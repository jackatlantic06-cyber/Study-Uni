const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const ALLOWED_PRICES = () => new Set([
  process.env.STRIPE_PRICE_MONTHLY,
  process.env.STRIPE_PRICE_SEMESTER,
  process.env.STRIPE_PRICE_ANNUAL,
  process.env.STRIPE_PRICE_ID,
].filter(Boolean));

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, email, priceId } = req.body || {};
    if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

    const allowed = ALLOWED_PRICES();
    const selectedPrice = (priceId && allowed.has(priceId))
      ? priceId
      : (process.env.STRIPE_PRICE_MONTHLY || process.env.STRIPE_PRICE_ID);

    if (!selectedPrice) {
      return res.status(400).json({ error: 'No Stripe price configured — add STRIPE_PRICE_MONTHLY to Vercel env vars' });
    }

    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

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
      line_items: [{ price: selectedPrice, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}/api/activate-subscription?session_id={CHECKOUT_SESSION_ID}&user_id=${userId}`,
      cancel_url: `${origin}/?sub=cancel`,
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('checkout error:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
