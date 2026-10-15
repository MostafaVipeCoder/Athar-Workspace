-- v60_alumni_edit_history  (m60: the manager edits every alumni field, the invited founder completes his own data, the needs-attention queue, the history of every edit)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
--
-- Fixture (ids ...00000000e60x users / c60x companies / f60x founders):
--   ADM = super_admin (e600), AM = alumni_manager (e601), PM = project_manager (e602), F1 = founder of CO1 (e603), F2 = founder of CO2 (e604)
--   CO1 Nile (F1), CO2 Delta (F2), CO3 Empty (nobody), CO4 Invited (manager-made, partial, a CEO record with an e-mail, an invitation), CO7 Timeline (as-of tests)
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute crashes this local Postgres image):
-- helpers are called as the owner, denials are asserted with has_function_privilege / has_column_privilege.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v60.res', '', false) \gset

begin;
create schema v60_test;
grant usage on schema v60_test to public;
create or replace function v60_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v60.res', current_setting('v60.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v60_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v60_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v60_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v60_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v60_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v60_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v60_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v60_test.t(p_key, true, 'ok');
  exception when others then
    perform v60_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
create or replace function v60_test.err_detail(p_sql text) returns text language plpgsql as $$
declare v_detail text;
begin
  begin execute p_sql; return 'no error';
  exception when others then get stacked diagnostics v_detail = pg_exception_detail; return v_detail; end;
end $$;
create or replace function v60_test.bump(p_table text, p_where text) returns void language plpgsql security definer as $$
begin
  if p_table = 'founders' then alter table public.founders disable trigger founders_bu_touch;
  elsif p_table = 'companies' then alter table public.companies disable trigger companies_bu_touch; end if;
  execute format('update public.%I set updated_at = clock_timestamp() where %s', p_table, p_where);
  if p_table = 'founders' then alter table public.founders enable trigger founders_bu_touch;
  elsif p_table = 'companies' then alter table public.companies enable trigger companies_bu_touch; end if;
end $$;
create or replace function v60_test.bump_snapshot(p_company uuid, p_year integer) returns void language plpgsql security definer as $$
begin
  update public.company_snapshots set updated_at = clock_timestamp() where company_id = p_company and snapshot_type = 'annual' and period_year = p_year;
end $$;
-- the time machine: remember the flat state of a company with its time, to compare with the replayed state later
create table v60_test.snap (label text primary key, t timestamptz not null, st jsonb not null);
grant select on v60_test.snap to public;
create or replace function v60_test.mark(p_label text, p_company uuid) returns void language plpgsql security definer as $$
begin
  perform pg_sleep(0.003);
  insert into v60_test.snap (label, t, st) values (p_label, clock_timestamp(), app_private.alumni_state_flat(p_company, clock_timestamp()));
  perform pg_sleep(0.003);
end $$;
revoke all on all functions in schema v60_test from public;
grant execute on all functions in schema v60_test to anon, authenticated, service_role;

-- ================================================================= C. catalog (as postgres)
select v60_test.val('C01 the log table: RLS enabled and forced', $q$select concat_ws('|', c.relrowsecurity::text, c.relforcerowsecurity::text) from pg_class c where c.oid = 'public.alumni_change_log'::regclass$q$, 'true|true');
select v60_test.val('C02 no API role can INSERT / UPDATE / DELETE / TRUNCATE the log, anon reads nothing', $q$select concat_ws('|', has_table_privilege('authenticated', 'public.alumni_change_log', 'INSERT')::text, has_table_privilege('authenticated', 'public.alumni_change_log', 'UPDATE')::text,
  has_table_privilege('authenticated', 'public.alumni_change_log', 'DELETE')::text, has_table_privilege('authenticated', 'public.alumni_change_log', 'TRUNCATE')::text, has_any_column_privilege('anon', 'public.alumni_change_log', 'SELECT')::text,
  has_table_privilege('service_role', 'public.alumni_change_log', 'UPDATE')::text)$q$, 'false|false|false|false|false|false');
select v60_test.val('C03 authenticated may SELECT 15 safe columns only: NOT the actor id, the reason or the request id', $q$select concat_ws('|', (select count(*) from information_schema.column_privileges g where g.table_name = 'alumni_change_log' and g.table_schema = 'public' and g.grantee = 'authenticated' and g.privilege_type = 'SELECT')::text,
  has_column_privilege('authenticated', 'public.alumni_change_log', 'actor_user_id', 'SELECT')::text, has_column_privilege('authenticated', 'public.alumni_change_log', 'reason', 'SELECT')::text,
  has_column_privilege('authenticated', 'public.alumni_change_log', 'request_id', 'SELECT')::text, has_column_privilege('authenticated', 'public.alumni_change_log', 'new_value', 'SELECT')::text)$q$, '15|false|false|false|true');
