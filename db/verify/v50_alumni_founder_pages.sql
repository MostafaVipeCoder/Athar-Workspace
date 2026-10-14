-- v50_alumni_founder_pages  (m50: the SQL needs of the founder-side Alumni pages)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
--
-- Fixture (ids ...00000000e50x / c50x / f50x / a50x):
--   AM = alumni_manager, PM = project_manager, F1 = founder of CO1 (founders row), F2 = founder of CO2, NR = no role
--   O1 = active opportunity with a future deadline, O2 = INACTIVE, O3 = active but its deadline was yesterday (Cairo)
--   one pending invitation (token 'v50-invite-token') of CO1 sent by AM, one expired (15 days old) and one revoked
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute crashes this
-- local Postgres image, m42 / m43 gotcha): triggers are SECURITY DEFINER, tests only touch public objects while role-switched.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v50.res', '', false) \gset

begin;
create schema v50_test;
grant usage on schema v50_test to public;
create or replace function v50_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v50.res', current_setting('v50.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v50_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v50_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v50_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v50_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v50_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v50_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v50_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v50_test.t(p_key, true, 'ok');
  exception when others then
    perform v50_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v50_test from public;
grant execute on all functions in schema v50_test to anon, authenticated, service_role;

-- ================================================================= C. catalog (as postgres)
select v50_test.val('C01 the two guard triggers exist and their functions are closed to every API role', $q$select (select count(*) from pg_trigger where tgname in ('opportunity_applications_bi_guard', 'notifications_bu_guard') and not tgisinternal)::text || '/' ||
  (select count(*) from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname in ('opportunity_applications_guard', 'notifications_guard')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text$q$, '2/0');
select v50_test.val('C02 validate_invitation is still anon-callable and read-only (STABLE, SECURITY DEFINER, empty search_path)', $q$select concat_ws('|', has_function_privilege('anon', 'public.validate_invitation(text)', 'EXECUTE')::text, p.provolatile::text, p.prosecdef::text,
  case when 'search_path=""' = any(p.proconfig) then 'y' else 'n' end) from pg_proc p where p.oid = 'public.validate_invitation(text)'::regprocedure$q$, 'true|s|true|y');
select v50_test.val('C04 no alumni function raises SQLSTATE 40001 any more (PostgREST 14 retries a serialization failure for ever: a stale save made the request spin)', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
  and p.proname in ('save_my_company_profile', 'save_alumni_company') and p.prosrc like '%errcode = ''40001''%'$q$, '0');
select v50_test.val('C03 accept_invitation stays closed to anon', $q$select has_function_privilege('anon', 'public.accept_invitation(text)', 'EXECUTE')::text$q$, 'false');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e500','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v50-am@example.invalid','{"provisioned":true}','{"full_name":"Mona Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e501','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v50-pm@example.invalid','{"provisioned":true}','{"full_name":"V50 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e502','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v50-f1@example.invalid','{"provisioned":true}','{"full_name":"V50 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e503','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v50-f2@example.invalid','{"provisioned":true}','{"full_name":"V50 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e504','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v50-nr@example.invalid','{"provisioned":true}','{"full_name":"V50 No Role"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e500','alumni_manager'), ('00000000-0000-4000-8000-00000000e501','project_manager'),
  ('00000000-0000-4000-8000-00000000e502','founder'), ('00000000-0000-4000-8000-00000000e503','founder');
insert into public.companies (id, name_en, name_ar, created_by) values
  ('00000000-0000-4000-8000-00000000c501', 'V50 Nile Co', 'نيل V50', '00000000-0000-4000-8000-00000000e502'),
  ('00000000-0000-4000-8000-00000000c502', 'V50 Delta Co', null, '00000000-0000-4000-8000-00000000e503');
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f501', 'V50 One', 'واحد', 'zz-v50-f1@example.invalid', '00000000-0000-4000-8000-00000000e502'),
  ('00000000-0000-4000-8000-00000000f502', 'V50 Two', 'اثنان', 'zz-v50-f2@example.invalid', '00000000-0000-4000-8000-00000000e503');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c501', '00000000-0000-4000-8000-00000000f501', true),
  ('00000000-0000-4000-8000-00000000c502', '00000000-0000-4000-8000-00000000f502', true);
insert into public.opportunities (opportunity_id, type, title_ar, title_en, deadline, is_active) values
  ('00000000-0000-4000-8000-00000000a501', 'grant', 'منحة', 'V50 open grant', (now() at time zone 'Africa/Cairo')::date + 30, true),
  ('00000000-0000-4000-8000-00000000a502', 'grant', 'منحة معطلة', 'V50 inactive', null, false),
  ('00000000-0000-4000-8000-00000000a503', 'event', 'فعالية', 'V50 expired', (now() at time zone 'Africa/Cairo')::date - 1, true),
  ('00000000-0000-4000-8000-00000000a504', 'event', 'فعالية اليوم', 'V50 closes today', (now() at time zone 'Africa/Cairo')::date, true),
  ('00000000-0000-4000-8000-00000000a505', 'competition', 'مسابقة', 'V50 open competition', null, true);
insert into public.alumni_invitations (id, company_id, founder_email, token, status, sent_at, sent_by) values
  ('00000000-0000-4000-8000-00000000b501', '00000000-0000-4000-8000-00000000c501', 'newfounder@example.invalid', encode(extensions.digest('v50-invite-token', 'sha256'), 'hex'), 'pending', now(), '00000000-0000-4000-8000-00000000e500'),
  ('00000000-0000-4000-8000-00000000b502', '00000000-0000-4000-8000-00000000c501', 'old@example.invalid', encode(extensions.digest('v50-expired-token', 'sha256'), 'hex'), 'pending', now() - interval '15 days', '00000000-0000-4000-8000-00000000e500'),
  ('00000000-0000-4000-8000-00000000b503', '00000000-0000-4000-8000-00000000c501', 'gone@example.invalid', encode(extensions.digest('v50-revoked-token', 'sha256'), 'hex'), 'revoked', now(), '00000000-0000-4000-8000-00000000e500'),
  ('00000000-0000-4000-8000-00000000b504', '00000000-0000-4000-8000-00000000c501', 'nobody@example.invalid', encode(extensions.digest('v50-orphan-token', 'sha256'), 'hex'), 'pending', now(), null);

-- ================================================================= I. validate_invitation (anon)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v50_test.val('I01 a valid token: the old keys are unchanged (valid, company_name, masked_email)', $q$select concat_ws('|', r->>'valid', r->>'company_name', r->>'masked_email') from (select public.validate_invitation('v50-invite-token') r) x$q$, 'true|V50 Nile Co|n***@example.invalid');
select v50_test.val('I02 NEW keys: who invited, when it expires, the name in both languages', $q$select concat_ws('|', r->>'inviter_name', r->>'company_name_en', r->>'company_name_ar', ((r->>'expires_at')::timestamptz > now() + interval '13 days')::text) from (select public.validate_invitation('v50-invite-token') r) x$q$, 'Mona Manager|V50 Nile Co|نيل V50|true');
select v50_test.val('I03 the clear e-mail and the token hash are NEVER in the answer', $q$select (r::text ~* 'newfounder@' or r::text ~* 'token')::text from (select public.validate_invitation('v50-invite-token') r) x$q$, 'false');
select v50_test.val('I04 an invitation without a sender still validates (inviter_name is null)', $q$select (r->>'valid') || '|' || coalesce(r->>'inviter_name', 'NULL') from (select public.validate_invitation('v50-orphan-token') r) x$q$, 'true|NULL');
select v50_test.val('I05 expired / revoked / unknown / empty / null tokens are all {valid:false} and say nothing else', $q$select string_agg(public.validate_invitation(t)::text, ',' order by o) from unnest(array['v50-expired-token', 'v50-revoked-token', 'nope', '', null]) with ordinality x(t, o)$q$,
  '{"valid": false},{"valid": false},{"valid": false},{"valid": false},{"valid": false}');
reset role;

-- ================================================================= A. opportunity applications (F1 founder of CO1, F2 of CO2)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e502","role":"authenticated"}', true);
set local role authenticated;
select v50_test.okrun('A01 a founder applies for his own company', $q$insert into public.opportunity_applications (opportunity_id, company_id, status, notes) values ('00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000c501', 'accepted', '  we are ready  ')$q$);
select v50_test.val('A02 the guard FORCED status = applied (the typed "accepted" was ignored), trimmed the note and filled the founder id', $q$select concat_ws('|', status, notes, (founder_id = '00000000-0000-4000-8000-00000000f501')::text) from public.opportunity_applications where company_id = '00000000-0000-4000-8000-00000000c501'$q$, 'applied|we are ready|true');
select v50_test.fails('A03 the same company cannot apply twice (unique)', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000c501')$q$, '23505');
select v50_test.fails('A04 an INACTIVE opportunity is refused with the token', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-00000000a502', '00000000-0000-4000-8000-00000000c501')$q$, '22023', 'opportunity_closed');
select v50_test.fails('A05 an opportunity whose deadline was yesterday (Cairo) is refused', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-00000000a503', '00000000-0000-4000-8000-00000000c501')$q$, '22023', 'opportunity_closed');
select v50_test.okrun('A06 an opportunity that closes TODAY is still open', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-00000000a504', '00000000-0000-4000-8000-00000000c501')$q$);
select v50_test.fails('A07 a note longer than 1000 characters is refused (alumni_invalid, detail notes:too_long)', $q$insert into public.opportunity_applications (opportunity_id, company_id, notes) values ('00000000-0000-4000-8000-00000000a505', '00000000-0000-4000-8000-00000000c501', repeat('x', 1001))$q$, '22023', 'alumni_invalid', 'notes:too_long');
select v50_test.fails('A08 an application for ANOTHER founder''s company is refused by RLS (the guard never sees it)', $q$insert into public.opportunity_applications (opportunity_id, company_id) values ('00000000-0000-4000-8000-00000000a504', '00000000-0000-4000-8000-00000000c502')$q$, '42501');
select v50_test.fails('A09 an application naming ANOTHER founder is refused by RLS', $q$insert into public.opportunity_applications (opportunity_id, company_id, founder_id) values ('00000000-0000-4000-8000-00000000a504', '00000000-0000-4000-8000-00000000c501', '00000000-0000-4000-8000-00000000f502')$q$, '42501');
select v50_test.val('A10 a founder reads only the applications of his own companies', $q$select count(*)::text from public.opportunity_applications$q$, '2');
select v50_test.val('A11 a founder cannot change the status afterwards (no update policy: 0 rows)', $q$with u as (update public.opportunity_applications set status = 'accepted' returning 1) select count(*)::text from u$q$, '0');
select v50_test.val('A12 a founder sees the ACTIVE opportunities only (4 of the 5 fixtures)', $q$select count(*)::text from public.opportunities where title_en like 'V50 %'$q$, '4');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e503","role":"authenticated"}', true);
set local role authenticated;
select v50_test.val('A13 the other founder sees none of them', $q$select count(*)::text from public.opportunity_applications$q$, '0');
select v50_test.okrun('A14 and applies for his own company (the 1000-character note passes)', $q$insert into public.opportunity_applications (opportunity_id, company_id, notes) values ('00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000c502', repeat('y', 1000))$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e500","role":"authenticated"}', true);
set local role authenticated;
select v50_test.val('A15 the alumni manager reads all three applications', $q$select count(*)::text from public.opportunity_applications$q$, '3');
select v50_test.val('A16 the manager still moves an application to any status (the guard is insert-only)', $q$with u as (update public.opportunity_applications set status = 'accepted' where company_id = '00000000-0000-4000-8000-00000000c502' returning 1) select count(*)::text from u$q$, '1');
reset role;
select set_config('request.jwt.claims', '', true);
select v50_test.val('A17 as the owner (no JWT: a migration / the service role) a direct insert keeps every value as written', $q$with i as (insert into public.opportunity_applications (opportunity_id, company_id, status) values ('00000000-0000-4000-8000-00000000a502', '00000000-0000-4000-8000-00000000c502', 'shortlisted') returning status) select status from i$q$, 'shortlisted');

-- ================================================================= N. notifications
insert into public.notifications (id, recipient_id, title, body, sent_by, metadata) values
  ('00000000-0000-4000-8000-00000000d501', '00000000-0000-4000-8000-00000000e502', 'Welcome', 'Welcome to the alumni network', '00000000-0000-4000-8000-00000000e500', '{"link":"/alumni/founder/opportunities"}'),
  ('00000000-0000-4000-8000-00000000d502', '00000000-0000-4000-8000-00000000e502', 'Second', 'Another message', '00000000-0000-4000-8000-00000000e500', '{}'),
  ('00000000-0000-4000-8000-00000000d503', '00000000-0000-4000-8000-00000000e503', 'For two', 'Private to founder two', '00000000-0000-4000-8000-00000000e500', '{}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e502","role":"authenticated"}', true);
set local role authenticated;
select v50_test.val('N01 a founder reads only his own notifications', $q$select count(*)::text from public.notifications$q$, '2');
select v50_test.val('N02 the unread count (a head count under RLS)', $q$select count(*)::text from public.notifications where is_read = false$q$, '2');
select v50_test.okrun('N03 he marks one as read', $q$update public.notifications set is_read = true where id = '00000000-0000-4000-8000-00000000d501'$q$);
select v50_test.fails('N04 he can NOT rewrite the title', $q$update public.notifications set title = 'You won a prize' where id = '00000000-0000-4000-8000-00000000d502'$q$, '42501');
select v50_test.fails('N05 he can NOT rewrite the body, even together with is_read', $q$update public.notifications set body = 'forged', is_read = true where id = '00000000-0000-4000-8000-00000000d502'$q$, '42501');
select v50_test.fails('N06 he can NOT re-target the metadata (the link of the message)', $q$update public.notifications set metadata = '{"link":"https://evil.example"}' where id = '00000000-0000-4000-8000-00000000d502'$q$, '42501');
select v50_test.val('N07 mark all read: one statement over his own rows (RLS: the other founder''s row is not touched)', $q$with u as (update public.notifications set is_read = true where is_read = false returning 1) select count(*)::text from u$q$, '1');
select v50_test.val('N08 the other founder''s notification is invisible and untouchable', $q$select count(*)::text from public.notifications where id = '00000000-0000-4000-8000-00000000d503'$q$, '0');
reset role;
select v50_test.val('N09 the other founder''s notification stayed unread', $q$select is_read::text from public.notifications where id = '00000000-0000-4000-8000-00000000d503'$q$, 'false');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e500","role":"authenticated"}', true);
set local role authenticated;
select v50_test.okrun('N10 the alumni manager may still edit a message (the guard is for readers only)', $q$update public.notifications set body = 'Updated by the manager' where id = '00000000-0000-4000-8000-00000000d502'$q$);
select v50_test.okrun('N11 and send a new one to a founder', $q$insert into public.notifications (recipient_id, title, body, sent_by) values ('00000000-0000-4000-8000-00000000e503', 'Hello', 'From the manager', '00000000-0000-4000-8000-00000000e500')$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e501","role":"authenticated"}', true);
set local role authenticated;
select v50_test.val('N12 a project manager reads no notification', $q$select count(*)::text from public.notifications$q$, '0');
select v50_test.val('N13 and cannot read an application', $q$select count(*)::text from public.opportunity_applications$q$, '0');
reset role;

-- ================================================================= S. alumni_stale is a normal refusal (P0001 + token), for the founder and for the manager
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e502","role":"authenticated"}', true);
set local role authenticated;
select v50_test.fails('S01 a founder saving with an old updated_at gets alumni_stale as P0001, never 40001', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c501', '{"description_en":"x"}', '2020-01-01T00:00:00+00'::timestamptz)$q$, 'P0001', 'alumni_stale');
select v50_test.okrun('S02 the same save with the current updated_at (null = no check) goes through', $q$select public.save_my_company_profile('00000000-0000-4000-8000-00000000c501', '{"description_en":"fresh"}', null)$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e500","role":"authenticated"}', true);
set local role authenticated;
select v50_test.fails('S03 a manager saving with an old updated_at gets the same refusal', $q$select public.save_alumni_company('00000000-0000-4000-8000-00000000c501', '{"description_en":"y"}', '2020-01-01T00:00:00+00'::timestamptz)$q$, 'P0001', 'alumni_stale');
reset role;

-- ================================================================= final state check
select current_setting('v50.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v50: founder-side alumni pages tests FAILED'; end $$;
\endif
