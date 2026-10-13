-- v03_rls_roleswitch  (03 13 step 3: role-switch tests of RLS, grants, RPC authorisation, triggers and the public paths)
-- Everything runs inside ONE transaction that is ROLLED BACK: temporary test users/rows never persist.
-- Only the PASS/FAIL lines are saved afterwards into migration.recon (phase 'stage1-verify-v03').
-- Users (fixed test ids):  U1 = project_manager of program P1/project J1   U2 = outsider (self-signup founder)
--                          U3 = project_manager of program P2/project J2   anon = no token
\set ON_ERROR_STOP on
set search_path = public, extensions;

select set_config('stage1.res', '', false) \gset

begin;
create schema stage1_test;      -- dropped by the final ROLLBACK (do not use pg_temp functions under restricted roles: this server crashes)
grant usage on schema stage1_test to public;
-- ---- helpers (session temp objects; survive the ROLLBACK because they are created before BEGIN)
create or replace function stage1_test.t(p_key text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $$
begin
  perform set_config('stage1.res', current_setting('stage1.res', true) || case when p_ok then 'ok' else 'mismatch' end
                     || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function stage1_test.setid(p_name text, p_val text) returns void language sql as $$ select set_config('stage1.id_' || p_name, p_val, false) $$;
create or replace function stage1_test.id(p_name text) returns uuid language sql as $$ select current_setting('stage1.id_' || p_name)::uuid $$;
-- run SQL expecting an error (optionally a specific SQLSTATE)
create or replace function stage1_test.fails(p_key text, p_sql text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform stage1_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    perform stage1_test.t(p_key, p_state is null or sqlstate = p_state, 'sqlstate ' || sqlstate || case when p_state is not null and sqlstate <> p_state then ' (wanted ' || p_state || ')' else '' end);
  end;
end $$;
-- run a scalar SQL and compare with the expected text
create or replace function stage1_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform stage1_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform stage1_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 120));
  end;
end $$;
create or replace function stage1_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform stage1_test.t(p_key, true, 'ok');
  exception when others then
    perform stage1_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- NOTE: functions with a NULL ACL (implicit PUBLIC execute) crash this local server image when executed under anon/authenticated,
-- so every helper gets an explicit ACL.
revoke all on all functions in schema stage1_test from public;
grant execute on all functions in schema stage1_test to anon, authenticated, service_role;


select set_config('stage1.id_ne_base', (select count(*)::text from public.network_experts), false);   -- experts that exist before the fixture (0 on a clean slate)
-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-u1@example.invalid','{}','{"full_name":"Test PM One"}', now(), now()),
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-u2@example.invalid','{}','{"full_name":"Test Outsider","role":"super_admin"}', now(), now()),
 ('00000000-0000-4000-8000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-u3@example.invalid','{}','{"full_name":"Test PM Three"}', now(), now());
-- (m25: a staff role and founder are mutually exclusive. The sign-up trigger gave these two fixture accounts the self-signup founder role: they are PMs here)
delete from public.user_roles where role_key = 'founder' and user_id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3');
insert into public.user_roles (user_id, role_key) values
 ('00000000-0000-4000-8000-0000000000a1','project_manager'), ('00000000-0000-4000-8000-0000000000a3','project_manager');

select stage1_test.val('T01 handle_new_user: profile row created', $q$select count(*)::text from public.profiles where id = '00000000-0000-4000-8000-0000000000a2'$q$, '1');
select stage1_test.val('T02 handle_new_user: self-signup gets role founder only (user_metadata.role=super_admin is ignored)',
  $q$select string_agg(role_key, ',' order by role_key) from public.user_roles where user_id = '00000000-0000-4000-8000-0000000000a2'$q$, 'founder');
select stage1_test.val('T03 handle_new_user: founders row linked to the new user', $q$select count(*)::text from public.founders where auth_user_id = '00000000-0000-4000-8000-0000000000a2'$q$, '1');

-- ================================================================= anon: no table access, public RPCs only
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select stage1_test.fails('A01 anon cannot select projects',        $q$select count(*) from public.projects$q$, '42501');
select stage1_test.fails('A02 anon cannot select nodes',           $q$select count(*) from public.nodes$q$, '42501');
select stage1_test.fails('A03 anon cannot select form_responses',  $q$select count(*) from public.form_responses$q$, '42501');
select stage1_test.fails('A04 anon cannot select companies',       $q$select count(*) from public.companies$q$, '42501');
select stage1_test.fails('A05 anon cannot select founders',        $q$select count(*) from public.founders$q$, '42501');
select stage1_test.fails('A06 anon cannot select participants',    $q$select count(*) from public.participants$q$, '42501');
select stage1_test.fails('A07 anon cannot select list_items',      $q$select count(*) from public.list_items$q$, '42501');
select stage1_test.fails('A08 anon cannot select bookings',        $q$select count(*) from public.bookings$q$, '42501');
select stage1_test.fails('A09 anon cannot select profiles',        $q$select count(*) from public.profiles$q$, '42501');
select stage1_test.fails('A10 anon cannot select user_roles',      $q$select count(*) from public.user_roles$q$, '42501');
select stage1_test.fails('A11 anon cannot select alumni_invitations', $q$select count(*) from public.alumni_invitations$q$, '42501');
select stage1_test.fails('A12 anon cannot select certificates',    $q$select count(*) from public.certificates$q$, '42501');
select stage1_test.fails('A13 anon cannot insert form_responses',  $q$insert into public.form_responses (project_id, node_id, answers) values (gen_random_uuid(), gen_random_uuid(), '{}')$q$, '42501');
select stage1_test.fails('A14 anon cannot read legacy.* (schema closed)', $q$select count(*) from legacy.company_submissions$q$, '42501');
select stage1_test.fails('A15 anon cannot read app_private.* (schema closed)', $q$select count(*) from app_private.google_connections$q$, '42501');
-- NOTE: executing a function the role may NOT execute crashes this local image (segfault in the permission-denied path, reproducible with any
-- revoked function), so function-level denial is asserted through has_function_privilege() instead of by calling the function.
select stage1_test.val('A16 anon has no EXECUTE on get_project_graph', $q$select has_function_privilege('anon', 'public.get_project_graph(uuid)', 'EXECUTE')::text$q$, 'false');
select stage1_test.val('A17 anon has no EXECUTE on submit_form_response (service role only)', $q$select has_function_privilege('anon', 'public.submit_form_response(text,jsonb,jsonb)', 'EXECUTE')::text$q$, 'false');
select stage1_test.val('A18 anon has no EXECUTE on app_private helpers', $q$select has_schema_privilege('anon', 'app_private', 'USAGE')::text$q$, 'false');
select stage1_test.val('A18b authenticated has no EXECUTE on service-role RPCs', $q$select has_function_privilege('authenticated', 'public.claim_email_batch(uuid,int)', 'EXECUTE')::text$q$, 'false');
select stage1_test.val('A19 anon may call resolve_ref (no leak: 0 rows for unknown ref)', $q$select count(*)::text from public.resolve_ref('form', 'doesnotexist')$q$, '0');
select stage1_test.val('A20 anon may call verify_certificate (invalid code -> valid:false)', $q$select (public.verify_certificate('NOPE')->>'valid')$q$, 'false');
reset role;

-- ================================================================= U2: authenticated without any membership sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('B01 no-membership user: projects = 0',      $q$select count(*)::text from public.projects$q$, '0');
select stage1_test.val('B02 no-membership user: programs = 0',      $q$select count(*)::text from public.programs$q$, '0');
select stage1_test.val('B03 no-membership user: nodes = 0',          $q$select count(*)::text from public.nodes$q$, '0');
select stage1_test.val('B04 no-membership user: form_responses = 0', $q$select count(*)::text from public.form_responses$q$, '0');
select stage1_test.val('B05 no-membership user: participants = 0',   $q$select count(*)::text from public.participants$q$, '0');
select stage1_test.val('B06 no-membership user: sees only their own profile', $q$select count(*)::text from public.profiles$q$, '1');
select stage1_test.val('B07 no-membership user: sees only their own role rows', $q$select count(*)::text from public.user_roles$q$, '1');
select stage1_test.val('B08 no-membership user: network_experts denied by RLS (0 rows)', $q$select count(*)::text from public.network_experts$q$, '0');
select stage1_test.fails('B09 no-membership user cannot insert a node', $q$insert into public.nodes (project_id, type, name_en) values (gen_random_uuid(), 'list', 'x')$q$);
select stage1_test.fails('B10 no-membership user cannot create a program (no project_manager role)', $q$select public.create_program('Nope')$q$, '42501');
-- (since m25 this founder fixture is refused by the staff / founder exclusivity trigger, 23514, before the RLS check, 42501: either refusal proves "cannot grant")
select stage1_test.fails('B11 no-membership user cannot grant themselves a role', $q$insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000000a2', 'super_admin')$q$);
select stage1_test.fails('B12 app_private tables are not reachable', $q$select count(*) from app_private.email_outbox$q$, '42501');
reset role;

-- ================================================================= U1: builds P1 / J1 with a graph
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.setid('P1', (select id::text from public.create_program('Test Program One', 'برنامج اختبار 1')));
select stage1_test.setid('J1', (select id::text from public.create_project(stage1_test.id('P1'), 'Test Project One', 'مشروع اختبار 1')));
select stage1_test.val('C01 creator became program owner', $q$select member_role from public.program_members where program_id = stage1_test.id('P1') and user_id = '00000000-0000-4000-8000-0000000000a1'$q$, 'owner');
select stage1_test.val('C02 create_project created the view_host system node', $q$select count(*)::text from public.nodes where project_id = stage1_test.id('J1') and type = 'view_host' and is_system$q$, '1');
select stage1_test.setid('F',  (select id::text from public.add_node(stage1_test.id('J1'), 'form_builder', '{"en":"Applications"}', 100, 100)));
select stage1_test.setid('L',  (select id::text from public.add_node(stage1_test.id('J1'), 'list', '{"en":"Companies"}', 300, 100, '{"subkind":"company"}')));
select stage1_test.setid('L2', (select id::text from public.add_node(stage1_test.id('J1'), 'list', '{"en":"Companies copy"}', 300, 300, '{"subkind":"company"}')));
select stage1_test.setid('LE', (select id::text from public.add_node(stage1_test.id('J1'), 'list', '{"en":"Experts"}', 300, 500, '{"subkind":"expert"}')));
select stage1_test.setid('B',  (select id::text from public.add_node(stage1_test.id('J1'), 'booking', '{"en":"Mentor booking"}', 500, 500, '{"mode":"mentor"}')));
select stage1_test.setid('CN', (select id::text from public.add_node(stage1_test.id('J1'), 'certificates', '{"en":"Certificates"}', 700, 100)));
select stage1_test.val('C03 add_node created extension rows (forms, lists, booking_settings)',
   $q$select ((select count(*) from public.forms where node_id = stage1_test.id('F')) + (select count(*) from public.lists where project_id = stage1_test.id('J1'))
            + (select count(*) from public.booking_settings where node_id = stage1_test.id('B')))::text$q$, '5');   -- 1 form + 3 lists + 1 booking_settings
select stage1_test.fails('C04 system node types cannot be created by add_node', $q$select public.add_node(stage1_test.id('J1'), 'view_host')$q$, '42501');
select stage1_test.val('C05 node_revisions row created with the node (rev >= 1; extension-row insert may already bump)', $q$select count(*)::text from public.node_revisions where node_id = stage1_test.id('F') and rev >= 1$q$, '1');

-- graph rules
select stage1_test.okrun('G01 connect form.responses -> list.items-in', $q$select public.connect(stage1_test.id('J1'), stage1_test.id('F'), 'responses', stage1_test.id('L'), 'items-in')$q$);
select stage1_test.okrun('G02 connect list.items -> list2.items-in',    $q$select public.connect(stage1_test.id('J1'), stage1_test.id('L'), 'items', stage1_test.id('L2'), 'items-in')$q$);
select stage1_test.fails('G03 cycle in rows:list-item family is rejected', $q$select public.connect(stage1_test.id('J1'), stage1_test.id('L2'), 'items', stage1_test.id('L'), 'items-in')$q$, '23514');
select stage1_test.fails('G04 company list cannot feed the expert-only booking.mentors port (kind mismatch)', $q$select public.connect(stage1_test.id('J1'), stage1_test.id('L'), 'items', stage1_test.id('B'), 'mentors')$q$, '23514');
select stage1_test.okrun('G05 expert list feeds booking.mentors', $q$select public.connect(stage1_test.id('J1'), stage1_test.id('LE'), 'items', stage1_test.id('B'), 'mentors')$q$);
select stage1_test.fails('G06 unknown output port is rejected', $q$select public.connect(stage1_test.id('J1'), stage1_test.id('F'), 'nope', stage1_test.id('L'), 'items-in')$q$, '23514');
select stage1_test.fails('G07 duplicate edge is rejected', $q$select public.connect(stage1_test.id('J1'), stage1_test.id('F'), 'responses', stage1_test.id('L'), 'items-in')$q$, '23505');
select stage1_test.val('G08 edge insert bumped the target node revision', $q$select (rev > 1)::text from public.node_revisions where node_id = stage1_test.id('L')$q$, 'true');

-- save_node: atomic, one revision bump, optimistic concurrency
select stage1_test.setid('revF0', (select rev::text from public.node_revisions where node_id = stage1_test.id('F')));
select stage1_test.okrun('S01 save_node with typed children (questions)',
  $q$select public.save_node(stage1_test.id('F'), current_setting('stage1.id_revF0')::bigint,
        '{"name_en":"Applications 2026","config":{"thank_you":{"en":"Thanks"}}}',
        '{"form":{"is_active":true},"questions":[{"key":"company_name","type":"text","semantic":"company_name","label_en":"Company","is_required":true,"order_index":1},{"key":"founder_email","type":"email","semantic":"founder_email","label_en":"E-mail","is_required":true,"order_index":2}]}')$q$);
select stage1_test.val('S02 revision bumped exactly once by save_node (children triggers suppressed)',
  $q$select (rev - current_setting('stage1.id_revF0')::bigint)::text from public.node_revisions where node_id = stage1_test.id('F')$q$, '1');
select stage1_test.val('S03 questions stored relationally', $q$select count(*)::text from public.form_questions where node_id = stage1_test.id('F')$q$, '2');
select stage1_test.fails('S04 stale revision raises 40001 (conflict)', $q$select public.save_node(stage1_test.id('F'), 1, '{"name_en":"stale"}')$q$, '40001');
select stage1_test.fails('S05 unknown patch key is rejected', $q$select public.save_node(stage1_test.id('F'), (select rev from public.node_revisions where node_id = stage1_test.id('F')), '{"id":"x"}')$q$, '22023');
select stage1_test.fails('S06 oversize config is rejected (> 256 KB)',
  $q$select public.save_node(stage1_test.id('F'), (select rev from public.node_revisions where node_id = stage1_test.id('F')), jsonb_build_object('config', jsonb_build_object('x', repeat('a', 300000))))$q$);
select stage1_test.fails('S07 semantic question must use the semantic as key (CHECK)', $q$update public.form_questions set key = 'something_else' where node_id = stage1_test.id('F') and semantic = 'company_name'$q$, '23514');
reset role;

-- some data as postgres: a company of J1, a form response, an expert
insert into public.companies (id, name_en, name_ar, origin_project_id, created_by) values ('00000000-0000-4000-8000-0000000000c1', 'Acme Test Co', 'شركة اختبار', stage1_test.id('J1'), null);
insert into public.network_experts (id, name_en, name_ar, email, kind) values ('00000000-0000-4000-8000-0000000000e1', 'Dr Expert', 'خبير', 'expert@example.invalid', 'expert');
select stage1_test.setid('revF1', (select rev::text from public.node_revisions where node_id = stage1_test.id('F')));
insert into public.form_responses (id, project_id, node_id, answers) values
  ('00000000-0000-4000-8000-0000000000d1', stage1_test.id('J1'), stage1_test.id('F'), '{"company_name":"Applicant One","founder_email":"founder1@example.invalid"}');
select stage1_test.val('R01 form_responses insert bumped the form node revision once (statement trigger)',
  $q$select (rev - current_setting('stage1.id_revF1')::bigint)::text from public.node_revisions where node_id = stage1_test.id('F')$q$, '1');

-- ================================================================= U1 (member) sees only their project; U3 / U2 do not
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('M01 member sees exactly their project', $q$select count(*)::text from public.projects$q$, '1');
select stage1_test.val('M02 member sees their project nodes (view_host + 6)', $q$select count(*)::text from public.nodes where project_id = stage1_test.id('J1')$q$, '7');
select stage1_test.val('M03 member sees the form response (PII family: PM)', $q$select count(*)::text from public.form_responses$q$, '1');
select stage1_test.val('M04 member reads a company referenced by origin project (ENTITY: PM of origin project)', $q$select count(*)::text from public.companies$q$, '1');
select stage1_test.val('M05 member reads the Athar Network (PM role holder): the experts that existed before + the 1 test expert', $q$select count(*)::text from public.network_experts$q$, ((current_setting('stage1.id_ne_base'))::int + 1)::text);
select stage1_test.val('M06 get_project_graph returns nodes+edges+revisions', $q$select (jsonb_array_length(g->'nodes') || '/' || jsonb_array_length(g->'edges') || '/' || jsonb_array_length(g->'revisions')) from public.get_project_graph(stage1_test.id('J1')) g$q$, '7/3/7');
select stage1_test.val('M07 get_graph_revisions returns one row per node', $q$select count(*)::text from public.get_graph_revisions(stage1_test.id('J1'))$q$, '7');
select stage1_test.fails('M09 member cannot insert form responses directly (no client INSERT)', $q$insert into public.form_responses (project_id, node_id, answers) values (stage1_test.id('J1'), stage1_test.id('F'), '{}')$q$, '42501');
-- list items: reference + overlay (virtual membership)
select stage1_test.setid('I1', (select public.ensure_item(stage1_test.id('L'), 'form_response', '00000000-0000-4000-8000-0000000000d1')::text));
select stage1_test.val('M10 ensure_item is idempotent (same id twice)', $q$select (public.ensure_item(stage1_test.id('L'), 'form_response', '00000000-0000-4000-8000-0000000000d1') = stage1_test.id('I1'))::text$q$, 'true');
select stage1_test.fails('M11 ensure_item refuses a response not reachable from the list', $q$select public.ensure_item(stage1_test.id('LE'), 'form_response', '00000000-0000-4000-8000-0000000000d1')$q$, '23514');
select stage1_test.okrun('M12 patch_item_overlay merges', $q$select public.patch_item_overlay(stage1_test.id('I1'), '{"note":"call back","score":7}')$q$);
select stage1_test.fails('M08 member cannot move rows into another project (project_id immutable)', $q$update public.list_items set project_id = gen_random_uuid()$q$);
select stage1_test.val('M13 resolve_list: one row, source ok, display from the response',
  $q$select (r->'source'->>'state') || '/' || (r->'display'->>'title_en') || '/' || (r->'overlay'->>'score') from public.resolve_list(stage1_test.id('L')) r$q$, 'ok/Applicant One/7');
select stage1_test.val('M14 resolve_list on the chained list L2 also sees the same source (reference, no copy)',
  $q$select count(*)::text from public.resolve_list(stage1_test.id('L2'))$q$, '1');   -- L feeds L2 only through the list-item family: L's own items (overlay rows) are carried
select stage1_test.okrun('M15 add_network_pick on the expert list', $q$select public.add_network_pick(stage1_test.id('LE'), '00000000-0000-4000-8000-0000000000e1')$q$);
select stage1_test.val('M16 resolve_list(expert list) carries the expert display', $q$select r->'display'->>'title_en' from public.resolve_list(stage1_test.id('LE')) r$q$, 'Dr Expert');
select stage1_test.fails('M18 add_member: target must hold project_manager', $q$select public.add_member('project', stage1_test.id('J1'), '00000000-0000-4000-8000-0000000000a2', 'manager')$q$, '22023');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.setid('P2', (select id::text from public.create_program('Test Program Two')));
select stage1_test.setid('J2', (select id::text from public.create_project(stage1_test.id('P2'), 'Test Project Two')));
select stage1_test.val('M20 other PM sees only their own project', $q$select count(*)::text from public.projects$q$, '1');
select stage1_test.val('M21 other PM sees no nodes of J1', $q$select count(*)::text from public.nodes where project_id = stage1_test.id('J1')$q$, '0');
select stage1_test.val('M22 other PM sees no responses of J1', $q$select count(*)::text from public.form_responses$q$, '0');
select stage1_test.fails('M23 other PM: get_project_graph(J1) forbidden', $q$select public.get_project_graph(stage1_test.id('J1'))$q$, '42501');
select stage1_test.fails('M24 other PM: ensure_item on a list of J1 forbidden', $q$select public.ensure_item(stage1_test.id('L'), 'form_response', '00000000-0000-4000-8000-0000000000d1')$q$, '42501');
select stage1_test.fails('M25 other PM cannot create a project in program P1', $q$select public.create_project(stage1_test.id('P1'), 'intruder')$q$, '42501');
select stage1_test.fails('M26 other PM cannot save a node of J1', $q$select public.save_node(stage1_test.id('F'), 1, '{"name_en":"hijack"}')$q$, '42501');
select stage1_test.fails('M27 other PM cannot attach themselves to J1 (insert member by RLS)', $q$insert into public.project_members (project_id, user_id) values (stage1_test.id('J1'), '00000000-0000-4000-8000-0000000000a3')$q$, '42501');
reset role;

-- U1 invites U3 (holds project_manager) to J1 as a guest: U3 now sees J1 as well
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.okrun('M30 owner adds another project manager as project member', $q$select public.add_member('project', stage1_test.id('J1'), '00000000-0000-4000-8000-0000000000a3', 'manager')$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('M31 after add_member the guest PM sees both projects', $q$select count(*)::text from public.projects$q$, '2');
select stage1_test.fails('M32 a guest (manager, not owner) cannot add members', $q$select public.add_member('project', stage1_test.id('J1'), '00000000-0000-4000-8000-0000000000a1', 'manager')$q$, '42501');
reset role;

-- ================================================================= participants: founder sees programs through participants, nothing else
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.setid('PA', (select id::text from public.assign_participant(stage1_test.id('J1'), null, '00000000-0000-4000-8000-0000000000a2')));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('P01 participant sees only their own participant row', $q$select count(*)::text from public.participants$q$, '1');
select stage1_test.val('P02 participant still sees no nodes', $q$select count(*)::text from public.nodes$q$, '0');
select stage1_test.val('P03 participant still sees no projects table rows (page comes through RPC)', $q$select count(*)::text from public.projects$q$, '0');
select stage1_test.val('P04 get_my_programs lists the project', $q$select count(*)::text from public.get_my_programs()$q$, '1');
select stage1_test.val('P05 get_founder_program_page works for a participant', $q$select (public.get_founder_program_page(stage1_test.id('J1'))->'project'->>'name_en')$q$, 'Test Project One');
select stage1_test.okrun('P06 participant may request withdrawal', $q$select public.request_withdrawal(stage1_test.id('PA'))$q$);
select stage1_test.val('P07 participant cannot change status (no UPDATE policy: 0 rows updated)', $q$with u as (update public.participants set status = 'attended' returning 1) select count(*)::text from u$q$, '0');
select stage1_test.val('P08 withdrawal request recorded, status unchanged', $q$select status || '/' || (withdrawal_requested_at is not null)::text from public.participants$q$, 'accepted/true');
reset role;

-- ================================================================= public paths: link, form, submit, analytics
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.setid('LK', (select public.ensure_public_link(stage1_test.id('F'), 'form')::text));
reset role;
select stage1_test.setid('slugF', (select slug from public.public_link_slugs where link_id = stage1_test.id('LK') and is_current));
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select stage1_test.val('W01 private form is invisible to anon (no existence leak)', $q$select (public.get_public_form(current_setting('stage1.id_slugF')) is null)::text$q$, 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.okrun('W02 PM publishes the form (visibility public via save_node)', $q$select public.save_node(stage1_test.id('F'), (select rev from public.node_revisions where node_id = stage1_test.id('F')), '{"visibility":"public"}')$q$);
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select stage1_test.val('W03 public form definition is served to anon (2 questions)', $q$select jsonb_array_length(public.get_public_form(current_setting('stage1.id_slugF'))->'questions')::text$q$, '2');
select stage1_test.val('W04 definition whitelist: no answers/config leaked', $q$select (public.get_public_form(current_setting('stage1.id_slugF')) ? 'config')::text$q$, 'false');
select stage1_test.okrun('W05 anon tracks an analytics event through the RPC', $q$select public.track_node_event(current_setting('stage1.id_slugF'), 'form_view')$q$);
reset role;
select stage1_test.val('W06 the analytics row exists', $q$select count(*)::text from public.node_events where node_id = stage1_test.id('F')$q$, '1');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select stage1_test.setid('R2', (select public.submit_form_response(current_setting('stage1.id_slugF'), '{"company_name":"Applicant Two","founder_email":"two@example.invalid"}')::text));
select stage1_test.fails('W07 submit rejects unknown answer keys', $q$select public.submit_form_response(current_setting('stage1.id_slugF'), '{"hack":"x","company_name":"a","founder_email":"b@example.invalid"}')$q$, '22023');
select stage1_test.fails('W08 submit rejects missing required answers', $q$select public.submit_form_response(current_setting('stage1.id_slugF'), '{"company_name":"only"}')$q$, '22023');
reset role;
select stage1_test.val('W09 submitted response is stored on the form node', $q$select count(*)::text from public.form_responses where node_id = stage1_test.id('F') and deleted_at is null$q$, '2');
-- closing the form is enforced server-side
update public.forms set is_active = false where node_id = stage1_test.id('F');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select stage1_test.fails('W10 closed form refuses submissions (server-side gate)', $q$select public.submit_form_response(current_setting('stage1.id_slugF'), '{"company_name":"x","founder_email":"y@example.invalid"}')$q$, 'P0001');
reset role;

-- ================================================================= public booking: atomic slot claim, no leaks
insert into public.booking_providers (id, project_id, node_id, list_item_id) values
  ('00000000-0000-4000-8000-0000000000b1', stage1_test.id('J1'), stage1_test.id('B'), (select id from public.list_items where network_expert_id = '00000000-0000-4000-8000-0000000000e1'));
insert into public.booking_slots (id, project_id, node_id, provider_id, starts_at, ends_at) values
  ('00000000-0000-4000-8000-0000000000b2', stage1_test.id('J1'), stage1_test.id('B'), '00000000-0000-4000-8000-0000000000b1', now() + interval '3 days', now() + interval '3 days 30 minutes');
select stage1_test.fails('BK01 overlapping slot of the same provider is rejected (EXCLUDE gist)',
  $q$insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (stage1_test.id('J1'), stage1_test.id('B'), '00000000-0000-4000-8000-0000000000b1', now() + interval '3 days 10 minutes', now() + interval '3 days 40 minutes')$q$, '23P01');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.setid('LKB', (select public.ensure_public_link(stage1_test.id('B'), 'booking')::text));
select stage1_test.okrun('BK02 PM publishes the booking page', $q$select public.save_node(stage1_test.id('B'), (select rev from public.node_revisions where node_id = stage1_test.id('B')), '{"visibility":"public"}')$q$);
reset role;
select stage1_test.setid('slugB', (select slug from public.public_link_slugs where link_id = stage1_test.id('LKB') and is_current));
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select stage1_test.val('BK03 anon sees the open slot and the provider (no e-mail / meet link in output)',
  $q$select (jsonb_array_length(p->'slots') || '/' || jsonb_array_length(p->'providers') || '/' || (p::text ~ 'expert@example.invalid|meet_link|booking_email')::text) from public.get_public_booking_page(current_setting('stage1.id_slugB')) p$q$, '1/1/false');
select stage1_test.okrun('BK04 anon books the slot', $q$select public.create_booking(current_setting('stage1.id_slugB'), '00000000-0000-4000-8000-0000000000b2', '{"email":"booker@example.invalid","name":"Booker"}')$q$);
select stage1_test.fails('BK05 second booking of the same slot is refused (one confirmed booking per slot)',
  $q$select public.create_booking(current_setting('stage1.id_slugB'), '00000000-0000-4000-8000-0000000000b2', '{"email":"other@example.invalid","name":"Other"}')$q$, 'P0001');   -- (since m34 a name is required first: the slot conflict is what is tested)
select stage1_test.val('BK06 the booked slot disappears from the public page', $q$select jsonb_array_length(p->'slots')::text from public.get_public_booking_page(current_setting('stage1.id_slugB')) p$q$, '0');
reset role;
select stage1_test.val('BK07 a calendar_create job was queued (sync state lives in the job queue)', $q$select count(*)::text from app_private.integration_jobs where kind = 'calendar_create'$q$, '1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('BK08 outsider cannot read bookings', $q$select count(*)::text from public.bookings$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('BK09 PM reads the booking', $q$select count(*)::text from public.bookings$q$, '1');
select stage1_test.fails('BK10 a booking cannot be deleted by deleting its slot (RESTRICT)', $q$delete from public.booking_slots where id = '00000000-0000-4000-8000-0000000000b2'$q$, '23503');
reset role;

-- ================================================================= certificates: only attended + completed, verifiable, template immutable
-- NOTE (m42, owner decision 08 section 17.2): this is the STAGE-1 clean-slate check (m00 - m07). Later migrations changed the model: since m42 a certificate belongs to a FOUNDER ACCOUNT (certificates.user_id, one per founder of a company), the m07 policy
-- certificates_select_pm_alumni_own was tightened to "revoked_at IS NULL AND user_id = auth.uid() AND the participant attended" (a founder no longer reads his co-founders' certificates), and issue_certificate() authorises the participant and returns the first person
-- certificate. The checks below stay valid at stage 1 (the participant here is a user-level one: user_id = U2) and still hold after m42; the per-person rules are covered by db/verify/v42_certificates_person.sql. (This file cannot run on the current stack: since m25 the role fixture of its
-- setup trips the staff / founder exclusivity trigger; it is kept as the stage-1 record.)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
-- (m43: the template tables are read-only for the API roles, templates are written through save_node (versioned, definer): the fixture row is inserted as the owner.
--  Since m42 an issue also needs a template that prints the person name.)
reset role;
select stage1_test.okrun('CE01 template row (setup, as owner; m43: no direct PM write)', $q$insert into public.certificate_templates (id, project_id, node_id, version, language, file_path, file_kind, width_px, height_px)
    values ('00000000-0000-4000-8000-0000000000f1', stage1_test.id('J1'), stage1_test.id('CN'), 1, 'ar', stage1_test.id('J1')::text || '/' || stage1_test.id('CN')::text || '/v1.webp', 'image', 2000, 1400)$q$);
select stage1_test.okrun('CE01b the person-name field of the template (setup)', $q$insert into public.certificate_template_fields (template_id, project_id, var, x, y, w, size)
    values ('00000000-0000-4000-8000-0000000000f1', stage1_test.id('J1'), 'person_name', 0.5, 0.5, 0.5, 0.04)$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.fails('CE01c a PM cannot write a template row directly (m43, 42501)', $q$update public.certificate_templates set width_px = 1999 where id = '00000000-0000-4000-8000-0000000000f1'$q$, '42501');
select stage1_test.fails('CE02 cannot issue before the project is completed / participant attended', $q$select public.issue_certificate(stage1_test.id('PA'), stage1_test.id('CN'))$q$, '23514');
select stage1_test.okrun('CE03 mark all attended + complete project', $q$select public.mark_all_attended(stage1_test.id('J1')), public.complete_project(stage1_test.id('J1'))$q$);
select stage1_test.setid('CERT', (select id::text from public.issue_certificate(stage1_test.id('PA'), stage1_test.id('CN'))));
select stage1_test.val('CE04 issue_certificate is idempotent', $q$select ((select id from public.issue_certificate(stage1_test.id('PA'), stage1_test.id('CN'))) = stage1_test.id('CERT'))::text$q$, 'true');
reset role;
select stage1_test.fails('CE05 template is immutable once referenced (even for the table owner: the trigger, 23514)', $q$update public.certificate_templates set width_px = 1 where id = '00000000-0000-4000-8000-0000000000f1'$q$, '23514');
select stage1_test.setid('code', (select code from public.certificates where id = stage1_test.id('CERT')));
update public.nodes set show_to_participants = true where id = stage1_test.id('CN');   -- (m42: an owner reads his certificate only while the node is shown to participants)
reset role;
do $$
declare v_code text; v jsonb;
begin
  select code into v_code from public.certificates limit 1;
  perform stage1_test.t('CE06 code format matches ^[0-9A-HJKMNP-TV-Z]{4}(-...){2}', v_code ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$', 'len ' || length(v_code));
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  v := public.verify_certificate(v_code);
  perform stage1_test.t('CE07 anon verify: valid + program name, no ids', (v->>'valid') = 'true' and v->>'program_name' in ('Test Program One', 'برنامج اختبار 1') and not (v ? 'participant_id'), v::text);
  reset role;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('CE08 attended participant reads their own certificate row', $q$select count(*)::text from public.certificates$q$, '1');
select stage1_test.okrun('CE09 render payload for the owner', $q$select public.get_certificate_render_payload(stage1_test.id('CERT'))$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.okrun('CE10 PM revokes', $q$select public.revoke_certificate(stage1_test.id('CERT'), 'test')$q$);
reset role;
do $$
declare v jsonb; v_code text;
begin
  select code into v_code from public.certificates limit 1;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  v := public.verify_certificate(v_code);
  reset role;
  perform stage1_test.t('CE11 revoked certificate verifies as invalid', (v->>'valid') = 'false' and (v->>'revoked') = 'true', v::text);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.val('CE12 revoked certificate is hidden from the founder', $q$select count(*)::text from public.certificates$q$, '0');
reset role;

-- ================================================================= storage policies (split buckets)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select stage1_test.okrun('ST01 PM uploads under their project folder of public-assets', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('public-assets', %L, %L)$q$, stage1_test.id('J1')::text || '/covers/a.webp', '00000000-0000-4000-8000-0000000000a1'));
select stage1_test.fails('ST02 PM cannot upload under another project folder', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('public-assets', %L, %L)$q$, stage1_test.id('J2')::text || '/covers/a.webp', '00000000-0000-4000-8000-0000000000a1'), '42501');
select stage1_test.fails('ST03 PM cannot write to global/ (super_admin only)', $q$insert into storage.objects (bucket_id, name, owner_id) values ('public-assets', 'global/x.webp', '00000000-0000-4000-8000-0000000000a1')$q$, '42501');
select stage1_test.fails('ST04 no direct upload to form-uploads (signed URL only)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('form-uploads', %L, %L)$q$, stage1_test.id('J1')::text || '/x', '00000000-0000-4000-8000-0000000000a1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select stage1_test.fails('ST05 anon cannot upload to public-assets', $q$insert into storage.objects (bucket_id, name) values ('public-assets', 'x/y.webp')$q$, '42501');
select stage1_test.fails('ST06 anon cannot upload to the legacy event-assets bucket either', $q$insert into storage.objects (bucket_id, name) values ('event-assets', 'x/y.webp')$q$, '42501');
reset role;

-- SET inside a transaction is undone by ROLLBACK, so carry the result lines out as a psql (client-side) variable first
select current_setting('stage1.res', true) as res \gset
rollback;

-- ================================================================= persist the PASS/FAIL lines (the data itself was rolled back)
begin;
insert into migration.run (phase, status, note) values ('stage1-verify-v03', 'running', 'role-switch tests (rolled back)') returning id as run_id \gset
insert into migration.recon (run_id, check_key, expected, actual, status)
  select :run_id, split_part(line, '|', 2), 'pass', split_part(line, '|', 3), split_part(line, '|', 1)
  from regexp_split_to_table(:'res', E'\n') line where line <> '';
update migration.run set finished_at = now(), status = case when exists (select 1 from migration.recon where run_id = :run_id and status <> 'ok') then 'FAIL' else 'PASS' end where id = :run_id;
commit;
select status, check_key, actual from migration.recon where run_id = :run_id order by (status = 'ok'), check_key;
select count(*) filter (where status = 'ok') as passed, count(*) filter (where status <> 'ok') as failed from migration.recon where run_id = :run_id;
select (count(*) filter (where status <> 'ok') > 0) as failed from migration.recon where run_id = :run_id \gset
\if :failed
  do $$ begin raise exception 'v03: role-switch tests FAILED (see migration.recon)'; end $$;
\endif
