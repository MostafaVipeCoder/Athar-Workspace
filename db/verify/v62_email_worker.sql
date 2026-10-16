-- v62_email_worker  (m62: e-mail outbox worker: claim / lease / quota / sender resolution / finish, the state guard, the audit log, the Outbox client RPCs, privileges)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / projects / outbox rows / connections never persist (the transaction first EMPTIES the outbox, the log
-- and the connections it works on, so the checks do not depend on what the database holds; the rollback brings everything back). Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e62x):  SA = super_admin, PM1 = project manager of project P1, PM2 = project manager of project P2, F = founder, NR = no role.
-- Connections: C1 = PM1's (active), C2 = PM2's (needs_reconnect), CS = the system sender (active).  Nodes: SEL1 (selection) + BK1 (booking, interview) in P1, SEL2 in P2.
-- Time cannot move inside one transaction (now() is constant): leases are expired by a definer helper, "the window slides" is not simulated here (the JS tests and
-- db/scripts/verify-email-worker.mjs cover time).
-- GOTCHAS honoured: (1) never call a function while the session role is anon / authenticated unless that role may EXECUTE it (it can crash this local Postgres image): denials are
-- proved with has_function_privilege(); (2) a statement does not see the rows a VOLATILE function changed in the SAME statement, except through a volatile definer helper:
-- every state read that follows a worker call goes through v62_test.ob / nlog / cnt or a separate statement.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v62.res', '', false) \gset
-- the committed state BEFORE the transaction (the end of the file proves it is back)
select (select count(*) from app_private.email_outbox) as ob0, (select count(*) from app_private.email_log) as lg0, (select count(*) from app_private.google_connections) as gc0,
       (select count(*) from app_private.worker_settings) as ws0, (select count(*) from app_private.worker_heartbeat) as hb0,
       (select count(*) from vault.secrets where name = 'athar-email-worker-secret') as vs0, (select count(*) from cron.job where jobname like 'athar-email-%') as cj0,
       (select count(*) from auth.users where email like 'zz-v62-%') as us0 \gset

begin;
create schema v62_test;
grant usage on schema v62_test to public;
create or replace function v62_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v62.res', current_setting('v62.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v62_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v62_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v62_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v62_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v62_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v62_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v62_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v62_test.t(p_key, true, 'ok');
  exception when others then
    perform v62_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- definer helpers (owner postgres, VOLATILE): the only way a role-switched session can see or build what it needs, and they always read the CURRENT state
create or replace function v62_test.ob(p_id uuid, p_col text) returns text language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from app_private.email_outbox where id = $1', p_col) into v using p_id;
  return v;
end $$;
create or replace function v62_test.cnt(p_where text) returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v integer;
begin
  execute 'select count(*)::integer from app_private.email_outbox where ' || p_where into v;
  return v;
end $$;
create or replace function v62_test.nlog(p_id uuid, p_event text) returns integer language sql volatile security definer set search_path = '' as $$
  select count(*)::integer from app_private.email_log where outbox_id = p_id and event = p_event
$$;
create or replace function v62_test.nlogs(p_where text) returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v integer;
begin
  execute 'select count(*)::integer from app_private.email_log where ' || p_where into v;
  return v;
end $$;
create or replace function v62_test.logcol(p_id uuid, p_event text, p_col text) returns text language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from app_private.email_log where outbox_id = $1 and event = $2 order by id limit 1', p_col) into v using p_id, p_event;
  return v;
end $$;
create or replace function v62_test.expire(p_id uuid) returns void language sql volatile security definer set search_path = '' as $$
  update app_private.email_outbox set locked_until = now() - interval '5 minutes' where id = p_id
$$;
create or replace function v62_test.due(p_id uuid) returns void language sql volatile security definer set search_path = '' as $$
  update app_private.email_outbox set next_attempt_at = now() - interval '1 second' where id = p_id
$$;
create or replace function v62_test.setstatus(p_id uuid, p_status text) returns void language sql volatile security definer set search_path = '' as $$
  update app_private.email_outbox set status = p_status where id = p_id
$$;
create or replace function v62_test.x(p_sql text) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  execute p_sql;
end $$;
create or replace function v62_test.wipe() returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from app_private.email_log;
  delete from app_private.email_outbox;
