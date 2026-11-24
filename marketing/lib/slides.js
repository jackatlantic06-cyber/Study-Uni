// Branded images for videos (1080x1920) and carousels (1080x1350).
// Uses satori (layout → SVG) + resvg (SVG → PNG). No browser needed.
const fs = require('fs');
const path = require('path');
const satori = require('satori').default || require('satori');
const { Resvg } = require('@resvg/resvg-js');

const BRAND = {
  navy: '#0f172a', navy2: '#1e293b', deep: '#172554', blue: '#2563eb', blueLight: '#93c5fd',
  sky: '#eff6ff', white: '#ffffff', muted: '#cbd5e1', ink: '#0f172a', slate: '#64748b',
};

const fontDir = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');
const font = w => fs.readFileSync(path.join(fontDir, `inter-latin-${w}-normal.woff`));
const FONTS = [400, 600, 700, 800].map(weight => ({ name: 'Inter', data: font(weight), weight, style: 'normal' }));

// Minimal element helper for satori (it takes React-like objects).
function h(type, style, ...children) {
  const kids = children.flat().filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: { style: Object.assign({ display: 'flex' }, style), children: kids.length === 1 ? kids[0] : kids } };
}

// Satori can't draw emoji without extra image packs; strip them from on-screen text.
function clean(t) {
  return String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
}

// Font size that keeps long lines on the slide.
function fit(text, sizes) {
  const n = clean(text).length;
  for (const [max, size] of sizes) if (n <= max) return size;
  return sizes[sizes.length - 1][1];
}

function brandBar(dark = true) {
  // Same badge as the site favicon: blue rounded square with "SU".
  return h('div', { alignItems: 'center', gap: 18 },
    h('div', { width: 68, height: 68, borderRadius: 16, background: BRAND.blue, alignItems: 'center', justifyContent: 'center', color: BRAND.white, fontSize: 30, fontWeight: 800, letterSpacing: -1 }, 'SU'),
    h('div', { fontSize: 40, fontWeight: 800, color: dark ? BRAND.white : BRAND.ink, letterSpacing: -0.5 }, 'Study-Uni'),
  );
}

function linkPill(text) {
  return h('div', { alignSelf: 'flex-start', background: BRAND.blue, color: BRAND.white, fontSize: 52, fontWeight: 800, padding: '22px 40px', borderRadius: 999, marginTop: 40 }, text);
}

// Pull a study-uni.ie link out of on-screen text so it can be shown as a pill.
function splitLink(t) {
  const m = clean(t).match(/(study-uni\.ie\/t\/[0-9a-z]+|study-uni\.ie)/i);
  if (!m) return { text: clean(t), link: null };
  const text = clean(t).replace(m[0], '').replace(/[:\-–—]\s*$/, '').trim();
  return { text, link: m[0] };
}

// ── Video frame: 1080x1920 ───────────────────────────────────────────────
// Keeps text out of TikTok/Reels UI zones (top ~12%, bottom ~22%, right ~14%).
const SAFE_W = 1080 - 90 - 150; // content width inside the UI-safe area

