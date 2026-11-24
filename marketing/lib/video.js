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

// Group words into short caption chunks (≤4 words, ≤24 chars).
function chunks(words) {
  const out = []; let cur = [];
  for (const w of words) {
    const text = cur.map(x => x.word).concat(w.word).join(' ');
    if (cur.length && (cur.length >= 4 || text.length > 24)) { out.push(cur); cur = []; }
    cur.push(w);
    if (/[.!?,]$/.test(w.word) && cur.length >= 2) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.map(c => ({ text: c.map(x => x.word).join(' '), start: c[0].start, end: c[c.length - 1].end }));
}

const PAD = 0.3;       // pause after each scene
const END_HOLD = 1.2;  // hold the last scene (CTA) a bit longer

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
    const cs = chunks(sc.audio.words);
    if (!cs.length) cs.push({ text: '', start: 0, end: dur });
    for (let c = 0; c < cs.length; c++) {
      const start = c === 0 ? 0 : cs[c].start;
      const end = c === cs.length - 1 ? dur : cs[c + 1].start;
      const png = path.join(workDir, `f${String(frameNo++).padStart(3, '0')}.png`);
      fs.writeFileSync(png, await renderVideoFrame({ onscreen: sc.onscreen, caption: cs[c].text, index: s, total: scenes.length, aiLabel }));
      concat.push({ png, dur: Math.max(0.1, end - start) });
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
