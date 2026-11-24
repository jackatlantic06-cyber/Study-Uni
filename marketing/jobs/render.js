// RENDER — runs after CREATE. Turns queued posts into media:
//   videos    → 1080x1920 MP4 with ElevenLabs voiceover + burned-in captions
//   carousels → 1080x1350 PNG slides
// Files go to the private Supabase Storage bucket "marketing-media"; the
// dashboard shows them through short-lived signed links.
//
// Usage: node jobs/render.js [--no-voice] [--force] [--only=<post_key>] [--local]
//   --no-voice  silent video with estimated caption timing (free test)
//   --local     write files to ./out instead of uploading (no DB changes)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { flags } = require('../lib/env');
const { renderCarouselSlide } = require('../lib/slides');
const { buildVideo } = require('../lib/video');
const voice = require('../lib/voice');
const { enrich } = require('../lib/enrich');

const BUCKET = 'marketing-media';
const LOCAL = process.argv.includes('--local');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];

async function ensureBucket(db) {
  const { data } = await db.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: '50MB', allowedMimeTypes: ['video/mp4', 'image/png'] });
  if (error && !/already exists/i.test(error.message)) throw new Error('createBucket: ' + error.message);
}

async function save(db, localFile, storagePath, contentType) {
  if (LOCAL) {
    const dest = path.join(__dirname, '..', 'out', storagePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(localFile, dest);
    return { path: storagePath, local: dest };
  }
  const { error } = await db.storage.from(BUCKET).upload(storagePath, fs.readFileSync(localFile), { contentType, upsert: true });
  if (error) throw new Error(`upload ${storagePath}: ${error.message}`);
  return { path: storagePath };
}

// Voiceover is identical for the TikTok and Instagram versions of a video,
// so it is generated once per piece and reused.
const voiceCache = new Map();
async function voiceFor(pieceKey, scenes, dir) {
  if (voiceCache.has(pieceKey)) return voiceCache.get(pieceKey);
  fs.mkdirSync(dir, { recursive: true });
  const audio = [];
  for (let i = 0; i < scenes.length; i++) {
    audio.push(await voice.speak(scenes[i].voiceover || scenes[i].text || '', path.join(dir, `vo-${i}.mp3`)));
  }
  voiceCache.set(pieceKey, audio);
  return audio;
}

// Adds an emoji + highlighted words to each scene/slide (once; saved to the script).
async function ensureStyle(db, post) {
  const list = post.format === 'video' ? (post.script.scenes || []) : (post.script.slides || []);
  if (!list.length || list.every(x => x.emoji !== undefined)) return;
  const lines = list.map(x => post.format === 'video' ? x.onscreen : (x.headline || x.title));
  const key = `${post.week}|${post.script.piece || post.title}|${post.format}`;
  const styled = await enrich(lines, key);
  list.forEach((x, i) => { x.emoji = styled[i].emoji; x.highlight = styled[i].highlight; });
  if (!LOCAL) await db.from('mkt_posts').update({ script: post.script }).eq('id', post.id);
}

async function renderPost(db, post, tmp) {
  const dir = path.join(tmp, post.post_key);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${post.week}/${post.post_key}`;
  const media = [];

  await ensureStyle(db, post);
  if (post.format === 'video') {
    const scenes = (post.script && post.script.scenes) || [];
    if (!scenes.length) throw new Error('no scenes in script');
    const pieceKey = `${post.week}|${(post.script && post.script.piece) || post.title}`;
    const audio = await voiceFor(pieceKey, scenes, path.join(tmp, 'vo-' + Buffer.from(pieceKey).toString('hex').slice(0, 24)));
    const out = path.join(dir, 'video.mp4');
    const res = await buildVideo({
      scenes: scenes.map((s, i) => ({ onscreen: s.onscreen, highlight: s.highlight, emoji: s.emoji, audio: audio[i] })),
      aiLabel: post.ai_label, workDir: path.join(dir, 'frames'), outFile: out,
    });
    const v = await save(db, out, `${base}/video.mp4`, 'video/mp4');
    const c = await save(db, res.cover, `${base}/cover.png`, 'image/png');
    media.push({ kind: 'video', path: v.path, duration: +res.duration.toFixed(1), bytes: fs.statSync(out).size, voice: audio[0] && audio[0].voice });
    media.push({ kind: 'cover', path: c.path });
    console.log(`  ${post.post_key}: video ${res.duration.toFixed(1)}s, ${res.frames} frames, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB${LOCAL ? ' → ' + v.local : ''}`);
  } else {
    const slides = (post.script && post.script.slides) || [];
    if (!slides.length) throw new Error('no slides in script');
    for (let i = 0; i < slides.length; i++) {
      const f = path.join(dir, `slide-${i + 1}.png`);
      fs.writeFileSync(f, await renderCarouselSlide({ headline: slides[i].headline || slides[i].title, body: slides[i].body, highlight: slides[i].highlight, emoji: slides[i].emoji, index: i, total: slides.length }));
      const s = await save(db, f, `${base}/slide-${i + 1}.png`, 'image/png');
      media.push({ kind: 'image', path: s.path });
    }
    console.log(`  ${post.post_key}: carousel, ${slides.length} slides${LOCAL ? ' → ' + path.dirname(path.join(__dirname, '..', 'out', media[0].path)) : ''}`);
  }
  return media;
}

async function main() {
  console.log(`Render${LOCAL ? ' (local files only)' : ''} — voice: ${voice.enabled() ? 'ElevenLabs' : 'silent test mode'}`);
  const { db: getDb, audit } = require('../lib/db');
  const db = getDb();
  if (!LOCAL) await ensureBucket(db);

  let q = db.from('mkt_posts').select('id, post_key, week, platform, format, title, script, ai_label, media, compliance, status')
    .eq('status', 'pending_review').order('post_key');
  if (ONLY) q = q.eq('post_key', ONLY);
  const { data: posts, error } = await q;
  if (error) throw new Error(error.message);
  const todo = (posts || []).filter(p => (flags.force || ONLY || !(p.media || []).length) && p.compliance && p.compliance.passed);
  console.log(`${todo.length} post(s) to render`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'su-render-'));
  let ok = 0, failed = 0;
  for (const post of todo) {
    try {
      const media = await renderPost(db, post, tmp);
      if (!LOCAL) {
        const { error: upErr } = await db.from('mkt_posts').update({ media, error: null }).eq('id', post.id).eq('status', 'pending_review');
        if (upErr) throw new Error(upErr.message);
      }
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ${post.post_key}: FAILED — ${e.message}`);
      if (!LOCAL) await db.from('mkt_posts').update({ error: 'Render failed: ' + e.message.slice(0, 400) }).eq('id', post.id);
    }
  }
  if (!LOCAL) await audit('job:render', 'media_rendered', null, { ok, failed, voice: voice.enabled() ? 'elevenlabs' : 'silent', characters: voice.usage.characters });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Done: ${ok} rendered, ${failed} failed. ElevenLabs: ${voice.usage.characters} characters in ${voice.usage.requests} requests.`);
  if (failed && !ok) process.exit(1);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
