// Owner-only marketing dashboard actions. Called from api/admin-stats.js
// AFTER it has verified the Supabase session and OWNER_EMAILS, so every
// function here can assume `ownerEmail` is an owner.
//
// Phase B: approve/schedule only change status in Supabase. Nothing is sent
// to Postiz from here until Phase E.

const { checkText } = require('./marketing-rules');

const EDITABLE = ['pending_review'];
const ACTIONS = ['mkt-overview', 'mkt-approve', 'mkt-unschedule', 'mkt-caption', 'mkt-reject', 'mkt-comment'];

const POST_COLS = 'id, post_key, week, platform, format, status, title, hook, script, caption, link, media, ai_label, compliance, scheduled_for, approved_by, approved_at, rejected_reason, release_url, published_at, error, is_demo, created_at';

function bad(res, code, msg) { return res.status(code).json({ error: msg }); }

// Media lives in the private "marketing-media" bucket; give the dashboard
// signed links that expire after 2 hours.
const MEDIA_BUCKET = 'marketing-media';
async function signMedia(sb, posts) {
  const paths = [];
  for (const p of posts) for (const m of (Array.isArray(p.media) ? p.media : [])) if (m && m.path && !m.url) paths.push(m.path);
  if (!paths.length) return;
  const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrls([...new Set(paths)], 7200);
  if (error) { console.error('signMedia:', error.message); return; }
  const byPath = {};
  for (const d of data || []) if (d.signedUrl) byPath[d.path] = d.signedUrl;
  for (const p of posts) for (const m of (Array.isArray(p.media) ? p.media : [])) if (m && m.path && byPath[m.path]) m.url = byPath[m.path];
}

async function audit(sb, actor, action, postId, detail) {
  try { await sb.from('mkt_audit').insert({ actor, action, post_id: postId || null, detail: detail || null }); } catch (_) {}
}

async function getPost(sb, id) {
  if (!id || typeof id !== 'string') return null;
  const { data } = await sb.from('mkt_posts').select(POST_COLS).eq('id', id).maybeSingle();
  return data || null;
}

// Sign-ups per post_key, plus yesterday / 7-day totals.
async function signupCounts(sb) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 10000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const users = (data && data.users) || [];
  const byContent = {};
  const now = new Date();
  const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0);
  const yStart = new Date(todayStart.getTime() - 86400000);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const totals = { today: 0, yesterday: 0, week: 0, weekTracked: 0, weekSocial: 0 };
  users.forEach(u => {
    const s = (u.user_metadata && u.user_metadata.signup_source) || {};
    if (s.content) byContent[s.content] = (byContent[s.content] || 0) + 1;
    const c = new Date(u.created_at);
    if (c >= todayStart) totals.today++;
    else if (c >= yStart) totals.yesterday++;
    if (c >= weekAgo) {
      totals.week++;
      if (s.content) totals.weekTracked++;
      if (s.medium === 'social') totals.weekSocial++;
    }
  });
  return { byContent, totals };
}

