-- v36_library  (m36: Resource Library node)  Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin, U2 = temporary founder (participant), U3 = founder without participation.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v36.res', '', false) \gset

begin;
create schema v36_test;
grant usage on schema v36_test to public;
create or replace function v36_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v36.res', current_setting('v36.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v36_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v36_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v36_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v36_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform v36_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform v36_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v36_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v36_test.t(p_key, true, 'ok');
  exception when others then
    perform v36_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v36_test from public;
grant execute on all functions in schema v36_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v36_test.val('C01 m36 objects exist', $q$select (to_regprocedure('app_private.save_children_library(uuid,jsonb)') is not null and to_regprocedure('app_private.library_payload(public.nodes,text)') is not null and to_regprocedure('public.get_public_library(text)') is not null and to_regprocedure('public.list_founder_libraries(uuid)') is not null and to_regprocedure('public.library_file_readable(text)') is not null and to_regclass('public.library_categories') is not null)::text$q$, 'true');
select v36_test.val('C02 m36 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('save_children_library','library_payload','library_audience','library_res_ok','get_public_library','list_founder_libraries','library_file_readable') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v36_test.val('C03 anon cannot execute the founder RPC, the writer or the payload helper', $q$select (has_function_privilege('anon','public.list_founder_libraries(uuid)','EXECUTE') or has_function_privilege('anon','app_private.save_children_library(uuid,jsonb)','EXECUTE') or has_function_privilege('anon','app_private.library_payload(public.nodes,text)','EXECUTE') or has_function_privilege('authenticated','app_private.save_children_library(uuid,jsonb)','EXECUTE'))::text$q$, 'false');
select v36_test.val('C04 anon can execute the public reads and the storage rule', $q$select (has_function_privilege('anon','public.get_public_library(text)','EXECUTE') and has_function_privilege('anon','public.get_public_tab(text,uuid,jsonb)','EXECUTE') and has_function_privilege('anon','public.library_file_readable(text)','EXECUTE'))::text$q$, 'true');
select v36_test.val('C05 get_public_tab calls the library payload for the caller''s standing', $q$select (pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure) like '%app_private.library_payload(s, app_private.library_viewer(s.id, l.audience))%')::text$q$, 'true');
select v36_test.val('C06 library_categories: RLS forced, no anon grant, no client write grant', $q$select (select relforcerowsecurity from pg_class where oid = 'public.library_categories'::regclass)::text || ' ' || (has_table_privilege('anon','public.library_categories','SELECT'))::text || ' ' || (has_table_privilege('authenticated','public.library_categories','INSERT') or has_table_privilege('authenticated','public.library_categories','UPDATE'))::text$q$, 'true false false');
select v36_test.val('C07 the storage policy for visitors exists on the resources bucket', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname='resources_select_visitor'$q$, '1');
select v36_test.val('C08 the migrated 26 resources are untouched (visibility public, no category)', $q$select count(*)::text from public.resources where visibility = 'public' and category_id is null and deleted_at is null and created_by is null$q$, '26');
select v36_test.val('C10 the form upload policy calls a wrapper that anon and authenticated may execute', $q$select (has_function_privilege('anon','public.form_upload_allowed(text)','EXECUTE') and has_function_privilege('authenticated','public.form_upload_allowed(text)','EXECUTE') and (select with_check from pg_policies where policyname = 'form_uploads_insert_public') not like '%app_private.form_upload_allowed%')::text$q$, 'true');
select v36_test.val('C09 library_res_ok matrix', $q$select (app_private.library_res_ok('public','public') and not app_private.library_res_ok('public','participants') and not app_private.library_res_ok('public','hidden') and app_private.library_res_ok('participant','participants') and not app_private.library_res_ok('participant','hidden') and app_private.library_res_ok('pm','hidden') and not app_private.library_res_ok(null,'public'))::text$q$, 'true');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000b0d2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v36-admin@example.invalid','{"provisioned":true}','{"full_name":"V36 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000b0f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v36-founder@example.invalid','{"provisioned":true}','{"full_name":"V36 Founder"}', now(), now()),
 ('00000000-0000-4000-8000-00000000b0f3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v36-other@example.invalid','{"provisioned":true}','{"full_name":"V36 Other"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000b0d2','super_admin'), ('00000000-0000-4000-8000-00000000b0f2','founder'), ('00000000-0000-4000-8000-00000000b0f3','founder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V36 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V36 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.create_project(:'prog', 'V36 Other Project', null, 'Asia/Riyadh')).id as proj2 \gset
select (public.add_node(:'proj', 'library', '{"en":"V36 Library","ar":"مكتبة"}', 0, 0, '{}')).id as lib \gset
select (public.add_node(:'proj', 'library', '{"en":"V36 Library B","ar":"مكتبة ب"}', 0, 0, '{}')).id as lib2 \gset
select (public.add_node(:'proj2', 'library', '{"en":"V36 Other Library"}', 0, 0, '{}')).id as libx \gset
reset role;

-- storage objects the resources will point at (as postgres: the Storage API does the real upload)
insert into storage.objects (bucket_id, name) values
 ('resources', :'proj' || '/' || :'lib' || '/11111111-aaaa-4aaa-8aaa-111111111111.pdf'),
 ('resources', :'proj' || '/' || :'lib' || '/22222222-aaaa-4aaa-8aaa-222222222222.webp'),
 ('resources', :'proj' || '/' || :'lib' || '/22222222-aaaa-4aaa-8aaa-222222222222_t.webp'),
 ('resources', :'proj' || '/' || :'lib' || '/33333333-aaaa-4aaa-8aaa-333333333333.pdf'),
 ('resources', :'proj2' || '/' || :'libx' || '/44444444-aaaa-4aaa-8aaa-444444444444.pdf');
select :'proj' || '/' || :'lib' || '/11111111-aaaa-4aaa-8aaa-111111111111.pdf' as f_pub \gset
select :'proj' || '/' || :'lib' || '/22222222-aaaa-4aaa-8aaa-222222222222.webp' as f_img \gset
select :'proj' || '/' || :'lib' || '/33333333-aaaa-4aaa-8aaa-333333333333.pdf' as f_part \gset
select :'proj2' || '/' || :'libx' || '/44444444-aaaa-4aaa-8aaa-444444444444.pdf' as f_other \gset

-- ================================================================= save_children_library
select r.rev as r0 from public.node_revisions r where r.node_id = :'lib' \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select (public.save_node(:'lib', (select r.rev from public.node_revisions r where r.node_id = :'lib'),
  jsonb_build_object('config', '{"layout":"list","groupBy":"category","secret":"x"}'::jsonb, 'visibility', 'private'),
  jsonb_build_object(
   'categories', jsonb_build_array(
      jsonb_build_object('id','c0000000-0000-4000-8000-000000000001','name_en','Guides','name_ar','أدلة','sort_order',1),
      jsonb_build_object('id','c0000000-0000-4000-8000-000000000002','name_en','Videos','name_ar',null,'sort_order',2)),
   'resources', jsonb_build_array(
      jsonb_build_object('id','a0000000-0000-4000-8000-000000000001','category_id','c0000000-0000-4000-8000-000000000001','title_en','Public PDF','title_ar','ملف','type','readable','visibility','public',
         'file_path', :'f_pub','mime','application/pdf','bytes',1234,'sort_order',1),
      jsonb_build_object('id','a0000000-0000-4000-8000-000000000002','category_id','c0000000-0000-4000-8000-000000000002','title_en','Public link','type','visual','visibility','public',
         'url','https://example.com/v','sort_order',2),
      jsonb_build_object('id','a0000000-0000-4000-8000-000000000003','title_en','Participants PDF','type','readable','visibility','participants',
         'file_path', :'f_part','mime','application/pdf','bytes',99,'sort_order',3),
      jsonb_build_object('id','a0000000-0000-4000-8000-000000000004','title_en','Hidden link','type','link','visibility','hidden','url','https://example.com/h','sort_order',4),
      jsonb_build_object('id','a0000000-0000-4000-8000-000000000005','title_en','An image','type','visual','visibility','public',
         'file_path', :'f_img','mime','image/webp','bytes',500,'sort_order',5))))->>'rev') as rev1 \gset
reset role;
select v36_test.val('S01 save_children_library wrote 2 categories and 5 resources', format($q$select (select count(*) from public.library_categories where node_id='%s')::text || '/' || (select count(*) from public.resources where node_id='%s' and deleted_at is null)::text$q$, :'lib', :'lib'), '2/5');
select v36_test.val('S02 ONE revision bump for the whole save', format($q$select ((select rev from public.node_revisions where node_id='%s') - %s)::text || ' ' || (%s - %s)::text$q$, :'lib', :'r0', :'rev1', :'r0'), '1 1');
select v36_test.val('S03 the draft config round-trips as sent (the RPC does not interpret it)', format($q$select config->>'layout' || ' ' || coalesce(config->>'secret','-') from public.nodes where id='%s'$q$, :'lib'), 'list x');

-- invalid writes (each in a savepoint-free way: the helper catches the error)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.fails('W01 a javascript: url is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"resources":[{"id":"a0000000-0000-4000-8000-000000000009","title_en":"x","type":"link","url":"javascript:alert(1)"}]}'::jsonb)$q$, :'lib', :'lib'), '22023');
select v36_test.fails('W02 a file of ANOTHER project is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('resources', jsonb_build_array(jsonb_build_object('id','a0000000-0000-4000-8000-000000000009','title_en','x','type','readable','file_path','%s','mime','application/pdf','bytes',1))))$q$, :'lib', :'lib', :'f_other'), '22023');
select v36_test.fails('W03 a file that is not in the bucket is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('resources', jsonb_build_array(jsonb_build_object('id','a0000000-0000-4000-8000-000000000009','title_en','x','type','readable','file_path','%s/%s/nope.pdf','mime','application/pdf','bytes',1))))$q$, :'lib', :'lib', :'proj', :'lib'), '22023');
select v36_test.fails('W04 a disallowed file type is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('resources', jsonb_build_array(jsonb_build_object('id','a0000000-0000-4000-8000-000000000009','title_en','x','type','readable','file_path','%s','mime','application/x-msdownload','bytes',1))))$q$, :'lib', :'lib', :'f_pub'), '22023');
select v36_test.fails('W05 a file over 50 MB is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('resources', jsonb_build_array(jsonb_build_object('id','a0000000-0000-4000-8000-000000000009','title_en','x','type','readable','file_path','%s','mime','application/pdf','bytes',52428801))))$q$, :'lib', :'lib', :'f_pub'), '22023');
select v36_test.fails('W06 a resource without title is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"resources":[{"id":"a0000000-0000-4000-8000-000000000009","type":"link","url":"https://e.com"}]}'::jsonb)$q$, :'lib', :'lib'), '22023');
select v36_test.fails('W07 a resource without a link or a file is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"resources":[{"id":"a0000000-0000-4000-8000-000000000009","title_en":"x","type":"link"}]}'::jsonb)$q$, :'lib', :'lib'), '22023');
select v36_test.fails('W08 a category of another node is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"categories":[{"id":"c0000000-0000-4000-8000-000000000001","name_en":"stolen"}]}'::jsonb)$q$, :'lib2', :'lib2'), '42501');
select v36_test.fails('W09 a resource id of another node is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"resources":[{"id":"a0000000-0000-4000-8000-000000000001","title_en":"stolen","type":"link","url":"https://e.com"}]}'::jsonb)$q$, :'lib2', :'lib2'), '42501');
select v36_test.fails('W10 a resource naming a category that is not in the node is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"resources":[{"id":"a0000000-0000-4000-8000-000000000009","title_en":"x","type":"link","url":"https://e.com","category_id":"c0000000-0000-4000-8000-0000000000ff"}]}'::jsonb)$q$, :'lib', :'lib'), '22023');
select v36_test.fails('W11 a bad visibility is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"resources":[{"id":"a0000000-0000-4000-8000-000000000009","title_en":"x","type":"link","url":"https://e.com","visibility":"everyone"}]}'::jsonb)$q$, :'lib', :'lib'), '22023');
select v36_test.fails('W12 a stale revision token conflicts (P0001 revision_conflict, never 40001)', format($q$select public.save_node('%s', 1, '{}'::jsonb, '{"resources":[]}'::jsonb)$q$, :'lib'), 'P0001');
-- direct PostgREST-style writes keep the same guarantees
select v36_test.fails('W13 a direct insert cannot point at another project''s file (CHECK)', format($q$insert into public.resources (project_id, node_id, title_en, type, file_path, mime, bytes) values ('%s','%s','x','readable','%s','application/pdf',1)$q$, :'proj', :'lib', :'f_other'), '23514');
select v36_test.fails('W14 a direct insert cannot store a javascript: url (CHECK)', format($q$insert into public.resources (project_id, node_id, title_en, type, url) values ('%s','%s','x','link','javascript:alert(1)')$q$, :'proj', :'lib'), '23514');
select v36_test.fails('W15 the categories table has no client write grant', format($q$insert into public.library_categories (project_id, node_id, name_en) values ('%s','%s','x')$q$, :'proj', :'lib'), '42501');
reset role;
select v36_test.val('W16 nothing of the refused saves persisted', format($q$select (select count(*) from public.library_categories where node_id='%s')::text || '/' || (select count(*) from public.resources where node_id='%s' and deleted_at is null)::text$q$, :'lib', :'lib'), '2/5');

