-- m65_remove_alumni_audit_log.sql  (owner decision 21, 2026-10-15: NO per-edit history; replaces the m60 / m64 audit log, decision 20.4 working default)
-- Re-runnable (drop ... if exists / create or replace / every step checks itself). Local DB only. Run AFTER m60 .. m64 and BEFORE m66 (the quarterly model).
-- Verify with db/verify/v65_remove_alumni_audit_log.sql.
--
-- WHY: a typo fixed five minutes later (10,000 -> 100,000) must never become a history entry a graph could read as growth. The owner keeps ONE frozen snapshot per company per
-- QUARTER (m66) and nothing per edit.
--
-- REMOVED (nothing of the log stays half-alive):
--   * the table public.alumni_change_log (+ its policies, indexes, the two immutability triggers) and app_private.alumni_log_epoch
--   * the nine row triggers *_alumni_log on companies / company_internal / founders / founder_identities / company_founders / company_snapshots
--   * the logger: alumni_log_guard / put / diff / mask / fields / companies / internal / founders / identities / team / snapshots, alumni_request_id, alumni_section_of
--   * the replay: alumni_state_current / alumni_state_flat, public.alumni_state_as_of, public.alumni_state_diff, and the viewer public.list_alumni_history
--   * the GUCs the logger read (app.alumni_reason, app.alumni_coalesce_seconds, app.alumni_log_merge): the manager RPCs lose their `p_reason` argument (it only fed the log)
--
-- KEPT (the "last modified" indicators and the manager editing features of m60): updated_at / updated_by / updated_source on companies, founders, company_founders,
-- company_internal, founder_identities, the BEFORE stamp triggers (alumni_actor + alumni_stamp_actor / alumni_stamp_source), the no-op aware touch trigger of m64, optimistic
-- concurrency (`alumni_stale`), the manager / founder editing RPCs, the invited founder adopting his record, the needs-attention queue.
-- get_alumni_stamps is rewritten WITHOUT the log: one stamp per record (company, each team member) from the row's own columns; there are no per-section stamps any more.
--
-- NATIONAL IDS: nothing in this file stores or reads one; with the log gone there is no place left that could have held an ID outside founder_identities (v52's proof query
-- scan_id_shaped_values still scans every text / jsonb column of `public`).
--
-- NOTE for a re-run of the chain: do NOT run m60 alone after this file (it would create the log again); a from-scratch build runs m60 .. m64 and then this file.
set search_path = public, extensions;

begin;

