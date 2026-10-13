-- v41_webp  (m41: universal WebP, server side)  Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin. The end-to-end proof over the real Storage API (HTTP 400
-- invalid_mime_type for a PNG, 200 for a WebP) is db/scripts/ (README: "Direct REST check"); this file proves the database side.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v41.res', '', false) \gset

begin;
create schema v41_test;
grant usage on schema v41_test to public;
create or replace function v41_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v41.res', current_setting('v41.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v41_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v41_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v41_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v41_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v41_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v41_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v41_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v41_test.t(p_key, true, 'ok');
  exception when others then
    perform v41_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
create or replace function v41_test.refused(p_bucket text, p_prefix text, p_exts text[], p_owner uuid default null) returns text language plpgsql as $$
declare e text; n int := 0; total int := 0;
begin
  foreach e in array p_exts loop
    total := total + 1;
    begin
      insert into storage.objects (bucket_id, name, owner, owner_id) values (p_bucket, p_prefix || '/' || gen_random_uuid()::text || '.' || e, p_owner, p_owner::text);
    exception when insufficient_privilege then n := n + 1;
    end;
  end loop;
  return n || '/' || total;
end $$;
revoke all on all functions in schema v41_test from public;
grant execute on all functions in schema v41_test to anon, authenticated, service_role;

-- ================================================================= catalog (as postgres)
select v41_test.val('C01 public-assets accepts WebP and SVG only; founder-assets WebP only', $q$select ((select allowed_mime_types from storage.buckets where id = 'public-assets') = array['image/webp','image/svg+xml'] and (select allowed_mime_types from storage.buckets where id = 'founder-assets') = array['image/webp'])::text$q$, 'true');
select v41_test.val('C02 the mixed buckets lost every raster type and kept their documents', $q$select (not (select allowed_mime_types && array['image/png','image/jpeg','image/gif'] from storage.buckets where id = 'resources')
  and not (select allowed_mime_types && array['image/png','image/jpeg','image/gif'] from storage.buckets where id = 'form-uploads')
  and (select allowed_mime_types @> array['application/pdf','image/webp','audio/mpeg','video/mp4'] from storage.buckets where id = 'resources')
  and (select allowed_mime_types @> array['application/pdf','image/webp','text/plain'] from storage.buckets where id = 'form-uploads'))::text$q$, 'true');
select v41_test.val('C03 certificate-templates is WebP ONLY since m42 (the Certificates builder switched it: owner decisions 17.2 + 17.3)', $q$select ((select allowed_mime_types from storage.buckets where id = 'certificate-templates') = array['image/webp'])::text$q$, 'true');
select v41_test.val('C04 two RESTRICTIVE policies (insert + update) for anon and authenticated', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('webp_only_insert','webp_only_update') and permissive = 'RESTRICTIVE' and roles @> array['anon','authenticated']::name[]$q$, '2');
select v41_test.val('C05 the policies call no function (an RLS function needs EXECUTE for the caller: the m36 lesson)', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('webp_only_insert','webp_only_update') and (coalesce(with_check,'') ~* '(app_private|public)\.[a-z_]+\(' or coalesce(qual,'') ~* '(app_private|public)\.[a-z_]+\(')$q$, '0');
select v41_test.val('C06 audit view and function are not reachable by API roles', $q$select (has_table_privilege('anon','app_private.nonwebp_image_objects','SELECT') or has_table_privilege('authenticated','app_private.nonwebp_image_objects','SELECT') or has_function_privilege('anon','app_private.storage_dangling_refs()','EXECUTE') or has_function_privilege('authenticated','app_private.storage_dangling_refs()','EXECUTE'))::text$q$, 'false');
select v41_test.val('C07 audit function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname = 'app_private' and p.proname = 'storage_dangling_refs' and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v41_test.val('C08 rewrite_storage_refs: only the service role may execute it (app_private and the public wrapper)', $q$select (not has_function_privilege('anon','public.rewrite_storage_refs(text,text)','EXECUTE') and not has_function_privilege('authenticated','public.rewrite_storage_refs(text,text)','EXECUTE') and not has_function_privilege('anon','app_private.rewrite_storage_refs(text,text)','EXECUTE') and not has_function_privilege('authenticated','app_private.rewrite_storage_refs(text,text)','EXECUTE') and has_function_privilege('service_role','public.rewrite_storage_refs(text,text)','EXECUTE') and has_function_privilege('service_role','app_private.rewrite_storage_refs(text,text)','EXECUTE'))::text$q$, 'true');
select v41_test.val('D01 no DB reference points at a missing file or a missing thumbnail', $q$select count(*)::text from app_private.storage_dangling_refs()$q$, '0');
select v41_test.val('D02 the image buckets hold no raster that is not WebP / SVG', $q$select count(*)::text from app_private.nonwebp_image_objects where bucket_id in ('public-assets','founder-assets','resources','form-uploads')$q$, '0');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000c041','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v41-admin@example.invalid','{"provisioned":true}','{"full_name":"V41 Admin"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000c041','super_admin');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c041","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V41 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V41 Project', null, 'Africa/Cairo')).id as proj \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V41 Apply"}', 0, 0, '{}')).id as frm \gset
select r.rev as rev0 from public.node_revisions r where r.node_id = :'frm' \gset
select v41_test.okrun('S01 a public form with a file question', format($q$select public.save_node('%s', %s, '{"config":{}}',
  '{"form":{"is_active":true},"sections":[],"questions":[{"id":"00000000-0000-4000-8000-00000000c0e6","key":"deck","type":"file","label_en":"Deck","order_index":0}]}')$q$, :'frm', :'rev0'));
