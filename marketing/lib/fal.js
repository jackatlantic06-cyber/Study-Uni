// fal.ai queue API: AI cartoon images (nano-banana) and image-to-video (Kling).
const fs = require('fs');

const QUEUE = 'https://queue.fal.run/';
const usage = { requests: [] };

function key() {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not set');
  return process.env.FAL_KEY;
}

async function call(model, input, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const headers = { Authorization: 'Key ' + key(), 'Content-Type': 'application/json' };
  const r = await fetch(QUEUE + model, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!r.ok) throw new Error(`fal ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const job = await r.json();
  const start = Date.now();
  for (;;) {
    await new Promise(res => setTimeout(res, 3000));
    const s = await (await fetch(job.status_url, { headers })).json();
    if (s.status === 'COMPLETED') break;
    if (s.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(s.status)) throw new Error(`fal ${model}: ${JSON.stringify(s).slice(0, 300)}`);
    if (Date.now() - start > timeoutMs) throw new Error(`fal ${model}: timed out`);
  }
  const out = await fetch(job.response_url, { headers });
  const body = await out.json();
  if (!out.ok || body.detail) throw new Error(`fal ${model}: ${JSON.stringify(body).slice(0, 400)}`);
  usage.requests.push(model);
  return body;
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

const dataUri = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

module.exports = { call, download, dataUri, usage };
