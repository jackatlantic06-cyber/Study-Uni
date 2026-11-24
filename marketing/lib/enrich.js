// Picks one emoji and the key word(s) to highlight for each scene/slide.
// Runs once per piece (shared by the TikTok and Instagram versions) and the
// result is saved into the post's script, so re-renders don't call Claude.
const { askJson } = require('./claude');
const { clean } = require('./slides');

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['emoji', 'highlight'], properties: {
    emoji: { type: 'string', description: 'Exactly one common emoji that fits the line (no flags, no skin tones, no people doing gestures).' },
    highlight: { type: 'string', description: '1–2 consecutive words copied EXACTLY from the line that carry the punch. Empty string if nothing stands out.' },
  } } } },
};

const cache = new Map();

async function enrich(lines, cacheKey) {
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const res = await askJson({
    system: 'You style short on-screen text for a UK/Irish student revision brand on TikTok/Instagram. Pick a fitting emoji and the punchiest 1–2 words to highlight for each line. Keep it tasteful and on-brand (study, exams, relief, humour).',
    schema: SCHEMA,
    effort: 'low',
    maxTokens: 2000,
    prompt: `Return exactly ${lines.length} items, one per line, in order.\n` + lines.map((l, i) => `${i + 1}. ${clean(l)}`).join('\n'),
  });
  const items = lines.map((l, i) => {
    const it = res.items[i] || {};
    const text = clean(l).toLowerCase();
    const hl = clean(it.highlight || '');
    return { emoji: (it.emoji || '').trim(), highlight: hl && text.includes(hl.toLowerCase()) ? hl : '' };
  });
  cache.set(cacheKey, items);
  return items;
}

module.exports = { enrich };
