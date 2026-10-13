-- m11_load_roles_profiles_membership  (05 phase 3 + 4 membership; STAGE 2a, LOCAL ONLY)
-- profiles (12), user_roles with the owner's account decision (08 section 9): every account becomes project_manager EXCEPT
-- abdullah.shaban@athareg.com which stays super_admin; project_members / program_members from legacy.project_managers (0 rows).
-- auth.users / auth.identities / password hashes are NOT touched.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m11_load_roles_profiles_membership') as id;
\o /dev/null

-- ---------------------------------------------------------------- the owner decision is recorded as fixups (old value kept)
insert into migration.fixups (entity, ref_id, column_name, new_value, reason, approved_by)
select 'user_roles', ur.user_id::text, 'role_key', 'project_manager',
       'owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: '||ur.role::text||')',
       'owner 2026-10-11'
from legacy.user_roles ur
join auth.users u on u.id = ur.user_id
where ur.role::text = 'super_admin' and lower(u.email) <> 'abdullah.shaban@athareg.com'
on conflict (entity, ref_id, column_name) do nothing;

-- ---------------------------------------------------------------- profiles
insert into public.profiles (id, full_name, avatar_path, language, created_at, updated_at)
select p.id, p.full_name,
       migration.register_asset('avatar', null, p.avatar_url, 'profiles', p.id::text, 'avatar_path'),
       'ar', p.updated_at, p.updated_at
from legacy.profiles p
where exists (select 1 from auth.users u where u.id = p.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- user_roles (the fixup replaces the old role)
insert into public.user_roles (user_id, role_key, granted_by, created_at)
select ur.user_id,
       coalesce((select f.new_value from migration.fixups f where f.entity = 'user_roles' and f.ref_id = ur.user_id::text and f.column_name = 'role_key'),
                ur.role::text),
       null, least(ur.assigned_at, ur.created_at)
from legacy.user_roles ur
where exists (select 1 from auth.users u where u.id = ur.user_id)
on conflict (user_id, role_key) do nothing;

-- ---------------------------------------------------------------- membership from the old project_managers table (0 rows locally)
insert into public.project_members (project_id, user_id, member_role, added_by, created_at)
select coalesce(pm.project_id, pm.event_id), pm.user_id,
       case pm.role_in_project when 'owner' then 'owner' else 'manager' end,
       coalesce(pm.added_by, pm.assigned_by), coalesce(pm.added_at, pm.assigned_at)
from legacy.project_managers pm
where exists (select 1 from public.projects j where j.id = coalesce(pm.project_id, pm.event_id))
  and exists (select 1 from auth.users u where u.id = pm.user_id)
on conflict (project_id, user_id) do nothing;

-- open item: project managers for whom there is no data to derive a membership (never guessed)
select migration.flag('pm_without_membership', 'review', 'user', ur.user_id::text,
       'project_manager account with no program/project membership: legacy.project_managers is empty and events carry no created_by, '
       || 'so nothing can be derived; the account sees no program or project until a super_admin adds it as a member (03 section 3.2)')
from public.user_roles ur
where ur.role_key = 'project_manager'
  and not exists (select 1 from public.project_members m where m.user_id = ur.user_id)
  and not exists (select 1 from public.program_members m where m.user_id = ur.user_id);

-- ================================================================= verification
select migration.check((select id from _r), 'V03.2 profiles = legacy', (select count(*)::text from legacy.profiles), (select count(*)::text from public.profiles));
select migration.check((select id from _r), 'V03.2 user_roles = legacy', (select count(*)::text from legacy.user_roles), (select count(*)::text from public.user_roles));
select migration.check((select id from _r), 'V03.2 every auth user has profile and role', '0',
  (select count(*)::text from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id) or not exists (select 1 from public.user_roles r where r.user_id = u.id)));
select migration.check((select id from _r), 'V03.4 super_admin accounts', '1', (select count(*)::text from public.user_roles where role_key = 'super_admin'));
select migration.check((select id from _r), 'V03.4 owner account is super_admin', '1',
  (select count(*)::text from public.user_roles r join auth.users u on u.id = r.user_id where r.role_key = 'super_admin' and lower(u.email) = 'abdullah.shaban@athareg.com'));
select migration.check((select id from _r), 'V03.4 project_manager accounts', ((select count(*) from legacy.user_roles) - 1)::text,
  (select count(*)::text from public.user_roles where role_key = 'project_manager'));
select migration.check((select id from _r), 'V03.5 no account holds two roles', '0',
  (select count(*)::text from (select user_id from public.user_roles group by 1 having count(*) > 1) x));
select migration.check((select id from _r), 'V03.5 no founder role created', '0', (select count(*)::text from public.user_roles where role_key = 'founder'));
select migration.check((select id from _r), 'V01.4 auth.users untouched (count)', (select row_count::text from migration.baseline where table_name = 'auth.users'), (select count(*)::text from auth.users));
select migration.check((select id from _r), 'V01.4 auth password fingerprint unchanged', (select value from migration.state where key = 'auth_pw_md5'),
  (select md5(coalesce(string_agg(encrypted_password, ',' order by id), '')) from auth.users));
select migration.check((select id from _r), 'V04.7 project_members = legacy project_managers (loadable)',
  (select count(*)::text from legacy.project_managers pm where exists (select 1 from public.projects j where j.id = coalesce(pm.project_id, pm.event_id))),
  (select count(*)::text from public.project_members));
select migration.check_design((select id from _r), 'D03.1 design: user_roles 12 / profiles 12 / members 0', '12/12/0',
  (select (select count(*) from public.user_roles) || '/' || (select count(*) from public.profiles) || '/' || (select count(*) from public.project_members)));
select migration.check_design((select id from _r), 'D03.2 open items: PMs without membership', '11',
  (select count(*)::text from migration.flags where code = 'pm_without_membership' and resolved_at is null));

select migration.finish_run((select id from _r));
\o
select check_key, expected, actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
