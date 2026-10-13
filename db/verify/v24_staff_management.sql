-- v24_staff_management  (m24: staff management + staff invitations)  Role-switch tests inside ONE transaction that is ROLLED BACK.
-- Test users/rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
-- U1 = temporary super_admin, U2 = temporary project_manager, U3 = account created through a staff invitation (trigger path),
-- U4 = account created through a staff invitation with an INVALID token (must get NO role, never founder).
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v24.res', '', false) \gset

begin;
create schema v24_test;
grant usage on schema v24_test to public;
create or replace function v24_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v24.res', current_setting('v24.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v24_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v24_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v24_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v24_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v24_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v24_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate);
  end;
end $$;
create or replace function v24_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v24_test.t(p_key, true, 'ok');
  exception when others then
    perform v24_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v24_test from public;
grant execute on all functions in schema v24_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v24_test.val('C01 profiles.profile_color exists', $q$select count(*)::text from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='profile_color'$q$, '1');
select v24_test.val('C02 staff_invitations RLS enabled + forced', $q$select (relrowsecurity and relforcerowsecurity)::text from pg_class where oid='public.staff_invitations'::regclass$q$, 'true');
select v24_test.val('C03 staff_invitations: only a super_admin SELECT policy (writes by RPC)', $q$select string_agg(cmd, ',' order by cmd) from pg_policies where tablename='staff_invitations'$q$, 'SELECT');
select v24_test.val('C04 anon has no grant on staff_invitations', $q$select has_table_privilege('anon','public.staff_invitations','SELECT')::text$q$, 'false');
select v24_test.val('C05 anon may EXECUTE validate_staff_invitation only', $q$select (has_function_privilege('anon','public.validate_staff_invitation(text)','EXECUTE') and not has_function_privilege('anon','public.accept_staff_invitation(text)','EXECUTE') and not has_function_privilege('anon','public.create_staff_invitation(text,text[],uuid[],text,text)','EXECUTE') and not has_function_privilege('anon','public.list_staff()','EXECUTE'))::text$q$, 'true');
select v24_test.val('C06 email_outbox scope check present', $q$select count(*)::text from pg_constraint where conname='email_outbox_scope_chk'$q$, '1');
select v24_test.val('C07 every m24 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('list_staff','set_staff_roles','set_program_memberships','remove_staff','create_staff_invitation','revoke_staff_invitation','validate_staff_invitation','accept_staff_invitation','apply_staff_invitation','handle_new_user') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');