-- ================================================================= public reads: the node is private -> nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select public.ensure_public_link(:'lib', 'view', 'library-tab', null) as vlink \gset
reset role;
select s.slug as vslug from public.public_link_slugs s where s.link_id = :'vlink' and s.is_current \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v36_test.val('P01 anon: a private library is not served (null)', format($q$select (public.get_public_library('%s') is null)::text$q$, :'vslug'), 'true');
select v36_test.val('P02 anon: no file of a private library is readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_pub'), '0');
reset role;

-- public node
update public.nodes set visibility = 'public' where id = :'lib';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v36_test.val('P03 anon: only the PUBLIC resources are listed (3 of 5), in order, no hidden/participants', format($q$select (select string_agg(r->>'title_en', ',' order by (r->>'sort_order')::int) from jsonb_array_elements(public.get_public_library('%s')->'data'->'resources') r)$q$, :'vslug'), 'Public PDF,Public link,An image');
select v36_test.val('P04 anon: the payload carries categories, the whitelisted config and NO visibility key', format($q$select (select jsonb_array_length(v->'data'->'categories')::text || ' ' || (v->'data'->'config')::text || ' ' || (select bool_or(r ? 'visibility')::text from jsonb_array_elements(v->'data'->'resources') r) from (select public.get_public_library('%s') v) x)$q$, :'vslug'), '2 {"layout": "list", "groupBy": "category"} false');
select v36_test.val('P05 anon: viewer is public, the title is the node name', format($q$select (select (v->>'viewer') || ' ' || (v->>'title_en') from (select public.get_public_library('%s') v) x)$q$, :'vslug'), 'public V36 Library');
select v36_test.val('P06 anon: the public file is readable by the storage rule (signed URLs follow)', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_pub'), '1');
select v36_test.val('P07 anon: the image thumbnail (_t) is readable too', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, replace(:'f_img', '.webp', '_t.webp')), '1');
select v36_test.val('P08 anon: a participants-only file is NOT readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_part'), '0');
select v36_test.val('P09 anon: another project''s file is NOT readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_other'), '0');
select v36_test.val('P10 anon: the table itself is closed', $q$select (select count(*) from information_schema.role_table_grants where table_name = 'resources' and grantee = 'anon' and table_schema = 'public')::text$q$, '0');
reset role;

