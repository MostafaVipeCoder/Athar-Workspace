-- m63_calendar_sync.sql  (Calendar / Meet sync of the Booking node; design 07 section 2; decisions 07-6 / 07-10 / 03-10 / 08 section 20.6)
-- Re-runnable (create ... if not exists / create or replace / drop ... if exists). Local DB only. Run AFTER m34, m06d and m61. Verify with db/verify/v63_calendar_sync.sql.
--
-- WHAT THIS ADDS (the database half of the `calendar-sync` edge function; the function itself is supabase-new/functions/calendar-sync):
--  1. app_private.calendar_sync_config (ONE row): the mode flag `calendar_sync_mode` = off | shadow | live (default SHADOW, a safety default),
--     the worker heartbeat (last_run_at / last_run_summary). app_private.calendar_sync_log: an append-only trail of what the worker did or WOULD do.
--     public.bookings.calendar_synced_at: the moment a Google event is known to exist for the booking (from then on its calendar owner is FROZEN).
--  2. MODES.  off    : nothing is claimed, the jobs wait.   shadow : the worker PLANS each pending job with the same code path as live and writes the plan
--                       to calendar_sync_log, it calls NO Google endpoint and never locks or completes a job (the Apps Script poller, through the
--                       poller_* bridge of m06d, can keep working next to it).   live : the worker claims, calls Google and writes the result back.
--     The poller bridge (poller_claim_bookings) and the generic claim_integration_jobs REFUSE calendar jobs while the mode is live, so a poller that was
--     not switched off in time can never create a second event.
--  3. Service-role RPCs (EXECUTE for service_role only; SECURITY DEFINER, search_path = ''):
--       calendar_worker_begin / calendar_worker_finish      mode + heartbeat
--       calendar_claim_jobs(limit, lease)                    atomic claim: FOR UPDATE SKIP LOCKED + a lease, strictly ONE job per booking at a time in creation
--                                                            order, an expired lease is reclaimed, a job that kept crashing its worker (6 claims) goes dead
--       calendar_job_context(job)                            everything the worker needs, read from stored data only (booking, slot in UTC, provider e-mail,
--                                                            node cc / admin lists, project time zone, Meet mode + shared link, the calendar owner decision)
--       calendar_note_event / calendar_complete_job          write-back (meet_link, owner, synced_at) fenced by the attempt number (a stale worker cannot complete)
--       calendar_fail_job / calendar_park_job                retryable-vs-permanent failure with backoff + max attempts; PARK = back to pending without a failure
--                                                            (needs a Google connection / needs reconnect), nothing is lost
--       calendar_shadow_peek / calendar_shadow_record        shadow mode
--  4. Client RPCs (authenticated): get_calendar_sync_mode, set_calendar_sync_mode (super_admin), get_calendar_sync_overview(node) (the per-booking sync
--     state the Bookings tab shows), get_calendar_sync_report (super_admin: the cut-over health check), retry_calendar_job re-created (a manual retry resets
--     the attempt counter and un-parks).
--  5. CALENDAR OWNER (who holds the event): an event that already exists stays on its calendar (frozen: no silent move); a new event goes to the node's
--     organizer connection, else the one recorded at booking time, else the node owner's own connection, else the system sender (startups@). A user
--     connection is only accepted for a user who may manage the booking's project (a PM cannot point a booking at somebody else's Google account).
--     Migrated bookings (legacy_calendar_event_id, created by the Apps Script poller on startups@) are marked "synced (migrated)" by DERIVATION (no rows are
--     written) and are never re-created: their create job is skipped, update / cancel act on the legacy event id through the system connection.
--  6. Guards: a trigger refuses a client role (authenticated / anon) changing calendar_owner_connection_id / calendar_synced_at / legacy_calendar_event_id on
--     bookings; a trigger on google_connections makes parked jobs due again the moment a connection becomes active.
--
-- NULL SAFETY: no guard of this file is written as `x <> y` on a nullable value; privileges (EXECUTE for service_role only) are the gate of the worker RPCs.
-- Error tokens (message prefix = hint): forbidden (42501), calendar_mode_invalid (22023).
set search_path = public, extensions;

begin;

-- ================================================================= 1. schema
alter table public.bookings add column if not exists calendar_synced_at timestamptz;

create table if not exists app_private.calendar_sync_config (
  id               boolean primary key default true check (id),
  mode             text not null default 'shadow' check (mode in ('off', 'shadow', 'live')),
  last_run_at      timestamptz,
  last_run_summary jsonb check (last_run_summary is null or octet_length(last_run_summary::text) <= 4096),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);
insert into app_private.calendar_sync_config (id) values (true) on conflict (id) do nothing;

