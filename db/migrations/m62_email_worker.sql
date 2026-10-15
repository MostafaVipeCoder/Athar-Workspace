-- m62_email_worker.sql  (E-mail outbox worker: design 07 section 1.4 / 1.6; owner decision 08 section 20.6 "connect")
-- Re-runnable (add column if not exists / create or replace / drop ... if exists / every data step checks itself). Local DB only.
-- Run AFTER m05, m06d, m24, m31, m33, m34 and m61 (it reads app_private.google_connections and resolves senders with m61's helpers).
-- Verify with db/verify/v62_email_worker.sql.
--
-- WHAT THIS ADDS
--  1. app_private.email_outbox: the LEASE (locked_by / locked_until), the in-flight marker (send_started_at), the number of requests really started
--     (send_attempt = the Message-ID marker), the retry streak, `blocked_reason` (why a queued row waits: rate_limited | daily_cap |
--     sender_needs_reconnect | no_sender | worker_config), the Message-ID used, the sender that sent it, and the manual resolution (who / when / what).
--     A BEFORE UPDATE guard makes `sent` and `cancelled` terminal, clears the lease / blocked reason when a row leaves the state they belong to.
--  2. app_private.email_log becomes a real audit + quota ledger: attempt, status, the sender, the recipient MASKED + HASHED (never the address),
--     the Gmail message id, the acting user. It never holds a subject or a body.
--  3. SERVICE-ROLE RPCs for the edge function email-worker (EXECUTE for service_role only):
--       email_worker_claim      atomic batch (one advisory lock + FOR UPDATE SKIP LOCKED), reaps expired leases first, resolves the sender per row
--                               (acting PM, else startups@ when the template allows), per-sender quota (a rolling minute and a rolling 24 h window,
--                               in-flight claims counted), blocked rows wait with next_attempt_at AND a visible reason
--       email_worker_mark_sending   persists "the request is about to leave" (the unknown-outcome boundary) and fixes the Message-ID marker
--       email_worker_finish     sent | retry (backoff, max streak) | failed | needs_review | blocked, with the audit row
--       email_worker_heartbeat  the worker's last run (the health panel shows when the scheduler stopped)
--  4. CLIENT RPCs (authenticated): list_email_outbox, get_email_outbox_item, get_email_outbox_counts, email_outbox_retry / cancel / mark_sent / resend,
--     email_outbox_send_now (a PM of the project; a staff-invitation row belongs to super_admin), get_email_health (super_admin),
--     list_staff_invitation_delivery (super_admin).
--  5. Scheduler plumbing (NOTHING is scheduled by this file): app_private.worker_settings / worker_heartbeat, app_private.email_kick_worker() (pg_net
--     POST to the edge function with a shared secret kept in Vault), email_worker_enable / disable / status, email_maintenance. db/scripts/email-worker-schedule.sh
--     enables them (pg_cron every minute) on the local stack; production uses the same functions or the scheduled-function config of the dashboard.
--  6. The legacy trio claim_email_batch / complete_email / fail_email (m06d: no lease, no quota) is REPLACED by shims that refuse (deprecated), so there is
--     exactly ONE claim path and a row can never be sent twice by two code paths. They keep their names and their service-role-only grants.
--
-- NULL SAFETY: guards start with `p_x is null or ...`, booleans are wrapped in coalesce, nullable comparisons use `is distinct from`.
-- Error tokens (message prefix = hint): forbidden (42501), email_invalid (22023, detail field:reason), deprecated (0A000).
set search_path = public, extensions;

begin;

-- ================================================================= 1. email_outbox: lease, in-flight marker, blocked reason, resolution
alter table app_private.email_outbox add column if not exists blocked_reason   text;
alter table app_private.email_outbox add column if not exists locked_until     timestamptz;
alter table app_private.email_outbox add column if not exists locked_by        text;
alter table app_private.email_outbox add column if not exists send_started_at  timestamptz;
alter table app_private.email_outbox add column if not exists send_attempt     integer not null default 0;
alter table app_private.email_outbox add column if not exists fail_streak      integer not null default 0;
alter table app_private.email_outbox add column if not exists last_attempt_at  timestamptz;
alter table app_private.email_outbox add column if not exists message_id       text;
alter table app_private.email_outbox add column if not exists sender_source    text;
alter table app_private.email_outbox add column if not exists resolution       text;
alter table app_private.email_outbox add column if not exists resolved_by      uuid;
alter table app_private.email_outbox add column if not exists resolved_at      timestamptz;

alter table app_private.email_outbox drop constraint if exists email_outbox_blocked_chk;
alter table app_private.email_outbox add constraint email_outbox_blocked_chk check (
  blocked_reason is null or (status = 'queued' and blocked_reason in ('rate_limited', 'daily_cap', 'sender_needs_reconnect', 'no_sender', 'worker_config')));
alter table app_private.email_outbox drop constraint if exists email_outbox_sender_source_chk;
alter table app_private.email_outbox add constraint email_outbox_sender_source_chk check (sender_source is null or sender_source in ('user', 'system'));
alter table app_private.email_outbox drop constraint if exists email_outbox_resolution_chk;
alter table app_private.email_outbox add constraint email_outbox_resolution_chk check (resolution is null or resolution in ('manual_sent', 'manual_resend', 'manual_retry', 'manual_cancel'));
alter table app_private.email_outbox drop constraint if exists email_outbox_counters_chk;
alter table app_private.email_outbox add constraint email_outbox_counters_chk check (send_attempt >= 0 and fail_streak >= 0 and attempts >= 0);
-- a short CODE, never a message (the human text is translated by the client): same shape as google_connections.last_error
alter table app_private.email_outbox drop constraint if exists email_outbox_error_code_chk;
alter table app_private.email_outbox add constraint email_outbox_error_code_chk check (error_code is null or error_code ~ '^[a-z][a-z0-9_.:-]{0,63}$');
alter table app_private.email_outbox drop constraint if exists email_outbox_message_id_chk;
alter table app_private.email_outbox add constraint email_outbox_message_id_chk check (message_id is null or message_id ~ '^<[A-Za-z0-9._~+=-]{1,128}@[A-Za-z0-9.-]{1,253}>$');

create index if not exists email_outbox_ready_idx    on app_private.email_outbox (created_at, id) where status = 'queued';          -- the claim reads the queue oldest first
create index if not exists email_outbox_lease_idx    on app_private.email_outbox (locked_until) where status = 'sending';
create index if not exists email_outbox_project_idx  on app_private.email_outbox (project_id, created_at desc) where project_id is not null;
create index if not exists email_outbox_status_idx   on app_private.email_outbox (status, next_attempt_at);
create index if not exists email_outbox_creator_idx  on app_private.email_outbox (created_by, created_at) where created_by is not null;

-- ================================================================= 2. email_log: audit + quota ledger (never a subject or a body)
alter table app_private.email_log add column if not exists attempt              integer;
alter table app_private.email_log add column if not exists status               text;
alter table app_private.email_log add column if not exists sender_connection_id uuid references app_private.google_connections(id) on delete set null;
alter table app_private.email_log add column if not exists recipient_masked     text;
alter table app_private.email_log add column if not exists recipient_hash       text;
alter table app_private.email_log add column if not exists gmail_message_id     text;
alter table app_private.email_log add column if not exists actor                uuid;
create index if not exists email_log_quota_idx  on app_private.email_log (sender_connection_id, created_at) where event = 'send_started';
create index if not exists email_log_created_idx on app_private.email_log (created_at);

-- ================================================================= 3. scheduler tables (private, granted to nobody)
create table if not exists app_private.worker_settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value      text not null check (length(value) <= 500),
  updated_at timestamptz not null default now()
);
create table if not exists app_private.worker_heartbeat (
  name        text primary key check (name ~ '^[a-z][a-z0-9_-]{1,63}$'),
  last_run_at timestamptz not null default now(),
  last_worker text,
  summary     jsonb not null default '{}'::jsonb check (octet_length(summary::text) <= 4096)
);
alter table app_private.worker_settings enable row level security;
alter table app_private.worker_settings force row level security;
alter table app_private.worker_heartbeat enable row level security;
alter table app_private.worker_heartbeat force row level security;
revoke all on app_private.worker_settings, app_private.worker_heartbeat from public, anon, authenticated, service_role;

