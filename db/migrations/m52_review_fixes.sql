-- m52_review_fixes.sql  (the DATABASE findings of the independent review of m44 / m45 / m49 / m50 / m51; fixer task of 2026-10-14)
-- Re-runnable (create or replace / drop ... if exists / every in-place patch checks its own result). Local DB only. Run AFTER m49, m50 and m51 (and again after any re-run of them:
-- m49 / m50 / m51 re-create the functions this file patches in place, exactly like m50 patches m49).
--
--  1. save_node            : the revision conflict was raised with SQLSTATE 40001. PostgREST 14 RETRIES a 40001 transaction until it succeeds, so two people editing one node made
--                            a stale save spin for ever (a hot BEGIN / call / error loop that keeps running after the client has gone: a cheap denial of service on the API pool, and the
--                            conflict UI never saw the error). Now P0001 + hint `revision_conflict` + detail = the current rev (the same shape m50 gave `alumni_stale`). The client maps the hint.
--                            (m06b is edited too, so a re-run of it cannot bring the bug back; v03 / v11 / v36 expect the new state.)
--  2. national ID in a URL : PostgREST 14.7 serves a GET on a VOLATILE function that does not write (a read-only transaction), so "volatile = POST only" is NOT a guarantee. Every function that
--                            takes or returns a national ID now refuses GET / HEAD itself (`app_private.alumni_post_only`, SQLSTATE PT405 = HTTP 405). import_alumni_preview (rows with IDs) was STABLE:
--                            now VOLATILE. The first-party client always POSTs, so nothing changes for it.
--  3. two write paths      : a founder held table-level INSERT / UPDATE on companies and UPDATE on founders, so a direct PostgREST write skipped every RPC check (javascript: URLs, a logo path of
--                            somebody else, free text, soft-deleting his own row, a second company with an existing name). Now:
--                            * founders: INSERT / UPDATE revoked from `authenticated` (every writer is a definer RPC / trigger: save_my_founder_profile, save_company_team_member, handle_new_user ...);
--                            * companies: the identity / audit / ownership columns (id, created_at, deleted_at, name_key, and on UPDATE created_by + origin_project_id) are not client-writable;
--                              the trigger `companies_biu_write_guard` gives a non-manager direct write the SAME checks as the RPC (urls, links, logo path + own folder, lengths, deleted_at / origin_project_id,
--                              and a founder may not create or rename a company to a name that exists). Managers are trusted (they have the RPCs; a merge copies legacy values and must not be
--                              re-validated). Only values that CHANGE are checked, so legacy rows stay readable and editable. A unique index on name_key was NOT added: the Athar team's own
--                              duplicate-then-merge workflow (m21, `merge_companies`) needs the duplicates to exist.
--  4. companies mirrors    : sector_key -> industry_en/ar, governorate_code -> governorate_en/ar and established_on -> founding_year were written one-way by the RPC only; merge_companies and a
--                            direct write left them stale. The trigger `companies_biu_mirror` keeps them in step for EVERY writer: while a key is set the key wins (a direct edit of the text is
--                            put back); with no key the legacy text stays free (the Lists node path inserts text only).
--  5. national ID at rest  : one migrated selection item carried two valid-shaped IDs inside a pasted text (overlay.previous_reasons.rejected), readable by any PM of the project. The digits are
--                            redacted ONCE here (`app_private.redact_ids_json`), and `app_private.scan_id_shaped_values()` is the proof query v52 runs over every text / jsonb column of `public`.
--  6. unknown is not zero  : a company with no founder record showed team size 0, female founders 0, founders below 35 0 in the export, the manager table, the company page and the directory.
--                            `alumni_team_stats` now returns NULL for "female founders" / "below 35" when nobody of the team has a known gender / age, and the four consumers stop turning NULL into 0
--                            (a team with no record at all is a blank cell, not a zero).
--
-- No column is added, no table is added; the data changes are: the one redacted overlay (and the revision bump its trigger makes for that list node), nothing else.
-- Error tokens (message prefix = hint): `revision_conflict` (P0001, detail = the current rev), `post_only` (PT405), `alumni_invalid` (22023), `alumni_company_exists` (23505), `forbidden` (42501).
set search_path = public, extensions;

begin;

