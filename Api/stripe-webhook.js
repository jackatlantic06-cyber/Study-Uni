import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } }; // IMPORTANT: raw body required

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // Read raw request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);
  const sig = req.headers['stripe-signature'];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Supabase (server) client
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = s.client_reference_id || null;
      const moduleCode = s.metadata?.module_code || null;

      // If user wasn’t logged in at checkout, we won’t have a userId; skip
      if (!userId) return res.json({ received: true });

      if (s.mode === 'subscription') {
        // Give Pro
        await supabase.from('entitlements').upsert({ user_id: userId, pro_active: true });
      } else if (s.mode === 'payment' && moduleCode) {
        // Record one-time module purchase
        await supabase.from('purchases').insert({ user_id: userId, module_code: moduleCode });
      }
    }

    // (Optional) if you later store user id on subscription, you can remove Pro on 'customer.subscription.deleted'

    res.json({ received: true });
  } catch (e) {
    res.status(500).send(`Supabase error: ${e.message}`);
  }
}