end $$;
-- a row in the outbox (any state) for the fixture; created_at = clock_timestamp() so the FIFO order is the call order
create or replace function v62_test.mk(p_key text, p_by uuid, p_project uuid, p_node uuid, p_status text default 'queued', p_to text default null, p_tag text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_tag text := coalesce(p_tag, gen_random_uuid()::text);
begin
  insert into app_private.email_outbox (project_id, node_id, email_key, recipient_email, subject, body_html, idempotency_key, status, created_by, created_at)
  values (p_project, p_node, p_key, coalesce(p_to, 'r-' || substr(v_tag, 1, 8) || '@example.invalid'), 'Subject ' || v_tag, '<p>Body ' || v_tag || '</p>', 'v62-' || v_tag, p_status, p_by, clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;
create or replace function v62_test.mk_n(p_prefix text, p_n integer, p_by uuid, p_project uuid, p_node uuid) returns integer language plpgsql volatile security definer set search_path = '' as $$
declare i integer;
begin
  for i in 1 .. p_n loop
    perform v62_test.mk('acceptance', p_by, p_project, p_node, 'queued', p_prefix || i || '@example.invalid', p_prefix || '-' || i);
  end loop;
  return p_n;
end $$;
create or replace function v62_test.mk_conn(p_kind text, p_owner uuid, p_email text, p_status text default 'active') returns uuid
language sql volatile security definer set search_path = '' as $$
  insert into app_private.google_connections (kind, owner_user_id, email, scopes, token_storage, status, last_error)
  values (p_kind, p_owner, p_email, array['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events'],
          'aes', p_status, case when p_status = 'needs_reconnect' then 'invalid_grant' end)
  returning id
$$;
create or replace function v62_test.cfg(p_node uuid, p_key text, p_cfg jsonb) returns void language sql volatile security definer set search_path = '' as $$
  update public.nodes set config = jsonb_set(coalesce(config, '{}'::jsonb), '{emails}', coalesce(config -> 'emails', '{}'::jsonb) || jsonb_build_object(p_key, p_cfg), true) where id = p_node
$$;
create or replace function v62_test.nocfg(p_node uuid) returns void language sql volatile security definer set search_path = '' as $$
  update public.nodes set config = '{}'::jsonb where id = p_node
$$;
create or replace function v62_test.sender_of(p_id uuid) returns text language sql volatile security definer set search_path = '' as $$
  select coalesce(s.source, '-') || '/' || coalesce(s.fallback::text, '-') || '/' || coalesce(s.reason, '-') || '/' || coalesce(s.email, '-')
    from app_private.email_outbox o cross join lateral app_private.email_pick_sender(o) s where o.id = p_id
$$;
create or replace function v62_test.nosender(p_id uuid) returns text language sql volatile security definer set search_path = '' as $$
  select (s.connection_id is null)::text || '/' || coalesce(s.reason, '-') from app_private.email_outbox o cross join lateral app_private.email_pick_sender(o) s where o.id = p_id
$$;
revoke all on all functions in schema v62_test from public;
grant execute on all functions in schema v62_test to anon, authenticated, service_role;

-- ================================================================= C. catalog (as postgres, BEFORE the data is emptied)
select v62_test.val('C01 email_outbox has the 12 new worker columns', $q$select count(*)::text from information_schema.columns where table_schema = 'app_private' and table_name = 'email_outbox'
  and column_name in ('blocked_reason','locked_until','locked_by','send_started_at','send_attempt','fail_streak','last_attempt_at','message_id','sender_source','resolution','resolved_by','resolved_at')$q$, '12');
select v62_test.val('C02 email_log has the 7 audit columns (attempt, status, sender, masked + hashed recipient, Gmail id, actor) and NO subject / body / address column', $q$select (select count(*) from information_schema.columns where table_schema = 'app_private' and table_name = 'email_log'
  and column_name in ('attempt','status','sender_connection_id','recipient_masked','recipient_hash','gmail_message_id','actor'))::text || '/' || (select count(*) from information_schema.columns where table_schema = 'app_private' and table_name = 'email_log' and column_name ~* '(subject|body|html|recipient_email|^to$)')::text$q$, '7/0');
select v62_test.val('C03 the six new CHECK constraints exist', $q$select count(*)::text from pg_constraint where conrelid = 'app_private.email_outbox'::regclass and conname in ('email_outbox_blocked_chk','email_outbox_sender_source_chk','email_outbox_resolution_chk','email_outbox_counters_chk','email_outbox_error_code_chk','email_outbox_message_id_chk')$q$, '6');
select v62_test.val('C04 the four worker RPCs: SECURITY DEFINER, empty search_path, EXECUTE for service_role and for NO client role', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('email_worker_claim','email_worker_mark_sending','email_worker_finish','email_worker_heartbeat') and p.prosecdef and 'search_path=""' = any(p.proconfig)
  and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '4');
select v62_test.val('C05 the three legacy functions keep their service-role-only grant', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_email_batch','complete_email','fail_email')
  and p.prosecdef and 'search_path=""' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '3');
select v62_test.fails('C06a claim_email_batch is a shim that refuses: ONE claim path', $q$select * from public.claim_email_batch(gen_random_uuid(), 5)$q$, '0A000', 'deprecated');
select v62_test.fails('C06b complete_email refuses', $q$select public.complete_email(gen_random_uuid(), 'x')$q$, '0A000', 'deprecated');
select v62_test.fails('C06c fail_email refuses', $q$select public.fail_email(gen_random_uuid(), 'x', 'y', true)$q$, '0A000', 'deprecated');
select v62_test.val('C07 the ten client RPCs: SECURITY DEFINER, empty search_path, EXECUTE for authenticated, NOT for anon', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('list_email_outbox','get_email_outbox_item','get_email_outbox_counts','email_outbox_retry','email_outbox_cancel','email_outbox_mark_sent','email_outbox_resend','email_outbox_send_now','get_email_health','list_staff_invitation_delivery')
  and p.prosecdef and 'search_path=""' = any(p.proconfig) and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '10');
select v62_test.val('C08 every app_private helper of m62 is closed to anon, authenticated and service_role', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('mask_email','email_hash','email_state','email_log_add','email_log_fill','google_connection_usable','email_row_manageable','email_outbox_state_guard','email_pick_sender','email_kick_worker','email_worker_enable','email_worker_disable','email_worker_status','email_maintenance')
  and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')$q$, '14');
select v62_test.val('C09 no client role (and not service_role) holds a privilege on the outbox, the log, the settings or the heartbeat table', $q$select count(*)::text from information_schema.role_table_grants where table_schema = 'app_private'
  and table_name in ('email_outbox','email_log','worker_settings','worker_heartbeat') and grantee in ('anon','authenticated','service_role','PUBLIC')$q$, '0');
select v62_test.val('C10 RLS is enabled AND forced on all four tables', $q$select count(*)::text from pg_class where oid in ('app_private.email_outbox'::regclass,'app_private.email_log'::regclass,'app_private.worker_settings'::regclass,'app_private.worker_heartbeat'::regclass) and relrowsecurity and relforcerowsecurity$q$, '4');
select v62_test.val('C11 no function a client role may execute reads Vault or the AES ciphertext table', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
  and (p.prosrc ilike '%decrypted_secrets%' or p.prosrc ilike '%google_connection_secrets%') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v62_test.val('C12 the state-guard trigger is on the outbox', $q$select count(*)::text from pg_trigger where tgrelid = 'app_private.email_outbox'::regclass and tgname = 'email_outbox_bu_state' and not tgisinternal$q$, '1');
select v62_test.val('C13 pg_cron and pg_net are installed on this image', $q$select count(*)::text from pg_extension where extname in ('pg_cron','pg_net')$q$, '2');
select v62_test.val('C14 the migration scheduled nothing by itself: the cron jobs exist only when the scheduler setting says enabled', $q$select ((select count(*) from cron.job where jobname like 'athar-email-%')::int = case when coalesce((select value from app_private.worker_settings where key = 'email_worker_enabled'), '0') = '1' then 2 else 0 end)::text$q$, 'true');
select v62_test.val('C16 mask_email / email_hash / email_state', $q$select app_private.mask_email('Ahmed.Ali@Gmail.com') || '|' || app_private.mask_email('a@b.co') || '|' || coalesce(app_private.mask_email(null), 'NULL') || '|' || coalesce(app_private.mask_email('nonsense'), 'NULL') || '|' || length(app_private.email_hash(' X@Y.Z ')) || '|' || (app_private.email_hash('X@Y.Z') = app_private.email_hash('x@y.z'))::text || '|' || coalesce(app_private.email_hash(null), 'NULL')
  || '|' || app_private.email_state('queued', 'rate_limited') || '|' || app_private.email_state('queued', null) || '|' || app_private.email_state('dead', null) || '|' || app_private.email_state('sent', null)$q$,
  'A***@Gmail.com|a***@b.co|NULL|NULL|24|true|NULL|blocked|queued|failed|sent');

-- ================================================================= empty what the tests work on (rolled back at the end), then the fixture
delete from app_private.email_log;
delete from app_private.email_outbox;
delete from app_private.google_connections;
delete from app_private.worker_settings;
delete from app_private.worker_heartbeat;
select v62_test.val('C15 emptied: no outbox row, no log row, no connection, no setting', $q$select ((select count(*) from app_private.email_outbox) + (select count(*) from app_private.email_log) + (select count(*) from app_private.google_connections) + (select count(*) from app_private.worker_settings))::text$q$, '0');

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e620','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v62-sa@athareg.com','{"provisioned":true}','{"full_name":"V62 Super Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e621','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v62-pm1@athareg.com','{"provisioned":true}','{"full_name":"V62 PM One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e622','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v62-pm2@athareg.com','{"provisioned":true}','{"full_name":"V62 PM Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e623','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v62-f@example.invalid','{"provisioned":true}','{"full_name":"V62 Founder"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e624','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v62-nr@example.invalid','{"provisioned":true}','{"full_name":"V62 No Role"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e620','super_admin'), ('00000000-0000-4000-8000-00000000e621','project_manager'),
  ('00000000-0000-4000-8000-00000000e622','project_manager'), ('00000000-0000-4000-8000-00000000e623','founder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e620","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V62 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V62 Project One', null, 'Africa/Cairo')).id as p1 \gset
select (public.create_project(:'prog', 'V62 Project Two', null, 'Africa/Cairo')).id as p2 \gset
select (public.add_node(:'p1', 'selection', '{"en":"V62 Stage 1"}', 0, 0, '{}')).id as sel1 \gset
select (public.add_node(:'p1', 'booking', '{"en":"V62 Interviews"}', 0, 0, '{"mode":"interview"}')).id as bk1 \gset
select (public.add_node(:'p2', 'selection', '{"en":"V62 Stage 2"}', 0, 0, '{}')).id as sel2 \gset
reset role;
insert into public.project_members (project_id, user_id, member_role) values (:'p1', '00000000-0000-4000-8000-00000000e621', 'manager'), (:'p2', '00000000-0000-4000-8000-00000000e622', 'manager');
select v62_test.mk_conn('user', '00000000-0000-4000-8000-00000000e621', 'zz-v62-pm1@athareg.com') as c1 \gset
select v62_test.mk_conn('user', '00000000-0000-4000-8000-00000000e622', 'zz-v62-pm2@athareg.com', 'needs_reconnect') as c2 \gset
select v62_test.mk_conn('system', null, 'zz-v62-startups@athareg.com') as cs \gset
\set PM1 '00000000-0000-4000-8000-00000000e621'
\set PM2 '00000000-0000-4000-8000-00000000e622'
\set SA  '00000000-0000-4000-8000-00000000e620'
\set FND '00000000-0000-4000-8000-00000000e623'
\set NRU '00000000-0000-4000-8000-00000000e624'

-- ================================================================= T. the state machine and the constraints
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'sent', null, 't-sent') as o_sent \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'cancelled', null, 't-cancel') as o_canc \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', null, 't-queued') as o_q \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', null, 't-queued2') as o_q2 \gset
select v62_test.fails('T01 a SENT e-mail can never change state (never sent twice)', format($q$select v62_test.setstatus('%s', 'queued')$q$, :'o_sent'), '22023', 'email_invalid');
select v62_test.fails('T02 a CANCELLED e-mail cannot be revived', format($q$select v62_test.setstatus('%s', 'queued')$q$, :'o_canc'), '22023', 'email_invalid');
select v62_test.fails('T02b nor can a sent row become failed or cancelled', format($q$select v62_test.setstatus('%s', 'failed')$q$, :'o_sent'), '22023', 'email_invalid');
select v62_test.okrun('T03 a sent row may still be updated without a state change (a body prune)', format($q$update app_private.email_outbox set body_html = null where id = '%s'$q$, :'o_sent'));
update app_private.email_outbox set blocked_reason = 'rate_limited' where id = :'o_q';
select v62_test.val('T04 a queued row can be blocked, and shows as "blocked"', format($q$select app_private.email_state(status, blocked_reason) from app_private.email_outbox where id = '%s'$q$, :'o_q'), 'blocked');
update app_private.email_outbox set status = 'cancelled' where id = :'o_q';
select v62_test.val('T05 leaving "queued" clears the blocked reason (the m24 revoke path cancels blocked rows)', format($q$select coalesce(blocked_reason, 'NULL') from app_private.email_outbox where id = '%s'$q$, :'o_q'), 'NULL');
select v62_test.fails('T06 a blocked reason on a row that is not queued is refused', format($q$insert into app_private.email_outbox (email_key, recipient_email, subject, body_html, idempotency_key, status, blocked_reason, project_id, node_id)
  values ('acceptance', 'x@example.invalid', 's', 'b', 'v62-t06', 'sent', 'rate_limited', '%s', '%s')$q$, :'p1', :'sel1'), '23514');
select v62_test.fails('T07 a blocked reason outside the vocabulary', format($q$update app_private.email_outbox set blocked_reason = 'because' where id = '%s'$q$, :'o_q2'), '23514');
select v62_test.fails('T08 error_code is a CODE: a sentence is refused', format($q$update app_private.email_outbox set error_code = 'Token has expired.' where id = '%s'$q$, :'o_q2'), '23514');
select v62_test.fails('T09 message_id must look like <id@domain>', format($q$update app_private.email_outbox set message_id = 'abc' where id = '%s'$q$, :'o_q2'), '23514');
select v62_test.fails('T10 resolution vocabulary', format($q$update app_private.email_outbox set resolution = 'whatever' where id = '%s'$q$, :'o_q2'), '23514');
select v62_test.fails('T11 negative counters refused', format($q$update app_private.email_outbox set fail_streak = -1 where id = '%s'$q$, :'o_q2'), '23514');
select v62_test.fails('T12 sender_source vocabulary', format($q$update app_private.email_outbox set sender_source = 'robot' where id = '%s'$q$, :'o_q2'), '23514');
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'Raw.Producer@example.invalid', 't-raw') as o_raw \gset
insert into app_private.email_log (outbox_id, event, detail) values (:'o_raw', 'queued', 'selection:acceptance round 1 lang en');   -- how m24 / m33 / m34 write their audit row
select v62_test.val('T13 an audit row written by a plain INSERT (the producers) still gets the recipient MASKED and HASHED, never the address', format($q$select v62_test.logcol('%s', 'queued', 'recipient_masked') || '/' || length(v62_test.logcol('%s', 'queued', 'recipient_hash'))$q$, :'o_raw', :'o_raw'), 'R***@example.invalid/24');
select v62_test.wipe();

-- ================================================================= S. sender resolution (as postgres: the helper is private)
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1') as s1 \gset
select v62_test.val('S01 the acting PM with an active connection sends as himself', format($q$select v62_test.sender_of('%s')$q$, :'s1'), 'user/false/-/zz-v62-pm1@athareg.com');
select v62_test.mk('acceptance', :'PM2', :'p2', :'sel2') as s2 \gset
select v62_test.val('S02 a PM whose connection needs reconnecting falls back to startups@ (with the reason)', format($q$select v62_test.sender_of('%s')$q$, :'s2'), 'system/true/user_needs_reconnect/zz-v62-startups@athareg.com');
select v62_test.cfg(:'sel2', 'acceptance', '{"fallback_to_system": false}'::jsonb);
select v62_test.val('S03 ... unless the template forbids the fallback: nobody sends', format($q$select v62_test.nosender('%s')$q$, :'s2'), 'true/user_needs_reconnect');
select v62_test.mk('acceptance', :'FND', :'p1', :'sel1') as s4 \gset
select v62_test.val('S04 a creator who never connected (a founder / an anonymous booker) falls back to the system sender', format($q$select v62_test.sender_of('%s')$q$, :'s4'), 'system/true/user_not_connected/zz-v62-startups@athareg.com');
select v62_test.mk('acceptance', null, :'p1', :'sel1') as s4b \gset
select v62_test.val('S04b a NULL creator too', format($q$select v62_test.sender_of('%s')$q$, :'s4b'), 'system/true/user_not_connected/zz-v62-startups@athareg.com');
select v62_test.mk('form_new_response', :'PM1', :'p1', :'sel1') as s5 \gset
select v62_test.val('S05 form notifications go out from the system sender by default', format($q$select v62_test.sender_of('%s')$q$, :'s5'), 'system/false/-/zz-v62-startups@athareg.com');
select v62_test.cfg(:'sel1', 'interview', '{"sender_mode": "system"}'::jsonb);
select v62_test.mk('interview', :'PM1', :'p1', :'sel1') as s6 \gset
select v62_test.val('S06 sender_mode system sends from startups@ even for a connected PM', format($q$select v62_test.sender_of('%s')$q$, :'s6'), 'system/false/-/zz-v62-startups@athareg.com');
update public.booking_settings set organizer_connection_id = :'c1' where node_id = :'bk1';
select v62_test.mk('booking_confirmation', null, :'p1', :'bk1') as s7 \gset
select v62_test.val('S07 a booking e-mail (anonymous booker) is sent by the booking node organizer', format($q$select v62_test.sender_of('%s')$q$, :'s7'), 'user/false/-/zz-v62-pm1@athareg.com');
update public.booking_settings set organizer_connection_id = null where node_id = :'bk1';
select v62_test.val('S08 a booking e-mail without an organizer uses the system sender', format($q$select v62_test.sender_of('%s')$q$, :'s7'), 'system/true/user_not_connected/zz-v62-startups@athareg.com');
update public.booking_settings set organizer_connection_id = :'c2' where node_id = :'bk1';
select v62_test.val('S08b ... and an organizer who needs reconnecting too, with the reason', format($q$select v62_test.sender_of('%s')$q$, :'s7'), 'system/true/user_needs_reconnect/zz-v62-startups@athareg.com');
update public.booking_settings set organizer_connection_id = null where node_id = :'bk1';
select v62_test.mk('acceptance', :'NRU', :'p1', :'sel1') as s9 \gset
update app_private.email_outbox set sender_connection_id = :'c1' where id = :'s9';
select v62_test.val('S09 a pinned sender that is still usable wins (m06d create_booking pins one)', format($q$select v62_test.sender_of('%s')$q$, :'s9'), 'user/false/-/zz-v62-pm1@athareg.com');
update app_private.email_outbox set sender_connection_id = :'c2' where id = :'s9';
select v62_test.val('S10 a pinned sender that needs reconnecting is ignored (system fallback)', format($q$select v62_test.sender_of('%s')$q$, :'s9'), 'system/true/user_not_connected/zz-v62-startups@athareg.com');
select v62_test.mk('staff_invitation', :'SA', null, null) as s11 \gset
select v62_test.val('S11 a staff invitation (no project, no node): the inviter has no connection, so startups@ sends it', format($q$select v62_test.sender_of('%s')$q$, :'s11'), 'system/true/user_not_connected/zz-v62-startups@athareg.com');
update app_private.google_connections set status = 'revoked', vault_secret_id = null where id = :'cs';
select v62_test.val('S12 no system sender at all and the creator never connected: nobody (reason no_connection)', format($q$select v62_test.nosender('%s')$q$, :'s4'), 'true/no_connection');
update app_private.google_connections set status = 'active' where id = :'cs';
select v62_test.val('S13 usable = active + both scopes + a secret: an unknown id and NULL are not usable', format($q$select app_private.google_connection_usable('%s')::text || '/' || app_private.google_connection_usable(gen_random_uuid())::text || '/' || app_private.google_connection_usable(null)::text$q$, :'c1'), 'true/false/false');
select v62_test.wipe();
select v62_test.nocfg(:'sel1');
select v62_test.nocfg(:'sel2');

-- ================================================================= W. the worker RPCs (as service_role)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'first@example.invalid', 'w-1') as w1 \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'second@example.invalid', 'w-2') as w2 \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'third@example.invalid', 'w-3') as w3 \gset
select public.email_worker_claim('wk-A', 2, 120, 30, 1500) as cl1 \gset
select v62_test.val('W01 claim(limit 2) returns the two OLDEST rows with recipient, subject, body and the resolved sender', format($q$select (jsonb_array_length(c->'rows') = 2 and (c->'rows'->0->>'id') = '%s' and (c->'rows'->1->>'id') = '%s'
  and c->'rows'->0->>'recipient' = 'first@example.invalid' and (c->'rows'->0->>'subject') like 'Subject w-1%%' and (c->'rows'->0->>'body_html') like '<p>Body w-1%%'
  and c->'rows'->0->'sender'->>'email' = 'zz-v62-pm1@athareg.com' and c->'rows'->0->'sender'->>'source' = 'user' and (c->'rows'->0->'sender'->>'fallback') = 'false' and c->'rows'->0->'sender'->>'name' = 'V62 PM One'
  and (c->>'claimed') = '2')::text from (select '%s'::jsonb c) x$q$, :'w1', :'w2', :'cl1'), 'true');
