import { eventSettings, validateEventSettings } from './event-settings.mjs';
import { providerChoices, eventLocation, recordedFormat, bookingMeetingUrl } from './meeting-formats.mjs';
// Narrow, server-authenticated operations for the shared scheduling workspace.
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function managementRoute(route) {
  return ['GET /api/public/formats', 'GET /api/public/bookings', 'GET /api/public/schedules', 'POST /api/public/schedules', 'POST /api/public/event-types'].includes(route)
    || /^GET \/api\/public\/event-types\/\d+$/.test(route)
    || /^PATCH \/api\/public\/event-types\/\d+$/.test(route)
    || /^POST \/api\/public\/bookings\/[A-Za-z0-9_-]{1,100}\/(cancel|reschedule)$/.test(route);
}
export async function manage(request, env, fetcher, session, c) {
  const { cal, account, eventTypes, selectedType, publicType, json, text, timezone, hash, limit, readJson, BookingError } = c;
  const url = new URL(request.url), path = url.pathname.slice('/api/public'.length);
  const fail = message => { throw new BookingError(message); };
  const scheduleView = s => ({ id: s.id, name: text(s.name, 100), timeZone: s.timeZone, isDefault: !!s.isDefault, availability: s.availability || [], overrides: s.overrides || [] });
  const schedules = async () => {
    const data = await cal(env, fetcher, '/schedules', '2024-06-11');
    if (!Array.isArray(data)) throw new BookingError('Availability schedules could not be loaded.', 502);
    return data;
  };
  const bookingView = b => ({ reference: b.uid, title: text(b.title, 160), start: b.start, end: b.end, status: b.status, eventTypeId: b.eventTypeId || b.eventType?.id,
    format: recordedFormat(b), meetingUrl: bookingMeetingUrl(b), participants: (b.attendees || []).map(a => text(a.name, 100)).filter(Boolean), cancellationReason: text(b.cancellationReason, 500), rescheduledTo: !!b.rescheduledToUid });
  await account(env, fetcher);
  if (request.method === 'GET') {
    if (/^\/event-types\/\d+$/.test(path)) {
      const event = await selectedType(env, fetcher, Number(path.split('/').at(-1)));
      return json({ event: { ...publicType(event), slug: text(event.slug, 100), settings: eventSettings(event) } });
    }
    if (path === '/formats') return json({ formats: providerChoices(await cal(env, fetcher, '/conferencing', '2024-06-11')) });
    if (path === '/schedules') return json({ schedules: (await schedules()).map(scheduleView) });
    const status = url.searchParams.get('status') || 'upcoming';
    if (!['upcoming', 'past', 'cancelled', 'unconfirmed'].includes(status)) fail('Choose a valid booking status.');
    const events = await eventTypes(env, fetcher), ids = new Set(events.map(e => e.id));
    if (!ids.size) return json({ bookings: [], nextCursor: null });
    const params = new URLSearchParams({ status, limit: '25', eventTypeIds: [...ids].join(',') });
    const cursor = url.searchParams.get('cursor');
    if (cursor) { if (cursor.length > 2048) fail('Invalid page cursor.'); params.set('cursor', cursor); }
    const result = await cal(env, fetcher, '/bookings?' + params, '2026-05-01', undefined, 'GET', true);
    if (!Array.isArray(result.data)) throw new BookingError('Bookings could not be loaded.', 502);
    return json({ bookings: result.data.filter(b => ids.has(b.eventTypeId || b.eventType?.id)).map(bookingView), nextCursor: result.pagination?.hasMore ? result.pagination.nextCursor || null : null });
  }
  const body = await readJson(request);
  if (!body || Array.isArray(body) || typeof body !== 'object') fail('Invalid request details.');
  const id = request.headers.get('Idempotency-Key');
  if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('An operation request ID is required.');
  const key = await hash(session + ':' + id, env), fingerprint = await hash(request.method + ':' + path + ':' + JSON.stringify(body), env);
  const previous = await env.DB.prepare('SELECT fingerprint, response, http_status FROM public_booking_requests WHERE id = ?').bind(key).first();
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new BookingError('This request ID has already been used for different details.', 409);
    return previous.response ? json(JSON.parse(previous.response), previous.http_status) : json({ uncertain: true, error: 'This change is already processing. Refresh the relevant list before trying again.' }, 409);
  }
  let upstreamPath = path, version, payload, view;
  if (path === '/schedules') {
    const name = text(body.name, 100), timeZone = timezone(body.timeZone);
    if (!name || !Array.isArray(body.days) || !body.days.length || body.days.some(d => !DAYS.includes(d))) fail('Enter a schedule name and select at least one weekday.');
    const clock = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (!clock(body.startTime) || !clock(body.endTime) || body.startTime >= body.endTime) fail('End time must be later than start time on the same day.');
    const overrides = body.overrides || [];
    if (!Array.isArray(overrides) || overrides.length > 30) fail('Use at most 30 date overrides.');
    for (const o of overrides) {
      if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(o.date || '') || !Number.isFinite(Date.parse(o.date)) || new Date(o.date).toISOString().slice(0, 10) !== o.date || !clock(o.startTime) || !clock(o.endTime) || o.startTime >= o.endTime) fail('Check the date and times in each override.');
    }
    payload = { name, timeZone, isDefault: false, availability: [{ days: [...new Set(body.days)], startTime: body.startTime, endTime: body.endTime }], overrides: overrides.map(o => ({ date: o.date, startTime: o.startTime, endTime: o.endTime })) };
    version = '2024-06-11'; view = s => ({ schedule: scheduleView(s) });
  } else if (path.startsWith('/event-types')) {
    if (request.method === 'PATCH') await selectedType(env, fetcher, Number(path.split('/').at(-1)));
    const title = text(body.title, 160), description = text(body.description, 500), lengthInMinutes = Number(body.duration), scheduleId = Number(body.scheduleId);
    if (!title || !Number.isSafeInteger(lengthInMinutes) || lengthInMinutes < 5 || lengthInMinutes > 480) fail('Enter an event title and a duration between 5 and 480 minutes.');
    if (!(await schedules()).some(s => s.id === scheduleId)) fail('Choose an availability schedule belonging to this workspace.');
    payload = { title, description, lengthInMinutes, scheduleId };
    try { Object.assign(payload, validateEventSettings(body.settings)); } catch (error) { fail(error.message); }
    if (request.method === 'POST' || body.slug !== undefined) {
      const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
      if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug) || slug.length > 100) fail('Use a URL slug with lowercase letters, numbers, hyphens, or underscores.');
      payload.slug = slug;
    }
    if (request.method === 'POST' || body.formatId) {
      const choices = providerChoices(await cal(env, fetcher, '/conferencing', '2024-06-11'));
      try { payload.locations = [eventLocation(body.formatId, body.formatDetail, choices)]; } catch (error) { fail(error.message); }
    }
    if (request.method === 'POST') {
      if (env.CAL_EVENT_TYPE_IDS) fail('Event creation is disabled while an event ID allowlist is configured. Contact the dashboard owner.');
      payload.hidden = false;
      payload.bookingRequiresAuthentication = false;
      payload.requiresBookerEmailVerification = false;
      payload.bookingFields = [{ field: 'guests', slug: 'guests', required: false, hidden: true }];
    }
    version = '2026-06-12'; view = e => ({ event: publicType(e) });
  } else {
    const [, , uid, action] = path.split('/');
    const existing = await cal(env, fetcher, '/bookings/' + uid, '2026-02-25');
    await selectedType(env, fetcher, existing.eventTypeId || existing.eventType?.id);
    if (!['accepted', 'pending'].includes(existing.status) || Date.parse(existing.end) <= Date.now()) fail('Only upcoming active bookings can be changed. Refresh the list for the latest status.');
    if (body.confirmed !== true) fail('Confirm that the participants agreed to this change.');
    if (action === 'cancel') payload = { cancellationReason: text(body.reason, 500) || 'Cancelled from MeetingSchedule' };
    else {
      const start = new Date(body.start);
      if (!Number.isFinite(+start) || +start <= Date.now() || +start > Date.now() + 366 * 86400000) fail('Choose a future time within the next year.');
      payload = { start: start.toISOString(), reschedulingReason: text(body.reason, 500) || 'Rescheduled from MeetingSchedule' };
    }
    version = '2026-02-25'; view = b => ({ booking: bookingView(b) });
  }
  await limit(request, env, 'manage');
  const claimed = await env.DB.prepare('INSERT INTO public_booking_requests (id, fingerprint, state, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(key, fingerprint, 'pending', Date.now() + 7 * 86400000).first();
  if (!claimed) return json({ uncertain: true, error: 'This change is already processing. Refresh before trying again.' }, 409);
  let result, status = 200;
  try { result = view(await cal(env, fetcher, upstreamPath, version, payload, request.method)); }
  catch (error) {
    const uncertain = !(error instanceof BookingError) || error.status >= 500;
    status = uncertain ? 409 : error.status;
    result = { uncertain, error: uncertain ? 'The change could not be confirmed. Refresh the relevant list before making another change.' : error.message };
  }
  await env.DB.prepare('UPDATE public_booking_requests SET state = ?, response = ?, http_status = ? WHERE id = ?').bind(result.error ? result.uncertain ? 'uncertain' : 'rejected' : 'done', JSON.stringify(result), status, key).run();
  return json(result, status);
}
