const { createClient } = require('@supabase/supabase-js');

function normaliseCourse(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9 &]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(bcomm?|b comm?|commerce|ck ?201)\b/.test(s))                    return 'Commerce (BCom) — CK201';
  if (/\b(bfin|b ?sc ?finance|finance|ck ?203)\b/.test(s))                return 'Finance (BSc) — CK203';
  if (/\b(bacc|b ?acc(ounting)?|ck ?204)\b/.test(s))                      return 'Accounting (BAcc) — CK204';
  if (/\b(bis|business info|ck ?104)\b/.test(s))                          return 'Business Information Systems (BIS) — CK104';
  if (/global.{0,10}bus|bus.{0,10}econ|ck ??114/.test(s))                return 'Global Business (BBus) — CK114';
  if (/law.{0,6}(bus|business)|ck ?302/.test(s))                          return 'Law and Business — CK302';
  if (/\b(bcl|law)\b/.test(s))                                            return 'Law (BCL) — CK301';
  if (/comp.{0,6}sci|computer science|\bcs\b|ck ?401/.test(s))            return 'Computer Science (BSc) — CK401';
  if (/data.{0,6}(sci|analy)|ck ?413/.test(s))                           return 'Data Science & Analytics — CK413';
  if (/\b(mb|medicine|med)\b/.test(s))                                    return 'Medicine (MB) — CK701';
  if (/pharm/.test(s))                                                     return 'Pharmacy (MPharm) — CK702';
  if (/nurs/.test(s))                                                      return 'Nursing (BSc) — CK706';
  if (/civil.{0,6}eng|ck ?110/.test(s))                                   return 'Civil Engineering — CK110';
  if (/elec.{0,10}eng|ck ?111/.test(s))                                   return 'Electrical Engineering — CK111';
  if (/mech.{0,6}eng|ck ?112/.test(s))                                    return 'Mechanical Engineering — CK112';
  if (/chem.{0,6}(eng|process)|ck ?113/.test(s))                         return 'Chemical Engineering — CK113';
  if (/psycho/.test(s))                                                    return 'Psychology (BSc) — CK107';
  if (/\b(ba|arts)\b/.test(s) && !/business/.test(s))                     return 'Arts (BA) — CK101';
  if (/\bsci(ence)?\b/.test(s) && !/comp|data|info|computer/.test(s))     return 'Science (BSc)';
  // already canonical (from dropdown) — return as-is
  return raw.trim();
}

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
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);

    // All users (paginated — handles up to 10k)
    const { data: usersPage, error: listErr } = await sb.auth.admin.listUsers({ perPage: 10000 });
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const allUsers = (usersPage && usersPage.users) || [];
    const totalUsers = allUsers.length;
    const weeklySignups = allUsers.filter(u => u.created_at > weekAgo).length;
    const todaySignups = allUsers.filter(u => new Date(u.created_at) >= todayStart).length;

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
        course: u.user_metadata?.course || '',
        plan: ownerEmails.includes(u.email) ? 'Owner' : proIdSet.has(u.id) ? 'Pro' : 'Free',
        created_at: u.created_at,
        last_sign_in: u.last_sign_in_at,
      }));

    // Most signed-up courses (normalised to handle old free-text entries)
    const courseCounts = {};
    allUsers.forEach(u => {
      const course = normaliseCourse(u.user_metadata?.course);
      if (course) courseCounts[course] = (courseCounts[course] || 0) + 1;
    });
    const topSignupCourses = Object.entries(courseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([course, count]) => ({ course, count }));

    // Pro subscribers
    const proCount = proIdSet.size;

    // Most viewed courses — graceful if table doesn't exist
    let topCourses = [];
    try {
      const { data: views } = await sb.from('course_views')
        .select('course_id')
        .gt('created_at', weekAgo)
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
      todaySignups,
      proCount: proCount || 0,
      freeCount: totalUsers - (proCount || 0),
      conversionRate: totalUsers > 0 ? ((proCount || 0) / totalUsers * 100).toFixed(1) : '0.0',
      topCourses,
      topSignupCourses,
      quizStats,
      recentUsers,
      allMembers,
    });

  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
