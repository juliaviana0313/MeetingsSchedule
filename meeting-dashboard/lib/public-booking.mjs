import { seal, unseal } from './secure-session.mjs';
import { manage, managementRoute } from './shared-management.mjs';
import { eventFormats, bookingLocation, providerChoices } from './meeting-formats.mjs';
import { MEETING_RECIPIENT } from './meeting-recipient.mjs';

const ROOT = 'https://api.cal.com/v2';
const COOKIE = '__Host-ms-visitor';
const encoder = new TextEncoder();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
class BookingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const cookieValue = request => (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
const configured = env => !!(env.CAL_API_KEY && env.CAL_ACCOUNT_EMAIL && env.CAL_SESSION_SECRET?.length >= 32 && env.DB);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) ? value.toLowerCase() : null;
const safeUrl = value => typeof value === 'string' && /^https:\/\//i.test(value) ? value : null;
function text(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function timezone(value) {
  if (typeof value !== 'string' || value.length > 100) throw new BookingError('Choose a valid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; }
  catch { throw new BookingError('Choose a valid time zone.'); }
}
async function hash(value, env) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.CAL_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function limit(request, env, kind, participantEmails = []) {
  const now = Date.now(), ip = request.headers.get('cf-connecting-ip') || 'local';
  const period = kind === 'read' ? 60000 : 3600000;
  const specs = [[`${kind}:ip:${ip}`, kind === 'book' ? 5 : kind === 'manage' ? 20 : 90], [`${kind}:global`, kind === 'read' ? 1000 : 100], ...participantEmails.map(e => [`book:email:${e}`, 5])];
  for (const [identity, maximum] of specs) {
    const id = 'public:' + await hash(`${identity}:${Math.floor(now / period)}`, env);
    const row = await env.DB.prepare('INSERT INTO email_auth_limits (id, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count').bind(id, now + period).first();
    if (!row || row.count > maximum) throw new BookingError('Too many requests. Please try again later.', 429);
  }
}
async function cal(env, fetcher, path, version, body, method = body ? 'POST' : 'GET', envelope = false) {
  let response;
  try {
    response = await fetcher(ROOT + path, {
      method,
      headers: { Authorization: `Bearer ${env.CAL_API_KEY}`, 'cal-api-version': version, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
  } catch { throw new BookingError('The scheduling service could not be reached.', 502); }
  if (response.status >= 300 && response.status < 400) throw new BookingError('The scheduling service returned an unexpected redirect.', 502);
  if (!response.ok) {
    if (response.status === 429) throw new BookingError('The scheduling service is busy. Please try again later.', 429);
    if ([401, 403].includes(response.status)) throw new BookingError('The organizer’s scheduling connection needs attention.', 503);
    if ([400, 404, 409, 422].includes(response.status)) throw new BookingError('This time or meeting type is no longer available, or its booking requirements could not be met. Choose another time or contact the organizer.', 400);
    throw new BookingError('The scheduling service is temporarily unavailable.', 502);
  }
  const result = await response.json().catch(() => null);
  if (!result?.data) throw new BookingError('The scheduling service returned an unreadable response.', 502);
  return envelope ? result : result.data;
}
async function account(env, fetcher) {
  const me = await cal(env, fetcher, '/me', '2024-06-11');
  if (typeof me.email !== 'string' || me.email.toLowerCase() !== env.CAL_ACCOUNT_EMAIL.trim().toLowerCase())
    throw new BookingError('The organizer’s scheduling account does not match its configuration.', 503);
  return me;
}
function eligible(event) {
  const extraRequired = (event.bookingFields || []).some(f => f.required && !['name', 'email', 'guests', 'notes', 'title', 'location'].includes(f.slug || f.field));
  return Number.isSafeInteger(event.id) && event.id > 0 && !event.hidden && !event.disableGuests && !event.bookingRequiresAuthentication && !event.requiresBookerEmailVerification && !event.requiresEmailVerification && !(event.price > 0) && !event.seatsPerTimeSlot && !(event.recurrence && !event.recurrence.disabled) && !extraRequired;
}
async function eventTypes(env, fetcher) {
  const data = await cal(env, fetcher, '/event-types', '2026-06-12');
  if (!Array.isArray(data)) throw new BookingError('Meeting types could not be loaded.', 502);
  const allow = env.CAL_EVENT_TYPE_IDS ? new Set(env.CAL_EVENT_TYPE_IDS.split(',').map(x => Number(x.trim()))) : null;
  return data.filter(e => eligible(e) && (!allow || allow.has(e.id)));
}
const publicType = e => ({ id: e.id, title: text(e.title, 160), duration: e.lengthInMinutes, description: text(e.description, 500), scheduleId: e.scheduleId || null, formats: eventFormats(e) });
async function selectedType(env, fetcher, id) {
  const event = (await eventTypes(env, fetcher)).find(e => e.id === id);
  if (!event) throw new BookingError('This meeting type is not available for public booking.', 400);
  return event;
}
function validate(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new BookingError('Invalid booking details.');
  const eventTypeId = Number(body.eventTypeId), start = new Date(body.start);
  const first = { name: text(body.first?.name, 100), email: email(typeof body.first?.email === 'string' ? body.first.email.trim() : null) };
  const second = { ...MEETING_RECIPIENT };
  if (!first.name || !first.email) throw new BookingError('Enter your name and a valid email address.');
  if (first.email === second.email) throw new BookingError('Enter your own email address, different from Travis’s invitation address.');
  if (!Number.isSafeInteger(eventTypeId) || eventTypeId <= 0 || !Number.isFinite(start.getTime()) || start.getTime() <= Date.now() || start.getTime() > Date.now() + 366 * 86400000) throw new BookingError('Choose a valid meeting type and future time within the next year.');
  if (body.agreed !== true) throw new BookingError('Confirm that you agree to receive the meeting invitation.');
  if (typeof body.formatId !== 'string' || !body.formatId || body.formatId.length > 100) throw new BookingError('Choose a meeting format before booking.');
  return { formatId: body.formatId, formatDetail: text(body.formatDetail, 500), eventTypeId, start: start.toISOString(), timeZone: timezone(body.timeZone), first, second, notes: text(body.notes, 1000) };
}
async function visitor(request, env) { return unseal(cookieValue(request) || '', env.CAL_SESSION_SECRET, 'public-booking'); }
const requestId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) ? value : null;

async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new BookingError('Use JSON booking data.', 415);
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new BookingError('Request too large.', 413);
  // Bound the streamed body as well as Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new BookingError('Booking details are required.');
  let bytes = 0, raw = ''; const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 8192) { await reader.cancel(); throw new BookingError('Request too large.', 413); } raw += decoder.decode(value, { stream: true }); }
  raw += decoder.decode();
  return JSON.parse(raw);
}

export async function publicBookingGateway(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  // Old authenticated endpoints must never become a public proxy to the service account.
  if (url.pathname.startsWith('/api/cal/') || url.pathname.startsWith('/api/auth/')) return json({ error: 'This endpoint is not available.' }, 404);
  if (!url.pathname.startsWith('/api/public/')) return null;
  const route = request.method + ' ' + url.pathname;
  if (!['GET /api/public/config', 'GET /api/public/slots', 'POST /api/public/bookings', 'GET /api/public/receipt'].includes(route) && !managementRoute(route)) return json({ error: 'This endpoint is not available.' }, 404);
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== url.origin) return json({ error: 'Request origin rejected.' }, 403);
  if (!configured(env)) return json({ ready: false, error: 'Booking is not available yet. The organizer needs to finish connecting the scheduling service.' }, 503);
  try {
    await limit(request, env, 'read');
    if (route === 'GET /api/public/receipt') {
      const session = await visitor(request, env), id = requestId(url.searchParams.get('requestId'));
      if (!session || !id) return json({ error: 'Booking receipt not found.' }, 404);
      const row = await env.DB.prepare('SELECT state, response, http_status FROM public_booking_requests WHERE id = ? AND expires_at > ?').bind(await hash(session + ':' + id, env), Date.now()).first();
      if (!row) return json({ error: 'Booking receipt not found.' }, 404);
      if (row.response) return json(JSON.parse(row.response), row.http_status);
      return json({ uncertain: true, error: 'The booking may still be processing. Check the participants’ email or contact the organizer before creating another booking.' }, 409);
    }
    if (route === 'GET /api/public/config') {
      await account(env, fetcher);
      const events = await eventTypes(env, fetcher);
      const session = await visitor(request, env) || crypto.randomUUID();
      const sealed = await seal({ token: session, userId: 'public-booking', expires: Date.now() + 86400000 }, env.CAL_SESSION_SECRET);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM public_booking_requests WHERE expires_at < ?').bind(Date.now()),
        env.DB.prepare('DELETE FROM email_auth_limits WHERE expires_at < ?').bind(Date.now() - 86400000),
      ]);
      return json({ ready: true, organizerEmail: env.CAL_ACCOUNT_EMAIL, events: events.map(publicType) }, 200, { 'Set-Cookie': `${COOKIE}=${sealed}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` });
    }
    const session = await visitor(request, env);
    if (!session) throw new BookingError('Please reload the booking page to continue.', 401);
    if (managementRoute(route)) return await manage(request, env, fetcher, session, { cal, account, eventTypes, selectedType, publicType, json, text, timezone, hash, limit, readJson, BookingError });
    if (route === 'GET /api/public/slots') {
      await account(env, fetcher);
      const event = await selectedType(env, fetcher, Number(url.searchParams.get('eventTypeId')));
      const date = url.searchParams.get('date'), tz = timezone(url.searchParams.get('timeZone'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new BookingError('Choose a valid date.');
      const day = new Date(date + 'T00:00:00Z');
      if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date || day.getTime() < Date.now() - 2 * 86400000 || day.getTime() > Date.now() + 366 * 86400000) throw new BookingError('Choose a date within the next year.');
      const params = new URLSearchParams({ eventTypeId: String(event.id), timeZone: tz, start: new Date(+day - 86400000).toISOString(), end: new Date(+day + 2 * 86400000).toISOString() });
      const data = await cal(env, fetcher, '/slots?' + params, '2024-09-04');
      const slots = [...new Set(Object.values(data).flat().map(x => typeof x === 'string' ? x : x?.start).filter(x => {
        if (typeof x !== 'string' || !Number.isFinite(Date.parse(x)) || Date.parse(x) <= Date.now()) return false;
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x)) === date;
      }))].sort();
      return json({ slots });
    }
    const booking = validate(await readJson(request));
    const id = requestId(request.headers.get('Idempotency-Key'));
    if (!id) throw new BookingError('A booking request ID is required.');
    const key = await hash(session + ':' + id, env), fingerprint = await hash(JSON.stringify(booking), env);
    const previous = await env.DB.prepare('SELECT fingerprint, response, http_status FROM public_booking_requests WHERE id = ?').bind(key).first();
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BookingError('This request ID has already been used for different details.', 409);
      return previous.response ? json(JSON.parse(previous.response), previous.http_status) : json({ uncertain: true, error: 'This booking is already processing. Check the participants’ email before booking again.' }, 409);
    }
    await limit(request, env, 'book', [booking.first.email]);
    await account(env, fetcher);
    const event = await selectedType(env, fetcher, booking.eventTypeId);
    let chosen;
    try { chosen = bookingLocation(event, booking.formatId, booking.formatDetail); } catch (error) { throw new BookingError(error.message); }
    if (['integration:google-meet', 'integration:zoom', 'integration:office365-video'].includes(booking.formatId)) {
      const apps = await cal(env, fetcher, '/conferencing', '2024-06-11');
      if (!providerChoices(apps).some(p => p.id === booking.formatId && p.available)) throw new BookingError('This conferencing provider is not connected. Ask the organizer to reconnect it or choose another format.');
    }
    const claimed = await env.DB.prepare('INSERT INTO public_booking_requests (id, fingerprint, state, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(key, fingerprint, 'pending', Date.now() + 7 * 86400000).first();
    if (!claimed) return json({ uncertain: true, error: 'This booking is already processing. Check its status before trying again.' }, 409);
    let result, status = 200;
    try {
      const data = await cal(env, fetcher, '/bookings', '2026-02-25', {
        eventTypeId: event.id, start: booking.start,
        attendee: { ...booking.first, timeZone: booking.timeZone, language: 'en' },
        guests: [booking.second.email],
        location: chosen.location,
        bookingFieldsResponses: {
          ...((event.bookingFields || []).some(f => (f.slug || f.field) === 'title') ? { title: `Meeting between ${booking.first.name} and ${booking.second.name}` } : {}),
          notes: `Meeting between ${booking.first.name} and ${booking.second.name}.\n${booking.notes}`,
        },
        metadata: { source: 'MeetingSchedule public booking', requestId: id, meetingFormat: chosen.format.label, meetingFormatId: chosen.format.id },
      });
      if (typeof data.uid !== 'string' || !Number.isFinite(Date.parse(data.start)) || !Number.isFinite(Date.parse(data.end))) throw new BookingError('The booking response could not be confirmed.', 502);
      result = { receipt: { reference: data.uid, title: text(data.title || event.title, 160), start: data.start, end: data.end, timeZone: booking.timeZone, status: data.status === 'accepted' ? 'accepted' : 'pending', format: chosen.format.label, location: text(data.location, 500), participants: [booking.first.name, booking.second.name], meetingUrl: (chosen.location.type === 'integration' || chosen.location.type === 'link') ? safeUrl(data.meetingUrl || data.location) : null } };
    } catch (error) {
      // Timeouts/5xx can follow a successful upstream write. Never automatically resend.
      const uncertain = !(error instanceof BookingError) || error.status >= 500;
      status = uncertain ? 409 : error.status;
      result = { uncertain, error: uncertain ? 'The booking result could not be confirmed. Check both participants’ email or contact the organizer before booking again.' : error.message };
    }
    await env.DB.prepare('UPDATE public_booking_requests SET state = ?, response = ?, http_status = ? WHERE id = ?').bind(result.receipt ? 'done' : result.uncertain ? 'uncertain' : 'rejected', JSON.stringify(result), status, key).run();
    return json(result, status);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid booking data.' }, 400);
    if (error instanceof BookingError) return json({ error: error.message }, error.status);
    return json({ error: 'Booking is temporarily unavailable. Please contact the organizer.' }, 503);
  }
}
