-- m50_alumni_founder_pages: the three small SQL needs of the founder-side Alumni pages (design 09 section 1.2: F1 / F2 / F7 / F8; builder task of 2026-10-14).
-- Re-runnable (create or replace / drop trigger if exists). Run AFTER m49.
--
--  1. public.validate_invitation  : ADDITIVE keys for the /invite/:token page ("who invited you", when it expires, the company name in both languages).
--                                   The existing keys (valid, company_name, masked_email) and the grants (anon + authenticated) are unchanged.
--  2. opportunity_applications    : a BEFORE INSERT guard. The RLS insert policy (m03) only checks the company / founder ownership, so a founder could insert an
--                                   application with ANY status ("accepted"), for an inactive or expired opportunity, with a huge note. For a non-manager the guard
--                                   forces status = 'applied', applied_at = now(), the caller's own founder id, a note of at most 1000 characters, and refuses an
--                                   inactive opportunity or a deadline before today (Cairo). Managers (the status writers, RLS update policy) and the service role are untouched.
--  4. alumni_stale                : `alumni_stale` was raised with SQLSTATE 40001 (serialization_failure). PostgREST 14 RETRIES a transaction that fails with 40001 until it succeeds, so a
--                                   stale save (two founders editing the same company) made the request spin FOR EVER, a hot loop of BEGIN / call / error on the database (found while
--                                   verifying the founder company page in the browser). Both savers (`save_my_company_profile`, `save_alumni_company`) now raise it with SQLSTATE P0001
--                                   (the token is the `hint`, unchanged: the client keys on `alumni_stale`, never on the code). NOTE for the lead: m06b `save_node` raises its revision conflict
--                                   with 40001 too (not touched here: outside this task).
--  3. notifications               : a BEFORE UPDATE guard. The RLS update policy lets the recipient change every column of his own notification; the founder page only
--                                   marks it read. For a non-manager only `is_read` may change (the manager's message cannot be rewritten by its reader).
--
-- Nothing is stored twice, no column is added, no data is touched. Error tokens (message prefix = hint): `opportunity_closed` (22023), `alumni_invalid` detail
-- `notes:too_long` (22023), `forbidden` (42501).

-- ================================================================= 1. validate_invitation: + inviter_name, expires_at, company_name_en / _ar
create or replace function public.validate_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.alumni_invitations; c public.companies; e text; v_inviter text;
begin
  select * into i from public.alumni_invitations x
   where x.token = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and x.status = 'pending' and x.sent_at + interval '14 days' > now();
  if not found then return jsonb_build_object('valid', false); end if;
  select * into c from public.companies co where co.id = i.company_id and co.deleted_at is null;
  e := regexp_replace(i.founder_email, '^(.).*(@.*)$', '\1***\2');
  select nullif(btrim(p.full_name), '') into v_inviter from public.profiles p where p.id = i.sent_by;
  return jsonb_build_object('valid', true, 'company_name', coalesce(c.name_en, c.name_ar), 'company_name_en', c.name_en, 'company_name_ar', c.name_ar,
                            'masked_email', e, 'inviter_name', v_inviter, 'expires_at', i.sent_at + interval '14 days');
end $$;

-- ================================================================= 2. opportunity_applications: a founder cannot forge the status or apply to a closed opportunity
create or replace function app_private.opportunity_applications_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.opportunities; v_uid uuid := (select auth.uid()); v_note text;
begin
  -- the service role / a migration (no JWT) and the managers keep full control of the row
  if v_uid is null or app_private.alumni_is_manager() then return new; end if;
  select * into o from public.opportunities x where x.opportunity_id = new.opportunity_id;
  if not found or not o.is_active or (o.deadline is not null and o.deadline < app_private.alumni_today()) then
    raise exception 'opportunity_closed: this opportunity is not open for applications' using errcode = '22023', hint = 'opportunity_closed';
  end if;
  v_note := nullif(btrim(coalesce(new.notes, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'alumni_invalid: notes:too_long' using errcode = '22023', hint = 'alumni_invalid', detail = 'notes:too_long';
  end if;
  new.notes := v_note;
  new.status := 'applied';
  new.applied_at := now();
  if new.founder_id is null then
    select f.id into new.founder_id from public.founders f where f.auth_user_id = v_uid and f.deleted_at is null;
  end if;
  return new;
end $$;
drop trigger if exists opportunity_applications_bi_guard on public.opportunity_applications;
create trigger opportunity_applications_bi_guard before insert on public.opportunity_applications for each row execute function app_private.opportunity_applications_guard();

-- ================================================================= 3. notifications: the reader of a notification may only mark it read
create or replace function app_private.notifications_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or app_private.alumni_is_manager() then return new; end if;
  if (new.recipient_id, new.founder_id, new.title, new.body, new.created_at, new.sent_by, new.audience_type, new.audience_target_id, new.broadcast_id, new.metadata)
     is distinct from (old.recipient_id, old.founder_id, old.title, old.body, old.created_at, old.sent_by, old.audience_type, old.audience_target_id, old.broadcast_id, old.metadata) then
    raise exception 'forbidden: a notification can only be marked read' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists notifications_bu_guard on public.notifications;
create trigger notifications_bu_guard before update on public.notifications for each row execute function app_private.notifications_guard();

-- ================================================================= 4. alumni_stale must NOT be a serialization failure (PostgREST retries 40001 forever)
do $$
declare f regprocedure; v_def text; v_new text;
begin
  foreach f in array array['public.save_my_company_profile(uuid,jsonb,timestamptz)'::regprocedure, 'public.save_alumni_company(uuid,jsonb,timestamptz)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_new := replace(v_def, 'errcode = ''40001'', hint = ''alumni_stale''', 'errcode = ''P0001'', hint = ''alumni_stale''');
    if v_new <> v_def then
      execute v_new;
      raise notice 'm50: % now raises alumni_stale with P0001', f;
    elsif position('errcode = ''P0001'', hint = ''alumni_stale''' in v_def) = 0 then
      raise exception 'm50: % has no alumni_stale raise to patch', f;
    end if;
  end loop;
end $$;

-- ================================================================= grants: the two trigger functions are closed to every API role (a trigger does not need EXECUTE to fire)
revoke all on function app_private.opportunity_applications_guard() from public, anon, authenticated;
revoke all on function app_private.notifications_guard() from public, anon, authenticated;
revoke all on function public.validate_invitation(text) from public, anon, authenticated;
grant execute on function public.validate_invitation(text) to anon, authenticated;

-- ================================================================= self-check
do $$
begin
  if not has_function_privilege('anon', 'public.validate_invitation(text)', 'EXECUTE') then raise exception 'm50: anon must keep validate_invitation'; end if;
  if has_function_privilege('anon', 'app_private.opportunity_applications_guard()', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.notifications_guard()', 'EXECUTE') then
    raise exception 'm50: a guard function is executable by an API role';
  end if;
  if (select count(*) from pg_trigger where tgname in ('opportunity_applications_bi_guard', 'notifications_bu_guard') and not tgisinternal) <> 2 then raise exception 'm50: guard triggers missing'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.proname ~ '(alumni|invitation|snapshot)' and p.prosrc like '%errcode = ''40001''%') then
    raise exception 'm50: an alumni function still raises SQLSTATE 40001';
  end if;
  raise notice 'm50 ok';
end $$;
