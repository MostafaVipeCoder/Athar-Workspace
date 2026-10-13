-- v25_staff_founder_exclusivity  (m25: staff vs founder exclusivity, 08 section 15)  Role-switch tests inside ONE transaction
-- that is ROLLED BACK. Test users/rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
-- U1 = temporary super_admin, U2 = temporary project_manager, U3 = founder (self sign-up path), U4 = staff-invitation sign-up.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v25.res', '', false) \gset

begin;
create schema v25_test;
grant usage on schema v25_test to public;
create or replace function v25_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v25.res', current_setting('v25.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v25_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v25_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v25_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
-- fails: expects an error; optional SQLSTATE and a token that must appear in the message
create or replace function v25_test.fails(p_key text, p_sql text, p_state text default null, p_token text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v25_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v25_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_token is null or sqlerrm like p_token || '%'),
                       'sqlstate ' || sqlstate || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v25_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v25_test.t(p_key, true, 'ok');
  exception when others then
    perform v25_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v25_test from public;
grant execute on all functions in schema v25_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v25_test.val('C01 trigger user_roles_biu_exclusive exists', $q$select count(*)::text from pg_trigger where tgname='user_roles_biu_exclusive' and tgrelid='public.user_roles'::regclass$q$, '1');
select v25_test.val('C02 m25 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('user_roles_exclusive','holds_staff_role','holds_founder_role','set_staff_roles','apply_staff_invitation') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v25_test.val('C03 helpers are not executable by API roles', $q$select (has_function_privilege('anon','app_private.holds_founder_role(uuid)','EXECUTE') or has_function_privilege('authenticated','app_private.holds_staff_role(uuid)','EXECUTE'))::text$q$, 'false');
select v25_test.val('C04 no existing account holds staff + founder', $q$select count(distinct r.user_id)::text from public.user_roles r join public.roles ro on ro.key=r.role_key where ro.is_staff and exists (select 1 from public.user_roles f where f.user_id=r.user_id and f.role_key='founder')$q$, '0');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v25-admin@example.invalid','{"provisioned":true}','{"full_name":"V25 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v25-pm@example.invalid','{"provisioned":true}','{"full_name":"V25 PM"}', now(), now()),
 ('00000000-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v25-founder@example.invalid','{}','{"full_name":"V25 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000d1','super_admin'), ('00000000-0000-4000-8000-0000000000d2','project_manager');
insert into public.programs (id, name_en, created_by) values ('00000000-0000-4000-8000-0000000000e1', 'V25 Program', '00000000-0000-4000-8000-0000000000d1');
select v25_test.val('S01 self sign-up (U3) got founder only', $q$select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d3'$q$, 'founder');

-- ================================================================= direct writes (as postgres): the trigger is the guarantee
select v25_test.fails('D01 founder cannot receive a staff role (insert)', $q$insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000d3','project_manager')$q$, '23514', 'staff_founder_exclusive');
select v25_test.fails('D02 staff cannot receive founder (insert)', $q$insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000d2','founder')$q$, '23514', 'staff_founder_exclusive');
select v25_test.fails('D03 staff cannot receive founder (insert ... on conflict do nothing still rejected)', $q$insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000d1','founder') on conflict do nothing$q$, '23514', 'staff_founder_exclusive');
select v25_test.fails('D04 update of a founder row into a staff role is rejected', $q$update public.user_roles set role_key='alumni_manager' where user_id='00000000-0000-4000-8000-0000000000d3' and role_key='founder'$q$, '23514', 'staff_founder_exclusive');
select v25_test.okrun('D05 a second staff role on a staff account is fine', $q$insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000d2','alumni_manager')$q$);
select v25_test.val('D06 state unchanged after rejected writes', $q$select (select string_agg(role_key, ',' order by role_key) from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d3') || ' / ' || (select string_agg(role_key, ',' order by role_key) from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d2')$q$, 'founder / alumni_manager,project_manager');

-- ================================================================= RPCs as the super_admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select v25_test.fails('R01 set_staff_roles on a founder account is rejected with the clear error', $q$select public.set_staff_roles('00000000-0000-4000-8000-0000000000d3', array['project_manager'])$q$, '23514', 'staff_founder_exclusive');
select v25_test.okrun('R02 set_staff_roles on a staff account still works', $q$select public.set_staff_roles('00000000-0000-4000-8000-0000000000d2', array['project_manager'])$q$);
select set_config('v25.inv2', (select public.create_staff_invitation('zz-v25-new@example.invalid', array['alumni_manager'], array['00000000-0000-4000-8000-0000000000e1']::uuid[]))::text, true);
reset role;
-- create_staff_invitation refuses existing accounts (m24), so the "founder accepts a staff invitation" case is set up directly
insert into public.staff_invitations (id, email, token_hash, roles, program_ids, invited_by)
values ('00000000-0000-4000-8000-0000000000e2', 'zz-v25-founder@example.invalid', encode(extensions.digest('v25-staff-token', 'sha256'), 'hex'),
        array['project_manager'], array['00000000-0000-4000-8000-0000000000e1']::uuid[], '00000000-0000-4000-8000-0000000000d1');
select set_config('v25.inv', '{"id":"00000000-0000-4000-8000-0000000000e2","token":"v25-staff-token"}', true);
select v25_test.val('R03 founder account kept founder only after R01', $q$select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d3'$q$, 'founder');
select v25_test.val('R04 set_staff_roles narrowed U2 to project_manager', $q$select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d2'$q$, 'project_manager');

-- ================================================================= invitation accepted by a founder account: refused with a reason
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select v25_test.val('I01 accept_staff_invitation by a founder returns reason founder_account', $q$select (public.accept_staff_invitation(current_setting('v25.inv')::jsonb->>'token'))->>'reason'$q$, 'founder_account');
reset role;
select v25_test.val('I02 founder still founder only; invitation still pending; no membership granted', $q$select ((select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d3') = 'founder' and (select status from public.staff_invitations where id=(current_setting('v25.inv')::jsonb->>'id')::uuid) = 'pending' and not exists (select 1 from public.program_members where user_id='00000000-0000-4000-8000-0000000000d3'))::text$q$, 'true');

-- staff sign-up through the trigger path (new account, valid token): still works and never grants founder
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v25-new@example.invalid','{}',
  jsonb_build_object('full_name','V25 New','staff_invitation_token', current_setting('v25.inv2')::jsonb->>'token'), now(), now());
select v25_test.val('I03 invited sign-up got exactly the invited staff role (no founder)', $q$select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d4'$q$, 'alumni_manager');

-- ================================================================= alumni invitation accepted by a STAFF account: rejected by the trigger
insert into public.companies (id, name_en) values ('00000000-0000-4000-8000-0000000000f1', 'V25 Co') on conflict do nothing;
insert into public.alumni_invitations (company_id, founder_email, token, status, sent_at)
values ('00000000-0000-4000-8000-0000000000f1', 'zz-v25-pm@example.invalid', encode(extensions.digest('v25-alumni-token', 'sha256'), 'hex'), 'pending', now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select v25_test.fails('A01 staff account cannot accept an alumni (founder) invitation', $q$select public.accept_invitation('v25-alumni-token')$q$, '23514', 'staff_founder_exclusive');
reset role;
select v25_test.val('A02 staff account unchanged; alumni invitation still pending', $q$select ((select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d2') = 'project_manager' and (select status from public.alumni_invitations where founder_email='zz-v25-pm@example.invalid') = 'pending')::text$q$, 'true');

-- ================================================================= remove_staff leaves no role at all
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select v25_test.okrun('Z01 remove_staff', $q$select public.remove_staff('00000000-0000-4000-8000-0000000000d2')$q$);
reset role;
select v25_test.val('Z02 removed staff member has no roles (no founder to keep)', $q$select count(*)::text from public.user_roles where user_id='00000000-0000-4000-8000-0000000000d2'$q$, '0');

select current_setting('v25.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v25: staff/founder exclusivity tests FAILED'; end $$;
\endif
