-- v76_network_experts_read  (m76: list_network_experts, get_network_expert, find_similar_network_experts, list_expert_duplicate_pairs, list_expert_tags + the participation rules)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
-- Fixture: users ADM (super_admin e760), AM (alumni_manager e761), PM1 (project_manager, MEMBER of program PA e762), PM2 (project_manager, member of nothing e763), F (founder e764).
--   Programs PA (projects JA1, JA2) and PB (project JB1). Experts E1 .. E6 (V76 ...): E1 is in a list of JA1, JA2 and JB1 (3 projects, 2 programs) and mentors 3 distribution sessions (2 with a
--   company); E2 is a booking provider of JA1 (3 slots: 2 confirmed bookings, 1 cancelled); E3 never took part; E4 = Athar team member; E5 = archived (in JB1); E6 = withdrawn from JA2.
-- NEVER call an app_private helper while the session role is anon / authenticated; anon is asserted with has_function_privilege (a role-switched call of a guarded function can crash this local image).
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v76.res', '', false) \gset

begin;
create schema v76_test;
grant usage on schema v76_test to public;
create or replace function v76_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v76.res', current_setting('v76.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v76_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v76_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v76_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v76_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v76_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v76_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
create or replace function v76_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v76_test.t(p_key, true, 'ok');
  exception when others then
    perform v76_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v76_test from public;
