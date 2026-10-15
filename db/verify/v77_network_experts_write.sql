-- v77_network_experts_write  (m77: create / update / tags / archive / delete / restore / merge / import of the experts registry)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
-- Fixture: users ADM (super_admin e770), AM (alumni_manager e771), PM (project_manager, program member e772), F (founder e773).
--   Program PA with project JA; lists LA / LB / LC / LX; a distribution node DA and a booking node BA; experts K (keep) and D (drop) that overlap in LA (collapse), D alone in LB (move), K alone in LC.
-- NEVER call an app_private helper while the session role is anon / authenticated; anon is asserted with has_function_privilege.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v77.res', '', false) \gset

begin;
create schema v77_test;
grant usage on schema v77_test to public;
create or replace function v77_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v77.res', current_setting('v77.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || replace(coalesce(p_detail, ''), E'\n', ' ~ ') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v77_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v77_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v77_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v77_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v77_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v77_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect or coalesce(v_detail, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || '/' || coalesce(v_detail, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
create or replace function v77_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v77_test.t(p_key, true, 'ok');
  exception when others then
    perform v77_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- run(key, call, check, expected): the RPC runs as one statement; the state check is a SECOND statement (a statement does not see the rows a volatile function wrote inside it); $1 = the call's result
create or replace function v77_test.run(p_key text, p_call text, p_check text, p_expected text) returns void language plpgsql as $$
declare v_r text; v text;
begin
  begin
    execute p_call into v_r;
    execute p_check into v using v_r;
    perform v77_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v77_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v77_test.audit(p_drop uuid) returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(m) from app_private.network_expert_merges m where m.drop_id = p_drop order by m.merged_at desc limit 1
$$;
revoke all on all functions in schema v77_test from public;
grant execute on all functions in schema v77_test to anon, authenticated, service_role;

-- ================================================================= A. catalog
select v77_test.val('A01 the eleven write RPCs exist, SECURITY DEFINER, search_path empty', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and 'search_path=""' = any (p.proconfig)
  and p.proname in ('create_network_expert', 'update_network_expert', 'set_network_expert_tags', 'set_network_expert_archived', 'delete_network_expert', 'restore_network_expert', 'update_expert_tag', 'dismiss_expert_duplicate', 'merge_network_experts', 'import_network_experts', 'list_network_expert_merges')$q$, '11');
select v77_test.val('A02 anon executes none of them, authenticated all', $q$select (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))::text || '/' || (count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('create_network_expert', 'update_network_expert', 'set_network_expert_tags', 'set_network_expert_archived', 'delete_network_expert', 'restore_network_expert', 'update_expert_tag', 'dismiss_expert_duplicate', 'merge_network_experts', 'import_network_experts', 'list_network_expert_merges')$q$, '0/11');
select v77_test.val('A03 the helpers of m77 are closed to API roles', $q$select (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_clean', 'expert_upsert_tag', 'expert_set_tags')$q$, '0');

-- ================================================================= setup
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e770','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v77-adm@example.invalid','{"provisioned":true}','{"full_name":"V77 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e771','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v77-am@example.invalid','{"provisioned":true}','{"full_name":"V77 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e772','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v77-pm@example.invalid','{"provisioned":true}','{"full_name":"V77 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e773','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v77-f@example.invalid','{"provisioned":true}','{"full_name":"V77 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e770','super_admin'), ('00000000-0000-4000-8000-00000000e771','alumni_manager'),
  ('00000000-0000-4000-8000-00000000e772','project_manager'), ('00000000-0000-4000-8000-00000000e773','founder');
-- the merge pair K (keep) / D (drop) and a team member T
insert into public.network_experts (id, kind, name_en, name_ar, title_en, company_en, bio_en, photo_path, linkedin_url, email, phone, languages, links, notes) values
  ('00000000-0000-4000-8000-0000000077a1', 'expert', 'V77 Keep Person', null, 'Keep title', null, null, null, 'https://www.linkedin.com/in/v77-person/', null, null, array['en'], '[{"kind":"other","url":"https://k.example/a"}]', 'keep note'),
  ('00000000-0000-4000-8000-0000000077a2', 'expert', 'V77 Drop Person', 'شخص الدمج', 'Drop title', 'Drop Co', 'Drop bio', 'global/expert-photo/00000000-0000-4000-8000-0000000077f2.webp', 'https://linkedin.com/in/v77-person', 'v77-drop@example.invalid', '+20 100 000 7777', array['ar','en'], '[{"kind":"other","url":"https://k.example/a"},{"kind":"other","url":"https://d.example/b"}]', 'drop note'),
  ('00000000-0000-4000-8000-0000000077a3', 'team', 'V77 Team Member', null, null, null, null, null, null, 'v77-team@example.invalid', null, '{}', '[]', null);
insert into public.network_experts (id, kind, name_en) values ('00000000-0000-4000-8000-0000000077a9', 'expert', 'Nabil Haddad');
insert into public.expert_tags (id, tag_key, name_en, name_ar) values ('00000000-0000-4000-8000-0000000077d1', 'v77 tag one', 'V77 Tag One', 'وسم واحد'), ('00000000-0000-4000-8000-0000000077d2', 'v77 tag two', 'V77 Tag Two', null) on conflict do nothing;
insert into public.network_expert_tags (expert_id, tag_id) values ('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077d1'), ('00000000-0000-4000-8000-0000000077a2', '00000000-0000-4000-8000-0000000077d1'), ('00000000-0000-4000-8000-0000000077a2', '00000000-0000-4000-8000-0000000077d2');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V77 Program A', 'برنامج', null, null, null, null)).id as pa \gset
select (public.create_project(:'pa', 'V77 Project A', null, 'Africa/Cairo')).id as ja \gset
select (public.add_node(:'ja', 'list', '{"en":"V77 LA"}', 0, 0, '{"subkind":"expert"}')).id as la \gset
select (public.add_node(:'ja', 'list', '{"en":"V77 LB"}', 0, 0, '{"subkind":"expert"}')).id as lb \gset
select (public.add_node(:'ja', 'list', '{"en":"V77 LC"}', 0, 0, '{"subkind":"expert"}')).id as lc \gset
select (public.add_node(:'ja', 'list', '{"en":"V77 LX"}', 0, 0, '{"subkind":"expert"}')).id as lx \gset
select (public.add_node(:'ja', 'list', '{"en":"V77 Companies"}', 0, 0, '{"subkind":"company"}')).id as lco \gset
select (public.add_node(:'ja', 'distribution', '{"en":"V77 Mentoring"}', 0, 0, '{}')).id as da \gset
select (public.add_node(:'ja', 'booking', '{"en":"V77 Booking"}', 0, 0, '{"mode":"mentor"}')).id as ba \gset
select public.add_network_pick(:'la', '00000000-0000-4000-8000-0000000077a1') as ik_a \gset
select public.add_network_pick(:'la', '00000000-0000-4000-8000-0000000077a2') as id_a \gset
select public.add_network_pick(:'lb', '00000000-0000-4000-8000-0000000077a2') as id_b \gset
select public.add_network_pick(:'lc', '00000000-0000-4000-8000-0000000077a1') as ik_c \gset
select public.add_network_pick(:'lx', '00000000-0000-4000-8000-0000000077a3') as it_x \gset
select public.add_manual_item(:'lco', '{"title_en":"V77 Co 1"}') as c1 \gset
select public.add_manual_item(:'lco', '{"title_en":"V77 Co 2"}') as c2 \gset
select public.add_manual_item(:'lco', '{"title_en":"V77 Co 3"}') as c3 \gset
reset role; select set_config('request.jwt.claims', '', true);
insert into public.program_members (program_id, user_id) values (:'pa', '00000000-0000-4000-8000-00000000e772');
update public.list_items set overlay = '{"role":"Keynote","card":{"show":{"show_bio":false}}}'::jsonb, status = null where id = :'ik_a';
update public.list_items set overlay = '{"role":"Trainer","note":"from drop"}'::jsonb, status = 'confirmed' where id = :'id_a';
insert into public.distribution_days (project_id, node_id, day_index, day_date, start_time, total_round_min, slot_duration_min, gap_min) values (:'ja', :'da', 0, '2026-11-01', '10:00', 60, 20, 0) returning id as dd \gset
insert into public.distribution_sessions (project_id, node_id, day_id, slot_index, mentor_item_id, company_item_id) values
  (:'ja', :'da', :'dd', 0, :'ik_a', :'c1'), (:'ja', :'da', :'dd', 1, :'id_a', :'c2'), (:'ja', :'da', :'dd', 2, :'id_a', :'c3');
insert into public.distribution_day_mentors (day_id, mentor_item_id, project_id) values (:'dd', :'ik_a', :'ja'), (:'dd', :'id_a', :'ja');
insert into public.distribution_mentor_rules (node_id, mentor_item_id, project_id, room) values (:'da', :'ik_a', :'ja', 'Room K'), (:'da', :'id_a', :'ja', 'Room D');
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email) values (:'ja', :'ba', :'ik_a', null) returning id as pvk \gset
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email, advance_notice_min) values (:'ja', :'ba', :'id_a', 'v77-book@example.invalid', 90) returning id as pvd \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja', :'ba', :'pvk', '2026-11-02 08:00+00', '2026-11-02 08:20+00') returning id as sk1 \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja', :'ba', :'pvd', '2026-11-02 09:00+00', '2026-11-02 09:20+00') returning id as sd1 \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja', :'ba', :'pvd', '2026-11-02 10:00+00', '2026-11-02 10:20+00') returning id as sd2 \gset
insert into public.bookings (project_id, node_id, slot_id, status, booker_email) values (:'ja', :'ba', :'sk1', 'confirmed', 'zz-v77-b1@example.invalid'), (:'ja', :'ba', :'sd1', 'confirmed', 'zz-v77-b2@example.invalid'), (:'ja', :'ba', :'sd2', 'confirmed', 'zz-v77-b3@example.invalid');

-- ================================================================= B. create
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e772","role":"authenticated"}', true);
set local role authenticated;
select v77_test.run('B01 a PM creates an expert; whitespace collapses, the e-mail is lower-cased, languages are de-duplicated, tags come by name', $q$select (public.create_network_expert('{"name_en":"  V77  New\tPerson ","title_en":"  Head   of Things ","email":" V77-NEW@Example.COM ","languages":["AR","en","ar"],"tags":["V77 Fresh Tag","v77  fresh tag", {"name_ar":"وسم جديد"}, "00000000-0000-4000-8000-0000000077d1"],"notes":"hello"}'::jsonb))::text$q$,
  $q$select ($1::jsonb->>'created') || '/' || (select name_en || '|' || title_en || '|' || email || '|' || array_to_string(languages, ',') || '|' || (select count(*) from public.network_expert_tags where expert_id = ($1::jsonb->>'id')::uuid) from public.network_experts where id = ($1::jsonb->>'id')::uuid)$q$,
  'true/V77 New Person|Head of Things|v77-new@example.com|ar,en|3');
select v77_test.val('B02 created_by is the PM and the search columns were derived', $q$select (created_by = '00000000-0000-4000-8000-00000000e772')::text || '/' || (search_text like '%v77 new person%')::text from public.network_experts where name_en = 'V77 New Person'$q$, 'true/true');
select v77_test.val('B03 the same name again is a BLOCKING duplicate: nothing is created, the match comes back', $q$select (r->>'created') || '/' || (r->'duplicates'->0->'reasons'->>0) || '/' || (select count(*) from public.network_experts where name_en = 'V77 New Person') from (select public.create_network_expert('{"name_en":"v77 new person"}'::jsonb) r) s$q$, 'false/same_name/1');
select v77_test.run('B04 with p_force the duplicate is created', $q$select (public.create_network_expert('{"name_en":"V77 New Person"}'::jsonb, true))::text$q$, $q$select ($1::jsonb->>'created') || '/' || (select count(*) from public.network_experts where name_en = 'V77 New Person')$q$, 'true/2');
select v77_test.val('B05 the same LinkedIn link blocks too (any spelling)', $q$select (r->>'created') || '/' || (r->'duplicates'->0->'reasons'->>0) from (select public.create_network_expert('{"name_en":"Completely Other","linkedin_url":"http://www.linkedin.com/in/V77-person/"}'::jsonb) r) s$q$, 'false/same_linkedin');
select v77_test.run('B06 a Latin / Arabic spelling of an existing name is only a WARNING for the server (not blocking): it is created, and the finder then reports it as same_name_translit', $q$select (public.create_network_expert('{"name_ar":"نبيل حداد"}'::jsonb))::text$q$,
  $q$select ($1::jsonb->>'created') || '/' || (select (x->'reasons'->>0) from jsonb_array_elements(public.find_similar_network_experts('Nabil Haddad')) x where x->'expert'->>'name_ar' = 'نبيل حداد')$q$, 'true/same_name_translit');
select v77_test.err('B07 a record without any name is refused', $q$select public.create_network_expert('{"title_en":"x"}'::jsonb)$q$, 'expert_invalid');
select v77_test.err('B08 an empty-string name in both languages is refused too', $q$select public.create_network_expert('{"name_en":"  ","name_ar":""}'::jsonb)$q$, 'expert_invalid');
select v77_test.err('B09 a bad e-mail is refused (detail names the field)', $q$select public.create_network_expert('{"name_en":"V77 Mail","email":"nope"}'::jsonb)$q$, 'email:invalid');
select v77_test.err('B10 a link that is not http(s) is refused (javascript: and friends)', $q$select public.create_network_expert('{"name_en":"V77 Link","linkedin_url":"javascript:alert(1)"}'::jsonb)$q$, 'linkedin_url:invalid');
select v77_test.err('B11 a phone with letters is refused', $q$select public.create_network_expert('{"name_en":"V77 Phone","phone":"call me"}'::jsonb)$q$, 'phone:invalid');
select v77_test.err('B12 a name over 200 characters is refused', $q$select public.create_network_expert(jsonb_build_object('name_en', repeat('x', 201)))$q$, 'name_en:too_long');
select v77_test.err('B13 a photo path that is not a lowercase WebP storage path is refused', $q$select public.create_network_expert('{"name_en":"V77 Photo","photo_path":"../../etc/passwd.webp"}'::jsonb)$q$, 'photo_path:invalid');
select v77_test.err('B14 a thumbnail path or a PNG is not a valid photo path', $q$select public.create_network_expert('{"name_en":"V77 Photo","photo_path":"global/expert-photo/abc.png"}'::jsonb)$q$, 'photo_path:invalid');
select v77_test.err('B15 more than 8 languages / 6 links / 12 tags are refused', $q$select public.create_network_expert('{"name_en":"V77 Many","languages":["ar","en","fr","de","es","it","tr","zh","ja"]}'::jsonb)$q$, 'languages:too_many');
select v77_test.err('B16 7 links', $q$select public.create_network_expert('{"name_en":"V77 Many","links":["https://a.io","https://b.io","https://c.io","https://d.io","https://e.io","https://f.io","https://g.io"]}'::jsonb)$q$, 'links:too_many');
select v77_test.err('B17 13 tags', $q$select public.create_network_expert(jsonb_build_object('name_en', 'V77 Many', 'tags', (select jsonb_agg('t' || i) from generate_series(1, 13) i)))$q$, 'tags:too_many');
select v77_test.err('B18 a bad kind is refused', $q$select public.create_network_expert('{"name_en":"V77 Kind","kind":"robot"}'::jsonb)$q$, 'kind:bad_value');
select v77_test.err('B19 a payload that is not an object is refused', $q$select public.create_network_expert('[1]'::jsonb)$q$, 'payload:bad_value');
select v77_test.err('B20 NULL payload is refused', $q$select public.create_network_expert(null)$q$, 'payload:bad_value');
select v77_test.run('B21 unknown keys are ignored (an attacker cannot set deleted_at / merged_into / archived_at / created_by through the payload)', $q$select (public.create_network_expert('{"name_en":"V77 Sneaky","deleted_at":"2020-01-01","merged_into":"00000000-0000-4000-8000-0000000077a1","archived_at":"2020-01-01","created_by":"00000000-0000-4000-8000-00000000e770"}'::jsonb))::text$q$,
  $q$select ($1::jsonb->>'created') || '/' || (select (deleted_at is null and merged_into is null and archived_at is null and created_by = '00000000-0000-4000-8000-00000000e772')::text from public.network_experts where id = ($1::jsonb->>'id')::uuid)$q$, 'true/true');
select v77_test.run('B22 an expert of the Athar team can be created too (kind team)', $q$select (public.create_network_expert('{"name_en":"V77 Staff Member","kind":"team"}'::jsonb))::text$q$, $q$select kind from public.network_experts where id = ($1::jsonb->>'id')::uuid$q$, 'team');
reset role; select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e771","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('B30 an alumni manager creates an expert too', $q$select (r->>'created') from (select public.create_network_expert('{"name_en":"V77 By Alumni Manager"}'::jsonb) r) s$q$, 'true');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e773","role":"authenticated"}', true);
set local role authenticated;
select v77_test.err('B31 a founder cannot create', $q$select public.create_network_expert('{"name_en":"V77 By Founder"}'::jsonb)$q$, '42501');
select v77_test.err('B32 a founder cannot update', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a1', '{"title_en":"x"}'::jsonb)$q$, '42501');
select v77_test.err('B33 a founder cannot archive', $q$select public.set_network_expert_archived('00000000-0000-4000-8000-0000000077a1', true)$q$, '42501');
select v77_test.err('B34 a founder cannot import', $q$select public.import_network_experts('[{"name_en":"x"}]'::jsonb)$q$, '42501');
select v77_test.err('B35 a founder cannot set tags', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a1', '[]'::jsonb)$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select v77_test.val('B36 anon executes none of the write RPCs (catalog; m78: the import has a 4th argument p_seen)', $q$select (not has_function_privilege('anon', 'public.create_network_expert(jsonb,boolean)', 'EXECUTE') and not has_function_privilege('anon', 'public.merge_network_experts(uuid,uuid,boolean,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.import_network_experts(jsonb,boolean,text,jsonb)', 'EXECUTE'))::text$q$, 'true');

-- ================================================================= C. update (patch semantics, stale token, kind rule, photo hand-back, tags)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e772","role":"authenticated"}', true);
set local role authenticated;
select updated_at as k_upd from public.network_experts where id = '00000000-0000-4000-8000-0000000077a1' \gset
select v77_test.run('C01 a patch changes ONLY the keys present (title) and keeps the rest', $q$select (public.update_network_expert('00000000-0000-4000-8000-0000000077a1', '{"title_en":"  Keep   title 2 "}'::jsonb))::text$q$,
  $q$select ($1::jsonb->>'updated') || '/' || (select title_en || '|' || name_en || '|' || coalesce(notes, '') || '|' || array_to_string(languages, ',') from public.network_experts where id = '00000000-0000-4000-8000-0000000077a1')$q$, 'true/Keep title 2|V77 Keep Person|keep note|en');
select v77_test.run('C02 an explicit null clears a field (phone), an absent key does not (the name stays)', $q$select (public.update_network_expert('00000000-0000-4000-8000-0000000077a2', '{"phone":null}'::jsonb))::text$q$, $q$select (select (phone is null)::text || '/' || name_en from public.network_experts where id = '00000000-0000-4000-8000-0000000077a2')$q$, 'true/V77 Drop Person');
select v77_test.err('C04 a STALE token (the profile changed since it was loaded) is refused: expert_stale', format($q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a1', '{"title_en":"stale"}'::jsonb, %L::timestamptz - interval '1 second')$q$, :'k_upd'), 'expert_stale');
select v77_test.val('C05 the current token is accepted', format($q$select (r->>'updated') from (select public.update_network_expert('00000000-0000-4000-8000-0000000077a1', '{"title_en":"fresh"}'::jsonb, %L::timestamptz) r) s$q$, :'k_upd'), 'true');
select v77_test.err('C06 clearing both names is refused', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a1', '{"name_en":null,"name_ar":""}'::jsonb)$q$, 'expert_invalid');
select v77_test.val('C07 clearing ONE name when the other stays is fine', $q$select (r->>'updated') from (select public.update_network_expert('00000000-0000-4000-8000-0000000077a2', '{"name_ar":null}'::jsonb) r) s$q$, 'true');
select v77_test.err('C08 a project manager cannot change the kind (super_admin only)', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a1', '{"kind":"team"}'::jsonb)$q$, 'kind:forbidden');
select v77_test.val('C09 the photo path change hands back the OLD path for the client to remove', $q$select r->>'old_photo_path' from (select public.update_network_expert('00000000-0000-4000-8000-0000000077a2', '{"photo_path":"global/expert-photo/00000000-0000-4000-8000-0000000077f9.webp"}'::jsonb) r) s$q$, 'global/expert-photo/00000000-0000-4000-8000-0000000077f2.webp');
select v77_test.run('C10 removing the photo hands back the path and stores null', $q$select (public.update_network_expert('00000000-0000-4000-8000-0000000077a2', '{"photo_path":null}'::jsonb))::text$q$,
  $q$select ($1::jsonb->>'old_photo_path') || '/' || (select (photo_path is null)::text from public.network_experts where id = '00000000-0000-4000-8000-0000000077a2')$q$, 'global/expert-photo/00000000-0000-4000-8000-0000000077f9.webp/true');
select v77_test.run('C11 tags REPLACE the set: D had two tags, now one new + one existing', $q$select (public.update_network_expert('00000000-0000-4000-8000-0000000077a2', '{"tags":["00000000-0000-4000-8000-0000000077d2", "V77 Brand New"]}'::jsonb))::text$q$,
  $q$select ($1::jsonb->>'updated') || '/' || (select string_agg(t.name_en, ',' order by t.name_en) from public.network_expert_tags x join public.expert_tags t on t.id = x.tag_id where x.expert_id = '00000000-0000-4000-8000-0000000077a2')$q$, 'true/V77 Brand New,V77 Tag Two');
select v77_test.val('C12 the tag typed by name is the SAME tag whatever the case / spacing (one row, key = normal form)', $q$select count(*)::text from public.expert_tags where tag_key = 'v77 brand new'$q$, '1');
select v77_test.run('C13 an Arabic plain-string tag lands in name_ar', $q$select (public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a1', '["00000000-0000-4000-8000-0000000077d1", "وسم عربي"]'::jsonb))::text$q$,
  $q$select (select name_ar || '/' || coalesce(name_en, 'null') from public.expert_tags where id = (select tag_id from public.network_expert_tags where expert_id = '00000000-0000-4000-8000-0000000077a1' and tag_id <> '00000000-0000-4000-8000-0000000077d1'))$q$, 'وسم عربي/null');
select v77_test.err('C14 an unknown tag id is refused', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a1', '["00000000-0000-4000-8000-0000000077ee"]'::jsonb)$q$, 'tags:unknown');
select v77_test.err('C15 a tag payload that is not an array is refused', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a1', '"x"'::jsonb)$q$, 'tags:bad_type');
select v77_test.err('C16 NULL tags are refused', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a1', null)$q$, 'tags:bad_type');
select v77_test.err('C17 an unknown expert is expert_not_found', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077ff', '{"title_en":"x"}'::jsonb)$q$, 'expert_not_found');
select v77_test.err('C18 NULL id is expert_not_found', $q$select public.update_network_expert(null, '{"title_en":"x"}'::jsonb)$q$, 'expert_not_found');
select v77_test.err('C19 NULL patch is refused', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a1', null)$q$, 'payload:bad_value');
reset role; select set_config('request.jwt.claims', '', true);

-- an archived tag stays on the experts that have it, but cannot be attached to others
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('C20 a super_admin renames a tag (both names) and archives it', $q$select (r->>'updated') from (select public.update_expert_tag('00000000-0000-4000-8000-0000000077d2', 'V77 Tag Two Renamed', 'وسم اثنين', true) r) s$q$, 'true');
select v77_test.err('C21 a tag cannot be renamed to the key of another tag', $q$select public.update_expert_tag('00000000-0000-4000-8000-0000000077d2', 'V77 Tag One', null, null)$q$, 'tags:duplicate');
select v77_test.err('C22 an archived tag cannot be attached to an expert that does not have it', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a3', '["00000000-0000-4000-8000-0000000077d2"]'::jsonb)$q$, 'tags:archived');
select v77_test.okrun('C23 ... but it stays on the one that has it (D keeps it through a re-save)', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a2', '["00000000-0000-4000-8000-0000000077d2"]'::jsonb)$q$);
select v77_test.okrun('C24 typing the archived tag''s name again brings it back (un-archives)', $q$select public.set_network_expert_tags('00000000-0000-4000-8000-0000000077a3', '["V77 Tag Two Renamed"]'::jsonb)$q$);
select v77_test.val('C25 and it is active again', $q$select (archived_at is null)::text from public.expert_tags where id = '00000000-0000-4000-8000-0000000077d2'$q$, 'true');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e772","role":"authenticated"}', true);
set local role authenticated;
select v77_test.err('C26 a project manager cannot rename a tag', $q$select public.update_expert_tag('00000000-0000-4000-8000-0000000077d2', 'Hacked')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e771","role":"authenticated"}', true);
set local role authenticated;
select v77_test.okrun('C27 an alumni manager edits a profile through the RPC', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a3', '{"title_en":"Team lead"}'::jsonb)$q$);
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= D. archive / delete / restore
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e772","role":"authenticated"}', true);
set local role authenticated;
select v77_test.run('D01 a PM archives an expert that lists use: archived_at / archived_by are set', $q$select (public.set_network_expert_archived('00000000-0000-4000-8000-0000000077a1', true))::text$q$,
  $q$select ($1::jsonb->>'archived_at' is not null)::text || '/' || (select (archived_by = '00000000-0000-4000-8000-00000000e772')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000077a1')$q$, 'true/true');
select v77_test.val('D02 the archived expert is out of the default list and in the archived view', $q$select (public.list_network_experts('{"q":"v77 keep"}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v77 keep","state":"archived"}'::jsonb)->>'total')$q$, '0/1');
select v77_test.val('D03 its HISTORY is untouched: still in 2 lists, still resolves in the list (resolve_list row is not "missing")', format($q$select (select count(*) from public.list_items where network_expert_id = '00000000-0000-4000-8000-0000000077a1')::text || '/' || (select count(*) from public.resolve_list('%s', '{}'::jsonb) r where r->'source'->>'state' = 'ok' and r->'display'->>'title_en' = 'V77 Keep Person')$q$, :'la'), '2/1');
select v77_test.run('D04 archiving twice keeps the first date (idempotent): the second call hands back the stored date', $q$select (public.set_network_expert_archived('00000000-0000-4000-8000-0000000077a1', true)->>'archived_at')$q$, $q$select (select (archived_at = $1::timestamptz)::text from public.network_experts where id = '00000000-0000-4000-8000-0000000077a1')$q$, 'true');
select v77_test.run('D05 unarchive clears both columns', $q$select (public.set_network_expert_archived('00000000-0000-4000-8000-0000000077a1', false))::text$q$,
  $q$select ($1::jsonb->>'archived_at' is null)::text || '/' || (select (archived_by is null)::text from public.network_experts where id = '00000000-0000-4000-8000-0000000077a1')$q$, 'true/true');
select v77_test.err('D06 NULL flag is refused', $q$select public.set_network_expert_archived('00000000-0000-4000-8000-0000000077a1', null)$q$, 'expert_invalid');
select v77_test.err('D07 unknown expert', $q$select public.set_network_expert_archived('00000000-0000-4000-8000-0000000077ff', true)$q$, 'expert_not_found');
select v77_test.err('D08 a project manager cannot delete', $q$select public.delete_network_expert('00000000-0000-4000-8000-0000000077a3')$q$, '42501');
select v77_test.err('D09 a project manager cannot restore', $q$select public.restore_network_expert('00000000-0000-4000-8000-0000000077a3')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.err('D10 an expert that a list uses cannot be deleted (expert_in_use, the count is in the detail)', $q$select public.delete_network_expert('00000000-0000-4000-8000-0000000077a1')$q$, 'expert_in_use');
select v77_test.run('D11 an unused expert is soft-deleted; the row stays (deleted_at set)', $q$select (public.delete_network_expert((select id from public.network_experts where name_en = 'V77 Sneaky')))::text$q$,
  $q$select ($1::jsonb->>'deleted') || '/' || (select (deleted_at is not null)::text from public.network_experts where name_en = 'V77 Sneaky')$q$, 'true/true');
select v77_test.val('D12 the deleted record is in the deleted view only, never in the default view', $q$select (public.list_network_experts('{"q":"v77 sneaky"}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v77 sneaky","state":"deleted"}'::jsonb)->>'total')$q$, '0/1');
select v77_test.err('D13 deleting it again is expert_not_found', $q$select public.delete_network_expert((select id from public.network_experts where name_en = 'V77 Sneaky'))$q$, 'expert_not_found');
select v77_test.run('D14 restore brings it back', $q$select (public.restore_network_expert((select id from public.network_experts where name_en = 'V77 Sneaky')))::text$q$,
  $q$select ($1::jsonb->>'restored') || '/' || (select (deleted_at is null)::text from public.network_experts where name_en = 'V77 Sneaky')$q$, 'true/true');
select v77_test.err('D15 restoring a live record is expert_not_found', $q$select public.restore_network_expert((select id from public.network_experts where name_en = 'V77 Sneaky'))$q$, 'expert_not_found');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= E. MERGE: permissions, dry-run, blockers
-- the duplicate D is put back to its full profile (the update tests above changed it): the merge tests start from a known state
update public.network_experts set name_ar = 'شخص الدمج', phone = '+20 100 000 7777', photo_path = 'global/expert-photo/00000000-0000-4000-8000-0000000077f2.webp' where id = '00000000-0000-4000-8000-0000000077a2';
select v77_test.val('E00 before the merge: K has 2 list items (LA, LC), D has 2 (LA, LB); D has 2 distribution sessions, a provider with 2 bookings', format($q$select (select count(*) from public.list_items where network_expert_id = '00000000-0000-4000-8000-0000000077a1')::text || '/' || (select count(*) from public.list_items where network_expert_id = '00000000-0000-4000-8000-0000000077a2')
  || '/' || (select count(*) from public.distribution_sessions where mentor_item_id = '%s') || '/' || (select count(*) from public.booking_slots where provider_id = '%s')$q$, :'id_a', :'pvd'), '2/2/2/2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e772","role":"authenticated"}', true);
set local role authenticated;
select v77_test.err('E01 a project manager cannot merge', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e771","role":"authenticated"}', true);
set local role authenticated;
select v77_test.err('E02 an alumni manager cannot merge', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2')$q$, '42501');
select v77_test.err('E03 an alumni manager cannot read the merge audit', $q$select public.list_network_expert_merges()$q$, '42501');
select v77_test.err('E04 an alumni manager cannot dismiss a duplicate pair', $q$select public.dismiss_expert_duplicate('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2')$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.err('E05 a record cannot be merged into itself', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a1')$q$, 'merge:same_record');
select v77_test.err('E06 NULL ids are refused', $q$select public.merge_network_experts(null, '00000000-0000-4000-8000-0000000077a1')$q$, 'merge:same_record');
select v77_test.err('E07 an unknown record is expert_not_found', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077ff')$q$, 'expert_not_found');
select v77_test.val('E08 DRY RUN is the default: the plan, no write (blocked = false)', $q$select (r->>'dry_run') || '/' || (r->>'blocked') || '/' || (r->'impact'->>'list_items') || '/' || (r->'impact'->>'items_moved') || '/' || (r->'impact'->>'items_collapsed') || '/' || (r->'impact'->>'booking_providers') || '/' || (r->'impact'->>'distribution_sessions') || '/' || (r->'impact'->>'tags_added')
  from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2') r) s$q$, 'true/false/2/1/1/1/2/1');
select v77_test.val('E09 the dry run wrote nothing: both experts live, no audit row', $q$select (select count(*) from public.network_experts where id in ('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2') and deleted_at is null)::text || '/' || (v77_test.audit('00000000-0000-4000-8000-0000000077a2') is null)::text$q$, '2/true');
select v77_test.val('E10 NULL as p_dry_run is a dry run (the safe default), and a non-object p_fields is ignored', $q$select (r->>'dry_run') from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2', null, '[1]'::jsonb) r) s$q$, 'true');
select v77_test.val('E11 the preview of the resulting values: the kept value wins, the empty ones are filled from the duplicate, notes concatenated, languages merged', $q$select concat_ws('|', r->'merged'->>'name_en', r->'merged'->>'name_ar', r->'merged'->>'company_en', r->'merged'->>'email', r->'merged'->>'photo_path', r->'merged'->>'notes', r->'merged'->>'languages')
  from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2') r) s$q$,
  'V77 Keep Person|شخص الدمج|Drop Co|v77-drop@example.invalid|global/expert-photo/00000000-0000-4000-8000-0000000077f2.webp|keep note' || E'\n\n' || '[V77 Drop Person] drop note|["ar", "en"]');
select v77_test.val('E12 a field choice "drop" takes the duplicate''s value (title), a choice for an empty side never erases', $q$select concat_ws('|', r->'merged'->>'title_en', r->'merged'->>'company_en') from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2', true, '{"title_en":"drop","company_en":"keep"}'::jsonb) r) s$q$, 'Drop title|Drop Co');
reset role; select set_config('request.jwt.claims', '', true);

-- blockers (each on its own throwaway pair, in the list LX): withdrawn mismatch, mentor slot conflict, provider overlap, kind mismatch
insert into public.network_experts (id, kind, name_en) values ('00000000-0000-4000-8000-0000000077b1', 'expert', 'V77 Pair P'), ('00000000-0000-4000-8000-0000000077b2', 'expert', 'V77 Pair Q');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select public.add_network_pick(:'lx', '00000000-0000-4000-8000-0000000077b1') as ip \gset
select public.add_network_pick(:'lx', '00000000-0000-4000-8000-0000000077b2') as iq \gset
reset role; select set_config('request.jwt.claims', '', true);
update public.list_items set withdrawn_at = now() where id = :'ip';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('F01 withdrawn in one list and active in the other is a BLOCKER (dry run)', $q$select (r->>'blocked') || '/' || (r->'blockers'->>0) from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077b2', '00000000-0000-4000-8000-0000000077b1') r) s$q$, 'true/withdrawn_mismatch');
select v77_test.err('F02 ... and the real run is refused with the blocker in the detail', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000077b2', '00000000-0000-4000-8000-0000000077b1', false)$q$, 'withdrawn_mismatch');
select v77_test.val('F03 a refused merge wrote nothing', $q$select count(*)::text from public.network_experts where id = '00000000-0000-4000-8000-0000000077b1' and deleted_at is null$q$, '1');
reset role; select set_config('request.jwt.claims', '', true);
update public.list_items set withdrawn_at = null where id = :'ip';
insert into public.distribution_sessions (project_id, node_id, day_id, slot_index, mentor_item_id, company_item_id) values (:'ja', :'da', :'dd', 3, :'ip', null), (:'ja', :'da', :'dd', 3, :'iq', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('F04 both mentoring the same distribution slot is a BLOCKER', $q$select (r->'blockers'->>0) from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077b2', '00000000-0000-4000-8000-0000000077b1') r) s$q$, 'mentor_slot_conflict');
reset role; select set_config('request.jwt.claims', '', true);
delete from public.distribution_sessions where slot_index = 3 and day_id = :'dd';
insert into public.booking_providers (project_id, node_id, list_item_id) values (:'ja', :'ba', :'ip') returning id as pvp \gset
insert into public.booking_providers (project_id, node_id, list_item_id) values (:'ja', :'ba', :'iq') returning id as pvq \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja', :'ba', :'pvp', '2026-12-01 08:00+00', '2026-12-01 08:30+00'), (:'ja', :'ba', :'pvq', '2026-12-01 08:15+00', '2026-12-01 08:45+00');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('F05 two booking providers of one node with OVERLAPPING slots is a BLOCKER', $q$select (r->'blockers'->>0) from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077b2', '00000000-0000-4000-8000-0000000077b1') r) s$q$, 'provider_slot_conflict');
select v77_test.val('F06 a team member and an expert cannot be merged (kind_mismatch)', $q$select (r->'blockers'->>0) from (select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a3') r) s$q$, 'kind_mismatch');
reset role; select set_config('request.jwt.claims', '', true);
delete from public.booking_slots where provider_id in (:'pvp', :'pvq');

-- ================================================================= G. the real merge K <- D
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2', false, '{"title_en":"drop"}'::jsonb) as mres \gset
select v77_test.val('G01 the answer: merged, the ids, the audit id', format($q$select (r->>'merged') || '/' || (r->>'keep_id' = '00000000-0000-4000-8000-0000000077a1')::text || '/' || (r->>'drop_id' = '00000000-0000-4000-8000-0000000077a2')::text || '/' || (r->>'merge_id' is not null)::text from (select %L::jsonb r) s$q$, :'mres'), 'true/true/true/true');
select v77_test.val('G02 the duplicate is soft-deleted and points at the canonical record', $q$select (deleted_at is not null)::text || '/' || (merged_into = '00000000-0000-4000-8000-0000000077a1')::text from public.network_experts where id = '00000000-0000-4000-8000-0000000077a2'$q$, 'true/true');
select v77_test.val('G03 NO list item points at the duplicate any more; the canonical expert holds every list (LA collapsed, LB moved, LC own = 3 items)', $q$select (select count(*) from public.list_items where network_expert_id = '00000000-0000-4000-8000-0000000077a2')::text || '/' || (select count(*) from public.list_items where network_expert_id = '00000000-0000-4000-8000-0000000077a1')::text$q$, '0/3');
select v77_test.val('G04 the MOVED item kept its id (everything attached to it stays attached)', format($q$select (network_expert_id = '00000000-0000-4000-8000-0000000077a1')::text from public.list_items where id = '%s'$q$, :'id_b'), 'true');
select v77_test.val('G05 the COLLAPSED duplicate item is gone, the canonical item keeps its overlay + gets the duplicate''s keys and status, the duplicate''s overlay is preserved', format($q$select (select count(*) from public.list_items where id = '%s')::text || '/' || (overlay->>'role') || '/' || (overlay->>'note') || '/' || coalesce(status, '-') || '/' || (overlay->'merged_from'->'%s'->>'role') from public.list_items where id = '%s'$q$, :'id_a', :'id_a', :'ik_a'), '0/Keynote/from drop/confirmed/Trainer');
select v77_test.val('G06 the mentoring sessions of the duplicate now belong to the canonical item (1 + 2 = 3), none to the old one', format($q$select (select count(*) from public.distribution_sessions where mentor_item_id = '%s')::text || '/' || (select count(*) from public.distribution_sessions where mentor_item_id = '%s')::text$q$, :'ik_a', :'id_a'), '3/0');
select v77_test.val('G07 day mentors union (one row for the canonical item) and the canonical item''s rule wins (the duplicate''s is dropped)', format($q$select (select count(*) from public.distribution_day_mentors where mentor_item_id = '%s')::text || '/' || (select count(*) from public.distribution_day_mentors where mentor_item_id = '%s')::text || '/' || (select string_agg(room, ',') from public.distribution_mentor_rules where mentor_item_id = '%s')::text || '/' || (select count(*) from public.distribution_mentor_rules where mentor_item_id = '%s')::text$q$, :'ik_a', :'id_a', :'ik_a', :'id_a'), '1/0/Room K/0');
select v77_test.val('G08 booking: the duplicate''s provider is gone, ITS SLOTS moved to the canonical provider (1 + 2 = 3), its bookings stayed attached to those slots, the canonical provider took the missing settings', format($q$select (select count(*) from public.booking_providers where id = '%s')::text || '/' || (select count(*) from public.booking_slots where provider_id = '%s')::text || '/' || (select count(*) from public.bookings b join public.booking_slots s on s.id = b.slot_id where s.provider_id = '%s' and b.status = 'confirmed')::text
  || '/' || (select booking_email || ':' || advance_notice_min from public.booking_providers where id = '%s')$q$, :'pvd', :'pvk', :'pvk', :'pvk'), '0/3/3/v77-book@example.invalid:90');
select v77_test.val('G09 the registry numbers of the canonical expert are the SUM (3 projects-lists collapse to 1 project; sessions 3 + 3 booking)', $q$select (x->>'projects_count') || '/' || (x->>'lists_count') || '/' || (x->>'distribution_sessions') || '/' || (x->>'booking_sessions') || '/' || (x->>'sessions_count') from jsonb_array_elements(public.list_network_experts('{"q":"v77 keep person"}'::jsonb)->'rows') x$q$, '1/3/3/3/6');
select v77_test.val('G10 the canonical record took the chosen / merged values: title from the duplicate (choice), the rest filled, notes concatenated, languages and links merged, tags merged', $q$select concat_ws('|', e.title_en, e.name_ar, e.company_en, e.bio_en, e.email, e.phone, e.photo_path, e.notes, array_to_string(e.languages, ','), jsonb_array_length(e.links), (select count(*) from public.network_expert_tags where expert_id = e.id))
  from public.network_experts e where e.id = '00000000-0000-4000-8000-0000000077a1'$q$,
  'Drop title|شخص الدمج|Drop Co|Drop bio|v77-drop@example.invalid|+20 100 000 7777|global/expert-photo/00000000-0000-4000-8000-0000000077f2.webp|keep note' || E'\n\n' || '[V77 Drop Person] drop note|ar,en|2|3');
select v77_test.val('G11 the audit row keeps the full before-image of BOTH records, the plan and the result', $q$select (a->'keep_before'->>'name_en') || '/' || (a->'drop_before'->>'name_en') || '/' || (a->'drop_before'->>'email') || '/' || jsonb_array_length(a->'plan'->'items_moved') || '/' || jsonb_array_length(a->'plan'->'items_collapsed') || '/' || (a->'result'->>'items_collapsed') || '/' || ((a->>'merged_by') = '00000000-0000-4000-8000-00000000e770')::text
  from (select v77_test.audit('00000000-0000-4000-8000-0000000077a2') a) s$q$, 'V77 Keep Person/V77 Drop Person/v77-drop@example.invalid/1/1/1/true');
select v77_test.val('G12 the merge audit is readable by the super_admin through the RPC and shows on the canonical profile', $q$select jsonb_array_length(public.list_network_expert_merges('00000000-0000-4000-8000-0000000077a1')) || '/' || jsonb_array_length(public.get_network_expert('00000000-0000-4000-8000-0000000077a1')->'absorbed') || '/' || (public.get_network_expert('00000000-0000-4000-8000-0000000077a2')->'merged_into'->>'name_en')$q$, '1/1/V77 Keep Person');
select v77_test.val('G13 the merged record can still be opened by the super_admin (it points at its canonical one); restore is refused', $q$select (public.get_network_expert('00000000-0000-4000-8000-0000000077a2')->'can'->>'restore')$q$, 'false');
select v77_test.err('G14 restoring a merged record is refused (expert_merged)', $q$select public.restore_network_expert('00000000-0000-4000-8000-0000000077a2')$q$, 'expert_merged');
select v77_test.err('G15 merging the already merged record again is expert_not_found', $q$select public.merge_network_experts('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a2', false)$q$, 'expert_not_found');
select v77_test.run('G16 a STALE picker that still shows the merged duplicate attaches the canonical expert instead (the list-item guard redirects)', format($q$select public.add_network_pick('%s', '00000000-0000-4000-8000-0000000077a2')::text$q$, :'lx'),
  $q$select (network_expert_id = '00000000-0000-4000-8000-0000000077a1')::text from public.list_items where id = $1::uuid$q$, 'true');
select v77_test.val('G17 the duplicate is gone from the registry (default view, any search) and from the pair finder', $q$select (select count(*) from jsonb_array_elements(public.list_network_experts('{"q":"v77"}'::jsonb, 'name', 'asc', 200)->'rows') x where x->>'id' = '00000000-0000-4000-8000-0000000077a2')::text || '/' || (select count(*) from jsonb_array_elements(public.list_expert_duplicate_pairs(200)->'pairs') x where (x->'a'->>'id') = '00000000-0000-4000-8000-0000000077a2' or (x->'b'->>'id') = '00000000-0000-4000-8000-0000000077a2')$q$, '0/0');
select v77_test.err('G19 update of the merged record is expert_not_found', $q$select public.update_network_expert('00000000-0000-4000-8000-0000000077a2', '{"title_en":"x"}'::jsonb)$q$, 'expert_not_found');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= H. the pair finder + dismiss
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e770","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('H01 two fresh look-alikes show up in the pair finder (same name = blocking score)', $q$select count(*)::text from jsonb_array_elements(public.list_expert_duplicate_pairs(200)->'pairs') x where x->'a'->>'name_en' = 'V77 New Person' and x->'b'->>'name_en' = 'V77 New Person'$q$, '1');
select v77_test.okrun('H02 the super_admin dismisses that pair (the order of the two ids does not matter)', $q$select public.dismiss_expert_duplicate((select id from public.network_experts where name_en = 'V77 New Person' order by id limit 1), (select id from public.network_experts where name_en = 'V77 New Person' order by id desc limit 1))$q$);
select v77_test.val('H03 the dismissed pair is gone from the list and counted as dismissed', $q$select (select count(*) from jsonb_array_elements(public.list_expert_duplicate_pairs(200)->'pairs') x where x->'a'->>'name_en' = 'V77 New Person' and x->'b'->>'name_en' = 'V77 New Person')::text || '/' || ((public.list_expert_duplicate_pairs(200)->>'dismissed')::int >= 1)::text$q$, '0/true');
select v77_test.err('H04 a pair of the same id is refused', $q$select public.dismiss_expert_duplicate('00000000-0000-4000-8000-0000000077a1', '00000000-0000-4000-8000-0000000077a1')$q$, 'pair:bad_value');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= I. import
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e772","role":"authenticated"}', true);
set local role authenticated;
select v77_test.val('I01 the preview (default): new / duplicate of a registry record / invalid / duplicate inside the file, counts and per-row detail; nothing is written', $q$select concat_ws('|', r->>'dry_run', r->'counts'->>'new', r->'counts'->>'duplicate', r->'counts'->>'invalid', r->'counts'->>'created',
    (r->'rows'->0->>'status'), (r->'rows'->1->>'status'), (r->'rows'->1->'matches'->0->>'name_en'), (r->'rows'->2->>'status'), (r->'rows'->2->>'error'), (r->'rows'->3->>'status'), (r->'rows'->4->>'status'), (r->'rows'->4->>'in_file'),
    (select count(*) from public.network_experts where name_en like 'V77 Imp%'))
  from (select public.import_network_experts('[{"name_en":"V77 Imp One","title_en":"T","email":"V77-imp1@example.invalid","tags":["V77 Imp Tag"]},{"name_en":"V77 Keep Person"},{"name_en":"V77 Imp Bad","email":"bad"},{"name_ar":"استيراد عربي","languages":["ar"]},{"name_ar":"استيراد عربي"}]'::jsonb) r) s$q$,
  'true|2|2|1|0|new|duplicate|V77 Keep Person|invalid|email:invalid|new|duplicate|true|0');
select v77_test.run('I02 the real import (skip duplicates) creates the 2 new rows and reports the rest; tags are created / linked', $q$select (public.import_network_experts('[{"name_en":"V77 Imp One","title_en":"T","email":"V77-imp1@example.invalid","tags":["V77 Imp Tag"]},{"name_en":"V77 Keep Person"},{"name_en":"V77 Imp Bad","email":"bad"},{"name_ar":"استيراد عربي","languages":["ar"]},{"name_ar":"استيراد عربي"}]'::jsonb, false))::text$q$,
  $q$select concat_ws('|', $1::jsonb->'counts'->>'created', $1::jsonb->'counts'->>'duplicate', $1::jsonb->'counts'->>'invalid', (select count(*) from public.network_experts where name_en = 'V77 Imp One' or name_ar = 'استيراد عربي'),
    (select count(*) from public.network_expert_tags x join public.expert_tags t on t.id = x.tag_id where t.tag_key = 'v77 imp tag'), (select created_by = '00000000-0000-4000-8000-00000000e772' from public.network_experts where name_en = 'V77 Imp One')::text)$q$, '2|2|1|2|1|true');
select v77_test.val('I03 running the same import again creates nothing (every row is now a duplicate)', $q$select (r->'counts'->>'created') || '/' || (r->'counts'->>'duplicate') from (select public.import_network_experts('[{"name_en":"V77 Imp One"},{"name_ar":"استيراد عربي"}]'::jsonb, false) r) s$q$, '0/2');
select v77_test.val('I04 duplicates = create imports a duplicate on purpose', $q$select (r->'counts'->>'created') from (select public.import_network_experts('[{"name_en":"V77 Imp One"}]'::jsonb, false, 'create') r) s$q$, '1');
select v77_test.err('I05 a payload that is not an array is refused', $q$select public.import_network_experts('{"a":1}'::jsonb)$q$, 'rows:bad_type');
select v77_test.err('I06 more than 500 rows are refused', $q$select public.import_network_experts((select jsonb_agg(jsonb_build_object('name_en', 'x' || i)) from generate_series(1, 501) i))$q$, 'rows:too_many');
select v77_test.err('I07 a bad duplicates mode is refused', $q$select public.import_network_experts('[]'::jsonb, true, 'overwrite')$q$, 'duplicates:bad_value');
select v77_test.run('I08 an import never creates a team member and never sets protected columns (kind / deleted_at in a row are ignored)', $q$select (public.import_network_experts('[{"name_en":"V77 Imp Sneaky","kind":"team","deleted_at":"2020-01-01"}]'::jsonb, false))::text$q$,
  $q$select ($1::jsonb->'counts'->>'created') || '/' || (select kind || (deleted_at is null)::text from public.network_experts where name_en = 'V77 Imp Sneaky')$q$, '1/experttrue');
select v77_test.val('I09 an element that is not an object is reported invalid, not a crash', $q$select (r->'rows'->0->>'status') || '/' || (r->'rows'->1->>'status') from (select public.import_network_experts('[1, "x"]'::jsonb) r) s$q$, 'invalid/invalid');
select v77_test.val('I10 an empty import is fine', $q$select (r->'counts'->>'new') || '/' || jsonb_array_length(r->'rows') from (select public.import_network_experts('[]'::jsonb) r) s$q$, '0/0');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= J. the guards still hold after all this (direct table writes)
select v77_test.val('J01 no list item points at a soft-deleted expert anywhere in the platform', $q$select count(*)::text from public.list_items li join public.network_experts ne on ne.id = li.network_expert_id where ne.deleted_at is not null$q$, '0');
select v77_test.val('J02 every live expert has the derived columns and a name', $q$select count(*) filter (where search_text is null or name_key is null or (name_en is null and name_ar is null))::text from public.network_experts where deleted_at is null$q$, '0');

-- ================================================================= final state check
select current_setting('v77.res', true) as res \gset
rollback;
select count(*) as n_experts from public.network_experts \gset
select count(*) as n_ghosts from public.network_experts where name_en like 'V77%' or name_ar like '%استيراد%' \gset
select count(*) as n_tags from public.expert_tags where tag_key like 'v77%' \gset
select count(*) as n_audit from app_private.network_expert_merges where keep_name like 'V77%' \gset
select (:n_experts = 44 and :n_ghosts = 0 and :n_tags = 0 and :n_audit = 0) as state_ok \gset

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or not (:'state_ok')::boolean) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v77: network experts write tests FAILED'; end $$;
\endif
