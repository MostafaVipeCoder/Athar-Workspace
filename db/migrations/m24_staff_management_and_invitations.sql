-- m24_staff_management_and_invitations.sql
-- Owner decision 2026-10-12 (docs/design/08-decisions-log.md section 14): super_admin staff management + staff invitations.
-- Re-runnable (if not exists / create or replace / drop policy if exists). Local DB only. No business data is altered.
--
-- What it adds
--   1. profiles.profile_color (hex colour chosen by the user; replaces the dropped avatar_color, 04 section 3.1)
--   2. app_private.storage_project_manager also accepts a PROGRAM id as first folder (program covers live under
--      public-assets/<program_id>/cover/<uuid>.webp, same thumbnail convention as stage 2b: <uuid>_t.webp)
--   3. public.staff_invitations (token hashed, e-mail, roles, program ids, inviter, expiry, status)  RLS family ID (super_admin)
--   4. app_private.email_outbox may hold platform e-mails that belong to no project/node (staff_invitation): the three
--      NOT NULL columns become nullable under a CHECK that keeps every node e-mail fully scoped (deviation from 04 3.14,
--      recorded in db/MIGRATION-LOG.md)
--   5. RPCs: list_staff, set_staff_roles, set_program_memberships, remove_staff, create_staff_invitation,
--      revoke_staff_invitation (super_admin); validate_staff_invitation (anon); accept_staff_invitation (authenticated)
--   6. handle_new_user: a sign-up that carries user_metadata.staff_invitation_token NEVER receives the founder role;
--      the trigger applies the invitation (same internal function as accept_staff_invitation) when the token is valid.
--      Mechanism chosen: token in user_metadata is only a HINT ("this is a staff sign-up"); authority comes from the
--      hashed invitation row (status, expiry, same e-mail), never from metadata. An invalid token yields an account with
--      NO roles (the app shows /no-access), never a founder.
set search_path = public, extensions;

begin;

-- ================================================================= 1. profiles.profile_color
alter table public.profiles add column if not exists profile_color text;
alter table public.profiles drop constraint if exists profiles_profile_color_chk;
alter table public.profiles add constraint profiles_profile_color_chk
  check (profile_color is null or profile_color ~ '^#[0-9a-f]{6}$');

