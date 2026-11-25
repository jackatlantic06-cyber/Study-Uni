// Seasonal posting plan (config.json "seasons"): busier in exam season,
// quieter over Christmas, back to the normal (Sunday-learned) mix otherwise.
const config = require('../config.json');
const { dublinDate } = require('./time');

function currentSeason(date = new Date()) {
  const today = dublinDate(date);
  return (config.seasons || []).find(s => today >= s.from && today <= s.to) || null;
}

module.exports = { currentSeason };
