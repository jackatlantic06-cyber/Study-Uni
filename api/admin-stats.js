const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { user }, error: authError } = await sb.auth.getUser(accessToken);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const owners = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!owners.includes(user.email)) return res.status(403).json({ error: 'Not authorized' });

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // All users (paginated — handles up to 10k)
    const { data: usersPage, error: listErr } = await sb.auth.admin.listUsers({ perPage: 10000 });
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const allUsers = (usersPage && usersPage.users) || [];
    const totalUsers = allUsers.length;
    const weeklySignups = allUsers.filter(u => u.created_at > weekAgo).length;

    // Recent sign-ups (newest first, last 30)
    const recentUsers = allUsers
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30)
      .map(u => ({
        email: u.email,
        name: u.user_metadata?.full_name || [u.user_metadata?.first_name, u.user_metadata?.last_name].filter(Boolean).join(' ') || '',
        created_at: u.created_at,
        last_sign_in: u.last_sign_in_at,
      }));

    // All subscriptions for plan lookup
    const { data: allSubs } = await sb.from('subscriptions')
      .select('id, is_active, current_period_end');
    const proIdSet = new Set((allSubs || [])
      .filter(s => s.is_active && (!s.current_period_end || new Date(s.current_period_end) > new Date()))
      .map(s => s.id));

    const ownerEmails = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

    // Full member list (newest first)
    const allMembers = allUsers
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(u => ({
        email: u.email,
        name: u.user_metadata?.full_name || [u.user_metadata?.first_name, u.user_metadata?.last_name].filter(Boolean).join(' ') || '',
        plan: ownerEmails.includes(u.email) ? 'Owner' : proIdSet.has(u.id) ? 'Pro' : 'Free',
        created_at: u.created_at,
        last_sign_in: u.last_sign_in_at,
      }));

    // Pro subscribers
    const proCount = proIdSet.size;

    // Most viewed courses — graceful if table doesn't exist
    let topCourses = [];
    try {
      const { data: views } = await sb.from('course_views')
        .select('course_id')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (views && views.length > 0) {
        const counts = {};
        views.forEach(v => { counts[v.course_id] = (counts[v.course_id] || 0) + 1; });
        topCourses = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id, count]) => ({ id, count }));
      }
    } catch (_) {}

    // Quiz stats — graceful if table doesn't exist
    let quizStats = { total: 0, avgPct: 0 };
    try {
      const { data: attempts } = await sb.from('quiz_attempts')
        .select('pct')
        .gt('created_at', weekAgo);
      if (attempts && attempts.length > 0) {
        quizStats.total = attempts.length;
        quizStats.avgPct = Math.round(attempts.reduce((s, a) => s + (a.pct || 0), 0) / attempts.length);
      }
    } catch (_) {}

    return res.status(200).json({
      totalUsers,
      weeklySignups,
      proCount: proCount || 0,
      freeCount: totalUsers - (proCount || 0),
      conversionRate: totalUsers > 0 ? ((proCount || 0) / totalUsers * 100).toFixed(1) : '0.0',
      topCourses,
      quizStats,
      recentUsers,
      allMembers,
    });

  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
