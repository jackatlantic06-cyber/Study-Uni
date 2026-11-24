// Branded images for videos (1080x1920) and carousels (1080x1350).
// Uses satori (layout → SVG) + resvg (SVG → PNG). No browser needed.
//
// Design: navy/midblue brand, one big emoji per scene (Google Noto emoji,
// Apache-2.0), key words highlighted, TikTok-style captions with the spoken
// word lit up, and a different background for each scene.
const fs = require('fs');
const path = require('path');
const satori = require('satori').default || require('satori');
const { Resvg } = require('@resvg/resvg-js');

const BRAND = {
  navy: '#0f172a', navy2: '#1e293b', deep: '#172554', royal: '#1e3a8a', blue: '#2563eb', blueD: '#1d4ed8',
  blueLight: '#93c5fd', sky: '#eff6ff', white: '#ffffff', muted: '#cbd5e1', ink: '#0f172a', slate: '#64748b',
};

const fontDir = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');
const font = w => fs.readFileSync(path.join(fontDir, `inter-latin-${w}-normal.woff`));
const FONTS = [400, 500, 600, 700, 800].map(weight => ({ name: 'Inter', data: font(weight), weight, style: 'normal' }));

// ── emoji (Noto, fetched once per run and cached in memory) ──────────────
const NOTO = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/svg/emoji_u';
const emojiCache = new Map();
async function emojiUri(emoji) {
  if (!emoji) return null;
  const cps = Array.from(emoji).map(c => c.codePointAt(0).toString(16)).filter(cp => cp !== 'fe0f' && cp !== '200d');
  if (!cps.length) return null;
  const key = cps.join('_');
  if (emojiCache.has(key)) return emojiCache.get(key);
  let uri = null;
  try {
    const r = await fetch(NOTO + key + '.svg');
    if (r.ok) uri = 'data:image/svg+xml;base64,' + Buffer.from(await r.text()).toString('base64');
  } catch (_) { /* no emoji is fine */ }
  emojiCache.set(key, uri);
  return uri;
}

// Minimal element helper for satori (it takes React-like objects).
function h(type, style, ...children) {
  const kids = children.flat().filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: { style: Object.assign({ display: 'flex' }, style), children: kids.length === 1 ? kids[0] : kids } };
}
const img = (src, style) => ({ type: 'img', props: { src, style } });

