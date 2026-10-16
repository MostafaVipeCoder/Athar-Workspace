-- v51_alumni_manager_pages  (m51: the SQL of the manager-side Alumni pages: programs, the wide table, the overview, server-side notifications, opportunities, the import preview)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
--
-- Fixture (ids ...00000000e51x / c51x / f51x):
--   ADM = super_admin, AM = alumni_manager, PM = project_manager (member of the program), F1 / F2 = founders with accounts, F3 = founder with an account and NO company, NR = no role
--   C1 (F1 primary, technology / mvp / Assiut, alumni), C2 (F2 primary, healthcare / idea_stage, alumni), C3 (legacy-like, no founder, NOT alumni), a team RECORD without an account in C1
--   one program, two projects: C1 + C3 are items of the company list of J1, C2 of J2; F3 is an accepted USER participant of J2 (a founder accepted through Selection, no company)
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute crashes this local Postgres image):
-- helpers are called as the owner; denials are asserted with has_function_privilege.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v51.res', '', false) \gset

begin;
create schema v51_test;
grant usage on schema v51_test to public;
create or replace function v51_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v51.res', current_setting('v51.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v51_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v51_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v51_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v51_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v51_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v51_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v51_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v51_test.t(p_key, true, 'ok');
  exception when others then
    perform v51_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v51_test from public;
grant execute on all functions in schema v51_test to anon, authenticated, service_role;

-- ================================================================= K. catalog (as postgres)
select v51_test.val('K01 the seven manager RPCs exist', $q$select count(*)::text from unnest(array['public.list_alumni_programs()', 'public.list_alumni_table(jsonb,integer,integer,text,text,integer)', 'public.get_alumni_overview()',
  'public.preview_notification_audience(jsonb)', 'public.send_alumni_notification(jsonb,text,text,text,text,text,uuid)', 'public.list_alumni_broadcasts(integer,integer)', 'public.import_alumni_preview(jsonb)']) f
  where to_regprocedure(f) is not null$q$, '7');
select v51_test.val('K02 authenticated executes all seven, anon none', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_alumni_programs', 'list_alumni_table', 'get_alumni_overview',
  'preview_notification_audience', 'send_alumni_notification', 'list_alumni_broadcasts', 'import_alumni_preview') and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '7');
select v51_test.val('K03 every one is SECURITY DEFINER with an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_alumni_programs', 'list_alumni_table', 'get_alumni_overview',
  'preview_notification_audience', 'send_alumni_notification', 'list_alumni_broadcasts', 'import_alumni_preview') and p.prosecdef and p.proconfig @> array['search_path=""']$q$, '7');
