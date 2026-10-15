-- m60_alumni_edit_history.sql  (owner decisions 20.3 and 20.4, 2026-10-15: the manager edits every alumni field, the invited founder completes his own data, a "needs attention" queue,
--                               and a history of every edit)
-- Re-runnable (create or replace / if not exists / drop ... if exists). Local DB only. Run AFTER m49, m50, m51, m52 (and again after any re-run of them: m49 re-creates the 3-argument
-- upsert_company_snapshot / the 1-argument save_my_founder_profile / the 2-argument save_alumni_founder this file replaces, and m24 / m25 re-create handle_new_user).
--
-- A. THE HISTORY (decision 20.4, the WORKING DEFAULT: log every edit, no periodic copies)
--    * public.alumni_change_log: append-only, field-level, written by DATABASE TRIGGERS on every table that holds an editable alumni value (companies, company_internal, founders,
--      founder_identities, company_founders, company_snapshots), so NOTHING bypasses it: the founder RPCs, the manager RPCs, a founder's or a PM's direct PostgREST write, merge_companies,
--      a migration (actor = system). One row = one field of one record: who (user, role), when, what (old -> new), source (founder | manager | import | system), an optional reason, the request.
--    * Rapid repeated edits (same actor, same field, within 10 minutes) are COALESCED into the newest entry (first old_value kept, last new_value, an edit counter): the only update the
--      log ever accepts. UPDATE (anything else) / DELETE / TRUNCATE are refused by triggers; the API roles have no privilege on the table beyond a column-limited SELECT.
--    * PII minimisation: a national ID is NEVER stored (only "an ID exists" before / after, flagged `redacted`); phone / e-mail / a typed birth date are stored masked
--      (`+**********78`, `a***@example.com`, `1995`) and flagged `redacted` (a partial value); everything else is stored as it is. A manager may read the log; a founder reads only the
--      history of his own company's YEARLY FIGURES (RLS), without names.
--    * app_private.alumni_state_as_of / public.alumni_state_as_of(company, timestamp): the state of a company at a date by REVERSE replay of the log over the current rows
--      (no copies). alumni_state_diff compares two dates. public.list_alumni_history: the viewer's query (filters, paging, export size).
--    * updated_at / updated_by / updated_source on every editable row (companies, founders, company_founders; the others already had updated_by) and the per-section "last edited by" stamps
--      (public.get_alumni_stamps). A yearly row can be marked "reviewed" by a manager (reviewed_at / by; it is not an edit and does not move the concurrency token).
-- B. EDITING: every manager / founder RPC keeps the m49 validation (the same validators, the ID wins); optimistic concurrency now also covers the founder profile
--    (`p_expected` = founders.updated_at) and the yearly row (`p_expected` = the row's updated_at, '-infinity' = "I loaded no row"): a stale write is a normal refusal
--    (P0001, hint `alumni_stale`, detail = the current version). `p_reason` (manager RPCs) is recorded in the history.
-- C. THE INVITED FOUNDER COMPLETES HIS OWN DATA: a manager-typed founder RECORD of the invited company whose e-mail is the invitation's e-mail is ADOPTED by the new account
--    (handle_new_user, accept_invitation): one person, one row, nothing typed by the manager is lost. (Before: the founders e-mail unique index made the sign-up trigger fail silently
--    and the invitation stayed pending.)
-- D. THE QUEUE (public.list_alumni_attention): per company the missing required / recommended items from a fixed catalogue the manager can switch on and off, with counts, filters,
--    completeness over the chosen rules, the CEO's contact (manager only) and the jump target section; one set-based statement (fast on 141 and on thousands of companies).
--
-- Error tokens (message prefix = hint): `alumni_stale` (P0001, detail = current version), `alumni_invalid` (22023), `forbidden` (42501), `log_immutable` (42501), `alumni_not_found` (P0002).
set search_path = public, extensions;

begin;

-- ================================================================= 1. who / when columns on the editable rows
alter table public.companies          add column if not exists updated_by uuid, add column if not exists updated_source text;
alter table public.founders           add column if not exists updated_by uuid, add column if not exists updated_source text;
alter table public.company_founders   add column if not exists updated_at timestamptz not null default now(), add column if not exists updated_by uuid, add column if not exists updated_source text;
alter table public.company_internal   add column if not exists updated_source text;
alter table public.founder_identities add column if not exists updated_source text;
alter table public.company_snapshots  add column if not exists reviewed_at timestamptz, add column if not exists reviewed_by uuid;

do $$
declare t text;
begin
  foreach t in array array['companies', 'founders', 'company_founders', 'company_internal', 'founder_identities'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_updated_source_chk');
    execute format('alter table public.%I add constraint %I check (updated_source is null or updated_source in (''founder'', ''manager'', ''import'', ''system''))', t, t || '_updated_source_chk');
  end loop;
end $$;

-- ================================================================= 2. the log table
create table if not exists app_private.alumni_log_epoch (
  id         boolean primary key default true check (id),
  started_at timestamptz not null default clock_timestamp()
);
insert into app_private.alumni_log_epoch (id) values (true) on conflict do nothing;
alter table app_private.alumni_log_epoch enable row level security;
alter table app_private.alumni_log_epoch force row level security;
revoke all on app_private.alumni_log_epoch from public, anon, authenticated;

create table if not exists public.alumni_change_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default clock_timestamp(),   -- when the change was FIRST made (a coalesced entry keeps it)
  last_at       timestamptz not null default clock_timestamp(),   -- when the latest merged edit was made
  actor_user_id uuid,                                              -- no FK: the log outlives the account (and is immutable)
  actor_role    text not null,                                     -- super_admin | alumni_manager | project_manager | founder | system | user
  source        text not null,                                     -- founder | manager | import | system
  entity_type   text not null,                                     -- company | internal | founder | identity | team | snapshot
  entity_id     uuid not null,                                     -- company id (company, internal, snapshot) / founder id (founder, identity, team)
  company_id    uuid,                                              -- the company timeline this entry belongs to (a founder entry is written once per company he belongs to)
  founder_id    uuid,
  period_key    text,                                              -- yearly figures: the year
  field         text not null,
  old_value     jsonb,
  new_value     jsonb,
  redacted      boolean not null default false,                    -- the value is withheld (national ID) or partial (masked phone / e-mail / birth year)
  edits         integer not null default 1,                        -- how many saves were coalesced into this entry
  reason        text,
  request_id    text,
  constraint alumni_change_log_source_chk check (source in ('founder', 'manager', 'import', 'system')),
  constraint alumni_change_log_entity_chk check (entity_type in ('company', 'internal', 'founder', 'identity', 'team', 'snapshot')),
  constraint alumni_change_log_field_chk check (char_length(field) between 1 and 80),
  constraint alumni_change_log_reason_chk check (reason is null or char_length(reason) <= 300),
  constraint alumni_change_log_edits_chk check (edits >= 1)
);
create index if not exists alumni_change_log_company_idx on public.alumni_change_log (company_id, at desc, id desc) where company_id is not null;
create index if not exists alumni_change_log_founder_idx on public.alumni_change_log (founder_id, at desc, id desc) where founder_id is not null;
create index if not exists alumni_change_log_entity_idx  on public.alumni_change_log (entity_type, entity_id, field, id desc);
create index if not exists alumni_change_log_at_idx      on public.alumni_change_log (at desc, id desc);
create index if not exists alumni_change_log_actor_idx   on public.alumni_change_log (actor_user_id, at desc) where actor_user_id is not null;

alter table public.alumni_change_log enable row level security;
alter table public.alumni_change_log force row level security;
revoke all on public.alumni_change_log from public, anon, authenticated;
-- a column-limited SELECT only (no actor id, no reason, no request id): the history viewer goes through list_alumni_history (definer) for the names
grant select (id, at, last_at, actor_role, source, entity_type, entity_id, company_id, founder_id, period_key, field, old_value, new_value, redacted, edits) on public.alumni_change_log to authenticated;
drop policy if exists alumni_change_log_select_manager on public.alumni_change_log;
create policy alumni_change_log_select_manager on public.alumni_change_log for select to authenticated
  using ((select app_private.has_any_role(array['alumni_manager', 'super_admin'])));
-- a founder reads the history of the YEARLY FIGURES of his own companies only (his own numbers; nothing about people)
drop policy if exists alumni_change_log_select_own_figures on public.alumni_change_log;
create policy alumni_change_log_select_own_figures on public.alumni_change_log for select to authenticated
  using (entity_type = 'snapshot' and company_id in (select app_private.my_company_ids()) and (select app_private.has_role('founder')));

-- the log is immutable: the ONLY update it accepts is the coalescing of the newest entry of the same actor (new value / last time / counter), done by the logger itself
create or replace function app_private.alumni_log_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('app.alumni_log_merge', true) = '1'
     and (new.id, new.at, new.actor_user_id, new.actor_role, new.source, new.entity_type, new.entity_id, new.company_id, new.founder_id, new.period_key, new.field, new.old_value, new.redacted, new.reason, new.request_id)
         is not distinct from
         (old.id, old.at, old.actor_user_id, old.actor_role, old.source, old.entity_type, old.entity_id, old.company_id, old.founder_id, old.period_key, old.field, old.old_value, old.redacted, old.reason, old.request_id) then
    return new;
  end if;
  raise exception 'log_immutable: the alumni change log is append-only' using errcode = '42501', hint = 'log_immutable';
end $$;
drop trigger if exists alumni_change_log_bud_guard on public.alumni_change_log;
create trigger alumni_change_log_bud_guard before update or delete on public.alumni_change_log for each row execute function app_private.alumni_log_guard();
drop trigger if exists alumni_change_log_bt_guard on public.alumni_change_log;
create trigger alumni_change_log_bt_guard before truncate on public.alumni_change_log for each statement execute function app_private.alumni_log_guard();

-- ================================================================= 3. the logger (every helper is closed to the API roles)
-- WHO is writing: the JWT user's strongest staff role, a founder, or "system" (no JWT: migrations, the sign-up trigger, the service role). `app.alumni_source` = 'import' marks a bulk import.
create or replace function app_private.alumni_actor() returns table (uid uuid, actor_role text, src text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_src text := nullif(current_setting('app.alumni_source', true), '');
begin
  if v_uid is null then
    return query select null::uuid, 'system'::text, case when v_src in ('import', 'system') then v_src else 'system' end;
  elsif app_private.has_role('super_admin') then
    return query select v_uid, 'super_admin'::text, case when v_src = 'import' then 'import' else 'manager' end;
  elsif app_private.has_role('alumni_manager') then
    return query select v_uid, 'alumni_manager'::text, case when v_src = 'import' then 'import' else 'manager' end;
  elsif app_private.has_role('project_manager') then
    return query select v_uid, 'project_manager'::text, 'manager'::text;
  elsif app_private.has_role('founder') then
    return query select v_uid, 'founder'::text, 'founder'::text;
  else
    return query select v_uid, 'user'::text, 'system'::text;
  end if;
end $$;

create or replace function app_private.alumni_request_id() returns text
language plpgsql stable set search_path = '' as $$
declare h text := nullif(current_setting('request.headers', true), ''); v text;
begin
  if h is not null then
    begin v := nullif(h::json ->> 'x-request-id', ''); exception when others then v := null; end;
  end if;
  return coalesce(left(v, 80), 'tx' || pg_current_xact_id()::text);
end $$;

-- the value that is STORED for a field (masks); the diff itself always compares the raw values
create or replace function app_private.alumni_log_mask(p_field text, p_val jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_val is null or jsonb_typeof(p_val) = 'null' then p_val
    when p_field = 'phone' then to_jsonb(regexp_replace(p_val #>> '{}', '[0-9](?=[0-9]{2})', '*', 'g'))
    when p_field = 'email' then to_jsonb(regexp_replace(p_val #>> '{}', '^(.).*(@.*)$', '\1***\2'))
    when p_field = 'self_birth_date' then to_jsonb(left(p_val #>> '{}', 4))
    else p_val end
$$;

-- the loggable fields of a row, under the names the UI uses (a missing row gives the same keys with their defaults, so an INSERT / DELETE diff has no phantom keys)
create or replace function app_private.alumni_log_fields(p_table text, p_row jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case p_table
    when 'companies' then jsonb_build_object(
      'name_en', p_row -> 'name_en', 'name_ar', p_row -> 'name_ar', 'description_en', p_row -> 'description_en', 'description_ar', p_row -> 'description_ar',
      'location_en', p_row -> 'location_en', 'location_ar', p_row -> 'location_ar', 'logo_path', p_row -> 'logo_path',
      'startup_type', p_row -> 'startup_type_key', 'sector', p_row -> 'sector_key', 'subsector', p_row -> 'subsector_key', 'stage', p_row -> 'stage', 'legal_status', p_row -> 'legal_status_key',
      'governorate', p_row -> 'governorate_code', 'established_on', p_row -> 'established_on', 'website_url', p_row -> 'website_url', 'app_url', p_row -> 'app_url',
      'linkedin_url', p_row -> 'linkedin_url', 'links', coalesce(nullif(p_row -> 'links', 'null'::jsonb), '[]'::jsonb), 'operating_status', coalesce(nullif(p_row -> 'operating_status', 'null'::jsonb), '"open"'::jsonb),
      'closed_on', p_row -> 'closed_on', 'closing_reason', p_row -> 'closing_reason_key', 'after_closing', p_row -> 'after_closing_key', 'closing_note', p_row -> 'closing_note',
      'directory_visibility', coalesce(nullif(p_row -> 'directory_visibility', 'null'::jsonb), '"private"'::jsonb), 'is_alumni', coalesce(nullif(p_row -> 'is_alumni', 'null'::jsonb), 'false'::jsonb), 'deleted_at', p_row -> 'deleted_at')
    when 'company_internal' then jsonb_build_object('hint', p_row -> 'hint', 'directory_hidden', coalesce(nullif(p_row -> 'directory_hidden', 'null'::jsonb), 'false'::jsonb), 'reviewed_at', p_row -> 'reviewed_at')
    when 'founders' then jsonb_build_object(
      'name_en', p_row -> 'name_en', 'name_ar', p_row -> 'name_ar', 'email', p_row -> 'email', 'phone', p_row -> 'phone', 'linkedin_url', p_row -> 'linkedin_url',
      'photo_path', p_row -> 'photo_path', 'bio_en', p_row -> 'bio_en', 'bio_ar', p_row -> 'bio_ar', 'education_status', p_row -> 'education_status',
      'has_account', to_jsonb(coalesce((p_row ->> 'auth_user_id') is not null, false)), 'deleted_at', p_row -> 'deleted_at')
    when 'founder_identities' then jsonb_build_object('self_birth_date', p_row -> 'self_birth_date', 'self_gender', p_row -> 'self_gender')
    when 'company_founders' then jsonb_build_object('role', p_row -> 'role', 'is_primary', coalesce(nullif(p_row -> 'is_primary', 'null'::jsonb), 'false'::jsonb))
    when 'company_snapshots' then jsonb_build_object(
      'revenue_total', p_row -> 'revenue_total', 'funding_raised_total', p_row -> 'funding_raised_total', 'employees_total', p_row -> 'employees_total',
      'employees_female', p_row -> 'employees_female', 'freelancers', p_row -> 'freelancers', 'traction', p_row -> 'traction', 'challenges', p_row -> 'challenges',
      'needs', p_row -> 'needs', 'reviewed_at', p_row -> 'reviewed_at')
    else '{}'::jsonb end
$$;

-- write ONE entry (or coalesce it into the newest entry of the same actor for the same field)
create or replace function app_private.alumni_log_put(p_entity text, p_entity_id uuid, p_company uuid, p_founder uuid, p_period text, p_field text, p_old jsonb, p_new jsonb, p_redacted boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare a record; e public.alumni_change_log; v_win integer; v_old jsonb; v_new jsonb; v_red boolean; v_reason text; v_now timestamptz := clock_timestamp();
begin
  select * into a from app_private.alumni_actor();
  v_old := app_private.alumni_log_mask(p_field, p_old);
  v_new := app_private.alumni_log_mask(p_field, p_new);
  v_red := p_redacted or p_field in ('phone', 'email', 'self_birth_date');
  -- a national ID typed into a FREE-TEXT value (a hint, a bio, a note) must not survive in an immutable log: the m52 redaction runs over the stored values and the reason
  if v_old is not null and app_private.redact_ids_json(v_old) is distinct from v_old then v_old := app_private.redact_ids_json(v_old); v_red := true; end if;
  if v_new is not null and app_private.redact_ids_json(v_new) is distinct from v_new then v_new := app_private.redact_ids_json(v_new); v_red := true; end if;
  v_reason := app_private.redact_ids_text(nullif(left(btrim(coalesce(current_setting('app.alumni_reason', true), '')), 300), ''));
  begin v_win := coalesce(nullif(current_setting('app.alumni_coalesce_seconds', true), '')::integer, 600); exception when others then v_win := 600; end;

  if v_win > 0 and p_field <> 'national_id' then
    select * into e from public.alumni_change_log l
     where l.entity_type = p_entity and l.entity_id = p_entity_id and l.field = p_field
       and l.period_key is not distinct from p_period and l.company_id is not distinct from p_company
     order by l.id desc limit 1;
    if found and e.actor_user_id is not distinct from a.uid and e.source = a.src and e.actor_role = a.actor_role and e.last_at > v_now - make_interval(secs => v_win) then
      perform set_config('app.alumni_log_merge', '1', true);
      update public.alumni_change_log l set new_value = v_new, last_at = v_now, edits = l.edits + 1 where l.id = e.id;
      perform set_config('app.alumni_log_merge', '', true);
      return;
    end if;
  end if;
  insert into public.alumni_change_log (at, last_at, actor_user_id, actor_role, source, entity_type, entity_id, company_id, founder_id, period_key, field, old_value, new_value, redacted, reason, request_id)
  values (v_now, v_now, a.uid, a.actor_role, a.src, p_entity, p_entity_id, p_company, p_founder, p_period, p_field, v_old, v_new, v_red, v_reason, app_private.alumni_request_id());
end $$;

-- one entry per field that differs between two loggable maps
create or replace function app_private.alumni_log_diff(p_entity text, p_entity_id uuid, p_company uuid, p_founder uuid, p_period text, p_old jsonb, p_new jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  for k in select s.x from (select jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) as x union select jsonb_object_keys(coalesce(p_old, '{}'::jsonb))) s order by 1 loop
    if coalesce(p_old -> k, 'null'::jsonb) is distinct from coalesce(p_new -> k, 'null'::jsonb) then
      perform app_private.alumni_log_put(p_entity, p_entity_id, p_company, p_founder, p_period, k, coalesce(p_old -> k, 'null'::jsonb), coalesce(p_new -> k, 'null'::jsonb));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- the row triggers (AFTER: they see the final row of every writer)
create or replace function app_private.alumni_log_companies() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.alumni_log_put('company', new.id, new.id, null, null, 'created', null, jsonb_build_object('name_en', new.name_en, 'name_ar', new.name_ar));
  elsif tg_op = 'UPDATE' then
    perform app_private.alumni_log_diff('company', new.id, new.id, null, null, app_private.alumni_log_fields('companies', to_jsonb(old)), app_private.alumni_log_fields('companies', to_jsonb(new)));
  else
    perform app_private.alumni_log_put('company', old.id, old.id, null, null, 'removed', jsonb_build_object('name_en', old.name_en, 'name_ar', old.name_ar), null);
  end if;
  return null;
end $$;
drop trigger if exists companies_ai_alumni_log on public.companies;
create trigger companies_ai_alumni_log after insert on public.companies for each row execute function app_private.alumni_log_companies();
drop trigger if exists companies_au_alumni_log on public.companies;
create trigger companies_au_alumni_log after update on public.companies for each row when (old.* is distinct from new.*) execute function app_private.alumni_log_companies();
drop trigger if exists companies_ad_alumni_log on public.companies;
create trigger companies_ad_alumni_log after delete on public.companies for each row execute function app_private.alumni_log_companies();

create or replace function app_private.alumni_log_internal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.alumni_log_diff('internal', case when tg_op = 'DELETE' then old.company_id else new.company_id end, case when tg_op = 'DELETE' then old.company_id else new.company_id end, null, null,
    app_private.alumni_log_fields('company_internal', case when tg_op = 'INSERT' then null else to_jsonb(old) end),
    app_private.alumni_log_fields('company_internal', case when tg_op = 'DELETE' then null else to_jsonb(new) end));
  return null;
end $$;
drop trigger if exists company_internal_aiud_alumni_log on public.company_internal;
create trigger company_internal_aiud_alumni_log after insert or update or delete on public.company_internal for each row execute function app_private.alumni_log_internal();

-- a founder belongs to 0..n companies: his entries are written once per company (the per-company timeline), or once with no company
create or replace function app_private.alumni_log_founders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; c uuid;
begin
  if tg_op = 'INSERT' then
    perform app_private.alumni_log_put('founder', new.id, null, new.id, null, 'created', null, jsonb_build_object('name_en', new.name_en, 'name_ar', new.name_ar));
    return null;
  end if;
  select coalesce(array_agg(cf.company_id order by cf.company_id), array[null]::uuid[]) into v_ids from public.company_founders cf where cf.founder_id = new.id;
  foreach c in array v_ids loop
    perform app_private.alumni_log_diff('founder', new.id, c, new.id, null, app_private.alumni_log_fields('founders', to_jsonb(old)), app_private.alumni_log_fields('founders', to_jsonb(new)));
  end loop;
  return null;
end $$;
drop trigger if exists founders_ai_alumni_log on public.founders;
create trigger founders_ai_alumni_log after insert on public.founders for each row execute function app_private.alumni_log_founders();
drop trigger if exists founders_au_alumni_log on public.founders;
create trigger founders_au_alumni_log after update on public.founders for each row when (old.* is distinct from new.*) execute function app_private.alumni_log_founders();

-- the identity: the self-declared fallback (birth date masked to the year) and the NATIONAL ID, which is NEVER stored: only "an ID exists" before / after
create or replace function app_private.alumni_log_identities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_f uuid; v_ids uuid[]; c uuid; v_had boolean := false; v_has boolean := false;
begin
  v_f := case when tg_op = 'DELETE' then old.founder_id else new.founder_id end;
  select coalesce(array_agg(cf.company_id order by cf.company_id), array[null]::uuid[]) into v_ids from public.company_founders cf where cf.founder_id = v_f;
  if tg_op <> 'INSERT' then v_had := old.national_id is not null; end if;
  if tg_op <> 'DELETE' then v_has := new.national_id is not null; end if;
  foreach c in array v_ids loop
    if tg_op = 'UPDATE' and old.national_id is not distinct from new.national_id then
      null;
    elsif v_had or v_has then
      perform app_private.alumni_log_put('identity', v_f, c, v_f, null, 'national_id', to_jsonb(v_had), to_jsonb(v_has), true);
    end if;
    perform app_private.alumni_log_diff('identity', v_f, c, v_f, null,
      app_private.alumni_log_fields('founder_identities', case when tg_op = 'INSERT' then null else to_jsonb(old) end),
      app_private.alumni_log_fields('founder_identities', case when tg_op = 'DELETE' then null else to_jsonb(new) end));
  end loop;
  return null;
end $$;
drop trigger if exists founder_identities_aiud_alumni_log on public.founder_identities;
create trigger founder_identities_aiud_alumni_log after insert or update or delete on public.founder_identities for each row execute function app_private.alumni_log_identities();

-- the team: membership (`member` = {role, is_primary} when present, null when not), role, CEO flag
create or replace function app_private.alumni_log_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.alumni_log_put('team', new.founder_id, new.company_id, new.founder_id, null, 'member', null, jsonb_build_object('role', new.role, 'is_primary', new.is_primary));
  elsif tg_op = 'DELETE' then
    perform app_private.alumni_log_put('team', old.founder_id, old.company_id, old.founder_id, null, 'member', jsonb_build_object('role', old.role, 'is_primary', old.is_primary), null);
  else
    perform app_private.alumni_log_diff('team', new.founder_id, new.company_id, new.founder_id, null, app_private.alumni_log_fields('company_founders', to_jsonb(old)), app_private.alumni_log_fields('company_founders', to_jsonb(new)));
  end if;
  return null;
end $$;
drop trigger if exists company_founders_aiud_alumni_log on public.company_founders;
create trigger company_founders_aiud_alumni_log after insert or update or delete on public.company_founders for each row execute function app_private.alumni_log_team();

-- the yearly figures (annual rows): one entry per changed metric; a row that moves to another company / year (merge) is a removal + an addition
create or replace function app_private.alumni_log_snapshots() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.snapshot_type = 'annual' then v_old := app_private.alumni_log_fields('company_snapshots', to_jsonb(old)); end if;
  if tg_op in ('UPDATE', 'INSERT') and new.snapshot_type = 'annual' then v_new := app_private.alumni_log_fields('company_snapshots', to_jsonb(new)); end if;
  if v_old is null and v_new is null then return null; end if;
  if tg_op = 'UPDATE' and old.snapshot_type = 'annual' and new.snapshot_type = 'annual' and old.company_id = new.company_id and old.period_year is not distinct from new.period_year then
    perform app_private.alumni_log_diff('snapshot', new.company_id, new.company_id, null, new.period_year::text, v_old, v_new);
  else
    if v_old is not null then
      perform app_private.alumni_log_diff('snapshot', old.company_id, old.company_id, null, old.period_year::text, v_old, app_private.alumni_log_fields('company_snapshots', null));
    end if;
    if v_new is not null then
      perform app_private.alumni_log_diff('snapshot', new.company_id, new.company_id, null, new.period_year::text, app_private.alumni_log_fields('company_snapshots', null), v_new);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists company_snapshots_aiud_alumni_log on public.company_snapshots;
create trigger company_snapshots_aiud_alumni_log after insert or update or delete on public.company_snapshots for each row execute function app_private.alumni_log_snapshots();

-- ---------------------------------------------------------------- the BEFORE trigger that stamps "who edited this row last" (the log is the history, this is the quick answer shown on the row)
create or replace function app_private.alumni_stamp_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from app_private.alumni_actor();
  new.updated_by := a.uid;
  new.updated_source := a.src;
  if tg_table_name = 'company_founders' then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists companies_biu_stamp on public.companies;
create trigger companies_biu_stamp before insert or update on public.companies for each row execute function app_private.alumni_stamp_actor();
drop trigger if exists founders_biu_stamp on public.founders;
create trigger founders_biu_stamp before insert or update on public.founders for each row execute function app_private.alumni_stamp_actor();
drop trigger if exists company_founders_biu_stamp on public.company_founders;
create trigger company_founders_biu_stamp before insert or update on public.company_founders for each row execute function app_private.alumni_stamp_actor();

create or replace function app_private.alumni_stamp_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from app_private.alumni_actor();
  new.updated_source := a.src;
  return new;
end $$;
drop trigger if exists company_internal_biu_stamp on public.company_internal;
create trigger company_internal_biu_stamp before insert or update on public.company_internal for each row execute function app_private.alumni_stamp_source();
drop trigger if exists founder_identities_biu_stamp on public.founder_identities;
create trigger founder_identities_biu_stamp before insert or update on public.founder_identities for each row execute function app_private.alumni_stamp_source();

-- ================================================================= 4. the state of a company at a date: reverse replay of the log over the CURRENT rows (no copies)
-- Flat map keys: company.<field> / internal.<field> / year.<YYYY>.<field> / team.<founder>.<member|role|is_primary> / founder.<founder>.<field>. A null / absent value = "not set".
create or replace function app_private.alumni_state_current(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := '{}'::jsonb; c public.companies; ci public.company_internal; v_fids uuid[]; f public.founders; i public.founder_identities; s public.company_snapshots; cf public.company_founders; fid uuid;
begin
  select * into c from public.companies x where x.id = p_company;
  if not found then return null; end if;
  select coalesce(jsonb_object_agg('company.' || e.key, app_private.alumni_log_mask(e.key, e.value)), '{}'::jsonb) into r from jsonb_each(app_private.alumni_log_fields('companies', to_jsonb(c))) e;
  select * into ci from public.company_internal x where x.company_id = p_company;
  r := r || coalesce((select jsonb_object_agg('internal.' || e.key, e.value) from jsonb_each(app_private.alumni_log_fields('company_internal', to_jsonb(ci))) e), '{}'::jsonb);
  for s in select * from public.company_snapshots x where x.company_id = p_company and x.snapshot_type = 'annual' loop
    r := r || coalesce((select jsonb_object_agg('year.' || s.period_year || '.' || e.key, e.value) from jsonb_each(app_private.alumni_log_fields('company_snapshots', to_jsonb(s))) e), '{}'::jsonb);
  end loop;
  select coalesce(array_agg(x.fid), '{}'::uuid[]) into v_fids from (
    select cf2.founder_id as fid from public.company_founders cf2 where cf2.company_id = p_company
    union select l.founder_id from public.alumni_change_log l where l.company_id = p_company and l.entity_type = 'team' and l.founder_id is not null) x;
  for cf in select * from public.company_founders x where x.company_id = p_company loop
    r := r || jsonb_build_object('team.' || cf.founder_id || '.member', true, 'team.' || cf.founder_id || '.role', to_jsonb(cf.role), 'team.' || cf.founder_id || '.is_primary', to_jsonb(cf.is_primary));
  end loop;
  foreach fid in array v_fids loop
    select * into f from public.founders x where x.id = fid;
    if not found then continue; end if;
    select * into i from public.founder_identities x where x.founder_id = fid;
    r := r || coalesce((select jsonb_object_agg('founder.' || fid || '.' || e.key, app_private.alumni_log_mask(e.key, e.value)) from jsonb_each(app_private.alumni_log_fields('founders', to_jsonb(f))) e), '{}'::jsonb)
           || coalesce((select jsonb_object_agg('founder.' || fid || '.' || e.key, app_private.alumni_log_mask(e.key, e.value)) from jsonb_each(app_private.alumni_log_fields('founder_identities', to_jsonb(i))) e), '{}'::jsonb)
           || jsonb_build_object('founder.' || fid || '.national_id', to_jsonb(coalesce(i.national_id is not null, false)));
  end loop;
  return r;
end $$;

create or replace function app_private.alumni_state_flat(p_company uuid, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cur jsonb; v_changes jsonb; v_fids uuid[]; r jsonb;
begin
  cur := app_private.alumni_state_current(p_company);
  if cur is null then return null; end if;
  if exists (select 1 from public.alumni_change_log l where l.entity_type = 'company' and l.entity_id = p_company and l.field = 'created' and l.at > p_at) then return '{}'::jsonb; end if;
  select coalesce(array_agg(x.fid), '{}'::uuid[]) into v_fids from (
    select cf.founder_id as fid from public.company_founders cf where cf.company_id = p_company
    union select l.founder_id from public.alumni_change_log l where l.company_id = p_company and l.entity_type = 'team' and l.founder_id is not null) x;
  -- the value at p_at is the OLD value of the earliest entry after p_at (per key); entries before the log existed are not there, so the oldest answer is the state when the log started
  select coalesce(jsonb_object_agg(q.k, q.v), '{}'::jsonb) into v_changes from (
    select distinct on (z.k) z.k,
           case when z.field = 'member' then (case when z.old_value is null or z.old_value = 'null'::jsonb then 'null'::jsonb else 'true'::jsonb end)
                when z.field = 'national_id' then (case when z.old_value = 'true'::jsonb then 'true'::jsonb else 'null'::jsonb end)
                else coalesce(z.old_value, 'null'::jsonb) end as v
      from (select l.at, l.id, l.field, l.old_value,
                   case l.entity_type when 'company' then 'company.' || l.field when 'internal' then 'internal.' || l.field when 'snapshot' then 'year.' || l.period_key || '.' || l.field
                                      when 'team' then 'team.' || l.entity_id || '.' || l.field else 'founder.' || l.entity_id || '.' || l.field end as k
              from public.alumni_change_log l
             where l.at > p_at and l.field not in ('created', 'removed') and (l.company_id = p_company or l.founder_id = any (v_fids))) z
     order by z.k, z.at, z.id) q;
  cur := cur || v_changes;
  -- only the founders that were on the team at p_at; no nulls
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into r from jsonb_each(cur) e
   where e.value <> 'null'::jsonb
     and (e.key !~ '^founder\.' or coalesce(cur -> ('team.' || split_part(e.key, '.', 2) || '.member'), 'null'::jsonb) = 'true'::jsonb);
  return r;
end $$;

create or replace function public.alumni_state_as_of(p_company uuid, p_at timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_at timestamptz := coalesce(p_at, clock_timestamp()); v_start timestamptz; v_flat jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  select e.started_at into v_start from app_private.alumni_log_epoch e;
  v_flat := app_private.alumni_state_flat(p_company, v_at);
  if v_flat is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  return jsonb_build_object('company_id', p_company, 'as_of', v_at, 'log_started_at', v_start, 'before_log', v_at < v_start, 'existed', v_flat <> '{}'::jsonb, 'fields', v_flat);
end $$;

-- two dates side by side: only the keys whose value differs
create or replace function public.alumni_state_diff(p_company uuid, p_from timestamptz, p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_to timestamptz := coalesce(p_to, clock_timestamp()); a jsonb; b jsonb; v_start timestamptz; v_changes jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null then perform app_private.alumni_fail('from', 'required'); end if;
  select e.started_at into v_start from app_private.alumni_log_epoch e;
  a := app_private.alumni_state_flat(p_company, p_from);
  b := app_private.alumni_state_flat(p_company, v_to);
  if a is null or b is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'from', a -> k.key, 'to', b -> k.key) order by k.key), '[]'::jsonb) into v_changes
    from (select jsonb_object_keys(a) as key union select jsonb_object_keys(b)) k where (a -> k.key) is distinct from (b -> k.key);
  return jsonb_build_object('company_id', p_company, 'from', p_from, 'to', v_to, 'log_started_at', v_start, 'before_log', least(p_from, v_to) < v_start, 'changes', v_changes);
end $$;

-- ================================================================= 5. the history viewer + the "last edited by" stamps
create or replace function app_private.alumni_section_of(p_entity text, p_field text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_entity = 'company' then case
      when p_field in ('name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on', 'created', 'removed', 'deleted_at') then 'basics'
      when p_field in ('startup_type', 'sector', 'subsector', 'stage', 'legal_status') then 'classification'
      when p_field in ('governorate', 'location_en', 'location_ar') then 'location'
      when p_field in ('website_url', 'app_url', 'linkedin_url', 'links') then 'online'
      when p_field in ('operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note') then 'status'
      when p_field = 'directory_visibility' then 'directory'
      when p_field = 'is_alumni' then 'manager'
      else 'basics' end
    when p_entity = 'internal' then 'manager'
    when p_entity in ('team', 'founder', 'identity') then 'team'
    when p_entity = 'snapshot' then 'metrics'
    else 'basics' end
$$;

-- p_filters: company_id, founder_id, entity_type, field, year (yearly figures), actor (user id), actor_role, source, from, to (timestamps), q (company name), order (desc | asc).
-- A manager sees everything (and the names); a founder only the YEARLY FIGURES of his own company (company_id required), with the role of the editor and never a name.
create or replace function public.list_alumni_history(p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := coalesce(p_filters, '{}'::jsonb); k text; v_mgr boolean; v_lim integer := least(greatest(coalesce(p_limit, 50), 1), case when app_private.alumni_is_manager() then 5000 else 200 end);
  v_off integer := greatest(coalesce(p_offset, 0), 0); v_company uuid; v_founder uuid; v_entity text; v_field text; v_year text; v_actor uuid; v_role text; v_source text;
  v_from timestamptz; v_to timestamptz; v_q text; v_order text; v_rows jsonb; v_total integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(v) <> 'object' then perform app_private.alumni_fail('filters', 'not_an_object'); end if;
  for k in select jsonb_object_keys(v) loop
    if k not in ('company_id', 'founder_id', 'entity_type', 'field', 'year', 'actor', 'actor_role', 'source', 'from', 'to', 'q', 'order') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  begin v_company := nullif(v ->> 'company_id', '')::uuid; exception when others then perform app_private.alumni_fail('company_id', 'bad_value'); end;
  begin v_founder := nullif(v ->> 'founder_id', '')::uuid; exception when others then perform app_private.alumni_fail('founder_id', 'bad_value'); end;
  begin v_actor := nullif(v ->> 'actor', '')::uuid; exception when others then perform app_private.alumni_fail('actor', 'bad_value'); end;
  begin v_from := nullif(v ->> 'from', '')::timestamptz; exception when others then perform app_private.alumni_fail('from', 'bad_date'); end;
  begin v_to := nullif(v ->> 'to', '')::timestamptz; exception when others then perform app_private.alumni_fail('to', 'bad_date'); end;
  v_entity := nullif(v ->> 'entity_type', ''); v_field := nullif(v ->> 'field', ''); v_year := nullif(v ->> 'year', ''); v_role := nullif(v ->> 'actor_role', ''); v_source := nullif(v ->> 'source', '');
  v_q := nullif(lower(btrim(v ->> 'q')), ''); v_order := lower(coalesce(nullif(v ->> 'order', ''), 'desc'));
  if v_entity is not null and v_entity not in ('company', 'internal', 'founder', 'identity', 'team', 'snapshot') then perform app_private.alumni_fail('entity_type', 'bad_value'); end if;
  if v_source is not null and v_source not in ('founder', 'manager', 'import', 'system') then perform app_private.alumni_fail('source', 'bad_value'); end if;
  if v_order not in ('asc', 'desc') then perform app_private.alumni_fail('order', 'bad_value'); end if;
  if v_q is not null and char_length(v_q) > 100 then perform app_private.alumni_fail('q', 'too_long'); end if;
  if not v_mgr then
    if v_company is null or not exists (select 1 from app_private.my_company_ids() m where m = v_company) then raise exception 'forbidden' using errcode = '42501'; end if;
    v_entity := 'snapshot'; v_founder := null; v_actor := null; v_role := null; v_q := null;
  end if;

  with f as (
    select l.* from public.alumni_change_log l
     where (v_company is null or l.company_id = v_company) and (v_founder is null or l.founder_id = v_founder) and (v_entity is null or l.entity_type = v_entity)
       and (v_field is null or l.field = v_field) and (v_year is null or l.period_key = v_year) and (v_actor is null or l.actor_user_id = v_actor)
       and (v_role is null or l.actor_role = v_role) and (v_source is null or l.source = v_source) and (v_from is null or l.last_at >= v_from) and (v_to is null or l.at <= v_to)
       and (v_q is null or exists (select 1 from public.companies c where c.id = l.company_id and (strpos(lower(coalesce(c.name_en, '')), v_q) > 0 or strpos(lower(coalesce(c.name_ar, '')), v_q) > 0))))
  select (select count(*) from f)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'at', p.at, 'last_at', p.last_at, 'edits', p.edits, 'source', p.source, 'entity_type', p.entity_type, 'entity_id', p.entity_id, 'company_id', p.company_id,
           'founder_id', p.founder_id, 'period_key', p.period_key, 'field', p.field, 'old_value', p.old_value, 'new_value', p.new_value, 'redacted', p.redacted,
           'actor', jsonb_build_object('role', p.actor_role) || case when v_mgr then jsonb_build_object('user_id', p.actor_user_id, 'name', pr.full_name) else '{}'::jsonb end,
           'company', case when v_mgr then jsonb_build_object('name_en', c.name_en, 'name_ar', c.name_ar) end,
           'founder', case when v_mgr and p.founder_id is not null then jsonb_build_object('name_en', fo.name_en, 'name_ar', fo.name_ar) end,
           'reason', case when v_mgr then p.reason end, 'request_id', case when v_mgr then p.request_id end,
           'section', app_private.alumni_section_of(p.entity_type, p.field))
           order by case when v_order = 'asc' then p.at end asc, case when v_order = 'desc' then p.at end desc, p.id), '[]'::jsonb)
    into v_total, v_rows
    from (select * from f order by case when v_order = 'asc' then f.at end asc, case when v_order = 'desc' then f.at end desc, f.id limit v_lim offset v_off) p
    left join public.profiles pr on pr.id = p.actor_user_id and v_mgr
    left join public.companies c on c.id = p.company_id and v_mgr
    left join public.founders fo on fo.id = p.founder_id and v_mgr;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- "Last edited by <manager | founder> on <date>" per section of one company (a manager: with the name; a founder of the company: the kind of editor only)
create or replace function public.get_alumni_stamps(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean; c public.companies; v_sections jsonb; v_years jsonb; v_founders jsonb; v_cu text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  select coalesce(jsonb_object_agg(s.section, jsonb_build_object('at', s.at, 'source', s.src, 'role', s.role, 'edits', s.n) || case when v_mgr then jsonb_build_object('name', s.name) else '{}'::jsonb end), '{}'::jsonb)
    into v_sections
    from (select z.section, max(z.last_at) as at, (array_agg(z.source order by z.last_at desc, z.id desc))[1] as src, (array_agg(z.actor_role order by z.last_at desc, z.id desc))[1] as role,
                 (array_agg(p.full_name order by z.last_at desc, z.id desc))[1] as name, count(*)::int as n
            from (select l.*, app_private.alumni_section_of(l.entity_type, l.field) as section from public.alumni_change_log l
                   where l.company_id = p_company and l.field <> 'created' and (v_mgr or l.entity_type <> 'internal')) z
            left join public.profiles p on p.id = z.actor_user_id
           where v_mgr or z.section <> 'manager'
           group by z.section) s;
  select coalesce(jsonb_agg(jsonb_build_object('year', y.period_year, 'updated_at', y.updated_at, 'source', y.source, 'reviewed_at', y.reviewed_at, 'reviewed', y.reviewed_at is not null and y.reviewed_at >= y.updated_at)
           || case when v_mgr then jsonb_build_object('name', pr.full_name, 'reviewed_by_name', rv.full_name) else '{}'::jsonb end order by y.period_year desc), '[]'::jsonb)
    into v_years
    from public.company_snapshots y left join public.profiles pr on pr.id = y.updated_by left join public.profiles rv on rv.id = y.reviewed_by
   where y.company_id = p_company and y.snapshot_type = 'annual';
  select coalesce(jsonb_agg(jsonb_build_object('founder_id', f.id, 'updated_at', f.updated_at, 'source', f.updated_source) order by cf.is_primary desc, cf.created_at, f.id), '[]'::jsonb) into v_founders
    from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null where cf.company_id = p_company;
  if v_mgr then select pr.full_name into v_cu from public.profiles pr where pr.id = c.updated_by; end if;
  return jsonb_build_object('company', jsonb_build_object('updated_at', c.updated_at, 'source', c.updated_source) || case when v_mgr then jsonb_build_object('name', v_cu) else '{}'::jsonb end,
                            'sections', v_sections, 'years', v_years, 'founders', v_founders);
end $$;

-- ================================================================= 6. concurrency + reason on the write RPCs (the old signatures are replaced: a default keeps every old call working)
drop function if exists public.save_alumni_company(uuid, jsonb, timestamptz);
create or replace function public.save_alumni_company(p_company uuid, p_patch jsonb, p_expected timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_clean jsonb; v_id uuid := p_company; v_upd timestamptz; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_clean := app_private.alumni_clean_company_patch(p_patch, true);
  perform set_config('app.alumni_reason', coalesce(left(btrim(p_reason), 300), ''), true);
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

-- the founder's own company: the same optimistic concurrency as before, now with the version in `detail`
create or replace function public.save_my_company_profile(p_company uuid, p_patch jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_f uuid; v_clean jsonb; v_id uuid := p_company; v_upd timestamptz; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_f := app_private.alumni_ensure_founder(v_uid);
  v_clean := app_private.alumni_clean_company_patch(p_patch, false);
  if v_id is null then
    v_name := lower(btrim(coalesce(v_clean->>'name_en', v_clean->>'name_ar')));
    if v_name is null then perform app_private.alumni_fail('name', 'required'); end if;
    if exists (select 1 from public.companies c where c.name_key = v_name and c.deleted_at is null) then
      raise exception 'alumni_company_exists: a company with this name already exists; ask the Athar team to link your account' using errcode = '23505', hint = 'alumni_company_exists';
    end if;
    insert into public.companies (name_en, name_ar, created_by) values (v_clean->>'name_en', v_clean->>'name_ar', v_uid) returning id into v_id;
    insert into public.company_founders (company_id, founder_id, role, is_primary) values (v_id, v_f, 'founder', true);
  else
    if not exists (select 1 from app_private.my_company_ids() m where m = v_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    select c.updated_at into v_upd from public.companies c where c.id = v_id and c.deleted_at is null for update;
    if not found then raise exception 'forbidden' using errcode = '42501'; end if;
    if p_expected is not null and v_upd is distinct from p_expected then
      raise exception 'alumni_stale: the company was changed by someone else; reload it' using errcode = 'P0001', hint = 'alumni_stale', detail = v_upd::text;
    end if;
  end if;
  perform app_private.alumni_apply_company_patch(v_id, v_clean, false, v_uid);
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(v_id, v_uid, false);
end $$;

-- the founder profile: `p_expected` = the founders.updated_at the form was loaded with (every identity change touches it: the founder row is always written)
drop function if exists public.save_my_founder_profile(jsonb);
create or replace function public.save_my_founder_profile(p_patch jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_f uuid; r jsonb; v_upd timestamptz;
begin
  perform app_private.alumni_post_only();   -- m52: personal data never travels in a URL (GET / HEAD refused)
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_f := app_private.alumni_ensure_founder(v_uid);
  if p_expected is not null then
    select f.updated_at into v_upd from public.founders f where f.id = v_f and f.deleted_at is null for update;
    if v_upd is distinct from p_expected then
      raise exception 'alumni_stale: your profile was changed by someone else; reload it' using errcode = 'P0001', hint = 'alumni_stale', detail = v_upd::text;
    end if;
  end if;
  r := app_private.alumni_apply_founder_patch(v_f, p_patch, false, v_uid, true);
  if (r->>'saved')::boolean is not true then return r; end if;
  return jsonb_build_object('saved', true, 'replaced', r->'replaced', 'founder', app_private.alumni_founder_json(v_f, true, false));
end $$;

drop function if exists public.save_alumni_founder(uuid, jsonb);
create or replace function public.save_alumni_founder(p_founder uuid, p_patch jsonb, p_expected timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r jsonb; v_upd timestamptz;
begin
  perform app_private.alumni_post_only();   -- m52: personal data never travels in a URL (GET / HEAD refused)
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform set_config('app.alumni_reason', coalesce(left(btrim(p_reason), 300), ''), true);
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

-- one yearly row. p_expected: the row's updated_at the form was loaded with; '-infinity' = "I loaded no row for this year" (a row that appeared meanwhile is a conflict); null = no check.
-- A save that changes nothing does not touch the row (so "last edited by" stays honest).
drop function if exists public.upsert_company_snapshot(uuid, integer, jsonb);
create or replace function public.upsert_company_snapshot(p_company uuid, p_year integer, p_data jsonb, p_expected timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; k text; val jsonb; t text; v jsonb := '{}'::jsonb; s public.company_snapshots; r jsonb; v_total int; v_female int; v_changed boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if p_year is null or p_year < 1990 or p_year > extract(year from app_private.alumni_today())::int then perform app_private.alumni_fail('year', 'out_of_range'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform app_private.alumni_fail('data', 'not_an_object'); end if;
  for k, val in select key, value from jsonb_each(p_data) loop
    if k not in ('revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers', 'traction', 'challenges', 'needs') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
    if jsonb_typeof(val) = 'null' then v := v || jsonb_build_object(k, null); continue; end if;
    if k in ('traction', 'challenges', 'needs') then
      if jsonb_typeof(val) <> 'string' then perform app_private.alumni_fail(k, 'not_a_string'); end if;
      t := nullif(btrim(val #>> '{}'), '');
      if t is not null and char_length(t) > 4000 then perform app_private.alumni_fail(k, 'too_long'); end if;
      v := v || jsonb_build_object(k, t);
    else
      t := btrim(val #>> '{}');
      if t !~ '^[0-9]+(\.[0-9]{1,2})?$' then perform app_private.alumni_fail(k, 'not_a_number'); end if;
      if k in ('revenue_total', 'funding_raised_total') then
        if t::numeric > 1000000000000 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        v := v || jsonb_build_object(k, t::numeric);
      else
        if t !~ '^[0-9]+$' or length(t) > 7 or t::int > 1000000 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        v := v || jsonb_build_object(k, t::int);
      end if;
    end if;
  end loop;
  perform set_config('app.alumni_reason', case when v_mgr then coalesce(left(btrim(p_reason), 300), '') else '' end, true);
  select * into s from public.company_snapshots x where x.company_id = p_company and x.snapshot_type = 'annual' and x.period_year = p_year for update;
  if p_expected is not null then
    if (found and (p_expected = '-infinity'::timestamptz or s.updated_at is distinct from p_expected)) or (not found and p_expected <> '-infinity'::timestamptz) then
      raise exception 'alumni_stale: this year was changed by someone else; reload it' using errcode = 'P0001', hint = 'alumni_stale', detail = coalesce(s.updated_at::text, '');
    end if;
  end if;
  v_total := case when v ? 'employees_total' then (v->>'employees_total')::int else s.employees_total end;
  v_female := case when v ? 'employees_female' then (v->>'employees_female')::int else s.employees_female end;
  if v_total is not null and v_female is not null and v_female > v_total then perform app_private.alumni_fail('employees_female', 'exceeds_total'); end if;
  if s.id is not null then
    v_changed := (v ? 'revenue_total' and (v->>'revenue_total')::numeric is distinct from s.revenue_total)
              or (v ? 'funding_raised_total' and (v->>'funding_raised_total')::numeric is distinct from s.funding_raised_total)
              or (v ? 'employees_total' and (v->>'employees_total')::int is distinct from s.employees_total)
              or (v ? 'employees_female' and (v->>'employees_female')::int is distinct from s.employees_female)
              or (v ? 'freelancers' and (v->>'freelancers')::int is distinct from s.freelancers)
              or (v ? 'traction' and v->>'traction' is distinct from s.traction)
              or (v ? 'challenges' and v->>'challenges' is distinct from s.challenges)
              or (v ? 'needs' and v->>'needs' is distinct from s.needs);
    if not v_changed then
      select e into r from jsonb_array_elements(app_private.alumni_snapshots_json(p_company)) e where (e->>'year')::int = p_year;
      return jsonb_build_object('saved', true, 'changed', false, 'snapshot', r, 'snapshots', app_private.alumni_snapshots_json(p_company));
    end if;
  end if;
  insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, revenue_total, funding_raised_total, employees_total, employees_female,
                                        freelancers, traction, challenges, needs, updated_by, updated_at)
  values (p_company, 'annual', least(make_date(p_year, 12, 31), app_private.alumni_today()), case when v_mgr then 'manager' else 'founder' end, p_year,
          (v->>'revenue_total')::numeric, (v->>'funding_raised_total')::numeric, (v->>'employees_total')::int, (v->>'employees_female')::int, (v->>'freelancers')::int,
          v->>'traction', v->>'challenges', v->>'needs', v_uid, now())
  on conflict (company_id, period_year) where snapshot_type = 'annual' do update set
    revenue_total = case when v ? 'revenue_total' then (v->>'revenue_total')::numeric else public.company_snapshots.revenue_total end,
    funding_raised_total = case when v ? 'funding_raised_total' then (v->>'funding_raised_total')::numeric else public.company_snapshots.funding_raised_total end,
    employees_total = case when v ? 'employees_total' then (v->>'employees_total')::int else public.company_snapshots.employees_total end,
    employees_female = case when v ? 'employees_female' then (v->>'employees_female')::int else public.company_snapshots.employees_female end,
    freelancers = case when v ? 'freelancers' then (v->>'freelancers')::int else public.company_snapshots.freelancers end,
    traction = case when v ? 'traction' then v->>'traction' else public.company_snapshots.traction end,
    challenges = case when v ? 'challenges' then v->>'challenges' else public.company_snapshots.challenges end,
    needs = case when v ? 'needs' then v->>'needs' else public.company_snapshots.needs end,
    source = case when v_mgr then 'manager' else 'founder' end, updated_by = v_uid, updated_at = now(),
    snapshot_date = least(make_date(p_year, 12, 31), app_private.alumni_today());
  select e into r from jsonb_array_elements(app_private.alumni_snapshots_json(p_company)) e where (e->>'year')::int = p_year;
  return jsonb_build_object('saved', true, 'changed', true, 'snapshot', r, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

-- a manager's checkpoint on a yearly row ("reviewed"): not an edit (no updated_at / source change: the founder's form stays current), recorded in the history
create or replace function public.review_company_snapshot(p_company uuid, p_year integer, p_reviewed boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.company_snapshots s set reviewed_at = case when coalesce(p_reviewed, true) then now() end, reviewed_by = case when coalesce(p_reviewed, true) then v_uid end
   where s.company_id = p_company and s.snapshot_type = 'annual' and s.period_year = p_year;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  return jsonb_build_object('saved', true, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

-- ================================================================= 7. the invited founder completes his OWN data: the manager-typed record of the invited company is ADOPTED by the account
-- founders_self_guard: the one extra rule (a definer RPC that links an account to a record of the invitation's company sets app.alumni_adopt for its own statement)
create or replace function app_private.founders_self_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;     -- loaders / service role
  if current_setting('app.alumni_adopt', true) = 'on' then return new; end if;   -- m60: linking an account to the record the invitation points at
  if not app_private.has_any_role(array['alumni_manager','super_admin'])
     and (new.auth_user_id is distinct from old.auth_user_id or new.email is distinct from old.email) then
    raise exception 'auth_user_id and e-mail can only be changed by an alumni manager' using errcode = '42501';
  end if;
  return new;
end $$;

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
  exception when others then null; end;

  -- optional invitation: token hash, pending, <= 14 days, same e-mail, single use (row lock)
  v_token := new.raw_user_meta_data->>'invitation_token';
  if v_token is not null then
    begin
      select * into v_inv from public.alumni_invitations i
       where i.token = encode(extensions.digest(v_token, 'sha256'), 'hex')
         and i.status = 'pending'
         and i.sent_at + interval '14 days' > now()
         and lower(i.founder_email) = lower(coalesce(new.email, ''))
       for update;
    exception when others then v_inv := null; end;
  end if;

  -- m60: the manager may have typed this person as a RECORD of the invited company (with this e-mail). The new account TAKES THAT RECORD OVER (linking by invitation, 03 OD-8):
  -- one person, one row, nothing the manager entered is lost, and the founders e-mail unique index no longer makes the sign-up fail silently.
  if v_inv.id is not null then
    begin
      select f.id into v_founder from public.founders f
        join public.company_founders cf on cf.founder_id = f.id and cf.company_id = v_inv.company_id
       where f.auth_user_id is null and f.deleted_at is null and lower(f.email::text) = lower(coalesce(new.email, ''))
       order by cf.is_primary desc, f.created_at limit 1 for update of f;
      if v_founder is not null then
        perform set_config('app.alumni_adopt', 'on', true);
        update public.founders set auth_user_id = new.id where id = v_founder;
        perform set_config('app.alumni_adopt', '', true);
      end if;
    exception when others then
      perform set_config('app.alumni_adopt', '', true);
      v_founder := null;
    end;
  end if;

  if v_founder is null then
    begin
      insert into public.founders (name_ar, name_en, email, auth_user_id)
        values (v_name, v_name, new.email, new.id)
        returning id into v_founder;
    exception when others then
      -- never block signup (e.g. an unlinked founders row with the same e-mail exists: no automatic linking by e-mail)
      v_founder := null;
    end;
  end if;

  if v_inv.id is not null and v_founder is not null then
    begin
      insert into public.company_founders (company_id, founder_id, role, is_primary)
        values (v_inv.company_id, v_founder, 'founder', false) on conflict do nothing;
      update public.alumni_invitations set status = 'accepted', accepted_at = now(), founder_id = v_founder where id = v_inv.id;
    exception when others then null; end;
  end if;
  return new;
end $$;

create or replace function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.alumni_invitations; v_uid uuid := (select auth.uid()); v_email text; v_founder uuid; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select u.email, coalesce(p.full_name, split_part(u.email, '@', 1)) into v_email, v_name
    from auth.users u left join public.profiles p on p.id = u.id where u.id = v_uid;
  select * into i from public.alumni_invitations x
   where x.token = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and x.status = 'pending' and x.sent_at + interval '14 days' > now() and lower(x.founder_email) = lower(coalesce(v_email, ''))
   for update;
  if not found then return jsonb_build_object('accepted', false); end if;
  select f.id into v_founder from public.founders f where f.auth_user_id = v_uid;
  if v_founder is null then
    -- m60: the record the manager typed for this person in the invited company becomes his own
    select f.id into v_founder from public.founders f
      join public.company_founders cf on cf.founder_id = f.id and cf.company_id = i.company_id
     where f.auth_user_id is null and f.deleted_at is null and lower(f.email::text) = lower(coalesce(v_email, ''))
     order by cf.is_primary desc, f.created_at limit 1 for update of f;
    if v_founder is not null then
      perform set_config('app.alumni_adopt', 'on', true);
      update public.founders set auth_user_id = v_uid where id = v_founder;
      perform set_config('app.alumni_adopt', '', true);
    end if;
  end if;
  if v_founder is null then
    insert into public.founders (name_ar, name_en, email, auth_user_id) values (v_name, v_name, v_email, v_uid) returning id into v_founder;
  end if;
  insert into public.user_roles (user_id, role_key) values (v_uid, 'founder') on conflict do nothing;
  insert into public.company_founders (company_id, founder_id, role) values (i.company_id, v_founder, 'founder') on conflict do nothing;
  update public.alumni_invitations set status = 'accepted', accepted_at = now(), founder_id = v_founder where id = i.id;
  return jsonb_build_object('accepted', true, 'company_id', i.company_id);
end $$;

-- ================================================================= 8. the "needs attention" queue
-- the catalogue: key, severity (required | recommended), the section of the company page that fixes it, the order
create or replace function app_private.alumni_attention_catalog() returns table (key text, severity text, section text, sort integer)
language sql immutable parallel safe set search_path = '' as $$
  select * from (values
    ('ceo', 'required', 'team', 1), ('ceo_id', 'required', 'team', 2), ('contact', 'required', 'team', 3), ('sector', 'required', 'classification', 4),
    ('governorate', 'required', 'location', 5), ('latest_figures', 'required', 'metrics', 6),
    ('description', 'recommended', 'basics', 7), ('logo', 'recommended', 'basics', 8), ('established_on', 'recommended', 'basics', 9), ('stage', 'recommended', 'classification', 10),
    ('startup_type', 'recommended', 'classification', 11), ('subsector', 'recommended', 'classification', 12), ('legal_status', 'recommended', 'classification', 13),
    ('online_presence', 'recommended', 'online', 14), ('ceo_education', 'recommended', 'team', 15)) v (key, severity, section, sort)
$$;

-- filters: scope (all | alumni | candidates; default all: the queue is about data that is missing, wherever it is), q, program_id, project_id, missing (one rule key), severity, has_account, invited.
-- p_rules: the catalogue keys that count (null = all). One set-based statement: no per-company function call.
create or replace function public.list_alumni_attention(p_filters jsonb default '{}'::jsonb, p_rules text[] default null, p_limit integer default 25, p_offset integer default 0, p_sort text default 'missing') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := coalesce(p_filters, '{}'::jsonb); k text; v_today date := app_private.alumni_today(); v_year integer := extract(year from app_private.alumni_today())::int;
  v_scope text; v_q text; v_program uuid; v_project uuid; v_missing text; v_sev text; v_account boolean; v_invited boolean; v_lim integer; v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(nullif(p_sort, ''), 'missing'); v_rules text[]; v_n integer; v_all text[]; v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_lim := least(greatest(coalesce(p_limit, 25), 1), 5000);
  if jsonb_typeof(v) <> 'object' then perform app_private.alumni_fail('filters', 'not_an_object'); end if;
  for k in select jsonb_object_keys(v) loop
    if k not in ('scope', 'q', 'program_id', 'project_id', 'missing', 'severity', 'has_account', 'invited') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  if v_sort not in ('missing', 'completeness', 'name', 'updated') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  select array_agg(c.key order by c.sort) into v_all from app_private.alumni_attention_catalog() c;
  v_rules := coalesce(p_rules, v_all);
  if cardinality(v_rules) = 0 then perform app_private.alumni_fail('rules', 'required'); end if;
  if exists (select 1 from unnest(v_rules) r where r <> all (v_all)) then perform app_private.alumni_fail('rules', 'unknown'); end if;
  v_n := cardinality(v_rules);
  v_scope := coalesce(nullif(v ->> 'scope', ''), 'all');
  if v_scope not in ('all', 'alumni', 'candidates') then perform app_private.alumni_fail('scope', 'bad_value'); end if;
  v_q := nullif(lower(btrim(v ->> 'q')), '');
  if v_q is not null and char_length(v_q) > 100 then perform app_private.alumni_fail('q', 'too_long'); end if;
  begin v_program := nullif(v ->> 'program_id', '')::uuid; exception when others then perform app_private.alumni_fail('program_id', 'bad_value'); end;
  begin v_project := nullif(v ->> 'project_id', '')::uuid; exception when others then perform app_private.alumni_fail('project_id', 'bad_value'); end;
  v_missing := nullif(v ->> 'missing', '');
  if v_missing is not null and v_missing <> all (v_all) then perform app_private.alumni_fail('missing', 'unknown'); end if;
  v_sev := nullif(v ->> 'severity', '');
  if v_sev is not null and v_sev not in ('required', 'recommended') then perform app_private.alumni_fail('severity', 'bad_value'); end if;
  begin v_account := nullif(v ->> 'has_account', '')::boolean; exception when others then perform app_private.alumni_fail('has_account', 'bad_value'); end;
  begin v_invited := nullif(v ->> 'invited', '')::boolean; exception when others then perform app_private.alumni_fail('invited', 'bad_value'); end;

  with ap as (select * from app_private.alumni_participations()),
       base as (
         select c.* from public.companies c
          where c.deleted_at is null
            and (v_scope = 'all' or (v_scope = 'alumni' and c.is_alumni)
                 or (v_scope = 'candidates' and not c.is_alumni and (exists (select 1 from ap where ap.company_id = c.id) or exists (select 1 from public.company_founders cf where cf.company_id = c.id))))
            and (v_q is null or strpos(lower(coalesce(c.name_en, '')), v_q) > 0 or strpos(lower(coalesce(c.name_ar, '')), v_q) > 0)
            and (v_program is null or exists (select 1 from ap where ap.company_id = c.id and ap.program_id = v_program))
            and (v_project is null or exists (select 1 from ap where ap.company_id = c.id and ap.project_id = v_project))),
       ceo as (
         select b.id as company_id, f.id as fid, f.phone, f.email, f.education_status, i.national_id is not null as has_id
           from base b
           left join lateral (select cf.founder_id from public.company_founders cf join public.founders f2 on f2.id = cf.founder_id and f2.deleted_at is null
                               where cf.company_id = b.id order by cf.is_primary desc, cf.created_at, cf.founder_id limit 1) x on true
           left join public.founders f on f.id = x.founder_id
           left join public.founder_identities i on i.founder_id = f.id),
       fig as (select s.company_id from public.company_snapshots s where s.snapshot_type = 'annual' and s.period_year >= v_year - 1 group by s.company_id),
       flags as (
         select b.id, array_remove(array[
           case when ceo.fid is null then 'ceo' end,
           case when ceo.fid is null or not ceo.has_id then 'ceo_id' end,
           case when ceo.fid is null or (ceo.phone is null and ceo.email is null) then 'contact' end,
           case when b.sector_key is null then 'sector' end,
           case when b.governorate_code is null then 'governorate' end,
           case when fig.company_id is null then 'latest_figures' end,
           case when b.description_en is null and b.description_ar is null then 'description' end,
           case when b.logo_path is null then 'logo' end,
           case when b.established_on is null then 'established_on' end,
           case when b.stage is null then 'stage' end,
           case when b.startup_type_key is null then 'startup_type' end,
           case when b.subsector_key is null then 'subsector' end,
           case when b.legal_status_key is null then 'legal_status' end,
           case when b.website_url is null and b.app_url is null and jsonb_array_length(app_private.alumni_social_links(b.links, b.linkedin_url)) = 0 then 'online_presence' end,
           case when ceo.fid is null or ceo.education_status is null then 'ceo_education' end], null) as miss
           from base b join ceo on ceo.company_id = b.id left join fig on fig.company_id = b.id),
       t as (
         select fl.id as company_id, m.miss as missing,
                (select count(*) from unnest(m.miss) x join app_private.alumni_attention_catalog() c on c.key = x where c.severity = 'required')::int as req,
                (select count(*) from unnest(m.miss) x join app_private.alumni_attention_catalog() c on c.key = x where c.severity = 'recommended')::int as rec,
                round(100.0 * (v_n - cardinality(m.miss)) / v_n)::int as pct
           from flags fl cross join lateral (select array(select x from unnest(fl.miss) x where x = any (v_rules)) as miss) m),
       counts as (
         select jsonb_build_object('total', count(*), 'with_issues', count(*) filter (where cardinality(t.missing) > 0), 'complete', count(*) filter (where cardinality(t.missing) = 0),
                  'by_rule', coalesce((select jsonb_object_agg(z.k, z.n) from (select x as k, count(*)::int as n from t t2, unnest(t2.missing) x group by x) z), '{}'::jsonb)) as j
           from t),
       sel as (
         select t.*, c.name_en, c.name_ar, c.logo_path, c.is_alumni, c.updated_at, c.updated_source
           from t join public.companies c on c.id = t.company_id
           left join lateral (select bool_or(f.auth_user_id is not null) as has_account from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null where cf.company_id = t.company_id) a on true
           left join lateral (select count(*)::int as pending from public.alumni_invitations i where i.company_id = t.company_id and i.status = 'pending' and i.sent_at + interval '14 days' > now()) iv on true
          where (v_missing is null or v_missing = any (t.missing))
            and (v_sev is null or exists (select 1 from unnest(t.missing) x join app_private.alumni_attention_catalog() cc on cc.key = x where cc.severity = v_sev))
            and (v_account is null or coalesce(a.has_account, false) = v_account)
            and (v_invited is null or (coalesce(iv.pending, 0) > 0) = v_invited)),
       page as (
         select s.*, row_number() over (order by
                  case when v_sort = 'missing' then s.req end desc nulls last, case when v_sort = 'missing' then cardinality(s.missing) end desc nulls last,
                  case when v_sort = 'completeness' then s.pct end asc nulls last, case when v_sort = 'updated' then s.updated_at end asc nulls last,
                  lower(coalesce(s.name_en, s.name_ar)), s.company_id) as rn
           from sel s)
  select jsonb_build_object('total', (select count(*) from sel), 'limit', v_lim, 'offset', v_off, 'sort', v_sort, 'as_of', v_today,
           'rules', (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'severity', c.severity, 'section', c.section, 'selected', c.key = any (v_rules),
                       'count', coalesce(((select cn.j from counts cn) -> 'by_rule' ->> c.key)::int, 0)) order by c.sort), '[]'::jsonb) from app_private.alumni_attention_catalog() c),
           'counts', (select cn.j from counts cn),
           'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', p.company_id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'logo_path', p.logo_path, 'is_alumni', p.is_alumni, 'missing', to_jsonb(p.missing),
                      'required_missing', p.req, 'recommended_missing', p.rec, 'completeness_percent', p.pct,
                      'last_update', jsonb_build_object('at', p.updated_at, 'source', p.updated_source),
                      'has_account', coalesce(a.has_account, false), 'pending_invitations', coalesce(iv.pending, 0),
                      'ceo', case when cf.id is not null then jsonb_build_object('founder_id', cf.id, 'name_en', cf.name_en, 'name_ar', cf.name_ar, 'email', cf.email::text, 'phone', cf.phone, 'has_account', cf.auth_user_id is not null) end,
                      'programs', coalesce(pr.programs, '[]'::jsonb)) order by p.rn), '[]'::jsonb)
                      from (select * from page where rn > v_off and rn <= v_off + v_lim) p
                      left join public.founders cf on cf.id = app_private.alumni_company_ceo(p.company_id)
                      left join lateral (select bool_or(f.auth_user_id is not null) as has_account from public.company_founders c2 join public.founders f on f.id = c2.founder_id and f.deleted_at is null where c2.company_id = p.company_id) a on true
                      left join lateral (select count(*)::int as pending from public.alumni_invitations i where i.company_id = p.company_id and i.status = 'pending' and i.sent_at + interval '14 days' > now()) iv on true
                      left join lateral (select jsonb_agg(distinct jsonb_build_object('program_name_en', g.name_en, 'program_name_ar', g.name_ar)) as programs
                                           from app_private.alumni_participations() ap2 join public.programs g on g.id = ap2.program_id where ap2.company_id = p.company_id) pr on true))
    into v_result;
  return v_result;
end $$;

-- ================================================================= 9. grants: nothing of the machinery is executable by an API role; the RPCs are for signed-in users (each checks its role)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace
            and p.proname in ('alumni_log_guard', 'alumni_actor', 'alumni_request_id', 'alumni_log_mask', 'alumni_log_fields', 'alumni_log_put', 'alumni_log_diff', 'alumni_log_companies',
                              'alumni_log_internal', 'alumni_log_founders', 'alumni_log_identities', 'alumni_log_team', 'alumni_log_snapshots', 'alumni_stamp_actor', 'alumni_stamp_source',
                              'alumni_state_current', 'alumni_state_flat', 'alumni_section_of', 'alumni_attention_catalog') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('alumni_state_as_of', 'alumni_state_diff', 'list_alumni_history', 'get_alumni_stamps', 'save_alumni_company', 'save_my_company_profile', 'save_my_founder_profile',
                              'save_alumni_founder', 'upsert_company_snapshot', 'review_company_snapshot', 'list_alumni_attention', 'accept_invitation') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
  -- the trigger functions that other roles fire (GoTrue fires handle_new_user): unchanged, closed as before
  revoke all on function app_private.handle_new_user() from public, anon, authenticated;
  revoke all on function app_private.founders_self_guard() from public, anon, authenticated;
end $$;

-- the personal-data functions keep the m52 rule (GET / HEAD refused, VOLATILE): re-apply it to the two functions this file re-created
do $$
declare f regprocedure; v_def text; v_new text;
begin
  foreach f in array array['public.save_my_founder_profile(jsonb,timestamptz)'::regprocedure, 'public.save_alumni_founder(uuid,jsonb,timestamptz,text)'::regprocedure] loop
    if position('app_private.alumni_post_only()' in pg_get_functiondef(f)) = 0 then raise exception 'm60: % lost the GET / HEAD guard', f; end if;
  end loop;
end $$;

analyze public.companies;
analyze public.founders;

-- ================================================================= self-check
do $$
declare v_bad integer;
begin
  if (select count(*) from pg_trigger where tgrelid = 'public.alumni_change_log'::regclass and not tgisinternal) <> 2 then raise exception 'm60: the immutability triggers are missing'; end if;
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_ai_alumni_log', 'companies_au_alumni_log', 'companies_ad_alumni_log', 'company_internal_aiud_alumni_log',
        'founders_ai_alumni_log', 'founders_au_alumni_log', 'founder_identities_aiud_alumni_log', 'company_founders_aiud_alumni_log', 'company_snapshots_aiud_alumni_log')) <> 9 then
    raise exception 'm60: a logging trigger is missing';
  end if;
  if has_table_privilege('authenticated', 'public.alumni_change_log', 'INSERT') or has_table_privilege('authenticated', 'public.alumni_change_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.alumni_change_log', 'DELETE') or has_table_privilege('anon', 'public.alumni_change_log', 'SELECT') then
    raise exception 'm60: an API role can write or anonymously read the log';
  end if;
  if has_column_privilege('authenticated', 'public.alumni_change_log', 'actor_user_id', 'SELECT') or has_column_privilege('authenticated', 'public.alumni_change_log', 'reason', 'SELECT') then
    raise exception 'm60: an API role reads the actor id / reason columns directly';
  end if;
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname in ('alumni_log_put', 'alumni_log_diff', 'alumni_actor', 'alumni_state_flat', 'alumni_state_current', 'alumni_stamp_actor')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then raise exception 'm60: % logger helper(s) executable by an API role', v_bad; end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ~* 'errcode\s*=\s*''(40001|40P01)''') then
    raise exception 'm60: a function raises SQLSTATE 40001 / 40P01';
  end if;
  raise notice 'm60 ok';
end $$;

commit;
