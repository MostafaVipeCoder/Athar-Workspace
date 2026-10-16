-- v66_alumni_quarterly_figures  (m65 + m66: no per-edit history; the draft + the frozen quarter; freeze / reopen / correct / confirm; the owner's scenario)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e66x users / c66x companies / f66x founders):  ADM = super_admin (e660), AM = alumni_manager (e661), PM = project_manager (e662),
--   F1 = founder of CO1 (e663), F2 = founder of CO2 (e664), F3 = founder of CO3 (e665, a company that is NOT alumni)
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute crashes this local Postgres image):
-- helpers are called as the owner, denials of anon are asserted with has_function_privilege.
-- The scheduler's clock is an argument (app_private.alumni_freeze_due(p_now)): "the quarter ended" is simulated with 2027-01-01 10:00 Cairo time, nothing waits for real time.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v66.res', '', false) \gset

begin;
create schema v66_test;
grant usage on schema v66_test to public;
create or replace function v66_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v66.res', current_setting('v66.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v66_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v66_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v66_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
-- the statement must FAIL with this SQLSTATE or this hint
create or replace function v66_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v66_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v66_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
create or replace function v66_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v66_test.t(p_key, true, 'ok');
  exception when others then
    perform v66_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v66_test from public;
grant execute on all functions in schema v66_test to anon, authenticated, service_role;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e660','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v66-adm@example.invalid','{"provisioned":true}','{"full_name":"V66 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e661','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v66-am@example.invalid','{"provisioned":true}','{"full_name":"V66 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e662','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v66-pm@example.invalid','{"provisioned":true}','{"full_name":"V66 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e663','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v66-f1@example.invalid','{"provisioned":true}','{"full_name":"V66 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e664','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v66-f2@example.invalid','{"provisioned":true}','{"full_name":"V66 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e665','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v66-f3@example.invalid','{"provisioned":true}','{"full_name":"V66 Founder Three"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e660','super_admin'), ('00000000-0000-4000-8000-00000000e661','alumni_manager'), ('00000000-0000-4000-8000-00000000e662','project_manager'),
  ('00000000-0000-4000-8000-00000000e663','founder'), ('00000000-0000-4000-8000-00000000e664','founder'), ('00000000-0000-4000-8000-00000000e665','founder');
insert into public.companies (id, name_en, name_ar, created_by, is_alumni) values
  ('00000000-0000-4000-8000-00000000c661', 'V66 Nile Co', 'نيل V66', '00000000-0000-4000-8000-00000000e663', true),
  ('00000000-0000-4000-8000-00000000c662', 'V66 Delta Co', 'دلتا V66', '00000000-0000-4000-8000-00000000e664', true),
  ('00000000-0000-4000-8000-00000000c663', 'V66 Not Alumni Co', null, '00000000-0000-4000-8000-00000000e665', false);
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f661', 'V66 One', 'واحد', 'zz-v66-f1@example.invalid', '00000000-0000-4000-8000-00000000e663'),
  ('00000000-0000-4000-8000-00000000f662', 'V66 Two', 'اثنان', 'zz-v66-f2@example.invalid', '00000000-0000-4000-8000-00000000e664'),
  ('00000000-0000-4000-8000-00000000f663', 'V66 Three', 'ثلاثة', 'zz-v66-f3@example.invalid', '00000000-0000-4000-8000-00000000e665');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c661', '00000000-0000-4000-8000-00000000f661', true),
  ('00000000-0000-4000-8000-00000000c662', '00000000-0000-4000-8000-00000000f662', true),
  ('00000000-0000-4000-8000-00000000c663', '00000000-0000-4000-8000-00000000f663', true);
-- a baseline for the "only my fixtures changed" checks
select set_config('v66.n_snap0', (select count(*) from public.company_snapshots)::text, false);
-- the clock of the simulated close: 1 January 2027, 10:00 Cairo (the quarter 2026-Q4 has ended)
select set_config('v66.t_close', '2027-01-01 10:00:00+02', false);

-- ================================================================= A. the audit log is GONE (m65)
select v66_test.val('A01 the log tables are gone', $q$select concat_ws('|', (to_regclass('public.alumni_change_log') is null)::text, (to_regclass('app_private.alumni_log_epoch') is null)::text)$q$, 'true|true');
select v66_test.val('A02 no logging trigger, no logger / replay / viewer function remains', $q$select concat_ws('|',
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname like '%alumni%log%')::text,
  (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and (p.proname like 'alumni\_log\_%' escape '\' or p.proname in ('alumni_state_as_of', 'alumni_state_diff', 'list_alumni_history', 'alumni_request_id', 'alumni_section_of', 'alumni_state_current', 'alumni_state_flat')))::text,
  (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and (p.prosrc ilike '%alumni\_change\_log%' escape '\' or p.prosrc ilike '%app.alumni_reason%'))::text)$q$, '0|0|0');
select v66_test.val('A03 the last-modified machinery stays: five stamp triggers + the no-op aware touch triggers', $q$select concat_ws('|',
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_biu_stamp', 'founders_biu_stamp', 'company_founders_biu_stamp', 'company_internal_biu_stamp', 'founder_identities_biu_stamp'))::text,
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_bu_touch', 'founders_bu_touch', 'company_founders_bu_touch'))::text)$q$, '5|3');
select v66_test.val('A04 the yearly-row writers are gone; the manager RPCs lost the log-only `reason`', $q$select concat_ws('|',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('upsert_company_snapshot', 'review_company_snapshot', 'delete_company_snapshot'))::text,
  (select pronargs from pg_proc where oid = 'public.save_alumni_company(uuid,jsonb,timestamptz)'::regprocedure)::text,
  (select pronargs from pg_proc where oid = 'public.save_alumni_founder(uuid,jsonb,timestamptz)'::regprocedure)::text)$q$, '0|3|3');
-- the manager editing features still work and still stamp "last modified"
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.ok', (public.save_alumni_company('00000000-0000-4000-8000-00000000c661', '{"description_en":"Builds boats"}'::jsonb, null) is not null)::text, false);
reset role;
select v66_test.val('A05 a manager edit still works and stamps updated_by / source (the "last modified" indicator)', $q$select concat_ws('|', c.description_en, c.updated_source, (c.updated_by = '00000000-0000-4000-8000-00000000e661')::text)
  from public.companies c where c.id = '00000000-0000-4000-8000-00000000c661'$q$, 'Builds boats|manager|true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select v66_test.val('A06 get_alumni_stamps answers from the rows (company + founders), with the editor name for a manager', $q$select concat_ws('|', public.get_alumni_stamps('00000000-0000-4000-8000-00000000c661')->'company'->>'source',
  public.get_alumni_stamps('00000000-0000-4000-8000-00000000c661')->'company'->>'name', (public.get_alumni_stamps('00000000-0000-4000-8000-00000000c661') ? 'sections')::text)$q$, 'manager|V66 Alumni Manager|false');
reset role;

-- ================================================================= C. catalog / privileges
select v66_test.val('C01 every figures machinery helper is closed to the API roles', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('alumni_tz', 'alumni_period_ok', 'alumni_period_index', 'alumni_period_from_index', 'alumni_period_next', 'alumni_period_prev', 'alumni_period_key', 'alumni_period_start', 'alumni_period_end',
                    'alumni_period_label', 'alumni_deadline_label', 'alumni_figures_status', 'alumni_target_period', 'alumni_clean_figures', 'alumni_freeze_one', 'alumni_freeze_company_due', 'alumni_freeze_due',
                    'alumni_snapshots_json', 'alumni_figures_json')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v66_test.val('C02 the eight public RPCs: authenticated yes, anon no; all SECURITY DEFINER with an empty search_path', $q$select concat_ws('|',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('freeze_due_quarters', 'close_alumni_quarter', 'reopen_alumni_quarter', 'refreeze_alumni_quarter', 'correct_alumni_snapshot', 'save_company_figures', 'confirm_company_figures', 'get_company_figures')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and p.prosecdef and 'search_path=""' = any (p.proconfig))::text,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'freeze_due_quarters' and has_function_privilege('service_role', p.oid, 'EXECUTE'))::text)$q$, '8|1');
select v66_test.val('C03 no API role can write the draft table; anon cannot read it; RLS is forced', $q$select concat_ws('|', has_table_privilege('authenticated', 'public.company_figures', 'INSERT')::text, has_table_privilege('authenticated', 'public.company_figures', 'UPDATE')::text,
  has_table_privilege('authenticated', 'public.company_figures', 'DELETE')::text, has_table_privilege('anon', 'public.company_figures', 'SELECT')::text,
  (select c.relforcerowsecurity::text from pg_class c where c.oid = 'public.company_figures'::regclass))$q$, 'false|false|false|false|true');
select v66_test.val('C04 no API role can write the snapshot table; anon cannot read it', $q$select concat_ws('|', has_table_privilege('authenticated', 'public.company_snapshots', 'INSERT')::text, has_table_privilege('authenticated', 'public.company_snapshots', 'UPDATE')::text,
  has_table_privilege('authenticated', 'public.company_snapshots', 'DELETE')::text, has_table_privilege('anon', 'public.company_snapshots', 'SELECT')::text)$q$, 'false|false|false|false');
select v66_test.val('C05 the year view and the settings are closed to the API roles', $q$select concat_ws('|', has_table_privilege('authenticated', 'app_private.alumni_year_rollup', 'SELECT')::text, has_table_privilege('authenticated', 'app_private.alumni_quarter_settings', 'SELECT')::text)$q$, 'false|false');
select v66_test.val('C06 the quarter table keeps one snapshot per company per quarter (unique index) and the type check no longer knows annual', $q$select concat_ws('|',
  (select count(*) from pg_indexes where tablename = 'company_snapshots' and indexname = 'company_snapshots_quarter_key')::text,
  (select (pg_get_constraintdef(oid) like '%annual%')::text from pg_constraint where conname = 'company_snapshots_type_chk'))$q$, '1|false');

-- ================================================================= Q. the quarter calendar (Africa/Cairo, DST aware)
select v66_test.val('Q01 the zone constant', $q$select app_private.alumni_tz()$q$, 'Africa/Cairo');
select v66_test.val('Q02 a quarter closes at midnight CAIRO time: 2026-12-31 21:59:59 UTC is still Q4, 22:00:00 UTC is Q1 2027 (winter, UTC+2)',
  $q$select concat_ws('|', app_private.alumni_period_key('2026-12-31 21:59:59+00'), app_private.alumni_period_key('2026-12-31 22:00:00+00'))$q$, '2026-Q4|2027-Q1');
select v66_test.val('Q03 ... and in summer (UTC+3): 2026-09-30 20:59:59 UTC is Q3, 21:00:00 UTC is Q4', $q$select concat_ws('|', app_private.alumni_period_key('2026-09-30 20:59:59+00'), app_private.alumni_period_key('2026-09-30 21:00:00+00'))$q$, '2026-Q3|2026-Q4');
select v66_test.val('Q04 period start / end of 2026-Q4', $q$select concat_ws('|', app_private.alumni_period_start('2026-Q4')::text, app_private.alumni_period_end('2026-Q4')::text)$q$, '2026-09-30 21:00:00+00|2026-12-31 22:00:00+00');
select v66_test.val('Q05 next / prev across a year, bad keys give NULL', $q$select concat_ws('|', app_private.alumni_period_next('2026-Q4'), app_private.alumni_period_prev('2027-Q1'), coalesce(app_private.alumni_period_next('2026-Q5'), 'NULL'),
  coalesce(app_private.alumni_period_next('x'), 'NULL'), coalesce(app_private.alumni_period_key(null), 'NULL'))$q$, '2027-Q1|2026-Q4|NULL|NULL|NULL');
select v66_test.val('Q06 labels and the deadline (the last day of the quarter), both languages', $q$select concat_ws('|', app_private.alumni_period_label('2026-Q4', 'en'), app_private.alumni_period_label('2026-Q4', 'ar'),
  app_private.alumni_deadline_label('2026-Q4', 'en'), app_private.alumni_deadline_label('2026-Q4', 'ar'), app_private.alumni_deadline_label('2027-Q1', 'en'))$q$,
  'Q4 2026|الربع الرابع 2026|31 December 2026|31 ديسمبر 2026|31 March 2027');
select v66_test.val('Q07 period_ok: a year out of range, a 5th quarter and NULL are refused', $q$select concat_ws('|', app_private.alumni_period_ok('2026-Q1')::text, app_private.alumni_period_ok('1999-Q1')::text, app_private.alumni_period_ok('2026-Q5')::text, app_private.alumni_period_ok(null)::text)$q$, 'true|false|false|false');

-- ================================================================= D. THE OWNER'S SCENARIO: revenue 10,000, five minutes later 100,000, then the quarter closes
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e663","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.c1', ((public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"revenue_total":10000,"employees_total":5,"employees_female":2,"funding_raised_total":50000}'::jsonb, '-infinity'::timestamptz)->>'changed'))::text, false);
select set_config('v66.c2', ((public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"revenue_total":100000}'::jsonb, null)->>'changed'))::text, false);
reset role;
select v66_test.val('D01 two saves: both change the draft; the draft holds ONE revenue value, 100000', $q$select concat_ws('|', current_setting('v66.c1'), current_setting('v66.c2'), f.revenue_total::text, f.employees_total::text, f.period_key) from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, 'true|true|100000.00|5|2026-Q4');
select v66_test.val('D02 NO snapshot exists yet: nothing a graph can read changed', $q$select count(*)::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661'$q$, '0');
select v66_test.val('D03 the draft keeps only who / when of the LAST save (no per-edit trail anywhere)', $q$select concat_ws('|', f.updated_source, (f.updated_by = '00000000-0000-4000-8000-00000000e663')::text) from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, 'founder|true');
select set_config('v66.upd_before', (select updated_at::text from public.company_figures where company_id = '00000000-0000-4000-8000-00000000c661'), false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e663","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.c3', ((public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"revenue_total":100000,"employees_total":5}'::jsonb, current_setting('v66.upd_before')::timestamptz)->>'changed'))::text, false);
reset role;
select v66_test.val('D04 a save that changes nothing does not move "last modified"', $q$select concat_ws('|', current_setting('v66.c3'), (f.updated_at = current_setting('v66.upd_before')::timestamptz)::text) from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, 'false|true');
-- the close, as the scheduler would run it (a clock argument): freezes the CURRENT draft values
select set_config('v66.fr1', (app_private.alumni_freeze_due(current_setting('v66.t_close')::timestamptz, 'auto', null)->>'frozen')::text, false);
select v66_test.val('D05 the close froze the alumni companies with a snapshot each (the two alumni fixtures at least, the non-alumni none)', $q$select concat_ws('|', (current_setting('v66.fr1')::int >= 2)::text, (select count(*) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c663')::text)$q$, 'true|0');
select v66_test.val('D06 THE GRAPH HAS ONE POINT for 2026-Q4 with 100000 (no 10000 anywhere), flagged reported and frozen auto', $q$select concat_ws('|', count(*)::text, min(s.period_key), min(s.revenue_total)::text, max(s.revenue_total)::text, bool_and(s.reported)::text, min(s.frozen_source), min(s.status))
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661'$q$, '1|2026-Q4|100000.00|100000.00|true|auto|frozen');
select v66_test.val('D07 stock + cumulative values copied as they were; the derived team size is there; operating status frozen', $q$select concat_ws('|', s.employees_total::text, s.employees_female::text, s.funding_raised_total::text, s.team_size::text, s.operating_status)
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661'$q$, '5|2|50000.00|1|open');
select v66_test.val('D08 carry forward: the flow metric (revenue) is cleared from the draft, the stock / cumulative values stay', $q$select concat_ws('|', coalesce(f.revenue_total::text, 'NULL'), f.employees_total::text, f.funding_raised_total::text)
  from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, 'NULL|5|50000.00');
select v66_test.val('D09 the freeze is IDEMPOTENT: a second run freezes nothing and changes nothing', $q$select (app_private.alumni_freeze_due(current_setting('v66.t_close')::timestamptz, 'auto', null)->>'frozen') || '|' ||
  (select count(*)::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661') || '|' || (select s.revenue_total::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661')$q$, '0|1|100000.00');
select v66_test.val('D10 the last human stamp of the draft was not touched by the freeze', $q$select (f.updated_at = current_setting('v66.upd_before')::timestamptz)::text from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, 'true');
-- the next quarter''s edit never reaches the frozen quarter
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e663","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.tp', (public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"revenue_total":777}'::jsonb, null)->>'target_period')::text, false);
reset role;
select v66_test.val('D11 after the early close the company edits for the NEXT quarter (its target period moved), the frozen quarter is untouched', $q$select concat_ws('|', f.period_key, f.revenue_total::text, (select s.revenue_total::text from public.company_snapshots s where s.company_id = f.company_id and s.period_key = '2026-Q4'))
  from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, '2027-Q1|777.00|100000.00');
select v66_test.val('D12 ... the status of the calendar quarter is "closed", the target quarter "updated"', $q$select concat_ws('|', app_private.alumni_figures_status('00000000-0000-4000-8000-00000000c661', '2026-Q4'), app_private.alumni_figures_status('00000000-0000-4000-8000-00000000c661', '2027-Q1'))$q$, 'closed|updated');

-- ================================================================= E. never overwritten silently; reopen / correct (the correction after the close)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.cl', ((public.close_alumni_quarter('2026-Q4', '00000000-0000-4000-8000-00000000c661')))::text, false);
reset role;
select v66_test.val('E01 "Close quarter now" on a closed quarter overwrites nothing: already_frozen 1, frozen 0, revenue still 100000', $q$select concat_ws('|', (current_setting('v66.cl')::jsonb->>'frozen'), (current_setting('v66.cl')::jsonb->>'already_frozen'),
  (select s.revenue_total::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q4'))$q$, '0|1|100000.00');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('E02 a correction WITHOUT reopening is refused (alumni_not_reopened)', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2026-Q4', '{"revenue_total":1}'::jsonb)$$, 'alumni_not_reopened');
select set_config('v66.ro', ((public.reopen_alumni_quarter('2026-Q4', '00000000-0000-4000-8000-00000000c661')->>'reopened'))::text, false);
reset role;
select v66_test.val('E03 reopen: the manager reopens ONE company\''s quarter; the values are unchanged, the status says so', $q$select concat_ws('|', current_setting('v66.ro'), s.status, s.revenue_total::text, (s.corrected_at is null)::text, (s.reopened_by = '00000000-0000-4000-8000-00000000e661')::text)
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q4'$q$, '1|reopened|100000.00|true|true');
select v66_test.val('E04 the OTHER company is not reopened', $q$select s.status from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c662' and s.period_key = '2026-Q4'$q$, 'frozen');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.k1', (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2026-Q4', '{"revenue_total":120000}'::jsonb)->>'changed')::text, false);
reset role;
select v66_test.val('E05 the CORRECTION: new value 120000, flagged corrected (when / by), the ORIGINAL frozen value kept once in previous_values, frozen again', $q$select concat_ws('|', current_setting('v66.k1'), s.revenue_total::text, s.previous_values::text, (s.corrected_at is not null)::text,
  (s.corrected_by = '00000000-0000-4000-8000-00000000e661')::text, s.status, (s.reopened_at is null)::text) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q4'$q$,
  'true|120000.00|{"revenue_total": 100000.00}|true|true|frozen|true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.ok', (public.reopen_alumni_quarter('2026-Q4', '00000000-0000-4000-8000-00000000c661') is not null)::text, false);
select set_config('v66.ok', (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2026-Q4', '{"revenue_total":150000,"employees_total":6}'::jsonb) is not null)::text, false);
reset role;
select v66_test.val('E06 a second correction keeps the FIRST frozen value (100000) per metric; a metric that was empty-to-set is annotated too', $q$select concat_ws('|', s.revenue_total::text, s.previous_values->>'revenue_total', s.previous_values->>'employees_total', s.employees_total::text)
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q4'$q$, '150000.00|100000.00|5|6');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.ok', (public.reopen_alumni_quarter('2026-Q4', '00000000-0000-4000-8000-00000000c661') is not null)::text, false);
select set_config('v66.ok', (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2026-Q4', '{"revenue_total":100000,"employees_total":5}'::jsonb) is not null)::text, false);
reset role;
select v66_test.val('E07 a correction BACK to the original value removes the annotation and the corrected flag (no trail of an undone typo)', $q$select concat_ws('|', s.revenue_total::text, coalesce(s.previous_values::text, 'NULL'), (s.corrected_at is null)::text, (s.corrected_by is null)::text, s.status)
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q4'$q$, '100000.00|NULL|true|true|frozen');
-- reopen for ALL, then cancel (refreeze) without a change
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.ro_all', ((public.reopen_alumni_quarter('2026-Q4', null)->>'reopened')::int)::text, false);
select set_config('v66.rf_all', ((public.refreeze_alumni_quarter('2026-Q4', null)->>'refrozen')::int)::text, false);
reset role;
select v66_test.val('E08 reopen for ALL companies, then refreeze: every reopened snapshot is back to frozen, nothing changed, nothing flagged', $q$select concat_ws('|', (current_setting('v66.ro_all')::int >= 2)::text, (current_setting('v66.rf_all')::int = current_setting('v66.ro_all')::int)::text,
  (select count(*) from public.company_snapshots s where s.period_key = '2026-Q4' and s.status <> 'frozen')::text, (select s.revenue_total::text from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q4'),
  (select count(*) from public.company_snapshots s where s.period_key = '2026-Q4' and s.corrected_at is not null)::text)$q$, 'true|true|0|100000.00|0');
-- backfill of an ended quarter with no snapshot (before the first tracked quarter)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.bf', (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2026-Q3', '{"revenue_total":40000,"employees_total":4,"employees_female":1}'::jsonb)->>'backfilled')::text, false);
reset role;
select v66_test.val('E09 backfill of an ended quarter: a MANUAL snapshot, reported, not flagged corrected (nothing was overwritten)', $q$select concat_ws('|', current_setting('v66.bf'), s.frozen_source, s.reported::text, s.status, s.revenue_total::text, (s.corrected_at is null)::text, coalesce(s.previous_values::text, 'NULL'))
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c661' and s.period_key = '2026-Q3'$q$, 'true|manual|true|frozen|40000.00|true|NULL');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('E10 an open / future quarter cannot be backfilled or closed (alumni_quarter_future)', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2099-Q1', '{"revenue_total":1}'::jsonb)$$, 'alumni_quarter_future');
select v66_test.err('E11 ... nor closed before it starts', $$select public.close_alumni_quarter('2099-Q1', null)$$, 'alumni_quarter_future');
select v66_test.err('E12 a correction is validated: employees_female above employees_total', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c662', '2026-Q3', '{"employees_total":2,"employees_female":3}'::jsonb)$$, '22023');
select v66_test.err('E13 ... an unknown key', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c662', '2026-Q3', '{"nope":1}'::jsonb)$$, '22023');
select v66_test.err('E14 ... a bad period', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c662', '2026-Q9', '{"revenue_total":1}'::jsonb)$$, '22023');
reset role;

-- ================================================================= F. permissions: a founder cannot freeze / reopen / correct / read another company
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e663","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('F01 a founder cannot close a quarter', $$select public.close_alumni_quarter('2026-Q4', '00000000-0000-4000-8000-00000000c661')$$, '42501');
select v66_test.err('F02 ... cannot reopen one', $$select public.reopen_alumni_quarter('2026-Q4', '00000000-0000-4000-8000-00000000c661')$$, '42501');
select v66_test.err('F03 ... cannot correct one', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c661', '2026-Q4', '{"revenue_total":1}'::jsonb)$$, '42501');
select v66_test.err('F04 ... cannot refreeze', $$select public.refreeze_alumni_quarter('2026-Q4', null)$$, '42501');
select v66_test.err('F05 ... cannot run the scheduler entry point', $$select public.freeze_due_quarters()$$, '42501');
select v66_test.err('F06 ... cannot read the portfolio', $$select public.get_alumni_portfolio('{}'::jsonb)$$, '42501');
select v66_test.err('F07 ... cannot read ANOTHER company\''s figures (RPC)', $$select public.get_company_figures('00000000-0000-4000-8000-00000000c662')$$, '42501');
select v66_test.err('F08 ... cannot write ANOTHER company\''s draft', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c662', '{"revenue_total":1}'::jsonb, null)$$, '42501');
select v66_test.err('F09 ... cannot confirm ANOTHER company\''s figures', $$select public.confirm_company_figures('00000000-0000-4000-8000-00000000c662')$$, '42501');
select v66_test.val('F10 ... sees ONLY his own company in the snapshot table (RLS)', $q$select string_agg(distinct s.company_id::text, ',') from public.company_snapshots s$q$, '00000000-0000-4000-8000-00000000c661');
select v66_test.val('F11 ... sees ONLY his own draft', $q$select string_agg(f.company_id::text, ',') from public.company_figures f$q$, '00000000-0000-4000-8000-00000000c661');
select v66_test.val('F12 ... reads his own figures: the frozen quarters come with NO editor names', $q$select concat_ws('|', jsonb_array_length(public.get_company_figures('00000000-0000-4000-8000-00000000c661')->'snapshots')::text,
  (public.get_company_figures('00000000-0000-4000-8000-00000000c661')->'draft' ? 'updated_by_name')::text)$q$, '2|false');
select v66_test.err('F13 NULL company: save refuses cleanly (alumni_not_found), confirm is forbidden', $$select public.save_company_figures(null, '{}'::jsonb, null)$$, 'alumni_not_found');
select v66_test.err('F14 ... confirm(null)', $$select public.confirm_company_figures(null)$$, '42501');
select v66_test.err('F15 ... get(null)', $$select public.get_company_figures(null)$$, '42501');
select v66_test.err('F16 a NULL / non-object data is refused (alumni_invalid)', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', null, null)$$, '22023');
select v66_test.err('F17 ... an array', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '[1]'::jsonb, null)$$, '22023');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e662","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('F20 a project manager can neither read nor write the figures of a company', $$select public.get_company_figures('00000000-0000-4000-8000-00000000c661')$$, '42501');
select v66_test.err('F21 ... nor close a quarter', $$select public.close_alumni_quarter('2026-Q4', null)$$, '42501');
select v66_test.val('F22 ... and sees no snapshot / draft row', $q$select (select count(*) from public.company_snapshots)::text || '|' || (select count(*) from public.company_figures)::text$q$, '0|0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('F23 a manager cannot confirm on a founder\''s behalf', $$select public.confirm_company_figures('00000000-0000-4000-8000-00000000c661')$$, '42501');
select v66_test.err('F24 close / reopen / get with NULL arguments fail cleanly', $$select public.close_alumni_quarter(null, null)$$, '22023');
select v66_test.err('F25 ... reopen(null)', $$select public.reopen_alumni_quarter(null, null)$$, '22023');
select v66_test.err('F26 ... get_company_figures(null) by a manager', $$select public.get_company_figures(null)$$, '42501');
select v66_test.val('F27 the manager scheduler entry point works as "manual" and finds nothing to do in real time', $q$select public.freeze_due_quarters()->>'frozen'$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v66_test.val('F28 the service role can run freeze_due_quarters (auth.uid() is null, role claim service_role)', $q$select public.freeze_due_quarters()->>'frozen'$q$, '0');
reset role;
select v66_test.val('F29 anon can execute none of the figures RPCs (privilege, not a call)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('freeze_due_quarters', 'close_alumni_quarter', 'reopen_alumni_quarter', 'refreeze_alumni_quarter',
  'correct_alumni_snapshot', 'save_company_figures', 'confirm_company_figures', 'get_company_figures', 'get_alumni_portfolio') and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '0');

-- ================================================================= G. confirm: "Confirm my figures for this quarter" (company 2, before any close would have taken it; its 2026-Q4 snapshot already exists from D05, so the target is 2027-Q1)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e664","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.cp1', ((public.confirm_company_figures('00000000-0000-4000-8000-00000000c662')->>'period'))::text, false);
reset role;
select v66_test.val('G01 the founder confirms: the draft row is created, confirmed for the TARGET quarter, by him', $q$select concat_ws('|', current_setting('v66.cp1'), f.confirmed_period, (f.confirmed_by = '00000000-0000-4000-8000-00000000e664')::text, (f.confirmed_at >= f.updated_at)::text, app_private.alumni_figures_status(f.company_id, f.confirmed_period))
  from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c662'$q$, '2027-Q1|2027-Q1|true|true|confirmed');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e664","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.ok', (public.save_company_figures('00000000-0000-4000-8000-00000000c662', '{"employees_total":9}'::jsonb, null) is not null)::text, false);
reset role;
select v66_test.val('G02 an edit AFTER the confirmation makes it unconfirmed again (updated, not confirmed)', $q$select app_private.alumni_figures_status('00000000-0000-4000-8000-00000000c662', '2027-Q1')$q$, 'updated');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e664","role":"authenticated"}', true);
set local role authenticated;
select set_config('v66.ok', (public.confirm_company_figures('00000000-0000-4000-8000-00000000c662') is not null)::text, false);
reset role;
select v66_test.val('G03 confirmed again', $q$select app_private.alumni_figures_status('00000000-0000-4000-8000-00000000c662', '2027-Q1')$q$, 'confirmed');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e661","role":"authenticated"}', true);
set local role authenticated;
select v66_test.val('G04 the manager sees WHO confirmed and who last modified (names), the founder view of the same call has none', $q$select concat_ws('|', public.get_company_figures('00000000-0000-4000-8000-00000000c662')->'draft'->>'confirmed_by_name',
  public.get_company_figures('00000000-0000-4000-8000-00000000c662')->'draft'->>'updated_by_name', public.get_company_figures('00000000-0000-4000-8000-00000000c662')->>'target_period')$q$, 'V66 Founder Two|V66 Founder Two|2027-Q1');
reset role;
-- the draft is validated
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e663","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('G10 a negative number', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"revenue_total":-5}'::jsonb, null)$$, '22023');
select v66_test.err('G11 an amount above 10^12', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"revenue_total":"1000000000001"}'::jsonb, null)$$, '22023');
select v66_test.err('G12 female employees above the total', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"employees_total":3,"employees_female":4}'::jsonb, null)$$, '22023');
select v66_test.err('G13 an unknown key', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"profit":1}'::jsonb, null)$$, '22023');
select v66_test.err('G14 a derived key is NOT writable in a draft (team_size)', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"team_size":3}'::jsonb, null)$$, '22023');
select v66_test.err('G15 a stale form (an old updated_at) is refused with alumni_stale', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"employees_total":7}'::jsonb, '2020-01-01'::timestamptz)$$, 'alumni_stale');
select v66_test.err('G16 "I loaded no draft" (-infinity) while a draft exists is stale too', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"employees_total":7}'::jsonb, '-infinity'::timestamptz)$$, 'alumni_stale');
select set_config('v66.ok', (public.save_company_figures('00000000-0000-4000-8000-00000000c661', '{"traction":"our id 29901011234567 here"}'::jsonb, null) is not null)::text, false);
reset role;
select v66_test.val('G17 a national ID typed into a free text is removed before it is stored', $q$select f.traction from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c661'$q$, 'our id [ID removed] here');

-- ================================================================= H. lazy freeze, the settings switch, companies that did not exist yet, the first tracked quarter
select set_config('request.jwt.claims', '', true);      -- the owner (no JWT) from here on: the direct fixture inserts below are not API calls
insert into public.companies (id, name_en, created_by, is_alumni) values ('00000000-0000-4000-8000-00000000c664', 'V66 Late Co', null, true);
insert into public.company_figures (company_id, period_key, revenue_total, employees_total, updated_source) values ('00000000-0000-4000-8000-00000000c664', '2026-Q4', 5, 3, 'founder');
select set_config('v66.lazy_n', (app_private.alumni_freeze_company_due('00000000-0000-4000-8000-00000000c664', current_setting('v66.t_close')::timestamptz))::text, false);
select v66_test.val('H01 LAZY freeze: a company whose ended quarter was not frozen yet is frozen (from its draft) before anything else touches it', $q$select concat_ws('|', current_setting('v66.lazy_n'), s.revenue_total::text, s.reported::text, s.frozen_source, (select coalesce(f.revenue_total::text, 'NULL') from public.company_figures f where f.company_id = s.company_id))
  from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c664' and s.period_key = '2026-Q4'$q$, '1|5.00|true|auto|NULL');
insert into public.companies (id, name_en, created_by, is_alumni, created_at) values ('00000000-0000-4000-8000-00000000c665', 'V66 Future Co', null, true, '2027-02-01 00:00:00+00');
select v66_test.val('H02 a company created AFTER the quarter ended gets no snapshot for it (not_yet_existing)', $q$select app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c665', '2026-Q4', 'auto', null, now())$q$, 'not_yet_existing');
select v66_test.val('H03 a non-alumni company is never frozen', $q$select app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c663', '2026-Q4', 'auto', null, now())$q$, 'not_alumni');
select v66_test.val('H04 freeze_one on an existing snapshot says "exists" and changes nothing', $q$select app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c661', '2026-Q4', 'manual', null, now())$q$, 'exists');
select v66_test.val('H05 bad arguments are refused as invalid (NULL company, bad key, bad source)', $q$select concat_ws('|', app_private.alumni_freeze_one(null, '2026-Q4', 'auto', null, now()), app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c661', 'zz', 'auto', null, now()),
  app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c661', '2026-Q4', 'x', null, now()), app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c661', '2026-Q4', null, null, now()))$q$, 'invalid|invalid|invalid|invalid');
select v66_test.val('H06 the first tracked quarter: the scheduler never created 2026-Q3 snapshots (only the manual backfill of company 1 has one)', $q$select string_agg(s.company_id::text, ',') from public.company_snapshots s where s.period_key = '2026-Q3'$q$, '00000000-0000-4000-8000-00000000c661');
update app_private.alumni_quarter_settings set auto_freeze = false;
insert into public.companies (id, name_en, created_by, is_alumni) values ('00000000-0000-4000-8000-00000000c666', 'V66 Switch Co', null, true);
select v66_test.val('H07 auto_freeze OFF: the scheduler freezes nothing (it says why), the lazy freeze neither; a manual close still can', $q$select concat_ws('|', app_private.alumni_freeze_due(current_setting('v66.t_close')::timestamptz, 'auto', null)->>'skipped', app_private.alumni_freeze_company_due('00000000-0000-4000-8000-00000000c666', current_setting('v66.t_close')::timestamptz)::text,
  (app_private.alumni_freeze_due(current_setting('v66.t_close')::timestamptz, 'manual', null)->>'frozen'))$q$, 'auto_freeze_off|0|1');
update app_private.alumni_quarter_settings set auto_freeze = true;

-- ================================================================= I. the year roll-up (the compat layer of the readers): frozen + reported quarters only
select v66_test.val('I01 2026 for company 1 = the reported quarters Q3 (40000) + Q4 (100000): revenue is the SUM, employees the latest reported value', $q$select concat_ws('|', r.revenue_total::text, r.employees_total::text, r.funding_raised_total::text, r.quarters_reported::text)
  from app_private.alumni_year_rollup r where r.company_id = '00000000-0000-4000-8000-00000000c661' and r.period_year = 2026$q$, '140000.00|5|50000.00|2');
select v66_test.val('I02 the DRAFT never reaches the roll-up: company 1 draft revenue 777 is nowhere in it', $q$select count(*)::text from app_private.alumni_year_rollup r where r.company_id = '00000000-0000-4000-8000-00000000c661' and r.revenue_total = 777$q$, '0');
select v66_test.val('I03 a year without a reported quarter has no row (company 3, not reported: carried values are not data points)', $q$select count(*)::text from app_private.alumni_year_rollup r where r.company_id = '00000000-0000-4000-8000-00000000c662' and r.period_year = 2026
  and not exists (select 1 from public.company_snapshots s where s.company_id = r.company_id and s.reported)$q$, '0');

-- ================================================================= J. merge_companies carries the figures: the kept company''s frozen quarters win
insert into public.companies (id, name_en, created_by, is_alumni) values ('00000000-0000-4000-8000-00000000c667', 'V66 Keep', null, true), ('00000000-0000-4000-8000-00000000c668', 'V66 Drop', null, true);
insert into public.company_snapshots (company_id, snapshot_type, period_year, period_key, status, frozen_at, frozen_source, reported, revenue_total, operating_status) values
  ('00000000-0000-4000-8000-00000000c667', 'quarter', 2026, '2026-Q3', 'frozen', now(), 'manual', true, 111, 'open'),
  ('00000000-0000-4000-8000-00000000c668', 'quarter', 2026, '2026-Q3', 'frozen', now(), 'manual', true, 999, 'open'),
  ('00000000-0000-4000-8000-00000000c668', 'quarter', 2026, '2026-Q2', 'frozen', now(), 'manual', true, 222, 'open');
insert into public.company_figures (company_id, period_key, employees_total, updated_source) values ('00000000-0000-4000-8000-00000000c668', '2026-Q4', 8, 'manager');
insert into public.company_figures (company_id, period_key, revenue_total, updated_source) values ('00000000-0000-4000-8000-00000000c667', '2026-Q4', 50, 'manager');
select app_private.alumni_merge_company_data('00000000-0000-4000-8000-00000000c667', '00000000-0000-4000-8000-00000000c668');
select v66_test.val('J01 merge: the kept quarter stays (111), the other quarter moves (222), the drop has nothing left; the draft only fills what the kept one lacks', $q$select concat_ws('|',
  (select string_agg(s.period_key || '=' || s.revenue_total::text, ',' order by s.period_key) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c667'),
  (select count(*) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c668')::text,
  (select f.revenue_total::text || '/' || f.employees_total::text from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c667'),
  (select count(*) from public.company_figures f where f.company_id = '00000000-0000-4000-8000-00000000c668')::text)$q$, '2026-Q2=222.00,2026-Q3=111.00|0|50.00/8|0');

-- ================================================================= K. the founder cannot edit a snapshot through the table; the check constraints hold
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e663","role":"authenticated"}', true);
set local role authenticated;
select v66_test.err('K01 a direct UPDATE of a frozen snapshot by a founder is refused (no privilege)', $$update public.company_snapshots set revenue_total = 1 where company_id = '00000000-0000-4000-8000-00000000c661'$$, '42501');
select v66_test.err('K02 a direct INSERT into the draft table by a founder is refused', $$insert into public.company_figures (company_id, period_key) values ('00000000-0000-4000-8000-00000000c661', '2026-Q4')$$, '42501');
reset role;
select v66_test.err('K03 a snapshot cannot hold more female founders than founders / a bad status (check constraints)', $$insert into public.company_snapshots (company_id, snapshot_type, period_year, period_key, status, frozen_at, frozen_source, team_size, female_founders)
  values ('00000000-0000-4000-8000-00000000c666', 'quarter', 2030, '2030-Q1', 'frozen', now(), 'auto', 1, 2)$$, '23514');
select v66_test.err('K04 two snapshots for one company and quarter are impossible (unique)', $$insert into public.company_snapshots (company_id, snapshot_type, period_year, period_key, status, frozen_at, frozen_source)
  values ('00000000-0000-4000-8000-00000000c661', 'quarter', 2026, '2026-Q4', 'frozen', now(), 'auto')$$, '23505');

-- ================================================================= final state check
select current_setting('v66.res', true) as res, current_setting('v66.n_snap0') as n_snap0 \gset
rollback;

-- the fixture is gone and nothing of the real data moved
select count(*) as n_snap1 from public.company_snapshots \gset
select (:n_snap0 = :n_snap1) as snap_ok \gset

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or not (:'snap_ok')::boolean) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v66: quarterly figures tests FAILED'; end $$;
\endif