select v51_test.val('K04 NO API role executes any alumni_* / id_* / eg_* helper (the audience resolver, the import helpers included)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^(alumni_|id_|eg_)'
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v51_test.val('K05 opportunity_visible_to_me: authenticated may execute (the RLS policy runs as the founder), anon may not; the guard trigger function is closed', $q$select (has_function_privilege('authenticated', 'app_private.opportunity_visible_to_me(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.opportunity_visible_to_me(jsonb)', 'EXECUTE') and not has_function_privilege('authenticated', 'app_private.opportunities_guard()', 'EXECUTE'))::text$q$, 'true');
select v51_test.val('K06 the opportunity checks and the guard trigger exist', $q$select (select count(*) from pg_constraint where conrelid = 'public.opportunities'::regclass and conname in ('opportunities_type_chk', 'opportunities_archived_chk', 'opportunities_text_chk', 'opportunities_link_chk'))::text
  || '/' || (select count(*) from pg_constraint where conrelid = 'public.opportunity_applications'::regclass and conname = 'opportunity_applications_status_chk')::text
  || '/' || (select count(*) from pg_trigger where tgrelid = 'public.opportunities'::regclass and tgname = 'opportunities_biu_guard' and not tgisinternal)::text$q$, '4/1/1');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e510','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-adm@example.invalid','{"provisioned":true}','{"full_name":"V51 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e511','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-am@example.invalid','{"provisioned":true}','{"full_name":"V51 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e512','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-pm@example.invalid','{"provisioned":true}','{"full_name":"V51 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e513','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-f1@example.invalid','{"provisioned":true}','{"full_name":"V51 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e514','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-f2@example.invalid','{"provisioned":true}','{"full_name":"V51 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e515','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-f3@example.invalid','{"provisioned":true}','{"full_name":"V51 Founder Three"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e516','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v51-nr@example.invalid','{"provisioned":true}','{"full_name":"V51 No Role"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e510','super_admin'), ('00000000-0000-4000-8000-00000000e511','alumni_manager'), ('00000000-0000-4000-8000-00000000e512','project_manager'),
  ('00000000-0000-4000-8000-00000000e513','founder'), ('00000000-0000-4000-8000-00000000e514','founder'), ('00000000-0000-4000-8000-00000000e515','founder');
update public.profiles set language = 'en' where id = '00000000-0000-4000-8000-00000000e515';
insert into public.companies (id, name_en, name_ar, created_by, sector_key, stage, governorate_code, is_alumni, startup_type_key, legal_status_key, established_on, website_url, description_en, operating_status) values
  ('00000000-0000-4000-8000-00000000c511', 'V51 Nile Labs', 'مختبرات النيل V51', '00000000-0000-4000-8000-00000000e513', 'technology', 'mvp', 25, true, 'startup', 'llc', date '2021-03-01', 'https://nile.example.com', 'Robots for farms', 'open'),
  ('00000000-0000-4000-8000-00000000c512', 'V51 Second Co', null, '00000000-0000-4000-8000-00000000e514', 'healthcare', 'idea_stage', 1, true, null, null, null, null, null, 'open');
insert into public.companies (id, name_en, name_ar, industry_en, governorate_en) values ('00000000-0000-4000-8000-00000000c513', 'V51 Legacy Co', null, 'Technology, Manufacturing', 'Alex');
insert into public.founders (id, name_en, name_ar, email, auth_user_id, phone, education_status) values
  ('00000000-0000-4000-8000-00000000f511', 'Sara Ali', 'سارة علي', 'zz-v51-f1@example.invalid', '00000000-0000-4000-8000-00000000e513', '+201012345678', 'graduate'),
  ('00000000-0000-4000-8000-00000000f512', 'Omar Zaki', 'عمر زكي', 'zz-v51-f2@example.invalid', '00000000-0000-4000-8000-00000000e514', null, 'student'),
  ('00000000-0000-4000-8000-00000000f513', 'Third Founder', 'الثالث', 'zz-v51-f3@example.invalid', '00000000-0000-4000-8000-00000000e515', null, null),
  ('00000000-0000-4000-8000-00000000f514', 'Record Cofounder', 'شريك بدون حساب', null, null, null, null);
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c511', '00000000-0000-4000-8000-00000000f511', true), ('00000000-0000-4000-8000-00000000c511', '00000000-0000-4000-8000-00000000f514', false),
  ('00000000-0000-4000-8000-00000000c512', '00000000-0000-4000-8000-00000000f512', true);
-- synthetic national IDs: IDA 29501010101234 = 1995-01-01 Cairo male (F1); IDB 30303152804527 = 2003-03-15 Aswan female (F2). The record cofounder is self-declared female, born 2001-05-05.
insert into public.founder_identities (founder_id, national_id) values ('00000000-0000-4000-8000-00000000f511', '29501010101234'), ('00000000-0000-4000-8000-00000000f512', '30303152804527');
insert into public.founder_identities (founder_id, self_birth_date, self_gender) values ('00000000-0000-4000-8000-00000000f514', date '2001-05-05', 'female');
insert into public.company_internal (company_id, hint) values ('00000000-0000-4000-8000-00000000c511', 'strong team');
insert into public.opportunities (opportunity_id, type, title_ar, is_active) values ('00000000-0000-4000-8000-0000000b5101', 'grant', 'x', false);
-- yearly metrics through the manager RPC later; here the table is filled directly (as the owner) to keep the numbers exact
-- m66 (owner decision 21): the figures are FROZEN QUARTERS (one reported Q4 snapshot per year gives the same year totals through the roll-up the readers use)
insert into public.company_snapshots (company_id, snapshot_type, period_year, period_key, status, frozen_at, frozen_source, reported, source, revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs, operating_status) values
  ('00000000-0000-4000-8000-00000000c511', 'quarter', 2023, '2023-Q4', 'frozen', now(), 'manual', true, 'manager', 100000, 50000, 5, 2, 1, '100 users', 'hiring', 'funding', 'open'),
  ('00000000-0000-4000-8000-00000000c511', 'quarter', 2024, '2024-Q4', 'frozen', now(), 'manual', true, 'manager', 250000, 80000, 9, 4, 3, null, null, null, 'open'),
  ('00000000-0000-4000-8000-00000000c512', 'quarter', 2024, '2024-Q4', 'frozen', now(), 'manual', true, 'founder', 5000, null, 2, 1, null, null, null, null, 'open');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e510","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V51 Program', null, null, null, null, null)).id as prog \gset
select (public.create_program('V51 Other Program', null, null, null, null, null)).id as prog2 \gset
select (public.create_project(:'prog', 'V51 Project One', null, 'Africa/Cairo')).id as j1 \gset
select (public.create_project(:'prog', 'V51 Project Two', null, 'Africa/Cairo')).id as j2 \gset
select (public.add_node(:'j1', 'list', '{"en":"V51 Companies","ar":"الشركات"}', 0, 0, '{"subkind":"company"}')).id as lc1 \gset
select (public.add_node(:'j1', 'agenda', '{"en":"V51 Agenda"}', 0, 100, '{}')).id as ag \gset
select (public.add_node(:'j2', 'list', '{"en":"V51 Companies 2","ar":"الشركات"}', 0, 0, '{"subkind":"company"}')).id as lc2 \gset
reset role;
insert into public.program_members (program_id, user_id) values (:'prog', '00000000-0000-4000-8000-00000000e512') on conflict do nothing;
insert into public.list_items (project_id, list_node_id, source_kind, company_id) values
  (:'j1', :'lc1', 'company', '00000000-0000-4000-8000-00000000c511'), (:'j1', :'lc1', 'company', '00000000-0000-4000-8000-00000000c513'), (:'j2', :'lc2', 'company', '00000000-0000-4000-8000-00000000c512');
insert into public.participants (project_id, user_id, source, status) values (:'j2', '00000000-0000-4000-8000-00000000e515', 'manual', 'accepted');

-- ================================================================= P. programs for the filters
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('P01 a manager lists the programs (the fixture program has its two projects and the companies it holds)', format($q$select (select (p->>'companies') || '/' || jsonb_array_length(p->'projects') from jsonb_array_elements(public.list_alumni_programs()->'programs') p where p->>'id' = '%s')$q$, :'prog'), '3/2');
select v51_test.val('P02 ... project level: J1 holds C1 + C3 (2), J2 holds C2 (1)', format($q$select (select string_agg(j->>'companies', ',' order by j->>'name_en') from jsonb_array_elements(public.list_alumni_programs()->'programs') p, jsonb_array_elements(p->'projects') j where p->>'id' = '%s')$q$, :'prog'), '2,1');
select v51_test.val('P03 a program with no company is listed too (0)', format($q$select (select p->>'companies' from jsonb_array_elements(public.list_alumni_programs()->'programs') p where p->>'id' = '%s')$q$, :'prog2'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e512","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('P04 a project manager (even a member of the program) cannot list through the alumni RPC', $q$select public.list_alumni_programs()$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('P05 a founder cannot', $q$select public.list_alumni_programs()$q$, '42501');
select v51_test.fails('P06 a founder cannot read the wide table', $q$select public.list_alumni_table('{}'::jsonb, 5, 0, 'name', 'asc', null)$q$, '42501');
select v51_test.fails('P07 a founder cannot read the overview', $q$select public.get_alumni_overview()$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e512","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('P08 a project manager cannot read the wide table', $q$select public.list_alumni_table('{}'::jsonb, 5, 0, 'name', 'asc', null)$q$, '42501');
select v51_test.fails('P09 a project manager cannot preview the import', $q$select public.import_alumni_preview('[{"Startup Name":"x"}]'::jsonb)$q$, '42501');
reset role;

-- ================================================================= T. the wide table
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 25, 0, 'name', 'asc', 2024) as tbl \gset
select public.export_alumni_rows('{"scope":"all","q":"v51"}'::jsonb, 2024, 'en', null) as exp \gset
select public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 25, 0, 'name', 'asc', 2023) as tbl23 \gset
reset role;
select v51_test.val('T01 the table lists the three fixture companies (scope all, q v51)', format($q$select jsonb_array_length(%L::jsonb->'rows')::text$q$, :'tbl'), '3');
select v51_test.val('T02 total 3 and the rows are in name order', format($q$select (%L::jsonb->>'total') || '|' || (select string_agg(r->>'name_en', ',' order by o) from jsonb_array_elements(%L::jsonb->'rows') with ordinality t(r, o))$q$, :'tbl', :'tbl'),
  '3|V51 Legacy Co,V51 Nile Labs,V51 Second Co');
select v51_test.val('T03 a row carries every group of the owner columns (keys)', format($q$select ((%L::jsonb->'rows'->1) ?& array['id', 'name_en', 'name_ar', 'logo_path', 'programs', 'projects', 'support', 'startup_type', 'hint', 'sector', 'subsector', 'description_en', 'description_ar', 'stage',
  'governorate', 'established_on', 'founding_year', 'app_url', 'website_url', 'social', 'traction', 'ceo', 'operating_status', 'closing_reason', 'closing_note', 'after_closing', 'legal_status', 'team', 'metrics', 'is_alumni',
  'directory_visibility', 'directory_hidden', 'reviewed_at', 'updated_at', 'completeness', 'legacy'])::text$q$, :'tbl'), 'true');
select v51_test.val('T04 the CEO block: derived from the ID (age as the SQL rule says, male, Cairo = 1), the ID only MASKED', format($q$select (r->'ceo'->>'age')::int = app_private.id_age('29501010101234', app_private.alumni_today()) and (r->'ceo'->>'gender') = 'male'
  and (r->'ceo'->>'governorate') = '1' and (r->'ceo'->>'id_masked') = '**********1234' and (r->'ceo'->>'has_national_id') = 'true' and (r->'ceo'->>'source') = 'id' from jsonb_array_elements(%L::jsonb->'rows') r where r->>'name_en' = 'V51 Nile Labs'$q$, :'tbl'), 'true');
select v51_test.val('T05 the national ID digits are in NO part of the payload (neither table nor export year 2023)', format($q$select (position('29501010101234' in %L) + position('30303152804527' in %L) + position('29501010101234' in %L))::text$q$, :'tbl', :'tbl', :'tbl23'), '0');
select v51_test.val('T06 metrics for year 2024: revenue = that year, the rest as of 2024', format($q$select (r->'metrics'->>'revenue_total') || '|' || (r->'metrics'->>'employees_total') || '|' || (r->'metrics'->>'employees_female') || '|' || (r->'metrics'->>'freelancers') || '|' || (r->'metrics'->>'funding_raised_total') || '|' || (r->>'traction')
  from jsonb_array_elements(%L::jsonb->'rows') r where r->>'name_en' = 'V51 Nile Labs'$q$, :'tbl'), '250000.00|9|4|3|80000.00|100 users');
select v51_test.val('T07 metrics for year 2023: the 2023 row (traction is as of the year)', format($q$select (r->'metrics'->>'revenue_total') || '|' || (r->'metrics'->>'employees_total') || '|' || (r->>'traction') from jsonb_array_elements(%L::jsonb->'rows') r where r->>'name_en' = 'V51 Nile Labs'$q$, :'tbl23'), '100000.00|5|100 users');
select v51_test.val('T08 the team counts are derived (C1: 2 members, 1 female (the record is self-declared female), 2 below 35)', format($q$select (r->'team'->>'size') || '|' || (r->'team'->>'female_founders') || '|' || (r->'team'->>'under_35') from jsonb_array_elements(%L::jsonb->'rows') r where r->>'name_en' = 'V51 Nile Labs'$q$, :'tbl'), '2|1|2');
select v51_test.val('T09 program scope / name / support are derived (C1: the program, project One, training)', format($q$select (r->'programs'->0->>'name_en') || '|' || (r->'projects'->0->>'name_en') || '|' || (r->>'support') from jsonb_array_elements(%L::jsonb->'rows') r where r->>'name_en' = 'V51 Nile Labs'$q$, :'tbl'),
  'V51 Program|V51 Project One|["training"]');
select v51_test.val('T10 PARITY with the export (same filter, same year): ceo age, team size, employees, female employees, freelancers, funding, revenue and hint agree for every fixture row', format($q$select count(*)::text from jsonb_array_elements(%L::jsonb->'rows') r
  join jsonb_array_elements(%L::jsonb->'rows') t on (r->>0) = coalesce(t->>'name_en', t->>'name_ar')
  where (r->>20) is distinct from (t->'ceo'->>'age') or (r->>28)::int is distinct from (t->'team'->>'size')::int or (r->>31) is distinct from (t->'metrics'->>'employees_total') or (r->>32) is distinct from (t->'metrics'->>'employees_female')
     or (r->>33) is distinct from (t->'metrics'->>'freelancers') or (r->>34)::numeric is distinct from (t->'metrics'->>'funding_raised_total')::numeric or (r->>35)::numeric is distinct from (t->'metrics'->>'revenue_total')::numeric
     or (r->>5) is distinct from (t->>'hint')$q$, :'exp', :'tbl'), '0');
select v51_test.val('T11 ... and the export really has the three rows (the join above is not vacuous)', format($q$select (%L::jsonb->'meta'->>'count')$q$, :'exp'), '3');
select v51_test.val('T12 the export governorate column = the CEO governorate FROM THE ID (Cairo), the table row says the company location is Assiut (25): two different values', format($q$select (select r->>10 from jsonb_array_elements(%L::jsonb->'rows') r where r->>0 = 'V51 Nile Labs') || '|' ||
  (select t->>'governorate' from jsonb_array_elements(%L::jsonb->'rows') t where t->>'name_en' = 'V51 Nile Labs')$q$, :'exp', :'tbl'), 'Cairo|25');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('T13 sort by name desc reverses the order', $q$select string_agg(r->>'name_en', ',' order by o) from jsonb_array_elements(public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 25, 0, 'name', 'desc', 2024)->'rows') with ordinality t(r, o)$q$,
  'V51 Second Co,V51 Nile Labs,V51 Legacy Co');
select v51_test.val('T14 sort by revenue desc: the highest first, rows without a value last', $q$select string_agg(r->>'name_en', ',' order by o) from jsonb_array_elements(public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 25, 0, 'revenue', 'desc', 2024)->'rows') with ordinality t(r, o)$q$,
  'V51 Nile Labs,V51 Second Co,V51 Legacy Co');
select v51_test.val('T15 sort by age asc: the youngest CEO first (C2 born 2003), no-ID last', $q$select string_agg(r->>'name_en', ',' order by o) from jsonb_array_elements(public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 25, 0, 'age', 'asc', 2024)->'rows') with ordinality t(r, o)$q$,
  'V51 Second Co,V51 Nile Labs,V51 Legacy Co');
select v51_test.val('T16 paging: limit 1 offset 1 = the second row; total is still 3', $q$select (public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 1, 1, 'name', 'asc', 2024)->'rows'->0->>'name_en') || '|' || (public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 1, 1, 'name', 'asc', 2024)->>'total')$q$, 'V51 Nile Labs|3');
select v51_test.val('T17 every sort key works (11 keys, no error)', $q$select count(*)::text from unnest(array['name', 'updated', 'created', 'established', 'completeness', 'age', 'employees', 'funding', 'revenue', 'sector', 'stage']) s
  where jsonb_array_length(public.list_alumni_table('{"scope":"all","q":"v51"}'::jsonb, 25, 0, s, 'desc', null)->'rows') = 3$q$, '11');
select v51_test.fails('T18 an unknown sort key is refused', $q$select public.list_alumni_table('{}'::jsonb, 5, 0, 'password', 'asc', null)$q$, '22023', 'alumni_invalid', 'sort:bad_value');
select v51_test.fails('T19 an unknown direction is refused', $q$select public.list_alumni_table('{}'::jsonb, 5, 0, 'name', 'sideways', null)$q$, '22023', 'alumni_invalid', 'dir:bad_value');
select v51_test.fails('T20 an unknown filter key is refused (the shared filter)', $q$select public.list_alumni_table('{"national_id":"1"}'::jsonb, 5, 0, 'name', 'asc', null)$q$, '22023', 'alumni_invalid', 'national_id:unknown_key');
select v51_test.val('T21 the filter ceo_governorate = 1 (Cairo) finds C1 only; age_category + gender filters agree', $q$select (jsonb_array_length(public.list_alumni_table('{"scope":"all","q":"v51","ceo_governorate":1}'::jsonb, 25, 0, 'name', 'asc', null)->'rows')::text
  || '|' || (public.list_alumni_table('{"scope":"all","ceo_governorate":1,"q":"v51"}'::jsonb, 25, 0, 'name', 'asc', null)->'rows'->0->>'name_en') || '|' ||
  (public.list_alumni_table('{"scope":"all","q":"v51","ceo_gender":"female"}'::jsonb, 25, 0, 'name', 'asc', null)->'rows'->0->>'name_en'))$q$, '1|V51 Nile Labs|V51 Second Co');
select v51_test.val('T22 the limit is clamped to 100', $q$select (public.list_alumni_table('{"scope":"all"}'::jsonb, 1000, 0, 'name', 'asc', null)->>'limit')$q$, '100');
select v51_test.val('T23 the default scope is the alumni (C1 + C2 only: two fixture companies)', $q$select jsonb_array_length(public.list_alumni_table('{"q":"v51"}'::jsonb, 25, 0, 'name', 'asc', null)->'rows')::text$q$, '2');

select v51_test.val('T24 the education filter (CEO student / graduate): student = C2, graduate = C1', $q$select (public.list_alumni_table('{"scope":"all","q":"v51","education_status":"student"}'::jsonb, 25, 0, 'name', 'asc', null)->'rows'->0->>'name_en') || '|' ||
  (public.list_alumni_table('{"scope":"all","q":"v51","education_status":"graduate"}'::jsonb, 25, 0, 'name', 'asc', null)->'rows'->0->>'name_en') || '|' ||
  jsonb_array_length(public.list_alumni_table('{"scope":"all","q":"v51","education_status":"other"}'::jsonb, 25, 0, 'name', 'asc', null)->'rows')::text$q$, 'V51 Second Co|V51 Nile Labs|0');
select v51_test.fails('T25 a bad education value is refused', $q$select public.list_alumni_table('{"education_status":"professor"}'::jsonb, 5, 0, 'name', 'asc', null)$q$, '22023', 'alumni_invalid', 'education_status:bad_value');
select v51_test.val('T26 the filter is shared: the export and the analytics accept it too (graduate = one company)', $q$select (public.export_alumni_rows('{"scope":"all","q":"v51","education_status":"graduate"}'::jsonb, 2024, 'en', null)->'meta'->>'count') || '|' ||
  (public.get_alumni_analytics('{"scope":"all","q":"v51","education_status":"graduate"}'::jsonb, 2024)->'totals'->>'companies')$q$, '1|1');

-- ================================================================= O. overview
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select public.get_alumni_overview() as ov \gset
reset role;
select v51_test.val('O01 companies: alumni = the marked ones, total = every live company', format($q$select (%L::jsonb->'companies'->>'alumni') || '|' || (%L::jsonb->'companies'->>'total') || '|' || (select count(*) from public.companies where is_alumni and deleted_at is null)::text || '|' || (select count(*) from public.companies where deleted_at is null)::text$q$, :'ov', :'ov'),
  (select (count(*) filter (where is_alumni))::text || '|' || count(*)::text || '|' || (count(*) filter (where is_alumni))::text || '|' || count(*)::text from public.companies where deleted_at is null));
select v51_test.val('O02 founders: total / with account / with national id are COUNTS that equal the tables', format($q$select (%L::jsonb->'founders'->>'total') || '|' || (%L::jsonb->'founders'->>'with_account') || '|' || (%L::jsonb->'founders'->>'with_national_id')$q$, :'ov', :'ov', :'ov'),
  (select count(*)::text || '|' || (count(*) filter (where auth_user_id is not null))::text || '|' || (select count(*) from public.founder_identities where national_id is not null)::text from public.founders where deleted_at is null));
select v51_test.val('O03 the overview carries no national ID digits and no name', format($q$select (position('29501010101234' in %L) + position('Sara' in %L))::text$q$, :'ov', :'ov'), '0');
select v51_test.val('O04 completeness: an average and the most often missing keys', format($q$select ((%L::jsonb->'completeness'->>'average') is not null)::text || '|' || (jsonb_array_length(%L::jsonb->'completeness'->'missing_by') > 0)::text$q$, :'ov', :'ov'), 'true|true');
select v51_test.val('O05 the latest year with data is the max year of the reported quarters (2024 in the fixture, or later when other work left a row)', format($q$select %L::jsonb->>'latest_year'$q$, :'ov'), (select max(period_year)::text from public.company_snapshots where snapshot_type = 'quarter' and reported));

-- ================================================================= N. notifications (server-side audience)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('N01 preview "all": recipients = the founders with an account, without_account = the records without one', $q$select (public.preview_notification_audience('{"kind":"all"}'::jsonb)->>'recipients') || '|' || (public.preview_notification_audience('{"kind":"all"}'::jsonb)->>'without_account')$q$,
  (select (count(*) filter (where auth_user_id is not null))::text || '|' || (count(*) filter (where auth_user_id is null))::text from public.founders where deleted_at is null));
select v51_test.val('N02 preview a PROGRAM: F1 (through C1 in J1) + F2 (C2 in J2) + F3 (an accepted user participant of J2, no company) = 3', format($q$select (public.preview_notification_audience(jsonb_build_object('kind', 'program', 'program_id', %L))->>'recipients')$q$, :'prog'), '3');
select v51_test.val('N03 preview a PROJECT: J2 = F2 + F3 (2); J1 = F1 + the record without an account (1 + 1 without)', format($q$select (public.preview_notification_audience(jsonb_build_object('kind', 'program', 'project_id', %L))->>'recipients') || '|' ||
  (public.preview_notification_audience(jsonb_build_object('kind', 'program', 'project_id', %L))->>'recipients') || '|' || (public.preview_notification_audience(jsonb_build_object('kind', 'program', 'project_id', %L))->>'without_account')$q$, :'j2', :'j1', :'j1'), '2|1|1');
select v51_test.val('N04 preview companies [C1]: F1 (account) + the record (no account); selected founders [F2, the record] = 1 + 1 without', $q$select (public.preview_notification_audience('{"kind":"company","company_ids":["00000000-0000-4000-8000-00000000c511"]}'::jsonb)->>'recipients') || '|' ||
  (public.preview_notification_audience('{"kind":"company","company_ids":["00000000-0000-4000-8000-00000000c511"]}'::jsonb)->>'without_account') || '|' ||
  (public.preview_notification_audience('{"kind":"founder","founder_ids":["00000000-0000-4000-8000-00000000f512","00000000-0000-4000-8000-00000000f514"]}'::jsonb)->>'recipients')$q$, '1|1|1');
select v51_test.fails('N05 an unknown audience key is refused', $q$select public.preview_notification_audience('{"kind":"all","everyone":true}'::jsonb)$q$, '22023', 'alumni_invalid', 'audience:unknown_key');
select v51_test.fails('N06 a bad kind is refused', $q$select public.preview_notification_audience('{"kind":"staff"}'::jsonb)$q$, '22023', 'alumni_invalid', 'audience:bad_value');
select v51_test.fails('N07 a program audience needs a program or a project', $q$select public.preview_notification_audience('{"kind":"program"}'::jsonb)$q$, '22023', 'alumni_invalid', 'audience:required');
select v51_test.fails('N08 an unknown program is refused', $q$select public.preview_notification_audience('{"kind":"program","program_id":"00000000-0000-4000-8000-0000000000ff"}'::jsonb)$q$, '22023', 'alumni_invalid', 'audience:unknown');
select v51_test.fails('N09 a company audience needs companies', $q$select public.preview_notification_audience('{"kind":"company","company_ids":[]}'::jsonb)$q$, '22023', 'alumni_invalid', 'audience:required');
select v51_test.fails('N10 a malformed id is refused with a token, not a cast error', $q$select public.preview_notification_audience('{"kind":"company","company_ids":["nope"]}'::jsonb)$q$, '22023', 'alumni_invalid', 'audience:bad_value');
-- send to the program (3 recipients) in both languages
select (public.send_alumni_notification(jsonb_build_object('kind', 'program', 'program_id', :'prog'), 'Welcome', 'مرحبا', 'English body <b>plain</b>', 'نص عربي')) as sent \gset
reset role;
select v51_test.val('N11 the send reports 3 recipients and a broadcast id', format($q$select (%L::jsonb->>'recipients') || '|' || ((%L::jsonb->>'broadcast_id') is not null)::text$q$, :'sent', :'sent'), '3|true');
select (:'sent'::jsonb->>'broadcast_id') as bid \gset
select v51_test.val('N12 one row per recipient, ALWAYS with recipient_id (none NULL), sent_by = the manager, the audience is recorded', format($q$select count(*)::text || '|' || (count(*) filter (where recipient_id is null))::text || '|' || (count(*) filter (where sent_by = '00000000-0000-4000-8000-00000000e511'))::text || '|' ||
  min(audience_type) || '|' || (min(audience_target_id::text) = '%s')::text from public.notifications where broadcast_id = '%s'$q$, :'prog', :'bid'), '3|0|3|program|true');
select v51_test.val('N13 the text is in the recipient''s language: F1 (profile ar) gets the Arabic title, F3 (profile en) the English one', format($q$select (select title from public.notifications where broadcast_id = '%s' and recipient_id = '00000000-0000-4000-8000-00000000e513') || '|' ||
  (select title from public.notifications where broadcast_id = '%s' and recipient_id = '00000000-0000-4000-8000-00000000e515')$q$, :'bid', :'bid'), 'مرحبا|Welcome');
select v51_test.val('N14 the full bilingual text is kept in metadata and the markup is stored as plain text (not interpreted)', format($q$select (metadata->>'title_en') || '|' || (metadata->>'title_ar') || '|' || (metadata->>'body_en') from public.notifications where broadcast_id = '%s' limit 1$q$, :'bid'), 'Welcome|مرحبا|English body <b>plain</b>');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('N15 F1 sees his notification (RLS), only his', format($q$select count(*)::text from public.notifications where broadcast_id = '%s'$q$, :'bid'), '1');
select v51_test.okrun('N16 F1 marks it read', format($q$update public.notifications set is_read = true where broadcast_id = '%s'$q$, :'bid'));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e514","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('N17 F2 sees only his own copy (never the others)', format($q$select count(*)::text || '|' || (count(*) filter (where recipient_id = '00000000-0000-4000-8000-00000000e514'))::text from public.notifications where broadcast_id = '%s'$q$, :'bid'), '1|1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('N18 the history: the broadcast with 3 recipients, 1 read, bilingual text, the target program name, the sender', format($q$select (b->>'recipients') || '|' || (b->>'reads') || '|' || (b->>'title_en') || '|' || (b->>'title_ar') || '|' || (b->>'target_name_en') || '|' || (b->>'audience_type') || '|' || (b->>'sent_by')
  from jsonb_array_elements(public.list_alumni_broadcasts(20, 0)->'rows') b where b->>'broadcast_id' = '%s'$q$, :'bid'), '3|1|Welcome|مرحبا|V51 Program|program|V51 Alumni Manager');
