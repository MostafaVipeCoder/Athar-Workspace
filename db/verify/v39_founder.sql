-- v39_founder  (m39: the founder Programs list + Program page block RPCs)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.
-- A = temporary super_admin (the PM), F1 = founder participant (accepted), F2 = founder participant (attended, gets a certificate),
-- F3 = founder who does NOT participate, F4 = founder participant `withdrawn`, F5 = founder participating through his COMPANY.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v39.res', '', false) \gset

begin;
create schema v39_test;
grant usage on schema v39_test to public;
create or replace function v39_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v39.res', current_setting('v39.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v39_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v39_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v39_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v39_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v39_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v39_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
revoke all on all functions in schema v39_test from public;
grant execute on all functions in schema v39_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v39_test.val('C01 m39 functions exist', $q$select (to_regprocedure('app_private.my_participation(uuid)') is not null and to_regprocedure('app_private.founder_project_dates(uuid)') is not null and to_regprocedure('public.list_my_programs(boolean)') is not null and to_regprocedure('public.get_founder_program_page(uuid)') is not null and to_regprocedure('public.get_founder_block(uuid,text,uuid,jsonb)') is not null)::text$q$, 'true');
select v39_test.val('C02 every m39 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('my_participation','founder_project_dates','list_my_programs','get_founder_program_page','get_founder_block') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v39_test.val('C03 anon executes NONE of them, authenticated executes only the three public RPCs', $q$select (not has_function_privilege('anon','public.list_my_programs(boolean)','EXECUTE') and not has_function_privilege('anon','public.get_founder_program_page(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_founder_block(uuid,text,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','app_private.my_participation(uuid)','EXECUTE') and not has_function_privilege('authenticated','app_private.my_participation(uuid)','EXECUTE') and not has_function_privilege('authenticated','app_private.founder_project_dates(uuid)','EXECUTE') and has_function_privilege('authenticated','public.list_my_programs(boolean)','EXECUTE') and has_function_privilege('authenticated','public.get_founder_program_page(uuid)','EXECUTE') and has_function_privilege('authenticated','public.get_founder_block(uuid,text,uuid,jsonb)','EXECUTE'))::text$q$, 'true');
select v39_test.val('C04 the migrated data is untouched (0 participants, 0 certificates in the MIGRATED projects: hermetic, throwaway rows committed by other sessions do not count)', $q$select (select count(*) from public.participants where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text || '/' || (select count(*) from public.certificates where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))$q$, '0/0');

-- ================================================================= fixtures
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000039a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-admin@example.invalid','{"provisioned":true}','{"full_name":"V39 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f1@example.invalid','{"provisioned":true}','{"full_name":"V39 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f2@example.invalid','{"provisioned":true}','{"full_name":"V39 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f3@example.invalid','{"provisioned":true}','{"full_name":"V39 Outsider"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f4@example.invalid','{"provisioned":true}','{"full_name":"V39 Withdrawn"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f5@example.invalid','{"provisioned":true}','{"full_name":"V39 Company Founder"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f6','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f6@example.invalid','{"provisioned":true}','{"full_name":"V39 Response Founder"}', now(), now()),
 ('00000000-0000-4000-8000-0000000039f7','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v39-f7@example.invalid','{"provisioned":true}','{"full_name":"V39 Unverified Founder"}', now(), now());
-- verified e-mails: the admin (a STAFF account), F6 and F3; F7 stays unverified
update auth.users set confirmation_sent_at = now() - interval '1 minute', email_confirmed_at = now() where id in ('00000000-0000-4000-8000-0000000039a0', '00000000-0000-4000-8000-0000000039f6', '00000000-0000-4000-8000-0000000039f3');
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000039a0','super_admin'), ('00000000-0000-4000-8000-0000000039f1','founder'),
  ('00000000-0000-4000-8000-0000000039f2','founder'), ('00000000-0000-4000-8000-0000000039f3','founder'), ('00000000-0000-4000-8000-0000000039f4','founder'), ('00000000-0000-4000-8000-0000000039f5','founder'),
  ('00000000-0000-4000-8000-0000000039f6','founder'), ('00000000-0000-4000-8000-0000000039f7','founder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V39 Program', 'برنامج اختبار', 'Program description', null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V39 Project', 'مشروع اختبار', 'Asia/Riyadh')).id as proj \gset
select (public.create_project(:'prog', 'V39 Empty project', null, 'Asia/Riyadh')).id as proj2 \gset
select (public.create_project(:'prog', 'V39 Foreign project', null, 'Asia/Riyadh')).id as proj3 \gset
select (public.add_node(:'proj', 'agenda', '{"en":"V39 Agenda","ar":"الأجندة"}', 0, 0, '{}')).id as ag \gset
select (public.add_node(:'proj', 'agenda', '{"en":"V39 Hidden agenda"}', 0, 100, '{}')).id as ag2 \gset
select (public.add_node(:'proj', 'list', '{"en":"V39 Mentors","ar":"المرشدون"}', 0, 200, '{"subkind":"expert"}')).id as lm \gset
select (public.add_node(:'proj', 'list', '{"en":"V39 Companies","ar":"الشركات"}', 0, 300, '{"subkind":"company"}')).id as lc \gset
select (public.add_node(:'proj', 'list', '{"en":"V39 Private mentors"}', 0, 400, '{"subkind":"expert"}')).id as lh \gset
select (public.add_node(:'proj', 'library', '{"en":"V39 Library","ar":"المكتبة"}', 300, 0, '{}')).id as lib \gset
select (public.add_node(:'proj', 'landing_page', '{"en":"V39 Landing","ar":"فرص"}', 300, 100, '{}')).id as ld \gset
select (public.add_node(:'proj', 'distribution', '{"en":"V39 Mentoring","ar":"الإرشاد"}', 300, 200, '{}')).id as ds \gset
select (public.add_node(:'proj', 'certificates', '{"en":"V39 Certificates","ar":"شهادات"}', 300, 300, '{}')).id as cn \gset
select (public.add_node(:'proj3', 'library', '{"en":"V39 Foreign library"}', 0, 0, '{}')).id as libx \gset
select (public.add_node(:'proj3', 'form_builder', '{"en":"V39 Apply form"}', 0, 100, '{}')).id as fm \gset
select public.add_manual_item(:'lm', '{"title_en":"Mentor Alpha","title_ar":"المرشد ألفا"}') as m1 \gset
select public.add_manual_item(:'lh', '{"title_en":"Hidden mentor"}') as mh \gset
select public.ensure_public_link(:'ag', 'agenda', null, null) as alink \gset
select public.ensure_public_link(:'lib', 'view', 'library-tab', null) as lklink \gset
select public.ensure_public_link(:'ld', 'view', 'landing', null) as ldlink \gset
reset role;

-- exposure: everything EXCEPT the hidden agenda, the hidden list and the (still empty) companies list is exposed; the distribution is not published yet
update public.nodes set show_to_participants = true, visibility = 'platform' where id in (:'ag', :'lm', :'lc', :'lib', :'ld', :'ds', :'cn', :'libx');
update public.nodes set show_to_participants = true, visibility = 'private' where id = :'lh';
update public.projects set description_en = 'Project description', description_ar = 'وصف المشروع', show_description = true, location_en = 'Riyadh Hall', location_ar = 'قاعة الرياض',
  map_url = 'https://maps.example.invalid/hall', offline_days = 2, transportation = 'provided', show_details = true where id = :'proj';
insert into public.agenda_days (project_id, node_id, sort_order, day_date, name_en, name_ar) values
  (:'proj', :'ag', 0, date '2030-03-10', 'Day 1', 'اليوم 1'), (:'proj', :'ag', 1, date '2030-03-12', 'Day 2', 'اليوم 2'), (:'proj', :'ag2', 0, date '2031-01-01', 'Hidden day', 'يوم');
insert into public.companies (id, name_en) values ('00000000-0000-4000-8000-0000000039c1', 'V39 Company Five');
insert into public.founders (id, name_ar, name_en, auth_user_id) values ('00000000-0000-4000-8000-0000000039d5', 'مؤسس', 'V39 Founder Five', '00000000-0000-4000-8000-0000000039f5');
insert into public.company_founders (company_id, founder_id) values ('00000000-0000-4000-8000-0000000039c1', '00000000-0000-4000-8000-0000000039d5');
insert into public.participants (project_id, user_id, company_id, source, status) values
  (:'proj',  '00000000-0000-4000-8000-0000000039f1', null, 'manual', 'accepted'),
  (:'proj2', '00000000-0000-4000-8000-0000000039f1', null, 'manual', 'accepted'),
  (:'proj',  '00000000-0000-4000-8000-0000000039f2', null, 'manual', 'attended'),
  (:'proj',  '00000000-0000-4000-8000-0000000039f4', null, 'manual', 'withdrawn'),
  (:'proj',  null, '00000000-0000-4000-8000-0000000039c1', 'manual', 'accepted');
-- participants created from FORM RESPONSES (accepted through Selection): no account yet, the link is the founder_email (02-8)
insert into public.form_responses (id, project_id, node_id, answers) values
  ('00000000-0000-4000-8000-0000000039e6', :'proj3', :'fm', '{"company_name":"Resp Co","founder_email":"  ZZ-V39-F6@Example.invalid "}'),
  ('00000000-0000-4000-8000-0000000039e7', :'proj3', :'fm', '{"company_name":"Resp Co again","founder_email":"zz-v39-f6@example.invalid"}'),
  ('00000000-0000-4000-8000-0000000039e8', :'proj3', :'fm', '{"company_name":"Unverified Co","founder_email":"zz-v39-f7@example.invalid"}'),
  ('00000000-0000-4000-8000-0000000039e9', :'proj3', :'fm', '{"company_name":"Staff Co","founder_email":"zz-v39-admin@example.invalid"}');
insert into public.participants (project_id, form_response_id, source, status) values
  (:'proj3', '00000000-0000-4000-8000-0000000039e6', 'selection', 'accepted'), (:'proj3', '00000000-0000-4000-8000-0000000039e7', 'selection', 'accepted'),
  (:'proj3', '00000000-0000-4000-8000-0000000039e8', 'selection', 'accepted'), (:'proj3', '00000000-0000-4000-8000-0000000039e9', 'selection', 'accepted');
select id as pf2 from public.participants where project_id = :'proj' and user_id = '00000000-0000-4000-8000-0000000039f2' \gset

-- ================================================================= the block list of an accepted participant (only what the PM enabled)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select format($q$select string_agg(b->>'type', ',' order by o) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') with ordinality as t(b, o)$q$, :'proj') as blocks_sql \gset
select v39_test.val('P01 an accepted participant sees EXACTLY the enabled blocks, in the owner order (no companies: empty list; no schedule: unpublished; no certificate: not completed)', :'blocks_sql', 'description,agenda,mentors,details,library,landing');
select v39_test.val('P02 the header carries both names, the cover fallback, the zone and the dates of the EXPOSED agenda only', format($q$select (p->'project'->>'name_en') || '|' || (p->'project'->'program'->>'name_en') || '|' || (p->'project'->>'timezone') || '|' || (p->'project'->>'start_date') || '|' || (p->'project'->>'end_date') || '|' || (p->'project'->>'completed') || '|' || (p->'participant'->>'status') || '|' || (p->>'restricted') from (select public.get_founder_program_page('%s') p) x$q$, :'proj'), 'V39 Project|V39 Program|Asia/Riyadh|2030-03-10|2030-03-12|false|accepted|false');
select v39_test.val('P03 the details block carries location, map, offline days and transportation', format($q$select b->'data'->>'location_en' || '|' || (b->'data'->>'map_url') || '|' || (b->'data'->>'offline_days') || '|' || (b->'data'->>'transportation') from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'details'$q$, :'proj'), 'Riyadh Hall|https://maps.example.invalid/hall|2|provided');
select v39_test.val('P04 the description block carries both languages', format($q$select b->'data'->>'description_en' || '|' || (b->'data'->>'description_ar') from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'description'$q$, :'proj'), 'Project description|وصف المشروع');
select v39_test.val('P05 the library and landing blocks reuse list_founder_libraries / list_founder_landings (one ref each)', format($q$select (select count(*) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'library' and jsonb_array_length(b->'data'->'items') = 1)::text || '/' || (select count(*) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'landing' and jsonb_array_length(b->'data'->'items') = 1)$q$, :'proj', :'proj'), '1/1');
select v39_test.val('P06 a project where NOTHING is enabled has an EMPTY block list', format($q$select jsonb_array_length(public.get_founder_program_page('%s')->'blocks')::text || '/' || (public.get_founder_program_page('%s')->'project'->>'name_en')$q$, :'proj2', :'proj2'), '0/V39 Empty project');
reset role;

-- ================================================================= a block the PM disables disappears; nodes that are not exposed never appear
update public.projects set show_description = false where id = :'proj';
update public.nodes set show_to_participants = false where id = :'lib';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('D01 description off (toggle) and library not shown to participants: both blocks are gone, the rest stays', :'blocks_sql', 'agenda,mentors,details,landing');
reset role;
update public.nodes set show_to_participants = true where id = :'lib';
update public.nodes set visibility = 'private' where id = :'ld';
update public.projects set show_details = false where id = :'proj';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('D02 a PRIVATE landing node and the details toggle off: gone (a private node never leaks to participants)', :'blocks_sql', 'agenda,mentors,library');
reset role;
update public.projects set show_description = true, show_details = true where id = :'proj';
update public.nodes set visibility = 'platform' where id = :'ld';

-- people blocks: the companies list shows up once it has an item; mentors come before companies
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select public.add_manual_item(:'lc', '{"title_en":"Company One"}') as c1 \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('D03 a connected companies list with an item appears AFTER the mentors block', :'blocks_sql', 'description,agenda,mentors,companies,details,library,landing');
-- the Mentoring Distribution block needs the PM to PUBLISH
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_distribution_published(:'ds', true) as pub \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('D04 a PUBLISHED distribution adds the schedule block (last, before the certificate)', :'blocks_sql', 'description,agenda,mentors,companies,details,library,landing,schedule');
reset role;

-- ================================================================= the lazy block payloads
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('B01 agenda payload: timezone + the 2 days of the exposed agenda', format($q$select (b->'data'->>'timezone') || '/' || jsonb_array_length(b->'data'->'days') from (select public.get_founder_block('%s', 'agenda', '%s') b) x$q$, :'proj', :'ag'), 'Asia/Riyadh/2');
select v39_test.val('B02 mentors payload = the whitelisted list payload (1 item, no contact / overlay / status keys)', format($q$select jsonb_array_length(b->'data'->'items') || '/' || ((b->'data'->'items'->0) ? 'contact')::text || '/' || ((b->'data'->'items'->0) ? 'overlay')::text || '/' || ((b->'data'->'items'->0) ? 'status')::text || '/' || (b->>'viewer') from (select public.get_founder_block('%s', 'mentors', '%s') b) x$q$, :'proj', :'lm'), '1/false/false/false/participant');
select v39_test.val('B03 a list that is NOT exposed to participants answers null', format($q$select public.get_founder_block('%s', 'mentors', '%s')::text$q$, :'proj', :'lh'), null);
select v39_test.val('B04 asking the companies block for a mentors list answers null', format($q$select public.get_founder_block('%s', 'companies', '%s')::text$q$, :'proj', :'lm'), null);
select v39_test.val('B05 a node of ANOTHER project answers null', format($q$select public.get_founder_block('%s', 'agenda', '%s')::text$q$, :'proj', :'libx'), null);
select v39_test.val('B06 a hidden (not exposed) agenda answers null', format($q$select public.get_founder_block('%s', 'agenda', '%s')::text$q$, :'proj', :'ag2'), null);
select v39_test.val('B07 the schedule payload carries my_company_ids (empty here) and the published flag', format($q$select (b->'data'->>'published') || '/' || jsonb_array_length(b->'data'->'my_company_ids') from (select public.get_founder_block('%s', 'schedule', '%s') b) x$q$, :'proj', :'ds'), 'true/0');
select v39_test.fails('B08 an unknown block type is refused', format($q$select public.get_founder_block('%s', 'nope', '%s')$q$, :'proj', :'ag'), '22023');
reset role;
update public.distributions set is_published = false where node_id = :'ds';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('B09 an UNPUBLISHED distribution answers null (and its block is gone)', format($q$select coalesce(public.get_founder_block('%s', 'schedule', '%s')::text, 'null') || '/' || (select count(*) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'schedule')$q$, :'proj', :'ds', :'proj'), 'null/0');
reset role;
update public.distributions set is_published = true where node_id = :'ds';

-- ================================================================= who may call what
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f3","role":"authenticated"}', true);
set local role authenticated;
select v39_test.fails('A01 a founder who does NOT participate gets forbidden on the Program page', format($q$select public.get_founder_program_page('%s')$q$, :'proj'), '42501');
select v39_test.fails('A02 ... and on every lazy block', format($q$select public.get_founder_block('%s', 'mentors', '%s')$q$, :'proj', :'lm'), '42501');
select v39_test.val('A03 ... and sees no program in the list (nothing of the project leaks)', $q$select public.list_my_programs(true)::text$q$, '[]');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select v39_test.fails('A04 a PM / super_admin who is not a participant gets forbidden too (the page is the participant view)', format($q$select public.get_founder_program_page('%s')$q$, :'proj'), '42501');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select v39_test.val('A05 anon has no EXECUTE on the three RPCs (privilege catalog; executing a denied SECURITY DEFINER function as anon crashes this local image)', $q$select (not has_function_privilege('anon','public.list_my_programs(boolean)','EXECUTE') and not has_function_privilege('anon','public.get_founder_program_page(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_founder_block(uuid,text,uuid,jsonb)','EXECUTE'))::text$q$, 'true');

-- ================================================================= withdrawn: the card with the status only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f4","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('W01 a withdrawn participant is HIDDEN from the Programs list by default (02-7)', $q$select public.list_my_programs()::text$q$, '[]');
select v39_test.val('W02 ... and shown with include_withdrawn as a card with the STATUS and the names only (03-6): no cover, dates, location, completion', $q$select (c ? 'cover_path')::text || '/' || (c ? 'start_date')::text || '/' || (c ? 'location_en')::text || '/' || (c ? 'completed')::text || '/' || (c->>'status') || '/' || (c->>'restricted') || '/' || (c->>'project_name_en') from (select public.list_my_programs(true)->0 c) x$q$, 'false/false/false/false/withdrawn/true/V39 Project');
select v39_test.val('W03 the Program page of a withdrawn participant: header + status + restricted + NO blocks and no cover', format($q$select (p->>'restricted') || '/' || jsonb_array_length(p->'blocks') || '/' || (p->'participant'->>'status') || '/' || ((p->'project') ? 'cover_path')::text || '/' || (p->'project'->>'name_en') from (select public.get_founder_program_page('%s') p) x$q$, :'proj'), 'true/0/withdrawn/false/V39 Project');
select v39_test.fails('W04 a withdrawn participant cannot load any block', format($q$select public.get_founder_block('%s', 'mentors', '%s')$q$, :'proj', :'lm'), '42501');
select v39_test.fails('W05 ... nor the agenda / library / landing exposure RPCs (is_participant excludes withdrawn)', format($q$select public.list_founder_libraries('%s')$q$, :'proj'), '42501');
reset role;

-- ================================================================= the Programs list
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('L01 F1 participates in two projects: both cards, ONE per project', $q$select jsonb_array_length(public.list_my_programs())::text$q$, '2');
select v39_test.val('L02 the card carries status, names, dates, completion, the cover fallback and (details on) the location', format($q$select (c->>'status') || '|' || (c->>'project_name_ar') || '|' || (c->>'program_name_en') || '|' || (c->>'start_date') || '|' || (c->>'completed') || '|' || (c->>'location_en') || '|' || (c->>'restricted') from (select x c from jsonb_array_elements(public.list_my_programs()) x where x->>'project_id' = '%s') s$q$, :'proj'), 'accepted|مشروع اختبار|V39 Program|2030-03-10|false|Riyadh Hall|false');
select v39_test.val('L03 the project WITHOUT an exposed agenda has no dates and (details off) no location', format($q$select coalesce(c->>'start_date', 'none') || '|' || coalesce(c->>'location_en', 'none') from (select x c from jsonb_array_elements(public.list_my_programs()) x where x->>'project_id' = '%s') s$q$, :'proj2'), 'none|none');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f5","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('L04 a participant through his COMPANY sees the project in the list and opens the page', format($q$select jsonb_array_length(public.list_my_programs())::text || '/' || (public.get_founder_program_page('%s')->'participant'->>'status')$q$, :'proj'), '1/accepted');
reset role;

-- ================================================================= certificate: completed + attended + issued + not revoked + node exposed
insert into storage.objects (bucket_id, name) values ('certificate-templates', :'proj' || '/' || :'cn' || '/t1.png');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'), '{"config":{"language":"en"}}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','participant_name','x',0.5,'y',0.46,'w',0.6,'size',0.045),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015)))));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f2","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('K01 before completion: the attended participant has NO certificate block', format($q$select count(*)::text from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate'$q$, :'proj'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select public.complete_project(:'proj');
select (public.issue_certificates(:'cn', null))::text as issued \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f2","role":"authenticated"}', true);
set local role authenticated;
select format($q$select string_agg(b->>'type', ',' order by o) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') with ordinality as t(b, o)$q$, :'proj') as blocks_sql2 \gset
select v39_test.val('K02 completed + attended + issued: the certificate block is LAST and carries one certificate; the completed flag is on the header', format($q$select (select string_agg(b->>'type', ',' order by o) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') with ordinality as t(b, o)) || '|' || (public.get_founder_program_page('%s')->'project'->>'completed')$q$, :'proj', :'proj'), 'description,agenda,mentors,companies,details,library,landing,schedule,certificate|true');
select v39_test.val('K03 the certificate block lists ONLY my certificate (code shape, no other participant)', format($q$select jsonb_array_length(b->'data'->'items') || '/' || ((b->'data'->'items'->0->>'code') ~ '^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$')::text from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate'$q$, :'proj'), '1/true');
select v39_test.val('K04 the Programs list marks the card completed and sorts it after the active project (F1 below)', $q$select (c->>'completed') || '/' || (c->>'status') from (select public.list_my_programs()->0 c) x$q$, 'true/attended');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f1","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('K05 an ACCEPTED (not attended) participant of the completed project gets NO certificate block', format($q$select count(*)::text from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate'$q$, :'proj'), '0');
select v39_test.val('K06 the active project (proj2) sorts BEFORE the completed one in F1''s list', $q$select (public.list_my_programs()->0->>'project_name_en') || ',' || (public.list_my_programs()->1->>'project_name_en')$q$, 'V39 Empty project,V39 Project');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select public.revoke_certificate((select id from public.certificates where participant_id = :'pf2'), 'v39');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f2","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('K07 a REVOKED certificate removes the block', format($q$select count(*)::text from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate'$q$, :'proj'), '0');
reset role;

-- ================================================================= accepted through Selection = a FORM RESPONSE participant: linked by the VERIFIED founder e-mail (02-8)
select v39_test.val('E01 before anybody opens the platform the response participants have no account', $q$select count(*)::text from public.participants where form_response_id::text like '00000000-0000-4000-8000-0000000039e%' and user_id is not null$q$, '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f6","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('E02 F6 (verified e-mail = the response founder_email, case and spaces ignored) sees the project in the list', format($q$select jsonb_array_length(public.list_my_programs())::text || '/' || (public.list_my_programs()->0->>'project_name_en') || '/' || (public.get_founder_program_page('%s')->'participant'->>'status')$q$, :'proj3'), '1/V39 Foreign project/accepted');
reset role;
select v39_test.val('E03 exactly ONE participant of that project was linked (one per project and user), the second response stays unlinked, no error', $q$select count(*) filter (where user_id = '00000000-0000-4000-8000-0000000039f6')::text || '/' || count(*) filter (where user_id is null) from public.participants where form_response_id in ('00000000-0000-4000-8000-0000000039e6', '00000000-0000-4000-8000-0000000039e7')$q$, '1/1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f7","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('E04 an UNVERIFIED e-mail never links (F7)', $q$select public.list_my_programs()::text$q$, '[]');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039f3","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('E05 a founder with ANOTHER e-mail links nothing (F3 verified, no response of hers)', $q$select public.list_my_programs()::text$q$, '[]');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000039a0","role":"authenticated"}', true);
set local role authenticated;
select v39_test.val('E06 a STAFF account whose e-mail is on a response is never linked (08 section 15)', $q$select public.list_my_programs()::text$q$, '[]');
reset role;
select v39_test.val('E07 after E04-E06 only F6 holds a response participant', $q$select string_agg(user_id::text, ',') from public.participants where form_response_id::text like '00000000-0000-4000-8000-0000000039e%' and user_id is not null$q$, '00000000-0000-4000-8000-0000000039f6');
select v39_test.val('E08 link_my_participations is not callable by clients', $q$select (has_function_privilege('authenticated', 'app_private.link_my_participations()', 'EXECUTE') or has_function_privilege('anon', 'app_private.link_my_participations()', 'EXECUTE'))::text$q$, 'false');

select current_setting('v39.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v39: founder RPC tests FAILED'; end $$;
\endif
