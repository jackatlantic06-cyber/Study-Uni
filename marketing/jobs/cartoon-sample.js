// SAMPLE ONLY: one cartoon dialogue video in two versions, written to
// ./out/cartoon (nothing touches the dashboard).
//   A = animated storybook (AI scenes + slow camera movement)
//   B = animated clips (AI image-to-video per scene)
// Usage: node jobs/cartoon-sample.js [scenes|a|b|all]
const fs = require('fs');
const path = require('path');
require('../lib/env');
const fal = require('../lib/fal');
const voice = require('../lib/voice');
const { buildDialogueVideo } = require('../lib/cartoon');

const OUT = path.join(__dirname, '..', 'out', 'cartoon');
const STEP = process.argv[2] || 'all';
const STYLE = '3D animated cartoon style, cinematic warm lighting, vertical 9:16 composition with both characters in the middle third, appealing stylised proportions, original characters. No text, no readable writing, no logos, no watermark.';
const CAST = {
  Aoife: { voiceId: 'pFZP5JQG7iQjIQuC4Bku', voiceName: 'Lily', color: '#16a34a' },
  Cian: { voiceId: 'IKne3meq5aSn9XLyUdCD', voiceName: 'Charlie', color: '#2563eb' },
};

// Script: compliant framing (past-paper practice, free sign-up with UCC email).
const SCENES = [
  { speaker: 'Aoife', line: 'Cian. Exams are in two weeks and I can\'t find a single EC1101 past paper.',
    image: 'Night in a cosy university library with tall wooden bookshelves and warm desk lamps. Aoife sits at a desk with an open laptop, both hands on her head, stressed. Cian sits beside her holding a takeaway coffee, looking at her sympathetically.',
    motion: 'Aoife talks in a stressed way, hands moving on her head, Cian listens and sips his coffee, slow camera push-in, natural subtle motion.' },
  { speaker: 'Cian', line: 'Did you try the library site?',
    image: 'Same library desk. Cian leans towards Aoife with one eyebrow raised, gesturing with an open hand as he asks a question. Aoife looks at him, tired.',
    motion: 'Cian leans in and gestures while asking, Aoife blinks and looks tired, gentle camera movement.' },
  { speaker: 'Aoife', line: 'Library site, Canvas, the group chat. Four links. None of them work.',
    image: 'Same library desk. Aoife holds up her phone (screen shows blurry chat bubbles, nothing readable) and counts on the fingers of her other hand, exasperated. Cian winces.',
    motion: 'Aoife counts on her fingers and waves her phone, exasperated, Cian winces, subtle handheld camera feel.' },
  { speaker: 'Cian', line: 'Grand, use study-uni dot ie. All the UCC past papers, one place.',
    image: 'Same library desk. Cian smiles confidently and shows his phone screen to Aoife (screen glows blue, nothing readable). Aoife leans in, curious and hopeful.',
    motion: 'Cian turns his phone towards Aoife with a confident smile, Aoife leans in curiously, slow push-in.' },
  { speaker: 'Aoife', line: 'Free with my UCC email? Right. Timer on, notes away.',
    image: 'Same library desk. Aoife, relieved and smiling, writes in a notebook with a small timer on the desk and her laptop open. Cian gives a thumbs up beside her.',
    motion: 'Aoife writes in her notebook with a smile, Cian gives a thumbs up and grins, warm calm motion.' },
];

async function makeScenes() {
  const ref = fal.dataUri(path.join(OUT, 'characters.png'));
  await Promise.all(SCENES.map(async (s, i) => {
    const file = path.join(OUT, `scene-${i + 1}.png`);
    if (fs.existsSync(file)) return;
    const r = await fal.call('fal-ai/nano-banana/edit', {
      prompt: `Use the two characters from the reference image exactly as designed (Aoife: auburn messy bun, round glasses, green hoodie; Cian: dark curly hair, stubble, navy quarter-zip). ${s.image} ${STYLE}`,
      image_urls: [ref], num_images: 1, output_format: 'png', aspect_ratio: '9:16',
    });
    await fal.download(r.images[0].url, file);
    console.log('scene', i + 1, 'done');
  }));
}

async function makeVoices() {
  const dir = path.join(OUT, 'voice');
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (let i = 0; i < SCENES.length; i++) {
    const s = SCENES[i];
    out.push(await voice.speak(s.line, path.join(dir, `line-${i + 1}.mp3`), CAST[s.speaker]));
  }
  return out;
}

async function makeClips() {
  await Promise.all(SCENES.map(async (s, i) => {
    const file = path.join(OUT, `clip-${i + 1}.mp4`);
    if (fs.existsSync(file)) return;
    const r = await fal.call('fal-ai/kling-video/v2.1/standard/image-to-video', {
      prompt: s.motion + ' 3D animated cartoon style, keep characters on-model, no text.',
      image_url: fal.dataUri(path.join(OUT, `scene-${i + 1}.png`)), duration: '5',
      negative_prompt: 'blur, distortion, extra limbs, text, watermark, morphing faces',
    });
    await fal.download(r.video.url, file);
    console.log('clip', i + 1, 'done');
  }));
}

async function main() {
  if (['scenes', 'all', 'a', 'b'].includes(STEP)) await makeScenes();
  if (STEP === 'scenes') return;
  const audio = await makeVoices();
  const scenes = SCENES.map((s, i) => ({ speaker: s.speaker, color: CAST[s.speaker].color, image: path.join(OUT, `scene-${i + 1}.png`), clip: path.join(OUT, `clip-${i + 1}.mp4`), audio: audio[i] }));
  if (STEP === 'a' || STEP === 'all') {
    const r = await buildDialogueVideo({ scenes, mode: 'storybook', workDir: path.join(OUT, 'work-a'), outFile: path.join(OUT, 'sample-A-storybook.mp4') });
    console.log(`A: ${r.duration.toFixed(1)}s`);
  }
  if (STEP === 'b' || STEP === 'all') {
    await makeClips();
    const r = await buildDialogueVideo({ scenes, mode: 'clips', workDir: path.join(OUT, 'work-b'), outFile: path.join(OUT, 'sample-B-animated.mp4') });
    console.log(`B: ${r.duration.toFixed(1)}s`);
  }
  console.log('fal requests:', fal.usage.requests.length, '| ElevenLabs characters:', voice.usage.characters);
}

main().catch(e => { console.error(e); process.exit(1); });
