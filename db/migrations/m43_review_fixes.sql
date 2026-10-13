-- m43_review_fixes.sql  (independent review of m40 withdrawn + m41 WebP + m42 certificates per founder: every database finding, fixed at the root)
-- Re-runnable (create or replace / if not exists / patches that detect "already applied"). Local DB only. No business data is altered.
-- Run AFTER m42. m40 / m42 are NOT edited: each function below is replaced or patched IN PLACE on its CURRENT definition (the m37 technique).
--
--  1. THREE-VALUED LOGIC in authorisation guards (an `if not <expr that can be NULL> then raise` never raises):
--       request_withdrawal (a company-level participant has user_id NULL: ANY authenticated user could flag it), get_certificate_render_payload
--       (a certificate whose account was deleted has user_id NULL: any authenticated user read the full payload), cert_is_member (NULL -> false),
--       cert_issue_person (the re-issue guard), plus a catalogue audit of every `auth.role()` guard (`<>` -> `is distinct from`, `=` -> coalesce).
--  2. WITHDRAWN EXPERTS are project-wide: the flag is written on EVERY list_items row of the same expert in the project (the materialised copies of
--       a chained list included) and a BEFORE INSERT trigger copies it to a copy materialised later, so Booking / Distribution / Agenda / resolver all
--       see it through the one predicate. set_item_withdrawn is re-created on top of app_private.withdraw_item_core; the new set_items_withdrawn does a
--       BULK withdraw / reinstate in ONE atomic call (the client did 2N round trips).
--  3. create_booking (mentor mode) no longer trusts a client company id: a visitor cannot attribute a booking to a company.
--  4. link_my_participations links by a GENUINELY verified e-mail (app_private.auth_email_verified): with Auth "Confirm email" OFF the flag
--       email_confirmed_at is set at sign-up with no proof, so it is not trusted (the 12 migrated accounts all show that signature).
--  5. participants: the PM-internal columns (notes, needs_review, status_changed_by, source, source_node_id, created_by) are no longer readable by the
--       authenticated role (a founder reads his own row); certificates: UPDATE only on the three revocation columns; template rows are read only.
--  6. certificates: cert_claim takes the participant-level lock (a claim cannot race a participant revocation); the public verifier says `valid`
--       only for an ATTENDED participant (a withdrawn / un-marked one reads as revoked until reinstated); cert_verify_limit trusts the proxy hop only,
--       adds a global bucket and bounds its table.
--  7. storage: per-bucket extension allow-list (RESTRICTIVE policies): .html / .svg / .pdf can no longer be inserted into the image buckets.
--  8. merge_companies keeps a withdrawn status when two participants collapse and refuses a dropped participant that holds a certificate GRANT.
--  9. two audit-FK indexes (list_items.withdrawn_by, participant_withdrawals.withdrawn_by).
set search_path = public, extensions;

begin;

-- ================================================================= patch helpers (pg_temp)
-- replace an anchor in the CURRENT definition of a function (exactly `p_expect` hits); skip when the new text is already there
create or replace function pg_temp.m43_patch(p_fn regprocedure, p_old text, p_new text, p_expect int default 1) returns text
language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  if position(p_new in v_def) > 0 then return 'already  ' || p_fn::text; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_expect then raise exception 'm43_patch: % anchor found % times (expected %): %', p_fn, v_n, p_expect, left(p_old, 90); end if;
  execute replace(v_def, p_old, p_new);
  return 'patched   ' || p_fn::text;
end $$;

