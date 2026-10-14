-- v45_originals_and_og  (m45: old raster originals converted + deleted, og-images JPEG derivatives)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist. Prints PASS/FAIL lines; exits non-zero on any FAIL.
--   U1 = temporary super_admin, UA = project_manager of project PA, UB = project_manager of project PB, UC = signed-in user with no role.
-- The data-state checks (D..) describe the FINISHED flow on this database: db/scripts/convert-images.mjs --apply then --delete-originals, and
-- db/scripts/backfill-og-images.mjs --apply. (The end-to-end proof over the real Storage API is in web/README.md "Universal WebP" / the log.)
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v45.res', '', false) \gset

begin;
create schema v45_test;
grant usage on schema v45_test to public;
create or replace function v45_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v45.res', current_setting('v45.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v45_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v45_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v45_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v45_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v45_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v45_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v45_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v45_test.t(p_key, true, 'ok');
  exception when others then
    perform v45_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- how many of the given names the caller's policies refuse (insert one object per name into og-images, count insufficient_privilege)
create or replace function v45_test.refused(p_bucket text, p_names text[], p_owner uuid default null) returns text language plpgsql as $$
declare e text; n int := 0;
begin
  foreach e in array p_names loop
    begin
      insert into storage.objects (bucket_id, name, owner, owner_id) values (p_bucket, e, p_owner, p_owner::text);
    exception when insufficient_privilege then n := n + 1;
    end;
  end loop;
  return n || '/' || array_length(p_names, 1);
end $$;
revoke all on all functions in schema v45_test from public;
grant execute on all functions in schema v45_test to anon, authenticated, service_role;

-- ================================================================= catalog (as postgres)
select v45_test.val('C01 og-images: a PUBLIC bucket that accepts image/jpeg only, 1 MiB', $q$select (select (public and allowed_mime_types = array['image/jpeg'] and file_size_limit = 1048576) from storage.buckets where id = 'og-images')::text$q$, 'true');
select v45_test.val('C02 og-images policies: select (anon + authenticated), insert / update / delete (authenticated only); none lets anon write', $q$select ((select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname = 'og_images_select_all' and cmd = 'SELECT' and roles @> array['anon','authenticated']::name[])
  + (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('og_images_insert_pm','og_images_update_pm','og_images_delete_pm') and roles = array['authenticated']::name[])
  + (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname ~ '^og_images_' and cmd <> 'SELECT' and roles && array['anon','public']::name[]) * 100)::text$q$, '4');
select v45_test.val('C03 the write policies name the pipeline path convention and a manager of the owner folder (or super_admin under global/)', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('og_images_insert_pm','og_images_update_pm')
  and coalesce(with_check,'') like '%\.jpg$%' and coalesce(with_check,'') like '%storage_project_manager%' and coalesce(with_check,'') like '%is_super_admin%'$q$, '2');
select v45_test.val('C04 the delete policy needs a manager of the owner folder too', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname = 'og_images_delete_pm' and qual like '%storage_project_manager%' and qual like '%is_super_admin%'$q$, '1');
select v45_test.val('C05 webp_only_insert / webp_only_update: RESTRICTIVE, anon + authenticated, EVERY bucket (no bucket list), only og-images exempt, no function call', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('webp_only_insert','webp_only_update') and permissive = 'RESTRICTIVE' and roles @> array['anon','authenticated']::name[]
  and with_check like '%og-images%' and with_check not like '%public-assets%' and with_check not like '%resources%' and with_check !~* '(app_private|public)\.[a-z_]+\('$q$, '2');