create table if not exists app_private.calendar_sync_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  job_id     uuid references app_private.integration_jobs(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  event      text not null check (event ~ '^[a-z][a-z0-9_]{1,39}$'),
  mode       text check (mode is null or mode in ('off', 'shadow', 'live')),
  detail     jsonb check (detail is null or octet_length(detail::text) <= 8192),
  actor      uuid references auth.users(id) on delete set null
);
create index if not exists calendar_sync_log_job_idx on app_private.calendar_sync_log (job_id) where job_id is not null;
create index if not exists calendar_sync_log_booking_idx on app_private.calendar_sync_log (booking_id, at desc) where booking_id is not null;
create unique index if not exists calendar_sync_log_shadow_once on app_private.calendar_sync_log (job_id) where event = 'shadow';
create index if not exists calendar_sync_log_actor_idx on app_private.calendar_sync_log (actor) where actor is not null;   -- every foreign key is indexed (v02 V02.1a)
create index if not exists integration_jobs_calendar_due_idx on app_private.integration_jobs (next_attempt_at)
  where kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and status in ('pending', 'failed', 'processing');

alter table app_private.calendar_sync_config enable row level security;
alter table app_private.calendar_sync_config force row level security;
alter table app_private.calendar_sync_log enable row level security;
alter table app_private.calendar_sync_log force row level security;
revoke all on app_private.calendar_sync_config, app_private.calendar_sync_log from public, anon, authenticated, service_role;

-- ================================================================= 2. helpers (never callable by a client role)
create or replace function app_private.calendar_sync_mode() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.mode from app_private.calendar_sync_config c where c.id), 'shadow')
$$;

-- a connection that can make Calendar calls right now (active, calendar scope granted, a secret exists)
create or replace function app_private.calendar_conn_usable(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.status = 'active' and c.scopes @> array['https://www.googleapis.com/auth/calendar.events']
                          and (c.token_storage = 'aes' or c.vault_secret_id is not null)
                     from app_private.google_connections c where c.id = p_id), false)
$$;

-- may this user hold calendar events of this project? (the explicit-user twin of app_private.is_project_manager)
create or replace function app_private.calendar_user_may_host(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and p_project is not null and (
       exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role_key = 'super_admin')
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = p_user)
    or exists (select 1 from public.projects j join public.program_members pm on pm.program_id = j.program_id where j.id = p_project and pm.user_id = p_user))
$$;

