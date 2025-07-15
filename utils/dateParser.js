const chrono = require('chrono-node');
const { format, addHours } = require('date-fns');
const { toZonedTime, fromZonedTime } = require('date-fns-tz');

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
  console.log(date, timezone);
  const zonedDate = toZonedTime(date, timezone);
  
  return {
    iso: fromZonedTime(zonedDate, timezone).toISOString(),
    local: format(zonedDate, 'yyyy-MM-dd HH:mm'),
    timezone
  };
}

function validateFutureDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Invalid date object');
  }

  const now = new Date();

  if (date <= now) {
    throw new Error('Date must be in the future');
  }

  return date;
}

module.exports = {
  parseNaturalDate,
  validateFutureDate
};