select v62_test.val('W02 the claimed rows are `sending` with a lease holder, an expiry, the sender pinned and attempts = 1', format($q$select v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'locked_by') || '/' || (v62_test.ob('%s', 'locked_until')::timestamptz > now())::text || '/' || (v62_test.ob('%s', 'sender_connection_id') = '%s')::text || '/' || v62_test.ob('%s', 'sender_source') || '/' || v62_test.ob('%s', 'attempts')$q$,
  :'w1', :'w1', :'w1', :'w1', :'c1', :'w1', :'w1'), 'sending/wk-A/true/true/user/1');
select public.email_worker_claim('wk-B', 10, 120, 30, 1500) as cl2 \gset
select v62_test.val('W03 a SECOND worker claiming right now gets ONLY the third row, never the two leased ones', format($q$select (select string_agg(r->>'id', ',') from jsonb_array_elements('%s'::jsonb->'rows') r)$q$, :'cl2'), :'w3');
select v62_test.val('W04 the audit row: claimed, attempt 1, the sender, the recipient MASKED and HASHED, never the address', format($q$select v62_test.logcol('%s', 'claimed', 'event') || '/' || v62_test.logcol('%s', 'claimed', 'attempt') || '/' || v62_test.logcol('%s', 'claimed', 'status') || '/' || v62_test.logcol('%s', 'claimed', 'recipient_masked') || '/' || length(v62_test.logcol('%s', 'claimed', 'recipient_hash')) || '/' || (v62_test.logcol('%s', 'claimed', 'sender_connection_id') = '%s')::text$q$, :'w1', :'w1', :'w1', :'w1', :'w1', :'w1', :'c1'), 'claimed/1/sending/f***@example.invalid/24/true');
select v62_test.val('W05 mark_sending by the lease holder: ok, send_attempt 1, the marker is persisted, the quota ledger has ONE send_started row; a second mark is refused', format($q$select (public.email_worker_mark_sending('%s', 'wk-A')->>'ok') || '/' || (public.email_worker_mark_sending('%s', 'wk-A')->>'reason') || '/' || v62_test.ob('%s', 'send_attempt') || '/' || (v62_test.ob('%s', 'send_started_at') is not null)::text || '/' || v62_test.nlog('%s', 'send_started')$q$, :'w1', :'w1', :'w1', :'w1', :'w1'), 'true/lease_lost/1/true/1');
select v62_test.val('W05b mark_sending by another worker / for a queued or unknown row / NULL arguments -> ok false', format($q$select (public.email_worker_mark_sending('%s', 'wk-B')->>'ok') || '/' || (public.email_worker_mark_sending(gen_random_uuid(), 'wk-A')->>'ok') || '/' || (public.email_worker_mark_sending(null, 'wk-A')->>'ok') || '/' || (public.email_worker_mark_sending('%s', null)->>'ok')$q$, :'w2', :'w1'), 'false/false/false/false');
select v62_test.val('W06 finish(sent) by a stranger is refused (not_owner)', format($q$select (public.email_worker_finish('%s', 'wk-B', 'sent', null, null, null, 'gm-1', '<x@athareg.com>')->>'reason')$q$, :'w1'), 'not_owner');
select v62_test.val('W07 finish(sent) by the holder: sent_at, the Gmail id, the Message-ID, lease cleared, streak 0', format($q$select (public.email_worker_finish('%s', 'wk-A', 'sent', null, 'cc_dropped:1', null, 'gm-1', '<%s.1@athareg.com>')->>'status') || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'gmail_message_id') || '/' || v62_test.ob('%s', 'message_id') || '/' || (v62_test.ob('%s', 'locked_by') is null and v62_test.ob('%s', 'locked_until') is null)::text || '/' || (v62_test.ob('%s', 'sent_at') is not null)::text || '/' || v62_test.ob('%s', 'fail_streak')$q$,
  :'w1', :'w1', :'w1', :'w1', :'w1', :'w1', :'w1', :'w1', :'w1'), 'sent/sent/gm-1/<' || :'w1' || '.1@athareg.com>/true/true/0');