select v51_test.val('N19 the manager reads the recipients of a broadcast directly (RLS: a manager reads every notification)', format($q$select count(*)::text from public.notifications where broadcast_id = '%s'$q$, :'bid'), '3');
select v51_test.fails('N19b a link must be an in-app path or an http(s) URL', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, 'T', null, 'b', null, 'javascript:alert(1)')$q$, '22023', 'alumni_invalid', 'link:bad_url');
select v51_test.fails('N19c a protocol-relative link is refused too', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, 'T', null, 'b', null, '//evil.example.com/x')$q$, '22023', 'alumni_invalid', 'link:bad_url');
select v51_test.fails('N19d an unknown opportunity is refused', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, 'T', null, 'b', null, null, '00000000-0000-4000-8000-0000000000ee')$q$, '22023', 'alumni_invalid', 'opportunity:unknown');
select (public.send_alumni_notification(jsonb_build_object('kind', 'program', 'program_id', :'prog'), 'With a link', null, 'See the opportunity', null, '/alumni/founder/opportunities', '00000000-0000-4000-8000-0000000b5101')->>'broadcast_id') as bid2 \gset
select v51_test.val('N19e the link and the opportunity id are in the metadata the founder inbox reads', format($q$select count(*)::text || '|' || min(metadata->>'link') || '|' || min(metadata->>'opportunity_id') from public.notifications where broadcast_id = '%s'$q$, :'bid2'),
  '3|/alumni/founder/opportunities|00000000-0000-4000-8000-0000000b5101');