-- WHO holds the Google event of a booking (design 07 section 2.2 table). One row: connection_id (NULL = nobody usable), source, usable, status, reason.
--   reason: needs_connection (no usable connection exists) | needs_reconnect (one exists but Google refused it: invalid_grant)
create or replace function app_private.calendar_pick_connection(p_booking uuid, p_job_conn uuid default null)
returns table (connection_id uuid, source text, usable boolean, status text, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.bookings; n public.nodes; bs public.booking_settings; v_sys uuid; v_cand uuid[]; v_src text[]; i int; c app_private.google_connections; r record;
begin
  select * into b from public.bookings x where x.id = p_booking;
  if not found then return; end if;
  select * into n from public.nodes x where x.id = b.node_id;
  select * into bs from public.booking_settings x where x.node_id = b.node_id;
  select x.id into v_sys from app_private.google_connections x where x.kind = 'system';

  if b.calendar_synced_at is not null or b.legacy_calendar_event_id is not null then
    -- the event already exists on ONE calendar: never moved silently (a legacy event was created by the poller on the system account)
    connection_id := coalesce(b.calendar_owner_connection_id, case when b.legacy_calendar_event_id is not null then v_sys end);
    source := case when b.calendar_owner_connection_id is not null then 'owner' else 'legacy_system' end;
    select * into c from app_private.google_connections x where x.id = connection_id;
    status := c.status;
    usable := c.id is not null and app_private.calendar_conn_usable(c.id);
    reason := case when usable then null when c.id is null or c.status = 'revoked' then 'needs_connection' else 'needs_reconnect' end;
    return next;
    return;
  end if;

  -- a NEW event: the node's organizer setting, the connection recorded at booking time, the job's, then the node owner's own (else the system sender)
  v_cand := array[bs.organizer_connection_id, b.calendar_owner_connection_id, p_job_conn];
  v_src := array['organizer', 'booking', 'job'];
  for i in 1 .. 3 loop
    if v_cand[i] is null then continue; end if;
    select * into c from app_private.google_connections x where x.id = v_cand[i];
    if c.id is null then continue; end if;
    if (c.kind = 'system' or app_private.calendar_user_may_host(c.owner_user_id, b.project_id)) and app_private.calendar_conn_usable(c.id) then
      connection_id := c.id; source := v_src[i]; usable := true; status := c.status; reason := null;
      return next;
      return;
    end if;
  end loop;
  select * into r from app_private.google_resolve_sender(n.created_by);
  if r.connection_id is not null and app_private.calendar_conn_usable(r.connection_id) then
    connection_id := r.connection_id; source := r.source; usable := true; status := 'active'; reason := null;
    return next;
    return;
  end if;
  connection_id := null; source := null; usable := false; status := null;
  reason := case when exists (select 1 from app_private.google_connections x
                               where x.status = 'needs_reconnect' and (x.id = any (v_cand) or x.owner_user_id = n.created_by or x.kind = 'system'))
                 then 'needs_reconnect' else 'needs_connection' end;
  return next;
end $$;

-- a short machine code (never a message): lower case, no spaces, at most 64 characters
create or replace function app_private.calendar_code(p_code text, p_default text default 'error') returns text
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(nullif(left(regexp_replace(lower(coalesce(p_code, '')), '[^a-z0-9_.:-]', '_', 'g'), 64), ''), p_default)
$$;

create or replace function app_private.calendar_log(p_event text, p_job uuid, p_booking uuid, p_detail jsonb default null, p_actor uuid default null) returns void
language sql volatile security definer set search_path = '' as $$
  insert into app_private.calendar_sync_log (job_id, booking_id, event, mode, detail, actor)
  values (p_job, p_booking,
          coalesce(nullif(left(regexp_replace(regexp_replace(lower(coalesce(p_event, '')), '[^a-z0-9_]', '_', 'g'), '^[^a-z]+', ''), 40), ''), 'event'),
          app_private.calendar_sync_mode(), p_detail, p_actor)
$$;

-- ================================================================= 3. the worker's RPCs (service role only)
create or replace function public.calendar_worker_begin() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  update app_private.calendar_sync_config set last_run_at = now() where id;
  return jsonb_build_object('mode', app_private.calendar_sync_mode(), 'now', clock_timestamp());
end $$;

create or replace function public.calendar_worker_finish(p_summary jsonb default null) returns void
language sql volatile security definer set search_path = '' as $$
  update app_private.calendar_sync_config
     set last_run_summary = case when p_summary is not null and jsonb_typeof(p_summary) = 'object' and octet_length(p_summary::text) <= 4096 then p_summary end
   where id
$$;

-- LIVE only. One job per booking at a time (creation order), SKIP LOCKED, a lease, attempts + 1. Returns the claimed jobs (metadata, no addresses).
create or replace function public.calendar_claim_jobs(p_limit int default 10, p_lease_seconds int default 300) returns setof jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if app_private.calendar_sync_mode() <> 'live' then return; end if;
  -- poison pill: a job whose lease expired six times (the worker died each time) is parked as dead, not retried for ever
  update app_private.integration_jobs j set status = 'dead', locked_until = null, error = 'lease_expired'
   where j.kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and j.status = 'processing' and j.locked_until < now() and j.attempts >= 6;
  return query
  with picked as (
    select x.id from app_private.integration_jobs x
     where x.kind in ('calendar_create', 'calendar_update', 'calendar_cancel')
       and x.next_attempt_at <= now()
       and (x.status in ('pending', 'failed') or (x.status = 'processing' and x.locked_until < now()))
       -- strictly ordered per booking: an earlier job of the same booking that is not finished blocks this one
       and not exists (select 1 from app_private.integration_jobs e
                        where x.booking_id is not null and e.booking_id = x.booking_id and e.id <> x.id
                          and e.kind in ('calendar_create', 'calendar_update', 'calendar_cancel')
                          and e.status in ('pending', 'failed', 'processing') and e.created_at < x.created_at)
     order by x.next_attempt_at, x.created_at
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
     for update of x skip locked),
  upd as (
    update app_private.integration_jobs j
       set status = 'processing', attempts = j.attempts + 1, error = null,
           locked_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900))
     where j.id in (select id from picked)
    returning j.id, j.kind, j.booking_id, j.connection_id, j.attempts, j.payload, j.created_at)
  select jsonb_build_object('id', u.id, 'kind', u.kind, 'booking_id', u.booking_id, 'connection_id', u.connection_id, 'attempts', u.attempts, 'payload', u.payload, 'created_at', u.created_at)
    from upd u order by u.created_at;
end $$;

