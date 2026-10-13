-- v32_agenda  (m32: Agenda node + view page RPCs)  Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin, U2 = temporary founder (participant), U3 = founder without participation.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v32.res', '', false) \gset

begin;
create schema v32_test;
grant usage on schema v32_test to public;
create or replace function v32_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v32.res', current_setting('v32.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v32_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v32_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v32_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v32_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v32_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v32_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v32_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v32_test.t(p_key, true, 'ok');
  exception when others then
    perform v32_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v32_test from public;
grant execute on all functions in schema v32_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v32_test.val('C01 m32 functions exist', $q$select (to_regprocedure('app_private.agenda_public_config(jsonb)') is not null and to_regprocedure('public.list_founder_agendas(uuid)') is not null and to_regprocedure('public.get_public_tab(text,uuid,jsonb)') is not null)::text$q$, 'true');
select v32_test.val('C02 m32 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('agenda_public_config','list_founder_agendas','get_public_tab','get_agenda_view') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v32_test.val('C03 anon cannot execute the founder RPC nor the helper', $q$select (has_function_privilege('anon','public.list_founder_agendas(uuid)','EXECUTE') or has_function_privilege('anon','app_private.agenda_public_config(jsonb)','EXECUTE'))::text$q$, 'false');
select v32_test.val('C04 anon can execute get_public_tab and get_agenda_view', $q$select (has_function_privilege('anon','public.get_public_tab(text,uuid,jsonb)','EXECUTE') and has_function_privilege('anon','public.get_agenda_view(text)','EXECUTE'))::text$q$, 'true');
select v32_test.val('C05 whitelist drops legacySheetUrl and unknown header keys', $q$select app_private.agenda_public_config('{"legacySheetUrl":"x","showDayNames":false,"header":{"brandName":"B","fontFamily":"f","dim":0.4},"theme":{"accent":"#1a27c9","x":1}}'::jsonb)::text$q$, '{"theme": {"accent": "#1a27c9"}, "header": {"dim": 0.4, "brandName": "B"}, "showDayNames": false}');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000a0d2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v32-admin@example.invalid','{"provisioned":true}','{"full_name":"V32 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000a0f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v32-founder@example.invalid','{"provisioned":true}','{"full_name":"V32 Founder"}', now(), now()),
 ('00000000-0000-4000-8000-00000000a0f3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v32-other@example.invalid','{"provisioned":true}','{"full_name":"V32 Other"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000a0d2','super_admin'), ('00000000-0000-4000-8000-00000000a0f2','founder'), ('00000000-0000-4000-8000-00000000a0f3','founder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d2","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V32 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V32 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.add_node(:'proj', 'agenda', '{"en":"V32 Agenda","ar":"أجندة"}', 0, 0, '{}')).id as ag \gset
select (public.add_node(:'proj', 'list', '{"en":"V32 Experts"}', 0, 0, '{"subkind":"expert"}')).id as lst \gset
select (public.save_node(:'ag', 1, '{"config":{"showDayNames":false,"legacySheetUrl":"https://docs.google.com/x","header":{"brandName":"Brand X","title":{"en":"Welcome","ar":"أهلاً"},"fontFamily":"legacy"},"theme":{"accent":"#1a27c9"}}}'::jsonb,
  '{"days":[{"sort_order":1,"day_date":"2026-11-03","name_en":"Day 1","name_ar":"اليوم الأول","slots":[{"sort_order":1,"start_time":"09:00","end_time":"09:45","title_en":"Opening","title_ar":"الافتتاح","presenter_en":"Ada","show_presenter":true,"bullets":[{"en":"Hello","ar":"مرحباً"}]},{"sort_order":2,"start_time":"10:00","end_time":"11:00","title_en":"Hidden presenter","presenter_en":"Ghost","show_presenter":false,"bullets":[]}]}]}'::jsonb))->>'rev' as rev1 \gset
select n.id as host from public.nodes n where n.project_id = :'proj' and n.type = 'view_host' \gset
select (public.connect(:'proj', :'ag', 'agenda', :'host', 'tabs', '{"audience":"public"}')).id as e1 \gset
select (public.connect(:'proj', :'lst', 'list-tab', :'ag', 'tabs', '{"audience":"public","label_en":"Mentors","label_ar":"المرشدون"}')).id as e2 \gset
select public.ensure_public_link(null, 'project', null, :'proj') as plink \gset
reset role;
select s.slug as pslug from public.public_link_slugs s where s.link_id = :'plink' and s.is_current \gset
update public.projects set visibility = 'public' where id = :'proj';
select v32_test.val('S01 save_children_agenda wrote 1 day and 2 slots', format($q$select (select count(*) from public.agenda_days where node_id='%s')::text || '/' || (select count(*) from public.agenda_slots s join public.agenda_days d on d.id=s.day_id where d.node_id='%s')::text$q$, :'ag', :'ag'), '1/2');

-- ================================================================= public tab through the project host (anon)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v32_test.val('P01 anon: private agenda is not served as a host tab (null)', format($q$select (public.get_public_tab('%s', '%s') is null)::text$q$, :'pslug', :'e1'), 'true');
reset role;
update public.nodes set visibility = 'public' where id = :'ag';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v32_test.val('P02 anon: agenda tab carries the whitelisted config (brand name round-trips)', format($q$select public.get_public_tab('%s', '%s')->'data'->'config'->'header'->>'brandName'$q$, :'pslug', :'e1'), 'Brand X');
select v32_test.val('P03 anon: legacySheetUrl and font keys never leak', format($q$select (select (not (c ? 'legacySheetUrl') and not (c->'header' ? 'fontFamily') and (c->'header'->'title'->>'ar') = 'أهلاً' and (c->>'showDayNames') = 'false') from (select public.get_public_tab('%s', '%s')->'data'->'config' c) x)::text$q$, :'pslug', :'e1'), 'true');
select v32_test.val('P04 anon: agenda tab carries the project timezone', format($q$select public.get_public_tab('%s', '%s')->'data'->>'timezone'$q$, :'pslug', :'e1'), 'Asia/Riyadh');
select v32_test.val('P05 anon: days and slots with HH:MM:SS times', format($q$select (select d->>'day_date' || ' ' || (d->'slots'->0->>'start_time') || '-' || (d->'slots'->0->>'end_time') || ' ' || jsonb_array_length(d->'slots')::text from (select public.get_public_tab('%s', '%s')->'data'->'days'->0 d) x)$q$, :'pslug', :'e1'), '2026-11-03 09:00:00-09:45:00 2');
select v32_test.val('P06 anon: show_presenter=false hides the presenter', format($q$select (public.get_public_tab('%s', '%s')->'data'->'days'->0->'slots'->1->>'presenter_en') is null$q$, :'pslug', :'e1'), 'true');
select v32_test.val('P07 anon: get_agenda_view of the host lists the agenda tab with the project zone', format($q$select (select (v->'host'->>'type') || ' ' || jsonb_array_length(v->'tabs')::text || ' ' || (v->'tabs'->0->>'view_key') || ' ' || (v->'project'->>'timezone') from (select public.get_agenda_view('%s') v) x)$q$, :'pslug'), 'view_host 1 agenda Asia/Riyadh');
select v32_test.val('P08 anon: a list tab connected to the agenda node is not a host tab', format($q$select (public.get_public_tab('%s', '%s') is null)::text$q$, :'pslug', :'e2'), 'true');
reset role;

-- ================================================================= the agenda node's OWN page (link kind agenda on the node)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d2","role":"authenticated"}', true);
set local role authenticated;
select public.ensure_public_link(:'ag', 'agenda', null, null) as alink \gset
reset role;
select s.slug as aslug from public.public_link_slugs s where s.link_id = :'alink' and s.is_current \gset
update public.nodes set visibility = 'public' where id = :'lst';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v32_test.val('A01 anon: the node link hosts the built-in agenda tab first, then the connected list tab with its label override', format($q$select (select (v->'host'->>'type') || ' ' || jsonb_array_length(v->'tabs')::text || ' ' || coalesce(v->'tabs'->0->>'edge_id','null') || ' ' || (v->'tabs'->1->>'title_en') || '/' || (v->'tabs'->1->>'title_ar') from (select public.get_agenda_view('%s') v) x)$q$, :'aslug'), 'agenda 2 null Mentors/المرشدون');
select v32_test.val('A02 anon: built-in tab payload (edge null) carries config + days', format($q$select (select (v->'data'->'config'->'header'->>'brandName') || ' ' || jsonb_array_length(v->'data'->'days')::text from (select public.get_public_tab('%s', null) v) x)$q$, :'aslug'), 'Brand X 1');
select v32_test.val('A03 anon: list tab through the agenda node carries config.kind', format($q$select public.get_public_tab('%s', '%s')->'data'->'config'->>'kind'$q$, :'aslug', :'e2'), 'expert');
reset role;
-- disabled edge disappears
update public.edges set is_enabled = false where id = :'e2';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v32_test.val('A04 anon: a disabled tab edge is not listed nor served', format($q$select jsonb_array_length(public.get_agenda_view('%s')->'tabs')::text || ' ' || (public.get_public_tab('%s', '%s') is null)::text$q$, :'aslug', :'aslug', :'e2'), '1 true');
reset role;
update public.edges set is_enabled = true where id = :'e2';

-- ================================================================= founder exposure (list_founder_agendas)
insert into public.participants (project_id, user_id, source, status) values (:'proj', '00000000-0000-4000-8000-00000000a0f2', 'manual', 'accepted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d2","role":"authenticated"}', true);
set local role authenticated;
select v32_test.val('F01 PM: nothing listed while show_to_participants is false', format($q$select jsonb_array_length(public.list_founder_agendas('%s'))::text$q$, :'proj'), '0');
-- the edges created above bumped the agenda's revision (edge triggers), so the token is read back (not :rev1)
select v32_test.okrun('F02 PM: expose the agenda to participants (save_node with the current rev token)', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{"show_to_participants": true}')$q$, :'ag', :'ag'));
select v32_test.val('F03 PM: listed once with the node''s own slug', format($q$select (select (v->0->>'name_en') || ' ' || (v->0->>'ref') || ' ' || (v->0->>'via') from (select public.list_founder_agendas('%s') v) x)$q$, :'proj'), 'V32 Agenda ' || :'aslug' || ' node');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0f2","role":"authenticated"}', true);
set local role authenticated;
select v32_test.val('F04 participant founder: sees the exposed agenda', format($q$select jsonb_array_length(public.list_founder_agendas('%s'))::text$q$, :'proj'), '1');
select v32_test.val('F05 participant founder: a PUBLIC agenda answers viewer public (pm is for managers only)', format($q$select public.get_agenda_view('%s')->>'viewer'$q$, :'aslug'), 'public');
reset role;
update public.nodes set visibility = 'platform' where id = :'ag';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0f2","role":"authenticated"}', true);
set local role authenticated;
select v32_test.val('F06 participant founder: platform agenda -> viewer participant', format($q$select public.get_agenda_view('%s')->>'viewer'$q$, :'aslug'), 'participant');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v32_test.val('F07 anon: platform agenda not served', format($q$select (public.get_agenda_view('%s') is null)::text$q$, :'aslug'), 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0f3","role":"authenticated"}', true);
set local role authenticated;
select v32_test.fails('F08 founder without participation: forbidden', format($q$select public.list_founder_agendas('%s')$q$, :'proj'), '42501');
reset role;
-- host fallback: remove the node link -> the project page link is offered when the agenda is a tab of the host
delete from public.public_link_slugs where link_id = :'alink';
delete from public.public_links where id = :'alink';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0f2","role":"authenticated"}', true);
set local role authenticated;
select v32_test.val('F09 participant founder: falls back to the project page link (via host)', format($q$select (select (v->0->>'ref') || ' ' || (v->0->>'via') from (select public.list_founder_agendas('%s') v) x)$q$, :'proj'), :'pslug' || ' host');
reset role;
update public.nodes set visibility = 'private' where id = :'ag';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0f2","role":"authenticated"}', true);
set local role authenticated;
select v32_test.val('F10 participant founder: a private agenda is never listed even when exposed', format($q$select jsonb_array_length(public.list_founder_agendas('%s'))::text$q$, :'proj'), '0');
reset role;

select current_setting('v32.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v32: agenda RPC tests FAILED'; end $$;
\endif
