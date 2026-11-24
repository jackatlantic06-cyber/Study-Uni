// RENDER — runs after CREATE. Turns queued posts into media:
//   branded videos   → 1080x1920 MP4, branded slides + narrator + captions
//   dialogue videos  → Abbey & Harry cartoon scenes (fal.ai), their two fixed
//                      voices, speaker captions; "animated" ones get AI clips
//   carousels        → 1080x1350 PNG slides
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
const { buildDialogueVideo } = require('../lib/cartoon');
const fal = require('../lib/fal');
const config = require('../config.json');

const BUCKET = 'marketing-media';
const LOCAL = process.argv.includes('--local');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];

async function ensureBucket(db) {
  const { data } = await db.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: '50MB', allowedMimeTypes: ['video/mp4', 'image/png', 'application/json'] });
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
// so it is generated once per piece and reused. Each line is generated with
// the lines around it as context so the voice stays consistent.
const voiceCache = new Map();
async function voiceFor(pieceKey, scenes, dir) {
  if (voiceCache.has(pieceKey)) return voiceCache.get(pieceKey);
  fs.mkdirSync(dir, { recursive: true });
  const text = s => (s && (s.voiceover || s.text)) || '';
  const audio = [];
  for (let i = 0; i < scenes.length; i++) {
    audio.push(await voice.speak(text(scenes[i]), path.join(dir, `vo-${i}.mp3`), {
      speed: config.voiceSpeed.branded,
      previous: scenes.slice(0, i).map(text).join(' ') || undefined,
      next: scenes.slice(i + 1).map(text).join(' ') || undefined,
    }));
  }
  voiceCache.set(pieceKey, audio);
  return audio;
}

// Run async jobs with limited parallelism.
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ── Dialogue (cartoon) videos ─────────────────────────────────────────────
const CHAR_REF = path.join(__dirname, '..', 'assets', 'characters.png');
const STYLE = '3D animated cartoon style, cinematic lighting, vertical 9:16 composition with the characters in the middle third, appealing stylised proportions, original characters. Plain unbranded props. No text, no readable writing, no logos, no watermark.';
const dialogueCache = new Map(); // pieceKey → {video, cover, duration, mode}

async function renderDialogue(post, dir) {
  const s = post.script;
  const pieceKey = `${post.week}|${s.piece || post.title}`;
  if (dialogueCache.has(pieceKey)) return dialogueCache.get(pieceKey);
  fs.mkdirSync(dir, { recursive: true });
  const looks = Object.values(config.characters).map(c => c.look).join('; ');
  const ref = fal.dataUri(CHAR_REF);

  // 1. One cartoon scene per line, all from the same character reference.
  const images = await pool(s.lines, 3, async (l, i) => {
    const r = await fal.call('fal-ai/nano-banana/edit', {
      prompt: `Use the two characters from the reference image exactly as designed (${looks}). Setting, identical in every image: ${s.setting}. ${l.scene} ${STYLE}`,
      image_urls: [ref], num_images: 1, output_format: 'png', aspect_ratio: '9:16',
    });
    return fal.download(r.images[0].url, path.join(dir, `scene-${i + 1}.png`));
  });

  // 2. Voices: each character always uses the same stock voice.
  const spoken = s.lines.map(l => l.line);
  const audio = [];
  for (let i = 0; i < s.lines.length; i++) {
    const c = config.characters[s.lines[i].speaker] || Object.values(config.characters)[i % 2];
    audio.push(await voice.speak(spoken[i], path.join(dir, `line-${i + 1}.mp3`), {
      voiceId: c.voiceId, voiceName: c.voiceName, speed: config.voiceSpeed.dialogue,
      previous: spoken.slice(0, i).join(' ') || undefined, next: spoken.slice(i + 1).join(' ') || undefined,
    }));
  }

  // 3. Animated version: a short AI clip per scene (falls back to the still if one fails).
  let clips = [];
  if (s.style === 'animated') {
    clips = await pool(s.lines, 3, async (l, i) => {
      try {
        const r = await fal.call('fal-ai/kling-video/v2.1/standard/image-to-video', {
          prompt: `${l.motion} 3D animated cartoon style, keep both characters on-model, no text.`,
          image_url: fal.dataUri(images[i]), duration: '5',
          negative_prompt: 'blur, distortion, extra limbs, extra fingers, morphing faces, text, watermark, logo',
        });
        return await fal.download(r.video.url, path.join(dir, `clip-${i + 1}.mp4`));
      } catch (e) { console.warn(`    clip ${i + 1} failed, using still: ${e.message.slice(0, 120)}`); return null; }
    });
  }

  const scenes = s.lines.map((l, i) => {
    const c = config.characters[l.speaker] || {};
    return { speaker: l.speaker, color: c.color, image: images[i], clip: clips[i] || '', audio: audio[i] };
  });
  const out = path.join(dir, 'video.mp4');
  const res = await buildDialogueVideo({ scenes, mode: s.style === 'animated' ? 'clips' : 'storybook', workDir: path.join(dir, 'work'), outFile: out });
  const result = { video: out, cover: images[0], duration: res.duration, mode: s.style, clipsOk: clips.filter(Boolean).length };
  dialogueCache.set(pieceKey, result);
  return result;
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

  const style = (post.script && post.script.style) || 'branded';
  if (post.format === 'video' && (style === 'storybook' || style === 'animated')) {
    const r = await renderDialogue(post, path.join(tmp, 'dlg-' + Buffer.from(`${post.week}|${post.script.piece || post.title}`).toString('hex').slice(0, 24)));
    const v = await save(db, r.video, `${base}/video.mp4`, 'video/mp4');
    const c = await save(db, r.cover, `${base}/cover.png`, 'image/png');
    media.push({ kind: 'video', path: v.path, duration: +r.duration.toFixed(1), bytes: fs.statSync(r.video).size, style });
    media.push({ kind: 'cover', path: c.path });
    console.log(`  ${post.post_key}: ${style} dialogue ${r.duration.toFixed(1)}s${style === 'animated' ? `, ${r.clipsOk}/${post.script.lines.length} animated clips` : ''}${LOCAL ? ' → ' + v.local : ''}`);
    return media;
  }

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
module.exports = { main, renderDialogue };
