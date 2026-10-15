-- m78_network_experts_review_fixes.sql  (Athar Network experts registry: the fixes of the review of m75 / m76 / m77)
-- Re-runnable (add column if not exists / create or replace / drop ... if exists). Local DB only. Run AFTER m75, m76, m77 (it replaces some of their functions: after ANY re-run of
-- m75 / m76 / m77 run m78 again). Verify with db/verify/v78_network_experts_review_fixes.sql.
--
-- WHAT THIS CHANGES (each point = a finding of the review)
--  1. The registry has ONE writer: the RPCs. The old direct INSERT / UPDATE policies of the project_manager (m07) are dropped and INSERT / UPDATE are revoked from `authenticated`: a PM could bypass
--     expert_clean (kind, URL scheme, e-mail, photo path, link shapes), spoof created_by / archived_by and store a `links` array that crashed the profile page for everybody. The table gets
--     CHECKs as defence in depth (URL scheme, e-mail, lengths, photo folder, link shape), the guard trigger stamps created_by / archived_by from the session and refuses a kind change by a
--     non-super_admin, a hard DELETE of an expert a list item still uses is refused (it would have set every item's expert to NULL), soft-deleted / merged rows are readable by the super_admin only.
--  2. Photos: photo_path is exactly global/expert-photo/<uuid>.webp (RPC + CHECK); update_network_expert hands the old path back ONLY when no other record (live, soft-deleted or in a
--     merge before-image) still points at it; the storage policies let staff remove a photo object only when nothing references it and add one only as image/webp.
--  3. The duplicate engine no longer scores every pair: stored keys (name_en_key / name_ar_key / link_key / email_key) + trigram / skeleton / link / e-mail CANDIDATES feed expert_match, so a
--     typed name costs ~10 ms, and the PAIRS of the registry are materialised (app_private.network_expert_pairs, maintained by a trigger when a record is created or its name / e-mail / link /
--     kind / deleted state changes): the finder reads a table instead of scoring n^2 pairs (it hit the 8 s API timeout from ~250 records). The import takes a p_seen argument so a big file can
--     go in chunks of ~50 rows (each call stays far below the timeout) and its preview also sees repeats INSIDE the file (name in either language, e-mail, LinkedIn).
--  4. Merge: a withdrawn mismatch is a blocker for the WHOLE project (the m43 rule: an expert is withdrawn project-wide), the inheritance of the withdrawal follows a merge redirect, the tag union
--     is capped at 12, every dependent row that is dropped by a collapse is kept in the audit, the collapsed provider keeps is_active / sort_order; the guards take a KEY SHARE lock on the expert
--     (a list item cannot land on an expert that a concurrent merge / delete is removing) and delete / merge lock the row FOR UPDATE.
--  5. Participation: a legacy HIDDEN list item (list_items.excluded, the 2 migrated provider items) counts when it has a real role (provider / mentor / presenter) or sessions and is flagged; a
--     hidden item that is only "listed" is not a participation. The search text carries only the LinkedIn HANDLE ("in" / "com" no longer match everybody).
--  6. Small: p_offset overflow of list_network_experts, a PM can no longer un-archive a tag by typing it and a call creates at most 50 new tags, network_expert_usage returns only the projects the
--     caller manages.
set search_path = public, extensions;

begin;

-- ================================================================= 1. stored keys of the duplicate engine
alter table public.network_experts
  add column if not exists name_en_key text,
  add column if not exists name_ar_key text,
  add column if not exists link_key    text,
  add column if not exists email_key   text;

create index if not exists network_experts_name_en_key_trgm_idx on public.network_experts using gin (name_en_key gin_trgm_ops);
create index if not exists network_experts_name_ar_key_trgm_idx on public.network_experts using gin (name_ar_key gin_trgm_ops);
create index if not exists network_experts_link_key_idx on public.network_experts (link_key) where link_key is not null;
create index if not exists network_experts_email_key_idx on public.network_experts (email_key) where email_key is not null;

create or replace function app_private.network_experts_derive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_link text := app_private.expert_linkkey(new.linkedin_url);
begin
  -- the search text carries the HANDLE of the profile link only (the host / path boilerplate of every LinkedIn link made "in", "com", "linkedin" match almost everybody)
  new.search_text := app_private.expert_norm(concat_ws(' ', new.name_en, new.name_ar, new.title_en, new.title_ar, new.company_en, new.company_ar, new.email::text,
                       case when position('/' in v_link) > 0 then regexp_replace(v_link, '^[^/]*/+((in|pub|company|school|profile)/+)?', '') end));
  new.name_en_key := app_private.expert_norm(new.name_en);
  new.name_ar_key := app_private.expert_norm(new.name_ar);
  new.name_key := btrim(new.name_en_key || ' ' || new.name_ar_key);
  new.name_skels := coalesce((select array_agg(distinct s) from unnest(array[app_private.expert_skeleton(new.name_en), app_private.expert_skeleton(new.name_ar)]) s where char_length(s) >= 4), '{}'::text[]);
  new.link_key := case when position('/' in v_link) > 0 then v_link end;                      -- only a link with a path can be "the same profile" (expert_match)
  new.email_key := nullif(lower(btrim(coalesce(new.email::text, ''))), '');
  return new;
end $$;

-- created_by / archived_by / updated_by come from the SESSION (a spoofed value of a caller is overwritten); deleted_at / merged_into / kind are the super_admin's. A call without a signed-in
-- user (the migrations, service_role) is trusted.
create or replace function app_private.network_experts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and not coalesce(app_private.is_super_admin(), false) then
    if tg_op = 'INSERT' then
      if new.deleted_at is not null or new.merged_into is not null then raise exception 'forbidden' using errcode = '42501'; end if;
    elsif old.deleted_at is distinct from new.deleted_at or old.merged_into is distinct from new.merged_into or old.kind is distinct from new.kind then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if v_uid is not null then
    if tg_op = 'INSERT' then
      new.created_by := v_uid;
      new.archived_by := case when new.archived_at is not null then v_uid end;
    else
      -- a value can only be CLEARED by the foreign key (a deleted user: ON DELETE SET NULL), never changed to another user
      if new.created_by is not null then new.created_by := old.created_by; end if;
      new.archived_by := case when new.archived_at is null then null
                              when old.archived_at is not distinct from new.archived_at then case when new.archived_by is null then null else old.archived_by end
                              else v_uid end;
    end if;
    new.updated_by := v_uid;
  elsif tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_uid);
  end if;
  return new;
end $$;

-- a hard DELETE through the API (a super_admin) must never orphan a list item: the foreign key is ON DELETE SET NULL, so the items of the expert would silently lose their person
create or replace function app_private.network_experts_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and exists (select 1 from public.list_items li where li.network_expert_id = old.id) then
    raise exception 'expert_in_use: a list item still uses this expert' using errcode = 'P0001', hint = 'expert_in_use';
  end if;
  return old;
end $$;
drop trigger if exists network_experts_bd_inuse on public.network_experts;
create trigger network_experts_bd_inuse before delete on public.network_experts for each row execute function app_private.network_experts_delete_guard();

-- re-derive every stored key (the touch trigger is off: `updated_at`, business data, does not move)
alter table public.network_experts disable trigger network_experts_bu_touch;
update public.network_experts set name_key = name_key;
alter table public.network_experts enable trigger network_experts_bu_touch;