select v62_test.val('W08 finish(sent) again is idempotent (already)', format($q$select (public.email_worker_finish('%s', 'wk-A', 'sent', null, null, null, 'gm-1', null)->>'already')$q$, :'w1'), 'true');
select v62_test.val('W09 the Gmail id and the status are in the audit log, still no address', format($q$select v62_test.logcol('%s', 'sent', 'gmail_message_id') || '/' || v62_test.logcol('%s', 'sent', 'status') || '/' || (v62_test.logcol('%s', 'sent', 'recipient_masked') like 'f***@%%')::text$q$, :'w1', :'w1', :'w1'), 'gm-1/sent/true');
-- retry / backoff / max streak: w2 is held by wk-A
select v62_test.val('W10 the second row: mark + finish(retry, 60 s): queued again at +60 s, streak 1, the code kept, lease and marker cleared', format($q$select (public.email_worker_mark_sending('%s', 'wk-A')->>'ok') || '/' || (public.email_worker_finish('%s', 'wk-A', 'retry', 'rate_limited', 'google rate_limited http 429', 60000)->>'status') || '/' || (v62_test.ob('%s', 'next_attempt_at')::timestamptz = now() + interval '60 seconds')::text || '/' || v62_test.ob('%s', 'fail_streak') || '/' || v62_test.ob('%s', 'error_code') || '/' || (v62_test.ob('%s', 'send_started_at') is null)::text || '/' || (v62_test.ob('%s', 'locked_by') is null)::text$q$,
  :'w2', :'w2', :'w2', :'w2', :'w2', :'w2', :'w2'), 'true/queued/true/1/rate_limited/true/true');
select public.email_worker_claim('wk-A', 10, 120, 30, 1500) as cl3 \gset
select v62_test.val('W11 a retried row is NOT claimed before its time', format($q$select (select count(*) from jsonb_array_elements('%s'::jsonb->'rows') r where r->>'id' = '%s')::text$q$, :'cl3', :'w2'), '0');
select v62_test.due(:'w2');
select public.email_worker_claim('wk-A', 10, 120, 30, 1500) as cl3b \gset
select v62_test.val('W12 ... and is claimed again when due, with attempts 2, the streak visible and send_attempt 1', format($q$select (select (r->>'attempts') || '/' || (r->>'fail_streak') || '/' || (r->>'send_attempt') from jsonb_array_elements('%s'::jsonb->'rows') r where r->>'id' = '%s')$q$, :'cl3b', :'w2'), '2/1/1');
select v62_test.val('W13 the streak limit (p_max_streak 2): the second consecutive retry is FAILED with max_attempts', format($q$select (public.email_worker_mark_sending('%s', 'wk-A')->>'ok') || '/' || (public.email_worker_finish('%s', 'wk-A', 'retry', 'server_error', 'google server_error http 503', 1000, null, null, 2)->>'status') || '/' || v62_test.ob('%s', 'error_code') || '/' || v62_test.ob('%s', 'send_attempt')$q$, :'w2', :'w2', :'w2', :'w2'), 'true/failed/max_attempts/2');
-- w3 was claimed by wk-B
select v62_test.val('W14 the third row: finish(failed) with a code and a one-line message (line breaks removed)', format($q$select (public.email_worker_mark_sending('%s', 'wk-B')->>'ok') || '/' || (public.email_worker_finish('%s', 'wk-B', 'failed', 'rejected_by_gmail', E'line one\nline two\r\n', null)->>'status') || '/' || v62_test.ob('%s', 'error_code') || '/' || v62_test.ob('%s', 'error_message')$q$, :'w3', :'w3', :'w3', :'w3'), 'true/failed/rejected_by_gmail/line one line two ');
select v62_test.fails('W15 an outcome outside the vocabulary is refused', format($q$select public.email_worker_finish('%s', 'wk-A', 'exploded', null, null, null)$q$, :'w1'), '22023', 'email_invalid');
select v62_test.fails('W15c finish(NULL id)', $q$select public.email_worker_finish(null, 'wk-A', 'sent')$q$, '22023', 'email_invalid');
select v62_test.fails('W15d finish(NULL worker)', format($q$select public.email_worker_finish('%s', null, 'sent')$q$, :'w1'), '22023', 'email_invalid');
select v62_test.fails('W15e finish(NULL outcome)', format($q$select public.email_worker_finish('%s', 'wk-A', null)$q$, :'w1'), '22023', 'email_invalid');
select v62_test.val('W15f finish(unknown id) is not_found, never an error', $q$select public.email_worker_finish(gen_random_uuid(), 'wk-A', 'sent')->>'reason'$q$, 'not_found');
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'queued', 'review@example.invalid', 'w-4') as w4 \gset
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'queued', 'blocked@example.invalid', 'w-5') as w5 \gset
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'queued', 'release@example.invalid', 'w-6') as w6 \gset
select public.email_worker_claim('wk-A', 10, 120, 30, 1500) as cl4 \gset
select v62_test.val('W16 the three new rows were claimed', format($q$select jsonb_array_length('%s'::jsonb->'rows')::text$q$, :'cl4'), '3');
select v62_test.val('W17 UNKNOWN OUTCOME: finish(needs_review) -> needs_review, code unknown_outcome, the request marker kept', format($q$select (public.email_worker_mark_sending('%s', 'wk-A')->>'ok') || '/' || (public.email_worker_finish('%s', 'wk-A', 'needs_review', null, 'google timeout')->>'status') || '/' || v62_test.ob('%s', 'error_code') || '/' || (v62_test.ob('%s', 'send_started_at') is not null)::text$q$, :'w4', :'w4', :'w4', :'w4'), 'true/needs_review/unknown_outcome/true');
select v62_test.due(:'w4');
select public.email_worker_claim('wk-A', 10, 120, 30, 1500) as cl5 \gset
select v62_test.val('W18 a needs_review row is NEVER claimed again, however long it waits', format($q$select (select count(*) from jsonb_array_elements('%s'::jsonb->'rows') r where r->>'id' = '%s')::text$q$, :'cl5', :'w4'), '0');
select v62_test.val('W19 a stranger cannot upgrade it; the SAME worker can (a late success): sent', format($q$select (public.email_worker_finish('%s', 'wk-Z', 'sent', null, null, null, 'gm-late')->>'reason') || '/' || (public.email_worker_finish('%s', 'wk-A', 'sent', null, null, null, 'gm-late', '<%s.1@athareg.com>')->>'status') || '/' || v62_test.ob('%s', 'gmail_message_id') || '/' || v62_test.nlog('%s', 'needs_review')$q$, :'w4', :'w4', :'w4', :'w4', :'w4'), 'not_owner/sent/gm-late/1');
select v62_test.val('W20 BLOCKED: finish(blocked, sender_needs_reconnect, 0 s) -> queued, blocked_reason set, state blocked, no streak', format($q$select (public.email_worker_finish('%s', 'wk-A', 'blocked', 'sender_needs_reconnect', 'google invalid_grant', 0)->>'status') || '/' || v62_test.ob('%s', 'blocked_reason') || '/' || v62_test.ob('%s', 'fail_streak') || '/' || v62_test.ob('%s', 'status')$q$, :'w5', :'w5', :'w5', :'w5'), 'queued/sender_needs_reconnect/0/queued');
select v62_test.fails('W21 a blocked reason outside the vocabulary is refused', format($q$select public.email_worker_finish('%s', 'wk-A', 'blocked', 'because', null)$q$, :'w6'), '22023', 'email_invalid');
select v62_test.val('W22 RELEASE before the request started: back to the queue, lease cleared, no failure counted', format($q$select (public.email_worker_finish('%s', 'wk-A', 'release', null, 'out of time')->>'status') || '/' || (v62_test.ob('%s', 'locked_by') is null)::text || '/' || v62_test.ob('%s', 'attempts') || '/' || v62_test.ob('%s', 'fail_streak')$q$, :'w6', :'w6', :'w6', :'w6'), 'queued/true/1/0');
select public.email_worker_claim('wk-A', 10, 120, 30, 1500) as cl6 \gset
select v62_test.val('W23 ... and after the request marker a RELEASE is refused (request_started)', format($q$select (public.email_worker_mark_sending('%s', 'wk-A')->>'ok') || '/' || (public.email_worker_finish('%s', 'wk-A', 'release')->>'reason')$q$, :'w6', :'w6'), 'true/request_started');
-- the reaper: w6 = marker set (lease will expire), w5 = claimed again by wk-A above (no marker); two fresh rows w7 / w8
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'crash-before@example.invalid', 'w-7') as w7 \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'crash-after@example.invalid', 'w-8') as w8 \gset
select public.email_worker_claim('wk-D', 10, 120, 30, 1500) as cl7 \gset
select public.email_worker_mark_sending(:'w8', 'wk-D');
select v62_test.expire(:'w6');
select v62_test.expire(:'w7');
select v62_test.expire(:'w8');
select public.email_worker_claim('wk-E', 10, 120, 30, 1500) as cl8 \gset
select v62_test.val('W24 an expired lease WITH the request marker is needs_review / unknown_outcome (w6 and w8), reported as reviewed >= 2, and never claimed', format($q$select ((c->>'reviewed')::int >= 2)::text || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'error_code') || '/' || (not exists (select 1 from jsonb_array_elements(c->'rows') r where r->>'id' in ('%s', '%s')))::text
  from (select '%s'::jsonb c) x$q$, :'w6', :'w8', :'w8', :'w6', :'w8', :'cl8'), 'true/needs_review/needs_review/unknown_outcome/true');
