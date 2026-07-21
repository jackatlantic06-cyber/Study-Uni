const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { session_id, user_id } = req.query || {};
  if (!session_id || !user_id) return res.redirect(302, '/?sub=error');

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    if (session.payment_status !== 'paid') return res.redirect(302, '/?sub=cancel');

    const sub = session.subscription;
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const courseId = session.metadata?.course_id || null;

    await sb.from('subscriptions').upsert({
      id: user_id,
      email: session.customer_details?.email,
      stripe_customer_id: typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id,
      stripe_subscription_id: sub?.id,
      is_active: true,
      current_period_end: sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      allowed_course: courseId,
    });

    res.redirect(302, '/?sub=success');
  } catch (err) {
    console.error('activate-subscription error:', err.message);
    res.redirect(302, '/?sub=error');
  }
};
