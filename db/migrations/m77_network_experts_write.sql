-- m77_network_experts_write.sql  (Athar Network: the experts registry, part 3 = the WRITE side: create / edit / photo / tags / archive / delete / restore / merge / import)
-- Re-runnable (create or replace). Local DB only. Run AFTER m75 and m76. Verify with db/verify/v77_network_experts_write.sql.
--
-- WHO MAY WRITE (assumed, the owner could not be asked):
--   project_manager, alumni_manager, super_admin: create, edit (incl. the photo and the tags), archive / unarchive, import.
--   super_admin ONLY: delete (soft, and only an expert no list uses), restore, MERGE, dismiss a "not the same person" pair, rename / archive a tag, change the kind of a record.
-- The tables keep their old direct-write policies for project_manager / super_admin (the Lists node used them), but `deleted_at` and `merged_into` are guarded by a trigger (m75): a
-- project manager cannot delete or merge through the table either. The client writes through these RPCs (normalised, validated, the duplicate check, the same stamps for every role).
--
-- ARCHIVE vs DELETE: ARCHIVE (archived_at) hides an expert from the pickers and the default registry view; every list that already uses the expert keeps resolving it (the history is
-- untouched). DELETE (deleted_at) is the soft delete of a record nobody uses (a typo, a test): refused while a list item points at it. MERGE keeps ONE canonical record and repoints
-- every reference; the duplicate becomes a soft-deleted row with `merged_into`, the full before-image of both rows and the plan are kept in app_private.network_expert_merges.
set search_path = public, extensions;

begin;

-- ================================================================= validation: one cleaner for create / update / import
-- Keeps only the keys that are present, trims and collapses whitespace (tabs and runs of spaces of the migrated names), turns '' into null and refuses what the form should have caught.
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
    if v is not null and (v !~ '^[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+\.webp$') then perform app_private.expert_fail('photo_path', 'invalid'); end if;
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
      u := case when jsonb_typeof(el) = 'string' then el #>> '{}' when jsonb_typeof(el) = 'object' then el->>'url' end;
      u := nullif(btrim(coalesce(u, '')), '');
      if u is null then continue; end if;
      if char_length(u) > 500 or u !~* '^https?://[^[:space:]]+$' then perform app_private.expert_fail('links', 'invalid'); end if;
      kd := case when jsonb_typeof(el) = 'object' and lower(coalesce(el->>'kind', '')) ~ '^[a-z]{1,20}$' then lower(el->>'kind') else 'other' end;
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

