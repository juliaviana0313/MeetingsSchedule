# MeetingSchedule

A shared public dashboard for creating events, setting available hours, and managing meetings with Travis Ruiz (`info@truemarch.fun`). Visitors do not register, sign in, or connect their own Cal.com accounts. The backend uses one server-managed Cal.com account: `hello@truemarch.fun`.

**Website:** https://meetingschedule-hub-nov26.dragonwarrior9873.chatgpt.site

Book a meeting, Events, Availability, and Bookings are in the left sidebar. On mobile, the sidebar becomes a compact icon rail with accessible button labels. The Light mode / Dark mode button at the top switches between white/gray and near-black themes. The preference is remembered in the browser.

## How the booking works

1. Open the website. No login or account email is required from the visitor.
2. Choose a meeting type and a required **Meeting format** (for example, Cal Video or Google Meet). Choose a date and time zone, then select **Find available times**. Only formats configured for that event are offered; there is no automatic selection.
3. Choose an available slot.
4. Enter **Your name** and **Your email**. Gmail, other personal email addresses, and business addresses are accepted. Travis Ruiz (`info@truemarch.fun`) is already included and cannot be changed.
5. Add optional meeting notes and agree to receive the meeting invitation.
6. Select **Confirm booking**. The page shows a confirmation or indicates that organizer approval is pending.
7. Check your email inbox for the invitation; Travis also receives an invitation at `info@truemarch.fun`. The confirmation shows the selected format and the location or meeting link when provided by Cal.com.

Cal.com records `hello@truemarch.fun` as the technical organizer. The visitor is the primary attendee and Travis is the fixed additional guest. Their names are included in the booking notes. The server adds Travis's address from `lib/meeting-recipient.mjs`, ignoring any client-supplied recipient or additional guests. The organizer can also appear on the calendar invitation. This does not change the connected account to `info@truemarch.fun` or connect Travis's separate calendar.

Available slots come from the organizer's schedule and connected calendars. The page cannot check either participant's private calendar from their email address. Confirm their availability separately. This is not a tool for taking control of arbitrary people's calendars.

## Events, availability, and reservations

All visitors share this workspace without signing up. Changes use the backend credentials for `hello@truemarch.fun`. Visitors can create and edit public meeting types and view, cancel, or reschedule their reservations. The shared list displays meeting titles, participant names, times, meeting format, status, reference, and cancellation reason. Older bookings without a recognizable format display “Not recorded”. It does not return attendee email addresses, private notes, meeting links, account profiles, or the API key. Hidden and unsupported event types and their reservations remain outside the public workspace.

1. **Availability → New schedule:** name the schedule, select a time zone and weekdays, and enter start/end hours. Optional date overrides replace the weekly hours on those dates. Save the schedule. Creating a schedule does not replace the account's default or change other events.
2. **Events → New event:** enter a title, unique URL slug, duration, description, and availability schedule. Choose a required **Event meeting format**. Cal Video, a custom HTTPS meeting link, an in-person address, and a phone call are available; connected Google Meet, Zoom, or Microsoft Teams providers can also be selected. Enter the link, address, or international phone number when prompted. Guests are enabled. Use **Edit event** to change its title, description, duration, assigned schedule, format, URL slug, or scheduling limits. **Keep current formats** preserves existing locations; selecting a different format replaces them. To replace offered hours, create a new schedule and assign it here.
3. **Book a meeting:** choose the event, meeting format, and a time, then enter your own name/email and confirm the invitation. You can also select **Book meeting** on an event card.
4. **Bookings:** switch between Upcoming, Pending, Past, and Cancelled. Every meeting shows the selected display time zone and its UTC offset at the meeting time. Use **Load more meetings** for additional pages.
5. **Cancel meeting:** enter a reason, confirm participants agreed, and choose **Confirm cancellation**. The reservation remains visible under **Cancelled**. Cal.com handles cancellation notifications.
6. **Reschedule:** find a new available time, confirm participants agreed, and save. Cal.com applies conflict checks and handles notifications.
7. **Refresh:** fetch the current data from Cal.com, including cancellations made outside the dashboard. Refreshing does not create, cancel, or resend meetings. Lists refresh automatically after successful changes; external changes appear when the list is reopened or refreshed.

