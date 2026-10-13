-- m41_webp.sql  (owner decision 08 section 17.3: UNIVERSAL WEBP, server side)
-- LOCAL stack only. Re-runnable (drops and re-creates its own policies/functions, sets the same bucket lists every time).
--
-- The browser converts every picked image to WebP before it uploads (web/src/lib/image, data/storage.js). This migration makes the
-- SERVER say the same thing, so a client that skips the pipeline (a script, a stale tab, another app) cannot store a raster that is not
-- WebP in an image bucket:
--   1. bucket `allowed_mime_types` (enforced by the Storage API: HTTP 415 invalid_mime_type):
--        public-assets   image/webp, image/svg+xml   (SVG = logos only: the browser pipeline keeps a vector as it is, nothing else)
--        founder-assets  image/webp
--        resources       the existing list MINUS image/png and image/jpeg (PDF / Office / audio / video unchanged)
--        form-uploads    the existing list MINUS image/png, image/jpeg and image/gif (respondent documents unchanged)
--      NOT touched: certificate-templates (still png/jpeg/pdf: its call site is converted by the Certificates builder, who then runs
--      the one statement documented at the end of this file), event-assets and migration-archive (frozen archives, no client writes).
--   2. two RESTRICTIVE policies on storage.objects (INSERT and UPDATE, anon + authenticated; the service role bypasses RLS) that refuse a
--      png/jpeg/gif/bmp/tiff/heic/avif OBJECT NAME or a recorded raster mimetype in the four buckets above, whatever the permissive
--      policies say. This is the second layer: the bucket list trusts the Content-Type header of the request, the policy also looks at the
--      name the object is stored under and at the mimetype Storage recorded. (Neither can look INSIDE the bytes: that is what the
--      server-side converter, db/scripts/convert-images.mjs and the image-convert edge function, is for.)
--      The policies use plain operators only: an RLS expression that calls a function needs EXECUTE for the calling role (the m36 lesson).
--   3. `app_private.nonwebp_image_objects` (what the converter reports), `app_private.storage_dangling_refs()` (the proof that no DB reference
--      points at a missing file or thumbnail; empty = clean) and `app_private.rewrite_storage_refs(old, new)` (+ a service-role-only public wrapper):
--      the one place that knows every column that stores a path, used by db/scripts/convert-images.mjs and the image-convert edge function.
-- Existing data is NOT changed here (the converter does that, on request).
begin;

-- ================================================================= 1. bucket mime lists
update storage.buckets set allowed_mime_types = array['image/webp', 'image/svg+xml'] where id = 'public-assets';
update storage.buckets set allowed_mime_types = array['image/webp'] where id = 'founder-assets';
update storage.buckets
   set allowed_mime_types = array(select m from unnest(allowed_mime_types) as m where m not in ('image/png', 'image/jpeg', 'image/jpg', 'image/gif'))
 where id in ('resources', 'form-uploads') and allowed_mime_types is not null;
-- the stored WebP of a cover / photo / frame is far below these, the limits stay (public-assets 5 MB, founder-assets 2 MB)

-- ================================================================= 2. restrictive policies (second layer)
drop policy if exists webp_only_insert on storage.objects;
create policy webp_only_insert on storage.objects as restrictive for insert to anon, authenticated
  with check (
    bucket_id not in ('public-assets', 'founder-assets', 'resources', 'form-uploads')
    or (
      name !~* '\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$'
      and coalesce(metadata ->> 'mimetype', '') !~* '^image/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)'
    )
  );

drop policy if exists webp_only_update on storage.objects;
create policy webp_only_update on storage.objects as restrictive for update to anon, authenticated
  with check (
    bucket_id not in ('public-assets', 'founder-assets', 'resources', 'form-uploads')
    or (
      name !~* '\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$'
      and coalesce(metadata ->> 'mimetype', '') !~* '^image/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)'
    )
  );

-- ================================================================= 3a. what is still a raster that is not WebP (any bucket)
create or replace view app_private.nonwebp_image_objects as
select o.bucket_id, o.name, o.metadata ->> 'mimetype' as mimetype, (o.metadata ->> 'size')::bigint as bytes, o.created_at
from storage.objects o
where o.name ~* '\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$'
   or coalesce(o.metadata ->> 'mimetype', '') ~* '^image/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)';
revoke all on app_private.nonwebp_image_objects from public, anon, authenticated;