select v60_test.val('C04 the two immutability triggers + the nine logging triggers + the five stamp triggers exist', $q$select concat_ws('|',
  (select count(*) from pg_trigger t where t.tgrelid = 'public.alumni_change_log'::regclass and not t.tgisinternal)::text,
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_ai_alumni_log', 'companies_au_alumni_log', 'companies_ad_alumni_log', 'company_internal_aiud_alumni_log', 'founders_ai_alumni_log', 'founders_au_alumni_log', 'founder_identities_aiud_alumni_log', 'company_founders_aiud_alumni_log', 'company_snapshots_aiud_alumni_log'))::text,
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_biu_stamp', 'founders_biu_stamp', 'company_founders_biu_stamp', 'company_internal_biu_stamp', 'founder_identities_biu_stamp'))::text)$q$, '2|9|5');
select v60_test.val('C05 every logger / replay helper is closed to every API role', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('alumni_log_guard', 'alumni_actor', 'alumni_request_id', 'alumni_log_mask', 'alumni_log_fields', 'alumni_log_put', 'alumni_log_diff', 'alumni_log_companies', 'alumni_log_internal', 'alumni_log_founders', 'alumni_log_identities',
                    'alumni_log_team', 'alumni_log_snapshots', 'alumni_stamp_actor', 'alumni_stamp_source', 'alumni_state_current', 'alumni_state_flat', 'alumni_section_of', 'alumni_attention_catalog')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v60_test.val('C06 the new RPCs: SECURITY DEFINER, empty search_path, executable by authenticated and NOT by anon', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('alumni_state_as_of', 'alumni_state_diff', 'list_alumni_history', 'get_alumni_stamps', 'review_company_snapshot', 'list_alumni_attention', 'save_alumni_company', 'save_my_founder_profile', 'save_alumni_founder', 'upsert_company_snapshot')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '10');
select v60_test.val('C07 the four re-created signatures carry the concurrency token (and the reason); the old ones are gone (no overload: PostgREST would answer PGRST203)', $q$select concat_ws('|',
  (to_regprocedure('public.save_my_founder_profile(jsonb,timestamptz)') is not null)::text, (to_regprocedure('public.save_alumni_founder(uuid,jsonb,timestamptz,text)') is not null)::text,
  (to_regprocedure('public.upsert_company_snapshot(uuid,integer,jsonb,timestamptz,text)') is not null)::text, (to_regprocedure('public.save_alumni_company(uuid,jsonb,timestamptz,text)') is not null)::text,
  (to_regprocedure('public.save_my_founder_profile(jsonb)') is null)::text, (to_regprocedure('public.save_alumni_founder(uuid,jsonb)') is null)::text,
  (to_regprocedure('public.upsert_company_snapshot(uuid,integer,jsonb)') is null)::text, (to_regprocedure('public.save_alumni_company(uuid,jsonb,timestamptz)') is null)::text)$q$, 'true|true|true|true|true|true|true|true');
select v60_test.val('C08 NO function of public / app_private raises SQLSTATE 40001 or 40P01 (PostgREST 14 retries those for ever)', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ~* 'errcode\s*=\s*''(40001|40P01)'''$q$, '0');
select v60_test.val('C09 the log epoch exists (one row) and is in the past', $q$select (count(*) = 1 and min(started_at) <= clock_timestamp())::text from app_private.alumni_log_epoch$q$, 'true');
select v60_test.val('C10 the indexes of the per-company / per-founder timelines, the entity lookup, the global feed and the actor exist', $q$select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'alumni_change_log'
  and indexname in ('alumni_change_log_pkey', 'alumni_change_log_company_idx', 'alumni_change_log_founder_idx', 'alumni_change_log_entity_idx', 'alumni_change_log_at_idx', 'alumni_change_log_actor_idx')$q$, '6');
select v60_test.val('C11 the m41 / m45 column scanners (image path rewrite, dangling references) skip the immutable log', $q$select ((pg_get_functiondef('app_private.rewrite_storage_refs(text,text)'::regprocedure) like '%table_name <> ''alumni_change_log''%')
  and (pg_get_functiondef('app_private.storage_dangling_refs()'::regprocedure) like '%table_name <> ''alumni_change_log''%'))::text$q$, 'true');
select v60_test.val('C12 every editable row carries who / when: updated_by + updated_source on companies, founders, company_founders, company_internal, founder_identities (10 columns), reviewed_at / reviewed_by on the yearly rows', $q$select concat_ws('|',
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name in ('updated_by', 'updated_source') and table_name in ('companies', 'founders', 'company_founders', 'company_internal', 'founder_identities'))::text,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'company_founders' and column_name = 'updated_at')::text,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'company_snapshots' and column_name in ('reviewed_at', 'reviewed_by'))::text)$q$, '10|1|2');
select v60_test.val('C13 the log is born empty of migrated data: the log holds no row for the 141 migrated companies (nothing was edited by the migration)', $q$select count(*)::text from public.alumni_change_log l where l.entity_type = 'company' and l.entity_id in (select id from public.companies where created_at < now() - interval '1 day') and l.at < clock_timestamp() - interval '1 hour'$q$, '0');
select v60_test.val('C14 the stage-1 hardening is intact: handle_new_user and founders_self_guard are definer functions closed to API roles', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname in ('handle_new_user', 'founders_self_guard') and p.prosecdef
  and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '2');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e600','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-adm@example.invalid','{"provisioned":true}','{"full_name":"V60 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e601','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-am@example.invalid','{"provisioned":true}','{"full_name":"V60 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e602','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-pm@example.invalid','{"provisioned":true}','{"full_name":"V60 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e603','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-f1@example.invalid','{"provisioned":true}','{"full_name":"V60 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e604','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-f2@example.invalid','{"provisioned":true}','{"full_name":"V60 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e605','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-ceo@example.invalid','{"provisioned":true}','{"full_name":"V60 CEO Account"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e609','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-norole@example.invalid','{"provisioned":true}','{"full_name":"V60 No Role"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e600','super_admin'), ('00000000-0000-4000-8000-00000000e601','alumni_manager'), ('00000000-0000-4000-8000-00000000e602','project_manager'),
  ('00000000-0000-4000-8000-00000000e603','founder'), ('00000000-0000-4000-8000-00000000e604','founder'), ('00000000-0000-4000-8000-00000000e605','founder');
insert into public.companies (id, name_en, name_ar, created_by) values
  ('00000000-0000-4000-8000-00000000c601', 'V60 Nile Co', 'نيل V60', '00000000-0000-4000-8000-00000000e603'),
  ('00000000-0000-4000-8000-00000000c602', 'V60 Delta Co', null, '00000000-0000-4000-8000-00000000e604'),
  ('00000000-0000-4000-8000-00000000c603', 'V60 Empty Co', null, null);
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f601', 'V60 One', 'واحد', 'zz-v60-f1@example.invalid', '00000000-0000-4000-8000-00000000e603'),
  ('00000000-0000-4000-8000-00000000f602', 'V60 Two', 'اثنان', 'zz-v60-f2@example.invalid', '00000000-0000-4000-8000-00000000e604'),
  ('00000000-0000-4000-8000-00000000f605', 'V60 Ceo', 'سي', 'zz-v60-ceo@example.invalid', '00000000-0000-4000-8000-00000000e605');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c601', '00000000-0000-4000-8000-00000000f601', true),
  ('00000000-0000-4000-8000-00000000c602', '00000000-0000-4000-8000-00000000f602', true);

-- ================================================================= X. who is acting (unit tests of the actor rules, as postgres with a claim)
select set_config('request.jwt.claims', '', true);
select v60_test.val('X01 no JWT (a migration, the sign-up trigger, the service role) = system / system', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'system|system');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e600","role":"authenticated"}', true);
select v60_test.val('X02 super_admin = super_admin / manager', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'super_admin|manager');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
select v60_test.val('X03 alumni_manager = alumni_manager / manager', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'alumni_manager|manager');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e602","role":"authenticated"}', true);
select v60_test.val('X04 project_manager = project_manager / manager (the Lists-node path: staff, the Athar team)', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'project_manager|manager');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
select v60_test.val('X05 founder = founder / founder', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'founder|founder');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e609","role":"authenticated"}', true);
select v60_test.val('X06 an account with no role = user / system', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'user|system');
select set_config('app.alumni_source', 'import', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
select v60_test.val('X07 a bulk import marks a MANAGER as source import', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'alumni_manager|import');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
select v60_test.val('X08 ... and cannot make a FOUNDER an importer (the override is ignored)', $q$select actor_role || '|' || src from app_private.alumni_actor()$q$, 'founder|founder');
select set_config('app.alumni_source', '', true);
select set_config('request.jwt.claims', '', true);

-- ================================================================= L. every write path is logged
-- L01: a founder through the RPC
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select public.save_my_company_profile('00000000-0000-4000-8000-00000000c601', '{"description_en":"Desc one","sector":"technology"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('L01 a founder saves through save_my_company_profile: one entry per changed field, actor founder / founder, old null -> new', $q$select string_agg(l.field || ':' || l.source || ':' || l.actor_role || ':' || l.old_value::text || '>' || l.new_value::text, ',' order by l.field)
  from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.entity_type = 'company' and l.field in ('description_en', 'sector')$q$,
  'description_en:founder:founder:null>"Desc one",sector:founder:founder:null>"technology"');
select v60_test.val('L02 the entry knows the user and a request id', $q$select (l.actor_user_id = '00000000-0000-4000-8000-00000000e603' and l.request_id is not null)::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.field = 'sector'$q$, 'true');
-- L03: a manager through the RPC (alumni_manager and super_admin)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c601', '{"stage":"mvp","directory_visibility":"alumni"}'::jsonb, null, 'first review') is not null as ok \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e600","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c601', '{"startup_type":"startup"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('L03 an alumni_manager through save_alumni_company: source manager, actor alumni_manager, the optional reason recorded', $q$select l.source || ':' || l.actor_role || ':' || l.reason from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.field = 'stage'$q$, 'manager:alumni_manager:first review');
select v60_test.val('L04 a super_admin = actor super_admin (source manager), no reason = NULL', $q$select l.source || ':' || l.actor_role || ':' || coalesce(l.reason, 'null') from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.field = 'startup_type'$q$, 'manager:super_admin:null');
-- L05: the system (no JWT)
select set_config('request.jwt.claims', '', true);
update public.companies set description_ar = 'system text' where id = '00000000-0000-4000-8000-00000000c603';
select v60_test.val('L05 a write with no JWT (migration, service role) = system / system', $q$select l.source || ':' || l.actor_role from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c603' and l.field = 'description_ar'$q$, 'system:system');
-- L06: a DIRECT PostgREST-style write by a founder (column privileges + RLS) is logged too: nothing bypasses the trigger
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
update public.companies set description_ar = 'direct by founder' where id = '00000000-0000-4000-8000-00000000c601';
reset role;
select v60_test.val('L06 a founder UPDATE straight on the table (the path m52 guards but cannot forbid) is logged as founder', $q$select l.source || ':' || l.actor_role || ':' || l.new_value::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.field = 'description_ar'$q$, 'founder:founder:"direct by founder"');
select v60_test.val('L07 ... and the row says who / how: updated_source founder, updated_by the founder', $q$select (c.updated_source = 'founder' and c.updated_by = '00000000-0000-4000-8000-00000000e603')::text from public.companies c where c.id = '00000000-0000-4000-8000-00000000c601'$q$, 'true');
-- L08: yearly figures: founder then manager (two actors = two entries, the second one has the founder's value as old)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, '{"revenue_total": 100, "employees_total": 5}'::jsonb) is not null as ok \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, '{"revenue_total": 150}'::jsonb, null, 'corrected from the audited accounts') is not null as ok \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2023, '{"revenue_total": 50, "freelancers": 2}'::jsonb) is not null as ok \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
select v60_test.val('L08 yearly figures: the founder entry (null > 100) and the manager entry (100 > 150, with the reason) are two entries with the year as period key', $q$select string_agg(l.source || ':' || l.old_value::text || '>' || l.new_value::text || ':' || coalesce(l.reason, '-'), ' | ' order by l.id)
  from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.entity_type = 'snapshot' and l.period_key = '2024' and l.field = 'revenue_total'$q$, 'founder:null>100.00:- | manager:100.00>150.00:corrected from the audited accounts');
select v60_test.val('L09 yearly figures: the stamp of the row says manager (the last editor), the founder employees entry is untouched', $q$select (s.source = 'manager' and s.updated_by = '00000000-0000-4000-8000-00000000e601'
  and (select l.source from public.alumni_change_log l where l.company_id = s.company_id and l.period_key = '2024' and l.field = 'employees_total') = 'founder')::text
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c601' and s.period_year = 2024$q$, 'true');
-- L10: delete + review of a year, team, CEO
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.review_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024) is not null as ok \gset
select public.delete_company_snapshot('00000000-0000-4000-8000-00000000c601', 2023) is not null as ok \gset
select (public.save_company_team_member('00000000-0000-4000-8000-00000000c601', null, '{"name_en":"V60 Record","role":"CTO","self_gender":"female","phone":"+201012345679"}'::jsonb)->>'founder_id') as rec1 \gset
reset role;
select v60_test.val('L10 the review checkpoint is logged (reviewed_at set by a manager) and is NOT an edit: the row keeps source manager from the correction, the founder token does not move', $q$select (l.new_value is not null and l.old_value = 'null'::jsonb)::text from public.alumni_change_log l
  where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.period_key = '2024' and l.field = 'reviewed_at'$q$, 'true');
select v60_test.val('L11 deleting a year logs every non-null value as old > null (the values are kept in the history)', $q$select string_agg(l.field || ':' || l.old_value::text || '>' || l.new_value::text, ',' order by l.field) from public.alumni_change_log l
  where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.entity_type = 'snapshot' and l.period_key = '2023' and l.new_value = 'null'::jsonb$q$, 'freelancers:2>null,revenue_total:50.00>null');
select v60_test.val('L12 a team record: member entry (null > {role, is_primary}), the record founder created, its phone MASKED and flagged', format($q$select concat_ws('|',
  (select l.new_value::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c601' and l.entity_type = 'team' and l.field = 'member' and l.founder_id = %L),
  (select l.new_value::text || ':' || l.redacted::text from public.alumni_change_log l where l.entity_type = 'founder' and l.founder_id = %L and l.field = 'phone'))$q$, :'rec1', :'rec1'), '{"role": "CTO", "is_primary": false}|"+**********79":true');

-- ================================================================= P. PII minimisation
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_founder('00000000-0000-4000-8000-00000000f601', '{"phone":"+201012345678","email":"zz-v60-f1b@example.invalid","national_id":"29501010101236","bio_en":"my id is 29501010101239 ok"}'::jsonb, null, 'ref 30303152804527') is not null as ok \gset
reset role;
select v60_test.val('P01 the phone is stored MASKED (last two digits) and flagged; the e-mail too', $q$select string_agg(l.field || '=' || l.new_value::text || ':' || l.redacted::text, ',' order by l.field) from public.alumni_change_log l
  where l.founder_id = '00000000-0000-4000-8000-00000000f601' and l.field in ('phone', 'email')$q$, 'email="z***@example.invalid":true,phone="+**********78":true');
select v60_test.val('P02 the national ID is NEVER stored: the entry says an ID now exists (false > true), flagged, no number anywhere', $q$select l.old_value::text || '>' || l.new_value::text || ':' || l.redacted::text from public.alumni_change_log l
  where l.founder_id = '00000000-0000-4000-8000-00000000f601' and l.entity_type = 'identity' and l.field = 'national_id'$q$, 'false>true:true');
select v60_test.val('P03 not one row of the log contains an ID-shaped number (any column, as text)', $q$select count(*)::text from public.alumni_change_log l where l::text ~ '(^|[^0-9A-Za-z])[23][0-9]{13}([^0-9A-Za-z]|$)'$q$, '0');
select v60_test.val('P04 an ID typed into a free-text value (a bio) or a reason is REDACTED in the log (the immutable copy cannot keep it)', $q$select (select l.new_value::text || ':' || l.redacted::text from public.alumni_change_log l where l.founder_id = '00000000-0000-4000-8000-00000000f601' and l.field = 'bio_en')
  || '|' || (select l.reason from public.alumni_change_log l where l.founder_id = '00000000-0000-4000-8000-00000000f601' and l.field = 'phone')$q$, '"my id is [ID removed] ok":true|ref [ID removed]');
select v60_test.val('P05 the proof query of m52 finds nothing in the log (the scan reads every text / jsonb column of public)', $q$select count(*)::text from app_private.scan_id_shaped_values() where table_name = 'alumni_change_log'$q$, '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_company_team_member('00000000-0000-4000-8000-00000000c601', :'rec1', '{"self_birth_date":"1999-05-17"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('P07 ... the entry says 1999, not the date', format($q$select l.new_value::text || ':' || l.redacted::text from public.alumni_change_log l where l.founder_id = %L and l.field = 'self_birth_date'$q$, :'rec1'), '"1999":true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_founder('00000000-0000-4000-8000-00000000f601', '{"national_id":"29501010101240"}'::jsonb) is not null as ok \gset
select public.save_alumni_founder('00000000-0000-4000-8000-00000000f601', '{"national_id":null}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('P09 the three ID events (set, changed, cleared) are three separate entries (never coalesced)', $q$select string_agg(l.old_value::text || '>' || l.new_value::text, ',' order by l.id) from public.alumni_change_log l where l.founder_id = '00000000-0000-4000-8000-00000000f601' and l.entity_type = 'identity' and l.field = 'national_id'$q$, 'false>true,true>true,true>false');

-- ================================================================= I. the log is immutable (and the bypass attempts fail)
select v60_test.fails('I01 UPDATE of a log row as the OWNER is refused by the trigger', $q$update public.alumni_change_log set new_value = '"hacked"' where id = (select min(id) from public.alumni_change_log)$q$, '42501', 'log_immutable');
select v60_test.fails('I02 DELETE is refused', $q$delete from public.alumni_change_log where id = (select min(id) from public.alumni_change_log)$q$, '42501', 'log_immutable');
select v60_test.fails('I03 TRUNCATE is refused', $q$truncate public.alumni_change_log$q$, '42501', 'log_immutable');
select set_config('app.alumni_log_merge', '1', true);
select v60_test.fails('I04 even WITH the merge flag, an old value / a time / an actor cannot be rewritten (only the new value / last time / counter move)', $q$update public.alumni_change_log set old_value = '"x"' where id = (select min(id) from public.alumni_change_log)$q$, '42501', 'log_immutable');
select v60_test.fails('I05 ... nor the actor', $q$update public.alumni_change_log set actor_role = 'founder', actor_user_id = null where id = (select min(id) from public.alumni_change_log)$q$, '42501', 'log_immutable');
select set_config('app.alumni_log_merge', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('I06 an alumni_manager cannot INSERT into the log (permission denied)', $q$insert into public.alumni_change_log (actor_role, source, entity_type, entity_id, field) values ('founder', 'founder', 'company', '00000000-0000-4000-8000-00000000c601', 'sector')$q$, '42501');
select v60_test.fails('I07 ... nor UPDATE', $q$update public.alumni_change_log set new_value = '"x"'$q$, '42501');
select v60_test.fails('I08 ... nor DELETE', $q$delete from public.alumni_change_log$q$, '42501');
select v60_test.fails('I09 ... nor TRUNCATE', $q$truncate public.alumni_change_log$q$, '42501');
select v60_test.fails('I10 ... nor switch the triggers off for the session (session_replication_role is superuser-only)', $q$set session_replication_role = replica$q$, '42501');
select v60_test.fails('I11 ... nor read the actor id / the reason / the request id straight from the table', $q$select actor_user_id from public.alumni_change_log limit 1$q$, '42501');
reset role;

-- ================================================================= K. coalescing of rapid edits (same actor, same field, short window)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"location_en":"A"}'::jsonb) is not null as ok \gset
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"location_en":"B"}'::jsonb) is not null as ok \gset
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"location_en":"C"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('K01 three saves of the same field by the same actor within the window = ONE entry: the FIRST old value, the LAST new value, edits = 3', $q$select count(*) || ':' || min(l.old_value::text) || '>' || min(l.new_value::text) || ':' || min(l.edits) from public.alumni_change_log l
  where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'location_en'$q$, '1:null>"C":3');
select v60_test.val('K02 the merged entry keeps its FIRST time and carries the last one', $q$select (l.last_at > l.at)::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'location_en'$q$, 'true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e604","role":"authenticated"}', true);
set local role authenticated;
select public.save_my_company_profile('00000000-0000-4000-8000-00000000c602', '{"location_en":"D"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('K03 ANOTHER actor never merges into somebody else''s entry: a second entry C > D by the founder', $q$select count(*) || ':' || (array_agg(l.source || ':' || l.old_value::text || '>' || l.new_value::text order by l.id))[2] from public.alumni_change_log l
  where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'location_en'$q$, '2:founder:"C">"D"');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"location_en":"E"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('K04 and the first actor''s NEXT edit after the other one is a new entry too (the newest entry belongs to somebody else)', $q$select count(*)::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'location_en'$q$, '3');
select set_config('app.alumni_coalesce_seconds', '0', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"location_ar":"1"}'::jsonb) is not null as ok \gset
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"location_ar":"2"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('K05 coalescing can be switched off (window 0): two entries', $q$select count(*)::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'location_ar'$q$, '2');
select set_config('app.alumni_coalesce_seconds', '1', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"website_url":"https://one.example.com"}'::jsonb) is not null as ok \gset
select pg_sleep(1.2);
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"website_url":"https://two.example.com"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('K06 after the window has passed the next edit is a new entry (1 second window, 1.2 second pause)', $q$select count(*)::text from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'website_url'$q$, '2');
select set_config('app.alumni_coalesce_seconds', '', true);
select set_config('request.jwt.claims', '', true);
update public.companies set app_url = 'https://base.example.com' where id = '00000000-0000-4000-8000-00000000c602';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"app_url":"https://changed.example.com"}'::jsonb) is not null as ok \gset
select public.save_alumni_company('00000000-0000-4000-8000-00000000c602', '{"app_url":"https://base.example.com"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.val('K07 an edit and its revert inside the window = ONE entry with old = new (the net change is nothing; the two saves are counted; the system write before it is a separate entry)', $q$select string_agg(l.source || ':' || l.old_value::text || '>' || l.new_value::text || ':' || l.edits, ' | ' order by l.id) from public.alumni_change_log l where l.company_id = '00000000-0000-4000-8000-00000000c602' and l.field = 'app_url'$q$,
  'system:null>"https://base.example.com":1 | manager:"https://base.example.com">"https://base.example.com":2');

-- ================================================================= R. RLS on the log (the table itself; the RPCs are tested in H)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('R01 a manager reads every entry (and the safe columns)', $q$select (count(*) > 30 and count(*) filter (where entity_type = 'snapshot') > 0)::text from public.alumni_change_log$q$, 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('R02 a founder reads ONLY the yearly figures of his own company: entity types', $q$select coalesce(string_agg(distinct entity_type, ','), 'none') from public.alumni_change_log$q$, 'snapshot');
select v60_test.val('R03 ... and only his company''s: the company ids', $q$select string_agg(distinct company_id::text, ',') from public.alumni_change_log$q$, '00000000-0000-4000-8000-00000000c601');
select v60_test.val('R04 ... never a person''s data (no founder / identity / team entry), never the manager notes', $q$select count(*)::text from public.alumni_change_log where entity_type <> 'snapshot'$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e604","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('R05 the other founder sees nothing of company 1 (his own company has no yearly figures yet: 0 rows)', $q$select count(*)::text from public.alumni_change_log$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e602","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('R06 a project manager reads nothing', $q$select count(*)::text from public.alumni_change_log$q$, '0');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select v60_test.fails('R07 anon: permission denied', $q$select count(*) from public.alumni_change_log$q$, '42501');
reset role;

-- ================================================================= H. the history viewer (list_alumni_history)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('H01 a manager: the timeline of one company, newest first, with the total', $q$select (public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 5, 0)->>'total')::int > 10 and
  ((public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 5, 0)->'rows'->0->>'at')::timestamptz >= (public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 5, 0)->'rows'->4->>'at')::timestamptz)$q$, 'true');
select v60_test.val('H02 paging: limit 5 offset 5 returns 5 other rows', $q$select (jsonb_array_length(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 5, 5)->'rows') = 5
  and public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 5, 5)->'rows'->0->>'id' <> public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 5, 0)->'rows'->0->>'id')::text$q$, 'true');
select v60_test.val('H03 filters: entity_type snapshot + year 2024 + field revenue_total = the two entries of the figures, with the names of the actors', $q$select string_agg(r->'actor'->>'name' || ':' || (r->>'source'), ',' order by (r->>'id')::bigint)
  from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601', 'entity_type', 'snapshot', 'year', '2024', 'field', 'revenue_total'))->'rows') r$q$, 'V60 Founder One:founder,V60 Alumni Manager:manager');
select v60_test.val('H04 filter by source manager only', $q$select count(*)::text from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601', 'source', 'manager'))->'rows') r where r->>'source' <> 'manager'$q$, '0');
select v60_test.val('H05 filter by actor (the founder user)', $q$select count(distinct r->'actor'->>'user_id')::text from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601', 'actor', '00000000-0000-4000-8000-00000000e603'))->'rows') r$q$, '1');
select v60_test.val('H06 filter by field (sector)', $q$select string_agg(distinct r->>'field', ',') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('field', 'sector', 'company_id', '00000000-0000-4000-8000-00000000c601'))->'rows') r$q$, 'sector');
select v60_test.val('H07 filter by date: a window in the far future is empty, one that starts yesterday has everything', $q$select concat_ws('|', (public.list_alumni_history(jsonb_build_object('from', (now() + interval '2 days')::text))->>'total'),
  (public.list_alumni_history(jsonb_build_object('from', (now() - interval '1 day')::text, 'company_id', '00000000-0000-4000-8000-00000000c601'))->>'total')::int > 10)$q$, '0|t');
select v60_test.val('H08 filter by company name (q), the company name rides in every row', $q$select count(distinct r->'company'->>'name_en')::text || ':' || min(r->'company'->>'name_en') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('q', 'v60 nile'))->'rows') r$q$, '1:V60 Nile Co');
select v60_test.val('H09 the timeline of ONE FOUNDER (his entries of every company) and the founder name rides along', $q$select count(*) filter (where r->'founder'->>'name_en' = 'V60 One')::text || ':' || count(*)::text from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('founder_id', '00000000-0000-4000-8000-00000000f601'))->'rows') r$q$, '8:8');
select v60_test.val('H10 the reason and the request id are shown to a manager', $q$select count(*) filter (where r->>'reason' is not null)::text || ':' || (count(*) filter (where r->>'request_id' is not null) > 0)::text from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601', 'field', 'stage'))->'rows') r$q$, '1:true');
select v60_test.fails('H12 an unknown filter key', $q$select public.list_alumni_history('{"nope":1}'::jsonb)$q$, '22023', 'alumni_invalid', 'nope:unknown_key');
select v60_test.fails('H13 a bad entity type', $q$select public.list_alumni_history('{"entity_type":"x"}'::jsonb)$q$, '22023', 'alumni_invalid', 'entity_type:bad_value');
select v60_test.fails('H14 a bad date', $q$select public.list_alumni_history('{"from":"yesterday-ish"}'::jsonb)$q$, '22023', 'alumni_invalid', 'from:bad_date');
select v60_test.val('H15 the export size: a manager may ask for 5000 rows at once (capped), a page of 9999 is cut to 5000', $q$select (public.list_alumni_history('{}'::jsonb, 9999, 0)->>'limit')$q$, '5000');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('H16 a FOUNDER sees the history of the YEARLY FIGURES of his own company: only snapshot entries', $q$select string_agg(distinct r->>'entity_type', ',') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'))->'rows') r$q$, 'snapshot');
select v60_test.val('H17 ... with the KIND of editor (role) but never a name, a user id, a reason, a request id, a company or a person', $q$select count(*)::text from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'))->'rows') r
  where (r->'actor') ? 'name' or (r->'actor') ? 'user_id' or r->>'reason' is not null or r->>'request_id' is not null or r->>'company' is not null or r->>'founder' is not null$q$, '0');
select v60_test.val('H18 ... the role of the editor is there (founder / alumni_manager)', $q$select string_agg(distinct r->'actor'->>'role', ',' order by r->'actor'->>'role') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'))->'rows') r$q$, 'alumni_manager,founder');
select v60_test.val('H19 a founder cannot pass other filters through (entity_type is forced, actor / founder / q ignored)', $q$select string_agg(distinct r->>'entity_type', ',') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601', 'entity_type', 'identity', 'founder_id', '00000000-0000-4000-8000-00000000f601'))->'rows') r$q$, 'snapshot');
select v60_test.fails('H20 a founder cannot ask for the history of ANOTHER company', $q$select public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c602'))$q$, '42501');
select v60_test.fails('H21 ... nor for everything (no company)', $q$select public.list_alumni_history('{}'::jsonb)$q$, '42501');
select v60_test.val('H22 a founder''s page is capped at 200', $q$select public.list_alumni_history(jsonb_build_object('company_id', '00000000-0000-4000-8000-00000000c601'), 9999)->>'limit'$q$, '200');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e602","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('H23 a project manager cannot read the history', $q$select public.list_alumni_history('{}'::jsonb)$q$, '42501');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
reset role;

-- ================================================================= S. optimistic concurrency (expected version) + no-op saves + the reason
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select (public.get_my_alumni_profile()->'founder'->>'updated_at') as ftok0 \gset
select (public.get_my_company_profile('00000000-0000-4000-8000-00000000c601')->'company'->>'updated_at') as ctok0 \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.okrun('S01 the founder saves his profile with the version he loaded', format($q$select public.save_my_founder_profile('{"education_status":"graduate"}'::jsonb, %L::timestamptz)$q$, :'ftok0'));
select v60_test.bump('founders', $b$id = '00000000-0000-4000-8000-00000000f601'$b$);
select v60_test.fails('S02 the same version again is STALE (the profile moved): P0001, hint alumni_stale (never 40001)', format($q$select public.save_my_founder_profile('{"phone":"+201099999999"}'::jsonb, %L::timestamptz)$q$, :'ftok0'), 'P0001', 'alumni_stale');
select (public.get_my_alumni_profile()->'founder'->>'updated_at') as ftok1 \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('S04 a manager with a stale founder version is refused too', format($q$select public.save_alumni_founder('00000000-0000-4000-8000-00000000f601', '{"phone":"+201088888888"}'::jsonb, %L::timestamptz)$q$, :'ftok0'), 'P0001', 'alumni_stale');
select v60_test.val('S04b the refusal carries the CURRENT version in detail (so the client can reload at once)', format($q$select (v60_test.err_detail(%L)::timestamptz = %L::timestamptz)::text$q$,
  format($r$select public.save_alumni_founder('00000000-0000-4000-8000-00000000f601', '{"phone":"+201088888888"}'::jsonb, %L::timestamptz)$r$, :'ftok0'), :'ftok1'), 'true');
select v60_test.okrun('S05 ... and succeeds with the current version', format($q$select public.save_alumni_founder('00000000-0000-4000-8000-00000000f601', '{"phone":"+201088888888"}'::jsonb, %L::timestamptz, 'phone confirmed by call')$q$, :'ftok1'));
select public.save_alumni_company('00000000-0000-4000-8000-00000000c601', '{"location_ar":"x"}'::jsonb) is not null as ok \gset
select v60_test.bump('companies', $b$id = '00000000-0000-4000-8000-00000000c601'$b$);
select v60_test.fails('S06 the company: a stale version is refused for the manager (P0001, detail = the current version)', format($q$select public.save_alumni_company('00000000-0000-4000-8000-00000000c601', '{"stage":"revenue"}'::jsonb, %L::timestamptz)$q$, :'ctok0'), 'P0001', 'alumni_stale');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('S07 ... and for the founder', format($q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c601', '{"stage":"revenue"}'::jsonb, %L::timestamptz)$q$, :'ctok0'), 'P0001', 'alumni_stale');
reset role;
-- yearly rows
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select (public.get_my_company_profile('00000000-0000-4000-8000-00000000c601')->'snapshots'->0->>'updated_at') as stok \gset
select (public.get_my_company_profile('00000000-0000-4000-8000-00000000c601')->'snapshots'->0->>'year') as syear \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, '{"needs":"more money"}'::jsonb, :'stok'::timestamptz) is not null as ok \gset
select v60_test.bump_snapshot('00000000-0000-4000-8000-00000000c601', 2024);
select v60_test.fails('S08 a yearly row: the old version is refused after somebody saved the row', format($q$select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, '{"needs":"other"}'::jsonb, %L::timestamptz)$q$, :'stok'), 'P0001', 'alumni_stale');
select v60_test.fails('S09 "-infinity" = "I loaded no row for this year": refused when the row exists', $q$select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, '{"needs":"other"}'::jsonb, '-infinity'::timestamptz)$q$, 'P0001', 'alumni_stale');
select v60_test.okrun('S10 ... accepted when the year really is new', $q$select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2022, '{"revenue_total":1}'::jsonb, '-infinity'::timestamptz)$q$);
select v60_test.fails('S11 a row that vanished while the form was open is a conflict too (a real version, no row)', $q$select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2021, '{"revenue_total":1}'::jsonb, '2026-01-01T00:00:00Z'::timestamptz)$q$, 'P0001', 'alumni_stale');
select v60_test.okrun('S12 no token = no check (the old callers keep working)', $q$select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, '{"needs":"fine"}'::jsonb)$q$);
reset role;
-- a save that changes nothing is not an edit
select s.updated_at::text as before_at, s.source as before_src from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c601' and s.period_year = 2022 \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select (public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c601', 2022, '{"revenue_total":1}'::jsonb)->>'changed') as chg \gset
reset role;
select v60_test.val('S13 a save that changes nothing answers changed:false and does NOT touch the row (the "last edited by" stays honest: the manager stays the editor)', format($q$select (%L = 'false' and s.updated_at::text = %L and s.source = %L and s.source = 'manager')::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c601' and s.period_year = 2022$q$, :'chg', :'before_at', :'before_src'), 'true');
select v60_test.bump_snapshot('00000000-0000-4000-8000-00000000c601', 2024);
select v60_test.val('S14 the review checkpoint did not move the token of the founder''s form: reviewed rows keep their updated_at', $q$select (s.reviewed_at is not null and s.updated_at > s.reviewed_at)::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c601' and s.period_year = 2024$q$, 'true');
-- reviewed -> edited again = "changed since review"
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('S15 the stamps tell the review state per year (reviewed, then changed since: not "reviewed")', $q$select (y->>'reviewed') from jsonb_array_elements(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'years') y where y->>'year' = '2024'$q$, 'false');
select public.review_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024) is not null as ok \gset
select v60_test.val('S16 ... reviewed again: true', $q$select (y->>'reviewed') || ':' || (y->>'reviewed_by_name') from jsonb_array_elements(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'years') y where y->>'year' = '2024'$q$, 'true:V60 Alumni Manager');
select public.review_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024, false) is not null as ok \gset
select v60_test.val('S17 ... and the checkpoint can be withdrawn', $q$select (y->>'reviewed') from jsonb_array_elements(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'years') y where y->>'year' = '2024'$q$, 'false');
select v60_test.fails('S18 reviewing a year that does not exist', $q$select public.review_company_snapshot('00000000-0000-4000-8000-00000000c601', 1999)$q$, 'P0002', 'alumni_not_found');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('S19 a founder cannot mark a year reviewed', $q$select public.review_company_snapshot('00000000-0000-4000-8000-00000000c601', 2024)$q$, '42501');
reset role;

-- ================================================================= T. the "last edited by" stamps
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('T01 a manager gets the section stamps with the editor''s kind AND name', $q$select string_agg(k || ':' || (v->>'source') || ':' || (v->>'name'), ',' order by k) from jsonb_each(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'sections') e(k, v)
  where k in ('basics', 'classification', 'directory', 'online', 'location')$q$, 'basics:founder:V60 Founder One,classification:manager:V60 Admin,directory:manager:V60 Alumni Manager,location:manager:V60 Alumni Manager');
select v60_test.val('T02 ... the classification was last touched by the super_admin (startup type), after the founder sector', $q$select (public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'sections'->'classification'->>'source')$q$, 'manager');
select v60_test.val('T03 the row stamp of the company (who last wrote it)', $q$select (public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'company'->>'source')$q$, 'manager');
select v60_test.val('T04 a manager also sees the yearly rows (2024 and 2022; 2023 was deleted) and the team rows stamped', $q$select jsonb_array_length(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'years')::text || ':' || jsonb_array_length(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'founders')::text$q$, '2:2');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('T05 a founder of the company gets the same stamps with the KIND of editor, NO name and no manager-only section', $q$select (select count(*) from jsonb_each(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'sections') e(k, v) where v ? 'name')::text || ':' || (public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'sections' ? 'manager')::text
  || ':' || ((public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'company') ? 'name')::text$q$, '0:false:false');
select v60_test.val('T06 ... the yearly rows carry no name either', $q$select count(*)::text from jsonb_array_elements(public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')->'years') y where y ? 'name' or y ? 'reviewed_by_name'$q$, '0');
select v60_test.fails('T07 a founder cannot read the stamps of another company', $q$select public.get_alumni_stamps('00000000-0000-4000-8000-00000000c602')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e602","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('T08 a project manager cannot read the stamps', $q$select public.get_alumni_stamps('00000000-0000-4000-8000-00000000c601')$q$, '42501');
reset role;

-- ================================================================= A. the state of a company at a date (reverse replay of the log): c607 "Timeline"
select set_config('app.alumni_coalesce_seconds', '0', true);
select clock_timestamp() as t_before \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select (public.save_alumni_company(null, '{"name_en":"V60 Timeline Co","stage":"idea_stage"}'::jsonb)->'company'->>'id') as c7 \gset
reset role;
insert into public.company_founders (company_id, founder_id, is_primary) values (:'c7', '00000000-0000-4000-8000-00000000f602', true);
select v60_test.mark('m0', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company(:'c7', '{"description_en":"D1"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m1', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e604","role":"authenticated"}', true);
set local role authenticated;
select public.save_my_company_profile(:'c7', '{"sector":"technology","governorate":25}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m2', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company(:'c7', '{"sector":"healthcare","internal":{"hint":"H1"}}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m3', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e604","role":"authenticated"}', true);
set local role authenticated;
select public.upsert_company_snapshot(:'c7', 2025, '{"revenue_total":10,"employees_total":3}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m4', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.upsert_company_snapshot(:'c7', 2025, '{"revenue_total":20}'::jsonb) is not null as ok \gset
select public.upsert_company_snapshot(:'c7', 2024, '{"freelancers":2}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m5', :'c7'::uuid);
set local role authenticated;
select (public.save_company_team_member(:'c7', null, '{"name_en":"V60 Rec Seven","role":"CTO","self_gender":"female"}'::jsonb)->>'founder_id') as rec7 \gset
reset role;
select v60_test.mark('m6', :'c7'::uuid);
set local role authenticated;
select public.save_alumni_founder(:'rec7', '{"phone":"+201055555555","national_id":"29501010101241"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m7', :'c7'::uuid);
set local role authenticated;
select public.set_company_ceo(:'c7', :'rec7') is not null as ok \gset
reset role;
select v60_test.mark('m8', :'c7'::uuid);
set local role authenticated;
select public.remove_company_team_member(:'c7', :'rec7') is not null as ok \gset
reset role;
select v60_test.mark('m9', :'c7'::uuid);
set local role authenticated;
select public.delete_company_snapshot(:'c7', 2024) is not null as ok \gset
reset role;
select v60_test.mark('m10', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e604","role":"authenticated"}', true);
set local role authenticated;
select public.save_my_company_profile(:'c7', '{"description_en":null}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m11', :'c7'::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company(:'c7', '{"operating_status":"closed","closed_on":"2025-06-01","closing_reason":"funding"}'::jsonb) is not null as ok \gset
reset role;
select v60_test.mark('m12', :'c7'::uuid);
select set_config('app.alumni_coalesce_seconds', '', true);

select v60_test.val('A01 the state at every one of the 13 remembered moments equals the replayed state (all keys, all values): m0 .. m12', format($q$select coalesce(string_agg(s.label, ',' order by s.t), 'none') from v60_test.snap s
  where s.st is distinct from (select (public.alumni_state_as_of(%L::uuid, s.t)->'fields') from (select 1) q)$q$, :'c7'), 'none');
select v60_test.val('A02 (the same, as the manager through the RPC, one by one: m0)', format($q$select (app_private.alumni_state_flat(%L::uuid, (select t from v60_test.snap where label = 'm0')) = (select st from v60_test.snap where label = 'm0'))::text$q$, :'c7'), 'true');
select v60_test.val('A03 m4 (after the founder''s first figures): 2025 revenue 10, employees 3, sector healthcare, hint H1', $q$select concat_ws('|', st->>'year.2025.revenue_total', st->>'year.2025.employees_total', st->>'company.sector', st->>'internal.hint') from v60_test.snap where label = 'm4'$q$, '10.00|3|healthcare|H1');
select v60_test.val('A04 m2 (the founder had set technology; the manager changed it to healthcare at m3)', $q$select (select st->>'company.sector' from v60_test.snap where label = 'm2') || '>' || (select st->>'company.sector' from v60_test.snap where label = 'm3')$q$, 'technology>healthcare');
select v60_test.val('A05 m6 / m9: the record was on the team at m8 and gone at m9, with its role and CEO flag', format($q$select concat_ws('|', (select (st ? ('team.' || %L || '.member'))::text from v60_test.snap where label = 'm8'),
  (select st->>('team.' || %L || '.is_primary') from v60_test.snap where label = 'm8'), (select (st ? ('team.' || %L || '.member'))::text from v60_test.snap where label = 'm9'))$q$, :'rec7', :'rec7', :'rec7'), 'true|true|false');
select v60_test.val('A06 the deleted year 2024 is back in m9 and gone in m10', $q$select concat_ws('|', (select st->>'year.2024.freelancers' from v60_test.snap where label = 'm9'), (select coalesce(st->>'year.2024.freelancers', 'none') from v60_test.snap where label = 'm10'))$q$, '2|none');
select v60_test.val('A07 the contact of the record is shown MASKED in the replayed state, and the national ID only as "an ID exists"', format($q$select concat_ws('|', st->>%L, st->>%L) from v60_test.snap where label = 'm8'$q$, 'founder.' || :'rec7' || '.phone', 'founder.' || :'rec7' || '.national_id'), '+**********55|true');
select v60_test.val('A08 before the company existed: existed = false and no fields', format($q$select (public.alumni_state_as_of(%L::uuid, %L::timestamptz)->>'existed') || ':' || (public.alumni_state_as_of(%L::uuid, %L::timestamptz)->'fields')::text$q$, :'c7', :'t_before', :'c7', :'t_before'), 'false:{}');
select v60_test.val('A09 before the log existed: the answer says so (before_log = true), the earliest known state is returned', $q$select (public.alumni_state_as_of('00000000-0000-4000-8000-00000000c601', (select min(started_at) from app_private.alumni_log_epoch) - interval '1 day')->>'before_log')$q$, 'true');
select v60_test.val('A10 as of NOW = the current state', format($q$select (app_private.alumni_state_flat(%L::uuid, clock_timestamp()) = (public.alumni_state_as_of(%L::uuid)->'fields'))::text$q$, :'c7', :'c7'), 'true');
set local role authenticated;
select v60_test.fails('A12 an unknown company is not found', $q$select public.alumni_state_as_of('00000000-0000-4000-8000-0000000cdead')$q$, 'P0002', 'alumni_not_found');
reset role;
-- the comparison of two dates
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('A13 compare m2 with m3: the sector and the hint, nothing else', format($q$select string_agg(c->>'key' || ':' || coalesce(c->>'from', '-') || '>' || coalesce(c->>'to', '-'), ',' order by c->>'key') from jsonb_array_elements(public.alumni_state_diff(%L::uuid, (select t from v60_test.snap where label = 'm2'), (select t from v60_test.snap where label = 'm3'))->'changes') c$q$, :'c7'),
  'company.sector:technology>healthcare,internal.hint:->H1');
select v60_test.val('A14 compare m0 with now: the 9 keys that differ (sector, location, notes, two 2025 figures, closing, the CEO flag), not the ones that came back (description set then cleared, the removed record, the deleted year)', format($q$select jsonb_array_length(public.alumni_state_diff(%L::uuid, (select t from v60_test.snap where label = 'm0'))->'changes')::text$q$, :'c7'), '9');
select v60_test.val('A15 compare two identical moments: no change', format($q$select jsonb_array_length(public.alumni_state_diff(%L::uuid, (select t from v60_test.snap where label = 'm5'), (select t from v60_test.snap where label = 'm5'))->'changes')::text$q$, :'c7'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e604","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('A16 a founder cannot replay a state (managers only: it holds the manager notes and the team)', format($q$select public.alumni_state_as_of(%L::uuid)$q$, :'c7'), '42501');
select v60_test.fails('A17 ... nor compare', format($q$select public.alumni_state_diff(%L::uuid, now() - interval '1 hour')$q$, :'c7'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e602","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('A18 a project manager cannot either', format($q$select public.alumni_state_as_of(%L::uuid)$q$, :'c7'), '42501');
reset role;

-- ================================================================= M. merge_companies is logged too (the removal of the duplicate, the moved figures)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select (public.save_alumni_company(null, '{"name_en":"V60 Keep Co"}'::jsonb)->'company'->>'id') as ck \gset
select (public.save_alumni_company(null, '{"name_en":"V60 Drop Co","sector":"retail"}'::jsonb)->'company'->>'id') as cd \gset
select public.upsert_company_snapshot(:'cd', 2022, '{"revenue_total":7}'::jsonb) is not null as ok \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select public.merge_companies(:'ck', :'cd') is not null as ok \gset
reset role;
select v60_test.val('M01 the duplicate''s removal (merge = a soft delete) and the figures that moved to the kept company are in the history, by the manager', format($q$select concat_ws('|',
  (select count(*) from public.alumni_change_log l where l.entity_id = %L::uuid and l.field = 'deleted_at' and l.source = 'manager')::text,
  (select l.new_value::text from public.alumni_change_log l where l.company_id = %L::uuid and l.entity_type = 'snapshot' and l.period_key = '2022' and l.field = 'revenue_total' order by l.id desc limit 1),
  (select l.new_value::text from public.alumni_change_log l where l.company_id = %L::uuid and l.entity_type = 'company' and l.field = 'sector' order by l.id desc limit 1))$q$, :'cd', :'ck', :'ck'), '1|7.00|"retail"');

-- ================================================================= Q. the needs-attention queue
-- fixtures: AQ1 empty, AQ2 complete (CEO = a registered account), AQ3 half, AQ5 half + a pending invitation
select current_date as d \gset
select extract(year from (now() at time zone 'Africa/Cairo'))::int as y \gset
insert into public.companies (id, name_en, description_en, sector_key, subsector_key, governorate_code, stage, startup_type_key, legal_status_key, established_on, logo_path, website_url) values
  ('00000000-0000-4000-8000-00000000a601', 'V60 AQ Empty', null, null, null, null, null, null, null, null, null, null),
  ('00000000-0000-4000-8000-00000000a602', 'V60 AQ Full', 'complete', 'technology', 'robotics', 25, 'mvp', 'startup', 'llc', date '2020-01-01', 'global/company-logo/00000000-0000-4000-8000-0000000060a2.webp', 'https://full.example.com'),
  ('00000000-0000-4000-8000-00000000a603', 'V60 AQ Half', 'only a text', 'technology', null, 25, null, null, null, null, null, null),
  ('00000000-0000-4000-8000-00000000a605', 'V60 AQ Invited Half', 'only a text', 'technology', null, 25, null, null, null, null, null, null);
update public.founders set phone = '+201011111111', education_status = 'graduate' where id = '00000000-0000-4000-8000-00000000f605';
insert into public.founder_identities (founder_id, national_id) values ('00000000-0000-4000-8000-00000000f605', '29501010101242');
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000a602', '00000000-0000-4000-8000-00000000f605', true);
insert into public.founders (id, name_en, name_ar) values ('00000000-0000-4000-8000-00000000f606', 'V60 Half Ceo', 'نصف'), ('00000000-0000-4000-8000-00000000f607', 'V60 Half Ceo 2', 'نصف2');
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000a603', '00000000-0000-4000-8000-00000000f606', true), ('00000000-0000-4000-8000-00000000a605', '00000000-0000-4000-8000-00000000f607', true);
insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, revenue_total) values
  ('00000000-0000-4000-8000-00000000a602', 'annual', current_date, 'founder', :y - 1, 100), ('00000000-0000-4000-8000-00000000a603', 'annual', current_date, 'founder', :y - 1, 100), ('00000000-0000-4000-8000-00000000a605', 'annual', current_date, 'founder', :y - 3, 100);
insert into public.alumni_invitations (company_id, founder_email, token, status, sent_by) values ('00000000-0000-4000-8000-00000000a605', 'zz-v60-inv-q@example.invalid', 'x', 'pending', '00000000-0000-4000-8000-00000000e601');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('Q01 the queue lists the four fixtures, the worst first (empty: 6 required missing; the half one with 2-year-old figures: 3; the other half: 2; the complete one last)', $q$select string_agg(r->>'name_en', ' > ' order by ord) from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq"}'::jsonb)->'rows') with ordinality t(r, ord)$q$, 'V60 AQ Empty > V60 AQ Invited Half > V60 AQ Half > V60 AQ Full');
select v60_test.val('Q02 the empty company misses all 15 items: 6 required, 9 recommended, 0 %', $q$select concat_ws('|', jsonb_array_length(r->'missing'), r->>'required_missing', r->>'recommended_missing', r->>'completeness_percent') from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq empty"}'::jsonb)->'rows') r$q$, '15|6|9|0');
select v60_test.val('Q03 the complete one misses nothing: 100 %', $q$select concat_ws('|', jsonb_array_length(r->'missing'), r->>'completeness_percent') from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq full"}'::jsonb)->'rows') r$q$, '0|100');
select v60_test.val('Q04 the half-filled one: exactly the expected items (a CEO without ID / contact / education, no logo, date, stage, type, sub sector, legal status, online presence)', $q$select string_agg(m, ',' order by m) from jsonb_array_elements_text(public.list_alumni_attention('{"q":"v60 aq half"}'::jsonb)->'rows'->0->'missing') m$q$,
  'ceo_education,ceo_id,contact,established_on,legal_status,logo,online_presence,stage,startup_type,subsector');
select v60_test.val('Q05 ... 10 items missing of 15: 33 %', $q$select (public.list_alumni_attention('{"q":"v60 aq half"}'::jsonb)->'rows'->0->>'completeness_percent')$q$, '33');
select v60_test.val('Q06 counts: total 4, with issues 3, complete 1', $q$select concat_ws('|', c->>'total', c->>'with_issues', c->>'complete') from (select public.list_alumni_attention('{"q":"v60 aq"}'::jsonb)->'counts' c) x$q$, '4|3|1');
select v60_test.val('Q07 counts per rule: no sector 1, no CEO 1, no ID 3, no contact 3, no latest figures 2 (the empty one and the half one with 2-year-old figures), the base is stable when a filter narrows the list', $q$select concat_ws('|', c->'by_rule'->>'sector', c->'by_rule'->>'ceo', c->'by_rule'->>'ceo_id', c->'by_rule'->>'contact', c->'by_rule'->>'latest_figures')
  from (select public.list_alumni_attention('{"q":"v60 aq","missing":"sector"}'::jsonb)->'counts' c) x$q$, '1|1|3|3|2');
select v60_test.val('Q08 filter missing = sector: the empty one only (the list narrows, the total says 1)', $q$select (public.list_alumni_attention('{"q":"v60 aq","missing":"sector"}'::jsonb)->>'total') || ':' || (public.list_alumni_attention('{"q":"v60 aq","missing":"sector"}'::jsonb)->'rows'->0->>'name_en')$q$, '1:V60 AQ Empty');
select v60_test.val('Q09 filter severity = required: the three with a required item missing', $q$select (public.list_alumni_attention('{"q":"v60 aq","severity":"required"}'::jsonb)->>'total')$q$, '3');
select v60_test.val('Q10 filter has_account = true: the complete one (his CEO is a registered account); false: the other three', $q$select (public.list_alumni_attention('{"q":"v60 aq","has_account":true}'::jsonb)->'rows'->0->>'name_en') || '|' || (public.list_alumni_attention('{"q":"v60 aq","has_account":false}'::jsonb)->>'total')$q$, 'V60 AQ Full|3');
select v60_test.val('Q11 filter invited = true: the one with a pending invitation, flagged in its row', $q$select (public.list_alumni_attention('{"q":"v60 aq","invited":true}'::jsonb)->'rows'->0->>'name_en') || ':' || (public.list_alumni_attention('{"q":"v60 aq","invited":true}'::jsonb)->'rows'->0->>'pending_invitations')$q$, 'V60 AQ Invited Half:1');
select v60_test.val('Q12 configurable rules: with only "sector" and "description" counted the empty company is 0 %, the half ones 100 %, and the catalogue shows which rules are selected', $q$select concat_ws('|',
  (select string_agg(r->>'name_en' || '=' || (r->>'completeness_percent'), ',' order by r->>'name_en') from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq"}'::jsonb, array['sector', 'description'])->'rows') r),
  (select count(*) filter (where (r->>'selected')::boolean)::text || '/' || count(*)::text from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq"}'::jsonb, array['sector', 'description'])->'rules') r))$q$,
  'V60 AQ Empty=0,V60 AQ Full=100,V60 AQ Half=100,V60 AQ Invited Half=100|2/15');
select v60_test.val('Q13 sort by completeness (the emptiest first) and by name', $q$select (public.list_alumni_attention('{"q":"v60 aq"}'::jsonb, null, 25, 0, 'completeness')->'rows'->0->>'name_en') || '|' || (public.list_alumni_attention('{"q":"v60 aq"}'::jsonb, null, 25, 0, 'name')->'rows'->0->>'name_en')$q$, 'V60 AQ Empty|V60 AQ Empty');
select v60_test.val('Q14 paging: limit 2 offset 2 returns the 3rd and 4th of 4', $q$select jsonb_array_length(public.list_alumni_attention('{"q":"v60 aq"}'::jsonb, null, 2, 2)->'rows')::text || ':' || (public.list_alumni_attention('{"q":"v60 aq"}'::jsonb, null, 2, 2)->>'total')$q$, '2:4');
select v60_test.val('Q15 each row carries what the manager needs to act: the CEO (name, e-mail, phone: manager only), the last update, the programs list', $q$select concat_ws('|', r->'ceo'->>'name_en', (r->'ceo'->>'has_account'), (r ? 'last_update')::text, (r ? 'programs')::text) from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq full"}'::jsonb)->'rows') r$q$, 'V60 Ceo|true|true|true');
select v60_test.val('Q16 the catalogue: 15 rules, 6 required then 9 recommended, each with the section that fixes it', $q$select count(*)::text || ':' || count(*) filter (where r->>'severity' = 'required')::text || ':' || (array_agg(r->>'section' order by ord))[1] from jsonb_array_elements(public.list_alumni_attention('{"q":"v60 aq"}'::jsonb)->'rules') with ordinality t(r, ord)$q$, '15:6:team');
select v60_test.val('Q17 the default scope is ALL companies: the 141 migrated companies (no CEO, no team) are in the queue and its counts', $q$select (c->>'total')::int >= 141 and (c->'by_rule'->>'ceo')::int >= 141 from (select public.list_alumni_attention('{}'::jsonb)->'counts' c) x$q$, 'true');
select clock_timestamp() as q0 \gset
select (public.list_alumni_attention('{}'::jsonb, null, 100, 0)->>'total')::int as qn \gset
select clock_timestamp() as q1 \gset
select v60_test.val('Q18 fast: the whole registry (141+ companies, one page of 100) in under 2 seconds', format($q$select (extract(epoch from (%L::timestamptz - %L::timestamptz)) < 2)::text$q$, :'q1', :'q0'), 'true');
select v60_test.val('Q19 the whole list can be exported in one call (5000 rows max): the page size is cut to 5000', $q$select public.list_alumni_attention('{}'::jsonb, null, 99999, 0)->>'limit'$q$, '5000');
select v60_test.fails('Q20 an unknown rule', $q$select public.list_alumni_attention('{}'::jsonb, array['nope'])$q$, '22023', 'alumni_invalid', 'rules:unknown');
select v60_test.fails('Q21 an empty rule list', $q$select public.list_alumni_attention('{}'::jsonb, array[]::text[])$q$, '22023', 'alumni_invalid', 'rules:required');
select v60_test.fails('Q22 an unknown filter', $q$select public.list_alumni_attention('{"nope":1}'::jsonb)$q$, '22023', 'alumni_invalid', 'nope:unknown_key');
select v60_test.fails('Q23 a bad scope', $q$select public.list_alumni_attention('{"scope":"x"}'::jsonb)$q$, '22023', 'alumni_invalid', 'scope:bad_value');
select v60_test.fails('Q24 a bad sort', $q$select public.list_alumni_attention('{}'::jsonb, null, 25, 0, 'x')$q$, '22023', 'alumni_invalid', 'sort:bad_value');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e603","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('Q25 a founder cannot read the queue', $q$select public.list_alumni_attention('{}'::jsonb)$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e602","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('Q26 nor a project manager', $q$select public.list_alumni_attention('{}'::jsonb)$q$, '42501');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
reset role;

-- ================================================================= V. the invited founder completes his OWN data
-- the manager prepares company 4 (partial) with the CEO as a RECORD (e-mail, phone, ID) and a first yearly figure, then invites that e-mail
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select (public.save_alumni_company(null, '{"name_en":"V60 Invited Co","sector":"technology","stage":"mvp","website_url":"https://invited.example.com"}'::jsonb)->'company'->>'id') as c4 \gset
select (public.save_company_team_member(:'c4', null, '{"name_en":"V60 Invited Person","role":"CEO","phone":"+201066666666","email":"zz-v60-inv@example.invalid","national_id":"29501010101243"}'::jsonb)->>'founder_id') as r4 \gset
select public.set_company_ceo(:'c4', :'r4') is not null as ok \gset
select public.upsert_company_snapshot(:'c4', :y - 1, '{"revenue_total": 5000, "employees_total": 4}'::jsonb) is not null as ok \gset
select (public.create_alumni_invitation(:'c4', 'zz-v60-inv@example.invalid', 'en', 'https://app.example.test')->>'token') as tok4 \gset
reset role;
select v60_test.val('V01 the manager''s CEO record is a founder row without an account, primary, with the e-mail the invitation will use', format($q$select concat_ws('|', (f.auth_user_id is null)::text, cf.is_primary::text, f.email::text, (select count(*) from public.founders x where lower(x.email::text) = 'zz-v60-inv@example.invalid')::text)
  from public.founders f join public.company_founders cf on cf.founder_id = f.id and cf.company_id = %L where f.id = %L$q$, :'c4', :'r4'), 'true|true|zz-v60-inv@example.invalid|1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('V02 the queue lists what is still missing of the prepared company (no description, location, legal status, start date, education of the CEO ...) while the CEO already has an ID and a contact', $q$select string_agg(m, ',' order by m) from jsonb_array_elements_text(public.list_alumni_attention('{"q":"v60 invited co"}'::jsonb)->'rows'->0->'missing') m$q$,
  'ceo_education,description,established_on,governorate,legal_status,logo,startup_type,subsector');
reset role;
-- the invitee signs up through the trigger with the invitation token (what GoTrue does): the account takes the record over
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e606','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-inv@example.invalid','{}', jsonb_build_object('full_name', 'V60 Invited Signup', 'invitation_token', :'tok4'), now(), now());
select v60_test.val('V03 the sign-up ADOPTED the manager''s record: ONE founder row for the e-mail, now with the account', format($q$select concat_ws('|', (select count(*) from public.founders x where lower(x.email::text) = 'zz-v60-inv@example.invalid')::text,
  (f.auth_user_id = '00000000-0000-4000-8000-00000000e606')::text, f.name_en, f.phone) from public.founders f where f.id = %L$q$, :'r4'), '1|true|V60 Invited Person|+201066666666');
select v60_test.val('V04 ... still the CEO (primary) of the invited company, no second membership row, the founder role granted', format($q$select concat_ws('|', (select count(*) from public.company_founders where company_id = %L)::text, (select is_primary::text from public.company_founders where company_id = %L and founder_id = %L),
  (select count(*) from public.user_roles where user_id = '00000000-0000-4000-8000-00000000e606' and role_key = 'founder')::text)$q$, :'c4', :'c4', :'r4'), '1|true|1');
select v60_test.val('V05 the invitation is accepted and points at the adopted record', format($q$select status || ':' || (founder_id = %L)::text from public.alumni_invitations where company_id = %L and lower(founder_email) = 'zz-v60-inv@example.invalid'$q$, :'r4', :'c4'), 'accepted:true');
select v60_test.val('V06 the national ID the manager typed stayed with the record (stored once) and the adoption is in the history as a system event', format($q$select concat_ws('|', (select count(*) from public.founder_identities where founder_id = %L and national_id is not null)::text,
  (select l.new_value::text from public.alumni_change_log l where l.founder_id = %L and l.field = 'has_account' order by l.id desc limit 1), (select l.source from public.alumni_change_log l where l.founder_id = %L and l.field = 'has_account' order by l.id desc limit 1))$q$, :'r4', :'r4', :'r4'), '1|true|system');
-- the invited founder opens the platform: he SEES what the manager filled
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e606","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('V07 he sees HIS profile as the manager typed it: name, phone, and his own national ID (the owner reads it), nothing lost', $q$select concat_ws('|', p->'founder'->>'name_en', p->'founder'->>'phone', (p->'founder'->'identity'->>'has_national_id'), p->'founder'->'identity'->'derived'->>'gender',
  jsonb_array_length(p->'companies')::text) from (select public.get_my_alumni_profile() p) x$q$, 'V60 Invited Person|+201066666666|true|female|1');
select v60_test.val('V08 he sees the COMPANY the manager prepared: sector, stage, website, the yearly figure, the team with himself as CEO', format($q$select concat_ws('|', c->'company'->>'sector', c->'company'->>'stage', c->'company'->>'website_url', jsonb_array_length(c->'snapshots')::text, (c->'team'->0->>'is_me'), (c->>'ceo_founder_id') = %L)
  from (select public.get_my_company_profile(%L) c) x$q$, :'r4', :'c4'), 'technology|mvp|https://invited.example.com|1|true|t');
select v60_test.val('V09 the completeness meters name exactly what is still missing (the profile: education; the company: description, legal status ...)', $q$select concat_ws('|', (p->'founder'->'completeness'->'missing')::text, jsonb_array_length(p->'companies'->0->'completeness'->'missing')::text) from (select public.get_my_alumni_profile() p) x$q$, '["education_status"]|5');
-- he completes the missing fields himself
select clock_timestamp() as t_pre4 \gset
select (public.get_my_alumni_profile()->'founder'->>'updated_at') as ftok4 \gset
select (public.get_my_company_profile(:'c4')->'company'->>'updated_at') as ctok4 \gset
select v60_test.okrun('V10 he completes his own profile with the version he loaded', format($q$select public.save_my_founder_profile('{"education_status":"graduate","bio_en":"I build things"}'::jsonb, %L::timestamptz)$q$, :'ftok4'));
select v60_test.okrun('V11 he completes the company (description, location, legal status, start date) with the version he loaded', format($q$select public.save_my_company_profile(%L, '{"description_en":"We build things","governorate":25,"legal_status":"llc","established_on":"2021-03-01"}'::jsonb, %L::timestamptz)$q$, :'c4', :'ctok4'));
select v60_test.okrun('V12 he adds the next yearly figure himself (a year nobody entered)', format($q$select public.upsert_company_snapshot(%L, %s, '{"revenue_total": 9000}'::jsonb, '-infinity'::timestamptz)$q$, :'c4', :'y'::int - 2));
reset role;
-- the manager changes the sector at the same time from an OLD page: stale; the manager sees the fresh data and the founder's edits are in the history
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select v60_test.bump('companies', format('id = %L', :'c4'));
select v60_test.fails('V13 the manager''s old copy of the company (loaded before the founder saved) is refused: neither side overwrites the other silently', format($q$select public.save_alumni_company(%L, '{"stage":"revenue"}'::jsonb, %L::timestamptz)$q$, :'c4', :'ctok4'), 'P0001', 'alumni_stale');
select v60_test.val('V14 the manager reads the founder''s changes: description, location, legal status and the new profile fields, with the stamps: founder on basics, location and classification (the legal status is his), manager on the online section', format($q$select concat_ws('|', c->'company'->>'description_en', c->'company'->>'governorate', c->'company'->>'legal_status', c->'company'->>'sector',
  s->'sections'->'basics'->>'source', s->'sections'->'location'->>'source', s->'sections'->'classification'->>'source', s->'sections'->'online'->>'source')
  from (select public.get_alumni_company(%L) c, public.get_alumni_stamps(%L) s) x$q$, :'c4', :'c4'), 'We build things|25|llc|technology|founder|founder|founder|manager');
select v60_test.val('V15 and the history shows who wrote what: the founder''s legal status entry, the manager''s sector entry', format($q$select string_agg(r->>'field' || ':' || (r->>'source'), ',' order by r->>'field') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('company_id', %L, 'entity_type', 'company'))->'rows') r
  where r->>'field' in ('legal_status', 'sector', 'description_en')$q$, :'c4'), 'description_en:founder,legal_status:founder,sector:manager');
select v60_test.val('V16 the founder''s own profile edit is in the history of the founder (education: founder; the manager''s earlier typing: manager)', format($q$select string_agg(r->>'field' || ':' || (r->>'source'), ',' order by r->>'field', r->>'source') from jsonb_array_elements(public.list_alumni_history(jsonb_build_object('founder_id', %L))->'rows') r
  where r->>'field' in ('education_status', 'phone', 'bio_en')$q$, :'r4'), 'bio_en:founder,education_status:founder,phone:manager');
select v60_test.val('V17 the queue now: the invited company lost every item the founder completed (3 left: logo, startup type, sub sector)', $q$select string_agg(m, ',' order by m) from jsonb_array_elements_text(public.list_alumni_attention('{"q":"v60 invited co"}'::jsonb)->'rows'->0->'missing') m$q$, 'logo,startup_type,subsector');
select v60_test.val('V18 as of "before the founder saved" (a time taken just before), the company had no description and the replay shows it', format($q$select coalesce(public.alumni_state_as_of(%L::uuid, %L::timestamptz)->'fields'->>'company.description_en', 'none') || '|' || coalesce(public.alumni_state_as_of(%L::uuid)->'fields'->>'company.description_en', 'none')$q$, :'c4', :'t_pre4', :'c4'), 'none|We build things');
reset role;
-- the second path: an account that exists without a founders row (the e-mail clashed at sign-up) accepts the invitation later and takes the record over
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select (public.save_company_team_member(:'c4', null, '{"name_en":"V60 Second Invitee","role":"CTO","email":"zz-v60-inv2@example.invalid","self_gender":"female"}'::jsonb)->>'founder_id') as r42 \gset
select (public.create_alumni_invitation(:'c4', 'zz-v60-inv2@example.invalid', 'en', 'https://app.example.test')->>'token') as tok42 \gset
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e607','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-inv2@example.invalid','{}', jsonb_build_object('full_name', 'V60 Second Signup'), now(), now());
select v60_test.val('V19 signed up WITHOUT the invitation token: the e-mail clashes with the record, so the account has the role but no founders row yet (the record is untouched)', format($q$select concat_ws('|', (select count(*) from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e607')::text, (select (auth_user_id is null)::text from public.founders where id = %L),
  (select count(*) from public.user_roles where user_id = '00000000-0000-4000-8000-00000000e607' and role_key = 'founder')::text)$q$, :'r42'), '0|true|1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e607","role":"authenticated"}', true);
set local role authenticated;
select v60_test.val('V20 accept_invitation: the account TAKES THE RECORD OVER (gender self-declared by the manager is still there), one company membership, no duplicate', format($q$select (public.accept_invitation(%L)->>'accepted')$q$, :'tok42'), 'true');
reset role;
select v60_test.val('V21 ... verified: the record now belongs to the account, nothing duplicated', format($q$select concat_ws('|', (select (auth_user_id = '00000000-0000-4000-8000-00000000e607')::text from public.founders where id = %L), (select count(*) from public.founders where lower(email::text) = 'zz-v60-inv2@example.invalid')::text,
  (select count(*) from public.company_founders where founder_id = %L)::text, (select self_gender from public.founder_identities where founder_id = %L))$q$, :'r42', :'r42', :'r42'), 'true|1|1|female');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e601","role":"authenticated"}', true);
set local role authenticated;
select (public.save_company_team_member('00000000-0000-4000-8000-00000000c602', null, '{"name_en":"V60 Foreign Record","email":"zz-v60-inv3@example.invalid"}'::jsonb)->>'founder_id') as r43 \gset
select (public.create_alumni_invitation(:'c4', 'zz-v60-inv3@example.invalid', 'en', 'https://app.example.test')->>'token') as tok43 \gset
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e608','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-inv3@example.invalid','{}', jsonb_build_object('full_name', 'V60 Third Signup', 'invitation_token', :'tok43'), now(), now());
select v60_test.val('V23 ... the foreign record stays without an account, the signing-up person has NO founders row (the clash is not resolved by guessing), the invitation stays pending', format($q$select concat_ws('|', (select (auth_user_id is null)::text from public.founders where id = %L),
  (select count(*) from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e608')::text, (select status from public.alumni_invitations where company_id = %L and lower(founder_email) = 'zz-v60-inv3@example.invalid'))$q$, :'r43', :'c4'), 'true|0|pending');
-- a normal sign-up is unchanged
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e610','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v60-plain@example.invalid','{}', jsonb_build_object('full_name', 'V60 Plain Signup'), now(), now());
select v60_test.val('V24 a plain open sign-up still gets the founder role and a founders row (no regression of handle_new_user)', $q$select (select count(*) from public.user_roles where user_id = '00000000-0000-4000-8000-00000000e610' and role_key = 'founder')::text || ':' || (select count(*) from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e610')::text$q$, '1:1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e610","role":"authenticated"}', true);
set local role authenticated;
select v60_test.fails('V26 a founder cannot link his account to another founders row by a direct UPDATE (no privilege)', format($q$update public.founders set auth_user_id = '00000000-0000-4000-8000-00000000e610' where id = %L$q$, :'r43'), '42501');
reset role;

-- ================================================================= final state check
select current_setting('v60.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v60: alumni edit history tests FAILED'; end $$;
\endif
