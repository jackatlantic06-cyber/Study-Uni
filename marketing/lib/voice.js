// ElevenLabs voiceover with per-character timestamps (used to time the
// burned-in captions). Uses a stock (premade) voice.
//
// Without ELEVENLABS_API_KEY (or with --no-voice) it returns silence with
// estimated timings, so the rest of the pipeline can be tested for free.
const fs = require('fs');

const API = 'https://api.elevenlabs.io/v1';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
// Tried in order if ELEVENLABS_VOICE_ID isn't set: young, natural stock voices.
const PREFERRED = ['Charlie', 'Liam', 'Will', 'Chris', 'Callum', 'Jessica', 'Laura', 'George'];

let chosenVoice = null;
const usage = { characters: 0, requests: 0 };

function enabled() {
  return !!process.env.ELEVENLABS_API_KEY && !process.argv.includes('--no-voice');
}

async function el(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function voiceId() {
  if (chosenVoice) return chosenVoice;
  if (process.env.ELEVENLABS_VOICE_ID) return (chosenVoice = { id: process.env.ELEVENLABS_VOICE_ID, name: 'configured' });
  const { voices } = await el('/voices');
  const premade = (voices || []).filter(v => v.category === 'premade');
  for (const name of PREFERRED) {
    const v = premade.find(x => (x.name || '').toLowerCase().startsWith(name.toLowerCase()));
    if (v) return (chosenVoice = { id: v.voice_id, name: v.name });
  }
  if (!premade.length) throw new Error('No premade ElevenLabs voices found — set ELEVENLABS_VOICE_ID');
  return (chosenVoice = { id: premade[0].voice_id, name: premade[0].name });
}

// Word timings from ElevenLabs' character alignment.
function wordsFromAlignment(text, a) {
  const words = [];
  let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } return; }
    if (!cur) cur = { word: '', start: a.character_start_times_seconds[i], end: 0 };
    cur.word += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  return words;
}

function estimateWords(text) {
  const ws = String(text).split(/\s+/).filter(Boolean);
  let t = 0.15;
  return ws.map(w => { const d = 0.18 + w.length * 0.045; const o = { word: w, start: t, end: t + d }; t += d + 0.05; return o; });
}

// Returns { file, duration, words:[{word,start,end}], voice }
async function speak(text, outFile) {
  if (!enabled()) {
    const words = estimateWords(text);
    return { file: null, duration: (words.length ? words[words.length - 1].end : 0) + 0.2, words, voice: 'silent (no ElevenLabs key)' };
  }
  const v = await voiceId();
  const res = await el(`/text-to-speech/${v.id}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
  });
  usage.characters += text.length; usage.requests++;
  fs.writeFileSync(outFile, Buffer.from(res.audio_base64, 'base64'));
  const a = res.alignment || res.normalized_alignment;
  const words = a ? wordsFromAlignment(text, a) : estimateWords(text);
  const duration = a && a.character_end_times_seconds.length ? a.character_end_times_seconds[a.character_end_times_seconds.length - 1] + 0.05 : words[words.length - 1].end;
  return { file: outFile, duration, words, voice: v.name };
}

module.exports = { speak, enabled, usage };
