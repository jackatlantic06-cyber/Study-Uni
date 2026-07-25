const fs   = require('fs');
const path = require('path');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const src = fs.readFileSync(path.join(process.cwd(), 'data.js'), 'utf8');

  const seen = new Set();
  const urls = [];
  const re = /url:"(https?:\/\/uccireland\.sharepoint\.com[^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }

  res.json({ count: urls.length, urls });
};
