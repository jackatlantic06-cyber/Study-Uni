// Two-layer check before anything reaches the approval queue:
//  1. deterministic banned-phrase rules (shared with the dashboard API)
//  2. an independent Claude review against the brand rules
// A piece that fails is rewritten once and re-checked; if it still fails it
// is saved as a hidden draft (never shown as approvable).
const fs = require('fs');
const path = require('path');
const { checkText } = require('../../lib/marketing-rules');
const { askJson } = require('./claude');

const brand = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'brand.md'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'compliance.md'), 'utf8');

function allText(piece) {
  const parts = [piece.hook, piece.caption, piece.cta];
  (piece.scenes || []).forEach(s => parts.push(s.onscreen, s.voiceover));
  (piece.slides || []).forEach(s => parts.push(s.headline, s.body));
  return parts.filter(Boolean).join('\n');
}

// Module codes named in a post must exist on the site WITH past papers.
let modIndex = null;
function moduleProblems(text) {
  if (!modIndex) { try { modIndex = require('./modules').buildIndex(); } catch (_) { modIndex = {}; } }
  if (!Object.keys(modIndex).length) return [];
  const { modulesIn } = require('../../lib/comments');
  return modulesIn(text).filter(c => !(modIndex[c] && modIndex[c].papers > 0))
    .map(c => `mentions ${c}, which has no past papers on study-uni.ie — use a module from the provided list`);
}

function ruleCheck(piece) {
  const text = allText(piece);
  const r = checkText(text);
  const mods = moduleProblems(text);
  return { passed: r.passed && !mods.length, blocked: [...r.blocked, ...mods], warnings: r.warnings };
}

const SCENE = { type: 'object', additionalProperties: false, required: ['onscreen', 'voiceover', 'visual'], properties: { onscreen: { type: 'string' }, voiceover: { type: 'string' }, visual: { type: 'string' } } };
const SLIDE = { type: 'object', additionalProperties: false, required: ['headline', 'body'], properties: { headline: { type: 'string' }, body: { type: 'string' } } };
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reviews'],
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'passed', 'issues', 'warnings', 'fixed'],
        properties: {
          id: { type: 'string' },
          passed: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          fixed: {
            anyOf: [{ type: 'null' }, {
              type: 'object', additionalProperties: false,
              required: ['hook', 'caption', 'scenes', 'slides'],
              properties: {
                hook: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                caption: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                scenes: { anyOf: [{ type: 'array', items: SCENE }, { type: 'null' }] },
                slides: { anyOf: [{ type: 'array', items: SLIDE }, { type: 'null' }] },
              },
            }],
          },
        },
      },
    },
  },
};

async function review(pieces, facts) {
  const res = await askJson({
    system: brand + '\n\n' + rules,
    schema: REVIEW_SCHEMA,
    effort: 'medium',
    prompt: `<verified_dates>\n${JSON.stringify((facts && facts.dates) || [])}\n</verified_dates>\n` +
      'Each piece will show its own short link where {{LINK}} appears (e.g. study-uni.ie/t/26w48t1); treat {{LINK}} as that link.\n' +
      'Review each piece. Return one review per id.\n<pieces>\n' + JSON.stringify(pieces.map(p => ({
      id: p.id, format: p.format, style: p.style, setting: p.setting, hook: p.hook, scenes: p.scenes, slides: p.slides, caption: p.caption,
      deterministic_flags: ruleCheck(p).blocked,
    }))) + '\n</pieces>',
  });
  const byId = {};
  for (const r of res.reviews) byId[r.id] = r;
  return byId;
}

function applyFix(piece, fixed) {
  if (!fixed) return piece;
  const out = Object.assign({}, piece);
  for (const k of ['hook', 'caption', 'scenes', 'slides']) if (fixed[k] != null) out[k] = fixed[k];
  return out;
}

// Returns pieces with .compliance = {passed, blocked, issues, warnings, rounds, checked_at}
async function checkAll(pieces, facts) {
  let current = pieces;
  let reviews = await review(current, facts);
  // Up to two rewrite rounds: apply the reviewer's fixes, review again.
  for (let round = 2; round <= 3; round++) {
    const needsFix = current.filter(p => !(reviews[p.id] && reviews[p.id].passed) || !ruleCheck(p).passed);
    if (!needsFix.length) break;
    const fixedPieces = needsFix.map(p => applyFix(p, reviews[p.id] && reviews[p.id].fixed));
    const again = await review(fixedPieces, facts);
    current = current.map(p => {
      const f = fixedPieces.find(x => x.id === p.id);
      if (!f) return p;
      const earlier = [...((reviews[p.id] && reviews[p.id].first_issues) || []), ...((reviews[p.id] && reviews[p.id].issues) || [])];
      reviews[p.id] = Object.assign({}, again[p.id], { first_issues: earlier });
      return Object.assign(f, { _rounds: round });
    });
  }
  const now = new Date().toISOString();
  return current.map(p => {
    const r = reviews[p.id] || { passed: false, issues: ['No review returned'], warnings: [] };
    const det = ruleCheck(p);
    return Object.assign(p, {
      compliance: {
        passed: !!r.passed && det.passed,
        blocked: det.blocked,
        issues: r.issues || [],
        first_issues: r.first_issues || undefined,
        warnings: [...new Set([...(r.warnings || []), ...det.warnings])],
        rounds: p._rounds || 1,
        checked_at: now,
      },
    });
  });
}

module.exports = { checkAll, ruleCheck, allText };
