-- v35_distribution  (m35: Mentoring Distribution RPCs)  Role-switch tests inside ONE transaction that is ROLLED BACK.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin, U2 = temporary founder (not a PM); public calls run as anon.
-- NOTE (PROGRESS, local stack): a PM-guarded SECURITY DEFINER function that is EXECUTED under `set local role anon` can crash the local Postgres 17.6
-- container. Every PM function below is therefore proven closed to anon through the privilege catalog (and the call is refused before it runs).
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v35.res', '', false) \gset

begin;
create schema v35_test;
grant usage on schema v35_test to public;
create or replace function v35_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v35.res', current_setting('v35.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v35_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v35_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v35_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v35_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare h text;
begin
  begin
    execute p_sql;
    perform v35_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    perform v35_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or h = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(h, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v35_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v35_test.t(p_key, true, 'ok');
  exception when others then
    perform v35_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v35_test from public;
grant execute on all functions in schema v35_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v35_test.val('C01 m35 functions exist', $q$select (to_regprocedure('public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)') is not null and to_regprocedure('public.set_distribution_session_companies(uuid,jsonb)') is not null and to_regprocedure('public.set_distribution_day_lock(uuid,boolean)') is not null and to_regprocedure('public.set_distribution_published(uuid,boolean)') is not null and to_regprocedure('public.distribution_timer_control(uuid,text,jsonb)') is not null and to_regprocedure('public.get_distribution_payload(uuid)') is not null and to_regprocedure('public.get_distribution_timer_state(uuid)') is not null and to_regprocedure('public.get_distribution_view(text,text)') is not null and to_regprocedure('public.get_distribution_timer(text)') is not null and to_regprocedure('app_private.save_children_distribution(uuid,jsonb)') is not null and to_regprocedure('app_private.distribution_payload(uuid,boolean)') is not null)::text$q$, 'true');
select v35_test.val('C02 m35 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('replace_distribution_sessions','set_distribution_session_companies','set_distribution_day_lock','set_distribution_published','distribution_timer_control','get_distribution_payload','get_distribution_timer_state','get_distribution_view','get_distribution_timer','save_children_distribution','distribution_payload','distribution_eff','distribution_slots','distribution_timer_json','distribution_resolve','get_agenda_view','get_public_tab') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v35_test.val('C03 anon executes only the read-only public RPCs (+ the existing public tab/agenda view), never a PM or control function', $q$select (has_function_privilege('anon','public.get_distribution_view(text,text)','EXECUTE') and has_function_privilege('anon','public.get_distribution_timer(text)','EXECUTE') and has_function_privilege('anon','public.get_public_tab(text,uuid,jsonb)','EXECUTE') and has_function_privilege('anon','public.get_agenda_view(text)','EXECUTE') and not has_function_privilege('anon','public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)','EXECUTE') and not has_function_privilege('anon','public.set_distribution_session_companies(uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.set_distribution_day_lock(uuid,boolean)','EXECUTE') and not has_function_privilege('anon','public.set_distribution_published(uuid,boolean)','EXECUTE') and not has_function_privilege('anon','public.distribution_timer_control(uuid,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.get_distribution_payload(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_distribution_timer_state(uuid)','EXECUTE') and not has_function_privilege('anon','app_private.distribution_payload(uuid,boolean)','EXECUTE') and not has_function_privilege('authenticated','app_private.distribution_payload(uuid,boolean)','EXECUTE') and not has_function_privilege('authenticated','app_private.save_children_distribution(uuid,jsonb)','EXECUTE'))::text$q$, 'true');
select v35_test.val('C04 distribution_timers: RLS enabled + forced, read-only for clients (no insert/update/delete grant, none for anon)', $q$select (c.relrowsecurity and c.relforcerowsecurity and not has_table_privilege('authenticated','public.distribution_timers','INSERT') and not has_table_privilege('authenticated','public.distribution_timers','UPDATE') and not has_table_privilege('authenticated','public.distribution_timers','DELETE') and not has_table_privilege('anon','public.distribution_timers','SELECT') and has_table_privilege('authenticated','public.distribution_timers','SELECT'))::text from pg_class c where c.oid = 'public.distribution_timers'::regclass$q$, 'true');
select v35_test.val('C05 node_types.distribution.save_children_fn', $q$select save_children_fn from public.node_types where key = 'distribution'$q$, 'save_children_distribution');
select v35_test.val('C06 slots per round = (total + gap) / (slot + gap), 01-7', $q$select (app_private.distribution_slots(130,30,0))::text || '/' || (app_private.distribution_slots(120,10,0))::text || '/' || (app_private.distribution_slots(55,20,5))::text || '/' || (app_private.distribution_slots(0,20,5))::text || '/' || (app_private.distribution_slots(60,20,5))::text$q$, '4/12/2/0/2');
select v35_test.val('C07 migrated data untouched (the two migrated nodes): 2 distributions, 9 days, 139 day mentors, 3 rules, 716 sessions, no timers, rooms all NULL', $q$with mig as (select node_id from public.distributions where node_id in ('4d1f85e3-17dd-5c42-9fd4-6b8ea29a4baa','55f0719b-9347-57a8-84b5-6d2e5011cbe9')) select (select count(*) from mig)::text || '/' || (select count(*) from public.distribution_days where node_id in (select node_id from mig)) || '/' || (select count(*) from public.distribution_day_mentors m join public.distribution_days d on d.id = m.day_id where d.node_id in (select node_id from mig)) || '/' || (select count(*) from public.distribution_mentor_rules where node_id in (select node_id from mig)) || '/' || (select count(*) from public.distribution_sessions where node_id in (select node_id from mig)) || '/' || (select count(*) from public.distribution_timers where node_id in (select node_id from mig)) || '/' || (select count(*) from public.distribution_mentor_rules where node_id in (select node_id from mig) and room is not null)$q$, '2/9/139/3/716/0/0');
select v35_test.val('C08 migrated payload: 716 sessions reachable through the builder (public variant hides ids and PM fields)', $q$select ((select sum(jsonb_array_length(app_private.distribution_payload(node_id, false)->'sessions')) from public.distributions where node_id in ('4d1f85e3-17dd-5c42-9fd4-6b8ea29a4baa','55f0719b-9347-57a8-84b5-6d2e5011cbe9')) = 716 and not (app_private.distribution_payload('55f0719b-9347-57a8-84b5-6d2e5011cbe9', false)->'sessions'->0 ? 'id') and (app_private.distribution_payload('55f0719b-9347-57a8-84b5-6d2e5011cbe9', true)->'sessions'->0 ? 'id'))::text$q$, 'true');
select v35_test.val('C09 migrated view links resolve (slug) and the legacy project id resolves to the same node', $q$select ((select node_id from app_private.distribution_resolve('44d058922b', array['matrix'])) = '55f0719b-9347-57a8-84b5-6d2e5011cbe9' and (select node_id from app_private.distribution_resolve('bdf987a0-493e-4e0c-9514-e8c1390f2e6c', array['live'])) = '55f0719b-9347-57a8-84b5-6d2e5011cbe9')::text$q$, 'true');

-- ================================================================= setup (as postgres + U1)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000d351','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v35-admin@example.invalid','{"provisioned":true}','{"full_name":"V35 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d352','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v35-founder@example.invalid','{}','{"full_name":"V35 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000d351','super_admin') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d351","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V35 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V35 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors"}', 0, 0, '{"subkind":"expert"}')).id as lm \gset
select (public.add_node(:'proj', 'list', '{"en":"Companies"}', 0, 0, '{"subkind":"company"}')).id as lc \gset
select (public.add_node(:'proj', 'distribution', '{"en":"Mentoring"}', 0, 0, '{}')).id as ds \gset
select (public.add_node(:'proj', 'agenda', '{"en":"Agenda"}', 0, 0, '{}')).id as ag \gset
select public.add_manual_item(:'lm', '{"title_en":"Mentor A"}') as m1 \gset
select public.add_manual_item(:'lm', '{"title_en":"Mentor B"}') as m2 \gset
select public.add_manual_item(:'lm', '{"title_en":"Mentor C"}') as m3 \gset
select public.add_manual_item(:'lc', '{"title_en":"Company 1"}') as c1 \gset
select public.add_manual_item(:'lc', '{"title_en":"Company 2"}') as c2 \gset
select public.add_manual_item(:'lc', '{"title_en":"Company 3"}') as c3 \gset
select public.add_manual_item(:'lc', '{"title_en":"Company 4"}') as c4 \gset
select v35_test.val('S01 add_node created the distributions row with the defaults', format($q$select slot_duration_min::text || '/' || gap_min || '/' || unique_pairing || '/' || is_published from public.distributions where node_id = '%s'$q$, :'ds'), '20/5/true/false');

-- ================================================================= configuration through save_node children
select rev as rv from public.node_revisions where node_id = :'ds' \gset
select v35_test.fails('T01 slot duration out of range is refused', format($q$select public.save_node('%s', %s, '{}'::jsonb, '{"settings":{"slot_duration_min":0}}'::jsonb)$q$, :'ds', :'rv'), '22023', 'distribution_invalid');
select v35_test.fails('T02 a mentor that is not an item of the project is refused', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('days', jsonb_build_array(jsonb_build_object('day_index', 0, 'start_time', '10:00', 'total_round_min', 60, 'mentor_item_ids', jsonb_build_array('00000000-0000-4000-8000-0000000000ff')))))$q$, :'ds', :'rv'), '22023', 'distribution_invalid');
select v35_test.fails('T03 a mentor window that ends before it starts is refused', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('rules', jsonb_build_array(jsonb_build_object('mentor_item_id', '%s', 'available_from', '12:00', 'available_to', '11:00'))))$q$, :'ds', :'rv', :'m1'), '22023', 'distribution_invalid');
select v35_test.val('T04 ONE save writes settings + two days + their mentors + two rules and bumps the revision once', format($q$select (public.save_node('%s', %s, '{"visibility":"public"}'::jsonb, jsonb_build_object(
   'settings', jsonb_build_object('slot_duration_min', 20, 'gap_min', 0, 'start_time', '10:00', 'unique_pairing', true),
   'days', jsonb_build_array(
     jsonb_build_object('day_index', 0, 'day_date', '2026-10-12', 'start_time', '10:00', 'total_round_min', 60, 'mentor_item_ids', jsonb_build_array('%s','%s','%s')),
     jsonb_build_object('day_index', 1, 'day_date', '2026-10-13', 'start_time', '09:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s'))),
   'rules', jsonb_build_array(
     jsonb_build_object('mentor_item_id', '%s', 'available_from', '10:20', 'max_slots', 1, 'room', 'Table 3'),
     jsonb_build_object('mentor_item_id', '%s', 'room', 'Room B'))))->>'rev')::int = %s + 1$q$, :'ds', :'rv', :'m1', :'m2', :'m3', :'m1', :'m2', :'m3', :'m2', :'rv')::text, 'true');
