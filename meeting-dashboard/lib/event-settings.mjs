const periods = ['day', 'week', 'month', 'year'];
const scalarDefaults = { minimumBookingNotice: 120, beforeEventBuffer: 0, afterEventBuffer: 0, slotInterval: null, offsetStart: 0, onlyShowFirstAvailableSlot: false };
const limitKeys = ['bookingLimitsCount', 'bookingLimitsDuration', 'bookingWindow', 'bookerActiveBookingsLimit'];
// Only scheduling settings are exposed; account data and arbitrary event metadata stay private.
export function eventSettings(event = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(scalarDefaults)) result[key] = event[key] ?? fallback;
  for (const key of limitKeys) {
    const value = event[key];
    if (!value || value.disabled === true) { result[key] = { disabled: true }; continue; }
    const fields = key === 'bookingWindow' ? ['type', 'value', 'rolling'] : key === 'bookerActiveBookingsLimit' ? ['maximumActiveBookings', 'offerReschedule'] : periods;
    result[key] = Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
    if (!Object.keys(result[key]).length) result[key] = { disabled: true };
  }
  return result;
}
export function validateEventSettings(input) {
  if (input === undefined) return {};
  const fail = message => { throw new Error(message); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(input)) fail('Invalid event settings.');
  const integer = (value, min, max, label) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be a whole number between ${min} and ${max}.`);
    return value;
  };
  const boolean = (value, label) => { if (typeof value !== 'boolean') fail(`${label} must be on or off.`); return value; };
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(Object.hasOwn(scalarDefaults, key)) && !limitKeys.includes(key)) fail('Unsupported event setting.');
    if (key === 'onlyShowFirstAvailableSlot') { result[key] = boolean(value, 'First available slot'); continue; }
    if (key === 'slotInterval' && value === null) { result[key] = null; continue; }
    if (Object.hasOwn(scalarDefaults, key)) {
      result[key] = integer(value, key === 'slotInterval' ? 1 : 0, key === 'minimumBookingNotice' ? 525600 : 1440, ({minimumBookingNotice:'Minimum notice',beforeEventBuffer:'Before-event buffer',afterEventBuffer:'After-event buffer',slotInterval:'Slot interval',offsetStart:'Start offset'})[key]); continue;
    }
    if (!object(value)) fail('Invalid booking limit.');
    if (value.disabled === true) { result[key] = { disabled: true }; continue; }
    if (key === 'bookingLimitsCount' || key === 'bookingLimitsDuration') {
      const limits = {};
      for (const period of periods) if (value[period] !== undefined) {
        limits[period] = integer(value[period], key === 'bookingLimitsDuration' ? 15 : 1, 1000000, `Limit per ${period}`);
        if (key === 'bookingLimitsDuration' && limits[period] % 15 !== 0) fail('Duration limits must be multiples of 15 minutes.');
      }
      if (!Object.keys(limits).length) fail('Enter at least one limit, or turn the limit off.');
      result[key] = limits;
    } else if (key === 'bookerActiveBookingsLimit') {
      result[key] = { maximumActiveBookings: integer(value.maximumActiveBookings, 1, 10000, 'Upcoming bookings per person'), offerReschedule: boolean(value.offerReschedule ?? false, 'Offer rescheduling') };
    } else {
      if (!['calendarDays', 'businessDays', 'range'].includes(value.type)) fail('Choose a valid booking window.');
      if (value.type === 'range') {
        const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
        if (!Array.isArray(value.value) || value.value.length !== 2 || !value.value.every(validDate) || value.value[0] > value.value[1]) fail('Choose a valid start and end date for the booking window.');
        result[key] = { type: 'range', value: value.value };
      } else {
        const rolling = boolean(value.rolling ?? false, 'Rolling window');
        result[key] = { type: value.type, value: integer(value.value, 1, rolling ? 61 : 366, 'Booking window days'), rolling };
      }
    }
  }
  return result;
}