-- everything the worker needs for one job, from stored data only (the request carries nothing the worker could be talked into)
create or replace function public.calendar_job_context(p_job uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  j app_private.integration_jobs; b public.bookings; sl public.booking_slots; n public.nodes; pj public.projects; bs public.booking_settings; pv public.booking_providers;
  v_pemail text; v_pen text; v_par text; v_co_en text; v_co_ar text; v_may boolean; v_conn record; v_cemail text; v_tpl jsonb;
begin
  if p_job is null then return null; end if;
  select * into j from app_private.integration_jobs x where x.id = p_job;
  if not found or j.kind not in ('calendar_create', 'calendar_update', 'calendar_cancel') then return null; end if;
  select * into b from public.bookings x where x.id = j.booking_id;
  if not found then
    return jsonb_build_object('mode', app_private.calendar_sync_mode(), 'now', clock_timestamp(), 'booking', null,
      'job', jsonb_build_object('id', j.id, 'kind', j.kind, 'attempts', j.attempts, 'status', j.status, 'payload', j.payload, 'connection_id', j.connection_id, 'created_at', j.created_at));
  end if;
  select * into sl from public.booking_slots x where x.id = b.slot_id;
  select * into n from public.nodes x where x.id = b.node_id;
  select * into pj from public.projects x where x.id = b.project_id;
  select * into bs from public.booking_settings x where x.node_id = b.node_id;
  select * into pv from public.booking_providers x where x.id = sl.provider_id;
  select coalesce(pv.booking_email::text, ne.email::text, li.manual_fields->>'email'),
         btrim(regexp_replace(coalesce(ne.name_en, li.manual_fields->>'title_en', ne.name_ar, li.manual_fields->>'title_ar', ''), '[[:space:]]+', ' ', 'g')),
         btrim(regexp_replace(coalesce(ne.name_ar, li.manual_fields->>'title_ar', ne.name_en, li.manual_fields->>'title_en', ''), '[[:space:]]+', ' ', 'g'))
    into v_pemail, v_pen, v_par
    from public.list_items li left join public.network_experts ne on ne.id = li.network_expert_id where li.id = pv.list_item_id;
  select co.name_en, co.name_ar into v_co_en, v_co_ar from public.companies co where co.id = b.booker_company_id;
  -- a Google event may exist when: it was migrated, the worker already wrote it down, or an earlier attempt of a create job reached Google
  v_may := b.legacy_calendar_event_id is not null or b.calendar_synced_at is not null
        or exists (select 1 from app_private.integration_jobs e
                    where e.booking_id = b.id and e.kind = 'calendar_create'
                      and (e.attempts - case when e.id = j.id and e.status = 'processing' then 1 else 0 end) > 0
                      and not (e.status = 'done' and coalesce(e.result->>'action', '') like 'skipped%'));  -- a create that only SKIPPED never reached Google
  select * into v_conn from app_private.calendar_pick_connection(b.id, j.connection_id);
  select c.email::text into v_cemail from app_private.google_connections c where c.id = v_conn.connection_id;
  v_tpl := coalesce(n.config->'emails'->'booking_confirmation', '{}'::jsonb);
  return jsonb_build_object(
    'mode', app_private.calendar_sync_mode(),
    'now', clock_timestamp(),
    'job', jsonb_build_object('id', j.id, 'kind', j.kind, 'attempts', j.attempts, 'status', j.status, 'payload', j.payload, 'connection_id', j.connection_id, 'created_at', j.created_at),
    'booking', jsonb_build_object('id', b.id, 'status', b.status, 'booker_email', b.booker_email::text, 'booker_name', b.booker_name, 'booker_company_name', b.booker_company_name,
                'company_en', v_co_en, 'company_ar', v_co_ar, 'lang', coalesce(b.lang, 'en'), 'meet_link', b.meet_link, 'event_id', b.calendar_event_id,
                'legacy_event', b.legacy_calendar_event_id is not null, 'synced_at', b.calendar_synced_at, 'owner_connection_id', b.calendar_owner_connection_id,
                'event_may_exist', v_may),
    'slot', jsonb_build_object('id', sl.id, 'starts_at', sl.starts_at, 'ends_at', sl.ends_at),
    'provider', jsonb_build_object('email', v_pemail, 'name_en', v_pen, 'name_ar', v_par),
    'node', jsonb_build_object('id', n.id, 'name_en', n.name_en, 'name_ar', n.name_ar, 'created_by', n.created_by, 'mode', bs.mode,
                'cc', case when jsonb_typeof(v_tpl->'cc') = 'array' then v_tpl->'cc' else '[]'::jsonb end,
                'admin', case when jsonb_typeof(v_tpl->'admin') = 'array' then v_tpl->'admin' else '[]'::jsonb end),
    'project', jsonb_build_object('id', pj.id, 'name_en', pj.name_en, 'name_ar', pj.name_ar, 'timezone', pj.timezone),
    'settings', jsonb_build_object('meeting_link_mode', bs.meeting_link_mode, 'shared_meet_link', bs.shared_meet_link, 'organizer_connection_id', bs.organizer_connection_id),
    'connection', jsonb_build_object('id', v_conn.connection_id, 'source', v_conn.source, 'usable', coalesce(v_conn.usable, false), 'status', v_conn.status, 'reason', v_conn.reason, 'email', v_cemail));
end $$;

-- the worker noted that Google ACCEPTED the event (created / adopted): the owner is frozen from now on, a cancel will reach the right calendar
create or replace function public.calendar_note_event(p_job uuid, p_attempt int, p_owner uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare j app_private.integration_jobs;
begin
  select * into j from app_private.integration_jobs x where x.id = p_job for update;
  if not found or j.status <> 'processing' or j.attempts is distinct from p_attempt or j.booking_id is null then return false; end if;
  update public.bookings set calendar_owner_connection_id = coalesce(p_owner, calendar_owner_connection_id), calendar_synced_at = coalesce(calendar_synced_at, now())
   where id = j.booking_id and (calendar_synced_at is null or calendar_owner_connection_id is null);
  return true;
end $$;

-- success: the job is done and the Meet link / owner are written back in the SAME transaction; false = the lease was lost (a newer attempt owns the job)
create or replace function public.calendar_complete_job(p_job uuid, p_attempt int, p_result jsonb default '{}'::jsonb, p_meet_link text default null, p_owner uuid default null) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare j app_private.integration_jobs; v_res jsonb := case when p_result is not null and jsonb_typeof(p_result) = 'object' and octet_length(p_result::text) <= 8000 then p_result else '{}'::jsonb end;
        v_link text := nullif(btrim(coalesce(p_meet_link, '')), '');
begin
  select * into j from app_private.integration_jobs x where x.id = p_job for update;
  if not found or j.status <> 'processing' or j.attempts is distinct from p_attempt then return false; end if;
  if j.booking_id is not null then
    if v_link is not null and v_link ~* '^https://[^[:space:]]+$' then
      update public.bookings set meet_link = v_link where id = j.booking_id and meet_link is distinct from v_link;
    end if;
    if p_owner is not null then
      update public.bookings set calendar_owner_connection_id = coalesce(calendar_owner_connection_id, p_owner), calendar_synced_at = coalesce(calendar_synced_at, now())
       where id = j.booking_id and j.kind <> 'calendar_cancel' and (calendar_synced_at is null or calendar_owner_connection_id is null);
    end if;
  end if;
  update app_private.integration_jobs set status = 'done', result = v_res, locked_until = null, error = null where id = p_job;
  perform app_private.calendar_log(coalesce(v_res->>'action', 'done'), p_job, j.booking_id, jsonb_build_object('kind', j.kind, 'attempt', j.attempts) || v_res);
  return true;
end $$;

-- failure: retryable -> `failed` + the next attempt after p_delay_seconds (the worker computes backoff / Retry-After), permanent or out of attempts -> `dead`
create or replace function public.calendar_fail_job(p_job uuid, p_attempt int, p_code text, p_retryable boolean default true, p_delay_seconds int default 60, p_max_attempts int default 6) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare j app_private.integration_jobs; v_code text := app_private.calendar_code(p_code); v_final boolean; v_status text;
begin
  select * into j from app_private.integration_jobs x where x.id = p_job for update;
  if not found or j.status <> 'processing' or j.attempts is distinct from p_attempt then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_final := not coalesce(p_retryable, false) or j.attempts >= greatest(coalesce(p_max_attempts, 6), 1);
  v_status := case when v_final then 'dead' else 'failed' end;
  update app_private.integration_jobs
     set status = v_status, locked_until = null, error = v_code,
         next_attempt_at = case when v_final then next_attempt_at else now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 60), 0), 86400)) end
   where id = p_job;
  perform app_private.calendar_log(case when v_final then 'dead' else 'failed' end, p_job, j.booking_id, jsonb_build_object('kind', j.kind, 'attempt', j.attempts, 'code', v_code, 'retryable', coalesce(p_retryable, false)));
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- park: no usable Google connection. Back to `pending` WITHOUT counting an attempt; the code (needs_connection | needs_reconnect) tells the UI why.
create or replace function public.calendar_park_job(p_job uuid, p_attempt int, p_code text default 'needs_connection', p_delay_seconds int default 900) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare j app_private.integration_jobs; v_code text := app_private.calendar_code(p_code, 'needs_connection');
begin
  select * into j from app_private.integration_jobs x where x.id = p_job for update;
  if not found or j.status <> 'processing' or j.attempts is distinct from p_attempt then return false; end if;
  update app_private.integration_jobs
     set status = 'pending', locked_until = null, attempts = greatest(attempts - 1, 0), error = v_code,
         next_attempt_at = now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 900), 1), 86400))
   where id = p_job;
  if j.error is distinct from v_code then
    perform app_private.calendar_log('parked', p_job, j.booking_id, jsonb_build_object('kind', j.kind, 'code', v_code));
  end if;
  return true;
