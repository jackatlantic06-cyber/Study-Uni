// Minimal Claude call for the dashboard (Vercel). Same model and structured
// output style as the marketing jobs.
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;

const MODEL = process.env.MARKETING_MODEL || 'claude-sonnet-5-5';
let client = null;

async function askJson({ system, prompt, schema, effort = 'low', maxTokens = 4000 }) {
  const apiKey = process.env.MARKETING_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key on the server');
  if (!client) client = new Anthropic({ apiKey, maxRetries: 2 });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

module.exports = { askJson };