function videoFrame({ onscreen, caption, index, total, aiLabel }) {
  const { text, link } = splitLink(onscreen);
  const size = fit(text, [[18, 116], [32, 98], [48, 84], [70, 72], [999, 62]]);
  return h('div', {
    width: 1080, height: 1920, fontFamily: 'Inter', position: 'relative',
    backgroundImage: `linear-gradient(165deg, ${BRAND.navy} 0%, ${BRAND.deep} 55%, #1e3a8a 100%)`,
  },
    // soft decorative circles
    h('div', { position: 'absolute', width: 900, height: 900, borderRadius: 450, right: -420, top: 980, background: 'rgba(37,99,235,0.22)' }),
    h('div', { position: 'absolute', width: 520, height: 520, borderRadius: 260, left: -300, top: -160, background: 'rgba(147,197,253,0.08)' }),
    // header: brand + AI label + progress
    h('div', { position: 'absolute', left: 90, top: 190, width: SAFE_W, flexDirection: 'column' },
      h('div', { justifyContent: 'space-between', alignItems: 'center' },
        brandBar(true),
        aiLabel ? h('div', { fontSize: 26, color: BRAND.muted, fontWeight: 600, border: '2px solid rgba(203,213,225,0.5)', borderRadius: 999, padding: '6px 16px' }, 'AI voice') : null,
      ),
      h('div', { gap: 10, marginTop: 34 }, Array.from({ length: total }, (_, i) =>
        h('div', { width: 60, height: 8, borderRadius: 4, background: i <= index ? BRAND.blueLight : 'rgba(255,255,255,0.18)' }))),
    ),
    // main on-screen text
    h('div', { position: 'absolute', left: 90, top: 430, width: SAFE_W, height: 700, flexDirection: 'column', justifyContent: 'center' },
      text ? h('div', { fontSize: size, fontWeight: 800, color: BRAND.white, lineHeight: 1.08, letterSpacing: -2 }, text) : null,
      link ? linkPill(link) : null,
    ),
    // burned-in caption chunk
    caption ? h('div', { position: 'absolute', left: 90, top: 1190, width: SAFE_W, justifyContent: 'center' },
      h('div', { background: 'rgba(255,255,255,0.96)', color: BRAND.ink, fontSize: 56, fontWeight: 800, lineHeight: 1.2, padding: '18px 30px', borderRadius: 22, textAlign: 'center' }, clean(caption)),
    ) : null,
  );
}

// ── Carousel slide: 1080x1350 (Instagram 4:5) ────────────────────────────
function carouselSlide({ headline, body, index, total }) {
  const first = index === 0, last = index === total - 1;
  const { text: bodyText, link: bodyLink } = splitLink(body);
  const { text: headText, link: headLink } = splitLink(headline);
  const link = bodyLink || headLink;
  const dark = first || last;
  const hSize = fit(headText, first ? [[20, 116], [36, 96], [60, 80], [999, 68]] : [[20, 90], [40, 76], [999, 62]]);
  const W = 1080 - 180;
  return h('div', {
    width: 1080, height: 1350, fontFamily: 'Inter', position: 'relative',
    backgroundImage: dark ? `linear-gradient(160deg, ${BRAND.navy} 0%, ${BRAND.deep} 60%, #1e3a8a 100%)` : `linear-gradient(160deg, ${BRAND.white} 0%, ${BRAND.sky} 100%)`,
  },
    dark ? h('div', { position: 'absolute', width: 700, height: 700, borderRadius: 350, right: -330, bottom: -330, background: 'rgba(37,99,235,0.25)' }) : null,
    h('div', { position: 'absolute', left: 90, top: 80, width: W, justifyContent: 'space-between', alignItems: 'center' },
      brandBar(dark),
      h('div', { fontSize: 34, fontWeight: 700, color: dark ? BRAND.blueLight : BRAND.blue }, `${index + 1}/${total}`),
    ),
    h('div', { position: 'absolute', left: 90, top: 220, width: W, height: 900, flexDirection: 'column', justifyContent: 'center' },
      first ? null : h('div', { width: 120, height: 12, borderRadius: 6, background: BRAND.blue, marginBottom: 44 }),
      h('div', { fontSize: hSize, fontWeight: 800, color: dark ? BRAND.white : BRAND.ink, lineHeight: 1.08, letterSpacing: -2 }, headText),
      bodyText ? h('div', { fontSize: first ? 48 : 50, fontWeight: 500, color: dark ? BRAND.muted : BRAND.navy2, lineHeight: 1.35, marginTop: 40 }, bodyText) : null,
      link ? linkPill(link) : null,
    ),
    h('div', { position: 'absolute', left: 90, bottom: 80, width: W, justifyContent: 'space-between', alignItems: 'center', fontSize: 32, fontWeight: 600, color: dark ? BRAND.muted : BRAND.slate },
      h('div', {}, 'study-uni.ie'),
      h('div', {}, first ? 'Swipe →' : last ? 'Free to sign up' : ''),
    ),
  );
}

async function toPng(node, width, height) {
  const svg = await satori(node, { width, height, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

const renderVideoFrame = opts => toPng(videoFrame(opts), 1080, 1920);
const renderCarouselSlide = opts => toPng(carouselSlide(opts), 1080, 1350);

module.exports = { renderVideoFrame, renderCarouselSlide, clean, BRAND };
