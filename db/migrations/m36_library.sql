-- m36_library.sql  (Resource Library node, design 01 section 3.8 / 03 sections 6.2 + 11 / 04 sections 3.11 + 6)
-- Adds what the Resource Library node needs beyond m04/m06d/m07/m32. Re-runnable (idempotent DDL, create or replace).
-- Local DB only. No business data is altered by applying this file (the 26 migrated resources keep every value; the new
-- columns take their defaults: visibility 'public', no category, no cover, no description).
--
-- 1. resources: description_en/ar, visibility (public | participants | hidden), cover_path (public-assets image), category_id;
--    CHECKs: visibility, http(s) url only (no javascript: links), the file/cover path must live under the node's PROJECT folder
--    (a PM can never point a row at another project's private file), size <= the bucket limit. Index on file_path (the
--    storage policy looks files up by path).
-- 2. library_categories (the sections of a library, ar/en, ordered) with RLS + revision bump; resources.category_id is a
--    composite FK (node_id, category_id) ON DELETE SET NULL (category_id).
-- 3. save_children_library(node, children)  the ONE writer of the node's categories + resources (called by save_node under the
--    revision token): validation per row (token `library_invalid`), ids kept, removed resources are SOFT deleted (04: nothing
--    lost; storage files stay until the purge), a file must exist in the `resources` bucket under the project folder.
-- 4. library_payload(node, audience) + library_audience(node) + library_res_ok(audience, visibility): the ONE public payload and the
--    ONE visibility rule (hidden never leaves the DB, 'participants' resources only for participants/PMs).
-- 5. get_public_tab: the library branch now returns that payload (patched in place, so a parallel re-creation of the function
--    elsewhere keeps its other branches; see the self-check). The payload is filtered for the CALLER's standing (library_viewer): a
--    participant of a PUBLIC library also sees the participants-only resources (resolve_link says 'public' for a public node), get_public_library(ref) for the node's own page
--    (/view/:ref/library-tab, link kind 'view'), list_founder_libraries(project) for the founder Program page.
-- 6. Storage: SELECT policy on the PRIVATE `resources` bucket for anon + authenticated through public.library_file_readable(name):
--    a file (or the derived `_t` thumbnail of an image) is readable when its resource is not deleted and the CALLER may see it
--    (node public -> everybody sees `public` resources; node public/platform + participant -> also `participants`; PMs -> all).
--    Clients obtain SHORT-LIVED signed URLs through the Storage API (createSignedUrl): there is no public URL for the bucket.
--    The bucket also accepts docx / xlsx / pptx (the "docs" of the as-is library).
-- 7. REPAIR of m31's `form_uploads_insert_public` storage policy: it called a function whose EXECUTE had been revoked from anon/authenticated,
--    which made EVERY storage insert by an authenticated user fail (covers, photos, library files...); it now calls a public wrapper.
set search_path = public, extensions;

begin;