No proposal/voting flow or automatic access to participants' private calendars is included. Pending organizer approval must still be handled through Cal.com. Payment, recurring, seated, hidden, and extra-required-field event types are not managed here. This dashboard implements the documented scheduling operations above, not every Cal.com account setting.

## Configure event details

Open **Events → Edit event**. The editor loads the event's current Cal.com values, including changes made outside this dashboard. Update the basics, availability schedule, format, and **Limits & buffers**, then select **Save event**.

| Control | Effect |
| --- | --- |
| Minimum notice | How far in advance a reservation must be made. Choose minutes, hours, or days; **0** allows short-notice bookings, subject to available hours and calendar conflicts. |
| Before / after event | Minutes reserved as a buffer around the meeting. **0** means no buffer. |
| Time-slot intervals | Use event duration automatically, or enter a custom interval between offered start times. |
| Limit booking frequency | Maximum bookings per day, week, month, or year. Leave unused periods blank. |
| Limit total booking duration | Maximum meeting minutes per period, in multiples of 15 minutes. |
| Limit future bookings | Calendar days, business days, or a specific date range. Optional rolling availability supports up to 61 available days. The dashboard searches at most one year ahead. |
| Limit upcoming bookings per person | Maximum active reservations per booker's email. The optional Cal.com rescheduling offer applies to its booking page; dashboard visitors can use **Bookings → Reschedule**. |
| More start-time options | Shift start times by an offset or offer only the first available slot each day. |

Switch a limit off to remove it. Choosing **Use event length (default)** resets a custom slot interval. Saving an existing event sends only changed scheduling settings, so unrelated policies are preserved. Changes affect new availability; existing reservations are not moved or cancelled. Return to **Book a meeting** and select **Find available times** to see the recalculated slots.

For example, with 120 minutes of minimum notice, a search at 3:59 AM first permits 5:59 AM; 30-minute slots start at 6:00 AM. Set minimum notice to 0 if short-notice reservations are intended. Cal.com can still enforce schedule-level minimum notice, calendar conflicts, buffers, and booking limits.

New events show a 2-hour notice default explicitly. Other limits start off. Payments, seats, recurrence, custom booking questions, confirmation policies, and account integrations remain outside this editor; existing unsupported event types stay excluded from the public workspace.

## Server environment setup

| Setting | Type | Value / purpose |
| --- | --- | --- |
| `CAL_ACCOUNT_EMAIL` | Environment variable | `hello@truemarch.fun`. The backend verifies that the API key belongs to this account. |
| `CAL_API_KEY` | **Secret** | Cal.com API key created while signed into the `hello@truemarch.fun` Cal.com account. Never expose it in frontend code. |
| `CAL_SESSION_SECRET` | **Secret** | At least 32 characters; protects anonymous visitor cookies and hashes. Preserve the existing secret when updating the site. |
| `CAL_EVENT_TYPE_IDS` | Optional environment variable | Comma-separated IDs of meeting types to offer, such as `123,456`. If omitted, eligible non-hidden event types from the service account are offered. New event creation is disabled when this allowlist is set, so newly created IDs cannot silently fall outside it. |
| `DB` | D1 binding | Declared in `.openai/hosting.json`; stores rate limits and short-lived booking receipts used to prevent duplicate submissions. |

There is no need for a visitor's Cal.com API key, Google OAuth, email verification code, or password. `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `GOOGLE_CLIENT_ID` are no longer used by the public flow. Existing values may remain in the environment without being used; invitations are handled by Cal.com.

### Prepare the organizer's Cal.com account

1. Sign into Cal.com as `hello@truemarch.fun` and create an API key under Settings → Security → API keys.
2. Connect the organizer's calendar/conferencing provider and set its availability.
3. Create a regular, free event type in the dashboard, or use Cal.com with guest invitations enabled. It must not require attendee login or email verification, seats, payment, recurrence, or additional required questions unsupported by this form.
4. Make the event type visible. Optionally restrict the page to selected event IDs with `CAL_EVENT_TYPE_IDS`.
5. Configure the event's confirmation and notification settings in Cal.com. If organizer approval is required, the dashboard displays a pending request rather than claiming the meeting is confirmed.

The server checks the Cal.com account before returning the public booking configuration and again before slot queries and new bookings. The API is stateless; no interactive connection is required from visitors. Missing or mismatched credentials disable booking and show a setup message.

