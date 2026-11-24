// Builds a 1080x1920 9:16 MP4: one branded frame per caption chunk, the
// voiceover underneath, captions burned into the frames.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { renderVideoFrame } = require('./slides');

const FFMPEG = (() => {
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return process.env.FFMPEG_PATH || 'ffmpeg';
})();

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error('ffmpeg: ' + (stderr || err.message).slice(0, 800))); else resolve();
    });
  });
}

// "study-uni dot ie" is spoken that way but shown as study-uni.ie.
function mergeDomain(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i], b = words[i + 1], c = words[i + 2];
    if (/^study-?uni$/i.test(a.word) && b && /^dot$/i.test(b.word) && c && /^ie\b/i.test(c.word)) {
      out.push({ word: 'study-uni.ie' + c.word.replace(/^ie/i, ''), start: a.start, end: c.end }); i += 2;
    } else out.push(a);
  }
  return out;
}

// Group words into short caption chunks (≤4 words, ≤24 chars).
function chunks(words) {
  words = mergeDomain(words);
  const out = []; let cur = [];
  for (const w of words) {
    const text = cur.map(x => x.word).concat(w.word).join(' ');
    if (cur.length && (cur.length >= 4 || text.length > 24)) { out.push(cur); cur = []; }
    cur.push(w);
    if (/[.!?,]$/.test(w.word) && cur.length >= 2) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.map(c => ({ words: c, text: c.map(x => x.word).join(' '), start: c[0].start, end: c[c.length - 1].end }));
}

const PAD = 0.45;      // pause after each scene
const END_HOLD = 1.6;  // hold the last scene (CTA) a bit longer

// scenes: [{ onscreen, audio: {file, duration, words} }]
async function buildVideo({ scenes, aiLabel, workDir, outFile }) {
  fs.mkdirSync(workDir, { recursive: true });
  const concat = [];
  let frameNo = 0, total = 0;
  const sceneDur = [];

  for (let s = 0; s < scenes.length; s++) {
    const sc = scenes[s];
    const dur = sc.audio.duration + (s === scenes.length - 1 ? END_HOLD : PAD);
    sceneDur.push(dur); total += dur;
    // One frame per spoken word: the caption chunk stays, the current word lights up.
    const cs = chunks(sc.audio.words);
    const beats = [];
    cs.forEach(c => c.words.forEach((w, wi) => beats.push({ at: w.start, caption: c.words.map((x, xi) => ({ word: x.word, active: xi === wi })) })));
    if (!beats.length) beats.push({ at: 0, caption: [] });
    for (let b = 0; b < beats.length; b++) {
      const start = b === 0 ? 0 : beats[b].at;
      const end = b === beats.length - 1 ? dur : beats[b + 1].at;
      const png = path.join(workDir, `f${String(frameNo++).padStart(4, '0')}.png`);
      fs.writeFileSync(png, await renderVideoFrame({ onscreen: sc.onscreen, highlight: sc.highlight, emoji: sc.emoji, caption: beats[b].caption, index: s, total: scenes.length, aiLabel }));
      concat.push({ png, dur: Math.max(0.04, end - start) });
    }
  }
  const list = concat.map(f => `file '${f.png.replace(/\\/g, '/')}'\nduration ${f.dur.toFixed(3)}`).join('\n') + `\nfile '${concat[concat.length - 1].png.replace(/\\/g, '/')}'\n`;
  const listFile = path.join(workDir, 'frames.txt');
  fs.writeFileSync(listFile, list);

  // Audio: each scene's voiceover padded to its scene length, then joined.
  const audioArgs = [], filters = [];
  const haveAudio = scenes.every(s => s.audio.file);
  if (haveAudio) {
    scenes.forEach((s, i) => { audioArgs.push('-i', s.audio.file); filters.push(`[${i + 1}:a]aresample=44100,apad=whole_dur=${sceneDur[i].toFixed(3)}[a${i}]`); });
    filters.push(scenes.map((_, i) => `[a${i}]`).join('') + `concat=n=${scenes.length}:v=0:a=1[aout]`);
  } else {
    audioArgs.push('-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo');
  }

  await run([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    ...audioArgs,
    ...(haveAudio ? ['-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]'] : ['-map', '0:v', '-map', '1:a']),
    '-vf', 'fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-tune', 'stillimage', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-t', total.toFixed(3), '-movflags', '+faststart', outFile,
  ]);
  return { duration: total, frames: concat.length, cover: concat[0].png };
}

module.exports = { buildVideo, chunks, FFMPEG };
