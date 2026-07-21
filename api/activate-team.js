const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { session_id, team_id } = req.query || {};
  if (!session_id || !team_id) {
    return res.status(400).send('Missing session_id or team_id');
  }

  const origin = req.headers.origin || req.headers.referer?.split('/api')[0] || 'https://study-uni.vercel.app';

  try {
    // Verify Stripe payment
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.redirect(`${origin}/?team=failed`);
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pending team data
    const { data: pending, error: fetchErr } = await sb
      .from('pending_teams')
      .select('*')
      .eq('id', team_id)
      .single();

    if (fetchErr || !pending) {
      console.error('activate-team: pending not found', fetchErr?.message);
      return res.redirect(`${origin}/?team=failed`);
    }

    const members = typeof pending.members === 'string'
      ? JSON.parse(pending.members)
      : pending.members;
    const password = pending.password;

    // Create accounts for each member
    const results = [];
    for (const member of members) {
      try {
        // Create user (or get existing)
        const { data: created, error: createErr } = await sb.auth.admin.createUser({
          email: member.email,
          password,
          email_confirm: true,
        });

        let userId;
        if (createErr) {
          // User may already exist — look them up
          const { data: existing } = await sb.auth.admin.listUsers();
          const found = existing?.users?.find(u => u.email === member.email);
          if (!found) throw new Error('Could not create or find user: ' + createErr.message);
          userId = found.id;
        } else {
          userId = created.user.id;
        }

        // Upsert Pro subscription with allowed course
        await sb.from('subscriptions').upsert({
          id: userId,
          email: member.email,
          status: 'active',
          plan: pending.plan,
          allowed_course: member.course?.id || null,
          stripe_session_id: session_id,
          activated_at: new Date().toISOString(),
        });

        results.push({ email: member.email, ok: true });
      } catch (memberErr) {
        console.error('activate-team member error:', member.email, memberErr.message);
        results.push({ email: member.email, ok: false, error: memberErr.message });
      }
    }

    // Clean up pending record
    await sb.from('pending_teams').delete().eq('id', team_id);

    console.log('activate-team results:', results);
    return res.redirect(`${origin}/?team=activated`);
  } catch (err) {
    console.error('activate-team error:', err.message);
    return res.redirect(`${origin}/?team=failed`);
  }
};