grant execute on all functions in schema v76_test to anon, authenticated, service_role;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e760','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v76-adm@example.invalid','{"provisioned":true}','{"full_name":"V76 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e761','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v76-am@example.invalid','{"provisioned":true}','{"full_name":"V76 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e762','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v76-pm1@example.invalid','{"provisioned":true}','{"full_name":"V76 PM One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e763','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v76-pm2@example.invalid','{"provisioned":true}','{"full_name":"V76 PM Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e764','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v76-f@example.invalid','{"provisioned":true}','{"full_name":"V76 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e760','super_admin'), ('00000000-0000-4000-8000-00000000e761','alumni_manager'),
  ('00000000-0000-4000-8000-00000000e762','project_manager'), ('00000000-0000-4000-8000-00000000e763','project_manager'), ('00000000-0000-4000-8000-00000000e764','founder');
insert into public.network_experts (id, kind, name_en, name_ar, title_en, title_ar, company_en, photo_path, linkedin_url, email, phone, languages, notes, bio_en) values
  ('00000000-0000-4000-8000-0000000076a1', 'expert', E'V76  Alpha\tMentor', 'ألفا المرشد', 'Founder', 'مؤسس', 'Alpha Co', 'global/expert-photo/00000000-0000-4000-8000-0000000076f1.webp', 'https://www.linkedin.com/in/v76-alpha/', 'v76-alpha@example.invalid', '+20 100 000 0001', array['ar','en'], 'staff note about alpha', 'Bio of alpha'),
  ('00000000-0000-4000-8000-0000000076a2', 'expert', 'V76 Beta Trainer', null, 'Trainer', null, 'Beta Co', null, null, 'v76-beta@example.invalid', null, array['en','fr'], null, null),
  ('00000000-0000-4000-8000-0000000076a3', 'expert', 'V76 Gamma Idle', 'جاما', null, null, null, 'global/expert-photo/00000000-0000-4000-8000-0000000076f3.webp', null, null, null, '{}', null, null),
  ('00000000-0000-4000-8000-0000000076a4', 'team', 'V76 Delta Team', null, null, null, 'Athar', null, null, 'startups@example.invalid', null, '{}', null, null),
  ('00000000-0000-4000-8000-0000000076a5', 'expert', 'V76 Epsilon Archived', null, null, null, null, null, null, null, null, '{}', null, null),
  ('00000000-0000-4000-8000-0000000076a6', 'expert', 'V76 Zeta Withdrawn', null, null, null, null, null, null, null, null, '{}', null, null);
update public.network_experts set archived_at = now() where id = '00000000-0000-4000-8000-0000000076a5';
-- tags: two from the starter vocabulary + one of ours
insert into public.expert_tags (id, tag_key, name_en, name_ar) values ('00000000-0000-4000-8000-0000000076d1', 'v76 climate', 'V76 Climate', 'مناخ V76') on conflict do nothing;
insert into public.network_expert_tags (expert_id, tag_id) values ('00000000-0000-4000-8000-0000000076a1', '00000000-0000-4000-8000-0000000076d1'), ('00000000-0000-4000-8000-0000000076a2', '00000000-0000-4000-8000-0000000076d1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e760","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V76 Program A', 'برنامج أ', null, null, null, null)).id as pa \gset
select (public.create_program('V76 Program B', 'برنامج ب', null, null, null, null)).id as pb \gset
select (public.create_project(:'pa', 'V76 Project A1', null, 'Africa/Cairo')).id as ja1 \gset
select (public.create_project(:'pa', 'V76 Project A2', null, 'Africa/Cairo')).id as ja2 \gset
select (public.create_project(:'pb', 'V76 Project B1', null, 'Africa/Cairo')).id as jb1 \gset
select (public.add_node(:'ja1', 'list', '{"en":"A1 Experts"}', 0, 0, '{"subkind":"expert"}')).id as la1 \gset
select (public.add_node(:'ja1', 'list', '{"en":"A1 Companies"}', 0, 0, '{"subkind":"company"}')).id as lc1 \gset
select (public.add_node(:'ja2', 'list', '{"en":"A2 Experts"}', 0, 0, '{"subkind":"expert"}')).id as la2 \gset
select (public.add_node(:'jb1', 'list', '{"en":"B1 Experts"}', 0, 0, '{"subkind":"expert"}')).id as lb1 \gset
select (public.add_node(:'ja1', 'distribution', '{"en":"A1 Mentoring"}', 0, 0, '{}')).id as da1 \gset
select (public.add_node(:'ja1', 'booking', '{"en":"A1 Booking"}', 0, 0, '{"mode":"mentor"}')).id as ba1 \gset
select public.add_network_pick(:'la1', '00000000-0000-4000-8000-0000000076a1') as i1a \gset
select public.add_network_pick(:'la1', '00000000-0000-4000-8000-0000000076a2') as i2a \gset
select public.add_network_pick(:'la1', '00000000-0000-4000-8000-0000000076a4') as i4a \gset
select public.add_network_pick(:'la2', '00000000-0000-4000-8000-0000000076a1') as i1b \gset
select public.add_network_pick(:'la2', '00000000-0000-4000-8000-0000000076a6') as i6b \gset
select public.add_network_pick(:'lb1', '00000000-0000-4000-8000-0000000076a1') as i1c \gset
select public.add_network_pick(:'lb1', '00000000-0000-4000-8000-0000000076a5') as i5c \gset
select public.add_manual_item(:'lc1', '{"title_en":"V76 Company One"}') as c1 \gset
select public.add_manual_item(:'lc1', '{"title_en":"V76 Company Two"}') as c2 \gset
reset role; select set_config('request.jwt.claims', '', true);

-- a PM of program PA only; sessions and bookings as the owner of the tables
insert into public.program_members (program_id, user_id) values (:'pa', '00000000-0000-4000-8000-00000000e762');
insert into public.distribution_days (project_id, node_id, day_index, day_date, start_time, total_round_min, slot_duration_min, gap_min) values (:'ja1', :'da1', 0, '2026-10-12', '10:00', 60, 20, 0) returning id as day1 \gset
insert into public.distribution_days (project_id, node_id, day_index, day_date, start_time, total_round_min, slot_duration_min, gap_min) values (:'ja1', :'da1', 1, '2026-10-14', '10:00', 60, 20, 0) returning id as day2 \gset
insert into public.distribution_sessions (project_id, node_id, day_id, slot_index, mentor_item_id, company_item_id) values
  (:'ja1', :'da1', :'day1', 0, :'i1a', :'c1'), (:'ja1', :'da1', :'day1', 1, :'i1a', :'c2'), (:'ja1', :'da1', :'day2', 0, :'i1a', null);
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email) values (:'ja1', :'ba1', :'i2a', 'v76-beta-book@example.invalid') returning id as pv2 \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja1', :'ba1', :'pv2', '2026-10-20 08:00+00', '2026-10-20 08:20+00') returning id as s1 \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja1', :'ba1', :'pv2', '2026-10-20 09:00+00', '2026-10-20 09:20+00') returning id as s2 \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'ja1', :'ba1', :'pv2', '2026-10-21 09:00+00', '2026-10-21 09:20+00') returning id as s3 \gset
insert into public.bookings (project_id, node_id, slot_id, status, booker_email) values (:'ja1', :'ba1', :'s1', 'confirmed', 'zz-v76-b1@example.invalid'), (:'ja1', :'ba1', :'s2', 'confirmed', 'zz-v76-b2@example.invalid'), (:'ja1', :'ba1', :'s3', 'cancelled', 'zz-v76-b3@example.invalid');
update public.list_items set withdrawn_at = now() where id = :'i6b';

