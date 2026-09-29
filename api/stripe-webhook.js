const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const getRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    return res.status(400).send('Could not read body');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated'
  ) {
    const sub = event.data.object;
    const customer = await stripe.customers.retrieve(sub.customer);
    const userId = customer.metadata?.supabase_id;
    if (userId) {
      await sb.from('subscriptions').upsert({
        id: userId,
        stripe_subscription_id: sub.id,
        is_active: sub.status === 'active',
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      });
    }
    // Send Pro confirmation email on new active subscription
    if (event.type === 'customer.subscription.created' && sub.status === 'active' && customer.email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const from = `Study-Uni <hello@${process.env.RESEND_FROM || 'resend.dev'}>`;
        const name = customer.name ? customer.name.split(' ')[0] : customer.email.split('@')[0];
        await resend.emails.send({
          from,
          to: customer.email,
          subject: "You're now Pro on Study-Uni ⭐",
          html: proConfirmHTML(name),
        });
      } catch (emailErr) {
        console.error('Pro confirm email failed:', emailErr.message);
      }
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customer = await stripe.customers.retrieve(sub.customer);
    const userId = customer.metadata?.supabase_id;
    if (userId) {
      await sb.from('subscriptions').upsert({ id: userId, is_active: false });
    }
  }

  res.json({ received: true });
};

function proConfirmHTML(name) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:20px;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:540px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:36px;margin-bottom:8px">⭐</div>
    <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0">You're now Pro!</h1>
    <p style="color:rgba(255,255,255,.8);font-size:13px;margin:6px 0 0">Study-Uni Pro is now active on your account</p>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:28px">
    <p style="font-size:16px;font-weight:600;margin:0 0 8px">Hi ${name},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px">
      Your Pro subscription is active. Here's everything you now have access to:
    </p>

    <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">✅ Now unlocked for you</div>
      <ul style="margin:0;padding-left:18px;color:#166534;font-size:14px;line-height:2.2">
        <li><strong>Marking schemes</strong> — official solutions for every paper</li>
        <li><strong>MCQ practice quizzes</strong> — with detailed explanations</li>
        <li><strong>StudyAI</strong> — AI predictions &amp; flashcards from your notes</li>
        <li><strong>Weekly performance reports</strong> — track your quiz scores</li>
      </ul>
    </div>

    <a href="https://study-uni.ie" style="display:block;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:16px">
      Start studying with Pro →
    </a>

    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">
      You can manage or cancel your subscription anytime at <a href="https://study-uni.ie" style="color:#6b7280">study-uni.ie</a> → Account settings.<br/>
      Study-Uni · UCC Students Only
    </p>
  </div>
</div>
</body>
</html>`;
}
