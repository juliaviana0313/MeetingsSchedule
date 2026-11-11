import test from "node:test";
import assert from "node:assert/strict";
import { gateway, seal, unseal, routeVersion } from "../lib/cal-gateway.mjs";
const secret = "test-only-secret-at-least-thirty-two-characters";
const env = { CAL_SESSION_SECRET: secret };
const request = (path, method = "GET", body, extra = {}) =>
  new Request("https://meet.example/api/cal/" + path, {
    method,
    headers: {
      "oai-authenticated-user-id": "user-a",
      origin: "https://meet.example",
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const session = async () =>
  "__Host-ms-cal=" +
  (await seal(
    {
      token: "cal_live_testtoken1234567890",
      userId: "user-a",
      expires: Date.now() + 60000,
    },
    secret,
  ));
const fixture = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("session encryption rejects tampering, expiry and a different user", async () => {
  const value = await seal(
    { token: "credential", userId: "a", expires: Date.now() + 60000 },
    secret,
  );
  assert.equal(await unseal(value, secret, "a"), "credential");
  assert.equal(await unseal(value, secret, "b"), null);
  assert.equal(await unseal(value + "x", secret, "a"), null);
  const expired = await seal(
    { token: "credential", userId: "a", expires: 1 },
    secret,
  );
  assert.equal(await unseal(expired, secret, "a"), null);
});
test("all API operations require platform identity", async () => {
  const r = await gateway(
    new Request("https://meet.example/api/cal/bookings"),
    env,
  );
  assert.equal(r.status, 401);
});
test("mutations reject cross-origin requests before contacting Cal", async () => {
  let called = false;
  const r = await gateway(
    request(
      "session",
      "POST",
      { apiKey: "cal_live_testtoken1234567890" },
      { origin: "https://evil.example" },
    ),
    env,
    async () => {
      called = true;
      return fixture({});
    },
  );
  assert.equal(r.status, 403);
  assert.equal(called, false);
});
test("connection verifies key and sets encrypted secure cookie without returning key", async () => {
  const r = await gateway(
    request("session", "POST", { apiKey: "cal_live_testtoken1234567890" }),
    env,
    async (url, options) => {
      assert.equal(url, "https://api.cal.com/v2/me");
      assert.match(options.headers.Authorization, /Bearer cal_live_/);
      return fixture({ data: { name: "Test" } });
    },
  );
  assert.equal(r.status, 200);
  assert.match(
    r.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Strict/,
  );
  assert.ok(!(await r.text()).includes("cal_live_"));
});
test("invalid Cal credentials never create a session", async () => {
  const r = await gateway(
    request("session", "POST", { apiKey: "cal_live_testtoken1234567890" }),
    env,
    async () => fixture({}, 401),
  );
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
});
test("gateway allowlist rejects arbitrary upstream paths", async () => {
  assert.equal(routeVersion("https://evil.example", "GET"), null);
  assert.equal(routeVersion("users/1", "DELETE"), null);
  const r = await gateway(request("oauth/token", "POST", {}), env);
  assert.equal(r.status, 404);
});
test("booking creation uses correct version and strips conflict bypasses", async () => {
  const cookie = await session();
  const r = await gateway(
    request(
      "bookings",
      "POST",
      {
        eventTypeId: 1,
        start: "2026-12-01T10:00:00Z",
        allowConflicts: true,
        skipBookingLimits: true,
        allowBookingOutOfBounds: true,
      },
      { cookie },
    ),
    env,
    async (url, options) => {
      assert.equal(options.headers["cal-api-version"], "2026-02-25");
      const body = JSON.parse(options.body);
      assert.equal(body.eventTypeId, 1);
      assert.equal(body.allowConflicts, undefined);
      assert.equal(body.skipBookingLimits, undefined);
      return fixture({ status: "success", data: { uid: "test" } });
    },
  );
  assert.equal(r.status, 200);
});
test("pagination query and list version are preserved", async () => {
  const cookie = await session();
  const r = await gateway(
    request("bookings?status=past&cursor=opaque%2Bvalue", "GET", null, {
      cookie,
    }),
    env,
    async (url, options) => {
      assert.equal(new URL(url).searchParams.get("cursor"), "opaque+value");
      assert.equal(options.headers["cal-api-version"], "2026-05-01");
      return fixture({
        data: [],
        pagination: { hasMore: false, nextCursor: null },
      });
    },
  );
  assert.equal(r.status, 200);
});
test("rate-limit response is surfaced with retry-after", async () => {
  const cookie = await session();
  const r = await gateway(
    request("slots", "GET", null, { cookie }),
    env,
    async () =>
      new Response("{}", { status: 429, headers: { "retry-after": "60" } }),
  );
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "60");
});
test("network ambiguity returns an actionable error without retrying writes", async () => {
  let calls = 0;
  const cookie = await session();
  const r = await gateway(
    request("bookings", "POST", { eventTypeId: 1 }, { cookie }),
    env,
    async () => {
      calls++;
      throw new Error("private upstream detail");
    },
  );
  assert.equal(calls, 1);
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /refresh your meetings/);
});
test("disconnect expires the session cookie", async () => {
  const r = await gateway(request("session", "DELETE"), env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});

test('connection distinguishes Cal server failures and unreadable profiles from invalid keys', async () => {
  for (const response of [fixture({}, 503), new Response('not-json'), fixture({ data: null })]) {
    const r = await gateway(request('session', 'POST', { apiKey: 'cal_live_testtoken1234567890' }), env, async () => response);
    assert.equal(r.status, 502);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.doesNotMatch((await r.json()).error, /expired/);
  }
});
test('connection network error does not incorrectly warn about duplicate bookings', async () => {
  const r = await gateway(request('session', 'POST', { apiKey: 'cal_live_testtoken1234567890' }), env, async () => { throw new Error('network failure'); });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /connect to Cal.com to verify/);
});