select v62_test.val('W25 an expired lease WITHOUT a marker (w7) is requeued and claimed again by the next worker (requeued >= 1)', format($q$select ((c->>'requeued')::int >= 1)::text || '/' || (exists (select 1 from jsonb_array_elements(c->'rows') r where r->>'id' = '%s'))::text || '/' || v62_test.ob('%s', 'locked_by') || '/' || v62_test.ob('%s', 'attempts')
  from (select '%s'::jsonb c) x$q$, :'w7', :'w7', :'w7', :'cl8'), 'true/true/wk-E/2');
select v62_test.val('W26 the lease holder that died cannot finish its old row as anything but the late `sent`', format($q$select (public.email_worker_finish('%s', 'wk-D', 'retry', 'network')->>'reason') || '/' || (public.email_worker_finish('%s', 'wk-D', 'failed', 'x')->>'reason') || '/' || (public.email_worker_finish('%s', 'wk-D', 'needs_review')->>'reason')$q$, :'w8', :'w8', :'w8'), 'not_owner/not_owner/not_owner');
select v62_test.val('W26b the reaper logged both decisions', format($q$select v62_test.nlog('%s', 'lease_expired_requeued') || '/' || v62_test.nlog('%s', 'needs_review')$q$, :'w7', :'w8'), '1/1');
select v62_test.wipe();

-- quota: per minute, per day, independent senders
select v62_test.mk_n('q', 5, :'PM1', :'p1', :'sel1') as qn \gset
select public.email_worker_claim('wk-Q', 10, 120, 2, 1500) as cq \gset
select v62_test.val('W30 per-minute quota 2: two rows claimed, three BLOCKED with reason rate_limited and next_attempt_at = +20 s', format($q$select (c->>'claimed') || '/' || (c->>'blocked') || '/' || v62_test.cnt($w$blocked_reason = 'rate_limited' and next_attempt_at = now() + interval '20 seconds'$w$) from (select '%s'::jsonb c) x$q$, :'cq'), '2/3/3');
select v62_test.val('W31 the blocked rows were logged ONCE with the reason', $q$select v62_test.nlogs($w$event = 'blocked' and detail = 'rate_limited'$w$)::text$q$, '3');
select v62_test.x($w$update app_private.email_outbox set next_attempt_at = now() - interval '1 second' where blocked_reason = 'rate_limited'$w$);
select public.email_worker_claim('wk-Q', 10, 120, 2, 1500) as cq2 \gset
select v62_test.val('W32 in-flight claims count against the quota: with the window still full they stay blocked and NO new log row is written (the reason did not change)', format($q$select (c->>'claimed') || '/' || (c->>'blocked') || '/' || v62_test.nlogs($w$event = 'blocked'$w$) from (select '%s'::jsonb c) x$q$, :'cq2'), '0/3/3');
select v62_test.x($w$update app_private.email_outbox set next_attempt_at = now() - interval '1 second' where blocked_reason = 'rate_limited'$w$);
select public.email_worker_claim('wk-Q', 10, 120, 10, 1500) as cq3 \gset
select v62_test.val('W33 a bigger per-minute budget lets them through, and the blocked reason is cleared', format($q$select (c->>'claimed') || '/' || v62_test.cnt('blocked_reason is not null') from (select '%s'::jsonb c) x$q$, :'cq3'), '3/0');
select v62_test.wipe();
-- daily cap
select v62_test.mk_n('d', 4, :'PM1', :'p1', :'sel1') as dn \gset
select public.email_worker_claim('wk-Day', 10, 120, 100, 3) as cd \gset
select v62_test.val('W34 daily cap 3: three claimed (in flight counted), the fourth BLOCKED daily_cap and retried in 15 minutes', format($q$select (c->>'claimed') || '/' || (c->>'blocked') || '/' || v62_test.cnt($w$blocked_reason = 'daily_cap' and next_attempt_at = now() + interval '15 minutes'$w$) from (select '%s'::jsonb c) x$q$, :'cd'), '3/1/1');
select v62_test.wipe();
-- per SENDER quotas
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'pm-a@example.invalid', 'x-1') as x1 \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'pm-b@example.invalid', 'x-2') as x2 \gset
select v62_test.mk('form_new_response', :'PM1', :'p1', :'sel1', 'queued', 'pm-c@example.invalid', 'x-3') as x3 \gset
select public.email_worker_claim('wk-X', 10, 120, 1, 1500) as cx \gset
select v62_test.val('W35 per-minute 1 for EACH sender: one row of the PM and the system form notification both go out, the second PM row waits', format($q$select (c->>'claimed') || '/' || (c->>'blocked') || '/' || (select string_agg(distinct r->'sender'->>'source', ',' order by r->'sender'->>'source') from jsonb_array_elements(c->'rows') r) from (select '%s'::jsonb c) x$q$, :'cx'), '2/1/system,user');
select v62_test.val('W36 the second PM row is the blocked one', format($q$select v62_test.ob('%s', 'blocked_reason')$q$, :'x2'), 'rate_limited');
select v62_test.wipe();
-- fallback is logged
select v62_test.mk('acceptance', :'PM2', :'p2', :'sel2', 'queued', 'fb@example.invalid', 'f-1') as f1 \gset
select public.email_worker_claim('wk-F', 10, 120, 30, 1500) as cf \gset
select v62_test.val('W37 a PM who needs reconnecting: the row is claimed WITH the system sender, fallback = true and the reason, and the audit row says so', format($q$select (c->'rows'->0->'sender'->>'source') || '/' || (c->'rows'->0->'sender'->>'fallback') || '/' || (c->'rows'->0->'sender'->>'fallback_reason') || '/' || v62_test.logcol('%s', 'claimed', 'detail')
  from (select '%s'::jsonb c) x$q$, :'f1', :'cf'), 'system/true/user_needs_reconnect/fallback to the system sender: user_needs_reconnect');
