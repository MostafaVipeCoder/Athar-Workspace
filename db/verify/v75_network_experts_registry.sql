-- v75_network_experts_registry  (m75: columns, pure helpers, derived search columns, guards, tags, audit tables, photo storage rule, participation function)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
-- Fixture: ADM = super_admin (e750), AM = alumni_manager (e751), PM = project_manager (e752), F = founder (e754).
-- NEVER call an app_private helper while the session role is anon / authenticated (the helpers are closed to them): helpers are called as the owner, denials are asserted with has_function_privilege.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v75.res', '', false) \gset

begin;
create schema v75_test;
grant usage on schema v75_test to public;
create or replace function v75_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v75.res', current_setting('v75.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v75_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v75_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v75_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
-- the statement must FAIL with this SQLSTATE or this hint
create or replace function v75_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v75_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v75_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
create or replace function v75_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v75_test.t(p_key, true, 'ok');
  exception when others then
    perform v75_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v75_test from public;
grant execute on all functions in schema v75_test to anon, authenticated, service_role;

-- ================================================================= A. catalog (as postgres)
select v75_test.val('A01 the new columns exist with the right types', $q$select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'network_experts' and column_name in ('phone', 'website_url', 'links', 'languages', 'notes', 'archived_at', 'archived_by', 'merged_into', 'updated_by', 'search_text', 'name_key', 'name_skels')$q$,
  'archived_at:timestamp with time zone,archived_by:uuid,languages:ARRAY,links:jsonb,merged_into:uuid,name_key:text,name_skels:ARRAY,notes:text,phone:text,search_text:text,updated_by:uuid,website_url:text');
select v75_test.val('A02 the constraints exist', $q$select count(*)::text from pg_constraint where conrelid = 'public.network_experts'::regclass and conname in ('network_experts_notes_len', 'network_experts_phone_len', 'network_experts_links_chk', 'network_experts_languages_chk', 'network_experts_merge_chk')$q$, '5');
select v75_test.val('A03 the search / duplicate / state indexes exist', $q$select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'network_experts'
  and indexname in ('network_experts_search_trgm_idx', 'network_experts_name_key_trgm_idx', 'network_experts_name_skels_idx', 'network_experts_state_idx', 'network_experts_merged_into_idx')$q$, '5');
select v75_test.val('A04 the four triggers of the registry exist (derive, guard, list-item guard, and the old touch trigger is still there)', $q$select (select count(*) from pg_trigger where not tgisinternal and tgname in ('network_experts_biu_derive', 'network_experts_biu_guard', 'network_experts_bu_touch', 'network_experts_bd_tombstone'))::text
  || '/' || (select count(*) from pg_trigger where not tgisinternal and tgname = 'list_items_biu_expert')$q$, '4/1');
select v75_test.val('A05 the tag tables and the audit tables have RLS enabled + forced', $q$select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity and ((n.nspname = 'public' and c.relname in ('expert_tags', 'network_expert_tags')) or (n.nspname = 'app_private' and c.relname in ('network_expert_merges', 'network_expert_nondup')))$q$, '4');
select v75_test.val('A06 anon has NO privilege on any of the new tables; authenticated can only SELECT the tag tables and nothing of the audit tables', $q$select (
  not has_table_privilege('anon', 'public.expert_tags', 'SELECT') and not has_table_privilege('anon', 'public.network_expert_tags', 'SELECT')
  and has_table_privilege('authenticated', 'public.expert_tags', 'SELECT') and not has_table_privilege('authenticated', 'public.expert_tags', 'INSERT') and not has_table_privilege('authenticated', 'public.expert_tags', 'UPDATE') and not has_table_privilege('authenticated', 'public.expert_tags', 'DELETE')
  and not has_table_privilege('authenticated', 'public.network_expert_tags', 'INSERT') and not has_table_privilege('authenticated', 'public.network_expert_tags', 'DELETE')
  and not has_table_privilege('authenticated', 'app_private.network_expert_merges', 'SELECT') and not has_table_privilege('authenticated', 'app_private.network_expert_nondup', 'SELECT') and not has_table_privilege('anon', 'app_private.network_expert_merges', 'SELECT'))::text$q$, 'true');