-- ================================================================= 1. three-valued logic
-- request_withdrawal: a company-level participant has user_id NULL, so `v.user_id = uid or v.company_id in (...)` was NULL for a stranger and the guard
-- did not raise. Every operand is now coalesced; the row is read WITHOUT a lock before the check (a stranger cannot hold a row lock).
create or replace function public.request_withdrawal(p_participant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.participants; v_uid uuid := (select auth.uid());
begin
  select * into v from public.participants where id = p_participant;
  if not found or v_uid is null
     or not (coalesce(v.user_id = v_uid, false) or coalesce(v.company_id in (select app_private.my_company_ids()), false)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.participants set withdrawal_requested_at = coalesce(withdrawal_requested_at, now()) where id = p_participant;
end $$;

-- cert_is_member never returns NULL (p.user_id is NULL for a company-level participant)
create or replace function app_private.cert_is_member(p public.participants, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_user is not null and (
    coalesce(p.user_id = p_user, false)
    or (p.company_id is not null and exists (
         select 1 from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
          where cf.company_id = p.company_id and f.auth_user_id = p_user))), false)
$$;
revoke all on function app_private.cert_is_member(public.participants, uuid) from public, anon, authenticated;

-- the render payload: a NULL operand of v_own (c.user_id of a deleted account, a missing participant) means NO
select pg_temp.m43_patch('public.get_certificate_render_payload(uuid)'::regprocedure,
$o$if not v_own then raise exception 'forbidden' using errcode = '42501'; end if;$o$,
$n$if not coalesce(v_own, false) then raise exception 'forbidden' using errcode = '42501'; end if;$n$);
-- the re-issue guard: an unlinked founder must give `not_linked` (certificate_not_linked), not a new certificate
select pg_temp.m43_patch('app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)'::regprocedure,
$o$if pa.status <> 'attended' or not app_private.cert_is_member(pa, p_user) then$o$,
$n$if pa.status is distinct from 'attended' or not coalesce(app_private.cert_is_member(pa, p_user), false) then$n$);

-- auth.role() guards (catalogue audit): through PostgREST the claim is always set, but a NULL role must still mean "refused"
select pg_temp.m43_patch(to_regprocedure(f), $o$if (select auth.role()) <> 'service_role' then$o$, $n$if (select auth.role()) is distinct from 'service_role' then$n$)
  from unnest(array['public.claim_email_batch(uuid,integer)', 'public.claim_integration_jobs(text,integer)', 'public.complete_email(uuid,text)', 'public.complete_job(uuid,jsonb)',
                    'public.fail_email(uuid,text,text,boolean)', 'public.fail_job(uuid,text)', 'public.release_integration_job(uuid,text,interval)']) f;
select pg_temp.m43_patch(to_regprocedure(f), $o$or (select auth.role()) = 'service_role')$o$, $n$or coalesce((select auth.role()) = 'service_role', false))$n$)
  from unnest(array['public.create_invitations(uuid,uuid[])', 'public.enqueue_email(uuid,text,uuid[],integer,boolean)']) f;
select pg_temp.m43_patch(to_regprocedure(f), $o$if not ((select auth.role()) = 'service_role' or app_private.is_super_admin()) then$o$,
                                          $n$if not (coalesce((select auth.role()) = 'service_role', false) or app_private.is_super_admin()) then$n$)
  from unnest(array['public.prune_email_bodies(interval)', 'public.purge_soft_deleted(interval)', 'public.report_orphan_assets()']) f;