-- ================================================================= tags
-- Finds or creates a tag by its name (the key is the normal form of the English name, else of the Arabic one: "Marketing" = "marketing"); a missing language is filled in, an archived tag typed again comes back.
create or replace function app_private.expert_upsert_tag(p_name_en text, p_name_ar text, p_uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_en text := nullif(btrim(regexp_replace(coalesce(p_name_en, ''), '\s+', ' ', 'g')), ''); v_ar text := nullif(btrim(regexp_replace(coalesce(p_name_ar, ''), '\s+', ' ', 'g')), '');
        v_key text; v_id uuid;
begin
  if v_en is null and v_ar is null then perform app_private.expert_fail('tags', 'name_required'); end if;
  if char_length(coalesce(v_en, '')) > 60 or char_length(coalesce(v_ar, '')) > 60 then perform app_private.expert_fail('tags', 'too_long'); end if;
  v_key := app_private.expert_norm(coalesce(v_en, v_ar));
  if v_key = '' then perform app_private.expert_fail('tags', 'name_required'); end if;
  insert into public.expert_tags (tag_key, name_en, name_ar, created_by) values (v_key, v_en, v_ar, p_uid)
  on conflict (tag_key) do update set name_en = coalesce(public.expert_tags.name_en, excluded.name_en), name_ar = coalesce(public.expert_tags.name_ar, excluded.name_ar), archived_at = null
  returning id into v_id;
  return v_id;
end $$;

-- Replaces the tags of an expert: each element is a tag uuid, {id}, {name_en, name_ar} or a plain name (Arabic letters -> the Arabic name); at most 12.
create or replace function app_private.expert_set_tags(p_expert uuid, p_tags jsonb, p_uid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare el jsonb; v_id uuid; v_ids uuid[] := '{}'::uuid[]; v_txt text; v_arch timestamptz; v_found boolean;
        c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_tags is null or jsonb_typeof(p_tags) <> 'array' then perform app_private.expert_fail('tags', 'bad_type'); end if;
  for el in select * from jsonb_array_elements(p_tags) loop
    v_id := null;
    if jsonb_typeof(el) = 'string' then
      v_txt := btrim(el #>> '{}');
      if lower(v_txt) ~ c_uuid then v_id := lower(v_txt)::uuid;
      elsif v_txt ~ '[؀-ۿ]' then v_id := app_private.expert_upsert_tag(null, v_txt, p_uid);
      else v_id := app_private.expert_upsert_tag(v_txt, null, p_uid); end if;
    elsif jsonb_typeof(el) = 'object' then
      if lower(coalesce(el->>'id', '')) ~ c_uuid then v_id := lower(el->>'id')::uuid;
      else v_id := app_private.expert_upsert_tag(el->>'name_en', el->>'name_ar', p_uid); end if;
    else
      perform app_private.expert_fail('tags', 'bad_value');
    end if;
    select true, t.archived_at into v_found, v_arch from public.expert_tags t where t.id = v_id;
    if v_found is not true then perform app_private.expert_fail('tags', 'unknown'); end if;
    if v_arch is not null and not exists (select 1 from public.network_expert_tags x where x.expert_id = p_expert and x.tag_id = v_id) then perform app_private.expert_fail('tags', 'archived'); end if;
    if not (v_id = any (v_ids)) then v_ids := array_append(v_ids, v_id); end if;
  end loop;
  if cardinality(v_ids) > 12 then perform app_private.expert_fail('tags', 'too_many'); end if;
  delete from public.network_expert_tags x where x.expert_id = p_expert and x.tag_id <> all (v_ids);
  insert into public.network_expert_tags (expert_id, tag_id) select p_expert, i from unnest(v_ids) i on conflict do nothing;
  return cardinality(v_ids);
end $$;

-- ================================================================= create
-- -> { created: true, id, updated_at }  or, when a BLOCKING duplicate exists (same link / e-mail / name) and p_force is not true,  { created: false, duplicates: [...] } and nothing is written.
create or replace function public.create_network_expert(p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb; v_id uuid; v_dups jsonb; v_uid uuid := (select auth.uid()); v_kind text; v_upd timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  c := app_private.expert_clean(p);
  if c->>'name_en' is null and c->>'name_ar' is null then perform app_private.expert_fail('name', 'required'); end if;
  v_kind := coalesce(c->>'kind', 'expert');
  if not coalesce(p_force, false) then
    select jsonb_agg(jsonb_build_object('id', s.id, 'score', s.score, 'reasons', to_jsonb(s.reasons),
                     'expert', jsonb_build_object('id', ne.id, 'kind', ne.kind, 'name_en', ne.name_en, 'name_ar', ne.name_ar, 'title_en', ne.title_en, 'title_ar', ne.title_ar,
                                                  'company_en', ne.company_en, 'company_ar', ne.company_ar, 'photo_path', ne.photo_path, 'archived_at', ne.archived_at)) order by s.score desc, ne.created_at)
      into v_dups
      from app_private.expert_find_similar(c->>'name_en', c->>'name_ar', c->>'email', c->>'linkedin_url', v_kind, null, 0.95, 5) s join public.network_experts ne on ne.id = s.id;
    if v_dups is not null then return jsonb_build_object('created', false, 'duplicates', v_dups); end if;
  end if;
  insert into public.network_experts (kind, name_en, name_ar, title_en, title_ar, company_en, company_ar, bio_en, bio_ar, photo_path, linkedin_url, website_url, email, phone, notes, links, languages, created_by)
  values (v_kind, c->>'name_en', c->>'name_ar', c->>'title_en', c->>'title_ar', c->>'company_en', c->>'company_ar', c->>'bio_en', c->>'bio_ar', c->>'photo_path',
          c->>'linkedin_url', c->>'website_url', (c->>'email')::extensions.citext, c->>'phone', c->>'notes', coalesce(c->'links', '[]'::jsonb),
          coalesce(array(select jsonb_array_elements_text(c->'languages')), '{}'::text[]), v_uid)
  returning id, updated_at into v_id, v_upd;
  if c ? 'tags' then perform app_private.expert_set_tags(v_id, c->'tags', v_uid); end if;
  return jsonb_build_object('created', true, 'id', v_id, 'updated_at', v_upd);
end $$;

-- ================================================================= update (a PATCH: only the keys present change)
-- p_expected = the updated_at the caller loaded: a different value means somebody saved in between (expert_stale, P0001). -> { updated: true, id, updated_at, old_photo_path }
create or replace function public.update_network_expert(p_id uuid, p jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ne public.network_experts; c jsonb; v_uid uuid := (select auth.uid()); v_upd timestamptz; v_sa boolean; v_en text; v_ar text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sa := coalesce(app_private.is_super_admin(), false);
  c := app_private.expert_clean(p);
  select * into ne from public.network_experts x where x.id = p_id for update;
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
  return jsonb_build_object('updated', true, 'id', p_id, 'updated_at', v_upd,
                            'old_photo_path', case when c ? 'photo_path' and (c->>'photo_path') is distinct from ne.photo_path then ne.photo_path end);
end $$;

create or replace function public.set_network_expert_tags(p_expert uuid, p_tags jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.network_experts x where x.id = p_expert and x.deleted_at is null) then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  n := app_private.expert_set_tags(p_expert, p_tags, v_uid);
  update public.network_experts set updated_at = now() where id = p_expert;
  return jsonb_build_object('id', p_expert, 'tags', n);
end $$;

-- ================================================================= archive / delete / restore
create or replace function public.set_network_expert_archived(p_id uuid, p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_at timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_archived is null then perform app_private.expert_fail('archived', 'required'); end if;
  update public.network_experts x set archived_at = case when p_archived then coalesce(x.archived_at, now()) end, archived_by = case when p_archived then v_uid end
   where x.id = p_id and x.deleted_at is null returning x.archived_at into v_at;
  if not found then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  return jsonb_build_object('id', p_id, 'archived_at', v_at);
end $$;

-- soft delete (super_admin): refused while ANY list item points at the expert (archive or merge instead)
create or replace function public.delete_network_expert(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uses int;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.network_experts x where x.id = p_id and x.deleted_at is null) then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  select count(*) into v_uses from public.list_items li where li.network_expert_id = p_id;
  if v_uses > 0 then raise exception 'expert_in_use: % list item(s) use this expert', v_uses using errcode = 'P0001', hint = 'expert_in_use', detail = v_uses::text; end if;
  update public.network_experts set deleted_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

create or replace function public.restore_network_expert(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ne public.network_experts;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ne from public.network_experts x where x.id = p_id for update;
  if not found or ne.deleted_at is null then raise exception 'expert_not_found: no such deleted expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  if ne.merged_into is not null then raise exception 'expert_merged: a merged record cannot be restored' using errcode = 'P0001', hint = 'expert_merged'; end if;
  update public.network_experts set deleted_at = null where id = p_id;
  return jsonb_build_object('id', p_id, 'restored', true);
end $$;

-- ================================================================= tag management (super_admin) and "these two are not the same person"
create or replace function public.update_expert_tag(p_id uuid, p_name_en text default null, p_name_ar text default null, p_archived boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.expert_tags; v_en text; v_ar text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.expert_tags x where x.id = p_id for update;
  if not found then raise exception 'expert_not_found: no such tag' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  v_en := case when p_name_en is null then t.name_en else nullif(btrim(regexp_replace(p_name_en, '\s+', ' ', 'g')), '') end;
  v_ar := case when p_name_ar is null then t.name_ar else nullif(btrim(regexp_replace(p_name_ar, '\s+', ' ', 'g')), '') end;
  if v_en is null and v_ar is null then perform app_private.expert_fail('tags', 'name_required'); end if;
  if char_length(coalesce(v_en, '')) > 60 or char_length(coalesce(v_ar, '')) > 60 then perform app_private.expert_fail('tags', 'too_long'); end if;
  if exists (select 1 from public.expert_tags o where o.id <> p_id and o.tag_key = app_private.expert_norm(coalesce(v_en, v_ar))) then perform app_private.expert_fail('tags', 'duplicate'); end if;
  update public.expert_tags x set name_en = v_en, name_ar = v_ar, tag_key = app_private.expert_norm(coalesce(v_en, v_ar)),
         archived_at = case when p_archived is null then x.archived_at when p_archived then coalesce(x.archived_at, now()) else null end where x.id = p_id;
  return jsonb_build_object('id', p_id, 'updated', true);
end $$;

create or replace function public.dismiss_expert_duplicate(p_a uuid, p_b uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_a is null or p_b is null or p_a = p_b then perform app_private.expert_fail('pair', 'bad_value'); end if;
  if (select count(*) from public.network_experts x where x.id in (p_a, p_b) and x.deleted_at is null) <> 2 then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  insert into app_private.network_expert_nondup (a, b, dismissed_by) values (least(p_a, p_b), greatest(p_a, p_b), (select auth.uid())) on conflict do nothing;
  return jsonb_build_object('dismissed', true);
end $$;

-- ================================================================= MERGE (super_admin): one canonical record, every reference repointed, nothing lost
-- p_fields = { "<field>": "keep" | "drop" } picks which record's value a scalar field takes (default: the kept record's value, else the other's; an empty choice never erases a value).
-- notes are concatenated, languages / links / tags are the union (links max 6, tags max 12).
-- p_dry_run (DEFAULT true) returns the PLAN and writes nothing: { dry_run, keep, drop, merged (the resulting scalar values), impact, blockers }.
-- A run with blockers is refused (expert_merge_blocked, detail = the blocker keys): withdrawn_mismatch (withdrawn from a list in one record, active in the other), mentor_slot_conflict
-- (both records mentor the same distribution slot), provider_slot_conflict (both are booking providers of one node and their slots overlap), kind_mismatch, unhandled_reference:<table>.
-- Items of the duplicate in a list that does not hold the canonical expert are MOVED (same item id: every booking, session and invitation stays attached); items in a list that holds both are
-- COLLAPSED into the canonical item (overlay merged, status kept, every dependent repointed), like merge_companies.
create or replace function public.merge_network_experts(p_keep uuid, p_drop uuid, p_dry_run boolean default true, p_fields jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.network_experts; d public.network_experts; v_uid uuid := (select auth.uid()); v_dry boolean := coalesce(p_dry_run, true);
  v_fields jsonb := case when jsonb_typeof(coalesce(p_fields, '{}'::jsonb)) = 'object' then coalesce(p_fields, '{}'::jsonb) else '{}'::jsonb end;
  r record; pf public.booking_providers; pk public.booking_providers; ref record; v_cnt bigint;
  v_moved jsonb := '[]'::jsonb; v_collapsed jsonb := '[]'::jsonb; v_blockers text[] := '{}'::text[];
  n_moved int := 0; n_collapsed int := 0; n_prov int := 0; n_slots int := 0; n_dist int := 0; n_tags int := 0; v_n int;
  f text; choice text; kv text; dv text; eff jsonb := '{}'::jsonb; v_notes text; v_notes_trunc boolean := false; v_links jsonb := '[]'::jsonb; el jsonb;
  v_langs text[]; v_overlay jsonb; v_merge_id uuid; v_keep_before jsonb; v_drop_before jsonb; v_impact jsonb; v_arch timestamptz; v_created timestamptz;
  c_fields constant text[] := array['name_en', 'name_ar', 'title_en', 'title_ar', 'company_en', 'company_ar', 'bio_en', 'bio_ar', 'photo_path', 'linkedin_url', 'website_url', 'email', 'phone'];
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then perform app_private.expert_fail('merge', 'same_record'); end if;
  perform 1 from public.network_experts x where x.id in (p_keep, p_drop) order by x.id for update;
  select * into k from public.network_experts x where x.id = p_keep;
  select * into d from public.network_experts x where x.id = p_drop;
  if k.id is null or d.id is null or k.deleted_at is not null or d.deleted_at is not null then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  if k.kind <> d.kind then v_blockers := array_append(v_blockers, 'kind_mismatch'); end if;

  -- 1. the plan: every list item of the duplicate is either MOVED or COLLAPSED into the canonical item of the same list
  for r in
    select di.id as drop_item, di.list_node_id, di.project_id, di.withdrawn_at as d_wd, ki.id as keep_item, ki.withdrawn_at as k_wd
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
      if (r.d_wd is null) is distinct from (r.k_wd is null) then v_blockers := array_append(v_blockers, 'withdrawn_mismatch'); end if;
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
  select count(*) into v_cnt from public.network_expert_tags x where x.expert_id = p_drop and not exists (select 1 from public.network_expert_tags y where y.expert_id = p_keep and y.tag_id = x.tag_id);
  n_tags := v_cnt;
  v_arch := case when k.archived_at is not null and d.archived_at is null then null else k.archived_at end;
  v_created := least(k.created_at, d.created_at);

  select jsonb_build_object(
           'list_items', n_moved + n_collapsed, 'items_moved', n_moved, 'items_collapsed', n_collapsed,
           'projects', (select count(distinct li.project_id) from public.list_items li where li.network_expert_id = p_drop),
           'booking_providers', (select count(*) from public.booking_providers bp join public.list_items li on li.id = bp.list_item_id where li.network_expert_id = p_drop),
           'booking_sessions', (select coalesce(sum(x.booking_sessions), 0) from app_private.expert_participation(p_drop) x),
           'distribution_sessions', (select coalesce(sum(x.distribution_sessions), 0) from app_private.expert_participation(p_drop) x),
           'tags_added', n_tags, 'notes_truncated', v_notes_trunc)
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
  v_keep_before := to_jsonb(k) - 'search_text' - 'name_key' - 'name_skels';
  v_drop_before := to_jsonb(d) - 'search_text' - 'name_key' - 'name_skels';

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
      insert into public.distribution_day_mentors (day_id, mentor_item_id, project_id)
        select m.day_id, r.keep_item, m.project_id from public.distribution_day_mentors m where m.mentor_item_id = r.drop_item on conflict do nothing;
      delete from public.distribution_day_mentors where mentor_item_id = r.drop_item;
      delete from public.distribution_mentor_rules a where a.mentor_item_id = r.drop_item and exists (select 1 from public.distribution_mentor_rules b where b.node_id = a.node_id and b.mentor_item_id = r.keep_item);
      update public.distribution_mentor_rules set mentor_item_id = r.keep_item where mentor_item_id = r.drop_item;
      -- booking providers: one provider per (node, item): the duplicate's slots move to the canonical provider (no overlap: checked above)
      for pf in select * from public.booking_providers where list_item_id = r.drop_item loop
        select * into pk from public.booking_providers b where b.node_id = pf.node_id and b.list_item_id = r.keep_item;
        if found then
          update public.booking_slots set provider_id = pk.id where provider_id = pf.id;
          get diagnostics v_n = row_count; n_slots := n_slots + v_n;
          update public.booking_providers set advance_notice_min = coalesce(advance_notice_min, pf.advance_notice_min), booking_email = coalesce(booking_email, pf.booking_email) where id = pk.id;
          delete from public.booking_providers where id = pf.id;
        else
          update public.booking_providers set list_item_id = r.keep_item where id = pf.id;
        end if;
        n_prov := n_prov + 1;
      end loop;
      -- anything else that may point at a list item (the same set merge_companies handles)
      update public.bookings set booker_item_id = r.keep_item where booker_item_id = r.drop_item;
      update app_private.email_outbox set list_item_id = r.keep_item where list_item_id = r.drop_item;
      delete from public.booking_invitations i where i.booker_item_id = r.drop_item
        and exists (select 1 from public.booking_invitations j where j.node_id = i.node_id and j.booker_item_id = r.keep_item and j.revoked_at is null);
      update public.booking_invitations set booker_item_id = r.keep_item where booker_item_id = r.drop_item;
      delete from public.selection_reviews where item_id = r.drop_item and exists (select 1 from public.selection_reviews s2 where s2.item_id = r.keep_item);
      update public.selection_reviews set item_id = r.keep_item where item_id = r.drop_item;
      delete from public.selection_scores a where a.item_id = r.drop_item and exists (select 1 from public.selection_scores b where b.item_id = r.keep_item and b.reviewer_id = a.reviewer_id);
      update public.selection_scores set item_id = r.keep_item where item_id = r.drop_item;
      -- safety net: no table may still point at the duplicate item (a future foreign key must not be cascaded away silently)
      for ref in select c.conrelid::regclass::text as tbl, a.attname as col
                   from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                  where c.contype = 'f' and c.confrelid = 'public.list_items'::regclass loop
        execute format('select count(*) from %s where %I = $1', ref.tbl, ref.col) into v_cnt using r.drop_item;
        if v_cnt > 0 then raise exception 'expert_merge_blocked: unhandled_reference:%', ref.tbl using errcode = 'P0001', hint = 'expert_merge_blocked', detail = 'unhandled_reference:' || ref.tbl; end if;
      end loop;
      delete from public.list_items where id = r.drop_item;
    end if;
  end loop;

  -- 5. the canonical record takes the chosen / merged values; the duplicate becomes a soft-deleted pointer
  update public.network_experts x set
    name_en = eff->>'name_en', name_ar = eff->>'name_ar', title_en = eff->>'title_en', title_ar = eff->>'title_ar', company_en = eff->>'company_en', company_ar = eff->>'company_ar',
    bio_en = eff->>'bio_en', bio_ar = eff->>'bio_ar', photo_path = eff->>'photo_path', linkedin_url = eff->>'linkedin_url', website_url = eff->>'website_url',
    email = (eff->>'email')::extensions.citext, phone = eff->>'phone', notes = v_notes, languages = v_langs, links = v_links, archived_at = v_arch, created_at = v_created
  where x.id = p_keep;
  insert into public.network_expert_tags (expert_id, tag_id) select p_keep, t.tag_id from public.network_expert_tags t where t.expert_id = p_drop on conflict do nothing;
  delete from public.network_expert_tags where expert_id = p_drop;
  update public.network_experts set deleted_at = now(), merged_into = p_keep, archived_at = null where id = p_drop;

  insert into app_private.network_expert_merges (keep_id, drop_id, keep_name, drop_name, keep_before, drop_before, plan, result, merged_by)
  values (p_keep, p_drop, coalesce(k.name_en, k.name_ar), coalesce(d.name_en, d.name_ar), v_keep_before, v_drop_before,
          jsonb_build_object('items_moved', v_moved, 'items_collapsed', v_collapsed, 'field_choices', v_fields),
          v_impact || jsonb_build_object('providers_repointed', n_prov, 'booking_slots_moved', n_slots, 'distribution_sessions_repointed', n_dist), v_uid)
  returning id into v_merge_id;

  return jsonb_build_object('dry_run', false, 'merged', true, 'keep_id', p_keep, 'drop_id', p_drop, 'merge_id', v_merge_id, 'impact', v_impact);
end $$;

-- ================================================================= import (staff): a PREVIEW (dry run) and the real thing; at most 500 rows
-- p_rows = [{ name_en, name_ar, title_en, ..., email, phone, linkedin_url, website_url, languages: [...], tags: ["name", ...], notes, bio_en, bio_ar }]
-- p_duplicates: 'skip' (default: a row with a BLOCKING duplicate is not imported) | 'create' (imported anyway).
-- -> { dry_run, counts: { new, duplicate, invalid, created }, rows: [{ index, status: new | duplicate | invalid | created, name, id?, matches?: [...], error?: "<field>:<reason>" }] }
create or replace function public.import_network_experts(p_rows jsonb, p_dry_run boolean default true, p_duplicates text default 'skip') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_dry boolean := coalesce(p_dry_run, true); v_mode text := coalesce(nullif(p_duplicates, ''), 'skip');
  el jsonb; i int := 0; c jsonb; v_out jsonb := '[]'::jsonb; v_matches jsonb; v_status text; v_err text; v_id uuid; v_name text; v_in_file boolean;
  v_seen_names text[] := '{}'::text[]; v_seen_links text[] := '{}'::text[]; v_nk text; v_lk text;
  n_new int := 0; n_dup int := 0; n_inv int := 0; n_created int := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_mode not in ('skip', 'create') then perform app_private.expert_fail('duplicates', 'bad_value'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then perform app_private.expert_fail('rows', 'bad_type'); end if;
  if jsonb_array_length(p_rows) > 500 then perform app_private.expert_fail('rows', 'too_many'); end if;
  for el in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_matches := null; v_err := null; v_id := null; v_in_file := false; c := null;
    begin
      c := app_private.expert_clean(el - 'kind');          -- an import never creates a team member
      if c->>'name_en' is null and c->>'name_ar' is null then perform app_private.expert_fail('name', 'required'); end if;
      v_nk := btrim(app_private.expert_norm(c->>'name_en') || ' ' || app_private.expert_norm(c->>'name_ar')); v_lk := app_private.expert_linkkey(c->>'linkedin_url');
      if v_nk = any (v_seen_names) or (v_lk <> '' and position('/' in v_lk) > 0 and v_lk = any (v_seen_links)) then v_in_file := true; end if;
      select jsonb_agg(jsonb_build_object('id', s.id, 'score', s.score, 'reasons', to_jsonb(s.reasons), 'name_en', ne.name_en, 'name_ar', ne.name_ar) order by s.score desc, ne.created_at)
        into v_matches
        from app_private.expert_find_similar(c->>'name_en', c->>'name_ar', c->>'email', c->>'linkedin_url', 'expert', null, 0.95, 3) s join public.network_experts ne on ne.id = s.id;
      v_status := case when v_matches is not null or v_in_file then 'duplicate' else 'new' end;
      v_name := coalesce(c->>'name_en', c->>'name_ar');
      v_seen_names := array_append(v_seen_names, v_nk); v_seen_links := array_append(v_seen_links, v_lk);
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
  return jsonb_build_object('dry_run', v_dry, 'counts', jsonb_build_object('new', n_new, 'duplicate', n_dup, 'invalid', n_inv, 'created', n_created), 'rows', v_out);
end $$;

-- ================================================================= the audit of merges (super_admin): the history of one record
create or replace function public.list_network_expert_merges(p_expert uuid default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'keep_id', m.keep_id, 'drop_id', m.drop_id, 'keep_name', m.keep_name, 'drop_name', m.drop_name, 'result', m.result, 'merged_at', m.merged_at) order by m.merged_at desc)
                     from (select * from app_private.network_expert_merges x where p_expert is null or x.keep_id = p_expert or x.drop_id = p_expert order by x.merged_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) m), '[]'::jsonb);
end $$;

-- ================================================================= grants
revoke all on function app_private.expert_clean(jsonb), app_private.expert_upsert_tag(text, text, uuid), app_private.expert_set_tags(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.create_network_expert(jsonb, boolean), public.update_network_expert(uuid, jsonb, timestamptz), public.set_network_expert_tags(uuid, jsonb),
  public.set_network_expert_archived(uuid, boolean), public.delete_network_expert(uuid), public.restore_network_expert(uuid),
  public.update_expert_tag(uuid, text, text, boolean), public.dismiss_expert_duplicate(uuid, uuid), public.merge_network_experts(uuid, uuid, boolean, jsonb),
  public.import_network_experts(jsonb, boolean, text), public.list_network_expert_merges(uuid, integer) from public, anon;
grant execute on function public.create_network_expert(jsonb, boolean), public.update_network_expert(uuid, jsonb, timestamptz), public.set_network_expert_tags(uuid, jsonb),
  public.set_network_expert_archived(uuid, boolean), public.delete_network_expert(uuid), public.restore_network_expert(uuid),
  public.update_expert_tag(uuid, text, text, boolean), public.dismiss_expert_duplicate(uuid, uuid), public.merge_network_experts(uuid, uuid, boolean, jsonb),
  public.import_network_experts(jsonb, boolean, text), public.list_network_expert_merges(uuid, integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('create_network_expert', 'update_network_expert', 'set_network_expert_tags', 'set_network_expert_archived', 'delete_network_expert', 'restore_network_expert',
                                'update_expert_tag', 'dismiss_expert_duplicate', 'merge_network_experts', 'import_network_experts', 'list_network_expert_merges')
              and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'm77: anon can execute a registry write function';
  end if;
  raise notice 'm77 ok';
end $$;

commit;
