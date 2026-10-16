-- v64_review_fixes  (m64: the database findings of the independent review of m60 / m62: national IDs in the immutable log, the audit bypass, no-op stamps, the NULL guard, the team removal order)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e64x users / c64x companies / f64x founders):  ADM = super_admin (e640), AM = alumni_manager (e641), F1 = founder of CO1 (e643); CO1 Nile (F1), CO2 Other (nobody)
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute crashes this local Postgres image):
-- helpers are called as the owner, denials are asserted with has_function_privilege / has_column_privilege.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v64.res', '', false) \gset

begin;
create schema v64_test;
grant usage on schema v64_test to public;
create or replace function v64_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v64.res', current_setting('v64.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v64_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v64_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v64_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
-- m65 removed the audit log: a check that encoded it (the log, its masking of IDs, the replay) is recorded as 'superseded' (not run). The log cannot hold an ID any more because it does not exist (v65);
-- the ID redaction functions themselves (R tests) stay and run.
create or replace function v64_test.superseded(p_key text) returns void language plpgsql as $$
begin
  perform v64_test.t(p_key, true, 'superseded by m65 (owner decision 21: the audit log is gone)');
end $$;
create or replace function v64_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v64_test.t(p_key, true, 'ok');
  exception when others then
    perform v64_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- the old time: a definer helper writes a stamp without moving it (the touch trigger is off for that one statement)
create or replace function v64_test.age(p_table text, p_id uuid, p_to timestamptz) returns void language plpgsql security definer as $$
begin
  execute format('alter table public.%I disable trigger user', p_table);
  execute format('update public.%I set updated_at = %L, updated_by = null, updated_source = null where %s = %L', p_table, p_to, case when p_table = 'company_founders' then 'founder_id' else 'id' end, p_id);
  execute format('alter table public.%I enable trigger user', p_table);
end $$;
revoke all on all functions in schema v64_test from public;
grant execute on all functions in schema v64_test to anon, authenticated, service_role;

-- ================================================================= C. catalog
select v64_test.superseded('C01');
select v64_test.val('C02 the three *_bu_touch triggers run the no-op aware function; the audit-log DELETE logger is gone (m65)', $q$select concat_ws('|',
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_bu_touch', 'founders_bu_touch', 'company_founders_bu_touch') and t.tgfoid = 'app_private.touch_updated_at_if_changed()'::regprocedure)::text,
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname = 'founders_ad_alumni_log')::text)$q$, '3|0');
select v64_test.val('C03 email_worker_finish: the ownership guard is two-valued (is not true)', $q$select (position(') is not true then' in pg_get_functiondef('public.email_worker_finish(uuid,text,text,text,text,integer,text,text,integer)'::regprocedure)) > 0)::text$q$, 'true');
select v64_test.val('C04 remove_company_team_member is still a definer function for authenticated only', $q$select (p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))::text from pg_proc p where p.oid = 'public.remove_company_team_member(uuid,uuid)'::regprocedure$q$, 'true');

select v64_test.val('C05 the only GENERATED column of companies / founders / company_founders is companies.name_key (the no-op test leaves it out)', $q$select coalesce(string_agg(a.attrelid::regclass::text || '.' || a.attname, ',' order by a.attname), 'none') from pg_attribute a where a.attrelid in ('public.companies'::regclass, 'public.founders'::regclass, 'public.company_founders'::regclass) and a.attgenerated <> '' and not a.attisdropped$q$, 'companies.name_key');

