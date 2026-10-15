-- m64_review_fixes.sql  (the database findings of the independent review of m60 / m61 / m62 / m63)
-- Re-runnable (create or replace / drop ... if exists / guarded patches). Local DB only. Run AFTER m63. Verify with db/verify/v64_review_fixes.sql.
-- m60 .. m63 are NOT edited destructively: every fix is a new definition here (m62 gets the same one-line guard fix in its source so a fresh build is identical).
--
--  1. NATIONAL ID IN THE IMMUTABLE LOG (medium). `redact_ids_text` knew only 14 LATIN digits in a row. An ID typed with Arabic-Indic / Persian digits, or with spaces,
--     dots or dashes between the digits ("2 99 01 01 12345 67"), survived in a free text (bio, hint, notes, links) and, once written to `alumni_change_log`, could never be
--     removed. The pattern now accepts Latin + Arabic-Indic (U+0660..0669) + extended Arabic-Indic (U+06F0..06F9) digits, one optional separator (space, tab, no-break
--     space, dot, hyphen, en / em dash) between any two of the 14 digits, and refuses a run that goes on (a 16-digit number is not an ID). The at-rest proof query
--     `scan_id_shaped_values()` uses the same pattern (one definition, `app_private.nid_shape_pattern()`).
--  2. AUDIT BYPASS (medium). `authenticated` owners hold column UPDATE / INSERT on companies.employees, founding_year and (when the typed key is empty) industry_en / ar,
--     governorate_en / ar. None was in `alumni_log_fields('companies')`, so a direct PostgREST PATCH (the Lists node does exactly that) changed alumni data with no entry
--     and `alumni_state_as_of` could not see it. They are logged now: `employees`, `founding_year`, `industry_en/ar`, `governorate_en/ar`. The three derived pairs are logged ONLY
--     while their key (established_on / sector / governorate) is empty, so a derived mirror never writes a second entry next to the key's own. Two more holes of the same kind
--     are closed: an UPDATE of company_founders that MOVES a membership (company_id / founder_id) is logged as a removal + an addition, and a DELETE of a founders row is logged.
--  3. NO-OP SAVES MOVED THE STAMPS (medium). `touch_updated_at` set updated_at = now() and `alumni_stamp_actor` rewrote updated_by / updated_source on EVERY update, so a save that
--     changed nothing showed "Last edited by <manager>" and gave a concurrent form (token = updated_at) a false `alumni_stale`. The new BEFORE trigger function
--     `touch_updated_at_if_changed` returns OLD when nothing but the three stamp columns would change: the row is not written, the AFTER log trigger (old is distinct from new) does
--     not fire. Applied to companies, founders and company_founders under the names the tests already use (`*_bu_touch`).
--  4. email_worker_finish (low): the ownership guard was three-valued (`locked_by` NULL -> the IF never fired). Now `(...) is not true`.
--  5. remove_company_team_member (low): the identity + the soft delete are done BEFORE the membership row goes, so their log entries still carry the company id and stay on
--     the company's timeline.
--  5b. list_alumni_history: a person's company-less entries (written before his membership row existed) stay on the company's timeline after he is removed.
--  6. alumni_section_of: the new fields belong to Classification (industry) / Location (governorate).

-- ================================================================= 1. the national-ID pattern, one definition
drop function if exists app_private.id_shaped_pattern() cascade;
drop function if exists app_private.id_candidate_ok(text) cascade;
create or replace function app_private.nid_shape_pattern() returns text
language sql immutable parallel safe set search_path = '' as $$
  select '(?<![0-9٠-٩۰-۹A-Za-z])[23٢٣۲۳](?:[ \t .‐-―-]?[0-9٠-٩۰-۹]){13}(?![0-9٠-٩۰-۹A-Za-z]|[ \t .‐-―-][0-9٠-٩۰-۹])'
$$;

