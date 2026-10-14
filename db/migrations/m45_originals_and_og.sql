-- m45_originals_and_og.sql  (owner decisions 18.4 + 18.6 of docs/design/08-decisions-log.md; builds on m41 UNIVERSAL WEBP)
-- LOCAL stack only. Re-runnable (drops and re-creates its own policies, replaces its own functions, upserts the bucket).
--
--   A. OLD RASTER ORIGINALS ("convert all of them to WebP and delete the old originals", 18.4)
--      1. `app_private.image_conversions`: the audit row of every raster -> WebP conversion (original path / bytes / sha256, the WebP
--         sibling, the thumbnail, when it was planned / converted / deleted). It is what makes the two-step flow of
--         db/scripts/convert-images.mjs safe (`--apply` converts and rewrites references, `--delete-originals` removes only originals that have a
--         verified WebP sibling, no remaining reference and an unchanged sha256) and what v45 audits afterwards.
--      2. The two RESTRICTIVE policies of m41 (`webp_only_insert` / `webp_only_update`) now cover EVERY bucket (a raster NAME or a recorded raster
--         mimetype is refused for anon + authenticated everywhere), except `og-images` (below), which holds JPEG by design.
--         `app_private.nonwebp_image_objects` follows: every raster object of every bucket except `og-images`.
--      3. `app_private.rewrite_storage_refs` also rewrites `migration.asset_result.archive_path` (the one bucket-relative path outside `public`:
--         the migration-archive originals); `app_private.storage_dangling_refs()` also proves that column resolves. The provenance strings of the
--         old project (`migration.asset_map.old_path`, `legacy.*` URLs of the LIVE project) are NOT storage references and are never rewritten.
--   B. OG JPEG DERIVATIVE ("link-preview crawlers may not render a WebP og:image", 18.6)
--      4. New PUBLIC bucket `og-images` (image/jpeg only, 1 MiB). The browser pipeline (web/src/lib/image, data/storage.js) writes a 1200 x 630
--         JPEG (cover crop, quality ~82, progressive, <= 300 KB) next to every image uploaded with a SHARING purpose, at the DETERMINISTIC path
--         derived from the source path: `public-assets/<owner>/<kind>/<uuid>.webp`  ->  `og-images/<owner>/<kind>/<uuid>.jpg`. No DB column.
--         Policies follow the public-assets rules (03 section 8): world-readable; insert / update / delete only for a manager of the owner folder
--         (project or program id) or super_admin under `global/`, and ONLY under the pipeline's path convention `<owner>/<kind>/<uuid>.jpg`.
--      5. Helpers: `app_private.og_image_path(source)` (+ a service-role-only `public.og_image_path` wrapper), `app_private.og_source_refs()` (the ONE
--         definition of which stored references are "shared"), `app_private.og_missing_refs()` (shared images that have no derivative yet = what the
--         backfill db/scripts/backfill-og-images.mjs works through; empty = complete) and `app_private.og_orphans` (derivatives whose source is gone).
-- Existing data is NOT changed here (the scripts do that, on request).
begin;

-- ================================================================= 1. conversion audit
create table if not exists app_private.image_conversions (
  id bigint generated always as identity primary key,
  bucket text not null,
  original_path text not null,
  original_bytes bigint,
  original_sha256 text,
  webp_path text not null,
  webp_bytes bigint,
  thumb_path text,
  width integer,
  height integer,
  planned_at timestamptz not null default now(),   -- the row is written BEFORE the upload (an interrupted run re-uses the planned name)
  converted_at timestamptz,                        -- set once the WebP (+ thumbnail) is stored and every reference rewritten
  deleted_at timestamptz,                          -- set once the original was removed through the Storage API
  note text,
  constraint image_conversions_original_key unique (bucket, original_path)
);
alter table app_private.image_conversions enable row level security;
alter table app_private.image_conversions force row level security;
revoke all on app_private.image_conversions from public, anon, authenticated;
comment on table app_private.image_conversions is 'm45: one row per raster original converted to WebP by db/scripts/convert-images.mjs (the --delete-originals step reads it; v45 audits it). No API role can read it.';

