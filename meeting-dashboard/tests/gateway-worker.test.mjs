// Exercise actual Workers Request validation, which Node-only fetch mocks miss.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  modulesRoot: process.cwd(),
  compatibilityDate: '2026-01-01',
  modules: [
    { type: 'ESModule', path: 'test-worker.mjs', contents: `
      import { gateway } from './cal-gateway.mjs';
      export default { async fetch(request) {
        const mode = new URL(request.url).searchParams.get('mode');
        let calls = 0;
        const result = await gateway(request, { CAL_SESSION_SECRET: 'test-only-worker-session-secret-at-least-32-characters' }, async (url, options) => {
          // This constructs a real workerd Request, not a Node Request.
          new Request(url, options);
          if (++calls > 1) throw new Error('Unexpected follow-up request');
          if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://example.invalid/credential-trap' } });
          if (mode === 'live') return fetch(url, options);
          return Response.json({ data: { name: 'Worker test' } });
        }, 'test-worker-user');
        return result;
      } }
    ` },
    { type: 'ESModule', path: 'cal-gateway.mjs', contents: readFileSync(new URL('../lib/cal-gateway.mjs', import.meta.url), 'utf8') },
    { type: 'ESModule', path: 'secure-session.mjs', contents: readFileSync(new URL('../lib/secure-session.mjs', import.meta.url), 'utf8') },
  ],
});
const connect = mode => mf.dispatchFetch('https://test.local/api/cal/session?mode=' + mode, { method: 'POST', headers: { origin: 'https://test.local', 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'cal_live_diagnostic_invalid_key' }) });
try {
  const connected = await connect('success');
  assert.equal(connected.status, 200, await connected.clone().text());
  assert.equal((await connected.json()).connected, true);
  const session = connected.headers.get('set-cookie').split(';')[0];
  const redirected = await connect('redirect');
  assert.equal(redirected.status, 502);
  assert.match((await redirected.json()).error, /unexpected redirect/);
  const list = await mf.dispatchFetch('https://test.local/api/cal/bookings?mode=success', { headers: { cookie: session } });
  assert.equal(list.status, 200, await list.clone().text());
  const write = await mf.dispatchFetch('https://test.local/api/cal/bookings?mode=redirect', { method: 'POST', headers: { cookie: session, origin: 'https://test.local', 'content-type': 'application/json' }, body: '{"eventTypeId":1}' });
  assert.equal(write.status, 502);
  assert.match((await write.json()).error, /unexpected redirect/);
  if (process.env.CAL_LIVE_SMOKE === '1') {
    const live = await connect('live');
    assert.equal(live.status, 401, await live.clone().text());
    console.log('Live Cal.com request from Workers reached API and rejected the diagnostic invalid key as expected.');
  }
  console.log('Workers runtime checks passed: connect, list, and redirect rejection for credentials and writes.');
} finally { await mf.dispose(); }
