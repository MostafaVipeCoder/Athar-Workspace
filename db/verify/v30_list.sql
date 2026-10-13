-- v30_list  (m30: Lists node RPCs)  Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v30.res', '', false) \gset

begin;
create schema v30_test;
grant usage on schema v30_test to public;
create or replace function v30_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v30.res', current_setting('v30.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v30_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v30_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v30_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v30_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v30_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v30_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v30_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v30_test.t(p_key, true, 'ok');
  exception when others then
    perform v30_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v30_test from public;
grant execute on all functions in schema v30_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v30_test.val('C01 m30 functions exist', $q$select (to_regprocedure('public.update_manual_item(uuid,jsonb)') is not null and to_regprocedure('public.delete_list_item(uuid)') is not null and to_regprocedure('public.get_public_list(text,jsonb)') is not null and to_regprocedure('app_private.list_public_payload(public.nodes,jsonb,jsonb)') is not null)::text$q$, 'true');
select v30_test.val('C02 m30 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('update_manual_item','delete_list_item','get_public_list','list_public_payload','get_public_tab') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v30_test.val('C03 anon cannot execute the write RPCs', $q$select (has_function_privilege('anon','public.update_manual_item(uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.delete_list_item(uuid)','EXECUTE') or has_function_privilege('anon','app_private.list_public_payload(public.nodes,jsonb,jsonb)','EXECUTE'))::text$q$, 'false');
select v30_test.val('C04 anon can execute get_public_list and get_public_tab', $q$select (has_function_privilege('anon','public.get_public_list(text,jsonb)','EXECUTE') and has_function_privilege('anon','public.get_public_tab(text,uuid,jsonb)','EXECUTE'))::text$q$, 'true');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000a0d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v30-admin@example.invalid','{"provisioned":true}','{"full_name":"V30 Admin"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000a0d1','super_admin');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d1","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V30 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V30 Project', null, 'Africa/Cairo')).id as proj \gset
select (public.add_node(:'proj', 'list', '{"en":"V30 Experts"}', 0, 0, '{"subkind":"expert"}')).id as lst \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V30 Form"}', 0, 0, '{}')).id as frm \gset
select public.add_manual_item(:'lst', '{"title_en":"Manual One","email":"m1@example.invalid"}') as man \gset
select public.add_network_pick(:'lst', (select id from public.network_experts where deleted_at is null order by created_at limit 1)) as pick \gset
reset role;
insert into public.form_responses (id, project_id, node_id, answers) values ('00000000-0000-4000-8000-00000000a0f1', :'proj', :'frm', '{"company_name":"Resp Co","founder_email":"f@example.invalid"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d1","role":"authenticated"}', true);
set local role authenticated;
select (public.connect(:'proj', :'frm', 'responses', :'lst', 'items-in', '{}')).id as e1 \gset
select public.ensure_item(:'lst', 'form_response', '00000000-0000-4000-8000-00000000a0f1') as fed \gset

-- ================================================================= manual item edit / delete rules (as U1)
select v30_test.okrun('M01 update_manual_item on a manual item', format($q$select public.update_manual_item('%s', '{"title_en":"Manual Two","title_ar":"يدوي","email":null}')$q$, :'man'));
reset role;
select v30_test.val('M02 manual fields replaced, nulls stripped', format($q$select manual_fields::text from public.list_items where id='%s'$q$, :'man'), '{"title_ar": "يدوي", "title_en": "Manual Two"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d1","role":"authenticated"}', true);
set local role authenticated;
select v30_test.fails('M03 update_manual_item refuses a pick', format($q$select public.update_manual_item('%s', '{"title_en":"x"}')$q$, :'pick'), '22023');
select v30_test.fails('M04 update_manual_item refuses a non-object', format($q$select public.update_manual_item('%s', '"x"')$q$, :'man'), '22023');
select v30_test.fails('M05 delete_list_item refuses a form-fed item', format($q$select public.delete_list_item('%s')$q$, :'fed'), '22023');
select v30_test.val('M06 resolve_list sees 3 items', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'lst'), '3');
select v30_test.okrun('M07 delete_list_item removes a pick', format($q$select public.delete_list_item('%s')$q$, :'pick'));
select v30_test.okrun('M08 delete_list_item removes a manual item', format($q$select public.delete_list_item('%s')$q$, :'man'));
select v30_test.val('M09 one item left (the form-fed one)', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'lst'), '1');
select public.add_manual_item(:'lst', '{"title_en":"Manual Three"}') as man2 \gset

