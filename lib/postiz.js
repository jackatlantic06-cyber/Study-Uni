// Postiz public API client, shared by the dashboard API (Vercel) and the
// marketing jobs (GitHub Actions).  Docs: https://docs.postiz.com/public-api
//
// Safety rules enforced here, not just in callers:
//  - only posts with status 'approved'/'publishing', approved_by set, a passed
//    compliance check and is_demo = false are ever sent;
//  - TikTok always uses content_posting_method DIRECT_POST;
//  - media is uploaded to Postiz first and the returned path is used.
const BASE = process.env.POSTIZ_API_URL || 'https://api.postiz.com/public/v1';

function enabled() { return !!process.env.POSTIZ_API_KEY; }

async function api(path, { method = 'GET', body, form } = {}) {
  if (!enabled()) throw new Error('POSTIZ_API_KEY is not set');
  const headers = { Authorization: process.env.POSTIZ_API_KEY };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!r.ok) {
    const msg = (json && (json.message || json.error)) || text;
    const err = new Error(`Postiz ${method} ${path} ${r.status}: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

// Connected channels → { tiktok: {id,name}, instagram: {id,name,type} }
let channelsCache = null;
async function channels() {
  if (channelsCache) return channelsCache;
  const list = await api('/integrations');
  const live = (list || []).filter(i => !i.disabled);
  const tt = live.find(i => i.identifier === 'tiktok') || live.find(i => i.identifier === 'tiktok-business');
  const ig = live.find(i => i.identifier === 'instagram') || live.find(i => i.identifier === 'instagram-standalone');
  channelsCache = {
    tiktok: tt ? { id: process.env.POSTIZ_TIKTOK_ID || tt.id, name: tt.name, type: tt.identifier } : null,
    instagram: ig ? { id: process.env.POSTIZ_INSTAGRAM_ID || ig.id, name: ig.name, type: ig.identifier } : null,
    all: (list || []).map(i => ({ id: i.id, name: i.name, identifier: i.identifier, disabled: !!i.disabled })),
  };
  return channelsCache;
}

// Upload by public HTTPS URL (our signed Supabase link) → {id, path}
async function uploadFromUrl(url) {
  const r = await api('/upload-from-url', { method: 'POST', body: { url } });
  if (!r || !r.path) throw new Error('Postiz upload returned no path');
  return { id: r.id, path: r.path };
}

// Same fields for "tiktok" and "tiktok-business" channels.
function tiktokSettings(post, type) {
  return {
    __type: type || 'tiktok',
    title: String(post.hook || post.title || '').slice(0, 90),
    privacy_level: 'PUBLIC_TO_EVERYONE',
    duet: false,
    stitch: false,
    comment: true,
    autoAddMusic: 'no',
    brand_content_toggle: false,
    brand_organic_toggle: true,          // promoting our own business ("Your brand")
    video_made_with_ai: !!post.ai_label,  // TikTok AI-generated content label
    content_posting_method: 'DIRECT_POST',
  };
}

function instagramSettings(post, type) {
  return {
    __type: type || 'instagram',
    post_type: 'post',                    // single video → Reel, 2+ images → carousel
    made_with_ai: !!post.ai_label,
    is_trial_reel: false,
    collaborators: [],
  };
}

function assertPublishable(post) {
  if (!['approved', 'publishing'].includes(post.status)) throw new Error(`refusing to publish: status is ${post.status}`);
  if (!post.approved_by) throw new Error('refusing to publish: not approved by an owner');
  if (!post.compliance || post.compliance.passed !== true) throw new Error('refusing to publish: compliance check not passed');
  if (post.is_demo) throw new Error('refusing to publish: demo post');
  if (!Array.isArray(post.media) || !post.media.some(m => m.kind === 'video' || m.kind === 'image')) throw new Error('refusing to publish: no media');
}

// signedUrl(path) → public https URL Postiz can fetch.
// Returns { postizId } after scheduling the post in Postiz.
async function schedulePost(post, signedUrl) {
  assertPublishable(post);
  const ch = await channels();
  const channel = post.platform === 'tiktok' ? ch.tiktok : ch.instagram;
  if (!channel) throw new Error(`No connected ${post.platform} channel in Postiz`);

  const files = post.format === 'video'
    ? post.media.filter(m => m.kind === 'video').slice(0, 1)
    : post.media.filter(m => m.kind === 'image');
  const image = [];
  for (const m of files) image.push(await uploadFromUrl(await signedUrl(m.path)));

  const when = post.scheduled_for && new Date(post.scheduled_for) > new Date(Date.now() + 60000)
    ? new Date(post.scheduled_for) : new Date(Date.now() + 2 * 60000);
  const settings = post.platform === 'tiktok' ? tiktokSettings(post, ch.tiktok.type) : instagramSettings(post, ch.instagram.type);

  const res = await api('/posts', {
    method: 'POST',
    body: {
      type: 'schedule',
      date: when.toISOString(),
      shortLink: false,
      tags: [],
      posts: [{ integration: { id: channel.id }, value: [{ content: post.caption, image }], settings }],
    },
  });
  const created = Array.isArray(res) ? res[0] : res;
  if (!created || !created.postId) throw new Error('Postiz did not return a post id');
  return { postizId: created.postId, date: when.toISOString() };
}

async function deletePost(postizId) {
  try { await api(`/posts/${encodeURIComponent(postizId)}`, { method: 'DELETE' }); }
  catch (e) { if (e.status !== 404) throw e; }
}

async function listPosts(startDate, endDate) {
  const q = new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString() });
  const r = await api('/posts?' + q);
  return (r && r.posts) || [];
}

async function postAnalytics(postizId, days = 30) {
  return api(`/analytics/post/${encodeURIComponent(postizId)}?date=${days}`);
}

module.exports = { enabled, channels, schedulePost, deletePost, listPosts, postAnalytics, uploadFromUrl, api };
