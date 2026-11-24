// CREATE — runs after RESEARCH on Monday.
// Writes ~5 video scripts and 2 carousels from this week's brief plus last
// week's results, runs the compliance check, and puts the posts in the
// approval queue (status pending_review, no media yet — Phase D renders it).
// Pieces that fail the check are saved as hidden drafts, never approvable.
//
// Usage: node jobs/create.js [--dry-run] [--force] [--brief=path/to/brief.json]
const fs = require('fs');
const path = require('path');
const { flags } = require('../lib/env');
const { campaign, dublinDate } = require('../lib/time');
const { postKey, trackedLink, shortLink } = require('../lib/links');
const { askJson, costReport } = require('../lib/claude');
const { checkAll } = require('../lib/compliance');
const config = require('../config.json');

const prompt = f => fs.readFileSync(path.join(__dirname, '..', 'prompts', f), 'utf8');
const LINK = '{{LINK}}';
const briefArg = process.argv.find(a => a.startsWith('--brief='));

const SCENE = { type: 'object', additionalProperties: false, required: ['onscreen', 'voiceover', 'visual'], properties: { onscreen: { type: 'string' }, voiceover: { type: 'string' }, visual: { type: 'string', description: 'What the branded slide shows besides the text (icon, emoji, simple illustration idea, colour emphasis). No people.' } } };
const SLIDE = { type: 'object', additionalProperties: false, required: ['headline', 'body'], properties: { headline: { type: 'string' }, body: { type: 'string' } } };
const CONTENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['videos', 'carousels'],
  properties: {
    videos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'angle', 'hook', 'duration_seconds', 'scenes', 'caption'], properties: {
      title: { type: 'string', description: 'Internal label, 2–5 words' },
      angle: { type: 'string', description: 'Which brief question/date/learning this targets' },
      hook: { type: 'string', description: 'The first-2-seconds hook (same as scene 1 on-screen text or close to it)' },
      duration_seconds: { type: 'integer' },
      scenes: { type: 'array', items: SCENE },
      caption: { type: 'string', description: `Caption incl. the literal placeholder ${LINK} where the short link goes, and hashtags` },
    } } },
    carousels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'angle', 'hook', 'slides', 'caption'], properties: {
      title: { type: 'string' }, angle: { type: 'string' }, hook: { type: 'string' },
      slides: { type: 'array', items: SLIDE },
      caption: { type: 'string', description: `Caption incl. the literal placeholder ${LINK} and hashtags` },
    } } },
  },
};

async function loadInputs(week) {
  if (briefArg) {
    const brief = JSON.parse(fs.readFileSync(briefArg.split('=')[1], 'utf8'));
    return { brief, learning: null, performance: [] };
  }
  const { db, signupsByPost } = require('../lib/db');
  const { data: briefs, error } = await db().from('mkt_briefs').select('*').order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const brief = (briefs || [])[0];
  if (!brief) throw new Error('No brief found — run research first.');
  if (brief.week !== week) console.warn(`Latest brief is for ${brief.week}, not ${week}.`);
  const { data: learn } = await db().from('mkt_learnings').select('week, summary, ranking').order('created_at', { ascending: false }).limit(1);
  const since = new Date(Date.now() - 21 * 86400000).toISOString();
  const { data: pubs } = await db().from('mkt_posts').select('id, post_key, platform, format, hook, title').eq('status', 'published').gte('published_at', since);
  const { data: rejected } = await db().from('mkt_posts').select('hook, rejected_reason').eq('status', 'rejected').gte('updated_at', since).limit(20);
  const signups = await signupsByPost();
  const performance = (pubs || []).map(p => ({ key: p.post_key, platform: p.platform, format: p.format, hook: p.hook, signups: signups[p.post_key] || 0 }));
  return { brief, learning: (learn || [])[0] || null, performance, rejected: rejected || [] };
}

function scriptFor(piece) {
  if (piece.format === 'video') {
    return { duration_seconds: piece.duration_seconds, angle: piece.angle, scenes: piece.scenes.map(s => ({ text: s.voiceover, voiceover: s.voiceover, onscreen: s.onscreen, visual: s.visual })) };
  }
  return { angle: piece.angle, slides: piece.slides.map(s => ({ title: s.headline, headline: s.headline, body: s.body })) };
}

function withLink(text, short) { return String(text || '').split(LINK).join(short); }

