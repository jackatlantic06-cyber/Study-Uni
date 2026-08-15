const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, type, id } = req.body || {};
  if (!accessToken || !type || !id) return res.status(400).json({ error: 'Missing params' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });

  const table = type === 'reply' ? 'module_replies' : 'module_posts';

  const { data: item } = await sb.from(table).select('user_id').eq('id', id).single();
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.user_id !== user.id) return res.status(403).json({ error: 'Not your post' });

  const { error } = await sb
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
};