-- ================================================================= 1. resources columns + constraints
alter table public.resources add column if not exists description_en text;
alter table public.resources add column if not exists description_ar text;
alter table public.resources add column if not exists visibility text not null default 'public';
alter table public.resources add column if not exists cover_path text;
alter table public.resources add column if not exists category_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resources_visibility_chk' and conrelid = 'public.resources'::regclass) then
    alter table public.resources add constraint resources_visibility_chk check (visibility in ('public', 'participants', 'hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resources_url_chk' and conrelid = 'public.resources'::regclass) then
    alter table public.resources add constraint resources_url_chk check (url is null or (url ~* '^https?://' and char_length(url) <= 2000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resources_bytes_chk' and conrelid = 'public.resources'::regclass) then
    alter table public.resources add constraint resources_bytes_chk check (bytes is null or (bytes >= 0 and bytes <= 52428800));
  end if;
  -- the file and the cover of a project resource live under the project folder: <project_id>/...; central ones under global/
  if not exists (select 1 from pg_constraint where conname = 'resources_path_chk' and conrelid = 'public.resources'::regclass) then
    alter table public.resources add constraint resources_path_chk check (
      (file_path is null or (file_path !~ '\.\.' and char_length(file_path) <= 500
         and ((project_id is not null and file_path like project_id::text || '/%') or (project_id is null and file_path like 'global/%'))))
      and (cover_path is null or (cover_path !~ '\.\.' and char_length(cover_path) <= 500
         and ((project_id is not null and cover_path like project_id::text || '/%') or (project_id is null and cover_path like 'global/%')))));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resources_text_len_chk' and conrelid = 'public.resources'::regclass) then
    alter table public.resources add constraint resources_text_len_chk check (
      char_length(coalesce(title_en, '')) <= 300 and char_length(coalesce(title_ar, '')) <= 300
      and char_length(coalesce(description_en, '')) <= 2000 and char_length(coalesce(description_ar, '')) <= 2000);
  end if;
end $$;
create index if not exists resources_file_path_idx on public.resources (file_path) where file_path is not null;

-- ================================================================= 2. library_categories
create table if not exists public.library_categories (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  node_id     uuid not null,
  name_en     text,
  name_ar     text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint library_categories_node_fk foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  constraint library_categories_name_chk check ((name_en is not null or name_ar is not null) and char_length(coalesce(name_en, '')) <= 120 and char_length(coalesce(name_ar, '')) <= 120)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'library_categories_node_id_key' and conrelid = 'public.library_categories'::regclass) then
    alter table public.library_categories add constraint library_categories_node_id_key unique (node_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resources_category_fk' and conrelid = 'public.resources'::regclass) then
    alter table public.resources add constraint resources_category_fk foreign key (node_id, category_id)
      references public.library_categories (node_id, id) on delete set null (category_id);
  end if;
end $$;
create index if not exists library_categories_node_idx on public.library_categories (node_id, sort_order);
create index if not exists library_categories_project_idx on public.library_categories (project_id);
create index if not exists resources_category_idx on public.resources (category_id) where category_id is not null;

alter table public.library_categories enable row level security;
alter table public.library_categories force row level security;
drop policy if exists library_categories_select_pm on public.library_categories;
create policy library_categories_select_pm on public.library_categories for select to authenticated
  using ((select app_private.is_project_manager(project_id)));
revoke all on public.library_categories from public, anon, authenticated;
grant select on public.library_categories to authenticated;      -- writes only through save_children_library (validated)
drop trigger if exists library_categories_bu_project on public.library_categories;
create trigger library_categories_bu_project before update of project_id on public.library_categories for each row execute function app_private.forbid_project_change();
do $$
declare ev text; refclause text;
begin
  foreach ev in array array['insert','update','delete'] loop
    refclause := case ev when 'delete' then 'old table as changed' else 'new table as changed' end;
    execute format('drop trigger if exists %I on public.library_categories', 'library_categories_rev_' || left(ev, 3));
    execute format('create trigger %I after %s on public.library_categories referencing %s for each statement execute function app_private.bump_node_revs(%L)',
                   'library_categories_rev_' || left(ev, 3), ev, refclause, 'node_id');
  end loop;
end $$;

-- ================================================================= 3. visibility rules (helpers, no grants to the API roles)
-- the caller's audience for a library node, ignoring links: pm | participant | public | null
create or replace function app_private.library_audience(p_node uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when app_private.is_project_manager(n.project_id) then 'pm'
    when n.visibility in ('public', 'platform') and app_private.is_participant(n.project_id) then 'participant'
    when n.visibility = 'public' then 'public'
  end
  from public.nodes n join public.projects j on j.id = n.project_id and j.deleted_at is null
  where n.id = p_node and n.type = 'library' and n.deleted_at is null
$$;
revoke all on function app_private.library_audience(uuid) from public, anon, authenticated;

-- may an audience see a resource of this visibility? (hidden: PMs only)
create or replace function app_private.library_res_ok(p_audience text, p_visibility text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case p_audience
    when 'pm' then true
    when 'participant' then p_visibility in ('public', 'participants')
    when 'public' then p_visibility = 'public'
    else false end
$$;
revoke all on function app_private.library_res_ok(text, text) from public, anon, authenticated;

-- the audience a payload is filtered for: the caller's own standing on the node (a participant of a PUBLIC library still sees the
-- participants-only resources; resolve_link answers 'public' for a public node whoever asks), else the link's audience
create or replace function app_private.library_viewer(p_node uuid, p_link_audience text) returns text
language sql stable security definer set search_path = '' as $$ select coalesce(app_private.library_audience(p_node), p_link_audience) $$;
revoke all on function app_private.library_viewer(uuid, text) from public, anon, authenticated;

-- ================================================================= 4. the ONE public payload of a library node
create or replace function app_private.library_payload(p_node public.nodes, p_audience text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'config', jsonb_strip_nulls(jsonb_build_object(
        'layout',        case when p_node.config->>'layout' in ('grid', 'list') then p_node.config->>'layout' end,
        'groupBy',       case when p_node.config->>'groupBy' in ('auto', 'category', 'type', 'none') then p_node.config->>'groupBy' end,
        'searchEnabled', case when jsonb_typeof(p_node.config->'searchEnabled') = 'boolean' then p_node.config->'searchEnabled' end)),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name_en', k.name_en, 'name_ar', k.name_ar) order by k.sort_order, k.created_at, k.id)
      from public.library_categories k where k.node_id = p_node.id), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.id, 'category_id', x.category_id, 'title_en', x.title_en, 'title_ar', x.title_ar,
               'description_en', x.description_en, 'description_ar', x.description_ar, 'type', x.type,
               'url', x.url, 'file_path', x.file_path, 'has_file', x.file_path is not null, 'mime', x.mime, 'bytes', x.bytes,
               'cover_path', x.cover_path, 'sort_order', x.sort_order,
               'visibility', case when p_audience = 'pm' then x.visibility end)) order by x.sort_order nulls last, x.created_at, x.id)
      from (select rr.* from public.resources rr
             where rr.deleted_at is null
               and (rr.node_id = p_node.id
                    or rr.id in (select ls.resource_id from public.library_selections ls where ls.node_id = p_node.id))
               and app_private.library_res_ok(p_audience, rr.visibility)) x), '[]'::jsonb))
