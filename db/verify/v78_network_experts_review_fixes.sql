-- v78_network_experts_review_fixes  (m78: the fixes of the review of the experts registry)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
-- Fixture: ADM = super_admin (e780), AM = alumni_manager (e781), PM = project_manager and member of program PA (e782), PM2 = project_manager, no membership (e783), F = founder (e784).
--   Program PA with project JA (lists LA / LB / LD, a distribution node DA, a booking node BA) and project J2 (list LC).
-- NEVER call an app_private helper while the session role is anon / authenticated (the helpers are closed to them): the old engine copies below are called as the owner.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v78.res', '', false) \gset

begin;
create schema v78_test;
grant usage on schema v78_test to public;
create or replace function v78_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v78.res', current_setting('v78.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || replace(coalesce(p_detail, ''), E'\n', ' ~ ') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v78_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v78_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v78_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
create or replace function v78_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v78_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v78_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect or coalesce(v_detail, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || '/' || coalesce(v_detail, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
create or replace function v78_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v78_test.t(p_key, true, 'ok');
  exception when others then
    perform v78_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- run(key, call, check, expected): the RPC runs as one statement; the state check is a SECOND statement ($1 = the call's result)
create or replace function v78_test.run(p_key text, p_call text, p_check text, p_expected text) returns void language plpgsql as $$
declare v_r text; v text;
begin
  begin
    execute p_call into v_r;
    execute p_check into v using v_r;
    perform v78_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v78_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v78_test from public;
grant execute on all functions in schema v78_test to anon, authenticated, service_role;

-- the ENGINE OF m76 / m77 (score every record against every other), kept here as the reference the new engine must equal; called as the owner only
create function v78_test.old_find(p_name_en text, p_name_ar text, p_email text, p_linkedin text, p_kind text, p_exclude uuid, p_min numeric, p_limit integer)
returns table (id uuid, score numeric, reasons text[])
language sql stable set search_path = '' as $$
  with q as (select app_private.expert_skeleton(p_name_en) s_en, app_private.expert_skeleton(p_name_ar) s_ar)
  select ne.id, m.score, m.reasons
    from public.network_experts ne
    cross join q
    cross join lateral app_private.expert_match(p_name_en, p_name_ar, p_email, p_linkedin, coalesce(p_kind, 'expert'),
                                                array(select x from unnest(array[q.s_en, q.s_ar]) x where char_length(x) >= 4),
                                                ne.name_en, ne.name_ar, ne.email::text, ne.linkedin_url, ne.kind, ne.name_skels) m
   where ne.deleted_at is null and (p_exclude is null or ne.id <> p_exclude) and m.score >= coalesce(p_min, 0.6)
   order by m.score desc, ne.created_at, ne.id
   limit least(greatest(coalesce(p_limit, 6), 1), 50)
$$;
create function v78_test.old_pairs()
returns table (a uuid, b uuid, score numeric, reasons text[])
language sql stable set search_path = '' as $$
  select a.id, b.id, m.score, m.reasons
    from public.network_experts a
    join public.network_experts b on a.id < b.id and a.deleted_at is null and b.deleted_at is null and a.kind = b.kind
    cross join lateral app_private.expert_match(a.name_en, a.name_ar, a.email::text, a.linkedin_url, a.kind, a.name_skels, b.name_en, b.name_ar, b.email::text, b.linkedin_url, b.kind, b.name_skels) m
   where m.score >= 0.6
$$;
revoke all on function v78_test.old_find(text, text, text, text, text, uuid, numeric, integer), v78_test.old_pairs() from anon, authenticated;

-- ================================================================= A. catalog (as postgres)
select v78_test.val('A01 no INSERT / UPDATE policy is left on network_experts (the RPCs are the only writer)', $q$select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'network_experts' and cmd in ('INSERT', 'UPDATE', 'ALL')$q$, '0');
select v78_test.val('A02 authenticated and anon have no INSERT / UPDATE privilege on the table, SELECT stays for authenticated', $q$select (not has_table_privilege('authenticated', 'public.network_experts', 'INSERT') and not has_table_privilege('authenticated', 'public.network_experts', 'UPDATE')
  and not has_table_privilege('anon', 'public.network_experts', 'INSERT') and not has_table_privilege('anon', 'public.network_experts', 'UPDATE') and has_table_privilege('authenticated', 'public.network_experts', 'SELECT'))::text$q$, 'true');
select v78_test.val('A03 the five table CHECKs exist', $q$select count(*)::text from pg_constraint where conrelid = 'public.network_experts'::regclass and conname in ('network_experts_urls_chk', 'network_experts_email_chk', 'network_experts_text_len_chk', 'network_experts_photo_chk', 'network_experts_links_shape_chk')$q$, '5');
select v78_test.val('A04 the stored keys and their indexes exist', $q$select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'network_experts' and column_name in ('name_en_key', 'name_ar_key', 'link_key', 'email_key'))::text
  || '/' || (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'network_experts' and indexname in ('network_experts_name_en_key_trgm_idx', 'network_experts_name_ar_key_trgm_idx', 'network_experts_link_key_idx', 'network_experts_email_key_idx'))$q$, '4/4');
select v78_test.val('A05 every migrated expert has its stored keys; the pairs table has the 3 real duplicate pairs of the migrated data', $q$select (select count(*) filter (where name_en_key is null or name_ar_key is null)::text from public.network_experts)
  || '/' || (select count(*)::text from app_private.network_expert_pairs where a in (select id from public.network_experts where created_at < now() - interval '1 hour') and b in (select id from public.network_experts where created_at < now() - interval '1 hour'))$q$, '0/3');
select v78_test.val('A06 the new helpers are closed to anon / authenticated (the photo-use check is open to authenticated on purpose: the storage policy calls it)', $q$select (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text from pg_proc p
  where p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_participation', 'expert_find_similar', 'rebuild_expert_pairs', 'network_experts_refresh_pairs', 'network_experts_delete_guard', 'expert_links_ok', 'expert_upsert_tag', 'expert_clean', 'list_items_expert_guard', 'list_items_inherit_withdrawn')$q$, '0');
select v78_test.val('A07 the pairs table has RLS forced and no API privilege', $q$select (c.relrowsecurity and c.relforcerowsecurity and not has_table_privilege('authenticated', 'app_private.network_expert_pairs', 'SELECT') and not has_table_privilege('anon', 'app_private.network_expert_pairs', 'SELECT'))::text
  from pg_class c where c.oid = 'app_private.network_expert_pairs'::regclass$q$, 'true');
select v78_test.val('A08 every function m78 defines pins search_path to empty', $q$select (count(*) filter (where p.proconfig is null or not ('search_path=""' = any (p.proconfig))))::text from pg_proc p
  where (p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_find_similar', 'network_experts_refresh_pairs', 'rebuild_expert_pairs', 'expert_photo_in_use', 'expert_links_ok', 'network_experts_delete_guard', 'expert_upsert_tag', 'expert_participation', 'list_items_expert_guard', 'list_items_inherit_withdrawn'))
     or (p.pronamespace = 'public'::regnamespace and p.proname in ('list_expert_duplicate_pairs', 'find_similar_network_experts', 'update_network_expert', 'delete_network_expert', 'merge_network_experts', 'import_network_experts', 'network_expert_usage', 'get_network_expert', 'list_network_experts'))$q$, '0');
select v78_test.val('A09 the import has ONE overload (an old 3-argument version would make every call ambiguous) and anon cannot execute any registry function', $q$select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'import_network_experts')::text
  || '/' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_network_experts', 'get_network_expert', 'find_similar_network_experts', 'list_expert_duplicate_pairs', 'update_network_expert', 'delete_network_expert', 'merge_network_experts', 'import_network_experts', 'network_expert_usage') and has_function_privilege('anon', p.oid, 'EXECUTE'))$q$, '1/0');
select v78_test.val('A10 the photo storage policies exist and the delete policy refuses a photo a record still uses', $q$select (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('public_assets_insert_expert_photo', 'public_assets_delete_expert_photo'))::text
  || '/' || (select (qual like '%expert_photo_in_use%')::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public_assets_delete_expert_photo')$q$, '2/true');

-- ================================================================= fixture
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e780','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v78-adm@example.invalid','{"provisioned":true}','{"full_name":"V78 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e781','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v78-am@example.invalid','{"provisioned":true}','{"full_name":"V78 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e782','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v78-pm@example.invalid','{"provisioned":true}','{"full_name":"V78 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e783','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v78-pm2@example.invalid','{"provisioned":true}','{"full_name":"V78 PM Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e784','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v78-f@example.invalid','{"provisioned":true}','{"full_name":"V78 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e780','super_admin'), ('00000000-0000-4000-8000-00000000e781','alumni_manager'),
  ('00000000-0000-4000-8000-00000000e782','project_manager'), ('00000000-0000-4000-8000-00000000e783','project_manager'), ('00000000-0000-4000-8000-00000000e784','founder');
insert into public.network_experts (id, kind, name_en, name_ar, title_en, linkedin_url, email, photo_path) values
  ('00000000-0000-4000-8000-0000000078a1', 'expert', 'V78 Alpha Person', null, 'T', 'https://www.linkedin.com/in/v78-alpha-handle/', 'v78-alpha@example.invalid', 'global/expert-photo/00000000-0000-4000-8000-000000007801.webp'),
  ('00000000-0000-4000-8000-0000000078a2', 'expert', 'V78 Beta Person', null, null, null, null, 'global/expert-photo/00000000-0000-4000-8000-000000007801.webp'),
  ('00000000-0000-4000-8000-0000000078a3', 'expert', 'V78 Gamma Person', null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000078a4', 'expert', 'V78 Delta Person', null, null, 'linkedin.com/in/v78-legacy', null, null);   -- a link WITHOUT a scheme (one migrated record has it)
insert into storage.buckets (id, name, public) values ('public-assets', 'public-assets', true) on conflict do nothing;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V78 Program A', 'برنامج', null, null, null, null)).id as pa \gset
select (public.create_project(:'pa', 'V78 Project A', null, 'Africa/Cairo')).id as ja \gset
select (public.create_project(:'pa', 'V78 Project B', null, 'Africa/Cairo')).id as j2 \gset
select (public.add_node(:'ja', 'list', '{"en":"V78 LA"}', 0, 0, '{"subkind":"expert"}')).id as la \gset
select (public.add_node(:'ja', 'list', '{"en":"V78 LB"}', 0, 0, '{"subkind":"expert"}')).id as lb \gset
select (public.add_node(:'ja', 'list', '{"en":"V78 LD"}', 0, 0, '{"subkind":"expert"}')).id as ld \gset
select (public.add_node(:'j2', 'list', '{"en":"V78 LC"}', 0, 0, '{"subkind":"expert"}')).id as lc \gset
select (public.add_node(:'ja', 'distribution', '{"en":"V78 Mentoring"}', 0, 0, '{}')).id as da \gset
select (public.add_node(:'ja', 'booking', '{"en":"V78 Booking"}', 0, 0, '{"mode":"mentor"}')).id as ba \gset
reset role; select set_config('request.jwt.claims', '', true);
insert into public.program_members (program_id, user_id) values (:'pa', '00000000-0000-4000-8000-00000000e782');

-- ================================================================= B. the registry table is written by the RPCs only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.err('B01 a project manager can NOT insert into the table (the old policy is gone)', $q$insert into public.network_experts (name_en) values ('V78 Direct')$q$, '42501');
select v78_test.err('B02 ... nor update it (kind, links, URLs: every rule of the RPCs would be bypassed)', $q$update public.network_experts set kind = 'team', links = '[{"kind":"x"}]'::jsonb, website_url = 'javascript:alert(1)' where id = '00000000-0000-4000-8000-0000000078a1'$q$, '42501');
select v78_test.val('B03 the soft-deleted / merged rows are NOT readable by a project manager directly (only live records); a live one is', $q$select (select count(*) from public.network_experts where deleted_at is not null)::text || '/' || (select count(*) from public.network_experts where id = '00000000-0000-4000-8000-0000000078a1')::text$q$, '0/1');
reset role; select set_config('request.jwt.claims', '', true);
-- soft-delete one as the owner, then read it as the PM / the super_admin
update public.network_experts set deleted_at = now() where id = '00000000-0000-4000-8000-0000000078a3';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('B04 the deleted row is invisible to the PM', $q$select count(*)::text from public.network_experts where id = '00000000-0000-4000-8000-0000000078a3'$q$, '0');
reset role; select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('B05 ... and visible to the super_admin', $q$select count(*)::text from public.network_experts where id = '00000000-0000-4000-8000-0000000078a3'$q$, '1');
reset role; select set_config('request.jwt.claims', '', true);
update public.network_experts set deleted_at = null where id = '00000000-0000-4000-8000-0000000078a3';

-- the guard trigger, as the OWNER with a user's session (so the trigger decides): spoofed stamps are overwritten, the kind belongs to the super_admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
select v78_test.okrun('B06 an insert that names another user as created_by / archived_by', $q$insert into public.network_experts (id, name_en, created_by, archived_at, archived_by) values ('00000000-0000-4000-8000-0000000078b1', 'V78 Spoof', '00000000-0000-4000-8000-00000000e780', now(), '00000000-0000-4000-8000-00000000e780')$q$);
select v78_test.val('B07 ... is stamped with the SESSION user instead', $q$select (created_by = '00000000-0000-4000-8000-00000000e782')::text || '/' || (archived_by = '00000000-0000-4000-8000-00000000e782')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000078b1'$q$, 'true/true');
select v78_test.okrun('B08 an update that tries to re-assign created_by / archived_by', $q$update public.network_experts set created_by = '00000000-0000-4000-8000-00000000e780', archived_by = '00000000-0000-4000-8000-00000000e780', title_en = 'x' where id = '00000000-0000-4000-8000-0000000078b1'$q$);
select v78_test.val('B09 ... the stamps do not move', $q$select (created_by = '00000000-0000-4000-8000-00000000e782')::text || '/' || (archived_by = '00000000-0000-4000-8000-00000000e782')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000078b1'$q$, 'true/true');
select v78_test.err('B10 a project manager session cannot change the KIND of a record (super_admin only)', $q$update public.network_experts set kind = 'team' where id = '00000000-0000-4000-8000-0000000078b1'$q$, '42501');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
select v78_test.okrun('B11 ... a super_admin session can', $q$update public.network_experts set kind = 'team' where id = '00000000-0000-4000-8000-0000000078b1'$q$);
select set_config('request.jwt.claims', '', true);
delete from public.network_experts where id = '00000000-0000-4000-8000-0000000078b1';

-- the CHECKs (as the owner)
select v78_test.err('B12 links: an element without a url', $q$update public.network_experts set links = '[{"kind":"x"}]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B13 links: a null element', $q$update public.network_experts set links = '[null]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B14 links: a url that is not a string', $q$update public.network_experts set links = '[{"url":5}]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B15 links: a javascript: url, a plain string, a nested array', $q$update public.network_experts set links = '[{"url":"javascript:alert(1)"}]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B16 links: a plain string element', $q$update public.network_experts set links = '["https://a.example"]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.okrun('B17 links: a well-formed one is fine', $q$update public.network_experts set links = '[{"kind":"other","url":"https://a.example/x"}]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2'$q$);
select v78_test.err('B18 website_url: javascript:', $q$update public.network_experts set website_url = 'javascript:alert(1)' where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B19 linkedin_url: data: / vbscript:', $q$update public.network_experts set linkedin_url = 'data:text/html,<script>1</script>' where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B20 linkedin_url: vbscript:', $q$update public.network_experts set linkedin_url = 'vbscript:msgbox(1)' where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.okrun('B21 a link without a scheme (the migrated shape) is still accepted', $q$update public.network_experts set linkedin_url = 'linkedin.com/in/v78-bare' where id = '00000000-0000-4000-8000-0000000078a2'$q$);
select v78_test.err('B22 a bad e-mail', $q$update public.network_experts set email = 'nope' where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B23 a name of 201 characters', $q$update public.network_experts set name_en = repeat('x', 201) where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B24 a photo outside the registry folder', $q$update public.network_experts set photo_path = 'global/hero/home-hero.webp' where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
select v78_test.err('B25 a photo that is not a uuid .webp', $q$update public.network_experts set photo_path = 'global/expert-photo/evil.webp' where id = '00000000-0000-4000-8000-0000000078a2'$q$, '23514');
update public.network_experts set linkedin_url = null, links = '[]'::jsonb where id = '00000000-0000-4000-8000-0000000078a2';

-- a hard DELETE through the API never orphans a list item
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select public.add_network_pick(:'la', '00000000-0000-4000-8000-0000000078a1') as it_a1 \gset
select v78_test.err('B26 a super_admin cannot hard-DELETE an expert a list item uses (the foreign key would have set the item NULL)', $q$delete from public.network_experts where id = '00000000-0000-4000-8000-0000000078a1'$q$, 'expert_in_use');
select v78_test.val('B27 ... the item still points at him', format($q$select (network_expert_id = '00000000-0000-4000-8000-0000000078a1')::text from public.list_items where id = %L$q$, :'it_a1'), 'true');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= C. the RPCs: photo path, links, the legacy link
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.err('C01 update_network_expert refuses a photo path of another folder (a global/ object that a super_admin would later delete)', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000078a2', '{"photo_path":"global/hero/home-hero.webp"}'::jsonb)$q$, 'photo_path:invalid');
select v78_test.err('C02 ... and create_network_expert too', $q$select public.create_network_expert('{"name_en":"V78 Photo","photo_path":"global/rvxcanary/rvx-canary.webp"}'::jsonb)$q$, 'photo_path:invalid');
select v78_test.err('C03 ... and a path that only ends in .webp', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000078a2', '{"photo_path":"a/b/c.webp"}'::jsonb)$q$, 'photo_path:invalid');
select v78_test.run('C04 a malformed links array is never stored: elements without a string url are dropped by the RPC', $q$select (public.update_network_expert('00000000-0000-4000-8000-0000000078a2', '{"links":[{"kind":"x"},{"url":5},null,{"url":"https://ok.example/a"}]}'::jsonb))::text$q$,
  $q$select links::text from public.network_experts where id = '00000000-0000-4000-8000-0000000078a2'$q$, '[{"url": "https://ok.example/a", "kind": "other"}]');
select v78_test.okrun('C05 the record with the scheme-less migrated link can still be saved (tags are replaced: the row is updated and the CHECK is not violated)', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000078a4', '[]'::jsonb)$q$);
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= D. a photo file is handed back for removal only when nothing else points at it
update public.network_experts set photo_path = 'global/expert-photo/00000000-0000-4000-8000-000000007801.webp' where id in ('00000000-0000-4000-8000-0000000078a1', '00000000-0000-4000-8000-0000000078a2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('D01 two records share one photo: replacing the photo of the FIRST hands nothing back (the other still shows it)', $q$select coalesce(public.update_network_expert('00000000-0000-4000-8000-0000000078a1', '{"photo_path":"global/expert-photo/00000000-0000-4000-8000-000000007802.webp"}'::jsonb)->>'old_photo_path', 'NULL')$q$, 'NULL');
select v78_test.val('D02 ... replacing it on the SECOND (now the only holder) hands the path back for removal', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000078a2', '{"photo_path":"global/expert-photo/00000000-0000-4000-8000-000000007803.webp"}'::jsonb)->>'old_photo_path'$q$, 'global/expert-photo/00000000-0000-4000-8000-000000007801.webp');
select v78_test.val('D03 clearing a photo that only this record has hands it back', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000078a2', '{"photo_path":null}'::jsonb)->>'old_photo_path'$q$, 'global/expert-photo/00000000-0000-4000-8000-000000007803.webp');
select v78_test.val('D04 an update that does not touch the photo hands nothing back', $q$select coalesce(public.update_network_expert('00000000-0000-4000-8000-0000000078a2', '{"title_en":"d04"}'::jsonb)->>'old_photo_path', 'NULL')$q$, 'NULL');
reset role; select set_config('request.jwt.claims', '', true);

-- storage: the PM removes an unreferenced expert photo, not one a record shows; SVG / foreign mimetypes are refused; a webp is accepted
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-000000007802.webp', null, null, '{"mimetype":"image/webp"}'),
  ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-000000007802_t.webp', null, null, '{"mimetype":"image/webp"}'),
  ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000078f9.webp', null, null, '{"mimetype":"image/webp"}'),
  ('public-assets', 'global/rvxcanary/rvx-canary.webp', null, null, '{"mimetype":"image/webp"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
reset role; select set_config('request.jwt.claims', '', true);
-- (Storage refuses a direct SQL DELETE on storage.objects: the end-to-end removal through the Storage API is proven by db/verify/v78_storage.mjs; here the rule the delete policy applies)
select v78_test.val('D05 the photo (and its thumbnail) of a record that still shows it is IN USE: the delete policy refuses it', $q$select app_private.expert_photo_in_use('global/expert-photo/00000000-0000-4000-8000-000000007802.webp')::text || '/' || app_private.expert_photo_in_use('global/expert-photo/00000000-0000-4000-8000-000000007802_t.webp')::text$q$, 'true/true');
select v78_test.val('D06 an unreferenced photo is not in use: the policy lets a staff member remove it', $q$select app_private.expert_photo_in_use('global/expert-photo/00000000-0000-4000-8000-0000000078f9.webp')::text$q$, 'false');
select v78_test.val('D07 the delete policy only matches the registry folder (any other object of the bucket is out of reach for a project manager)', $q$select ('global/rvxcanary/rvx-canary.webp' ~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$')::text$q$, 'false');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.err('D08 an SVG (or any non-webp mimetype) cannot be stored under the expert-photo path', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000078e1.webp', '00000000-0000-4000-8000-00000000e782', '00000000-0000-4000-8000-00000000e782', '{"mimetype":"image/svg+xml"}')$q$, '42501');
select v78_test.err('D09 text/html neither', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000078e2.webp', '00000000-0000-4000-8000-00000000e782', '00000000-0000-4000-8000-00000000e782', '{"mimetype":"text/html"}')$q$, '42501');
select v78_test.okrun('D10 a webp is accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', 'global/expert-photo/00000000-0000-4000-8000-0000000078e3.webp', '00000000-0000-4000-8000-00000000e782', '00000000-0000-4000-8000-00000000e782', '{"mimetype":"image/webp"}')$q$);
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= E. the duplicate engine: the SAME answers as the old full scan, on the real records + a corpus, and the finder reads a table
insert into public.network_experts (kind, name_en, name_ar, email, linkedin_url)
select 'expert',
  (array['Ahmed','Mohamed','Mahmoud','Mostafa','Omar','Ali','Hassan','Khaled','Tarek','Karim','Amr','Sara','Nour','Hana','Laila','Dina'])[1 + (abs(hashtext('a' || i)) % 16)] || ' ' ||
  (array['Hassan','Ibrahim','Farouk','Nabil','Salem','Fathy','Mansour','Gaber','Zaki','Rashad','Elbehery','Elsherif','Nageeb','Ismail'])[1 + (abs(hashtext('b' || i)) % 14)] || ' v78e' || (i % 40),
  case when i % 6 = 0 then 'اسم ' || md5(i::text) end,
  case when i % 7 = 0 then 'zz-v78e-' || (i % 20) || '@example.invalid' end,
  case when i % 5 = 0 then 'https://www.linkedin.com/in/zz-v78e-' || (i % 25) || '/' end
from generate_series(1, 150) i;
insert into public.network_experts (kind, name_en, name_ar) values ('expert', 'Osama  Nageeb', null), ('expert', null, 'محمد البحيري'), ('expert', 'Muhammad Elbehery', null), ('team', 'V78 Team Person', null);
create table v78_test.probes as select name_en, name_ar, email, linkedin_url, kind from public.network_experts order by name_en nulls last, id limit 120;
insert into v78_test.probes values ('Mohamad Hassan Ibrahim', null, null, null, 'expert'), (null, 'محمد حسن', null, null, 'expert'), ('osama nagib', null, null, null, 'expert'), ('X', null, null, null, 'expert'),
  (null, null, 'zz-v78e-5@example.invalid', null, 'expert'), (null, null, null, 'linkedin.com/in/zz-v78e-6', 'expert'), ('Mohamed Elbehery', null, null, null, 'expert'), (null, 'نبيل', null, null, 'expert');
select v78_test.val('E01 find: the new engine equals the old full scan for every probe (p_min 0.6, 50 rows)', $q$select count(*)::text from (
  select p.*, (select string_agg(id::text || ':' || score || ':' || array_to_string(reasons, ','), ';' order by score desc, id) from v78_test.old_find(p.name_en, p.name_ar, p.email, p.linkedin_url, p.kind, null, 0.6, 50)) o,
              (select string_agg(id::text || ':' || score || ':' || array_to_string(reasons, ','), ';' order by score desc, id) from app_private.expert_find_similar(p.name_en, p.name_ar, p.email, p.linkedin_url, p.kind, null, 0.6, 50)) n
    from v78_test.probes p) x where o is distinct from n$q$, '0');
select v78_test.val('E02 find: ... and at the blocking floor 0.95 (what create and import use)', $q$select count(*)::text from (
  select p.*, (select string_agg(id::text || ':' || score, ';' order by score desc, id) from v78_test.old_find(p.name_en, p.name_ar, p.email, p.linkedin_url, p.kind, null, 0.95, 5)) o,
              (select string_agg(id::text || ':' || score, ';' order by score desc, id) from app_private.expert_find_similar(p.name_en, p.name_ar, p.email, p.linkedin_url, p.kind, null, 0.95, 5)) n
    from v78_test.probes p) x where o is distinct from n$q$, '0');
select v78_test.val('E03 the probes really find things (the comparison is not empty)', $q$select (count(*) filter (where exists (select 1 from app_private.expert_find_similar(p.name_en, p.name_ar, p.email, p.linkedin_url, p.kind, null, 0.6, 5))) > 40)::text from v78_test.probes p$q$, 'true');
select v78_test.val('E04 the pairs table equals the old pair finder (pairs and scores and reasons; same kind only)', $q$select ((select count(*) from (select a, b, score, reasons from v78_test.old_pairs() except select a, b, score, reasons from app_private.network_expert_pairs) x)
  || '/' || (select count(*) from (select a, b, score, reasons from app_private.network_expert_pairs except select a, b, score, reasons from v78_test.old_pairs()) y))$q$, '0/0');
select v78_test.okrun('E05a a record is renamed to something unrelated', $q$update public.network_experts set name_en = 'Zz V78 Unrelated Name' where name_en = 'Muhammad Elbehery'$q$);
select v78_test.val('E05 a pair follows an edit of a name: the old pairs of the record are gone', $q$select count(*)::text from app_private.network_expert_pairs p join public.network_experts n on n.id in (p.a, p.b) where n.name_en = 'Zz V78 Unrelated Name'$q$, '0');
select v78_test.okrun('E06a ... and renamed back', $q$update public.network_experts set name_en = 'Muhammad Elbehery' where name_en = 'Zz V78 Unrelated Name'$q$);
select v78_test.val('E06 ... the pairs are back', $q$select (count(*) > 0)::text from app_private.network_expert_pairs p join public.network_experts n on n.id in (p.a, p.b) where n.name_en = 'Muhammad Elbehery'$q$, 'true');
update public.network_experts set deleted_at = now() where name_en = 'Muhammad Elbehery';
select v78_test.val('E07 a soft-deleted record has no pairs', $q$select count(*)::text from app_private.network_expert_pairs p join public.network_experts n on n.id in (p.a, p.b) where n.name_en = 'Muhammad Elbehery'$q$, '0');
update public.network_experts set deleted_at = null where name_en = 'Muhammad Elbehery';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('E08 the finder (super_admin) answers from the table: pairs come back ordered by score, the three real ones included', $q$select (r->'pairs'->0->>'score')::numeric >= (r->'pairs'->2->>'score')::numeric and jsonb_array_length(r->'pairs') >= 3 from (select public.list_expert_duplicate_pairs(200) r) s$q$, 'true');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.err('E09 a project manager cannot call the finder', $q$select public.list_expert_duplicate_pairs()$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);

-- performance: ~1000 records. The finder reads a table, a typed name costs milliseconds, a chunk of 100 import rows stays far below the 8 s API timeout
insert into public.network_experts (kind, name_en, name_ar, email, linkedin_url)
select 'expert',
  (array['Ahmed','Mohamed','Mahmoud','Mostafa','Omar','Ali','Hassan','Hussein','Ibrahim','Ismail','Khaled','Tarek','Karim','Youssef','Amr','Walid','Hossam','Sherif','Ayman','Adel','Sara','Nour','Hana','Laila','Dina','Rania','Mona','Heba','Amira','Salma'])[1 + (abs(hashtext('a' || i)) % 30)] || ' ' ||
  (array['Hassan','Ibrahim','Farouk','Nabil','Salem','Fathy','Mansour','Gaber','Zaki','Rashad','Soliman','Abbas','Elsayed','Mostafa','Hegazy','Darwish','Lotfy','Anwar','Fouad','Taha','Shaker','Wahba','Metwally','Sabry','Kamel','Badawy','Ghoneim','Sharaf','Tawfik','Younis'])[1 + (abs(hashtext('b' || i)) % 30)] || ' ' ||
  (array['Zayed','Khalil','Amin','Bakr','Eissa','Fahmy','Gad','Habib','Idris','Jaber','Kandil','Labib','Maher','Naguib','Othman','Qassem','Radwan','Saad','Tantawy','Wagdy'])[1 + (abs(hashtext('c' || i)) % 20)] || ' p' || i,
  case when i % 5 = 0 then 'اسم ' || md5((i * 7)::text) end,
  case when i % 6 = 0 then 'zz-v78p-' || i || '@example.invalid' end,
  case when i % 4 = 0 then 'https://www.linkedin.com/in/zz-v78p-' || i || '/' end
from generate_series(1, 850) i;
select count(*) as n_big from public.network_experts \gset
select v78_test.val('E10 the registry now holds ~1000 records', format($q$select (%s > 1000)::text$q$, :'n_big'), 'true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select clock_timestamp() as t0 \gset
select jsonb_array_length((public.list_expert_duplicate_pairs(60))->'pairs') as n_pairs \gset
select (extract(epoch from clock_timestamp() - :'t0'::timestamptz) < 2) as fast_pairs \gset
select v78_test.t('E11 the pair finder answers in under 2 s at ~1000 records (the old one: 18 s at 340)', :'fast_pairs'::boolean, 'pairs ' || :'n_pairs');
select clock_timestamp() as t0 \gset
select jsonb_array_length(public.find_similar_network_experts('Ahmed Hassan Zayed', null, null, null, null, 'expert', 6)) as n_hits \gset
select (extract(epoch from clock_timestamp() - :'t0'::timestamptz) < 1) as fast_find \gset
select v78_test.t('E12 a typed name is checked in under 1 s at ~1000 records', :'fast_find'::boolean, 'hits ' || :'n_hits');
select clock_timestamp() as t0 \gset
select (public.import_network_experts((select jsonb_agg(jsonb_build_object('name_en', 'V78 Chunk ' || md5(i::text) || ' Person', 'email', 'zz-v78c-' || i || '@example.invalid')) from generate_series(1, 100) i), true))->'counts'->>'new' as n_new \gset
select (extract(epoch from clock_timestamp() - :'t0'::timestamptz) < 3) as fast_import \gset
select v78_test.t('E13 the preview of a chunk of 100 import rows takes under 3 s at ~1000 records', :'fast_import'::boolean, 'new ' || :'n_new');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= F. merge: withdrawn is PROJECT-WIDE; the redirect inherits; the tag cap; the audit keeps what a collapse drops
insert into public.network_experts (id, kind, name_en) values
  ('00000000-0000-4000-8000-0000000078c1', 'expert', 'V78 Merge Keep One'), ('00000000-0000-4000-8000-0000000078c2', 'expert', 'V78 Merge Drop One'),
  ('00000000-0000-4000-8000-0000000078c3', 'expert', 'V78 Merge Keep Two'), ('00000000-0000-4000-8000-0000000078c4', 'expert', 'V78 Merge Drop Two'),
  ('00000000-0000-4000-8000-0000000078c5', 'expert', 'V78 Merge Keep Three'), ('00000000-0000-4000-8000-0000000078c6', 'expert', 'V78 Merge Zebra'),
  ('00000000-0000-4000-8000-0000000078c7', 'expert', 'V78 Merge Keep Four'), ('00000000-0000-4000-8000-0000000078c8', 'expert', 'V78 Merge Drop Four'),
  ('00000000-0000-4000-8000-0000000078c9', 'expert', 'V78 Merge Keep Five'), ('00000000-0000-4000-8000-0000000078ca', 'expert', 'V78 Merge Drop Five');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
-- (a) K1 withdrawn in list LA, D1 active in ANOTHER list LB of the same project
select public.add_network_pick(:'la', '00000000-0000-4000-8000-0000000078c1') as ik1 \gset
select public.add_network_pick(:'lb', '00000000-0000-4000-8000-0000000078c2') as id1 \gset
select public.set_item_withdrawn(:'ik1', true) is not null as _w1 \gset
select v78_test.val('F01 withdrawn in one LIST and active in ANOTHER list of the same project is a blocker (dry run)', $q$select (r->>'blocked') || '/' || (r->'blockers'->>0) from (select public.merge_network_experts('00000000-0000-4000-8000-0000000078c1', '00000000-0000-4000-8000-0000000078c2') r) s$q$, 'true/withdrawn_mismatch');
select v78_test.err('F02 ... and the real run is refused', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000078c1', '00000000-0000-4000-8000-0000000078c2', false)$q$, 'withdrawn_mismatch');
select v78_test.val('F03 ... the reverse (the DUPLICATE is withdrawn, the kept record is active) too', $q$select (r->'blockers'->>0) from (select public.merge_network_experts('00000000-0000-4000-8000-0000000078c2', '00000000-0000-4000-8000-0000000078c1') r) s$q$, 'withdrawn_mismatch');
select v78_test.val('F04 a refused merge changed nothing: both records are live, the duplicate item is still in LB', format($q$select (select count(*) from public.network_experts where id in ('00000000-0000-4000-8000-0000000078c1', '00000000-0000-4000-8000-0000000078c2') and deleted_at is null)::text || '/' || (select network_expert_id::text from public.list_items where id = %L)$q$, :'id1'), '2/00000000-0000-4000-8000-0000000078c2');
select public.set_item_withdrawn(:'id1', true) is not null as _w2 \gset
select v78_test.val('F05 withdrawn on BOTH sides (the same project-wide fact) is not a blocker', $q$select (r->>'blocked') from (select public.merge_network_experts('00000000-0000-4000-8000-0000000078c1', '00000000-0000-4000-8000-0000000078c2') r) s$q$, 'false');
-- (b) K2 withdrawn project-wide; a stale picker adds the merged duplicate
select public.add_network_pick(:'la', '00000000-0000-4000-8000-0000000078c3') as ik2 \gset
select public.set_item_withdrawn(:'ik2', true) is not null as _w3 \gset
select v78_test.okrun('F06 the unused zebra is merged into the withdrawn K3', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000078c3', '00000000-0000-4000-8000-0000000078c6', false)$q$);
select public.add_network_pick(:'lb', '00000000-0000-4000-8000-0000000078c6') as iz \gset
select v78_test.val('F07 a stale picker adds the merged zebra: the item lands on the KEPT record and inherits ITS withdrawal', format($q$select (network_expert_id = '00000000-0000-4000-8000-0000000078c3')::text || '/' || (withdrawn_at is not null)::text from public.list_items where id = %L$q$, :'iz'), 'true/true');
-- tag cap
reset role; select set_config('request.jwt.claims', '', true);
insert into public.expert_tags (id, tag_key, name_en) select ('00000000-0000-4000-8000-00000078d' || lpad(i::text, 3, '0'))::uuid, 'v78 cap tag ' || i, 'V78 Cap Tag ' || i from generate_series(1, 20) i;
insert into public.network_expert_tags (expert_id, tag_id) select '00000000-0000-4000-8000-0000000078c5', ('00000000-0000-4000-8000-00000078d' || lpad(i::text, 3, '0'))::uuid from generate_series(1, 10) i;
-- the tag test uses its own duplicate (the zebra was merged above)
insert into public.network_experts (id, kind, name_en) values ('00000000-0000-4000-8000-0000000078cb', 'expert', 'V78 Tag Drop');
insert into public.network_expert_tags (expert_id, tag_id) select '00000000-0000-4000-8000-0000000078cb', ('00000000-0000-4000-8000-00000078d' || lpad(i::text, 3, '0'))::uuid from generate_series(11, 20) i;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('F08 the tag union is capped at 12 (dry run says how many are left out)', $q$select (r->'impact'->>'tags_added') || '/' || (r->'impact'->>'tags_dropped') from (select public.merge_network_experts('00000000-0000-4000-8000-0000000078c5', '00000000-0000-4000-8000-0000000078cb') r) s$q$, '2/8');
select v78_test.okrun('F09 the merge runs', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000078c5', '00000000-0000-4000-8000-0000000078cb', false)$q$);
reset role; select set_config('request.jwt.claims', '', true);
select v78_test.val('F10 the kept record has 12 tags (so a later save of its tag list is not refused with too_many); the audit lists the duplicate''s 10', $q$select (select count(*) from public.network_expert_tags where expert_id = '00000000-0000-4000-8000-0000000078c5')::text || '/' || (select jsonb_array_length(plan->'drop_tags')::text from app_private.network_expert_merges where drop_id = '00000000-0000-4000-8000-0000000078cb')$q$, '12/10');
-- the audit keeps the dependent rows that a collapse drops; the collapsed provider keeps is_active
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select public.add_network_pick(:'ld', '00000000-0000-4000-8000-0000000078c7') as ik4 \gset
select public.add_network_pick(:'ld', '00000000-0000-4000-8000-0000000078c8') as id4 \gset
reset role; select set_config('request.jwt.claims', '', true);
insert into public.distribution_mentor_rules (node_id, mentor_item_id, project_id, room) values (:'da', :'ik4', :'ja', 'Room K'), (:'da', :'id4', :'ja', 'Room D');
insert into public.booking_providers (project_id, node_id, list_item_id, is_active, sort_order) values (:'ja', :'ba', :'ik4', false, null), (:'ja', :'ba', :'id4', true, 7);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.okrun('F11 the two experts that share the list LD collapse into one item', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000078c7', '00000000-0000-4000-8000-0000000078c8', false)$q$);
reset role; select set_config('request.jwt.claims', '', true);
select v78_test.val('F12 the audit keeps the duplicate item, its mentor rule and its booking provider (nothing is lost)', $q$select jsonb_array_length(plan->'dropped_rows'->'list_items')::text || '/' || jsonb_array_length(plan->'dropped_rows'->'mentor_rules')::text || '/' || jsonb_array_length(plan->'dropped_rows'->'booking_providers')::text
  from app_private.network_expert_merges where drop_id = '00000000-0000-4000-8000-0000000078c8'$q$, '1/1/1');
select v78_test.val('F13 the collapsed provider keeps what the duplicate had: active, and the sort order', format($q$select is_active::text || '/' || coalesce(sort_order::text, 'NULL') from public.booking_providers where list_item_id = %L$q$, :'ik4'), 'true/7');
-- the audit also lists the photo of a before-image as "in use": a merge before-image keeps its photo
update public.network_experts set photo_path = 'global/expert-photo/00000000-0000-4000-8000-000000007811.webp' where id = '00000000-0000-4000-8000-0000000078c9';
update public.network_experts set photo_path = 'global/expert-photo/00000000-0000-4000-8000-000000007812.webp' where id = '00000000-0000-4000-8000-0000000078ca';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.okrun('F14 merge with the duplicate''s photo chosen', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000078c9', '00000000-0000-4000-8000-0000000078ca', false, '{"photo_path":"drop"}'::jsonb)$q$);
select v78_test.val('F15 replacing the kept record''s photo afterwards hands nothing back: the duplicate row and the merge before-image still point at the old file', $q$select coalesce(public.update_network_expert('00000000-0000-4000-8000-0000000078c9', '{"photo_path":"global/expert-photo/00000000-0000-4000-8000-000000007813.webp"}'::jsonb)->>'old_photo_path', 'NULL')$q$, 'NULL');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= G. participation: a legacy HIDDEN item counts only with a real role, and is flagged
insert into public.network_experts (id, kind, name_en) values ('00000000-0000-4000-8000-0000000078d1', 'expert', 'V78 Hidden Person');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select public.add_network_pick(:'lc', '00000000-0000-4000-8000-0000000078d1') as ih \gset
reset role; select set_config('request.jwt.claims', '', true);
update public.list_items set excluded = true where id = :'ih';
select v78_test.val('G01 a hidden item that is only "listed" is NOT a participation (flagged, not counted)', format($q$select (counted::text || '/' || hidden::text) from app_private.expert_participation('00000000-0000-4000-8000-0000000078d1') where item_id = %L$q$, :'ih'), 'false/true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select (public.add_node(:'j2', 'booking', '{"en":"V78 Booking J2"}', 0, 0, '{"mode":"mentor"}')).id as bj2 \gset
reset role; select set_config('request.jwt.claims', '', true);
insert into public.booking_providers (project_id, node_id, list_item_id) values (:'j2', :'bj2', :'ih');
select v78_test.val('G02 the same hidden item, once it is a booking provider (a real role), IS counted - and still flagged hidden', format($q$select counted::text || '/' || hidden::text || '/' || is_provider::text from app_private.expert_participation('00000000-0000-4000-8000-0000000078d1') where item_id = %L$q$, :'ih'), 'true/true/true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('G03 the profile totals count it and flag it on its row; the list counts agree', $q$select (r->'totals'->>'lists') || '/' || (r->'participation'->0->>'item_hidden') || '/' || (r->'participation'->0->>'counted') || '/' || ((public.list_network_experts('{"q":"v78 hidden person"}'::jsonb))->'rows'->0->>'lists_count')
  from (select public.get_network_expert('00000000-0000-4000-8000-0000000078d1') r) s$q$, '1/true/true/1');
reset role; select set_config('request.jwt.claims', '', true);
delete from public.booking_providers where list_item_id = :'ih';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('G04 ... and without the provider it is not counted again (the profile says 0 lists, 1 hidden item that is not counted)', $q$select (r->'totals'->>'lists') || '/' || (r->'totals'->>'hidden_not_counted') from (select public.get_network_expert('00000000-0000-4000-8000-0000000078d1') r) s$q$, '0/1');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= H. tags: only a super_admin brings an archived tag back; a call creates at most 50 new tags
insert into public.expert_tags (id, tag_key, name_en, archived_at) values ('00000000-0000-4000-8000-00000078e001', 'v78 archived tag', 'V78 Archived Tag', now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.err('H01 a project manager typing the name of an ARCHIVED tag does not bring it back', $q$select public.create_network_expert('{"name_en":"V78 Tagged One","tags":["V78 Archived Tag"]}'::jsonb)$q$, 'tags:archived');
select v78_test.val('H02 ... the tag is still archived', $q$select (archived_at is not null)::text from public.expert_tags where tag_key = 'v78 archived tag'$q$, 'true');
select v78_test.val('H03 an import of 5 rows with 12 NEW tags each creates 4 rows and refuses the 5th (50 new tags per call at most)', $q$select (r->'counts'->>'created') || '/' || (r->'counts'->>'invalid') || '/' || (r->'rows'->4->>'error') from (select public.import_network_experts((select jsonb_agg(jsonb_build_object('name_en', 'V78 Tagimp ' || r, 'tags', (select jsonb_agg('V78 Newtag ' || r || '-' || t) from generate_series(1, 12) t))) from generate_series(1, 5) r), false) r) s$q$, '4/1/tags:too_many_new');
reset role; select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.okrun('H04 a super_admin typing it brings it back', $q$select public.create_network_expert('{"name_en":"V78 Tagged Two","tags":["V78 Archived Tag"]}'::jsonb)$q$);
select v78_test.val('H05 ... and the tag is active again', $q$select (archived_at is null)::text from public.expert_tags where tag_key = 'v78 archived tag'$q$, 'true');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= I. import: the preview sees repeats INSIDE the file, also across chunks (p_seen)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select public.import_network_experts('[{"name_en":"V78 Imp Alpha Xq"},{"name_en":"v78  imp alpha xq"},{"name_ar":"محمد اختبار كويز"},{"name_ar":"محمد اختبار كويز"},{"name_en":"V78 Imp Beta Xq","email":"v78-imp@example.invalid"},{"name_en":"V78 Imp Gamma Xq","email":"V78-IMP@example.invalid"},{"name_en":"V78 Imp Delta Xq","linkedin_url":"https://linkedin.com/in/v78-imp-delta"},{"name_en":"V78 Imp Eps Xq","linkedin_url":"http://www.linkedin.com/in/V78-imp-delta/"},{"name_en":"V78 Imp Name Xq","name_ar":"محمد اختبار كويز"}]'::jsonb, true) as imp \gset
select v78_test.val('I01 the dry run marks the repeats of the same file (same name, same Arabic name, same e-mail, same LinkedIn): new / dup / new / dup / new / dup / new / dup / dup', format($q$select string_agg(left(x->>'status', 1) || coalesce(case when (x->>'in_file')::boolean then '*' end, ''), ',' order by (x->>'index')::int) from jsonb_array_elements(%L::jsonb->'rows') x$q$, :'imp'), 'n,d*,n,d*,n,d*,n,d*,d*');
select v78_test.val('I02 the counts agree with the rows: 4 new, 5 duplicates', format($q$select (%L::jsonb->'counts'->>'new') || '/' || (%L::jsonb->'counts'->>'duplicate')$q$, :'imp', :'imp'), '4/5');
select (:'imp'::jsonb->'seen')::text as seen \gset
select v78_test.val('I03 a SECOND chunk with the keys of the first (p_seen) still reports a repeat across chunks', format($q$select (r->'rows'->0->>'status') || '/' || (r->'rows'->0->>'in_file') || '/' || (r->'rows'->1->>'status') from (select public.import_network_experts('[{"name_en":"V78 IMP alpha xq"},{"name_en":"V78 Imp Fresh Xq"}]'::jsonb, true, 'skip', %L::jsonb) r) s$q$, :'seen'), 'duplicate/true/new');
select v78_test.val('I04 without p_seen the same chunk does not know the first one (that is why the client passes it)', $q$select (r->'rows'->0->>'status') from (select public.import_network_experts('[{"name_en":"V78 IMP alpha xq"}]'::jsonb, true) r) s$q$, 'new');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= J. small ones: the offset, the usage function, the search text, the delete lock
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('J01 a huge offset / limit does not overflow (it used to raise 22003)', $q$select ((public.list_network_experts('{}'::jsonb, 'name', 'asc', 2147483647, 2147483647))->>'limit')$q$, '200');
select v78_test.val('J02 network_expert_usage returns the projects the caller manages (the member PM sees the project of the list item)', $q$select count(*)::text from public.network_expert_usage('00000000-0000-4000-8000-0000000078a1')$q$, '1');
reset role; select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e783","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('J03 ... and a project manager of ANOTHER program sees nothing (it used to return the ids across all programs)', $q$select count(*)::text from public.network_expert_usage('00000000-0000-4000-8000-0000000078a1')$q$, '0');
reset role; select set_config('request.jwt.claims', '', true);
select v78_test.val('J04 the search text carries the LinkedIn HANDLE only: "linkedin" / "com" no longer match a record that only has a link', $q$select (search_text like '%linkedin%' or search_text like '% com %')::text || '/' || (search_text like '%v78 alpha handle%')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000078a1'$q$, 'false/true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e782","role":"authenticated"}', true);
set local role authenticated;
select v78_test.val('J05 ... so a search for "linkedin" finds none of the fixture records, a search for the handle finds him', $q$select (select (public.list_network_experts('{"q":"linkedin"}'::jsonb))->>'total' from (select 1) z) || '/' || ((public.list_network_experts('{"q":"v78 alpha handle"}'::jsonb))->>'total')$q$, '0/1');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e780","role":"authenticated"}', true);
set local role authenticated;
select v78_test.err('J06 delete_network_expert still refuses an expert a list uses', $q$select public.delete_network_expert('00000000-0000-4000-8000-0000000078a1')$q$, 'expert_in_use');
select v78_test.okrun('J07 ... and soft-deletes one nobody uses', $q$select public.delete_network_expert('00000000-0000-4000-8000-0000000078a4')$q$);
reset role; select set_config('request.jwt.claims', '', true);
select v78_test.val('J08 the invariant of m77 J01 still holds after all of this: no list item points at a soft-deleted expert', $q$select count(*)::text from public.list_items li join public.network_experts ne on ne.id = li.network_expert_id where ne.deleted_at is not null$q$, '0');

-- ================================================================= final state check
select current_setting('v78.res', true) as res \gset
rollback;
select count(*) as n_experts from public.network_experts \gset
select count(*) as n_ghosts from public.network_experts where name_en like 'V78%' or name_en like '%v78%' or name_ar like '%اختبار%' \gset
select count(*) as n_tags from public.expert_tags where tag_key like 'v78%' \gset
select count(*) as n_audit from app_private.network_expert_merges where keep_name like 'V78%' \gset
select count(*) as n_pairs from app_private.network_expert_pairs \gset
select count(*) as n_objects from storage.objects where bucket_id = 'public-assets' and (name like 'global/expert-photo/00000000-0000-4000-8000-0000000078%' or name like 'global/expert-photo/00000000-0000-4000-8000-00000000780%' or name = 'global/rvxcanary/rvx-canary.webp') \gset
select (:n_experts = 44 and :n_ghosts = 0 and :n_tags = 0 and :n_audit = 0 and :n_pairs = 3 and :n_objects = 0) as state_ok \gset

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or not (:'state_ok')::boolean) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v78: network experts review-fix tests FAILED'; end $$;
\endif