end $$;

-- SHADOW: pending jobs nobody has planned yet (no lock, no state change: the poller may still take them)
create or replace function public.calendar_shadow_peek(p_limit int default 20) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.calendar_sync_mode() <> 'shadow' then return; end if;
  return query
    select jsonb_build_object('id', x.id, 'kind', x.kind, 'booking_id', x.booking_id, 'created_at', x.created_at)
      from app_private.integration_jobs x
     where x.kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and x.status in ('pending', 'failed')
       and not exists (select 1 from app_private.calendar_sync_log l where l.job_id = x.id and l.event = 'shadow')
     order by x.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

create or replace function public.calendar_shadow_record(p_job uuid, p_plan jsonb) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare j app_private.integration_jobs; v_n int;
begin
  select * into j from app_private.integration_jobs x where x.id = p_job;
  if not found or j.kind not in ('calendar_create', 'calendar_update', 'calendar_cancel') then return false; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or octet_length(p_plan::text) > 8000 then return false; end if;
  insert into app_private.calendar_sync_log (job_id, booking_id, event, mode, detail) values (p_job, j.booking_id, 'shadow', 'shadow', p_plan)
    on conflict (job_id) where event = 'shadow' do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ================================================================= 4. client RPCs (authenticated)
create or replace function public.get_calendar_sync_mode() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app_private.google_user_is_staff(v_uid) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  return jsonb_build_object('mode', app_private.calendar_sync_mode(), 'can_set', app_private.google_user_is_super_admin(v_uid),
    'last_run_at', (select c.last_run_at from app_private.calendar_sync_config c where c.id));
end $$;