select id as day1 from public.distribution_days where node_id = :'ds' and day_index = 0 \gset
select id as day2 from public.distribution_days where node_id = :'ds' and day_index = 1 \gset
select v35_test.val('T05 days, day mentors and rules were stored', format($q$select (select count(*) from public.distribution_days where node_id = '%s')::text || '/' || (select count(*) from public.distribution_day_mentors m join public.distribution_days d on d.id = m.day_id where d.node_id = '%s') || '/' || (select count(*) from public.distribution_mentor_rules where node_id = '%s') || '/' || (select room from public.distribution_mentor_rules where node_id = '%s' and mentor_item_id = '%s')$q$, :'ds', :'ds', :'ds', :'ds', :'m3'), '2/5/2/Table 3');
select rev as rv from public.node_revisions where node_id = :'ds' \gset
select v35_test.okrun('T07 swap the day order and put it back', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('days', jsonb_build_array(
     jsonb_build_object('id', '%s', 'day_index', 1, 'day_date', '2026-10-12', 'start_time', '10:00', 'total_round_min', 60, 'mentor_item_ids', jsonb_build_array('%s','%s','%s')),
     jsonb_build_object('id', '%s', 'day_index', 0, 'day_date', '2026-10-13', 'start_time', '09:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s')))))$q$, :'ds', :'rv', :'day1', :'m1', :'m2', :'m3', :'day2', :'m1', :'m2'));
