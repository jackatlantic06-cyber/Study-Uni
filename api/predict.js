const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const CACHE_DAYS = 30;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { moduleCode, moduleName, years } = req.body || {};
    if (!moduleCode) return res.status(400).json({ error: 'moduleCode required' });

    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Return cached prediction if fresh enough
    const { data: cached } = await sb
      .from('module_predictions')
      .select('prediction, created_at')
      .eq('module_code', moduleCode)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.created_at).getTime();
      if (ageMs < CACHE_DAYS * 86400000) {
        return res.json(cached.prediction);
      }
    }

    // Read marking scheme PDFs from disk
    const schemesDir = path.join(process.cwd(), 'marking-schemes');
    const paperTexts = [];

    try {
      const files = fs.readdirSync(schemesDir)
        .filter(f => f.startsWith(moduleCode + '_') && f.endsWith('.pdf'));

      for (const file of files) {
        try {
          const buf = fs.readFileSync(path.join(schemesDir, file));
          const parsed = await pdfParse(buf);
          const text = (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
          if (text.length > 50) {
            // Derive a clean year label from the filename
            const label = file
              .replace(moduleCode + '_', '')
              .replace(/_(Marking_?Scheme|Full_Marking_Scheme|Section[A-Z0-9]+_Marking_?Scheme|Paper\d+_Full_Marking_Scheme)\.pdf$/i, '')
              .replace(/_/g, ' ')
              .trim();
            paperTexts.push({ label, text });
          }
        } catch (e) { /* skip unreadable PDF */ }
      }
    } catch (e) { /* marking-schemes dir not accessible */ }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let prompt;

    if (paperTexts.length > 0) {
      prompt = `You are analysing UCC (University College Cork) past exam marking schemes to give students reliable, evidence-based topic predictions for their next exam.

Module: ${moduleName} (${moduleCode})
Papers available: ${(Array.isArray(years) && years.length ? years.join(', ') : 'multiple years')}
Marking schemes you have: ${paperTexts.length}

${paperTexts.map(p => `=== ${p.label} ===\n${p.text}`).join('\n\n')}

Carefully identify the specific topics, question types, and themes examined in each paper. Track exactly which years each topic appeared in.

Return ONLY valid JSON — no markdown, no extra text:
{
  "certain": [
    {"topic": "Specific topic name", "note": "X of ${paperTexts.length} years", "years": ["label1", "label2"]}
  ],
  "likely": [
    {"topic": "Specific topic name", "note": "X of ${paperTexts.length} years", "years": ["label1"]}
  ],
  "watchlist": [
    {"topic": "Specific topic name", "note": "appeared once — due a comeback", "years": ["label1"]}
  ],
  "sources": ${paperTexts.length},
  "based_on": "Analysis of ${paperTexts.length} past marking scheme${paperTexts.length !== 1 ? 's' : ''}"
}

Rules:
- "certain" = topic appeared in 70%+ of the available papers
- "likely" = appeared in 40–69% of papers
- "watchlist" = appeared once or is clearly part of the syllabus but hasn't appeared recently
- The "note" field MUST contain evidence like "3 of 4 years" or "appeared once — due a comeback"
- The "years" array must list the exact paper labels where this topic appeared
- Be highly specific to this module's actual content — not generic study tips
- Maximum 4 items per category`;
    } else {
      prompt = `You are an exam prediction assistant for UCC (University College Cork), Ireland.

Module: ${moduleName} (${moduleCode})
Papers available: ${(Array.isArray(years) && years.length ? years.join(', ') : 'multiple years')}

No marking schemes are available yet. Based on standard UCC curriculum patterns for this module, predict which topics are most likely to appear.

Return ONLY valid JSON — no markdown, no extra text:
{
  "certain": [{"topic": "...", "note": "typically examined every year", "years": []}],
  "likely": [{"topic": "...", "note": "frequently examined", "years": []}],
  "watchlist": [{"topic": "...", "note": "occasionally examined", "years": []}],
  "sources": 0,
  "based_on": "Curriculum patterns (no marking schemes uploaded yet)"
}

Maximum 4 items per category. Be specific to this module's actual content.`;
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse AI response');
    const prediction = JSON.parse(match[0]);

    // Cache in Supabase
    await sb.from('module_predictions').upsert({
      module_code: moduleCode,
      prediction,
      created_at: new Date().toISOString(),
    });

    return res.json(prediction);

  } catch (err) {
    console.error('predict error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
