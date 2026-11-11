import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { publicBookingGateway as gateway } from '../lib/public-booking.mjs';
const origin = 'https://site.test';
const future = new Date(Date.now() + 3 * 86400000); future.setUTCHours(12, 0, 0, 0);
const start = future.toISOString(), end = new Date(+future + 1800000).toISOString();
const body = () => ({ eventTypeId: 42, formatId: 'integration:cal-video', start, timeZone: 'UTC', first: { name: 'Person B', email: 'b@example.com' }, notes: 'Discuss plans', agreed: true });
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0000_dizzy_dark_phoenix.sql', '0001_perpetual_pretty_boy.sql']) db.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const DB = { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { return db.prepare(sql).run(...args); } }; }, async batch(statements) { return Promise.all(statements.map(s => s.run())); } };
  const env = { DB, CAL_API_KEY: 'cal_live_server_only_test_key', CAL_ACCOUNT_EMAIL: 'hello@truemarch.fun', CAL_SESSION_SECRET: 'public-booking-test-secret-at-least-32-characters' };
  const calls = [], events = [{ id: 42, title: 'Intro', lengthInMinutes: 30, hidden: false, locations: [{ type: 'integration', integration: 'cal-video' }] }];
  const apps = [];
  const schedules = [{ id: 7, name: 'Working hours', timeZone: 'UTC', availability: [{ days: ['Monday'], startTime: '09:00', endTime: '17:00' }], overrides: [] }];
  const bookings = [{ uid: 'booking-1', title: 'Conversation', eventTypeId: 42, start, end, status: 'accepted', attendees: [{ name: 'B', email: 'PRIVATE_EMAIL' }], hosts: [{ email: 'PRIVATE_HOST' }], metadata: { secret: 'PRIVATE_METADATA' } }];
  let manageMode = 'ok';
  let profileEmail = env.CAL_ACCOUNT_EMAIL, bookingMode = 'ok';
  const fetcher = async (url, options) => {
    calls.push({ url, options }); assert.equal(options.headers.Authorization, 'Bearer ' + env.CAL_API_KEY); assert.equal(options.redirect, 'manual');
    if (url.endsWith('/conferencing')) return Response.json({ data: apps });
    if (url.endsWith('/me')) return Response.json({ data: { email: profileEmail, privateProfile: 'PRIVATE_PROFILE' } });
    if (url.endsWith('/event-types') && options.method === 'GET') return Response.json({ data: events });
    if (url.endsWith('/schedules') && options.method === 'GET') return Response.json({ data: schedules });
    if (url.includes('/bookings?')) return Response.json({ data: bookings, pagination: { hasMore: true, nextCursor: 'next-page' } });
    if (url.endsWith('/bookings/booking-1')) return Response.json({ data: bookings[0] });
    if ((url.includes('/schedules') || url.includes('/event-types') || /bookings\/booking-1\/(cancel|reschedule)$/.test(url)) && options.method !== 'GET') {
      if (manageMode === 'timeout') throw new Error('network');
      if (manageMode === 'reject') return Response.json({ error: { message: 'PRIVATE_ERROR' } }, { status: 400 });
      const payload = JSON.parse(options.body);
      if (url.endsWith('/schedules')) return Response.json({ data: { id: 8, ...payload } });
      if (url.includes('/event-types')) return Response.json({ data: { id: 43, ...payload } });
      return Response.json({ data: { ...bookings[0], status: url.endsWith('/cancel') ? 'cancelled' : 'accepted', cancellationReason: payload.cancellationReason, start: payload.start || start } });
    }
    if (url.includes('/slots?')) return Response.json({ data: { [start.slice(0, 10)]: [{ start }] } });
    if (url.endsWith('/bookings')) {
      if (bookingMode === 'timeout') throw new Error('network');
      if (bookingMode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://bad.test' } });
      if (bookingMode === 'invalid') return Response.json({ private: 'PRIVATE_ERROR' }, { status: 400 });
      return Response.json({ data: { uid: 'private-booking-reference', title: 'Intro', start, end, status: 'accepted', meetingUrl: 'https://meet.example.com/123', hosts: [{ email: 'PRIVATE_HOST' }], internalMetadata: 'PRIVATE_DATA' } });
    }
    throw new Error('Unexpected URL: ' + url);
  };
  const req = (path, payload, cookie, extra = {}) => new Request(origin + path, { method: payload === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...(cookie ? { cookie } : {}), ...extra }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const call = (path, payload, cookie, extra) => gateway(req(path, payload, cookie, extra), env, fetcher);
  const init = async () => { const r = await call('/api/public/config'); assert.equal(r.status, 200, await r.clone().text()); return { cookie: r.headers.get('set-cookie').split(';')[0], data: await r.json() }; };
  const book = (cookie, payload = body(), id = crypto.randomUUID()) => call('/api/public/bookings', payload, cookie, { 'Idempotency-Key': id });
  return { db, env, events, apps, schedules, bookings, setManageMode: v => manageMode = v, calls, fetcher, req, call, init, book, setEmail: v => profileEmail = v, setMode: v => bookingMode = v };
}
test('public startup requires no identity, verifies service account, and returns only public fields', async () => {
  const f = fixture(); f.events[0].secret = 'PRIVATE_EVENT'; const { data, cookie } = await f.init();
  assert.equal(data.ready, true); assert.equal(data.organizerEmail, 'hello@truemarch.fun');
  assert.deepEqual(Object.keys(data.events[0]), ['id', 'title', 'duration', 'description', 'scheduleId', 'formats']);
  assert.ok(cookie.startsWith('__Host-ms-visitor=')); assert.ok(!cookie.includes(f.env.CAL_API_KEY));
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
});
test('missing configuration and wrong service account fail closed', async () => {
  const f = fixture(); assert.equal((await gateway(f.req('/api/public/config'), { ...f.env, CAL_API_KEY: '' }, f.fetcher)).status, 503);
  f.setEmail('someoneelse@example.com'); assert.equal((await f.call('/api/public/config')).status, 503);
  assert.equal(f.calls.filter(x => x.url.endsWith('/event-types')).length, 0);
});
test('legacy account endpoints and unsupported operations stay blocked', async () => {
  const f = fixture();
  for (const path of ['/api/auth/session', '/api/auth/email/request', '/api/cal/session', '/api/cal/me', '/api/cal/bookings', '/api/cal/schedules', '/api/cal/event-types', '/api/cal/bookings/secret/cancel', '/api/public/event-types']) {
    const r = await f.call(path, undefined, undefined, { 'oai-authenticated-user-id': 'owner' }); assert.equal(r.status, 404, path);
  }
  assert.equal(f.calls.length, 0);
});
test('hidden, restricted, paid, seated, and guest-disabled events cannot be booked', async () => {
  const f = fixture();
  for (const setting of [{ hidden: true }, { disableGuests: true }, { price: 10 }, { bookingRequiresAuthentication: true }, { requiresBookerEmailVerification: true }, { seatsPerTimeSlot: 2 }, { recurrence: { disabled: false } }, { bookingFields: [{ slug: 'phone', required: true }] }]) f.events.push({ id: f.events.length + 100, title: 'Restricted', ...setting });
  const { cookie, data } = await f.init(); assert.equal(data.events.length, 1);
  assert.equal((await f.book(cookie, { ...body(), eventTypeId: 101 })).status, 400);
  assert.equal((await f.book(cookie, { ...body(), eventTypeId: 99999 })).status, 400);
  assert.equal(f.calls.some(x => x.url.endsWith('/bookings')), false);
});
test('slots are confined to approved event types, valid dates, and the selected timezone', async () => {
  const f = fixture(), { cookie } = await f.init();
  const r = await f.call('/api/public/slots?' + new URLSearchParams({ eventTypeId: '42', date: start.slice(0, 10), timeZone: 'UTC', username: 'attacker', allowConflicts: 'true' }), undefined, cookie);
  assert.deepEqual((await r.json()).slots, [start]);
  const url = f.calls.at(-1).url; assert.ok(!url.includes('attacker')); assert.ok(!url.includes('allowConflicts'));
  assert.equal((await f.call('/api/public/slots?eventTypeId=42&date=2026-02-31&timeZone=UTC', undefined, cookie)).status, 400);
  assert.equal((await f.call('/api/public/slots?eventTypeId=42&date=' + start.slice(0, 10) + '&timeZone=bad', undefined, cookie)).status, 400);
});
test('required title fields remain bookable and receive a generated participant title', async () => {
  const f = fixture();
  f.events[0].bookingFields = [{ slug: 'email', required: true }, { slug: 'title', field: 'title', required: true }];
  const { cookie, data } = await f.init();
  assert.equal(data.events.length, 1);
  assert.equal((await f.book(cookie)).status, 200);
  const sent = JSON.parse(f.calls.at(-1).options.body);
  assert.equal(sent.bookingFieldsResponses.title, 'Meeting between Person B and Travis Ruiz');
  assert.equal(sent.bookingFieldsResponses.notes, 'Meeting between Person B and Travis Ruiz.\nDiscuss plans');
});
test('booking fixes Travis as recipient and ignores client-supplied recipient and bypass fields', async () => {
  const f = fixture(), { cookie } = await f.init();
  const r = await f.book(cookie, { ...body(), second: { name: 'Wrong recipient', email: 'wrong@example.com' }, allowConflicts: true, skipBookingLimits: true, allowBookingOutOfBounds: true, guests: ['attacker@example.com'], attendee: { email: 'attacker@example.com' }, metadata: { secret: 'bad' } });
  assert.equal(r.status, 200); const data = await r.json();
  const sent = JSON.parse(f.calls.at(-1).options.body);
  assert.equal(sent.attendee.email, 'b@example.com'); assert.deepEqual(sent.guests, ['info@truemarch.fun']); assert.equal(sent.eventTypeId, 42);
  assert.equal(sent.allowConflicts, undefined); assert.equal(sent.skipBookingLimits, undefined); assert.equal(sent.allowBookingOutOfBounds, undefined);
  assert.deepEqual(data.receipt.participants, ['Person B', 'Travis Ruiz']); assert.ok(!JSON.stringify(data).includes('PRIVATE')); assert.ok(!JSON.stringify(data).includes(f.env.CAL_API_KEY));
});
test('duplicate and concurrent submissions write to Cal.com only once', async () => {
  const f = fixture(), { cookie } = await f.init(), id = crypto.randomUUID();
  const results = await Promise.all([f.book(cookie, body(), id), f.book(cookie, body(), id)]);
  assert.ok(results.some(r => r.status === 200)); assert.equal(f.calls.filter(x => x.url.endsWith('/bookings')).length, 1);
  const replay = await f.book(cookie, body(), id); assert.equal(replay.status, 200); assert.equal(f.calls.filter(x => x.url.endsWith('/bookings')).length, 1);
  assert.equal((await f.book(cookie, { ...body(), notes: 'Changed' }, id)).status, 409);
});
test('timeouts and redirects preserve uncertain state and do not retry writes', async () => {
  for (const mode of ['timeout', 'redirect']) {
    const f = fixture(), { cookie } = await f.init(), id = crypto.randomUUID(); f.setMode(mode);
    const first = await f.book(cookie, body(), id); assert.equal(first.status, 409); assert.equal((await first.json()).uncertain, true);
    assert.equal((await f.book(cookie, body(), id)).status, 409);
    assert.equal(f.calls.filter(x => x.url.endsWith('/bookings')).length, 1);
  }
});
test('receipts are scoped to the requesting browser, not a public meeting list', async () => {
  const f = fixture(), a = await f.init(), b = await f.init(), id = crypto.randomUUID(); await f.book(a.cookie, body(), id);
  assert.equal((await f.call('/api/public/receipt?requestId=' + id, undefined, a.cookie)).status, 200);
  assert.equal((await f.call('/api/public/receipt?requestId=' + id, undefined, b.cookie)).status, 404);
  assert.equal((await f.call('/api/public/receipt?requestId=' + id)).status, 404);
});
test('validation, consent, missing visitor, cross-origin, and oversized bodies fail before writing', async () => {
  const f = fixture(), { cookie } = await f.init();
  for (const payload of [null, [], { ...body(), agreed: false }, { ...body(), first: { name: 'Travis', email: 'INFO@TRUEMARCH.FUN' } }, { ...body(), first: { name: 'B', email: 'bad' } }]) assert.equal((await f.book(cookie, payload)).status, 400);
  assert.equal((await f.book('')).status, 401);
  assert.equal((await f.call('/api/public/bookings', body(), cookie, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.book(cookie, { ...body(), notes: 'x'.repeat(9000) })).status, 413);
  assert.equal(f.calls.some(x => x.url.endsWith('/bookings')), false);
});
test('public booking attempts are rate limited and upstream errors are not leaked', async () => {
  const f = fixture(), { cookie } = await f.init(); f.setMode('invalid');
  for (let i = 0; i < 5; i++) { const r = await f.book(cookie); assert.equal(r.status, 400); assert.ok(!(await r.text()).includes('PRIVATE_ERROR')); }
  assert.equal((await f.book(cookie)).status, 429);
});

const eventPayload = { title: 'Project chat', slug: 'project-chat', duration: 30, description: 'A conversation', scheduleId: 7, formatId: 'integration:cal-video' };
const schedulePayload = { name: 'Afternoons', timeZone: 'Europe/Berlin', days: ['Tuesday'], startTime: '13:00', endTime: '17:00', overrides: [{ date: '2027-01-05', startTime: '14:00', endTime: '16:00' }] };
async function write(f, cookie, path, body, id = crypto.randomUUID(), method = 'POST') {
  const request = new Request(origin + '/api/public/' + path, { method, headers: { origin, cookie, 'content-type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(body) });
  return gateway(request, f.env, f.fetcher);
}
test('shared booking list supports cancellations and cursors without leaking emails or hidden events', async () => {
  const f = fixture(), { cookie } = await f.init();
  f.bookings[0].status = 'cancelled'; f.bookings[0].cancellationReason = 'Schedule changed';
  f.bookings.push({ ...f.bookings[0], uid: 'hidden-booking', eventTypeId: 999, title: 'PRIVATE_TITLE' });
  const response = await f.call('/api/public/bookings?status=cancelled&cursor=abc&attendeeEmail=ignored@example.com', undefined, cookie);
  const result = await response.json(); assert.equal(response.status, 200);
  assert.equal(result.bookings.length, 1); assert.equal(result.bookings[0].status, 'cancelled'); assert.equal(result.bookings[0].cancellationReason, 'Schedule changed');
  assert.equal(result.nextCursor, 'next-page'); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  const upstream = new URL(f.calls.at(-1).url); assert.equal(upstream.searchParams.get('eventTypeIds'), '42'); assert.equal(upstream.searchParams.get('cursor'), 'abc'); assert.equal(upstream.searchParams.has('attendeeEmail'), false);
  assert.equal((await f.call('/api/public/bookings?status=bogus', undefined, cookie)).status, 400);
  assert.equal((await f.call('/api/public/bookings')).status, 401);
});
test('shared event creation and edits validate ownership, allow only supported fields, and prevent duplicates', async () => {
  const f = fixture(), { cookie } = await f.init(), id = crypto.randomUUID();
  const payload = { ...eventPayload, ownerId: 123, hidden: true, requiresBookerEmailVerification: true, price: 100 };
  const responses = await Promise.all([write(f, cookie, 'event-types', payload, id), write(f, cookie, 'event-types', payload, id)]);
  assert.ok(responses.some(r => r.status === 200));
  const writes = f.calls.filter(c => c.url.endsWith('/event-types') && c.options.method === 'POST'); assert.equal(writes.length, 1);
  const sent = JSON.parse(writes[0].options.body); assert.equal(sent.hidden, false); assert.equal(sent.ownerId, undefined); assert.equal(sent.price, undefined); assert.equal(sent.requiresBookerEmailVerification, false);
  assert.equal((await write(f, cookie, 'event-types', payload, id)).status, 200);
  assert.equal((await write(f, cookie, 'event-types', { ...payload, title: 'Different' }, id)).status, 409);
  assert.equal((await write(f, cookie, 'event-types/42', eventPayload, crypto.randomUUID(), 'PATCH')).status, 200);
  assert.equal((await write(f, cookie, 'event-types/999', eventPayload, crypto.randomUUID(), 'PATCH')).status, 400);
  assert.equal((await write(f, cookie, 'event-types', { ...eventPayload, scheduleId: 999 })).status, 400);
});
test('availability creation preserves default schedule and validates local hours and overrides', async () => {
  const f = fixture(), { cookie } = await f.init();
  assert.equal((await write(f, cookie, 'schedules', { ...schedulePayload, isDefault: true })).status, 200);
  const sent = JSON.parse(f.calls.at(-1).options.body); assert.equal(sent.isDefault, false); assert.deepEqual(sent.availability[0].days, ['Tuesday']); assert.equal(sent.overrides[0].date, '2027-01-05');
  for (const payload of [{ ...schedulePayload, endTime: '12:00' }, { ...schedulePayload, days: ['Tomorrow'] }, { ...schedulePayload, timeZone: 'invalid' }, { ...schedulePayload, overrides: [{ date: '2027-02-30', startTime: '10:00', endTime: '12:00' }] }]) assert.equal((await write(f, cookie, 'schedules', payload)).status, 400);
});
test('cancel and reschedule require confirmation, public event ownership, and keep conflict checks', async () => {
  const f = fixture(), { cookie } = await f.init();
  assert.equal((await write(f, cookie, 'bookings/booking-1/cancel', { confirmed: false })).status, 400);
  const cancellation = await write(f, cookie, 'bookings/booking-1/cancel', { confirmed: true, reason: 'Agreed', cancelSubsequentBookings: true });
  assert.equal(cancellation.status, 200); assert.equal((await cancellation.json()).booking.status, 'cancelled');
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { cancellationReason: 'Agreed' });
  const reschedule = await write(f, cookie, 'bookings/booking-1/reschedule', { confirmed: true, start, allowConflicts: true, skipBookingLimits: true });
  assert.equal(reschedule.status, 200); const sent = JSON.parse(f.calls.at(-1).options.body); assert.equal(sent.start, start); assert.equal(sent.allowConflicts, undefined); assert.equal(sent.skipBookingLimits, undefined);
  f.bookings[0].eventTypeId = 999; assert.equal((await write(f, cookie, 'bookings/booking-1/cancel', { confirmed: true })).status, 400);
});
test('management protects origins, bounded input, rate limits, and uncertain writes', async () => {
  const f = fixture(), { cookie } = await f.init(), id = crypto.randomUUID();
  f.setManageMode('timeout');
  assert.equal((await write(f, cookie, 'event-types', eventPayload, id)).status, 409);
  assert.equal((await write(f, cookie, 'event-types', eventPayload, id)).status, 409);
  assert.equal(f.calls.filter(c => c.url.endsWith('/event-types') && c.options.method === 'POST').length, 1);
  assert.equal((await f.call('/api/public/receipt?requestId=' + id, undefined, cookie)).status, 409);
  assert.equal((await f.call('/api/public/schedules', schedulePayload, cookie, { origin: 'https://evil.test', 'Idempotency-Key': crypto.randomUUID() })).status, 403);
  assert.equal((await write(f, cookie, 'schedules', { ...schedulePayload, junk: 'x'.repeat(9000) })).status, 413);
  const other = fixture(), init = await other.init(); other.setManageMode('reject');
  for (let i = 0; i < 20; i++) assert.equal((await write(other, init.cookie, 'schedules', schedulePayload)).status, 400);
  assert.equal((await write(other, init.cookie, 'schedules', schedulePayload)).status, 429);
});

test('Gmail visitors can book with Travis without sharing the fixed recipient rate limit', async () => {
  const f = fixture(), { cookie } = await f.init();
  for (let i = 0; i < 6; i++) {
    const r = await f.call('/api/public/bookings', { ...body(), first: { name: 'Visitor ' + i, email: 'visitor' + i + '@gmail.com' } }, cookie, { 'cf-connecting-ip': '192.0.2.' + (i + 10), 'Idempotency-Key': crypto.randomUUID() });
    assert.equal(r.status, 200);
    const sent = JSON.parse(f.calls.at(-1).options.body);
    assert.deepEqual(sent.guests, ['info@truemarch.fun']);
  }
});

test('meeting format is mandatory, event-scoped, and sent as a structured location', async () => {
  const f = fixture(), { cookie } = await f.init();
  for (const formatId of [undefined, '', 'integration:google-meet', 'address']) assert.equal((await f.book(cookie, { ...body(), formatId })).status, 400);
  assert.equal(f.calls.some(c => c.url.endsWith('/bookings')), false);
  const r = await f.book(cookie, { ...body(), location: { type: 'integration', integration: 'google-meet' }, meetingUrl: 'https://attacker.test' });
  assert.equal(r.status, 200); assert.equal((await r.json()).receipt.format, 'Cal Video');
  const sent = JSON.parse(f.calls.at(-1).options.body);
  assert.deepEqual(sent.location, { type: 'integration', integration: 'cal-video' });
  assert.equal(sent.metadata.meetingFormat, 'Cal Video'); assert.equal(sent.meetingUrl, undefined);
});
test('Google Meet requires both event configuration and a valid organizer connection', async () => {
  const f = fixture(); f.events[0].locations = [{ type: 'integration', integration: 'google-meet' }];
  const { cookie } = await f.init();
  assert.equal((await f.book(cookie, { ...body(), formatId: 'integration:google-meet' })).status, 400);
  f.apps.push({ type: 'google_video', invalid: true });
  assert.equal((await f.book(cookie, { ...body(), formatId: 'integration:google-meet' })).status, 400);
  f.apps[0].invalid = false;
  const r = await f.book(cookie, { ...body(), formatId: 'integration:google-meet' });
  assert.equal(r.status, 200); assert.equal((await r.json()).receipt.format, 'Google Meet');
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).location, { type: 'integration', integration: 'google-meet' });
});
test('organizer locations stay private and attendee phone details are validated', async () => {
  const f = fixture(); f.events[0].locations = [{ type: 'address', address: 'PRIVATE_ADDRESS', public: false }, { type: 'attendeePhone' }];
  f.events[0].bookingFields = [{ slug: 'location', required: true }];
  const { cookie, data } = await f.init(); assert.equal(data.events.length, 1); assert.ok(!JSON.stringify(data).includes('PRIVATE_ADDRESS'));
  const r = await f.book(cookie, { ...body(), formatId: 'address', formatDetail: 'attacker address' }); assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).location, { type: 'address' }); assert.equal((await r.json()).receipt.meetingUrl, null);
  assert.equal((await f.book(cookie, { ...body(), formatId: 'attendeePhone', formatDetail: 'bad' })).status, 400);
  assert.equal((await f.book(cookie, { ...body(), formatId: 'attendeePhone', formatDetail: '+12025550123' })).status, 200);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).location, { type: 'attendeePhone', phone: '+12025550123' });
});
test('event format settings require a connected provider or valid meeting details', async () => {
  const f = fixture(), { cookie } = await f.init();
  const choices = await (await f.call('/api/public/formats', undefined, cookie)).json();
  assert.equal(choices.formats.find(p => p.id === 'integration:google-meet').available, false);
  for (const settings of [{ formatId: '' }, { formatId: 'integration:google-meet' }, { formatId: 'link', formatDetail: 'javascript:alert(1)' }, { formatId: 'address', formatDetail: '' }]) assert.equal((await write(f, cookie, 'event-types', { ...eventPayload, ...settings })).status, 400);
  assert.equal((await write(f, cookie, 'event-types', { ...eventPayload, formatId: 'link', formatDetail: 'https://meet.example.com/room' })).status, 200);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).locations, [{ type: 'link', link: 'https://meet.example.com/room', public: false }]);
});
