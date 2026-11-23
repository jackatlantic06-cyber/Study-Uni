// Brand / compliance rules shared by the dashboard API and the GitHub Actions
// jobs. Everything must read as revision and past-paper practice — never as
// getting exam answers or anything that suggests academic dishonesty.

const BLOCKED = [
  { re: /\bexam answers?\b/i,                       why: '"exam answers" suggests academic dishonesty' },
  { re: /\b(get|getting|got|see|all) (the )?answers\b/i, why: '"get the answers" suggests academic dishonesty' },
  { re: /\banswers?\s+(to|for)\s+(the|this|your|next|upcoming)\b/i, why: 'implies answers to a live exam' },
  { re: /\banswer ?keys?\b/i,                       why: '"answer key" suggests academic dishonesty' },
  { re: /\bcheat(s|ing|ed|er|sheet)?\b/i,           why: '"cheat" is not allowed' },
  { re: /\bleak(s|ed|ing)?\b/i,                     why: '"leaked" suggests stolen exam content' },
  { re: /\b(guarantee[sd]?|guaranteed)\b.{0,20}\b(pass|grade|h1|first|1\.1)\b/i, why: 'no guaranteed results' },
  { re: /\bwithout (studying|revising|doing any work)\b/i, why: 'must be framed as revision' },
  { re: /\b(hack|game|beat) the (exam|system|lecturer)\b/i, why: 'implies gaming the exam' },
  { re: /\bdo (your|my) (assignment|essay|coursework)\b/i, why: 'implies contract cheating' },
  { re: /\bwrite (your|my) (assignment|essay)\b/i,  why: 'implies contract cheating' },
  { re: /\bupcoming exam (paper|questions)\b/i,     why: 'implies access to unreleased papers' },
];

// Softer phrases: allowed, but shown as warnings so Jack looks twice.
const WARN = [
  { re: /\banswers?\b/i,      why: 'mentions "answers" — make sure it means past-paper marking schemes' },
  { re: /\bsolutions?\b/i,    why: 'mentions "solutions" — make sure it is framed as practice' },
];

function checkText(text) {
  const t = String(text || '');
  const blocked = BLOCKED.filter(r => r.re.test(t)).map(r => r.why);
  const warnings = WARN.filter(r => r.re.test(t)).map(r => r.why);
  return { passed: blocked.length === 0, blocked, warnings };
}

module.exports = { checkText, BLOCKED, WARN };
