# calendar-sync (design 07 section 2; migration m63): the ONE path to Google Calendar / Meet

`POST /functions/v1/calendar-sync` with the **service-role key** (the gateway accepts any valid JWT, including the public anon key, so the function checks the key itself: anon / a signed-in PM = `401 unauthenticated`, GET = 405). Answers `{ ok, mode, claimed, done, skipped, retried, parked, dead, deferred, lease_lost, shadowed, errors }` (counts only: no name, no address, no token).
It replaces `process-booking`, `generate-google-meet`, `notify-google-apps-script`, both Apps Script files and the every-minute poller (`docs/design/07` 2.3; the retirement order is the "Calendar cut-over runbook" in `web/PROGRESS.md`).

| File | What |
|---|---|
| `index.ts` | the Deno entry: caller check, builds the worker with the Edge runtime (`createEdgeRuntime`: config, token store, `accessTokens()`), runs ONE pass |
| `../_shared/calendar-sync.js` | the pure logic (no Deno / Node API): `planJob` (what must happen for one job), the executor (insert-or-adopt, patch, delete, Meet), failure classification + backoff, the RPC adapter `createCalendarDb` (+ `CALENDAR_RPC_CONTRACT`) and `createCalendarWorker` |
| `../../../db/migrations/m63_calendar_sync.sql` | the database side (mode flag, claim / complete / fail / park RPCs, shadow log, owner decision, overview) |

## The three modes (`app_private.calendar_sync_config.mode`, switched by a super_admin in Booking > Settings > Calendar; default **shadow**)
| mode | a pass does |
|---|---|
| `off` | nothing is claimed or planned; bookings are saved and their jobs wait |
| `shadow` | every pending job is PLANNED with the same code path as live and the plan is written to `calendar_sync_log`; **no Google endpoint is called (not even the token endpoint), no job is locked or completed**, so the Apps Script poller (through the `poller_*` bridge) can keep working next to it. No Google credentials are needed to run in shadow |
| `live` | jobs are claimed (`FOR UPDATE SKIP LOCKED` + a 5-minute lease, one job per booking at a time in creation order, an expired lease is reclaimed, six expired leases = dead), executed against Google AS the booking's calendar owner, written back; the poller bridge and the generic claim step aside (`poller_claim_bookings` returns nothing while live) |

## One job, step by step (live)
1. `calendar_job_context(job)` returns everything from stored data: booking, slot (UTC), provider e-mail, the node's cc / admin lists, the project time zone, the Meet mode + shared link, the calendar-owner decision. Nothing comes from the request.
2. `planJob` decides: `create` / `patch` / `delete` / `skip` (`migrated`, `past`, `never_synced`, `restored`, `booking_gone`) / `park` (`needs_connection`, `needs_reconnect`) / `fail` (a configuration error: `shared_link_required`, `shared_link_invalid`, `invalid_timezone`, `invalid_time`).
3. Execute: event id = the booking uuid as 32 hex digits (a migrated booking keeps its legacy id); `events.insert`, a 409 means "it exists" -> `events.get` and ADOPT it (patch only when it differs; a cancelled one is brought back with `status: confirmed`); `unique` Meet = `conferenceData.createRequest` (requestId = booking id) + a bounded poll, `shared` = the node's link in `location` + `description` (an EMPTY link is an error, never a silent unique link); times in the project zone (`dateTime` with the zone's own offset AND `timeZone`, DST-correct); attendees = booker + provider + cc / admin lists, lower-cased, de-duplicated, invalid ones dropped, the organizer left out; `sendUpdates = all`.
4. `calendar_note_event` as soon as Google accepted the event (the calendar that holds it is FROZEN from then on: a cancel / reschedule always reaches that calendar, never another one), then `calendar_complete_job` writes `meet_link` + owner + `synced_at` and the result (`action`, `event_id`, `html_link`, counts; no address) in one transaction, fenced by the attempt number (a stale worker cannot complete a reclaimed job).

## Failures
| What happened | Result |
|---|---|
| HTTP 429 / 5xx / timeout / network / Meet not ready yet | `failed`, retried after `max(Retry-After, 30 s x 2^(attempt-1) +/- 20 %, cap 30 min)`, `dead` after 6 attempts |
| **timeout AFTER Google accepted the event** | the retry gets 409 and adopts the event: no duplicate (tests: `calendar-sync.test.js`, `verify-calendar-sync.mjs`) |
| HTTP 400 / 403 / 404 / a configuration error | `dead` at once with a short code; the Bookings tab shows the problem in words and a Retry button (`retry_calendar_job` starts again with attempts = 0) |
| `invalid_grant` (the PM removed the app / Google expired the grant) | the connection becomes `needs_reconnect`; the job is PARKED (`pending`, no attempt counted, code `needs_reconnect`): a NEW event falls back to the node owner's other candidates and then the system sender (`startups@`), an event that already lives on that PM's calendar WAITS for him; reconnecting makes parked jobs due at once (trigger) |
| no connection at all | PARKED with `needs_connection`, same wake-up |

## Local run / tests
```
bash db/scripts/dev-functions.sh up                 # runtime + fake Google
bash db/scripts/calendar-sync-run.sh                # one pass (what pg_cron does every minute)
node --test "supabase-new/functions/_shared/tests/*.test.js"      # pure logic + the worker against the fake Google (in-memory database twin)
node db/scripts/verify-calendar-sync.mjs            # END TO END on the real runtime + real DB + fake Google (~80 checks)
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v63_calendar_sync.sql     # the SQL (126 checks, rolled back)
node db/verify/v63_calendar_concurrency.mjs         # two real database sessions racing for the same jobs
```
Scheduling on a real project: `db/scripts/calendar-sync-schedule.sql` (pg_cron + pg_net, service key in Vault; not part of any migration).

## What is NOT here
No deployment (nothing is deployed anywhere), no real Google call (the real OAuth client is the owner's step, `docs/design/10-google-integration-setup.md`), no "move this booking to the system calendar" action for an event whose owner left (the job waits; open question in `web/PROGRESS.md`).
