-- v49_alumni_profile_model  (m49, design 09: the Alumni profile model driven by the owner's Excel columns; decision 19: the national ID)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
--
-- Fixture (ids ...00000000e49x / c49x / f49x):
--   ADM = super_admin, AM = alumni_manager, PM = project_manager, F1 / F2 = founders (accounts + founders rows), F3 = founder with NO founders row, NR = no role
--   CO1 (F1 is its primary founder), CO2 (F2), CO3 (a "legacy-like" company: typed industry / governorate text, no keys)
--   one program with two projects: CO1 and CO3 are items of the company list of J1, CO2 is an item of J1 AND a WITHDRAWN participant, CO1 is also in J2 (a booking project)
-- NEVER call an app_private helper while the session role is anon / authenticated: a role-switched call of a function the role may not execute
-- crashes this local Postgres image (known gotcha, m42 / m43). Helpers are called as the owner; denials are asserted with has_function_privilege.
-- Synthetic national IDs (digit 1 = century, 2-7 = YYMMDD, 8-9 = governorate, 10-13 = serial, 14 = check digit that is NOT validated):
--   IDA 29501010101234 = 1995-01-01, Cairo (01), male (13th digit 3)         IDB 30303152804527 = 2003-03-15, Aswan (28), female (13th digit 2)
--   IDC 28802298811171 = 1988-02-29 (leap), born abroad (88), male           IDD 30002292999980 = 2000-02-29 (leap, century year), Luxor (29), female
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v49.res', '', false) \gset

begin;
create schema v49_test;
grant usage on schema v49_test to public;
create or replace function v49_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v49.res', current_setting('v49.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v49_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v49_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v49_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v49_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v49_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v49_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
-- m65 / m66 (owner decision 21) replaced the YEARLY snapshot rows (upsert / delete / review RPCs, annual rows, the year roll-ups the analytics and the export read) by the quarterly figures:
-- every check that encoded them is recorded as 'superseded' (it is not run); the behaviour is covered by v66 (draft, freeze, reopen, correct, confirm) and v67 (graphs, analytics, export).
create or replace function v49_test.superseded(p_key text, variadic p_rest text[] default '{}') returns void language plpgsql as $$
begin
  perform v49_test.t(p_key, true, 'superseded by m66 (owner decision 21): see v66 / v67');
end $$;
create or replace function v49_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v49_test.t(p_key, true, 'ok');
  exception when others then
    perform v49_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v49_test from public;
grant execute on all functions in schema v49_test to anon, authenticated, service_role;

-- ================================================================= C. catalog (as postgres)
select v49_test.val('C01 every alumni RPC exists (23: the yearly upsert / delete RPCs were replaced by m66)', $q$select count(*)::text from unnest(array[
  'public.list_alumni_lookups()', 'public.save_alumni_lookup(text,text,jsonb)', 'public.delete_alumni_lookup(text,text)', 'public.preview_national_id(text)',
  'public.get_my_alumni_profile()', 'public.save_my_founder_profile(jsonb)', 'public.get_my_company_profile(uuid)', 'public.save_my_company_profile(uuid,jsonb,timestamptz)',
  'public.save_company_team_member(uuid,uuid,jsonb)', 'public.remove_company_team_member(uuid,uuid)', 'public.set_company_ceo(uuid,uuid)',
  'public.list_alumni_directory(jsonb,integer,integer,text)',
  'public.get_alumni_company(uuid)', 'public.get_alumni_founder(uuid,boolean)', 'public.save_alumni_company(uuid,jsonb,timestamptz)', 'public.save_alumni_founder(uuid,jsonb)',
  'public.set_companies_alumni(uuid[],boolean)', 'public.export_alumni_rows(jsonb,integer,text,date)', 'public.get_alumni_analytics(jsonb,integer)',
  'public.list_public_alumni_directory(jsonb,integer,integer)', 'public.create_alumni_invitation(uuid,text,text,text)', 'public.revoke_alumni_invitation(uuid)',
  'public.list_alumni_invitations(text,integer,integer)'] ) f
  -- m60 replaced four signatures (concurrency token / reason): either generation counts
  where to_regprocedure(f) is not null or to_regprocedure(case f when 'public.save_my_founder_profile(jsonb)' then 'public.save_my_founder_profile(jsonb,timestamptz)'
    when 'public.save_alumni_founder(uuid,jsonb)' then 'public.save_alumni_founder(uuid,jsonb,timestamptz)' end) is not null$q$, '23');
select v49_test.val('C02 anon executes ONLY the vocabulary and the public directory', $q$select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and has_function_privilege('anon', p.oid, 'EXECUTE') and (p.proname in ('list_alumni_lookups', 'list_public_alumni_directory', 'preview_national_id', 'get_my_alumni_profile', 'save_my_founder_profile', 'export_alumni_rows',
  'get_alumni_analytics', 'list_alumni_directory', 'get_alumni_company', 'get_alumni_founder', 'save_alumni_company', 'save_alumni_founder', 'upsert_company_snapshot', 'create_alumni_invitation'))$q$, 'list_alumni_lookups,list_public_alumni_directory');
select v49_test.val('C03 NO API role executes any alumni_* / id_* / eg_* helper (the identity logic is reachable only through the RPCs)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^(alumni_|id_|eg_)'
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v49_test.val('C04 the identity / internal-notes / lookup tables carry NO privilege for anon, authenticated or PUBLIC (RPC only)', $q$select count(*)::text from information_schema.role_table_grants g where g.table_schema = 'public'
  and g.table_name in ('founder_identities', 'company_internal', 'alumni_lookups') and g.grantee in ('anon', 'authenticated', 'PUBLIC')$q$, '0');
select v49_test.val('C05 the audit and the probe limiter live in app_private with no API privilege', $q$select count(*)::text from information_schema.role_table_grants g where g.table_schema = 'app_private'
  and g.table_name in ('founder_identity_access_log', 'alumni_probe_limits') and g.grantee in ('anon', 'authenticated', 'PUBLIC')$q$, '0');
select v49_test.val('C06 RLS is enabled AND forced on the three new public tables and the two app_private tables', $q$select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where ((n.nspname = 'public' and c.relname in ('founder_identities', 'company_internal', 'alumni_lookups')) or (n.nspname = 'app_private' and c.relname in ('founder_identity_access_log', 'alumni_probe_limits')))
  and c.relrowsecurity and c.relforcerowsecurity$q$, '5');
select v49_test.val('C07 every public RPC (23) is SECURITY DEFINER with an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_alumni_lookups', 'save_alumni_lookup',
  'delete_alumni_lookup', 'preview_national_id', 'get_my_alumni_profile', 'save_my_founder_profile', 'get_my_company_profile', 'save_my_company_profile', 'save_company_team_member', 'remove_company_team_member',
  'set_company_ceo', 'list_alumni_directory', 'get_alumni_company', 'get_alumni_founder', 'save_alumni_company', 'save_alumni_founder', 'set_companies_alumni',
  'export_alumni_rows', 'get_alumni_analytics', 'list_public_alumni_directory', 'create_alumni_invitation', 'revoke_alumni_invitation', 'list_alumni_invitations')
  and p.prosecdef and p.proconfig @> array['search_path=""']$q$, '23');
select v49_test.val('C08 company_snapshots: authenticated can only READ, anon nothing (m69: column-level read, no actor columns)', $q$select (has_any_column_privilege('authenticated', 'public.company_snapshots', 'SELECT') and not has_table_privilege('authenticated', 'public.company_snapshots', 'INSERT')
  and not has_table_privilege('authenticated', 'public.company_snapshots', 'UPDATE') and not has_table_privilege('authenticated', 'public.company_snapshots', 'DELETE') and not has_table_privilege('anon', 'public.company_snapshots', 'SELECT'))::text$q$, 'true');
select v49_test.val('C09 the seeds: 18 sectors, 55 sub sectors (each under a sector), 11 stages, every stage already stored in companies.stage is in the lookup', $q$select (select count(*) from public.alumni_lookups where kind = 'sector')::text || '/' ||
  (select count(*) from public.alumni_lookups where kind = 'subsector')::text || '/' || (select count(*) from public.alumni_lookups where kind = 'stage')::text || '/' ||
  (select count(*) from public.companies c where c.stage is not null and not exists (select 1 from public.alumni_lookups l where l.kind = 'stage' and l.key = c.stage))::text$q$, '18/55/11/0');
select v49_test.val('C10 the guard trigger exists on companies and merge_companies calls the merge helper', $q$select (exists (select 1 from pg_trigger t where t.tgrelid = 'public.companies'::regclass and t.tgname = 'companies_bu_alumni_guard' and not t.tgisinternal)
  and pg_get_functiondef('public.merge_companies(uuid,uuid)'::regprocedure) like '%alumni_merge_company_data%')::text$q$, 'true');
select v49_test.val('C11 every id_* function is IMMUTABLE (a pure function of its arguments): the ten of the ID rules', $q$select (count(*) filter (where p.provolatile = 'i') || '/' || count(*))::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^id_'$q$, '10/10');
select v49_test.val('C12 no migrated company was lost or nameless (HERMETIC since m52: alumni flags, snapshots, identities and notes entered later by real users are legitimate; the totals below run on a sandbox)', $q$select
  (select (count(*) >= 141)::text from public.companies c where c.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')) || '/' ||
  (select count(*) from public.companies c where c.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a') and c.name_en is null and c.name_ar is null)::text$q$, 'true/0');
select v49_test.val('C13 every function that takes or returns a national ID is VOLATILE (necessary, NOT sufficient: PostgREST 14.7 still serves a GET on a volatile function that writes nothing; the explicit refusal of GET / HEAD is m52, checked in v52)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('preview_national_id', 'save_my_founder_profile', 'save_company_team_member', 'save_alumni_founder', 'get_alumni_founder', 'export_alumni_rows', 'get_my_alumni_profile') and p.provolatile = 'v'$q$, '7');

-- ================================================================= U. national-ID unit tests (as postgres; pure functions)
select v49_test.val('U01 normalisation: Arabic-Indic digits, spaces, dashes, dots', $q$select app_private.id_normalize('٢٩٥٠١٠١٠١٠١٢٣٤') || '/' || app_private.id_normalize(' 2 9501-01.01 0123 4 ')$q$, '29501010101234/29501010101234');
select v49_test.val('U02 empty / blank normalises to NULL', $q$select coalesce(app_private.id_normalize('  '), 'NULL') || '/' || coalesce(app_private.id_normalize(null), 'NULL')$q$, 'NULL/NULL');
select v49_test.val('U03 IDA is valid and derives 1995-01-01 / male / Cairo', $q$select coalesce(app_private.id_invalid_reason('29501010101234', (now() at time zone 'Africa/Cairo')::date), 'valid') || '|' || app_private.id_birth_date('29501010101234') || '|' || app_private.id_gender('29501010101234') || '|' ||
  app_private.id_governorate_code('29501010101234') || '|' || app_private.id_governorate_name('29501010101234', 'en') || '|' || app_private.id_governorate_name('29501010101234', 'ar')$q$, 'valid|1995-01-01|male|1|Cairo|القاهرة');
select v49_test.val('U04 IDB (century 3) derives 2003-03-15 / female / Aswan', $q$select coalesce(app_private.id_invalid_reason('30303152804527', (now() at time zone 'Africa/Cairo')::date), 'valid') || '|' || app_private.id_birth_date('30303152804527') || '|' || app_private.id_gender('30303152804527') || '|' ||
  app_private.id_governorate_name('30303152804527', 'en')$q$, 'valid|2003-03-15|female|Aswan');
select v49_test.val('U05 IDC: 29 Feb 1988 (leap) + code 88 = born abroad, male', $q$select coalesce(app_private.id_invalid_reason('28802298811171', (now() at time zone 'Africa/Cairo')::date), 'valid') || '|' || app_private.id_birth_date('28802298811171') || '|' || app_private.id_gender('28802298811171') || '|' ||
  app_private.id_governorate_code('28802298811171') || '|' || app_private.id_governorate_name('28802298811171', 'ar')$q$, 'valid|1988-02-29|male|88|مولود بالخارج');
select v49_test.val('U06 IDD: 29 Feb 2000 (a century year divisible by 400 IS leap), Luxor, female', $q$select coalesce(app_private.id_invalid_reason('30002292999980', (now() at time zone 'Africa/Cairo')::date), 'valid') || '|' || app_private.id_birth_date('30002292999980') || '|' || app_private.id_gender('30002292999980') || '|' ||
  app_private.id_governorate_name('30002292999980', 'en')$q$, 'valid|2000-02-29|female|Luxor');
select v49_test.val('U07 29 Feb 1900 is NOT a real date (1900 is not leap)', $q$select app_private.id_invalid_reason('20002290101230')$q$, 'date');
select v49_test.val('U08 month 13 / day 31 of April / day 00 / month 00 are not real dates', $q$select app_private.id_invalid_reason('29513010101234') || '/' || app_private.id_invalid_reason('29504310101234') || '/' || app_private.id_invalid_reason('29501000101234') || '/' || app_private.id_invalid_reason('29500010101234')$q$, 'date/date/date/date');
select v49_test.val('U09 century digit must be 2 or 3 (1 and 4+ refused)', $q$select app_private.id_invalid_reason('19501010101234') || '/' || app_private.id_invalid_reason('49501010101234') || '/' || app_private.id_invalid_reason('09501010101234')$q$, 'century/century/century');
select v49_test.val('U10 length and characters: 13 / 15 digits = length; a letter = digits; blank = empty', $q$select app_private.id_invalid_reason('2950101010123') || '/' || app_private.id_invalid_reason('295010101012345') || '/' || app_private.id_invalid_reason('2950101010123A') || '/' || app_private.id_invalid_reason('') || '/' || app_private.id_invalid_reason(null)$q$, 'length/length/digits/empty/empty');
select v49_test.val('U11 governorate codes: 05 / 20 / 30 / 36 / 87 / 99 are unknown, 88 is valid', $q$select string_agg(coalesce(app_private.id_invalid_reason('2950101' || c || '01234', (now() at time zone 'Africa/Cairo')::date), 'valid'), ',' order by o) from unnest(array['05', '20', '30', '36', '87', '99', '88']) with ordinality t(c, o)$q$,
  'governorate,governorate,governorate,governorate,governorate,governorate,valid');
select v49_test.val('U12 every listed code (01-04, 11-19, 21-29, 31-35, 88) is accepted', $q$select count(*)::text from app_private.eg_governorates() g where app_private.id_invalid_reason('2950101' || lpad(g.code::text, 2, '0') || '01234', (now() at time zone 'Africa/Cairo')::date) is null$q$, '28');
select v49_test.val('U13 a birth date in the FUTURE is refused with a date, but only when "today" is given (the CHECK constraint is structural)', $q$select app_private.id_invalid_reason('39912310101234', (now() at time zone 'Africa/Cairo')::date) || '/' || coalesce(app_private.id_invalid_reason('39912310101234'), 'structure ok')$q$, 'future/structure ok');
select v49_test.val('U14 age boundary: on the birthday = the new age; the day before = the previous age; before birth = NULL', $q$select app_private.id_age('30010142801230', date '2026-10-14') || '/' || app_private.id_age('30010152801230', date '2026-10-14') || '/' ||
  app_private.id_age('30010152801230', date '2026-10-15') || '/' || coalesce(app_private.id_age('30010152801230', date '2000-10-14')::text, 'NULL')$q$, '26/25/26/NULL');
select v49_test.val('U15 age of a 29 Feb birth on 28 Feb / 1 Mar of a non-leap year', $q$select app_private.id_age('30002292999980', date '2025-02-28') || '/' || app_private.id_age('30002292999980', date '2025-03-01')$q$, '24/25');
select v49_test.val('U16 age categories: 17 under_18, 18 / 24 -> 18-24, 25 / 34 -> 25-34, 35 / 44 -> 35-44, 45 -> 45+, NULL -> NULL', $q$select concat_ws(',', app_private.id_age_category(17), app_private.id_age_category(18), app_private.id_age_category(24),
  app_private.id_age_category(25), app_private.id_age_category(34), app_private.id_age_category(35), app_private.id_age_category(44), app_private.id_age_category(45), coalesce(app_private.id_age_category(null), 'NULL'))$q$,
  'under_18,age_18_24,age_18_24,age_25_34,age_25_34,age_35_44,age_35_44,age_45_plus,NULL');
select v49_test.val('U17 gender: the 13th digit (odd male / even female) on 10 serials', $q$select string_agg(app_private.id_gender('295010101' || lpad(s::text, 4, '0') || '4') , ',' order by s) from generate_series(1, 6) s$q$, 'male,female,male,female,male,female');
select v49_test.val('U18 an invalid ID derives NOTHING (no birth date / age / gender / governorate / name)', $q$select concat_ws('|', coalesce(app_private.id_birth_date('12345')::text, 'N'), coalesce(app_private.id_age('12345', (now() at time zone 'Africa/Cairo')::date)::text, 'N'), coalesce(app_private.id_gender('12345'), 'N'),
  coalesce(app_private.id_governorate_code('12345')::text, 'N'), coalesce(app_private.id_governorate_name('12345', 'en'), 'N'))$q$, 'N|N|N|N|N');
select v49_test.val('U19 the mask keeps ten asterisks and the last four digits only', $q$select app_private.id_mask('29501010101234') || '/' || coalesce(app_private.id_mask(null), 'NULL')$q$, '**********1234/NULL');
select v49_test.val('U20 a governorate typed in free text resolves to the code (Arabic / English / alias / prefixed / with country)', $q$select concat_ws(',', app_private.eg_governorate_from_text('أسيوط'), app_private.eg_governorate_from_text('Cairo'), app_private.eg_governorate_from_text('Alex'),
  app_private.eg_governorate_from_text('محافظة سوهاج'), app_private.eg_governorate_from_text('Assiut, Egypt'), app_private.eg_governorate_from_text('القاهره'), app_private.eg_governorate_from_text('الاسكندرية'),
  coalesce(app_private.eg_governorate_from_text('nowhere')::text, 'NULL'), coalesce(app_private.eg_governorate_from_text('Born abroad')::text, 'NULL'), app_private.eg_governorate_from_text('Born abroad', true))$q$, '25,1,2,26,25,1,2,NULL,NULL,88');
select v49_test.val('U21 a legacy industry text resolves to its PRIMARY sector (first listed)', $q$select concat_ws(',', app_private.alumni_sector_from_text('التكنولوجيا، الخدمات'), app_private.alumni_sector_from_text('Technology, Manufacturing'),
  app_private.alumni_sector_from_text('Food & Beverage'), app_private.alumni_sector_from_text('الخدمات اللوجستية / النقل'), app_private.alumni_sector_from_text('Creative Industries'), coalesce(app_private.alumni_sector_from_text('xyz'), 'NULL'))$q$,
  'technology,technology,food_beverage,logistics,creative,NULL');
select v49_test.val('U22 the structural CHECK of founder_identities refuses a bad ID, a future-free structure passes (as postgres)', $q$select (select count(*) from (values ('12345'), ('29513010101234'), ('2950101010123A')) v(x) where app_private.id_invalid_reason(x) is not null)::text$q$, '3');

-- ================================================================= hermetic base (m52)
-- Real alumni data (companies marked alumni, yearly figures, identities, notes) may exist by now; every exact total below is about the FIXTURE only. All of this is rolled back
-- with the rest of the transaction (nothing outside it is touched).
delete from public.company_snapshots;
delete from public.company_internal;
delete from public.founder_identities;
delete from public.company_founders;
update public.companies set is_alumni = false where is_alumni;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e490','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-adm@example.invalid','{"provisioned":true}','{"full_name":"V49 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e491','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-am@example.invalid','{"provisioned":true}','{"full_name":"V49 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e492','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-pm@example.invalid','{"provisioned":true}','{"full_name":"V49 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e493','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-f1@example.invalid','{"provisioned":true}','{"full_name":"profile one"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e494','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-f2@example.invalid','{"provisioned":true}','{"full_name":"profile two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e495','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-f3@example.invalid','{"provisioned":true}','{"full_name":"Third Founder"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e496','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v49-nr@example.invalid','{"provisioned":true}','{"full_name":"V49 No Role"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e490','super_admin'), ('00000000-0000-4000-8000-00000000e491','alumni_manager'), ('00000000-0000-4000-8000-00000000e492','project_manager'),
  ('00000000-0000-4000-8000-00000000e493','founder'), ('00000000-0000-4000-8000-00000000e494','founder'), ('00000000-0000-4000-8000-00000000e495','founder');
insert into public.companies (id, name_en, name_ar, created_by) values
  ('00000000-0000-4000-8000-00000000c491', 'V49 Nile Labs', 'مختبرات النيل V49', '00000000-0000-4000-8000-00000000e493'),
  ('00000000-0000-4000-8000-00000000c492', 'V49 Second Co', null, '00000000-0000-4000-8000-00000000e494');
insert into public.companies (id, name_en, name_ar, industry_en, governorate_en, location_en, website_url, links) values
  ('00000000-0000-4000-8000-00000000c493', 'V49 Legacy Co', null, 'Technology, Manufacturing', 'Alex', 'Alex', 'https://leg.example.com',
   '[{"url":"https://facebook.com/leg","type":"facebook","label":"Facebook"},{"url":"https://leg.example.com","type":"globe","label":"Website"},{"url":"https://linkedin.com/company/leg","type":"linkedin","label":"LinkedIn"},{"url":"https://drive.example.com/deck","type":"globe","label":"Pitch Deck"}]');
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f491', 'Sara Ali', 'سارة علي', 'zz-v49-f1@example.invalid', '00000000-0000-4000-8000-00000000e493'),
  ('00000000-0000-4000-8000-00000000f492', 'Omar Zaki', 'عمر زكي', 'zz-v49-f2@example.invalid', '00000000-0000-4000-8000-00000000e494');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c491', '00000000-0000-4000-8000-00000000f491', true),
  ('00000000-0000-4000-8000-00000000c492', '00000000-0000-4000-8000-00000000f492', true);

-- a program with two projects: J1 (list + agenda: training), J2 (booking + distribution: mentoring)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e490","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V49 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V49 Project One', null, 'Africa/Cairo')).id as j1 \gset
select (public.create_project(:'prog', 'V49 Project Two', null, 'Africa/Cairo')).id as j2 \gset
select (public.add_node(:'j1', 'list', '{"en":"V49 Companies","ar":"الشركات"}', 0, 0, '{"subkind":"company"}')).id as lc1 \gset
select (public.add_node(:'j1', 'agenda', '{"en":"V49 Agenda"}', 0, 100, '{}')).id as ag \gset
select (public.add_node(:'j2', 'list', '{"en":"V49 Companies 2","ar":"الشركات"}', 0, 0, '{"subkind":"company"}')).id as lc2 \gset
select (public.add_node(:'j2', 'booking', '{"en":"V49 Booking"}', 0, 100, '{}')).id as bk \gset
select (public.add_node(:'j2', 'distribution', '{"en":"V49 Distribution"}', 0, 200, '{}')).id as ds \gset
reset role;
insert into public.program_members (program_id, user_id) values (:'prog', '00000000-0000-4000-8000-00000000e492') on conflict do nothing;
insert into public.list_items (project_id, list_node_id, source_kind, company_id) values
  (:'j1', :'lc1', 'company', '00000000-0000-4000-8000-00000000c491'), (:'j1', :'lc1', 'company', '00000000-0000-4000-8000-00000000c492'), (:'j1', :'lc1', 'company', '00000000-0000-4000-8000-00000000c493'),
  (:'j2', :'lc2', 'company', '00000000-0000-4000-8000-00000000c491');
insert into public.participants (project_id, company_id, source, status) values (:'j1', '00000000-0000-4000-8000-00000000c492', 'manual', 'withdrawn');
select format($q$select count(*)::text from app_private.alumni_participations() where project_id in ('%s', '%s')$q$, :'j1', :'j2') as part_sql \gset
select v49_test.val('D01 participations are DERIVED: CO1 (J1 + J2) and CO3 (J1) count, the WITHDRAWN CO2 does not (3 company-project pairs)', :'part_sql', '3');

-- ================================================================= L. lookups
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v49_test.val('L01 anon reads the vocabulary: 28 governorates, 18 sectors, the 55 sub sectors nested', $q$select (jsonb_array_length(public.list_alumni_lookups()->'governorates'))::text || '/' || jsonb_array_length(public.list_alumni_lookups()->'sectors')::text || '/' ||
  (select sum(jsonb_array_length(s->'subsectors')) from jsonb_array_elements(public.list_alumni_lookups()->'sectors') s)::text$q$, '28/18/55');
select v49_test.val('L02 the vocabulary has no personal data and is bilingual (every sector has both labels)', $q$select (select count(*) from jsonb_array_elements(public.list_alumni_lookups()->'sectors') s where s->>'label_en' is null or s->>'label_ar' is null)::text$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('L03 a founder cannot create / edit a lookup value', $q$select public.save_alumni_lookup('stage', 'zzz', '{"label_en":"Z","label_ar":"ز"}')$q$, '42501');
select v49_test.fails('L04 a founder cannot delete a lookup value', $q$select public.delete_alumni_lookup('stage', 'mvp')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('L05 a manager adds a stage (key + both labels)', $q$select (public.save_alumni_lookup('stage', 'pre_seed', '{"label_en":"Pre-seed","label_ar":"ما قبل التمويل الأولي","sort_order":55}'))->>'key'$q$, 'pre_seed');
select v49_test.val('L06 ... and it is in the vocabulary, sorted', $q$select (select string_agg(s->>'key', ',' order by ord) from jsonb_array_elements(public.list_alumni_lookups()->'stages') with ordinality t(s, ord) where s->>'key' in ('mvp', 'pre_seed', 'early_traction'))$q$, 'mvp,pre_seed,early_traction');
select v49_test.fails('L07 a closed vocabulary (gender) takes no new key', $q$select public.save_alumni_lookup('gender', 'other', '{"label_en":"X","label_ar":"س"}')$q$, '22023', 'alumni_invalid', 'key:closed_vocabulary');
select v49_test.fails('L08 a system value cannot be deactivated', $q$select public.save_alumni_lookup('gender', 'male', '{"is_active":false}')$q$, '22023', 'alumni_invalid', 'is_active:system_value');
select v49_test.val('L09 ... but its label can be edited', $q$select (public.save_alumni_lookup('gender', 'male', '{"label_ar":"ذكر "}'))->>'label_ar'$q$, 'ذكر');
select v49_test.fails('L10 a sub sector needs an existing sector as parent', $q$select public.save_alumni_lookup('subsector', 'zzz_sub', '{"label_en":"Z","label_ar":"ز","parent_key":"nope"}')$q$, '22023', 'alumni_invalid', 'parent_key:unknown');
select v49_test.val('L11 a sub sector is added under a sector', $q$select (public.save_alumni_lookup('subsector', 'zzz_sub', '{"label_en":"Z sub","label_ar":"فرعي","parent_key":"technology"}'))->>'parent_key'$q$, 'technology');
select v49_test.fails('L12 a bad key / unknown field / bad kind is refused', $q$select public.save_alumni_lookup('stage', 'Bad Key', '{"label_en":"Z","label_ar":"ز"}')$q$, '22023', 'alumni_invalid', 'key:bad_value');
select v49_test.fails('L13 unknown patch field', $q$select public.save_alumni_lookup('stage', 'pre_seed', '{"colour":"red"}')$q$, '22023', 'alumni_invalid', 'colour:unknown_key');
select v49_test.okrun('L14 an UNUSED value can be deleted', $q$select public.delete_alumni_lookup('subsector', 'zzz_sub')$q$);
select v49_test.fails('L15 a value used by a company cannot be deleted (alumni_in_use)', $q$select public.delete_alumni_lookup('stage', 'mvp')$q$, '23503', 'alumni_in_use');
select v49_test.fails('L16 a sector with sub sectors cannot be deleted', $q$select public.delete_alumni_lookup('sector', 'technology')$q$, '23503', 'alumni_in_use');
select v49_test.fails('L17 a system value cannot be deleted', $q$select public.delete_alumni_lookup('age_category', 'under_18')$q$, '22023', 'alumni_invalid', 'key:system_value');
reset role;

-- ================================================================= F. the founder profile and the national ID
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('F01 preview: a valid ID shows its derived values with the SAME functions', $q$select (p->>'valid') || '|' || (p->>'birth_date') || '|' || (p->>'gender') || '|' || (p->'governorate'->>'name_en') || '|' || (p->'governorate'->>'is_abroad')
  from (select public.preview_national_id('٢٩٥٠١٠١٠١٠١٢٣٤') p) x$q$, 'true|1995-01-01|male|Cairo|false');
select v49_test.val('F02 preview: an invalid ID answers the reason and derives nothing', $q$select (p->>'valid') || '|' || (p->>'reason') || '|' || (p ? 'birth_date')::text from (select public.preview_national_id('2950101') p) x$q$, 'false|length|false');
select v49_test.val('F03 get_my_alumni_profile: the signed-in founder block + his ONE company', $q$select jsonb_array_length(p->'companies')::text || '|' || ((p->'founder'->>'id')::uuid = '00000000-0000-4000-8000-00000000f491')::text
  from (select public.get_my_alumni_profile() p) x$q$, '1|true');
select v49_test.val('F04 no ID and no typed value yet: source is NULL and the completeness names the missing parts', $q$select coalesce(p->'founder'->'identity'->>'source', 'NULL') || '|' || (p->'founder'->'completeness'->>'percent') || '|' || (p->'founder'->'completeness'->'missing')::text
  from (select public.get_my_alumni_profile() p) x$q$, 'NULL|25|["phone", "identity", "education_status"]');
select v49_test.val('F05 save: phone is normalised to E.164, education status stored', $q$select (r->'founder'->>'phone') || '|' || (r->'founder'->>'education_status') from (select public.save_my_founder_profile('{"phone":"010 1234 5678","education_status":"graduate"}') r) x$q$, '+201012345678|graduate');
select v49_test.val('F06 self-declared fallback (no ID yet): birth date + gender are used and FLAGGED "self"', $q$select (r->'founder'->'identity'->>'source') || '|' || (r->'founder'->'identity'->'derived'->>'birth_date') || '|' || (r->'founder'->'identity'->'derived'->>'gender') || '|' ||
  coalesce(r->'founder'->'identity'->'derived'->>'governorate', 'NULL') from (select public.save_my_founder_profile('{"self_birth_date":"1990-05-05","self_gender":"female"}') r) x$q$, 'self|1990-05-05|female|NULL');
select v49_test.val('F07 the typed values give an age and a category computed at read time (never stored)', $q$select (p->'founder'->'identity'->'derived'->>'age') || '|' || (p->'founder'->'identity'->'derived'->>'age_category') from (select public.get_my_alumni_profile() p) x$q$,
  extract(year from age((now() at time zone 'Africa/Cairo')::date, date '1990-05-05'))::text || '|age_35_44');
select v49_test.val('F08 entering the ID: THE ID WINS - birth date / gender / governorate come from it and the typed ones are reported as replaced', $q$select (r->'founder'->'identity'->>'source') || '|' ||
  (r->'founder'->'identity'->'derived'->>'birth_date') || '|' || (r->'founder'->'identity'->'derived'->>'gender') || '|' || (r->'founder'->'identity'->'derived'->>'governorate') || '|' ||
  (select string_agg(e->>'field' || ':' || (e->>'typed') || '->' || (e->>'from_id'), ',' order by e->>'field') from jsonb_array_elements(r->'replaced') e)
  from (select public.save_my_founder_profile('{"national_id":"٢٩٥٠١٠١٠١٠١٢٣٤"}') r) x$q$, 'id|1995-01-01|male|1|birth_date:1990-05-05->1995-01-01,gender:female->male');
reset role;
select v49_test.val('F09 NO second copy: with an ID the self-declared columns are NULL (the typed values were dropped)', $q$select (national_id is not null)::text || '|' || (self_birth_date is null)::text || '|' || (self_gender is null)::text from public.founder_identities where founder_id = (select id from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e493')$q$, 'true|true|true');
select v49_test.val('F10 the stored ID is the normalised 14 ASCII digits', $q$select national_id from public.founder_identities where founder_id = (select id from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e493')$q$, '29501010101234');
select v49_test.fails('F11 a CHECK stops a typed value next to an ID even for the owner of the table (id wins)', $q$update public.founder_identities set self_gender = 'male' where national_id = '29501010101234'$q$, '23514');
select v49_test.fails('F12 a CHECK refuses a structurally invalid ID written directly', $q$update public.founder_identities set national_id = '29513010101234' where national_id = '29501010101234'$q$, '23514');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('F13 typing a birth date while an ID exists is refused (id_wins)', $q$select public.save_my_founder_profile('{"self_birth_date":"1999-09-09"}')$q$, '22023', 'alumni_invalid', 'self_birth_date:id_wins');
select v49_test.fails('F14 an invalid ID: length', $q$select public.save_my_founder_profile('{"national_id":"2950101"}')$q$, '22023', 'national_id_invalid', 'national_id:length');
select v49_test.fails('F15 an invalid ID: century 4', $q$select public.save_my_founder_profile('{"national_id":"49501010101234"}')$q$, '22023', 'national_id_invalid', 'national_id:century');
select v49_test.fails('F16 an invalid ID: impossible date', $q$select public.save_my_founder_profile('{"national_id":"29513010101234"}')$q$, '22023', 'national_id_invalid', 'national_id:date');
select v49_test.fails('F17 an invalid ID: a birth date in the future', $q$select public.save_my_founder_profile('{"national_id":"39912310101234"}')$q$, '22023', 'national_id_invalid', 'national_id:future');
select v49_test.fails('F18 an invalid ID: unknown governorate code', $q$select public.save_my_founder_profile('{"national_id":"29501010501234"}')$q$, '22023', 'national_id_invalid', 'national_id:governorate');
select v49_test.fails('F19 an invalid ID: letters', $q$select public.save_my_founder_profile('{"national_id":"2950101010123A"}')$q$, '22023', 'national_id_invalid', 'national_id:digits');
select v49_test.fails('F20 unknown / forbidden fields are refused: e-mail is a manager field, the auth link is not a field at all', $q$select public.save_my_founder_profile('{"email":"x@y.zz"}')$q$, '22023', 'alumni_invalid', 'email:manager_only');
select v49_test.fails('F21 a bad phone', $q$select public.save_my_founder_profile('{"phone":"12"}')$q$, '22023', 'alumni_invalid', 'phone:bad_value');
select v49_test.fails('F22 a bad education status', $q$select public.save_my_founder_profile('{"education_status":"professor"}')$q$, '22023', 'alumni_invalid', 'education_status:bad_value');
select v49_test.fails('F23 a bad self-declared date (future)', $q$select public.save_my_founder_profile('{"self_birth_date":"2999-01-01"}')$q$, '22023', 'alumni_invalid', 'self_birth_date:bad_date');
select v49_test.fails('F24 a name cannot be erased (name_ar is required)', $q$select public.save_my_founder_profile('{"name_en":null,"name_ar":null}')$q$, '22023', 'alumni_invalid', 'name:required');
select v49_test.val('F25 clearing the ID falls back to "no source" (the typed values were dropped when the ID came)', $q$select coalesce(r->'founder'->'identity'->>'source', 'NULL') || '|' || (r->'founder'->'identity'->>'has_national_id') from (select public.save_my_founder_profile('{"national_id":null}') r) x$q$, 'NULL|false');
select v49_test.val('F26 re-entering the ID restores the derived values; the same ID by the SAME founder is not a conflict', $q$select (r->>'saved') || '|' || (r->'founder'->'identity'->'derived'->>'gender') from (select public.save_my_founder_profile('{"national_id":"29501010101234"}') r) x$q$, 'true|male');
reset role;

-- ================================================================= P. privacy of the ID: nobody else reads or probes it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('P01 another founder gets a SOFT failure on a taken ID (no detail on who owns it)', $q$select (r->>'saved') || '|' || (r->>'error') || '|' || (r ? 'founder')::text from (select public.save_my_founder_profile('{"national_id":"29501010101234"}') r) x$q$, 'false|national_id_conflict|false');
select v49_test.val('P02 ... and his own profile is unchanged by the failed attempt', $q$select coalesce(p->'founder'->'identity'->>'source', 'NULL') from (select public.get_my_alumni_profile() p) x$q$, 'NULL');
select public.save_my_founder_profile('{"national_id":"29501010101234"}');
select public.save_my_founder_profile('{"national_id":"29501010101234"}');
select public.save_my_founder_profile('{"national_id":"29501010101234"}');
select public.save_my_founder_profile('{"national_id":"29501010101234"}');
select v49_test.fails('P03 the sixth attempt within the hour is rate limited (the conflict probe is bounded)', $q$select public.save_my_founder_profile('{"national_id":"29501010101234"}')$q$, 'P0001', 'alumni_rate_limited');
select v49_test.val('P04 the limiter does not block a legitimate save without an ID', $q$select public.save_my_founder_profile('{"education_status":"student"}')->>'saved'$q$, 'true');
select v49_test.fails('P05 direct SELECT on founder_identities is denied for a founder', $q$select count(*) from public.founder_identities$q$, '42501');
select v49_test.fails('P06 direct UPDATE of founder_identities is denied for a founder', $q$update public.founder_identities set national_id = '29501010101234'$q$, '42501');
select v49_test.fails('P07 direct INSERT into founder_identities is denied for a founder', $q$insert into public.founder_identities (founder_id, national_id) values ('00000000-0000-4000-8000-00000000f492', '30303152804527')$q$, '42501');
select v49_test.val('P08 a founder cannot read the founders row of ANOTHER founder through the API (RLS)', $q$select count(*)::text from public.founders where id = '00000000-0000-4000-8000-00000000f491'$q$, '0');
select v49_test.val('P09 a founder reads ONLY his own founders row', $q$select count(*)::text from public.founders$q$, '1');
select v49_test.fails('P10 get_alumni_founder is manager only', $q$select public.get_alumni_founder('00000000-0000-4000-8000-00000000f491', true)$q$, '42501');
select v49_test.fails('P11 export_alumni_rows is manager only', $q$select public.export_alumni_rows()$q$, '42501');
select v49_test.fails('P12 get_alumni_company / save_alumni_company / save_alumni_founder are manager only', $q$select public.get_alumni_company('00000000-0000-4000-8000-00000000c491')$q$, '42501');
select v49_test.fails('P13 save_alumni_founder is manager only', $q$select public.save_alumni_founder('00000000-0000-4000-8000-00000000f491', '{"national_id":"30303152804527"}')$q$, '42501');
select v49_test.fails('P14 analytics are manager only', $q$select public.get_alumni_analytics()$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e492","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('P15 a PM cannot read founder_identities', $q$select count(*) from public.founder_identities$q$, '42501');
select v49_test.fails('P16 a PM cannot read the manager-only notes', $q$select count(*) from public.company_internal$q$, '42501');
select v49_test.fails('P17 a PM cannot read the lookup table directly (RPC only)', $q$select count(*) from public.alumni_lookups$q$, '42501');
select v49_test.fails('P18 a PM cannot export', $q$select public.export_alumni_rows()$q$, '42501');
select v49_test.fails('P19 a PM cannot get a founder through the manager RPC', $q$select public.get_alumni_founder('00000000-0000-4000-8000-00000000f491', false)$q$, '42501');
select v49_test.val('P20 a PM reads no financial snapshot (none exist, and the policy no longer lets a participating PM read them)', $q$select count(*)::text from public.company_snapshots$q$, '0');
select v49_test.fails('P21 a PM is not a founder: no founder profile', $q$select public.get_my_alumni_profile()$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e496","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('P22 a user with no role has no founder profile and no directory', $q$select public.get_my_alumni_profile()$q$, '42501');
select v49_test.fails('P23 ... nor the directory', $q$select public.list_alumni_directory()$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v49_test.fails('P24 anon cannot touch the identity table', $q$select count(*) from public.founder_identities$q$, '42501');
select v49_test.fails('P25 anon cannot read companies', $q$select count(*) from public.companies$q$, '42501');
reset role;
select v49_test.val('P26 the privilege catalogue agrees: no anon / authenticated privilege on the identity tables, anon cannot execute the profile RPCs', $q$select (not has_table_privilege('anon', 'public.founder_identities', 'SELECT') and not has_table_privilege('authenticated', 'public.founder_identities', 'SELECT')
  and not has_function_privilege('anon', 'public.get_my_alumni_profile()', 'EXECUTE') and not has_function_privilege('anon', 'public.export_alumni_rows(jsonb,integer,text,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_alumni_founder(uuid,boolean)', 'EXECUTE'))::text$q$, 'true');

-- ================================================================= M. manager: identity of founders, masked unless revealed (audited)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('M01 a manager sees the founder with the ID MASKED by default (and the derived values)', $q$select (f->'identity'->>'id_masked') || '|' || (f->'identity' ? 'national_id')::text || '|' || (f->'identity'->'derived'->>'gender') || '|' || (f->'identity'->'derived'->>'governorate')
  from (select public.get_alumni_founder('00000000-0000-4000-8000-00000000f491') f) x$q$, '**********1234|false|male|1');
select v49_test.val('M02 a reveal returns the full number and is LOGGED', $q$select f->'identity'->>'national_id' from (select public.get_alumni_founder('00000000-0000-4000-8000-00000000f491', true) f) x$q$, '29501010101234');
reset role;
select v49_test.val('M03 the access log holds who / how / which founder, never the number', $q$select count(*)::text || '|' || bool_and(via = 'reveal' and founder_id = '00000000-0000-4000-8000-00000000f491' and accessed_by = '00000000-0000-4000-8000-00000000e491')::text
  from app_private.founder_identity_access_log$q$, '1|true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('M04 a manager entering a taken ID gets the conflict as an ERROR with the owner (for merging), not as a soft failure', $q$select public.save_alumni_founder('00000000-0000-4000-8000-00000000f492', '{"national_id":"29501010101234"}')$q$, '23505', 'national_id_conflict');
select v49_test.val('M05 a manager sets the ID of founder F2 (an Excel import of a founder): derived values appear', $q$select (r->'founder'->'identity'->'derived'->>'gender') || '|' || (r->'founder'->'identity'->'derived'->>'governorate') || '|' || (r->'founder'->'identity'->>'id_masked')
  from (select public.save_alumni_founder('00000000-0000-4000-8000-00000000f492', '{"national_id":"30303152804527","education_status":"student"}') r) x$q$, 'female|28|**********4527');
select v49_test.val('M06 a manager may set the e-mail of a founder', $q$select r->'founder'->>'email' from (select public.save_alumni_founder('00000000-0000-4000-8000-00000000f492', '{"email":"Zz-V49-F2b@Example.invalid"}') r) x$q$, 'zz-v49-f2b@example.invalid');
reset role;

-- ================================================================= F3: a founder without a founders row gets one (and a company by himself)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('E01 get_my_alumni_profile creates the missing founders row (name from the profile, e-mail from the account) and returns no company', $q$select (p->'founder'->>'name_en') || '|' || (p->'founder'->>'email') || '|' || jsonb_array_length(p->'companies')::text
  from (select public.get_my_alumni_profile() p) x$q$, 'Third Founder|zz-v49-f3@example.invalid|0');
reset role;
select v49_test.val('E02 exactly one founders row for that account (a second call does not add another)', $q$select count(*)::text from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e495'$q$, '1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select public.get_my_alumni_profile() is not null as again \gset
select v49_test.val('E03 ... even after a second call', $q$select count(*)::text from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e495'$q$, '1');
select v49_test.fails('E04 a company needs a name', $q$select public.save_my_company_profile(null, '{"sector":"healthcare"}')$q$, '22023', 'alumni_invalid', 'name:required');
select v49_test.fails('E05 a founder cannot create a company that ALREADY exists (same name, any case): the Athar team links him', $q$select public.save_my_company_profile(null, '{"name_en":"v49 nile labs"}')$q$, '23505', 'alumni_company_exists');
select (public.save_my_company_profile(null, '{"name_en":"V49 Third Startup","name_ar":"شركتي الثالثة","description_en":"We build things","sector":"technology","subsector":"robotics","stage":"mvp","startup_type":"startup","legal_status":"llc","governorate":25,"location_en":"Assiut city","established_on":"2022-02-02","website_url":"https://third.example.com","app_url":"https://play.example.com/third","linkedin_url":"https://linkedin.com/company/third","links":[{"kind":"facebook","url":"https://facebook.com/third"},{"kind":"deck","url":"https://example.com/deck","label":"Pitch deck"}]}')->'company'->>'id') as co3 \gset
select v49_test.val('E07 the founder created his company: he is its PRIMARY founder, the company is NOT alumni and PRIVATE', format($q$select (select cf.is_primary::text from public.company_founders cf where cf.company_id = '%s') || '|' || (select c.is_alumni::text from public.companies c where c.id = '%s') || '|' ||
  (select c.directory_visibility from public.companies c where c.id = '%s') || '|' || (select c.created_by::text from public.companies c where c.id = '%s')$q$, :'co3', :'co3', :'co3', :'co3'), 'true|false|private|00000000-0000-4000-8000-00000000e495');
reset role;
select v49_test.val('E08 typed values were saved; the legacy text columns were mirrored FROM THE KEYS (one-way) and founding_year follows established_on', format($q$select concat_ws('|', sector_key, subsector_key, stage, governorate_code, industry_en, governorate_ar, founding_year, app_url) from public.companies where id = '%s'$q$, :'co3'),
  'technology|robotics|mvp|25|Technology|أسيوط|2022|https://play.example.com/third');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('E09 changing the sector clears the sub sector unless a new one is given', format($q$select coalesce(r->'company'->>'subsector', 'NULL') || '|' || (r->'company'->>'sector') || '|' || (r->'company'->'legacy'->>'industry_ar') from (select public.save_my_company_profile('%s', '{"sector":"healthcare"}') r) x$q$, :'co3'), 'NULL|healthcare|الرعاية الصحية وعلوم الحياة');
select v49_test.fails('E10 a sub sector of another sector is refused', format($q$select public.save_my_company_profile('%s', '{"sector":"healthcare","subsector":"robotics"}')$q$, :'co3'), '22023', 'alumni_invalid', 'subsector:parent_mismatch');
select v49_test.fails('E11 unknown stage / sector / startup type / legal status / governorate / closing reason', format($q$select public.save_my_company_profile('%s', '{"stage":"warp"}')$q$, :'co3'), '22023', 'alumni_invalid', 'stage:unknown');
select v49_test.fails('E12 unknown sector', format($q$select public.save_my_company_profile('%s', '{"sector":"warp"}')$q$, :'co3'), '22023', 'alumni_invalid', 'sector:unknown');
select v49_test.fails('E13 unknown governorate (99) and born-abroad (88) are not company locations', format($q$select public.save_my_company_profile('%s', '{"governorate":88}')$q$, :'co3'), '22023', 'alumni_invalid', 'governorate:unknown');
select v49_test.fails('E14 a future establishment date', format($q$select public.save_my_company_profile('%s', '{"established_on":"2999-01-01"}')$q$, :'co3'), '22023', 'alumni_invalid', 'established_on:future');
select v49_test.fails('E15 a bad date', format($q$select public.save_my_company_profile('%s', '{"established_on":"31/12/2020"}')$q$, :'co3'), '22023', 'alumni_invalid', 'established_on:bad_date');
select v49_test.fails('E16 javascript: URLs are refused (website / app / linkedin / links)', format($q$select public.save_my_company_profile('%s', '{"website_url":"javascript:alert(1)"}')$q$, :'co3'), '22023', 'alumni_invalid', 'website_url:bad_url');
select v49_test.fails('E17 a link of an unknown kind / linkedin inside links', format($q$select public.save_my_company_profile('%s', '{"links":[{"kind":"linkedin","url":"https://linkedin.com/x"}]}')$q$, :'co3'), '22023', 'alumni_invalid', 'links:use_linkedin_url');
select v49_test.fails('E18 more than 12 links', format($q$select public.save_my_company_profile('%s', %L)$q$, :'co3', jsonb_build_object('links', (select jsonb_agg(jsonb_build_object('kind', 'other', 'url', 'https://e.example/' || g)) from generate_series(1, 13) g))::text), '22023', 'alumni_invalid', 'links:bad_value');
select v49_test.fails('E19 is_alumni and the internal notes are manager-only keys', format($q$select public.save_my_company_profile('%s', '{"internal":{"hint":"x"}}')$q$, :'co3'), '22023', 'alumni_invalid', 'internal:manager_only');
select v49_test.fails('E20 an unknown key is refused (the form cannot silently lose a field)', format($q$select public.save_my_company_profile('%s', '{"revenue":5}')$q$, :'co3'), '22023', 'alumni_invalid', 'revenue:unknown_key');
select v49_test.fails('E21 a text that is too long', format($q$select public.save_my_company_profile('%s', %L)$q$, :'co3', jsonb_build_object('description_en', repeat('x', 4001))::text), '22023', 'alumni_invalid', 'description_en:too_long');
select v49_test.fails('E22 closed-only fields on an open company', format($q$select public.save_my_company_profile('%s', '{"closing_reason":"funding"}')$q$, :'co3'), '22023', 'alumni_invalid', 'closing:requires_closed');
select v49_test.val('E23 closing a company: status + date + reason + what happened after', format($q$select (r->'company'->>'operating_status') || '|' || (r->'company'->>'closed_on') || '|' || (r->'company'->>'closing_reason') || '|' || (r->'company'->>'after_closing')
  from (select public.save_my_company_profile('%s', '{"operating_status":"closed","closed_on":"2025-06-01","closing_reason":"funding","after_closing":"employed","closing_note":"ran out of runway"}') r) x$q$, :'co3'), 'closed|2025-06-01|funding|employed');
select v49_test.val('E24 re-opening clears every closing field', format($q$select (r->'company'->>'operating_status') || '|' || coalesce(r->'company'->>'closing_reason', 'NULL') || '|' || coalesce(r->'company'->>'closing_note', 'NULL')
  from (select public.save_my_company_profile('%s', '{"operating_status":"open"}') r) x$q$, :'co3'), 'open|NULL|NULL');
select public.get_my_company_profile(:'co3')->'company'->>'updated_at' as upd \gset
select v49_test.fails('E26 stale save', format($q$select public.save_my_company_profile('%s', '{"description_en":"changed"}', %L::timestamptz)$q$, :'co3', '2020-01-01T00:00:00+00'), 'P0001', 'alumni_stale'); -- P0001, not 40001 (m50): PostgREST retries a serialization failure for ever
select v49_test.val('E27 a current updated_at saves', format($q$select (public.save_my_company_profile('%s', '{"description_en":"changed"}', %L::timestamptz))->'company'->>'description_en'$q$, :'co3', :'upd'), 'changed');
select v49_test.val('E28 the company profile carries the derived team counts: 1 founder, none female / under 35 known', format($q$select (p->'counts')::text from (select public.get_my_company_profile('%s') p) x$q$, :'co3'), '{"team_size": 1, "female_founders": null, "founders_under_35": null}');   -- m52: nobody of the team has a known gender / age: unknown, not 0
select v49_test.val('E29 the completeness of the company names what is missing', format($q$select (p->'company'->'completeness'->'missing')::text from (select public.get_my_company_profile('%s') p) x$q$, :'co3'), '["annual_update"]');
reset role;

-- ================================================================= T. team (co-founders), CEO and the derived counts
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('T01 a founder adds a co-founder RECORD (no account): team of 2, role kept', format($q$select jsonb_array_length(r->'team')::text || '|' || (select t->>'role' from jsonb_array_elements(r->'team') t where t->>'name_en' = 'Hana Co')
  from (select public.save_company_team_member('%s', null, '{"name_en":"Hana Co","role":"CTO","self_gender":"female","self_birth_date":"2002-06-06"}') r) x$q$, :'co3'), '2|CTO');
select v49_test.val('T02 Founding team size / Female founders / Nu. of founders below 35 are DERIVED from the rows: 2 / 1 / 1 (Hana, 24)', format($q$select (p->'counts')::text from (select public.get_my_company_profile('%s') p) x$q$, :'co3'), '{"team_size": 2, "female_founders": 1, "founders_under_35": 1}');
select public.get_my_company_profile(:'co3')->'team' as team_json \gset
select v49_test.val('T03 the record shows its typed values to the lead founder and the record is flagged "self"', format($q$select (t->>'gender') || '|' || (t->>'source') || '|' || (t->>'has_account') from jsonb_array_elements(%L::jsonb) t where t->>'name_en' = 'Hana Co'$q$, :'team_json'), 'female|self|false');
select v49_test.fails('T04 a founder cannot enter a NATIONAL ID for somebody else', format($q$select public.save_company_team_member('%s', null, '{"name_en":"X","national_id":"29501010101234"}')$q$, :'co3'), '22023', 'alumni_invalid', 'national_id:not_allowed');
select v49_test.fails('T05 a founder cannot add a team member to a company that is not his', $q$select public.save_company_team_member('00000000-0000-4000-8000-00000000c491', null, '{"name_en":"Intruder"}')$q$, '42501');
select (select t->>'founder_id' from jsonb_array_elements(:'team_json'::jsonb) t where t->>'name_en' = 'Hana Co') as hana \gset
select v49_test.val('T06 he edits the record (a gender fix)', format($q$select (select t->>'gender' from jsonb_array_elements(r->'team') t where t->>'name_en' = 'Hana Co') from (select public.save_company_team_member('%s', '%s', '{"self_gender":"male"}') r) x$q$, :'co3', :'hana'), 'male');
select v49_test.val('T07 ... counts follow (0 female)', format($q$select (p->'counts'->>'female_founders') from (select public.get_my_company_profile('%s') p) x$q$, :'co3'), '0');
select v49_test.val('T08 set_company_ceo moves the CEO flag (exactly one primary: Hana)', format($q$select (select count(*) from jsonb_array_elements(r->'team') t where (t->>'is_primary')::boolean)::text || '|' || (r->>'ceo_founder_id') from (select public.set_company_ceo('%s', '%s') r) x$q$, :'co3', :'hana'), '1|' || :'hana');
reset role;
select v49_test.val('T09 ... and the CEO helper agrees (primary first; called as the owner: the helper is not executable by an API role)', format($q$select (app_private.alumni_company_ceo('%s') = '%s')::text$q$, :'co3', :'hana'), 'true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('T10 a founder cannot remove a REGISTERED co-founder (the lead himself, who has an account)', format($q$select public.remove_company_team_member('%s', (select f.id from public.founders f where f.auth_user_id = '00000000-0000-4000-8000-00000000e495'))$q$, :'co3'), '42501');
select v49_test.val('T11 he removes the record: the team shrinks and the record is soft-deleted with its identity row erased', format($q$select jsonb_array_length(r->'team')::text from (select public.remove_company_team_member('%s', '%s') r) x$q$, :'co3', :'hana'), '1');
reset role;
select v49_test.val('T12 the removed record: deleted_at set, no identity row left', format($q$select (f.deleted_at is not null)::text || '|' || (select count(*) from public.founder_identities i where i.founder_id = f.id)::text from public.founders f where f.id = '%s'$q$, :'hana'), 'true|0');

-- ================================================================= S. yearly snapshots
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.superseded('S01 a founder writes the ANNUAL row of 2024: all metrics, source founder', format($q$select (r->'snapshot'->>'year') || '|' || (r->'snapshot'->>'revenue_total') || '|' || (r->'snapshot'->>'employees_total') || '|' || (r->'snapshot'->>'source')
  from (select public.upsert_company_snapshot('%s', 2024, '{"revenue_total":250000.5,"funding_raised_total":100000,"employees_total":10,"employees_female":4,"freelancers":3,"traction":"50 pilots","challenges":"cash flow","needs":"seed funding"}') r) x$q$, :'co3'),
  '2024|250000.50|10|founder');
select v49_test.superseded('S02 a second call for the SAME year updates the same row (patch: untouched keys are kept, null clears)', format($q$select jsonb_array_length(r->'snapshots')::text || '|' || (r->'snapshot'->>'revenue_total') || '|' || (r->'snapshot'->>'employees_total') || '|' || coalesce(r->'snapshot'->>'challenges', 'NULL')
  from (select public.upsert_company_snapshot('%s', 2024, '{"employees_total":12,"challenges":null}') r) x$q$, :'co3'), '1|250000.50|12|NULL');
select v49_test.superseded('S03 a different year is another row (keyed by year: 2025 can be added next year)', format($q$select jsonb_array_length(r->'snapshots')::text || '|' || (r->'snapshots'->0->>'year') from (select public.upsert_company_snapshot('%s', 2025, '{"revenue_total":400000}') r) x$q$, :'co3'), '2|2025');
select v49_test.superseded('S04 female employees cannot exceed the total', format($q$select public.upsert_company_snapshot('%s', 2024, '{"employees_female":99}')$q$, :'co3'), '22023', 'alumni_invalid', 'employees_female:exceeds_total');
select v49_test.superseded('S05 a negative / non-numeric amount', format($q$select public.upsert_company_snapshot('%s', 2024, '{"revenue_total":-5}')$q$, :'co3'), '22023', 'alumni_invalid', 'revenue_total:not_a_number');
select v49_test.superseded('S06 a year in the future / before 1990', format($q$select public.upsert_company_snapshot('%s', 2999, '{"employees_total":1}')$q$, :'co3'), '22023', 'alumni_invalid', 'year:out_of_range');
select v49_test.superseded('S07 unknown metric', format($q$select public.upsert_company_snapshot('%s', 2024, '{"profit":1}')$q$, :'co3'), '22023', 'alumni_invalid', 'profit:unknown_key');
select v49_test.superseded('S08 a founder of ANOTHER company cannot write it', $q$select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c491', 2024, '{"employees_total":1}')$q$, '42501');
select v49_test.superseded('S09 a founder cannot delete a snapshot (manager only)', format($q$select public.delete_company_snapshot('%s', 2025)$q$, :'co3'), '42501');
select v49_test.superseded('S10 the founder reads his own snapshots directly (RLS) and nobody else''s', $q$select count(*)::text from public.company_snapshots$q$, '2');
select v49_test.superseded('S11 a founder cannot INSERT a snapshot directly (RPC only)', format($q$insert into public.company_snapshots (company_id, snapshot_type, period_year) values ('%s', 'annual', 2020)$q$, :'co3'), '42501');
select v49_test.superseded('S12 a founder cannot UPDATE a snapshot directly', $q$update public.company_snapshots set revenue_total = 1$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.superseded('S13 another founder reads none of those snapshots', $q$select count(*)::text from public.company_snapshots$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.superseded('S14 a manager corrects the same year: source becomes manager', format($q$select (r->'snapshot'->>'source') || '|' || (r->'snapshot'->>'revenue_total') from (select public.upsert_company_snapshot('%s', 2024, '{"revenue_total":260000}') r) x$q$, :'co3'), 'manager|260000.00');
select v49_test.superseded('S15 a manager deletes a year', format($q$select jsonb_array_length(r->'snapshots')::text from (select public.delete_company_snapshot('%s', 2025) r) x$q$, :'co3'), '1');
reset role;
select v49_test.superseded('S16 the annual key is unique per company and year (the index backstop)', format($q$select (select count(*) from public.company_snapshots where company_id = '%s' and snapshot_type = 'annual' and period_year = 2024)::text$q$, :'co3'), '1');
select v49_test.superseded('S17 the unique index refuses a duplicate year even for the table owner', format($q$insert into public.company_snapshots (company_id, snapshot_type, period_year) values ('%s', 'annual', 2024)$q$, :'co3'), '23505');

-- ================================================================= manager fixture for the directory / export / analytics
-- (helper as the owner: the cell of a given company row and column header in an export payload)
create or replace function v49_test.cell(j jsonb, p_name text, p_header text) returns text language sql immutable as $$
  select r->>(c.ord::int - 1) from jsonb_array_elements(j->'rows') r,
         (select (x->>'header') as h, ord from jsonb_array_elements(j->'columns') with ordinality t(x, ord)) c
   where c.h = p_header and r->>0 = p_name limit 1
$$;
grant execute on function v49_test.cell(jsonb, text, text) to anon, authenticated, service_role;
select app_private.id_age_category(extract(year from age((now() at time zone 'Africa/Cairo')::date, date '1995-01-01'))::int) as cat_a \gset
select extract(year from age((now() at time zone 'Africa/Cairo')::date, date '1995-01-01'))::int as age_a \gset
select :'co3'::text as co4 \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('D02 before anyone is marked alumni the default (alumni) scope of the manager directory is EMPTY for the fixture', $q$select (public.list_alumni_directory('{"q":"v49"}'))->>'total'$q$, '0');
select v49_test.val('D03 scope "all": the four fixture companies', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all"}'))->>'total'$q$, '4');
select v49_test.val('D04 scope "candidates": not alumni yet AND (a derived participation OR a linked founder) = all four', $q$select (public.list_alumni_directory('{"q":"v49","scope":"candidates"}'))->>'total'$q$, '4');
select v49_test.val('D05 set_companies_alumni marks CO1, CO3 and the founder-created company (3 changed)', format($q$select (public.set_companies_alumni(array['00000000-0000-4000-8000-00000000c491', '00000000-0000-4000-8000-00000000c493', '%s']::uuid[], true))->>'changed'$q$, :'co4'), '3');
select v49_test.val('D06 ... a second identical call changes nothing', format($q$select (public.set_companies_alumni(array['00000000-0000-4000-8000-00000000c491', '%s']::uuid[], true))->>'changed'$q$, :'co4'), '0');
select v49_test.fails('D07 set_companies_alumni refuses an empty list and more than 500', $q$select public.set_companies_alumni(array[]::uuid[], true)$q$, '22023', 'alumni_invalid', 'ids:required');
select v49_test.val('D08 the default scope now lists the 3 alumni', $q$select (public.list_alumni_directory('{"q":"v49"}'))->>'total'$q$, '3');
-- the manager completes CO1 (everything a manager may write: typed fields, the internal notes, the review stamp)
select v49_test.val('D09 save_alumni_company: a manager edits CO1 incl. the manager-only notes', $q$select (r->'company'->>'sector') || '|' || (r->'company'->'internal'->>'hint') || '|' || ((r->'company'->'internal'->>'reviewed_at') is not null)::text
  from (select public.save_alumni_company('00000000-0000-4000-8000-00000000c491', '{"governorate":25,"sector":"technology","subsector":"robotics","stage":"scaling","startup_type":"startup","legal_status":"llc","established_on":"2020-01-15",
  "description_en":"Nile Labs builds robots for farms","website_url":"https://nile.example.com","internal":{"hint":"Strong team; follow up in Q1","reviewed":true}}') r) x$q$, 'technology|Strong team; follow up in Q1|true');
select v49_test.superseded('D10 a manager writes the 2024 snapshot of CO1 (revenue / headcount only)', $q$select (r->'snapshot'->>'revenue_total') from (select public.upsert_company_snapshot('00000000-0000-4000-8000-00000000c491', 2024, '{"revenue_total":500000,"employees_total":20,"employees_female":8}') r) x$q$, '500000.00');
select v49_test.fails('D11 a manager cannot create a second company with an existing name (merge instead)', $q$select public.save_alumni_company(null, '{"name_en":"V49 NILE LABS"}')$q$, '23505', 'alumni_company_exists');
select v49_test.val('D12 a manager can create a company (no founder link, created_by = the manager)', $q$select (r->'company'->>'name_en') || '|' || jsonb_array_length(r->'team')::text from (select public.save_alumni_company(null, '{"name_en":"V49 Manager Made","sector":"education"}') r) x$q$, 'V49 Manager Made|0');
select ctid::text as ct1 from public.companies where id = '00000000-0000-4000-8000-00000000c491' \gset
select public.save_alumni_company('00000000-0000-4000-8000-00000000c491', '{"internal":{"hint":"Strong team; follow up in Q1"}}') is not null as note_only \gset
select v49_test.val('D13 a manager NOTE alone does not write the company row (its updated_at, the founders'' optimistic-concurrency token, does not move)', format($q$select (ctid::text = %L)::text from public.companies where id = '00000000-0000-4000-8000-00000000c491'$q$, :'ct1'), 'true');
select public.save_alumni_company('00000000-0000-4000-8000-00000000c491', '{"description_en":"Nile Labs builds robots for farms"}') is not null as field_save \gset
select v49_test.val('D14 ... a company FIELD does (a new row version)', format($q$select (ctid::text <> %L)::text from public.companies where id = '00000000-0000-4000-8000-00000000c491'$q$, :'ct1'), 'true');

select public.get_alumni_company('00000000-0000-4000-8000-00000000c493') as co_leg \gset
select v49_test.val('D15 a LEGACY company: the payload links are CANONICAL ({kind,url,label}): the entry that repeats the website and the LinkedIn entry are dropped (they live in website_url / linkedin_url), the plain link becomes "other"', format($q$select ((j->'company'->'links')::text) || '|' || (j->'company'->>'linkedin_url') from (select %L::jsonb j) x$q$, :'co_leg'),
  '[{"url": "https://facebook.com/leg", "kind": "facebook", "label": "Facebook"}, {"url": "https://drive.example.com/deck", "kind": "other", "label": "Pitch Deck"}]|https://linkedin.com/company/leg');
select v49_test.val('D16 the payload round-trips: saving it back unchanged is accepted and stores the canonical links (no legacy key left)', format($q$select ((r->'company'->'links')::text) from (select public.save_alumni_company('00000000-0000-4000-8000-00000000c493', jsonb_build_object('links', (%L::jsonb)->'company'->'links', 'linkedin_url', (%L::jsonb)->'company'->>'linkedin_url', 'website_url', (%L::jsonb)->'company'->>'website_url')) r) x$q$, :'co_leg', :'co_leg', :'co_leg'),
  '[{"url": "https://facebook.com/leg", "kind": "facebook", "label": "Facebook"}, {"url": "https://drive.example.com/deck", "kind": "other", "label": "Pitch Deck"}]');
reset role;

-- visibility: founders choose, the manager can veto, "alumni" status is the gate
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('V01 a signed-in founder (F2) sees NO company while every profile is private', $q$select (j->>'total') || '|' || (j->>'audience') from (select public.list_alumni_directory('{"q":"v49"}') j) x$q$, '0|member');
select v49_test.val('V02 F2 publishes HIS company (not alumni): still invisible (a manager has not vouched for it)', $q$select (public.save_my_company_profile('00000000-0000-4000-8000-00000000c492', '{"directory_visibility":"public"}'))->'company'->>'directory_visibility'$q$, 'public');
select v49_test.val('V03 ... and it does not appear', $q$select (public.list_alumni_directory('{"q":"v49"}'))->>'total'$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('V04 F1 sets CO1 to PUBLIC', $q$select (public.save_my_company_profile('00000000-0000-4000-8000-00000000c491', '{"directory_visibility":"public"}'))->'company'->>'directory_visibility'$q$, 'public');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('V05 F3 sets his company to ALUMNI-only', format($q$select (public.save_my_company_profile('%s', '{"directory_visibility":"alumni"}'))->'company'->>'directory_visibility'$q$, :'co4'), 'alumni');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select public.list_alumni_directory('{"q":"v49"}') as dir_member \gset
select v49_test.val('V06 a signed-in founder now sees CO1 (public) and the alumni-level company, not the private CO3', format($q$select (j->>'total') || '|' || (select string_agg(r->>'name_en', ',' order by r->>'name_en') from jsonb_array_elements(j->'rows') r) from (select %L::jsonb j) x$q$, :'dir_member'), '2|V49 Nile Labs,V49 Third Startup');
select v49_test.val('V07 the member payload is a WHITELIST: exactly these keys per row', format($q$select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys((%L::jsonb)->'rows'->0) k)$q$, :'dir_member'),
  'app_url,description_ar,description_en,established_year,governorate,id,logo_path,name_ar,name_en,operating_status,programs,sector,social,stage,startup_type,subsector,website_url');
select v49_test.val('V08 ... and carries NO personal or financial value: no ID, no e-mail, no phone, no revenue, no hint, no age', format($q$select (%L like '%%29501010101234%%' or %L like '%%example.invalid%%' or %L like '%%+2010%%' or %L like '%%revenue%%' or %L like '%%Strong team%%' or %L like '%%"age"%%' or %L like '%%team%%')::text$q$,
  :'dir_member', :'dir_member', :'dir_member', :'dir_member', :'dir_member', :'dir_member', :'dir_member'), 'false');
select v49_test.fails('V10 ceo_gender is manager only', $q$select public.list_alumni_directory('{"ceo_gender":"female"}')$q$, '22023', 'alumni_invalid', 'ceo_gender:manager_only');
select v49_test.fails('V11 scope is manager only (a founder cannot ask for "all")', $q$select public.list_alumni_directory('{"scope":"all"}')$q$, '22023', 'alumni_invalid', 'scope:manager_only');
select v49_test.fails('V12 an unknown filter key is refused', $q$select public.list_alumni_directory('{"colour":"red"}')$q$, '22023', 'alumni_invalid', 'colour:unknown_key');
select v49_test.fails('V13 a malformed uuid filter', $q$select public.list_alumni_directory('{"program_id":"nope"}')$q$, '22023', 'alumni_invalid', 'program_id:bad_value');
select v49_test.fails('V14 an unknown sort', $q$select public.list_alumni_directory('{}', 24, 0, 'revenue')$q$, '22023', 'alumni_invalid', 'sort:bad_value');
select v49_test.val('V15 the member rows carry the DERIVED programs (names only: Program Scope / Program Name come from the participations)', format($q$select (select jsonb_array_length(r->'programs')::text || '|' || (r->'programs'->0->>'program_name_en') from jsonb_array_elements((%L::jsonb)->'rows') r where r->>'name_en' = 'V49 Nile Labs')$q$, :'dir_member'), '2|V49 Program');
select v49_test.val('V16 the member filters work (sector technology -> CO1 only)', $q$select (public.list_alumni_directory('{"q":"v49","sector":"technology"}'))->>'total'$q$, '1');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select public.list_public_alumni_directory('{"q":"v49"}') as dir_public \gset
select v49_test.val('V17 anon sees ONLY the public one (CO1), audience "public"', format($q$select (j->>'total') || '|' || (j->>'audience') || '|' || (j->'rows'->0->>'name_en') from (select %L::jsonb j) x$q$, :'dir_public'), '1|public|V49 Nile Labs');
select v49_test.val('V18 the public payload has the same whitelist (no personal / financial value)', format($q$select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys((%L::jsonb)->'rows'->0) k)$q$, :'dir_public'),
  'app_url,description_ar,description_en,established_year,governorate,id,logo_path,name_ar,name_en,operating_status,programs,sector,social,stage,startup_type,subsector,website_url');
select v49_test.fails('V19 anon cannot use a manager / unknown filter', $q$select public.list_public_alumni_directory('{"scope":"all"}')$q$, '22023', 'alumni_invalid', 'scope:manager_only');
select v49_test.val('V20 the public page size is capped at 50', $q$select (public.list_public_alumni_directory('{}', 1000, 0))->>'limit'$q$, '50');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('V21 the MANAGER vetoes CO1 from the directory (internal.directory_hidden)', $q$select (r->'company'->'internal'->>'directory_hidden') from (select public.save_alumni_company('00000000-0000-4000-8000-00000000c491', '{"internal":{"directory_hidden":true}}') r) x$q$, 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('V22 ... the signed-in founder no longer sees CO1', $q$select (public.list_alumni_directory('{"q":"v49"}'))->>'total'$q$, '1');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v49_test.val('V23 ... and anon sees nothing', $q$select (public.list_public_alumni_directory('{"q":"v49"}'))->>'total'$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('V24 the owner sees THAT his company is blocked (a boolean), never the manager note', $q$select (p->'company'->>'directory_blocked') || '|' || (p->'company' ? 'internal')::text || '|' || (p::text like '%Strong team%')::text from (select public.get_my_company_profile('00000000-0000-4000-8000-00000000c491') p) x$q$, 'true|false|false');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c491', '{"internal":{"directory_hidden":false}}') is not null as unveiled \gset

-- the manager list rows
select public.list_alumni_directory('{"q":"v49","scope":"all"}', 24, 0, 'established') as dir_mgr \gset
select v49_test.val('V25 manager rows are ordered by the requested sort (established, newest first; nulls last)', format($q$select (select string_agg(r->>'name_en', ',' order by ord) from jsonb_array_elements((%L::jsonb)->'rows') with ordinality t(r, ord) where ord <= 2)$q$, :'dir_mgr'), 'V49 Third Startup,V49 Nile Labs');
select v49_test.val('V26 a manager row carries the CEO derived FROM THE ID (gender / age / governorate of origin / source) and the team counts', format($q$select (select (r->'ceo'->>'gender') || '|' || (r->'ceo'->>'age') || '|' || (r->'ceo'->>'governorate') || '|' || (r->'ceo'->>'source') || '|' || (r->'team'->>'size') || '|' || (r->'team'->>'under_35')
  from jsonb_array_elements((%L::jsonb)->'rows') r where r->>'name_en' = 'V49 Nile Labs')$q$, :'dir_mgr'), 'male|' || :'age_a' || '|1|id|1|1');
select v49_test.val('V27 ... the company location (typed) and the CEO governorate (from the ID) are SEPARATE values: Assiut (25) vs Cairo (1)', format($q$select (select (r->>'governorate') || '|' || (r->'ceo'->>'governorate') from jsonb_array_elements((%L::jsonb)->'rows') r where r->>'name_en' = 'V49 Nile Labs')$q$, :'dir_mgr'), '25|1');
select v49_test.superseded('V28 the latest snapshot summary (financial) is in the MANAGER row only', format($q$select (select (r->'latest'->>'year') || '|' || (r->'latest'->>'revenue_total') from jsonb_array_elements((%L::jsonb)->'rows') r where r->>'name_en' = 'V49 Nile Labs')$q$, :'dir_mgr'), '2024|500000.00');
select v49_test.val('V29 the legacy company keeps its legacy text next to the (empty) keys', format($q$select (select (r->'legacy'->>'industry_en') || '|' || coalesce(r->>'sector', 'NULL') || '|' || coalesce(r->>'governorate', 'NULL') from jsonb_array_elements((%L::jsonb)->'rows') r where r->>'name_en' = 'V49 Legacy Co')$q$, :'dir_mgr'), 'Technology, Manufacturing|NULL|NULL');
select v49_test.val('V30 paging: limit 2 offset 2 of 5 rows (the manager-made company is the 5th)', $q$select (j->>'total') || '|' || jsonb_array_length(j->'rows')::text || '|' || (j->>'offset') from (select public.list_alumni_directory('{"q":"v49","scope":"all"}', 2, 2) j) x$q$, '5|2|2');
select v49_test.val('V30b paging past the end: the total is still the number of matching companies, the page is empty', $q$select (j->>'total') || '|' || jsonb_array_length(j->'rows')::text from (select public.list_alumni_directory('{"q":"v49","scope":"all"}', 2, 50) j) x$q$, '5|0');
select v49_test.val('V31 limit above 100 is clamped', $q$select (public.list_alumni_directory('{}', 100000, 0))->>'limit'$q$, '100');
select v49_test.val('V32 filter by company governorate (25): CO1 and the founder-created one', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all","governorate":25}'))->>'total'$q$, '2');
select v49_test.val('V33 filter by the CEO governorate of origin (Cairo, 1): CO1 only', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all","ceo_governorate":1}'))->>'total'$q$, '1');
select v49_test.val('V34 filter by CEO gender female (F2 by the ID): CO2 only', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all","ceo_gender":"female"}'))->>'total'$q$, '1');
select v49_test.val('V35 filter by age category (CO1 CEO)', format($q$select (public.list_alumni_directory('{"q":"v49","scope":"all","age_category":"%s"}'))->>'total'$q$, :'cat_a'), '1');
select v49_test.val('V36 filter by a program: CO1 and CO3 (the withdrawn CO2 is not a participant)', format($q$select (public.list_alumni_directory('{"q":"v49","scope":"all","program_id":"%s"}'))->>'total'$q$, :'prog'), '2');
select v49_test.val('V37 filter by a project: J2 has CO1 only', format($q$select (public.list_alumni_directory('{"q":"v49","scope":"all","project_id":"%s"}'))->>'total'$q$, :'j2'), '1');
select v49_test.val('V38 filter has_female_founder (F2 is female by ID): CO2 only', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all","has_female_founder":true}'))->>'total'$q$, '1');
select v49_test.val('V39 filter reviewed (CO1 got the review stamp)', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all","reviewed":true}'))->>'total'$q$, '1');
select v49_test.val('V40 filter incomplete (a profile with a missing part): all but none complete', $q$select (public.list_alumni_directory('{"q":"v49","scope":"all","incomplete":true}'))->>'total'$q$, '5');
select v49_test.val('V41 the manager can read the company with the internal notes, the masked IDs and the derived programs (support kinds per project)', $q$select (p->'company'->'internal'->>'hint') || '|' || (select string_agg(t->>'id_masked', ',') from jsonb_array_elements(p->'team') t) || '|' ||
  jsonb_array_length(p->'programs')::text || '|' || (p::text like '%29501010101234%')::text from (select public.get_alumni_company('00000000-0000-4000-8000-00000000c491') p) x$q$, 'Strong team; follow up in Q1|**********1234|2|false');
select v49_test.val('V42 the derived support provided: J1 (agenda) = training, J2 (booking + distribution) = mentoring', $q$select (select string_agg(pr->'support'->>0, ',' order by pr->>'project_name_en') from jsonb_array_elements(p->'programs') pr) from (select public.get_alumni_company('00000000-0000-4000-8000-00000000c491') p) x$q$, 'training,mentoring');
reset role;

-- ================================================================= X. the export: the owner's 38 columns, in the owner's order
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select public.export_alumni_rows('{"q":"v49","scope":"all"}') as exp \gset
select public.export_alumni_rows('{"q":"v49","scope":"all"}', 2023, 'ar') as exp_ar \gset
reset role;
select v49_test.superseded('X01 the header texts and their ORDER are the owner''s (typos kept: Governerate, Nu. of ...)', format($q$select (select string_agg(c->>'header', '|' order by ord) from jsonb_array_elements((%L::jsonb)->'columns') with ordinality t(c, ord))$q$, :'exp'),
  'Startup Name|Program Scope|Program Name|Support provided|Startup type|Hint|Sector|Sub sector|Description|Stage|Governerate|Date of company established|App|Website|Social media|Traction/Validation|CEO Name|Phone|Email|ID|CEO Age|Age Category|Student/Graduate|CEO Gender|Open/Closed|Reason for closing|After closing|Legal Status|Founding team size|Female founders|Nu. of founders below 35|Nu. of employees|Nu. of female employees|Number of freelancers|Funding raised|Revenue (2024) (Total)|Challenges|Needs');
select v49_test.val('X02 38 columns, every row has 38 cells, 5 rows (the fixture)', format($q$select jsonb_array_length((%L::jsonb)->'columns')::text || '|' || (select string_agg(distinct jsonb_array_length(r)::text, ',') from jsonb_array_elements((%L::jsonb)->'rows') r) || '|' || ((%L::jsonb)->'meta'->>'count')$q$, :'exp', :'exp', :'exp'), '38|38|5');
select v49_test.val('X02b meta.ceo_source counts how many CEO cells come from an ID / are self-declared / unknown (the CEOs of the fixture: 2 by ID, 0 self-declared, 3 unknown)', format($q$select ((%L::jsonb)->'meta'->'ceo_source')::text$q$, :'exp'), '{"id": 2, "none": 3, "self": 0}');
select v49_test.superseded('X03 the default year is the latest year that has data (2024); an explicit year renames the revenue header', format($q$select ((%L::jsonb)->'meta'->>'year') || '|' || ((%L::jsonb)->'columns'->35->>'header')$q$, :'exp', :'exp_ar'), '2024|Revenue (2023) (Total)');
select v49_test.val('X04 CO1: Program Scope = the program, Program Name = the projects, Support provided = the derived kinds (mentoring first)', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Program Scope'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Program Name'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Support provided'))$q$, :'exp', :'exp', :'exp'),
  'V49 Program|V49 Project One; V49 Project Two|Mentoring; Training and workshops');
select v49_test.val('X05 CO1: Governerate = the CEO''s governorate FROM THE ID (Cairo), NOT the company''s typed Assiut', format($q$select v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Governerate')$q$, :'exp'), 'Cairo');
select v49_test.val('X06 CO1: CEO name / phone / e-mail / ID come from the founder', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'CEO Name'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Phone'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Email'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'ID'))$q$, :'exp', :'exp', :'exp', :'exp'),
  'Sara Ali|+201012345678|zz-v49-f1@example.invalid|29501010101234');
select v49_test.val('X07 CO1: CEO Age / Age Category / Student-Graduate / Gender are DERIVED (age at today, bucket label, typed status, ID gender)', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'CEO Age'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Age Category'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Student/Graduate'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'CEO Gender'))$q$, :'exp', :'exp', :'exp', :'exp'),
  :'age_a' || '|25 - 34|Graduate|Male');
select v49_test.val('X08 CO1: the classification and the manager note', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Startup type'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Sector'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Sub sector'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Stage'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Legal Status'),
  v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Hint'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Open/Closed'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Date of company established'))$q$, :'exp', :'exp', :'exp', :'exp', :'exp', :'exp', :'exp', :'exp'),
  'Startup|Technology|Robotics|Scaling|Limited liability company|Strong team; follow up in Q1|Open|2020-01-15');
select v49_test.superseded('X09 CO1: the counts are derived from the founders (1 / 0 / 1) and the yearly metrics come from the 2024 snapshot', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Founding team size'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Female founders'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Nu. of founders below 35'),
  v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Nu. of employees'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Nu. of female employees'), v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Revenue (2024) (Total)'))$q$, :'exp', :'exp', :'exp', :'exp', :'exp', :'exp'), '1|0|1|20|8|500000.00');
select v49_test.val('X10 CO1: a metric nobody entered is empty (no freelancers, no funding)', format($q$select coalesce(v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Number of freelancers'), 'NULL') || '|' || coalesce(v49_test.cell(%L::jsonb, 'V49 Nile Labs', 'Funding raised'), 'NULL')$q$, :'exp', :'exp'), 'NULL|NULL');
select v49_test.val('X11 CO3 (legacy, no keys, no CEO): the legacy industry / governorate TEXT fills Sector / Governerate; programs are still derived', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'Sector'), v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'Governerate'), v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'Program Name'), v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'Support provided'),
  coalesce(v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'CEO Name'), 'NULL'), coalesce(v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'Founding team size'), 'blank'))$q$, :'exp', :'exp', :'exp', :'exp', :'exp', :'exp'), 'Technology, Manufacturing|Alex|V49 Project One|Training and workshops|NULL|blank');   -- m52: a company with no founder record has a BLANK team size, not 0
select v49_test.val('X11b CO3: Social media = the social entries (facebook + linkedin) from the links / linkedin_url, as "Kind: url" joined by "; "; the plain link is not social', format($q$select v49_test.cell(%L::jsonb, 'V49 Legacy Co', 'Social media')$q$, :'exp'), 'Facebook: https://facebook.com/leg; Linkedin: https://linkedin.com/company/leg');
select v49_test.val('X12 CO2: the CEO governorate from the ID (Aswan) fills Governerate although the company has no governorate; the WITHDRAWN company has no program', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Second Co', 'Governerate'), v49_test.cell(%L::jsonb, 'V49 Second Co', 'CEO Gender'), coalesce(v49_test.cell(%L::jsonb, 'V49 Second Co', 'Program Name'), 'NULL'), v49_test.cell(%L::jsonb, 'V49 Second Co', 'Student/Graduate'))$q$, :'exp', :'exp', :'exp', :'exp'), 'Aswan|Female|NULL|Student');
select v49_test.superseded('X13 the founder-created company (no ID on its CEO): Governerate = the company''s typed governorate (Assiut); the 2024 metrics + the text fields as of the year', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Governerate'), v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Revenue (2024) (Total)'), v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Nu. of employees'),
  v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Number of freelancers'), v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Funding raised'), v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Traction/Validation'), coalesce(v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Challenges'), 'NULL'), v49_test.cell(%L::jsonb, 'V49 Third Startup', 'Needs'),
  coalesce(v49_test.cell(%L::jsonb, 'V49 Third Startup', 'ID'), 'NULL'), coalesce(v49_test.cell(%L::jsonb, 'V49 Third Startup', 'CEO Age'), 'NULL'))$q$, :'exp', :'exp', :'exp', :'exp', :'exp', :'exp', :'exp', :'exp', :'exp', :'exp'),
  'Assiut|260000.00|12|3|100000.00|50 pilots|NULL|seed funding|NULL|NULL');
select v49_test.val('X14 the Arabic export: Arabic names / labels (company, sector, governorate from the ID)', format($q$select concat_ws('|', v49_test.cell(%L::jsonb, 'مختبرات النيل V49', 'Sector'), v49_test.cell(%L::jsonb, 'مختبرات النيل V49', 'Governerate'), v49_test.cell(%L::jsonb, 'مختبرات النيل V49', 'CEO Gender'))$q$, :'exp_ar', :'exp_ar', :'exp_ar'), 'التكنولوجيا|القاهرة|ذكر');
select v49_test.val('X15 a year with no snapshot: the revenue cell is empty and the as-of metrics are empty too (the 2024 row is later than 2023)', format($q$select coalesce(v49_test.cell(%L::jsonb, 'مختبرات النيل V49', 'Revenue (2023) (Total)'), 'NULL') || '|' || coalesce(v49_test.cell(%L::jsonb, 'مختبرات النيل V49', 'Nu. of employees'), 'NULL')$q$, :'exp_ar', :'exp_ar'), 'NULL|NULL');
select v49_test.val('X16 every export is LOGGED (row count only): three exports so far, none with a number in the log', $q$select count(*)::text || '|' || (select sum(row_count) from app_private.founder_identity_access_log where via = 'export')::text from app_private.founder_identity_access_log where via = 'export'$q$, '2|10');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('X17 the export honours the filters (scope alumni -> the 3 alumni + the manager-made one is not alumni)', $q$select ((public.export_alumni_rows('{"q":"v49"}'))->'meta'->>'count')$q$, '3');
select v49_test.fails('X18 a bad filter on the export', $q$select public.export_alumni_rows('{"nope":1}')$q$, '22023', 'alumni_invalid', 'nope:unknown_key');
select v49_test.fails('X19 a bad year on the export', $q$select public.export_alumni_rows('{}', 1800)$q$, '22023', 'alumni_invalid', 'year:out_of_range');
reset role;

-- ================================================================= A. analytics
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select public.get_alumni_analytics('{"q":"v49","scope":"all"}') as an \gset
reset role;
select v49_test.superseded('A01 totals: 5 companies, all open, survival 100, 2 with a program, 2 reporting 2024', format($q$select concat_ws('|', (a->'totals'->>'companies'), (a->'totals'->>'open'), (a->'totals'->>'closed'), (a->'totals'->>'survival_rate'), (a->'totals'->>'with_program'), (a->'totals'->>'reporting_year'), (a->>'year')) from (select %L::jsonb a) x$q$, :'an'), '5|5|0|100.0|2|2|2024');
select v49_test.val('A02 totals of people (derived): 3 founders, 1 female (F2 by ID), 2 below 35 (F1, F2)', format($q$select concat_ws('|', (a->'totals'->>'founders'), (a->'totals'->>'female_founders'), (a->'totals'->>'founders_under_35')) from (select %L::jsonb a) x$q$, :'an'), '3|1|2');
select v49_test.superseded('A03 totals of metrics: 32 employees, 12 female, 3 freelancers, funding 100000, revenue 2024 760000', format($q$select concat_ws('|', (a->'totals'->>'employees'), (a->'totals'->>'female_employees'), (a->'totals'->>'freelancers'), (a->'totals'->>'funding_raised'), (a->'totals'->>'revenue')) from (select %L::jsonb a) x$q$, :'an'), '32|12|3|100000.00|760000.00');
select v49_test.val('A04 by CEO gender (from the ID): male 1, female 1, unknown 3', format($q$select (select string_agg(coalesce(e->>'key', 'null') || ':' || (e->>'count'), ',' order by coalesce(e->>'key', 'zzz')) from jsonb_array_elements(a->'by_ceo_gender') e) from (select %L::jsonb a) x$q$, :'an'), 'female:1,male:1,null:3');
select v49_test.val('A05 by CEO governorate of origin (from the ID): Cairo 1, Aswan 1', format($q$select (select string_agg(coalesce(e->>'key', 'null') || ':' || (e->>'count'), ',' order by coalesce(e->>'key', 'zzz')) from jsonb_array_elements(a->'by_ceo_governorate') e where e->>'key' is not null) from (select %L::jsonb a) x$q$, :'an'), '1:1,28:1');
select v49_test.superseded('A06 by year: 2024 has 2 reporting companies', format($q$select (a->'by_year'->0->>'year') || ':' || (a->'by_year'->0->>'companies_reporting') from (select %L::jsonb a) x$q$, :'an'), '2024:2');
select v49_test.val('A07 by program: the program counts its 2 participating companies (the withdrawn one is out)', format($q$select (a->'by_program'->0->>'program_name_en') || ':' || (a->'by_program'->0->>'count') from (select %L::jsonb a) x$q$, :'an'), 'V49 Program:2');
select v49_test.val('A08 by sector / stage / type use keys (the labels are the client lookup)', format($q$select (select string_agg(coalesce(e->>'key', 'null') || ':' || (e->>'count'), ',' order by coalesce(e->>'key', 'zzz')) from jsonb_array_elements(a->'by_sector') e) from (select %L::jsonb a) x$q$, :'an'), 'education:1,healthcare:1,technology:1,null:2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('A09 analytics are manager only (a founder)', $q$select public.get_alumni_analytics()$q$, '42501');
reset role;

-- ================================================================= I. invitations (the signup / invite pages)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'ZZ-V49-F2@Example.invalid', 'en', 'https://app.example.com') as inv1 \gset
select v49_test.val('I01 a founder invites a co-founder to HIS company: the token is returned once with the link, the e-mail is normalised', format($q$select (j->>'email') || '|' || (j->>'link' like 'https://app.example.com/invite/%%')::text || '|' || (char_length(j->>'token') >= 30)::text from (select %L::jsonb j) x$q$, :'inv1'), 'zz-v49-f2@example.invalid|true|true');
select v49_test.fails('I02 a founder cannot invite to a company that is not his', $q$select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c492', 'x@example.invalid')$q$, '42501');
select v49_test.fails('I03 inviting somebody who is already a member', $q$select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'zz-v49-f1@example.invalid')$q$, '22023', 'alumni_invalid', 'email:already_member');
select v49_test.fails('I04 a bad e-mail', $q$select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'not-an-email')$q$, '22023', 'alumni_invalid', 'email:bad_value');
select v49_test.val('I05 a founder lists the invitations of his companies; the row has NO token', $q$select (j->>'total') || '|' || (j->'rows'->0->>'status') || '|' || (j->'rows'->0 ? 'token')::text || '|' || (j::text like '%"token"%')::text from (select public.list_alumni_invitations() j) x$q$, '1|pending|false|false');
reset role;
select v49_test.val('I06 only the sha256 of the token is stored (the stored value is not the token)', format($q$select (select (i.token <> %L and i.token = encode(extensions.digest(%L, 'sha256'), 'hex'))::text from public.alumni_invitations i where i.id = (%L::jsonb->>'id')::uuid)$q$, (:'inv1'::jsonb)->>'token', (:'inv1'::jsonb)->>'token', :'inv1'), 'true');
select v49_test.val('I07 the EXISTING validate_invitation answers for that token (masked e-mail, company name) and accept still works for it', format($q$select (public.validate_invitation(%L)->>'valid') || '|' || (public.validate_invitation(%L)->>'masked_email')$q$, (:'inv1'::jsonb)->>'token', (:'inv1'::jsonb)->>'token'), 'true|z***@example.invalid');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'zz-v49-f2@example.invalid', 'ar') as inv2 \gset
select v49_test.val('I08 a second invitation to the same e-mail REVOKES the first (one pending per company and e-mail)', format($q$select (select i.status from public.alumni_invitations i where i.id = (%L::jsonb->>'id')::uuid) || '|' || (select i.status from public.alumni_invitations i where i.id = (%L::jsonb->>'id')::uuid)$q$, :'inv1', :'inv2'), 'revoked|pending');
select v49_test.val('I09 a manager lists them all (here: one pending left after the replacement)', $q$select (j->>'total')::int >= 1 from (select public.list_alumni_invitations('pending') j) x$q$, 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('I10 the invitee (F2, an existing founder account with that e-mail) ACCEPTS the invitation (the EXISTING accept_invitation RPC)', format($q$select public.accept_invitation(%L)->>'accepted'$q$, (:'inv2'::jsonb)->>'token'), 'true');
select v49_test.val('I10b ... he is linked to the company, NOT as its primary (an invited founder joins the existing company, decision C10)', $q$select cf.is_primary::text from public.company_founders cf where cf.company_id = '00000000-0000-4000-8000-00000000c491' and cf.founder_id = '00000000-0000-4000-8000-00000000f492'$q$, 'false');
select v49_test.val('I11 ... and his profile now lists both companies', $q$select jsonb_array_length(public.get_my_alumni_profile()->'companies')::text$q$, '2');
select v49_test.fails('I12 an ACCEPTED invitation can no longer be revoked (even by a member of the company)', format($q$select public.revoke_alumni_invitation((%L::jsonb->>'id')::uuid)$q$, :'inv2'), 'P0002');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'new-cofounder@example.invalid') as inv3 \gset
select v49_test.okrun('I13 a founder of the company revokes a pending invitation', format($q$select public.revoke_alumni_invitation((%L::jsonb->>'id')::uuid)$q$, :'inv3'));
select v49_test.fails('I14 a founder is limited to 20 invitations per day (rate limit)', $q$select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'bulk' || g || '@example.invalid') from generate_series(1, 25) g$q$, 'P0001', 'alumni_rate_limited');
reset role;

-- ================================================================= G. direct writes keep working for the PM side; the guards hold for everybody else
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e492","role":"authenticated"}', true);
set local role authenticated;
select v49_test.okrun('G01 COMPATIBILITY: a PM still creates a company directly (the Lists node path: name / industry / links only)', $q$insert into public.companies (name_en, industry_en, links, created_by) values ('V49 PM Created', 'Retail', '[{"kind":"facebook","url":"https://facebook.com/pm"}]', '00000000-0000-4000-8000-00000000e492')$q$);
select v49_test.fails('G02 ... but not as an alumni company', $q$insert into public.companies (name_en, is_alumni, created_by) values ('V49 PM Alumni', true, '00000000-0000-4000-8000-00000000e492')$q$, '42501');
select v49_test.fails('G03 a PM cannot write an invalid stage directly (the guard trigger is for every writer)', $q$insert into public.companies (name_en, stage, created_by) values ('V49 PM Bad', 'warp', '00000000-0000-4000-8000-00000000e492')$q$, '22023', 'alumni_invalid', 'stage:unknown');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('G04 a founder cannot change is_alumni of his company by a direct write (CO1 is alumni: he cannot un-mark it either)', $q$update public.companies set is_alumni = false where id = '00000000-0000-4000-8000-00000000c491'$q$, '42501');
select v49_test.fails('G05 a direct write with a sub sector of another sector is refused', $q$update public.companies set subsector_key = 'robotics', sector_key = 'healthcare' where id = '00000000-0000-4000-8000-00000000c491'$q$, '22023', 'alumni_invalid', 'subsector:parent_mismatch');
select v49_test.fails('G06 closing fields on an open company by a direct write: the CHECK', $q$update public.companies set closing_note = 'x' where id = '00000000-0000-4000-8000-00000000c491'$q$, '23514');
select v49_test.fails('G07 a founder cannot give away the company (created_by)', $q$update public.companies set created_by = '00000000-0000-4000-8000-00000000e494' where id = '00000000-0000-4000-8000-00000000c491'$q$, '42501');
reset role;

-- ================================================================= H. storage: a founder's logo and photo
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049a1.webp', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e493","role":"authenticated"}', true);
set local role authenticated;
select v49_test.okrun('H01 a founder uploads a company logo into HIS folder (WebP, the logo name pattern)', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049a2.webp', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}')$q$);
select v49_test.okrun('H02 ... and its _t.webp thumbnail', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049a2_t.webp', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}')$q$);
select v49_test.fails('H03 a founder cannot write into ANOTHER founder''s folder', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e494/logo/00000000-0000-4000-8000-0000000049a3.webp', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}')$q$, '42501');
select v49_test.fails('H04 a PNG is refused (universal WebP, m41)', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049a4.png', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}')$q$, '42501');
select v49_test.fails('H05 only the logo folder is open (alumni/<uid>/anything-else is refused)', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e493/docs/00000000-0000-4000-8000-0000000049a5.webp', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}')$q$, '42501');
select v49_test.val('H06 the company logo path must be in the caller''s own folder and the file must exist', $q$select (public.save_my_company_profile('00000000-0000-4000-8000-00000000c491', '{"logo_path":"alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049a1.webp"}'))->'company'->>'logo_path'$q$,
  'alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049a1.webp');
select v49_test.fails('H07 a logo path that does not exist', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c491', '{"logo_path":"alumni/00000000-0000-4000-8000-00000000e493/logo/00000000-0000-4000-8000-0000000049ff.webp"}')$q$, '22023', 'alumni_invalid', 'logo_path:file_missing');
select v49_test.fails('H08 a logo path in somebody else''s folder', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c491', '{"logo_path":"alumni/00000000-0000-4000-8000-00000000e494/logo/00000000-0000-4000-8000-0000000049a6.webp"}')$q$, '22023', 'alumni_invalid', 'logo_path:not_your_folder');
select v49_test.fails('H09 a malformed logo path', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c491', '{"logo_path":"../secret.webp"}')$q$, '22023', 'alumni_invalid', 'logo_path:bad_path');
select v49_test.okrun('H10 the founder photo (private bucket) goes to founders/<uid>/photo/ (existing policy) and is accepted as photo_path', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('founder-assets', 'founders/00000000-0000-4000-8000-00000000e493/photo/00000000-0000-4000-8000-0000000049b1.webp', '00000000-0000-4000-8000-00000000e493', '00000000-0000-4000-8000-00000000e493', '{"mimetype":"image/webp"}')$q$);
select v49_test.val('H11 photo_path saved', $q$select (public.save_my_founder_profile('{"photo_path":"founders/00000000-0000-4000-8000-00000000e493/photo/00000000-0000-4000-8000-0000000049b1.webp"}'))->'founder'->>'photo_path'$q$, 'founders/00000000-0000-4000-8000-00000000e493/photo/00000000-0000-4000-8000-0000000049b1.webp');
select v49_test.fails('H12 a photo path of another account''s folder', $q$select public.save_my_founder_profile('{"photo_path":"founders/00000000-0000-4000-8000-00000000e494/photo/00000000-0000-4000-8000-0000000049b2.webp"}')$q$, '22023', 'alumni_invalid', 'photo_path:not_your_folder');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e492","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('H13 a PM cannot write into the alumni logo folders', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e492/logo/00000000-0000-4000-8000-0000000049a7.webp', '00000000-0000-4000-8000-00000000e492', '00000000-0000-4000-8000-00000000e492', '{"mimetype":"image/webp"}')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.okrun('H14 a manager may write into any alumni logo folder', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e494/logo/00000000-0000-4000-8000-0000000049a8.webp', '00000000-0000-4000-8000-00000000e491', '00000000-0000-4000-8000-00000000e491', '{"mimetype":"image/webp"}')$q$);
reset role;

-- ================================================================= Z. more manager / edge cases
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('Z01 a MANAGER adds a team record WITH a national ID (born abroad, 1988): masked ID, governorate 88, counts follow (1 founder, none female, none below 35)', $q$select (t->>'id_masked') || '|' || (t->>'governorate') || '|' || (t->>'gender') || '|' || (r->'counts')::text
  from (select public.save_company_team_member('00000000-0000-4000-8000-00000000c493', null, '{"name_en":"Rami Legacy","national_id":"28802298811171","education_status":"graduate"}') r) x, lateral jsonb_array_elements(r->'team') t$q$,
  '**********1171|88|male|{"team_size": 1, "female_founders": 0, "founders_under_35": 0}');
select v49_test.fails('Z02 the same ID for another record is a conflict ERROR for a manager (no soft failure)', $q$select public.save_company_team_member('00000000-0000-4000-8000-00000000c493', null, '{"name_en":"Twin","national_id":"28802298811171"}')$q$, '23505', 'national_id_conflict');
select v49_test.fails('Z03 a manager save with a stale updated_at is refused too', $q$select public.save_alumni_company('00000000-0000-4000-8000-00000000c493', '{"description_en":"x"}', '2020-01-01T00:00:00+00'::timestamptz)$q$, 'P0001', 'alumni_stale');
select v49_test.superseded('Z04 deleting a year that has no row', $q$select public.delete_company_snapshot('00000000-0000-4000-8000-00000000c493', 1999)$q$, 'P0002', 'alumni_not_found');
select public.create_alumni_invitation('00000000-0000-4000-8000-00000000c491', 'expired-check@example.invalid', 'en', 'https://app.example.com') as inv_old \gset
reset role;
update public.alumni_invitations set sent_at = now() - interval '20 days' where id = (:'inv_old'::jsonb->>'id')::uuid;
select v49_test.val('Z05 an invitation older than 14 days is "expired" for the list and no longer validates (the existing validate_invitation)', format($q$select (public.validate_invitation(%L)->>'valid') || '|' || (select (i.status || '/' || case when i.status = 'pending' and i.sent_at + interval '14 days' <= now() then 'expired' else i.status end) from public.alumni_invitations i where i.id = (%L::jsonb->>'id')::uuid)$q$, (:'inv_old'::jsonb)->>'token', :'inv_old'), 'false|pending/expired');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('Z06 the manager list reports it as expired (effective status) and filters on it', $q$select (select count(*) from jsonb_array_elements((public.list_alumni_invitations('expired'))->'rows') r where r->>'email' = 'expired-check@example.invalid' and r->>'effective_status' = 'expired')::text$q$, '1');
select v49_test.val('Z07 a manager deactivates the stage "mvp" (a value in use)', $q$select (public.save_alumni_lookup('stage', 'mvp', '{"is_active":false}'))->>'active'$q$, 'false');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e495","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('Z08 a company that ALREADY holds the deactivated stage still saves other fields (an unchanged value is not re-validated)', format($q$select (public.save_my_company_profile('%s', '{"description_en":"still saves","stage":"mvp"}'))->'company'->>'stage'$q$, :'co4'), 'mvp');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('Z10 a founder of another company cannot choose the deactivated stage', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c492', '{"stage":"mvp"}')$q$, '22023', 'alumni_invalid', 'stage:unknown');
select v49_test.fails('Z11 a founder cannot set the CEO of a company that is not his (F2 is a member of CO1 since he accepted the invitation, CO3 is not his)', $q$select public.set_company_ceo('00000000-0000-4000-8000-00000000c493', '00000000-0000-4000-8000-00000000f491')$q$, '42501');
select v49_test.fails('Z12 a founder cannot remove a member of a company that is not his', $q$select public.remove_company_team_member('00000000-0000-4000-8000-00000000c493', '00000000-0000-4000-8000-00000000f491')$q$, '42501');
select v49_test.fails('Z12b ... nor a REGISTERED co-founder of his own company (F2 vs F1 in CO1)', $q$select public.remove_company_team_member('00000000-0000-4000-8000-00000000c491', '00000000-0000-4000-8000-00000000f491')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e492","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('Z13 a PM reads the member directory (audience member, only what founders made visible)', $q$select (j->>'audience') from (select public.list_alumni_directory('{"q":"v49"}') j) x$q$, 'member');
select v49_test.fails('Z14 ... and cannot use a manager filter', $q$select public.list_alumni_directory('{"incomplete":true}')$q$, '22023', 'alumni_invalid', 'incomplete:manager_only');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('Z15 analytics refuse an unknown filter', $q$select public.get_alumni_analytics('{"nope":1}')$q$, '22023', 'alumni_invalid', 'nope:unknown_key');
select v49_test.val('Z16 re-activating the stage', $q$select (public.save_alumni_lookup('stage', 'mvp', '{"is_active":true}'))->>'active'$q$, 'true');
select v49_test.val('Z16b ... the vocabulary shows it active again (a separate statement: one statement does not see its own writes)', $q$select (s->>'active') from jsonb_array_elements(public.list_alumni_lookups()->'stages') s where s->>'key' = 'mvp'$q$, 'true');
reset role;
select founder_id as rami from public.company_founders where company_id = '00000000-0000-4000-8000-00000000c493' limit 1 \gset
insert into public.company_founders (company_id, founder_id) values ('00000000-0000-4000-8000-00000000c492', :'rami');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e494","role":"authenticated"}', true);
set local role authenticated;
select v49_test.fails('Z17 a team RECORD that is also a member of another company is shared data: the lead founder of CO2 cannot edit it (only a manager)', format($q$select public.save_company_team_member('00000000-0000-4000-8000-00000000c492', '%s', '{"role":"changed"}')$q$, :'rami'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select v49_test.val('Z18 the invitations total is the number of matching rows even when the requested page is past the end', $q$select ((j->>'total')::int >= 1)::text || '|' || jsonb_array_length(j->'rows')::text from (select public.list_alumni_invitations(null, 5, 500) j) x$q$, 'true|0');
reset role;
reset role;

-- ================================================================= Q. merge_companies (m49 patch): yearly snapshots, internal notes and profile gaps survive
select v49_test.superseded('Q01 before the merge: CO1 has ONE 2024 snapshot (no freelancers / funding), the founder-created company has its own and a founder', format($q$select (select count(*) from public.company_snapshots where company_id = '00000000-0000-4000-8000-00000000c491')::text || '|' || (select count(*) from public.company_snapshots where company_id = '%s')::text || '|' ||
  (select count(*) from public.company_founders where company_id = '%s')::text$q$, :'co4', :'co4'), '1|1|1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e491","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company(:'co4'::uuid, '{"internal":{"hint":"merge me","directory_hidden":true}}') is not null as hinted \gset
select public.merge_companies('00000000-0000-4000-8000-00000000c491', :'co4') as merged \gset
reset role;
select v49_test.val('Q02 the merge ran: the dropped company is soft-deleted', format($q$select (deleted_at is not null)::text from public.companies where id = '%s'$q$, :'co4'), 'true');
select v49_test.superseded('Q03 ONE 2024 snapshot remains on the kept company: the kept values WIN (revenue 500000, employees 20), the gaps are filled from the dropped one (freelancers 3, funding 100000, traction)', $q$select concat_ws('|', count(*), max(revenue_total), max(employees_total), max(freelancers), max(funding_raised_total), max(traction)) from public.company_snapshots where company_id = '00000000-0000-4000-8000-00000000c491'$q$, '1|500000.00|20|3|100000.00|50 pilots');
select v49_test.val('Q04 no snapshot is left on the dropped company', format($q$select count(*)::text from public.company_snapshots where company_id = '%s'$q$, :'co4'), '0');
select v49_test.val('Q05 the manager notes: the kept hint wins, the dropped note is not copied over it, the veto (directory_hidden) is OR-ed, the dropped row is gone', format($q$select (select hint from public.company_internal where company_id = '00000000-0000-4000-8000-00000000c491') || '|' || (select directory_hidden::text from public.company_internal where company_id = '00000000-0000-4000-8000-00000000c491') || '|' ||
  (select count(*) from public.company_internal where company_id = '%s')::text$q$, :'co4'), 'Strong team; follow up in Q1|true|0');
select v49_test.val('Q06 the founders moved: the kept company now has F1, F2 (accepted invitation) and F3', $q$select count(*)::text from public.company_founders where company_id = '00000000-0000-4000-8000-00000000c491'$q$, '3');
select v49_test.val('Q07 the profile gaps of the kept company were filled from the dropped one only where empty (legal status / sector stay CO1''s)', $q$select concat_ws('|', sector_key, subsector_key, legal_status_key, stage, is_alumni::text) from public.companies where id = '00000000-0000-4000-8000-00000000c491'$q$, 'technology|robotics|llc|scaling|true');

-- ================================================================= B. the backfill of the MIGRATED companies (hermetic: rows created before stage 2a finished)
select v49_test.val('B01 every migrated company whose governorate text is recognised has its governorate_code (and no code was invented for the rest)', $q$select count(*)::text from public.companies c where c.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')
  and ((c.governorate_code is null and coalesce(app_private.eg_governorate_from_text(c.governorate_en), app_private.eg_governorate_from_text(c.governorate_ar), app_private.eg_governorate_from_text(c.location_en), app_private.eg_governorate_from_text(c.location_ar)) is not null)
    or (c.governorate_code is not null and coalesce(c.governorate_en, c.governorate_ar, c.location_en, c.location_ar) is null))$q$, '0');
select v49_test.val('B02 every migrated company whose industry text is recognised has its sector_key', $q$select count(*)::text from public.companies c where c.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')
  and c.sector_key is null and app_private.alumni_sector_from_text(coalesce(c.industry_en, c.industry_ar)) is not null$q$, '0');
select v49_test.val('B03 nothing was overwritten: the legacy text columns of the migrated companies are unchanged (no company lost its industry / governorate text)', $q$select count(*)::text from public.companies c where c.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')
  and ((c.sector_key is not null and c.industry_en is null and c.industry_ar is null) or (c.governorate_code is not null and c.governorate_en is null and c.governorate_ar is null and c.location_en is null and c.location_ar is null))$q$, '0');
select v49_test.val('B05 the new columns default safely: every migrated company is open, private and not alumni', $q$select count(*)::text from public.companies c where c.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')
  and (c.operating_status <> 'open' or c.directory_visibility <> 'private' or c.is_alumni)$q$, '0');

-- ================================================================= final state check
select current_setting('v49.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v49: alumni profile model tests FAILED'; end $$;
\endif
