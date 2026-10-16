# email-worker (design 07 section 1.4 / 1.6, migration m62)

Delivers the rows of `app_private.email_outbox` through the **Gmail API**, one message per recipient, as the acting PM's connected Google account (fallback: the `startups@athareg.com` system sender when the template allows it). The browser never sends mail: every producer (Selection, Booking, staff invitations, form notifications, Alumni later) only INSERTS a row; this function sends it. Code: `../_shared/email-worker.js` (all the logic, pure, 71 tests) and `../_shared/email-worker-edge.js` (the request handler); `index.ts` is 10 lines.

```
POST /functions/v1/email-worker          header  x-worker-secret: <EMAIL_WORKER_SECRET>        (or  Authorization: Bearer <service role key>)
body (optional, numbers only, they can only LOWER the configured limits)   { "maxMessages": 50, "maxRunSeconds": 30, "perMinute": 10, "dailyCap": 500, "batch": 5 }
-> 200 { worker, runs, claimed, sent, retried, failed, needs_review, blocked, held, released, skipped, requeued, reviewed, stopped, elapsed_ms }   COUNTS only, never an address
   401 unauthorized      405 method_not_allowed      503 not_configured { missing: [env NAMES] }
```

* **No JWT at the gateway** (`verify_jwt = false`, like `image-convert` and the Google callback): the caller is the database (pg_cron + pg_net) or a script, neither holds a user session. The function checks its own secret FIRST (constant-time) and is **closed when none is configured**. Nothing in the request can name a recipient, a subject or a body: the function sends only what the database claimed.
* **Local**: `bash db/scripts/dev-functions.sh up` (it adds `EMAIL_WORKER_SECRET` to `local-db/functions.env` and serves the function), then `bash db/scripts/trigger-email-worker.sh` (one run now) or `bash db/scripts/email-worker-schedule.sh enable` (pg_cron every minute; `disable` / `status` / `kick`). The Google side is the fake server while `ALLOW_FAKE_GOOGLE=1`.
* **Proof**: `node db/scripts/verify-email-worker.mjs` (103 checks end to end on the real runtime + the real database + the fake Google), `node --test "supabase-new/functions/_shared/tests/*.test.js"`, `db/verify/v62_email_worker.sql` (167).

## Environment names (values never in git)
| Name | Meaning |
|---|---|
| `EMAIL_WORKER_SECRET` | shared secret (>= 24 characters, random) between the database and this function. The SAME value goes to `app_private.email_worker_enable(url, secret)` (stored in Vault) |
| `GOOGLE_*`, `APP_URL`, `OAUTH_STATE_SECRET`, `TOKEN_STORAGE`, `TOKEN_ENC_KEY` | the Google core (m61): the worker mints access tokens from the stored refresh tokens (`_shared/google-core.js`) |
| `EMAIL_PER_MINUTE` (30), `EMAIL_DAILY_CAP` (1500), `EMAIL_MAX_RUN_SECONDS` (100) | optional ceilings; a request body can only go below them. 30 a minute is half of what Gmail allows through the API; 1,500 a day is below Google's 2,000 per user (decision 07-12) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | injected by the runtime |

## What the worker does with a row (the rules, each one has a test)
1. **Claim** (`email_worker_claim`, SQL): one advisory lock + `FOR UPDATE SKIP LOCKED`; expired leases are reaped first; the sender is resolved per row (the acting PM's active connection, else the system sender when the template's `fallback_to_system` is not `false`; booking e-mails use the node's organizer; form notifications default to the system sender; a still-usable pinned sender wins); the per-sender quota (a rolling minute and a rolling 24 h, in-flight claims counted) holds rows back with `next_attempt_at` and a visible `blocked_reason` (`rate_limited` | `daily_cap` | `sender_needs_reconnect` | `no_sender` | `worker_config`).
2. **Build** the MIME message from the STORED row (UTF-8 Arabic subjects as RFC 2047 words, text + HTML parts, CC and Reply-To from the template, an invalid CC address is dropped, an invalid recipient is a permanent failure). Message-ID = `<outbox id.attempt@sender-domain>`.
3. **Mark** (`email_worker_mark_sending`): persists "the request is about to leave" BEFORE the HTTP call. A crash after this point = unknown outcome; before it = a harmless requeue.
4. **Send** (`users.messages.send`) and **finish** (`email_worker_finish`):

| Answer | Outcome |
|---|---|
| 200 with a message id | `sent` (Gmail id + Message-ID stored; the audit row has the id, the sender, the masked recipient) |
| timeout / connection reset after the request left, a 200 without an id, any exception we did not foresee | **`needs_review`, NEVER resent automatically** (a PM can mark it sent, send it again on purpose = a new Message-ID, or cancel) |
| 401 | one retry with a fresh token; again 401 -> the connection is marked `needs_reconnect` |
| `invalid_grant` (token refresh) | connection `needs_reconnect`; the rows go back to the queue with `blocked_reason = sender_needs_reconnect` and, when the template allows, go out from `startups@` on the next claim |
| 429 / 403 rate limit / 5xx / connection refused | `retry`: exponential backoff with jitter (30 s, 1 min, 2 min ... max 30 min, `Retry-After` honoured), `failed` with `max_attempts` after 6 in a row |
| Gmail daily limit | `blocked daily_cap` (the sender waits an hour) |
| 400 / other 4xx | `failed` with a code the UI translates (`rejected_by_gmail`, `invalid_recipient`, `forbidden` ...) |
| Gmail API not enabled | `blocked worker_config` (15 minutes) |

Nothing is logged except ids, counts and fixed codes: no address, subject, body, token or secret (tested on the real runtime log).

## Scheduling
* **Local / any Postgres with pg_cron + pg_net**: `bash db/scripts/email-worker-schedule.sh enable` (or, in a SQL editor, `select app_private.email_worker_enable('<functions base url>', '<EMAIL_WORKER_SECRET>')`): two cron jobs (`athar-email-worker` every minute, `athar-email-maintenance` nightly: bodies of finished mail are dropped after 90 days) and the secret in Vault. The database reaches the function over pg_net (`http://kong:8000/functions/v1` locally). **Nothing is scheduled by the migration itself.** "Send now" in the Outbox releases a project's waiting rows and kicks the worker through the same path.
* **Production (Supabase hosted)**: deploy with `supabase functions deploy email-worker --no-verify-jwt` (or `[functions.email-worker] verify_jwt = false` in `config.toml`), `supabase secrets set EMAIL_WORKER_SECRET=...` (plus the Google secrets of docs/design/10), then run `app_private.email_worker_enable('https://<project-ref>.supabase.co/functions/v1', '<the same secret>')` once. Without pg_cron any scheduler that can POST the URL with the header every minute works (`db/scripts/trigger-email-worker.sh --url ...`).
* Overlapping runs are safe (lease + advisory lock): a slow run and the next tick never send the same row. A run stops after about 100 s (the hosted wall clock is 150 s); the next tick continues.

## Operating it
* The super_admin page `/admin/email` shows the worker's last run (a heartbeat the worker writes), whether the scheduler is on, the queue (due / waiting / held back / sending / needs review / oldest), each sender against 30 a minute and 1,500 a day, and why mail is held back. A silent worker with mail waiting is shown as stalled.
* A PM sees `/projects/:id/outbox` (filters, details, retry / cancel / mark as sent / send again, bulk, "Send now"); the Selection E-mails tab, the Booking Bookings tab and the staff invitations list show the real delivery state.
* Searching a possibly delivered message: the Outbox detail shows `rfc822msgid:<outbox id.attempt@domain>` to paste into Gmail's search box.
