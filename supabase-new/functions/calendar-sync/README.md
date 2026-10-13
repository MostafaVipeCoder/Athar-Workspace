# calendar-sync (design 07 section 2.2) - skeleton, not deployed

The ONE server-side path for Google Calendar / Meet of booking nodes. `index.ts` implements the job loop over
`app_private.integration_jobs` (`calendar_create` / `calendar_update` / `calendar_cancel`, enqueued by the m06d/m34 RPCs
`create_booking`, `reschedule_booking`, `cancel_booking`, `restore_booking`), the Google Calendar calls with the
idempotency rules (event id = the booking id without dashes, `conferenceData.createRequest.requestId` = booking id,
HTTP 409 -> adopt the existing event, 404/410 on delete = success), the two Meet modes (`unique`: Meet created with the
event, polled until the entry point exists; `shared`: the node's link in `location`, an empty link is a hard failure) and
the attendee derivation (booker, provider booking e-mail, the node's admin/CC lists; lower-cased, de-duplicated, invalid
addresses dropped). The Meet link is written back onto `bookings.meet_link` together with `calendar_owner_connection_id`.

## What is missing (hand-over to the OAuth work)

1. `getAccessToken(db, connectionId)` returns `null`: it must exchange the refresh token stored in Supabase Vault
   (`app_private.google_connections.vault_secret_id`) for an access token with the `calendar.events` scope, mark the
   connection `needs_reauth` on `invalid_grant` and throw `NonRetryable` so the job pauses.
2. The OAuth connect flow itself (`google-oauth-start` / `google-oauth-callback`, design 07 section 1.4) that creates the
   `google_connections` rows (one per PM + the `startups@` system row). The Booking node Settings already offers the
   connection select (reads `get_booking_extras().connections`: own + system) and shows "Not connected" while empty.
3. Deployment and the trigger: `supabase functions deploy calendar-sync` plus a `pg_cron` minute job (or a kick after
   enqueue) calling `POST /functions/v1/calendar-sync` with the service key. Nothing is deployed today.
4. Migrated bookings: the 28 rows with `legacy_calendar_event_id` were created by the Apps Script poller on `startups@`;
   once the system connection exists set `bookings.calendar_owner_connection_id` for them (MIGRATION-LOG stage 2a open
   item) so later cancellations hit the right calendar. The poller must be switched off BEFORE this function goes live
   (07 section 2.3 cut-over order).

## Contract with the client (web/src/nodes/booking)

- A booking is never rolled back because Google fails: the booking row is the truth, the job carries the sync state.
- `pending` + no connection = "Waiting for a Google connection" in the PM Bookings tab; `failed` / `dead` offer "Retry
  sync" (`retry_calendar_job`, re-queues the job); `done` = "Synced"; a migrated booking with a legacy event id shows
  "Synced (migrated)".
- The confirmation e-mail (queued by the DB in `email_outbox`, null sender) says "the meeting link will follow by e-mail"
  when the Meet link is not known at booking time (unique mode); Google's own invitation (`sendUpdates=all`) carries it.
