import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const { priceId, mode, moduleCode, supabaseUserId, successUrl, cancelUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode, // 'subscription' | 'payment'
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: supabaseUserId || undefined,
      metadata: moduleCode ? { module_code: moduleCode } : {},
      allow_promotion_codes: true,
      automatic_tax: { enabled: true } // optional
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