-- ================================================================= 2. the og-images bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('og-images', 'og-images', true, 1048576, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ~ '^og_images_' loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- world-readable (the bucket is public: crawlers fetch /storage/v1/object/public/og-images/<path>)
create policy og_images_select_all on storage.objects for select to anon, authenticated
  using (bucket_id = 'og-images');
-- writes: the pipeline's path convention `<owner>/<kind>/<uuid>.jpg` only, by a manager of the owner folder (project or program id) or super_admin under global/
create policy og_images_insert_pm on storage.objects for insert to authenticated
  with check (bucket_id = 'og-images'
    and name ~* '^(global|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[a-z0-9-]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));
create policy og_images_update_pm on storage.objects for update to authenticated
  using (bucket_id = 'og-images'
    and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))))
  with check (bucket_id = 'og-images'
    and name ~* '^(global|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[a-z0-9-]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));
create policy og_images_delete_pm on storage.objects for delete to authenticated
  using (bucket_id = 'og-images'
    and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));

-- ================================================================= 3. WebP-only everywhere, except og-images (a JPEG belongs there and only there)
-- Plain operators only (an RLS expression that calls a function needs EXECUTE for the calling role: the m36 lesson).
drop policy if exists webp_only_insert on storage.objects;
create policy webp_only_insert on storage.objects as restrictive for insert to anon, authenticated
  with check (
    bucket_id = 'og-images'
    or (
      name !~* '\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$'
      and coalesce(metadata ->> 'mimetype', '') !~* '^image/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)'
    )
  );
drop policy if exists webp_only_update on storage.objects;
create policy webp_only_update on storage.objects as restrictive for update to anon, authenticated
  with check (
    bucket_id = 'og-images'
    or (
      name !~* '\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$'
      and coalesce(metadata ->> 'mimetype', '') !~* '^image/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)'
    )
  );

create or replace view app_private.nonwebp_image_objects as
select o.bucket_id, o.name, o.metadata ->> 'mimetype' as mimetype, (o.metadata ->> 'size')::bigint as bytes, o.created_at
from storage.objects o
where o.bucket_id <> 'og-images'
  and (o.name ~* '\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$'
       or coalesce(o.metadata ->> 'mimetype', '') ~* '^image/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)');
revoke all on app_private.nonwebp_image_objects from public, anon, authenticated;

-- ================================================================= 4. dangling references: + migration.asset_result.archive_path
create or replace function app_private.storage_dangling_refs() returns table (source text, value text, problem text)
language plpgsql stable set search_path = '' as $$
declare
  r record;
  cols constant text[][] := array[
    -- [table, column, has_thumbnail]
    ['companies', 'logo_path', 'y'], ['network_experts', 'photo_path', 'y'], ['founders', 'photo_path', 'y'], ['profiles', 'avatar_path', 'y'],
    ['programs', 'cover_path', 'y'], ['projects', 'cover_path', 'y'], ['public_links', 'og_image_path', 'y'], ['form_covers', 'image_path', 'y'],
    ['landing_cards', 'cover_path', 'y'], ['resources', 'cover_path', 'y'],
    ['landing_frames', 'image_path', 'n'], ['resources', 'file_path', 'n'], ['certificate_templates', 'file_path', 'n']
  ];
  i int;
