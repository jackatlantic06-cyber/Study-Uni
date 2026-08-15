const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, postId, content } = req.body || {};
  if (!accessToken || !postId || !content?.trim())
    return res.status(400).json({ error: 'Missing params' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });

  const { data: post } = await sb
    .from('module_posts')
    .select('*')
    .eq('id', postId)
    .is('deleted_at', null)
    .single();
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

  // Notify the original poster if it's a different user
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
    } catch (e) {
      console.error('Reply notification failed:', e.message);
    }
  }

  res.json({ reply });
};