-- ================================================================= 2. validation: the photo is exactly the registry folder
create or replace function app_private.expert_clean(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  o jsonb := '{}'::jsonb; k text; v text; el jsonb; arr text[]; links jsonb; n int; u text; kd text;
  c_short constant text[] := array['name_en', 'name_ar', 'title_en', 'title_ar', 'company_en', 'company_ar'];
  c_long constant text[] := array['bio_en', 'bio_ar', 'notes'];
  c_url constant text[] := array['linkedin_url', 'website_url'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform app_private.expert_fail('payload', 'bad_value'); end if;
  foreach k in array c_short loop
    if p ? k then
      if jsonb_typeof(p->k) not in ('string', 'null') then perform app_private.expert_fail(k, 'bad_type'); end if;
      v := nullif(btrim(regexp_replace(coalesce(p->>k, ''), '\s+', ' ', 'g')), '');
      if char_length(coalesce(v, '')) > 200 then perform app_private.expert_fail(k, 'too_long'); end if;
      o := o || jsonb_build_object(k, v);
    end if;
  end loop;
  foreach k in array c_long loop
    if p ? k then
      if jsonb_typeof(p->k) not in ('string', 'null') then perform app_private.expert_fail(k, 'bad_type'); end if;
      v := nullif(btrim(regexp_replace(regexp_replace(replace(coalesce(p->>k, ''), E'\r', ''), '[ \t]+', ' ', 'g'), E'\n{3,}', E'\n\n', 'g')), '');
      if char_length(coalesce(v, '')) > 4000 then perform app_private.expert_fail(k, 'too_long'); end if;
      o := o || jsonb_build_object(k, v);
    end if;
  end loop;
  foreach k in array c_url loop
    if p ? k then
      if jsonb_typeof(p->k) not in ('string', 'null') then perform app_private.expert_fail(k, 'bad_type'); end if;
      v := nullif(btrim(coalesce(p->>k, '')), '');
      if v is not null and (char_length(v) > 500 or v !~* '^https?://[^[:space:]]+$') then perform app_private.expert_fail(k, 'invalid'); end if;
      o := o || jsonb_build_object(k, v);
    end if;
  end loop;
  if p ? 'email' then
    if jsonb_typeof(p->'email') not in ('string', 'null') then perform app_private.expert_fail('email', 'bad_type'); end if;
    v := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
    if v is not null and (char_length(v) > 254 or v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then perform app_private.expert_fail('email', 'invalid'); end if;
    o := o || jsonb_build_object('email', v);
  end if;
  if p ? 'phone' then
    if jsonb_typeof(p->'phone') not in ('string', 'null') then perform app_private.expert_fail('phone', 'bad_type'); end if;
    v := nullif(btrim(regexp_replace(coalesce(p->>'phone', ''), '\s+', ' ', 'g')), '');
    if v is not null and v !~ '^\+?[0-9][0-9 ().-]{3,38}$' then perform app_private.expert_fail('phone', 'invalid'); end if;
    o := o || jsonb_build_object('phone', v);
  end if;
  if p ? 'photo_path' then
    if jsonb_typeof(p->'photo_path') not in ('string', 'null') then perform app_private.expert_fail('photo_path', 'bad_type'); end if;
    v := nullif(btrim(coalesce(p->>'photo_path', '')), '');
    -- exactly the folder of the registry photos (the storage policy's pattern): any other object of the bucket could be deleted by whoever replaces the photo next
    if v is not null and v !~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then perform app_private.expert_fail('photo_path', 'invalid'); end if;
    o := o || jsonb_build_object('photo_path', v);
  end if;
  if p ? 'kind' then
    if jsonb_typeof(p->'kind') <> 'string' or (p->>'kind') not in ('expert', 'team') then perform app_private.expert_fail('kind', 'bad_value'); end if;
    o := o || jsonb_build_object('kind', p->>'kind');
  end if;
  if p ? 'languages' then
    if jsonb_typeof(p->'languages') <> 'array' then perform app_private.expert_fail('languages', 'bad_type'); end if;
    arr := '{}'::text[];
    for el in select * from jsonb_array_elements(p->'languages') loop
      v := lower(btrim(coalesce(el #>> '{}', '')));
      if jsonb_typeof(el) <> 'string' or v !~ '^[a-z]{2,3}$' then perform app_private.expert_fail('languages', 'bad_value'); end if;
      if not (v = any (arr)) then arr := array_append(arr, v); end if;
    end loop;
    if cardinality(arr) > 8 then perform app_private.expert_fail('languages', 'too_many'); end if;
    o := o || jsonb_build_object('languages', to_jsonb(arr));
  end if;
  if p ? 'links' then
    if jsonb_typeof(p->'links') <> 'array' then perform app_private.expert_fail('links', 'bad_type'); end if;
    links := '[]'::jsonb;
    for el in select * from jsonb_array_elements(p->'links') loop
      u := case when jsonb_typeof(el) = 'string' then el #>> '{}' when jsonb_typeof(el) = 'object' and jsonb_typeof(el->'url') = 'string' then el->>'url' end;
      u := nullif(btrim(coalesce(u, '')), '');
      if u is null then continue; end if;
      if char_length(u) > 500 or u !~* '^https?://[^[:space:]]+$' then perform app_private.expert_fail('links', 'invalid'); end if;
      kd := case when jsonb_typeof(el) = 'object' and jsonb_typeof(el->'kind') = 'string' and lower(el->>'kind') ~ '^[a-z]{1,20}$' then lower(el->>'kind') else 'other' end;
      if not exists (select 1 from jsonb_array_elements(links) x where x->>'url' = u) then links := links || jsonb_build_array(jsonb_build_object('kind', kd, 'url', u)); end if;
    end loop;
    if jsonb_array_length(links) > 6 then perform app_private.expert_fail('links', 'too_many'); end if;
    o := o || jsonb_build_object('links', links);
  end if;
  if p ? 'tags' then
    if jsonb_typeof(p->'tags') <> 'array' then perform app_private.expert_fail('tags', 'bad_type'); end if;
    if jsonb_array_length(p->'tags') > 12 then perform app_private.expert_fail('tags', 'too_many'); end if;
    o := o || jsonb_build_object('tags', p->'tags');
  end if;
  return o;
end $$;

-- ================================================================= 3. the table defends itself (defence in depth: the RPCs are the only writer, but a CHECK costs nothing)
create or replace function app_private.expert_links_ok(p jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(p) = 'array' then
    jsonb_array_length(p) <= 6 and not exists (
      select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) is distinct from 'object'
          or jsonb_typeof(e->'url') is distinct from 'string'
          or char_length(e->>'url') > 500
          or (e->>'url') !~* '^https?://[^[:space:]]+$'
          or (e ? 'kind' and jsonb_typeof(e->'kind') is distinct from 'string'))
  else false end
$$;
revoke all on function app_private.expert_links_ok(jsonb) from public, anon, authenticated;
grant execute on function app_private.expert_links_ok(jsonb) to service_role;

alter table public.network_experts drop constraint if exists network_experts_urls_chk;
alter table public.network_experts add constraint network_experts_urls_chk check (
  (linkedin_url is null or (char_length(linkedin_url) <= 500 and (linkedin_url ~* '^https?://[^[:space:]]+$' or linkedin_url ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/[^[:space:]]*)?$')))
  and (website_url is null or (char_length(website_url) <= 500 and (website_url ~* '^https?://[^[:space:]]+$' or website_url ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/[^[:space:]]*)?$')))
);   -- the second alternative is a link WITHOUT a scheme ("linkedin.com/in/x": one migrated record has it); a scheme such as javascript: / data: never matches
alter table public.network_experts drop constraint if exists network_experts_email_chk;
alter table public.network_experts add constraint network_experts_email_chk check (email is null or (char_length(email::text) <= 254 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
alter table public.network_experts drop constraint if exists network_experts_text_len_chk;
alter table public.network_experts add constraint network_experts_text_len_chk check (
  char_length(coalesce(name_en, '')) <= 200 and char_length(coalesce(name_ar, '')) <= 200 and char_length(coalesce(title_en, '')) <= 200 and char_length(coalesce(title_ar, '')) <= 200
  and char_length(coalesce(company_en, '')) <= 200 and char_length(coalesce(company_ar, '')) <= 200 and char_length(coalesce(bio_en, '')) <= 4000 and char_length(coalesce(bio_ar, '')) <= 4000);
alter table public.network_experts drop constraint if exists network_experts_photo_chk;
alter table public.network_experts add constraint network_experts_photo_chk check (photo_path is null or photo_path ~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$');
alter table public.network_experts drop constraint if exists network_experts_links_shape_chk;
alter table public.network_experts add constraint network_experts_links_shape_chk check (app_private.expert_links_ok(links));

-- ================================================================= 4. one writer: the RPCs
drop policy if exists network_experts_insert_pm_role on public.network_experts;
drop policy if exists network_experts_update_pm_role on public.network_experts;
revoke insert, update on public.network_experts from authenticated, anon;
-- live records for every staff role; soft-deleted / merged ones (notes, phone, e-mail included) for the super_admin only
drop policy if exists network_experts_select_staff on public.network_experts;
create policy network_experts_select_staff on public.network_experts for select to authenticated
  using ((select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin'])) and (deleted_at is null or (select app_private.is_super_admin())));

-- the pre-registry usage function returned program / project ids across ALL programs to any staff role: only the projects the caller manages now (the registry shows the rest as a count)
create or replace function public.network_expert_usage(p_expert uuid)
returns table (project_id uuid, program_id uuid, list_node_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select distinct j.id, j.program_id, li.list_node_id
      from public.list_items li
      join public.nodes n on n.id = li.list_node_id and n.deleted_at is null
      join public.projects j on j.id = n.project_id and j.deleted_at is null
     where li.network_expert_id = p_expert and coalesce(app_private.is_project_manager(j.id), false);
end $$;

-- ================================================================= 5. photo files: a file is removed only when no record (live, soft-deleted, merge before-image) points at it
create or replace function app_private.expert_photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.network_experts ne where ne.photo_path = regexp_replace(coalesce(p_path, ''), '_t\.webp$', '.webp'))
      or exists (select 1 from app_private.network_expert_merges m
                  where m.keep_before->>'photo_path' = regexp_replace(coalesce(p_path, ''), '_t\.webp$', '.webp') or m.drop_before->>'photo_path' = regexp_replace(coalesce(p_path, ''), '_t\.webp$', '.webp'))
$$;
revoke all on function app_private.expert_photo_in_use(text) from public, anon;
grant execute on function app_private.expert_photo_in_use(text) to authenticated, service_role;

drop policy if exists public_assets_insert_expert_photo on storage.objects;
create policy public_assets_insert_expert_photo on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and name ~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$'
              and coalesce(metadata->>'mimetype', 'image/webp') = 'image/webp'
              and (select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin'])));
drop policy if exists public_assets_delete_expert_photo on storage.objects;
create policy public_assets_delete_expert_photo on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and name ~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$'
         and (select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin']))
         and not (select app_private.expert_photo_in_use(name)));

-- ================================================================= 6. participation: a legacy HIDDEN item counts only with a real role / sessions, and is flagged
-- `counted` = the row takes part in every count and total; `withdrawn` rows and hidden items that are only "listed" are not counted. The two migrated hidden items are PROVIDER items
-- (a booking provider of a legacy event that is not shown in the public list), so they count.
drop function if exists app_private.expert_participation(uuid);
create function app_private.expert_participation(p_expert uuid default null)
returns table (expert_id uuid, item_id uuid, node_id uuid, project_id uuid, program_id uuid, withdrawn boolean,
               is_provider boolean, is_mentor boolean, is_presenter boolean,
               booking_sessions integer, distribution_sessions integer, first_session_on date, last_session_on date, added_at timestamptz,
               hidden boolean, counted boolean)
language sql stable security definer set search_path = '' as $$
  select li.network_expert_id, li.id, li.list_node_id, li.project_id, j.program_id, (li.withdrawn_at is not null),
         r.is_provider, r.is_mentor, r.is_presenter,
         coalesce(bk.n, 0), coalesce(ds.n, 0),
         least(bk.first_on, ds.first_on), greatest(bk.last_on, ds.last_on), li.created_at,
         li.excluded,
         (li.withdrawn_at is null and (not li.excluded or r.is_provider or r.is_mentor or r.is_presenter or coalesce(bk.n, 0) + coalesce(ds.n, 0) > 0))
    from public.list_items li
    join public.nodes n on n.id = li.list_node_id and n.deleted_at is null
    join public.projects j on j.id = li.project_id and j.deleted_at is null
    join public.programs g on g.id = j.program_id and g.deleted_at is null
    cross join lateral (
      select exists (select 1 from public.booking_providers bp join public.nodes bn on bn.id = bp.node_id and bn.deleted_at is null where bp.list_item_id = li.id) as is_provider,
             (exists (select 1 from public.distribution_sessions x where x.mentor_item_id = li.id)
              or exists (select 1 from public.distribution_mentor_rules r2 where r2.mentor_item_id = li.id)
              or exists (select 1 from public.distribution_day_mentors m where m.mentor_item_id = li.id)) as is_mentor,
             exists (select 1 from public.agenda_slots a where a.presenter_item_id = li.id) as is_presenter) r
    left join lateral (
      select count(*)::int as n, min((s.starts_at at time zone coalesce(j.timezone, 'Africa/Cairo'))::date) as first_on, max((s.starts_at at time zone coalesce(j.timezone, 'Africa/Cairo'))::date) as last_on
        from public.booking_providers bp
        join public.booking_slots s on s.provider_id = bp.id
        join public.bookings b on b.slot_id = s.id and b.status = 'confirmed'
        join public.nodes bn on bn.id = bp.node_id and bn.deleted_at is null
       where bp.list_item_id = li.id) bk on true
    left join lateral (
      select count(*)::int as n, min(d.day_date) as first_on, max(d.day_date) as last_on
        from public.distribution_sessions x
        join public.distribution_days d on d.id = x.day_id
        join public.nodes dn on dn.id = x.node_id and dn.deleted_at is null
       where x.mentor_item_id = li.id and x.company_item_id is not null) ds on true
   where li.network_expert_id is not null and (p_expert is null or li.network_expert_id = p_expert)
$$;
revoke all on function app_private.expert_participation(uuid) from public, anon, authenticated;

-- ================================================================= 7. the duplicate engine: candidates from the stored keys, expert_match only on the candidates; the pairs of the registry are MATERIALISED
-- A candidate of a typed record: the same profile link, the same e-mail, a name (either script) whose trigram similarity reaches ~0.6 (0.59 here: expert_match decides exactly), or an
-- overlapping consonant skeleton. Everything else cannot reach the 0.6 floor of expert_match, so the result equals the old full scan (v78 compares both on a corpus). The cross-script
-- trigram branches only run when the typed text really holds the other script (a Latin string shares no trigram with an Arabic one).
create or replace function app_private.expert_find_similar(p_name_en text, p_name_ar text, p_email text, p_linkedin text, p_kind text, p_exclude uuid, p_min numeric, p_limit integer)
returns table (id uuid, score numeric, reasons text[])
language sql stable security definer set search_path = '' set pg_trgm.similarity_threshold = '0.59' as $$
  with q as (
    select app_private.expert_norm(p_name_en) as en, app_private.expert_norm(p_name_ar) as ar,
           array(select x from unnest(array[app_private.expert_skeleton(p_name_en), app_private.expert_skeleton(p_name_ar)]) x where char_length(x) >= 4) as skels,
           case when position('/' in app_private.expert_linkkey(p_linkedin)) > 0 then app_private.expert_linkkey(p_linkedin) end as lk,
           nullif(lower(btrim(coalesce(p_email, ''))), '') as em),
  cand as (
    select ne.id from public.network_experts ne, q where ne.deleted_at is null and q.lk is not null and ne.link_key = q.lk
    union select ne.id from public.network_experts ne, q where ne.deleted_at is null and q.em is not null and ne.email_key = q.em
    union select ne.id from public.network_experts ne, q where ne.deleted_at is null and char_length(q.en) >= 3 and ne.name_en_key operator(extensions.%) q.en
    union select ne.id from public.network_experts ne, q where ne.deleted_at is null and char_length(q.en) >= 3 and q.en ~ '[؀-ۿ]' and ne.name_ar_key operator(extensions.%) q.en
    union select ne.id from public.network_experts ne, q where ne.deleted_at is null and char_length(q.ar) >= 3 and q.ar ~ '[a-z]' and ne.name_en_key operator(extensions.%) q.ar
    union select ne.id from public.network_experts ne, q where ne.deleted_at is null and char_length(q.ar) >= 3 and ne.name_ar_key operator(extensions.%) q.ar
    union select ne.id from public.network_experts ne, q where ne.deleted_at is null and cardinality(q.skels) > 0 and ne.name_skels && q.skels)
  select ne.id, m.score, m.reasons
    from cand c
    join public.network_experts ne on ne.id = c.id
    cross join q
    cross join lateral app_private.expert_match(p_name_en, p_name_ar, p_email, p_linkedin, coalesce(p_kind, 'expert'), q.skels,
                                                ne.name_en, ne.name_ar, ne.email::text, ne.linkedin_url, ne.kind, ne.name_skels) m
   where (p_exclude is null or ne.id <> p_exclude) and m.score >= coalesce(p_min, 0.6)
   order by m.score desc, ne.created_at, ne.id
   limit least(greatest(coalesce(p_limit, 6), 1), 1000)
$$;
revoke all on function app_private.expert_find_similar(text, text, text, text, text, uuid, numeric, integer) from public, anon, authenticated;

-- the RPC keeps its own cap (the typing flow shows a handful)
create or replace function public.find_similar_network_experts(p_name_en text default null, p_name_ar text default null, p_email text default null, p_linkedin text default null,
                                                               p_exclude uuid default null, p_kind text default 'expert', p_limit integer default 6) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_kind, 'expert') not in ('expert', 'team') then perform app_private.expert_fail('kind', 'bad_value'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'score', s.score, 'reasons', to_jsonb(s.reasons), 'blocking', s.score >= 0.95,
                       'expert', jsonb_build_object('id', ne.id, 'kind', ne.kind, 'name_en', app_private.expert_text(ne.name_en), 'name_ar', app_private.expert_text(ne.name_ar), 'title_en', app_private.expert_text(ne.title_en), 'title_ar', app_private.expert_text(ne.title_ar),
                                                    'company_en', app_private.expert_text(ne.company_en), 'company_ar', app_private.expert_text(ne.company_ar), 'photo_path', ne.photo_path, 'archived_at', ne.archived_at))
                     order by s.score desc, ne.created_at, ne.id)
      from app_private.expert_find_similar(p_name_en, p_name_ar, p_email, p_linkedin, coalesce(p_kind, 'expert'), p_exclude, 0.6, least(greatest(coalesce(p_limit, 6), 1), 50)) s
      join public.network_experts ne on ne.id = s.id), '[]'::jsonb);
end $$;

-- THE PAIRS OF THE REGISTRY (m77's finder scored every pair of records on every call: quadratic, past the 8 s API timeout from ~250 records). A pair is computed ONCE, when a record is
-- created or its name / e-mail / link / kind / deleted state changes (a probe through the same engine, ~10 ms), and kept here; the finder only reads it. The probes are serialised by an
-- advisory lock, so two writers that add look-alikes at the same moment still see each other (the second probe sees the first commit). Pairs follow a hard delete (foreign key cascade).
create table if not exists app_private.network_expert_pairs (
  a       uuid not null references public.network_experts(id) on delete cascade,
  b       uuid not null references public.network_experts(id) on delete cascade,
  score   numeric not null,
  reasons text[] not null,
  primary key (a, b),
  check (a < b)
);
create index if not exists network_expert_pairs_b_idx on app_private.network_expert_pairs (b);
alter table app_private.network_expert_pairs enable row level security;
alter table app_private.network_expert_pairs force row level security;
revoke all on app_private.network_expert_pairs from public, anon, authenticated;

create or replace function app_private.network_experts_refresh_pairs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('expert-pairs', 0));
  delete from app_private.network_expert_pairs where a = new.id or b = new.id;
  if new.deleted_at is null then
    insert into app_private.network_expert_pairs (a, b, score, reasons)
      select least(new.id, s.id), greatest(new.id, s.id), s.score, s.reasons
        from app_private.expert_find_similar(new.name_en, new.name_ar, new.email::text, new.linkedin_url, new.kind, new.id, 0.6, 1000) s
        join public.network_experts o on o.id = s.id and o.kind = new.kind
      on conflict (a, b) do update set score = excluded.score, reasons = excluded.reasons;
  end if;
  return null;
end $$;
revoke all on function app_private.network_experts_refresh_pairs() from public, anon, authenticated;
drop trigger if exists network_experts_ai_pairs on public.network_experts;
create trigger network_experts_ai_pairs after insert on public.network_experts for each row execute function app_private.network_experts_refresh_pairs();
drop trigger if exists network_experts_au_pairs on public.network_experts;
create trigger network_experts_au_pairs after update of name_en, name_ar, email, linkedin_url, kind, deleted_at on public.network_experts for each row
  when (old.name_en is distinct from new.name_en or old.name_ar is distinct from new.name_ar or old.email is distinct from new.email or old.linkedin_url is distinct from new.linkedin_url
        or old.kind is distinct from new.kind or old.deleted_at is distinct from new.deleted_at)
  execute function app_private.network_experts_refresh_pairs();

-- rebuild the whole table (m78 does it once; run it again after a change of expert_norm / expert_skeleton / expert_match)
create or replace function app_private.rebuild_expert_pairs() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('expert-pairs', 0));
  delete from app_private.network_expert_pairs;
  for r in select x.id, x.name_en, x.name_ar, x.email, x.linkedin_url, x.kind from public.network_experts x where x.deleted_at is null loop
    insert into app_private.network_expert_pairs (a, b, score, reasons)
      select least(r.id, s.id), greatest(r.id, s.id), s.score, s.reasons
        from app_private.expert_find_similar(r.name_en, r.name_ar, r.email::text, r.linkedin_url, r.kind, r.id, 0.6, 1000) s
        join public.network_experts o on o.id = s.id and o.kind = r.kind
      on conflict (a, b) do nothing;
  end loop;
  select count(*) into n from app_private.network_expert_pairs;
  return n;
end $$;
revoke all on function app_private.rebuild_expert_pairs() from public, anon, authenticated;
select app_private.rebuild_expert_pairs();

-- All probable duplicate PAIRS (super_admin): -> { pairs: [{ score, reasons[], a: {...}, b: {...} }], dismissed }
create or replace function public.list_expert_duplicate_pairs(p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_pairs jsonb; v_dismissed integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into v_dismissed from app_private.network_expert_nondup d
    join public.network_experts a on a.id = d.a and a.deleted_at is null join public.network_experts b on b.id = d.b and b.deleted_at is null;
  with cand as (
    select p.a as a_id, p.b as b_id, p.score, p.reasons, a.created_at as a_created
      from app_private.network_expert_pairs p
      join public.network_experts a on a.id = p.a and a.deleted_at is null
      join public.network_experts b on b.id = p.b and b.deleted_at is null
     where not exists (select 1 from app_private.network_expert_nondup d where d.a = p.a and d.b = p.b)
     order by p.score desc, a.created_at, p.a, p.b
     limit least(greatest(coalesce(p_limit, 60), 1), 200))
  select coalesce(jsonb_agg(jsonb_build_object('score', c.score, 'reasons', to_jsonb(c.reasons),
           'a', jsonb_build_object('id', a.id, 'kind', a.kind, 'name_en', app_private.expert_text(a.name_en), 'name_ar', app_private.expert_text(a.name_ar), 'title_en', app_private.expert_text(a.title_en), 'title_ar', app_private.expert_text(a.title_ar), 'company_en', app_private.expert_text(a.company_en), 'company_ar', app_private.expert_text(a.company_ar), 'photo_path', a.photo_path, 'archived_at', a.archived_at),
           'b', jsonb_build_object('id', b.id, 'kind', b.kind, 'name_en', app_private.expert_text(b.name_en), 'name_ar', app_private.expert_text(b.name_ar), 'title_en', app_private.expert_text(b.title_en), 'title_ar', app_private.expert_text(b.title_ar), 'company_en', app_private.expert_text(b.company_en), 'company_ar', app_private.expert_text(b.company_ar), 'photo_path', b.photo_path, 'archived_at', b.archived_at))
         order by c.score desc, c.a_created, a.id, b.id), '[]'::jsonb)
    into v_pairs
    from cand c join public.network_experts a on a.id = c.a_id join public.network_experts b on b.id = c.b_id;
  return jsonb_build_object('pairs', v_pairs, 'dismissed', v_dismissed);
end $$;

-- ================================================================= 8. the registry list and the profile: `counted` instead of "not withdrawn"; the offset cannot overflow
create or replace function public.list_network_experts(p_filter jsonb default '{}'::jsonb, p_sort text default 'name', p_dir text default 'asc', p_limit integer default 24,
                                                       p_offset integer default 0, p_lang text default 'en', p_full boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_f jsonb := case when jsonb_typeof(coalesce(p_filter, '{}'::jsonb)) = 'object' then coalesce(p_filter, '{}'::jsonb) else '{}'::jsonb end;
  v_full boolean := coalesce(p_full, false);
  v_lim integer := least(greatest(coalesce(p_limit, 24), 1), case when v_full then 5000 else 200 end);
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_sort text := coalesce(nullif(p_sort, ''), 'name');
  v_dir text := lower(coalesce(nullif(p_dir, ''), 'asc'));
  v_lang text := case when p_lang = 'ar' then 'ar' else 'en' end;
  v_sa boolean;
  v_terms text[]; v_kind text; v_state text; v_has_photo boolean; v_has_email boolean; v_tags uuid[] := '{}'; v_language text; v_part text;
  v_prog_req uuid[] := '{}'; v_prog_filter boolean := false; v_progs uuid[] := '{}';
  v_counts jsonb; v_rows jsonb; v_total integer;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sa := coalesce(app_private.is_super_admin(), false);
  if v_sort not in ('name', 'programs', 'projects', 'sessions', 'last', 'updated', 'created') then perform app_private.expert_fail('sort', 'bad_value'); end if;
  if v_dir not in ('asc', 'desc') then perform app_private.expert_fail('dir', 'bad_value'); end if;

  v_terms := array(select t from unnest(regexp_split_to_array(app_private.expert_norm(v_f->>'q'), ' ')) t where t <> '' limit 8);
  v_kind := nullif(v_f->>'kind', '');
  if v_kind is not null and v_kind not in ('expert', 'team') then perform app_private.expert_fail('kind', 'bad_value'); end if;
  v_state := coalesce(nullif(v_f->>'state', ''), 'active');
  if v_state not in ('active', 'archived', 'deleted', 'all') then perform app_private.expert_fail('state', 'bad_value'); end if;
  if v_state = 'deleted' and not v_sa then raise exception 'forbidden' using errcode = '42501'; end if;
  v_has_photo := case when jsonb_typeof(v_f->'has_photo') = 'boolean' then (v_f->>'has_photo')::boolean end;
  v_has_email := case when jsonb_typeof(v_f->'has_email') = 'boolean' then (v_f->>'has_email')::boolean end;
  if jsonb_typeof(v_f->'tag_ids') = 'array' then
    v_tags := array(select e::uuid from jsonb_array_elements_text(v_f->'tag_ids') e where e ~ c_uuid limit 20);
  end if;
  v_language := nullif(lower(btrim(coalesce(v_f->>'language', ''))), '');
  if v_language is not null and v_language !~ '^[a-z]{2,3}$' then perform app_private.expert_fail('language', 'bad_value'); end if;
  v_part := nullif(v_f->>'participated', '');
  if v_part is not null and v_part not in ('yes', 'no') then perform app_private.expert_fail('participated', 'bad_value'); end if;
  if jsonb_typeof(v_f->'program_ids') = 'array' then
    v_prog_req := array(select e::uuid from jsonb_array_elements_text(v_f->'program_ids') e where e ~ c_uuid limit 20);
    v_prog_filter := cardinality(v_prog_req) > 0;
  end if;
  if v_prog_filter then
    -- only programs the caller can see: a program of somebody else cannot be probed through the filter
    v_progs := coalesce((select array_agg(g.id) from public.programs g
                          where g.id = any (v_prog_req) and g.deleted_at is null
                            and (coalesce(app_private.is_program_member(g.id), false)
                                 or exists (select 1 from public.projects j where j.program_id = g.id and j.deleted_at is null and coalesce(app_private.is_project_manager(j.id), false)))), '{}'::uuid[]);
  end if;

  select jsonb_build_object(
           'active', count(*) filter (where ne.deleted_at is null and ne.archived_at is null),
           'expert', count(*) filter (where ne.deleted_at is null and ne.archived_at is null and ne.kind = 'expert'),
           'team', count(*) filter (where ne.deleted_at is null and ne.archived_at is null and ne.kind = 'team'),
           'archived', count(*) filter (where ne.deleted_at is null and ne.archived_at is not null),
           'deleted', case when v_sa then count(*) filter (where ne.deleted_at is not null and ne.merged_into is null) else 0 end,
           'without_photo', count(*) filter (where ne.deleted_at is null and ne.archived_at is null and ne.photo_path is null))
    into v_counts from public.network_experts ne;

  with pr as materialized (select * from app_private.expert_participation(null) x where x.counted),
       part as (select x.expert_id, count(distinct x.program_id)::int as programs, count(distinct x.project_id)::int as projects, count(*)::int as lists,
                       coalesce(sum(x.booking_sessions), 0)::int as bk, coalesce(sum(x.distribution_sessions), 0)::int as ds,
                       min(x.first_session_on) as first_on, max(x.last_session_on) as last_on
                  from pr x group by x.expert_id),
       filtered as (
         select ne.*, coalesce(pt.programs, 0) as n_programs, coalesce(pt.projects, 0) as n_projects, coalesce(pt.lists, 0) as n_lists,
                coalesce(pt.bk, 0) as n_bk, coalesce(pt.ds, 0) as n_ds, coalesce(pt.bk, 0) + coalesce(pt.ds, 0) as n_sessions, pt.first_on, pt.last_on,
                app_private.expert_norm(case when v_lang = 'ar' then coalesce(nullif(ne.name_ar, ''), ne.name_en) else coalesce(nullif(ne.name_en, ''), ne.name_ar) end) as sort_name,
                case when v_lang = 'ar' and coalesce(nullif(ne.name_ar, ''), ne.name_en) ~ '[؀-ۿ]' then 0 else 1 end as sort_rank
           from public.network_experts ne
           left join part pt on pt.expert_id = ne.id
          where (case v_state when 'active' then ne.deleted_at is null and ne.archived_at is null
                              when 'archived' then ne.deleted_at is null and ne.archived_at is not null
                              when 'deleted' then ne.deleted_at is not null and ne.merged_into is null
                              else ne.deleted_at is null end)
            and (v_kind is null or ne.kind = v_kind)
            and (v_has_photo is null or (ne.photo_path is not null) = v_has_photo)
            and (v_has_email is null or (ne.email is not null) = v_has_email)
            and (v_language is null or v_language = any (ne.languages))
            and (cardinality(v_tags) = 0 or exists (select 1 from public.network_expert_tags x where x.expert_id = ne.id and x.tag_id = any (v_tags)))
            and (v_part is null or (v_part = 'yes') = (coalesce(pt.lists, 0) > 0))
            and (not v_prog_filter or exists (select 1 from pr x where x.expert_id = ne.id and x.program_id = any (v_progs)))
            and (cardinality(v_terms) = 0 or not exists (
                   select 1 from unnest(v_terms) t
                    where not (coalesce(ne.search_text, '') like '%' || t || '%'
                               or exists (select 1 from public.network_expert_tags x join public.expert_tags et on et.id = x.tag_id
                                           where x.expert_id = ne.id and app_private.expert_norm(coalesce(et.name_en, '') || ' ' || coalesce(et.name_ar, '')) like '%' || t || '%')))) ),
       ordered as (
         select f.*, row_number() over (order by
                  case when v_dir = 'asc' then (case v_sort when 'name' then f.sort_rank end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'name' then f.sort_rank end) end desc nulls last,
                  case when v_dir = 'asc' then (case v_sort when 'name' then f.sort_name end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'name' then f.sort_name end) end desc nulls last,
                  case when v_dir = 'asc' then (case v_sort when 'programs' then f.n_programs::numeric when 'projects' then f.n_projects::numeric when 'sessions' then f.n_sessions::numeric
                                                  when 'last' then extract(epoch from f.last_on::timestamp) when 'updated' then extract(epoch from f.updated_at)
                                                  when 'created' then extract(epoch from f.created_at) end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'programs' then f.n_programs::numeric when 'projects' then f.n_projects::numeric when 'sessions' then f.n_sessions::numeric
                                                  when 'last' then extract(epoch from f.last_on::timestamp) when 'updated' then extract(epoch from f.updated_at)
                                                  when 'created' then extract(epoch from f.created_at) end) end desc nulls last,
                  f.sort_name, f.id) as rn
           from filtered f),
       page as (select o.* from ordered o where o.rn > v_off and o.rn <= v_off + v_lim),
       tagrows as (
         select x.expert_id, jsonb_agg(jsonb_build_object('id', et.id, 'name_en', app_private.expert_text(et.name_en), 'name_ar', app_private.expert_text(et.name_ar), 'archived', et.archived_at is not null)
                                       order by lower(coalesce(et.name_en, et.name_ar)), et.id) as tags
           from public.network_expert_tags x join public.expert_tags et on et.id = x.tag_id
          where x.expert_id in (select pg.id from page pg) group by x.expert_id)
  select (select count(*) from filtered)::int,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', pg.id, 'kind', pg.kind, 'name_en', app_private.expert_text(pg.name_en), 'name_ar', app_private.expert_text(pg.name_ar), 'title_en', app_private.expert_text(pg.title_en), 'title_ar', app_private.expert_text(pg.title_ar), 'company_en', app_private.expert_text(pg.company_en), 'company_ar', app_private.expert_text(pg.company_ar),
             'photo_path', pg.photo_path, 'linkedin_url', pg.linkedin_url, 'website_url', pg.website_url, 'links', pg.links, 'languages', to_jsonb(pg.languages),
             'has_email', pg.email is not null, 'archived_at', pg.archived_at, 'deleted_at', pg.deleted_at, 'created_at', pg.created_at, 'updated_at', pg.updated_at,
             'tags', coalesce(tr.tags, '[]'::jsonb),
             'programs_count', pg.n_programs, 'projects_count', pg.n_projects, 'lists_count', pg.n_lists, 'booking_sessions', pg.n_bk, 'distribution_sessions', pg.n_ds, 'sessions_count', pg.n_sessions,
             'first_session_on', pg.first_on, 'last_session_on', pg.last_on)
           || case when v_full then jsonb_build_object('bio_en', pg.bio_en, 'bio_ar', pg.bio_ar, 'email', pg.email, 'phone', pg.phone, 'notes', pg.notes) else '{}'::jsonb end
           order by pg.rn), '[]'::jsonb)
    into v_total, v_rows
    from page pg left join tagrows tr on tr.expert_id = pg.id;

  return jsonb_build_object('total', coalesce(v_total, 0), 'counts', v_counts, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

create or replace function public.get_network_expert(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ne public.network_experts; v_sa boolean; v_tags jsonb; v_tot jsonb; v_part jsonb; v_hidden jsonb; v_into jsonb := null; v_abs jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sa := coalesce(app_private.is_super_admin(), false);
  if p_id is null then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  select * into ne from public.network_experts x where x.id = p_id;
  if not found or (ne.deleted_at is not null and not v_sa) then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', et.id, 'name_en', app_private.expert_text(et.name_en), 'name_ar', app_private.expert_text(et.name_ar), 'archived', et.archived_at is not null) order by lower(coalesce(et.name_en, et.name_ar)), et.id), '[]'::jsonb)
    into v_tags from public.network_expert_tags x join public.expert_tags et on et.id = x.tag_id where x.expert_id = p_id;

  with pr as (select * from app_private.expert_participation(p_id))
  select jsonb_build_object(
           'programs', count(distinct x.program_id) filter (where x.counted), 'projects', count(distinct x.project_id) filter (where x.counted),
           'lists', count(*) filter (where x.counted), 'booking_sessions', coalesce(sum(x.booking_sessions) filter (where x.counted), 0),
           'distribution_sessions', coalesce(sum(x.distribution_sessions) filter (where x.counted), 0),
           'sessions', coalesce(sum(x.booking_sessions + x.distribution_sessions) filter (where x.counted), 0),
           'first_session_on', min(x.first_session_on) filter (where x.counted), 'last_session_on', max(x.last_session_on) filter (where x.counted),
           'first_listed_at', min(x.added_at) filter (where x.counted), 'withdrawn', count(*) filter (where x.withdrawn),
           'hidden_not_counted', count(*) filter (where x.hidden and not x.counted and not x.withdrawn))
    into v_tot from pr x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', x.item_id,
           'node', jsonb_build_object('id', n.id, 'type', n.type, 'name_en', app_private.expert_text(n.name_en), 'name_ar', app_private.expert_text(n.name_ar)),
           'project', jsonb_build_object('id', j.id, 'name_en', app_private.expert_text(j.name_en), 'name_ar', app_private.expert_text(j.name_ar), 'completed_at', j.completed_at),
           'program', jsonb_build_object('id', g.id, 'name_en', app_private.expert_text(g.name_en), 'name_ar', app_private.expert_text(g.name_ar), 'year', g.year),
           'withdrawn', x.withdrawn, 'item_hidden', x.hidden, 'counted', x.counted, 'roles', jsonb_build_object('provider', x.is_provider, 'mentor', x.is_mentor, 'presenter', x.is_presenter),
           'booking_sessions', x.booking_sessions, 'distribution_sessions', x.distribution_sessions,
           'first_session_on', x.first_session_on, 'last_session_on', x.last_session_on, 'added_at', x.added_at)
           order by coalesce(x.last_session_on, x.added_at::date) desc, g.name_en, j.name_en, x.item_id), '[]'::jsonb)
    into v_part
    from app_private.expert_participation(p_id) x
    join public.nodes n on n.id = x.node_id join public.projects j on j.id = x.project_id join public.programs g on g.id = x.program_id
   where coalesce(app_private.is_project_manager(x.project_id), false);

  select jsonb_build_object('engagements', count(*), 'projects', count(distinct x.project_id), 'programs', count(distinct x.program_id))
    into v_hidden
    from app_private.expert_participation(p_id) x
   where x.counted and not coalesce(app_private.is_project_manager(x.project_id), false);

  if ne.merged_into is not null then
    select jsonb_build_object('id', m.id, 'name_en', app_private.expert_text(m.name_en), 'name_ar', app_private.expert_text(m.name_ar)) into v_into from public.network_experts m where m.id = ne.merged_into;
  end if;
  if v_sa then
    select coalesce(jsonb_agg(jsonb_build_object('merge_id', mg.id, 'drop_id', mg.drop_id, 'drop_name', mg.drop_name, 'merged_at', mg.merged_at) order by mg.merged_at desc), '[]'::jsonb)
      into v_abs from app_private.network_expert_merges mg where mg.keep_id = p_id;
  end if;

  return jsonb_build_object(
    'expert', jsonb_build_object('id', ne.id, 'kind', ne.kind, 'name_en', app_private.expert_text(ne.name_en), 'name_ar', app_private.expert_text(ne.name_ar), 'title_en', app_private.expert_text(ne.title_en), 'title_ar', app_private.expert_text(ne.title_ar),
                                 'company_en', app_private.expert_text(ne.company_en), 'company_ar', app_private.expert_text(ne.company_ar), 'bio_en', ne.bio_en, 'bio_ar', ne.bio_ar, 'photo_path', ne.photo_path,
                                 'linkedin_url', ne.linkedin_url, 'website_url', ne.website_url, 'links', ne.links, 'email', ne.email, 'phone', ne.phone,
                                 'languages', to_jsonb(ne.languages), 'notes', ne.notes, 'archived_at', ne.archived_at, 'deleted_at', ne.deleted_at, 'merged_into', ne.merged_into,
                                 'created_at', ne.created_at, 'updated_at', ne.updated_at),
    'tags', v_tags, 'totals', v_tot, 'participation', v_part, 'hidden', v_hidden, 'merged_into', v_into, 'absorbed', v_abs,
    'can', jsonb_build_object('edit', ne.deleted_at is null, 'archive', ne.deleted_at is null, 'merge', v_sa and ne.deleted_at is null, 'delete', v_sa and ne.deleted_at is null, 'restore', v_sa and ne.deleted_at is not null and ne.merged_into is null));
end $$;

-- ================================================================= 9. list items: the redirect of a merged expert also decides the inherited withdrawal; the guard takes a KEY SHARE lock
-- (a merge / a delete holds the row FOR UPDATE: a list item inserted meanwhile waits and then follows the redirect instead of landing on a soft-deleted record)
create or replace function app_private.list_items_expert_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_del timestamptz; v_into uuid; v_hops int := 0; v_from uuid;
begin
  if new.network_expert_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.network_expert_id is not distinct from old.network_expert_id then return new; end if;
  v_from := new.network_expert_id;
  v_id := new.network_expert_id;
  loop
    select x.deleted_at, x.merged_into into v_del, v_into from public.network_experts x where x.id = v_id for key share;
    if not found then return new; end if;          -- the foreign key reports a missing expert
    exit when v_del is null;
    v_hops := v_hops + 1;
    if v_into is null or v_hops > 5 then
      raise exception 'expert_unavailable: this expert was removed' using errcode = '22023', hint = 'expert_unavailable';
    end if;
    v_id := v_into;
  end loop;
  new.network_expert_id := v_id;
  -- redirected after the withdrawal was inherited (the inherit trigger of m43 runs first): take the withdrawal of the CANONICAL expert in this project
  if tg_op = 'INSERT' and v_id is distinct from v_from and new.withdrawn_at is null then
    select x.withdrawn_at, x.withdrawn_by, x.withdrawn_reason into new.withdrawn_at, new.withdrawn_by, new.withdrawn_reason
      from public.list_items x
     where x.project_id = new.project_id and x.network_expert_id = v_id and x.withdrawn_at is not null
     order by x.withdrawn_at limit 1;
  end if;
  return new;
end $$;
revoke all on function app_private.list_items_expert_guard() from public, anon, authenticated;

-- the m43 inheritance, but for the CANONICAL expert (the item of a stale picker that names a merged duplicate inherits the withdrawal of the kept record)
create or replace function app_private.list_items_inherit_withdrawn() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_expert uuid := new.network_expert_id; v_into uuid; v_hops int := 0;
begin
  if new.network_expert_id is not null and new.withdrawn_at is null then
    loop
      select x.merged_into into v_into from public.network_experts x where x.id = v_expert and x.deleted_at is not null and x.merged_into is not null;
      exit when v_into is null or v_hops >= 5;
      v_expert := v_into; v_hops := v_hops + 1;
    end loop;
    perform app_private.withdrawn_expert_lock(new.project_id, v_expert);
    select x.withdrawn_at, x.withdrawn_by, x.withdrawn_reason into new.withdrawn_at, new.withdrawn_by, new.withdrawn_reason
      from public.list_items x
     where x.project_id = new.project_id and x.network_expert_id = v_expert and x.withdrawn_at is not null
     order by x.withdrawn_at limit 1;
  end if;
  return new;
end $$;
revoke all on function app_private.list_items_inherit_withdrawn() from public, anon, authenticated;

-- ================================================================= 10. tags: only a super_admin brings an archived tag back; a call creates at most 50 new tags
create or replace function app_private.expert_upsert_tag(p_name_en text, p_name_ar text, p_uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_en text := nullif(btrim(regexp_replace(coalesce(p_name_en, ''), '\s+', ' ', 'g')), ''); v_ar text := nullif(btrim(regexp_replace(coalesce(p_name_ar, ''), '\s+', ' ', 'g')), '');
        v_key text; v_id uuid; v_arch timestamptz; v_new boolean; v_n int;
begin
  if v_en is null and v_ar is null then perform app_private.expert_fail('tags', 'name_required'); end if;
  if char_length(coalesce(v_en, '')) > 60 or char_length(coalesce(v_ar, '')) > 60 then perform app_private.expert_fail('tags', 'too_long'); end if;
  v_key := app_private.expert_norm(coalesce(v_en, v_ar));
  if v_key = '' then perform app_private.expert_fail('tags', 'name_required'); end if;
  insert into public.expert_tags (tag_key, name_en, name_ar, created_by) values (v_key, v_en, v_ar, p_uid)
  on conflict (tag_key) do update set name_en = coalesce(public.expert_tags.name_en, excluded.name_en), name_ar = coalesce(public.expert_tags.name_ar, excluded.name_ar)
  returning id, archived_at, (xmax = 0) into v_id, v_arch, v_new;
  if v_arch is not null then
    if coalesce(app_private.is_super_admin(), false) then update public.expert_tags set archived_at = null where id = v_id;
    else perform app_private.expert_fail('tags', 'archived'); end if;
  end if;
  if v_new then
    v_n := coalesce(nullif(current_setting('app.expert_new_tags', true), ''), '0')::int + 1;
    if v_n > 50 then perform app_private.expert_fail('tags', 'too_many_new'); end if;
    perform set_config('app.expert_new_tags', v_n::text, true);
  end if;
  return v_id;
end $$;
revoke all on function app_private.expert_upsert_tag(text, text, uuid) from public, anon, authenticated;

-- ================================================================= 11. update (a PATCH): the old photo file is handed back only when nothing else points at it; no FOR UPDATE (a profile edit does not block list items)
create or replace function public.update_network_expert(p_id uuid, p jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ne public.network_experts; c jsonb; v_uid uuid := (select auth.uid()); v_upd timestamptz; v_sa boolean; v_en text; v_ar text; v_old text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sa := coalesce(app_private.is_super_admin(), false);
  c := app_private.expert_clean(p);
  select * into ne from public.network_experts x where x.id = p_id for no key update;
  if not found or ne.deleted_at is not null then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  if p_expected is not null and ne.updated_at is distinct from p_expected then raise exception 'expert_stale: the profile changed' using errcode = 'P0001', hint = 'expert_stale'; end if;
  if c ? 'kind' and (c->>'kind') is distinct from ne.kind and not v_sa then perform app_private.expert_fail('kind', 'forbidden'); end if;
  v_en := case when c ? 'name_en' then c->>'name_en' else ne.name_en end;
  v_ar := case when c ? 'name_ar' then c->>'name_ar' else ne.name_ar end;
  if v_en is null and v_ar is null then perform app_private.expert_fail('name', 'required'); end if;
  update public.network_experts x set
    kind = case when c ? 'kind' then c->>'kind' else x.kind end,
    name_en = v_en, name_ar = v_ar,
    title_en = case when c ? 'title_en' then c->>'title_en' else x.title_en end, title_ar = case when c ? 'title_ar' then c->>'title_ar' else x.title_ar end,
    company_en = case when c ? 'company_en' then c->>'company_en' else x.company_en end, company_ar = case when c ? 'company_ar' then c->>'company_ar' else x.company_ar end,
    bio_en = case when c ? 'bio_en' then c->>'bio_en' else x.bio_en end, bio_ar = case when c ? 'bio_ar' then c->>'bio_ar' else x.bio_ar end,
    photo_path = case when c ? 'photo_path' then c->>'photo_path' else x.photo_path end,
    linkedin_url = case when c ? 'linkedin_url' then c->>'linkedin_url' else x.linkedin_url end,
    website_url = case when c ? 'website_url' then c->>'website_url' else x.website_url end,
    email = case when c ? 'email' then (c->>'email')::extensions.citext else x.email end,
    phone = case when c ? 'phone' then c->>'phone' else x.phone end,
    notes = case when c ? 'notes' then c->>'notes' else x.notes end,
    links = case when c ? 'links' then c->'links' else x.links end,
    languages = case when c ? 'languages' then coalesce(array(select jsonb_array_elements_text(c->'languages')), '{}'::text[]) else x.languages end
  where x.id = p_id
  returning x.updated_at into v_upd;
  if c ? 'tags' then perform app_private.expert_set_tags(p_id, c->'tags', v_uid); end if;
  -- the replaced file may be removed by the client only when no other record (live, deleted, merge before-image) still shows it
  if c ? 'photo_path' and (c->>'photo_path') is distinct from ne.photo_path and ne.photo_path is not null and not app_private.expert_photo_in_use(ne.photo_path) then v_old := ne.photo_path; end if;
  return jsonb_build_object('updated', true, 'id', p_id, 'updated_at', v_upd, 'old_photo_path', v_old);
end $$;

-- ================================================================= 12. delete: lock the row first (a list item inserted meanwhile waits and sees the deletion)
create or replace function public.delete_network_expert(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uses int; v_row uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  select x.id into v_row from public.network_experts x where x.id = p_id and x.deleted_at is null for update;
  if v_row is null then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  select count(*) into v_uses from public.list_items li where li.network_expert_id = p_id;
  if v_uses > 0 then raise exception 'expert_in_use: % list item(s) use this expert', v_uses using errcode = 'P0001', hint = 'expert_in_use', detail = v_uses::text; end if;
  update public.network_experts set deleted_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

-- ================================================================= 13. MERGE: project-wide withdrawn blocker, capped tag union, dropped rows kept in the audit, the collapsed provider keeps its flags
create or replace function public.merge_network_experts(p_keep uuid, p_drop uuid, p_dry_run boolean default true, p_fields jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.network_experts; d public.network_experts; v_uid uuid := (select auth.uid()); v_dry boolean := coalesce(p_dry_run, true);
  v_fields jsonb := case when jsonb_typeof(coalesce(p_fields, '{}'::jsonb)) = 'object' then coalesce(p_fields, '{}'::jsonb) else '{}'::jsonb end;
  r record; pf public.booking_providers; pk public.booking_providers; ref record; v_cnt bigint;
  v_moved jsonb := '[]'::jsonb; v_collapsed jsonb := '[]'::jsonb; v_blockers text[] := '{}'::text[];
  n_moved int := 0; n_collapsed int := 0; n_prov int := 0; n_slots int := 0; n_dist int := 0; n_tags int := 0; n_tags_new int := 0; n_tags_dropped int := 0; v_room int; v_n int;
  f text; choice text; kv text; dv text; eff jsonb := '{}'::jsonb; v_notes text; v_notes_trunc boolean := false; v_links jsonb := '[]'::jsonb; el jsonb;
  v_langs text[]; v_overlay jsonb; v_merge_id uuid; v_keep_before jsonb; v_drop_before jsonb; v_impact jsonb; v_arch timestamptz; v_created timestamptz;
  l_rules jsonb := '[]'::jsonb; l_providers jsonb := '[]'::jsonb; l_invites jsonb := '[]'::jsonb; l_reviews jsonb := '[]'::jsonb; l_scores jsonb := '[]'::jsonb; l_items jsonb := '[]'::jsonb; l_dmentors jsonb := '[]'::jsonb;
  v_drop_tags jsonb; v_keep_tags jsonb;
  c_fields constant text[] := array['name_en', 'name_ar', 'title_en', 'title_ar', 'company_en', 'company_ar', 'bio_en', 'bio_ar', 'photo_path', 'linkedin_url', 'website_url', 'email', 'phone'];
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then perform app_private.expert_fail('merge', 'same_record'); end if;
  -- ONE lock order for everybody: the per-(project, expert) withdrawal locks (the m43 rule: an expert is withdrawn project-wide) BEFORE the rows
  if not v_dry then
    for r in select distinct li.project_id from public.list_items li where li.network_expert_id in (p_keep, p_drop) order by li.project_id loop
      perform app_private.withdrawn_expert_lock(r.project_id, p_keep);
      perform app_private.withdrawn_expert_lock(r.project_id, p_drop);
    end loop;
  end if;
  perform 1 from public.network_experts x where x.id in (p_keep, p_drop) order by x.id for update;
  select * into k from public.network_experts x where x.id = p_keep;
  select * into d from public.network_experts x where x.id = p_drop;
  if k.id is null or d.id is null or k.deleted_at is not null or d.deleted_at is not null then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  if k.kind <> d.kind then v_blockers := array_append(v_blockers, 'kind_mismatch'); end if;

  -- withdrawn is PROJECT-WIDE: where both records have items in one project they must agree (moved items keep their own state, which would re-activate / withdraw the person in the other list)
  if exists (select 1
               from (select li.project_id, bool_or(li.withdrawn_at is not null) as wd from public.list_items li where li.network_expert_id = p_keep group by li.project_id) a
               join (select li.project_id, bool_or(li.withdrawn_at is not null) as wd from public.list_items li where li.network_expert_id = p_drop group by li.project_id) b on b.project_id = a.project_id
              where a.wd is distinct from b.wd) then
    v_blockers := array_append(v_blockers, 'withdrawn_mismatch');
  end if;

  -- 1. the plan: every list item of the duplicate is either MOVED or COLLAPSED into the canonical item of the same list
  for r in
    select di.id as drop_item, di.list_node_id, di.project_id, ki.id as keep_item
      from public.list_items di
      left join public.list_items ki on ki.list_node_id = di.list_node_id and ki.network_expert_id = p_keep
     where di.network_expert_id = p_drop
     order by di.list_node_id, di.id
  loop
    if r.keep_item is null then
      n_moved := n_moved + 1;
      v_moved := v_moved || jsonb_build_array(jsonb_build_object('item', r.drop_item, 'node', r.list_node_id, 'project', r.project_id));
    else
      n_collapsed := n_collapsed + 1;
      v_collapsed := v_collapsed || jsonb_build_array(jsonb_build_object('drop_item', r.drop_item, 'keep_item', r.keep_item, 'node', r.list_node_id, 'project', r.project_id));
      if exists (select 1 from public.distribution_sessions a join public.distribution_sessions b on b.day_id = a.day_id and b.slot_index = a.slot_index
                  where a.mentor_item_id = r.drop_item and b.mentor_item_id = r.keep_item) then v_blockers := array_append(v_blockers, 'mentor_slot_conflict'); end if;
      if exists (select 1 from public.booking_providers a join public.booking_providers b on b.node_id = a.node_id and b.list_item_id = r.keep_item
                   join public.booking_slots sa on sa.provider_id = a.id join public.booking_slots sb on sb.provider_id = b.id and tstzrange(sb.starts_at, sb.ends_at) && tstzrange(sa.starts_at, sa.ends_at)
                  where a.list_item_id = r.drop_item) then v_blockers := array_append(v_blockers, 'provider_slot_conflict'); end if;
    end if;
  end loop;
  v_blockers := array(select distinct b from unnest(v_blockers) b order by b);

  -- 2. the resulting scalar values
  foreach f in array c_fields loop
    kv := nullif(btrim(to_jsonb(k) ->> f), ''); dv := nullif(btrim(to_jsonb(d) ->> f), '');
    choice := v_fields ->> f;
    eff := eff || jsonb_build_object(f, case when choice = 'drop' then coalesce(dv, kv) else coalesce(kv, dv) end);
  end loop;
  v_notes := k.notes;
  if d.notes is not null and d.notes is distinct from k.notes then
    v_notes := concat_ws(E'\n\n', k.notes, '[' || coalesce(d.name_en, d.name_ar, '') || '] ' || d.notes);
    if char_length(v_notes) > 4000 then v_notes := left(v_notes, 4000); v_notes_trunc := true; end if;
  end if;
  v_langs := coalesce((select array_agg(l order by l) from (select distinct l from unnest(k.languages || d.languages) l limit 8) s), '{}'::text[]);
  for el in select * from jsonb_array_elements(k.links || d.links) loop
    if jsonb_array_length(v_links) < 6 and not exists (select 1 from jsonb_array_elements(v_links) x where x->>'url' = el->>'url') then v_links := v_links || jsonb_build_array(el); end if;
  end loop;
  -- tags: the union, capped at 12 (the canonical record's own first; the rest is reported and kept in the audit)
  select count(*) into v_cnt from public.network_expert_tags x where x.expert_id = p_drop and not exists (select 1 from public.network_expert_tags y where y.expert_id = p_keep and y.tag_id = x.tag_id);
  n_tags_new := v_cnt;
  v_room := greatest(12 - (select count(*) from public.network_expert_tags y where y.expert_id = p_keep)::int, 0);
  n_tags := least(n_tags_new, v_room);
  n_tags_dropped := n_tags_new - n_tags;
  v_arch := case when k.archived_at is not null and d.archived_at is null then null else k.archived_at end;
  v_created := least(k.created_at, d.created_at);

  select jsonb_build_object(
           'list_items', n_moved + n_collapsed, 'items_moved', n_moved, 'items_collapsed', n_collapsed,
           'projects', (select count(distinct li.project_id) from public.list_items li where li.network_expert_id = p_drop),
           'booking_providers', (select count(*) from public.booking_providers bp join public.list_items li on li.id = bp.list_item_id where li.network_expert_id = p_drop),
           'booking_sessions', (select coalesce(sum(x.booking_sessions), 0) from app_private.expert_participation(p_drop) x),
           'distribution_sessions', (select coalesce(sum(x.distribution_sessions), 0) from app_private.expert_participation(p_drop) x),
           'tags_added', n_tags, 'tags_dropped', n_tags_dropped, 'notes_truncated', v_notes_trunc)
    into v_impact;

  if v_dry then
    return jsonb_build_object('dry_run', true, 'blocked', cardinality(v_blockers) > 0, 'blockers', to_jsonb(v_blockers), 'impact', v_impact, 'merged', eff || jsonb_build_object('notes', v_notes, 'languages', to_jsonb(v_langs)),
                              'keep', jsonb_build_object('id', k.id, 'kind', k.kind, 'name_en', k.name_en, 'name_ar', k.name_ar), 'drop', jsonb_build_object('id', d.id, 'kind', d.kind, 'name_en', d.name_en, 'name_ar', d.name_ar),
                              'items_moved', v_moved, 'items_collapsed', v_collapsed);
  end if;
  if cardinality(v_blockers) > 0 then
    raise exception 'expert_merge_blocked: %', array_to_string(v_blockers, ',') using errcode = 'P0001', hint = 'expert_merge_blocked', detail = array_to_string(v_blockers, ',');
  end if;

  -- 3. the before-images (kept for ever in the audit table: nothing of the duplicate is lost)
  v_keep_before := to_jsonb(k) - 'search_text' - 'name_key' - 'name_skels' - 'name_en_key' - 'name_ar_key' - 'link_key' - 'email_key';
  v_drop_before := to_jsonb(d) - 'search_text' - 'name_key' - 'name_skels' - 'name_en_key' - 'name_ar_key' - 'link_key' - 'email_key';
  select coalesce(jsonb_agg(x.tag_id order by x.tag_id), '[]'::jsonb) into v_keep_tags from public.network_expert_tags x where x.expert_id = p_keep;
  select coalesce(jsonb_agg(x.tag_id order by x.tag_id), '[]'::jsonb) into v_drop_tags from public.network_expert_tags x where x.expert_id = p_drop;

  -- 4. items: MOVED (same item id) or COLLAPSED (the dependents follow, then the duplicate item goes)
  for r in
    select di.id as drop_item, di.list_node_id, di.overlay as d_overlay, di.status as d_status, ki.id as keep_item, ki.overlay as k_overlay
      from public.list_items di
      left join public.list_items ki on ki.list_node_id = di.list_node_id and ki.network_expert_id = p_keep
     where di.network_expert_id = p_drop
     order by di.list_node_id, di.id
  loop
    if r.keep_item is null then
      update public.list_items set network_expert_id = p_keep where id = r.drop_item;
    else
      v_overlay := coalesce(r.d_overlay, '{}'::jsonb) || coalesce(r.k_overlay, '{}'::jsonb);
      if coalesce(r.d_overlay, '{}'::jsonb) <> '{}'::jsonb and octet_length((v_overlay || jsonb_build_object('merged_from', jsonb_build_object(r.drop_item::text, r.d_overlay)))::text) < 15000 then
        v_overlay := v_overlay || jsonb_build_object('merged_from', coalesce(r.k_overlay->'merged_from', '{}'::jsonb) || jsonb_build_object(r.drop_item::text, r.d_overlay));
      end if;
      update public.list_items set overlay = v_overlay, status = coalesce(status, r.d_status) where id = r.keep_item;
      update public.agenda_slots set presenter_item_id = r.keep_item where presenter_item_id = r.drop_item;
      -- mentoring distribution
      update public.distribution_sessions set mentor_item_id = r.keep_item where mentor_item_id = r.drop_item;
      get diagnostics v_n = row_count; n_dist := n_dist + v_n;
      l_dmentors := l_dmentors || coalesce((select jsonb_agg(to_jsonb(m)) from public.distribution_day_mentors m where m.mentor_item_id = r.drop_item), '[]'::jsonb);
      insert into public.distribution_day_mentors (day_id, mentor_item_id, project_id)
        select m.day_id, r.keep_item, m.project_id from public.distribution_day_mentors m where m.mentor_item_id = r.drop_item on conflict do nothing;
      delete from public.distribution_day_mentors where mentor_item_id = r.drop_item;
      l_rules := l_rules || coalesce((select jsonb_agg(to_jsonb(a)) from public.distribution_mentor_rules a where a.mentor_item_id = r.drop_item
                                        and exists (select 1 from public.distribution_mentor_rules b where b.node_id = a.node_id and b.mentor_item_id = r.keep_item)), '[]'::jsonb);
      delete from public.distribution_mentor_rules a where a.mentor_item_id = r.drop_item and exists (select 1 from public.distribution_mentor_rules b where b.node_id = a.node_id and b.mentor_item_id = r.keep_item);
      update public.distribution_mentor_rules set mentor_item_id = r.keep_item where mentor_item_id = r.drop_item;
      -- booking providers: one provider per (node, item): the duplicate's slots move to the canonical provider (no overlap: checked above)
      for pf in select * from public.booking_providers where list_item_id = r.drop_item loop
        select * into pk from public.booking_providers b where b.node_id = pf.node_id and b.list_item_id = r.keep_item;
        if found then
          update public.booking_slots set provider_id = pk.id where provider_id = pf.id;
          get diagnostics v_n = row_count; n_slots := n_slots + v_n;
          update public.booking_providers set advance_notice_min = coalesce(advance_notice_min, pf.advance_notice_min), booking_email = coalesce(booking_email, pf.booking_email),
                 is_active = is_active or pf.is_active, sort_order = coalesce(sort_order, pf.sort_order) where id = pk.id;
          l_providers := l_providers || jsonb_build_array(to_jsonb(pf));
          delete from public.booking_providers where id = pf.id;
        else
          update public.booking_providers set list_item_id = r.keep_item where id = pf.id;
        end if;
        n_prov := n_prov + 1;
      end loop;
      -- anything else that may point at a list item (the same set merge_companies handles)
      update public.bookings set booker_item_id = r.keep_item where booker_item_id = r.drop_item;
      update app_private.email_outbox set list_item_id = r.keep_item where list_item_id = r.drop_item;
      l_invites := l_invites || coalesce((select jsonb_agg(to_jsonb(i)) from public.booking_invitations i where i.booker_item_id = r.drop_item
                                            and exists (select 1 from public.booking_invitations j where j.node_id = i.node_id and j.booker_item_id = r.keep_item and j.revoked_at is null)), '[]'::jsonb);
      delete from public.booking_invitations i where i.booker_item_id = r.drop_item
        and exists (select 1 from public.booking_invitations j where j.node_id = i.node_id and j.booker_item_id = r.keep_item and j.revoked_at is null);
      update public.booking_invitations set booker_item_id = r.keep_item where booker_item_id = r.drop_item;
      l_reviews := l_reviews || coalesce((select jsonb_agg(to_jsonb(s)) from public.selection_reviews s where s.item_id = r.drop_item and exists (select 1 from public.selection_reviews s2 where s2.item_id = r.keep_item)), '[]'::jsonb);
      delete from public.selection_reviews where item_id = r.drop_item and exists (select 1 from public.selection_reviews s2 where s2.item_id = r.keep_item);
      update public.selection_reviews set item_id = r.keep_item where item_id = r.drop_item;
      l_scores := l_scores || coalesce((select jsonb_agg(to_jsonb(a)) from public.selection_scores a where a.item_id = r.drop_item
                                          and exists (select 1 from public.selection_scores b where b.item_id = r.keep_item and b.reviewer_id = a.reviewer_id)), '[]'::jsonb);
      delete from public.selection_scores a where a.item_id = r.drop_item and exists (select 1 from public.selection_scores b where b.item_id = r.keep_item and b.reviewer_id = a.reviewer_id);
      update public.selection_scores set item_id = r.keep_item where item_id = r.drop_item;
      -- safety net: no table may still point at the duplicate item (a future foreign key must not be cascaded away silently)
      for ref in select c.conrelid::regclass::text as tbl, a.attname as col
                   from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                  where c.contype = 'f' and c.confrelid = 'public.list_items'::regclass loop
        execute format('select count(*) from %s where %I = $1', ref.tbl, ref.col) into v_cnt using r.drop_item;
        if v_cnt > 0 then raise exception 'expert_merge_blocked: unhandled_reference:%', ref.tbl using errcode = 'P0001', hint = 'expert_merge_blocked', detail = 'unhandled_reference:' || ref.tbl; end if;
      end loop;
      l_items := l_items || jsonb_build_array((select to_jsonb(li) from public.list_items li where li.id = r.drop_item));
      delete from public.list_items where id = r.drop_item;
    end if;
  end loop;

  -- 5. the canonical record takes the chosen / merged values; the duplicate becomes a soft-deleted pointer
  update public.network_experts x set
    name_en = eff->>'name_en', name_ar = eff->>'name_ar', title_en = eff->>'title_en', title_ar = eff->>'title_ar', company_en = eff->>'company_en', company_ar = eff->>'company_ar',
    bio_en = eff->>'bio_en', bio_ar = eff->>'bio_ar', photo_path = eff->>'photo_path', linkedin_url = eff->>'linkedin_url', website_url = eff->>'website_url',
    email = (eff->>'email')::extensions.citext, phone = eff->>'phone', notes = v_notes, languages = v_langs, links = v_links, archived_at = v_arch, created_at = v_created
  where x.id = p_keep;
  insert into public.network_expert_tags (expert_id, tag_id)
    select p_keep, t.tag_id from public.network_expert_tags t join public.expert_tags et on et.id = t.tag_id
     where t.expert_id = p_drop and not exists (select 1 from public.network_expert_tags y where y.expert_id = p_keep and y.tag_id = t.tag_id)
     order by lower(coalesce(et.name_en, et.name_ar)), t.tag_id limit v_room
  on conflict do nothing;
  delete from public.network_expert_tags where expert_id = p_drop;
  update public.network_experts set deleted_at = now(), merged_into = p_keep, archived_at = null where id = p_drop;

  insert into app_private.network_expert_merges (keep_id, drop_id, keep_name, drop_name, keep_before, drop_before, plan, result, merged_by)
  values (p_keep, p_drop, coalesce(k.name_en, k.name_ar), coalesce(d.name_en, d.name_ar), v_keep_before, v_drop_before,
          jsonb_build_object('items_moved', v_moved, 'items_collapsed', v_collapsed, 'field_choices', v_fields, 'keep_tags', v_keep_tags, 'drop_tags', v_drop_tags,
                             'dropped_rows', jsonb_build_object('list_items', l_items, 'mentor_rules', l_rules, 'day_mentors', l_dmentors, 'booking_providers', l_providers,
                                                                'booking_invitations', l_invites, 'selection_reviews', l_reviews, 'selection_scores', l_scores)),
          v_impact || jsonb_build_object('providers_repointed', n_prov, 'booking_slots_moved', n_slots, 'distribution_sessions_repointed', n_dist), v_uid)
  returning id into v_merge_id;

  return jsonb_build_object('dry_run', false, 'merged', true, 'keep_id', p_keep, 'drop_id', p_drop, 'merge_id', v_merge_id, 'impact', v_impact);
end $$;

-- ================================================================= 14. import: one candidate lookup per row; the preview sees repeats INSIDE the file (name in either language, e-mail, LinkedIn)
-- (the 3-argument version of m77 is dropped: a second overload would make every call ambiguous)
drop function if exists public.import_network_experts(jsonb, boolean, text);
create or replace function public.import_network_experts(p_rows jsonb, p_dry_run boolean default true, p_duplicates text default 'skip', p_seen jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_dry boolean := coalesce(p_dry_run, true); v_mode text := coalesce(nullif(p_duplicates, ''), 'skip');
  el jsonb; i int := 0; c jsonb; v_out jsonb := '[]'::jsonb; v_matches jsonb; v_status text; v_err text; v_id uuid; v_name text; v_in_file boolean;
  v_seen_names text[] := '{}'::text[]; v_seen_links text[] := '{}'::text[]; v_seen_mails text[] := '{}'::text[]; v_nen text; v_nar text; v_lk text; v_em text;
  n_new int := 0; n_dup int := 0; n_inv int := 0; n_created int := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_mode not in ('skip', 'create') then perform app_private.expert_fail('duplicates', 'bad_value'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then perform app_private.expert_fail('rows', 'bad_type'); end if;
  if jsonb_array_length(p_rows) > 500 then perform app_private.expert_fail('rows', 'too_many'); end if;
  -- a big file is imported in chunks (the client sends ~50 rows per call): p_seen carries the keys of the rows of the earlier chunks, so a repeat ACROSS chunks is still reported
  if p_seen is not null and jsonb_typeof(p_seen) = 'object' then
    if jsonb_typeof(p_seen->'names') = 'array' then v_seen_names := array(select left(e, 300) from jsonb_array_elements_text(p_seen->'names') e limit 3000); end if;
    if jsonb_typeof(p_seen->'links') = 'array' then v_seen_links := array(select left(e, 300) from jsonb_array_elements_text(p_seen->'links') e limit 3000); end if;
    if jsonb_typeof(p_seen->'mails') = 'array' then v_seen_mails := array(select left(e, 300) from jsonb_array_elements_text(p_seen->'mails') e limit 3000); end if;
  end if;
  for el in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_matches := null; v_err := null; v_id := null; v_in_file := false; c := null;
    begin
      c := app_private.expert_clean(el - 'kind');          -- an import never creates a team member
      if c->>'name_en' is null and c->>'name_ar' is null then perform app_private.expert_fail('name', 'required'); end if;
      v_nen := app_private.expert_norm(c->>'name_en'); v_nar := app_private.expert_norm(c->>'name_ar');
      v_lk := case when position('/' in app_private.expert_linkkey(c->>'linkedin_url')) > 0 then app_private.expert_linkkey(c->>'linkedin_url') end;
      v_em := nullif(lower(btrim(coalesce(c->>'email', ''))), '');
      if (char_length(v_nen) >= 3 and v_nen = any (v_seen_names)) or (char_length(v_nar) >= 3 and v_nar = any (v_seen_names))
         or (v_lk is not null and v_lk = any (v_seen_links)) or (v_em is not null and v_em = any (v_seen_mails)) then v_in_file := true; end if;
      select jsonb_agg(jsonb_build_object('id', s.id, 'score', s.score, 'reasons', to_jsonb(s.reasons), 'name_en', ne.name_en, 'name_ar', ne.name_ar) order by s.score desc, ne.created_at)
        into v_matches
        from app_private.expert_find_similar(c->>'name_en', c->>'name_ar', c->>'email', c->>'linkedin_url', 'expert', null, 0.95, 3) s join public.network_experts ne on ne.id = s.id;
      v_status := case when v_matches is not null or v_in_file then 'duplicate' else 'new' end;
      v_name := coalesce(c->>'name_en', c->>'name_ar');
      if char_length(v_nen) >= 3 then v_seen_names := array_append(v_seen_names, v_nen); end if;
      if char_length(v_nar) >= 3 then v_seen_names := array_append(v_seen_names, v_nar); end if;
      if v_lk is not null then v_seen_links := array_append(v_seen_links, v_lk); end if;
      if v_em is not null then v_seen_mails := array_append(v_seen_mails, v_em); end if;
      if v_status = 'new' or v_mode = 'create' then
        if not v_dry then
          insert into public.network_experts (kind, name_en, name_ar, title_en, title_ar, company_en, company_ar, bio_en, bio_ar, linkedin_url, website_url, email, phone, notes, links, languages, created_by)
          values ('expert', c->>'name_en', c->>'name_ar', c->>'title_en', c->>'title_ar', c->>'company_en', c->>'company_ar', c->>'bio_en', c->>'bio_ar', c->>'linkedin_url', c->>'website_url',
                  (c->>'email')::extensions.citext, c->>'phone', c->>'notes', coalesce(c->'links', '[]'::jsonb), coalesce(array(select jsonb_array_elements_text(c->'languages')), '{}'::text[]), v_uid)
          returning id into v_id;
          if c ? 'tags' then perform app_private.expert_set_tags(v_id, c->'tags', v_uid); end if;
          v_status := 'created'; n_created := n_created + 1;
        else
          n_new := n_new + 1;
          if v_matches is not null or v_in_file then n_dup := n_dup + 1; n_new := n_new - 1; end if;
        end if;
      else
        n_dup := n_dup + 1;
      end if;
    exception when others then
      get stacked diagnostics v_err = pg_exception_detail;
      v_status := 'invalid'; v_err := coalesce(v_err, sqlerrm); n_inv := n_inv + 1; v_name := null;
      if sqlstate not in ('22023') then v_err := 'row:bad_value'; end if;
    end;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('index', i, 'status', v_status, 'name', v_name, 'id', v_id, 'matches', v_matches, 'in_file', case when v_in_file then true end, 'error', v_err)));
  end loop;
  return jsonb_build_object('dry_run', v_dry, 'counts', jsonb_build_object('new', n_new, 'duplicate', n_dup, 'invalid', n_inv, 'created', n_created), 'rows', v_out,
                            'seen', jsonb_build_object('names', to_jsonb(v_seen_names), 'links', to_jsonb(v_seen_links), 'mails', to_jsonb(v_seen_mails)));
end $$;
revoke all on function public.import_network_experts(jsonb, boolean, text, jsonb) from public, anon;
grant execute on function public.import_network_experts(jsonb, boolean, text, jsonb) to authenticated;

-- ================================================================= 15. grants (create or replace keeps the ACL of the replaced functions; the re-created participation function was revoked above)
revoke all on function public.network_expert_usage(uuid) from public, anon;
grant execute on function public.network_expert_usage(uuid) to authenticated;

do $$
declare v_bad int;
begin
  if exists (select 1 from pg_policies where tablename = 'network_experts' and policyname in ('network_experts_insert_pm_role', 'network_experts_update_pm_role')) then raise exception 'm78: a direct write policy is still there'; end if;
  if has_table_privilege('authenticated', 'public.network_experts', 'INSERT') or has_table_privilege('authenticated', 'public.network_experts', 'UPDATE') then raise exception 'm78: authenticated can still write network_experts'; end if;
  select count(*) into v_bad from public.network_experts where name_en_key is null and name_ar_key is null;
  if v_bad <> 0 then raise exception 'm78: % experts without the stored keys', v_bad; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_network_experts', 'get_network_expert', 'list_expert_duplicate_pairs', 'update_network_expert', 'delete_network_expert',
                                                                                                'merge_network_experts', 'import_network_experts', 'network_expert_usage') and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'm78: anon can execute a registry function';
  end if;
  if has_function_privilege('authenticated', 'app_private.expert_participation(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.expert_find_similar(text, text, text, text, text, uuid, numeric, integer)', 'EXECUTE') then
    raise exception 'm78: an engine helper is open to authenticated';
  end if;
  raise notice 'm78 ok';
end $$;

commit;