select rev as rv from public.node_revisions where node_id = :'ds' \gset
select v35_test.okrun('T08 and back', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('days', jsonb_build_array(
     jsonb_build_object('id', '%s', 'day_index', 0, 'day_date', '2026-10-12', 'start_time', '10:00', 'total_round_min', 60, 'mentor_item_ids', jsonb_build_array('%s','%s','%s')),
     jsonb_build_object('id', '%s', 'day_index', 1, 'day_date', '2026-10-13', 'start_time', '09:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s')))))$q$, :'ds', :'rv', :'day1', :'m1', :'m2', :'m3', :'day2', :'m1', :'m2'));
select v35_test.val('T09 the stored order is back', format($q$select string_agg(case when id = '%s' then 'd1' else 'd2' end, ',' order by day_index) from public.distribution_days where node_id = '%s'$q$, :'day1', :'ds'), 'd1,d2');

-- ================================================================= generation persistence: server-side validation of every row
select format('{"day_id":"%s","slot_index":%%s,"mentor_item_id":"%s","company_item_id":%%s,"is_manual_override":false}', :'day1', :'m1') as row_m1 \gset
-- 3 slots x (m1,m2,m3): m3 only from slot 1 (10:20) and max 1 per day
select v35_test.val('G01 a valid generation is stored atomically with DB ids; the seed is kept', format($q$select (x->>'inserted') || '/' || (x->>'deleted') || '/' || (x->>'unmatched') from public.replace_distribution_sessions('%s', 'all', null, jsonb_build_array(
   jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id',null),
   jsonb_build_object('day_id','%s','slot_index',2,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s')), 777) x$q$,
   :'ds', :'day1', :'m1', :'c1', :'day1', :'m2', :'c2', :'day1', :'m1', :'c3', :'day1', :'m2', :'c4', :'day1', :'m3', :'day1', :'m1', :'c2', :'day2', :'m1', :'c4'), '7/0/1');
select v35_test.val('G02 sessions carry ids from creation; the seed was stored', format($q$select (select count(*) from public.distribution_sessions where node_id = '%s' and id is not null)::text || '/' || (select seed from public.distributions where node_id = '%s')::text$q$, :'ds', :'ds'), '7/777');
select v35_test.val('G03 revision bumped by the session writes', format($q$select (rev > %s)::text from public.node_revisions where node_id = '%s'$q$, :'rv', :'ds'), 'true');
select v35_test.fails('G04 a mentor before the start of their window (m3 from 10:20) is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m3', :'c1'), '22023', 'distribution_invalid');
select v35_test.fails('G05 more sessions than the mentor''s maximum per day (m3 max 1) is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s'), jsonb_build_object('day_id','%s','slot_index',2,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m3', :'c1', :'day1', :'m3', :'c2'), '22023', 'distribution_invalid');
select v35_test.fails('G06 a company in two rooms in one round is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'), jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m1', :'c1', :'day1', :'m2', :'c1'), '23505', 'distribution_company_double_booked');
select v35_test.fails('G07 a repeated pair is refused while unique pairing is on', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'), jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m1', :'c1', :'day1', :'m1', :'c1'), 'P0001', 'distribution_pair_repeated');
select v35_test.fails('G08 a slot beyond the round (day 1 has 3 rounds) is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',3,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m1', :'c1'), '22023', 'distribution_invalid');
select v35_test.fails('G09 a mentor that is not on that day is refused (day 2 has m1, m2)', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day2', :'day2', :'m3', :'c1'), '22023', 'distribution_invalid');
select v35_test.fails('G10 an unknown company is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','00000000-0000-4000-8000-0000000000fe')))$q$, :'ds', :'day1', :'day1', :'m1'), '22023', 'distribution_invalid');
select v35_test.val('G11 refused generations changed nothing', format($q$select count(*)::text from public.distribution_sessions where node_id = '%s'$q$, :'ds'), '7');

