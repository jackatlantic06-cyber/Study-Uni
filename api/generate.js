const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, youtubeUrl, accessToken, pdfBase64, count, keywords, action, exams, hoursPerDay, startDate, restDays } = req.body || {};

    if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: { user }, error: authError } = await sb.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session — please sign in again' });

    // Owner / Pro bypass
    const owners    = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    const proEmails = (process.env.PRO_EMAILS   || '').split(',').map(e => e.trim()).filter(Boolean);
    const bypass    = owners.includes(user.email) || proEmails.includes(user.email);

    if (!bypass) {
      const { data: sub } = await sb.from('subscriptions')
        .select('is_active,current_period_end')
        .eq('id', user.id)
        .maybeSingle();
      const isPro = !!(sub && sub.is_active &&
        (!sub.current_period_end || new Date(sub.current_period_end) > new Date()));
      if (!isPro) return res.status(403).json({ error: 'Pro subscription required' });
    }

    // ── Study Planner ──────────────────────────────────────────────────────
    if (action === 'planner') {
      if (!exams || !exams.length) return res.status(400).json({ error: 'Please add at least one exam' });
      const restList = (restDays || []).join(', ') || 'None';
      const hrs      = Math.min(Math.max(parseInt(hoursPerDay) || 4, 1), 12);
      const lastExamDate = exams.map(e => e.date).sort().pop();
      const start = new Date(startDate + 'T12:00:00');
      const end   = new Date(lastExamDate + 'T12:00:00');
      const daySpan = Math.round((end - start) / (1000 * 60 * 60 * 24));
      if (daySpan > 14) return res.status(400).json({ error: `Your schedule spans ${daySpan} days — please set a start date within 14 days of your last exam for a focused two-week plan.` });

      const examDetails = exams.map(e =>
        `- Module: ${e.subject}  |  Exam date: ${e.date}  |  Topics: ${(e.topics || []).join(', ')}`
      ).join('\n');

      const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{ role: 'user', content:
`You are a UCC study planning expert. Create a day-by-day study schedule using Study-Uni resources.

Start date: ${startDate}
Available study hours per day: ${hrs}
Rest days (no studying): ${restList}

Modules and topics:
${examDetails}

TASK TYPES — for each topic, cycle through these task types across different days:
1. "quiz"     — "Do the Study-Uni quiz on [Topic]" (use this first for a topic)
2. "paper"    — "Attempt past paper questions on [Topic]"
3. "marking"  — "Review marking scheme for [Topic]"
4. "revision" — "Consolidate notes on [Topic]" (for a final pass)

RULES:
- Schedule from start date up to and including the last exam date
- Rest days: include in schedule with empty sessions array and totalHours 0
- Day before each exam: sessions for THAT module only — type "revision", topic "Full timed past paper + marking scheme review", max 1.5h total
- Spread topics across days; cover each topic at least twice with different task types
- Prioritise modules whose exams are sooner
- Sessions within a day can mix different modules and topics
- Daily totalHours must not exceed ${hrs}; each session 0.5–2h
- "topic" field = short label e.g. "Supply & Demand — Quiz". "detail" = action sentence

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "summary": "One sentence overview",
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "dayName": "Monday",
      "sessions": [
        {
          "subject": "EC1208",
          "topic": "Supply & Demand — Quiz",
          "detail": "Do the Study-Uni quiz on Supply & Demand",
          "type": "quiz",
          "hours": 1
        }
      ],
      "totalHours": 3,
      "note": "Optional encouragement (omit if nothing useful)"
    }
  ]
}` }]
      });
      const raw = message.content[0].text;
      let result;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        result = JSON.parse(m ? m[0] : raw);
        if (!Array.isArray(result.schedule)) throw new Error('Invalid structure');
      } catch(e) {
        console.error('Planner parse error:', e.message, '| Raw:', raw.slice(0, 200));
        return res.status(500).json({ error: 'Could not generate plan — please try again' });
      }
      return res.status(200).json(result);
    }

    const cardCount = Math.min(Math.max(parseInt(count) || 8, 4), 12);
    const mcqCount  = Math.min(cardCount, 8);
    const kwLine    = keywords ? `\nFocus especially on these topics: ${keywords}` : '';

    let content = (text || '').trim();
    const { pdfBase64: _pdf } = req.body || {};

    if (pdfBase64 && !content) {
      try {
        const pdfParse = require('pdf-parse');
        const buffer = Buffer.from(pdfBase64, 'base64');
        const parsed = await pdfParse(buffer);
        content = (parsed.text || '').replace(/\s+/g, ' ').trim();
        if (!content) return res.status(400).json({ error: 'Could not extract text from PDF. Try a text-based PDF rather than a scanned image.' });
      } catch (e) {
        return res.status(400).json({ error: 'PDF could not be read: ' + e.message });
      }
    }

    if (youtubeUrl && !content) {
      try {
        const { YoutubeTranscript } = require('youtube-transcript');
        const m = youtubeUrl.match(/(?:v=|youtu\.be\/|embed\/)([^&\n?#]+)/);
        if (!m) return res.status(400).json({ error: 'Invalid YouTube URL' });
        const transcript = await YoutubeTranscript.fetchTranscript(m[1]);
        content = transcript.map(t => t.text).join(' ');
      } catch (e) {
        return res.status(400).json({
          error: 'Could not fetch transcript. Try a video with captions enabled, or paste the text directly.'
        });
      }
    }

    if (!content || content.length < 80) {
      return res.status(400).json({ error: 'Please provide more content (at least 80 characters)' });
    }

    const truncated = content.slice(0, 8000);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are an expert study assistant. Generate study materials from the content below.${kwLine}

Produce EXACTLY ${cardCount} flashcards and ${mcqCount} MCQs.

FLASHCARD RULES (critical):
- "front": A short topic name or key term — 2 to 6 words, NO questions, NO "What is..."
- "back": A concise explanation — 2 to 3 sentences maximum, clear and memorable

Good flashcard examples:
- {"front": "Law of Demand", "back": "As price rises, quantity demanded falls, assuming all else equal. This inverse relationship exists because higher prices make goods relatively less attractive compared to substitutes."}
- {"front": "Types of Unemployment", "back": "Cyclical unemployment is caused by economic downturns. Structural unemployment stems from skills mismatches. Frictional unemployment occurs between jobs."}

Bad examples (never do this):
- front: "What is the law of demand?" — NO questions on the front
- back: four or more sentences — too long

MCQ RULES:
- 4 options (A, B, C, D format)
- Test real understanding, not just recall
- Include a clear explanation

Also generate a short title (3–5 words) summarising the main topic of these notes.

Respond with ONLY valid JSON — no markdown, no code fences:
{
  "title": "Short Topic Title",
  "flashcards": [
    {"front": "Topic Name", "back": "Concise explanation in 2-3 sentences."}
  ],
  "mcqs": [
    {"q": "Question text", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correct": 0, "explanation": "Why this answer is correct"}
  ]
}

Content:
${truncated}`
      }]
    });

    const raw = message.content[0].text;
    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      if (!Array.isArray(result.flashcards) || !Array.isArray(result.mcqs)) throw new Error('Invalid structure');
    } catch (e) {
      console.error('AI parse error:', e.message, '| Raw:', raw.slice(0, 200));
      return res.status(500).json({ error: 'AI response could not be parsed — please try again' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('generate error:', err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
