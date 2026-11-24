const { createClient } = require('@supabase/supabase-js');
const { need } = require('./env');

let client = null;
function db() {
  if (!client) {
    need('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  }
  return client;
}

async function audit(actor, action, postId, detail) {
  await db().from('mkt_audit').insert({ actor, action, post_id: postId || null, detail: detail || null });
}

// Sign-ups grouped by utm_content (post_key), from auth user metadata.
async function signupsByPost() {
  const { data, error } = await db().auth.admin.listUsers({ perPage: 10000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const out = {};
  for (const u of (data && data.users) || []) {
    const c = u.user_metadata && u.user_metadata.signup_source && u.user_metadata.signup_source.content;
    if (c) out[c] = (out[c] || 0) + 1;
  }
  return out;
}

module.exports = { db, audit, signupsByPost };
