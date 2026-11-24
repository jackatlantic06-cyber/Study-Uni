// SYNC — hourly (GitHub Actions). Keeps Supabase in step with Postiz:
//  1. Retries approved posts that didn't reach Postiz (e.g. Postiz was down).
//  2. Marks posts published (with the live link) or failed (with the reason).
//  3. Once a day (07:00 Irish time, or --stats) saves views/likes/comments +
//     sign-ups per post for the dashboard and the Sunday learning step.
// Nothing here can publish a post that an owner hasn't approved: the push
// goes through pushToPostiz, which only takes status 'approved' posts, and
// lib/postiz.js re-checks approved_by / compliance / is_demo.
const { flags } = require('../lib/env');
const { db, audit, signupsByPost } = require('../lib/db');
const { dublinParts } = require('../lib/time');
const postiz = require('../../lib/postiz');
const { pushToPostiz } = require('../../lib/marketing-api');

const STATS = process.argv.includes('--stats') || dublinParts().hour === 7;

// Postiz analytics → single numbers. Series can be daily or running totals;
// use the last value if it never goes down, otherwise the sum.
function metric(list, ...names) {
  const m = (list || []).find(x => names.some(n => String(x.label || '').toLowerCase() === n));
  if (!m || !Array.isArray(m.data) || !m.data.length) return null;
  const vals = m.data.map(d => Number(d.total) || 0);
  const cumulative = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
  return cumulative ? vals[vals.length - 1] : vals.reduce((a, b) => a + b, 0);
}

async function main() {
  if (!postiz.enabled()) { console.log('POSTIZ_API_KEY not set — nothing to sync.'); return; }
  const sb = db();
  const now = Date.now();

  // 1. Retry approved posts due within 48h that aren't in Postiz yet.
  const { data: waiting } = await sb.from('mkt_posts').select('id, post_key, scheduled_for')
    .eq('status', 'approved').is('postiz_post_id', null)
    .lte('scheduled_for', new Date(now + 48 * 3600e3).toISOString());
  for (const p of waiting || []) {
    if (new Date(p.scheduled_for).getTime() < now - 24 * 3600e3) {
      await sb.from('mkt_posts').update({ status: 'failed', error: 'Could not be sent to Postiz for over 24 hours' }).eq('id', p.id);
      console.log(`  ${p.post_key}: gave up (over 24h late)`);
      continue;
    }
    const r = await pushToPostiz(sb, p.id, 'job:sync');
    console.log(`  ${p.post_key}: ${r.ok ? 'sent to Postiz' : r.error ? 'still failing — ' + r.error.slice(0, 120) : 'skipped'}`);
  }

  // 2. Status of everything we've put in the Postiz queue.
  const { data: queued } = await sb.from('mkt_posts').select('id, post_key, postiz_post_id, scheduled_for')
    .eq('status', 'publishing').not('postiz_post_id', 'is', null);
  if ((queued || []).length) {
    const remote = await postiz.listPosts(new Date(now - 21 * 86400e3), new Date(now + 62 * 86400e3));
    const byId = new Map(remote.map(p => [p.id, p]));
    for (const p of queued) {
      const r = byId.get(p.postiz_post_id);
      if (!r) {
        if (new Date(p.scheduled_for).getTime() < now - 3600e3) {
          await sb.from('mkt_posts').update({ status: 'failed', error: 'Not found in Postiz (deleted there?)' }).eq('id', p.id);
          console.log(`  ${p.post_key}: missing in Postiz → failed`);
        }
        continue;
      }
      if (r.state === 'PUBLISHED') {
        await sb.from('mkt_posts').update({ status: 'published', published_at: r.publishDate || new Date().toISOString(), release_url: r.releaseURL || null, error: null }).eq('id', p.id);
        await audit('job:sync', 'published', p.id, { release_url: r.releaseURL || null });
        console.log(`  ${p.post_key}: published ${r.releaseURL || ''}`);
      } else if (r.state === 'ERROR') {
        await sb.from('mkt_posts').update({ status: 'failed', error: 'Platform error: ' + String(r.error || 'unknown').slice(0, 400) }).eq('id', p.id);
        await audit('job:sync', 'publish_failed', p.id, { error: r.error || null });
        console.log(`  ${p.post_key}: FAILED — ${r.error}`);
      }
    }
  }

  // 3. Stats: every hour for posts from the last 7 days (numbers move fast
  //    early on); once a day (07:00 / --stats) for everything in 30 days.
  //    A new snapshot is only saved when a number has changed.
  {
    const days = STATS ? 30 : 7;
    const { data: pubs } = await sb.from('mkt_posts').select('id, post_key, postiz_post_id')
      .eq('status', 'published').not('postiz_post_id', 'is', null)
      .gte('published_at', new Date(now - days * 86400e3).toISOString());
    const signups = (pubs || []).length ? await signupsByPost() : {};
    let saved = 0;
    for (const p of pubs || []) {
      let a = null;
      try { a = await postiz.postAnalytics(p.postiz_post_id, 30); } catch (e) { console.warn(`  ${p.post_key}: analytics error ${e.message.slice(0, 100)}`); continue; }
      if (a && a.missing) {
        await sb.from('mkt_posts').update({ error: 'Stats unavailable: the platform did not return a post ID — open the post in Postiz and use "connect"' }).eq('id', p.id);
        continue;
      }
      const list = Array.isArray(a) ? a : [];
      const row = {
        post_id: p.id,
        views: metric(list, 'views', 'video views', 'plays', 'impressions', 'reach'),
        likes: metric(list, 'likes'),
        comments: metric(list, 'comments'),
        shares: metric(list, 'shares'),
        saves: metric(list, 'saves', 'saved'),
        signups: signups[p.post_key] || 0,
      };
      const { data: last } = await sb.from('mkt_post_stats').select('views, likes, comments, shares, saves, signups')
        .eq('post_id', p.id).order('captured_at', { ascending: false }).limit(1);
      const prev = last && last[0];
      if (prev && ['views', 'likes', 'comments', 'shares', 'saves', 'signups'].every(k => (prev[k] ?? null) === (row[k] ?? null))) continue;
      await sb.from('mkt_post_stats').insert(row);
      saved++;
    }
    console.log(`Stats: ${saved} updated of ${(pubs || []).length} post(s) from the last ${days} days.`);
  }
  console.log('Sync done.');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main, metric };
