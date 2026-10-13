-- m25_staff_founder_exclusivity.sql
-- Owner decision 2026-10-12 (docs/design/08-decisions-log.md section 15): a staff role (super_admin / project_manager /
-- alumni_manager) and `founder` are mutually exclusive per account.
-- Re-runnable (create or replace / drop trigger if exists). Local DB only. No business data is altered.
--
-- Guarantee: a BEFORE INSERT OR UPDATE row trigger on public.user_roles rejects any row that would make an account hold
-- both a staff role and `founder`. Every path that grants roles (set_staff_roles, apply_staff_invitation and therefore
-- handle_new_user + accept_staff_invitation, the founder self-signup, accept_invitation of the alumni platform, direct SQL)
-- goes through the table, so the trigger is the single guarantee; the RPCs add an explicit early check (same error) so a
-- rejected call never does partial work and the client gets one clear error.
--
-- Error contract (client: web/src/data/errors.js maps it to messageKey errors.staffFounderExclusive):
--   SQLSTATE 23514 (check_violation), MESSAGE starts with 'staff_founder_exclusive', DETAIL names the user id.
--   apply_staff_invitation does not raise for an existing founder account: it returns {accepted:false, reason:'founder_account'}
--   (the invite page shows the reason; the signup trigger path cannot hit it because a brand-new account has no role).
set search_path = public, extensions;

begin;

-- ================================================================= 1. helper: does the account hold a staff role / founder?
create or replace function app_private.holds_staff_role(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r join public.roles ro on ro.key = r.role_key where r.user_id = p_user and ro.is_staff)
$$;
revoke all on function app_private.holds_staff_role(uuid) from public, anon, authenticated;

create or replace function app_private.holds_founder_role(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r where r.user_id = p_user and r.role_key = 'founder')
$$;
revoke all on function app_private.holds_founder_role(uuid) from public, anon, authenticated;

-- ================================================================= 2. the guarantee: trigger on user_roles
create or replace function app_private.user_roles_exclusive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_is_staff boolean;
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.role_key = old.role_key then return new; end if;
  select ro.is_staff into v_is_staff from public.roles ro where ro.key = new.role_key;
  if new.role_key = 'founder' and app_private.holds_staff_role(new.user_id) then
    raise exception 'staff_founder_exclusive: a staff account cannot hold the founder role'
      using errcode = '23514', detail = 'user ' || new.user_id::text, hint = 'staff_founder_exclusive';
  end if;
  if coalesce(v_is_staff, false) and app_private.holds_founder_role(new.user_id) then
    raise exception 'staff_founder_exclusive: a founder account cannot hold a staff role'
      using errcode = '23514', detail = 'user ' || new.user_id::text, hint = 'staff_founder_exclusive';
  end if;
  return new;
end $$;
drop trigger if exists user_roles_biu_exclusive on public.user_roles;
create trigger user_roles_biu_exclusive before insert or update on public.user_roles
  for each row execute function app_private.user_roles_exclusive();

-- ================================================================= 3. RPCs re-check explicitly (same error, before any write)
create or replace function public.set_staff_roles(p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_staff text[] := app_private.staff_role_keys(); r text;
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'you cannot change your own roles' using errcode = '22023'; end if;
  if p_roles is null or not (p_roles <@ v_staff) then raise exception 'invalid staff role' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'user not found' using errcode = 'P0002'; end if;
  -- 08 section 15: a founder account never receives a staff role (the trigger guarantees it; this gives the clear error first)
  if cardinality(p_roles) > 0 and app_private.holds_founder_role(p_user) then
    raise exception 'staff_founder_exclusive: a founder account cannot hold a staff role'
      using errcode = '23514', detail = 'user ' || p_user::text, hint = 'staff_founder_exclusive';
  end if;
  delete from public.user_roles where user_id = p_user and role_key = any (v_staff) and not (role_key = any (p_roles));
  foreach r in array p_roles loop
    insert into public.user_roles (user_id, role_key, granted_by) values (p_user, r, (select auth.uid())) on conflict do nothing;
  end loop;
end $$;

-- the ONE place that turns an invitation into roles + memberships (m24); now refuses founder accounts with a reason
create or replace function app_private.apply_staff_invitation(p_user uuid, p_email text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.staff_invitations; r text; g uuid;
begin
  if p_user is null or p_token is null then return jsonb_build_object('accepted', false, 'reason', 'invalid'); end if;
  select * into i from public.staff_invitations x
   where x.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then return jsonb_build_object('accepted', false, 'reason', 'invalid'); end if;
  if i.status = 'accepted' then
    return jsonb_build_object('accepted', i.accepted_by = p_user, 'already', true, 'reason', case when i.accepted_by = p_user then null else 'used' end);
  end if;
  if i.status <> 'pending' then return jsonb_build_object('accepted', false, 'reason', 'revoked'); end if;
  if i.expires_at <= now() then return jsonb_build_object('accepted', false, 'reason', 'expired'); end if;
  if lower(i.email::text) <> lower(coalesce(p_email, '')) then return jsonb_build_object('accepted', false, 'reason', 'email_mismatch'); end if;
  -- 08 section 15: an account that holds `founder` cannot become staff (the invitation stays pending for another account)
  if app_private.holds_founder_role(p_user) then return jsonb_build_object('accepted', false, 'reason', 'founder_account'); end if;

  foreach r in array i.roles loop
    insert into public.user_roles (user_id, role_key, granted_by) values (p_user, r, i.invited_by) on conflict do nothing;
  end loop;
  foreach g in array i.program_ids loop
    insert into public.program_members (program_id, user_id, member_role, added_by)
    select g, p_user, 'manager', i.invited_by from public.programs p where p.id = g and p.deleted_at is null
    on conflict do nothing;
  end loop;
  update public.staff_invitations set status = 'accepted', accepted_at = now(), accepted_by = p_user where id = i.id;
  return jsonb_build_object('accepted', true, 'roles', to_jsonb(i.roles), 'program_ids', to_jsonb(i.program_ids));
end $$;
revoke all on function app_private.apply_staff_invitation(uuid, text, text) from public, anon, authenticated;

-- remove_staff (m24) is unchanged: with exclusivity a removed staff member has no founder role to keep, so the account
-- ends with no roles (08 section 15).

-- ================================================================= 4. self-check: no account violates the rule today
do $$
declare v_bad int;
begin
  select count(distinct r.user_id) into v_bad
    from public.user_roles r join public.roles ro on ro.key = r.role_key
   where ro.is_staff and exists (select 1 from public.user_roles f where f.user_id = r.user_id and f.role_key = 'founder');
  if v_bad > 0 then raise exception 'm25: % account(s) hold both a staff role and founder; resolve before applying', v_bad; end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_roles_biu_exclusive' and tgrelid = 'public.user_roles'::regclass) then
    raise exception 'm25: trigger missing';
  end if;
  raise notice 'm25 ok';
end $$;

commit;
