// Thin wrapper around the Anthropic SDK for the marketing jobs.
// Model: claude-sonnet-5-5 (as requested). Server-side refusal fallback is
// enabled so a mis-flagged request is retried on another model instead of
// failing the weekly run.
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;
const { need } = require('./env');

const MODEL = process.env.MARKETING_MODEL || 'claude-sonnet-5-5';
let client = null;
const usage = { input: 0, output: 0, cacheRead: 0, searches: 0, calls: 0 };

function api() {
  if (!client) { need('ANTHROPIC_API_KEY'); client = new Anthropic({ maxRetries: 3 }); }
  return client;
}

function track(msg) {
  const u = msg.usage || {};
  usage.calls++;
  usage.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  usage.cacheRead += u.cache_read_input_tokens || 0;
  usage.output += u.output_tokens || 0;
  usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
}

async function send(params) {
  const msg = await api().beta.messages.stream({
    model: MODEL,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    ...params,
  }).finalMessage();
  track(msg);
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request: ' + JSON.stringify(msg.stop_details || {}));
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens — raise maxTokens');
  return msg;
}

function textOf(msg) {
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

// Returns parsed JSON matching `schema` (structured outputs).
async function askJson({ system, prompt, schema, effort = 'medium', maxTokens = 16000 }) {
  const msg = await send({
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });
  return JSON.parse(textOf(msg));
}

// Free-text answer, optionally with Anthropic's web search tool.
async function askText({ system, prompt, effort = 'medium', maxTokens = 8000, webSearch = null }) {
  const tools = webSearch ? [{
    type: 'web_search_20260209', name: 'web_search', max_uses: webSearch.maxUses || 5,
    ...(webSearch.allowedDomains ? { allowed_domains: webSearch.allowedDomains } : {}),
    ...(webSearch.blockedDomains ? { blocked_domains: webSearch.blockedDomains } : {}),
  }] : undefined;
  const msg = await send({
    max_tokens: maxTokens,
    system,
    output_config: { effort },
    ...(tools ? { tools } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  return textOf(msg);
}

// Rough cost in USD at Sonnet 5.5 list prices ($2 / $10 per M tokens, $0.10 cache reads, $10 per 1k searches).
function costReport() {
  const usd = usage.input * 2e-6 + usage.output * 10e-6 + usage.cacheRead * 0.1e-6 + usage.searches * 0.01;
  return `${usage.calls} Claude calls, ${usage.input} in / ${usage.output} out tokens, ${usage.searches} web searches ≈ $${usd.toFixed(3)}`;
}

module.exports = { MODEL, askJson, askText, costReport };
