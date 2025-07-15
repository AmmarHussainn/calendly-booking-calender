const chrono = require('chrono-node');
const { format, addHours } = require('date-fns');
const { utcToZonedTime, zonedTimeToUtc } = require('date-fns-tz');

function parseNaturalDate(input, timezone = 'UTC') {
  const referenceDate = new Date();
  const parsed = chrono.parse(input, referenceDate)[0];
  
  if (!parsed) throw new Error('Invalid date format');
  
  let date = parsed.start.date();
  
  // If no time specified, default to 9 AM
  if (!parsed.start.isCertain('hour')) {
    date.setHours(9, 0, 0, 0);
  }
  
  // Convert to the specified timezone
  const zonedDate = utcToZonedTime(date, timezone);
  
  return {
    iso: zonedTimeToUtc(zonedDate, timezone).toISOString(),
    local: format(zonedDate, 'yyyy-MM-dd HH:mm'),
    timezone
  };
}

module.exports = {
  parseNaturalDate
};