async function overview(sb, res) {
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [queueR, upcomingR, recentR, failedR, commentsR, briefR, learnR, signups] = await Promise.all([
    sb.from('mkt_posts').select(POST_COLS).eq('status', 'pending_review').order('created_at', { ascending: true }).limit(50),
    sb.from('mkt_posts').select(POST_COLS).in('status', ['approved', 'publishing']).order('scheduled_for', { ascending: true, nullsFirst: true }).limit(50),
    sb.from('mkt_posts').select(POST_COLS).eq('status', 'published').gte('published_at', since30).order('published_at', { ascending: false }).limit(60),
    sb.from('mkt_posts').select(POST_COLS).eq('status', 'failed').order('updated_at', { ascending: false }).limit(20),
    sb.from('mkt_comments').select('id, platform, post_id, author, body, commented_at, category, reply_draft, status, created_at').in('status', ['needs_jack', 'draft']).order('created_at', { ascending: false }).limit(50),
    sb.from('mkt_briefs').select('*').order('created_at', { ascending: false }).limit(1),
    sb.from('mkt_learnings').select('*').order('created_at', { ascending: false }).limit(1),
    signupCounts(sb),
  ]);
  const firstErr = [queueR, upcomingR, recentR, failedR, commentsR, briefR, learnR].find(r => r.error);
  if (firstErr) {
    const msg = firstErr.error.message || '';
    if (/relation .*mkt_|does not exist|schema cache/i.test(msg)) {
      return res.status(200).json({ setupNeeded: true, error: 'Marketing tables not found — run supabase/migrations/001_marketing.sql in the Supabase SQL editor.' });
    }
    throw new Error(msg);
  }

  await signMedia(sb, [...(queueR.data || []), ...(upcomingR.data || []), ...(failedR.data || [])]);

  // Latest stats snapshot per published post
  const recent = recentR.data || [];
  let latest = {};
  if (recent.length) {
    const { data: stats } = await sb.from('mkt_post_stats')
      .select('post_id, captured_at, views, likes, comments, shares, saves')
      .in('post_id', recent.map(p => p.id))
      .order('captured_at', { ascending: false })
      .limit(2000);
    (stats || []).forEach(s => { if (!latest[s.post_id]) latest[s.post_id] = s; });
  }
  const withStats = recent.map(p => Object.assign({}, p, {
    stats: latest[p.id] || null,
    signups: signups.byContent[p.post_key] || 0,
  }));

  const comments = commentsR.data || [];
  const upcoming = upcomingR.data || [];
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const summary = {
    signupsToday: signups.totals.today,
    signupsYesterday: signups.totals.yesterday,
    signupsWeek: signups.totals.week,
    signupsWeekFromPosts: signups.totals.weekTracked,
    awaitingApproval: (queueR.data || []).length,
    goingOutToday: upcoming.filter(p => !p.scheduled_for || new Date(p.scheduled_for) <= todayEnd).length,
    needsJack: comments.filter(c => c.status === 'needs_jack').length,
    replyDrafts: comments.filter(c => c.status === 'draft').length,
    failed: (failedR.data || []).length,
    topPost: withStats.slice().sort((a, b) => (b.signups - a.signups) || (((b.stats && b.stats.views) || 0) - ((a.stats && a.stats.views) || 0)))[0] || null,
  };

  return res.status(200).json({
    publishingEnabled: !!process.env.POSTIZ_API_KEY,
    summary,
    queue: queueR.data || [],
    upcoming,
    failed: failedR.data || [],
    published: withStats,
    comments,
    brief: (briefR.data || [])[0] || null,
    learning: (learnR.data || [])[0] || null,
  });
}

