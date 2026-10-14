-- v52_review_fixes  (m52: the database findings of the independent review of m44 / m45 / m49 / m50 / m51)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
--
-- Fixture (ids ...00000000e52x / c52x / f52x):
--   ADM = super_admin, AM = alumni_manager, PM = project_manager (member of program A only), F1 / F2 = founders (account + founders row + company CO1 / CO2), CO3 = a company with no founder record
--   program A with project JA, program B with project JB
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute crashes this local Postgres image,
-- m42 / m43 gotcha): helpers are called as the owner, denials are asserted with has_function_privilege / has_column_privilege.
-- The one check that reads REAL data is C07 (no ID-shaped number outside founder_identities, before any fixture exists): a failure there means a person typed or pasted an ID somewhere; inspect with
--   select * from app_private.scan_id_shaped_values();
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v52.res', '', false) \gset

begin;
create schema v52_test;
grant usage on schema v52_test to public;
create or replace function v52_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v52.res', current_setting('v52.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v52_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v52_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v52_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v52_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v52_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v52_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v52_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v52_test.t(p_key, true, 'ok');
  exception when others then
    perform v52_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
create or replace function v52_test.cell(j jsonb, p_name text, p_header text) returns text language sql immutable as $$
  select r->>(c.ord::int - 1) from jsonb_array_elements(j->'rows') r,
         (select (x->>'header') as h, ord from jsonb_array_elements(j->'columns') with ordinality t(x, ord)) c
   where c.h = p_header and r->>0 = p_name limit 1
$$;
revoke all on all functions in schema v52_test from public;
grant execute on all functions in schema v52_test to anon, authenticated, service_role;

