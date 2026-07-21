const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const TEAM_PRICES = () => ({
  duo:   process.env.STRIPE_PRICE_DUO,
  team5: process.env.STRIPE_PRICE_TEAM5,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plan, members, password } = req.body || {};

    if (!plan || !members || !password) {
      return res.status(400).json({ error: 'Missing plan, members, or password' });
    }
    const expectedCount = plan === 'duo' ? 2 : plan === 'team5' ? 5 : null;
    if (!expectedCount) return res.status(400).json({ error: 'Invalid plan' });
    if (!Array.isArray(members) || members.length !== expectedCount) {
      return res.status(400).json({ error: `Plan ${plan} requires exactly ${expectedCount} members` });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

    const prices = TEAM_PRICES();
    const priceId = prices[plan];
    if (!priceId) {
      return res.status(400).json({ error: `Stripe price for ${plan} not configured — add STRIPE_PRICE_${plan.toUpperCase()} to Vercel env vars` });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Store pending team data in Supabase so we can retrieve it after payment
    const { data: pending, error: insertErr } = await sb
      .from('pending_teams')
      .insert({
        plan,
        members: JSON.stringify(members),
        password,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr) throw new Error('Could not store team data: ' + insertErr.message);

    const origin = req.headers.origin || 'https://study-uni.vercel.app';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: { team_pending_id: String(pending.id), plan },
      success_url: `${origin}/api/activate-team?session_id={CHECKOUT_SESSION_ID}&team_id=${pending.id}`,
      cancel_url: `${origin}/?sub=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('team-checkout error:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