select v45_test.val('C06 the og / audit objects are not reachable by API roles; only the service role runs public.og_image_path', $q$select (has_function_privilege('anon','public.og_image_path(text)','EXECUTE') or has_function_privilege('authenticated','public.og_image_path(text)','EXECUTE')
  or has_function_privilege('anon','app_private.og_image_path(text)','EXECUTE') or has_function_privilege('authenticated','app_private.og_image_path(text)','EXECUTE')
  or has_function_privilege('anon','app_private.og_source_refs()','EXECUTE') or has_function_privilege('authenticated','app_private.og_source_refs()','EXECUTE')
  or has_function_privilege('anon','app_private.og_missing_refs()','EXECUTE') or has_function_privilege('authenticated','app_private.og_missing_refs()','EXECUTE')
  or has_table_privilege('anon','app_private.og_orphans','SELECT') or has_table_privilege('authenticated','app_private.og_orphans','SELECT')
  or has_table_privilege('anon','app_private.image_conversions','SELECT') or has_table_privilege('authenticated','app_private.image_conversions','SELECT') or has_table_privilege('authenticated','app_private.image_conversions','INSERT')
  or not has_function_privilege('service_role','public.og_image_path(text)','EXECUTE'))::text$q$, 'false');
select v45_test.val('C07 every m45 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('og_image_path','og_source_refs','og_missing_refs','storage_dangling_refs','rewrite_storage_refs') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v45_test.val('C08 image_conversions: RLS enabled and forced, no policy (nobody but the owner / service role reads it)', $q$select (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'app_private.image_conversions'::regclass)::text || ',' || (select count(*) from pg_policies where schemaname = 'app_private' and tablename = 'image_conversions')$q$, 'true,0');
select v45_test.val('C09 og_image_path: webp -> jpg (any case); a thumbnail, an SVG, a raster, a double extension and NULL have none', $q$select (app_private.og_image_path('P/cover/a.webp') = 'P/cover/a.jpg' and app_private.og_image_path('P/cover/A.WEBP') = 'P/cover/A.jpg'
  and app_private.og_image_path('P/cover/a_t.webp') is null and app_private.og_image_path('P/logo/a.svg') is null and app_private.og_image_path('P/cover/a.png') is null and app_private.og_image_path('P/cover/a.webp.bak') is null and app_private.og_image_path(null) is null
  and public.og_image_path('P/og/b.webp') = 'P/og/b.jpg')::text$q$, 'true');

-- ================================================================= data state (the finished flow)
select v45_test.val('D01 no DB reference points at a missing file or a missing thumbnail (public + migration.asset_result.archive_path)', $q$select count(*)::text from app_private.storage_dangling_refs()$q$, '0');
select v45_test.val('D02 NO raster is left in ANY bucket (the audit view covers every bucket except og-images)', $q$select count(*)::text from app_private.nonwebp_image_objects$q$, '0');
select v45_test.val('D03 every SHARED image reference has its JPEG derivative (the backfill is complete)', $q$select count(*)::text from app_private.og_missing_refs()$q$, '0');
select v45_test.val('D04 no JPEG derivative lives without its source image', $q$select count(*)::text from app_private.og_orphans$q$, '0');
select v45_test.val('D05 every og-images object is a .jpg recorded as image/jpeg, not larger than the bucket cap', $q$select count(*)::text from storage.objects where bucket_id = 'og-images' and (name !~* '\.jpg$' or coalesce(metadata->>'mimetype','') <> 'image/jpeg' or (metadata->>'size')::bigint > 1048576 or (metadata->>'size')::bigint = 0)$q$, '0');
select v45_test.val('D06 no conversion is half done (every recorded row is converted)', $q$select count(*)::text from app_private.image_conversions where converted_at is null$q$, '0');
select v45_test.val('D07 every converted row has its WebP and its thumbnail in storage', $q$select count(*)::text from app_private.image_conversions c where c.converted_at is not null and (not exists (select 1 from storage.objects o where o.bucket_id = c.bucket and o.name = c.webp_path)
  or (c.thumb_path is not null and not exists (select 1 from storage.objects t where t.bucket_id = c.bucket and t.name = c.thumb_path)) or c.webp_path !~* '\.webp$')$q$, '0');
select v45_test.val('D08 every converted original was deleted (deleted_at set) and is really gone from storage', $q$select count(*)::text from app_private.image_conversions c where c.deleted_at is null or exists (select 1 from storage.objects o where o.bucket_id = c.bucket and o.name = c.original_path)$q$, '0');
select v45_test.val('D09 no reference anywhere still names a deleted original (public + archive_path)', $q$select count(*)::text from app_private.image_conversions c where exists (select 1 from migration.asset_result a where a.archive_path = c.original_path)$q$, '0');
select v45_test.val('D10 every migration-archive path of migration.asset_result is a stored WebP', $q$select count(*)::text from migration.asset_result a where a.archive_path is not null and (a.archive_path !~* '\.webp$' or not exists (select 1 from storage.objects o where o.bucket_id = 'migration-archive' and o.name = a.archive_path))$q$, '0');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000c451','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v45-admin@example.invalid','{"provisioned":true}','{"full_name":"V45 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000c452','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v45-pm-a@example.invalid','{"provisioned":true}','{"full_name":"V45 PM A"}', now(), now()),
 ('00000000-0000-4000-8000-00000000c453','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v45-pm-b@example.invalid','{"provisioned":true}','{"full_name":"V45 PM B"}', now(), now()),
 ('00000000-0000-4000-8000-00000000c454','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v45-none@example.invalid','{"provisioned":true}','{"full_name":"V45 Nobody"}', now(), now());
insert into public.user_roles (user_id, role_key) values
 ('00000000-0000-4000-8000-00000000c451','super_admin'), ('00000000-0000-4000-8000-00000000c452','project_manager'), ('00000000-0000-4000-8000-00000000c453','project_manager');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c451","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V45 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V45 Project A', null, 'Africa/Cairo')).id as pa \gset
select (public.create_project(:'prog', 'V45 Project B', null, 'Africa/Cairo')).id as pb \gset
select (public.add_node(:'pa', 'landing_page', '{"en":"V45 Landing"}', 0, 0, '{}')).id as ld \gset
select (public.add_node(:'pa', 'form_builder', '{"en":"V45 Form"}', 0, 100, '{}')).id as frm \gset
select public.ensure_public_link(:'frm', 'form', null, null) as flink \gset
reset role;
insert into public.project_members (project_id, user_id, member_role) values (:'pa', '00000000-0000-4000-8000-00000000c452', 'manager'), (:'pb', '00000000-0000-4000-8000-00000000c453', 'manager');

-- ================================================================= PM of project A writes og-images (the pipeline convention only)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c452","role":"authenticated"}', true);
set local role authenticated;
select v45_test.okrun('O01 a manager of project A stores <A>/cover/<uuid>.jpg', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('og-images', '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452', '{"mimetype":"image/jpeg","size":50000}')$q$, :'pa'));
select v45_test.okrun('O02 ... also under every kind of the pipeline (project-cover, form-cover, og, landing)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('og-images', '%1$s/project-cover/00000000-0000-4000-8000-0000000045a2.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452', '{"mimetype":"image/jpeg"}'),
  ('og-images', '%1$s/form-cover/00000000-0000-4000-8000-0000000045a3.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452', '{"mimetype":"image/jpeg"}'),
  ('og-images', '%1$s/og/00000000-0000-4000-8000-0000000045a4.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452', '{"mimetype":"image/jpeg"}'),
  ('og-images', '%1$s/landing/00000000-0000-4000-8000-0000000045a5.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452', '{"mimetype":"image/jpeg"}')$q$, :'pa'));