-- ================================================================= C. catalog (as postgres)
select v52_test.val('C01 NO function of public / app_private raises SQLSTATE 40001 or 40P01 (PostgREST 14 retries those for ever: a stale save made the request spin and pinned a connection)', $q$select count(*)::text from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ~* 'errcode\s*=\s*''(40001|40P01)'''$q$, '0');
select v52_test.val('C02 save_node raises the revision conflict as P0001 with the hint token', $q$select (p.prosrc like '%revision_conflict: current rev%errcode = ''P0001'', hint = ''revision_conflict'', detail%')::text from pg_proc p where p.oid = 'public.save_node(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure$q$, 'true');
select v52_test.val('C03 the seven functions that take or return a national ID all refuse GET / HEAD, and all are VOLATILE', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('preview_national_id', 'import_alumni_preview', 'save_my_founder_profile', 'save_company_team_member', 'save_alumni_founder', 'get_alumni_founder', 'export_alumni_rows')
  and p.prosrc like '%app_private.alumni_post_only()%' and p.provolatile = 'v'$q$, '7');
select v52_test.val('C04 every helper of m52 is closed to every API role', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('alumni_post_only', 'alumni_check_len', 'alumni_check_url', 'alumni_check_links', 'companies_write_guard', 'companies_sync_mirrors', 'redact_ids_text', 'redact_ids_json', 'json_scan_text', 'scan_id_shaped_values')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v52_test.val('C05 founders: no client INSERT / UPDATE at all (every writer is a definer RPC or trigger); the manager DELETE stays', $q$select concat_ws('|', has_table_privilege('authenticated', 'public.founders', 'INSERT')::text, has_table_privilege('authenticated', 'public.founders', 'UPDATE')::text,
  has_column_privilege('authenticated', 'public.founders', 'phone', 'UPDATE')::text, has_column_privilege('authenticated', 'public.founders', 'deleted_at', 'UPDATE')::text, has_table_privilege('authenticated', 'public.founders', 'DELETE')::text)$q$, 'false|false|false|false|true');
select v52_test.val('C06 companies: id / created_at / deleted_at / name_key are not client-writable, created_by + origin_project_id are insert-only, the Lists node columns are', $q$select concat_ws('|',
  (select count(*) from unnest(array['id', 'created_at', 'deleted_at', 'name_key']) c where has_column_privilege('authenticated', 'public.companies', c, 'UPDATE') or has_column_privilege('authenticated', 'public.companies', c, 'INSERT'))::text,
  has_column_privilege('authenticated', 'public.companies', 'created_by', 'UPDATE')::text, has_column_privilege('authenticated', 'public.companies', 'origin_project_id', 'UPDATE')::text,
  has_column_privilege('authenticated', 'public.companies', 'created_by', 'INSERT')::text, has_column_privilege('authenticated', 'public.companies', 'origin_project_id', 'INSERT')::text,
  has_column_privilege('authenticated', 'public.companies', 'name_en', 'INSERT')::text, has_column_privilege('authenticated', 'public.companies', 'links', 'UPDATE')::text,
  has_table_privilege('authenticated', 'public.companies', 'UPDATE')::text)$q$, '0|false|false|true|true|true|true|false');
select v52_test.val('C07 NO national-ID-shaped number is stored outside founder_identities (every text / jsonb column of public, REAL data, before any fixture)', $q$select count(*)::text from app_private.scan_id_shaped_values()$q$, '0');
select v52_test.val('C08 the three companies triggers exist', $q$select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t where t.tgrelid = 'public.companies'::regclass and not t.tgisinternal and t.tgname in ('companies_biu_write_guard', 'companies_biu_mirror', 'companies_bu_alumni_guard')$q$, 'companies_biu_mirror,companies_biu_write_guard,companies_bu_alumni_guard');

-- ================================================================= R. redaction unit tests (as postgres)
select v52_test.val('R01 a standalone 14-digit number starting with 2 / 3 is redacted, the text around it is kept', $q$select app_private.redact_ids_text('id: 29501010101234, again 30303152804527.')$q$, 'id: [ID removed], again [ID removed].');
select v52_test.val('R02 not an ID: 13 digits, 15 digits, starting with 1, glued to a letter (a hash)', $q$select app_private.redact_ids_text('2950101010123 | 295010101012345 | 19501010101234 | a29501010101234 | 29501010101234b')$q$, '2950101010123 | 295010101012345 | 19501010101234 | a29501010101234 | 29501010101234b');
select v52_test.val('R03 Arabic text around the number does not hide it', $q$select app_private.redact_ids_text('رقمي القومي:29501010101234.')$q$, 'رقمي القومي:[ID removed].');
select v52_test.val('R04 json: strings at any depth, a number leaf, arrays keep their order, the rest is unchanged', $q$select app_private.redact_ids_json('{"a":["x 30303152804527", 29501010101234, 5, {"b":"ok", "c":null}], "d":true}'::jsonb)::text$q$, '{"a": ["x [ID removed]", null, 5, {"b": "ok", "c": null}], "d": true}');
select v52_test.val('R05 the scan text turns jsonb escapes into spaces (an ID right after a line break stays visible to the scan)', $q$select (app_private.json_scan_text(jsonb_build_object('a', E'Timestamp\n29501010101234\nnext')) ~ '(^|[^0-9A-Za-z])[23][0-9]{13}([^0-9A-Za-z]|$)')::text$q$, 'true');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e520','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v52-adm@example.invalid','{"provisioned":true}','{"full_name":"V52 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e521','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v52-am@example.invalid','{"provisioned":true}','{"full_name":"V52 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e522','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v52-pm@example.invalid','{"provisioned":true}','{"full_name":"V52 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e523','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v52-f1@example.invalid','{"provisioned":true}','{"full_name":"V52 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e524','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v52-f2@example.invalid','{"provisioned":true}','{"full_name":"V52 Founder Two"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e520','super_admin'), ('00000000-0000-4000-8000-00000000e521','alumni_manager'), ('00000000-0000-4000-8000-00000000e522','project_manager'),
  ('00000000-0000-4000-8000-00000000e523','founder'), ('00000000-0000-4000-8000-00000000e524','founder');
insert into public.companies (id, name_en, name_ar, created_by) values
  ('00000000-0000-4000-8000-00000000c521', 'V52 Nile Co', 'نيل V52', '00000000-0000-4000-8000-00000000e523'),
  ('00000000-0000-4000-8000-00000000c522', 'V52 Delta Co', null, '00000000-0000-4000-8000-00000000e524'),
  ('00000000-0000-4000-8000-00000000c523', 'V52 No Team Co', null, null);
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f521', 'V52 One', 'واحد', 'zz-v52-f1@example.invalid', '00000000-0000-4000-8000-00000000e523'),
  ('00000000-0000-4000-8000-00000000f522', 'V52 Two', 'اثنان', 'zz-v52-f2@example.invalid', '00000000-0000-4000-8000-00000000e524');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c521', '00000000-0000-4000-8000-00000000f521', true),
  ('00000000-0000-4000-8000-00000000c522', '00000000-0000-4000-8000-00000000f522', true);
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('public-assets', 'alumni/00000000-0000-4000-8000-00000000e523/logo/00000000-0000-4000-8000-0000000052a1.webp', '00000000-0000-4000-8000-00000000e523', '00000000-0000-4000-8000-00000000e523', '{"mimetype":"image/webp"}'),
  ('public-assets', 'global/company-logo/00000000-0000-4000-8000-0000000052a2.svg', null, null, '{"mimetype":"image/svg+xml"}'),
  ('public-assets', 'global/company-logo/00000000-0000-4000-8000-0000000052a3.webp', null, null, '{"mimetype":"image/webp"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e520","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V52 Program A', null, null, null, null, null)).id as prog_a \gset
select (public.create_program('V52 Program B', null, null, null, null, null)).id as prog_b \gset
select (public.create_project(:'prog_a', 'V52 Project A', null, 'Africa/Cairo')).id as ja \gset
select (public.create_project(:'prog_b', 'V52 Project B', null, 'Africa/Cairo')).id as jb \gset
select (public.add_node(:'ja', 'agenda', '{"en":"V52 Agenda"}', 0, 0, '{}')).id as nd \gset
reset role;
insert into public.program_members (program_id, user_id) values (:'prog_a', '00000000-0000-4000-8000-00000000e522') on conflict do nothing;

-- ================================================================= N. the node revision conflict (PM of program A)
select (select r.rev from public.node_revisions r where r.node_id = :'nd') as rev_now \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e522","role":"authenticated"}', true);
set local role authenticated;
select v52_test.fails('N01 a stale save_node is a normal refusal: P0001 + hint revision_conflict + detail = the current revision (never 40001: PostgREST would retry for ever)', format($q$select public.save_node('%s', %s, '{"name_en":"stale"}')$q$, :'nd', :'rev_now'::int + 5), 'P0001', 'revision_conflict', :'rev_now');
select v52_test.okrun('N02 the same save with the current revision goes through', format($q$select public.save_node('%s', %s, '{"name_en":"fresh"}')$q$, :'nd', :'rev_now'));
reset role;

-- ================================================================= G. a national ID never travels in a URL (GET / HEAD refused inside the function)
select set_config('request.method', 'GET', true);
select v52_test.fails('G01 preview_national_id refuses GET (PT405 = HTTP 405)', $q$select public.preview_national_id('29501010101234')$q$, 'PT405', 'post_only');
select v52_test.fails('G02 import_alumni_preview refuses GET', $q$select public.import_alumni_preview('[]'::jsonb)$q$, 'PT405', 'post_only');
select v52_test.fails('G03 save_my_founder_profile refuses GET', $q$select public.save_my_founder_profile('{}'::jsonb)$q$, 'PT405', 'post_only');
select v52_test.fails('G04 save_company_team_member refuses GET', $q$select public.save_company_team_member('00000000-0000-4000-8000-00000000c521', null, '{}'::jsonb)$q$, 'PT405', 'post_only');
select v52_test.fails('G05 save_alumni_founder refuses GET', $q$select public.save_alumni_founder('00000000-0000-4000-8000-00000000f521', '{}'::jsonb)$q$, 'PT405', 'post_only');
select v52_test.fails('G06 get_alumni_founder (the audited reveal) refuses GET', $q$select public.get_alumni_founder('00000000-0000-4000-8000-00000000f521', true)$q$, 'PT405', 'post_only');
select v52_test.fails('G07 export_alumni_rows refuses GET', $q$select public.export_alumni_rows('{}'::jsonb)$q$, 'PT405', 'post_only');
select set_config('request.method', 'HEAD', true);
select v52_test.fails('G08 ... and HEAD', $q$select public.preview_national_id('29501010101234')$q$, 'PT405', 'post_only');
select set_config('request.method', 'POST', true);
select set_config('request.jwt.claims', '', true);
select v52_test.fails('G09 a POST passes the guard (and meets the next rule: not authenticated)', $q$select public.preview_national_id('29501010101234')$q$, '42501');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e523","role":"authenticated"}', true);
set local role authenticated;
select v52_test.val('G10 as a signed-in founder a POST derives from the ID (the same SQL as before)', $q$select (public.preview_national_id('29501010101234')->>'valid')$q$, 'true');
select set_config('request.method', 'GET', true);
select v52_test.fails('G11 ... and the same call as a GET is refused', $q$select public.preview_national_id('29501010101234')$q$, 'PT405', 'post_only');
reset role;
select set_config('request.method', '', true);
select v52_test.okrun('G12 with no request.method (a migration / a test session) the guard passes', $q$select app_private.alumni_post_only()$q$);

-- ================================================================= W. F1 (a founder) writes his company directly: the RPC checks apply, the protected columns are closed
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e523","role":"authenticated"}', true);
set local role authenticated;
select v52_test.fails('W01 website_url javascript: is refused', $q$update public.companies set website_url = 'javascript:alert(document.domain)' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'website_url:bad_url');
select v52_test.fails('W02 linkedin_url javascript: is refused', $q$update public.companies set linkedin_url = 'javascript:alert(1)' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'linkedin_url:bad_url');
select v52_test.fails('W03 a links entry with a javascript: url is refused', $q$update public.companies set links = '[{"kind":"facebook","url":"javascript:alert(1)"}]' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'links:bad_url');
select v52_test.fails('W04 links that are not an array are refused', $q$update public.companies set links = '{"url":"https://x.example"}' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'links:bad_value');
select v52_test.fails('W05 a logo of ANOTHER founder''s folder is refused (even if it exists)', $q$update public.companies set logo_path = 'alumni/00000000-0000-4000-8000-00000000e524/logo/00000000-0000-4000-8000-0000000052a9.webp' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'logo_path:not_your_folder');
select v52_test.fails('W06 a logo that points at ANY other object of public-assets is refused (shape)', $q$update public.companies set logo_path = 'global/company-logo/00000000-0000-4000-8000-0000000052a3.webp' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'logo_path:bad_path');
select v52_test.fails('W07 a logo in his own folder whose file does not exist is refused', $q$update public.companies set logo_path = 'alumni/00000000-0000-4000-8000-00000000e523/logo/00000000-0000-4000-8000-0000000052a8.webp' where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'logo_path:file_missing');
select v52_test.okrun('W08 a logo in his own folder that exists is accepted', $q$update public.companies set logo_path = 'alumni/00000000-0000-4000-8000-00000000e523/logo/00000000-0000-4000-8000-0000000052a1.webp' where id = '00000000-0000-4000-8000-00000000c521'$q$);
select v52_test.fails('W09 he cannot soft-delete his company (deleted_at: no column privilege)', $q$update public.companies set deleted_at = now() where id = '00000000-0000-4000-8000-00000000c521'$q$, '42501');
select v52_test.fails('W10 he cannot change id', $q$update public.companies set id = '00000000-0000-4000-8000-00000000c529' where id = '00000000-0000-4000-8000-00000000c521'$q$, '42501');
select v52_test.fails('W11 he cannot change created_at', $q$update public.companies set created_at = now() - interval '5 years' where id = '00000000-0000-4000-8000-00000000c521'$q$, '42501');
select v52_test.fails('W12 he cannot give away the company (created_by)', $q$update public.companies set created_by = '00000000-0000-4000-8000-00000000e524' where id = '00000000-0000-4000-8000-00000000c521'$q$, '42501');
select v52_test.fails('W13 he cannot re-point the origin project', format($q$update public.companies set origin_project_id = '%s' where id = '00000000-0000-4000-8000-00000000c521'$q$, :'ja'), '42501');
select v52_test.fails('W14 an over-long description is refused (4001 characters)', $q$update public.companies set description_en = repeat('x', 4001) where id = '00000000-0000-4000-8000-00000000c521'$q$, '22023', 'alumni_invalid', 'description_en:too_long');
select v52_test.okrun('W15 a normal direct edit still works', $q$update public.companies set description_en = 'fresh description', website_url = 'https://nile.example', links = '[{"kind":"facebook","url":"https://facebook.com/nile"}]' where id = '00000000-0000-4000-8000-00000000c521'$q$);
select v52_test.fails('W16 a second company with an existing name (any case) is refused on INSERT', $q$insert into public.companies (name_en, created_by) values ('  v52 DELTA co ', '00000000-0000-4000-8000-00000000e523')$q$, '23505', 'alumni_company_exists');
select v52_test.fails('W17 renaming his company to a name that exists is refused', $q$update public.companies set name_en = 'V52 Delta Co' where id = '00000000-0000-4000-8000-00000000c521'$q$, '23505', 'alumni_company_exists');
select v52_test.fails('W18 a founder records no origin project on a new company', format($q$insert into public.companies (name_en, created_by, origin_project_id) values ('V52 Origin Try', '00000000-0000-4000-8000-00000000e523', '%s')$q$, :'ja'), '42501');
select v52_test.okrun('W19 a unique new name is accepted', $q$insert into public.companies (name_en, created_by) values ('V52 Brand New', '00000000-0000-4000-8000-00000000e523')$q$);
select v52_test.fails('W20 founders: a direct UPDATE of the phone is refused (no privilege)', $q$update public.founders set phone = 'not a phone' where auth_user_id = '00000000-0000-4000-8000-00000000e523'$q$, '42501');
select v52_test.fails('W21 founders: javascript: in linkedin_url is refused', $q$update public.founders set linkedin_url = 'javascript:alert(1)' where auth_user_id = '00000000-0000-4000-8000-00000000e523'$q$, '42501');
select v52_test.fails('W22 founders: a photo_path of another folder is refused', $q$update public.founders set photo_path = 'founders/00000000-0000-4000-8000-00000000e524/photo/00000000-0000-4000-8000-0000000052b1.webp' where auth_user_id = '00000000-0000-4000-8000-00000000e523'$q$, '42501');
select v52_test.fails('W23 founders: he cannot soft-delete himself', $q$update public.founders set deleted_at = now() where auth_user_id = '00000000-0000-4000-8000-00000000e523'$q$, '42501');
select v52_test.fails('W24 founders: a direct INSERT is refused', $q$insert into public.founders (name_ar) values ('x')$q$, '42501');
-- the RPC paths are unchanged (definer functions write what the client may not)
select v52_test.okrun('W25 save_my_company_profile still works', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c521', '{"description_en":"via the rpc"}', null)$q$);
select v52_test.okrun('W26 save_my_founder_profile still works (writes founders as a definer)', $q$select public.save_my_founder_profile('{"phone":"01012345678"}'::jsonb)$q$);
select v52_test.val('W27 ... and the phone is stored in E.164', $q$select phone from public.founders where auth_user_id = '00000000-0000-4000-8000-00000000e523'$q$, '+201012345678');
reset role;

-- ================================================================= P. a PM keeps the Lists node path (insert: name / industry / links / created_by / origin project) with the same value checks
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e522","role":"authenticated"}', true);
set local role authenticated;
select v52_test.okrun('P01 a PM creates a company the legacy way (legacy {type,label,url} links, industry text, the project he manages)', format($q$insert into public.companies (name_en, industry_en, links, created_by, origin_project_id) values ('V52 PM Legacy', 'Retail', '[{"type":"globe","label":"Website","url":"https://pm.example"}]', '00000000-0000-4000-8000-00000000e522', '%s')$q$, :'ja'));
select v52_test.fails('P02 ... but not with a javascript: website', $q$insert into public.companies (name_en, website_url, created_by) values ('V52 PM Bad Url', 'javascript:alert(1)', '00000000-0000-4000-8000-00000000e522')$q$, '22023', 'alumni_invalid', 'website_url:bad_url');
select v52_test.fails('P03 ... nor with the origin project of a program he is not a member of', format($q$insert into public.companies (name_en, created_by, origin_project_id) values ('V52 PM Other Project', '00000000-0000-4000-8000-00000000e522', '%s')$q$, :'jb'), '42501');
select v52_test.okrun('P04 a PM may use an SVG logo of the global folder (logos only) that exists', $q$insert into public.companies (name_en, logo_path, created_by) values ('V52 PM Svg Logo', 'global/company-logo/00000000-0000-4000-8000-0000000052a2.svg', '00000000-0000-4000-8000-00000000e522')$q$);
select v52_test.fails('P05 ... but not a PNG name', $q$insert into public.companies (name_en, logo_path, created_by) values ('V52 PM Png Logo', 'global/company-logo/00000000-0000-4000-8000-0000000052a4.png', '00000000-0000-4000-8000-00000000e522')$q$, '22023', 'alumni_invalid', 'logo_path:bad_path');
select v52_test.okrun('P06 a PM may still create a company whose name exists (the duplicate-then-merge workflow of the Athar team; only a FOUNDER is refused)', $q$insert into public.companies (name_en, created_by) values ('V52 Nile Co', '00000000-0000-4000-8000-00000000e522')$q$);
select v52_test.val('P07 a PM updates no company (RLS: 0 rows)', $q$with u as (update public.companies set description_en = 'x' where id = '00000000-0000-4000-8000-00000000c521' returning 1) select count(*)::text from u$q$, '0');
reset role;

-- ================================================================= M. an alumni manager: trusted values, but the audit columns stay closed
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e521","role":"authenticated"}', true);
set local role authenticated;
select v52_test.okrun('M01 a manager may write a legacy value directly (a merge copies those; no re-validation)', $q$update public.companies set website_url = 'www.legacy.example' where id = '00000000-0000-4000-8000-00000000c523'$q$);
select v52_test.fails('M02 ... but deleted_at is not client-writable even for him (merge_companies / the RPCs are the path)', $q$update public.companies set deleted_at = now() where id = '00000000-0000-4000-8000-00000000c523'$q$, '42501');
reset role;

-- ================================================================= R2. the legacy mirrors follow the typed keys for every writer (as postgres)
select v52_test.okrun('R10 a sector key fills industry_en / industry_ar from the vocabulary', $q$update public.companies set sector_key = 'technology' where id = '00000000-0000-4000-8000-00000000c522'$q$);
select v52_test.val('R11 ... exactly the labels', $q$select (c.industry_en = l.label_en and c.industry_ar = l.label_ar)::text from public.companies c join public.alumni_lookups l on l.kind = 'sector' and l.key = c.sector_key where c.id = '00000000-0000-4000-8000-00000000c522'$q$, 'true');
select v52_test.okrun('R12 a direct edit of the mirror text while the key is set is put back (the key wins)', $q$update public.companies set industry_en = 'Hacked text' where id = '00000000-0000-4000-8000-00000000c522'$q$);
select v52_test.val('R13 ... so the two can never disagree', $q$select (c.industry_en = l.label_en)::text from public.companies c join public.alumni_lookups l on l.kind = 'sector' and l.key = c.sector_key where c.id = '00000000-0000-4000-8000-00000000c522'$q$, 'true');
select v52_test.okrun('R14 a governorate code fills the legacy names', $q$update public.companies set governorate_code = 1 where id = '00000000-0000-4000-8000-00000000c522'$q$);
select v52_test.val('R15 ... Cairo in both languages', $q$select (governorate_en = app_private.eg_governorate_name(1, 'en') and governorate_ar = app_private.eg_governorate_name(1, 'ar') and governorate_en is not null)::text from public.companies where id = '00000000-0000-4000-8000-00000000c522'$q$, 'true');
select v52_test.okrun('R16 established_on fills founding_year, and a direct founding_year edit is put back', $q$update public.companies set established_on = date '2019-05-01', founding_year = 1999 where id = '00000000-0000-4000-8000-00000000c522'$q$);
select v52_test.val('R17 ... 2019', $q$select founding_year::text from public.companies where id = '00000000-0000-4000-8000-00000000c522'$q$, '2019');
select v52_test.okrun('R18 clearing the keys clears their mirrors (what the RPC always did)', $q$update public.companies set sector_key = null, subsector_key = null, governorate_code = null, established_on = null where id = '00000000-0000-4000-8000-00000000c522'$q$);
select v52_test.val('R19 ... industry, governorate and year are empty', $q$select concat_ws('|', coalesce(industry_en, 'N'), coalesce(industry_ar, 'N'), coalesce(governorate_en, 'N'), coalesce(founding_year::text, 'N')) from public.companies where id = '00000000-0000-4000-8000-00000000c522'$q$, 'N|N|N|N');
select v52_test.okrun('R20 with NO key the legacy text stays free (the Lists node path inserts text only)', $q$update public.companies set industry_en = 'Free text', governorate_en = 'Somewhere' where id = '00000000-0000-4000-8000-00000000c522'$q$);
select v52_test.val('R21 ... and it is kept', $q$select industry_en || '|' || governorate_en from public.companies where id = '00000000-0000-4000-8000-00000000c522'$q$, 'Free text|Somewhere');
-- merge_companies copies the dropped company's keys into the kept one: the mirror follows
insert into public.companies (id, name_en, sector_key, governorate_code) values ('00000000-0000-4000-8000-00000000c524', 'V52 Merge Drop', 'technology', 1);
insert into public.companies (id, name_en) values ('00000000-0000-4000-8000-00000000c525', 'V52 Merge Keep');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e521","role":"authenticated"}', true);
set local role authenticated;
select v52_test.okrun('R22 a manager merges the two', $q$select public.merge_companies('00000000-0000-4000-8000-00000000c525', '00000000-0000-4000-8000-00000000c524')$q$);
reset role;
select v52_test.val('R23 the kept company got the keys AND their mirrors', $q$select concat_ws('|', (c.sector_key = 'technology')::text, (c.industry_en = l.label_en)::text, (c.governorate_en = app_private.eg_governorate_name(1, 'en'))::text) from public.companies c
  left join public.alumni_lookups l on l.kind = 'sector' and l.key = 'technology' where c.id = '00000000-0000-4000-8000-00000000c525'$q$, 'true|true|true');

-- ================================================================= T. unknown is not zero (the manager reads company c523 with no founder record, c521 with one founder)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e521","role":"authenticated"}', true);
set local role authenticated;
select v52_test.val('T01 a company with NO founder record: the three counts are unknown (null), not 0', $q$select (public.get_alumni_company('00000000-0000-4000-8000-00000000c523')->'counts')::text$q$, '{"team_size": null, "female_founders": null, "founders_under_35": null}');
select v52_test.val('T02 one founder, no ID and no self-declared values: size 1, the other two are unknown', $q$select (public.get_alumni_company('00000000-0000-4000-8000-00000000c521')->'counts')::text$q$, '{"team_size": 1, "female_founders": null, "founders_under_35": null}');
reset role;
insert into public.founder_identities (founder_id, national_id) values ('00000000-0000-4000-8000-00000000f521', '29501010101234');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e521","role":"authenticated"}', true);
set local role authenticated;
select v52_test.val('T03 once his ID is known (a man born 1995): size 1, female 0, below 35 = 1', $q$select (public.get_alumni_company('00000000-0000-4000-8000-00000000c521')->'counts')::text$q$, '{"team_size": 1, "female_founders": 0, "founders_under_35": 1}');
select public.export_alumni_rows('{"q":"V52","scope":"all"}') as exp \gset
reset role;
select v52_test.val('T04 the export: a company with no founder record has BLANK team cells (3 of them)', format($q$select concat_ws('|', coalesce(v52_test.cell(%L::jsonb, 'V52 No Team Co', 'Founding team size'), 'blank'), coalesce(v52_test.cell(%L::jsonb, 'V52 No Team Co', 'Female founders'), 'blank'),
  coalesce(v52_test.cell(%L::jsonb, 'V52 No Team Co', 'Nu. of founders below 35'), 'blank'))$q$, :'exp', :'exp', :'exp'), 'blank|blank|blank');
select v52_test.val('T05 ... and the one with a known founder shows 1 / 0 / 1', format($q$select concat_ws('|', v52_test.cell(%L::jsonb, 'V52 Nile Co', 'Founding team size'), v52_test.cell(%L::jsonb, 'V52 Nile Co', 'Female founders'), v52_test.cell(%L::jsonb, 'V52 Nile Co', 'Nu. of founders below 35'))$q$, :'exp', :'exp', :'exp'), '1|0|1');

-- ================================================================= D. the scan finds an ID in text and in jsonb (a fixture row each), and the redaction removes it again
insert into public.company_internal (company_id, hint) values ('00000000-0000-4000-8000-00000000c523', 'call 29501010101234 now');
insert into public.notifications (recipient_id, title, body, metadata) values ('00000000-0000-4000-8000-00000000e523', 'x', 'y', jsonb_build_object('note', E'ID?\n30303152804527\nthanks'));
select v52_test.val('D01 the proof query finds both the text column and the jsonb column (with a line break before the number)', $q$select string_agg(table_name || '.' || column_name || '=' || hits, ',' order by table_name, column_name) from app_private.scan_id_shaped_values()$q$, 'company_internal.hint=1,notifications.metadata=1');
update public.notifications set metadata = app_private.redact_ids_json(metadata) where recipient_id = '00000000-0000-4000-8000-00000000e523';
update public.company_internal set hint = app_private.redact_ids_text(hint) where company_id = '00000000-0000-4000-8000-00000000c523';
select v52_test.val('D02 after the redaction the scan is empty again', $q$select count(*)::text from app_private.scan_id_shaped_values()$q$, '0');
select v52_test.val('D03 the redacted text keeps the rest of the message', $q$select replace((select metadata->>'note' from public.notifications where recipient_id = '00000000-0000-4000-8000-00000000e523'), chr(10), '/') || '|' || (select hint from public.company_internal where company_id = '00000000-0000-4000-8000-00000000c523')$q$, 'ID?/[ID removed]/thanks|call [ID removed] now');

-- ================================================================= final state check
select current_setting('v52.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v52: review fixes tests FAILED'; end $$;
\endif