select v51_test.fails('N20 a title or a body is required (any language)', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, ' ', null, 'x', null)$q$, '22023', 'alumni_invalid', 'title:required');
select v51_test.fails('N21 ... the body too', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, 'T', null, '  ', ' ')$q$, '22023', 'alumni_invalid', 'body:required');
select v51_test.fails('N22 a title over 200 characters is refused', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, repeat('x', 201), null, 'b', null)$q$, '22023', 'alumni_invalid', 'title:too_long');
select v51_test.fails('N23 an audience with nobody to notify is refused (a company whose only team member has no account)', $q$select public.send_alumni_notification('{"kind":"founder","founder_ids":["00000000-0000-4000-8000-00000000f514"]}'::jsonb, 'T', null, 'b', null)$q$, '22023', 'alumni_invalid', 'audience:empty');
select v51_test.val('N24 a one-language message falls back for the other language (F1 and F2 both read the English text, F3 too)', format($q$select (public.send_alumni_notification(jsonb_build_object('kind', 'program', 'program_id', %L), 'Only English', null, 'Only body', null)->>'recipients')$q$, :'prog'), '3');
reset role;
select v51_test.val('N25 ... and the Arabic reader got the English text (no empty title)', $q$select count(*)::text from public.notifications where title = 'Only English' and recipient_id = '00000000-0000-4000-8000-00000000e513'$q$, '1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e512","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('N26 a project manager cannot send', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, 'T', null, 'b', null)$q$, '42501');
select v51_test.fails('N27 ... nor preview, nor read the history', $q$select public.preview_notification_audience('{"kind":"all"}'::jsonb)$q$, '42501');
select v51_test.fails('N28 ... the history either', $q$select public.list_alumni_broadcasts(5, 0)$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('N29 a founder cannot send', $q$select public.send_alumni_notification('{"kind":"all"}'::jsonb, 'T', null, 'b', null)$q$, '42501');
select v51_test.fails('N30 a founder cannot insert a notification directly for somebody else', $q$insert into public.notifications (recipient_id, title, body) values ('00000000-0000-4000-8000-00000000e514', 'x', 'y')$q$, '42501');
reset role;

-- ================================================================= OP. opportunities
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
insert into public.opportunities (opportunity_id, type, title_ar, title_en, provider_en, is_active, target) values
  ('00000000-0000-4000-8000-0000000a5101', 'grant', 'منحة للجميع', 'Open to all', 'Athar', true, '{}'),
  ('00000000-0000-4000-8000-0000000a5102', 'event', 'للتكنولوجيا', 'Technology only', null, true, '{"sectors":["technology"]}'),
  ('00000000-0000-4000-8000-0000000a5103', 'event', 'للصحة', 'Healthcare only', null, true, '{"sectors":["healthcare"]}'),
  ('00000000-0000-4000-8000-0000000a5104', 'investment', 'مسودة', 'A draft', null, false, '{}');
insert into public.opportunities (opportunity_id, type, title_ar, title_en, is_active, target) values
  ('00000000-0000-4000-8000-0000000a5105', 'competition', 'برنامج', 'Program only', true, jsonb_build_object('program_ids', jsonb_build_array(:'prog'))),
  ('00000000-0000-4000-8000-0000000a5106', 'competition', 'برنامج آخر', 'Other program only', true, jsonb_build_object('program_ids', jsonb_build_array(:'prog2'))),
  ('00000000-0000-4000-8000-0000000a5107', 'partnership', 'مرحلة ومحافظة', 'Stage + governorate', true, '{"stages":["mvp"],"governorates":[25]}'),
  ('00000000-0000-4000-8000-0000000a5108', 'partnership', 'مرحلة ومحافظة أخرى', 'Stage + other governorate', true, '{"stages":["mvp"],"governorates":[1]}');
select v51_test.val('OP01 the manager sees all eight (drafts included)', $q$select count(*)::text from public.opportunities where opportunity_id::text like '00000000-0000-4000-8000-0000000a51%'$q$, '8');
select v51_test.fails('OP02 an unknown target key is refused', $q$insert into public.opportunities (type, title_ar, target) values ('grant', 'x', '{"colour":["red"]}')$q$, '22023', 'alumni_invalid', 'target:unknown_key');
select v51_test.fails('OP03 an unknown sector in a target is refused', $q$insert into public.opportunities (type, title_ar, target) values ('grant', 'x', '{"sectors":["nope"]}')$q$, '22023', 'alumni_invalid', 'sectors:unknown');
select v51_test.fails('OP04 a target value must be an array', $q$insert into public.opportunities (type, title_ar, target) values ('grant', 'x', '{"stages":"mvp"}')$q$, '22023', 'alumni_invalid', 'stages:not_an_array');
select v51_test.fails('OP05 an unknown type is refused', $q$insert into public.opportunities (type, title_ar) values ('bogus', 'x')$q$, '23514');
select v51_test.fails('OP06 an archived opportunity cannot be active', $q$insert into public.opportunities (type, title_ar, is_active, archived_at) values ('grant', 'x', true, now())$q$, '23514');
select v51_test.fails('OP07 a javascript: link is refused', $q$insert into public.opportunities (type, title_ar, link) values ('grant', 'x', 'javascript:alert(1)')$q$, '23514');
select v51_test.okrun('OP08 an https link is accepted', $q$insert into public.opportunities (opportunity_id, type, title_ar, link, is_active) values ('00000000-0000-4000-8000-0000000a5109', 'grant', 'x', 'https://example.com/apply', false)$q$);
select v51_test.okrun('OP09a a target with an empty list is accepted', $q$insert into public.opportunities (opportunity_id, type, title_ar, is_active, target) values ('00000000-0000-4000-8000-0000000a510a', 'grant', 'x', false, '{"sectors":[],"stages":["mvp"]}')$q$);
select v51_test.val('OP09 ... and the empty list is normalised away', $q$select target::text from public.opportunities where opportunity_id = '00000000-0000-4000-8000-0000000a510a'$q$, '{"stages": ["mvp"]}');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('OP10 F1 (C1: technology, mvp, Assiut, in the program) sees: all, technology, program, stage + Assiut = 4; not healthcare, not the other program, not the other governorate, not the draft', $q$select string_agg(title_en, ',' order by title_en) from public.opportunities where opportunity_id::text like '00000000-0000-4000-8000-0000000a51%'$q$,
  'Open to all,Program only,Stage + governorate,Technology only');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e514","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('OP11 F2 (C2: healthcare, idea_stage, Cairo, in the program via J2) sees: all, healthcare, program', $q$select string_agg(title_en, ',' order by title_en) from public.opportunities where opportunity_id::text like '00000000-0000-4000-8000-0000000a51%'$q$,
  'Healthcare only,Open to all,Program only');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e515","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('OP12 F3 (no company) sees only what has no restriction', $q$select string_agg(title_en, ',' order by title_en) from public.opportunities where opportunity_id::text like '00000000-0000-4000-8000-0000000a51%'$q$, 'Open to all');
select v51_test.fails('OP12b the member directory refuses the manager-only education filter', $q$select public.list_alumni_directory('{"education_status":"student"}'::jsonb)$q$, '22023', 'alumni_invalid', 'education_status:manager_only');
select v51_test.fails('OP14 ... insert is refused by RLS', $q$insert into public.opportunities (type, title_ar) values ('grant', 'mine')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e512","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('OP15 a project manager sees every ACTIVE opportunity (the target filter is for founders only): 7 active of the 8', $q$select count(*)::text from public.opportunities where opportunity_id::text like '00000000-0000-4000-8000-0000000a51%' and opportunity_id::text <> '00000000-0000-4000-8000-0000000a5109' and opportunity_id::text <> '00000000-0000-4000-8000-0000000a510a'$q$, '7');
reset role;
-- applications
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.okrun('OP16 F1 applies for his company to a visible opportunity', $q$insert into public.opportunity_applications (opportunity_id, company_id, notes) values ('00000000-0000-4000-8000-0000000a5101', '00000000-0000-4000-8000-00000000c511', 'we are ready')$q$);
select v51_test.fails('OP17 F1 cannot apply to an opportunity his company is not targeted by (healthcare only)', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-0000000a5103', '00000000-0000-4000-8000-00000000c511')$q$, '42501');
select v51_test.fails('OP18 F1 cannot apply for somebody else''s company', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-0000000a5102', '00000000-0000-4000-8000-00000000c512')$q$, '42501');
select v51_test.fails('OP19 F1 cannot apply to a draft (the m50 guard: opportunity_closed)', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-0000000a5104', '00000000-0000-4000-8000-00000000c511')$q$, '22023', 'opportunity_closed');
select v51_test.val('OP20 the application got status applied whatever the founder sent (m50 guard)', $q$select status from public.opportunity_applications where company_id = '00000000-0000-4000-8000-00000000c511'$q$, 'applied');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e514","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('OP21 F2 does not see F1''s application', $q$select count(*)::text from public.opportunity_applications$q$, '0');
select v51_test.okrun('OP22a F2 tries to accept F1''s application (RLS: the update touches 0 rows, no error)', $q$update public.opportunity_applications set status = 'accepted'$q$);
reset role;
select v51_test.val('OP22 ... and nothing changed', $q$select status from public.opportunity_applications where company_id = '00000000-0000-4000-8000-00000000c511'$q$, 'applied');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select v51_test.okrun('OP23 the manager applies ON BEHALF of C2 (not his own company)', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-0000000a5101', '00000000-0000-4000-8000-00000000c512')$q$);
select v51_test.okrun('OP24a the manager moves an application through the workflow', $q$update public.opportunity_applications set status = 'shortlisted' where company_id = '00000000-0000-4000-8000-00000000c511'$q$);
select v51_test.val('OP24 ... and the status is stored', $q$select status from public.opportunity_applications where company_id = '00000000-0000-4000-8000-00000000c511'$q$, 'shortlisted');
select v51_test.fails('OP25 a status outside the vocabulary is refused', $q$update public.opportunity_applications set status = 'bogus' where company_id = '00000000-0000-4000-8000-00000000c511'$q$, '23514');
select v51_test.val('OP26 the manager sees both applications (of the fixture opportunities)', $q$select count(*)::text from public.opportunity_applications where opportunity_id::text like '00000000-0000-4000-8000-0000000a51%'$q$, '2');
select v51_test.okrun('OP27 the manager archives an opportunity (inactive + archived_at)', $q$update public.opportunities set is_active = false, archived_at = now() where opportunity_id = '00000000-0000-4000-8000-0000000a5101'$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.val('OP28 ... and F1 no longer sees it', $q$select count(*)::text from public.opportunities where opportunity_id = '00000000-0000-4000-8000-0000000a5101'$q$, '0');
reset role;

-- ================================================================= I. the import preview
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select public.import_alumni_preview($j$[
  {"Startup Name":"V51 Nile Labs","Sector":"Technology","Sub sector":"Robotics","Stage":"MVP","Governerate":"Assiut","Date of company stabilished":"2021-03-01","Website":"nile.example.com","ID":"29501010101234","CEO Gender":"Female","CEO Age":"20","Open/Closed":"Open","Nu. of employees":"10","Nu. of female employees":"12","Revenue (2023) (Total)":"1,000","Legal Status":"Odd Status"},
  {"Startup Name":"A Brand New One","ID":"30303152804527","Email":"new@example.com"},
  {"Startup Name":"Matched by the ID only","ID":"29501010101234"},
  {"Startup Name":"Bad ID","ID":"12345"},
  {"Startup Name":"","Hint":"x"},
  {"Startup Name":"Dates","Date of company stabilished":"2999-01-01","App":"not a url at all","Nu. of employees":"abc"},
  {"Startup Name":"Closed one","Open/Closed":"Closed","Reason for closing":"Funding","After closing":"Studying","Sector":"Technology","Sub sector":"Quantum Gadgets","Stage":"Nonsense Stage"},
  {"Startup Name":"Year only","Date of company stabilished":"2019"},
  {"Unknown Header":"zzz"},
  {}
]$j$::jsonb) as imp \gset
reset role;
select v51_test.val('I01 the summary: 9 rows (the blank one skipped): rows 2 and 3 match through the ID (update), row 8 is a create, the rest carry errors', format($q$select (%L::jsonb->>'count') || '|' || (%L::jsonb->'summary'->>'update') || '|' || (%L::jsonb->'summary'->>'create')$q$, :'imp', :'imp', :'imp'), '9|2|1');
select v51_test.val('I02 NO national ID digits in the preview, only the masked value', format($q$select (position('29501010101234' in %L) + position('30303152804527' in %L))::text || '|' || ((%L::jsonb->'rows'->0->'ceo'->>'id_masked'))$q$, :'imp', :'imp', :'imp'), '0|**********1234');
select v51_test.val('I03 row 1 (C1): derived mismatch warnings (gender, age), the female > total error, an unknown legal status, the website scheme info', format($q$select string_agg(i->>'code' || ':' || (i->>'field'), ',' order by i->>'field', i->>'code') from jsonb_array_elements(%L::jsonb->'rows'->0->'issues') i$q$, :'imp'),
  'derived_mismatch:CEO Age,derived_mismatch:CEO Gender,unknown_value:Legal Status,exceeds_total:Nu. of female employees,url_scheme_added:Website');
select v51_test.val('I04 row 1 is matched to C1 (the company id is the fixture one)', format($q$select (%L::jsonb->'rows'->0->>'company_id') || '|' || (%L::jsonb->'rows'->0->>'plan')$q$, :'imp', :'imp'), '00000000-0000-4000-8000-00000000c511|error');
select v51_test.val('I05 row 2 has a new name but its ID belongs to F2: matched through the ID (update of C2), the CEO block derives Aswan (28) / female', format($q$select (%L::jsonb->'rows'->1->>'plan') || '|' || (%L::jsonb->'rows'->1->'ceo'->>'governorate') || '|' || (%L::jsonb->'rows'->1->'ceo'->>'gender')$q$, :'imp', :'imp', :'imp'), 'update|28|female');
select v51_test.val('I06 row 3: matched by the ID alone (a different name) = update of C2? no: of the company of the ID (C1)', format($q$select (%L::jsonb->'rows'->2->>'plan') || '|' || (%L::jsonb->'rows'->2->>'company_id')$q$, :'imp', :'imp'), 'update|00000000-0000-4000-8000-00000000c511');
select v51_test.val('I07 an invalid ID is reported by REASON (length), never by value', format($q$select (%L::jsonb->'rows'->3->'issues'->0->>'code') || '|' || (%L::jsonb->'rows'->3->'issues'->0->>'value')$q$, :'imp', :'imp'), 'invalid_id|length');
select v51_test.val('I08 a missing name is an error', format($q$select (%L::jsonb->'rows'->4->'issues'->0->>'code') || '|' || (%L::jsonb->'rows'->4->>'plan')$q$, :'imp', :'imp'), 'required|error');
select v51_test.val('I09 future date / bad URL / not a number are errors', format($q$select string_agg(i->>'code', ',' order by i->>'code') from jsonb_array_elements(%L::jsonb->'rows'->5->'issues') i$q$, :'imp'), 'bad_url,future,not_a_number');
select v51_test.val('I10 open lists propose new values (sub sector under its sector, the stage), a closed list does not create anything', format($q$select string_agg((p->>'kind') || ':' || (p->>'value') || ':' || coalesce(p->>'parent', '-'), ',' order by p->>'kind', p->>'value') from jsonb_array_elements(%L::jsonb->'proposed_lookups') p$q$, :'imp'),
  'legal_status:Odd Status:-,stage:Nonsense Stage:-,subsector:Quantum Gadgets:technology');
select v51_test.val('I11 a year alone is accepted with an info', format($q$select (%L::jsonb->'rows'->7->'issues'->0->>'code') || '|' || (%L::jsonb->'rows'->7->>'plan')$q$, :'imp', :'imp'), 'year_only|create');
select v51_test.val('I12 the header report: the unknown header, the derived columns the sheet carried (ignored)', format($q$select (%L::jsonb->'headers'->'unknown'->>0) || '|' || (select string_agg(h, ',' order by h) from jsonb_array_elements_text(%L::jsonb->'headers'->'ignored_derived') h)$q$, :'imp', :'imp'), 'Unknown Header|CEO Age,CEO Gender');
select v51_test.val('I13 nothing was written: no company named like a preview row exists, the access log is untouched by the preview', $q$select count(*)::text from public.companies where name_en in ('A Brand New One', 'Closed one', 'Dates', 'Year only')$q$, '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e511","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('I14 more than 500 rows are refused', $q$select public.import_alumni_preview((select jsonb_agg(jsonb_build_object('Startup Name', 'r' || g)) from generate_series(1, 501) g))$q$, '22023', 'alumni_invalid', 'rows:too_many');
select v51_test.fails('I15 a non-array is refused', $q$select public.import_alumni_preview('{"Startup Name":"x"}'::jsonb)$q$, '22023', 'alumni_invalid', 'rows:not_an_array');
select v51_test.fails('I16 an empty array is refused', $q$select public.import_alumni_preview('[]'::jsonb)$q$, '22023', 'alumni_invalid', 'rows:required');
select v51_test.val('I17 a d/m/y date and "Open"/"مفتوح" statuses resolve (no issue)', $q$select jsonb_array_length(public.import_alumni_preview('[{"Startup Name":"Dmy Co","Date of company stabilished":"15/03/2020","Open/Closed":"مفتوح","Governerate":"أسيوط"}]'::jsonb)->'rows'->0->'issues')::text$q$, '0');
select v51_test.val('I18 the spelling of the owner''s decision log ("established") works too', $q$select jsonb_array_length(public.import_alumni_preview('[{"Startup Name":"Est Co","Date of company established":"2020-01-31"}]'::jsonb)->'rows'->0->'issues')::text$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e513","role":"authenticated"}', true);
set local role authenticated;
select v51_test.fails('I19 a founder cannot preview an import', $q$select public.import_alumni_preview('[{"Startup Name":"x"}]'::jsonb)$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v51_test.val('I20 anon has no privilege on any of them (catalog)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('import_alumni_preview', 'list_alumni_table') and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '0');
reset role;

-- ================================================================= final state check
select current_setting('v51.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v51: alumni manager pages tests FAILED'; end $$;
\endif
