const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { moduleCode, moduleName, years, accessToken } = req.body || {};
    if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
    if (!moduleCode)  return res.status(400).json({ error: 'moduleCode required' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await sb.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session — please sign in again' });

    const owners    = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    const proEmails = (process.env.PRO_EMAILS   || '').split(',').map(e => e.trim()).filter(Boolean);
    const bypass    = owners.includes(user.email) || proEmails.includes(user.email);

    if (!bypass) {
      const { data: sub } = await sb.from('subscriptions')
        .select('is_active,current_period_end')
        .eq('id', user.id)
        .maybeSingle();
      const isPro = !!(sub && sub.is_active &&
        (!sub.current_period_end || new Date(sub.current_period_end) > new Date()));
      if (!isPro) return res.status(403).json({ error: 'Pro subscription required' });
    }

    const yearList = Array.isArray(years) && years.length
      ? years.join(', ')
      : 'multiple years';

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are an expert exam prediction assistant for UCC (University College Cork), Ireland.

Module: ${moduleName} (${moduleCode})
Past exam papers available for: ${yearList}

Based on standard university curriculum patterns for this module, predict which topics are most likely to appear in the next exam. Be specific to the actual subject matter of this module.

Return ONLY valid JSON in this exact format — no other text:
{"certain":["topic1","topic2","topic3"],"likely":["topic1","topic2","topic3"],"watchlist":["topic1","topic2","topic3"]}

"certain" = appears nearly every year
"likely" = appears frequently
"watchlist" = due a comeback or occasionally appears`
      }]
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid response from AI');
    const data = JSON.parse(match[0]);

    return res.status(200).json(data);
  } catch (err) {
    console.error('predict error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
