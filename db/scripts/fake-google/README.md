# Fake Google (local tests only)

`server.mjs` (Node built-ins only, no install) imitates the parts of Google the platform talks to, so the OAuth flow, the e-mail worker and the calendar sync can run end to end **without ever calling a real Google endpoint**. It is the test double of `supabase-new/functions/_shared/google*.js` and of every later worker. It is **not secure** (random tokens, no real signatures, no authentication on its control endpoints): bind it to loopback and never expose it.

```
node db/scripts/fake-google/server.mjs --port 54399                 # auto-approving consent (login_hint or --default-email)
node db/scripts/fake-google/server.mjs --port 54399 --interactive   # shows a consent page (pick the account, untick a scope, Deny)
node db/scripts/fake-google/server.mjs --host 0.0.0.0 ...           # only when a container (the edge runtime) must reach it: http://host.docker.internal:54399
```
Options / env: `--client-id` / `FAKE_GOOGLE_CLIENT_ID`, `--client-secret` / `FAKE_GOOGLE_CLIENT_SECRET` (when set they are enforced), `--redirect-uri URL` (repeatable) / `FAKE_GOOGLE_REDIRECT_URIS` (when set the authorize endpoint accepts exactly these), `--default-email` / `FAKE_GOOGLE_DEFAULT_EMAIL` (default `fake.user@athareg.com`), `--verbose`, `--port` / `FAKE_GOOGLE_PORT` (default 54399), `--host` / `FAKE_GOOGLE_HOST`. Ports 5433-5532 and 5174 are reserved by Windows on the owner's machine: 54399 is not.

From a test: `const g = await startFakeGoogle({ port: 0 }); g.url; g.state; g.reset(); g.nextAccount({...}); g.inject({...}); await g.close()`.

## Pointing the platform at it (instead of Google)
In the functions' env file (names only): `ALLOW_FAKE_GOOGLE=1`, `GOOGLE_AUTH_BASE=http://<host>:54399`, `GOOGLE_TOKEN_URL=http://<host>:54399/token`, `GOOGLE_REVOKE_URL=http://<host>:54399/revoke`, `GOOGLE_API_BASE=http://<host>:54399`, plus any non-empty `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Without `ALLOW_FAKE_GOOGLE=1` the functions refuse every `GOOGLE_*` address override. See `functions.env.example`.

## What it implements
| Area | Endpoints / behaviour |
|---|---|
| OAuth authorize | `GET /o/oauth2/v2/auth`: checks `response_type=code`, client id, **exact registered redirect URI**, scope, `code_challenge_method=S256`; signs in as the queued account (`/__control/next-account`), else `login_hint`, else the default; `access_type=offline` + (`prompt=consent` or a first grant) issues a refresh token (a repeat grant without `prompt=consent` does NOT, like Google); the granted `scope` reports `email` as `.../auth/userinfo.email`; deny and granular consent (un-ticked scopes) are simulated |
| Token | `POST /token`: `authorization_code` (single-use code, 10 min, redirect uri + client + **PKCE S256 verifier** checked) and `refresh_token`; returns `access_token` (1 h by default), `refresh_token`, `scope`, `id_token` (unsigned JWT with `iss`, `aud`, `sub`, `email`, `email_verified`, `hd`) ; `invalid_grant` for unknown / revoked tokens; `invalid_client` for a wrong secret |
| Other | `GET /oauth2/v3/userinfo`, `POST /revoke` (a refresh token takes its access tokens with it; unknown -> 400 `invalid_token`) |
| Gmail | `POST /gmail/v1/users/me/messages/send`: needs a live bearer with `gmail.send`; decodes and RECORDS the message (headers unfolded, RFC 2047 words decoded, multipart parts decoded, **a `problems` list** for anything a strict MTA would reject: bare LF, a non-ASCII header byte, missing Date / Message-ID / MIME-Version, header lines > 998) |
| Calendar | `POST/GET/PATCH/DELETE /calendar/v3/calendars/{primary or the account's e-mail}/events[/{id}]`: needs `calendar.events`; id alphabet a-v + 0-9 (5-1024) and **409 for a duplicate id (also a cancelled one)**; `start`/`end` need an offset or a `timeZone` (400 otherwise, like Google); attendees validated; `conferenceData.createRequest` creates a Meet link **only with `conferenceDataVersion=1`**, `pending` first and `success` (video entry point + `hangoutLink`) after `meetPendingGets` reads (`meetAsync=false` = immediately); `sendUpdates` recorded; delete leaves a `cancelled` event (a second delete = 410, `PATCH status=confirmed` restores it) |
| Inspection | `GET /__state` (tokens masked; `?include_tokens=1` shows them), `GET /__messages`, `GET /__events`, `POST /__reset` (state AND config back to the start), `GET /__health`. Every non-`/__` request is listed in `state.calls` with its status, so a test can prove "zero Google calls" |

## Control endpoints (JSON bodies)
* `POST /__control/next-account` `{ email, hd?, email_verified?, sub?, deny?, scopes_denied? }` (queued, one per authorize; `hd: null` = a consumer account without the hosted-domain claim)
* `POST /__control/config` `{ accessTokenTtlSec, meetAsync, meetPendingGets, interactive, clientSecret, redirectUris, defaultEmail, codeTtlSec }`
* `POST /__control/inject` `{ target, mode, times = 1, after = 0, retryAfter, match }` with
  * `target`: `token`, `revoke`, `gmail.send`, `calendar.insert|get|patch|delete` or `*`
  * `mode`: `invalid_grant` (token only), `401`, `403` (rate limit), `429` (+ `Retry-After`), `500`, `503`, `timeout-before-accept` (nothing recorded, never answers), `timeout-after-accept` (**recorded / created, never answers**: the unknown-outcome case), `reset-after-accept` (recorded, connection destroyed)
  * `match`: `{ recipient }` (substring of To/Cc), `{ refreshToken }`, `{ eventId }`
* `POST /__control/expire-access-tokens`, `POST /__control/revoke-all` `{ email }` (the user removed the app at Google), `POST /__control/clear-injections`

## Tests
`supabase-new/functions/_shared/tests/fake-google.test.js` tests the server itself; `google-api.test.js` and `google-oauth-flow.test.js` use it. `mime-parse.mjs` is an independent MIME reader (different code from `google-mime.js` on purpose).

## Added for the calendar sync tests (m63)
* `POST /__control/clear-calls` empties the request log (`state.calls`) and the counters (a test then proves "zero Google calls" from that moment).
* `POST /__control/purge-event` `{ email, id }` removes an event for good (Google purges deleted events after a while: a get answers 404).
* `match: { eventId }` of `/__control/inject` scopes a failure to ONE booking's event id (`calendar.insert|get|patch|delete`): two tasks can share the running fake without disturbing each other. `GET /__state` stamps every call with the time its request STARTED (`calls[].t`), so a test can count the calls since a timestamp without clearing anything.
* A process started BEFORE this change does not know the two new control endpoints (restart it: `bash db/scripts/dev-functions.sh restart`); `db/scripts/verify-calendar-sync.mjs` therefore uses only `match.eventId` and the timestamps, and the in-process tests (`calendar-sync.test.js`) start their own fake.
