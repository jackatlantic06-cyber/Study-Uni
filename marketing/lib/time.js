// Irish-time helpers. GitHub Actions cron runs in UTC; these keep "Monday
// 06:00" and week numbers correct across summer/winter time.
const TZ = 'Europe/Dublin';

function dublinParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: p.weekday };
}

// ISO-8601 week of the Irish calendar date.
function isoWeek(d = new Date()) {
  const { year, month, day } = dublinParts(d);
  const t = new Date(Date.UTC(year, month - 1, day));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return { year: y, week };
}

function campaign(d = new Date()) {
  const { year, week } = isoWeek(d);
  return `${year}-w${String(week).padStart(2, '0')}`;
}

function dublinDate(d = new Date()) {
  const { year, month, day } = dublinParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

module.exports = { TZ, dublinParts, isoWeek, campaign, dublinDate };
