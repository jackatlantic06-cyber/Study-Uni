const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, email } = req.body || {};
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Get or create Stripe customer
  const { data: profile } = await sb
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { supabase_id: userId },
    });
    customerId = customer.id;
    await sb.from('subscriptions').upsert({ id: userId, email, stripe_customer_id: customerId });
  }

  const origin = req.headers.origin || 'https://study-uni.vercel.app';
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    mode: 'subscription',
    success_url: `${origin}/api/activate-subscription?session_id={CHECKOUT_SESSION_ID}&user_id=${userId}`,
    cancel_url: `${origin}/?sub=cancel`,
  });

  res.json({ url: session.url });
};
