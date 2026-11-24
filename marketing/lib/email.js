// "Needs Jack" alerts via Resend (same provider the site already uses).
// Without RESEND_FROM (your own verified domain) it sends from Resend's test
// address, which only delivers to the Resend account owner's inbox.
async function sendAlert({ subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.MARKETING_ALERT_EMAIL;
  if (!key || !to) { console.warn('Email alert skipped (RESEND_API_KEY / MARKETING_ALERT_EMAIL not set)'); return false; }
  const from = process.env.RESEND_FROM || 'Study-Uni Marketing <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.split(',').map(s => s.trim()), subject, html, text }),
  });
  if (!r.ok) { console.warn('Email alert failed:', r.status, (await r.text()).slice(0, 200)); return false; }
  return true;
}

module.exports = { sendAlert };