-- ================================================================= locked days (01-7: Generate never overwrites a locked day)
select v35_test.okrun('L01 lock day 1', format($q$select public.set_distribution_day_lock('%s', true)$q$, :'day1'));
select v35_test.fails('L02 a generation row for a locked day is refused', format($q$select public.replace_distribution_sessions('%s', 'all', null, jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'m1', :'c4'), 'P0001', 'distribution_day_locked');
select v35_test.fails('L03 naming a locked day as the target is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], '[]'::jsonb)$q$, :'ds', :'day1'), 'P0001', 'distribution_day_locked');
select v35_test.val('L04 a full generation (no target list) for the unlocked day leaves the locked day byte-identical', format($q$with before as (select md5(string_agg(id::text || slot_index || mentor_item_id || coalesce(company_item_id::text, ''), ',' order by id)) h from public.distribution_sessions where day_id = '%s'),
  g as (select public.replace_distribution_sessions('%s', 'all', null, jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s'))) r)
  select (b.h = (select md5(string_agg(id::text || slot_index || mentor_item_id || coalesce(company_item_id::text, ''), ',' order by id)) from public.distribution_sessions where day_id = '%s'))::text from before b, g$q$, :'day1', :'ds', :'day2', :'m2', :'c3', :'day1'), 'true');
select v35_test.fails('L05 the configuration of a locked day cannot change through save_node', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('days', jsonb_build_array(jsonb_build_object('id', '%s', 'day_index', 0, 'day_date', '2026-10-12', 'start_time', '10:00', 'total_round_min', 90, 'mentor_item_ids', jsonb_build_array('%s','%s','%s')), jsonb_build_object('id', '%s', 'day_index', 1, 'day_date', '2026-10-13', 'start_time', '09:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s')))))$q$, :'ds', (select rev from public.node_revisions where node_id = :'ds'), :'day1', :'m1', :'m2', :'m3', :'day2', :'m1', :'m2'), 'P0001', 'distribution_day_locked');
select v35_test.fails('L06 a locked day cannot be removed', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('days', jsonb_build_array(jsonb_build_object('id', '%s', 'day_index', 0, 'day_date', '2026-10-13', 'start_time', '09:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s')))))$q$, :'ds', (select rev from public.node_revisions where node_id = :'ds'), :'day2', :'m1', :'m2'), 'P0001', 'distribution_day_locked');
select v35_test.okrun('L07 saving the locked day UNCHANGED is fine', format($q$select public.save_node('%s', %s, '{}'::jsonb, jsonb_build_object('days', jsonb_build_array(jsonb_build_object('id', '%s', 'day_index', 0, 'day_date', '2026-10-12', 'start_time', '10:00', 'total_round_min', 60, 'mentor_item_ids', jsonb_build_array('%s','%s','%s')), jsonb_build_object('id', '%s', 'day_index', 1, 'day_date', '2026-10-13', 'start_time', '09:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s')))))$q$, :'ds', (select rev from public.node_revisions where node_id = :'ds'), :'day1', :'m1', :'m2', :'m3', :'day2', :'m1', :'m2'));

