// COMMUNITY — daily (GitHub Actions).
//  1. Reads new comments on our Instagram posts (last 30 days).
//  2. Triages them (lib/comments.js): safe question / needs Jack / spam / other.
//  3. Instagram safe questions → friendly auto-reply (capped per day).
//     Needs Jack → dashboard inbox + one email digest.
//  4. Refreshes the module list the dashboard's TikTok helper uses.
// TikTok comments can't be read through any API we have; the dashboard has a
// "paste a TikTok comment" helper instead.
//
// Usage: node jobs/comments.js [--dry-run]   (dry run: classify, no replies/emails/writes)
const { flags } = require('../lib/env');
const { db, audit } = require('../lib/db');
const { askJson, costReport } = require('../lib/claude');
const { buildIndex } = require('../lib/modules');
const { classify } = require('../../lib/comments');
const instagram = require('../lib/instagram');
const { sendAlert } = require('../lib/email');
const config = require('../config.json');

const SETTINGS = Object.assign({ autoReply: true, maxAutoRepliesPerDay: 15 }, config.comments || {});
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function saveModuleIndex(sb, index) {
  if (flags.dryRun) return;
  await sb.storage.from('marketing-media').upload('config/modules.json', Buffer.from(JSON.stringify(index)), { contentType: 'application/json', upsert: true });
}

async function collectInstagram(sb) {
  if (!(await instagram.loadToken(sb))) { console.log('Instagram not connected (no IG_ACCESS_TOKEN) — skipping.'); return 0; }
  const account = await instagram.me(sb);
  const media = await instagram.recentMedia(sb, 30);
  const { data: ourPosts } = await sb.from('mkt_posts').select('id, release_url').eq('platform', 'instagram').eq('status', 'published');
  let added = 0;
  for (const m of media) {
    if (!m.comments_count) continue;
    const post = (ourPosts || []).find(p => p.release_url && m.permalink && p.release_url.replace(/\/$/, '') === m.permalink.replace(/\/$/, ''));
    for (const c of await instagram.comments(sb, m.id)) {
      if (!c.text || (c.username && c.username === account.username)) continue;               // our own comments
      if ((c.replies && c.replies.data || []).some(r => r.username === account.username)) continue; // already answered by us
      if (flags.dryRun) { added++; continue; }
      const { error } = await sb.from('mkt_comments').upsert({
        platform: 'instagram', external_id: c.id, post_id: post ? post.id : null, author: c.username || null,
        body: c.text.slice(0, 2000), commented_at: c.timestamp || null, status: 'new',
      }, { onConflict: 'platform,external_id', ignoreDuplicates: true });
      if (!error) added++;
    }
  }
  return added;
}

async function main() {
  const sb = db();
  const index = buildIndex();
  await saveModuleIndex(sb, index);

  const found = await collectInstagram(sb).catch(e => { console.error('Instagram read failed:', e.message); return 0; });
  console.log(`Instagram: ${found} comment(s) collected`);
  if (flags.dryRun) { console.log(costReport()); return; }

  const { data: fresh } = await sb.from('mkt_comments').select('id, platform, external_id, body, author').eq('status', 'new').limit(100);
  if (!(fresh || []).length) { console.log('No new comments.'); }
  const decisions = await classify(fresh || [], { askJson, moduleIndex: index });

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: repliedToday } = await sb.from('mkt_comments').select('id', { count: 'exact', head: true }).eq('status', 'auto_replied').gte('replied_at', dayStart.toISOString());
  let budget = SETTINGS.maxAutoRepliesPerDay - (repliedToday || 0);
  const tally = { auto_replied: 0, needs_jack: 0, draft: 0, ignored: 0, done: 0 };

  for (const d of decisions) {
    const c = fresh.find(x => x.id === d.id);
    let status, repliedAt = null;
    if (d.autoReply && c.platform === 'instagram' && SETTINGS.autoReply && budget > 0) {
      try {
        await instagram.reply(sb, c.external_id, d.reply);
        status = 'auto_replied'; repliedAt = new Date().toISOString(); budget--;
        await audit('job:comments', 'auto_reply', null, { comment: c.external_id, reply: d.reply });
      } catch (e) { console.warn('Reply failed:', e.message); status = 'draft'; }
    } else if (d.category === 'safe_question') status = 'draft';      // TikTok, cap reached, or auto-reply off
    else if (d.category === 'needs_jack') status = 'needs_jack';
    else if (d.category === 'spam') status = 'ignored';
    else status = 'done';
    tally[status]++;
    await sb.from('mkt_comments').update({
      category: d.category === 'other' ? 'other' : d.category, reply_draft: d.reply || null, status, replied_at: repliedAt,
    }).eq('id', c.id).eq('status', 'new');
  }
  console.log('Triage:', JSON.stringify(tally));

  // One email for anything that needs Jack and hasn't been emailed yet.
  const { data: alerts } = await sb.from('mkt_comments').select('id, platform, author, body, reply_draft, created_at').eq('status', 'needs_jack').is('emailed_at', null).limit(30);
  if ((alerts || []).length) {
    const lines = alerts.map(a => `• [${a.platform}] ${a.author || 'someone'}: "${a.body}"${a.reply_draft ? `\n   Suggested reply: ${a.reply_draft}` : ''}`);
    const ok = await sendAlert({
      subject: `Study-Uni: ${alerts.length} comment${alerts.length === 1 ? '' : 's'} need you`,
      text: lines.join('\n\n') + '\n\nOpen the dashboard: https://study-uni.ie/marketing#inbox',
      html: `<p>${alerts.length} comment${alerts.length === 1 ? '' : 's'} need you:</p><ul>${alerts.map(a => `<li><b>[${esc(a.platform)}] ${esc(a.author || 'someone')}</b>: “${esc(a.body)}”${a.reply_draft ? `<br><i>Suggested reply:</i> ${esc(a.reply_draft)}` : ''}</li>`).join('')}</ul><p><a href="https://study-uni.ie/marketing#inbox">Open the dashboard inbox</a></p>`,
    });
    if (ok) await sb.from('mkt_comments').update({ emailed_at: new Date().toISOString() }).in('id', alerts.map(a => a.id));
    console.log(`Needs-Jack email: ${ok ? 'sent' : 'not sent'} (${alerts.length})`);
  }
  console.log(costReport());
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
