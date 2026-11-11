import { seal, unseal } from './secure-session.mjs';

const SESSION = '__Host-ms-email';
const CHALLENGE = '__Host-ms-email-challenge';
const TEN_MINUTES = 600000;
const encoder = new TextEncoder();
// A practical consumer-mail filter, not a proof of employment. Custom business
// domains hosted by Google Workspace or Microsoft 365 remain eligible.
const personalDomains = new Set('gmail.com googlemail.com yahoo.com yahoo.co.uk yahoo.co.jp ymail.com rocketmail.com hotmail.com hotmail.co.uk outlook.com live.com msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me mail.com gmx.com gmx.de web.de hey.com yandex.com yandex.ru mail.ru inbox.ru bk.ru list.ru rambler.ru qq.com 163.com 126.com zoho.com fastmail.com tutanota.com tuta.com'.split(' '));
export function businessEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return null;
  const [local, domain] = email.split('@');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if ([...personalDomains].some(d => domain === d || domain.endsWith('.' + d))) return null;
  return email;
}
const cookie = (name, value, maxAge = 28800) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${value ? maxAge : 0}`;
const readCookie = (request, name) => (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const configured = env => !!(env.DB && env.RESEND_API_KEY && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.AUTH_EMAIL_FROM || '') && env.CAL_SESSION_SECRET?.length >= 32);
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
async function digest(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4200000000);
  return String(value % 100000000).padStart(8, '0');
}
async function rateLimit(request, email, env, now) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const specs = [[`email-minute:${email}`, 60000, 1], [`email-hour:${email}`, 3600000, 5], [`ip-hour:${ip}`, 3600000, 20], ['global-hour', 3600000, 300]];
  const statements = await Promise.all(specs.map(async ([identity, period]) => {
    const bucket = Math.floor(now / period);
    const key = await digest(`rate:${identity}:${bucket}`, env.CAL_SESSION_SECRET);
    return env.DB.prepare('INSERT INTO email_auth_limits (id, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count').bind(key, (bucket + 1) * period);
  }));
  const results = await env.DB.batch(statements);
  return results.every((r, i) => r.results[0].count <= specs[i][2]);
}
export async function resolveIdentity(request, env) {
  const encrypted = readCookie(request, SESSION);
  if (!encrypted) return null;
  const identity = await unseal(encrypted, env.CAL_SESSION_SECRET, 'email-session');
  return identity?.provider === 'email' && typeof identity.id === 'string' && identity.id.startsWith('email:') && businessEmail(identity.email) ? identity : null;
}
export async function authGateway(request, env, send = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/')) return null;
  const path = url.pathname.slice('/api/auth/'.length);
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return json({ error: 'Request origin rejected.' }, 403);
  if (path === 'session' && request.method === 'GET') return json({ user: await resolveIdentity(request, env), emailConfigured: configured(env) });
  if (path === 'logout' && request.method === 'POST') {
    const response = json({ signedOut: true, platformSignOut: !!request.headers.get('oai-authenticated-user-id') });
    for (const name of [SESSION, CHALLENGE, '__Host-ms-cal', '__Host-ms-google', '__Host-ms-google-challenge']) response.headers.append('Set-Cookie', cookie(name, ''));
    return response;
  }
  if (!['email/request', 'email/verify'].includes(path) || request.method !== 'POST') return json({ error: 'Unknown authentication operation.' }, 404);
  if (!configured(env)) return json({ error: 'Business-email sign-in is awaiting email delivery setup. Please contact the site owner.' }, 503);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON request required.' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 2048) return json({ error: 'Request too large.' }, 413);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'Request too large.' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new Error();
  } catch { return json({ error: 'Invalid request.' }, 400); }
  try {
    const now = Date.now();
    if (path === 'email/request') {
      const email = businessEmail(body.email);
      if (!email) return json({ error: 'Enter your individual work email at a company domain. Common personal email providers are not accepted.' }, 400);
      if (!(await rateLimit(request, email, env, now))) {
        const response = json({ error: 'Too many sign-in requests. Wait before requesting another code.' }, 429);
        response.headers.set('Retry-After', '60');
        return response;
      }
      const id = crypto.randomUUID(), browser = random(), code = newCode();
      const browserHash = await digest(`browser:${browser}`, env.CAL_SESSION_SECRET);
      const codeHash = await digest(`code:${id}:${code}`, env.CAL_SESSION_SECRET);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM email_auth_challenges WHERE expires_at < ?').bind(now - 86400000),
        env.DB.prepare('DELETE FROM email_auth_limits WHERE expires_at < ?').bind(now - 86400000),
        env.DB.prepare('INSERT INTO email_auth_challenges (id, email, code_hash, browser_hash, expires_at, attempts) VALUES (?, ?, ?, ?, ?, 0)').bind(id, email, codeHash, browserHash, now + TEN_MINUTES),
      ]);
      let delivered = false;
      try {
        const sent = await send('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `signin/${id}` },
          body: JSON.stringify({ from: `MeetingSchedule <${env.AUTH_EMAIL_FROM}>`, to: [email], subject: 'Your MeetingSchedule sign-in code', text: `Your MeetingSchedule code is: ${code}\n\nEnter this code in the same browser where you requested it. It expires in 10 minutes and can only be used once.\n\nIf you did not request this code, ignore this email. Do not share the code with anyone.` }),
          signal: AbortSignal.timeout(10000),
        });
        delivered = sent.ok && typeof (await sent.json()).id === 'string';
      } catch { /* Do not log provider responses, addresses, or codes. */ }
      if (!delivered) {
        await env.DB.prepare('DELETE FROM email_auth_challenges WHERE id = ?').bind(id).run();
        return json({ error: 'We could not send your code. Try again later or contact the site owner.' }, 502);
      }
      const encrypted = await seal({ userId: 'email-challenge', token: { id, browser }, expires: now + TEN_MINUTES }, env.CAL_SESSION_SECRET);
      const response = json({ sent: true, expiresIn: 600 });
      response.headers.append('Set-Cookie', cookie(CHALLENGE, encrypted, 600));
      return response;
    }
    if (typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)) return json({ error: 'Enter the 8-digit code from your email.' }, 400);
    const challenge = await unseal(readCookie(request, CHALLENGE) || '', env.CAL_SESSION_SECRET, 'email-challenge');
    if (!challenge?.id || !challenge?.browser) return json({ error: 'Your sign-in attempt expired. Request a new code in this browser.' }, 401);
    const hash = await digest(`code:${challenge.id}:${body.code}`, env.CAL_SESSION_SECRET);
    const browserHash = await digest(`browser:${challenge.browser}`, env.CAL_SESSION_SECRET);
    // One atomic update enforces the attempt limit and consumes a matching code.
    // A replay, including simultaneous verification, cannot consume it twice.
    const row = await env.DB.prepare('UPDATE email_auth_challenges SET attempts = attempts + 1, used_at = CASE WHEN code_hash = ? THEN ? ELSE NULL END WHERE id = ? AND browser_hash = ? AND expires_at > ? AND used_at IS NULL AND attempts < 5 RETURNING email, used_at').bind(hash, now, challenge.id, browserHash, now).first();
    if (!row?.used_at) return json({ error: 'The code is invalid, expired, or already used. After five attempts, request a new code.' }, 401);
    const user = await env.DB.prepare('INSERT INTO email_auth_users (id, email, verified_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET verified_at = excluded.verified_at RETURNING id, email').bind(crypto.randomUUID(), row.email, now).first();
    const identity = { id: `email:${user.id}`, email: user.email, name: user.email, provider: 'email' };
    const encrypted = await seal({ userId: 'email-session', token: identity, expires: now + 28800000 }, env.CAL_SESSION_SECRET);
    const response = json({ user: identity });
    response.headers.append('Set-Cookie', cookie(SESSION, encrypted));
    for (const name of [CHALLENGE, '__Host-ms-cal', '__Host-ms-google', '__Host-ms-google-challenge']) response.headers.append('Set-Cookie', cookie(name, ''));
    return response;
  } catch {
    return json({ error: 'Sign-in is temporarily unavailable. Please try again later.' }, 503);
  }
}
