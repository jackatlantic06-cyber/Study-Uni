const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

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
  const { data: item } = await sb.from(table).select('*').eq('id', id).single();
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: `Study-Uni <noreply@${process.env.RESEND_FROM || 'study-uni.ie'}>`,
        to: 'jackatlantic06@gmail.com',
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
    } catch (e) {
      console.error('Flag email failed:', e.message);
    }
  }

  res.json({ success: true });
};
