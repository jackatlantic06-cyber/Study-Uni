const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, moduleCode } = req.body || {};
  if (!accessToken || !moduleCode) return res.status(400).json({ error: 'Missing params' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });

  const { data: posts, error } = await sb
    .from('module_posts')
    .select('*')
    .eq('module_code', moduleCode)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  const postIds = (posts || []).map(p => p.id);
  let replies = [];
  if (postIds.length > 0) {
    const { data: replyData } = await sb
      .from('module_replies')
      .select('*')
      .in('post_id', postIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    replies = replyData || [];
  }

  const postsWithReplies = (posts || []).map(p => ({
    ...p,
    replies: replies.filter(r => r.post_id === p.id),
  }));

  res.json({ posts: postsWithReplies, currentUserId: user.id });
};