async function approve(sb, res, ownerEmail, body) {
  const post = await getPost(sb, body.postId);
  if (!post) return bad(res, 404, 'Post not found');
  if (post.status !== 'pending_review') return bad(res, 409, `Post is ${post.status}, not awaiting approval`);
  if (!post.compliance || post.compliance.passed !== true) return bad(res, 409, 'Post has not passed the compliance check');
  const recheck = checkText([post.hook, post.caption].join('\n'));
  if (!recheck.passed) return bad(res, 409, 'Caption breaks the content rules: ' + recheck.blocked.join('; '));
  if (!Array.isArray(post.media) || post.media.length === 0) return bad(res, 409, 'Post has no media yet');

  let when = null;
  if (body.scheduledFor) {
    const d = new Date(body.scheduledFor);
    if (isNaN(d)) return bad(res, 400, 'Invalid date');
    if (d.getTime() < Date.now() - 5 * 60000) return bad(res, 400, 'That time is in the past');
    if (d.getTime() > Date.now() + 60 * 86400000) return bad(res, 400, 'Schedule within the next 60 days');
    when = d.toISOString();
  }
  const { data, error } = await sb.from('mkt_posts')
    .update({ status: 'approved', scheduled_for: when || new Date().toISOString(), approved_by: ownerEmail, approved_at: new Date().toISOString(), error: null })
    .eq('id', post.id).eq('status', 'pending_review')
    .select(POST_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return bad(res, 409, 'Post changed — refresh and try again');
  await audit(sb, ownerEmail, when ? 'schedule' : 'approve', post.id, { scheduled_for: data.scheduled_for });
  return res.status(200).json({ ok: true, post: data });
}

async function unschedule(sb, res, ownerEmail, body) {
  const post = await getPost(sb, body.postId);
  if (!post) return bad(res, 404, 'Post not found');
  if (post.status !== 'approved') return bad(res, 409, `Post is ${post.status} — can only unschedule approved posts`);
  const { data, error } = await sb.from('mkt_posts')
    .update({ status: 'pending_review', scheduled_for: null, approved_by: null, approved_at: null })
    .eq('id', post.id).eq('status', 'approved')
    .select(POST_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return bad(res, 409, 'Post is already being published');
  await audit(sb, ownerEmail, 'unschedule', post.id, null);
  return res.status(200).json({ ok: true, post: data });
}

async function caption(sb, res, ownerEmail, body) {
  const post = await getPost(sb, body.postId);
  if (!post) return bad(res, 404, 'Post not found');
  if (!EDITABLE.includes(post.status)) return bad(res, 409, 'Unschedule the post before editing its caption');
  const text = String(body.caption || '').trim();
  if (!text) return bad(res, 400, 'Caption is empty');
  if (text.length > 2200) return bad(res, 400, 'Caption is over 2,200 characters');
  const check = checkText(text);
  if (!check.passed) return bad(res, 400, 'Caption breaks the content rules: ' + check.blocked.join('; '));
  const compliance = Object.assign({}, post.compliance || {}, {
    caption_edited_by: ownerEmail, caption_warnings: check.warnings, caption_checked_at: new Date().toISOString(),
  });
  const { data, error } = await sb.from('mkt_posts')
    .update({ caption: text, compliance })
    .eq('id', post.id).eq('status', 'pending_review')
    .select(POST_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return bad(res, 409, 'Post changed — refresh and try again');
  await audit(sb, ownerEmail, 'edit_caption', post.id, { before: post.caption, after: text });
  return res.status(200).json({ ok: true, post: data, warnings: check.warnings });
}

async function reject(sb, res, ownerEmail, body) {
  const post = await getPost(sb, body.postId);
  if (!post) return bad(res, 404, 'Post not found');
  if (!['pending_review', 'approved', 'failed', 'draft'].includes(post.status)) return bad(res, 409, `Post is ${post.status}`);
  const reason = String(body.reason || '').slice(0, 500) || null;
  const { data, error } = await sb.from('mkt_posts')
    .update({ status: 'rejected', rejected_reason: reason, scheduled_for: null })
    .eq('id', post.id).eq('status', post.status)
    .select(POST_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return bad(res, 409, 'Post changed — refresh and try again');
  await audit(sb, ownerEmail, 'reject', post.id, { reason });
  return res.status(200).json({ ok: true, post: data });
}

async function comment(sb, res, ownerEmail, body) {
  const status = body.status;
  if (!['done', 'ignored'].includes(status)) return bad(res, 400, 'Invalid status');
  if (!body.commentId) return bad(res, 400, 'Missing comment');
  const { data, error } = await sb.from('mkt_comments')
    .update({ status }).eq('id', body.commentId).in('status', ['needs_jack', 'draft', 'new'])
    .select('id, status').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return bad(res, 404, 'Comment not found');
  await audit(sb, ownerEmail, 'comment_' + status, null, { comment_id: body.commentId });
  return res.status(200).json({ ok: true });
}

async function handle(sb, res, ownerEmail, body) {
  try {
    switch (body.action) {
      case 'mkt-overview':   return await overview(sb, res);
      case 'mkt-approve':    return await approve(sb, res, ownerEmail, body);
      case 'mkt-unschedule': return await unschedule(sb, res, ownerEmail, body);
      case 'mkt-caption':    return await caption(sb, res, ownerEmail, body);
      case 'mkt-reject':     return await reject(sb, res, ownerEmail, body);
      case 'mkt-comment':    return await comment(sb, res, ownerEmail, body);
      default:               return bad(res, 400, 'Unknown action');
    }
  } catch (err) {
    console.error('marketing-api error:', err.message);
    return bad(res, 500, err.message || 'Server error');
  }
}

module.exports = { handle, ACTIONS };