-- ================================================================= setup (as postgres): U1 super_admin, U2 PM, one program
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v24-admin@example.invalid','{"provisioned":true}','{"full_name":"V24 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v24-pm@example.invalid','{"provisioned":true}','{"full_name":"V24 PM"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000b1','super_admin'), ('00000000-0000-4000-8000-0000000000b2','project_manager');
insert into public.programs (id, name_en, created_by) values ('00000000-0000-4000-8000-0000000000c1', 'V24 Program', '00000000-0000-4000-8000-0000000000b1');

-- ================================================================= U2 (project_manager): everything forbidden
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select v24_test.fails('P01 PM cannot list staff', $q$select count(*) from public.list_staff()$q$, '42501');
select v24_test.fails('P02 PM cannot create a staff invitation', $q$select public.create_staff_invitation('zz-v24-x@example.invalid', array['project_manager'])$q$, '42501');
select v24_test.fails('P03 PM cannot change roles', $q$select public.set_staff_roles('00000000-0000-4000-8000-0000000000b1', array['project_manager'])$q$, '42501');
select v24_test.fails('P04 PM cannot remove staff', $q$select public.remove_staff('00000000-0000-4000-8000-0000000000b1')$q$, '42501');
select v24_test.val('P05 PM sees no invitation rows', $q$select count(*)::text from public.staff_invitations$q$, '0');
select v24_test.okrun('P06 PM may set own profile colour', $q$update public.profiles set profile_color = '#1a27c9' where id = '00000000-0000-4000-8000-0000000000b2'$q$);
select v24_test.fails('P07 profile colour must be a hex colour', $q$update public.profiles set profile_color = 'red' where id = '00000000-0000-4000-8000-0000000000b2'$q$, '23514');
reset role;

-- ================================================================= U1 (super_admin): manage + invite
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select v24_test.val('A01 super_admin lists staff incl. the temporary PM', $q$select count(*)::text from public.list_staff() s where s->>'id' = '00000000-0000-4000-8000-0000000000b2'$q$, '1');
select v24_test.okrun('A02 super_admin sets PM memberships', $q$select public.set_program_memberships('00000000-0000-4000-8000-0000000000b2', array['00000000-0000-4000-8000-0000000000c1']::uuid[])$q$);
select v24_test.val('A03 membership row exists (manager)', $q$select member_role from public.program_members where user_id='00000000-0000-4000-8000-0000000000b2' and program_id='00000000-0000-4000-8000-0000000000c1'$q$, 'manager');
select v24_test.okrun('A04 super_admin clears memberships', $q$select public.set_program_memberships('00000000-0000-4000-8000-0000000000b2', '{}'::uuid[])$q$);
select v24_test.val('A05 membership removed', $q$select count(*)::text from public.program_members where user_id='00000000-0000-4000-8000-0000000000b2'$q$, '0');
select v24_test.okrun('A06 super_admin changes roles (PM -> alumni_manager)', $q$select public.set_staff_roles('00000000-0000-4000-8000-0000000000b2', array['alumni_manager'])$q$);
select v24_test.val('A07 roles replaced', $q$select string_agg(role_key, ',' order by role_key) from public.user_roles where user_id='00000000-0000-4000-8000-0000000000b2'$q$, 'alumni_manager');
select v24_test.fails('A08 cannot change own roles', $q$select public.set_staff_roles('00000000-0000-4000-8000-0000000000b1', array['project_manager'])$q$, '22023');
select v24_test.fails('A09 founder is not a staff role', $q$select public.set_staff_roles('00000000-0000-4000-8000-0000000000b2', array['founder'])$q$, '22023');
select v24_test.fails('A10 invitation: existing e-mail rejected', $q$select public.create_staff_invitation('zz-v24-pm@example.invalid', array['project_manager'])$q$, '23505');
select v24_test.fails('A11 invitation: founder role rejected', $q$select public.create_staff_invitation('zz-v24-new@example.invalid', array['founder'])$q$, '22023');
select v24_test.fails('A12 invitation: unknown program rejected', $q$select public.create_staff_invitation('zz-v24-new@example.invalid', array['project_manager'], array['00000000-0000-4000-8000-0000000000ff']::uuid[])$q$, 'P0002');
select set_config('v24.inv', (select public.create_staff_invitation('zz-v24-new@example.invalid', array['project_manager'], array['00000000-0000-4000-8000-0000000000c1']::uuid[], 'ar', 'http://127.0.0.1:5174'))::text, true);
select v24_test.val('A13 invitation created with a token', $q$select (length(current_setting('v24.inv')::jsonb->>'token') >= 30)::text$q$, 'true');
select v24_test.val('A15 token is stored hashed only', $q$select (count(*) = 0)::text from public.staff_invitations where token_hash = current_setting('v24.inv')::jsonb->>'token'$q$, 'true');
select set_config('v24.inv', (select public.create_staff_invitation('zz-v24-new@example.invalid', array['project_manager']))::text, true);
select set_config('v24.inv', (select public.create_staff_invitation('zz-v24-new@example.invalid', array['project_manager','alumni_manager'], array['00000000-0000-4000-8000-0000000000c1']::uuid[], 'en', 'http://127.0.0.1:5174'))::text, true);
reset role;
-- (as postgres: app_private and auth are closed to the API roles)
select v24_test.val('A14 outbox row queued with the link (project/node NULL)', $q$select (o.status = 'queued' and o.body_html like '%/invite/staff/%' and o.project_id is null and o.node_id is null)::text from app_private.email_outbox o join public.staff_invitations i on i.outbox_id = o.id where i.id = (current_setting('v24.inv')::jsonb->>'id')::uuid$q$, 'true');
select v24_test.val('A16 a new invitation for the same e-mail revokes the previous ones and cancels their outbox rows', $q$select ((select count(*) from public.staff_invitations where email = 'zz-v24-new@example.invalid' and status = 'revoked') = 2 and (select count(*) from public.staff_invitations where email = 'zz-v24-new@example.invalid' and status = 'pending') = 1 and (select count(*) from app_private.email_outbox o join public.staff_invitations i on i.outbox_id = o.id where i.email = 'zz-v24-new@example.invalid' and i.status = 'revoked' and o.status = 'cancelled') = 2)::text$q$, 'true');

-- ================================================================= anon: validate only
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v24_test.val('N01 anon validate: valid token -> e-mail + inviter + expiry only', $q$select (v->>'valid' = 'true' and v->>'email' = 'zz-v24-new@example.invalid' and v->>'inviter_name' = 'V24 Admin' and v ? 'expires_at' and not (v ? 'roles') and not (v ? 'program_ids'))::text from public.validate_staff_invitation(current_setting('v24.inv')::jsonb->>'token') v$q$, 'true');
select v24_test.val('N02 anon validate: bad token -> valid:false, nothing else', $q$select (v->>'valid' = 'false' and not (v ? 'email'))::text from public.validate_staff_invitation('nope') v$q$, 'true');
select v24_test.fails('N03 anon cannot read staff_invitations', $q$select count(*) from public.staff_invitations$q$, '42501');
reset role;

-- ================================================================= trigger path: sign-up with the staff token (U3) and with a bad token (U4)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000b3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v24-new@example.invalid','{}',
  jsonb_build_object('full_name','V24 Invitee','profile_color','#A1B2C3','staff_invitation_token', current_setting('v24.inv')::jsonb->>'token'), now(), now()),
 ('00000000-0000-4000-8000-0000000000b4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v24-bad@example.invalid','{}',
  '{"full_name":"V24 Bad Token","staff_invitation_token":"not-a-real-token"}', now(), now());