$$;
revoke all on function app_private.library_payload(public.nodes, text) from public, anon, authenticated;

-- ================================================================= 5. save_children_library (called by save_node)
-- children = { categories?: [ { id, name_en, name_ar, sort_order } ],
--              resources?:  [ { id, category_id, title_en, title_ar, description_en, description_ar, type, visibility, url,
--                               file_path, mime, bytes, cover_path, sort_order } ] }
-- A missing key leaves that part untouched. Ids are client uuids (so a new resource can name a new category); an id that
-- belongs to another node is refused. Removed resources are soft deleted, removed categories are deleted (resources lose the link).
create or replace function app_private.save_children_library(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid; v_uid uuid := (select auth.uid());
  c record; r record; v_old public.resources; v_n int;
  keep_cat uuid[] := '{}'; keep_res uuid[] := '{}'; v_cats uuid[];
  v_mimes text[] := array['application/pdf','audio/mpeg','audio/mp4','audio/wav','audio/ogg','image/png','image/jpeg','image/webp','video/mp4',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
begin
  select n.project_id into v_project from public.nodes n where n.id = p_node and n.type = 'library';
  if v_project is null then raise exception 'not a library node' using errcode = '22023'; end if;
  if p_children is null or jsonb_typeof(p_children) <> 'object' then raise exception 'children must be an object' using errcode = '22023'; end if;

  if p_children ? 'categories' then
    if jsonb_typeof(p_children->'categories') <> 'array' then raise exception 'categories must be an array' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_to_recordset(p_children->'categories') as x(id uuid) join public.library_categories k on k.id = x.id where k.node_id <> p_node) then
      raise exception 'a category id belongs to another node' using errcode = '42501';
    end if;
    v_n := 0;
    for c in select * from jsonb_to_recordset(p_children->'categories') as x(id uuid, name_en text, name_ar text, sort_order int) loop
      v_n := v_n + 1;
      if c.id is null then raise exception 'library_invalid: category %', v_n using errcode = '22023', hint = 'library_invalid', detail = 'category:' || v_n || ':id'; end if;
      if nullif(btrim(coalesce(c.name_en, '')), '') is null and nullif(btrim(coalesce(c.name_ar, '')), '') is null then
        raise exception 'library_invalid: category % name', v_n using errcode = '22023', hint = 'library_invalid', detail = 'category:' || c.id || ':name';
      end if;
      if char_length(coalesce(c.name_en, '')) > 120 or char_length(coalesce(c.name_ar, '')) > 120 then
        raise exception 'library_invalid: category % name too long', v_n using errcode = '22023', hint = 'library_invalid', detail = 'category:' || c.id || ':name_length';
      end if;
      insert into public.library_categories (id, project_id, node_id, name_en, name_ar, sort_order)
      values (c.id, v_project, p_node, nullif(btrim(coalesce(c.name_en, '')), ''), nullif(btrim(coalesce(c.name_ar, '')), ''), coalesce(c.sort_order, v_n))
      on conflict (id) do update set name_en = excluded.name_en, name_ar = excluded.name_ar, sort_order = excluded.sort_order;
      keep_cat := keep_cat || c.id;
    end loop;
    delete from public.library_categories k where k.node_id = p_node and k.id <> all (keep_cat);
  end if;
  select coalesce(array_agg(k.id), '{}') into v_cats from public.library_categories k where k.node_id = p_node;

  if p_children ? 'resources' then
    if jsonb_typeof(p_children->'resources') <> 'array' then raise exception 'resources must be an array' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_to_recordset(p_children->'resources') as x(id uuid) join public.resources z on z.id = x.id where z.node_id is distinct from p_node) then
      raise exception 'a resource id belongs to another node' using errcode = '42501';
    end if;
    v_n := 0;
    for r in select * from jsonb_to_recordset(p_children->'resources') as x(
               id uuid, category_id uuid, title_en text, title_ar text, description_en text, description_ar text, type text, visibility text,
               url text, file_path text, mime text, bytes bigint, cover_path text, sort_order int) loop
      v_n := v_n + 1;
      if r.id is null then raise exception 'library_invalid: resource %', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || v_n || ':id'; end if;
      if nullif(btrim(coalesce(r.title_en, '')), '') is null and nullif(btrim(coalesce(r.title_ar, '')), '') is null then
        raise exception 'library_invalid: resource % title', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':title';
      end if;
      if char_length(coalesce(r.title_en, '')) > 300 or char_length(coalesce(r.title_ar, '')) > 300 then
        raise exception 'library_invalid: resource % title too long', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':title_length';
      end if;
      if char_length(coalesce(r.description_en, '')) > 2000 or char_length(coalesce(r.description_ar, '')) > 2000 then
        raise exception 'library_invalid: resource % description too long', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':description_length';
      end if;
      if r.type is null or r.type not in ('readable', 'audible', 'visual', 'link') then
        raise exception 'library_invalid: resource % type', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':type';
      end if;
      if coalesce(r.visibility, 'public') not in ('public', 'participants', 'hidden') then
        raise exception 'library_invalid: resource % visibility', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':visibility';
      end if;
      if r.url is null and r.file_path is null then
        raise exception 'library_invalid: resource % needs a link or a file', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':source';
      end if;
      if r.url is not null and (r.url !~* '^https?://' or char_length(r.url) > 2000) then
        raise exception 'library_invalid: resource % url', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':url';
      end if;
      if r.category_id is not null and r.category_id <> all (v_cats) then
        raise exception 'library_invalid: resource % category', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':category';
      end if;
      if r.file_path is not null then
        if r.file_path ~ '\.\.' or r.file_path not like v_project::text || '/%' or char_length(r.file_path) > 500 then
          raise exception 'library_invalid: resource % file path', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':file_path';
        end if;
        if r.mime is null or r.mime <> all (v_mimes) then
          raise exception 'library_invalid: resource % file type', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':file_type';
        end if;
        if r.bytes is null or r.bytes < 0 or r.bytes > 52428800 then
          raise exception 'library_invalid: resource % file size', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':file_size';
        end if;
      end if;
      if r.cover_path is not null and (r.cover_path ~ '\.\.' or r.cover_path not like v_project::text || '/%' or char_length(r.cover_path) > 500) then
        raise exception 'library_invalid: resource % cover', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':cover';
      end if;
      select * into v_old from public.resources z where z.id = r.id;
      if r.file_path is not null and (v_old.id is null or v_old.file_path is distinct from r.file_path) then
        if not exists (select 1 from storage.objects o where o.bucket_id = 'resources' and o.name = r.file_path) then
          raise exception 'library_invalid: resource % file is not uploaded', v_n using errcode = '22023', hint = 'library_invalid', detail = 'resource:' || r.id || ':file_missing';
        end if;
      end if;
      insert into public.resources (id, project_id, node_id, category_id, title_en, title_ar, description_en, description_ar, type, visibility,
                                    url, file_path, mime, bytes, cover_path, sort_order, created_by)
      values (r.id, v_project, p_node, r.category_id, nullif(btrim(coalesce(r.title_en, '')), ''), nullif(btrim(coalesce(r.title_ar, '')), ''),
              nullif(btrim(coalesce(r.description_en, '')), ''), nullif(btrim(coalesce(r.description_ar, '')), ''), r.type, coalesce(r.visibility, 'public'),
              r.url, r.file_path, case when r.file_path is not null then r.mime end, case when r.file_path is not null then r.bytes::int end,
              r.cover_path, coalesce(r.sort_order, v_n), v_uid)
      on conflict (id) do update set category_id = excluded.category_id, title_en = excluded.title_en, title_ar = excluded.title_ar,
        description_en = excluded.description_en, description_ar = excluded.description_ar, type = excluded.type, visibility = excluded.visibility,
        url = excluded.url, file_path = excluded.file_path, mime = excluded.mime, bytes = excluded.bytes, cover_path = excluded.cover_path,
        sort_order = excluded.sort_order, deleted_at = null;
      keep_res := keep_res || r.id;
    end loop;
    update public.resources z set deleted_at = now() where z.node_id = p_node and z.deleted_at is null and z.id <> all (keep_res);
  end if;