create or replace function public.set_calendar_sync_mode(p_mode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_old text; v_inflight int;
begin
  if v_uid is null or not app_private.google_user_is_super_admin(v_uid) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  if p_mode is null or p_mode not in ('off', 'shadow', 'live') then
    raise exception 'calendar_mode_invalid: mode must be off, shadow or live' using errcode = '22023', hint = 'calendar_mode_invalid', detail = 'mode:invalid';
  end if;
  select c.mode into v_old from app_private.calendar_sync_config c where c.id for update;
  update app_private.calendar_sync_config set mode = p_mode, updated_at = now(), updated_by = v_uid where id;
  if v_old is distinct from p_mode then
    perform app_private.calendar_log('mode_changed', null, null, jsonb_build_object('from', v_old, 'to', p_mode), v_uid);
  end if;
  -- jobs somebody (the poller bridge, a worker) is working on right now: switch to live only when this is 0 (runbook step)
  select count(*)::int into v_inflight from app_private.integration_jobs j
   where j.kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and j.status = 'processing' and j.locked_until > now();
  return jsonb_build_object('mode', p_mode, 'previous', v_old, 'in_flight', v_inflight);
end $$;

-- the Bookings tab: the sync state of every booking of a node, derived (migrated bookings are "migrated", nothing is written for them)
create or replace function public.get_calendar_sync_overview(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes; v_mode text := app_private.calendar_sync_mode();
begin
  select * into n from public.nodes x where x.id = p_node and x.type = 'booking' and x.deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  return jsonb_build_object(
    'mode', v_mode,
    'can_set_mode', coalesce((select app_private.is_super_admin()), false),
    'last_run_at', (select c.last_run_at from app_private.calendar_sync_config c where c.id),
    'now', now(),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', b.id,
        'state', case
          when lj.id is null then case when b.status = 'cancelled' then 'cancelled' when b.legacy_calendar_event_id is not null then 'migrated' when b.calendar_synced_at is not null then 'synced' else 'none' end
          when lj.status = 'done' then case
            when lj.result->>'action' = 'skipped_migrated' then 'migrated'
            when lj.result->>'action' = 'skipped_past' then 'past'
            when lj.kind = 'calendar_cancel' or lj.result->>'action' like 'skipped_cancel%' then 'cancelled'
            else 'synced' end
          when lj.status = 'processing' then 'syncing'
          when lj.status = 'failed' then 'retrying'
          when lj.status = 'dead' then 'failed'
          when lj.error in ('needs_connection', 'needs_reconnect') then 'needs_connection'
          when v_mode = 'off' then 'off'
          when v_mode = 'shadow' then 'shadow'
          else 'pending' end,
        'code', case when lj.status in ('failed', 'dead', 'pending') and lj.error ~ '^[a-z0-9_.:-]{1,64}$' then lj.error end,
        'job', case when lj.id is null then null else jsonb_build_object('id', lj.id, 'kind', lj.kind, 'status', lj.status, 'attempts', lj.attempts,
                  'next_attempt_at', lj.next_attempt_at, 'updated_at', lj.updated_at, 'action', lj.result->>'action', 'html_link', lj.result->>'html_link') end,
        'event_id', case when b.legacy_calendar_event_id is not null or b.calendar_synced_at is not null then b.calendar_event_id end,
        'migrated', b.legacy_calendar_event_id is not null,
        'synced_at', b.calendar_synced_at,
        'calendar_email', (select c.email::text from app_private.google_connections c
                            where c.id = coalesce(b.calendar_owner_connection_id, case when b.legacy_calendar_event_id is not null then (select s.id from app_private.google_connections s where s.kind = 'system') end)),
        'plan', case when lj.id is not null and v_mode = 'shadow' and lj.status in ('pending', 'failed')
                     then (select l.detail from app_private.calendar_sync_log l where l.job_id = lj.id and l.event = 'shadow') end)
        order by b.created_at)
      from public.bookings b
      left join lateral (select j.* from app_private.integration_jobs j
                          where j.booking_id = b.id and j.kind in ('calendar_create', 'calendar_update', 'calendar_cancel')
                          order by j.created_at desc, j.id desc limit 1) lj on true
      where b.node_id = n.id), '[]'::jsonb));
end $$;