select v24_test.val('T01 invitee: roles from the invitation, NO founder', $q$select string_agg(role_key, ',' order by role_key) from public.user_roles where user_id='00000000-0000-4000-8000-0000000000b3'$q$, 'alumni_manager,project_manager');
select v24_test.val('T02 invitee: program membership applied', $q$select member_role from public.program_members where user_id='00000000-0000-4000-8000-0000000000b3'$q$, 'manager');
select v24_test.val('T03 invitee: no founders row', $q$select count(*)::text from public.founders where auth_user_id='00000000-0000-4000-8000-0000000000b3'$q$, '0');
select v24_test.val('T04 invitee: profile colour stored lower-case', $q$select profile_color from public.profiles where id='00000000-0000-4000-8000-0000000000b3'$q$, '#a1b2c3');
select v24_test.val('T05 invitation marked accepted by the invitee', $q$select (status = 'accepted' and accepted_by = '00000000-0000-4000-8000-0000000000b3')::text from public.staff_invitations where id = (current_setting('v24.inv')::jsonb->>'id')::uuid$q$, 'true');
select v24_test.val('T06 bad token: profile created, NO role at all (never founder)', $q$select (exists (select 1 from public.profiles where id='00000000-0000-4000-8000-0000000000b4') and not exists (select 1 from public.user_roles where user_id='00000000-0000-4000-8000-0000000000b4'))::text$q$, 'true');
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000b5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v24-founder@example.invalid','{}','{"full_name":"V24 Founder"}', now(), now());
select v24_test.val('T08 plain self sign-up gets founder only', $q$select string_agg(role_key, ',') from public.user_roles where user_id='00000000-0000-4000-8000-0000000000b5'$q$, 'founder');

-- accept RPC as the invitee: already accepted by them -> accepted:true (idempotent); as another user -> accepted:false
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
set local role authenticated;
select v24_test.val('R01 accept again by the same user is idempotent', $q$select (public.accept_staff_invitation(current_setting('v24.inv')::jsonb->>'token')->>'accepted')$q$, 'true');
select v24_test.fails('R02 invitee (PM) cannot list staff', $q$select count(*) from public.list_staff()$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
set local role authenticated;
select v24_test.val('R03 another user cannot reuse the token', $q$select (public.accept_staff_invitation(current_setting('v24.inv')::jsonb->>'token')->>'accepted')$q$, 'false');
reset role;

-- ================================================================= super_admin: remove staff, revoke, last-admin guard
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select v24_test.okrun('Z01 remove staff (roles + memberships, user kept)', $q$select public.remove_staff('00000000-0000-4000-8000-0000000000b3')$q$);
select v24_test.fails('Z03 cannot remove yourself', $q$select public.remove_staff('00000000-0000-4000-8000-0000000000b1')$q$, '22023');
select set_config('v24.inv2', (select public.create_staff_invitation('zz-v24-rev@example.invalid', array['project_manager']))::text, true);
select v24_test.okrun('Z04 revoke a pending invitation', $q$select public.revoke_staff_invitation((current_setting('v24.inv2')::jsonb->>'id')::uuid)$q$);
reset role;
select v24_test.val('Z02 removed: no roles, no memberships, user and profile still exist', $q$select (not exists (select 1 from public.user_roles where user_id='00000000-0000-4000-8000-0000000000b3') and not exists (select 1 from public.program_members where user_id='00000000-0000-4000-8000-0000000000b3') and exists (select 1 from auth.users where id='00000000-0000-4000-8000-0000000000b3') and exists (select 1 from public.profiles where id='00000000-0000-4000-8000-0000000000b3'))::text$q$, 'true');
select v24_test.val('Z05 revoked token no longer validates; outbox cancelled', $q$select ((public.validate_staff_invitation(current_setting('v24.inv2')::jsonb->>'token')->>'valid') = 'false' and (select o.status from app_private.email_outbox o join public.staff_invitations i on i.outbox_id = o.id where i.id = (current_setting('v24.inv2')::jsonb->>'id')::uuid) = 'cancelled')::text$q$, 'true');

select current_setting('v24.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v24: staff management tests FAILED'; end $$;
\endif
