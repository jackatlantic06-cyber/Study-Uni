// Cartoon dialogue videos: AI scene per line + that character's voice +
// captions with the speaker's name, ending on the branded study-uni.ie card.
//   mode 'storybook' → slow zoom on each still scene
//   mode 'clips'     → AI image-to-video clip per scene
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { renderCaptionOverlay, renderVideoFrame } = require('./slides');
const { chunks, FFMPEG } = require('./video');

const FPS = 30;
const PAD = 0.35;

function run(args) {
  return new Promise((resolve, reject) => execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 << 20 },
    (err, _o, se) => err ? reject(new Error('ffmpeg: ' + (se || err.message).slice(0, 800))) : resolve()));
}

const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2'];
const posix = p => p.replace(/\\/g, '/');

async function overlayList(scene, dur, dir) {
  const beats = [];
  chunks(scene.audio.words).forEach(c => c.words.forEach((w, wi) => beats.push({ at: w.start, caption: c.words.map((x, xi) => ({ word: x.word, active: xi === wi })) })));
  if (!beats.length) beats.push({ at: 0, caption: [] });
  const lines = [];
  for (let b = 0; b < beats.length; b++) {
    const f = path.join(dir, `ov-${String(b).padStart(3, '0')}.png`);
    fs.writeFileSync(f, await renderCaptionOverlay({ speaker: scene.speaker, color: scene.color, caption: beats[b].caption }));
    const start = b === 0 ? 0 : beats[b].at, end = b === beats.length - 1 ? dur : beats[b + 1].at;
    lines.push(`file '${posix(f)}'\nduration ${Math.max(0.04, end - start).toFixed(3)}`);
  }
  lines.push(`file '${posix(path.join(dir, `ov-${String(beats.length - 1).padStart(3, '0')}.png`))}'`);
  const list = path.join(dir, 'overlay.txt');
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return list;
}

async function segment(scene, i, mode, dir, out) {
  fs.mkdirSync(dir, { recursive: true });
  const dur = scene.audio.duration + PAD;
  const frames = Math.round(dur * FPS);
  const list = await overlayList(scene, dur, dir);
  let bgIn, bgFilter;
  if (mode === 'clips' && fs.existsSync(scene.clip)) {
    bgIn = ['-i', scene.clip];
    bgFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS},tpad=stop_mode=clone:stop_duration=30,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[bg]`;
  } else {
    // Gentle Ken Burns: alternate zoom-in / zoom-out per scene.
    const zin = i % 2 === 0;
    const z = zin ? `min(1.0+0.12*on/${frames},1.12)` : `max(1.12-0.12*on/${frames},1.0)`;
    bgIn = ['-i', scene.image];
    bgFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=1620:2880,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${FPS}[bg]`;
  }
  await run([
    ...bgIn,
    '-f', 'concat', '-safe', '0', '-i', list,
    '-i', scene.audio.file,
    '-filter_complex', `${bgFilter};[1:v]format=rgba,fps=${FPS}[ov];[bg][ov]overlay=0:0:eof_action=repeat,trim=duration=${dur.toFixed(3)},format=yuv420p[v];[2:a]aresample=44100,apad=whole_dur=${dur.toFixed(3)}[a]`,
    '-map', '[v]', '-map', '[a]', ...ENC, '-t', dur.toFixed(3), out,
  ]);
  return dur;
}

async function endCard(dir, out) {
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, 'end.png');
  fs.writeFileSync(png, await renderVideoFrame({ onscreen: 'All UCC past papers. One place. study-uni.ie', highlight: 'One place', emoji: '📚', caption: [], index: 1, total: 2, aiLabel: false }));
  const dur = 2.6;
  await run(['-loop', '1', '-t', String(dur), '-i', png, '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', `fps=${FPS},format=yuv420p`, '-map', '0:v', '-map', '1:a', ...ENC, '-t', String(dur), out]);
  return dur;
}

async function buildDialogueVideo({ scenes, mode, workDir, outFile }) {
  fs.mkdirSync(workDir, { recursive: true });
  const parts = [];
  let total = 0;
  for (let i = 0; i < scenes.length; i++) {
    const seg = path.join(workDir, `seg-${i}.mp4`);
    total += await segment(scenes[i], i, mode, path.join(workDir, `s${i}`), seg);
    parts.push(seg);
  }
  const end = path.join(workDir, 'seg-end.mp4');
  total += await endCard(path.join(workDir, 'end'), end);
  parts.push(end);
  const list = path.join(workDir, 'parts.txt');
  fs.writeFileSync(list, parts.map(p => `file '${posix(p)}'`).join('\n') + '\n');
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
  return { duration: total };
}

module.exports = { buildDialogueVideo };
