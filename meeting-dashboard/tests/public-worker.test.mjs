import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
const mf = new Miniflare({
  modulesRoot: process.cwd(), compatibilityDate: '2026-01-01',
  d1Databases: { DB: 'test-public-booking' },
  bindings: { CAL_API_KEY: 'cal_live_test_only', CAL_ACCOUNT_EMAIL: 'hello@truemarch.fun', CAL_SESSION_SECRET: 'public-worker-test-secret-at-least-32-characters' },
  modules: [
    { type: 'ESModule', path: 'test-public-worker.mjs', contents: `
      import { publicBookingGateway } from './public-booking.mjs';
      export default { async fetch(request, env) {
        return await publicBookingGateway(request, env, async (url, options) => {
          new Request(url, options); // Real Workers runtime validation, not Node fetch.
          if (url.endsWith('/me')) return Response.json({ data: { email: env.CAL_ACCOUNT_EMAIL } });
          if (url.endsWith('/event-types')) return Response.json({ data: [{ id: 42, title: 'Conversation', lengthInMinutes: 30, locations: [{ type: 'integration', integration: 'cal-video' }] }] });
          if (url.endsWith('/bookings')) {
            const body = JSON.parse(options.body);
            if (body.location?.integration !== 'cal-video') throw new Error('Missing selected meeting format');
            if (body.guests?.length !== 1 || body.guests[0] !== 'info@truemarch.fun') throw new Error('Recipient was not fixed to Travis');
            if (body.attendee.email === 'redirect@example.com') return new Response(null, { status: 302, headers: { location: 'https://trap.invalid' } });
            return Response.json({ data: { uid: 'worker-booking', title: 'Conversation', start: body.start, end: new Date(Date.parse(body.start) + 1800000).toISOString(), status: 'accepted' } });
          }
          throw new Error('Unexpected upstream');
        }) || new Response('page');
      } }
    ` },
    { type: 'ESModule', path: 'public-booking.mjs', contents: readFileSync(new URL('../lib/public-booking.mjs', import.meta.url), 'utf8') },
    { type: 'ESModule', path: 'shared-management.mjs', contents: readFileSync(new URL('../lib/shared-management.mjs', import.meta.url), 'utf8') },
    { type: 'ESModule', path: 'meeting-formats.mjs', contents: readFileSync(new URL('../lib/meeting-formats.mjs', import.meta.url), 'utf8') },
    { type: 'ESModule', path: 'meeting-recipient.mjs', contents: readFileSync(new URL('../lib/meeting-recipient.mjs', import.meta.url), 'utf8') },
    { type: 'ESModule', path: 'secure-session.mjs', contents: readFileSync(new URL('../lib/secure-session.mjs', import.meta.url), 'utf8') },
  ],
});
try {
  const db = await mf.getD1Database('DB');
  for (const name of ['0000_dizzy_dark_phoenix.sql', '0001_perpetual_pretty_boy.sql']) {
    const sql = readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) await db.exec(statement.replace(/\n/g, ' '));
  }
  const init = await mf.dispatchFetch('https://test.local/api/public/config');
  assert.equal(init.status, 200, await init.clone().text());
  const cookie = init.headers.get('set-cookie').split(';')[0];
  const start = new Date(Date.now() + 86400000).toISOString();
  const book = (email, id = crypto.randomUUID()) => mf.dispatchFetch('https://test.local/api/public/bookings', { method: 'POST', headers: { origin: 'https://test.local', cookie, 'content-type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ eventTypeId: 42, formatId: 'integration:cal-video', start, timeZone: 'UTC', first: { name: 'B', email }, agreed: true }) });
  const id = crypto.randomUUID(), success = await book('b@example.com', id);
  assert.equal(success.status, 200, await success.clone().text());
  assert.equal((await success.json()).receipt.reference, 'worker-booking');
  assert.equal((await book('b@example.com', id)).status, 200);
  const redirect = await book('redirect@example.com'); assert.equal(redirect.status, 409); assert.equal((await redirect.json()).uncertain, true);
  assert.equal((await mf.dispatchFetch('https://test.local/api/cal/bookings', { headers: { cookie } })).status, 404);
  console.log('Public Workers checks passed: real D1 migrations, anonymous cookie, booking, replay, redirect rejection, and blocked private endpoints.');
} finally { await mf.dispose(); }
