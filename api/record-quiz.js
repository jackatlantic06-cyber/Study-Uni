const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { accessToken, module_code, topic, score, total, pct } = req.body || {};
    if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: { user }, error: authError } = await sb.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

    await sb.from('quiz_attempts').insert({
      user_id: user.id,
      module_code: module_code || '',
      topic: topic || '',
      score: score || 0,
      total: total || 0,
      pct: pct || 0,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('record-quiz error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
