// Instagram API (Instagram Login): read comments on our posts, reply to them.
// Token: starts from the IG_ACCESS_TOKEN secret (a 60-day long-lived token);
// the job refreshes it weekly and keeps the newest one in the private
// storage bucket (config/ig-token.json), so it never expires while in use.
const GRAPH = 'https://graph.instagram.com';
const BUCKET = 'marketing-media';
const TOKEN_FILE = 'config/ig-token.json';

let state = null; // { token, refreshed_at }

async function loadToken(db) {
  if (state) return state.token;
  const { data } = await db.storage.from(BUCKET).download(TOKEN_FILE);
  if (data) { try { state = JSON.parse(await data.text()); } catch (_) {} }
  if (!state || !state.token) {
    if (!process.env.IG_ACCESS_TOKEN) return null;
    state = { token: process.env.IG_ACCESS_TOKEN.trim(), refreshed_at: null };
  }
  // Refresh weekly (token must be at least 24h old; refreshed one lasts 60 days).
  // Only Instagram Login tokens ("IG…") need this; system-user tokens never expire.
  const age = state.refreshed_at ? Date.now() - new Date(state.refreshed_at).getTime() : Infinity;
  if (age > 7 * 86400e3 && /^IG/.test(state.token)) {
    try {
      const r = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(state.token)}`);
      const j = await r.json();
      if (r.ok && j.access_token) {
        state = { token: j.access_token, refreshed_at: new Date().toISOString(), expires_in: j.expires_in };
        await db.storage.from(BUCKET).upload(TOKEN_FILE, Buffer.from(JSON.stringify(state)), { contentType: 'application/json', upsert: true });
        console.log('Instagram token refreshed.');
      } else console.warn('Instagram token refresh skipped:', (j.error && j.error.message) || r.status);
    } catch (e) { console.warn('Instagram token refresh failed:', e.message); }
  }
  return state.token;
}

// Two token types work:
//  - Instagram Login token ("IG…")  → graph.instagram.com, /me/...
//  - System-user token from Meta's Unified Login (never expires)
//      → graph.facebook.com, /{instagram-user-id}/... (IG_USER_ID)
let host = null, igUserId = null;

async function ig(db, path, { method = 'GET', params = {} } = {}) {
  const token = await loadToken(db);
  if (!token) throw new Error('No Instagram token (IG_ACCESS_TOKEN)');
  if (!host) await detectHost(token);
  path = path.replace(/^\/me(?=\/|$)/, host === 'fb' ? `/${igUserId}` : '/me');
  const base = host === 'fb' ? 'https://graph.facebook.com/v22.0' : GRAPH;
  const q = new URLSearchParams({ ...params, access_token: token });
  const url = `${base}${path}${method === 'GET' ? '?' + q : ''}`;
  const r = await fetch(url, method === 'GET' ? {} : { method, body: q });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Instagram ${path}: ${(j.error && j.error.message) || r.status}`);
  return j;
}

async function detectHost(token) {
  const r = await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
  if (r.ok) { host = 'ig'; return; }
  igUserId = process.env.IG_USER_ID || '17841433684687845';
  host = 'fb';
  if (state) state.refreshed_at = new Date().toISOString(); // system-user tokens don't need refreshing
}

async function me(db) {
  if (!host) await detectHost(await loadToken(db));
  const j = await ig(db, '/me', { params: { fields: host === 'fb' ? 'id,username' : 'user_id,username' } });
  return { username: j.username, id: j.user_id || j.id };
}

async function recentMedia(db, days = 30) {
  const j = await ig(db, '/me/media', { params: { fields: 'id,permalink,timestamp,caption,comments_count', limit: '50' } });
  const since = Date.now() - days * 86400e3;
  return (j.data || []).filter(m => new Date(m.timestamp).getTime() >= since);
}

async function comments(db, mediaId) {
  const j = await ig(db, `/${mediaId}/comments`, { params: { fields: 'id,text,timestamp,username,replies{id,username}', limit: '50' } });
  return j.data || [];
}

const reply = (db, commentId, message) => ig(db, `/${commentId}/replies`, { method: 'POST', params: { message } });

module.exports = { loadToken, me, recentMedia, comments, reply };