select v45_test.fails('O03 ... NOT under project B (not his)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('og-images', '%s/cover/00000000-0000-4000-8000-0000000045b1.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452')$q$, :'pb'), '42501');
select v45_test.fails('O04 ... NOT under global/ (super_admin only)', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('og-images', 'global/og/00000000-0000-4000-8000-0000000045b2.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452')$q$, '42501');
select v45_test.val('O05 a WebP / PNG / JPEG-by-another-extension / GIF name is refused in og-images (the path convention is .jpg only)', format($q$select v45_test.refused('og-images', array['%1$s/cover/00000000-0000-4000-8000-0000000045b3.webp', '%1$s/cover/00000000-0000-4000-8000-0000000045b4.png', '%1$s/cover/00000000-0000-4000-8000-0000000045b5.jpeg', '%1$s/cover/00000000-0000-4000-8000-0000000045b6.gif', '%1$s/cover/00000000-0000-4000-8000-0000000045b7.JPG.exe'], '00000000-0000-4000-8000-00000000c452')$q$, :'pa'), '5/5');
select v45_test.val('O06 a path outside the convention is refused (no kind folder, a space in the kind, a name that is not a uuid, a deeper folder, no owner)', format($q$select v45_test.refused('og-images', array['%1$s/00000000-0000-4000-8000-0000000045c1.jpg', '%1$s/Cover Photo/00000000-0000-4000-8000-0000000045c2.jpg', '%1$s/cover/not-a-uuid.jpg', '%1$s/cover/sub/00000000-0000-4000-8000-0000000045c3.jpg', 'cover/00000000-0000-4000-8000-0000000045c4.jpg'], '00000000-0000-4000-8000-00000000c452')$q$, :'pa'), '5/5');
select v45_test.fails('O07 a JPEG does NOT belong in public-assets: it is refused there even for the owner of the folder', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('public-assets', '%s/cover/00000000-0000-4000-8000-0000000045d1.jpg', '00000000-0000-4000-8000-00000000c452', '00000000-0000-4000-8000-00000000c452')$q$, :'pa'), '42501');
select v45_test.okrun('O08 UPDATE: touching his own derivative (same name, JPEG mimetype) works', format($q$update storage.objects set metadata = '{"mimetype":"image/jpeg","size":50001}' where bucket_id = 'og-images' and name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg'$q$, :'pa'));
select v45_test.fails('O09 UPDATE: renaming his derivative to .png / .webp is refused', format($q$update storage.objects set name = '%s/cover/00000000-0000-4000-8000-0000000045a1.png' where bucket_id = 'og-images' and name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg'$q$, :'pa', :'pa'), '42501');
select v45_test.fails('O10 UPDATE: moving his derivative under project B is refused', format($q$update storage.objects set name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg' where bucket_id = 'og-images' and name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg'$q$, :'pb', :'pa'), '42501');
reset role;

-- ================================================================= the other people
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c453","role":"authenticated"}', true);
set local role authenticated;
select v45_test.okrun('P01 the manager of project B stores under project B', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('og-images', '%s/cover/00000000-0000-4000-8000-0000000045e1.jpg', '00000000-0000-4000-8000-00000000c453', '00000000-0000-4000-8000-00000000c453', '{"mimetype":"image/jpeg"}')$q$, :'pb'));
select v45_test.fails('P02 ... and not under project A', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('og-images', '%s/cover/00000000-0000-4000-8000-0000000045e2.jpg', '00000000-0000-4000-8000-00000000c453', '00000000-0000-4000-8000-00000000c453')$q$, :'pa'), '42501');
select v45_test.val('P03 B cannot update A''s derivative (the row is not even visible for writing: 0 rows)', format($q$with u as (update storage.objects set metadata = '{"mimetype":"image/jpeg","size":1}' where bucket_id = 'og-images' and name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg' returning 1) select count(*)::text from u$q$, :'pa'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c454","role":"authenticated"}', true);
set local role authenticated;
select v45_test.fails('P04 a signed-in user with no role and no membership cannot store anything', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('og-images', '%s/cover/00000000-0000-4000-8000-0000000045e3.jpg', '00000000-0000-4000-8000-00000000c454', '00000000-0000-4000-8000-00000000c454')$q$, :'pa'), '42501');
select v45_test.val('P05 ... but reads the derivatives (the bucket is public: crawlers fetch it anonymously)', format($q$select (count(*) > 0)::text from storage.objects where bucket_id = 'og-images' and name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg'$q$, :'pa'), 'true');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v45_test.fails('P06 anon cannot store into og-images', format($q$insert into storage.objects (bucket_id, name, metadata) values ('og-images', '%s/cover/00000000-0000-4000-8000-0000000045e4.jpg', '{"mimetype":"image/jpeg"}')$q$, :'pa'), '42501');
select v45_test.val('P07 anon reads a derivative', format($q$select (count(*) > 0)::text from storage.objects where bucket_id = 'og-images' and name = '%s/cover/00000000-0000-4000-8000-0000000045a1.jpg'$q$, :'pa'), 'true');
reset role;
-- delete policy (the Storage API sets storage.allow_delete_query; a direct DELETE needs it, and only the policies decide who may)
select set_config('storage.allow_delete_query', 'true', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c453","role":"authenticated"}', true);
set local role authenticated;
select v45_test.val('P08 B cannot delete A''s derivative (0 rows)', format($q$with d as (delete from storage.objects where bucket_id = 'og-images' and name = '%s/landing/00000000-0000-4000-8000-0000000045a5.jpg' returning 1) select count(*)::text from d$q$, :'pa'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c452","role":"authenticated"}', true);
set local role authenticated;
select v45_test.val('P09 A deletes his own derivative (1 row) - what removeImage does when a cover is replaced', format($q$with d as (delete from storage.objects where bucket_id = 'og-images' and name = '%s/landing/00000000-0000-4000-8000-0000000045a5.jpg' returning 1) select count(*)::text from d$q$, :'pa'), '1');
reset role;
-- the super_admin: global/ and everything else
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c451","role":"authenticated"}', true);
set local role authenticated;
select v45_test.okrun('S01 super_admin stores under global/', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('og-images', 'global/og/00000000-0000-4000-8000-0000000045f1.jpg', '00000000-0000-4000-8000-00000000c451', '00000000-0000-4000-8000-00000000c451', '{"mimetype":"image/jpeg"}')$q$);
select v45_test.fails('S02 ... but a PDF / WebP name is still refused in og-images', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('og-images', 'global/og/00000000-0000-4000-8000-0000000045f2.pdf', '00000000-0000-4000-8000-00000000c451', '00000000-0000-4000-8000-00000000c451')$q$, '42501');
-- the WebP-only rule now covers EVERY bucket (the permissive policy of certificate-templates / resources / founder-assets would say yes to the manager)
select v45_test.fails('W01 certificate-templates: a .jpg name is refused (m42''s own restrictive policy AND the m45 all-bucket rule say no)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('certificate-templates', '%s/00000000-0000-4000-8000-0000000045f3/00000000-0000-4000-8000-0000000045f4.jpg', '00000000-0000-4000-8000-00000000c451', '00000000-0000-4000-8000-00000000c451')$q$, :'pa'), '42501');
select v45_test.okrun('W02 certificate-templates: the same name as .webp is accepted (control)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('certificate-templates', '%s/00000000-0000-4000-8000-0000000045f3/00000000-0000-4000-8000-0000000045f4.webp', '00000000-0000-4000-8000-00000000c451', '00000000-0000-4000-8000-00000000c451', '{"mimetype":"image/webp"}')$q$, :'pa'));
select v45_test.val('W03 every raster name is still refused in public-assets / resources / founder-assets (m41 regression)', format($q$select v45_test.refused('public-assets', array['%1$s/cover/00000000-0000-4000-8000-0000000045f5.png', '%1$s/cover/00000000-0000-4000-8000-0000000045f6.jpg', '%1$s/cover/00000000-0000-4000-8000-0000000045f7.JPEG', '%1$s/cover/00000000-0000-4000-8000-0000000045f8.gif'], '00000000-0000-4000-8000-00000000c451')$q$, :'pa'), '4/4');
reset role;

-- ================================================================= the helpers see the shared references (as postgres)
-- sources (public-assets) for the throwaway references
insert into storage.objects (bucket_id, name) select 'public-assets', x from unnest(array[
  :'pa' || '/cover/00000000-0000-4000-8000-0000000045a1.webp', :'pa' || '/landing/00000000-0000-4000-8000-0000000045a6.webp', :'pa' || '/landing/00000000-0000-4000-8000-0000000045a7.webp',
  :'pa' || '/og/00000000-0000-4000-8000-0000000045a8.webp', :'pa' || '/logo/00000000-0000-4000-8000-0000000045a9.webp']) x;
update public.projects set cover_path = :'pa' || '/cover/00000000-0000-4000-8000-0000000045a1.webp' where id = :'pa';
update public.nodes set config = jsonb_set(jsonb_set(config, '{seo}', jsonb_build_object('imagePath', :'pa' || '/landing/00000000-0000-4000-8000-0000000045a6.webp')), '{hero}', jsonb_build_object('coverPath', :'pa' || '/landing/00000000-0000-4000-8000-0000000045a7.webp')) where id = :'ld';
update public.nodes set config = jsonb_set(config, '{share}', jsonb_build_object('image_path', :'pa' || '/og/00000000-0000-4000-8000-0000000045a8.webp')) where id = :'frm';
update public.public_links set og_image_path = :'pa' || '/og/00000000-0000-4000-8000-0000000045a8.webp' where id = :'flink';
insert into public.companies (name_en, logo_path) values ('V45 logo', :'pa' || '/logo/00000000-0000-4000-8000-0000000045a9.webp');
select v45_test.val('H01 og_source_refs names every kind of shared reference (project cover, landing seo + hero, form share image, public link preview)', format($q$select count(distinct source)::text from app_private.og_source_refs() where path like '%s/%%'$q$, :'pa'), '5');
select v45_test.val('H02 og_missing_refs reports the shared images that have no derivative yet (cover a1 HAS one: it was stored in O01)', format($q$select string_agg(distinct right(value, 9) || ':' || source, ' ' order by right(value, 9) || ':' || source) from app_private.og_missing_refs() where value like '%s/%%'$q$, :'pa'), '45a6.webp:nodes.config.seo.imagePath 45a7.webp:nodes.config.hero.coverPath 45a8.webp:nodes.config.share.image_path 45a8.webp:public_links.og_image_path');
select v45_test.val('H03 a company LOGO is not a shared image: never reported, never given a derivative', format($q$select count(*)::text from app_private.og_missing_refs() where value like '%s/logo/%%'$q$, :'pa'), '0');
insert into storage.objects (bucket_id, name, metadata) select 'og-images', :'pa' || '/landing/00000000-0000-4000-8000-0000000045a6.jpg', '{"mimetype":"image/jpeg","size":40000}';
select v45_test.val('H04 once the derivative exists at the deterministic path the reference is complete', format($q$select count(*)::text from app_private.og_missing_refs() where value = '%s/landing/00000000-0000-4000-8000-0000000045a6.webp'$q$, :'pa'), '0');
select v45_test.val('H05 a derivative with no source image is an orphan (housekeeping)', format($q$select count(*)::text from app_private.og_orphans where name like '%s/%%'$q$, :'pa'), '3'); -- a1 has its source here; the project-cover / form-cover / og ones O02 stored do not

-- ================================================================= the conversion references: migration.asset_result.archive_path
select old_path as ar_old, archive_path as ar_path from migration.asset_result where archive_path is not null order by old_path limit 1 \gset
insert into storage.objects (bucket_id, name, metadata) values ('migration-archive', 'external/zz45-new.webp', '{"mimetype":"image/webp","size":10}');
update migration.asset_result set archive_path = 'external/zz45-old.png' where old_path = :'ar_old';
select v45_test.val('A01 a path with no file in migration.asset_result.archive_path is reported by the dangling proof', $q$select count(*)::text from app_private.storage_dangling_refs() where source = 'migration.asset_result.archive_path' and value = 'external/zz45-old.png'$q$, '1');
select v45_test.val('A02 rewrite_storage_refs moves it (exact match) and says where', $q$select (app_private.rewrite_storage_refs('external/zz45-old.png', 'external/zz45-new.webp') ->> 'migration.asset_result.archive_path')$q$, '1');
select v45_test.val('A03 afterwards the row points at the WebP and the proof is clean again', format($q$select (select archive_path from migration.asset_result where old_path = %L) || ',' || (select count(*) from app_private.storage_dangling_refs() where source like 'migration.%%')$q$, :'ar_old'), 'external/zz45-new.webp,0');
select v45_test.val('A04 the provenance strings (old URLs in migration.asset_map / legacy.*) are NOT touched by a rewrite', $q$select count(*)::text from migration.asset_map where old_path like '%zz45%'$q$, '0');

select current_setting('v45.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v45: originals / og-images tests FAILED'; end $$;
\endif
