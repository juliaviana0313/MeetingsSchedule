import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { authGateway, resolveIdentity, businessEmail } from '../lib/email-auth.mjs';
import { gateway, seal } from '../lib/cal-gateway.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_dizzy_dark_phoenix.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) {
    let args = [];
    const statement = { bind(...values) { args = values; return statement; }, async run() { return sqlite.prepare(sql).run(...args); }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
    return statement;
  }, async batch(statements) { const output = []; for (const s of statements) output.push(await s.all()); return output; } };
  const env = { DB, CAL_SESSION_SECRET: 'test-email-session-secret-at-least-32-characters', RESEND_API_KEY: 'test-provider-key', AUTH_EMAIL_FROM: 'signin@company.test' };
  const sent = [];
  const sender = async (url, options) => { assert.equal(url, 'https://api.resend.com/emails'); sent.push(JSON.parse(options.body)); return Response.json({ id: 'test-delivery' }); };
  return { env, sqlite, sent, sender };
}
const req = (path, body, headers = {}) => new Request('https://site.test/api/auth/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://site.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const cookies = response => response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
async function start(f, email = 'person@company.test') {
  const response = await authGateway(req('email/request', { email }), f.env, f.sender);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sent, true);
  return { cookie: cookies(response), code: f.sent.at(-1).text.match(/code is: (\d{8})/)[1] };
}
const verify = (f, c, code = c.code) => authGateway(req('email/verify', { code }, { cookie: c.cookie }), f.env, f.sender);

test('normalizes business emails, rejects malformed and common consumer addresses', () => {
  assert.equal(businessEmail(' Person@Company.test '), 'person@company.test');
  for (const v of ['x@gmail.com', 'x@outlook.com', 'x@sub.gmail.com', 'x@localhost', 'x@bad-.com', 'a..b@company.test', 'a@company.test\nBcc: other@test.test', null]) assert.equal(businessEmail(v), null);
  assert.equal(businessEmail('alex@google-workspace-company.test'), 'alex@google-workspace-company.test');
});
test('missing delivery configuration fails closed; Google and platform cookies do not grant access', async () => {
  const f = fixture();
  const session = await (await authGateway(req('session', undefined, { 'oai-authenticated-user-id': 'native-user', cookie: '__Host-ms-google=old' }), f.env)).json();
  assert.equal(session.user, null); assert.equal(session.emailConfigured, true);
  assert.equal((await authGateway(req('email/request', { email: 'a@company.test' }), { ...f.env, RESEND_API_KEY: '' })).status, 503);
  assert.equal((await authGateway(req('google/challenge', {}), f.env)).status, 404);
});
test('request sends code only by email and stores keyed hashes', async () => {
  const f = fixture(), c = await start(f);
  const row = f.sqlite.prepare('SELECT * FROM email_auth_challenges').get();
  assert.equal(row.attempts, 0); assert.equal(row.used_at, null);
  assert.equal(JSON.stringify(row).includes(c.code), false);
  assert.equal(c.cookie.includes(c.code), false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM email_auth_users').get().n, 0);
});
test('valid code creates stable user, encrypted session and clears old Cal/Google cookies', async () => {
  const f = fixture(), c = await start(f), response = await verify(f, c);
  assert.equal(response.status, 200);
  const { user } = await response.json();
  assert.equal(user.email, 'person@company.test'); assert.equal(user.provider, 'email');
  const session = response.headers.getSetCookie().find(x => x.startsWith('__Host-ms-email='));
  assert.match(session, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(session.includes(user.email), false);
  assert.ok(response.headers.getSetCookie().some(x => x.startsWith('__Host-ms-cal=;')));
  assert.equal((await resolveIdentity(req('session', undefined, { cookie: cookies(response) }), f.env)).id, user.id);
  f.sqlite.exec('DELETE FROM email_auth_limits');
  const second = await verify(f, await start(f, 'PERSON@company.test'));
  assert.equal((await second.json()).user.id, user.id);
});
test('code cannot be used twice, including simultaneous requests', async () => {
  const f = fixture(), c = await start(f);
  const responses = await Promise.all([verify(f, c), verify(f, c)]);
  assert.deepEqual(responses.map(x => x.status).sort(), [200, 401]);
});
test('five wrong attempts lock the challenge even for a subsequent correct code', async () => {
  const f = fixture(), c = await start(f), wrong = c.code === '00000000' ? '11111111' : '00000000';
  for (let i = 0; i < 5; i++) assert.equal((await verify(f, c, wrong)).status, 401);
  assert.equal((await verify(f, c)).status, 401);
});
test('expired challenges and another browser cannot authenticate', async () => {
  const f = fixture(), c = await start(f);
  assert.equal((await verify(f, { ...c, cookie: '' })).status, 401);
  assert.equal((await verify(f, { ...c, cookie: '__Host-ms-email-challenge=forged' })).status, 401);
  f.sqlite.exec('UPDATE email_auth_challenges SET expires_at = 1');
  assert.equal((await verify(f, c)).status, 401);
});
test('request rate limits block repeat sends to the same email and excessive sends per IP', async () => {
  const f = fixture(); await start(f);
  assert.equal((await authGateway(req('email/request', { email: 'person@company.test' }), f.env, f.sender)).status, 429);
  for (let i = 0; i < 18; i++) await start(f, `person${i}@company.test`);
  assert.equal((await authGateway(req('email/request', { email: 'last@company.test' }), f.env, f.sender)).status, 429);
});
test('failed email delivery deletes challenge and does not claim success', async () => {
  const f = fixture();
  const response = await authGateway(req('email/request', { email: 'person@company.test' }), f.env, async () => Response.json({ error: 'bad credentials' }, { status: 403 }));
  assert.equal(response.status, 502); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM email_auth_challenges').get().n, 0);
});
test('rejects CSRF, invalid JSON and oversized bodies', async () => {
  const f = fixture();
  assert.equal((await authGateway(req('email/request', { email: 'x@company.test' }, { origin: 'https://evil.test' }), f.env)).status, 403);
  assert.equal((await authGateway(req('email/request', null), f.env)).status, 400);
  assert.equal((await authGateway(req('email/request', { email: 'x'.repeat(3000) }), f.env)).status, 413);
  assert.equal((await authGateway(req('email/request', {}, { 'content-type': 'text/plain' }), f.env)).status, 415);
});
test('Cal connections remain bound to their email user and anonymous API access is denied', async () => {
  const f = fixture();
  const response = await verify(f, await start(f));
  const { user } = await response.json();
  const cal = await seal({ userId: 'email:someone-else', token: 'cal_live_testtoken1234567890', expires: Date.now() + 60000 }, f.env.CAL_SESSION_SECRET);
  for (const identity of [null, user.id]) {
    const result = await gateway(new Request('https://site.test/api/cal/bookings', { headers: { cookie: '__Host-ms-cal=' + cal } }), f.env, () => { throw new Error('Must not contact Cal'); }, identity);
    assert.equal(result.status, 401);
  }
});
test('logout clears email, challenge, Cal and legacy Google cookies', async () => {
  const f = fixture(), response = await authGateway(req('logout', {}), f.env);
  assert.equal(response.headers.getSetCookie().length, 5);
  assert.ok(response.headers.getSetCookie().every(x => x.includes('Max-Age=0')));
});
