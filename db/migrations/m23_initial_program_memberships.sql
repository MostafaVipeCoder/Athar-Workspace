-- m23_initial_program_memberships.sql
-- Owner decision 2026-10-12 (docs/design/08-decisions-log.md §14):
-- every current project_manager becomes a member of ALL programs as a starting point.
-- Re-runnable (ON CONFLICT DO NOTHING). Local DB only. Recorded in migration.fixups.
begin;

insert into migration.fixups (entity, ref_id, column_name, new_value, reason, approved_by)
select 'program_members', ur.user_id::text || ':' || p.id::text, 'member_role', 'manager',
       'initial membership: all project_managers in all programs (owner 2026-10-12)', 'owner'
from public.user_roles ur
cross join public.programs p
where ur.role_key = 'project_manager'
  and p.deleted_at is null
  and not exists (select 1 from migration.fixups f
                  where f.entity = 'program_members'
                    and f.ref_id = ur.user_id::text || ':' || p.id::text);

insert into public.program_members (program_id, user_id, member_role, added_by)
select p.id, ur.user_id, 'manager',
       (select u.id from auth.users u where u.email = 'abdullah.shaban@athareg.com')
from public.user_roles ur
cross join public.programs p
where ur.role_key = 'project_manager'
  and p.deleted_at is null
on conflict (program_id, user_id) do nothing;

-- verify
do $$
declare v_pm int; v_prog int; v_members int;
begin
  select count(*) into v_pm from public.user_roles where role_key = 'project_manager';
  select count(*) into v_prog from public.programs where deleted_at is null;
  select count(*) into v_members from public.program_members;
  if v_members < v_pm * v_prog then
    raise exception 'm23: expected at least % memberships, found %', v_pm * v_prog, v_members;
  end if;
  raise notice 'm23 ok: % project_managers x % programs = % memberships', v_pm, v_prog, v_members;
end $$;

commit;