end $$;
revoke all on function app_private.save_children_library(uuid, jsonb) from public, anon, authenticated;

update public.node_types set save_children_fn = 'save_children_library'
 where key = 'library' and save_children_fn is distinct from 'save_children_library';

-- ================================================================= 6. get_public_tab: the library branch (patched in place)
do $$
declare v_def text; v_old text; v_new text;
  c_new constant text := 'v := app_private.library_payload(s, app_private.library_viewer(s.id, l.audience));';
begin
  select pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure) into v_def;
  if v_def like '%app_private.library_viewer(s.id, l.audience)%' then return; end if;            -- already patched
  if v_def like '%v := app_private.library_payload(s, l.audience);%' then                           -- patched by the first m36 text
    v_new := replace(v_def, 'v := app_private.library_payload(s, l.audience);', c_new);
  else
    v_old := substring(v_def from $re$(elsif s\.type = 'library' then.*?)(?=\s+elsif s\.type = 'landing_page')$re$);
    if v_old is null then raise exception 'm36: the library branch of get_public_tab was not found (patch it by hand: %)', c_new; end if;
    v_new := replace(v_def, v_old, 'elsif s.type = ''library'' then' || chr(10) || '    ' || c_new);
  end if;
  execute v_new;
end $$;
grant execute on function public.get_public_tab(text, uuid, jsonb) to anon, authenticated;