select v62_test.wipe();
-- no usable sender: blocked, with a visible reason
select v62_test.cfg(:'sel2', 'acceptance', '{"fallback_to_system": false}'::jsonb);
select v62_test.mk('acceptance', :'PM2', :'p2', :'sel2', 'queued', 'nofb@example.invalid', 'n-1') as n1 \gset
select v62_test.mk('acceptance', :'NRU', :'p1', :'sel1', 'queued', 'nosend@example.invalid', 'n-2') as n2 \gset
select v62_test.x(format($w$update app_private.google_connections set status = 'revoked', vault_secret_id = null where id = '%s'$w$, :'cs'));
select public.email_worker_claim('wk-N', 10, 120, 30, 1500) as cn \gset
select v62_test.val('W38 no usable sender: nothing is claimed, the rows are BLOCKED (sender_needs_reconnect for the PM, no_sender for the stranger) and retried in 5 minutes', format($q$select (c->>'claimed') || '/' || (c->>'blocked') || '/' || v62_test.ob('%s', 'blocked_reason') || '/' || v62_test.ob('%s', 'blocked_reason') || '/' || v62_test.cnt($w$next_attempt_at = now() + interval '5 minutes'$w$) from (select '%s'::jsonb c) x$q$, :'n1', :'n2', :'cn'), '0/2/sender_needs_reconnect/no_sender/2');
select v62_test.val('W38b the first block of each row is logged with the reason', $q$select v62_test.nlogs($w$event = 'blocked' and detail in ('sender_needs_reconnect', 'no_sender')$w$)::text$q$, '2');
select v62_test.x(format($w$update app_private.google_connections set status = 'active' where id = '%s'$w$, :'cs'));
select v62_test.wipe();
select v62_test.nocfg(:'sel2');
-- reply-to, staff invitation body, clamps
select v62_test.cfg(:'sel1', 'acceptance', '{"reply_to": "Team@Athareg.com"}'::jsonb);
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'rt@example.invalid', 'r-1') as r1 \gset
select public.email_worker_claim('wk-R', 5, 120, 30, 1500) as cr \gset
select v62_test.val('W39 reply_to from the template config (lower-cased) travels with the claimed row', format($q$select ('%s'::jsonb)->'rows'->0->>'reply_to'$q$, :'cr'), 'team@athareg.com');
select v62_test.wipe();
select v62_test.cfg(:'sel1', 'acceptance', '{"reply_to": "not an address"}'::jsonb);
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'rt2@example.invalid', 'r-2') as r2 \gset
select public.email_worker_claim('wk-R', 5, 120, 30, 1500) as cr2 \gset
select v62_test.val('W40 an invalid reply_to is ignored (NULL)', format($q$select (('%s'::jsonb)->'rows'->0->>'reply_to' is null)::text$q$, :'cr2'), 'true');
select v62_test.wipe();
select v62_test.nocfg(:'sel1');
select v62_test.mk('staff_invitation', :'SA', null, null, 'queued', 'newstaff@example.invalid', 'i-1') as i1 \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'keepbody@example.invalid', 'i-2') as i2 \gset
select public.email_worker_claim('wk-I', 10, 120, 30, 1500) as ci \gset
select public.email_worker_mark_sending(:'i1', 'wk-I');
select public.email_worker_mark_sending(:'i2', 'wk-I');
select v62_test.val('W41 a sent staff-invitation loses its body (it held a one-time link); a sent selection e-mail keeps it', format($q$select (public.email_worker_finish('%s', 'wk-I', 'sent', null, null, null, 'gm-i1')->>'ok') || '/' || (public.email_worker_finish('%s', 'wk-I', 'sent', null, null, null, 'gm-i2')->>'ok') || '/' || (v62_test.ob('%s', 'body_html') is null)::text || '/' || (v62_test.ob('%s', 'body_html') is not null)::text$q$, :'i1', :'i2', :'i1', :'i2'), 'true/true/true/true');
select v62_test.val('W42 the staff invitation was claimed from the system sender (startups@) with no project / node', format($q$select (r->>'project_id' is null)::text || '/' || (r->'sender'->>'source') from (select jsonb_array_elements('%s'::jsonb->'rows') r) x where r->>'id' = '%s'$q$, :'ci', :'i1'), 'true/system');
select v62_test.fails('W43 claim(NULL worker)', $q$select public.email_worker_claim(null)$q$, '22023', 'email_invalid');
select v62_test.fails('W44 claim(a worker id with spaces / injection characters)', $q$select public.email_worker_claim('a b; drop table x')$q$, '22023', 'email_invalid');
select v62_test.val('W45 claim(NULL limit / lease / quota) uses the defaults; absurd values are clamped (no error)', $q$select (public.email_worker_claim('wk-Clamp', null, null, null, null)->>'claimed') || '/' || (public.email_worker_claim('wk-Clamp', -5, 0, 0, 999999)->>'claimed')$q$, '0/0');
select v62_test.okrun('W46 heartbeat stores the last run', $q$select public.email_worker_heartbeat('wk-H', '{"sent": 3}'::jsonb)$q$);
select v62_test.okrun('W46a a garbage worker id / NULL summary are ignored, never an error', $q$select public.email_worker_heartbeat('bad id!', '{}'::jsonb), public.email_worker_heartbeat(null, null), public.email_worker_heartbeat('wk-H2', null)$q$);
reset role;
select v62_test.val('W46b ... and the heartbeat row is there (the last valid call wins: a NULL summary becomes an empty object)', $q$select last_worker || '/' || jsonb_typeof(summary) || '/' || (select count(*) from app_private.worker_heartbeat) from app_private.worker_heartbeat where name = 'email-worker'$q$, 'wk-H2/object/1');
select v62_test.val('W47 NO audit row of the whole worker section contains a subject, a body or an address', $q$select count(*)::text from app_private.email_log where detail ~* '(subject|body|@example|<p>)' or recipient_masked !~ '^[^*]\*\*\*@'$q$, '0');
select v62_test.wipe();

-- ================================================================= P. the Outbox RPCs for people (as authenticated)
-- a mixed project: sent, failed, needs_review, queued, blocked, cancelled, sending in P1; a row in P2; a staff-invitation row (no project)
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'sent', 'sent1@example.invalid', 'p-sent') as ps \gset
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'failed', 'failed1@example.invalid', 'p-failed') as pf \gset
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'needs_review', 'review1@example.invalid', 'p-review') as pr \gset
select v62_test.mk('rejection', :'PM1', :'p1', :'sel1', 'queued', 'queued1@example.invalid', 'p-queued') as pq \gset
select v62_test.mk('rejection', :'PM1', :'p1', :'sel1', 'queued', 'blocked1@example.invalid', 'p-blocked') as pb \gset
update app_private.email_outbox set blocked_reason = 'no_sender', next_attempt_at = now() + interval '5 minutes' where id = :'pb';
select v62_test.mk('rejection', :'PM1', :'p1', :'sel1', 'cancelled', 'cancelled1@example.invalid', 'p-cancelled') as pc \gset
select v62_test.mk('booking_confirmation', null, :'p1', :'bk1', 'sent', 'booker@example.invalid', 'p-booking') as pbk \gset
select v62_test.mk('acceptance', :'PM2', :'p2', :'sel2', 'failed', 'other-project@example.invalid', 'p-other') as po \gset
select v62_test.mk('staff_invitation', :'SA', null, null, 'queued', 'invitee@example.invalid', 'p-invite') as pi \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'sending-now@example.invalid', 'p-sending') as psn \gset
update app_private.email_outbox set status = 'sending', locked_by = 'wk-P', locked_until = now() + interval '1 minute' where id = :'psn';
update app_private.email_outbox set subject = 'دعوة لمقابلة', error_code = 'rejected_by_gmail' where id = :'pf';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e621","role":"authenticated"}', true);
set local role authenticated;
select v62_test.val('P01 PM1 lists P1: the 8 project rows (no row of P2, none without a project), counts by state', format($q$select (l->>'total') || '/' || (l->'counts'->>'sent') || '/' || (l->'counts'->>'failed') || '/' || (l->'counts'->>'needs_review') || '/' || (l->'counts'->>'queued') || '/' || (l->'counts'->>'blocked') || '/' || (l->'counts'->>'cancelled') || '/' || (l->'counts'->>'sending')
  from (select public.list_email_outbox('%s') l) x$q$, :'p1'), '8/2/1/1/1/1/1/1');
select v62_test.val('P02 the rows carry the node name, the state, the error code and NO body', format($q$select (r->'node_name'->>'en') || '/' || (r->>'state') || '/' || (r->>'error_code') || '/' || (r ? 'body_html')::text || '/' || (r->>'subject') from jsonb_array_elements(public.list_email_outbox('%s', array['failed'])->'rows') r$q$, :'p1'), 'V62 Stage 1/failed/rejected_by_gmail/false/دعوة لمقابلة');
select v62_test.val('P03 the blocked row shows as `blocked` with its reason', format($q$select (r->>'state') || '/' || (r->>'blocked_reason') from jsonb_array_elements(public.list_email_outbox('%s', array['blocked'])->'rows') r$q$, :'p1'), 'blocked/no_sender');
select v62_test.val('P04 filters: by node, by search (recipient and subject), pagination, total independent of the page, limit clamped', format($q$select (public.list_email_outbox('%s', null, '%s')->>'total') || '/' || (public.list_email_outbox('%s', null, null, 'REVIEW1')->>'total') || '/' || (public.list_email_outbox('%s', null, null, 'دعوة')->>'total')
  || '/' || jsonb_array_length(public.list_email_outbox('%s', null, null, null, 3, 0)->'rows') || '/' || (public.list_email_outbox('%s', null, null, null, 3, 3)->>'total') || '/' || jsonb_array_length(public.list_email_outbox('%s', null, null, null, 500, 0)->'rows')$q$, :'p1', :'bk1', :'p1', :'p1', :'p1', :'p1', :'p1'), '1/1/1/3/8/8');
