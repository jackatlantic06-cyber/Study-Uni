const { Resend } = require('resend');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, firstName } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const name = firstName || email.split('@')[0];

    await resend.emails.send({
      from: 'Study-Uni <hello@study-uni.ie>',
      to: email,
      subject: 'Welcome to Study-Uni 🎓',
      html: welcomeHTML(name),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-welcome error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function welcomeHTML(name) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:20px;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:540px;margin:0 auto">
  <div style="background:#2563eb;padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">🎓</div>
    <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0">Welcome to Study-Uni!</h1>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:28px">
    <p style="font-size:16px;font-weight:600;margin:0 0 8px">Hi ${name},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px">
      You're in! Here's everything you can access right now on Study-Uni:
    </p>

    <div style="background:#f8fafc;border-radius:10px;padding:16px 20px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">✅ Free — available now</div>
      <ul style="margin:0;padding-left:18px;color:#0f172a;font-size:14px;line-height:2.1">
        <li>Every UCC past exam paper — all modules</li>
        <li>100+ courses across all degrees</li>
        <li>Search by module code or name</li>
        <li>Bookmark your modules for quick access</li>
      </ul>
    </div>

    <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:22px">
      <div style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">⚡ Pro — unlock everything for €4.99/mo</div>
      <ul style="margin:0;padding-left:18px;color:#1e3a8a;font-size:14px;line-height:2.1">
        <li>Official marking schemes &amp; worked solutions</li>
        <li>MCQ practice quizzes with explanations</li>
        <li>StudyAI — generate flashcards from your lecture notes or PDFs</li>
        <li>Weekly quiz performance reports</li>
      </ul>
    </div>

    <a href="https://study-uni.ie" style="display:block;background:#2563eb;color:#fff;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:8px">
      Start studying →
    </a>
    <a href="https://study-uni.ie/#pricing" style="display:block;background:#f1f5f9;color:#374151;text-align:center;padding:12px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none">
      Explore Pro →
    </a>

    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:20px 0 0">Study-Uni · UCC Students Only</p>
  </div>
</div>
</body>
</html>`;
}