-- ================================================================= 7. get_public_library: the node's own public page
create or replace function public.get_public_library(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; s public.nodes; v_rev bigint; v_aud text;
begin
  select * into l from app_private.resolve_link('view', p_ref) r where r.view_key = 'library-tab' limit 1;
  if not found or l.node_id is null then return null; end if;
  select * into s from public.nodes n where n.id = l.node_id and n.type = 'library' and n.deleted_at is null;
  if not found then return null; end if;
  select rev into v_rev from public.node_revisions where node_id = s.id;
  v_aud := app_private.library_viewer(s.id, l.audience);
  return jsonb_build_object('type', s.type, 'node_id', s.id, 'revision', v_rev, 'viewer', v_aud, 'slug', l.slug,
           'title_en', s.name_en, 'title_ar', s.name_ar, 'data', app_private.library_payload(s, v_aud));
end $$;
revoke all on function public.get_public_library(text) from public, anon, authenticated;
grant execute on function public.get_public_library(text) to anon, authenticated;

-- ================================================================= 8. founder exposure: the libraries a participant may open
-- [{ node_id, name_en, name_ar, ref, via }]: show_to_participants AND visibility platform/public; `ref` = the current slug of the node's
-- own page link (kind 'view', key 'library-tab', via 'node'), else the project page link when the library is an enabled tab of the
-- implicit host (via 'host'), else null. Participants of the project and its PMs only; anon never.
create or replace function public.list_founder_libraries(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_host uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (app_private.is_project_manager(p_project) or app_private.is_participant(p_project)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select n.id into v_host from public.nodes n where n.project_id = p_project and n.type = 'view_host' and n.deleted_at is null order by n.created_at limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'node_id', a.id, 'name_en', a.name_en, 'name_ar', a.name_ar,
             'ref', coalesce(own.slug, host.slug),
             'via', case when own.slug is not null then 'node' when host.slug is not null then 'host' end,
             'count', (select count(*) from public.resources r where r.node_id = a.id and r.deleted_at is null and r.visibility <> 'hidden'))
           order by a.created_at, a.id)
    from public.nodes a
    left join lateral (
      select s.slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current
       where l.node_id = a.id and l.kind = 'view' and l.view_key = 'library-tab' and l.is_enabled and (l.expires_at is null or l.expires_at > now())
       limit 1) own on true
    left join lateral (
      select s.slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current
       where l.project_id = p_project and l.is_enabled and (l.expires_at is null or l.expires_at > now())
         and ((l.node_id = v_host and l.kind = 'agenda') or (l.node_id is null and l.kind = 'project'))
         and exists (select 1 from public.edges e where e.from_node_id = a.id and e.from_port = 'library-tab' and e.to_node_id = v_host and e.to_port = 'tabs' and e.is_enabled)
       order by (l.node_id is not null) desc limit 1) host on true
    where a.project_id = p_project and a.type = 'library' and a.deleted_at is null
      and a.show_to_participants and a.visibility in ('platform', 'public')), '[]'::jsonb);