select public.ensure_public_link(:'frm', 'form', null, null) as link \gset
reset role;
update public.nodes set visibility = 'public' where id = :'frm';

-- ================================================================= a super_admin (authenticated) writes images
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c041","role":"authenticated"}', true);
set local role authenticated;
select v41_test.okrun('X01 public-assets: a .webp object is accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/webp","size":1000}')$q$);
select v41_test.okrun('X02 public-assets: its _t.webp thumbnail is accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/zz41/00000000-0000-4000-8000-0000000041a1_t.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/webp","size":100}')$q$);
select v41_test.okrun('X03 public-assets: an SVG (the vector logo) is accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/logo/00000000-0000-4000-8000-0000000041a2.svg', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/svg+xml","size":300}')$q$);
select v41_test.fails('X04 public-assets: a .png name is refused', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/zz41/00000000-0000-4000-8000-0000000041b1.png', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/webp"}')$q$, '42501');
select v41_test.val('X05 public-assets: every raster name is refused (jpg JPEG jpeg jfif gif heic heif avif bmp tif tiff PNG), case-insensitive', $q$select v41_test.refused('public-assets', 'global/zz41', array['jpg','JPEG','jpeg','jfif','gif','heic','heif','avif','bmp','tif','tiff','PNG'], '00000000-0000-4000-8000-00000000c041')$q$, '12/12');
select v41_test.fails('X06 public-assets: a .webp NAME with a recorded image/png mimetype is refused', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/zz41/00000000-0000-4000-8000-0000000041b2.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/png"}')$q$, '42501');
select v41_test.fails('X07 public-assets: a .webp NAME with a recorded image/jpeg mimetype is refused', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/zz41/00000000-0000-4000-8000-0000000041b3.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/jpeg"}')$q$, '42501');
select v41_test.fails('X08 UPDATE: renaming a stored WebP to .png is refused', $q$update storage.objects set name = 'global/zz41/00000000-0000-4000-8000-0000000041a1.png' where bucket_id = 'public-assets' and name = 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp'$q$, '42501');
select v41_test.fails('X09 UPDATE: re-recording a stored WebP as image/png is refused', $q$update storage.objects set metadata = '{"mimetype":"image/png"}' where bucket_id = 'public-assets' and name = 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp'$q$, '42501');
select v41_test.okrun('X10 UPDATE: touching a WebP object (same name, WebP mimetype) still works', $q$update storage.objects set metadata = '{"mimetype":"image/webp","size":1001}' where bucket_id = 'public-assets' and name = 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp'$q$);
-- founder-assets: own folder only, WebP only
select v41_test.okrun('F01 founder-assets: own-folder .webp is accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('founder-assets', 'founders/00000000-0000-4000-8000-00000000c041/00000000-0000-4000-8000-0000000041c1.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/webp"}')$q$);
select v41_test.fails('F02 founder-assets: own-folder .png / .jpg are refused', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('founder-assets', 'founders/00000000-0000-4000-8000-00000000c041/00000000-0000-4000-8000-0000000041c2.jpg', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041')$q$, '42501');
-- resources (mixed): documents yes, raster names no
select v41_test.okrun('R01 resources: a PDF is accepted (unchanged)', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('resources', 'global/zz41/00000000-0000-4000-8000-0000000041d1.pdf', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"application/pdf"}')$q$);
select v41_test.okrun('R02 resources: a .webp image and its thumbnail are accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('resources', 'global/zz41/00000000-0000-4000-8000-0000000041d2.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/webp"}'), ('resources', 'global/zz41/00000000-0000-4000-8000-0000000041d2_t.webp', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/webp"}')$q$);
select v41_test.fails('R03 resources: a .jpg / .png name is refused', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', 'global/zz41/00000000-0000-4000-8000-0000000041d3.jpg', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041')$q$, '42501');
select v41_test.fails('R04 resources: a PDF NAME recorded as image/jpeg is refused (the mimetype is looked at too)', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('resources', 'global/zz41/00000000-0000-4000-8000-0000000041d4.pdf', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041', '{"mimetype":"image/jpeg"}')$q$, '42501');
reset role;

-- ================================================================= anonymous respondents on a public form (form-uploads, the m31 policy + the new one)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v41_test.okrun('U01 anon: a PDF under <project>/<form>/<uuid>.pdf is accepted (the m31 rule still works)', format($q$insert into storage.objects (bucket_id, name, metadata) values ('form-uploads', '%s/%s/00000000-0000-4000-8000-0000000041e1.pdf', '{"mimetype":"application/pdf"}')$q$, :'proj', :'frm'));
select v41_test.okrun('U02 anon: a .webp picture is accepted', format($q$insert into storage.objects (bucket_id, name, metadata) values ('form-uploads', '%s/%s/00000000-0000-4000-8000-0000000041e2.webp', '{"mimetype":"image/webp"}')$q$, :'proj', :'frm'));
select v41_test.fails('U03 anon: a .png picture is refused although the form rule allows .png', format($q$insert into storage.objects (bucket_id, name, metadata) values ('form-uploads', '%s/%s/00000000-0000-4000-8000-0000000041e3.png', '{"mimetype":"image/png"}')$q$, :'proj', :'frm'), '42501');
select v41_test.val('U04 anon: .jpg .jpeg .gif pictures are refused too (names that pass the form rule)', format($q$select v41_test.refused('form-uploads', '%s/%s', array['jpg','jpeg','gif'])$q$, :'proj', :'frm'), '3/3');
select v41_test.fails('U05 anon: a .webp NAME with a recorded image/png mimetype is refused', format($q$insert into storage.objects (bucket_id, name, metadata) values ('form-uploads', '%s/%s/00000000-0000-4000-8000-0000000041e7.webp', '{"mimetype":"image/png"}')$q$, :'proj', :'frm'), '42501');
select v41_test.fails('U06 anon cannot write into the image buckets at all', $q$insert into storage.objects (bucket_id, name, metadata) values ('public-assets', 'global/zz41/anon.webp', '{"mimetype":"image/webp"}')$q$, '42501');
reset role;

-- ================================================================= the second layer on its own: without the restrictive policy the permissive PM policy would accept a .png name
-- (the Storage API's bucket list would still refuse the upload; this shows the DB policy is a real, independent layer)
drop policy webp_only_insert on storage.objects;
drop policy ext_allow_insert on storage.objects;       -- (m43's extension allow-list says no to a .png name as well)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c041","role":"authenticated"}', true);
set local role authenticated;
select v41_test.okrun('Y01 WITHOUT webp_only_insert (and the m43 allow-list) a super_admin could insert a .png name into public-assets (the permissive policy says yes)', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('public-assets', 'global/zz41/00000000-0000-4000-8000-0000000041f1.png', '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c041')$q$);
reset role;

-- ================================================================= the audit helpers see what they should
select v41_test.val('A01 the audit view lists that stray PNG (and nothing from the image buckets before it)', $q$select count(*)::text from app_private.nonwebp_image_objects where bucket_id = 'public-assets' and name like 'global/zz41/%'$q$, '1');
insert into public.companies (name_en, logo_path) values ('V41 dangling', 'global/company-logo/00000000-0000-4000-8000-0000000041f9.webp');
select v41_test.val('A02 the dangling-reference proof reports a logo path with no file', $q$select count(*)::text from app_private.storage_dangling_refs() where source = 'companies.logo_path' and problem = 'missing_file'$q$, '1');
update public.companies set logo_path = 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp' where name_en = 'V41 dangling';
select v41_test.val('A03 a WebP that has its _t thumbnail is clean', $q$select count(*)::text from app_private.storage_dangling_refs() where source = 'companies.logo_path'$q$, '0');
update public.companies set logo_path = 'founders/00000000-0000-4000-8000-00000000c041/00000000-0000-4000-8000-0000000041c1.webp' where name_en = 'V41 dangling';
select v41_test.val('A03b a stored WebP WITHOUT its _t thumbnail is reported as missing_thumb', $q$select count(*)::text from app_private.storage_dangling_refs() where source = 'companies.logo_path' and problem = 'missing_thumb'$q$, '1');
update public.companies set logo_path = 'global/logo/00000000-0000-4000-8000-0000000041a2.svg' where name_en = 'V41 dangling';
select v41_test.val('A04 an SVG logo needs no thumbnail', $q$select count(*)::text from app_private.storage_dangling_refs() where source = 'companies.logo_path'$q$, '0');
update public.nodes set config = jsonb_set(config, '{zz41}', '"global/zz41/00000000-0000-4000-8000-00000000dead.webp"') where id = :'frm';
select v41_test.val('A05 a path inside a jsonb config with no file is reported too', $q$select count(*)::text from app_private.storage_dangling_refs() where source = 'nodes.config (jsonb)'$q$, '1');

-- ================================================================= rewrite_storage_refs (the one place that knows every column that stores a path)
insert into public.companies (name_en, logo_path) values ('V41 rewrite', 'global/zz41/old-logo.png');
update public.nodes set config = jsonb_set(config, '{zz41}', '"global/zz41/old-logo.png"') where id = :'frm';
select v41_test.fails('RW01 old and new must differ and be present', $q$select app_private.rewrite_storage_refs('global/zz41/a.png', 'global/zz41/a.png')$q$, '22023');
select v41_test.fails('RW02 the new object must exist (data never points at a missing file)', $q$select app_private.rewrite_storage_refs('global/zz41/old-logo.png', 'global/zz41/nope.webp')$q$, '22023');
select v41_test.val('RW03 rewrites a text column and a jsonb document in one call and says where', $q$select (select (r->>'companies.logo_path') || ',' || (r->>'nodes.config') from (select app_private.rewrite_storage_refs('global/zz41/old-logo.png', 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp') r) x)$q$, '1,1');
select v41_test.val('RW04 afterwards the old path is nowhere and the new one is', $q$select (select count(*) from public.companies where logo_path = 'global/zz41/old-logo.png') || ',' || (select count(*) from public.nodes where config::text like '%old-logo.png%') || ',' || (select count(*) from public.companies where logo_path = 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp') || ',' || (select count(*) from public.nodes where config::text like '%0000000041a1.webp%')$q$, '0,0,1,1');
select v41_test.val('RW05 a path embedded in a longer value (a public URL) is rewritten as well', $q$select (select count(*) from (select app_private.rewrite_storage_refs('global/zz41/00000000-0000-4000-8000-0000000041a1.webp', 'global/logo/00000000-0000-4000-8000-0000000041a2.svg')) x)::text$q$, '1');
select v41_test.val('RW06 ... and the company now points at the new file', $q$select count(*)::text from public.companies where name_en = 'V41 rewrite' and logo_path = 'global/logo/00000000-0000-4000-8000-0000000041a2.svg'$q$, '1');
-- (no role-switched call of a function the role may NOT execute: on this local image the permission-denied error path of a function call segfaults the
-- Postgres server (see m36 section 10). The privileges are asserted with has_function_privilege in C08 and in the m41 self-check instead.)
set local role service_role;
select v41_test.val('RW09 the service role can (it is what the image-convert edge function uses)', $q$select (public.rewrite_storage_refs('global/logo/00000000-0000-4000-8000-0000000041a2.svg', 'global/zz41/00000000-0000-4000-8000-0000000041a1.webp') ->> 'companies.logo_path')$q$, '2');
reset role;

select current_setting('v41.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v41: universal-WebP tests FAILED'; end $$;
\endif