select v75_test.val('A07 every helper of m75 is closed to anon / authenticated (the RPCs are the only door)', $q$select (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text from pg_proc p
  where p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_norm', 'expert_skeleton', 'expert_linkkey', 'expert_participation', 'network_experts_derive', 'network_experts_guard', 'list_items_expert_guard')$q$, '0');
select v75_test.val('A08 every helper / trigger function of m75 pins search_path to empty', $q$select (count(*) filter (where p.proconfig is null or not ('search_path=""' = any (p.proconfig))))::text from pg_proc p
  where p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_norm', 'expert_skeleton', 'expert_linkkey', 'expert_participation', 'network_experts_derive', 'network_experts_guard', 'list_items_expert_guard')$q$, '0');
select v75_test.val('A09 the security-definer ones: participation function and the three triggers', $q$select (count(*) filter (where p.prosecdef))::text from pg_proc p
  where p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_participation', 'network_experts_derive', 'network_experts_guard', 'list_items_expert_guard')$q$, '4');
select v75_test.val('A10 the photo storage policies exist (staff insert / delete under global/expert-photo/)', $q$select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('public_assets_insert_expert_photo', 'public_assets_delete_expert_photo')$q$, '2');
select v75_test.val('A11 the starter tag vocabulary is there (>= 18, unique keys, every tag has a name in a language)', $q$select ((select count(*) from public.expert_tags) >= 18 and (select count(*) = count(distinct tag_key) from public.expert_tags) and not exists (select 1 from public.expert_tags where name_en is null and name_ar is null))::text$q$, 'true');

-- ================================================================= B. the pure helpers (as postgres)
select v75_test.val('B01 norm: whitespace, tabs and punctuation collapse to one space', $q$select app_private.expert_norm(E'  Dr.  Alaa\tAfifi-Ibrahim  ')$q$, 'dr alaa afifi ibrahim');
select v75_test.val('B02 norm: tashkeel, tatweel and alef variants are folded', $q$select app_private.expert_norm('أَحْمَد  إبراهيم ـ آل')$q$, 'احمد ابراهيم ال');
select v75_test.val('B03 norm: ya / ta-marbuta / accents', $q$select app_private.expert_norm('مصطفى ليلة  Humboldt-Universität')$q$, 'مصطفي ليله humboldt universitat');
select v75_test.val('B04 norm: null and empty give an empty string, never NULL', $q$select (app_private.expert_norm(null) = '')::text || (app_private.expert_norm('   ') = '')::text$q$, 'truetrue');
select v75_test.val('B05 skeleton: the same name in Latin and Arabic gives ONE skeleton (4 real pairs)', $q$select (app_private.expert_skeleton('Osama Nageeb') = app_private.expert_skeleton('أسامة نجيب')
  and app_private.expert_skeleton('Mohamed Elbehery') = app_private.expert_skeleton('محمد البحيري') and app_private.expert_skeleton('Mohamed Hani Ismail') = app_private.expert_skeleton('محمد هاني إسماعيل')
  and app_private.expert_skeleton('Moustafa Nabil') = app_private.expert_skeleton('مصطفى نبيل'))::text$q$, 'true');
select v75_test.val('B06 skeleton: different people do not collide (Ahmed Fathy / Ahmed Fadl; Mohamed Ali / Mohamed Salah)', $q$select (app_private.expert_skeleton('Ahmed Fathy') <> app_private.expert_skeleton('Ahmed Fadl')
  and app_private.expert_skeleton('Mohamed Ali') <> app_private.expert_skeleton('Mohamed Salah'))::text$q$, 'true');
select v75_test.val('B07 skeleton: spelling variants of one name agree (Mohamed / Muhammad, Mahmoud / Mahmood)', $q$select (app_private.expert_skeleton('Mohamed Elbehery') = app_private.expert_skeleton('Muhammad Elbehery')
  and app_private.expert_skeleton('Mahmoud Qassem') = app_private.expert_skeleton('Mahmood Kassem'))::text$q$, 'true');
select v75_test.val('B08 skeleton: null is the empty string', $q$select (app_private.expert_skeleton(null) = '')::text$q$, 'true');
select v75_test.val('B09 linkkey: scheme, www, country sub-domain, query and trailing slash do not matter', $q$select (
  app_private.expert_linkkey('https://www.linkedin.com/in/osama-nageeb/?utm=1') = 'linkedin.com/in/osama-nageeb'
  and app_private.expert_linkkey('http://eg.linkedin.com/in/Osama-Nageeb') = 'linkedin.com/in/osama-nageeb'
  and app_private.expert_linkkey('linkedin.com/in/osama-nageeb/') = 'linkedin.com/in/osama-nageeb'
  and app_private.expert_linkkey(null) = '')::text$q$, 'true');

-- ================================================================= C. the migrated data is untouched (as postgres)
select v75_test.val('C01 the 44 migrated experts (42 experts + 2 Athar team) are all there and none is archived / deleted / merged', $q$select count(*)::text || '/' || count(*) filter (where kind = 'expert') || '/' || count(*) filter (where kind = 'team')
  || '/' || count(*) filter (where archived_at is not null or deleted_at is not null or merged_into is not null) from public.network_experts$q$, '44/42/2/0');
select v75_test.val('C02 every migrated expert has its derived search columns', $q$select count(*) filter (where search_text is null or name_key is null or name_skels is null)::text from public.network_experts$q$, '0');
select v75_test.val('C03 the references of the lists are all intact (69 list items point at the 44 experts)', $q$select count(*)::text || '/' || count(distinct network_expert_id) from public.list_items where network_expert_id is not null$q$, '69/44');
select v75_test.val('C04 the participation function agrees with the legacy usage view on lists / projects (every expert item of a live node)', $q$select (
  (select count(*) from app_private.expert_participation(null)) = (select count(*) from public.v_network_expert_programs v join public.programs g on g.id = v.program_id and g.deleted_at is null))::text$q$, 'true');

-- ================================================================= fixture
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e750','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v75-adm@example.invalid','{"provisioned":true}','{"full_name":"V75 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e751','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v75-am@example.invalid','{"provisioned":true}','{"full_name":"V75 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e752','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v75-pm@example.invalid','{"provisioned":true}','{"full_name":"V75 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e754','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v75-f@example.invalid','{"provisioned":true}','{"full_name":"V75 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e750','super_admin'), ('00000000-0000-4000-8000-00000000e751','alumni_manager'),
  ('00000000-0000-4000-8000-00000000e752','project_manager'), ('00000000-0000-4000-8000-00000000e754','founder');
insert into public.network_experts (id, kind, name_en, name_ar, title_en, linkedin_url, email) values
  ('00000000-0000-4000-8000-0000000075a1', 'expert', E'V75  Alpha\tPerson', 'ألفا', 'Founder', 'https://www.linkedin.com/in/v75-alpha/', 'v75-alpha@example.invalid'),
  ('00000000-0000-4000-8000-0000000075a2', 'expert', 'V75 Beta Person', null, null, null, null),
  ('00000000-0000-4000-8000-0000000075a3', 'expert', 'V75 Gamma Person', null, null, null, null);
select v75_test.val('D01 a new row gets its derived columns from the trigger (whitespace-insensitive; m78: only the LinkedIn HANDLE is searchable)', $q$select search_text || '|' || name_key from public.network_experts where id = '00000000-0000-4000-8000-0000000075a1'$q$,
  'v75 alpha person الفا founder v75 alpha example invalid v75 alpha|v75 alpha person الفا');

-- ================================================================= E. the guard trigger (m78: the table is written by the RPCs only; the trigger is tested as the OWNER with the PM's session, so the trigger decides, not the privilege)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e752","role":"authenticated"}', true);
select v75_test.okrun('E01 the session of a project manager edits a profile (the trigger stamps; m78: the PM ROLE cannot write the table itself, see E14)', $q$update public.network_experts set title_en = 'Founder & CEO' where id = '00000000-0000-4000-8000-0000000075a1'$q$);
select v75_test.val('E02 the edit is stamped (updated_by = the PM) and the search column follows', $q$select (updated_by = '00000000-0000-4000-8000-00000000e752')::text || '/' || (search_text like '%ceo%')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000075a1'$q$, 'true/true');
select v75_test.err('E03 a project manager session cannot soft-delete through the table', $q$update public.network_experts set deleted_at = now() where id = '00000000-0000-4000-8000-0000000075a2'$q$, '42501');
select v75_test.err('E04 a project manager session cannot set merged_into through the table', $q$update public.network_experts set merged_into = '00000000-0000-4000-8000-0000000075a1' where id = '00000000-0000-4000-8000-0000000075a2'$q$, '42501');
select v75_test.err('E05 a project manager session cannot INSERT a record that is already deleted', $q$insert into public.network_experts (name_en, deleted_at) values ('V75 Ghost', now())$q$, '42501');
select v75_test.okrun('E06 a project manager session creates a new record: created_by is stamped', $q$insert into public.network_experts (id, name_en) values ('00000000-0000-4000-8000-0000000075a4', 'V75 Delta Person')$q$);
select v75_test.val('E07 created_by is the PM', $q$select (created_by = '00000000-0000-4000-8000-00000000e752')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000075a4'$q$, 'true');
select v75_test.err('E08 a link list with 7 entries is refused (check)', $q$update public.network_experts set links = '[{"url":"https://a"},{"url":"https://b"},{"url":"https://c"},{"url":"https://d"},{"url":"https://e"},{"url":"https://f"},{"url":"https://g"}]'::jsonb where id = '00000000-0000-4000-8000-0000000075a2'$q$, '23514');
select v75_test.err('E09 a language that is not a 2-3 letter code is refused (check)', $q$update public.network_experts set languages = array['english'] where id = '00000000-0000-4000-8000-0000000075a2'$q$, '23514');
select v75_test.err('E10 more than 8 languages are refused (check)', $q$update public.network_experts set languages = array['ar','en','fr','de','es','it','tr','zh','ja'] where id = '00000000-0000-4000-8000-0000000075a2'$q$, '23514');
set local role authenticated;
select v75_test.val('E11 the project manager reads the tag lookup (staff) but cannot write it', $q$select count(*) > 0 from public.expert_tags$q$, 'true');
select v75_test.err('E12 a project manager cannot insert a tag directly (RPC only)', $q$insert into public.expert_tags (tag_key, name_en) values ('v75 direct', 'V75 direct')$q$, '42501');
select v75_test.err('E13 a project manager cannot link a tag directly', $q$insert into public.network_expert_tags (expert_id, tag_id) select '00000000-0000-4000-8000-0000000075a2', id from public.expert_tags limit 1$q$, '42501');
select v75_test.err('E14 (m78) the project manager ROLE has no INSERT / UPDATE privilege on the registry table: the RPCs are the only writer', $q$update public.network_experts set title_en = 'direct' where id = '00000000-0000-4000-8000-0000000075a2'$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e751","role":"authenticated"}', true);
set local role authenticated;
select v75_test.val('F01 an alumni manager READS the registry rows and the tags', $q$select (select count(*) from public.network_experts) >= 47 and (select count(*) from public.expert_tags) >= 18$q$, 'true');
select v75_test.err('F02 but a direct UPDATE by an alumni manager is refused (m78: no privilege and no policy: the RPC is the door)', $q$update public.network_experts set title_en = 'hacked' where id = '00000000-0000-4000-8000-0000000075a2'$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e754","role":"authenticated"}', true);
set local role authenticated;
select v75_test.val('G01 a founder reads no expert and no tag', $q$select (select count(*) from public.network_experts)::text || '/' || (select count(*) from public.expert_tags) || '/' || (select count(*) from public.network_expert_tags)$q$, '0/0/0');
select v75_test.err('G02 a founder cannot insert an expert', $q$insert into public.network_experts (name_en) values ('V75 Founder Made')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select v75_test.val('G03 anon has no table privilege on the experts, the tags or the audit tables', $q$select (not has_table_privilege('anon', 'public.network_experts', 'SELECT') and not has_table_privilege('anon', 'public.network_experts', 'INSERT') and not has_table_privilege('anon', 'public.expert_tags', 'SELECT'))::text$q$, 'true');

-- ================================================================= H. the list-item guard: a merged expert is redirected, a removed one is refused (as the owner of the tables)
insert into public.programs (id, name_en) values ('00000000-0000-4000-8000-0000000075b0', 'V75 Program');
insert into public.projects (id, program_id, name_en) values ('00000000-0000-4000-8000-0000000075b1', '00000000-0000-4000-8000-0000000075b0', 'V75 Project');
insert into public.nodes (id, project_id, type, name_en, config) values ('00000000-0000-4000-8000-0000000075b2', '00000000-0000-4000-8000-0000000075b1', 'list', 'V75 Experts', '{"subkind":"expert"}');
-- a3 becomes the duplicate merged into a1; a2 is plainly deleted (as postgres: no signed-in user, trusted)
update public.network_experts set deleted_at = now(), merged_into = '00000000-0000-4000-8000-0000000075a1' where id = '00000000-0000-4000-8000-0000000075a3';
update public.network_experts set deleted_at = now() where id = '00000000-0000-4000-8000-0000000075a4';
select v75_test.val('H01 a list item that points at a MERGED expert lands on the canonical expert', $q$with i as (insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id)
  values ('00000000-0000-4000-8000-0000000075b1', '00000000-0000-4000-8000-0000000075b2', 'network_expert', '00000000-0000-4000-8000-0000000075a3') returning network_expert_id) select (network_expert_id = '00000000-0000-4000-8000-0000000075a1')::text from i$q$, 'true');
select v75_test.err('H02 a second item for the same canonical expert in the same list is a duplicate (the redirect feeds the unique index)', $q$insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id)
  values ('00000000-0000-4000-8000-0000000075b1', '00000000-0000-4000-8000-0000000075b2', 'network_expert', '00000000-0000-4000-8000-0000000075a3')$q$, '23505');
select v75_test.err('H03 a list item cannot point at a removed (soft-deleted, not merged) expert', $q$insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id)
  values ('00000000-0000-4000-8000-0000000075b1', '00000000-0000-4000-8000-0000000075b2', 'network_expert', '00000000-0000-4000-8000-0000000075a4')$q$, 'expert_unavailable');
select v75_test.okrun('H04 an ARCHIVED expert can still be referenced (archive hides, it does not remove)', $q$update public.network_experts set archived_at = now() where id = '00000000-0000-4000-8000-0000000075a2'$q$);
select v75_test.okrun('H05 ... and a list can still add it', $q$insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id) values ('00000000-0000-4000-8000-0000000075b1', '00000000-0000-4000-8000-0000000075b2', 'network_expert', '00000000-0000-4000-8000-0000000075a2')$q$);
select v75_test.val('H06 the participation function lists one row per expert item (a1 via the redirect, a2 archived but present)', $q$select string_agg(right(expert_id::text, 2), ',' order by expert_id) from app_private.expert_participation(null) where project_id = '00000000-0000-4000-8000-0000000075b1'$q$, 'a1,a2');
update public.list_items set withdrawn_at = now() where network_expert_id = '00000000-0000-4000-8000-0000000075a2' and project_id = '00000000-0000-4000-8000-0000000075b1';select v75_test.val('H07 a withdrawn item is returned flagged (the counts of m76 leave it out)', $q$select withdrawn::text from app_private.expert_participation('00000000-0000-4000-8000-0000000075a2')$q$, 'true');update public.nodes set deleted_at = now() where id = '00000000-0000-4000-8000-0000000075b2';select v75_test.val('H08 a list node that is soft-deleted drops out of the participation', $q$select count(*)::text from app_private.expert_participation(null) where project_id = '00000000-0000-4000-8000-0000000075b1'$q$, '0');

-- ================================================================= I. storage: staff manage expert photos under global/expert-photo/ only
insert into storage.buckets (id, name, public) values ('public-assets', 'public-assets', true) on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e751","role":"authenticated"}', true);
set local role authenticated;
select v75_test.okrun('I01 an alumni manager stores an expert photo (.webp) at global/expert-photo/<uuid>.webp', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000075c1.webp', '00000000-0000-4000-8000-00000000e751', '00000000-0000-4000-8000-00000000e751', '{"mimetype":"image/webp"}')$q$);
select v75_test.okrun('I02 ... and its _t thumbnail', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000075c1_t.webp', '00000000-0000-4000-8000-00000000e751', '00000000-0000-4000-8000-00000000e751', '{"mimetype":"image/webp"}')$q$);
select v75_test.err('I03 another folder under global/ is still super_admin only', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/other/00000000-0000-4000-8000-0000000075c2.webp', '00000000-0000-4000-8000-00000000e751', '00000000-0000-4000-8000-00000000e751', '{"mimetype":"image/webp"}')$q$, '42501');
select v75_test.err('I04 a non-uuid file name in the expert-photo folder is refused', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/evil.webp', '00000000-0000-4000-8000-00000000e751', '00000000-0000-4000-8000-00000000e751', '{"mimetype":"image/webp"}')$q$, '42501');
select v75_test.err('I05 a PNG in the expert-photo folder is refused (the WebP-only rule of m41 still applies)', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000075c3.png', '00000000-0000-4000-8000-00000000e751', '00000000-0000-4000-8000-00000000e751', '{"mimetype":"image/png"}')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e754","role":"authenticated"}', true);
set local role authenticated;
select v75_test.err('I07 a founder cannot store an expert photo', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000075c4.webp', '00000000-0000-4000-8000-00000000e754', '00000000-0000-4000-8000-00000000e754', '{"mimetype":"image/webp"}')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= final state check
select current_setting('v75.res', true) as res \gset
rollback;
select count(*) as n_experts from public.network_experts \gset
select count(*) as n_ghosts from public.network_experts where name_en like 'V75%' \gset
select (:n_experts = 44 and :n_ghosts = 0) as state_ok \gset

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or not (:'state_ok')::boolean) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v75: network experts registry (schema) tests FAILED'; end $$;
\endif