select v62_test.val('P04b a search with LIKE wildcards is literal (a % or _ matches nothing)', format($q$select (public.list_email_outbox('%s', null, null, '%%')->>'total') || '/' || (public.list_email_outbox('%s', null, null, '_')->>'total')$q$, :'p1', :'p1'), '0/0');
select v62_test.fails('P05 PM1 cannot list the project he does not manage', format($q$select public.list_email_outbox('%s')$q$, :'p2'), '42501', 'forbidden');
select v62_test.fails('P05b NULL project', $q$select public.list_email_outbox(null)$q$, '42501', 'forbidden');
select v62_test.fails('P06 get_email_outbox_item of another project is refused', format($q$select public.get_email_outbox_item('%s')$q$, :'po'), '42501', 'forbidden');
select v62_test.fails('P06b a staff invitation row (no project): super_admin only', format($q$select public.get_email_outbox_item('%s')$q$, :'pi'), '42501', 'forbidden');
select v62_test.fails('P06c unknown id', $q$select public.get_email_outbox_item(gen_random_uuid())$q$, '42501', 'forbidden');
select v62_test.fails('P06d NULL id', $q$select public.get_email_outbox_item(null)$q$, '42501', 'forbidden');
select v62_test.val('P07 PM1 reads his own row in full: subject, rendered body, the timeline', format($q$select (i->>'subject') || '/' || ((i->>'body_html') like '<p>Body p-failed%%')::text || '/' || jsonb_typeof(i->'events') from (select public.get_email_outbox_item('%s') i) x$q$, :'pf'), 'دعوة لمقابلة/true/array');
select v62_test.val('P08 counts: per state, per node, and the attention number (failed + needs_review + blocked)', format($q$select (c->'counts'->>'failed') || '/' || (c->>'attention') || '/' || (c->'by_node'->'%s'->>'sent') || '/' || (c->'by_node'->'%s'->>'sent') from (select public.get_email_outbox_counts('%s') c) x$q$, :'sel1', :'bk1', :'p1'), '1/3/1/1');
select v62_test.fails('P08b counts of another project', format($q$select public.get_email_outbox_counts('%s')$q$, :'p2'), '42501', 'forbidden');
select v62_test.val('P09 retry: the failed row is queued again; a sent row, a staff-invitation row and the other project''s row are SKIPPED', format($q$select (r->>'requested') || '/' || (r->>'updated') || '/' || (r->>'skipped') from (select public.email_outbox_retry(array['%s','%s','%s','%s']::uuid[]) r) x$q$, :'pf', :'ps', :'pi', :'po'), '4/1/3');
select v62_test.val('P10 ... and what it did: queued, due now, error cleared, resolution manual_retry, one audit row', format($q$select v62_test.ob('%s', 'status') || '/' || (v62_test.ob('%s', 'next_attempt_at')::timestamptz <= now())::text || '/' || coalesce(v62_test.ob('%s', 'error_code'), 'NULL') || '/' || v62_test.ob('%s', 'resolution') || '/' || v62_test.nlog('%s', 'manual_retry')$q$, :'pf', :'pf', :'pf', :'pf', :'pf'), 'queued/true/NULL/manual_retry/1');
select v62_test.val('P11 a blocked row can be retried (reason cleared); a SENDING row cannot', format($q$select (public.email_outbox_retry(array['%s'::uuid])->>'updated') || '/' || coalesce(v62_test.ob('%s', 'blocked_reason'), 'NULL') || '/' || (public.email_outbox_retry(array['%s'::uuid])->>'updated')$q$, :'pb', :'pb', :'psn'), '1/NULL/0');
select v62_test.val('P12 mark_sent: only needs_review / failed rows: the review row becomes sent (manual_sent, who); a queued row is skipped', format($q$select (public.email_outbox_mark_sent(array['%s'::uuid, '%s'::uuid])->>'updated') || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'resolution') || '/' || (v62_test.ob('%s', 'resolved_by') = '%s')::text$q$, :'pr', :'pq', :'pr', :'pr', :'pr', :'PM1'), '1/sent/manual_sent/true');
select v62_test.fails('P13 and a manually sent row is final (sent is terminal)', format($q$select v62_test.setstatus('%s', 'queued')$q$, :'pr'), '22023', 'email_invalid');
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'needs_review', 'review2@example.invalid', 'p-review2') as pr2 \gset
select v62_test.val('P14 resend: only needs_review -> queued (a NEW request, resolution manual_resend); a failed / sent / queued row is skipped', format($q$select (public.email_outbox_resend(array['%s'::uuid, '%s'::uuid, '%s'::uuid])->>'updated') || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'resolution') || '/' || v62_test.nlog('%s', 'manual_resend')$q$, :'pr2', :'ps', :'pf', :'pr2', :'pr2', :'pr2'), '1/queued/manual_resend/1');
select v62_test.mk('interview', :'PM1', :'p1', :'sel1', 'needs_review', 'review3@example.invalid', 'p-review3') as pr3 \gset
select v62_test.val('P15 cancel: a needs_review row and a queued row are cancelled; a SENT row and a SENDING row are not', format($q$select (public.email_outbox_cancel(array['%s'::uuid, '%s'::uuid, '%s'::uuid, '%s'::uuid])->>'updated') || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'status') || '/' || v62_test.ob('%s', 'resolution')$q$, :'pr3', :'pq', :'ps', :'psn', :'pr3', :'pq', :'pr3'), '2/cancelled/cancelled/manual_cancel');
select v62_test.val('P16 bulk: 500 ids are accepted; NULL / empty are no-ops', $q$select (public.email_outbox_retry(array_fill(gen_random_uuid(), array[500]))->>'updated') || '/' || (public.email_outbox_retry(null)->>'requested') || '/' || (public.email_outbox_cancel('{}')->>'requested') || '/' || (public.email_outbox_mark_sent(null)->>'updated') || '/' || (public.email_outbox_resend('{}')->>'updated')$q$, '0/0/0/0/0');
select v62_test.fails('P16b 501 ids (retry)', $q$select public.email_outbox_retry(array_fill(gen_random_uuid(), array[501]))$q$, '22023', 'email_invalid');
select v62_test.fails('P16c 501 ids (cancel)', $q$select public.email_outbox_cancel(array_fill(gen_random_uuid(), array[501]))$q$, '22023', 'email_invalid');
select v62_test.fails('P16d 501 ids (mark_sent)', $q$select public.email_outbox_mark_sent(array_fill(gen_random_uuid(), array[501]))$q$, '22023', 'email_invalid');
select v62_test.fails('P16e 501 ids (resend)', $q$select public.email_outbox_resend(array_fill(gen_random_uuid(), array[501]))$q$, '22023', 'email_invalid');
select v62_test.val('P17 send_now: nothing waiting; the scheduler is off so nothing is kicked', format($q$select (r->>'released') || '/' || (r->>'kicked') from (select public.email_outbox_send_now('%s') r) x$q$, :'p1'), '0/false');
select v62_test.fails('P17b send_now on another project', format($q$select public.email_outbox_send_now('%s')$q$, :'p2'), '42501', 'forbidden');
select v62_test.fails('P17c send_now(NULL)', $q$select public.email_outbox_send_now(null)$q$, '42501', 'forbidden');
select v62_test.fails('P18 a project manager is not an administrator: the health panel is super_admin only', $q$select public.get_email_health()$q$, '42501', 'forbidden');
select v62_test.fails('P18b nor the staff-invitation delivery list', $q$select public.list_staff_invitation_delivery()$q$, '42501', 'forbidden');
-- another PM
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e622","role":"authenticated"}', true);
select v62_test.val('P19 PM2 sees exactly his project''s one row, and cannot touch PM1''s rows (skipped, unchanged)', format($q$select (public.list_email_outbox('%s')->>'total') || '/' || (public.email_outbox_cancel(array['%s'::uuid])->>'updated') || '/' || v62_test.ob('%s', 'status')$q$, :'p2', :'pr2', :'pr2'), '1/0/queued');
select v62_test.fails('P19b PM2 cannot list P1', format($q$select public.list_email_outbox('%s')$q$, :'p1'), '42501', 'forbidden');
-- a founder and a user without a role
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e623","role":"authenticated"}', true);
select v62_test.fails('P20 a FOUNDER: list', format($q$select public.list_email_outbox('%s')$q$, :'p1'), '42501', 'forbidden');
select v62_test.fails('P20b a founder: item', format($q$select public.get_email_outbox_item('%s')$q$, :'pf'), '42501', 'forbidden');
select v62_test.fails('P20c a founder: counts', format($q$select public.get_email_outbox_counts('%s')$q$, :'p1'), '42501', 'forbidden');
select v62_test.fails('P20d a founder: send_now', format($q$select public.email_outbox_send_now('%s')$q$, :'p1'), '42501', 'forbidden');
select v62_test.fails('P20e a founder: health', $q$select public.get_email_health()$q$, '42501', 'forbidden');
select v62_test.val('P20f a founder: the actions change nothing (every row skipped)', format($q$select (public.email_outbox_retry(array['%s'::uuid])->>'updated') || '/' || (public.email_outbox_cancel(array['%s'::uuid])->>'updated') || '/' || (public.email_outbox_mark_sent(array['%s'::uuid])->>'updated') || '/' || (public.email_outbox_resend(array['%s'::uuid])->>'updated')$q$, :'pf', :'pf', :'pf', :'pf'), '0/0/0/0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e624","role":"authenticated"}', true);
select v62_test.fails('P21 a user with no role: list', format($q$select public.list_email_outbox('%s')$q$, :'p1'), '42501', 'forbidden');
select v62_test.fails('P21b no role: health', $q$select public.get_email_health()$q$, '42501', 'forbidden');
select v62_test.fails('P21c no role: delivery', $q$select public.list_staff_invitation_delivery()$q$, '42501', 'forbidden');
-- super_admin: everything, including the staff invitation rows
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e620","role":"authenticated"}', true);
select v62_test.val('P22 super_admin lists any project, reads a staff-invitation row and cancels it', format($q$select (public.list_email_outbox('%s')->>'total') || '/' || (public.get_email_outbox_item('%s')->>'recipient') || '/' || (public.email_outbox_cancel(array['%s'::uuid])->>'updated')$q$, :'p2', :'pi', :'pi'), '1/invitee@example.invalid/1');
select v62_test.val('P23 the health panel: queue depth, oldest, blocked by reason, senders (with their quota counters), the worker heartbeat, the scheduler state', $q$select (h->'queue' ? 'depth')::text || '/' || (h->'queue' ? 'oldest_age_seconds')::text || '/' || (h ? 'blocked_by_reason')::text || '/' || jsonb_typeof(h->'senders') || '/' || (h->'worker' ? 'scheduler_enabled')::text
  || '/' || ((select count(*) from jsonb_array_elements(h->'senders') s where s ? 'started_1m' and s ? 'started_24h' and s ? 'queued')) from (select public.get_email_health() h) x$q$, 'true/true/true/array/true/3');
select v62_test.val('P24 the health numbers: the system sender is listed with its kind; the queue counts are consistent with the rows', $q$select ((select count(*) from jsonb_array_elements(public.get_email_health()->'senders') s where s->>'kind' = 'system' and s->>'email' = 'zz-v62-startups@athareg.com') = 1)::text
  || '/' || ((public.get_email_health()->'queue'->>'depth')::int = v62_test.cnt($w$status = 'queued'$w$))::text || '/' || ((public.get_email_health()->'queue'->>'sending')::int = v62_test.cnt($w$status = 'sending'$w$))::text$q$, 'true/true/true');
