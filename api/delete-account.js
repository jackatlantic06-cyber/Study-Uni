const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authError } = await sb.auth.getUser(accessToken);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  try {
    await sb.from('quiz_attempts').delete().eq('user_id', user.id);
    await sb.from('course_views').delete().eq('user_id', user.id);
    await sb.from('subscriptions').delete().eq('id', user.id);

    const { error } = await sb.auth.admin.deleteUser(user.id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete-account error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