-- super_admin: the cut-over health check (what is waiting, what is stuck, what the shadow runs found, whether the worker runs at all)
create or replace function public.get_calendar_sync_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select app_private.is_super_admin()), false) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  return jsonb_build_object(
    'mode', app_private.calendar_sync_mode(),
    'last_run_at', (select c.last_run_at from app_private.calendar_sync_config c where c.id),
    'last_run_summary', (select c.last_run_summary from app_private.calendar_sync_config c where c.id),
    'jobs', (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending' and coalesce(error, '') not in ('needs_connection', 'needs_reconnect')),
        'parked', count(*) filter (where status = 'pending' and error in ('needs_connection', 'needs_reconnect')),
        'processing', count(*) filter (where status = 'processing'),
        'in_flight', count(*) filter (where status = 'processing' and locked_until > now()),
        'retrying', count(*) filter (where status = 'failed'),
        'dead', count(*) filter (where status = 'dead'),
        'done', count(*) filter (where status = 'done'),
        'oldest_pending_minutes', (extract(epoch from (now() - min(created_at) filter (where status in ('pending', 'failed')))) / 60)::int)
      from app_private.integration_jobs where kind in ('calendar_create', 'calendar_update', 'calendar_cancel')),
    'shadow', (select jsonb_build_object('planned', count(*),
        'would_sync', count(*) filter (where detail->>'action' in ('create', 'patch', 'delete')),
        'would_skip', count(*) filter (where detail->>'action' = 'skip'),
        'would_park', count(*) filter (where detail->>'action' = 'park'),
        'would_fail', count(*) filter (where detail->>'action' = 'fail'),
        'problems', coalesce((select jsonb_object_agg(p, k) from (select detail->>'code' p, count(*) k from app_private.calendar_sync_log
                                where event = 'shadow' and detail->>'code' is not null group by 1) q), '{}'::jsonb))
      from app_private.calendar_sync_log where event = 'shadow'),
    'bookings', (select jsonb_build_object('total', count(*), 'migrated', count(*) filter (where legacy_calendar_event_id is not null),
        'synced', count(*) filter (where calendar_synced_at is not null)) from public.bookings),
    'connections', (select jsonb_build_object('system', (select c.status from app_private.google_connections c where c.kind = 'system'),
        'active_users', count(*) filter (where kind = 'user' and status = 'active'),
        'needs_reconnect', count(*) filter (where status = 'needs_reconnect')) from app_private.google_connections));
end $$;