-- the thumbnail of a NON-image is never readable even if the name matches a derived path
insert into storage.objects (bucket_id, name) values ('resources', replace(:'f_pub', '.pdf', '_t.pdf'));
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v36_test.val('P11 anon: a derived "_t" name of a PDF is NOT readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, replace(:'f_pub', '.pdf', '_t.pdf')), '0');
reset role;

-- through the Agenda host tab (project page link) the same payload is served
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select public.ensure_public_link(null, 'project', null, :'proj') as plink \gset
reset role;
select s.slug as pslug from public.public_link_slugs s where s.link_id = :'plink' and s.is_current \gset
select n.id as host from public.nodes n where n.project_id = :'proj' and n.type = 'view_host' \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select (public.connect(:'proj', :'lib', 'library-tab', :'host', 'tabs', '{"audience":"public"}')).id as e1 \gset
reset role;
update public.projects set visibility = 'public' where id = :'proj';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v36_test.val('T01 anon: the host tab serves the library payload (3 public resources + categories)', format($q$select (select jsonb_array_length(v->'data'->'resources')::text || ' ' || jsonb_array_length(v->'data'->'categories')::text || ' ' || (v->>'type') from (select public.get_public_tab('%s', '%s') v) x)$q$, :'pslug', :'e1'), '3 2 library');
reset role;

-- ================================================================= participants (platform node)
insert into public.participants (project_id, user_id, source, status) values (:'proj', '00000000-0000-4000-8000-00000000b0f2', 'manual', 'accepted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.val('Q00 participant on a PUBLIC library: viewer participant, public + participants resources (4 of 5), through the own page', format($q$select (select (v->>'viewer') || ' ' || jsonb_array_length(v->'data'->'resources')::text from (select public.get_public_library('%s') v) x)$q$, :'vslug'), 'participant 4');
select v36_test.val('Q00b participant on a PUBLIC library: the host tab carries the same 4', format($q$select jsonb_array_length(public.get_public_tab('%s', '%s')->'data'->'resources')::text$q$, :'pslug', :'e1'), '4');
select v36_test.val('Q00c participant on a PUBLIC library: the participants-only file is readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_part'), '1');
reset role;
update public.nodes set visibility = 'platform' where id = :'lib';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v36_test.val('Q01 anon: a platform library is not served', format($q$select (public.get_public_library('%s') is null)::text$q$, :'vslug'), 'true');
select v36_test.val('Q02 anon: no file of a platform library is readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_pub'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.val('Q03 participant: public + participants resources (4 of 5), viewer participant, never hidden', format($q$select (select (v->>'viewer') || ' ' || jsonb_array_length(v->'data'->'resources')::text || ' ' || (select string_agg(r->>'title_en', ',' order by (r->>'sort_order')::int) from jsonb_array_elements(v->'data'->'resources') r) from (select public.get_public_library('%s') v) x)$q$, :'vslug'), 'participant 4 Public PDF,Public link,Participants PDF,An image');
select v36_test.val('Q04 participant: the participants-only file IS readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_part'), '1');
select v36_test.val('Q05 participant: the public file is readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_pub'), '1');
select v36_test.val('Q06 participant: another project''s file is not readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_other'), '0');
select v36_test.val('Q07 participant: no table access to resources (PM only)', format($q$select count(*)::text from public.resources where node_id = '%s'$q$, :'lib'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f3","role":"authenticated"}', true);
set local role authenticated;
select v36_test.val('Q08 founder without participation: platform library not served', format($q$select (public.get_public_library('%s') is null)::text$q$, :'vslug'), 'true');
select v36_test.val('Q09 founder without participation: no file readable', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_part'), '0');
reset role;

-- ================================================================= PM: everything incl. hidden; soft delete; founder exposure
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.val('R01 PM (viewer pm): all 5 resources incl. hidden with their visibility, even on a platform node', format($q$select (select (v->>'viewer') || ' ' || jsonb_array_length(v->'data'->'resources')::text || ' ' || (select string_agg(r->>'visibility', ',' order by (r->>'sort_order')::int) from jsonb_array_elements(v->'data'->'resources') r) from (select public.get_public_library('%s') v) x)$q$, :'vslug'), 'pm 5 public,public,participants,hidden,public');
select v36_test.val('R02 PM: the hidden resource has a readable path through the PM policy', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_part'), '1');
select v36_test.val('R03 PM: list_founder_libraries is empty while show_to_participants is false', format($q$select jsonb_array_length(public.list_founder_libraries('%s'))::text$q$, :'proj'), '0');
select v36_test.okrun('R04 PM: expose the library (show_to_participants) with the rev token', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{"show_to_participants": true}')$q$, :'lib', :'lib'));
select v36_test.val('R05 PM: listed with the node link and the visible count (4 non-hidden)', format($q$select (select (v->0->>'name_en') || ' ' || (v->0->>'ref') || ' ' || (v->0->>'via') || ' ' || (v->0->>'count') from (select public.list_founder_libraries('%s') v) x)$q$, :'proj'), 'V36 Library ' || :'vslug' || ' node 4');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.val('R06 participant founder: sees the exposed library', format($q$select jsonb_array_length(public.list_founder_libraries('%s'))::text$q$, :'proj'), '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f3","role":"authenticated"}', true);
set local role authenticated;
select v36_test.fails('R07 founder without participation: forbidden', format($q$select public.list_founder_libraries('%s')$q$, :'proj'), '42501');
reset role;

-- soft delete + category removal
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.okrun('D01 PM: remove one resource and one category in a save (children keys present)', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object(
  'categories', jsonb_build_array(jsonb_build_object('id','c0000000-0000-4000-8000-000000000001','name_en','Guides','sort_order',1)),
  'resources', jsonb_build_array(
     jsonb_build_object('id','a0000000-0000-4000-8000-000000000001','category_id','c0000000-0000-4000-8000-000000000001','title_en','Public PDF','type','readable','visibility','public','file_path','%s','mime','application/pdf','bytes',1234,'sort_order',1),
     jsonb_build_object('id','a0000000-0000-4000-8000-000000000002','title_en','Public link','type','visual','visibility','public','url','https://example.com/v','sort_order',2))))$q$, :'lib', :'lib', :'f_pub'));
reset role;
select v36_test.val('D02 removed resources are SOFT deleted (3 rows with deleted_at), files kept', format($q$select (select count(*) from public.resources where node_id='%s' and deleted_at is not null)::text || ' ' || (select count(*) from storage.objects where bucket_id='resources' and name like '%s/%%')::text$q$, :'lib', :'proj' || '/' || :'lib'), '3 5');
select v36_test.val('D03 the removed category is gone and its resource lost the link only', format($q$select (select count(*) from public.library_categories where node_id='%s')::text || ' ' || (select (category_id is null)::text from public.resources where id='a0000000-0000-4000-8000-000000000002')$q$, :'lib'), '1 true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.val('D05 participant: the deleted participants-only file is not readable any more', format($q$select count(*)::text from storage.objects where bucket_id = 'resources' and name = '%s'$q$, :'f_part'), '0');
reset role;
-- undo semantics of a re-save: the same id comes back (deleted_at cleared)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.okrun('D06 PM: re-submitting a deleted id restores it', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('resources', jsonb_build_array(
     jsonb_build_object('id','a0000000-0000-4000-8000-000000000003','title_en','Participants PDF','type','readable','visibility','participants','file_path','%s','mime','application/pdf','bytes',99,'sort_order',1))))$q$, :'lib', :'lib', :'f_part'));
reset role;
select v36_test.val('D07 exactly one live resource after the restore', format($q$select count(*)::text from public.resources where node_id='%s' and deleted_at is null$q$, :'lib'), '1');
-- a PM of another project cannot read this node's data
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f3","role":"authenticated"}', true);
set local role authenticated;
select v36_test.fails('D08 a non-PM cannot save a library', format($q$select public.save_node('%s', 1, '{}'::jsonb, '{"resources":[]}'::jsonb)$q$, :'lib'), '42501');
reset role;

-- ================================================================= uploads (m31 policy repair): a PM can write to the private bucket, others cannot
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d2","role":"authenticated"}', true);
set local role authenticated;
select v36_test.okrun('X01 PM: uploads a file under <project>/<node>/ into the private bucket (storage insert as authenticated)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', '%s/%s/55555555-aaaa-4aaa-8aaa-555555555555.pdf', '00000000-0000-4000-8000-00000000b0d2', '00000000-0000-4000-8000-00000000b0d2')$q$, :'proj', :'lib'));
select v36_test.okrun('X02 PM: uploads a cover image under <project>/ into public-assets', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('public-assets', '%s/library/55555555-aaaa-4aaa-8aaa-555555555555.webp', '00000000-0000-4000-8000-00000000b0d2', '00000000-0000-4000-8000-00000000b0d2')$q$, :'proj'));
select v36_test.fails('X03 PM: cannot upload into another project''s folder?', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', 'not-a-uuid/x/55555555-aaaa-4aaa-8aaa-555555555556.pdf', '00000000-0000-4000-8000-00000000b0d2', '00000000-0000-4000-8000-00000000b0d2')$q$), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f3","role":"authenticated"}', true);
set local role authenticated;
select v36_test.fails('X04 a non-PM cannot upload into the private bucket', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', '%s/%s/55555555-aaaa-4aaa-8aaa-555555555557.pdf', '00000000-0000-4000-8000-00000000b0f3', '00000000-0000-4000-8000-00000000b0f3')$q$, :'proj', :'lib'), '42501');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v36_test.fails('X05 anon cannot upload into the private bucket', format($q$insert into storage.objects (bucket_id, name) values ('resources', '%s/%s/55555555-aaaa-4aaa-8aaa-555555555558.pdf')$q$, :'proj', :'lib'), '42501');
select v36_test.val('X06 anon: the form upload rule answers (false for a path that is no form)', format($q$select public.form_upload_allowed('%s/%s/55555555-aaaa-4aaa-8aaa-555555555559.pdf')::text$q$, :'proj', :'lib'), 'false');
reset role;

select current_setting('v36.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v36: library tests FAILED'; end $$;
\endif
