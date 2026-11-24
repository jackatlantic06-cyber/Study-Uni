// Module lookup built from the site's own data.js, so comment replies only
// say what's actually on study-uni.ie.
//   { EC1101: { name, papers, schemes, quiz, courses:[...] }, ... }
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function buildIndex(dataFile = path.join(__dirname, '..', '..', 'data.js')) {
  const src = fs.readFileSync(dataFile, 'utf8').replace(/^﻿/, '');
  const ctx = { window: {}, console: { log() {}, warn() {} } };
  vm.createContext(ctx);
  vm.runInContext(src + ';this.__d={SCHOOLS,MODEL_ANSWERS,QUIZ_BANK};', ctx, { timeout: 10000 });
  const { SCHOOLS, MODEL_ANSWERS, QUIZ_BANK } = ctx.__d;
  const idx = {};
  const add = (m, course) => {
    if (!m || !m.code) return;
    const code = String(m.code).toUpperCase();
    const e = idx[code] || (idx[code] = { name: m.name || '', papers: 0, schemes: 0, quiz: false, courses: [] });
    for (const f of m.files || []) {
      const label = String((f && f.label) || '');
      if (/marking scheme|solution|model answer/i.test(label)) e.schemes++; else e.papers++;
    }
    if (course && !e.courses.includes(course)) e.courses.push(course);
  };
  for (const s of SCHOOLS || []) for (const c of s.courses || []) for (const y of c.years || []) {
    for (const m of y.modules || []) add(m, c.name);
    for (const sec of y.sections || []) for (const m of sec.modules || []) add(m, c.name);
  }
  for (const code of Object.keys(MODEL_ANSWERS || {})) {
    const e = idx[code.toUpperCase()] || (idx[code.toUpperCase()] = { name: '', papers: 0, schemes: 0, quiz: false, courses: [] });
    const v = MODEL_ANSWERS[code];
    e.schemes = Math.max(e.schemes, Array.isArray(v) ? v.length : 1);
  }
  for (const code of Object.keys(QUIZ_BANK || {})) {
    const e = idx[code.toUpperCase()] || (idx[code.toUpperCase()] = { name: '', papers: 0, schemes: 0, quiz: false, courses: [] });
    e.quiz = true;
  }
  return idx;
}

module.exports = { buildIndex };