### Enable Google Meet

The connected account currently offers Cal Video; Google Meet was not connected when this feature was configured. An API key alone does not connect a conferencing provider.

1. Sign into Cal.com as `hello@truemarch.fun` and connect the organizer's Google Calendar and Google Meet app. Complete Google's authorization for that organizer account.
2. Return to the dashboard, open **Events**, and refresh. Google Meet becomes available when Cal.com reports a valid connection.
3. Choose **Edit event**, select **Google Meet** under **Event meeting format**, and save.
4. Visitors select **Google Meet** in the booking form. Cal.com creates the meeting link as part of booking and sends the invitation according to the event's settings.

Visitors do not need Google accounts or dashboard accounts to submit a booking. Provider-specific joining policies still apply. To use an existing meeting URL instead of generating one, choose **Other video / meeting link** in the event settings and supply its HTTPS URL. Organizer links, addresses, and phone numbers are excluded from public event lists and appear in the invitation and booking receipt when Cal.com provides them.

See [Cal.com's conferencing API documentation](https://cal.com/docs/api-reference/v2/conferencing-apps.md) for provider connection requirements.

### Set the live website's variables

The existing Sites project is `appgprj_6af3dcec2e8c81918277a6876e1dd5a8`.

1. Open this project's hosted environment settings—the same settings used previously for `RESEND_API_KEY`.
2. Add **`CAL_API_KEY` as a secret** and `CAL_ACCOUNT_EMAIL=hello@truemarch.fun` as an environment variable. Keep the existing `CAL_SESSION_SECRET`.
3. Keep `DB` in the hosting manifest. Sites applies the committed Drizzle migrations when deploying.
4. Deploy a saved version after changing environment variables so the running website receives the new values.
5. Open the website. Available meeting types indicate that the backend has verified the account. A real test booking sends real invitations; use participants who have agreed to it.

**Local `.env.local` and hosted environment settings are separate.** Saving a key locally does not update the live website. Keep all credentials out of Git, client-side variables, screenshots, and chat messages.

### Run locally

Requires Node.js 22.13 or later. From `meeting-dashboard/`:

```sh
npm run install:ci
```

Copy `.env.example` to `.env.local` for a new setup. If `.env.local` already exists, edit it without overwriting existing secrets. Fill in the Cal.com key, organizer email, and session secret.

Generate a secret only for a **new environment**:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Build to generate the Worker configuration:

```sh
npm run build
```

For a **fresh local database**, apply both migrations once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dizzy_dark_phoenix.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_perpetual_pretty_boy.sql
npm run dev
```

For an existing local database that already has migration 0000, apply only 0001. Local and production databases are independent. Open the printed local URL (normally `http://127.0.0.1:5173`). `npm run start` previews the production build locally.

## Public API boundaries

- `GET /api/public/config`: verifies the service account and returns organizer contact plus a minimal list of eligible meeting types. Sets an anonymous encrypted HttpOnly cookie; this is not account registration.
- `GET /api/public/slots`: returns available times only for eligible service-account meeting types.
- `POST /api/public/bookings`: accepts the visitor's name/email, time, meeting type, required format, any required location details, notes, and consent; validates the format against the event and the provider connection; the server fixes the other participant to Travis Ruiz (`info@truemarch.fun`). The server constructs the Cal.com payload and never forwards arbitrary guest lists, authentication, host overrides, or conflict-bypass flags.
- `GET /api/public/receipt`: retrieves one submitted request's result, scoped to the same anonymous browser cookie and request ID.
- `GET /api/public/formats`: returns format labels and connection availability without provider credentials.
- `GET /api/public/schedules` and `POST /api/public/schedules`: list availability schedules and create a separate schedule with weekly hours and date overrides.
- `GET /api/public/event-types/:id`: loads current basics and allowlisted scheduling settings for an eligible event.
- `POST /api/public/event-types` and `PATCH /api/public/event-types/:id`: create/edit public event types with a validated schedule owned by the service account and an explicitly selected, available meeting format. Scheduling settings are validated and mapped to Cal.com API v2 fields; arbitrary settings are rejected.
- `GET /api/public/bookings`: list sanitized reservations for eligible public event types, with status filters and cursor pagination.
- `POST /api/public/bookings/:uid/cancel` and `/reschedule`: verify event eligibility, require participant agreement, and submit the supported change. No bypass flags or arbitrary Cal.com paths are forwarded.
- Old `/api/auth/*` and `/api/cal/*` endpoints return 404, including for browsers with old authenticated sessions.

Every booking and management write uses an idempotency key. A D1 record is claimed atomically before submitting to Cal.com. Repeated requests with the same visitor, key, and details return the stored result. They do not create another booking. This protects request retries, not deliberately new bookings submitted from another browser or with a new request ID.

If an upstream request times out, the result is treated as uncertain because Cal.com might already have created the meeting. The UI blocks another submission, preserves the pending request ID in sessionStorage, and offers **Check booking status**. An uncertain upstream result may require checking email or asking the organizer; the app does not automatically repeat it or claim to reconcile all ambiguous results.

Management writes are limited to 20/hour per IP and 100/hour overall. Public endpoints have persistent rate limits: 90 reads/minute per IP and 1,000/minute overall; booking attempts are limited to 5/hour per IP, 5/hour per visitor email (the fixed Travis recipient does not consume a shared per-email quota), and 100/hour overall. The limits use fixed time buckets and keyed hashes rather than storing raw IP addresses in the counter table. Existing Cal.com booking limits and conflict checks also apply.

Visitor cookies last 24 hours. Booking request records, fingerprints, and minimal receipts expire after seven days and are deleted during later configuration requests; raw request bodies are not stored. The pending browser values contain only request IDs. Management changes also retain uncertain operations across reloads and provide Check change status; users can clear the notice after independently verifying the result in the relevant list. Writes are never automatically repeated. A receipt can contain names, a meeting link, and a booking reference, so it is only returned to its originating visitor session. Old email-authentication tables are retained to avoid deleting existing data but are not used for sign-in.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Booking is not available yet | Add `CAL_API_KEY`, verify `CAL_ACCOUNT_EMAIL`, retain a valid session secret and `DB`, then redeploy. |
| Account does not match configuration | The API key must belong to the exact email in `CAL_ACCOUNT_EMAIL`. |
| No meeting types available | Create a visible regular event type, enable guests, remove unsupported booking requirements, and check any `CAL_EVENT_TYPE_IDS` restriction. |
| Google Meet is not connected | Connect Google Calendar and Google Meet for the organizer in Cal.com, refresh Events, and assign Google Meet to the event. |
| No meeting formats available | Edit the event and select a supported format. |
| No slots | Check the date/time zone and organizer's availability, connected calendars, minimum notice, and limits. |
| Booking requirements could not be met | The slot may have been taken or the event has additional requirements. Choose another slot or contact the organizer. |
| Booking result is uncertain | Use Check booking status, check both recipients' email, or contact the organizer before trying again. A retry could otherwise create a duplicate. |
| Too many requests | Wait for the applicable rate-limit window. |
| No invitation | Check Spam and Cal.com's approval/notification settings. A pending request is not a confirmed meeting. |

## Verification

```sh
node tests/public-booking.test.mjs
node tests/public-worker.test.mjs
node tests/meeting-time.test.mjs
npx tsc --noEmit
npm run build
```

With `npm run dev` on port 5173 and Playwright/Chromium available:

```sh
node tests/browser-check.mjs
node tests/management-browser.mjs
```

If Playwright is installed outside the project, set `PLAYWRIGHT_MODULE` to its absolute module entry path. Browser checks mock the public API and create no real bookings. Backend checks use real SQLite migration SQL and mocked Cal.com responses. A real account connection and invitation delivery require separate live verification.

Main files: `app/page.tsx` (workspace and booking form), `app/workspace-management.tsx` (events, schedules, and bookings), `app/event-settings-fields.tsx` (scheduling controls), `lib/event-settings.mjs` (settings validation), `app/theme-toggle.tsx`, `app/globals.css`, `lib/public-booking.mjs` and `lib/shared-management.mjs` (restricted server API), `lib/meeting-formats.mjs` (format validation and provider availability), `lib/secure-session.mjs`, `worker/index.ts`, and `db/schema.ts`/`drizzle/`.

The former per-user authentication/gateway modules and their unit tests are historical, unmounted code. The historical [Cal.com analysis](docs/cal-com-analysis.html) describes an earlier account-based dashboard and is not this shared workspace's user guide.
