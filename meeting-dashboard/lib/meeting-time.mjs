// Calculate offsets at the meeting's instant, including daylight-saving changes.
export function meetingTime(start, end, timeZone) {
  const startDate = new Date(start), endDate = new Date(end);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const endDay = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
  const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const offset = instant => {
    const label = offsetFormat.formatToParts(instant).find(part => part.type === 'timeZoneName').value.replace('GMT', 'UTC');
    return label === 'UTC' ? 'UTC+00:00' : label;
  };
  const firstOffset = offset(startDate), lastOffset = offset(endDate);
  return {
    startLabel: time.format(startDate),
    endLabel: `${date.format(startDate) !== date.format(endDate) ? endDay.format(endDate) + ', ' : ''}${time.format(endDate)}`,
    zoneLabel: `${timeZone} · ${firstOffset}${firstOffset !== lastOffset ? ' → ' + lastOffset : ''}`,
  };
}
