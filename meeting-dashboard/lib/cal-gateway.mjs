import { seal, unseal } from "./secure-session.mjs";
export { seal, unseal } from "./secure-session.mjs";
// Cal.com API gateway. No API credential is persisted in source or returned to JavaScript.
const ROOT = "https://api.cal.com/v2";
const COOKIE = "__Host-ms-cal";
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...extra },
  });
const isRedirect = (response) => response.status >= 300 && response.status < 400;
const redirectError = () =>
  json({ error: "Cal.com returned an unexpected redirect. The request was stopped to protect your API key. Please contact the dashboard owner." }, 502);
export function routeVersion(path, method) {
  if (path === "me" && method === "GET") return "2024-06-11";
  if (path === "slots" && method === "GET") return "2024-09-04";
  if (
    /^event-types(?:\/\d+)?$/.test(path) &&
    ["GET", "POST", "PATCH", "DELETE"].includes(method)
  )
    return "2026-06-12";
  if (
    /^schedules(?:\/\d+)?$/.test(path) &&
    ["GET", "POST", "PATCH", "DELETE"].includes(method)
  )
    return "2024-06-11";
  if (path === "bookings" && method === "GET") return "2026-05-01";
  if (path === "bookings" && method === "POST") return "2026-02-25";
  if (
    /^bookings\/[A-Za-z0-9_-]+\/(reschedule|cancel|confirm|decline)$/.test(
      path,
    ) &&
    method === "POST"
  )
    return "2026-02-25";
  return null;
}
export async function gateway(
  request,
  env,
  fetcher = fetch,
  authenticatedUserId = request.headers.get("oai-authenticated-user-id"),
) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/cal/")) return null;
  const userId = authenticatedUserId;
  if (!userId) return json({ error: "Sign in to access your meetings." }, 401);
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin)
    return json({ error: "Request origin rejected." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 65536)
    return json({ error: "Request too large." }, 413);
  const path = url.pathname.slice("/api/cal/".length);
  const sessionCookie = (request.headers.get("cookie") || "")
    .split("; ")
    .find((x) => x.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  const token = sessionCookie
    ? await unseal(sessionCookie, env.CAL_SESSION_SECRET, userId)
    : null;
  const cookie = (value) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${value ? 28800 : 0}`;
  if (path === "session" && request.method === "DELETE")
    return json({ connected: false }, 200, { "Set-Cookie": cookie("") });
  if (path === "session" && request.method === "GET")
    return json({ connected: !!token });
  try {
    if (path === "session" && request.method === "POST") {
      const body = await request.json();
      if (
        typeof body.apiKey !== "string" ||
        !/^cal_(live_)?[A-Za-z0-9_-]{10,500}$/.test(body.apiKey)
      )
        return json({ error: "Enter a valid Cal.com API key." }, 400);
      if (!env.CAL_SESSION_SECRET)
        return json({ error: "Session encryption is not configured." }, 503);
      const upstream = await fetcher(ROOT + "/me", {
        headers: { Authorization: `Bearer ${body.apiKey}` },
        signal: AbortSignal.timeout(15000),
        // Workers supports manual/follow only. Never forward credentials to a redirect.
        redirect: "manual",
      });
      if (isRedirect(upstream)) return redirectError();
      if (!upstream.ok)
        return json(
          {
            error:
              upstream.status === 429
                ? "Cal.com rate limit reached. Please try later."
                : [401, 403].includes(upstream.status)
                  ? "Cal.com could not verify this key. Use a Cal.com API key with the required access, and check that it has not expired."
                  : "Cal.com is temporarily unable to verify your account. Please try again later.",
          },
          [401, 403, 429].includes(upstream.status) ? upstream.status : 502,
        );
      const me = await upstream.json().catch(() => null);
      if (!me?.data || typeof me.data !== "object" || Array.isArray(me.data))
        return json({ error: "Cal.com returned an unreadable profile. Please try again later." }, 502);
      const value = await seal(
        { token: body.apiKey, userId, expires: Date.now() + 28800000 },
        env.CAL_SESSION_SECRET,
      );
      return json({ connected: true, profile: me.data }, 200, {
        "Set-Cookie": cookie(value),
      });
    }
    const version = routeVersion(path, request.method);
    if (!version)
      return json({ error: "Unsupported scheduling operation." }, 404);
    if (!token)
      return json({ error: "Connect your Cal.com account to continue." }, 401);
    let body;
    if (!["GET", "DELETE"].includes(request.method)) {
      const text = await request.text();
      if (text.length > 65536)
        return json({ error: "Request too large." }, 413);
      const payload = JSON.parse(text || "{}");
      // Never allow this dashboard to bypass Cal.com's conflict and booking-limit checks.
      delete payload.allowConflicts;
      delete payload.allowBookingOutOfBounds;
      delete payload.skipBookingLimits;
      body = JSON.stringify(payload);
    }
    const upstream = await fetcher(ROOT + "/" + path + url.search, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "cal-api-version": version,
        "Content-Type": "application/json",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    if (isRedirect(upstream)) return redirectError();
    if (upstream.status === 204) return json({ status: "success", data: null });
    const result = await upstream
      .json()
      .catch(() => ({ error: "Cal.com returned an unreadable response." }));
    if (!upstream.ok) {
      const msg =
        result.error?.message ||
        result.message ||
        result.error ||
        "The scheduling request failed.";
      return json(
        {
          error:
            upstream.status === 429
              ? "Cal.com rate limit reached. Wait before trying again."
              : typeof msg === "string"
                ? msg
                : JSON.stringify(msg),
        },
        upstream.status,
        upstream.headers.get("retry-after")
          ? { "Retry-After": upstream.headers.get("retry-after") }
          : {},
      );
    }
    return json(result);
  } catch (err) {
    return json(
      {
        error:
          err instanceof SyntaxError
            ? "Invalid request data."
            : path === "session"
              ? "The dashboard could not connect to Cal.com to verify your key. Please try again; if this continues, contact the dashboard owner."
              : "Cal.com could not be reached. For a booking change, refresh your meetings before retrying to avoid duplicates.",
      },
      err instanceof SyntaxError ? 400 : 502,
    );
  }
}
