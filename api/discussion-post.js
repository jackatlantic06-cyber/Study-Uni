const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, moduleCode, content } = req.body || {};
  if (!accessToken || !moduleCode || !content?.trim())
    return res.status(400).json({ error: 'Missing params' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });

  const trimmed = content.trim().slice(0, 2000);
  const userName = user.user_metadata?.first_name || user.email.split('@')[0];

  const { data: post, error } = await sb.from('module_posts').insert({
    module_code: moduleCode,
    user_id: user.id,
    user_email: user.email,
    user_name: userName,
    content: trimmed,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ post: { ...post, replies: [] } });
};