// Strip emoji/markers from on-screen text (emoji are drawn separately).
function clean(t) {
  return String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

function fit(text, sizes) {
  const n = clean(text).length;
  for (const [max, size] of sizes) if (n <= max) return size;
  return sizes[sizes.length - 1][1];
}

// On-screen links always show as plain "study-uni.ie" (tracking stays in captions).
function splitLink(t) {
  const c = clean(t);
  const re = /study-uni\.ie(\/t\/[0-9a-z]+)?/gi;
  if (!re.test(c)) return { text: c, link: null };
  const text = c.replace(re, '').replace(/\s{2,}/g, ' ').replace(/[:\-–—,]\s*$/, '').replace(/\s+([.!?])/g, '$1').trim();
  return { text, link: 'study-uni.ie' };
}

// Words as separate boxes so chosen ones can be highlighted.
function richText(text, highlight, style, hl) {
  const words = clean(text).split(' ').filter(Boolean);
  const hlWords = new Set(clean(highlight).toLowerCase().split(' ').map(w => w.replace(/[^\w'-]/g, '')).filter(Boolean));
  return h('div', { flexWrap: 'wrap', columnGap: style.fontSize * 0.26, rowGap: style.fontSize * 0.08, ...style },
    words.map(w => {
      const on = hlWords.has(w.toLowerCase().replace(/[^\w'-]/g, ''));
      return h('div', on ? { ...hl, padding: `0 ${style.fontSize * 0.14}px`, borderRadius: style.fontSize * 0.14 } : {}, w);
    }));
}

function brandBar(dark = true) {
  return h('div', { alignItems: 'center', gap: 18 },
    h('div', { width: 68, height: 68, borderRadius: 16, background: BRAND.blue, alignItems: 'center', justifyContent: 'center', color: BRAND.white, fontSize: 30, fontWeight: 800, letterSpacing: -1, boxShadow: '0 6px 18px rgba(37,99,235,0.45)' }, 'SU'),
    h('div', { fontSize: 40, fontWeight: 800, color: dark ? BRAND.white : BRAND.ink, letterSpacing: -0.5 }, 'Study-Uni'),
  );
}

// The Inter subset has no arrow glyph, so the arrow is the Noto ➡️ image.
function linkPill(big, arrow) {
  const s = big ? 60 : 50;
  return h('div', { alignSelf: 'flex-start', alignItems: 'center', gap: 18, background: BRAND.white, color: BRAND.blueD, fontSize: s, fontWeight: 800, padding: big ? '24px 40px' : '20px 34px', borderRadius: 999, marginTop: 44, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' },
    'study-uni.ie', arrow ? img(arrow, { width: s * 0.9, height: s * 0.9 }) : null);
}

// Background themes, cycled per scene so each scene looks different.
const THEMES = [
  { bg: `linear-gradient(165deg, ${BRAND.navy} 0%, ${BRAND.deep} 60%, ${BRAND.royal} 100%)`, blobs: [[-260, 980, 940, 'rgba(37,99,235,0.30)'], [700, -200, 520, 'rgba(147,197,253,0.10)']], hl: { background: BRAND.blue, color: BRAND.white } },
  { bg: `linear-gradient(200deg, ${BRAND.blueD} 0%, ${BRAND.royal} 55%, ${BRAND.navy} 100%)`, blobs: [[620, 1150, 900, 'rgba(15,23,42,0.35)'], [-220, -120, 600, 'rgba(255,255,255,0.08)']], hl: { background: BRAND.white, color: BRAND.blueD } },
  { bg: `linear-gradient(150deg, ${BRAND.navy2} 0%, ${BRAND.navy} 50%, ${BRAND.deep} 100%)`, blobs: [[560, 260, 760, 'rgba(37,99,235,0.28)'], [-300, 1400, 700, 'rgba(147,197,253,0.10)']], hl: { background: BRAND.blueLight, color: BRAND.navy } },
  { bg: `linear-gradient(180deg, ${BRAND.deep} 0%, ${BRAND.blueD} 100%)`, blobs: [[-320, 300, 800, 'rgba(15,23,42,0.30)'], [640, 1300, 760, 'rgba(255,255,255,0.08)']], hl: { background: BRAND.white, color: BRAND.blueD } },
];
const blob = ([x, y, d, c]) => h('div', { position: 'absolute', left: x, top: y, width: d, height: d, borderRadius: d / 2, background: c });

const SAFE_W = 1080 - 90 - 150; // keep clear of TikTok/Reels side buttons

// ── Video frame: 1080x1920 ───────────────────────────────────────────────
// caption: [{word, active}] — the spoken word is lit up.
async function videoFrame({ onscreen, highlight, emoji, caption, index, total, aiLabel }) {
  const theme = index === total - 1 ? THEMES[1] : THEMES[index % THEMES.length];
  const { text, link } = splitLink(onscreen);
  const isHook = index === 0, isEnd = index === total - 1;
  const size = fit(text, isHook ? [[18, 124], [32, 108], [48, 92], [70, 78], [999, 66]] : [[18, 112], [32, 96], [48, 84], [70, 72], [999, 62]]);
  const e = await emojiUri(emoji);
  const arrow = link ? await emojiUri('➡️') : null;
  return h('div', { width: 1080, height: 1920, fontFamily: 'Inter', position: 'relative', backgroundImage: theme.bg },
    ...theme.blobs.map(blob),
    // header
    h('div', { position: 'absolute', left: 90, top: 190, width: SAFE_W, flexDirection: 'column' },
      h('div', { justifyContent: 'space-between', alignItems: 'center' },
        brandBar(true),
        aiLabel ? h('div', { fontSize: 26, color: BRAND.muted, fontWeight: 600, border: '2px solid rgba(203,213,225,0.5)', borderRadius: 999, padding: '6px 16px' }, 'AI voice') : null,
      ),
      h('div', { gap: 10, marginTop: 34 }, Array.from({ length: total }, (_, i) =>
        h('div', { width: i === index ? 90 : 54, height: 10, borderRadius: 5, background: i <= index ? BRAND.white : 'rgba(255,255,255,0.22)' }))),
    ),
    // emoji + main text
    h('div', { position: 'absolute', left: 90, top: 400, width: SAFE_W, height: 760, flexDirection: 'column', justifyContent: 'center' },
      e ? img(e, { width: isHook ? 190 : 170, height: isHook ? 190 : 170, marginBottom: 36 }) : null,
      text ? richText(text, highlight, { fontSize: size, fontWeight: 800, color: BRAND.white, lineHeight: 1.12, letterSpacing: -2 }, theme.hl) : null,
      link ? linkPill(true, arrow) : null,
      isEnd && link ? h('div', { fontSize: 40, fontWeight: 600, color: BRAND.muted, marginTop: 26 }, 'Free to sign up with your UCC email') : null,
    ),
    // captions
    caption && caption.length ? h('div', { position: 'absolute', left: 90, top: 1215, width: SAFE_W, justifyContent: 'center' },
      h('div', { flexWrap: 'wrap', justifyContent: 'center', columnGap: 2, rowGap: 6, background: 'rgba(255,255,255,0.97)', padding: '20px 30px', borderRadius: 26, boxShadow: '0 14px 40px rgba(0,0,0,0.35)', maxWidth: SAFE_W },
        caption.map(w => h('div', {
          fontSize: 58, fontWeight: 800, lineHeight: 1.2, color: w.active ? BRAND.white : BRAND.ink,
          background: w.active ? BRAND.blue : 'transparent', padding: '0 10px', borderRadius: 12,
        }, w.word)))) : null,
  );
}

// ── Carousel slide: 1080x1350 (Instagram 4:5) ────────────────────────────
async function carouselSlide({ headline, body, highlight, emoji, index, total }) {
  const first = index === 0, last = index === total - 1;
  const { text: bodyText, link: bodyLink } = splitLink(body);
  const { text: headText, link: headLink } = splitLink(headline);
  const link = bodyLink || headLink || (last ? 'study-uni.ie' : null);
  const dark = first || last;
  const hSize = fit(headText, first ? [[20, 116], [36, 98], [60, 82], [999, 68]] : [[20, 88], [40, 76], [999, 62]]);
  const e = await emojiUri(emoji);
  const arrow = await emojiUri('➡️');
  const W = 1080 - 180;
  const bg = first ? THEMES[0].bg : last ? THEMES[1].bg : `linear-gradient(160deg, ${BRAND.white} 0%, ${BRAND.sky} 100%)`;
  const hl = first ? THEMES[0].hl : last ? THEMES[1].hl : { background: BRAND.blue, color: BRAND.white };
  return h('div', { width: 1080, height: 1350, fontFamily: 'Inter', position: 'relative', backgroundImage: bg },
    dark ? blob([620, 880, 760, 'rgba(37,99,235,0.28)']) : blob([700, -260, 640, 'rgba(37,99,235,0.08)']),
    h('div', { position: 'absolute', left: 90, top: 80, width: W, justifyContent: 'space-between', alignItems: 'center' },
      brandBar(dark),
      h('div', { fontSize: 32, fontWeight: 700, color: dark ? BRAND.blueLight : BRAND.blue, background: dark ? 'rgba(255,255,255,0.08)' : BRAND.sky, padding: '8px 20px', borderRadius: 999 }, `${index + 1}/${total}`),
    ),
    h('div', { position: 'absolute', left: 90, top: 210, width: W, height: 900, flexDirection: 'column', justifyContent: 'center' },
      h('div', { alignItems: 'center', gap: 26, marginBottom: 36 },
        !first && !last ? h('div', { width: 96, height: 96, borderRadius: 48, background: BRAND.blue, color: BRAND.white, fontSize: 48, fontWeight: 800, alignItems: 'center', justifyContent: 'center' }, String(index)) : null,
        e ? img(e, { width: first ? 150 : 110, height: first ? 150 : 110 }) : null,
      ),
      richText(headText, highlight, { fontSize: hSize, fontWeight: 800, color: dark ? BRAND.white : BRAND.ink, lineHeight: 1.1, letterSpacing: -2 }, hl),
      bodyText ? h('div', { fontSize: first ? 46 : 48, fontWeight: 500, color: dark ? BRAND.muted : BRAND.navy2, lineHeight: 1.38, marginTop: 36 }, bodyText) : null,
      link ? linkPill(false, arrow) : null,
    ),
    h('div', { position: 'absolute', left: 90, bottom: 80, width: W, justifyContent: 'space-between', alignItems: 'center', fontSize: 32, fontWeight: 600, color: dark ? BRAND.muted : BRAND.slate },
      h('div', {}, 'study-uni.ie'),
      first ? h('div', { alignItems: 'center', gap: 12, background: BRAND.white, color: BRAND.blueD, padding: '10px 26px', borderRadius: 999, fontWeight: 800 }, 'Swipe', arrow ? img(arrow, { width: 32, height: 32 }) : null) : h('div', {}, last ? 'Free to sign up' : ''),
    ),
  );
}

// ── Transparent caption overlay for cartoon dialogue videos ──────────────
// speaker chip + caption box (spoken word lit up) + brand + AI tag.
async function captionOverlay({ speaker, color, caption }) {
  return h('div', { width: 1080, height: 1920, fontFamily: 'Inter', position: 'relative' },
    h('div', { position: 'absolute', left: 60, top: 170, alignItems: 'center', gap: 14, background: 'rgba(15,23,42,0.72)', padding: '12px 22px 12px 14px', borderRadius: 999 },
      h('div', { width: 52, height: 52, borderRadius: 13, background: BRAND.blue, alignItems: 'center', justifyContent: 'center', color: BRAND.white, fontSize: 24, fontWeight: 800 }, 'SU'),
      h('div', { fontSize: 32, fontWeight: 800, color: BRAND.white }, 'Study-Uni')),
    h('div', { position: 'absolute', right: 150, top: 182, fontSize: 26, fontWeight: 700, color: BRAND.white, background: 'rgba(15,23,42,0.72)', padding: '10px 18px', borderRadius: 999 }, 'AI-generated'),
    caption && caption.length ? h('div', { position: 'absolute', left: 90, top: 1260, width: SAFE_W, flexDirection: 'column', alignItems: 'center' },
      speaker ? h('div', { background: color || BRAND.blue, color: BRAND.white, fontSize: 34, fontWeight: 800, padding: '8px 24px', borderRadius: 999, marginBottom: -14, zIndex: 2, boxShadow: '0 6px 16px rgba(0,0,0,0.3)' }, speaker) : null,
      h('div', { flexWrap: 'wrap', justifyContent: 'center', columnGap: 2, rowGap: 6, background: 'rgba(255,255,255,0.97)', padding: '28px 30px 20px', borderRadius: 26, boxShadow: '0 14px 40px rgba(0,0,0,0.35)', maxWidth: SAFE_W },
        caption.map(w => h('div', { fontSize: 54, fontWeight: 800, lineHeight: 1.2, color: w.active ? BRAND.white : BRAND.ink, background: w.active ? (color || BRAND.blue) : 'transparent', padding: '0 10px', borderRadius: 12 }, w.word)))) : null,
  );
}

async function toPng(node, width, height) {
  const svg = await satori(node, { width, height, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

const renderVideoFrame = async opts => toPng(await videoFrame(opts), 1080, 1920);
const renderCarouselSlide = async opts => toPng(await carouselSlide(opts), 1080, 1350);

const renderCaptionOverlay = async opts => toPng(await captionOverlay(opts), 1080, 1920);

module.exports = { renderVideoFrame, renderCarouselSlide, renderCaptionOverlay, clean, BRAND };