-- ================================================================= A. catalog
select v76_test.val('A01 the five read RPCs exist', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_network_experts', 'get_network_expert', 'find_similar_network_experts', 'list_expert_duplicate_pairs', 'list_expert_tags')$q$, '5');
select v76_test.val('A02 every one pins search_path to empty and is SECURITY DEFINER', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_network_experts', 'get_network_expert', 'find_similar_network_experts', 'list_expert_duplicate_pairs', 'list_expert_tags') and p.prosecdef and 'search_path=""' = any (p.proconfig)$q$, '5');
select v76_test.val('A03 anon cannot execute any of them, authenticated can', $q$select (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))::text || '/' || (count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('list_network_experts', 'get_network_expert', 'find_similar_network_experts', 'list_expert_duplicate_pairs', 'list_expert_tags')$q$, '0/5');
select v76_test.val('A04 the helpers of m76 are closed to API roles', $q$select (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))::text from pg_proc p
  where p.pronamespace = 'app_private'::regnamespace and p.proname in ('expert_text', 'expert_is_staff', 'expert_fail', 'expert_match', 'expert_find_similar')$q$, '0');

-- ================================================================= B. the list (as the super_admin)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e760","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('B01 the default view = the active experts (the 44 migrated + the fixture, without the archived one)', $q$select (r->>'total') || '/' || (r->'counts'->>'archived') from (select public.list_network_experts('{}'::jsonb, 'name', 'asc', 5, 0, 'en') r) s$q$, '49/1');
select v76_test.val('B02 the search "v76" finds the 5 active fixture experts, in name order', $q$select string_agg(x->>'name_en', ' | ' order by (x->>'ord')::int) from (select x || jsonb_build_object('ord', ord) x from jsonb_array_elements(public.list_network_experts('{"q":"v76"}'::jsonb, 'name', 'asc', 50, 0, 'en')->'rows') with ordinality t(x, ord)) s$q$,
  'V76 Alpha Mentor | V76 Beta Trainer | V76 Delta Team | V76 Gamma Idle | V76 Zeta Withdrawn');
select v76_test.val('B03 whitespace-insensitive: the stored name has a tab and a double space, the search does not', $q$select (public.list_network_experts('{"q":"alpha mentor"}'::jsonb)->>'total')$q$, '1');
select v76_test.val('B04 a search in Arabic finds the Arabic name', $q$select (public.list_network_experts('{"q":"المرشد"}'::jsonb)->>'total')$q$, '1');
select v76_test.val('B05 a search matches the e-mail, the company and a tag name too (all words must match)', $q$select (public.list_network_experts('{"q":"beta.invalid"}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"beta co"}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v76 climate"}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"mentor nomatch"}'::jsonb)->>'total')$q$, '1/1/2/0');
select v76_test.val('B06 the participation numbers are live: E1 = 2 programs, 3 projects, 3 lists, 2 distribution sessions (the empty slot is not a session)', $q$select concat_ws('/', x->>'programs_count', x->>'projects_count', x->>'lists_count', x->>'booking_sessions', x->>'distribution_sessions', x->>'sessions_count', x->>'first_session_on', x->>'last_session_on')
  from jsonb_array_elements(public.list_network_experts('{"q":"alpha mentor"}'::jsonb)->'rows') x$q$, '2/3/3/0/2/2/2026-10-12/2026-10-12');
select v76_test.val('B07 E2: one project, two CONFIRMED booking sessions (the cancelled one does not count), dates of the sessions', $q$select concat_ws('/', x->>'programs_count', x->>'projects_count', x->>'booking_sessions', x->>'distribution_sessions', x->>'sessions_count', x->>'first_session_on', x->>'last_session_on')
  from jsonb_array_elements(public.list_network_experts('{"q":"beta trainer"}'::jsonb)->'rows') x$q$, '1/1/2/0/2/2026-10-20/2026-10-20');
select v76_test.val('B08 a withdrawn item does not count (E6: in a list of JA2 but withdrawn = 0 programs)', $q$select concat_ws('/', x->>'programs_count', x->>'projects_count', x->>'lists_count') from jsonb_array_elements(public.list_network_experts('{"q":"zeta withdrawn"}'::jsonb)->'rows') x$q$, '0/0/0');
select v76_test.val('B09 never took part: E3 (filter participated = no), and the filter "yes" has the others', $q$select (select string_agg(x->>'name_en', ',') from jsonb_array_elements(public.list_network_experts('{"q":"v76","participated":"no"}'::jsonb)->'rows') x) || ' / ' ||
  (select count(*)::text from jsonb_array_elements(public.list_network_experts('{"q":"v76","participated":"yes"}'::jsonb, 'name', 'asc', 50)->'rows') x)$q$, 'V76 Gamma Idle,V76 Zeta Withdrawn / 3');
select v76_test.val('B10 kind filter: the team member', $q$select (select string_agg(x->>'name_en', ',') from jsonb_array_elements(public.list_network_experts('{"q":"v76","kind":"team"}'::jsonb)->'rows') x)$q$, 'V76 Delta Team');
select v76_test.val('B11 state filter: archived = E5 only; "all" = active + archived', $q$select (select string_agg(x->>'name_en', ',') from jsonb_array_elements(public.list_network_experts('{"q":"v76","state":"archived"}'::jsonb)->'rows') x) || ' / ' || (public.list_network_experts('{"q":"v76","state":"all"}'::jsonb)->>'total')$q$, 'V76 Epsilon Archived / 6');
select v76_test.val('B12 photo / e-mail filters', $q$select (public.list_network_experts('{"q":"v76","has_photo":true}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v76","has_photo":false}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v76","has_email":true}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v76","has_email":false}'::jsonb)->>'total')$q$, '2/3/3/2');
select v76_test.val('B13 tag filter (any of) and language filter', $q$select (public.list_network_experts(jsonb_build_object('q', 'v76', 'tag_ids', jsonb_build_array('00000000-0000-4000-8000-0000000076d1')))->>'total') || '/' || (public.list_network_experts('{"q":"v76","language":"fr"}'::jsonb)->>'total') || '/' || (public.list_network_experts('{"q":"v76","language":"en"}'::jsonb)->>'total')$q$, '2/1/2');
select v76_test.val('B14 program filter (the super_admin sees every program): PB = E1 (+E5 is archived)', format($q$select (select string_agg(x->>'name_en', ',') from jsonb_array_elements(public.list_network_experts(jsonb_build_object('q', 'v76', 'program_ids', jsonb_build_array('%s')))->'rows') x)$q$, :'pb'), 'V76 Alpha Mentor');
select v76_test.val('B15 sorting by programs desc puts E1 first among the fixture; by sessions desc E1 / E2 are the two with sessions', $q$select (public.list_network_experts('{"q":"v76"}'::jsonb, 'programs', 'desc')->'rows'->0->>'name_en') || ' / ' || (select string_agg(x->>'name_en', ',') from (select x from jsonb_array_elements(public.list_network_experts('{"q":"v76"}'::jsonb, 'sessions', 'desc', 2)->'rows') x) s)$q$, 'V76 Alpha Mentor / V76 Alpha Mentor,V76 Beta Trainer');
select v76_test.val('B16 paging: limit 2 offset 2 of the 5 fixture rows; total stays 5', $q$select (public.list_network_experts('{"q":"v76"}'::jsonb, 'name', 'asc', 2, 2)->>'total') || '/' || jsonb_array_length(public.list_network_experts('{"q":"v76"}'::jsonb, 'name', 'asc', 2, 2)->'rows') || '/' || (public.list_network_experts('{"q":"v76"}'::jsonb, 'name', 'asc', 2, 2)->'rows'->0->>'name_en') || '/' || jsonb_array_length(public.list_network_experts('{"q":"v76"}'::jsonb, 'name', 'asc', 2, 40)->'rows')$q$, '5/2/V76 Delta Team/0');
select v76_test.val('B17 the Arabic name sorts first in the Arabic UI (p_lang = ar)', $q$select public.list_network_experts('{"q":"v76"}'::jsonb, 'name', 'asc', 1, 0, 'ar')->'rows'->0->>'name_ar'$q$, 'ألفا المرشد');
select v76_test.val('B18 a row carries the light fields (no e-mail address, no phone, no notes) and the tags; p_full adds them', $q$select ((r->'rows'->0) ? 'email') || '/' || ((r->'rows'->0) ? 'notes') || '/' || (r->'rows'->0->>'has_email') || '/' || jsonb_array_length(r->'rows'->0->'tags') || '/' || (f->'rows'->0->>'email') || '/' || (f->'rows'->0->>'notes')
  from (select public.list_network_experts('{"q":"alpha mentor"}'::jsonb) r, public.list_network_experts('{"q":"alpha mentor"}'::jsonb, 'name', 'asc', 5000, 0, 'en', true) f) s$q$, 'false/false/true/1/v76-alpha@example.invalid/staff note about alpha');
select v76_test.val('B19 a garbage filter (an array, a string) is tolerated as "no filter"', $q$select (public.list_network_experts('[1,2]'::jsonb)->>'total') || '/' || (public.list_network_experts('"x"'::jsonb)->>'total') || '/' || (public.list_network_experts(null)->>'total')$q$, '49/49/49');
select v76_test.err('B20 an unknown sort key is refused', $q$select public.list_network_experts('{}'::jsonb, 'password')$q$, 'expert_invalid');
select v76_test.err('B21 an unknown kind is refused', $q$select public.list_network_experts('{"kind":"robot"}'::jsonb)$q$, 'expert_invalid');
select v76_test.err('B22 a malformed language is refused', $q$select public.list_network_experts('{"language":"english"}'::jsonb)$q$, 'expert_invalid');
select v76_test.val('B23 limit 0 / negative / huge are clamped; offset negative is 0', $q$select (public.list_network_experts('{}'::jsonb, 'name', 'asc', 0, -5)->>'limit') || '/' || (public.list_network_experts('{}'::jsonb, 'name', 'asc', 999999, 0)->>'limit') || '/' || (public.list_network_experts('{}'::jsonb, 'name', 'asc', null, null)->>'limit')$q$, '1/200/24');
select v76_test.val('B24 the registry sees the 3 duplicate pairs of the migrated data in the pair finder and nothing else is flagged for the fixture', $q$select jsonb_array_length(public.list_expert_duplicate_pairs(50)->'pairs')::text$q$, '3');
select v76_test.val('B25 the deleted view is the super_admin''s (nothing deleted yet = 0)', $q$select (public.list_network_experts('{"state":"deleted"}'::jsonb)->>'total')$q$, '0');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= C. who may read what
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e764","role":"authenticated"}', true);
set local role authenticated;
select v76_test.err('C01 a founder gets nothing: list', $q$select public.list_network_experts('{}'::jsonb)$q$, '42501');
select v76_test.err('C02 a founder gets nothing: profile', $q$select public.get_network_expert('00000000-0000-4000-8000-0000000076a1')$q$, '42501');
select v76_test.err('C03 a founder gets nothing: similar', $q$select public.find_similar_network_experts('V76 Alpha')$q$, '42501');
select v76_test.err('C04 a founder gets nothing: tags', $q$select public.list_expert_tags()$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);
select v76_test.val('C05 anon cannot execute the registry RPCs (privilege catalog; the calls are not made)', $q$select (not has_function_privilege('anon', 'public.list_network_experts(jsonb,text,text,integer,integer,text,boolean)', 'EXECUTE') and not has_function_privilege('anon', 'public.get_network_expert(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.find_similar_network_experts(text,text,text,text,uuid,text,integer)', 'EXECUTE'))::text$q$, 'true');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e763","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('C06 a project manager of NOTHING still sees the registry and the GLOBAL numbers (E1 = 2 programs / 3 projects)', $q$select concat_ws('/', x->>'programs_count', x->>'projects_count') from jsonb_array_elements(public.list_network_experts('{"q":"alpha mentor"}'::jsonb)->'rows') x$q$, '2/3');
select v76_test.val('C07 ... but the program filter ignores programs he cannot see (PA: nothing)', format($q$select (public.list_network_experts(jsonb_build_object('program_ids', jsonb_build_array('%s')))->>'total')$q$, :'pa'), '0');
select v76_test.err('C08 the "deleted" list is the super_admin''s', $q$select public.list_network_experts('{"state":"deleted"}'::jsonb)$q$, '42501');
select v76_test.err('C09 the pair finder is the super_admin''s', $q$select public.list_expert_duplicate_pairs()$q$, '42501');
reset role; select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e762","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('C10 PM1 (member of PA) can filter by PA: E1, E2 and the team member', format($q$select (select string_agg(x->>'name_en', ',' order by x->>'name_en') from jsonb_array_elements(public.list_network_experts(jsonb_build_object('q', 'v76', 'program_ids', jsonb_build_array('%s')))->'rows') x)$q$, :'pa'), 'V76 Alpha Mentor,V76 Beta Trainer,V76 Delta Team');
select v76_test.val('C11 ... but PB (not a member) gives nothing even though E1 took part in it', format($q$select (public.list_network_experts(jsonb_build_object('program_ids', jsonb_build_array('%s')))->>'total')$q$, :'pb'), '0');
reset role; select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e761","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('C12 the alumni manager reads the registry with the same global numbers', $q$select concat_ws('/', x->>'programs_count', x->>'projects_count', x->>'sessions_count') from jsonb_array_elements(public.list_network_experts('{"q":"alpha mentor"}'::jsonb)->'rows') x$q$, '2/3/2');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= D. the profile: detail rows follow the caller's projects, totals are global
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e760","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('D01 super_admin: the 3 engagements of E1 with program, project, list; nothing hidden', $q$select jsonb_array_length(p->'participation') || '/' || (p->'hidden'->>'engagements') || '/' || (p->'totals'->>'programs') || '/' || (p->'totals'->>'projects') || '/' || (p->'totals'->>'sessions')
  from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a1') p) s$q$, '3/0/2/3/2');
select v76_test.val('D02 the mentor role and the session counts come from the distribution node (E1 in A1: mentor, 2 sessions, dates)', $q$select concat_ws('/', x->'roles'->>'mentor', x->'roles'->>'provider', x->>'distribution_sessions', x->>'first_session_on', x->'node'->>'name_en', x->'project'->>'name_en', x->'program'->>'name_en')
  from jsonb_array_elements(public.get_network_expert('00000000-0000-4000-8000-0000000076a1')->'participation') x where x->'project'->>'name_en' = 'V76 Project A1'$q$, 'true/false/2/2026-10-12/A1 Experts/V76 Project A1/V76 Program A');
select v76_test.val('D03 the provider role and the booking sessions come from the booking node (E2 in A1)', $q$select concat_ws('/', x->'roles'->>'provider', x->'roles'->>'mentor', x->>'booking_sessions', x->>'last_session_on') from jsonb_array_elements(public.get_network_expert('00000000-0000-4000-8000-0000000076a2')->'participation') x$q$, 'true/false/2/2026-10-20');
select v76_test.val('D04 the profile carries the staff-only fields: e-mail, phone, notes, languages, tags', $q$select concat_ws('/', p->'expert'->>'email', p->'expert'->>'phone', p->'expert'->>'notes', p->'expert'->>'languages', jsonb_array_length(p->'tags'), p->'can'->>'merge', p->'can'->>'delete')
  from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a1') p) s$q$, 'v76-alpha@example.invalid/+20 100 000 0001/staff note about alpha/["ar", "en"]/1/true/true');
select v76_test.val('D05 a withdrawn engagement is listed flagged but not counted (E6: totals 0, one row, withdrawn)', $q$select (p->'totals'->>'lists') || '/' || (p->'totals'->>'withdrawn') || '/' || jsonb_array_length(p->'participation') || '/' || (p->'participation'->0->>'withdrawn') from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a6') p) s$q$, '0/1/1/true');
select v76_test.val('D06 an expert that never took part: zero totals, empty history, null dates', $q$select (p->'totals'->>'programs') || '/' || (p->'totals'->>'sessions') || '/' || jsonb_array_length(p->'participation') || '/' || coalesce(p->'totals'->>'first_session_on', 'null') from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a3') p) s$q$, '0/0/0/null');
select v76_test.err('D07 an unknown id is expert_not_found (P0002)', $q$select public.get_network_expert('00000000-0000-4000-8000-0000000076ff')$q$, 'expert_not_found');
select v76_test.err('D08 a NULL id is expert_not_found, not an empty answer', $q$select public.get_network_expert(null)$q$, 'expert_not_found');
reset role; select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e762","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('D10 PM1 (member of PA): the 2 engagements of PA in the detail, 1 hidden (PB), totals still global', $q$select jsonb_array_length(p->'participation') || '/' || (p->'hidden'->>'engagements') || '/' || (p->'hidden'->>'projects') || '/' || (p->'hidden'->>'programs') || '/' || (p->'totals'->>'projects') || '/' || (p->'totals'->>'programs')
  from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a1') p) s$q$, '2/1/1/1/3/2');
select v76_test.val('D11 PM1: the hidden engagement is only a COUNT: the program / project of PB appear nowhere in the answer', $q$select (public.get_network_expert('00000000-0000-4000-8000-0000000076a1')::text not like '%V76 Project B1%' and public.get_network_expert('00000000-0000-4000-8000-0000000076a1')::text not like '%V76 Program B%')::text$q$, 'true');
select v76_test.val('D12 PM1 cannot merge / delete (the buttons are the super_admin''s)', $q$select (p->'can'->>'merge') || '/' || (p->'can'->>'delete') || '/' || (p->'can'->>'edit') from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a1') p) s$q$, 'false/false/true');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e763","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('D13 PM2 (member of nothing): no detail rows, 3 hidden, global totals', $q$select jsonb_array_length(p->'participation') || '/' || (p->'hidden'->>'engagements') || '/' || (p->'hidden'->>'projects') || '/' || (p->'totals'->>'projects') from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a1') p) s$q$, '0/3/3/3');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e761","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('D14 the alumni manager (no project membership): no detail rows, global totals', $q$select jsonb_array_length(p->'participation') || '/' || (p->'hidden'->>'engagements') || '/' || (p->'totals'->>'programs') from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a1') p) s$q$, '0/3/2');
reset role; select set_config('request.jwt.claims', '', true);

-- a deleted expert is the super_admin's to see (the trash)
update public.network_experts set deleted_at = now() where id = '00000000-0000-4000-8000-0000000076a3';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e763","role":"authenticated"}', true);
set local role authenticated;
select v76_test.err('D15 a deleted expert is not found for a project manager', $q$select public.get_network_expert('00000000-0000-4000-8000-0000000076a3')$q$, 'expert_not_found');
reset role; select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e760","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('D16 the super_admin sees it with the restore flag, and lists it in the deleted view', $q$select (p->'can'->>'restore') || '/' || (p->'expert'->>'deleted_at' is not null)::text || '/' || (public.list_network_experts('{"state":"deleted"}'::jsonb)->>'total') from (select public.get_network_expert('00000000-0000-4000-8000-0000000076a3') p) s$q$, 'true/true/1');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= E. duplicates (as the super_admin / a PM)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e762","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('E01 the same name in another spelling is a BLOCKING duplicate (same_name), with the expert card', $q$select (x->>'blocking') || '/' || (x->'reasons'->>0) || '/' || regexp_replace(x->'expert'->>'name_en', '[[:space:]]+', ' ', 'g') from jsonb_array_elements(public.find_similar_network_experts('v76 alpha mentor')) x limit 1$q$, 'true/same_name/V76 Alpha Mentor');
select v76_test.val('E02 the same LinkedIn profile (any spelling of the link) is a blocking duplicate even with a different name', $q$select (x->>'score') || '/' || (x->'reasons'->>0) from jsonb_array_elements(public.find_similar_network_experts('Somebody Else', null, null, 'http://eg.linkedin.com/in/V76-Alpha?x=1')) x limit 1$q$, '1/same_linkedin');
select v76_test.val('E03 the same e-mail is a blocking duplicate for experts', $q$select (x->>'score') || '/' || (x->'reasons'->>0) from jsonb_array_elements(public.find_similar_network_experts('Somebody Else', null, 'V76-BETA@example.invalid')) x limit 1$q$, '0.95/same_email');
select v76_test.val('E04 ... but NOT for the Athar team (they share one inbox): two team records with the same address are not flagged', $q$select count(*)::text from jsonb_array_elements(public.find_similar_network_experts('Another Team', null, 'startups@example.invalid', null, null, 'team')) x$q$, '0');
select v76_test.val('E05 a Latin / Arabic pair is found through the consonant skeleton (a warning, not blocking)', $q$select (x->>'blocking') || '/' || (x->'reasons'->>0) || '/' || (x->'expert'->>'name_en') from jsonb_array_elements(public.find_similar_network_experts('Mohamed Elbehery', null)) x where x->'expert'->>'name_en' = 'محمد البحيري'$q$, 'false/same_name_translit/محمد البحيري');
select v76_test.val('E06 p_exclude leaves the record itself out (the edit form)', $q$select count(*)::text from jsonb_array_elements(public.find_similar_network_experts('V76 Alpha Mentor', null, null, null, '00000000-0000-4000-8000-0000000076a1')) x where x->>'id' = '00000000-0000-4000-8000-0000000076a1'$q$, '0');
select v76_test.val('E07 an unrelated name finds nothing; an empty name finds nothing (no crash)', $q$select jsonb_array_length(public.find_similar_network_experts('Qwertyuiop Zxcvbnm'))::text || '/' || jsonb_array_length(public.find_similar_network_experts(null, null))::text || '/' || jsonb_array_length(public.find_similar_network_experts('', ''))::text$q$, '0/0/0');
select v76_test.val('E08 an archived expert is still a candidate (the card says so); a deleted one is not', $q$select count(*)::text from jsonb_array_elements(public.find_similar_network_experts('V76 Epsilon Archived')) x where (x->'expert'->>'archived_at') is not null$q$, '1');
select v76_test.err('E09 a bad kind is refused', $q$select public.find_similar_network_experts('x', null, null, null, null, 'robot')$q$, 'expert_invalid');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= F. tags
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e763","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('F01 the tag list: starter vocabulary + ours with its use count (2 live experts carry it)', $q$select (jsonb_array_length(public.list_expert_tags()) >= 19)::text || '/' || (select (x->>'uses') from jsonb_array_elements(public.list_expert_tags()) x where x->>'name_en' = 'V76 Climate')$q$, 'true/2');
select v76_test.val('F02 the use count leaves deleted experts out', $q$select count(*)::text from jsonb_array_elements(public.list_expert_tags()) x where x->>'name_en' = 'V76 Climate' and (x->>'uses')::int = 2$q$, '1');
reset role; select set_config('request.jwt.claims', '', true);
update public.expert_tags set archived_at = now() where id = '00000000-0000-4000-8000-0000000076d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e763","role":"authenticated"}', true);
set local role authenticated;
select v76_test.val('F03 an archived tag is out of the default list and in the full one', $q$select (select count(*) from jsonb_array_elements(public.list_expert_tags()) x where x->>'name_en' = 'V76 Climate')::text || '/' || (select count(*) from jsonb_array_elements(public.list_expert_tags(true)) x where x->>'name_en' = 'V76 Climate')::text$q$, '0/1');
reset role; select set_config('request.jwt.claims', '', true);

-- ================================================================= final state check
select current_setting('v76.res', true) as res \gset
rollback;
select count(*) as n_experts from public.network_experts \gset
select count(*) as n_ghosts from public.network_experts where name_en like 'V76%' \gset
select count(*) as n_prog from public.programs where name_en like 'V76%' \gset
select (:n_experts = 44 and :n_ghosts = 0 and :n_prog = 0) as state_ok \gset

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or not (:'state_ok')::boolean) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v76: network experts read tests FAILED'; end $$;
\endif