-- ================================================================= 1. save_node: the revision conflict is NOT a serialization failure
do $$
declare f regprocedure := 'public.save_node(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure; v_def text; v_new text;
begin
  v_def := pg_get_functiondef(f);
  v_new := replace(v_def, '''conflict: current rev %'', v_rev using errcode = ''40001'', detail = v_rev::text',
                          '''revision_conflict: current rev %'', v_rev using errcode = ''P0001'', hint = ''revision_conflict'', detail = v_rev::text');
  if v_new <> v_def then
    execute v_new;
    raise notice 'm52: save_node now raises revision_conflict with P0001';
  elsif position('errcode = ''P0001'', hint = ''revision_conflict''' in v_def) = 0 then
    raise exception 'm52: save_node has no revision conflict raise to patch';
  end if;
end $$;

-- ================================================================= 2. a national ID never travels in a URL: refuse GET / HEAD inside the functions that take or return one
create or replace function app_private.alumni_post_only() returns void
language plpgsql set search_path = '' as $$
begin
  -- PostgREST sets request.method for every request; a direct SQL session (tests, migrations) has none and passes
  if upper(coalesce(current_setting('request.method', true), '')) in ('GET', 'HEAD') then
    raise exception 'post_only: this call carries personal data and must be sent as a POST' using errcode = 'PT405', hint = 'post_only';
  end if;
end $$;

do $$
declare f regprocedure; v_def text; v_new text;
begin
  foreach f in array array[
    'public.preview_national_id(text)'::regprocedure, 'public.import_alumni_preview(jsonb)'::regprocedure, 'public.save_my_founder_profile(jsonb)'::regprocedure,
    'public.save_company_team_member(uuid,uuid,jsonb)'::regprocedure, 'public.save_alumni_founder(uuid,jsonb)'::regprocedure, 'public.get_alumni_founder(uuid,boolean)'::regprocedure,
    'public.export_alumni_rows(jsonb,integer,text,date)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    if position('app_private.alumni_post_only()' in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform app_private.alumni_post_only();   -- m52: personal data never travels in a URL (GET / HEAD refused)\n');
    if v_new = v_def then raise exception 'm52: no BEGIN to patch in %', f; end if;
    if f = 'public.import_alumni_preview(jsonb)'::regprocedure then
      -- the rows of the owner's sheet carry national IDs: it must not be a STABLE function (PostgREST serves those by GET)
      v_new := replace(v_new, ' STABLE SECURITY DEFINER', ' SECURITY DEFINER');
      if position(' STABLE SECURITY DEFINER' in v_new) > 0 then raise exception 'm52: import_alumni_preview is still STABLE'; end if;
    end if;
    execute v_new;
    raise notice 'm52: % now refuses GET / HEAD', f;
  end loop;
end $$;

-- ================================================================= 3. ONE write path for companies and founders
-- 3a. founders: no client writes the table directly (every writer is a definer RPC or the sign-up trigger)
revoke insert, update on public.founders from authenticated;

-- 3b. companies: the client may write the columns the Lists node and the typed-column guard already know, not the identity / audit / ownership ones
revoke insert, update on public.companies from authenticated;
do $$
declare v_ins text; v_upd text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_ins from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'companies' and c.column_name not in ('id', 'created_at', 'updated_at', 'deleted_at', 'name_key');
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_upd from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'companies' and c.column_name not in ('id', 'created_at', 'updated_at', 'deleted_at', 'name_key', 'created_by', 'origin_project_id');
  execute 'grant insert (' || v_ins || ') on public.companies to authenticated';
  execute 'grant update (' || v_upd || ') on public.companies to authenticated';
end $$;

-- 3c. the value checks of the RPC path, reusable (every one raises the m49 `alumni_invalid` refusal: 22023, hint = token, detail = "<field>:<reason>")
create or replace function app_private.alumni_check_len(p_field text, p_value text, p_max integer) returns void
language plpgsql set search_path = '' as $$
begin
  if p_value is not null and char_length(p_value) > p_max then perform app_private.alumni_fail(p_field, 'too_long'); end if;
end $$;

create or replace function app_private.alumni_check_url(p_field text, p_value text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_value is not null and (char_length(p_value) > 500 or p_value !~* '^https?://[^[:space:]]+$') then perform app_private.alumni_fail(p_field, 'bad_url'); end if;
end $$;

-- links: a jsonb array of objects; every `url` is http(s); kind / type / label are short strings (legacy {type,label,url} and the m49 {kind,url,label} both pass)
create or replace function app_private.alumni_check_links(p_links jsonb) returns void
language plpgsql set search_path = '' as $$
declare e jsonb; k text;
begin
  if p_links is null then return; end if;
  if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 30 then perform app_private.alumni_fail('links', 'bad_value'); end if;
  for e in select x.value from jsonb_array_elements(p_links) x loop
    if jsonb_typeof(e) <> 'object' then perform app_private.alumni_fail('links', 'bad_value'); end if;
    if e ? 'url' and (jsonb_typeof(e->'url') <> 'string' or char_length(e->>'url') > 500 or (e->>'url') !~* '^https?://[^[:space:]]+$') then perform app_private.alumni_fail('links', 'bad_url'); end if;
    foreach k in array array['kind', 'type', 'label'] loop
      if e ? k and (jsonb_typeof(e->k) <> 'string' or char_length(e->>k) > 60) then perform app_private.alumni_fail('links', 'bad_value'); end if;
    end loop;
  end loop;
end $$;

create or replace function app_private.companies_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; v_founder boolean; v_key text;
begin
  if v_uid is null then return new; end if;                  -- migrations / loaders / the service role
  v_mgr := app_private.alumni_is_manager();
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'forbidden: id and created_at never change' using errcode = '42501';
  end if;
  if v_mgr then return new; end if;                          -- managers use the RPCs; a merge copies legacy values that must not be re-validated

  -- ownership / audit columns (the column privileges already refuse them to the API roles: this is the second wall for any definer path)
  if (tg_op = 'INSERT' and new.deleted_at is not null) or (tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at) then
    raise exception 'forbidden: only an alumni manager can delete or restore a company' using errcode = '42501';
  end if;
  v_founder := app_private.has_role('founder');
  if tg_op = 'UPDATE' and new.origin_project_id is distinct from old.origin_project_id then
    raise exception 'forbidden: the origin project of a company never changes' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.origin_project_id is not null and (v_founder or not app_private.is_project_manager(new.origin_project_id)) then
    raise exception 'forbidden: a company can only record a project the creator manages' using errcode = '42501';
  end if;

  -- the value checks of the RPC path (only what CHANGES is checked: a legacy value stays readable and the row stays editable)
  if tg_op = 'INSERT' or new.name_en is distinct from old.name_en then perform app_private.alumni_check_len('name_en', new.name_en, 200); end if;
  if tg_op = 'INSERT' or new.name_ar is distinct from old.name_ar then perform app_private.alumni_check_len('name_ar', new.name_ar, 200); end if;
  if tg_op = 'INSERT' or new.description_en is distinct from old.description_en then perform app_private.alumni_check_len('description_en', new.description_en, 4000); end if;
  if tg_op = 'INSERT' or new.description_ar is distinct from old.description_ar then perform app_private.alumni_check_len('description_ar', new.description_ar, 4000); end if;
  if tg_op = 'INSERT' or new.location_en is distinct from old.location_en then perform app_private.alumni_check_len('location_en', new.location_en, 300); end if;
  if tg_op = 'INSERT' or new.location_ar is distinct from old.location_ar then perform app_private.alumni_check_len('location_ar', new.location_ar, 300); end if;
  if tg_op = 'INSERT' or new.industry_en is distinct from old.industry_en then perform app_private.alumni_check_len('industry_en', new.industry_en, 200); end if;
  if tg_op = 'INSERT' or new.industry_ar is distinct from old.industry_ar then perform app_private.alumni_check_len('industry_ar', new.industry_ar, 200); end if;
  if tg_op = 'INSERT' or new.governorate_en is distinct from old.governorate_en then perform app_private.alumni_check_len('governorate_en', new.governorate_en, 100); end if;
  if tg_op = 'INSERT' or new.governorate_ar is distinct from old.governorate_ar then perform app_private.alumni_check_len('governorate_ar', new.governorate_ar, 100); end if;
  if tg_op = 'INSERT' or new.employees is distinct from old.employees then perform app_private.alumni_check_len('employees', new.employees, 100); end if;
  if tg_op = 'INSERT' or new.website_url is distinct from old.website_url then perform app_private.alumni_check_url('website_url', new.website_url); end if;
  if tg_op = 'INSERT' or new.linkedin_url is distinct from old.linkedin_url then perform app_private.alumni_check_url('linkedin_url', new.linkedin_url); end if;
  if tg_op = 'INSERT' or new.app_url is distinct from old.app_url then perform app_private.alumni_check_url('app_url', new.app_url); end if;
  if tg_op = 'INSERT' or new.links is distinct from old.links then perform app_private.alumni_check_links(new.links); end if;

  -- the logo: the same shape as the RPC (a founder: WebP in HIS OWN folder only; staff: WebP or SVG under the folders the Lists node uses), and the file must exist
  if new.logo_path is not null and (tg_op = 'INSERT' or new.logo_path is distinct from old.logo_path) then
    if v_founder then
      if new.logo_path !~ '^alumni/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then perform app_private.alumni_fail('logo_path', 'bad_path'); end if;
      if not starts_with(new.logo_path, 'alumni/' || v_uid::text || '/logo/') then perform app_private.alumni_fail('logo_path', 'not_your_folder'); end if;
    elsif new.logo_path !~ '^(alumni/[0-9a-f-]{36}/logo|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9_-]+|global/[a-z0-9_-]+)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|svg)$' then
      perform app_private.alumni_fail('logo_path', 'bad_path');
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'public-assets' and o.name = new.logo_path) then perform app_private.alumni_fail('logo_path', 'file_missing'); end if;
  end if;

  -- a founder never creates a second copy of a company that exists (the Athar team links him by invitation, 03 OD-8); the answer never says who owns it
  if v_founder and (tg_op = 'INSERT' or lower(btrim(coalesce(new.name_en, new.name_ar))) is distinct from lower(btrim(coalesce(old.name_en, old.name_ar)))) then
    v_key := lower(btrim(coalesce(new.name_en, new.name_ar)));
    if v_key is not null and exists (select 1 from public.companies c where c.name_key = v_key and c.deleted_at is null and c.id <> new.id) then
      raise exception 'alumni_company_exists: a company with this name already exists; ask the Athar team to link your account' using errcode = '23505', hint = 'alumni_company_exists';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists companies_biu_write_guard on public.companies;
create trigger companies_biu_write_guard before insert or update on public.companies for each row execute function app_private.companies_write_guard();

-- ================================================================= 4. the legacy mirrors follow the typed keys for EVERY writer
create or replace function app_private.companies_sync_mirrors() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_en text; v_ar text; v_found boolean;
begin
  -- sector_key -> industry_en / industry_ar
  if new.sector_key is not null then
    if tg_op = 'INSERT' or new.sector_key is distinct from old.sector_key or new.industry_en is distinct from old.industry_en or new.industry_ar is distinct from old.industry_ar then
      select l.label_en, l.label_ar into v_en, v_ar from public.alumni_lookups l where l.kind = 'sector' and l.key = new.sector_key;
      if found then new.industry_en := v_en; new.industry_ar := v_ar; end if;     -- an unknown key is refused by the m49 guard
    end if;
  elsif tg_op = 'UPDATE' and old.sector_key is not null then
    new.industry_en := null; new.industry_ar := null;                          -- the key was cleared: so is its mirror (what the RPC does)
  end if;
  -- governorate_code -> governorate_en / governorate_ar
  if new.governorate_code is not null then
    if tg_op = 'INSERT' or new.governorate_code is distinct from old.governorate_code or new.governorate_en is distinct from old.governorate_en or new.governorate_ar is distinct from old.governorate_ar then
      v_en := app_private.eg_governorate_name(new.governorate_code::integer, 'en'); v_ar := app_private.eg_governorate_name(new.governorate_code::integer, 'ar');
      if v_en is not null then new.governorate_en := v_en; new.governorate_ar := v_ar; end if;
    end if;
  elsif tg_op = 'UPDATE' and old.governorate_code is not null then
    new.governorate_en := null; new.governorate_ar := null;
  end if;
  -- established_on -> founding_year
  if new.established_on is not null then
    if tg_op = 'INSERT' or new.established_on is distinct from old.established_on or new.founding_year is distinct from old.founding_year then
      new.founding_year := extract(year from new.established_on)::smallint;
    end if;
  elsif tg_op = 'UPDATE' and old.established_on is not null then
    new.founding_year := null;
  end if;
  return new;
end $$;
drop trigger if exists companies_biu_mirror on public.companies;
create trigger companies_biu_mirror before insert or update on public.companies for each row execute function app_private.companies_sync_mirrors();

-- ================================================================= 5. a national ID outside founder_identities
-- 14 digits, digit 1 = the century (2 / 3), standing alone (no letter or digit next to it). The same pattern is the scan v52 runs.
create or replace function app_private.redact_ids_text(p_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(p_text, '(?<![0-9A-Za-z])[23][0-9]{13}(?![0-9A-Za-z])', '[ID removed]', 'g')
$$;

create or replace function app_private.redact_ids_json(p_json jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb;
begin
  case jsonb_typeof(p_json)
    when 'string' then return to_jsonb(app_private.redact_ids_text(p_json #>> '{}'));
    when 'array' then
      select coalesce(jsonb_agg(app_private.redact_ids_json(x.value) order by x.ord), '[]'::jsonb) into r from jsonb_array_elements(p_json) with ordinality x(value, ord);
      return r;
    when 'object' then
      select coalesce(jsonb_object_agg(x.key, app_private.redact_ids_json(x.value)), '{}'::jsonb) into r from jsonb_each(p_json) x;
      return r;
    when 'number' then
      return case when p_json::text ~ '^[23][0-9]{13}$' then 'null'::jsonb else p_json end;
    else return p_json;
  end case;
end $$;

-- jsonb::text escapes a line break as backslash + n, which would hide an ID that follows one from a "no letter next to it" test: the escapes become spaces first (chr(92) = backslash)
create or replace function app_private.json_scan_text(p_json jsonb) returns text
language sql immutable parallel safe set search_path = '' as $$
  select replace(replace(replace(replace(p_json::text, chr(92) || 'n', ' '), chr(92) || 't', ' '), chr(92) || 'r', ' '), chr(92) || '"', ' ')
$$;

-- the proof query: every text / varchar / citext / jsonb column of `public` (the one table that may hold an ID is excluded) with the number of values that contain an ID-shaped number
create or replace function app_private.scan_id_shaped_values() returns table (table_name text, column_name text, hits bigint)
language plpgsql stable security definer set search_path = '' as $$
declare r record; n bigint;
begin
  for r in select c.table_name::text as t, c.column_name::text as col, c.data_type::text as dt from information_schema.columns c
             join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.table_name <> 'founder_identities' and c.data_type in ('text', 'character varying', 'jsonb', 'USER-DEFINED')
              and (c.data_type <> 'USER-DEFINED' or c.udt_name = 'citext')
            order by 1, 2 loop
    execute format('select count(*) from public.%I where %s ~ %L', r.t, case when r.dt = 'jsonb' then format('app_private.json_scan_text(%I)', r.col) else format('%I::text', r.col) end,
                   '(^|[^0-9A-Za-z])[23][0-9]{13}([^0-9A-Za-z]|$)') into n;
    if n > 0 then table_name := r.t; column_name := r.col; hits := n; return next; end if;
  end loop;
end $$;

-- the one known row: the PM's pasted text. A PM of the project could read it (list_items_select_pm), decision 19.4 says the ID is readable only by its owner and the alumni managers.
update public.list_items set overlay = app_private.redact_ids_json(overlay)
 where app_private.json_scan_text(overlay) ~ '(^|[^0-9A-Za-z])[23][0-9]{13}([^0-9A-Za-z]|$)';

-- ================================================================= 6. unknown is not zero: team counts
create or replace function app_private.alumni_team_stats(p_today date default app_private.alumni_today(), p_company uuid default null)
returns table (company_id uuid, team_size integer, female_founders integer, founders_under_35 integer)
language sql stable security definer set search_path = '' as $$
  select cf.company_id, count(*)::int,
         case when count(a.gender) = 0 then null else (count(*) filter (where a.gender = 'female'))::int end,      -- nobody of the team has a known gender: unknown, not 0
         case when count(a.age) = 0 then null else (count(*) filter (where a.age < 35))::int end
    from public.company_founders cf
    join public.founders f on f.id = cf.founder_id and f.deleted_at is null
    left join app_private.alumni_founder_attrs(p_today) a on a.founder_id = f.id
   where p_company is null or cf.company_id = p_company
   group by cf.company_id
$$;

do $$
declare f regprocedure; v_def text; v_new text; v_pat text;
begin
  foreach f in array array['public.export_alumni_rows(jsonb,integer,text,date)'::regprocedure, 'public.list_alumni_table(jsonb,integer,integer,text,text,integer)'::regprocedure,
                           'app_private.alumni_company_payload(uuid,uuid,boolean)'::regprocedure, 'app_private.alumni_directory_page(jsonb,text,integer,integer,text)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_new := v_def;
    foreach v_pat in array array['team_size', 'female_founders', 'founders_under_35'] loop
      v_new := replace(v_new, 'coalesce(ts.' || v_pat || ', 0)', 'ts.' || v_pat);
    end loop;
    if v_new <> v_def then
      execute v_new;
      raise notice 'm52: % no longer turns an unknown team count into 0', f;
    elsif v_def !~ 'ts\.team_size' then
      raise exception 'm52: % has no team count to patch', f;
    end if;
  end loop;
end $$;

-- ================================================================= grants: nothing new is executable by an API role
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace
            and p.proname in ('alumni_post_only', 'alumni_check_len', 'alumni_check_url', 'alumni_check_links', 'companies_write_guard', 'companies_sync_mirrors',
                              'redact_ids_text', 'redact_ids_json', 'json_scan_text', 'scan_id_shaped_values') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;

analyze public.companies;

-- ================================================================= self-check
do $$
declare v_bad integer;
begin
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ~* 'errcode\s*=\s*''(40001|40P01)''') then
    raise exception 'm52: a function still raises SQLSTATE 40001 / 40P01 (PostgREST retries those for ever)';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc like '%app_private.alumni_post_only()%') <> 7 then raise exception 'm52: the GET guard is not in the 7 ID functions'; end if;
  if (select p.provolatile from pg_proc p where p.oid = 'public.import_alumni_preview(jsonb)'::regprocedure) <> 'v' then raise exception 'm52: import_alumni_preview is not VOLATILE'; end if;
  if has_table_privilege('authenticated', 'public.founders', 'INSERT') or has_table_privilege('authenticated', 'public.founders', 'UPDATE')
     or has_column_privilege('authenticated', 'public.founders', 'phone', 'UPDATE') then raise exception 'm52: authenticated can still write founders'; end if;
  if has_table_privilege('authenticated', 'public.companies', 'UPDATE') or has_table_privilege('authenticated', 'public.companies', 'INSERT') then raise exception 'm52: authenticated still has table-level companies writes'; end if;
  select count(*) into v_bad from unnest(array['id', 'created_at', 'deleted_at', 'name_key']) c where has_column_privilege('authenticated', 'public.companies', c, 'UPDATE') or has_column_privilege('authenticated', 'public.companies', c, 'INSERT');
  if v_bad > 0 then raise exception 'm52: % protected company column(s) are client-writable', v_bad; end if;
  if has_column_privilege('authenticated', 'public.companies', 'created_by', 'UPDATE') or has_column_privilege('authenticated', 'public.companies', 'origin_project_id', 'UPDATE') then raise exception 'm52: created_by / origin_project_id are updatable'; end if;
  if not has_column_privilege('authenticated', 'public.companies', 'name_en', 'INSERT') or not has_column_privilege('authenticated', 'public.companies', 'links', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.companies', 'created_by', 'INSERT') then raise exception 'm52: the Lists node path lost a column privilege'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.companies'::regclass and tgname in ('companies_biu_write_guard', 'companies_biu_mirror', 'companies_bu_alumni_guard') and not tgisinternal) <> 3 then raise exception 'm52: a companies trigger is missing'; end if;
  if exists (select 1 from app_private.scan_id_shaped_values()) then raise exception 'm52: an ID-shaped number is still stored outside founder_identities'; end if;
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname in ('alumni_post_only', 'alumni_check_len', 'alumni_check_url', 'alumni_check_links', 'companies_write_guard',
    'companies_sync_mirrors', 'redact_ids_text', 'redact_ids_json', 'json_scan_text', 'scan_id_shaped_values') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then raise exception 'm52: % helper(s) executable by an API role', v_bad; end if;
  raise notice 'm52 ok';
end $$;

commit;