-- ================================================================= 4. helpers (app_private: never callable by a client role)
create or replace function app_private.mask_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case when p_email is null or position('@' in p_email) < 2 then null
              else left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2) end
$$;

create or replace function app_private.email_hash(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case when p_email is null or btrim(p_email) = '' then null else left(encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex'), 24) end
$$;

-- the state the UI shows: a queued row with a blocked reason is "blocked"; `dead` (m06d) reads as failed
create or replace function app_private.email_state(p_status text, p_blocked text) returns text
language sql immutable set search_path = '' as $$
  select case when p_status = 'queued' and p_blocked is not null then 'blocked' when p_status = 'dead' then 'failed' else p_status end
$$;

-- one audit row; the recipient is stored MASKED and HASHED only, `detail` is a fixed short text chosen by the caller (never a subject or a body)
create or replace function app_private.email_log_add(p_outbox uuid, p_event text, p_detail text default null, p_attempt integer default null, p_status text default null,
                                                    p_sender uuid default null, p_gmail text default null, p_actor uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_to text;
begin
  if p_outbox is null or p_event is null then return; end if;
  select o.recipient_email::text into v_to from app_private.email_outbox o where o.id = p_outbox;
  insert into app_private.email_log (outbox_id, event, detail, attempt, status, sender_connection_id, recipient_masked, recipient_hash, gmail_message_id, actor)
  values (p_outbox, left(p_event, 40), left(p_detail, 300), p_attempt, left(p_status, 20), p_sender, app_private.mask_email(v_to), app_private.email_hash(v_to), left(p_gmail, 200), p_actor);
end $$;

-- EVERY audit row carries the recipient masked + hashed, also the ones the producers write by a plain INSERT (m24 / m33 / m34 'queued'): filled from the outbox row
create or replace function app_private.email_log_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_to text;
begin
  if new.recipient_masked is null or new.recipient_hash is null then
    select o.recipient_email::text into v_to from app_private.email_outbox o where o.id = new.outbox_id;
    new.recipient_masked := coalesce(new.recipient_masked, app_private.mask_email(v_to));
    new.recipient_hash := coalesce(new.recipient_hash, app_private.email_hash(v_to));
  end if;
  return new;
end $$;
drop trigger if exists email_log_bi_fill on app_private.email_log;
create trigger email_log_bi_fill before insert on app_private.email_log for each row execute function app_private.email_log_fill();

-- a connection can send now: active, both scopes granted, a stored secret (the same predicate as m61's sender resolution)
create or replace function app_private.google_connection_usable(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.status = 'active'
                          and c.scopes @> array['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events']
                          and (c.token_storage = 'aes' or c.vault_secret_id is not null)
                     from app_private.google_connections c where c.id = p_id), false)
$$;

-- who may manage this row: a PM of the project; a row without a project (a staff invitation) belongs to super_admin
create or replace function app_private.email_row_manageable(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_project is null then app_private.is_super_admin() else app_private.is_project_manager(p_project) end
$$;

-- State machine guard: `sent` and `cancelled` are terminal; leaving `queued` clears the blocked reason; leaving `sending` clears the lease.
-- (needs_review keeps locked_by: a late success of THAT worker may still upgrade the row to sent, see email_worker_finish.)
create or replace function app_private.email_outbox_state_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status in ('sent', 'cancelled') then
      raise exception 'email_invalid: a % e-mail cannot change state', old.status using errcode = '22023', hint = 'email_invalid', detail = 'status:terminal';
    end if;
    if new.status <> 'queued' then new.blocked_reason := null; end if;
    if new.status in ('queued', 'sent', 'failed', 'dead', 'cancelled') then new.locked_by := null; new.locked_until := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists email_outbox_bu_state on app_private.email_outbox;
create trigger email_outbox_bu_state before update on app_private.email_outbox for each row execute function app_private.email_outbox_state_guard();

-- Which connection sends this row? -> (connection_id, source user|system, fallback, reason, owner_name, email).
--   template config (node.config.emails.<key>): sender_mode 'acting_pm' (default) | 'system', fallback_to_system (default true), reply_to (read by the claim)
--   acting_pm : a pinned sender that is still usable, else the acting user's own connection (m61 google_resolve_sender), for a booking e-mail the node's
--               organizer connection; when that is not usable and the template allows it: the system sender (startups@) with the reason the own one was not used
--   system    : the system sender only (form notifications default to it)
-- connection_id is NULL when nothing can send; `reason` then says why (m61 vocabulary + organizer cases).
create or replace function app_private.email_pick_sender(p_row app_private.email_outbox)
returns table (connection_id uuid, source text, fallback boolean, reason text, owner_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg jsonb; v_mode text; v_fb boolean; v_id uuid; v_src text; v_reason text; v_sys uuid; v_org uuid; v_g record; v_fallback boolean := false;
begin
  v_cfg := coalesce((select n.config -> 'emails' -> p_row.email_key from public.nodes n where n.id = p_row.node_id), '{}'::jsonb);
  if jsonb_typeof(v_cfg) is distinct from 'object' then v_cfg := '{}'::jsonb; end if;
  v_mode := coalesce(nullif(v_cfg ->> 'sender_mode', ''), case when p_row.email_key = 'form_new_response' then 'system' else 'acting_pm' end);
  v_fb := coalesce(lower(v_cfg ->> 'fallback_to_system') is distinct from 'false', true);
  select c.id into v_sys from app_private.google_connections c where c.kind = 'system' and app_private.google_connection_usable(c.id) limit 1;

  if v_mode = 'system' then
    if v_sys is not null then v_id := v_sys; v_src := 'system'; else v_reason := 'no_connection'; end if;
  else
    -- 1. a pinned sender that is still usable (booking confirmations pinned by create_booking, the legacy enqueue_email)
    if p_row.sender_connection_id is not null and app_private.google_connection_usable(p_row.sender_connection_id) then
      v_id := p_row.sender_connection_id;
      v_src := case when exists (select 1 from app_private.google_connections c where c.id = v_id and c.kind = 'system') then 'system' else 'user' end;
    -- 2. a booking e-mail: the organizer of the booking node
    elsif p_row.email_key in ('booking_confirmation', 'booking_cancellation') then
      select bs.organizer_connection_id into v_org from public.booking_settings bs where bs.node_id = p_row.node_id;
      if v_org is not null and app_private.google_connection_usable(v_org) then
        v_id := v_org;
        v_src := case when exists (select 1 from app_private.google_connections c where c.id = v_id and c.kind = 'system') then 'system' else 'user' end;
      else
        v_reason := case when exists (select 1 from app_private.google_connections c where c.id = v_org and c.status = 'needs_reconnect') then 'user_needs_reconnect' else 'user_not_connected' end;
      end if;
    -- 3. everything else: the acting user's own connection (resolve_sender also reports why it was not used)
    else
      select * into v_g from app_private.google_resolve_sender(p_row.created_by);
      if v_g.source = 'user' then v_id := v_g.connection_id; v_src := 'user';
      else v_reason := v_g.reason; end if;
    end if;
    if v_id is null then
      if v_fb and v_sys is not null then
        v_id := v_sys; v_src := 'system'; v_fallback := true;
      elsif v_reason is null then
        v_reason := 'no_connection';
      end if;
    end if;
  end if;

  connection_id := v_id; source := v_src; fallback := v_fallback; reason := v_reason;
  owner_name := null; email := null;
  if v_id is not null then
    select c.email::text, case when c.kind = 'user' then (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = c.owner_user_id) end
      into email, owner_name from app_private.google_connections c where c.id = v_id;
  end if;
  return next;
end $$;

-- ================================================================= 5. service-role RPCs for the edge function
-- email_worker_claim(...) -> { rows: [...], claimed, blocked, has_more, requeued, reviewed, next_ready_at, now }
-- Serialised by ONE advisory lock (so two workers never both see the same quota as free) and FOR UPDATE SKIP LOCKED (a row is never taken twice).
create or replace function public.email_worker_claim(p_worker text, p_limit integer default 20, p_lease_seconds integer default 120,
                                                     p_per_minute integer default 30, p_daily_cap integer default 1500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer; v_lease integer; v_pm integer; v_cap integer; v_window integer;
  r app_private.email_outbox; r2 app_private.email_outbox; s record;
  v_rows jsonb := '[]'::jsonb; v_claimed integer := 0; v_blocked integer := 0; v_scanned integer := 0; v_requeued integer := 0; v_reviewed integer := 0;
  v_um jsonb := '{}'::jsonb; v_ud jsonb := '{}'::jsonb; v_key text; um integer; ud integer; v_next timestamptz; v_reason text; v_reply text; v_cfg jsonb;
begin
  if p_worker is null or p_worker !~ '^[A-Za-z0-9:._-]{1,64}$' then raise exception 'email_invalid: worker' using errcode = '22023', hint = 'email_invalid', detail = 'worker:invalid'; end if;
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_lease := least(greatest(coalesce(p_lease_seconds, 120), 30), 900);
  v_pm    := least(greatest(coalesce(p_per_minute, 30), 1), 120);
  v_cap   := least(greatest(coalesce(p_daily_cap, 1500), 1), 1900);   -- never above Google's own 2,000 a day
  v_window := v_limit * 5;

  perform pg_advisory_xact_lock(hashtextextended('athar-email-worker-claim', 0));

  -- 1. reap expired leases. Never sent (no request marker) = back to the queue. A request WAS started = the outcome is unknown: needs_review, never resent.
  for r in
    select o.* from app_private.email_outbox o
     where o.status = 'sending' and (o.locked_until is null or o.locked_until < now()) for update skip locked
  loop
    if r.send_started_at is null then
      update app_private.email_outbox o set status = 'queued', next_attempt_at = now() where o.id = r.id;
      perform app_private.email_log_add(r.id, 'lease_expired_requeued', 'the worker stopped before the request was sent', r.attempts, 'queued', r.sender_connection_id);
      v_requeued := v_requeued + 1;
    else
      update app_private.email_outbox o set status = 'needs_review', error_code = 'unknown_outcome', error_message = 'the worker stopped after the request was sent', locked_until = null
       where o.id = r.id;
      perform app_private.email_log_add(r.id, 'needs_review', 'lease expired after the request was sent', r.send_attempt, 'needs_review', r.sender_connection_id);
      v_reviewed := v_reviewed + 1;
    end if;
  end loop;

  -- 2. candidates: oldest first; a sender over its quota pushes its rows into the future, so they stop being candidates
  for r in
    select o.* from app_private.email_outbox o
     where o.status = 'queued' and o.next_attempt_at <= now()
     order by o.created_at, o.id limit v_window for update skip locked
  loop
    v_scanned := v_scanned + 1;
    exit when v_claimed >= v_limit;
    select * into s from app_private.email_pick_sender(r);
    if s.connection_id is null then
      v_reason := case when s.reason in ('user_needs_reconnect', 'user_needs_reconnect_no_system') then 'sender_needs_reconnect' else 'no_sender' end;
      update app_private.email_outbox o set blocked_reason = v_reason, next_attempt_at = now() + interval '5 minutes' where o.id = r.id;
      if r.blocked_reason is distinct from v_reason then
        perform app_private.email_log_add(r.id, 'blocked', v_reason, r.attempts, 'queued');
      end if;
      v_blocked := v_blocked + 1;
      continue;
    end if;
    v_key := s.connection_id::text;
    if not (v_um ? v_key) then
      -- requests started in the last minute + rows claimed (in flight) that have not started yet
      select (select count(*) from app_private.email_log l where l.sender_connection_id = s.connection_id and l.event = 'send_started' and l.created_at > now() - interval '1 minute')
           + (select count(*) from app_private.email_outbox o where o.status = 'sending' and o.sender_connection_id = s.connection_id and o.send_started_at is null),
             (select count(*) from app_private.email_log l where l.sender_connection_id = s.connection_id and l.event = 'send_started' and l.created_at > now() - interval '24 hours')
           + (select count(*) from app_private.email_outbox o where o.status = 'sending' and o.sender_connection_id = s.connection_id and o.send_started_at is null)
        into um, ud;
      v_um := v_um || jsonb_build_object(v_key, um);
      v_ud := v_ud || jsonb_build_object(v_key, ud);
    end if;
    um := (v_um ->> v_key)::integer;
    ud := (v_ud ->> v_key)::integer;
    if ud >= v_cap then
      update app_private.email_outbox o set blocked_reason = 'daily_cap', next_attempt_at = now() + interval '15 minutes' where o.id = r.id;
      if r.blocked_reason is distinct from 'daily_cap' then perform app_private.email_log_add(r.id, 'blocked', 'daily_cap', r.attempts, 'queued', s.connection_id); end if;
      v_blocked := v_blocked + 1;
      continue;
    end if;
    if um >= v_pm then
      update app_private.email_outbox o set blocked_reason = 'rate_limited', next_attempt_at = now() + interval '20 seconds' where o.id = r.id;
      if r.blocked_reason is distinct from 'rate_limited' then perform app_private.email_log_add(r.id, 'blocked', 'rate_limited', r.attempts, 'queued', s.connection_id); end if;
      v_blocked := v_blocked + 1;
      continue;
    end if;

    update app_private.email_outbox o
       set status = 'sending', attempts = o.attempts + 1, locked_by = p_worker, locked_until = now() + make_interval(secs => v_lease),
           sender_connection_id = s.connection_id, sender_source = s.source, blocked_reason = null, send_started_at = null, last_attempt_at = now()
     where o.id = r.id returning * into r2;
    v_um := v_um || jsonb_build_object(v_key, um + 1);
    v_ud := v_ud || jsonb_build_object(v_key, ud + 1);
    v_claimed := v_claimed + 1;
    perform app_private.email_log_add(r2.id, 'claimed', case when s.fallback then 'fallback to the system sender: ' || coalesce(s.reason, '-') else 'sender ' || s.source end,
                                      r2.attempts, 'sending', s.connection_id);
    v_cfg := coalesce((select n.config -> 'emails' -> r2.email_key from public.nodes n where n.id = r2.node_id), '{}'::jsonb);
    v_reply := case when jsonb_typeof(v_cfg) = 'object' and (v_cfg ->> 'reply_to') ~ '^[^@\s<>",;()]+@[^@\s<>",;()]+\.[^@\s<>",;()]+$' then lower(v_cfg ->> 'reply_to') end;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', r2.id, 'email_key', r2.email_key, 'recipient', r2.recipient_email::text, 'cc', coalesce(to_jsonb(r2.cc), '[]'::jsonb),
      'subject', r2.subject, 'body_html', r2.body_html, 'send_attempt', r2.send_attempt, 'attempts', r2.attempts, 'fail_streak', r2.fail_streak,
      'project_id', r2.project_id, 'node_id', r2.node_id, 'created_by', r2.created_by, 'reply_to', v_reply,
      'sender', jsonb_build_object('id', s.connection_id, 'email', s.email, 'source', s.source, 'fallback', s.fallback, 'fallback_reason', s.reason, 'name', s.owner_name)));
  end loop;

  select min(o.next_attempt_at) into v_next from app_private.email_outbox o where o.status = 'queued';
  return jsonb_build_object('rows', v_rows, 'claimed', v_claimed, 'blocked', v_blocked, 'has_more', v_scanned >= v_window and v_claimed < v_limit,
                            'requeued', v_requeued, 'reviewed', v_reviewed, 'next_ready_at', v_next, 'now', now());
end $$;

-- the request is about to leave: persist the marker. After this point a crash means "unknown outcome" (needs_review), before it the row is simply requeued.
create or replace function public.email_worker_mark_sending(p_id uuid, p_worker text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o app_private.email_outbox;
begin
  if p_id is null or p_worker is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  update app_private.email_outbox x
     set send_started_at = now(), send_attempt = x.send_attempt + 1, last_attempt_at = now(), locked_until = greatest(x.locked_until, now() + interval '90 seconds')
   where x.id = p_id and x.status = 'sending' and x.locked_by = p_worker and x.locked_until > now() and x.send_started_at is null
  returning * into o;
  if o.id is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  perform app_private.email_log_add(o.id, 'send_started', 'request sent to Gmail', o.send_attempt, 'sending', o.sender_connection_id);
  return jsonb_build_object('ok', true, 'send_attempt', o.send_attempt);
end $$;

-- outcome: sent | retry | failed | needs_review | blocked | release.  Only the lease holder may finish a row (a late `sent` of the SAME worker may upgrade needs_review).
create or replace function public.email_worker_finish(p_id uuid, p_worker text, p_outcome text, p_code text default null, p_detail text default null, p_delay_ms integer default null,
                                                      p_gmail_message_id text default null, p_message_id text default null, p_max_streak integer default 6) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o app_private.email_outbox; v_code text; v_detail text; v_streak integer; v_secs double precision; v_max integer;
begin
  if p_id is null or p_worker is null or p_outcome is null or p_outcome not in ('sent', 'retry', 'failed', 'needs_review', 'blocked', 'release') then
    raise exception 'email_invalid: outcome' using errcode = '22023', hint = 'email_invalid', detail = 'outcome:invalid';
  end if;
  v_code := case when p_code ~ '^[a-z][a-z0-9_.:-]{0,63}$' then p_code end;
  v_detail := left(regexp_replace(coalesce(p_detail, ''), '[\r\n\t]+', ' ', 'g'), 300);
  v_max := least(greatest(coalesce(p_max_streak, 6), 1), 20);
  select * into o from app_private.email_outbox x where x.id = p_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'sent' and p_outcome = 'sent' then return jsonb_build_object('ok', true, 'status', 'sent', 'already', true); end if;
  if ((o.status = 'sending' and o.locked_by = p_worker)
      or (o.status = 'needs_review' and o.locked_by = p_worker and o.error_code = 'unknown_outcome' and p_outcome = 'sent')) is not true then   -- (m64: two-valued; a NULL locked_by never matches)
    return jsonb_build_object('ok', false, 'reason', 'not_owner', 'status', o.status);
  end if;

  if p_outcome = 'sent' then
    update app_private.email_outbox x set status = 'sent', sent_at = now(), gmail_message_id = left(p_gmail_message_id, 200), message_id = p_message_id,
           error_code = null, error_message = null, fail_streak = 0,                                   -- (the resolution stays: "retried / resent by a person" is history)
           body_html = case when x.email_key = 'staff_invitation' then null else x.body_html end   -- the body holds a one-time sign-up link
     where x.id = o.id;
    perform app_private.email_log_add(o.id, 'sent', case when o.status = 'needs_review' then 'confirmed after an unknown outcome' else 'accepted by Gmail' end, o.send_attempt, 'sent', o.sender_connection_id, p_gmail_message_id);
  elsif p_outcome = 'retry' then
    v_streak := o.fail_streak + 1;
    if v_streak >= v_max then
      update app_private.email_outbox x set status = 'failed', fail_streak = v_streak, error_code = 'max_attempts', error_message = left('gave up after ' || v_streak || ' attempts: ' || coalesce(v_code, 'error'), 300), send_started_at = null
       where x.id = o.id;
      perform app_private.email_log_add(o.id, 'failed', 'max_attempts after ' || coalesce(v_code, 'error'), o.send_attempt, 'failed', o.sender_connection_id);
    else
      v_secs := least(greatest(coalesce(p_delay_ms, 30000), 1000), 21600000) / 1000.0;
      update app_private.email_outbox x set status = 'queued', fail_streak = v_streak, next_attempt_at = now() + make_interval(secs => v_secs),
             error_code = v_code, error_message = nullif(v_detail, ''), send_started_at = null
       where x.id = o.id;
      perform app_private.email_log_add(o.id, 'retry_scheduled', coalesce(v_code, 'error') || ' in ' || round(v_secs) || ' s', o.send_attempt, 'queued', o.sender_connection_id);
    end if;
  elsif p_outcome = 'failed' then
    update app_private.email_outbox x set status = 'failed', error_code = coalesce(v_code, 'failed'), error_message = nullif(v_detail, ''), send_started_at = null where x.id = o.id;
    perform app_private.email_log_add(o.id, 'failed', coalesce(v_code, 'failed'), o.send_attempt, 'failed', o.sender_connection_id);
  elsif p_outcome = 'needs_review' then
    update app_private.email_outbox x set status = 'needs_review', error_code = 'unknown_outcome', error_message = nullif(v_detail, ''), locked_until = null where x.id = o.id;
    perform app_private.email_log_add(o.id, 'needs_review', coalesce(v_code, 'unknown_outcome'), o.send_attempt, 'needs_review', o.sender_connection_id);
  elsif p_outcome = 'release' then   -- the worker ran out of time BEFORE the request started: the row simply goes back to the queue (refused once a request was marked)
    if o.send_started_at is not null then return jsonb_build_object('ok', false, 'reason', 'request_started', 'status', o.status); end if;
    update app_private.email_outbox x set status = 'queued', next_attempt_at = now() where x.id = o.id;
    perform app_private.email_log_add(o.id, 'released', 'returned to the queue before the request started', o.send_attempt, 'queued', o.sender_connection_id);
  else  -- blocked: back to the queue with a visible reason; no failure is counted
    if v_code is null or v_code not in ('rate_limited', 'daily_cap', 'sender_needs_reconnect', 'no_sender', 'worker_config') then
      raise exception 'email_invalid: blocked reason' using errcode = '22023', hint = 'email_invalid', detail = 'code:invalid';
    end if;
    v_secs := least(greatest(coalesce(p_delay_ms, 300000), 0), 21600000) / 1000.0;
    update app_private.email_outbox x set status = 'queued', blocked_reason = v_code, next_attempt_at = now() + make_interval(secs => v_secs),
           error_code = v_code, error_message = nullif(v_detail, ''), send_started_at = null
     where x.id = o.id;
    perform app_private.email_log_add(o.id, 'blocked', v_code, o.send_attempt, 'queued', o.sender_connection_id);
  end if;
  return jsonb_build_object('ok', true, 'status', (select x.status from app_private.email_outbox x where x.id = o.id));
end $$;

create or replace function public.email_worker_heartbeat(p_worker text, p_summary jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_worker is null or p_worker !~ '^[A-Za-z0-9:._-]{1,64}$' then return; end if;
  insert into app_private.worker_heartbeat (name, last_run_at, last_worker, summary)
  values ('email-worker', now(), p_worker, case when jsonb_typeof(p_summary) = 'object' and octet_length(p_summary::text) <= 4096 then p_summary else '{}'::jsonb end)
  on conflict (name) do update set last_run_at = excluded.last_run_at, last_worker = excluded.last_worker, summary = excluded.summary;
end $$;

-- ================================================================= 6. the legacy trio: replaced by shims that refuse (ONE claim path)
create or replace function public.claim_email_batch(p_sender uuid, p_limit integer default 20) returns setof app_private.email_outbox
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'deprecated: claim_email_batch was replaced by email_worker_claim (m62)' using errcode = '0A000', hint = 'deprecated';
end $$;
create or replace function public.complete_email(p_id uuid, p_gmail_message_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'deprecated: complete_email was replaced by email_worker_finish (m62)' using errcode = '0A000', hint = 'deprecated';
end $$;
create or replace function public.fail_email(p_id uuid, p_code text, p_msg text, p_retry boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'deprecated: fail_email was replaced by email_worker_finish (m62)' using errcode = '0A000', hint = 'deprecated';
end $$;

-- ================================================================= 7. client RPCs: the Outbox
-- list_email_outbox -> { total, counts: {state: n}, rows: [...] }   (a PM of the project; no body, no token)
create or replace function public.list_email_outbox(p_project uuid, p_states text[] default null, p_node uuid default null, p_search text default null,
                                                    p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200); v_off integer := greatest(coalesce(p_offset, 0), 0);
        v_q text; v_pat text; v_rows jsonb; v_total integer; v_counts jsonb; v_states text[];
begin
  if p_project is null or not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  v_q := nullif(btrim(p_search), '');
  v_pat := case when v_q is null then null else '%' || replace(replace(replace(left(v_q, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_states := case when p_states is null or cardinality(p_states) = 0 then null else p_states end;

  select coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb) into v_counts
    from (select app_private.email_state(o.status, o.blocked_reason) as state, count(*) as n
            from app_private.email_outbox o where o.project_id = p_project and (p_node is null or o.node_id = p_node) group by 1) s;

  select count(*) into v_total from app_private.email_outbox o
   where o.project_id = p_project and (p_node is null or o.node_id = p_node)
     and (v_states is null or app_private.email_state(o.status, o.blocked_reason) = any(v_states))
     and (v_pat is null or o.recipient_email::text ilike v_pat or o.subject ilike v_pat);

  select coalesce(jsonb_agg(t.j order by t.created_at desc, t.id), '[]'::jsonb) into v_rows
    from (select o.created_at, o.id, jsonb_build_object(
            'id', o.id, 'node_id', o.node_id, 'node_name', jsonb_build_object('en', n.name_en, 'ar', n.name_ar), 'node_type', n.type,
            'email_key', o.email_key, 'recipient', o.recipient_email::text, 'cc', coalesce(to_jsonb(o.cc), '[]'::jsonb), 'subject', o.subject,
            'state', app_private.email_state(o.status, o.blocked_reason), 'status', o.status, 'blocked_reason', o.blocked_reason,
            'error_code', o.error_code, 'attempts', o.attempts, 'send_attempt', o.send_attempt, 'fail_streak', o.fail_streak,
            'created_at', o.created_at, 'next_attempt_at', o.next_attempt_at, 'sent_at', o.sent_at, 'last_attempt_at', o.last_attempt_at,
            'sender_email', c.email::text, 'sender_source', o.sender_source, 'message_id', o.message_id,
            'resolution', o.resolution, 'resolved_at', o.resolved_at, 'created_by_name', nullif(btrim(p.full_name), ''),
            'list_item_id', o.list_item_id, 'booking_id', o.booking_id) as j
            from app_private.email_outbox o
            left join public.nodes n on n.id = o.node_id
            left join app_private.google_connections c on c.id = o.sender_connection_id
            left join public.profiles p on p.id = o.created_by
           where o.project_id = p_project and (p_node is null or o.node_id = p_node)
             and (v_states is null or app_private.email_state(o.status, o.blocked_reason) = any(v_states))
             and (v_pat is null or o.recipient_email::text ilike v_pat or o.subject ilike v_pat)
           order by o.created_at desc, o.id limit v_limit offset v_off) t;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'rows', v_rows);
end $$;

-- one row in full: the rendered subject / body and the audit timeline (a staff-invitation row: super_admin)
create or replace function public.get_email_outbox_item(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o app_private.email_outbox; v_events jsonb;
begin
  if p_id is null then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  select * into o from app_private.email_outbox x where x.id = p_id;
  if o.id is null or not app_private.email_row_manageable(o.project_id) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('at', l.created_at, 'event', l.event, 'detail', l.detail, 'attempt', l.attempt, 'status', l.status,
                                               'sender_email', c.email::text, 'actor_name', nullif(btrim(pr.full_name), '')) order by l.created_at, l.id), '[]'::jsonb)
    into v_events from app_private.email_log l
    left join app_private.google_connections c on c.id = l.sender_connection_id
    left join public.profiles pr on pr.id = l.actor
   where l.outbox_id = o.id;
  return jsonb_build_object('id', o.id, 'email_key', o.email_key, 'recipient', o.recipient_email::text, 'cc', coalesce(to_jsonb(o.cc), '[]'::jsonb),
    'subject', o.subject, 'body_html', o.body_html, 'state', app_private.email_state(o.status, o.blocked_reason), 'status', o.status, 'blocked_reason', o.blocked_reason,
    'error_code', o.error_code, 'attempts', o.attempts, 'send_attempt', o.send_attempt, 'fail_streak', o.fail_streak, 'created_at', o.created_at,
    'next_attempt_at', o.next_attempt_at, 'sent_at', o.sent_at, 'message_id', o.message_id, 'gmail_message_id', o.gmail_message_id, 'resolution', o.resolution,
    'resolved_at', o.resolved_at, 'sender_email', (select c.email::text from app_private.google_connections c where c.id = o.sender_connection_id), 'sender_source', o.sender_source,
    'events', v_events);
end $$;

-- counts by state for a project (and per node): the badges of the project page and of the Selection / Booking nodes
create or replace function public.get_email_outbox_counts(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_total jsonb; v_nodes jsonb;
begin
  if p_project is null or not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  select coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb) into v_total
    from (select app_private.email_state(o.status, o.blocked_reason) as state, count(*) as n from app_private.email_outbox o where o.project_id = p_project group by 1) s;
  select coalesce(jsonb_object_agg(s.node_id, s.c), '{}'::jsonb) into v_nodes
    from (select x.node_id, jsonb_object_agg(x.state, x.n) as c
            from (select o.node_id, app_private.email_state(o.status, o.blocked_reason) as state, count(*) as n
                    from app_private.email_outbox o where o.project_id = p_project group by 1, 2) x group by x.node_id) s;
  return jsonb_build_object('counts', v_total, 'by_node', v_nodes,
    'attention', coalesce((v_total ->> 'failed')::integer, 0) + coalesce((v_total ->> 'needs_review')::integer, 0) + coalesce((v_total ->> 'blocked')::integer, 0));
end $$;

-- PM actions. Each answers { requested, updated, skipped }; rows the caller cannot manage, or whose state does not allow the action, are skipped.
-- retry: failed | dead | queued (waiting or blocked) -> queued now, a fresh retry budget.
create or replace function public.email_outbox_retry(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return jsonb_build_object('requested', 0, 'updated', 0, 'skipped', 0); end if;
  if cardinality(p_ids) > 500 then raise exception 'email_invalid: too many rows' using errcode = '22023', hint = 'email_invalid', detail = 'ids:too_many'; end if;
  with u as (
    update app_private.email_outbox o set status = 'queued', next_attempt_at = now(), fail_streak = 0, blocked_reason = null, error_code = null, error_message = null,
           resolution = 'manual_retry', resolved_by = (select auth.uid()), resolved_at = now()
     where o.id = any(p_ids) and o.status in ('failed', 'dead', 'queued') and app_private.email_row_manageable(o.project_id)
    returning o.id)
  select array_agg(id) into v_ids from u;
  v_n := coalesce(cardinality(v_ids), 0);
  perform app_private.email_log_add(x, 'manual_retry', 'retried by a person', null, 'queued', null, null, (select auth.uid())) from unnest(coalesce(v_ids, '{}')) x;
  return jsonb_build_object('requested', cardinality(p_ids), 'updated', v_n, 'skipped', cardinality(p_ids) - v_n);
end $$;

-- cancel: queued (waiting / blocked) | failed | dead | needs_review -> cancelled (terminal). A row being sent right now cannot be cancelled.
create or replace function public.email_outbox_cancel(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return jsonb_build_object('requested', 0, 'updated', 0, 'skipped', 0); end if;
  if cardinality(p_ids) > 500 then raise exception 'email_invalid: too many rows' using errcode = '22023', hint = 'email_invalid', detail = 'ids:too_many'; end if;
  with u as (
    update app_private.email_outbox o set status = 'cancelled', resolution = 'manual_cancel', resolved_by = (select auth.uid()), resolved_at = now()
     where o.id = any(p_ids) and o.status in ('queued', 'failed', 'dead', 'needs_review') and app_private.email_row_manageable(o.project_id)
    returning o.id)
  select array_agg(id) into v_ids from u;
  v_n := coalesce(cardinality(v_ids), 0);
  perform app_private.email_log_add(x, 'manual_cancel', 'cancelled by a person', null, 'cancelled', null, null, (select auth.uid())) from unnest(coalesce(v_ids, '{}')) x;
  return jsonb_build_object('requested', cardinality(p_ids), 'updated', v_n, 'skipped', cardinality(p_ids) - v_n);
end $$;

-- mark_sent: needs_review | failed | dead -> sent, because a person knows the message went out (found in the Sent folder, or sent by hand)
create or replace function public.email_outbox_mark_sent(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return jsonb_build_object('requested', 0, 'updated', 0, 'skipped', 0); end if;
  if cardinality(p_ids) > 500 then raise exception 'email_invalid: too many rows' using errcode = '22023', hint = 'email_invalid', detail = 'ids:too_many'; end if;
  with u as (
    update app_private.email_outbox o set status = 'sent', sent_at = now(), error_code = null, error_message = null, fail_streak = 0,
           resolution = 'manual_sent', resolved_by = (select auth.uid()), resolved_at = now(),
           body_html = case when o.email_key = 'staff_invitation' then null else o.body_html end
     where o.id = any(p_ids) and o.status in ('needs_review', 'failed', 'dead') and app_private.email_row_manageable(o.project_id)
    returning o.id)
  select array_agg(id) into v_ids from u;
  v_n := coalesce(cardinality(v_ids), 0);
  perform app_private.email_log_add(x, 'manual_mark_sent', 'marked as sent by a person', null, 'sent', null, null, (select auth.uid())) from unnest(coalesce(v_ids, '{}')) x;
  return jsonb_build_object('requested', cardinality(p_ids), 'updated', v_n, 'skipped', cardinality(p_ids) - v_n);
end $$;

-- resend: needs_review -> queued again (a NEW request with a new Message-ID). The ONLY way a possibly-delivered message is sent a second time.
create or replace function public.email_outbox_resend(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return jsonb_build_object('requested', 0, 'updated', 0, 'skipped', 0); end if;
  if cardinality(p_ids) > 500 then raise exception 'email_invalid: too many rows' using errcode = '22023', hint = 'email_invalid', detail = 'ids:too_many'; end if;
  with u as (
    update app_private.email_outbox o set status = 'queued', next_attempt_at = now(), fail_streak = 0, error_code = null, error_message = null, send_started_at = null,
           resolution = 'manual_resend', resolved_by = (select auth.uid()), resolved_at = now()
     where o.id = any(p_ids) and o.status = 'needs_review' and app_private.email_row_manageable(o.project_id)
    returning o.id)
  select array_agg(id) into v_ids from u;
  v_n := coalesce(cardinality(v_ids), 0);
  perform app_private.email_log_add(x, 'manual_resend', 'sent again on purpose by a person', null, 'queued', null, null, (select auth.uid())) from unnest(coalesce(v_ids, '{}')) x;
  return jsonb_build_object('requested', cardinality(p_ids), 'updated', v_n, 'skipped', cardinality(p_ids) - v_n);
end $$;

-- "Send now": the project's waiting rows (backoff or blocked) become due immediately and the worker is kicked (when the scheduler is enabled).
create or replace function public.email_outbox_send_now(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_queued integer; v_kick bigint;
begin
  if p_project is null or not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  update app_private.email_outbox o set next_attempt_at = now(), blocked_reason = null where o.project_id = p_project and o.status = 'queued' and o.next_attempt_at > now();
  get diagnostics v_n = row_count;
  select count(*) into v_queued from app_private.email_outbox o where o.project_id = p_project and o.status = 'queued';
  if v_queued > 0 then v_kick := app_private.email_kick_worker(); end if;
  return jsonb_build_object('released', v_n, 'queued', v_queued, 'kicked', v_kick is not null);
end $$;

-- super_admin: the health of the whole queue
create or replace function public.get_email_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_queue jsonb; v_24h jsonb; v_blocked jsonb; v_senders jsonb; v_hb record; v_enabled text; v_cron boolean := false;
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  select jsonb_build_object(
      'depth', count(*) filter (where status = 'queued'),
      'ready', count(*) filter (where status = 'queued' and blocked_reason is null and next_attempt_at <= now()),
      'waiting', count(*) filter (where status = 'queued' and blocked_reason is null and next_attempt_at > now()),
      'blocked', count(*) filter (where status = 'queued' and blocked_reason is not null),
      'sending', count(*) filter (where status = 'sending'),
      'needs_review', count(*) filter (where status = 'needs_review'),
      'oldest_queued_at', min(created_at) filter (where status = 'queued'),
      'oldest_age_seconds', (extract(epoch from (now() - min(created_at) filter (where status = 'queued'))))::bigint)
    into v_queue from app_private.email_outbox;
  select jsonb_build_object('sent', count(*) filter (where status = 'sent'), 'failed', count(*) filter (where status in ('failed', 'dead')),
                            'needs_review', count(*) filter (where status = 'needs_review'))
    into v_24h from app_private.email_outbox where created_at > now() - interval '24 hours';
  select coalesce(jsonb_object_agg(b.blocked_reason, b.n), '{}'::jsonb) into v_blocked
    from (select blocked_reason, count(*) as n from app_private.email_outbox where status = 'queued' and blocked_reason is not null group by 1) b;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email::text, 'kind', c.kind, 'status', c.status, 'last_error', c.last_error,
            'queued', coalesce(x.queued, 0), 'blocked', coalesce(x.blocked, 0), 'sent_24h', coalesce(x.sent_24h, 0), 'failed_24h', coalesce(x.failed_24h, 0),
            'started_1m', coalesce(x.started_1m, 0), 'started_24h', coalesce(x.started_24h, 0), 'last_used_at', c.last_used_at) order by c.kind desc, c.email), '[]'::jsonb)
    into v_senders
    from app_private.google_connections c
    left join lateral (
      select (select count(*) from app_private.email_outbox o where o.sender_connection_id = c.id and o.status = 'queued') as queued,
             (select count(*) from app_private.email_outbox o where o.sender_connection_id = c.id and o.status = 'queued' and o.blocked_reason is not null) as blocked,
             (select count(*) from app_private.email_outbox o where o.sender_connection_id = c.id and o.status = 'sent' and o.sent_at > now() - interval '24 hours') as sent_24h,
             (select count(*) from app_private.email_outbox o where o.sender_connection_id = c.id and o.status in ('failed', 'dead') and o.created_at > now() - interval '24 hours') as failed_24h,
             (select count(*) from app_private.email_log l where l.sender_connection_id = c.id and l.event = 'send_started' and l.created_at > now() - interval '1 minute') as started_1m,
             (select count(*) from app_private.email_log l where l.sender_connection_id = c.id and l.event = 'send_started' and l.created_at > now() - interval '24 hours') as started_24h) x on true
   where c.status <> 'revoked' or x.queued > 0;
  select * into v_hb from app_private.worker_heartbeat where name = 'email-worker';
  select value into v_enabled from app_private.worker_settings where key = 'email_worker_enabled';
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''athar-email-worker'' and active)' into v_cron;
  end if;
  return jsonb_build_object('queue', v_queue, 'last_24h', v_24h, 'blocked_by_reason', v_blocked, 'senders', v_senders,
    'worker', jsonb_build_object('last_run_at', v_hb.last_run_at, 'age_seconds', (extract(epoch from (now() - v_hb.last_run_at)))::bigint,
                                 'summary', coalesce(v_hb.summary, '{}'::jsonb), 'scheduler_enabled', coalesce(v_enabled, '0') = '1', 'cron_scheduled', coalesce(v_cron, false)),
    'now', now());
end $$;

-- super_admin: the delivery state of each staff invitation e-mail (the invitations list shows it)
create or replace function public.list_staff_invitation_delivery() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('invitation_id', i.id, 'outbox_id', o.id, 'state', app_private.email_state(o.status, o.blocked_reason), 'status', o.status,
            'blocked_reason', o.blocked_reason, 'error_code', o.error_code, 'attempts', o.attempts, 'sent_at', o.sent_at, 'next_attempt_at', o.next_attempt_at,
            'sender_email', c.email::text, 'resolution', o.resolution) order by i.created_at desc)
          from public.staff_invitations i join app_private.email_outbox o on o.id = i.outbox_id
          left join app_private.google_connections c on c.id = o.sender_connection_id), '[]'::jsonb);
end $$;

-- ================================================================= 8. scheduler plumbing (database -> edge function over pg_net; NOTHING is scheduled by this file)
-- app_private.email_kick_worker(): POST to <functions_base_url>/email-worker with the shared secret (Vault 'athar-email-worker-secret'). A no-op until enabled.
create or replace function app_private.email_kick_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_on text; v_url text; v_secret text; v_last timestamptz; v_id bigint;
begin
  select s.value into v_on from app_private.worker_settings s where s.key = 'email_worker_enabled';
  if coalesce(v_on, '0') <> '1' then return null; end if;
  select s.value into v_url from app_private.worker_settings s where s.key = 'functions_base_url';
  if v_url is null or v_url !~ '^https?://[^\s]+$' then return null; end if;
  select s.updated_at into v_last from app_private.worker_settings s where s.key = 'last_kick_at';
  if v_last is not null and v_last > now() - interval '4 seconds' then return null; end if;     -- a burst of "Send now" clicks is one kick
  select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.name = 'athar-email-worker-secret';
  if v_secret is null or length(v_secret) < 24 then return null; end if;
  insert into app_private.worker_settings (key, value, updated_at) values ('last_kick_at', 'x', now())
    on conflict (key) do update set updated_at = excluded.updated_at;
  v_id := net.http_post(url => rtrim(v_url, '/') || '/email-worker', body => '{}'::jsonb,
                        headers => jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret), timeout_milliseconds => 5000);
  return v_id;
end $$;

-- enable: store the settings and the secret, schedule pg_cron (every minute) + the nightly maintenance. Run as postgres (db/scripts/email-worker-schedule.sh).
create or replace function app_private.email_worker_enable(p_base_url text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_base_url is null or p_base_url !~ '^https?://[^\s]+$' then raise exception 'email_invalid: base url' using errcode = '22023', hint = 'email_invalid', detail = 'base_url:invalid'; end if;
  if p_secret is null or length(p_secret) < 24 then raise exception 'email_invalid: secret' using errcode = '22023', hint = 'email_invalid', detail = 'secret:too_short'; end if;
  if to_regclass('cron.job') is null then raise exception 'pg_cron is not installed on this database' using errcode = '0A000'; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then raise exception 'pg_net is not installed on this database' using errcode = '0A000'; end if;
  select d.id into v_id from vault.decrypted_secrets d where d.name = 'athar-email-worker-secret';
  if v_id is null then perform vault.create_secret(p_secret, 'athar-email-worker-secret', 'shared secret of the email-worker edge function');
  else perform vault.update_secret(v_id, p_secret); end if;
  insert into app_private.worker_settings (key, value, updated_at) values ('functions_base_url', rtrim(p_base_url, '/'), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into app_private.worker_settings (key, value, updated_at) values ('email_worker_enabled', '1', now())
    on conflict (key) do update set value = '1', updated_at = now();
  perform cron.schedule('athar-email-worker', '* * * * *', 'select app_private.email_kick_worker()');
  perform cron.schedule('athar-email-maintenance', '23 3 * * *', 'select app_private.email_maintenance()');
  return app_private.email_worker_status();
end $$;

create or replace function app_private.email_worker_disable() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname in ('athar-email-worker', 'athar-email-maintenance');
  end if;
  delete from vault.secrets where name = 'athar-email-worker-secret';
  delete from app_private.worker_settings where key in ('email_worker_enabled', 'functions_base_url', 'last_kick_at');
  return app_private.email_worker_status();
end $$;

create or replace function app_private.email_worker_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_jobs jsonb := '[]'::jsonb; v_resp jsonb := '[]'::jsonb; v_hb record;
begin
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''name'', jobname, ''schedule'', schedule, ''active'', active)), ''[]''::jsonb) from cron.job where jobname like ''athar-email-%'''
      into v_jobs;
  end if;
  if to_regclass('net._http_response') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''status'', status_code, ''error'', left(error_msg, 120), ''at'', created) order by created desc), ''[]''::jsonb)
             from (select status_code, error_msg, created from net._http_response order by created desc limit 3) x' into v_resp;
  end if;
  select * into v_hb from app_private.worker_heartbeat where name = 'email-worker';
  return jsonb_build_object(
    'enabled', coalesce((select s.value from app_private.worker_settings s where s.key = 'email_worker_enabled'), '0') = '1',
    'functions_base_url', (select s.value from app_private.worker_settings s where s.key = 'functions_base_url'),
    'secret_set', exists (select 1 from vault.secrets v where v.name = 'athar-email-worker-secret'),
    'cron_jobs', v_jobs, 'last_http', v_resp, 'last_run_at', v_hb.last_run_at, 'last_summary', coalesce(v_hb.summary, '{}'::jsonb));
end $$;

-- nightly: the rendered subject / body of finished mail is dropped after 90 days (rows and the audit log stay: idempotency and counts)
create or replace function app_private.email_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pruned bigint;
begin
  update app_private.email_outbox set subject = null, body_html = null
   where created_at < now() - interval '90 days' and status in ('sent', 'failed', 'dead', 'cancelled') and (subject is not null or body_html is not null);
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('pruned', v_pruned);
end $$;

-- ================================================================= 9. grants
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'app_private.mask_email(text)'::regprocedure, 'app_private.email_hash(text)'::regprocedure, 'app_private.email_state(text,text)'::regprocedure,
    'app_private.email_log_add(uuid,text,text,integer,text,uuid,text,uuid)'::regprocedure, 'app_private.email_log_fill()'::regprocedure, 'app_private.google_connection_usable(uuid)'::regprocedure,
    'app_private.email_row_manageable(uuid)'::regprocedure, 'app_private.email_outbox_state_guard()'::regprocedure,
    'app_private.email_pick_sender(app_private.email_outbox)'::regprocedure, 'app_private.email_kick_worker()'::regprocedure,
    'app_private.email_worker_enable(text,text)'::regprocedure, 'app_private.email_worker_disable()'::regprocedure, 'app_private.email_worker_status()'::regprocedure,
    'app_private.email_maintenance()'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- the worker RPCs (and the deprecated shims keep their m06d grant): service_role ONLY
  foreach f in array array[
    'public.email_worker_claim(text,integer,integer,integer,integer)'::regprocedure, 'public.email_worker_mark_sending(uuid,text)'::regprocedure,
    'public.email_worker_finish(uuid,text,text,text,text,integer,text,text,integer)'::regprocedure, 'public.email_worker_heartbeat(text,jsonb)'::regprocedure,
    'public.claim_email_batch(uuid,integer)'::regprocedure, 'public.complete_email(uuid,text)'::regprocedure, 'public.fail_email(uuid,text,text,boolean)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.list_email_outbox(uuid,text[],uuid,text,integer,integer)'::regprocedure, 'public.get_email_outbox_item(uuid)'::regprocedure,
    'public.get_email_outbox_counts(uuid)'::regprocedure, 'public.email_outbox_retry(uuid[])'::regprocedure, 'public.email_outbox_cancel(uuid[])'::regprocedure,
    'public.email_outbox_mark_sent(uuid[])'::regprocedure, 'public.email_outbox_resend(uuid[])'::regprocedure, 'public.email_outbox_send_now(uuid)'::regprocedure,
    'public.get_email_health()'::regprocedure, 'public.list_staff_invitation_delivery()'::regprocedure] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ================================================================= self-check
do $$
begin
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
        'email_worker_claim', 'email_worker_mark_sending', 'email_worker_finish', 'email_worker_heartbeat', 'claim_email_batch', 'complete_email', 'fail_email',
        'list_email_outbox', 'get_email_outbox_item', 'get_email_outbox_counts', 'email_outbox_retry', 'email_outbox_cancel', 'email_outbox_mark_sent', 'email_outbox_resend',
        'email_outbox_send_now', 'get_email_health', 'list_staff_invitation_delivery') and p.prosecdef and 'search_path=""' = any(p.proconfig)) <> 17 then
    raise exception 'm62: a function is missing or lacks SECURITY DEFINER / search_path = ''''';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('email_outbox', 'email_log', 'worker_settings', 'worker_heartbeat')
             and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) then
    raise exception 'm62: a client role holds a privilege on an outbox table';
  end if;
  if exists (select 1 from app_private.email_outbox where status = 'sending' and locked_by is null) then
    raise exception 'm62: a sending row without a lease holder (the legacy claim ran?)';
  end if;
end $$;

commit;