-- ================================================================= R. national IDs: the redaction function (unit tests)
select v64_test.val('R01 14 Latin digits in a row (the old rule) are still removed', $q$select app_private.redact_ids_text('a 29901011234567 b')$q$, 'a [ID removed] b');
select v64_test.val('R02 Arabic-Indic digits are removed', $q$select app_private.redact_ids_text(U&'\0662\0669\0669\0660\0661\0660\0661\0661\0662\0663\0664\0665\0666\0667')$q$, '[ID removed]');
select v64_test.val('R03 extended Arabic-Indic (Persian) digits are removed', $q$select app_private.redact_ids_text(U&'x \06F2\06F9\06F9\06F0\06F1\06F0\06F1\06F1\06F2\06F3\06F4\06F5\06F6\06F7 y')$q$, 'x [ID removed] y');
select v64_test.val('R04 spaces between the digits ("2 99 01 01 12345 67")', $q$select app_private.redact_ids_text('id: 2 99 01 01 12345 67.')$q$, 'id: [ID removed].');
select v64_test.val('R05 dashes and dots', $q$select app_private.redact_ids_text('2-99-01-01-12-345-67 / 3.01.12.31.01.234.56')$q$, '[ID removed] / [ID removed]');
select v64_test.val('R06 a mix of Latin and Arabic digits with separators', $q$select app_private.redact_ids_text(U&'2 99 \0660\0661 01 12345 67')$q$, '[ID removed]');
select v64_test.val('R07 not an ID: 13 digits, 15 digits, 17 digits, a card-like 16 digit group', $q$select concat_ws('|', app_private.redact_ids_text('2990101123456'), app_private.redact_ids_text('299010112345678'), app_private.redact_ids_text('29901011234567890'), app_private.redact_ids_text('2024 1234 5678 9012'))$q$,
  '2990101123456|299010112345678|29901011234567890|2024 1234 5678 9012');