-- ================================================================= 2. storage: program folders
create or replace function app_private.storage_project_manager(p_folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then app_private.is_project_manager(p_folder::uuid) or app_private.is_program_member(p_folder::uuid)
              else false end
$$;

-- ================================================================= 3. staff_invitations
create table if not exists public.staff_invitations (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null,
  token_hash   text not null unique,
  roles        text[] not null,
  program_ids  uuid[] not null default '{}',
  language     text not null default 'en' check (language in ('ar','en')),
  invited_by   uuid references auth.users(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','accepted','revoked')),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz,
  outbox_id    uuid,
  created_at   timestamptz not null default now(),
  constraint staff_invitations_roles_chk check (cardinality(roles) >= 1
    and roles <@ array['super_admin','project_manager','alumni_manager']::text[]),
  constraint staff_invitations_email_chk check (email::text ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index if not exists staff_invitations_pending_email_uidx on public.staff_invitations (email) where status = 'pending';
create index if not exists staff_invitations_status_idx on public.staff_invitations (status, created_at desc);

alter table public.staff_invitations enable row level security;
alter table public.staff_invitations force row level security;
drop policy if exists staff_invitations_select_admin on public.staff_invitations;
create policy staff_invitations_select_admin on public.staff_invitations for select to authenticated
  using ((select app_private.is_super_admin()));
-- writes: RPC only (no insert/update/delete policy)
revoke all on public.staff_invitations from public, anon, authenticated;
grant select on public.staff_invitations to authenticated;

-- ================================================================= 4. email_outbox: platform e-mails without a node
alter table app_private.email_outbox alter column project_id drop not null;
alter table app_private.email_outbox alter column node_id drop not null;
alter table app_private.email_outbox alter column sender_connection_id drop not null;
alter table app_private.email_outbox drop constraint if exists email_outbox_scope_chk;
alter table app_private.email_outbox add constraint email_outbox_scope_chk check (
  (project_id is not null and node_id is not null and sender_connection_id is not null)
  or (email_key in ('staff_invitation') and project_id is null and node_id is null));

-- ================================================================= 5. helpers
create or replace function app_private.staff_role_keys() returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(key order by key), '{}') from public.roles where is_staff
$$;

-- bilingual e-mail body for a staff invitation (template lives here so the outbox row is the audit copy, 04 1.3)
create or replace function app_private.staff_invitation_email(p_lang text, p_inviter text, p_link text, p_expires timestamptz,
                                                             out subject text, out body_html text)
language plpgsql immutable set search_path = '' as $$
declare v_exp text := to_char(p_expires at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI');
begin
  if p_lang = 'ar' then
    subject := 'دعوة للانضمام إلى فريق أثر';
    body_html := '<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;font-size:15px;line-height:1.7">'
      || '<p>مرحباً،</p><p>دعاك <strong>' || p_inviter || '</strong> للانضمام إلى منصة أثر كعضو في الفريق.</p>'
      || '<p><a href="' || p_link || '" style="display:inline-block;padding:10px 18px;background:#1A27C9;color:#fff;border-radius:8px;text-decoration:none">قبول الدعوة</a></p>'
      || '<p>أو افتح الرابط: <a href="' || p_link || '">' || p_link || '</a></p>'
      || '<p>تنتهي صلاحية الدعوة في ' || v_exp || ' (توقيت القاهرة).</p></div>';
  else
    subject := 'You are invited to the Athar team';
    body_html := '<div dir="ltr" style="font-family:Manrope,Arial,sans-serif;font-size:15px;line-height:1.7">'
      || '<p>Hello,</p><p><strong>' || p_inviter || '</strong> invited you to join the Athar platform as a staff member.</p>'
      || '<p><a href="' || p_link || '" style="display:inline-block;padding:10px 18px;background:#1A27C9;color:#fff;border-radius:8px;text-decoration:none">Accept the invitation</a></p>'
      || '<p>Or open this link: <a href="' || p_link || '">' || p_link || '</a></p>'
      || '<p>The invitation expires on ' || v_exp || ' (Cairo time).</p></div>';
  end if;
end $$;

-- the ONE place that turns an invitation into roles + memberships (used by the signup trigger and by accept_staff_invitation)
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

-- ================================================================= 6. RPCs (super_admin)
create or replace function public.list_staff() returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select jsonb_build_object(
      'id', u.id, 'email', u.email, 'full_name', p.full_name, 'profile_color', p.profile_color, 'avatar_path', p.avatar_path,
      'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'roles', (select coalesce(jsonb_agg(r.role_key order by r.role_key), '[]'::jsonb) from public.user_roles r where r.user_id = u.id),
      'programs', (select coalesce(jsonb_agg(jsonb_build_object('program_id', m.program_id, 'member_role', m.member_role) order by m.created_at), '[]'::jsonb)
                   from public.program_members m where m.user_id = u.id))
    from auth.users u
    left join public.profiles p on p.id = u.id
    where exists (select 1 from public.user_roles r join public.roles ro on ro.key = r.role_key where r.user_id = u.id and ro.is_staff)
    order by lower(coalesce(p.full_name, u.email::text));
end $$;

create or replace function public.set_staff_roles(p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_staff text[] := app_private.staff_role_keys(); r text;
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'you cannot change your own roles' using errcode = '22023'; end if;
  if p_roles is null or not (p_roles <@ v_staff) then raise exception 'invalid staff role' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'user not found' using errcode = 'P0002'; end if;
  delete from public.user_roles where user_id = p_user and role_key = any (v_staff) and not (role_key = any (p_roles));
  foreach r in array p_roles loop
    insert into public.user_roles (user_id, role_key, granted_by) values (p_user, r, (select auth.uid())) on conflict do nothing;
  end loop;
end $$;

create or replace function public.set_program_memberships(p_user uuid, p_program_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_roles r join public.roles ro on ro.key = r.role_key where r.user_id = p_user and ro.is_staff) then
    raise exception 'the user must hold a staff role' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_program_ids, '{}')) x(id) where not exists (select 1 from public.programs p where p.id = x.id and p.deleted_at is null)) then
    raise exception 'program not found' using errcode = 'P0002';
  end if;
  delete from public.program_members where user_id = p_user and not (program_id = any (coalesce(p_program_ids, '{}')));
  foreach g in array coalesce(p_program_ids, '{}') loop
    insert into public.program_members (program_id, user_id, member_role, added_by) values (g, p_user, 'manager', (select auth.uid()))
    on conflict do nothing;                       -- an existing owner keeps owner
  end loop;
end $$;

-- revokes staff roles and every membership; the auth user, profile and a possible founder role stay
create or replace function public.remove_staff(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'you cannot remove yourself' using errcode = '22023'; end if;
  delete from public.user_roles where user_id = p_user and role_key = any (app_private.staff_role_keys());  -- guard: last super_admin
  delete from public.program_members where user_id = p_user;
  delete from public.project_members where user_id = p_user;
end $$;

create or replace function public.create_staff_invitation(
  p_email text, p_roles text[], p_program_ids uuid[] default '{}', p_language text default 'en', p_app_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token text; v_inv public.staff_invitations; v_link text; v_inviter text; v_mail record; v_out uuid; v_lang text;
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid e-mail' using errcode = '22023'; end if;
  if p_roles is null or cardinality(p_roles) = 0 or not (p_roles <@ app_private.staff_role_keys()) then
    raise exception 'invalid staff role' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_program_ids, '{}')) x(id) where not exists (select 1 from public.programs p where p.id = x.id and p.deleted_at is null)) then
    raise exception 'program not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = lower(p_email)) then
    raise exception 'a user with this e-mail already exists' using errcode = '23505';
  end if;
  if p_app_url is not null and p_app_url !~* '^https?://[^\s]+$' then raise exception 'invalid app url' using errcode = '22023'; end if;
  v_lang := case when p_language = 'ar' then 'ar' else 'en' end;

  -- one pending invitation per e-mail: a new one replaces (revokes) the previous
  update public.staff_invitations set status = 'revoked', revoked_at = now() where email = p_email::extensions.citext and status = 'pending';
  update app_private.email_outbox o set status = 'cancelled'
    from public.staff_invitations i where i.outbox_id = o.id and i.email = p_email::extensions.citext and i.status = 'revoked' and o.status = 'queued';

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');  -- base64url, returned once
  insert into public.staff_invitations (email, token_hash, roles, program_ids, language, invited_by)
  values (p_email::extensions.citext, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_roles, coalesce(p_program_ids, '{}'), v_lang, (select auth.uid()))
  returning * into v_inv;

  select coalesce(nullif(btrim(p.full_name), ''), u.email::text) into v_inviter
    from auth.users u left join public.profiles p on p.id = u.id where u.id = (select auth.uid());
  v_link := coalesce(rtrim(p_app_url, '/'), '') || '/invite/staff/' || v_token;
  select * into v_mail from app_private.staff_invitation_email(v_lang, v_inviter, v_link, v_inv.expires_at);

  -- design 07: queue in the outbox (delivery worker is not wired yet; the admin UI also offers "copy invitation link")
  insert into app_private.email_outbox (email_key, recipient_email, subject, body_html, idempotency_key, created_by)
  values ('staff_invitation', p_email::extensions.citext, v_mail.subject, v_mail.body_html, 'staff_invitation:' || v_inv.id, (select auth.uid()))
  returning id into v_out;
  update public.staff_invitations set outbox_id = v_out where id = v_inv.id;

  return jsonb_build_object('id', v_inv.id, 'email', v_inv.email, 'token', v_token, 'expires_at', v_inv.expires_at,
                            'roles', to_jsonb(v_inv.roles), 'program_ids', to_jsonb(v_inv.program_ids));
end $$;

create or replace function public.revoke_staff_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.staff_invitations set status = 'revoked', revoked_at = now() where id = p_id and status = 'pending';
  if not found then raise exception 'invitation not found or not pending' using errcode = 'P0002'; end if;
  update app_private.email_outbox o set status = 'cancelled'
    from public.staff_invitations i where i.id = p_id and i.outbox_id = o.id and o.status = 'queued';
end $$;

-- ================================================================= 7. RPCs (anon / authenticated)
-- returns ONLY e-mail + inviter name + expiry (never the roles/programs; those are applied server-side on accept)
create or replace function public.validate_staff_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.staff_invitations; v_inviter text;
begin
  select * into i from public.staff_invitations x
   where x.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and x.status = 'pending' and x.expires_at > now();
  if not found then return jsonb_build_object('valid', false); end if;
  select coalesce(nullif(btrim(p.full_name), ''), 'Athar') into v_inviter from public.profiles p where p.id = i.invited_by;
  return jsonb_build_object('valid', true, 'email', i.email, 'inviter_name', coalesce(v_inviter, 'Athar'), 'expires_at', i.expires_at, 'language', i.language);
end $$;

create or replace function public.accept_staff_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  return app_private.apply_staff_invitation(v_uid, v_email, p_token);
end $$;

-- ================================================================= 8. handle_new_user (03 4.4 + staff rule)
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_color text;
  v_provisioned boolean;
  v_token text;
  v_inv public.alumni_invitations;
  v_founder uuid;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'User');
  v_color := lower(nullif(btrim(new.raw_user_meta_data->>'profile_color'), ''));
  if v_color !~ '^#[0-9a-f]{6}$' then v_color := null; end if;
  insert into public.profiles (id, full_name, profile_color) values (new.id, v_name, v_color) on conflict (id) do nothing;

  -- staff accounts are created by the admin API with app_metadata.provisioned = true: no automatic role
  v_provisioned := coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false);
  if v_provisioned then return new; end if;

  -- staff invitation sign-up (08 section 14): NEVER founder. The token is a hint; authority is the hashed invitation row.
  -- A bad/expired token leaves the account with no role at all (the app shows /no-access), never a founder.
  if new.raw_user_meta_data ? 'staff_invitation_token' then
    begin
      perform app_private.apply_staff_invitation(new.id, new.email, new.raw_user_meta_data->>'staff_invitation_token');
    exception when others then null; end;
    return new;
  end if;

  -- self signup: the role is ALWAYS the literal 'founder' (never read from user_metadata)
  begin
    insert into public.user_roles (user_id, role_key) values (new.id, 'founder') on conflict do nothing;
    insert into public.founders (name_ar, name_en, email, auth_user_id)
      values (v_name, v_name, new.email, new.id)
      returning id into v_founder;
  exception when others then
    -- never block signup (e.g. an unlinked founders row with the same e-mail exists: no automatic linking by e-mail)
    begin
      insert into public.user_roles (user_id, role_key) values (new.id, 'founder') on conflict do nothing;
    exception when others then null; end;
  end;

  -- optional invitation: token hash, pending, <= 14 days, same e-mail, single use (row lock)
  v_token := new.raw_user_meta_data->>'invitation_token';
  if v_token is not null and v_founder is not null then
    begin
      select * into v_inv from public.alumni_invitations i
       where i.token = encode(extensions.digest(v_token, 'sha256'), 'hex')
         and i.status = 'pending'
         and i.sent_at + interval '14 days' > now()
         and lower(i.founder_email) = lower(coalesce(new.email, ''))
       for update;
      if found then
        insert into public.company_founders (company_id, founder_id, role, is_primary)
          values (v_inv.company_id, v_founder, 'founder', false) on conflict do nothing;
        update public.alumni_invitations set status = 'accepted', accepted_at = now(), founder_id = v_founder where id = v_inv.id;
      end if;
    exception when others then null; end;
  end if;
  return new;