reset role;
-- an invitation through the REAL producer, then the delivery list
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e620","role":"authenticated"}', true);
set local role authenticated;
select (public.create_staff_invitation('zz-v62-invitee@example.invalid', array['project_manager'], '{}', 'en', 'http://127.0.0.1:5174')->>'id') as inv \gset
select v62_test.val('P26 create_staff_invitation queues an outbox row and the delivery list shows it as queued with no sender yet', format($q$select (d->>'state') || '/' || (d->>'status') || '/' || coalesce(d->>'sender_email', 'NULL') || '/' || (d->>'attempts') from jsonb_array_elements(public.list_staff_invitation_delivery()) d where d->>'invitation_id' = '%s'$q$, :'inv'), 'queued/queued/NULL/0');
select v62_test.okrun('P27a revoking the invitation', format($q$select public.revoke_staff_invitation('%s')$q$, :'inv'));
select v62_test.val('P27 ... cancels its row (the m24 path through the new state guard), and the delivery list says cancelled', format($q$select d->>'state' from jsonb_array_elements(public.list_staff_invitation_delivery()) d where d->>'invitation_id' = '%s'$q$, :'inv'), 'cancelled');
reset role;
select v62_test.val('P28 every manual action wrote an audit row with the ACTOR (PM1: retry x2, mark_sent, resend, cancel x2)', format($q$select v62_test.nlogs($w$actor = '%s' and event like 'manual\_%%'$w$)::text$q$, :'PM1'), '6');
select v62_test.val('P29 the audit rows of manual actions carry the masked recipient and no body', $q$select v62_test.nlogs($w$event like 'manual\_%' and (recipient_masked is null or detail ~* '(subject|body|<p>)')$w$)::text$q$, '0');

-- ================================================================= H. hardening
select v62_test.val('H01 all 17 public functions of m62 are SECURITY DEFINER with an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
  'email_worker_claim','email_worker_mark_sending','email_worker_finish','email_worker_heartbeat','claim_email_batch','complete_email','fail_email','list_email_outbox','get_email_outbox_item','get_email_outbox_counts',
  'email_outbox_retry','email_outbox_cancel','email_outbox_mark_sent','email_outbox_resend','email_outbox_send_now','get_email_health','list_staff_invitation_delivery') and p.prosecdef and 'search_path=""' = any(p.proconfig)$q$, '17');
select v62_test.val('H02 anon can execute NONE of the m62 functions (proved by privilege, never by calling them)', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.proname in ('email_worker_claim','email_worker_mark_sending','email_worker_finish','email_worker_heartbeat','list_email_outbox','get_email_outbox_item','get_email_outbox_counts','email_outbox_retry','email_outbox_cancel','email_outbox_mark_sent','email_outbox_resend','email_outbox_send_now','get_email_health','list_staff_invitation_delivery','email_kick_worker','email_pick_sender','email_log_add')$q$, '0');
select v62_test.val('H03 no client role can execute a worker RPC, a shim or a helper', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and p.proname in ('email_worker_claim','email_worker_mark_sending','email_worker_finish','email_worker_heartbeat','claim_email_batch','complete_email','fail_email','email_kick_worker','email_pick_sender','email_log_add','email_worker_enable')$q$, '0');
select v62_test.val('H04 the existing producers keep their grants: enqueue_email is for authenticated, not for anon', $q$select (has_function_privilege('authenticated', 'public.enqueue_email(uuid,text,uuid[],integer,boolean)', 'EXECUTE'))::text || '/' || (has_function_privilege('anon', 'public.enqueue_email(uuid,text,uuid[],integer,boolean)', 'EXECUTE'))::text$q$, 'true/false');

-- ================================================================= K. scheduler plumbing (inside the rolled-back transaction: nothing is really scheduled, nothing is really sent)
select v62_test.val('K01 email_kick_worker is a no-op while the scheduler is not enabled', $q$select coalesce((select app_private.email_kick_worker()::text), 'NULL')$q$, 'NULL');
select v62_test.fails('K02 enable refuses a bad URL', $q$select app_private.email_worker_enable('ftp://x', repeat('s', 32))$q$, '22023', 'email_invalid');
select v62_test.fails('K03 enable refuses a short secret', $q$select app_private.email_worker_enable('http://kong:8000/functions/v1', 'short')$q$, '22023', 'email_invalid');
select v62_test.fails('K04 enable refuses a NULL URL / NULL secret', $q$select app_private.email_worker_enable(null, null)$q$, '22023', 'email_invalid');
select app_private.email_worker_enable('http://kong:8000/functions/v1/', repeat('s', 32)) as en1 \gset
select v62_test.val('K05 enable: settings + the secret in Vault + two cron jobs; the status never shows the secret', format($q$select (s->>'enabled') || '/' || (s->>'secret_set') || '/' || jsonb_array_length(s->'cron_jobs') || '/' || (s::text like '%%' || repeat('s', 32) || '%%')::text || '/' || (s->>'functions_base_url') from (select '%s'::jsonb s) x$q$, :'en1'), 'true/true/2/false/http://kong:8000/functions/v1');
select v62_test.val('K06 the cron job runs every minute and calls only the kick function', $q$select schedule || '/' || command from cron.job where jobname = 'athar-email-worker'$q$, '* * * * */select app_private.email_kick_worker()');
select v62_test.val('K06b the maintenance job runs nightly', $q$select schedule || '/' || command from cron.job where jobname = 'athar-email-maintenance'$q$, '23 3 * * */select app_private.email_maintenance()');
select v62_test.val('K07 the secret is in Vault ENCRYPTED (vault.secrets does not hold it in clear)', $q$select ((select count(*) from vault.secrets where name = 'athar-email-worker-secret') = 1 and (select secret from vault.secrets where name = 'athar-email-worker-secret') <> repeat('s', 32))::text$q$, 'true');
select v62_test.val('K08 the kick posts to <base>/email-worker through pg_net (a request id comes back) and a second kick within 4 s is throttled', $q$select (app_private.email_kick_worker() is not null)::text || '/' || (app_private.email_kick_worker() is null)::text$q$, 'true/true');
select v62_test.val('K09 re-running enable keeps ONE secret and two jobs (idempotent)', $q$select (app_private.email_worker_enable('http://kong:8000/functions/v1', repeat('t', 32)) is not null)::text || '/' || (select count(*) from vault.secrets where name = 'athar-email-worker-secret') || '/' || (select count(*) from cron.job where jobname like 'athar-email-%')$q$, 'true/1/2');
update app_private.worker_settings set updated_at = now() - interval '1 minute' where key = 'last_kick_at';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e621","role":"authenticated"}', true);
set local role authenticated;
select v62_test.val('K10 "Send now" kicks the worker when something is queued (the PM RPC reports kicked)', format($q$select (r->>'queued')::int > 0 and (r->>'kicked') = 'true' from (select public.email_outbox_send_now('%s') r) x$q$, :'p1'), 'true');
reset role;
update app_private.worker_settings set updated_at = now() - interval '1 minute' where key = 'last_kick_at';
select app_private.email_worker_disable() as ds \gset
select v62_test.val('K11 disable: no cron job, no Vault secret, no settings; the status says so and the kick is a no-op again', format($q$select (s->>'enabled') || '/' || (s->>'secret_set') || '/' || jsonb_array_length(s->'cron_jobs') || '/' || (select count(*) from app_private.worker_settings) || '/' || coalesce((select app_private.email_kick_worker()::text), 'NULL') from (select '%s'::jsonb s) x$q$, :'ds'), 'false/false/0/0/NULL');
select v62_test.wipe();
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'sent', 'old@example.invalid', 'k-old') as k1 \gset
select v62_test.mk('acceptance', :'PM1', :'p1', :'sel1', 'queued', 'oldq@example.invalid', 'k-oldq') as k2 \gset
update app_private.email_outbox set created_at = now() - interval '100 days' where id in (:'k1', :'k2');
select app_private.email_maintenance() as mt \gset
select v62_test.val('K12 maintenance: the old SENT row loses subject and body, the old QUEUED row keeps them', format($q$select (m->>'pruned') || '/' || (v62_test.ob('%s', 'subject') is null and v62_test.ob('%s', 'body_html') is null)::text || '/' || (v62_test.ob('%s', 'subject') is not null)::text from (select '%s'::jsonb m) x$q$, :'k1', :'k1', :'k2', :'mt'), '1/true/true');

-- ================================================================= final state check
select current_setting('v62.res', true) as res \gset
rollback;

-- the committed state is exactly what it was before the transaction
select (select count(*) from app_private.email_outbox) as ob1, (select count(*) from app_private.email_log) as lg1, (select count(*) from app_private.google_connections) as gc1,
       (select count(*) from app_private.worker_settings) as ws1, (select count(*) from app_private.worker_heartbeat) as hb1,
       (select count(*) from vault.secrets where name = 'athar-email-worker-secret') as vs1, (select count(*) from cron.job where jobname like 'athar-email-%') as cj1,
       (select count(*) from auth.users where email like 'zz-v62-%') as us1 \gset
select (:ob0 = :ob1 and :lg0 = :lg1 and :gc0 = :gc1 and :ws0 = :ws1 and :hb0 = :hb1 and :vs0 = :vs1 and :cj0 = :cj1 and :us0 = :us1) as baseline_restored \gset
select :'baseline_restored' as baseline_restored;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or :'baseline_restored' <> 't') as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v62: e-mail worker tests FAILED'; end $$;
\endif