-- ================================================================= 3b. dangling references (proof query)
-- Every place the schema stores a storage path: the *_path columns below and every string inside any jsonb column of `public` that looks like a
-- path (`<uuid>/...` or `global/...` ending in a file extension). A value with no storage.objects row is returned as 'missing_file'; a stored
-- full image of a thumbnail-carrying column whose `_t` file is absent as 'missing_thumb'. Empty result = every reference resolves.
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
end $$;
revoke all on function app_private.storage_dangling_refs() from public, anon, authenticated;

-- ================================================================= 3c. rewrite every reference of a stored file (used by the converter script and the image-convert edge function)
-- Replaces the path `p_old` by `p_new` in EVERY text / varchar / json / jsonb column of schema public (a substring replace: the paths are long
-- unique strings, so this also fixes a path embedded in a public URL or a jsonb document), in the caller's transaction. The new object must
-- already exist (data never points at a missing file). Returns { "<table>.<column>": rows } for what changed. A match inside an array column
-- raises (nothing in the schema stores paths in arrays today; if that ever changes, the converter must learn it).
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
  return res;
end $$;
revoke all on function app_private.rewrite_storage_refs(text, text) from public, anon, authenticated;
grant execute on function app_private.rewrite_storage_refs(text, text) to service_role;

-- the edge function calls it through PostgREST with the service key: a thin public wrapper that ONLY the service role can execute
create or replace function public.rewrite_storage_refs(p_old text, p_new text) returns jsonb
language sql security definer set search_path = '' as $$ select app_private.rewrite_storage_refs(p_old, p_new) $$;
revoke all on function public.rewrite_storage_refs(text, text) from public, anon, authenticated;
grant execute on function public.rewrite_storage_refs(text, text) to service_role;

-- ================================================================= self-check
do $$
declare v_pub text[]; v_res text[]; v_form text[];
begin
  select allowed_mime_types into v_pub from storage.buckets where id = 'public-assets';
  if v_pub is distinct from array['image/webp', 'image/svg+xml'] then raise exception 'm41: public-assets mime list is %', v_pub; end if;
  if (select allowed_mime_types from storage.buckets where id = 'founder-assets') is distinct from array['image/webp'] then raise exception 'm41: founder-assets mime list'; end if;
  select allowed_mime_types into v_res from storage.buckets where id = 'resources';
  select allowed_mime_types into v_form from storage.buckets where id = 'form-uploads';
  if v_res && array['image/png', 'image/jpeg', 'image/gif'] or v_form && array['image/png', 'image/jpeg', 'image/gif'] then raise exception 'm41: a mixed bucket still lists a raster type'; end if;
  if not (v_res @> array['application/pdf', 'image/webp']) or not (v_form @> array['application/pdf', 'image/webp', 'text/plain']) then raise exception 'm41: a mixed bucket lost a non-raster type'; end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('webp_only_insert', 'webp_only_update') and permissive = 'RESTRICTIVE') <> 2 then
    raise exception 'm41: the restrictive policies are missing';
  end if;
  if to_regclass('app_private.nonwebp_image_objects') is null or to_regprocedure('app_private.storage_dangling_refs()') is null then raise exception 'm41: an object is missing'; end if;
  if has_function_privilege('anon', 'app_private.storage_dangling_refs()', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.storage_dangling_refs()', 'EXECUTE') then
    raise exception 'm41: the audit function must not be executable by API roles';
  end if;
  if to_regprocedure('app_private.rewrite_storage_refs(text,text)') is null or to_regprocedure('public.rewrite_storage_refs(text,text)') is null then raise exception 'm41: rewrite_storage_refs is missing'; end if;
  if has_function_privilege('anon', 'public.rewrite_storage_refs(text,text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.rewrite_storage_refs(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.rewrite_storage_refs(text,text)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.rewrite_storage_refs(text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.rewrite_storage_refs(text,text)', 'EXECUTE') then
    raise exception 'm41: rewrite_storage_refs privileges are wrong';
  end if;
  raise notice 'm41 ok';
end $$;

commit;

-- ================================================================= for the Certificates builder (NOT run here)
-- When data/certificates.js uploads templates through data/storage.js (uploadImage / storeImage, profile 'template'), enforce WebP on that
-- bucket as well, in the builder's own migration:
--   update storage.buckets set allowed_mime_types = array['image/webp'] where id = 'certificate-templates';
--   and add 'certificate-templates' to the bucket_id lists of webp_only_insert / webp_only_update above (drop + create the two policies).
-- The bucket currently also lists application/pdf: the owner decided that templates are images only (08 section 17.2).