-- ================================================================= 1. triggers first (they depend on the functions)
do $$
declare r record;
begin
  for r in select t.tgrelid::regclass as tbl, t.tgname from pg_trigger t
            where not t.tgisinternal
              and (t.tgname like '%\_alumni\_log' escape '\' or t.tgname in ('alumni_change_log_bud_guard', 'alumni_change_log_bt_guard')) loop
    execute format('drop trigger if exists %I on %s', r.tgname, r.tbl);
  end loop;
end $$;

-- ================================================================= 2. the table and its epoch marker
drop table if exists public.alumni_change_log cascade;
drop table if exists app_private.alumni_log_epoch cascade;

-- ================================================================= 3. the functions (every overload)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p
            where (p.pronamespace = 'app_private'::regnamespace
                   and (p.proname like 'alumni\_log\_%' escape '\' or p.proname in ('alumni_request_id', 'alumni_section_of', 'alumni_state_current', 'alumni_state_flat')))
               or (p.pronamespace = 'public'::regnamespace and p.proname in ('alumni_state_as_of', 'alumni_state_diff', 'list_alumni_history')) loop
    execute format('drop function if exists %s', r.f);
  end loop;
end $$;

-- the yearly-row writers of m49 / m60 carried the log's reason and the per-year model; the quarterly figures (m66) replace them: public.save_company_figures,
-- confirm_company_figures, close / reopen / correct. (review_company_snapshot was the "reviewed" checkpoint of a yearly row: a frozen quarter is the checkpoint now.)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('upsert_company_snapshot', 'review_company_snapshot', 'delete_company_snapshot') loop
    execute format('drop function if exists %s', r.f);
  end loop;
end $$;

-- ================================================================= 3b. two storage proof functions skipped the log table by name: patched IN PLACE on their current definition
do $$
declare f regprocedure; v_def text; v_new text;
begin
  foreach f in array array['app_private.rewrite_storage_refs(text,text)'::regprocedure, 'app_private.storage_dangling_refs()'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_new := replace(v_def, ' and c.table_name <> ''alumni_change_log''', '');
    if v_new = v_def and position('alumni_change_log' in v_def) > 0 then raise exception 'm65: % mentions the log in a shape this patch does not know', f; end if;
    if v_new <> v_def then execute v_new; end if;
  end loop;
end $$;

-- ================================================================= 4. the manager RPCs without the log's `reason`
drop function if exists public.save_alumni_company(uuid, jsonb, timestamptz, text);
create or replace function public.save_alumni_company(p_company uuid, p_patch jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_clean jsonb; v_id uuid := p_company; v_upd timestamptz; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_clean := app_private.alumni_clean_company_patch(p_patch, true);
  if v_id is null then
    v_name := lower(btrim(coalesce(v_clean->>'name_en', v_clean->>'name_ar')));
    if v_name is null then perform app_private.alumni_fail('name', 'required'); end if;
    if exists (select 1 from public.companies c where c.name_key = v_name and c.deleted_at is null) then
      raise exception 'alumni_company_exists: a company with this name already exists (use merge_companies for duplicates)' using errcode = '23505', hint = 'alumni_company_exists';
    end if;
    insert into public.companies (name_en, name_ar, created_by) values (v_clean->>'name_en', v_clean->>'name_ar', v_uid) returning id into v_id;
  else
    select c.updated_at into v_upd from public.companies c where c.id = v_id and c.deleted_at is null for update;
    if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
    if p_expected is not null and v_upd is distinct from p_expected then
      raise exception 'alumni_stale: the company was changed by someone else; reload it' using errcode = 'P0001', hint = 'alumni_stale', detail = v_upd::text;
    end if;
  end if;
  perform app_private.alumni_apply_company_patch(v_id, v_clean, true, v_uid);
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(v_id, v_uid, true);
end $$;

drop function if exists public.save_alumni_founder(uuid, jsonb, timestamptz, text);
create or replace function public.save_alumni_founder(p_founder uuid, p_patch jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r jsonb; v_upd timestamptz;
begin
  perform app_private.alumni_post_only();   -- m52: personal data never travels in a URL (GET / HEAD refused)
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_expected is not null then
    select f.updated_at into v_upd from public.founders f where f.id = p_founder and f.deleted_at is null for update;
    if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
    if v_upd is distinct from p_expected then
      raise exception 'alumni_stale: this founder was changed by someone else; reload it' using errcode = 'P0001', hint = 'alumni_stale', detail = v_upd::text;
    end if;
  end if;
  r := app_private.alumni_apply_founder_patch(p_founder, p_patch, true, v_uid, true);
  return jsonb_build_object('saved', true, 'replaced', r->'replaced', 'founder', app_private.alumni_founder_json(p_founder, false, false));
end $$;

-- ================================================================= 5. "last modified": one stamp per record, from the rows themselves (no log)
-- a manager: with the editor's name; a founder of the company: the KIND of editor only (founder | manager | import | system), never a name.
-- (the figures' own stamp comes with the quarterly model: public.get_company_figures, m66)
create or replace function public.get_alumni_stamps(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean; c public.companies; v_founders jsonb; v_cu text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('founder_id', f.id, 'updated_at', f.updated_at, 'source', f.updated_source) order by cf.is_primary desc, cf.created_at, f.id), '[]'::jsonb) into v_founders
    from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null where cf.company_id = p_company;
  if v_mgr then select pr.full_name into v_cu from public.profiles pr where pr.id = c.updated_by; end if;
  return jsonb_build_object('company', jsonb_build_object('updated_at', c.updated_at, 'source', c.updated_source) || case when v_mgr then jsonb_build_object('name', v_cu) else '{}'::jsonb end,
                            'founders', v_founders);
end $$;

-- ================================================================= 6. grants (the RPCs are for signed-in users; each checks its role)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('save_alumni_company', 'save_alumni_founder', 'get_alumni_stamps') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;

-- ================================================================= 7. self-check: nothing of the log remains
do $$
declare v_n integer;
begin
  if to_regclass('public.alumni_change_log') is not null or to_regclass('app_private.alumni_log_epoch') is not null then raise exception 'm65: a log table is still there'; end if;
  select count(*) into v_n from pg_trigger t where not t.tgisinternal and (t.tgname like '%\_alumni\_log' escape '\' or t.tgname like 'alumni\_change\_log%' escape '\');
  if v_n > 0 then raise exception 'm65: % log trigger(s) remain', v_n; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
     and (p.proname like 'alumni\_log\_%' escape '\' or p.proname in ('alumni_request_id', 'alumni_state_as_of', 'alumni_state_diff', 'list_alumni_history', 'alumni_section_of', 'alumni_state_current', 'alumni_state_flat'));
  if v_n > 0 then raise exception 'm65: % log function(s) remain', v_n; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
     and (p.prosrc ilike '%alumni\_change\_log%' escape '\' or p.prosrc ilike '%app.alumni_reason%' or p.prosrc ilike '%alumni_log_epoch%');
  if v_n > 0 then raise exception 'm65: % function(s) still mention the log', v_n; end if;
  -- the last-modified machinery must still be there
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_biu_stamp', 'founders_biu_stamp', 'company_founders_biu_stamp', 'company_internal_biu_stamp', 'founder_identities_biu_stamp')) <> 5 then
    raise exception 'm65: a last-modified stamp trigger is missing';
  end if;
  raise notice 'm65 ok';
end $$;

commit;