begin
  for i in 1 .. array_length(cols, 1) loop
    continue when to_regclass('public.' || quote_ident(cols[i][1])) is null;
    return query execute format(
      'select %L, x.%I::text, ''missing_file'' from public.%I x where x.%I is not null and x.%I <> '''' and not exists (select 1 from storage.objects o where o.name = x.%I)',
      cols[i][1] || '.' || cols[i][2], cols[i][2], cols[i][1], cols[i][2], cols[i][2], cols[i][2]);
    if cols[i][3] = 'y' then
      return query execute format(
        'select %L, x.%I::text, ''missing_thumb'' from public.%I x where x.%I like ''%%.webp'' and x.%I not like ''%%\_t.webp'' and exists (select 1 from storage.objects o where o.name = x.%I) and not exists (select 1 from storage.objects t where t.name = regexp_replace(x.%I, ''\.webp$'', ''_t.webp''))',
        cols[i][1] || '.' || cols[i][2], cols[i][2], cols[i][1], cols[i][2], cols[i][2], cols[i][2], cols[i][2]);
    end if;
  end loop;
  -- jsonb columns: any string that looks like a storage path must exist
  for r in
    select c.table_name as t, c.column_name as col
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'jsonb'
  loop
    return query execute format(
      $q$select %L, v #>> '{}', 'missing_file'
         from public.%I x, lateral jsonb_path_query(x.%I, 'strict $.**') v
         where jsonb_typeof(v) = 'string'
           and (v #>> '{}') ~* '^(global|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[^ ]+\.(webp|svg|png|jpe?g|gif|pdf|docx|xlsx|pptx|txt|mp3|m4a|wav|ogg|mp4)$'
           and not exists (select 1 from storage.objects o where o.name = v #>> '{}')$q$,
      r.t || '.' || r.col || ' (jsonb)', r.t, r.col);
  end loop;
  -- m45: the bucket-relative path of a migration-archive original (the one storage path outside `public`)
  if to_regclass('migration.asset_result') is not null then
    return query
      select 'migration.asset_result.archive_path'::text, a.archive_path::text, 'missing_file'::text
      from migration.asset_result a
      where a.archive_path is not null and a.archive_path <> '' and not exists (select 1 from storage.objects o where o.name = a.archive_path);
  end if;
end $$;
revoke all on function app_private.storage_dangling_refs() from public, anon, authenticated;

-- ================================================================= 5. rewrite every reference of a stored file: + migration.asset_result.archive_path
create or replace function app_private.rewrite_storage_refs(p_old text, p_new text) returns jsonb
language plpgsql set search_path = '' as $$
declare r record; n bigint; res jsonb := '{}'::jsonb;
begin
  if coalesce(p_old, '') = '' or coalesce(p_new, '') = '' or p_old = p_new then
    raise exception 'rewrite_storage_refs: the old and the new path are required and must differ' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.name = p_new) then
    raise exception 'rewrite_storage_refs: the new object does not exist' using errcode = '22023';
  end if;
  for r in
    select c.table_name as t, c.column_name as col, c.data_type as dt
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY') and c.is_generated = 'NEVER'
  loop
    if r.dt = 'ARRAY' then
      execute format('select count(*) from public.%I where strpos(%I::text, $1) > 0', r.t, r.col) into n using p_old;
      if n > 0 then raise exception 'rewrite_storage_refs: %.% holds the path inside an array column', r.t, r.col using errcode = '0A000'; end if;
      continue;
    end if;
    execute case r.dt
      when 'jsonb' then format('update public.%I set %I = replace(%I::text, $1, $2)::jsonb where strpos(%I::text, $1) > 0', r.t, r.col, r.col, r.col)
      when 'json' then format('update public.%I set %I = replace(%I::text, $1, $2)::json where strpos(%I::text, $1) > 0', r.t, r.col, r.col, r.col)
      else format('update public.%I set %I = replace(%I, $1, $2) where strpos(%I, $1) > 0', r.t, r.col, r.col, r.col)
    end using p_old, p_new;
    get diagnostics n = row_count;
    if n > 0 then res := res || jsonb_build_object(r.t || '.' || r.col, n); end if;
  end loop;
  -- m45: an EXACT match on the one storage path that lives outside `public` (never the URL strings of the old project, which are provenance)
  if to_regclass('migration.asset_result') is not null then
    update migration.asset_result set archive_path = p_new where archive_path = p_old;
    get diagnostics n = row_count;
    if n > 0 then res := res || jsonb_build_object('migration.asset_result.archive_path', n); end if;
  end if;
  return res;
end $$;
revoke all on function app_private.rewrite_storage_refs(text, text) from public, anon, authenticated;
grant execute on function app_private.rewrite_storage_refs(text, text) to service_role;

-- ================================================================= 6. og helpers
-- The deterministic derivative path: `<owner>/<kind>/<uuid>.webp` -> `<owner>/<kind>/<uuid>.jpg` in bucket `og-images`. NULL for anything that has no
-- derivative (a `_t.webp` thumbnail, an SVG, a legacy raster, NULL). The browser (web/src/lib/image/paths.js ogPathOf) and db/scripts/lib/plan.mjs compute the same.
create or replace function app_private.og_image_path(p_source text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p_source ~* '\.webp$' and p_source !~* '_t\.webp$' then regexp_replace(p_source, '\.webp$', '.jpg', 'i') end
$$;
revoke all on function app_private.og_image_path(text) from public, anon, authenticated;
grant execute on function app_private.og_image_path(text) to service_role;

-- a thin wrapper for the (future) share / OG edge function, which calls with the service key; the URL is
-- <SUPABASE_URL>/storage/v1/object/public/og-images/<og_image_path(source)>. Executable by the service role ONLY.
create or replace function public.og_image_path(p_source text) returns text
language sql immutable security definer set search_path = '' as $$ select app_private.og_image_path(p_source) $$;
revoke all on function public.og_image_path(text) from public, anon, authenticated;
grant execute on function public.og_image_path(text) to service_role;

-- THE definition of "a stored image reference that is SHARED" (a link preview may show it): program / project covers (the agenda page and the project
-- page share the project cover), a public link's own preview image, the form cover library, landing card covers, and the config keys of the
-- landing page (`seo.imagePath`, `hero.coverPath`) and the form (`share.image_path`). Landing FRAMES, library covers, logos and photos are not shared.
create or replace function app_private.og_source_refs() returns table (source text, path text)
language sql stable set search_path = '' as $$
  select s.source, s.path from (
    select 'programs.cover_path'::text as source, cover_path as path from public.programs
    union all select 'projects.cover_path', cover_path from public.projects
    union all select 'public_links.og_image_path', og_image_path from public.public_links
    union all select 'form_covers.image_path', image_path from public.form_covers
    union all select 'landing_cards.cover_path', cover_path from public.landing_cards
    union all select 'nodes.config.seo.imagePath', config #>> '{seo,imagePath}' from public.nodes where type = 'landing_page'
    union all select 'nodes.config.hero.coverPath', config #>> '{hero,coverPath}' from public.nodes where type = 'landing_page'
    union all select 'nodes.config.share.image_path', config #>> '{share,image_path}' from public.nodes where type = 'form_builder'
  ) s
  where s.path is not null and s.path <> ''
$$;
revoke all on function app_private.og_source_refs() from public, anon, authenticated;

-- shared images that exist but have no JPEG derivative yet (the backfill's work list; empty = complete)
create or replace function app_private.og_missing_refs() returns table (source text, value text, problem text)
language sql stable set search_path = '' as $$
  select r.source, r.path, 'missing_og'::text
  from app_private.og_source_refs() r
  where app_private.og_image_path(r.path) is not null
    and exists (select 1 from storage.objects o where o.bucket_id = 'public-assets' and o.name = r.path)
    and not exists (select 1 from storage.objects g where g.bucket_id = 'og-images' and g.name = app_private.og_image_path(r.path))
$$;
revoke all on function app_private.og_missing_refs() from public, anon, authenticated;

-- derivatives whose source image no longer exists (a replaced cover whose best-effort cleanup failed): housekeeping, never an error
create or replace view app_private.og_orphans as
select g.name, (g.metadata ->> 'size')::bigint as bytes, g.created_at
from storage.objects g
where g.bucket_id = 'og-images'
  and not exists (select 1 from storage.objects s where s.bucket_id = 'public-assets' and s.name = regexp_replace(g.name, '\.jpg$', '.webp', 'i'));
revoke all on app_private.og_orphans from public, anon, authenticated;

-- ================================================================= self-check
do $$
declare v_mime text[]; v_pub boolean;
begin
  select allowed_mime_types, public into v_mime, v_pub from storage.buckets where id = 'og-images';
  if v_mime is distinct from array['image/jpeg'] or v_pub is not true then raise exception 'm45: og-images bucket is wrong (% / public %)', v_mime, v_pub; end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ~ '^og_images_') <> 4 then raise exception 'm45: og-images policies'; end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('webp_only_insert', 'webp_only_update') and permissive = 'RESTRICTIVE') <> 2 then
    raise exception 'm45: the restrictive WebP policies are missing';
  end if;
  if app_private.og_image_path('a/b/c.webp') is distinct from 'a/b/c.jpg' or app_private.og_image_path('a/b/c_t.webp') is not null or app_private.og_image_path('a/b/c.png') is not null then
    raise exception 'm45: og_image_path';
  end if;
  if has_function_privilege('anon', 'public.og_image_path(text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.og_image_path(text)', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.og_missing_refs()', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.og_missing_refs()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.og_image_path(text)', 'EXECUTE') then
    raise exception 'm45: og helper privileges are wrong';
  end if;
  if has_table_privilege('anon', 'app_private.image_conversions', 'SELECT') or has_table_privilege('authenticated', 'app_private.image_conversions', 'SELECT') then
    raise exception 'm45: image_conversions must not be readable by API roles';
  end if;
  raise notice 'm45 ok';
end $$;

commit;