-- a candidate found by the loose pattern is an ID when it is the legacy shape (14 Latin digits in a row, as before) or, for the looser spellings (other digit scripts, separators),
-- when its digits also read as century + YYMMDD with a real month and day (so "Screenshot 2024-05-12 123456" is not an ID)
create or replace function app_private.nid_candidate_ok(p_match text) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
declare d text;
begin
  if p_match ~ '^[23][0-9]{13}$' then return true; end if;
  d := regexp_replace(translate(p_match, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
  return length(d) = 14 and substr(d, 4, 2) between '01' and '12' and substr(d, 6, 2) between '01' and '31';
end $$;

create or replace function app_private.redact_ids_text(p_text text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare r text := p_text; m text;
begin
  if p_text is null then return null; end if;
  for m in select x[1] from regexp_matches(p_text, '(' || app_private.nid_shape_pattern() || ')', 'g') x loop
    if app_private.nid_candidate_ok(m) then r := replace(r, m, '[ID removed]'); end if;
  end loop;
  return r;
end $$;

-- true when the text holds an ID-shaped number (the at-rest proof query)
create or replace function app_private.contains_id(p_text text) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
declare m text;
begin
  if p_text is null then return false; end if;
  for m in select x[1] from regexp_matches(p_text, '(' || app_private.nid_shape_pattern() || ')', 'g') x loop
    if app_private.nid_candidate_ok(m) then return true; end if;
  end loop;
  return false;
end $$;

-- the proof query (v52): the same pattern over every text / varchar / citext / jsonb column of `public`
create or replace function app_private.scan_id_shaped_values() returns table (table_name text, column_name text, hits bigint)
language plpgsql stable security definer set search_path = '' as $$
declare r record; n bigint;
begin
  for r in select c.table_name::text as t, c.column_name::text as col, c.data_type::text as dt from information_schema.columns c
             join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.table_name <> 'founder_identities' and c.data_type in ('text', 'character varying', 'jsonb', 'USER-DEFINED')
              and (c.data_type <> 'USER-DEFINED' or c.udt_name = 'citext')
            order by 1, 2 loop
    execute format('select count(*) from public.%I where app_private.contains_id(%s)', r.t, case when r.dt = 'jsonb' then format('app_private.json_scan_text(%I)', r.col) else format('%I::text', r.col) end) into n;
    if n > 0 then table_name := r.t; column_name := r.col; hits := n; return next; end if;
  end loop;
end $$;

-- ================================================================= 2. the loggable fields (companies get the legacy / derived columns) + their sections
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
      'directory_visibility', coalesce(nullif(p_row -> 'directory_visibility', 'null'::jsonb), '"private"'::jsonb), 'is_alumni', coalesce(nullif(p_row -> 'is_alumni', 'null'::jsonb), 'false'::jsonb), 'deleted_at', p_row -> 'deleted_at',
      -- m64: the legacy columns a company owner can still write directly. The derived ones are logged only while their key is empty (otherwise they are a copy of the key's value)
      'employees', p_row -> 'employees',
      'founding_year', case when p_row ->> 'established_on' is null then p_row -> 'founding_year' end,
      'industry_en', case when p_row ->> 'sector_key' is null then p_row -> 'industry_en' end,
      'industry_ar', case when p_row ->> 'sector_key' is null then p_row -> 'industry_ar' end,
      'governorate_en', case when p_row ->> 'governorate_code' is null then p_row -> 'governorate_en' end,
      'governorate_ar', case when p_row ->> 'governorate_code' is null then p_row -> 'governorate_ar' end)
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

create or replace function app_private.alumni_section_of(p_entity text, p_field text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_entity = 'company' then case
      when p_field in ('name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on', 'founding_year', 'employees', 'created', 'removed', 'deleted_at') then 'basics'
      when p_field in ('startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'industry_en', 'industry_ar') then 'classification'
      when p_field in ('governorate', 'governorate_en', 'governorate_ar', 'location_en', 'location_ar') then 'location'
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

-- a membership that MOVES (company_id / founder_id changed by a direct UPDATE) is a removal from the old pair + an addition to the new one
create or replace function app_private.alumni_log_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.alumni_log_put('team', new.founder_id, new.company_id, new.founder_id, null, 'member', null, jsonb_build_object('role', new.role, 'is_primary', new.is_primary));
  elsif tg_op = 'DELETE' then
    perform app_private.alumni_log_put('team', old.founder_id, old.company_id, old.founder_id, null, 'member', jsonb_build_object('role', old.role, 'is_primary', old.is_primary), null);
  elsif new.company_id is distinct from old.company_id or new.founder_id is distinct from old.founder_id then
    perform app_private.alumni_log_put('team', old.founder_id, old.company_id, old.founder_id, null, 'member', jsonb_build_object('role', old.role, 'is_primary', old.is_primary), null);
    perform app_private.alumni_log_put('team', new.founder_id, new.company_id, new.founder_id, null, 'member', null, jsonb_build_object('role', new.role, 'is_primary', new.is_primary));
  else
    perform app_private.alumni_log_diff('team', new.founder_id, new.company_id, new.founder_id, null, app_private.alumni_log_fields('company_founders', to_jsonb(old)), app_private.alumni_log_fields('company_founders', to_jsonb(new)));
  end if;
  return null;
end $$;

-- a DELETE of a founders row (a manager, through the table) is logged like a removal
create or replace function app_private.alumni_log_founders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; c uuid;
begin
  if tg_op = 'INSERT' then
    perform app_private.alumni_log_put('founder', new.id, null, new.id, null, 'created', null, jsonb_build_object('name_en', new.name_en, 'name_ar', new.name_ar));
    return null;
  elsif tg_op = 'DELETE' then
    select coalesce(array_agg(cf.company_id order by cf.company_id), array[null]::uuid[]) into v_ids from public.company_founders cf where cf.founder_id = old.id;
    foreach c in array v_ids loop
      perform app_private.alumni_log_put('founder', old.id, c, old.id, null, 'removed', jsonb_build_object('name_en', old.name_en, 'name_ar', old.name_ar), null);
    end loop;
    return null;
  end if;
  select coalesce(array_agg(cf.company_id order by cf.company_id), array[null]::uuid[]) into v_ids from public.company_founders cf where cf.founder_id = new.id;
  foreach c in array v_ids loop
    perform app_private.alumni_log_diff('founder', new.id, c, new.id, null, app_private.alumni_log_fields('founders', to_jsonb(old)), app_private.alumni_log_fields('founders', to_jsonb(new)));
  end loop;
  return null;
end $$;
drop trigger if exists founders_ad_alumni_log on public.founders;
create trigger founders_ad_alumni_log after delete on public.founders for each row execute function app_private.alumni_log_founders();

-- ================================================================= 3. a save that changes nothing leaves the stamps and the version token alone
create or replace function app_private.touch_updated_at_if_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- name_key is a GENERATED column: it is not computed yet in a BEFORE trigger (NEW has null), so it is left out of the comparison (v64 proves no other generated column exists on these tables)
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['updated_at', 'updated_by', 'updated_source', 'name_key']) = (to_jsonb(old) - array['updated_at', 'updated_by', 'updated_source', 'name_key']) then
    return old;     -- nothing a person can see changed: the row is not written (no new token, no "last edited by", no log entry)
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function app_private.touch_updated_at_if_changed() from public, anon, authenticated;

drop trigger if exists companies_bu_touch on public.companies;
create trigger companies_bu_touch before update on public.companies for each row execute function app_private.touch_updated_at_if_changed();
drop trigger if exists founders_bu_touch on public.founders;
create trigger founders_bu_touch before update on public.founders for each row execute function app_private.touch_updated_at_if_changed();
drop trigger if exists company_founders_bu_touch on public.company_founders;
create trigger company_founders_bu_touch before update on public.company_founders for each row execute function app_private.touch_updated_at_if_changed();

-- ================================================================= 4. email_worker_finish: the ownership guard is two-valued now
do $$
declare v_def text; v_new text; f regprocedure := 'public.email_worker_finish(uuid,text,text,text,text,integer,text,text,integer)'::regprocedure;
begin
  v_def := pg_get_functiondef(f);
  if position(') is not true then' in v_def) > 0 then return; end if;        -- already patched (m62 source or an earlier run)
  v_new := replace(v_def,
    E'  if not ((o.status = ''sending'' and o.locked_by = p_worker)\n          or (o.status = ''needs_review'' and o.locked_by = p_worker and o.error_code = ''unknown_outcome'' and p_outcome = ''sent'')) then',
    E'  if ((o.status = ''sending'' and o.locked_by = p_worker)\n          or (o.status = ''needs_review'' and o.locked_by = p_worker and o.error_code = ''unknown_outcome'' and p_outcome = ''sent'')) is not true then');
  if v_new = v_def then raise exception 'm64: the ownership guard of email_worker_finish was not found'; end if;
  execute v_new;
end $$;

-- ================================================================= 5. remove_company_team_member: identity + soft delete BEFORE the membership row (their log entries keep the company id)
create or replace function public.remove_company_team_member(p_company uuid, p_founder uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; f public.founders; v_other boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into f from public.founders x where x.id = p_founder and x.deleted_at is null;
  if not found or not exists (select 1 from public.company_founders cf where cf.company_id = p_company and cf.founder_id = p_founder) then
    raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found';
  end if;
  if not v_mgr and f.auth_user_id is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_other := exists (select 1 from public.company_founders cf where cf.founder_id = p_founder and cf.company_id <> p_company);
  if f.auth_user_id is null and not v_other then
    delete from public.founder_identities i where i.founder_id = p_founder;
    update public.founders x set deleted_at = now() where x.id = p_founder;
  end if;
  delete from public.company_founders cf where cf.company_id = p_company and cf.founder_id = p_founder;
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(p_company, v_uid, v_mgr);
end $$;

-- ================================================================= 5b. the company timeline keeps the entries written about a person BEFORE his membership row existed (or after it went)
-- m60 showed a company-less founder entry only while the founder is a member NOW: after a removal the creation entries (name, e-mail, 'an ID is recorded') vanished from the company's timeline.
-- A member is a person the log itself ever put on this company's team (a 'team' entry of the company) or who is on it now.
do $$
declare v_def text; v_new text; f regprocedure := 'public.list_alumni_history(jsonb,integer,integer)'::regprocedure;
begin
  v_def := pg_get_functiondef(f);
  if position('m64: ever on the team' in v_def) > 0 then return; end if;
  v_new := replace(v_def, 'exists (select 1 from public.company_founders cf where cf.company_id = v_company and cf.founder_id = l.founder_id)))',
    'exists (select 1 from public.company_founders cf where cf.company_id = v_company and cf.founder_id = l.founder_id)
                or exists (select 1 from public.alumni_change_log tm where tm.company_id = v_company and tm.entity_type = ''team'' and tm.founder_id = l.founder_id)))   -- m64: ever on the team');
  if v_new = v_def then raise exception 'm64: the membership clause of list_alumni_history was not found'; end if;
  execute v_new;
end $$;

-- ================================================================= grants: nothing of the machinery is executable by an API role
do $$
declare p record;
begin
  for p in select pr.oid::regprocedure as f from pg_proc pr where pr.pronamespace = 'app_private'::regnamespace
            and pr.proname in ('nid_shape_pattern', 'nid_candidate_ok', 'contains_id', 'redact_ids_text', 'scan_id_shaped_values', 'alumni_log_fields', 'alumni_section_of', 'alumni_log_team', 'alumni_log_founders', 'touch_updated_at_if_changed') loop
    execute format('revoke all on function %s from public, anon, authenticated', p.f);
  end loop;
end $$;
revoke all on function public.remove_company_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_company_team_member(uuid, uuid) to authenticated;

-- ================================================================= self-check
do $$
begin
  if app_private.redact_ids_text('x 29901011234567 y') <> 'x [ID removed] y' then raise exception 'm64: Latin ID not redacted'; end if;
  if app_private.redact_ids_text(U&'\0662\0669\0669\0660\0661\0660\0661\0661\0662\0663\0664\0665\0666\0667') <> '[ID removed]' then raise exception 'm64: Arabic-Indic ID not redacted'; end if;
  if app_private.redact_ids_text('2 99 01 01 12345 67') <> '[ID removed]' then raise exception 'm64: spaced ID not redacted'; end if;
  if app_private.redact_ids_text('29901011234567890') <> '29901011234567890' then raise exception 'm64: a 17-digit number must stay'; end if;
  if app_private.redact_ids_text('Screenshot 2024-05-12 123456') <> 'Screenshot 2024-05-12 123456' then raise exception 'm64: a screenshot name is not an ID'; end if;
  if exists (select 1 from pg_trigger t where t.tgname in ('companies_bu_touch', 'founders_bu_touch', 'company_founders_bu_touch') and not t.tgisinternal and t.tgfoid <> 'app_private.touch_updated_at_if_changed()'::regprocedure) then
    raise exception 'm64: a touch trigger still uses the old function';
  end if;
  if (select count(*) from pg_trigger t where t.tgname in ('companies_bu_touch', 'founders_bu_touch', 'company_founders_bu_touch', 'founders_ad_alumni_log') and not t.tgisinternal) <> 4 then raise exception 'm64: a trigger is missing'; end if;
  if position(') is not true then' in pg_get_functiondef('public.email_worker_finish(uuid,text,text,text,text,integer,text,text,integer)'::regprocedure)) = 0 then raise exception 'm64: email_worker_finish guard'; end if;
  raise notice 'm64: review fixes in place';
end $$;