-- ================================================================= 2. withdrawn experts are PROJECT-WIDE
-- The flag lives on list_items rows. An expert (a Network expert) can have several rows in a project (the Mentors list, a chained copy, a copy
-- feeding Distribution / Booking / an agenda presenter); withdrawing ONE of them must withdraw the person from EVERY consumer. So the mutation writes
-- the flag on every row of the same expert in the project, a BEFORE INSERT trigger copies it to a copy materialised later, and the single predicate
-- (app_private.is_withdrawn / item_is_withdrawn) needs no change. One advisory lock per (project, expert) serialises a withdraw with a materialisation.
create or replace function app_private.withdrawn_expert_lock(p_project uuid, p_expert uuid) returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('wd-expert|' || p_project::text || '|' || p_expert::text, 0))
$$;
revoke all on function app_private.withdrawn_expert_lock(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.list_items_inherit_withdrawn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.network_expert_id is not null and new.withdrawn_at is null then
    perform app_private.withdrawn_expert_lock(new.project_id, new.network_expert_id);
    select x.withdrawn_at, x.withdrawn_by, x.withdrawn_reason into new.withdrawn_at, new.withdrawn_by, new.withdrawn_reason
      from public.list_items x
     where x.project_id = new.project_id and x.network_expert_id = new.network_expert_id and x.withdrawn_at is not null
     order by x.withdrawn_at limit 1;
  end if;
  return new;
end $$;
revoke all on function app_private.list_items_inherit_withdrawn() from public, anon, authenticated;
drop trigger if exists list_items_bi_inherit_withdrawn on public.list_items;
create trigger list_items_bi_inherit_withdrawn before insert on public.list_items for each row execute function app_private.list_items_inherit_withdrawn();

-- heal any inconsistent state (a flagged row whose siblings are not): idempotent, 0 rows on a clean database
update public.list_items x set withdrawn_at = s.withdrawn_at, withdrawn_by = s.withdrawn_by, withdrawn_reason = s.withdrawn_reason
  from (select distinct on (project_id, network_expert_id) project_id, network_expert_id, withdrawn_at, withdrawn_by, withdrawn_reason
          from public.list_items where network_expert_id is not null and withdrawn_at is not null order by project_id, network_expert_id, withdrawn_at) s
 where x.project_id = s.project_id and x.network_expert_id = s.network_expert_id and x.withdrawn_at is null;

-- ONE item: m40's set_item_withdrawn body + the expert branch (every row of the expert in the project).
create or replace function app_private.withdraw_item_core(p_item uuid, p_withdrawn boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.list_items; n public.nodes; v_flag boolean := coalesce(p_withdrawn, true); v_pid uuid; v_res jsonb := '{}'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_pre record; v_copies int := 0;
begin
  select li.project_id, li.network_expert_id into v_pre from public.list_items li where li.id = p_item;
  if found and v_pre.network_expert_id is not null and app_private.is_project_manager(v_pre.project_id) then
    perform app_private.withdrawn_expert_lock(v_pre.project_id, v_pre.network_expert_id);     -- BEFORE the row locks below (one lock order for everybody)
  end if;
  v := app_private.item_for_write(p_item);                -- PM check + row lock
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'withdrawn_invalid: the reason is too long' using errcode = '22023', hint = 'withdrawn_invalid', detail = 'reason:too_long';
  end if;
  select * into n from public.nodes where id = v.list_node_id;
  if v.company_id is not null or v.form_response_id is not null then
    select x.id into v_pid from public.participants x
     where x.project_id = v.project_id
       and ((v.company_id is not null and x.company_id = v.company_id) or (v.company_id is null and x.form_response_id = v.form_response_id))
     order by (x.status = 'withdrawn') desc limit 1;
    if v_flag then
      if v_pid is null then
        insert into public.participants (project_id, company_id, form_response_id, source, source_node_id, status, created_by)
        values (v.project_id, v.company_id, case when v.company_id is null then v.form_response_id end,
                case when n.type = 'selection' then 'selection' else 'manual' end, case when n.type = 'selection' then n.id end,
                'withdrawn', (select auth.uid()))
        returning id into v_pid;
        insert into public.participant_withdrawals (participant_id, project_id, reason, restore_status, withdrawn_by)
        values (v_pid, v.project_id, v_reason, 'not_enrolled', (select auth.uid()));
        v_res := jsonb_build_object('participant_id', v_pid, 'status', 'withdrawn', 'removed', false);
      else
        v_res := app_private.apply_withdrawal(v_pid, true, v_reason);
      end if;
      update public.list_items set excluded = false where id = p_item and excluded;     -- a legacy "hidden" flag is converted
    elsif v_pid is not null then
      v_res := app_private.apply_withdrawal(v_pid, false, null);
    end if;
  elsif v.network_expert_id is not null then
    -- an expert: the flag on EVERY row of the same expert in the project (chained copies, presenter / provider / mentor references)
    if v_flag then
      update public.list_items set withdrawn_at = coalesce(withdrawn_at, now()), withdrawn_by = coalesce(withdrawn_by, (select auth.uid())),
             withdrawn_reason = coalesce(v_reason, withdrawn_reason), excluded = case when id = p_item then false else excluded end
       where project_id = v.project_id and network_expert_id = v.network_expert_id;
    else
      update public.list_items set withdrawn_at = null, withdrawn_by = null, withdrawn_reason = null
       where project_id = v.project_id and network_expert_id = v.network_expert_id and withdrawn_at is not null;
    end if;
    get diagnostics v_copies = row_count;
  elsif v_flag then
    update public.list_items set withdrawn_at = coalesce(withdrawn_at, now()), withdrawn_by = coalesce(withdrawn_by, (select auth.uid())),
           withdrawn_reason = coalesce(v_reason, withdrawn_reason), excluded = false where id = p_item;
  else
    update public.list_items set withdrawn_at = null, withdrawn_by = null, withdrawn_reason = null where id = p_item;
  end if;
  return v_res || jsonb_build_object('item_id', p_item, 'withdrawn', app_private.item_is_withdrawn(p_item), 'copies', v_copies);
end $$;
revoke all on function app_private.withdraw_item_core(uuid, boolean, text) from public, anon, authenticated;

create or replace function public.set_item_withdrawn(p_item uuid, p_withdrawn boolean default true, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return app_private.withdraw_item_core(p_item, p_withdrawn, p_reason);
end $$;
revoke all on function public.set_item_withdrawn(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_item_withdrawn(uuid, boolean, text) to authenticated;

-- BULK: many items in ONE atomic call (all or nothing: a forbidden / invalid item rolls the whole call back). The ids are processed in sorted order
-- so two concurrent calls take their locks in the same order. At most 500 per call.
create or replace function public.set_items_withdrawn(p_items uuid[], p_withdrawn boolean default true, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_rows jsonb := '[]'::jsonb; v_n int := 0;
begin
  if p_items is null or cardinality(p_items) = 0 then return jsonb_build_object('count', 0, 'results', '[]'::jsonb); end if;
  if cardinality(p_items) > 500 then
    raise exception 'withdrawn_invalid: at most 500 items per call' using errcode = '22023', hint = 'withdrawn_invalid', detail = 'items:too_many';
  end if;
  for v_id in select distinct x from unnest(p_items) x order by x loop
    v_rows := v_rows || jsonb_build_array(app_private.withdraw_item_core(v_id, p_withdrawn, p_reason));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('count', v_n, 'results', v_rows);
end $$;
revoke all on function public.set_items_withdrawn(uuid[], boolean, text) from public, anon, authenticated;
grant execute on function public.set_items_withdrawn(uuid[], boolean, text) to authenticated;

-- ================================================================= 3. create_booking (mentor mode): no client company id
-- Only a SIGNED-IN founder may name a company, and only one of his own that is not withdrawn; everybody else books under the typed company NAME.
select pg_temp.m43_patch('public.create_booking(text,uuid,jsonb,text)'::regprocedure,
$o$v_company uuid := nullif(p_booker->>'company_id', '')::uuid;$o$,
$n$v_company uuid;$n$);
select pg_temp.m43_patch('public.create_booking(text,uuid,jsonb,text)'::regprocedure,
$o$v_company_name := nullif(btrim(coalesce(p_booker->>'company_name', '')), '');$o$,
$n$v_company_name := nullif(btrim(coalesce(p_booker->>'company_name', '')), '');
    -- a visitor cannot attribute a booking to a company: only a signed-in founder naming one of HIS OWN companies (not withdrawn) is believed
    if coalesce(p_booker->>'company_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (select auth.uid()) is not null
       and (p_booker->>'company_id')::uuid in (select app_private.my_company_ids())
       and not app_private.is_withdrawn(n.project_id, null, (p_booker->>'company_id')::uuid, null) then
      v_company := (p_booker->>'company_id')::uuid;
    end if;$n$);

-- ================================================================= 4. link by a GENUINELY verified e-mail
-- Auth "Confirm email" ON: sign-up sends a confirmation (confirmation_sent_at is set) and the click sets email_confirmed_at AFTER it.
-- Auth "Confirm email" OFF: email_confirmed_at is set AT sign-up and nothing is sent (the 12 migrated accounts: confirmation_sent_at NULL, confirmed
-- within milliseconds of creation). So `email_confirmed_at is not null` proves nothing there; a confirmation that was SENT and then CLICKED does.
create or replace function app_private.auth_email_verified(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.email_confirmed_at is not null and u.confirmation_sent_at is not null and u.email_confirmed_at >= u.confirmation_sent_at
                     from auth.users u where u.id = p_user), false)
$$;
revoke all on function app_private.auth_email_verified(uuid) from public, anon, authenticated;
select pg_temp.m43_patch('app_private.link_my_participations()'::regprocedure,
$o$from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;$o$,
$n$from auth.users u where u.id = v_uid and app_private.auth_email_verified(u.id);$n$);

-- ================================================================= 5. column privileges
-- participants: a founder reads his own row (RLS) but not the PM-internal columns. PMs / alumni managers read them through the SECURITY DEFINER RPCs
-- (list_participants, get_selection_extras, get_certificates_admin) and the compat view below (notes through a definer helper).
revoke select on public.participants from authenticated;
grant select (id, project_id, company_id, user_id, form_response_id, status, status_changed_at, withdrawal_requested_at, created_at, updated_at)
  on public.participants to authenticated;

create or replace function app_private.participant_notes(p_participant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select pa.notes from public.participants pa
   where pa.id = p_participant and (app_private.is_project_manager(pa.project_id) or app_private.has_role('alumni_manager'))
$$;
revoke all on function app_private.participant_notes(uuid) from public, anon;
grant execute on function app_private.participant_notes(uuid) to authenticated;

create or replace view public.v_program_participations with (security_invoker = true) as
 select pa.id, pa.company_id, j.program_id, pa.project_id, pa.status as graduation_status,
        app_private.participant_notes(pa.id) as notes,
        (select min(d.day_date) from public.agenda_days d join public.nodes n on n.id = d.node_id and n.deleted_at is null where n.project_id = pa.project_id) as start_date,
        (select max(d.day_date) from public.agenda_days d join public.nodes n on n.id = d.node_id and n.deleted_at is null where n.project_id = pa.project_id) as end_date,
        pa.created_at, pa.updated_at
   from public.participants pa join public.projects j on j.id = pa.project_id
  where pa.company_id is not null;

-- certificates: the PM may only REVOKE (the three revocation columns); the frozen snapshot, the code, the account, the participant, the template and
-- the node cannot be rewritten through PostgREST. Templates and their fields change only through save_node (versioned, definer).
revoke update on public.certificates from authenticated;
grant update (revoked_at, revoked_by, revoked_reason) on public.certificates to authenticated;
revoke insert, update, delete on public.certificate_templates, public.certificate_template_fields from authenticated;

-- ================================================================= 6. certificates: lock, verifier, rate limit
-- a claim takes the SAME participant-level lock as issue / revoke (cert_issue_person then re-reads the grant under it): a claim that passed the grant
-- check can no longer commit an ACTIVE certificate under a grant that a concurrent participant revocation just revoked
select pg_temp.m43_patch('app_private.cert_claim(uuid,uuid)'::regprocedure,
$o$v_any := true;$o$,
$n$v_any := true;
    perform pg_advisory_xact_lock(hashtextextended(p_node::text || r.participant_id::text, 0));$n$);

-- the verifier: `valid` needs an ATTENDED participant (withdrawn / un-marked = not valid until reinstated; the row is untouched)
select pg_temp.m43_patch('public.get_public_certificate_verification(text)'::regprocedure,
$o$v_valid := c.revoked_at is null;$o$,
$n$v_valid := c.revoked_at is null and exists (select 1 from public.participants vp where vp.id = c.participant_id and vp.status = 'attended');$n$);

-- the rate-limit bucket: the proxy-trusted address only (Cloudflare's header, else the LAST hop of X-Forwarded-For = appended by the nearest proxy;
-- the leftmost entries are whatever the client sent). A GLOBAL bucket caps the whole endpoint (a spoofed header can no longer evade it), is checked
-- first (so spoofed addresses cannot grow the table) and expired buckets are purged regularly.
create or replace function app_private.cert_verify_limit() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_headers jsonb; v_xff text[]; v_ip text; v_hits int; v_total int;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_xff := string_to_array(coalesce(v_headers->>'x-forwarded-for', ''), ',');
  v_ip := coalesce(nullif(btrim(coalesce(v_headers->>'cf-connecting-ip', '')), ''),
                   nullif(btrim(coalesce(v_xff[cardinality(v_xff)], '')), ''),
                   nullif(btrim(coalesce(v_headers->>'x-real-ip', '')), ''), 'unknown');
  if random() < 0.05 then delete from app_private.certificate_verify_limits where window_start < now() - interval '10 minutes'; end if;
  insert into app_private.certificate_verify_limits (bucket, window_start, hits) values ('cert|*', now(), 1)
  on conflict (bucket) do update set
    hits = case when app_private.certificate_verify_limits.window_start < now() - interval '10 minutes' then 1 else app_private.certificate_verify_limits.hits + 1 end,
    window_start = case when app_private.certificate_verify_limits.window_start < now() - interval '10 minutes' then now() else app_private.certificate_verify_limits.window_start end
  returning hits into v_total;
  if v_total > 1500 then return false; end if;
  insert into app_private.certificate_verify_limits (bucket, window_start, hits) values (md5('cert|' || v_ip), now(), 1)
  on conflict (bucket) do update set
    hits = case when app_private.certificate_verify_limits.window_start < now() - interval '10 minutes' then 1 else app_private.certificate_verify_limits.hits + 1 end,
    window_start = case when app_private.certificate_verify_limits.window_start < now() - interval '10 minutes' then now() else app_private.certificate_verify_limits.window_start end
  returning hits into v_hits;
  return v_hits <= 40;
end $$;
revoke all on function app_private.cert_verify_limit() from public, anon, authenticated;

-- ================================================================= 7. storage: per-bucket extension allow-list
-- m41 blocks raster NAMES and mimetypes; this adds the positive list per bucket (a name outside it cannot be stored, whatever the permissive policies
-- say): public-assets = .webp, plus .svg ONLY under a logo folder (<owner>/logo/<id>.svg); founder-assets = .webp; resources = the library file types.
-- (form-uploads has its own whitelist, form_upload_allowed; certificate-templates is .webp only since m42.) Plain operators only: no function call.
drop policy if exists ext_allow_insert on storage.objects;
create policy ext_allow_insert on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('public-assets', 'founder-assets', 'resources')
    or (bucket_id = 'public-assets' and (name ~* '\.webp$' or name ~* '^[^/]+/logo/[^/]+\.svg$'))
    or (bucket_id = 'founder-assets' and name ~* '\.webp$')
    or (bucket_id = 'resources' and name ~* '\.(webp|pdf|docx|xlsx|pptx|mp3|m4a|wav|ogg|mp4)$'));
drop policy if exists ext_allow_update on storage.objects;
create policy ext_allow_update on storage.objects as restrictive for update to anon, authenticated
  with check (bucket_id not in ('public-assets', 'founder-assets', 'resources')
    or (bucket_id = 'public-assets' and (name ~* '\.webp$' or name ~* '^[^/]+/logo/[^/]+\.svg$'))
    or (bucket_id = 'founder-assets' and name ~* '\.webp$')
    or (bucket_id = 'resources' and name ~* '\.(webp|pdf|docx|xlsx|pptx|mp3|m4a|wav|ogg|mp4)$'));

-- ================================================================= 8. merge_companies
-- (a) the dropped company's WITHDRAWN status is carried to the kept participant when two participants of one project collapse; (b) a dropped participant
-- that holds a certificate GRANT (no certificate yet) is a manual-review case like one that holds a certificate (not a raw FK error).
select pg_temp.m43_patch('public.merge_companies(uuid,uuid)'::regprocedure,
$o$if exists (select 1 from public.certificates c where c.participant_id = r.id) then$o$,
$n$if exists (select 1 from public.certificates c where c.participant_id = r.id) or exists (select 1 from public.certificate_grants g where g.participant_id = r.id) then$n$);
select pg_temp.m43_patch('public.merge_companies(uuid,uuid)'::regprocedure,
$o$delete from public.participants where id = r.id;$o$,
$n$if exists (select 1 from public.participants pd where pd.id = r.id and pd.status = 'withdrawn') then
        perform app_private.apply_withdrawal((select k2.id from public.participants k2 where k2.project_id = r.project_id and k2.company_id = p_keep), true,
                                             (select w.reason from public.participant_withdrawals w where w.participant_id = r.id));
      end if;
      delete from public.participants where id = r.id;$n$);

-- ================================================================= 9. audit-FK indexes
create index if not exists list_items_withdrawn_by_idx on public.list_items (withdrawn_by) where withdrawn_by is not null;
create index if not exists participant_withdrawals_withdrawn_by_idx on public.participant_withdrawals (withdrawn_by) where withdrawn_by is not null;
-- the two foreign keys v02 / v10 reported without a leading index (non-audit): the timer's day and the composite (node, category) of a resource
create index if not exists distribution_timers_day_idx on public.distribution_timers (day_id) where day_id is not null;
create index if not exists resources_node_category_idx on public.resources (node_id, category_id) where category_id is not null;

-- ================================================================= self-check
do $$
declare v_def text;
begin
  for v_def in select pg_get_functiondef(p) from unnest(array['public.request_withdrawal(uuid)', 'app_private.cert_is_member(participants,uuid)']::regprocedure[]) p loop
    if v_def not like '%coalesce(%' then raise exception 'm43: a guard is not null-safe: %', left(v_def, 100); end if;
  end loop;
  if pg_get_functiondef('public.get_certificate_render_payload(uuid)'::regprocedure) not like '%not coalesce(v_own, false)%' then raise exception 'm43: render payload guard not patched'; end if;
  if pg_get_functiondef('app_private.cert_claim(uuid,uuid)'::regprocedure) not like '%pg_advisory_xact_lock(hashtextextended(p_node::text || r.participant_id::text%' then raise exception 'm43: cert_claim lock missing'; end if;
  if pg_get_functiondef('public.create_booking(text,uuid,jsonb,text)'::regprocedure) like '%v_company uuid := nullif(p_booker%' then raise exception 'm43: create_booking still trusts the client company'; end if;
  if pg_get_functiondef('app_private.link_my_participations()'::regprocedure) not like '%auth_email_verified%' then raise exception 'm43: link_my_participations not patched'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prokind = 'f' and p.prosrc like '%auth.role()) <> ''service_role''%') then
    raise exception 'm43: an auth.role() guard is still NULL-unsafe';
  end if;
  if to_regprocedure('public.set_items_withdrawn(uuid[],boolean,text)') is null or to_regprocedure('app_private.withdraw_item_core(uuid,boolean,text)') is null
     or to_regprocedure('app_private.auth_email_verified(uuid)') is null then raise exception 'm43: an object is missing'; end if;
  if has_function_privilege('anon', 'public.set_items_withdrawn(uuid[],boolean,text)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.withdraw_item_core(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.auth_email_verified(uuid)', 'EXECUTE') or has_function_privilege('anon', 'app_private.participant_notes(uuid)', 'EXECUTE') then
    raise exception 'm43: wrong function privileges';
  end if;
  if not has_function_privilege('authenticated', 'public.set_items_withdrawn(uuid[],boolean,text)', 'EXECUTE') then raise exception 'm43: authenticated must execute set_items_withdrawn'; end if;
  if has_column_privilege('authenticated', 'public.participants', 'notes', 'SELECT') or has_column_privilege('authenticated', 'public.participants', 'needs_review', 'SELECT')
     or has_column_privilege('authenticated', 'public.participants', 'status_changed_by', 'SELECT') or has_column_privilege('authenticated', 'public.participants', 'source_node_id', 'SELECT') then
    raise exception 'm43: the PM-internal participant columns are still readable';
  end if;
  if not has_column_privilege('authenticated', 'public.participants', 'status', 'SELECT') then raise exception 'm43: participants.status must stay readable'; end if;
  if has_column_privilege('authenticated', 'public.certificates', 'snapshot', 'UPDATE') or has_column_privilege('authenticated', 'public.certificates', 'user_id', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.certificates', 'revoked_at', 'UPDATE') then raise exception 'm43: certificates update privileges are wrong'; end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('ext_allow_insert', 'ext_allow_update') and permissive = 'RESTRICTIVE') <> 2 then
    raise exception 'm43: the extension allow-list policies are missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.list_items'::regclass and tgname = 'list_items_bi_inherit_withdrawn' and not tgisinternal) then raise exception 'm43: the inherit trigger is missing'; end if;
end $$;

commit;