-- ================================================================= public list page (anon through a view link)
select public.ensure_public_link(:'lst', 'view', 'list-tab', null) as link \gset
reset role;
select s.slug as slug from public.public_link_slugs s where s.link_id = :'link' and s.is_current \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v30_test.val('P01 anon: private list is not served (null)', format($q$select (public.get_public_list('%s') is null)::text$q$, :'slug'), 'true');
reset role;
update public.nodes set visibility = 'public' where id = :'lst';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v30_test.val('P02 anon: public list served with 2 items', format($q$select jsonb_array_length(public.get_public_list('%s')->'data'->'items')::text$q$, :'slug'), '2');
select v30_test.val('P03 anon: items carry no contact/overlay/status/fields', format($q$select (select bool_and(not (i ? 'contact') and not (i ? 'overlay') and not (i ? 'status') and not (i ? 'fields') and (i ? 'display') and (i ? 'card')) from jsonb_array_elements(public.get_public_list('%s')->'data'->'items') i)::text$q$, :'slug'), 'true');
select v30_test.val('P04 anon: payload carries kind and card config', format($q$select (public.get_public_list('%s')->'data'->'config'->>'kind')$q$, :'slug'), 'expert');
select v30_test.val('P05 anon: viewer audience is public', format($q$select public.get_public_list('%s')->>'viewer'$q$, :'slug'), 'public');
select v30_test.val('P06 anon: unknown ref is null', $q$select (public.get_public_list('nope-nope') is null)::text$q$, 'true');
reset role;
-- a view link of another kind (agenda) never serves the list
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v30_test.val('P07 anon: get_public_tab with the list slug (not a host) is null', format($q$select (public.get_public_tab('%s', null) is null)::text$q$, :'slug'), 'true');
reset role;

-- ================================================================= list tab inside the project host (get_public_tab carries config)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d1","role":"authenticated"}', true);
set local role authenticated;
select n.id as host from public.nodes n where n.project_id = :'proj' and n.type = 'view_host' \gset
select (public.connect(:'proj', :'lst', 'list-tab', :'host', 'tabs', '{}')).id as e2 \gset
select public.ensure_public_link(null, 'project', null, :'proj') as plink \gset
reset role;
select s.slug as pslug from public.public_link_slugs s where s.link_id = :'plink' and s.is_current \gset
update public.projects set visibility = 'public' where id = :'proj';
update public.edges set audience = 'public' where id = :'e2';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v30_test.val('T01 anon: list tab through the host carries config.kind', format($q$select public.get_public_tab('%s', '%s')->'data'->'config'->>'kind'$q$, :'pslug', :'e2'), 'expert');
select v30_test.val('T02 anon: list tab items whitelisted', format($q$select (select bool_and(not (i ? 'contact') and not (i ? 'overlay') and not (i ? 'status')) from jsonb_array_elements(public.get_public_tab('%s', '%s')->'data'->'items') i)::text$q$, :'pslug', :'e2'), 'true');
select v30_test.val('T03 anon: agenda view lists the tab', format($q$select jsonb_array_length(public.get_agenda_view('%s')->'tabs')::text$q$, :'pslug'), '1');
reset role;

select current_setting('v30.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v30: list RPC tests FAILED'; end $$;
\endif
