-- v63_calendar_sync  (m63: Calendar / Meet sync: mode flag, claim / complete / fail / park RPCs, shadow log, calendar-owner decision, overview, guards)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
-- The true two-session race (two real connections claiming at the same time) is db/verify/v63_calendar_concurrency.mjs.
--
-- Fixture (ids ...00000000e63x): SA = super_admin, PM1 = project_manager + member of the test program, PM2 = project_manager NOT in the program, AM = alumni_manager,
-- F = founder, IN = the Apps Script poller's `integration` account. Bookings 1..16 of one booking node (one slot each); jobs are created per test with explicit ages
-- (now() is constant inside a transaction, the claim orders by creation time).
-- NEVER call a function that the session role may NOT execute while that role is anon / authenticated (the local Postgres image can crash, v03 / v61 note):
-- denials are tested inside a plpgsql exception block (fails()) or with has_function_privilege().
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v63.res', '', false) \gset

begin;
create schema v63_test;
grant usage on schema v63_test to public;
create or replace function v63_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v63.res', current_setting('v63.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v63_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v63_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v63_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v63_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v63_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v63_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v63_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v63_test.t(p_key, true, 'ok');
  exception when others then
    perform v63_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;

-- ================================================================= C. catalog (as postgres)
select v63_test.val('C01 both tables: RLS enabled AND forced, no client / service role holds any privilege', $q$select (select count(*) from pg_class where relnamespace = 'app_private'::regnamespace and relname in ('calendar_sync_config', 'calendar_sync_log') and relrowsecurity and relforcerowsecurity)::text
  || '/' || (select count(*) from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('calendar_sync_config', 'calendar_sync_log') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC'))::text$q$, '2/0');
select v63_test.val('C02 the ten worker RPCs: SECURITY DEFINER, empty search_path, EXECUTE for service_role and for NO client role', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('calendar_worker_begin','calendar_worker_finish','calendar_claim_jobs','calendar_job_context','calendar_note_event','calendar_complete_job','calendar_fail_job','calendar_park_job','calendar_shadow_peek','calendar_shadow_record')
  and p.prosecdef and 'search_path=""' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '10');
select v63_test.val('C03 the five client RPCs: SECURITY DEFINER, empty search_path, EXECUTE for authenticated, never for anon', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_calendar_sync_mode','set_calendar_sync_mode','get_calendar_sync_overview','get_calendar_sync_report','retry_calendar_job')
  and p.prosecdef and 'search_path=""' = any(p.proconfig) and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '5');
select v63_test.val('C04 the app_private helpers of m63 are closed to anon and authenticated and have an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('calendar_sync_mode','calendar_conn_usable','calendar_user_may_host','calendar_pick_connection','calendar_code','calendar_log','bookings_guard_calendar_columns','google_connection_unpark_calendar')
  and 'search_path=""' = any(p.proconfig) and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '8');
select v63_test.val('C05 the re-created m06d / m34 functions keep their closed grants (generic claim: service_role only; poller bridge and retry: no anon)', $q$select (has_function_privilege('service_role', 'public.claim_integration_jobs(text,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_integration_jobs(text,integer)', 'EXECUTE') and not has_function_privilege('anon', 'public.claim_integration_jobs(text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.poller_claim_bookings(integer)', 'EXECUTE') and not has_function_privilege('anon', 'public.retry_calendar_job(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.retry_calendar_job(uuid)', 'EXECUTE'))::text$q$, 'true');
select v63_test.val('C06 exactly one config row; the column default of the mode is SHADOW (the safety default)', $q$select (select count(*) from app_private.calendar_sync_config)::text || '/' || (select column_default from information_schema.columns where table_schema = 'app_private' and table_name = 'calendar_sync_config' and column_name = 'mode')$q$, $q$1/'shadow'::text$q$);
select v63_test.fails('C07 an unknown mode is refused by the table (only off | shadow | live)', $q$update app_private.calendar_sync_config set mode = 'sometimes'$q$, '23514');
select v63_test.fails('C08 a second config row is impossible', $q$insert into app_private.calendar_sync_config (id) values (false)$q$, '23514');
select v63_test.val('C09 shadow plans are unique per job (partial unique index) and the due-queue index exists', $q$select count(*)::text from pg_indexes where schemaname = 'app_private' and indexname in ('calendar_sync_log_shadow_once', 'integration_jobs_calendar_due_idx', 'calendar_sync_log_job_idx', 'calendar_sync_log_booking_idx')$q$, '4');
select v63_test.val('C10 bookings.calendar_synced_at exists and the guard + un-park triggers are in place', $q$select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'calendar_synced_at')::text
  || '/' || (select count(*) from pg_trigger where tgname in ('bookings_bu_calendar_guard', 'google_connections_ai_unpark_calendar', 'google_connections_au_unpark_calendar') and not tgisinternal)::text$q$, '1/3');
select v63_test.val('C11 the migrated data is untouched: 28 bookings with a legacy calendar event, none of them marked synced by m63', $q$select count(*) filter (where legacy_calendar_event_id is not null)::text || '/' || count(*) filter (where calendar_synced_at is not null)::text from public.bookings$q$, '28/0');
select v63_test.val('C12 calendar_code keeps a code a code: lower case, no spaces / addresses, 64 characters at most', $q$select app_private.calendar_code('Rate Limited: a@b.com!') || '|' || length(app_private.calendar_code(repeat('x', 200)))::text || '|' || app_private.calendar_code(null, 'dflt') || '|' || app_private.calendar_code('   ')$q$, 'rate_limited:_a_b.com_|64|dflt|___');

-- ================================================================= fixture
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e630','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v63-sa@athareg.com','{"provisioned":true}','{"full_name":"V63 Super Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e631','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v63-pm1@athareg.com','{"provisioned":true}','{"full_name":"V63 PM One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e632','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v63-pm2@athareg.com','{"provisioned":true}','{"full_name":"V63 PM Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e633','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v63-am@athareg.com','{"provisioned":true}','{"full_name":"V63 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e634','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v63-f@example.invalid','{"provisioned":true}','{"full_name":"V63 Founder"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e635','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v63-in@athareg.com','{"provisioned":true}','{"full_name":"V63 Poller"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e630','super_admin'), ('00000000-0000-4000-8000-00000000e631','project_manager'),
  ('00000000-0000-4000-8000-00000000e632','project_manager'), ('00000000-0000-4000-8000-00000000e633','alumni_manager'), ('00000000-0000-4000-8000-00000000e634','founder'),
  ('00000000-0000-4000-8000-00000000e635','integration');
insert into public.network_experts (id, name_en, name_ar, title_en, email) values ('00000000-0000-4000-8000-00000000e6a1', 'Mentor  Sixty-Three', 'منتور', 'CEO', 'Mentor63@Example.invalid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e630","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V63 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V63 Project', null, 'Africa/Cairo')).id as proj \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors"}', 0, 0, '{"subkind":"expert"}')).id as lst \gset
select (public.add_node(:'proj', 'booking', '{"en":"Mentor sessions"}', 0, 0, '{"mode":"mentor"}')).id as bkm \gset
select (public.connect(:'proj', :'lst', 'items', :'bkm', 'mentors', '{}')).id as e1 \gset
select public.add_network_pick(:'lst', '00000000-0000-4000-8000-00000000e6a1') as item \gset
reset role;
insert into public.program_members (program_id, user_id) values (:'prog', '00000000-0000-4000-8000-00000000e631');
insert into public.booking_providers (project_id, node_id, list_item_id) values (:'proj', :'bkm', :'item') returning id as pv \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at)
  select :'proj', :'bkm', :'pv', date_trunc('hour', now() + interval '5 days') + n * interval '40 minutes', date_trunc('hour', now() + interval '5 days') + n * interval '40 minutes' + interval '30 minutes' from generate_series(1, 16) n;
insert into public.bookings (project_id, node_id, slot_id, booker_email, booker_name, lang)
  select :'proj', :'bkm', s.id, 'zz-v63-b' || (row_number() over (order by s.starts_at)) || '@example.invalid', 'Booker ' || (row_number() over (order by s.starts_at)), 'en' from public.booking_slots s where s.node_id = :'bkm';
create table v63_test.bk (n int primary key, id uuid not null);
grant select on v63_test.bk to public;
insert into v63_test.bk select substring(booker_email::text from 'zz-v63-b(\d+)@')::int, id from public.bookings where node_id = :'bkm';
create or replace function v63_test.b(p_n int) returns uuid language sql stable security definer set search_path = '' as $$ select id from v63_test.bk where n = p_n $$;
-- one job of a booking: `p_age` seconds old (the claim orders by creation time), due long ago
create or replace function v63_test.mk(p_n int, p_kind text, p_age int default 0, p_status text default 'pending') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into app_private.integration_jobs (kind, project_id, booking_id, status, idempotency_key, payload, created_at, next_attempt_at)
  select p_kind, b.project_id, b.id, p_status, 'v63:' || p_n || ':' || p_kind || ':' || p_age || ':' || gen_random_uuid()::text, '{}'::jsonb, now() - make_interval(secs => p_age), now() - interval '1 day'
    from public.bookings b where b.id = v63_test.b(p_n) returning id into v_id;
  return v_id;
end $$;
create or replace function v63_test.jc(p_job uuid, p_col text) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from app_private.integration_jobs where id = $1', p_col) into v using p_job;
  return v;
end $$;
create or replace function v63_test.bc(p_n int, p_col text) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from public.bookings where id = $1', p_col) into v using v63_test.b(p_n);
  return v;
end $$;
create or replace function v63_test.logn(p_event text, p_job uuid default null) returns integer language sql volatile security definer set search_path = '' as $$
  select count(*)::integer from app_private.calendar_sync_log l where l.event = p_event and (p_job is null or l.job_id = p_job)
$$;
-- seconds until the job is due (volatile: sees the effect of a call made earlier in the same statement)
create or replace function v63_test.dly(p_job uuid) returns integer language sql volatile security definer set search_path = '' as $$
  select extract(epoch from (next_attempt_at - now()))::integer from app_private.integration_jobs where id = p_job
$$;
-- how many of the claimed jobs (a jsonb array of rows) belong to the fixture (real jobs of other work are not ours to count)
create or replace function v63_test.mine(p_claimed jsonb) returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from jsonb_array_elements(coalesce(p_claimed, '[]'::jsonb)) c where (c->>'booking_id')::uuid in (select id from v63_test.bk)
$$;
create or replace function v63_test.claim(p_limit int default 50, p_lease int default 300) returns jsonb language sql volatile as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_claim_jobs(p_limit, p_lease) x
$$;
-- the sync state of booking n as the PM's Bookings tab sees it (role-switched session)
create or replace function v63_test.st(p_n int) returns text language sql stable as $$
  select s->>'state' from jsonb_array_elements(public.get_calendar_sync_overview((select node_id from public.bookings where id = v63_test.b(p_n)))->'bookings') s where s->>'booking_id' = v63_test.b(p_n)::text
$$;
revoke all on all functions in schema v63_test from public;
grant execute on all functions in schema v63_test to anon, authenticated, service_role;

-- another task's throwaway Google connections on the same DB would change the owner decisions: refuse to run then (re-run when they are gone)
select (count(*) > 0) as foreign_conn from app_private.google_connections \gset
\if :foreign_conn
  do $$ begin raise exception 'v63: Google connections already exist on this database (another task is using them): re-run when they are gone'; end $$;
\endif
select v63_test.t('F00 fixture: node, provider, 16 bookings, no calendar job yet, no Google connection', (select count(*) from v63_test.bk) = 16
  and not exists (select 1 from app_private.integration_jobs j where j.booking_id in (select id from v63_test.bk)));

-- ================================================================= M. the mode flag
update app_private.calendar_sync_config set mode = 'shadow' where id;
select v63_test.val('M01 the mode function answers shadow', $q$select app_private.calendar_sync_mode()$q$, 'shadow');
select v63_test.mk(1, 'calendar_create', 100) as j1 \gset
select v63_test.mk(2, 'calendar_create', 99) as j2 \gset
select v63_test.mk(3, 'calendar_create', 98) as j3 \gset
select v63_test.val('M02 SHADOW: calendar_claim_jobs claims nothing and changes nothing', $q$select v63_test.mine(v63_test.claim())::text || '/' || (select count(*) from app_private.integration_jobs j where j.booking_id in (select id from v63_test.bk) and (j.status <> 'pending' or j.attempts <> 0 or j.locked_until is not null))::text$q$, '0/0');
update app_private.calendar_sync_config set mode = 'off' where id;
select v63_test.val('M03 OFF: nothing is claimed either', $q$select v63_test.mine(v63_test.claim())::text$q$, '0');
select v63_test.val('M04 OFF: the shadow peek returns nothing', $q$select v63_test.mine((select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_shadow_peek(50) x))::text$q$, '0');
update app_private.calendar_sync_config set mode = 'live' where id;
select v63_test.val('M05 LIVE: the shadow peek returns nothing', $q$select v63_test.mine((select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_shadow_peek(50) x))::text$q$, '0');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select v63_test.val('M06 LIVE: the generic claim_integration_jobs (service role) refuses the calendar kinds: calendar_claim_jobs owns them (the poller bridge steps aside too, see P)', $q$select (select count(*) from public.claim_integration_jobs('calendar_create', 50) c where c.booking_id in (select id from v63_test.bk))::text$q$, '0');
select set_config('request.jwt.claims', '{}', true);
select public.calendar_worker_begin() as wb \gset
select v63_test.val('M07 calendar_worker_begin reports the mode and writes the heartbeat', format($q$select (%L::jsonb->>'mode') || '/' || ((select last_run_at from app_private.calendar_sync_config where id) is not null)::text$q$, :'wb'), 'live/true');
select public.calendar_worker_finish('{"done": 3}'::jsonb);
select v63_test.val('M08 calendar_worker_finish keeps the summary (an object only, 4 KB at most)', $q$select last_run_summary->>'done' from app_private.calendar_sync_config where id$q$, '3');
select public.calendar_worker_finish('[1,2]'::jsonb);
select v63_test.val('M09 a non-object summary is dropped, not stored', $q$select coalesce(last_run_summary::text, 'NULL') from app_private.calendar_sync_config where id$q$, 'NULL');

-- ================================================================= K. who holds the event (the calendar-owner decision)
select v63_test.val('K01 context of a create job: the stored data, nothing from a request (zone, provider e-mail, collapsed provider name, hex event id)', format($q$select (c->'project'->>'timezone') || '|' || (c->'provider'->>'email') || '|' || (c->'provider'->>'name_en') || '|' || (c->'booking'->>'event_id') = (select 'Africa/Cairo|Mentor63@Example.invalid|Mentor Sixty-Three|' || replace(%L, '-', '')) from (select public.calendar_job_context(%L::uuid) c) x$q$, v63_test.b(1)::text, :'j1'), 'true');
select v63_test.val('K02 context: booker, slot in UTC, booking state, no token anywhere in the document', format($q$select (c->'booking'->>'status') || '|' || (c->'booking'->>'booker_email') || '|' || (c->'booking'->>'lang') || '|' || (c->'node'->>'mode') || '|' || (c ? 'slot')::text || '|' || (c::text ~* '(token|secret|refresh|ciphertext)')::text from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'confirmed|zz-v63-b1@example.invalid|en|mentor|true|false');
select v63_test.val('K03 the context of an unknown job / NULL / a non-calendar job is NULL', $q$select coalesce(public.calendar_job_context(gen_random_uuid())::text, 'NULL') || '/' || coalesce(public.calendar_job_context(null)::text, 'NULL')$q$, 'NULL/NULL');
select v63_test.val('K04 NO connection anywhere: nobody usable, the reason says "needs a connection"', format($q$select (c->'connection'->>'usable') || '/' || coalesce(c->'connection'->>'id', 'none') || '/' || (c->'connection'->>'reason') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'false/none/needs_connection');
-- connections: the system sender, the node owner (SA created the node), PM1 (a member of the program), PM2 (NOT a member)
insert into app_private.google_connections (kind, owner_user_id, email, scopes, status, token_storage) values
  ('system', null, 'zz-v63-startups@athareg.com', array['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send'], 'active', 'aes') on conflict do nothing;
select id as c_sys from app_private.google_connections where kind = 'system' and email::text = 'zz-v63-startups@athareg.com' \gset
insert into app_private.google_connections (kind, owner_user_id, email, scopes, status, token_storage) values
  ('user', '00000000-0000-4000-8000-00000000e631', 'zz-v63-pm1@athareg.com', array['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send'], 'active', 'aes') returning id as c_pm1 \gset
insert into app_private.google_connections (kind, owner_user_id, email, scopes, status, token_storage) values
  ('user', '00000000-0000-4000-8000-00000000e632', 'zz-v63-pm2@athareg.com', array['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send'], 'active', 'aes') returning id as c_pm2 \gset
select v63_test.val('K05 the system sender is the fallback when the node owner has no connection', format($q$select (c->'connection'->>'source') || '/' || (c->'connection'->>'usable') || '/' || (c->'connection'->>'email') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'system/true/zz-v63-startups@athareg.com');
insert into app_private.google_connections (kind, owner_user_id, email, scopes, status, token_storage) values
  ('user', '00000000-0000-4000-8000-00000000e630', 'zz-v63-sa@athareg.com', array['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send'], 'active', 'aes') returning id as c_sa \gset
select v63_test.val('K06 the node owner''s OWN connection wins over the system sender', format($q$select (c->'connection'->>'source') || '/' || (c->'connection'->>'email') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'user/zz-v63-sa@athareg.com');
update public.booking_settings set organizer_connection_id = :'c_pm1' where node_id = :'bkm';
select v63_test.val('K07 the node''s organizer setting (PM1, a member of the program) wins over the node owner', format($q$select (c->'connection'->>'source') || '/' || (c->'connection'->>'email') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'organizer/zz-v63-pm1@athareg.com');
update public.booking_settings set organizer_connection_id = :'c_pm2' where node_id = :'bkm';
select v63_test.val('K08 an organizer connection of somebody who may NOT manage the project is IGNORED (a PM cannot point a booking at another person''s Google account)', format($q$select (c->'connection'->>'source') || '/' || (c->'connection'->>'email') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'user/zz-v63-sa@athareg.com');
update public.booking_settings set organizer_connection_id = :'c_pm1' where node_id = :'bkm';
update app_private.google_connections set status = 'needs_reconnect' where id = :'c_pm1';
select v63_test.val('K09 an organizer that needs reconnecting is skipped for a NEW event (the next candidate holds it)', format($q$select (c->'connection'->>'source') || '/' || (c->'connection'->>'email') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'user/zz-v63-sa@athareg.com');
update app_private.google_connections set status = 'active' where id = :'c_pm1';
-- a connection without the calendar scope cannot hold events
update app_private.google_connections set scopes = array['https://www.googleapis.com/auth/gmail.send'] where id = :'c_pm1';
select v63_test.val('K10 a connection that lacks the calendar.events scope is not usable for events', format($q$select (c->'connection'->>'source') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'user');
update app_private.google_connections set scopes = array['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send'] where id = :'c_pm1';
-- the event exists (frozen): written by the worker through calendar_note_event, here directly as postgres
update public.bookings set calendar_owner_connection_id = :'c_pm1', calendar_synced_at = now() where id = v63_test.b(1);
update app_private.google_connections set status = 'needs_reconnect' where id = :'c_pm1';
select v63_test.val('K11 FROZEN owner: the event lives on PM1''s calendar and PM1 needs to reconnect: the job is NOT moved to another calendar (usable false, reason needs_reconnect)', format($q$select (c->'connection'->>'source') || '/' || (c->'connection'->>'usable') || '/' || (c->'connection'->>'reason') || '/' || (c->'connection'->>'email') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'owner/false/needs_reconnect/zz-v63-pm1@athareg.com');
update app_private.google_connections set status = 'revoked', vault_secret_id = null where id = :'c_pm1';
select v63_test.val('K12 FROZEN owner disconnected: reason needs_connection', format($q$select (c->'connection'->>'reason') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j1'), 'needs_connection');
update app_private.google_connections set status = 'active' where id = :'c_pm1';
select v63_test.val('K13 the booking in the context: owner + synced_at + event_may_exist', format($q$select ((c->'booking'->>'owner_connection_id') = %L)::text || '/' || (c->'booking'->>'event_may_exist') || '/' || ((c->'booking'->>'synced_at') is not null)::text from (select public.calendar_job_context(%L::uuid) c) x$q$, :'c_pm1', :'j1'), 'true/true/true');
-- a migrated booking: the legacy event was created by the poller on the system account
update public.bookings set legacy_calendar_event_id = '8vp3k0jsl1d2m4n5o6q7r8s9t0', meet_link = 'https://meet.google.com/old-link-xyz' where id = v63_test.b(4);
select v63_test.mk(4, 'calendar_update', 50) as j4 \gset
select v63_test.val('K14 MIGRATED booking: the legacy event id is the event id, the owner is the system sender (legacy_system), event_may_exist', format($q$select (c->'booking'->>'event_id') || '/' || (c->'booking'->>'legacy_event') || '/' || (c->'connection'->>'source') || '/' || (c->'booking'->>'event_may_exist') from (select public.calendar_job_context(%L::uuid) c) x$q$, :'j4'), '8vp3k0jsl1d2m4n5o6q7r8s9t0/true/legacy_system/true');
insert into app_private.integration_jobs (kind, project_id, booking_id, idempotency_key) values ('calendar_create', :'proj', null, 'v63:nobooking') returning id as jnb \gset
insert into app_private.integration_jobs (kind, project_id, idempotency_key) values ('sheets_append', :'proj', 'v63:sheets') returning id as jsh \gset
select v63_test.val('K15 a calendar job whose booking is gone has a context with booking null (the worker skips it); a non-calendar job has none', format($q$select ((public.calendar_job_context(%L::uuid)->'booking')::text) || '/' || coalesce(public.calendar_job_context(%L::uuid)::text, 'NULL')$q$, :'jnb', :'jsh'), 'null/NULL');
-- a create that only SKIPPED never reached Google (attempts 1, done, skipped_*) and does not make a later cancel think an event may exist; a create that really ran does
select v63_test.mk(16, 'calendar_create', 400, 'done') as jk1 \gset
update app_private.integration_jobs set attempts = 1, result = '{"action":"skipped_never_synced"}' where id = :'jk1';
select v63_test.mk(16, 'calendar_cancel', 390) as jk2 \gset
select v63_test.mk(15, 'calendar_create', 400, 'done') as jk3 \gset
update app_private.integration_jobs set attempts = 1, result = '{"action":"created"}' where id = :'jk3';
select v63_test.mk(15, 'calendar_cancel', 390) as jk4 \gset
select v63_test.val('K16 event_may_exist: false after a create that only SKIPPED, true after a create that ran (no needless delete call, no missed one)', format($q$select (public.calendar_job_context(%L::uuid)->'booking'->>'event_may_exist') || '/' || (public.calendar_job_context(%L::uuid)->'booking'->>'event_may_exist')$q$, :'jk2', :'jk4'), 'false/true');
delete from app_private.integration_jobs where idempotency_key in ('v63:nobooking', 'v63:sheets') or booking_id in (v63_test.b(15), v63_test.b(16));

-- ================================================================= L. the claim (live)
update app_private.calendar_sync_config set mode = 'live' where id;
select v63_test.mk(5, 'calendar_create', 90) as j5 \gset
select v63_test.mk(5, 'calendar_update', 80) as j5u \gset
select v63_test.mk(6, 'calendar_create', 70) as j6 \gset
-- j1, j2, j3, j5, j6 are pending creates; j4 (booking 4) and j5u (an update that waits behind j5)
select v63_test.val('L01 claim: one job per booking at a time in creation order: j5u waits behind j5; every other due job is claimed', $q$select v63_test.mine(v63_test.claim())::text$q$, '6');
select v63_test.val('L02 claimed jobs are processing, attempts = 1, leased about 5 minutes; the update behind j5 is still pending', format($q$select v63_test.jc(%L, 'status') || '/' || v63_test.jc(%L, 'attempts') || '/' || (extract(epoch from (select locked_until from app_private.integration_jobs where id = %L) - now()))::int::text || '/' || v63_test.jc(%L, 'status')$q$, :'j1', :'j1', :'j1', :'j5u'), 'processing/1/300/pending');
select v63_test.val('L03 a second claim right away gets nothing (the leases hold)', $q$select v63_test.mine(v63_test.claim())::text$q$, '0');
-- complete j5 (attempt 1): the update behind it becomes claimable
select v63_test.val('L04 complete_job: true for the current attempt, the job is done with its result', format($q$select public.calendar_complete_job(%L, 1, '{"action":"created","event_id":"x"}'::jsonb, null, null)::text || '/' || v63_test.jc(%L, 'status') || '/' || (v63_test.jc(%L, 'result')::jsonb->>'action')$q$, :'j5', :'j5', :'j5'), 'true/done/created');
select v63_test.val('L05 after j5 is done, the update job of the same booking is claimed (attempt 1)', $q$select v63_test.mine(v63_test.claim())::text$q$, '1');
update app_private.integration_jobs set locked_until = now() - interval '1 minute' where id = :'j1';
select v63_test.claim() as rc \gset
select v63_test.val('L06 an EXPIRED lease is reclaimed by the next worker: the job comes back with attempts 2', format($q$select (select x->>'attempts' from jsonb_array_elements(%L::jsonb) x where x->>'id' = %L)$q$, :'rc', :'j1'), '2');
select v63_test.val('L07 ... and only that one (the other leases still hold)', format($q$select v63_test.mine(%L::jsonb)::text$q$, :'rc'), '1');
-- the stale worker A (attempt 1) comes back after worker B reclaimed the job (attempt 2)
select v63_test.val('L08 FENCE: the stale worker (attempt 1) cannot complete, fail, park or note the reclaimed job; nothing changes', format($q$select public.calendar_complete_job(%L, 1, '{"action":"created"}'::jsonb, 'https://meet.google.com/stale-lnk-xyz', %L)::text
  || '/' || (public.calendar_fail_job(%L, 1, 'late', true, 60)->>'reason') || '/' || public.calendar_park_job(%L, 1, 'needs_connection')::text || '/' || public.calendar_note_event(%L, 1, %L)::text
  || '/' || v63_test.jc(%L, 'status') || '/' || coalesce(v63_test.bc(1, 'meet_link'), 'NULL')$q$, :'j1', :'c_sa', :'j1', :'j1', :'j1', :'c_sa', :'j1'), 'false/lease_lost/false/false/processing/NULL');
select v63_test.val('L09 nothing of the stale write reached the booking (no link; owner unchanged)', $q$select coalesce(v63_test.bc(1, 'meet_link'), 'NULL') || '/' || (v63_test.bc(1, 'calendar_owner_connection_id') is not null)::text$q$, 'NULL/true');
select v63_test.val('L10 complete / fail / park need a PROCESSING job: a pending one is refused', format($q$select public.calendar_complete_job(%L, 0, '{}'::jsonb)::text || '/' || public.calendar_park_job(%L, 0, 'x')::text || '/' || (public.calendar_fail_job(%L, 0, 'x', true)->>'ok')$q$, :'j5u', :'j5u', :'j5u'), 'false/false/false');
select v63_test.val('L11 NULL / unknown arguments are harmless', $q$select public.calendar_complete_job(null, null)::text || '/' || public.calendar_park_job(null, null, null)::text || '/' || (public.calendar_fail_job(null, null, null, null)->>'ok') || '/' || public.calendar_note_event(null, null, null)::text || '/' || public.calendar_shadow_record(null, null)::text$q$, 'false/false/false/false/false');
-- poison pill: a job whose workers kept dying
select v63_test.mk(7, 'calendar_create', 60) as j7 \gset
update app_private.integration_jobs set status = 'processing', attempts = 6, locked_until = now() - interval '1 minute' where id = :'j7';
select v63_test.val('L12 a job whose lease expired six times is DEAD with lease_expired, not claimed again', format($q$select v63_test.mine(v63_test.claim())::text || '/' || v63_test.jc(%L, 'status') || '/' || v63_test.jc(%L, 'error')$q$, :'j7', :'j7'), '0/dead/lease_expired');
-- limits
select v63_test.mk(8, 'calendar_create', 50) as j8 \gset
select v63_test.mk(9, 'calendar_create', 49) as j9 \gset
select v63_test.mk(10, 'calendar_create', 48) as j10 \gset
select v63_test.val('L13 the limit is respected (2 of 3 due jobs), 0 / NULL / negative clamp to 1 / 10 / 1', $q$select v63_test.mine(v63_test.claim(2))::text || '/' || v63_test.mine((select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_claim_jobs(0, 300) x))::text$q$, '2/1');
select v63_test.val('L14 a normal lease is 300 s', format($q$select (extract(epoch from ((select locked_until from app_private.integration_jobs where id = %L) - now())))::int::text$q$, :'j10'), '300');
update app_private.integration_jobs set status = 'pending', attempts = 0, locked_until = null where id in (:'j8', :'j9', :'j10');
select v63_test.claim(1, 1)->0->>'id' as lj1 \gset
select v63_test.claim(1, 100000)->0->>'id' as lj2 \gset
select v63_test.val('L15 an absurd lease is clamped: 1 s -> 30 s, 100000 s -> 900 s', format($q$select (select extract(epoch from (locked_until - now()))::int::text from app_private.integration_jobs where id = %L) || '/' || (select extract(epoch from (locked_until - now()))::int::text from app_private.integration_jobs where id = %L)$q$, :'lj1', :'lj2'), '30/900');

-- ================================================================= W. write-back (complete / note)
select v63_test.mk(11, 'calendar_create', 40) as j11 \gset
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j11';
select v63_test.val('W01 complete writes the Meet link, the owner and synced_at back to the booking IN THE SAME CALL (a link that is not https is ignored)', format($q$select public.calendar_complete_job(%L, 1, '{"action":"created","meet":"unique"}'::jsonb, 'http://insecure.example/x', %L)::text || '/' || coalesce(v63_test.bc(11, 'meet_link'), 'NULL')$q$, :'j11', :'c_pm2'), 'true/NULL');
select v63_test.mk(11, 'calendar_update', 30) as j11b \gset
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j11b';
select v63_test.val('W02 a valid https link is stored; the owner was already set by the first completion (frozen: never replaced)', format($q$select public.calendar_complete_job(%L, 1, '{"action":"patched"}'::jsonb, 'https://meet.google.com/abc-defg-hij', %L)::text || '/' || v63_test.bc(11, 'meet_link') || '/' || (v63_test.bc(11, 'calendar_owner_connection_id') = %L)::text || '/' || (v63_test.bc(11, 'calendar_synced_at') is not null)::text$q$, :'j11b', :'c_sa', :'c_pm2'), 'true/https://meet.google.com/abc-defg-hij/true/true');
select v63_test.mk(12, 'calendar_cancel', 20) as j12 \gset
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j12';
select v63_test.val('W03 completing a CANCEL never marks the booking synced / owned', format($q$select public.calendar_complete_job(%L, 1, '{"action":"deleted"}'::jsonb, null, %L)::text || '/' || (v63_test.bc(12, 'calendar_synced_at') is null)::text || '/' || (v63_test.bc(12, 'calendar_owner_connection_id') is null)::text$q$, :'j12', :'c_sa'), 'true/true/true');
select v63_test.mk(13, 'calendar_create', 20) as j13 \gset
update app_private.integration_jobs set status = 'processing', attempts = 2, locked_until = now() + interval '5 minutes' where id = :'j13';
select v63_test.val('W04 calendar_note_event freezes the owner as soon as Google accepted the event; a second note does not move it', format($q$select public.calendar_note_event(%L, 2, %L)::text || public.calendar_note_event(%L, 2, %L)::text || '/' || (v63_test.bc(13, 'calendar_owner_connection_id') = %L)::text || '/' || (v63_test.bc(13, 'calendar_synced_at') is not null)::text$q$, :'j13', :'c_pm2', :'j13', :'c_sa', :'c_pm2'), 'truetrue/true/true');
select v63_test.val('W05 every completion leaves a log row with its action; the job result is the 8 KB-capped object we passed', format($q$select v63_test.logn('created', %L)::text || '/' || v63_test.logn('patched', %L)::text || '/' || v63_test.logn('deleted', %L)::text$q$, :'j5', :'j11b', :'j12'), '1/1/1');
update app_private.integration_jobs set status = 'processing', attempts = 3, locked_until = now() + interval '5 minutes' where id = :'j13';
select public.calendar_complete_job(:'j13', 3, jsonb_build_object('x', repeat('a', 9000)), null, null) as _c \gset
select v63_test.val('W06 an oversized result is replaced by an empty object, never an error', format($q$select v63_test.jc(%L, 'status') || '/' || v63_test.jc(%L, 'result')$q$, :'j13', :'j13'), 'done/{}');

-- ================================================================= X. failures and parking
select v63_test.mk(14, 'calendar_create', 10) as j14 \gset
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j14';
select v63_test.val('X01 a retryable failure: status failed, the next attempt after exactly the delay, a CODE as the error', format($q$select (public.calendar_fail_job(%L, 1, 'rate_limited:429', true, 120)->>'status') || '/' || v63_test.jc(%L, 'status') || '/' || v63_test.jc(%L, 'error') || '/' || v63_test.dly(%L)::text$q$, :'j14', :'j14', :'j14', :'j14'), 'failed/failed/rate_limited:429/120');
update app_private.integration_jobs set status = 'processing', attempts = 6, locked_until = now() + interval '5 minutes' where id = :'j14';
select v63_test.val('X02 a retryable failure on the LAST attempt (max 6) is dead', format($q$select (public.calendar_fail_job(%L, 6, 'server_error:500', true, 60, 6)->>'status')$q$, :'j14'), 'dead');
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j14';
select v63_test.val('X03 a permanent failure is dead at once', format($q$select (public.calendar_fail_job(%L, 1, 'shared_link_required', false, 0)->>'status')$q$, :'j14'), 'dead');
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j14';
select v63_test.val('X04 the stored code is sanitised: no space, no address, lower case, 64 characters at most', format($q$select (public.calendar_fail_job(%L, 1, 'Bad Code: mona@example.com said NO!', true, 1)->>'ok') || '/' || (v63_test.jc(%L, 'error') ~ '^[a-z0-9_.:-]{1,64}$')::text || '/' || (v63_test.jc(%L, 'error') like '%%@%%')::text$q$, :'j14', :'j14', :'j14'), 'true/true/false');
update app_private.integration_jobs set status = 'failed', next_attempt_at = now() + interval '2 minutes', attempts = 1, locked_until = null where id = :'j14';
select v63_test.claim() as rf0 \gset
select v63_test.val('X05a a failed job is NOT claimed before it is due', format($q$select (select count(*) from jsonb_array_elements(%L::jsonb) x where x->>'id' = %L)::text$q$, :'rf0', :'j14'), '0');
update app_private.integration_jobs set next_attempt_at = now() - interval '1 second' where id = :'j14';
select v63_test.claim() as rf \gset
select v63_test.val('X05b ... and is claimed (attempt 2) when it is', format($q$select (select x->>'attempts' from jsonb_array_elements(%L::jsonb) x where x->>'id' = %L)$q$, :'rf', :'j14'), '2');
select v63_test.mk(15, 'calendar_create', 10) as j15 \gset
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j15';
select v63_test.val('X06 PARK: back to pending WITHOUT an attempt, the reason as a code, due after the delay (default 15 min)', format($q$select public.calendar_park_job(%L, 1, 'needs_reconnect')::text || '/' || v63_test.jc(%L, 'status') || '/' || v63_test.jc(%L, 'attempts') || '/' || v63_test.jc(%L, 'error') || '/' || v63_test.dly(%L)::text$q$, :'j15', :'j15', :'j15', :'j15', :'j15'), 'true/pending/0/needs_reconnect/900');
select v63_test.val('X07 a parked job is not claimed before it is due', format($q$select (select count(*) from jsonb_array_elements(v63_test.claim()) x where x->>'id' = %L)::text$q$, :'j15'), '0');
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j15';
select public.calendar_park_job(:'j15', 1, 'needs_reconnect', 60) as _p \gset
select v63_test.val('X08 parking again with the same code logs ONCE (no log flood every 15 minutes)', format($q$select v63_test.logn('parked', %L)::text$q$, :'j15'), '1');
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j15';
select public.calendar_park_job(:'j15', 1, 'x', 0) as _p2 \gset
select v63_test.val('X09a the park delay is at least 1 second ...', format($q$select v63_test.dly(%L)::text$q$, :'j15'), '1');
update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where id = :'j15';
select public.calendar_park_job(:'j15', 1, 'x', 1000000000) as _p3 \gset
select v63_test.val('X09b ... and at most a day', format($q$select v63_test.dly(%L)::text$q$, :'j15'), '86400');
update app_private.integration_jobs set status = 'pending', next_attempt_at = now() + interval '1 hour', error = 'needs_connection' where id = :'j15';
-- the un-park trigger: a connection that becomes active makes the parked calendar jobs due at once
update app_private.google_connections set status = 'needs_reconnect' where id = :'c_pm2';
update app_private.google_connections set status = 'active' where id = :'c_pm2';
select v63_test.val('X10 a connection becoming active makes the PARKED calendar jobs due now (the trigger)', format($q$select (select next_attempt_at <= now() from app_private.integration_jobs where id = %L)::text$q$, :'j15'), 'true');
update app_private.integration_jobs set status = 'pending', next_attempt_at = now() + interval '1 hour', error = 'rate_limited:429' where id = :'j15';
update app_private.google_connections set status = 'needs_reconnect' where id = :'c_pm2';
update app_private.google_connections set status = 'active' where id = :'c_pm2';
select v63_test.val('X11 ... but a job that is only backing off (not parked) is left alone', format($q$select (select next_attempt_at > now() from app_private.integration_jobs where id = %L)::text$q$, :'j15'), 'true');

-- ================================================================= S. shadow
update app_private.calendar_sync_config set mode = 'shadow' where id;
select v63_test.mk(16, 'calendar_create', 5) as j16 \gset
select v63_test.val('S01 SHADOW: the peek lists the pending job nobody planned yet', format($q$select (select count(*) from jsonb_array_elements((select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_shadow_peek(100) x)) y where y->>'id' = %L)::text$q$, :'j16'), '1');
select v63_test.val('S02 record the plan: true once, false the second time (once per job); the log row is a shadow event', format($q$select public.calendar_shadow_record(%L, '{"action":"create","kind":"calendar_create","event":{"summary":"x"}}'::jsonb)::text || '/' || public.calendar_shadow_record(%L, '{"action":"create"}'::jsonb)::text || '/' || v63_test.logn('shadow', %L)::text$q$, :'j16', :'j16', :'j16'), 'true/false/1');
select v63_test.val('S03 the planned job leaves the peek; the job itself was never locked or changed', format($q$select (select count(*) from jsonb_array_elements((select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_shadow_peek(100) x)) y where y->>'id' = %L)::text || '/' || v63_test.jc(%L, 'status') || '/' || v63_test.jc(%L, 'attempts') || '/' || coalesce(v63_test.jc(%L, 'locked_until'), 'NULL')$q$, :'j16', :'j16', :'j16', :'j16'), '0/pending/0/NULL');
select v63_test.val('S04 a plan that is not an object, or too large, is refused (false), never stored', format($q$select public.calendar_shadow_record(%L, '[1]'::jsonb)::text || '/' || public.calendar_shadow_record(gen_random_uuid(), '{"a":1}'::jsonb)::text$q$, :'j16'), 'false/false');
select v63_test.val('S05 the shadow peek only returns pending / failed calendar jobs (a done one is not planned)', format($q$select (select count(*) from jsonb_array_elements((select coalesce(jsonb_agg(x), '[]'::jsonb) from public.calendar_shadow_peek(100) x)) y where y->>'id' = %L)::text$q$, :'j5'), '0');

-- ================================================================= P. the Apps Script poller bridge steps aside while live
select v63_test.mk(9, 'calendar_create', 3) as jp \gset
update app_private.integration_jobs set status = 'pending', attempts = 0, locked_until = null, next_attempt_at = now() - interval '1 day' where id = :'jp';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e635","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('P01 SHADOW: the `integration` account (the poller) still claims the pending jobs through poller_claim_bookings', $q$select (select count(*) from public.poller_claim_bookings(50) p where p.booking_id = v63_test.b(9))::text$q$, '1');
reset role;
update app_private.integration_jobs set status = 'pending', attempts = 0, locked_until = null where id = :'jp';
update app_private.calendar_sync_config set mode = 'live' where id;
set local role authenticated;
select v63_test.val('P02 LIVE: poller_claim_bookings returns NOTHING (a poller that was not switched off creates no second event)', $q$select (select count(*) from public.poller_claim_bookings(50))::text$q$, '0');
reset role;
select v63_test.val('P03 ... and the job is still pending for the new worker', format($q$select v63_test.jc(%L, 'status')$q$, :'jp'), 'pending');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('P04 a project manager is not the poller: poller_claim_bookings refuses him', $q$select * from public.poller_claim_bookings(5)$q$, '42501');
reset role;

-- ================================================================= A. the mode RPCs and who may call them (role switch)
update app_private.calendar_sync_config set mode = 'shadow' where id;
select count(*) as mc0 from app_private.calendar_sync_log where event = 'mode_changed' \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('A01 PM1 reads the mode (read-only: can_set false)', $q$select (public.get_calendar_sync_mode()->>'mode') || '/' || (public.get_calendar_sync_mode()->>'can_set')$q$, 'shadow/false');
select v63_test.fails('A02 PM1 cannot change the mode', $q$select public.set_calendar_sync_mode('live')$q$, '42501', 'forbidden');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e633","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('A03 the alumni manager cannot change it either', $q$select public.set_calendar_sync_mode('off')$q$, '42501', 'forbidden');
select v63_test.val('A04 ... but staff can read it', $q$select public.get_calendar_sync_mode()->>'mode'$q$, 'shadow');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e634","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('A05 a founder can neither read nor set the mode', $q$select public.get_calendar_sync_mode()$q$, '42501', 'forbidden');
select v63_test.fails('A06 ... (set)', $q$select public.set_calendar_sync_mode('live')$q$, '42501', 'forbidden');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e630","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('A07 an unknown mode is refused with a token + the field', $q$select public.set_calendar_sync_mode('sometimes')$q$, '22023', 'calendar_mode_invalid', 'mode:invalid');
select v63_test.fails('A08 NULL is refused the same way (no NULL slips through a guard)', $q$select public.set_calendar_sync_mode(null)$q$, '22023', 'calendar_mode_invalid');
select v63_test.val('A09 the super_admin switches to live: the answer carries the previous mode and the number of jobs in flight', $q$select (r->>'mode') || '/' || (r->>'previous') || '/' || ((r->>'in_flight') ~ '^[0-9]+$')::text from (select public.set_calendar_sync_mode('live') r) x$q$, 'live/shadow/true');
select v63_test.val('A10 ... and he can read it back (can_set true)', $q$select (public.get_calendar_sync_mode()->>'mode') || '/' || (public.get_calendar_sync_mode()->>'can_set')$q$, 'live/true');
reset role;
select v63_test.val('A11 mode_changed is logged once (this run) with from / to / actor', format($q$select (count(*) - %s)::text || '/' || (select detail->>'from' || '>' || (detail->>'to') || '/' || (actor::text = '00000000-0000-4000-8000-00000000e630')::text from app_private.calendar_sync_log where event = 'mode_changed' order by id desc limit 1) from app_private.calendar_sync_log where event = 'mode_changed'$q$, :'mc0'), '1/shadow>live/true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e630","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('A12 setting the same mode again changes nothing and logs nothing', $q$select (public.set_calendar_sync_mode('live')->>'previous')$q$, 'live');
reset role;
select v63_test.val('A13 ... still one mode_changed row of this run', format($q$select (count(*) - %s)::text from app_private.calendar_sync_log where event = 'mode_changed'$q$, :'mc0'), '1');
select v63_test.val('A14 anon holds no EXECUTE on any calendar RPC', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%calendar%' and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '0');

-- ================================================================= O. the overview (what the Bookings tab shows)
update app_private.calendar_sync_config set mode = 'live' where id;
-- one booking per state (jobs: the last one decides)
delete from app_private.integration_jobs where booking_id in (select id from v63_test.bk);
update public.bookings set calendar_owner_connection_id = null, calendar_synced_at = null, legacy_calendar_event_id = null, meet_link = null, status = 'confirmed' where id in (select id from v63_test.bk);
select v63_test.mk(1, 'calendar_create', 10) as o1 \gset
select v63_test.mk(2, 'calendar_create', 10, 'processing') as o2 \gset
select v63_test.mk(3, 'calendar_create', 10, 'failed') as o3 \gset
select v63_test.mk(4, 'calendar_create', 10, 'dead') as o4 \gset
select v63_test.mk(5, 'calendar_create', 10) as o5 \gset
update app_private.integration_jobs set error = 'needs_connection', next_attempt_at = now() + interval '1 hour' where id = :'o5';
select v63_test.mk(6, 'calendar_create', 10, 'done') as o6 \gset
update app_private.integration_jobs set result = '{"action":"created"}' where id = :'o6';
update public.bookings set status = 'cancelled' where id = v63_test.b(7);
select v63_test.mk(7, 'calendar_cancel', 10, 'done') as o7 \gset
update app_private.integration_jobs set result = '{"action":"deleted"}' where id = :'o7';
update public.bookings set legacy_calendar_event_id = '8vp3k0jsl1d2m4n5o6q7r8s9t0' where id = v63_test.b(8);  -- migrated, no job
select v63_test.mk(9, 'calendar_create', 10, 'done') as o9 \gset
update app_private.integration_jobs set result = '{"action":"skipped_migrated"}' where id = :'o9';
select v63_test.mk(10, 'calendar_create', 10, 'done') as o10 \gset
update app_private.integration_jobs set result = '{"action":"skipped_past"}' where id = :'o10';
-- 11: no job, not migrated: none.  12: cancelled, no job: cancelled.  13: pending in shadow, with a plan
update public.bookings set status = 'cancelled' where id = v63_test.b(12);
select v63_test.mk(13, 'calendar_create', 10) as o13 \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('O01 LIVE states: pending / syncing / retrying / failed / needs_connection / synced / cancelled', $q$select v63_test.st(1) || ',' || v63_test.st(2) || ',' || v63_test.st(3) || ',' || v63_test.st(4) || ',' || v63_test.st(5) || ',' || v63_test.st(6) || ',' || v63_test.st(7)$q$, 'pending,syncing,retrying,failed,needs_connection,synced,cancelled');
select v63_test.val('O02 migrated (no job), migrated (skipped create), past, none, cancelled (no job)', $q$select v63_test.st(8) || ',' || v63_test.st(9) || ',' || v63_test.st(10) || ',' || v63_test.st(11) || ',' || v63_test.st(12)$q$, 'migrated,migrated,past,none,cancelled');
reset role;
update app_private.calendar_sync_config set mode = 'shadow' where id;
insert into app_private.calendar_sync_log (job_id, booking_id, event, mode, detail) values (:'o13', v63_test.b(13), 'shadow', 'shadow', '{"action":"create","event":{"summary":"Mentor Session: x"}}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('O03 SHADOW: a pending job reads "shadow" and carries the plan the worker would execute; the others keep their state', $q$select v63_test.st(1) || ',' || v63_test.st(13) || ',' || v63_test.st(6)$q$, 'shadow,shadow,synced');
select v63_test.val('O04 the plan is only exposed in shadow mode for a pending job', format($q$select (select (b->'plan'->>'action') from jsonb_array_elements(public.get_calendar_sync_overview(%L)->'bookings') b where b->>'booking_id' = %L) || '/' || (select coalesce((b->'plan')::text, 'x') from jsonb_array_elements(public.get_calendar_sync_overview(%L)->'bookings') b where b->>'booking_id' = %L)$q$, :'bkm', v63_test.b(13)::text, :'bkm', v63_test.b(6)::text), 'create/null');
reset role;
update app_private.calendar_sync_config set mode = 'off' where id;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('O05 OFF: pending jobs read "off"; parked ones still read needs_connection', $q$select v63_test.st(1) || ',' || v63_test.st(5)$q$, 'off,needs_connection');
reset role;
update app_private.calendar_sync_config set mode = 'live' where id;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('O06 the entry of a booking has exactly the keys the UI uses (no token, no secret, no connection id)', format($q$select (select string_agg(k, ',' order by k) from jsonb_object_keys((select b from jsonb_array_elements(public.get_calendar_sync_overview(%L)->'bookings') b where b->>'booking_id' = %L)) k)$q$, :'bkm', v63_test.b(6)::text), 'booking_id,calendar_email,code,event_id,job,migrated,plan,state,synced_at');
select v63_test.val('O07 the head: mode, can_set_mode (false for a PM), the worker heartbeat, 16 bookings', format($q$select (o->>'mode') || '/' || (o->>'can_set_mode') || '/' || jsonb_array_length(o->'bookings') from (select public.get_calendar_sync_overview(%L) o) x$q$, :'bkm'), 'live/false/16');
reset role;
-- calendar_email: the owner's account (a migrated booking: the system sender)
update public.bookings set calendar_owner_connection_id = :'c_pm2', calendar_synced_at = now() where id = v63_test.b(6);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('O08 calendar_email shows the account that holds the event (owner), and the system sender for a migrated booking', format($q$select (select b->>'calendar_email' from jsonb_array_elements(public.get_calendar_sync_overview(%L)->'bookings') b where b->>'booking_id' = %L) || '/' || (select coalesce(b->>'calendar_email', 'NULL') from jsonb_array_elements(public.get_calendar_sync_overview(%L)->'bookings') b where b->>'booking_id' = %L)$q$, :'bkm', v63_test.b(6)::text, :'bkm', v63_test.b(8)::text), 'zz-v63-pm2@athareg.com/zz-v63-startups@athareg.com');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e632","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('O09 PM2 (not in the program) cannot read the overview of the node', format($q$select public.get_calendar_sync_overview(%L)$q$, :'bkm'), '42501', 'forbidden');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e634","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('O10 a founder cannot either', format($q$select public.get_calendar_sync_overview(%L)$q$, :'bkm'), '42501', 'forbidden');
select v63_test.fails('O11 nor the report', $q$select public.get_calendar_sync_report()$q$, '42501', 'forbidden');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('O12 a PM is not a super_admin: no report', $q$select public.get_calendar_sync_report()$q$, '42501', 'forbidden');
select v63_test.fails('O13 an unknown node is refused (NULL too)', $q$select public.get_calendar_sync_overview(null)$q$, '42501', 'forbidden');
reset role;
-- the migrated production data, read as super_admin: 28 migrated, 2 with no event (not synced), NONE is pending a create
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e630","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('O14 REAL DATA: the 28 migrated bookings read "migrated", the 2 without a calendar event read "none"; no migrated booking has a create job', format($q$select count(*) filter (where s->>'state' = 'migrated')::text || '/' || count(*) filter (where s->>'state' = 'none')::text || '/' || count(*) filter (where s->>'state' in ('pending', 'shadow', 'off', 'syncing'))::text
  from public.nodes n cross join lateral jsonb_array_elements(public.get_calendar_sync_overview(n.id)->'bookings') s where n.type = 'booking' and n.project_id <> %L$q$, :'proj'), '28/2/0');
select v63_test.val('O15 the cut-over report (super_admin): mode, jobs by state, shadow findings, migrated count, connections', $q$select (r->>'mode') || '/' || (r->'bookings'->>'migrated') || '/' || ((r->'jobs'->>'pending') ~ '^[0-9]+$')::text || '/' || ((r->'shadow'->>'planned') ~ '^[0-9]+$')::text || '/' || (r->'connections'->>'system') from (select public.get_calendar_sync_report() r) x$q$, 'live/29/true/true/active');
reset role;

-- ================================================================= R. retry
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('R01 retry: the DEAD job and the FAILED job of booking 4 / 3 start again (attempts 0, due now, no error); a parked one is due now', $q$select public.retry_calendar_job(v63_test.b(4))::text || public.retry_calendar_job(v63_test.b(3))::text || public.retry_calendar_job(v63_test.b(5))::text$q$, '111');
reset role;
select v63_test.val('R02 ... exactly that', format($q$select v63_test.jc(%L, 'status') || ',' || v63_test.jc(%L, 'attempts') || ',' || coalesce(v63_test.jc(%L, 'error'), 'NULL') || ',' || v63_test.jc(%L, 'status') || ',' || (select next_attempt_at <= now() from app_private.integration_jobs where id = %L)::text$q$, :'o4', :'o4', :'o4', :'o3', :'o5'), 'pending,0,NULL,pending,true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('R03 retry does not touch a job that is syncing or done; a booking with nothing to retry answers 0', $q$select public.retry_calendar_job(v63_test.b(2))::text || public.retry_calendar_job(v63_test.b(6))::text$q$, '00');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e632","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('R04 PM2 (not in the program) cannot retry', $q$select public.retry_calendar_job(v63_test.b(4))$q$, '42501');
reset role;
select v63_test.val('R05 the retry is logged once per call that changed something', $q$select count(*)::text from app_private.calendar_sync_log where event = 'retry_requested'$q$, '3');

-- ================================================================= G. guards on the calendar-owned booking columns
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e631","role":"authenticated"}', true);
set local role authenticated;
select v63_test.fails('G01 a PM cannot point a booking at another Google account (calendar_owner_connection_id)', format($q$update public.bookings set calendar_owner_connection_id = %L where id = v63_test.b(2)$q$, :'c_sa'), '42501', 'forbidden');
select v63_test.fails('G02 ... nor mark it synced', $q$update public.bookings set calendar_synced_at = now() where id = v63_test.b(2)$q$, '42501', 'forbidden');
select v63_test.fails('G03 ... nor give it a legacy event id (the worker would then patch / delete that event)', $q$update public.bookings set legacy_calendar_event_id = 'abcdefghijklmnopqrstuvwxyz' where id = v63_test.b(2)$q$, '42501', 'forbidden');
select v63_test.okrun('G04a ... while the other columns of his own booking stay editable (the guard is column-precise)', $q$update public.bookings set booker_name = 'Renamed by PM1' where id = v63_test.b(2)$q$);
reset role;
select v63_test.val('G04b ... and the edit really happened', $q$select v63_test.bc(2, 'booker_name')$q$, 'Renamed by PM1');
select v63_test.okrun('G05 the worker (definer functions, postgres) can write them: no guard for the owner role', format($q$update public.bookings set calendar_owner_connection_id = %L where id = v63_test.b(2)$q$, :'c_sa'));

-- ================================================================= RLS as the second line of defence
grant select on app_private.calendar_sync_log, app_private.calendar_sync_config to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e630","role":"authenticated"}', true);
set local role authenticated;
select v63_test.val('Z01 even a super_admin with a (temporary) table grant sees ZERO rows: RLS is forced and there is no policy', $q$select (select count(*) from app_private.calendar_sync_log)::text || '/' || (select count(*) from app_private.calendar_sync_config)::text$q$, '0/0');
reset role;
revoke select on app_private.calendar_sync_log, app_private.calendar_sync_config from authenticated;
select v63_test.val('Z02 ... as postgres the rows exist (the log has entries, the config row is there)', $q$select (select count(*) > 0 from app_private.calendar_sync_log)::text || '/' || (select count(*) from app_private.calendar_sync_config)::text$q$, 'true/1');
select v63_test.val('Z03 the temporary grant is gone', $q$select count(*)::text from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('calendar_sync_config', 'calendar_sync_log') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')$q$, '0');

-- ================================================================= SEQUENTIAL two-worker proof (the true parallel race is v63_calendar_concurrency.mjs)
update app_private.calendar_sync_config set mode = 'live' where id;
delete from app_private.integration_jobs where booking_id in (select id from v63_test.bk);
select v63_test.mk(1, 'calendar_create', 30) as q1 \gset
select v63_test.mk(2, 'calendar_create', 29) as q2 \gset
select v63_test.mk(3, 'calendar_create', 28) as q3 \gset
select v63_test.mk(4, 'calendar_create', 27) as q4 \gset
select v63_test.claim(2) as wa \gset
select v63_test.claim(2) as wb \gset
select v63_test.claim(2) as wc \gset
select v63_test.val('Q01 TWO WORKERS: A takes 2, B takes the other 2, C gets nothing; the sets are disjoint and cover all four jobs', format($q$select v63_test.mine(%L::jsonb)::text || '/' || v63_test.mine(%L::jsonb)::text || '/' || v63_test.mine(%L::jsonb)::text || '/' || (select count(distinct x->>'id') from jsonb_array_elements(%L::jsonb || %L::jsonb) x)::text$q$, :'wa', :'wb', :'wc', :'wa', :'wb'), '2/2/0/4');
select v63_test.val('Q02 every job was claimed exactly once (attempts = 1)', format($q$select count(*)::text from app_private.integration_jobs where id in (%L, %L, %L, %L) and attempts = 1 and status = 'processing'$q$, :'q1', :'q2', :'q3', :'q4'), '4');

-- ================================================================= the end state
update app_private.calendar_sync_config set mode = 'shadow', last_run_at = null, last_run_summary = null where id;
select current_setting('v63.res', true) as res \gset
rollback;

-- the baseline is back (the whole test ran in a rolled-back transaction)
select (select count(*) from app_private.integration_jobs where idempotency_key like 'v63:%') + (select count(*) from app_private.google_connections where email::text like 'zz-v63-%')
       + (select count(*) from auth.users where email like 'zz-v63-%') + (select count(*) from public.bookings where booker_email::text like 'zz-v63-%') + (select count(*) from public.programs where name_en = 'V63 Program') as leftovers \gset
select :leftovers = 0 as baseline_restored;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or :leftovers <> 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v63: calendar sync tests FAILED'; end $$;
\endif