-- ================================================================= manual edits (swap / move / clear) with server-side validation
select id as sa from public.distribution_sessions where day_id = :'day1' and slot_index = 0 and mentor_item_id = :'m1' \gset
select id as sb from public.distribution_sessions where day_id = :'day1' and slot_index = 0 and mentor_item_id = :'m2' \gset
select v35_test.fails('M01 editing a session of a locked day is refused', format($q$select public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id',null)))$q$, :'ds', :'sa'), 'P0001', 'distribution_day_locked');
select v35_test.okrun('M02 unlock day 1', format($q$select public.set_distribution_day_lock('%s', false)$q$, :'day1'));
select v35_test.okrun('M03a swap two sessions in one call (transient uniqueness handled)', format($q$select public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id','%s'), jsonb_build_object('session_id','%s','company_item_id','%s')))$q$, :'ds', :'sa', :'c2', :'sb', :'c1'));
select v35_test.val('M03 the two cells swapped and both are flagged manual', format($q$select (select company_item_id::text from public.distribution_sessions where id = '%s') || '/' || (select company_item_id::text from public.distribution_sessions where id = '%s') || '/' || (select bool_and(is_manual_override)::text from public.distribution_sessions where id in ('%s','%s'))$q$, :'sa', :'sb', :'sa', :'sb'), :'c2' || '/' || :'c1' || '/true');
select id as sc from public.distribution_sessions where day_id = :'day1' and slot_index = 1 and mentor_item_id = :'m2' \gset
select v35_test.fails('M04 a company already in another room in that round is refused (c3 is with m1 in round 2)', format($q$select public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id','%s')))$q$, :'ds', :'sc', :'c3'), '23505', 'distribution_company_double_booked');
select v35_test.fails('M05 an unknown company is refused', format($q$select public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id','00000000-0000-4000-8000-0000000000fe')))$q$, :'ds', :'sc'), '22023', 'distribution_invalid');
select v35_test.fails('M06 a session of another node is refused', format($q$select public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000fd','company_item_id',null)))$q$, :'ds'), '22023', 'distribution_invalid');
select v35_test.val('M07 clearing a cell + Undo (restoring the manual flag) round-trips', format($q$select (public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id',null)))->>'applied') || '/' || (public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id','%s','is_manual_override',false)))->>'applied') || '/' || (select company_item_id::text = '%s' and not is_manual_override from public.distribution_sessions where id = '%s')$q$, :'ds', :'sc', :'ds', :'sc', :'c4', :'c4', :'sc'), '1/1/true');
select v35_test.val('M08 a repeated pair is allowed by hand but reported as a warning', format($q$select (x->'warnings'->0->>'code') from public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id','%s','company_item_id','%s'))) x$q$, :'ds', (select id from public.distribution_sessions where day_id = :'day1' and slot_index = 2 and mentor_item_id = :'m1'), :'c3'), 'repeat_pair');
select v35_test.val('M09 scope "unlocked" keeps the manual sessions and replaces the others', format($q$select (x->>'deleted') || '/' || (select count(*) from public.distribution_sessions where day_id = '%s' and is_manual_override)::text from public.replace_distribution_sessions('%s', 'unlocked', array['%s']::uuid[], '[]'::jsonb) x$q$, :'day1', :'ds', :'day1'), (select count(*) filter (where not is_manual_override)::text || '/' || count(*) filter (where is_manual_override)::text from public.distribution_sessions where day_id = :'day1'));

select count(*) as nsess from public.distribution_sessions where node_id = :'ds' \gset
-- ================================================================= publish gate + public payload (server enforced)
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d351","role":"authenticated"}', true);
set local role authenticated;
select v35_test.okrun('V00 public links for the two views and the agenda', format($q$select public.ensure_public_link('%s', 'view', 'matrix', null); select public.ensure_public_link('%s', 'view', 'live', null); select public.ensure_public_link('%s', 'agenda', null, null)$q$, :'ds', :'ds', :'ag'));
select (public.connect(:'proj', :'ds', 'sessions-tab', :'ag', 'tabs', '{}')).id as eid \gset
update public.edges set audience = 'public' where id = :'eid';
select rev as agrev from public.node_revisions where node_id = :'ag' \gset
select v35_test.okrun('V00b agenda host made public', format($q$select public.save_node('%s', %s, '{"visibility":"public"}'::jsonb)$q$, :'ag', :'agrev'));
select s.slug as slugm from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'ds' and l.kind = 'view' and l.view_key = 'matrix' \gset
select s.slug as slugl from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'ds' and l.kind = 'view' and l.view_key = 'live' \gset
select s.slug as slugag from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'ag' and l.kind = 'agenda' \gset
select v35_test.val('V01 PM payload carries ids, locks, own timing and the seed; names are resolved by reference', format($q$select (x->'sessions'->0 ? 'id')::text || '/' || (x->'days'->0 ? 'is_locked')::text || '/' || (x->'config'->>'seed') || '/' || (select string_agg(m->>'name_en' || ':' || coalesce(m->>'room', '-'), ',' order by m->>'name_en') from jsonb_array_elements(x->'mentors') m) from public.get_distribution_payload('%s') x$q$, :'ds'), 'true/true/777/Mentor A:-,Mentor B:Room B,Mentor C:Table 3');
select v35_test.fails('V02 the PM payload is refused to a non-PM', format($q$select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d352","role":"authenticated"}', true); select public.get_distribution_payload('%s')$q$, :'ds'), '42501');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d351","role":"authenticated"}', true);
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v35_test.val('V03 anon: a PUBLIC node that is NOT published answers only published:false (publish gate enforced in the DB, CON-17)', format($q$select (x->>'published') || '/' || (x ? 'sessions')::text || '/' || (x ? 'days')::text from public.get_distribution_view('%s', 'matrix') x$q$, :'slugm'), 'false/false/false');
select v35_test.val('V04 the live timer poll also reports unpublished', format($q$select (x->>'published') from public.get_distribution_timer('%s') x$q$, :'slugl'), 'false');
select v35_test.val('V05 get_public_tab refuses an unpublished distribution (the agenda host answers null)', format($q$select coalesce(public.get_public_tab('%s', '%s')::text, 'null')$q$, :'slugag', :'eid'), 'null');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d351","role":"authenticated"}', true);
set local role authenticated;
select v35_test.val('P01 publish touches ONLY the publish columns (as-is BUG-1: config columns were reset)', format($q$select (select slot_duration_min::text || '/' || gap_min || '/' || start_time || '/' || unique_pairing || '/' || seed from public.distributions where node_id = '%s')$q$, :'ds'), '20/0/10:00:00/true/777');
select v35_test.okrun('P02 set_distribution_published', format($q$select public.set_distribution_published('%s', true)$q$, :'ds'));
select v35_test.val('P02b published; publish_at set; the config columns are untouched', format($q$select is_published::text || '/' || (published_at is not null)::text || '/' || slot_duration_min || '/' || gap_min || '/' || start_time || '/' || unique_pairing || '/' || seed from public.distributions where node_id = '%s'$q$, :'ds'), 'true/true/20/0/10:00:00/true/777');
select count(distinct company_item_id) as ncomp from public.distribution_sessions where node_id = :'ds' \gset
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v35_test.val('P04 anon matrix: whitelisted payload (no ids, no PM fields, no seed), mentors/companies by reference', format($q$select (x->>'published') || '/' || (x->>'viewer') || '/' || jsonb_array_length(x->'sessions') || '/' || (x->'sessions'->0 ? 'id')::text || '/' || (x->'sessions'->0 ? 'manual')::text || '/' || coalesce(x->'config'->>'seed', 'null') || '/' || (x->'days'->0->>'is_locked' is null)::text || '/' || jsonb_array_length(x->'mentors') || '/' || jsonb_array_length(x->'companies') from public.get_distribution_view('%s', 'matrix') x$q$, :'slugm'), 'true/public/' || :'nsess' || '/false/false/null/true/3/' || :'ncomp');
select v35_test.val('P05 the view key is strict: the matrix slug is null as a live view and vice versa', format($q$select coalesce(public.get_distribution_view('%s', 'live')::text, 'null') || '/' || coalesce(public.get_distribution_view('%s', 'matrix')::text, 'null')$q$, :'slugm', :'slugl'), 'null/null');
select v35_test.val('P06 the legacy project id (the old /view/<event id>/mentoring/matrix link) resolves to the matrix link', format($q$select (x->>'node_id') from public.get_distribution_view('%s', 'matrix') x$q$, :'proj'), :'ds');
select v35_test.val('P07 the Agenda tab payload = the same builder (get_public_tab) and the default title of the second tab', format($q$select (x->>'type') || '/' || (x->'data'->>'published') || '/' || jsonb_array_length(x->'data'->'sessions') from public.get_public_tab('%s', '%s') x$q$, :'slugag', :'eid'), 'distribution/true/' || :'nsess');
select v35_test.val('P08 an anon founder-less visitor gets an empty my_company_ids', format($q$select (x->'data'->'my_company_ids')::text from public.get_public_tab('%s', '%s') x$q$, :'slugag', :'eid'), '[]');
reset role;
-- a private distribution answers null to anon (no existence leak), also through the legacy id
update public.nodes set visibility = 'private' where id = :'ds';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v35_test.val('P09 private node: null for anon on both views and the timer', format($q$select coalesce(public.get_distribution_view('%s', 'matrix')::text, 'null') || '/' || coalesce(public.get_distribution_timer('%s')::text, 'null')$q$, :'slugm', :'slugl'), 'null/null');
reset role;
update public.nodes set visibility = 'public' where id = :'ds';

-- ================================================================= the shared timer: PM-only control, server timestamps for everyone
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v35_test.val('K01 anon cannot control the timer: no EXECUTE on the control RPC (proven by the privilege catalog; executing it under anon crashes the local container, see the note at the top)', $q$select (not has_function_privilege('anon','public.distribution_timer_control(uuid,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.get_distribution_timer_state(uuid)','EXECUTE'))::text$q$, 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d352","role":"authenticated"}', true);
set local role authenticated;
select v35_test.fails('K02 a signed-in non-PM (the founder account) cannot control the timer', format($q$select public.distribution_timer_control('%s', 'start')$q$, :'ds'), '42501');
select v35_test.fails('K03 nor read the PM timer state, nor write the table', format($q$select public.get_distribution_timer_state('%s')$q$, :'ds'), '42501');
select v35_test.val('K03b the table is invisible to them (RLS) and cannot be written', format($q$select (select count(*) from public.distribution_timers)::text$q$), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d351","role":"authenticated"}', true);
set local role authenticated;
select v35_test.fails('K04 start before any round is picked', format($q$select public.distribution_timer_control('%s', 'start')$q$, :'ds'), 'P0001', 'timer_no_round');
select v35_test.fails('K05 unknown action', format($q$select public.distribution_timer_control('%s', 'explode')$q$, :'ds'), '22023', 'distribution_invalid');
select v35_test.fails('K06 a round outside the schedule', format($q$select public.distribution_timer_control('%s', 'set_round', jsonb_build_object('day_id', '%s', 'slot_index', 9))$q$, :'ds', :'day1'), '22023', 'distribution_invalid');
select v35_test.val('K07 set_round: paused at the full slot duration (20 min = 1200 s)', format($q$select (x->>'status') || '/' || (x->>'remaining_s') || '/' || (x->>'duration_s') || '/' || (x->>'slot_index') from public.distribution_timer_control('%s', 'set_round', jsonb_build_object('day_id', '%s', 'slot_index', 0)) x$q$, :'ds', :'day1'), 'paused/1200/1200/0');
select v35_test.val('K08 start: running, remaining computed from ends_at (about 1200 s)', format($q$select (x->>'status') || '/' || ((x->>'remaining_s')::int between 1195 and 1200)::text || '/' || (x->>'ends_at' is not null)::text from public.distribution_timer_control('%s', 'start') x$q$, :'ds'), 'running/true/true');
select v35_test.val('K09 adjust +60 on a running round moves ends_at', format($q$select ((x->>'remaining_s')::int between 1255 and 1260)::text from public.distribution_timer_control('%s', 'adjust', '{"seconds":60}') x$q$, :'ds'), 'true');
select v35_test.val('K10 pause keeps the remaining time (no ends_at), version increases', format($q$select (x->>'status') || '/' || ((x->>'remaining_s')::int between 1250 and 1260)::text || '/' || (x->>'ends_at' is null)::text || '/' || ((x->>'version')::int >= 4)::text from public.distribution_timer_control('%s', 'pause') x$q$, :'ds'), 'paused/true/true/true');
select v35_test.val('K11 adjust -90 on a paused round never goes below zero', format($q$select (x->>'remaining_s') from public.distribution_timer_control('%s', 'adjust', '{"seconds":-3600}') x$q$, :'ds'), '0');
select v35_test.fails('K12 adjust beyond an hour is refused', format($q$select public.distribution_timer_control('%s', 'adjust', '{"seconds":99999}')$q$, :'ds'), '22023', 'distribution_invalid');
select v35_test.val('K13 reset: the same round paused at the full duration', format($q$select (x->>'status') || '/' || (x->>'remaining_s') from public.distribution_timer_control('%s', 'reset') x$q$, :'ds'), 'paused/1200');
select v35_test.val('K14 next walks the whole schedule: round 2 of day 1', format($q$select (x->>'slot_index') || '/' || (x->>'day_id' = '%s')::text || '/' || (x->>'status') from public.distribution_timer_control('%s', 'next') x$q$, :'day1', :'ds'), '1/true/paused');
select v35_test.okrun('K15a next (paused) goes to round 3 of day 1', format($q$select public.distribution_timer_control('%s', 'next')$q$, :'ds'));
select v35_test.val('K15 next with run starts the following round at once (day 2 round 1)', format($q$select (x->>'slot_index') || '/' || (x->>'day_id' = '%s')::text || '/' || (x->>'status') || '/' || ((x->>'remaining_s')::int between 1195 and 1200)::text from public.distribution_timer_control('%s', 'next', '{"run":true}') x$q$, :'day2', :'ds'), '0/true/running/true');
select v35_test.okrun('K16a set_round to the last round of the last day', format($q$select public.distribution_timer_control('%s', 'set_round', jsonb_build_object('day_id', '%s', 'slot_index', 1))$q$, :'ds', :'day2'));
select v35_test.fails('K16 next past the last round of the last day', format($q$select public.distribution_timer_control('%s', 'next')$q$, :'ds'), 'P0001', 'timer_no_next');
select v35_test.val('K17 PM read of the state (the Edit Live tab poll)', format($q$select (x->>'status') || '/' || (x->>'slot_index') from public.get_distribution_timer_state('%s') x$q$, :'ds'), 'paused/1');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v35_test.val('K18 anon (viewer): the live view reads the SAME server timestamps (read-only)', format($q$select (x->>'status') || '/' || (x->>'slot_index') || '/' || (x->>'viewer') || '/' || (x ? 'server_now')::text || '/' || (x->>'remaining_s') from public.get_distribution_timer('%s') x$q$, :'slugl'), 'paused/1/public/true/1200');
select v35_test.val('K19 anon live payload carries the timer for the first paint', format($q$select (x->'timer'->>'status') from public.get_distribution_view('%s', 'live') x$q$, :'slugl'), 'paused');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d351","role":"authenticated"}', true);
set local role authenticated;
select v35_test.val('K20 clear: back to the wall clock', format($q$select (x->>'status') || '/' || coalesce(x->>'day_id', 'null') from public.distribution_timer_control('%s', 'clear') x$q$, :'ds'), 'idle/null');
reset role;

select current_setting('v35.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v35: distribution RPC tests FAILED'; end $$;
\endif
