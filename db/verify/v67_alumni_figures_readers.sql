-- v67_alumni_figures_readers  (m67: graphs, aggregates, table, directory and export read the FROZEN quarterly snapshots ONLY; the portfolio indicators by quarter)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e67x users / c67x companies):  AM = alumni_manager (e671), F1 = founder of Alpha (e673), PM = project_manager (e672)
--   Alpha + Beta (technology, Cairo), Gamma + Delta (agriculture, Aswan). Snapshots are inserted directly (as the owner): the quarters 2025-Q4 .. 2026-Q2 with known numbers.
--   Gamma's 2025-Q4 snapshot is NOT reported but carries 999999 / 99 (a carried-forward value that must never count); Beta closes in 2026-Q2; Delta never reports.
-- NEVER call an app_private helper while the session role is anon / authenticated.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v67.res', '', false) \gset

begin;
create schema v67_test;
grant usage on schema v67_test to public;
create or replace function v67_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v67.res', current_setting('v67.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v67_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v67_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v67_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v67_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v67_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v67_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
revoke all on all functions in schema v67_test from public;
grant execute on all functions in schema v67_test to anon, authenticated, service_role;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e671','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v67-am@example.invalid','{"provisioned":true}','{"full_name":"V67 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e672','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v67-pm@example.invalid','{"provisioned":true}','{"full_name":"V67 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e673','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v67-f1@example.invalid','{"provisioned":true}','{"full_name":"V67 Founder One"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e671','alumni_manager'), ('00000000-0000-4000-8000-00000000e672','project_manager'), ('00000000-0000-4000-8000-00000000e673','founder');
insert into public.companies (id, name_en, name_ar, created_by, is_alumni, sector_key, governorate_code, directory_visibility, operating_status, closed_on) values
  ('00000000-0000-4000-8000-00000000c671', 'V67 Alpha', 'ألفا', null, true, 'technology', 1, 'alumni', 'open', null),
  ('00000000-0000-4000-8000-00000000c672', 'V67 Beta', 'بيتا', null, true, 'technology', 1, 'alumni', 'closed', date '2026-05-01'),
  ('00000000-0000-4000-8000-00000000c673', 'V67 Gamma', 'جاما', null, true, 'agriculture', 28, 'alumni', 'open', null),
  ('00000000-0000-4000-8000-00000000c674', 'V67 Delta', 'دلتا', null, true, 'agriculture', 28, 'alumni', 'open', null);
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values ('00000000-0000-4000-8000-00000000f671', 'V67 One', 'واحد', 'zz-v67-f1@example.invalid', '00000000-0000-4000-8000-00000000e673');
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000c671', '00000000-0000-4000-8000-00000000f671', true);
insert into public.company_snapshots (company_id, snapshot_type, period_year, period_key, status, frozen_at, frozen_source, reported, revenue_total, employees_total, employees_female, funding_raised_total, operating_status, team_size, female_founders) values
  ('00000000-0000-4000-8000-00000000c671', 'quarter', 2025, '2025-Q4', 'frozen', now(), 'auto', true, 100, 10, 4, 1000, 'open', 2, 1),
  ('00000000-0000-4000-8000-00000000c671', 'quarter', 2026, '2026-Q1', 'frozen', now(), 'auto', true, 150, 12, 5, 1000, 'open', 2, 1),
  ('00000000-0000-4000-8000-00000000c671', 'quarter', 2026, '2026-Q2', 'frozen', now(), 'auto', true, 300, 15, 7, 2000, 'open', 3, 1),
  ('00000000-0000-4000-8000-00000000c672', 'quarter', 2025, '2025-Q4', 'frozen', now(), 'auto', true, 50, 5, 1, 500, 'open', 1, 0),
  ('00000000-0000-4000-8000-00000000c672', 'quarter', 2026, '2026-Q1', 'frozen', now(), 'auto', true, 70, 5, 1, null, 'open', 1, 0),
  ('00000000-0000-4000-8000-00000000c672', 'quarter', 2026, '2026-Q2', 'frozen', now(), 'auto', false, null, null, null, null, 'closed', 1, 0),
  ('00000000-0000-4000-8000-00000000c673', 'quarter', 2025, '2025-Q4', 'frozen', now(), 'auto', false, 999999, 99, 99, 999999, 'open', 1, 1),
  ('00000000-0000-4000-8000-00000000c673', 'quarter', 2026, '2026-Q1', 'frozen', now(), 'auto', true, 200, 20, 10, null, 'open', 1, 1),
  ('00000000-0000-4000-8000-00000000c673', 'quarter', 2026, '2026-Q2', 'frozen', now(), 'auto', true, 400, 22, 11, null, 'open', 1, 1),
  ('00000000-0000-4000-8000-00000000c674', 'quarter', 2026, '2026-Q2', 'frozen', now(), 'auto', false, null, null, null, null, 'open', 1, 0);
-- a DRAFT on Alpha (777) that no reader may show
insert into public.company_figures (company_id, period_key, revenue_total, employees_total, updated_source) values ('00000000-0000-4000-8000-00000000c671', '2026-Q4', 777, 31, 'founder');
select set_config('request.jwt.claims', '', true);

-- ================================================================= P. the portfolio by quarter (manager only), from snapshots only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e671","role":"authenticated"}', true);
set local role authenticated;
select set_config('v67.p', public.get_alumni_portfolio('{}'::jsonb, '2025-Q4', '2026-Q2')::text, false);
select set_config('v67.pt', public.get_alumni_portfolio('{"sector":"technology"}'::jsonb, '2025-Q4', '2026-Q2')::text, false);
select set_config('v67.pw', public.get_alumni_portfolio('{"sector":"agriculture","governorate":"28"}'::jsonb, '2026-Q1', '2026-Q2')::text, false);
select set_config('v67.pd', public.get_alumni_portfolio('{}'::jsonb)::text, false);
reset role;
select v67_test.val('P01 2025-Q4: three companies, two REPORTING; revenue sum 150, median 75; employees 15 (the carried 99 of Gamma is NOT counted); female share 33.3; funding 1500',
  $q$select concat_ws('|', p->>'companies', p->>'reporting', p->>'revenue_total', p->>'revenue_median', p->>'employees_total', p->>'female_share', p->>'funding_total', p->>'survival_rate', p->>'closing_rate')
     from jsonb_array_elements(current_setting('v67.p')::jsonb->'periods') p where p->>'period_key' = '2025-Q4'$q$, '3|2|150.00|75|15|33.3|1500.00|100.0');
select v67_test.val('P02 2026-Q1: three reporting; revenue 420, median 150, employees 37, female share 43.2, at risk 3 and nobody closed (closing 0.0)',
  $q$select concat_ws('|', p->>'companies', p->>'reporting', p->>'revenue_total', p->>'revenue_median', p->>'employees_total', p->>'female_share', p->>'at_risk', p->>'closed_new', p->>'closing_rate')
     from jsonb_array_elements(current_setting('v67.p')::jsonb->'periods') p where p->>'period_key' = '2026-Q1'$q$, '3|3|420.00|150|37|43.2|3|0|0.0');
select v67_test.val('P03 2026-Q2: four companies, TWO reporting (Alpha, Gamma); revenue 700, median 350; Beta CLOSED: survival 75.0, closing 33.3 (1 of 3 open before); funding 2000; corrected 0',
  $q$select concat_ws('|', p->>'companies', p->>'reporting', p->>'revenue_total', p->>'revenue_median', p->>'employees_total', p->>'female_share', p->>'open', p->>'closed', p->>'survival_rate', p->>'closed_new', p->>'at_risk', p->>'closing_rate', p->>'funding_total', p->>'corrected')
     from jsonb_array_elements(current_setting('v67.p')::jsonb->'periods') p where p->>'period_key' = '2026-Q2'$q$, '4|2|700.00|350|37|48.6|3|1|75.0|1|3|33.3|2000.00|0');
select v67_test.val('P04 the DRAFT (revenue 777, employees 31) is in NO period: every period total stays a frozen sum', $q$select count(*)::text from jsonb_array_elements(current_setting('v67.p')::jsonb->'periods') p where (p->>'revenue_total')::numeric = 777 or (p->>'employees_total')::int = 31$q$, '0');
select v67_test.val('P05 the sector filter: technology only (Alpha + Beta): 2025-Q4 revenue 150, 2026-Q2 revenue 300, closing 50.0 (Beta of Alpha + Beta)',
  $q$select concat_ws('|', (select p->>'revenue_total' from jsonb_array_elements(current_setting('v67.pt')::jsonb->'periods') p where p->>'period_key' = '2025-Q4'),
     (select p->>'revenue_total' from jsonb_array_elements(current_setting('v67.pt')::jsonb->'periods') p where p->>'period_key' = '2026-Q2'),
     (select p->>'closing_rate' from jsonb_array_elements(current_setting('v67.pt')::jsonb->'periods') p where p->>'period_key' = '2026-Q2'))$q$, '150.00|300.00|50.0');
select v67_test.val('P06 sector + governorate filters together: agriculture / Aswan, two periods, Gamma + Delta', $q$select concat_ws('|', jsonb_array_length(current_setting('v67.pw')::jsonb->'periods')::text,
  (select p->>'companies' from jsonb_array_elements(current_setting('v67.pw')::jsonb->'periods') p where p->>'period_key' = '2026-Q1'),
  (select p->>'companies' from jsonb_array_elements(current_setting('v67.pw')::jsonb->'periods') p where p->>'period_key' = '2026-Q2'),
  (select p->>'revenue_total' from jsonb_array_elements(current_setting('v67.pw')::jsonb->'periods') p where p->>'period_key' = '2026-Q2'))$q$, '2|1|2|400.00');
select v67_test.val('P07 default range: the 8 quarters ending at the latest frozen period; empty periods are returned empty (a continuous axis)', $q$select concat_ws('|', current_setting('v67.pd')::jsonb->>'latest', current_setting('v67.pd')::jsonb->>'to',
  jsonb_array_length(current_setting('v67.pd')::jsonb->'periods')::text, (select p->>'companies' from jsonb_array_elements(current_setting('v67.pd')::jsonb->'periods') p where p->>'period_key' = '2024-Q4'))$q$, '2026-Q2|2026-Q2|8|0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e671","role":"authenticated"}', true);
set local role authenticated;
select v67_test.err('P10 a bad period', $$select public.get_alumni_portfolio('{}'::jsonb, '2026-Q9', null)$$, '22023');
select v67_test.err('P11 from after to', $$select public.get_alumni_portfolio('{}'::jsonb, '2026-Q2', '2026-Q1')$$, '22023');
select v67_test.err('P12 a range longer than 40 quarters', $$select public.get_alumni_portfolio('{}'::jsonb, '2010-Q1', '2026-Q2')$$, '22023');
select v67_test.err('P13 an unknown filter key', $$select public.get_alumni_portfolio('{"nope":1}'::jsonb)$$, '22023');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e673","role":"authenticated"}', true);
set local role authenticated;
select v67_test.err('P20 a founder cannot read the portfolio', $$select public.get_alumni_portfolio('{}'::jsonb)$$, '42501');
select v67_test.err('P21 ... nor the analytics', $$select public.get_alumni_analytics('{}'::jsonb, 2026)$$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e672","role":"authenticated"}', true);
set local role authenticated;
select v67_test.err('P22 a project manager cannot read the portfolio', $$select public.get_alumni_portfolio('{}'::jsonb)$$, '42501');
reset role;
select v67_test.val('P23 anon cannot execute the portfolio (privilege)', $q$select has_function_privilege('anon', 'public.get_alumni_portfolio(jsonb,text,text)'::regprocedure, 'EXECUTE')::text$q$, 'false');

-- ================================================================= R. the readers of the yearly shape: frozen only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e671","role":"authenticated"}', true);
set local role authenticated;
select set_config('v67.an', public.get_alumni_analytics('{}'::jsonb, 2026)::text, false);
select set_config('v67.tb', public.list_alumni_table('{}'::jsonb, 25, 0, 'name', 'asc', 2026)::text, false);
select set_config('v67.ex', public.export_alumni_rows('{}'::jsonb, 2026, 'en')::text, false);
select set_config('v67.ov', public.get_alumni_overview()::text, false);
select set_config('v67.dir', public.list_alumni_directory('{}'::jsonb, 50, 0, 'name')::text, false);
select set_config('v67.att', public.list_alumni_attention('{"q":"v67"}'::jsonb, null, 25, 0, 'missing')::text, false);
reset role;
select v67_test.val('R01 analytics 2026 totals: revenue = the reported 2026 quarters (Alpha 450 + Beta 70 + Gamma 600 = 1120), NOT 777, NOT the carried 999999; employees = the latest reported per company (15 + 5 + 22)',
  $q$select concat_ws('|', current_setting('v67.an')::jsonb->'totals'->>'revenue', current_setting('v67.an')::jsonb->'totals'->>'employees', current_setting('v67.an')::jsonb->'totals'->>'reporting_year', current_setting('v67.an')::jsonb->'totals'->>'companies')$q$, '1120.00|42|3|4');
select v67_test.val('R02 analytics by_year (from snapshots): 2025 reports Alpha + Beta (two), 2026 three', $q$select string_agg((y->>'year') || ':' || (y->>'companies_reporting') || ':' || (y->>'revenue'), ',' order by y->>'year')
  from jsonb_array_elements(current_setting('v67.an')::jsonb->'by_year') y$q$, '2025:2:150.00,2026:3:1120.00');
select v67_test.val('R03 the manager table: Alpha row shows the FROZEN revenue 450 for 2026 (not the draft 777) and a freshness indicator', $q$select concat_ws('|', r->'metrics'->>'revenue_total', r->'figures'->>'status', r->'figures'->>'period', ((r->'figures'->>'updated_at') is not null)::text)
  from jsonb_array_elements(current_setting('v67.tb')::jsonb->'rows') r where r->>'name_en' = 'V67 Alpha'$q$, '450.00|updated|' || (select app_private.alumni_period_key(now())) || '|true');
select v67_test.val('R04 ... Gamma (no draft) shows not_updated and its frozen figures; Delta (never reported) shows none', $q$select concat_ws('|', (select r->'figures'->>'status' from jsonb_array_elements(current_setting('v67.tb')::jsonb->'rows') r where r->>'name_en' = 'V67 Gamma'),
  (select r->'metrics'->>'revenue_total' from jsonb_array_elements(current_setting('v67.tb')::jsonb->'rows') r where r->>'name_en' = 'V67 Gamma'),
  (select coalesce(r->'metrics'->>'revenue_total', 'NULL') from jsonb_array_elements(current_setting('v67.tb')::jsonb->'rows') r where r->>'name_en' = 'V67 Delta'))$q$, 'not_updated|600.00|NULL');
select v67_test.val('R05 the Excel export: the Revenue (2026) (Total) column is the frozen sum per company (Alpha 450), never the draft', $q$select concat_ws('|',
  (select c.ord::text from jsonb_array_elements(current_setting('v67.ex')::jsonb->'columns') with ordinality c(col, ord) where c.col->>'key' = 'revenue'),
  (select c.col->>'header' from jsonb_array_elements(current_setting('v67.ex')::jsonb->'columns') with ordinality c(col, ord) where c.col->>'key' = 'revenue'),
  (select r->>((select c.ord::int - 1 from jsonb_array_elements(current_setting('v67.ex')::jsonb->'columns') with ordinality c(col, ord) where c.col->>'key' = 'revenue')) from jsonb_array_elements(current_setting('v67.ex')::jsonb->'rows') r where r->>0 = 'V67 Alpha'))$q$,
  '36|Revenue (2026) (Total)|450.00');
select v67_test.val('R06 overview: latest_year comes from the snapshots', $q$select current_setting('v67.ov')::jsonb->>'latest_year'$q$, '2026');
select v67_test.val('R07 the manager directory rows carry the freshness indicator; the attention queue answers', $q$select concat_ws('|', (select r->'figures'->>'status' from jsonb_array_elements(current_setting('v67.dir')::jsonb->'rows') r where r->>'name_en' = 'V67 Alpha'),
  (select r->'latest'->>'year' from jsonb_array_elements(current_setting('v67.dir')::jsonb->'rows') r where r->>'name_en' = 'V67 Alpha'), (current_setting('v67.att')::jsonb ? 'rows')::text)$q$, 'updated|2026|true');
select v67_test.val('R08 attention: "latest_figures" is NOT missing for Alpha (a reported quarter + a draft with figures) and IS missing for Delta (nothing)', $q$select concat_ws('|',
  (select (r->'missing' ? 'latest_figures')::text from jsonb_array_elements(current_setting('v67.att')::jsonb->'rows') r where r->>'name_en' = 'V67 Alpha'),
  (select (r->'missing' ? 'latest_figures')::text from jsonb_array_elements(current_setting('v67.att')::jsonb->'rows') r where r->>'name_en' = 'V67 Delta'))$q$, 'false|true');

-- the founder's own readers
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e673","role":"authenticated"}', true);
set local role authenticated;
select set_config('v67.me', public.get_my_alumni_profile()::text, false);
select set_config('v67.fdir', public.list_alumni_directory('{}'::jsonb, 50, 0, 'name')::text, false);
reset role;
select v67_test.val('R10 the founder home: his company carries the figures state of the calendar quarter + the deadline', $q$select concat_ws('|', c->'figures'->>'status', c->'figures'->>'period', c->'figures'->>'deadline')
  from jsonb_array_elements(current_setting('v67.me')::jsonb->'companies') c where c->>'name_en' = 'V67 Alpha'$q$,
  'updated|' || app_private.alumni_period_key(now()) || '|' || ((app_private.alumni_period_end(app_private.alumni_period_key(now())) at time zone 'Africa/Cairo')::date - 1)::text);
select v67_test.val('R11 the MEMBER directory (a founder) carries NO freshness key and no figures', $q$select count(*)::text from jsonb_array_elements(current_setting('v67.fdir')::jsonb->'rows') r where r ? 'figures' or r ? 'latest'$q$, '0');

-- ================================================================= S. a structural proof: nothing reads the draft but the quarterly model
select v67_test.val('S01 no reader function outside the model references the draft table', $q$select coalesce(string_agg(p.proname, ','), 'none') from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ilike '%company_figures%'
  and p.proname not in ('alumni_freeze_one', 'alumni_figures_status', 'alumni_figures_json', 'save_company_figures', 'confirm_company_figures', 'alumni_company_missing', 'alumni_merge_company_data', 'alumni_directory_page', 'list_alumni_table',
                        'get_my_alumni_profile', 'list_alumni_attention', 'list_alumni_quarter_status', 'alumni_reminder_audience', 'alumni_reminders_send', 'alumni_target_period')$q$, 'none');

-- ================================================================= final state check
select current_setting('v67.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v67: figures readers tests FAILED'; end $$;
\endif