async function main() {
  const week = campaign();
  console.log(`Create for ${week}${flags.dryRun ? ' (dry run)' : ''}`);

  if (!flags.dryRun) {
    const { db } = require('../lib/db');
    const { count } = await db().from('mkt_posts').select('id', { count: 'exact', head: true }).eq('week', week).eq('is_demo', false);
    if (count && !flags.force) { console.log(`${count} posts already exist for ${week} — use --force to add more.`); return; }
  }

  const inputs = await loadInputs(week);
  const nV = config.videosPerWeek, nC = config.carouselsPerWeek;

  const content = await askJson({
    system: prompt('brand.md') + '\n\n' + prompt('create.md'),
    schema: CONTENT_SCHEMA,
    effort: 'high',
    maxTokens: 32000,
    prompt: [
      `Week ${week}. Today (Irish time): ${dublinDate()}.`,
      `Write exactly ${nV} videos and ${nC} carousels. Wherever the short link should appear (final scene/slide and caption), write the literal placeholder ${LINK} — it is replaced with each post's own link.`,
      `<brief>\n${JSON.stringify({ summary: inputs.brief.summary, questions: inputs.brief.questions, pain_points: inputs.brief.pain_points, exam_dates: inputs.brief.exam_dates, angles: inputs.brief.angles, engagement: inputs.brief.engagement })}\n</brief>`,
      `<learnings>\n${inputs.learning ? inputs.learning.summary : 'No results yet — this is an early week. Test a variety of hooks and formats.'}\n</learnings>`,
      `<performance>\n${JSON.stringify(inputs.performance || [])}\nRecently rejected by the founder (avoid repeating): ${JSON.stringify(inputs.rejected || [])}\n</performance>`,
    ].join('\n\n'),
  });

  let pieces = [
    ...content.videos.slice(0, nV).map((v, i) => Object.assign(v, { id: `v${i + 1}`, format: 'video' })),
    ...content.carousels.slice(0, nC).map((c, i) => Object.assign(c, { id: `c${i + 1}`, format: 'carousel' })),
  ];
  pieces = await checkAll(pieces, { dates: inputs.brief.exam_dates || [] });

  // One post row per platform per piece, each with its own tracked link.
  const counters = { tiktok: 0, instagram: 0 };
  const now = new Date();
  if (!flags.dryRun) { // --force re-runs continue numbering instead of clashing
    const { db } = require('../lib/db');
    const { data: existing } = await db().from('mkt_posts').select('post_key, platform').eq('week', week);
    for (const e of existing || []) {
      const n = parseInt(String(e.post_key).replace(/^.*[ti]/, ''), 10);
      if (counters[e.platform] != null && n > counters[e.platform]) counters[e.platform] = n;
    }
  }
  const rows = [];
  for (const p of pieces) {
    const platforms = p.format === 'video' ? config.videoPlatforms : config.carouselPlatforms;
    for (const platform of platforms) {
      const key = postKey(now, platform, ++counters[platform]);
      const short = shortLink(key);
      const fill = s => withLink(s, short);
      const script = scriptFor(p);
      // Spoken lines say the domain; the exact short link is shown on screen.
      if (script.scenes) script.scenes.forEach(s => { s.onscreen = fill(s.onscreen); s.voiceover = withLink(s.voiceover, 'study-uni dot ie'); s.text = s.voiceover; });
      if (script.slides) script.slides.forEach(s => { s.title = fill(s.title); s.headline = fill(s.headline); s.body = fill(s.body); });
      let caption = fill(p.caption).trim();
      if (!caption.includes(short)) caption += `\n\n📚 ${short}`;
      const aiLabel = p.format === 'video'; // AI voiceover → disclose
      if (aiLabel) caption += '\n\n(AI voiceover)';
      rows.push({
        post_key: key, week, platform, format: p.format,
        status: p.compliance.passed ? 'pending_review' : 'draft',
        title: p.title, hook: fill(p.hook), script, caption,
        link: trackedLink(platform, week, key),
        media: [], ai_label: aiLabel, compliance: p.compliance,
      });
    }
  }

  const passed = rows.filter(r => r.status === 'pending_review').length;
  console.log(`${pieces.length} pieces → ${rows.length} posts (${passed} to queue, ${rows.length - passed} held back by the rules check)`);

  if (flags.dryRun) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const { db, audit } = require('../lib/db');
    const { error } = await db().from('mkt_posts').insert(rows);
    if (error) throw new Error(error.message);
    await audit('job:create', 'drafts_created', null, { week, posts: rows.length, queued: passed });
    console.log('Saved to the approval queue.');
  }
  console.log(costReport());
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
