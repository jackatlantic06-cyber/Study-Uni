const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const STUDY_TIPS = [
  'The most effective way to use exam papers is the active feedback loop: complete practice questions under timed conditions, grade them using the official marking scheme, and identify knowledge gaps. This shifts your study from passive reading to the exact format required to pass.',
  'Instead of doing a full paper right away, tackle it section by section. Answer a single question from memory, immediately check the marking scheme, learn from your errors, and correct your notes. This builds instant, deep understanding of high-yield topics.',
  'Once you are familiar with the content, simulate actual exam conditions. Clear your desk, set a timer for the allotted marks (e.g., 1.5 minutes per mark), and write without checking your notes. This trains your brain to manage time and perform under stress.',
  'The marking scheme reveals exactly what examiners want. After attempting a paper, note the specific phrasing the examiner is looking for, understand the math where you lost marks, and identify common traps that lose students marks.',
  'For complex subjects, do an initial "open-book" pass. Use your notes to answer the exam questions. This familiarises you with how questions are worded and teaches you to apply your knowledge, rather than just memorising facts.',
  'Instead of repeatedly reviewing the same topic, rotate through different past papers on a staggered schedule. Spaced repetition builds much stronger long-term retention than cramming the same material repeatedly.',
];

module.exports = async (req, res) => {
  // Accept Vercel cron calls or direct POST with secret
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasCronSecret = process.env.CRON_SECRET && req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  if (!isVercelCron && !hasCronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 10000 });
    if (!users || users.length === 0) return res.status(200).json({ sent: 0 });

    const { data: subs } = await sb.from('subscriptions')
      .select('id, is_active, current_period_end')
      .eq('is_active', true);

    const proIds = new Set((subs || [])
      .filter(s => !s.current_period_end || new Date(s.current_period_end) > new Date())
      .map(s => s.id));

    const owners  = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    const proMail = (process.env.PRO_EMAILS   || '').split(',').map(e => e.trim()).filter(Boolean);

    let weeklyAttempts = {};
    try {
      const { data: attempts } = await sb.from('quiz_attempts')
        .select('user_id, module_code, topic, score, total, pct, created_at')
        .gt('created_at', weekAgo);
      (attempts || []).forEach(a => {
        if (!weeklyAttempts[a.user_id]) weeklyAttempts[a.user_id] = [];
        weeklyAttempts[a.user_id].push(a);
      });
    } catch (_) {}

    let sent = 0;
    const tip = STUDY_TIPS[new Date().getDate() % STUDY_TIPS.length];

    for (const user of users) {
      if (!user.email) continue;
      const isPro = proIds.has(user.id) || owners.includes(user.email) || proMail.includes(user.email);
      const firstName = user.user_metadata?.first_name || user.email.split('@')[0];

      try {
        const from = process.env.RESEND_FROM || 'Study-Uni <onboarding@resend.dev>';
        if (isPro) {
          const attempts = weeklyAttempts[user.id] || [];
          await resend.emails.send({
            from,
            to: user.email,
            subject: attempts.length > 0 ? 'Your Study-Uni weekly recap 🏆' : 'Study tip of the week 📚',
            html: proWeeklyHTML(firstName, attempts, tip),
          });
        } else {
          await resend.emails.send({
            from,
            to: user.email,
            subject: 'Unlock Pro this week — marking schemes & quizzes 📖',
            html: freeWeeklyHTML(firstName),
          });
        }
        sent++;
        await new Promise(r => setTimeout(r, 60)); // ~16/sec, well within Resend limits
      } catch (e) {
        console.error(`Email failed for ${user.email}:`, e.message);
      }
    }

    return res.status(200).json({ sent });
  } catch (err) {
    console.error('weekly-email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function proWeeklyHTML(name, attempts, tip) {
  let quizSection = '';
  if (attempts.length > 0) {
    const avgPct = Math.round(attempts.reduce((s, a) => s + a.pct, 0) / attempts.length);
    const best   = attempts.reduce((b, a) => a.pct > b.pct ? a : b, attempts[0]);
    const rows   = attempts.slice(0, 5).map(a =>
      `<tr>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f1f5f9">${a.module_code}</td>
        <td style="padding:8px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9">${(a.topic||'').split(':')[0].trim()}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:700;text-align:right;border-bottom:1px solid #f1f5f9;color:${a.pct>=80?'#16a34a':a.pct>=60?'#d97706':'#dc2626'}">${a.score}/${a.total} (${a.pct}%)</td>
      </tr>`
    ).join('');
    const lowNote = avgPct < 70
      ? `<p style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;font-size:13px;color:#92400e;margin:0 0 16px">
           <strong>Areas to focus on:</strong> Your scores suggest some topics need more practice. Try the Question-by-Question Method — tackle one question from memory, check the marking scheme immediately, then correct your notes before moving on.
         </p>`
      : '';
    quizSection = `
      <div style="background:#f8fafc;border-radius:10px;padding:16px 20px;margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">📊 This week's quizzes</div>
        <div style="display:flex;gap:20px;margin-bottom:14px">
          <div style="text-align:center"><div style="font-size:30px;font-weight:800;color:#2563eb">${avgPct}%</div><div style="font-size:11px;color:#64748b">avg score</div></div>
          <div style="text-align:center"><div style="font-size:30px;font-weight:800;color:#0f172a">${attempts.length}</div><div style="font-size:11px;color:#64748b">quizzes</div></div>
          <div style="text-align:center"><div style="font-size:30px;font-weight:800;color:#16a34a">${best.pct}%</div><div style="font-size:11px;color:#64748b">best</div></div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#e2e8f0">
            <th style="padding:7px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Module</th>
            <th style="padding:7px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Topic</th>
            <th style="padding:7px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Score</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${lowNote}`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:20px;background:#f8fafc;font-family:Inter,Arial,sans-serif">
<div style="max-width:540px;margin:0 auto">
  <div style="background:#2563eb;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;font-size:20px;font-weight:800;margin:0">Weekly Recap 🏆</h1>
    <p style="color:rgba(255,255,255,.75);font-size:12px;margin:5px 0 0">Study-Uni Pro</p>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
    <p style="font-size:15px;font-weight:600;margin:0 0 16px">Hi ${name},</p>
    ${quizSection}
    <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-bottom:18px">
      <div style="font-size:12px;font-weight:700;color:#15803d;margin-bottom:6px">💡 Study Technique of the Week</div>
      <p style="font-size:13px;color:#166534;line-height:1.65;margin:0">${tip}</p>
    </div>
    <a href="https://study-uni.ie" style="display:block;background:#2563eb;color:#fff;text-align:center;padding:13px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none">Continue studying →</a>
  </div>
  <p style="font-size:11px;color:#94a3b8;text-align:center;margin:10px 0 0">Study-Uni · UCC Students Only</p>
</div>
</body></html>`;
}

function freeWeeklyHTML(name) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:20px;background:#f8fafc;font-family:Inter,Arial,sans-serif">
<div style="max-width:540px;margin:0 auto">
  <div style="background:#0f172a;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;font-size:20px;font-weight:800;margin:0">Your weekly update 📚</h1>
    <p style="color:rgba(255,255,255,.55);font-size:12px;margin:5px 0 0">Study-Uni</p>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
    <p style="font-size:15px;font-weight:600;margin:0 0 8px">Hi ${name},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px">You have access to every UCC past exam paper — but top students are using <strong>Pro</strong> to prepare smarter:</p>
    <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:18px">
      <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px">⚡ What Pro students get:</div>
      <ul style="margin:0;padding-left:18px;color:#1e3a8a;font-size:14px;line-height:2">
        <li>Official marking schemes — see exactly what earns marks</li>
        <li>MCQ practice quizzes with detailed explanations</li>
        <li>StudyAI — generate flashcards from lecture notes &amp; PDFs</li>
        <li>Weekly performance reports with your quiz scores</li>
      </ul>
    </div>
    <a href="https://study-uni.ie/#pricing" style="display:block;background:#2563eb;color:#fff;text-align:center;padding:13px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;margin-bottom:10px">Upgrade to Pro — €4.99/mo →</a>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0">Cancel anytime · Study-Uni · UCC Students Only</p>
  </div>
</div>
</body></html>`;
}
