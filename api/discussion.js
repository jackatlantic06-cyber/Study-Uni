const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, accessToken, moduleCode, content, postId, type, id } = req.body || {};
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });

  if (action === 'fetch') {
    if (!moduleCode) return res.status(400).json({ error: 'Missing moduleCode' });
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
    return res.json({ posts: postsWithReplies, currentUserId: user.id });
  }

  if (action === 'post') {
    if (!moduleCode || !content?.trim()) return res.status(400).json({ error: 'Missing params' });
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
    return res.json({ post: { ...post, replies: [] } });
  }

  if (action === 'reply') {
    if (!postId || !content?.trim()) return res.status(400).json({ error: 'Missing params' });
    const { data: post } = await sb
      .from('module_posts').select('*').eq('id', postId).is('deleted_at', null).single();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const trimmed = content.trim().slice(0, 1000);
    const userName = user.user_metadata?.first_name || user.email.split('@')[0];
    const { data: reply, error } = await sb.from('module_replies').insert({
      post_id: postId,
      user_id: user.id,
      user_email: user.email,
      user_name: userName,
      content: trimmed,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (post.user_email && post.user_email !== user.email && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const preview = post.content.length > 80 ? post.content.slice(0, 80) + '…' : post.content;
        const replyPreview = trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed;
        await resend.emails.send({
          from: `Study-Uni <noreply@${process.env.RESEND_FROM || 'study-uni.ie'}>`,
          to: post.user_email,
          subject: `${userName} replied to your post in ${post.module_code}`,
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="font-size:18px;margin-bottom:4px">Someone replied to your post 💬</h2>
            <p style="color:#64748b;font-size:14px;margin-bottom:20px">${post.module_code} discussion on Study-Uni</p>
            <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;margin-bottom:12px;border-left:3px solid #94a3b8">
              <p style="font-size:12px;color:#94a3b8;margin:0 0 6px">Your post</p>
              <p style="margin:0;font-size:14px;color:#334155">${preview.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
            </div>
            <div style="background:#eff6ff;border-radius:8px;padding:14px 16px;border-left:3px solid #3b82f6">
              <p style="font-size:12px;color:#3b82f6;margin:0 0 6px"><strong>${userName}</strong> replied</p>
              <p style="margin:0;font-size:14px;color:#1e3a5f">${replyPreview.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
            </div>
            <p style="margin-top:20px"><a href="https://www.study-uni.ie" style="color:#3b82f6">Open Study-Uni →</a></p>
          </div>`,
        });
      } catch (e) { console.error('Reply notification failed:', e.message); }
    }
    return res.json({ reply });
  }

  if (action === 'delete') {
    if (!type || !id) return res.status(400).json({ error: 'Missing params' });
    const table = type === 'reply' ? 'module_replies' : 'module_posts';
    const { data: item } = await sb.from(table).select('user_id').eq('id', id).single();
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.user_id !== user.id) return res.status(403).json({ error: 'Not your post' });
    const { error } = await sb.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  if (action === 'flag') {
    if (!type || !id) return res.status(400).json({ error: 'Missing params' });
    const table = type === 'reply' ? 'module_replies' : 'module_posts';
    const { data: item } = await sb.from(table).select('*').eq('id', id).single();
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: `Study-Uni <noreply@${process.env.RESEND_FROM || 'study-uni.ie'}>`,
          to: 'studyuni26@gmail.com',
          subject: `🚩 Flagged ${type} — ${item.module_code || ''}`,
          html: `<div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#dc2626">🚩 Content flagged on Study-Uni</h2>
            <table style="border-collapse:collapse;width:100%;font-size:14px">
              <tr><td style="padding:6px 0;color:#64748b;width:120px">Type</td><td><strong>${type}</strong></td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Module</td><td>${item.module_code || '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Posted by</td><td>${item.user_email}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Flagged by</td><td>${user.email}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Post ID</td><td style="font-family:monospace;font-size:12px">${id}</td></tr>
            </table>
            <div style="background:#fef2f2;border-radius:8px;padding:14px 16px;margin-top:16px;border-left:3px solid #dc2626">
              <p style="margin:0;font-size:14px">${(item.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
            </div>
            <p style="margin-top:16px;font-size:13px;color:#64748b">To delete this content, go to your Supabase dashboard and soft-delete the row (set deleted_at = now()).</p>
          </div>`,
        });
      } catch (e) { console.error('Flag email failed:', e.message); }
    }
    return res.json({ success: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
