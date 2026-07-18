const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, youtubeUrl, accessToken } = req.body || {};

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

    let content = (text || '').trim();
    const { pdfBase64 } = req.body || {};

    // Extract text from PDF if provided
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

    // Fetch YouTube transcript if URL provided and no text
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

    // Truncate to ~8000 chars to keep costs predictable
    const truncated = content.slice(0, 8000);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are an expert study assistant. Based on the content below, generate study materials.

Produce EXACTLY:
- 8 flashcards covering the most important terms and concepts
- 5 multiple choice questions (MCQs) testing real understanding

Respond with ONLY valid JSON — no markdown, no code fences, no extra text:
{
  "flashcards": [
    {"front": "term or short question", "back": "definition or answer"}
  ],
  "mcqs": [
    {"q": "question text", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correct": 0, "explanation": "why the correct answer is right"}
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