-- a manual retry: failed / dead jobs of the booking start again with a fresh attempt counter, parked ones become due now
create or replace function public.retry_calendar_job(p_booking uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; k int;
begin
  select * into b from public.bookings x where x.id = p_booking;
  if not found or not app_private.is_project_manager(b.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  with u as (
    update app_private.integration_jobs
       set status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = null, error = null
     where booking_id = p_booking and kind in ('calendar_create', 'calendar_update', 'calendar_cancel')
       and (status in ('failed', 'dead') or (status = 'pending' and next_attempt_at > now()))
    returning 1)
  select count(*)::int into k from u;
  if k > 0 then perform app_private.calendar_log('retry_requested', null, p_booking, jsonb_build_object('jobs', k), (select auth.uid())); end if;
  return k;
end $$;

-- ================================================================= 5. the poller bridge and the generic claim step aside while the mode is live
create or replace function public.claim_integration_jobs(p_kind text, p_limit int default 10) returns setof app_private.integration_jobs
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;   -- NULL-safe like m43
  if p_kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and app_private.calendar_sync_mode() = 'live' then return; end if;  -- calendar-sync owns them (calendar_claim_jobs)
  return query
  update app_private.integration_jobs j set status = 'processing', attempts = j.attempts + 1, locked_until = now() + interval '5 minutes'
  where j.id in (select x.id from app_private.integration_jobs x
                 where x.kind = p_kind and x.next_attempt_at <= now()
                   and (x.status in ('pending','failed') or (x.status = 'processing' and x.locked_until < now()))
                 order by x.next_attempt_at limit least(greatest(p_limit, 1), 100) for update skip locked)
  returning j.*;
end $$;

create or replace function public.poller_claim_bookings(p_limit int default 20)
returns table (job_id uuid, booking_id uuid, kind text, starts_at timestamptz, ends_at timestamptz, booker_email text, booker_name text,
               provider_email text, meeting_link_mode text, shared_meet_link text, calendar_event_id text, mode text)
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.has_role('integration') then raise exception 'forbidden' using errcode = '42501'; end if;
  if app_private.calendar_sync_mode() = 'live' then return; end if;   -- the new worker owns the jobs: a poller that was not switched off creates nothing
  return query
  with c as (
    update app_private.integration_jobs j set status = 'processing', attempts = j.attempts + 1, locked_until = now() + interval '5 minutes'
    where j.id in (select x.id from app_private.integration_jobs x
                   where x.kind in ('calendar_create','calendar_update','calendar_cancel') and x.next_attempt_at <= now()
                     and (x.status in ('pending','failed') or (x.status = 'processing' and x.locked_until < now()))
                   order by x.next_attempt_at limit least(greatest(p_limit, 1), 50) for update skip locked)
    returning j.id, j.booking_id, j.kind)
  select c.id, b.id, c.kind, s.starts_at, s.ends_at, b.booker_email::text, b.booker_name,
         coalesce(p.booking_email, ne.email)::text, bs.meeting_link_mode, bs.shared_meet_link, b.calendar_event_id, bs.mode
  from c
  join public.bookings b on b.id = c.booking_id
  join public.booking_slots s on s.id = b.slot_id
  join public.booking_providers p on p.id = s.provider_id
  join public.list_items li on li.id = p.list_item_id
  left join public.network_experts ne on ne.id = li.network_expert_id
  join public.booking_settings bs on bs.node_id = b.node_id;
end $$;

-- ================================================================= 6. guards
-- the calendar-owned columns of a booking can be changed by the definer functions (the worker, create_booking) and by nobody on the client side
create or replace function app_private.bookings_guard_calendar_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'forbidden: the calendar columns of a booking are maintained by the calendar sync' using errcode = '42501', hint = 'forbidden';
  end if;
  return new;
end $$;
drop trigger if exists bookings_bu_calendar_guard on public.bookings;
create trigger bookings_bu_calendar_guard before update of calendar_owner_connection_id, calendar_synced_at, legacy_calendar_event_id on public.bookings
  for each row execute function app_private.bookings_guard_calendar_columns();

-- a connection that becomes active (a PM reconnected, the system sender was linked) makes the parked jobs due at once
create or replace function app_private.google_connection_unpark_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.integration_jobs set next_attempt_at = now()
   where kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and status = 'pending' and error in ('needs_connection', 'needs_reconnect') and next_attempt_at > now();
  return null;
end $$;
drop trigger if exists google_connections_ai_unpark_calendar on app_private.google_connections;
create trigger google_connections_ai_unpark_calendar after insert on app_private.google_connections
  for each row when (new.status = 'active') execute function app_private.google_connection_unpark_calendar();
drop trigger if exists google_connections_au_unpark_calendar on app_private.google_connections;
create trigger google_connections_au_unpark_calendar after update of status on app_private.google_connections
  for each row when (new.status = 'active' and old.status is distinct from 'active') execute function app_private.google_connection_unpark_calendar();

-- ================================================================= 7. grants
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'app_private.calendar_sync_mode()'::regprocedure, 'app_private.calendar_conn_usable(uuid)'::regprocedure, 'app_private.calendar_user_may_host(uuid,uuid)'::regprocedure,
    'app_private.calendar_pick_connection(uuid,uuid)'::regprocedure, 'app_private.calendar_code(text,text)'::regprocedure,
    'app_private.calendar_log(text,uuid,uuid,jsonb,uuid)'::regprocedure, 'app_private.bookings_guard_calendar_columns()'::regprocedure,
    'app_private.google_connection_unpark_calendar()'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.calendar_worker_begin()'::regprocedure, 'public.calendar_worker_finish(jsonb)'::regprocedure, 'public.calendar_claim_jobs(int,int)'::regprocedure,
    'public.calendar_job_context(uuid)'::regprocedure, 'public.calendar_note_event(uuid,int,uuid)'::regprocedure, 'public.calendar_complete_job(uuid,int,jsonb,text,uuid)'::regprocedure,
    'public.calendar_fail_job(uuid,int,text,boolean,int,int)'::regprocedure, 'public.calendar_park_job(uuid,int,text,int)'::regprocedure,
    'public.calendar_shadow_peek(int)'::regprocedure, 'public.calendar_shadow_record(uuid,jsonb)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_calendar_sync_mode()'::regprocedure, 'public.set_calendar_sync_mode(text)'::regprocedure, 'public.get_calendar_sync_overview(uuid)'::regprocedure,
    'public.get_calendar_sync_report()'::regprocedure, 'public.retry_calendar_job(uuid)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- the two re-created legacy functions keep their m06d grants
  revoke all on function public.claim_integration_jobs(text, int) from public, anon, authenticated;
  grant execute on function public.claim_integration_jobs(text, int) to service_role;
  revoke all on function public.poller_claim_bookings(int) from public, anon;
  grant execute on function public.poller_claim_bookings(int) to authenticated;
end $$;

-- ================================================================= self-check
do $$
begin
  if (select count(*) from app_private.calendar_sync_config) <> 1 then raise exception 'm63: calendar_sync_config must hold exactly one row'; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and 'search_path=""' = any (p.proconfig)
        and p.proname in ('calendar_worker_begin', 'calendar_worker_finish', 'calendar_claim_jobs', 'calendar_job_context', 'calendar_note_event', 'calendar_complete_job',
                          'calendar_fail_job', 'calendar_park_job', 'calendar_shadow_peek', 'calendar_shadow_record', 'get_calendar_sync_mode', 'set_calendar_sync_mode',
                          'get_calendar_sync_overview', 'get_calendar_sync_report', 'retry_calendar_job')) <> 15 then
    raise exception 'm63: a function is missing or lacks SECURITY DEFINER / search_path = ''''';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('calendar_sync_config', 'calendar_sync_log')
              and grantee in ('anon', 'authenticated', 'service_role', 'public')) then
    raise exception 'm63: a client role holds a privilege on a calendar sync table';
  end if;
  if has_function_privilege('authenticated', 'public.calendar_claim_jobs(int,int)', 'EXECUTE') or has_function_privilege('anon', 'public.calendar_job_context(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.calendar_complete_job(uuid,int,jsonb,text,uuid)', 'EXECUTE') then
    raise exception 'm63: worker RPC privileges are wrong';
  end if;
  if app_private.calendar_sync_mode() not in ('off', 'shadow', 'live') then raise exception 'm63: mode'; end if;
  raise notice 'm63 ok (mode: %)', app_private.calendar_sync_mode();
end $$;

commit;