select v64_test.val('R08 not an ID: a screenshot file name with a date and a time, a phone number', $q$select concat_ws('|', app_private.redact_ids_text('Screenshot 2024-05-12 123456'), app_private.redact_ids_text('+20 100 123 4567'))$q$, 'Screenshot 2024-05-12 123456|+20 100 123 4567');
select v64_test.val('R09 NULL in, NULL out; empty stays empty', $q$select concat_ws('|', coalesce(app_private.redact_ids_text(null), 'NULL'), '[' || app_private.redact_ids_text('') || ']')$q$, 'NULL|[]');
select v64_test.val('R10 the jsonb walker (the one the log uses) reaches nested strings', $q$select app_private.redact_ids_json('{"a":["x 2 99 01 01 12345 67"],"b":{"c":"29901011234567"}}'::jsonb)::text$q$, '{"a": ["x [ID removed]"], "b": {"c": "[ID removed]"}}');
select v64_test.val('R11 the at-rest scan sees the new spellings and ignores the screenshot name', $q$select concat_ws('|', app_private.contains_id('2 99 01 01 12345 67')::text, app_private.contains_id(U&'\0662\0669\0669\0660\0661\0660\0661\0661\0662\0663\0664\0665\0666\0667')::text, app_private.contains_id('Screenshot 2024-05-12 123456')::text, app_private.contains_id('no number here')::text)$q$, 'true|true|false|false');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e640','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v64-adm@example.invalid','{"provisioned":true}','{"full_name":"V64 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e641','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v64-am@example.invalid','{"provisioned":true}','{"full_name":"V64 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e643','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v64-f1@example.invalid','{"provisioned":true}','{"full_name":"V64 Founder One"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e640','super_admin'), ('00000000-0000-4000-8000-00000000e641','alumni_manager'), ('00000000-0000-4000-8000-00000000e643','founder');
insert into public.companies (id, name_en, name_ar, created_by) values
  ('00000000-0000-4000-8000-00000000c641', 'V64 Nile Co', 'نيل V64', '00000000-0000-4000-8000-00000000e643'),
  ('00000000-0000-4000-8000-00000000c642', 'V64 Other Co', null, null);
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f641', 'V64 One', 'واحد', 'zz-v64-f1@example.invalid', '00000000-0000-4000-8000-00000000e643');
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000c641', '00000000-0000-4000-8000-00000000f641', true);

-- ================================================================= I. an ID typed into a free text never reaches the immutable log
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
reset role;
select v64_test.superseded('I01');
select v64_test.superseded('I02');

-- ================================================================= A. the audit bypass: every column an owner can write is logged
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e643","role":"authenticated"}', true);
set local role authenticated;
update public.companies set employees = '9999', founding_year = 1901, industry_en = 'Free industry', governorate_en = 'Free place' where id = '00000000-0000-4000-8000-00000000c641';
reset role;
select v64_test.superseded('A01');
select v64_test.superseded('A02');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
select v64_test.superseded('A03');
-- a derived mirror writes NO second entry next to its key: the key is set, the mirror follows
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
update public.companies set sector_key = 'technology', governorate_code = '1', established_on = date '2019-03-04' where id = '00000000-0000-4000-8000-00000000c642';
reset role;
select v64_test.superseded('A04');
select v64_test.val('A05 the mirror still follows the key (nothing else changed): industry, governorate name and the year are derived', $q$select concat_ws('|', (c.industry_en is not null)::text, (c.governorate_en is not null)::text, c.founding_year::text) from public.companies c where c.id = '00000000-0000-4000-8000-00000000c642'$q$, 'true|true|2019');
-- a manager moves a membership with a direct UPDATE, deletes a founders row: both leave a trace
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
update public.company_founders set company_id = '00000000-0000-4000-8000-00000000c642' where founder_id = '00000000-0000-4000-8000-00000000f641';
reset role;
select v64_test.superseded('A06');
insert into public.founders (id, name_en, name_ar) values ('00000000-0000-4000-8000-00000000f642', 'V64 Delete Me', 'احذفني');
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000c641', '00000000-0000-4000-8000-00000000f642', false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
delete from public.company_founders where founder_id = '00000000-0000-4000-8000-00000000f642';
delete from public.founders where id = '00000000-0000-4000-8000-00000000f642';
reset role;
select v64_test.superseded('A07');
-- the founder goes back to his company for the next sections
update public.company_founders set company_id = '00000000-0000-4000-8000-00000000c641' where founder_id = '00000000-0000-4000-8000-00000000f641';
-- the structural proof: every column the API roles can write on the six tables is either logged or on the short list of columns that are not alumni data
select v64_test.superseded('A08');

-- ================================================================= N. a save that changes nothing leaves the stamps and the token alone
select v64_test.age('companies', '00000000-0000-4000-8000-00000000c641', timestamptz '2020-01-01 00:00:00+00');
select v64_test.age('founders', '00000000-0000-4000-8000-00000000f641', timestamptz '2020-01-01 00:00:00+00');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c641', jsonb_build_object('stage', (select c.stage from public.companies c where c.id = '00000000-0000-4000-8000-00000000c641')), null) is not null as ok \gset
reset role;
select v64_test.superseded('N01');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_founder('00000000-0000-4000-8000-00000000f641', jsonb_build_object('name_en', (select f.name_en from public.founders f where f.id = '00000000-0000-4000-8000-00000000f641')), null) is not null as ok \gset
reset role;
select v64_test.val('N02 the same for a founder record saved with its current name: nothing moves', $q$select concat_ws('|', (f.updated_at = timestamptz '2020-01-01 00:00:00+00')::text, (f.updated_by is null)::text, (f.updated_source is null)::text) from public.founders f where f.id = '00000000-0000-4000-8000-00000000f641'$q$, 'true|true|true');
-- the old token still works for the founder's form (no false alumni_stale)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e643","role":"authenticated"}', true);
set local role authenticated;
select public.save_my_company_profile('00000000-0000-4000-8000-00000000c641', '{"description_en":"Founder text"}'::jsonb, timestamptz '2020-01-01 00:00:00+00') is not null as ok \gset
reset role;
select v64_test.val('N03 the founder form loaded BEFORE the manager no-op save still saves with its token (no false stale); the real change moves the stamp', $q$select concat_ws('|', (c.updated_at > timestamptz '2020-01-01')::text, c.updated_source, c.description_en) from public.companies c where c.id = '00000000-0000-4000-8000-00000000c641'$q$, 'true|founder|Founder text');
select v64_test.val('N04 a REAL change by a manager moves the stamp and the editor', $q$select concat_ws('|', (c.updated_at > timestamptz '2020-01-01')::text, c.updated_source) from public.companies c where c.id = '00000000-0000-4000-8000-00000000c641'$q$, 'true|founder');
select v64_test.age('companies', '00000000-0000-4000-8000-00000000c641', timestamptz '2020-01-01 00:00:00+00');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
select public.save_alumni_company('00000000-0000-4000-8000-00000000c641', '{"stage":"mvp"}'::jsonb, timestamptz '2020-01-01 00:00:00+00') is not null as ok \gset
reset role;
select v64_test.val('N05 a real manager change: token matched, stamp moved, source manager', $q$select concat_ws('|', (c.updated_at > timestamptz '2020-01-01')::text, c.updated_source, c.stage) from public.companies c where c.id = '00000000-0000-4000-8000-00000000c641'$q$, 'true|manager|mvp');
-- a direct no-op UPDATE through the table (a PATCH with the same values)
select v64_test.age('companies', '00000000-0000-4000-8000-00000000c642', timestamptz '2020-01-01 00:00:00+00');
update public.companies set name_en = name_en where id = '00000000-0000-4000-8000-00000000c642';
select v64_test.val('N06 UPDATE ... SET col = col leaves the row untouched too', $q$select (c.updated_at = timestamptz '2020-01-01 00:00:00+00')::text from public.companies c where c.id = '00000000-0000-4000-8000-00000000c642'$q$, 'true');

-- ================================================================= G. email_worker_finish: a lease with no holder is never finished by anybody
insert into app_private.email_outbox (email_key, recipient_email, subject, body_html, idempotency_key, status, locked_by, locked_until, created_by)
values ('staff_invitation', 'zz-v64-guard@example.invalid', 'S', '<p>B</p>', 'v64-guard-1', 'sending', null, now() + interval '1 minute', '00000000-0000-4000-8000-00000000e640');
select id as g1 from app_private.email_outbox where idempotency_key = 'v64-guard-1' \gset
select v64_test.val('G01 a `sending` row with NO lease holder cannot be finished by a named worker (not_owner)', format($q$select (public.email_worker_finish(%L, 'wk-X', 'sent')->>'reason') || '/' || (select status from app_private.email_outbox where id = %L)$q$, :'g1', :'g1'), 'not_owner/sending');
update app_private.email_outbox set status = 'needs_review', error_code = 'unknown_outcome', locked_by = null where id = :'g1';
select v64_test.val('G02 a needs_review / unknown_outcome row with no holder cannot be marked sent by a named worker either', format($q$select (public.email_worker_finish(%L, 'wk-X', 'sent')->>'reason') || '/' || (select status from app_private.email_outbox where id = %L)$q$, :'g1', :'g1'), 'not_owner/needs_review');
update app_private.email_outbox set status = 'sending', error_code = null, locked_by = 'wk-X' where id = :'g1';
select v64_test.val('G03 the real holder still finishes its row', format($q$select (public.email_worker_finish(%L, 'wk-X', 'sent', null, null, null, 'gm-1', '<v64@athareg.com>')->>'status')$q$, :'g1'), 'sent');

-- ================================================================= T. removing a team member: the identity + soft delete entries stay on the company timeline
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
select (public.save_company_team_member('00000000-0000-4000-8000-00000000c642', null, '{"name_en":"V64 Record","role":"CTO","self_birth_date":"1999-05-17"}'::jsonb)->>'founder_id') as rec1 \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
set local role authenticated;
select public.remove_company_team_member('00000000-0000-4000-8000-00000000c642', :'rec1') is not null as ok \gset
reset role;
select v64_test.superseded('T01');
select v64_test.val('T02 the record is soft-deleted, the identity row erased, the membership gone', format($q$select concat_ws('|', (select (f.deleted_at is not null)::text from public.founders f where f.id = %L), (select count(*) from public.founder_identities i where i.founder_id = %L)::text,
  (select count(*) from public.company_founders cf where cf.founder_id = %L)::text)$q$, :'rec1', :'rec1', :'rec1'), 'true|0|0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e641","role":"authenticated"}', true);
select v64_test.superseded('T03');

-- ================================================================= report (inside the transaction: the recorded details never travel through a psql variable)
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(current_setting('v64.res', true), chr(10)) line where line <> '' and split_part(line, '|', 1) <> 'ok' order by 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(current_setting('v64.res', true), chr(10)) line where line <> '';
do $$ begin
  if exists (select 1 from regexp_split_to_table(current_setting('v64.res', true), chr(10)) line where line <> '' and split_part(line, '|', 1) <> 'ok') then
    raise exception 'v64: review fixes tests FAILED';
  end if;
end $$;
rollback;
