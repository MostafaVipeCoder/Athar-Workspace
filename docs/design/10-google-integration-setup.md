# Design 10 - Google integration setup (the steps the owner performs)

Status: **instructions for the owner**. Nothing here was done from the repository: creating the Google Cloud project, the OAuth client and the Workspace settings needs a person with the right Google account. The code that uses the result is built and tested against a **fake Google server** (`db/scripts/fake-google/`), so nothing in this document is needed to run the tests; it is needed before the first real "Connect Google" click.

Context: owner decision 08 section 20.6 (each PM connects THEIR OWN Google Workspace account; the e-mail sender is the acting PM with automatic fallback to the system account `startups@athareg.com`), design 07 sections 1-3 (architecture), `web/PROGRESS.md` ("Google OAuth core" section) for what was built.

**Never paste a client secret, a token or a key into a chat, a ticket or the repository.** The two values you create in step 5 go only into the git-ignored file named in step 6.

---

## 0. What you will end up with

| Thing | Where it lives | Who creates it |
|---|---|---|
| A Google Cloud **project** named `Athar Platform` inside the Athar Workspace organization | Google Cloud Console | owner / Workspace admin |
| The **Gmail API** and **Google Calendar API** switched on for that project | same project | same |
| An **OAuth consent screen** of type **Internal** (only `@athareg.com` accounts can use it) | same project | same |
| One **OAuth client** (type "Web application") = a **client ID** (public) + a **client secret** (private) | same project | same |
| The client ID and secret stored as **server secrets** of the local stack (later: of the live project) | `local-db/functions.env` (git-ignored) | owner |
| The **system sender** `startups@athareg.com` linked once | the platform, Profile > Google account | a super_admin |
| Every PM's own connection | the platform, Profile > Google account | each PM |

Scopes the platform asks for (and nothing else): `gmail.send` (send e-mail), `calendar.events` (create / change / cancel calendar events with a Meet link), plus `openid` and `email` (to learn which account was connected). It cannot read anybody's mail, contacts or existing events.

You will need: a Google account that is a **Workspace super admin or has the "Project Creator" role on the organization** `athareg.com` (08 section 11 says the organization has such an admin), and about 30 minutes.

> The Google console renames menus now and then. Names in "quotes" below are what the console showed when this was written. If a label differs, look for the same words (for example **Google Auth Platform** is the new home of what used to be called **OAuth consent screen**).

---

## 1. Create the project inside the organization

1. Open <https://console.cloud.google.com/> signed in as the admin account (an `@athareg.com` account, **not** a personal Gmail).
2. At the top left click the **project picker** (it shows the current project name) > **New project**.
3. **Project name:** `Athar Platform`. (Do **not** reuse `athar-meet-generator`: that project and its service account were deleted on 2026-10-12, decision 08 section 12.)
4. **Organization:** choose `athareg.com`. **Location:** the organization (or a folder the admin prefers). If the Organization field is empty or missing, you are signed in with a personal account: stop and sign in with the Workspace account, because an **Internal** consent screen (step 3) exists only for projects that belong to the organization.
5. Click **Create**, wait for the notification, and make sure `Athar Platform` is the selected project (top bar).

## 2. Turn on the two APIs

1. Menu **APIs & Services > Library**.
2. Search **Gmail API** > open it > **Enable**.
3. Search **Google Calendar API** > open it > **Enable**.
   (Meet links are created through the Calendar API: no separate "Meet API" is needed.)

## 3. The consent screen: type Internal

Menu **APIs & Services > OAuth consent screen** (new console: **Google Auth Platform**). If you see **Get started**, click it and fill the four steps:

| Step | Field | Value |
|---|---|---|
| App information | **App name** | `Athar Platform` (this is the name each user sees on the Google permission screen) |
| | **User support email** | `startups@athareg.com` (or the owner's address) |
| Audience | **User type** | **Internal** (NOT External). This is the whole point: only accounts of your organization can connect, and Google does **not** require app verification. |
| Contact information | **Email addresses** | the owner's address (Google writes here about changes to the app) |
| Finish | the user-data policy box | tick it, **Continue**, **Create** |

Then fill the optional pages (**Branding**): app logo (the Athar logo, 120x120 px, optional), **Application home page** `https://athareg.com`, **Authorized domain** `athareg.com`, **Developer contact** the owner's address. Save.

### Scopes ("Data access")

Open **Data access** (older console: "Edit app > Scopes") > **Add or remove scopes**, tick or paste exactly these four, **Update**, **Save**:

| Scope | What Google calls it |
|---|---|
| `openid` | "Associate you with your personal info on Google" |
| `.../auth/userinfo.email` | "See your primary Google Account email address" |
| `https://www.googleapis.com/auth/gmail.send` | "Send email on your behalf" |
| `https://www.googleapis.com/auth/calendar.events` | "View and edit events on all your calendars" |

(`gmail.send` is a "sensitive" scope, not a "restricted" one. For an Internal app neither needs Google's review.)

## 4. Allow the app in the Workspace admin console (only if API access is restricted)

If your Workspace blocks third-party apps, users will see "Access blocked" even for an Internal app. A **super admin** checks once:

1. <https://admin.google.com/> > **Security > Access and data control > API controls**.
2. Under **Settings** make sure **Trust internal, domain-owned apps** is ticked (then Internal apps are trusted automatically and you can skip to step 5), **or** do the explicit way:
3. **Manage Third-Party App Access > Add app > OAuth App Name Or Client ID**, search for the **client ID** you create in step 5 (or `Athar Platform`), select it, **Select**, choose the scope **All in organization** (or the organizational unit that holds the PMs), then **Trusted** (or "Specific Google data" and allow the Gmail and Calendar scopes), **Configure** / **Finish**.
4. If **Gmail** or **Calendar** access for third-party apps is switched off under **Apps > Google Workspace > Gmail / Calendar** for the PMs' organizational unit, switch the API access back on for that unit. Changes can take up to an hour to apply.

(If you do this step before step 5 you cannot search the client ID yet: do it after step 5.)

## 5. Create the OAuth client (Web application)

1. **APIs & Services > Credentials > Create credentials > OAuth client ID** (new console: **Google Auth Platform > Clients > Create client**).
2. **Application type:** **Web application**. **Name:** `Athar Platform web`.
3. **Authorized JavaScript origins:** leave empty (the exchange happens on the server, no browser script talks to Google).
4. **Authorized redirect URIs:** click **Add URI** for each line, **exactly** as written (scheme, host, port, path: Google compares them character by character):

   | Use | URI |
   |---|---|
   | Local stack (the only one needed now) | `http://127.0.0.1:54321/functions/v1/google-oauth-callback` |
   | Production (add it later, step 8) | `https://<your-supabase-project-ref>.supabase.co/functions/v1/google-oauth-callback` |

   Google allows plain `http` only for `localhost` / `127.0.0.1`: that is why the local one works without HTTPS.
5. **Create.** A box shows the **Client ID** (ends with `.apps.googleusercontent.com`) and the **Client secret**. **Copy both into the file of step 6 now** (or use **Download JSON** and delete the download after copying). If the secret is no longer shown later: open the client > **Add secret**, copy the new one, then **Disable / Delete** the old one.

## 6. Where the values go (names only; the values never leave your machine)

Create or edit **`local-db/functions.env`** (the `local-db/` folder is git-ignored, see `.gitignore`; check with `git check-ignore local-db/functions.env`). The local edge-function runner reads it with `--env-file`. Variable **names** and what they hold:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID from step 5 |
| `GOOGLE_CLIENT_SECRET` | the client secret from step 5 |
| `GOOGLE_REDIRECT_URI` | `http://127.0.0.1:54321/functions/v1/google-oauth-callback` (must equal the URI registered in step 5, character for character) |
| `APP_URL` | where the browser is sent after Google: `http://127.0.0.1:5174` for `npm run dev:local` (production: the https address of the app, including its base path) |
| `OAUTH_STATE_SECRET` | a random string of at least 32 characters, made once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `EMAIL_WORKER_SECRET` | the secret shared by the database scheduler and the `email-worker` function, at least 24 random characters. `dev-functions.sh up` generates it; in production it is a NEW value (section 10). The worker refuses every call while it is not set |
| `TOKEN_ENC_KEY` | only when Supabase Vault is not used: 64 hexadecimal characters, made once: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The local image has Vault, so this is a spare. **Keep a copy of it in the password manager: without it, tokens stored with it cannot be read.** |
| `ALLOWED_GOOGLE_DOMAIN` | `athareg.com` (default) |
| `SYSTEM_SENDER_EMAIL` | `startups@athareg.com` (default) |
| `GOOGLE_PM_EMAIL_POLICY` | `same_email` (default: a PM must connect the Google account that has the same e-mail address as his platform login) or `same_domain` (any `@athareg.com` account) |
| `ALLOWED_ORIGINS` | optional, comma separated; default = the origin of `APP_URL` |
| `TOKEN_STORAGE` | optional: `auto` (default: Vault if available, else AES), `vault`, `aes` |

**Test-only variables** (used only while the local functions talk to the fake Google, see the appendix): `ALLOW_FAKE_GOOGLE=1`, `GOOGLE_AUTH_BASE`, `GOOGLE_TOKEN_URL`, `GOOGLE_REVOKE_URL`, `GOOGLE_API_BASE`. **Delete these five lines before you use the real client.** The code refuses to start with any `GOOGLE_*` address override unless `ALLOW_FAKE_GOOGLE=1`, so a leftover cannot send real tokens to a fake server (or the other way round).

You normally do **not** write this file by hand: `bash db/scripts/dev-functions.sh up` generates it the first time (random `OAUTH_STATE_SECRET`, `TOKEN_ENC_KEY` and `EMAIL_WORKER_SECRET`, placeholder Google values, the five fake-Google lines), serves every function of `supabase-new/functions` on the local stack's edge runtime and starts the fake Google. To use the REAL client you only put the two real values into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, delete the five test-only lines and run `dev-functions.sh restart` (db/README.md, "Replacing the fake Google by the REAL credentials"). The functions that read these values are `google-oauth-start`, `google-oauth-callback` and `google-disconnect` (this document), plus `email-worker` and `calendar-sync`, which mint access tokens from the same stored connections (section 10). If the Connect button answers "Connecting Google is not set up on this server yet", the functions are not running or a required value is missing: `bash db/scripts/dev-functions.sh status` names what is missing (names only, never a value).

## 7. Link the system sender (`startups@athareg.com`), once

1. Make sure `startups@athareg.com` is a normal Workspace **user** (own Gmail and Calendar licence, not a Group and not an alias). You administer it (08 section 11).
2. In the platform sign in as a **super_admin** > avatar menu > **Profile** > section **Google account** > card **System sender (startups@athareg.com)** > **Link the system sender**.
3. On the Google screen choose **Use another account** if needed and sign in as `startups@athareg.com`, read the permissions and **Allow** (tick both the mail and the calendar boxes if Google shows them separately).
4. You return to the Profile page with "The system sender is connected." The card now says "Linked as startups@athareg.com".
   * If you picked another account the platform answers "The system sender must be the startups@athareg.com account." and stores nothing (the grant is revoked at Google at once).
5. The system sender is used whenever the acting PM has no working connection of his own (decision 07-3). If it stops working (its password changed, the app was removed) the card shows "Needs reconnecting": link it again the same way.

## 8. What a PM does (and what the owner tells them)

Profile > **Google account** > **Connect Google** > choose your **own** `@athareg.com` account > **Allow** > back on the Profile page: "Google connected. The platform can now send as you." The page then shows "Connected as ...", when it was connected and when it was last used. **Disconnect** removes the stored permission and revokes it at Google. A PM can also remove it any time in his own Google account (Security > Third-party access): the platform then shows "Needs reconnecting" after the next use and falls back to `startups@`.

## 9. Test checklist (real Google, local stack, after the functions are served)

Tick each line. Use a throwaway PM account of the platform whose e-mail is a real `@athareg.com` mailbox.

- [ ] Profile > Google account shows **Not connected** and names `startups@athareg.com` as the fallback (or says no sender exists yet).
- [ ] **Connect Google** opens Google's permission screen titled **Athar Platform** and lists the two permissions (mail send, calendar events).
- [ ] **Allow** returns to `/profile` with the green message and the status **Connected** + the right address. The URL no longer contains `google=`.
- [ ] **Cancel** on the Google screen returns "You cancelled the Google screen, so nothing was connected." and the status stays **Not connected**.
- [ ] Signing in to Google with a **personal Gmail** (or any non-`@athareg.com` account) is refused ("Only Athar accounts ...") and the status stays **Not connected**; in your Google account's Third-party access list the app does **not** appear.
- [ ] With `GOOGLE_PM_EMAIL_POLICY=same_email`: choosing another `@athareg.com` mailbox than the platform login is refused ("Connect with the same Google account ...").
- [ ] Open the same "Connect" link twice (copy the Google URL, finish once, then try the old callback URL again): the second one is refused ("This connection link was already used").
- [ ] **Reconnect Google** works and keeps a single connection (the Super admin overview, step below, shows one row per person).
- [ ] As **super_admin**: Profile > System sender > **Link the system sender** with `startups@athareg.com` works; with any other account it is refused. **Everyone's connections** lists the PM and the system sender with their status and last use, and no token.
- [ ] **Disconnect** (confirm dialog) shows "Google disconnected." and the app disappears from the PM's Google account Third-party access list.
- [ ] Remove the app from the PM's Google account by hand, then send one e-mail (a Selection test or a staff invitation; the worker must be running, `dev-functions.sh up` + `email-worker-schedule.sh enable`, or "Send now" in the Outbox): the platform shows **Needs reconnecting**, the e-mail goes out from `startups@`, nothing is lost.
- [ ] After 8 days or more a connected PM still sends (design 07 section 1.3: Internal apps do not have the 7-day token limit of External/Testing apps; this line is the real-world check).
- [ ] Booking > Settings > Calendar and Selection > E-mails show the acting user's real sender ("sent from your Google account (...)" / "go out from the system sender (...)").

## 10. What changes at production time

Five edge functions run the Google side of the platform (sources in `supabase-new/functions`, nothing is deployed from this repository by itself): the three **Google core** functions of this document, the **e-mail worker** (`email-worker`, sends every queued e-mail through Gmail) and the **calendar sync** (`calendar-sync`, creates / changes / cancels the Calendar events and Meet links of bookings). A sixth function, `image-convert`, is the WebP webhook and has nothing to do with Google. Do the steps in this order.

1. **Same OAuth client, one more redirect URI.** In the client (step 5) add `https://<project-ref>.supabase.co/functions/v1/google-oauth-callback`. Keep the local one for development.
2. **Secrets on the live project** (Supabase dashboard > Edge Functions > Secrets, or `supabase secrets set`; never in git, never in chat):

   | Secret | Value | Needed by |
   |---|---|---|
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the client of step 5 | the three Google functions, `email-worker`, `calendar-sync` (they mint access tokens from the stored refresh tokens) |
   | `GOOGLE_REDIRECT_URI` | the production URI of step 1 | the Google core |
   | `APP_URL` | the https address of the app, including its base path | the Google core (and, being part of the shared configuration, the two workers) |
   | `OAUTH_STATE_SECRET` | a NEW random value of at least 32 characters, not the local one | the Google core and the workers (shared configuration) |
   | `EMAIL_WORKER_SECRET` | a NEW random value of at least 24 characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). **The same value** goes to the scheduler in step 5 | `email-worker` |
   | `ALLOWED_ORIGINS` | only when the app is on more than one origin | the Google core |
   | optional: `EMAIL_PER_MINUTE` (30), `EMAIL_DAILY_CAP` (1500), `EMAIL_MAX_RUN_SECONDS` (100) | ceilings; a request can only lower them | `email-worker` |

   `TOKEN_ENC_KEY` is not needed because hosted Supabase has Vault (`TOKEN_STORAGE=auto` chooses it). `SUPABASE_URL` and the service-role key are injected by the platform. **Do not set** `ALLOW_FAKE_GOOGLE` or any `GOOGLE_*_URL` / `GOOGLE_AUTH_BASE` / `GOOGLE_API_BASE`: the code refuses to start with them unless `ALLOW_FAKE_GOOGLE=1`, and even then only for this machine's own addresses.
3. **Deploy the functions** (`supabase functions deploy <name>`), with this JWT setting for each:

   | Function | JWT verification at the gateway | Why |
   |---|---|---|
   | `google-oauth-start`, `google-disconnect` | **on** (the default) | called by a signed-in person from the browser |
   | `google-oauth-callback` | **off**: `--no-verify-jwt` | Google's redirect carries no platform login; the signed single-use `state` is its protection |
   | `email-worker` | **off**: `--no-verify-jwt` | called by the database scheduler (pg_cron + pg_net) and scripts, not by a user. It checks `EMAIL_WORKER_SECRET` itself first and is **closed when no secret is set** |
   | `calendar-sync` | **on** (the default) | called with the service-role key; it additionally checks that key itself, so the public anon key and a signed-in PM are refused |
   | `image-convert` | **off**: `--no-verify-jwt` | a database webhook with its own `IMAGE_CONVERT_SECRET` (its own README) |
4. **Connections do not move.** Refresh tokens are encrypted per project (design 07 section 1.4): after the cut-over every PM and the system sender connect again on the live project (a two-minute step each, sections 7 and 8). Until at least the system sender is connected, queued e-mails wait (the Outbox shows "no sender") and nothing is lost.
5. **Switch the schedulers on.** Neither is started by a migration (a migration that starts delivering mail on its own would be a surprise):
   * **E-mail**: in the SQL editor of the live project run once `select app_private.email_worker_enable('https://<project-ref>.supabase.co/functions/v1', '<the same EMAIL_WORKER_SECRET>');` (pg_cron every minute + a nightly clean-up; the secret is kept in Vault). Check `/admin/email` as a super_admin: the worker heartbeat must be fresh and the scheduler "ON". Switch off again with `select app_private.email_worker_disable();`. Without pg_cron, any scheduler that can POST the URL with the header `x-worker-secret` every minute does the same job (`db/scripts/trigger-email-worker.sh --url ...` shows the call).
   * **Calendar**: put the service-role key into Vault once by hand (`select vault.create_secret('<service role key>', 'calendar_sync_service_key');`), then run `psql -v url="https://<project-ref>.supabase.co/functions/v1/calendar-sync" -f db/scripts/calendar-sync-schedule.sql` (header of that file: how to check and how to stop it). The worker starts in **shadow** mode: it only writes down what it WOULD do and calls no Google endpoint, so it can run next to the old Apps Script.
6. **The order against the Apps Script retirement matters** (design 07 section 2.3): the Apps Script poller is stopped BEFORE the calendar sync is switched from `shadow` to `live` (Booking > Settings > Calendar, a super_admin), or both would create the same event. The step-by-step runbook (smoke test, health check, rollback, the legacy functions to retire last) is "Calendar cut-over runbook" in `web/PROGRESS.md`. The e-mail worker has no such conflict: Gmail sending replaces the old Apps Script mail path as soon as its scheduler is on.
7. **Re-run the checklist of step 9** against production once, with one real PM; then send one test e-mail (a Selection or Booking test, or an invitation) and watch it go from "queued" to "sent" in the Outbox, and one test booking through to "Synced" in the Bookings tab.
8. The consent screen stays **Internal**. Do not publish it as External: that would put the 7-day token expiry and Google's verification back.
9. Rotating the client secret: client page > **Add secret** > put the new value into the live secrets > check one Connect > **Disable** then **Delete** the old secret. Existing connections keep working (their refresh tokens stay valid), but every refresh also sends the client secret, so swap it in one step and test one Connect straight away.

## 11. If something fails

| What you see | Meaning | Fix |
|---|---|---|
| Google: **Error 400: redirect_uri_mismatch** | the address in `GOOGLE_REDIRECT_URI` is not in the client's list (a trailing slash, `localhost` vs `127.0.0.1`, another port) | make the two identical, character for character (step 5) |
| Google: **Error 403: org_internal** | the chosen account is not in the organization, or the project is not inside it | choose the `@athareg.com` account; check the project's organization (step 1) |
| Google: **Access blocked: ... has not completed the Google verification process** | the consent screen is External | set it to **Internal** (step 3) |
| Google: **Access blocked: Authorization Error / app not trusted** | Workspace API controls | step 4 |
| Google: **Error 401: invalid_client** or the platform says "Google did not accept the connection" | wrong or rotated client ID / secret in the secrets file | re-copy both (step 5/6) and restart the functions |
| Google: **invalid_scope** | a scope in the request is not on the consent screen's list | add all four scopes (step 3) |
| Platform: "Connecting Google is not set up on this server yet" | the functions are not running or a required secret is missing (the function log names the missing variable) | step 6; start the functions |
| Platform: "The link expired ..." / "already used" | the Google window stayed open more than 10 minutes, or the link was opened twice | press **Connect Google** again |
| Platform: "Both permissions are needed ..." | the user unticked one permission box on Google's screen | connect again and leave both ticked |
| Platform: "Google did not give a lasting permission ..." | Google answered without a long-term token | remove **Athar Platform** in the user's Google account (Third-party access) and connect again |
| Status **Needs reconnecting** | Google refused the saved permission (removed, password changed, admin policy, 6 months unused) | **Reconnect Google** |

## 12. Security summary (for the owner's peace of mind)

* The permission is minimal: send mail and create calendar events. There is no permission to read mail, contacts or existing events.
* The long-lived Google token is stored **only on the server**, in Supabase Vault (or AES-256-GCM encrypted with `TOKEN_ENC_KEY` where Vault does not exist). The browser, the API responses, the logs and the database tables that people can query never contain it.
* The Google screen is protected against forged and replayed links (a signed state that can be used once and expires after 10 minutes, PKCE) and against linking somebody else's mailbox to your account (`same_email`).
* Only `@athareg.com` Workspace accounts can connect; the system sender must be `startups@athareg.com`.
* Disconnecting revokes the permission at Google and deletes the stored token.
* The old leaked service-account key is dead (decision 08 section 12) and nothing here uses a service account or domain-wide delegation.

## Appendix: running the tests without Google

```
node --test "supabase-new/functions/_shared/tests/*.test.js"      # state, PKCE, MIME (Arabic), calendar, OAuth flow, fake Google server
bash db/run.sh file db/migrations/m61_google_oauth.sql            # local DB only, re-runnable
docker exec -i supabase_db_stack psql -U postgres -d postgres -X < db/verify/v61_google_oauth.sql
node db/scripts/fake-google/server.mjs --port 54399 --interactive   # the fake Google, with a consent page, for the browser
bash db/scripts/dev-functions.sh up                               # the edge runtime with ALL the functions + the fake Google
node db/scripts/verify-email-worker.mjs                           # e-mail worker end to end (real runtime + real database + fake Google)
node db/scripts/verify-calendar-sync.mjs                          # calendar sync end to end
```
The fake server is described in `db/scripts/fake-google/README.md`. It never contacts Google.
