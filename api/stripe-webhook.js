const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

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
