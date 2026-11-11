const integrations = { 'cal-video': 'Cal Video', 'google-meet': 'Google Meet', zoom: 'Zoom', 'office365-video': 'Microsoft Teams', 'whereby-video': 'Whereby', 'jitsi': 'Jitsi Meet' };
const fixed = { address: 'In person', link: 'Other video / meeting link', phone: 'Phone call', attendeeAddress: 'In person — your address', attendeePhone: 'Phone call — your number', attendeeDefined: 'Other — specify location' };
export function eventFormats(event) {
  const formats = [];
  for (const location of event.locations || []) {
    const integration = location.type === 'integration' && typeof location.integration === 'string' ? location.integration : null;
    const id = integration ? 'integration:' + integration : location.type;
    const label = integration ? integrations[integration] || integration.replaceAll('-', ' ') : fixed[location.type];
    if (!label || formats.some(f => f.id === id)) continue;
    formats.push({ id, label, input: ({ attendeeAddress: 'address', attendeePhone: 'phone', attendeeDefined: 'location' })[location.type] || null });
  }
  return formats;
}
export function bookingLocation(event, id, detail) {
  const format = eventFormats(event).find(f => f.id === id);
  if (!format) throw new Error('Choose a meeting format offered by this event. Refresh if its formats have changed.');
  const location = id.startsWith('integration:') ? { type: 'integration', integration: id.slice(12) } : { type: id };
  if (format.input) {
    const value = typeof detail === 'string' ? detail.trim() : '';
    if (!value || value.length > 500) throw new Error('Enter the details required for this meeting format.');
    if (format.input === 'phone' && !/^\+[1-9]\d{6,14}$/.test(value)) throw new Error('Enter a phone number with its country code, such as +12025550123.');
    location[format.input] = value;
  }
  return { format, location };
}
export function providerChoices(apps) {
  const valid = new Set((apps || []).filter(a => a.invalid !== true).map(a => a.type));
  return [
    { id: 'integration:cal-video', label: 'Cal Video', available: true },
    { id: 'integration:google-meet', label: 'Google Meet', available: valid.has('google_video') },
    { id: 'integration:zoom', label: 'Zoom', available: valid.has('zoom_video') },
    { id: 'integration:office365-video', label: 'Microsoft Teams', available: valid.has('office365_video') },
    { id: 'link', label: fixed.link, available: true },
    { id: 'address', label: fixed.address, available: true },
    { id: 'phone', label: fixed.phone, available: true },
  ];
}
export function eventLocation(id, detail, choices) {
  if (!choices.some(c => c.id === id && c.available)) throw new Error('Choose an available meeting format. Connect the conferencing provider to the organizer account first.');
  if (id.startsWith('integration:')) return { type: 'integration', integration: id.slice(12) };
  const value = typeof detail === 'string' ? detail.trim() : '';
  if (!value || value.length > 500) throw new Error('Enter a meeting link, address, or phone number for the selected format.');
  if (id === 'link') {
    let url; try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS meeting link.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter a valid HTTPS meeting link without embedded credentials.');
  }
  if (id === 'phone' && !/^\+[1-9]\d{6,14}$/.test(value)) throw new Error('Enter a phone number including its country code.');
  return { type: id, [id]: value, public: false };
}
export function recordedFormat(booking) {
  const metadata = booking.metadata || {};
  if (metadata.source === 'MeetingSchedule public booking' && typeof metadata.meetingFormat === 'string') return metadata.meetingFormat.slice(0, 100);
  const value = booking.meetingUrl || booking.location || '';
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'meet.google.com') return 'Google Meet';
    if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'Zoom';
    if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'Microsoft Teams';
    if (host === 'cal.video' || host.endsWith('.cal.video') || host === 'video.cal.com') return 'Cal Video';
    return 'Other video / meeting link';
  } catch { return 'Not recorded'; }
}

// Current APIs return the join URL in location; older responses may use meetingUrl.
export function bookingMeetingUrl(booking) {
  for (const value of [booking.location, booking.meetingUrl]) {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* A phone number, address, or provider identifier is not a link. */ }
  }
  return null;
}
