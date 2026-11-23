// Loads secrets from the environment (GitHub Actions secrets). For local test
// runs it also reads marketing/.env.local (create it yourself; it is
// git-ignored) and then the repo's .env.local pulled from Vercel. Vercel's
// "[SENSITIVE]" placeholders are ignored.
const fs = require('fs');
const path = require('path');

for (const file of [path.join(__dirname, '..', '.env.local'), path.join(__dirname, '..', '..', '.env.local')]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    const v = m[2].replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n');
    if (!v || /^\[SENSITIVE\]$/i.test(v)) continue;
    process.env[m[1]] = v;
  }
}

function need(...names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const args = new Set(process.argv.slice(2));
const flags = {
  dryRun: args.has('--dry-run'),   // print results, write nothing
  force: args.has('--force'),      // re-run even if this week already exists
};

module.exports = { need, flags };
