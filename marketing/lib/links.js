// Post keys and tracked links.
//
// post_key = <yy>w<ww><t|i><n>, e.g. 26w48t1 = 2026 week 48, TikTok post 1.
// It is the utm_content value, and also the short link study-uni.ie/t/26w48t1
// (vercel.json redirects it to the full UTM link). The short link is what goes
// in captions and on the last frame, because TikTok/Instagram captions are not
// clickable and people can type a short link.
const { isoWeek } = require('./time');

const SITE = 'https://study-uni.ie';
const PLATFORM_LETTER = { tiktok: 't', instagram: 'i' };

function postKey(date, platform, n) {
  const { year, week } = isoWeek(date);
  return `${String(year).slice(2)}w${String(week).padStart(2, '0')}${PLATFORM_LETTER[platform]}${n}`;
}

function trackedLink(platform, campaign, key) {
  const q = new URLSearchParams({ utm_source: platform, utm_medium: 'social', utm_campaign: campaign, utm_content: key });
  return `${SITE}/?${q}`;
}

function shortLink(key) {
  return `study-uni.ie/t/${key}`;
}

module.exports = { SITE, postKey, trackedLink, shortLink };