end $$;

-- ================================================================= 9. grants (explicit; default is nobody)
revoke all on function public.list_staff() from public, anon, authenticated;
revoke all on function public.set_staff_roles(uuid, text[]) from public, anon, authenticated;
revoke all on function public.set_program_memberships(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.remove_staff(uuid) from public, anon, authenticated;
revoke all on function public.create_staff_invitation(text, text[], uuid[], text, text) from public, anon, authenticated;
revoke all on function public.revoke_staff_invitation(uuid) from public, anon, authenticated;
revoke all on function public.validate_staff_invitation(text) from public, anon, authenticated;
revoke all on function public.accept_staff_invitation(text) from public, anon, authenticated;
revoke all on function app_private.staff_role_keys() from public, anon, authenticated;
revoke all on function app_private.staff_invitation_email(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.list_staff(), public.set_staff_roles(uuid, text[]), public.set_program_memberships(uuid, uuid[]),
  public.remove_staff(uuid), public.create_staff_invitation(text, text[], uuid[], text, text), public.revoke_staff_invitation(uuid),
  public.accept_staff_invitation(text) to authenticated;
grant execute on function public.validate_staff_invitation(text) to anon, authenticated;

-- ================================================================= 10. self-check
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'profile_color') then
    raise exception 'm24: profiles.profile_color missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff_invitations') then
    raise exception 'm24: staff_invitations policy missing';
  end if;
  if not has_function_privilege('anon', 'public.validate_staff_invitation(text)', 'EXECUTE') then raise exception 'm24: anon grant missing'; end if;
  if has_function_privilege('anon', 'public.accept_staff_invitation(text)', 'EXECUTE') then raise exception 'm24: anon must not accept'; end if;
  raise notice 'm24 ok';
end $$;

commit;
