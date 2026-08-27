const { Resend } = require('resend');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, firstName, lastName } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!audienceId) return res.status(500).json({ error: 'Newsletter not configured' });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.contacts.create({
      email,
      firstName: firstName || '',
      lastName: lastName || '',
      unsubscribed: false,
      audienceId,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('newsletter-subscribe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