end $$;
revoke all on function public.list_founder_libraries(uuid) from public, anon, authenticated;
grant execute on function public.list_founder_libraries(uuid) to authenticated;

-- ================================================================= 9. storage: the private `resources` bucket
-- anon has no USAGE on app_private, so the policy calls a public SECURITY DEFINER function (it answers only "is this object
-- readable by the caller", the same rule the payload applies). A signed URL is minted by the Storage API after this check.
create or replace function public.library_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.resources r
    left join public.library_selections ls on ls.resource_id = r.id and r.node_id is null
    cross join lateral (select coalesce(r.node_id, ls.node_id) as nid) t
    where r.deleted_at is null and t.nid is not null and r.file_path is not null
      and r.file_path = any (array[p_name, regexp_replace(p_name, '_t(\.[A-Za-z0-9]+)$', '\1')])
      and (r.file_path = p_name or r.mime like 'image/%')            -- the derived thumbnail exists for images only
      and app_private.library_res_ok(app_private.library_audience(t.nid), r.visibility))
$$;
revoke all on function public.library_file_readable(text) from public, anon, authenticated;
grant execute on function public.library_file_readable(text) to anon, authenticated;

drop policy if exists resources_select_visitor on storage.objects;
create policy resources_select_visitor on storage.objects for select to anon, authenticated
  using (bucket_id = 'resources' and (select public.library_file_readable(name)));

