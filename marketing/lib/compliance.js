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

function ruleCheck(piece) { return checkText(allText(piece)); }

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

async function review(pieces) {
  const res = await askJson({
    system: brand + '\n\n' + rules,
    schema: REVIEW_SCHEMA,
    effort: 'medium',
    prompt: 'Review each piece. Return one review per id.\n<pieces>\n' + JSON.stringify(pieces.map(p => ({
      id: p.id, format: p.format, hook: p.hook, scenes: p.scenes, slides: p.slides, caption: p.caption, short_link: p.short_link,
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
async function checkAll(pieces) {
  let current = pieces;
  let reviews = await review(current);
  const needsFix = current.filter(p => !(reviews[p.id] && reviews[p.id].passed) || !ruleCheck(p).passed);
  if (needsFix.length) {
    const fixedPieces = needsFix.map(p => applyFix(p, reviews[p.id] && reviews[p.id].fixed));
    const second = await review(fixedPieces);
    current = current.map(p => {
      const f = fixedPieces.find(x => x.id === p.id);
      if (!f) return p;
      reviews[p.id] = Object.assign({}, second[p.id], { first_issues: reviews[p.id] ? reviews[p.id].issues : [] });
      return Object.assign(f, { _rounds: 2 });
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