update storage.buckets set allowed_mime_types = array['application/pdf','audio/mpeg','audio/mp4','audio/wav','audio/ogg','image/png','image/jpeg','image/webp','video/mp4',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation']
 where id = 'resources';

-- ================================================================= 10. REPAIR of m31's upload policy (found while building the library uploads)
-- m31 created `form_uploads_insert_public` (INSERT for anon + authenticated on storage.objects) calling
-- app_private.form_upload_allowed(name), and REVOKED execute on that function from anon/authenticated. Postgres checks the EXECUTE
-- privilege of every function in an RLS expression when the statement starts, whatever branch is evaluated, so EVERY insert into
-- storage.objects by an authenticated user (program/project covers, list photos, landing images, library files, ...) failed with
-- "permission denied for function form_upload_allowed" (on this local image the error path even segfaults the server), and anon
-- has no USAGE on app_private at all, so the public form upload could never pass either. Same remedy as the library read policy:
-- the policy calls a thin PUBLIC wrapper (SECURITY DEFINER, EXECUTE for anon + authenticated); the rule itself is unchanged.
create or replace function public.form_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$ select app_private.form_upload_allowed(p_name) $$;
revoke all on function public.form_upload_allowed(text) from public, anon, authenticated;
grant execute on function public.form_upload_allowed(text) to anon, authenticated;
drop policy if exists form_uploads_insert_public on storage.objects;
create policy form_uploads_insert_public on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'form-uploads' and (select public.form_upload_allowed(name)));

-- ================================================================= self-check
do $$
begin
  if not has_function_privilege('anon', 'public.form_upload_allowed(text)', 'EXECUTE') or not has_function_privilege('authenticated', 'public.form_upload_allowed(text)', 'EXECUTE') then
    raise exception 'm36: the form upload policy wrapper must be executable by anon and authenticated';
  end if;
  if to_regprocedure('app_private.save_children_library(uuid,jsonb)') is null or to_regprocedure('app_private.library_payload(public.nodes,text)') is null
     or to_regprocedure('public.get_public_library(text)') is null or to_regprocedure('public.list_founder_libraries(uuid)') is null
     or to_regprocedure('public.library_file_readable(text)') is null or to_regclass('public.library_categories') is null then
    raise exception 'm36: an object is missing';
  end if;
  if (select save_children_fn from public.node_types where key = 'library') is distinct from 'save_children_library' then raise exception 'm36: node_types.library.save_children_fn'; end if;
  if pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure) not like '%app_private.library_viewer(s.id, l.audience)%' then
    raise exception 'm36: get_public_tab lost the library branch (it must call app_private.library_payload(s, app_private.library_viewer(s.id, l.audience)))';
  end if;
  if has_function_privilege('anon', 'public.list_founder_libraries(uuid)', 'EXECUTE') or has_function_privilege('anon', 'app_private.library_payload(public.nodes,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.save_children_library(uuid,jsonb)', 'EXECUTE') then
    raise exception 'm36: a PM/helper function is executable by an API role';
  end if;
  if not has_function_privilege('anon', 'public.get_public_library(text)', 'EXECUTE') or not has_function_privilege('anon', 'public.library_file_readable(text)', 'EXECUTE') then
    raise exception 'm36: anon must execute get_public_library and library_file_readable';
  end if;
  if has_table_privilege('anon', 'public.library_categories', 'SELECT') or has_table_privilege('authenticated', 'public.library_categories', 'INSERT') then
    raise exception 'm36: library_categories grants are too wide';
  end if;
  if app_private.library_res_ok('public', 'participants') or not app_private.library_res_ok('participant', 'participants') or app_private.library_res_ok('participant', 'hidden')
     or not app_private.library_res_ok('pm', 'hidden') or app_private.library_res_ok(null, 'public') then
    raise exception 'm36: library_res_ok rule is wrong';
  end if;
end $$;

commit;
