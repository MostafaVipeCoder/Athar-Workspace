-- v40_withdrawn  (m40: WITHDRAWN replaces "Hide" - one predicate, every consumer)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.
-- A = temporary super_admin (the PM), P2 = a project_manager of ANOTHER scope (no membership), F1 = a founder whose VERIFIED e-mail is the
-- e-mail of application R1.
-- The chain: Form -> Stage 1 (S1) -> Stage 2 (S2) -> Company list (LC) -> Distribution (DS) / Agenda tab (AG); S1 interview -> Interview
-- booking (BI); Expert list (LM) -> Distribution mentors / Mentor booking (BM) / Agenda presenter / a second list (LM2).
-- NOTE: a scalar sub-select in the SAME statement as a data-modifying function call sees the OLD snapshot, so every write is its own
-- statement (\gset) and the state is checked in the next one.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v40.res', '', false) \gset

begin;
create schema v40_test;
grant usage on schema v40_test to public;
create or replace function v40_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v40.res', current_setting('v40.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v40_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v40_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v40_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v40_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare h text;
begin
  begin
    execute p_sql;
    perform v40_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    perform v40_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or h = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(h, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v40_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v40_test.t(p_key, true, 'ok');
  exception when others then
    perform v40_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v40_test from public;
grant execute on all functions in schema v40_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v40_test.val('C01 the predicate and its helpers exist', $q$select (to_regprocedure('app_private.is_withdrawn(uuid,uuid,uuid,timestamptz)') is not null and to_regprocedure('app_private.item_is_withdrawn(uuid)') is not null and to_regprocedure('app_private.provider_is_withdrawn(uuid)') is not null and to_regprocedure('app_private.withdrawal_detail(uuid,uuid,uuid,timestamptz,text)') is not null and to_regprocedure('app_private.apply_withdrawal(uuid,boolean,text)') is not null and to_regprocedure('public.set_item_withdrawn(uuid,boolean,text)') is not null and to_regprocedure('public.withdraw_participant(uuid,boolean,text)') is not null)::text$q$, 'true');
select v40_test.val('C02 every m40 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('is_withdrawn','item_is_withdrawn','provider_is_withdrawn','withdrawal_detail','apply_withdrawal','set_item_withdrawn','withdraw_participant','bump_withdrawal_revs') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v40_test.val('C03 anon executes none of the PM RPCs; the app_private helpers are executable by neither anon nor authenticated', $q$select (not has_function_privilege('anon','public.set_item_withdrawn(uuid,boolean,text)','EXECUTE') and not has_function_privilege('anon','public.withdraw_participant(uuid,boolean,text)','EXECUTE') and has_function_privilege('authenticated','public.set_item_withdrawn(uuid,boolean,text)','EXECUTE') and has_function_privilege('authenticated','public.withdraw_participant(uuid,boolean,text)','EXECUTE') and not has_function_privilege('anon','app_private.is_withdrawn(uuid,uuid,uuid,timestamptz)','EXECUTE') and not has_function_privilege('authenticated','app_private.is_withdrawn(uuid,uuid,uuid,timestamptz)','EXECUTE') and not has_function_privilege('authenticated','app_private.item_is_withdrawn(uuid)','EXECUTE') and not has_function_privilege('authenticated','app_private.apply_withdrawal(uuid,boolean,text)','EXECUTE') and not has_function_privilege('authenticated','app_private.withdrawal_detail(uuid,uuid,uuid,timestamptz,text)','EXECUTE'))::text$q$, 'true');
select v40_test.val('C04 participant_withdrawals: RLS enabled + forced, no client write, anon has no grant', $q$select (c.relrowsecurity and c.relforcerowsecurity and not has_table_privilege('authenticated','public.participant_withdrawals','INSERT') and not has_table_privilege('authenticated','public.participant_withdrawals','UPDATE') and not has_table_privilege('authenticated','public.participant_withdrawals','DELETE') and not has_table_privilege('anon','public.participant_withdrawals','SELECT'))::text from pg_class c where c.oid = 'public.participant_withdrawals'::regclass$q$, 'true');
select v40_test.val('C05 the predicate on its own: item flag, nothing, unknown identity', $q$select app_private.is_withdrawn(null, null, null, now())::text || '/' || app_private.is_withdrawn(null, null, null, null) || '/' || app_private.is_withdrawn('00000000-0000-4000-8000-0000000040ff', '00000000-0000-4000-8000-0000000040fe', null, null)$q$, 'true/false/false');
select v40_test.val('C06 every consumer calls the ONE predicate (catalog: 17 functions)', $q$select count(*)::text from unnest(array['app_private.resolve_list_rows(uuid,jsonb,integer,jsonb,boolean)','public.enroll_accepted(uuid,uuid)','public.list_participants(uuid,text)','public.detach_item_to_manual(uuid)','app_private.invite_for(uuid,text)','public.get_public_booking_page(text,uuid,text)','public.create_booking(text,uuid,jsonb,text)','public.create_invitations(uuid,uuid[])','public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)','public.enqueue_email(uuid,text,uuid[],integer,boolean)','public.get_booking_extras(uuid)','app_private.distribution_payload(uuid,boolean)','public.set_distribution_session_companies(uuid,jsonb)','public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)','public.my_meetings(uuid)','public.get_public_tab(text,uuid,jsonb)','public.get_founder_block(uuid,text,uuid,jsonb)']::regprocedure[]) f where pg_get_functiondef(f) like '%withdrawn(%'$q$, '17');
select v40_test.val('C07 the migrated data is untouched (0 participants, 612 items, 2 hidden, no withdrawn item, no side row; counted in the MIGRATED projects: hermetic)', $q$select (select count(*) from public.participants where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text || '/' || (select count(*) from public.list_items where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a'))) || '/' || (select count(*) from public.list_items where excluded and project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a'))) || '/' || (select count(*) from public.list_items where withdrawn_at is not null and project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a'))) || '/' || (select count(*) from public.participant_withdrawals where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))$q$, '0/612/2/0/0');
select v40_test.val('C08 every migrated list resolves as before: (all rows - default rows) = the legacy hidden rows of that list', $q$select count(*)::text from public.nodes n where n.type in ('list','selection') and n.deleted_at is null and n.project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')) and (select count(*) from app_private.resolve_list_rows(n.id, '{"include_excluded":true,"include_withdrawn":true}'::jsonb, 200, null, false)) - (select count(*) from app_private.resolve_list_rows(n.id, '{}'::jsonb, 200, null, false)) <> (select count(*) from public.list_items li where li.list_node_id = n.id and li.excluded)$q$, '0');

-- ================================================================= fixtures (as postgres + A)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000040a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v40-admin@example.invalid','{"provisioned":true}','{"full_name":"V40 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-0000000040a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v40-pm2@example.invalid','{"provisioned":true}','{"full_name":"V40 Other PM"}', now(), now()),
 ('00000000-0000-4000-8000-0000000040f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f1@example.invalid','{"provisioned":true}','{"full_name":"V40 Founder One"}', now(), now());
update auth.users set confirmation_sent_at = now() - interval '1 minute', email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000040f1';   -- a confirmation SENT then CLICKED (m43)
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000040a0','super_admin'), ('00000000-0000-4000-8000-0000000040a1','project_manager'),
  ('00000000-0000-4000-8000-0000000040f1','founder');
insert into public.network_experts (id, name_en, name_ar, title_en, email) values ('00000000-0000-4000-8000-0000000040e1', 'Mentor One', 'منتور واحد', 'CEO', 'mentor1@example.invalid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V40 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V40 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V40 Form"}', 0, 0, '{}')).id as frm \gset
select (public.add_node(:'proj', 'selection', '{"en":"Stage 1"}', 0, 0, '{}')).id as s1 \gset
select (public.add_node(:'proj', 'selection', '{"en":"Stage 2"}', 0, 0, '{}')).id as s2 \gset
select (public.add_node(:'proj', 'list', '{"en":"Companies"}', 0, 0, '{"subkind":"company"}')).id as lc \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors"}', 0, 0, '{"subkind":"expert"}')).id as lm \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors copy"}', 0, 0, '{"subkind":"expert"}')).id as lm2 \gset
select (public.add_node(:'proj', 'distribution', '{"en":"Mentoring"}', 0, 0, '{}')).id as ds \gset
select (public.add_node(:'proj', 'booking', '{"en":"Mentor sessions"}', 0, 0, '{"mode":"mentor"}')).id as bm \gset
select (public.add_node(:'proj', 'booking', '{"en":"Interviews"}', 0, 0, '{"mode":"interview"}')).id as bi \gset
select (public.add_node(:'proj', 'agenda', '{"en":"Agenda"}', 0, 0, '{}')).id as ag \gset
select (public.add_node(:'proj', 'certificates', '{"en":"Certificates"}', 0, 0, '{}')).id as cn \gset
select (public.connect(:'proj', :'frm', 'responses', :'s1', 'applicants', '{}')).id as e1 \gset
select (public.connect(:'proj', :'s1', 'approved', :'s2', 'applicants', '{}')).id as e2 \gset
select (public.connect(:'proj', :'s2', 'approved', :'lc', 'items-in', '{}')).id as e3 \gset
select (public.connect(:'proj', :'s1', 'interview', :'bi', 'bookers', '{}')).id as e4 \gset
select (public.connect(:'proj', :'lm', 'items', :'lm2', 'items-in', '{}')).id as e5 \gset
select (public.connect(:'proj', :'lc', 'list-tab', :'ag', 'tabs', '{}')).id as etab \gset
reset role;
update public.nodes set config = '{"stages":[{"key":"screening","type":"inbox"},{"key":"interview","type":"stage","email":"interview"},{"key":"accepted","type":"accept","email":"acceptance"},{"key":"rejected","type":"reject","email":"rejection"}],"passing":["accepted"],"participantRule":{"onAccept":"create_participant"},
  "emails":{"interview":{"subject":"Interview {{company_name}}","body_html":"Book: {{booking_link}}"},"acceptance":{"subject":"Welcome {{company_name}}","body_html":"Hi {{founder_name}}"}}}'::jsonb where id = :'s1';
update public.nodes set config = '{"stages":[{"key":"screening","type":"inbox"},{"key":"accepted","type":"accept"},{"key":"rejected","type":"reject"}],"passing":["accepted"]}'::jsonb where id = :'s2';
insert into public.form_responses (id, project_id, node_id, answers) values
 ('00000000-0000-4000-8000-0000000040b1', :'proj', :'frm', '{"company_name":"Resp One","founder_name":"Founder One","founder_email":"F1@example.invalid"}'),
 ('00000000-0000-4000-8000-0000000040b2', :'proj', :'frm', '{"company_name":"Resp Two","founder_name":"Founder Two","founder_email":"f2@example.invalid"}'),
 ('00000000-0000-4000-8000-0000000040b3', :'proj', :'frm', '{"company_name":"Resp Three","founder_name":"Founder Three","founder_email":"f3@example.invalid"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;

-- stage 1: R1 + R2 accepted, R3 in the interview stage
select public.ensure_item(:'s1', 'form_response', '00000000-0000-4000-8000-0000000040b1') as i1 \gset
select public.ensure_item(:'s1', 'form_response', '00000000-0000-4000-8000-0000000040b2') as i2 \gset
select public.ensure_item(:'s1', 'form_response', '00000000-0000-4000-8000-0000000040b3') as i3 \gset
select public.set_item_status(:'i1', 'accepted', 'strong');
select public.set_item_status(:'i2', 'accepted', 'good');
select public.set_item_status(:'i3', 'interview', null);
-- stage 2: both accepted again; the company list is fed by stage 2
select public.ensure_item(:'s2', 'form_response', '00000000-0000-4000-8000-0000000040b1') as j1 \gset
select public.ensure_item(:'s2', 'form_response', '00000000-0000-4000-8000-0000000040b2') as j2 \gset
select public.set_item_status(:'j1', 'accepted', null);
select public.set_item_status(:'j2', 'accepted', null);
select public.ensure_item(:'lc', 'form_response', '00000000-0000-4000-8000-0000000040b1') as c1 \gset
select public.ensure_item(:'lc', 'form_response', '00000000-0000-4000-8000-0000000040b2') as c2 \gset
-- experts: one network expert (M1), two manual ones (M2, M3)
select public.add_network_pick(:'lm', '00000000-0000-4000-8000-0000000040e1') as m1 \gset
select public.add_manual_item(:'lm', '{"title_en":"Mentor Two","email":"m2@example.invalid"}') as m2 \gset
select public.add_manual_item(:'lm', '{"title_en":"Mentor Three"}') as m3 \gset
select v40_test.val('S00 fixture: S1 lists 3 applicants, S2 2, LC 2, LM 3', format($q$select (select count(*) from public.resolve_list('%s')) || '/' || (select count(*) from public.resolve_list('%s')) || '/' || (select count(*) from public.resolve_list('%s')) || '/' || (select count(*) from public.resolve_list('%s'))$q$, :'s1', :'s2', :'lc', :'lm'), '3/2/2/3');
select v40_test.val('S01 nobody is withdrawn yet: no flag, no withdrawal object', format($q$select count(*) filter (where (r->>'withdrawn')::boolean)::text || '/' || count(*) filter (where jsonb_typeof(r->'withdrawal') = 'object') from public.resolve_list('%s') r$q$, :'s1'), '0/0');
select v40_test.val('S02 the expert copy list (fed by the expert list; only referenced experts flow downstream) holds M1', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'lm2'), '1');

-- distribution: one day, two 20-minute rounds, mentors M1 + M2, companies C1 + C2 (a full 2 x 2 grid)
select rev as rv from public.node_revisions where node_id = :'ds' \gset
select v40_test.okrun('D00 distribution configured (one save)', format($q$select public.save_node('%s', %s, '{"visibility":"public"}'::jsonb, jsonb_build_object(
   'settings', jsonb_build_object('slot_duration_min', 20, 'gap_min', 0, 'start_time', '10:00', 'unique_pairing', false),
   'days', jsonb_build_array(jsonb_build_object('day_index', 0, 'day_date', '2030-10-12', 'start_time', '10:00', 'total_round_min', 40, 'mentor_item_ids', jsonb_build_array('%s','%s')))))$q$, :'ds', :'rv', :'m1', :'m2'));
select v40_test.okrun('D00b published', format($q$select public.set_distribution_published('%s', true)$q$, :'ds'));
select id as day1 from public.distribution_days where node_id = :'ds' and day_index = 0 \gset
select v40_test.val('D01 four sessions stored (2 rounds x 2 mentors, every cell filled)', format($q$select (x->>'inserted') from public.replace_distribution_sessions('%s', 'all', null, jsonb_build_array(
   jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s'),
   jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s'))) x$q$, :'ds',
   :'day1', :'m1', :'c1', :'day1', :'m2', :'c2', :'day1', :'m1', :'c2', :'day1', :'m2', :'c1'), '4');

-- booking: Mentor sessions (provider M1, 2 slots), Interviews (provider M2, 2 slots); both public
reset role;
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email) values (:'proj', :'bm', :'m1', 'book-me@example.invalid') returning id as pvm \gset
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email) values (:'proj', :'bi', :'m2', 'm2@example.invalid') returning id as pvi \gset
select to_char(date_trunc('hour', now() + interval '3 days'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as base \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values
  (:'proj', :'bm', :'pvm', :'base'::timestamptz, :'base'::timestamptz + interval '30 minutes'),
  (:'proj', :'bm', :'pvm', :'base'::timestamptz + interval '40 minutes', :'base'::timestamptz + interval '70 minutes'),
  (:'proj', :'bi', :'pvi', :'base'::timestamptz, :'base'::timestamptz + interval '30 minutes'),
  (:'proj', :'bi', :'pvi', :'base'::timestamptz + interval '40 minutes', :'base'::timestamptz + interval '70 minutes');
select id as slotm from public.booking_slots where node_id = :'bm' order by starts_at limit 1 \gset
select id as sloti from public.booking_slots where node_id = :'bi' order by starts_at limit 1 \gset
update public.nodes set visibility = 'public' where id in (:'bm', :'bi', :'lc', :'ag', :'lm');
update public.edges set audience = 'public' where id = :'etab';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select public.ensure_public_link(:'bm', 'booking', null, null) as lkbm \gset
select public.ensure_public_link(:'ag', 'agenda', null, null) as lkag \gset
select public.ensure_public_link(:'lc', 'view', 'list-tab', null) as lklc \gset
reset role;
select s.slug as slugbm from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'bm' and l.kind = 'booking' \gset
select s.slug as slugag from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'ag' and l.kind = 'agenda' \gset
select s.slug as sluglc from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'lc' and l.kind = 'view' and l.view_key = 'list-tab' \gset
-- an agenda with one session presented by M1 (an expert reference)
insert into public.agenda_days (project_id, node_id, sort_order, day_date, name_en) values (:'proj', :'ag', 0, date '2030-10-12', 'Day 1') returning id as agday \gset
insert into public.agenda_slots (project_id, day_id, sort_order, start_time, end_time, title_en, presenter_item_id, show_presenter) values (:'proj', :'agday', 0, '10:00', '11:00', 'Keynote', :'m1', true);
-- the interview invitation of R3 (token in the e-mail link)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('E00 the interview invitation of R3 is queued', format($q$select r.status from public.send_selection_emails('%s', 'interview', array['%s'::uuid], 'en', 'https://app.example.invalid') r$q$, :'s1', :'i3'), 'queued');
reset role;
select substring(o.body_html from 'invite=([A-Za-z0-9_-]+)') as tok from app_private.email_outbox o where o.node_id = :'s1' and o.email_key = 'interview' limit 1 \gset
select s.slug as slugbi from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'bi' and l.kind = 'booking' \gset
select count(*) as n_out from app_private.email_outbox \gset
select rev as rev_ds0 from public.node_revisions where node_id = :'ds' \gset
select rev as rev_lc0 from public.node_revisions where node_id = :'lc' \gset
select rev as rev_s20 from public.node_revisions where node_id = :'s2' \gset
select rev as rev_bi0 from public.node_revisions where node_id = :'bi' \gset
select rev as rev_cn0 from public.node_revisions where node_id = :'cn' \gset

-- ================================================================= BEFORE: what everybody sees while nobody is withdrawn
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v40_test.val('B01 anon: the Companies tab lists both companies', format($q$select jsonb_array_length(public.get_public_tab('%s', '%s')->'data'->'items')::text$q$, :'slugag', :'etab'), '2');
select v40_test.val('B02 anon: the agenda shows the expert presenter', format($q$select public.get_public_tab('%s', null)->'data'->'days'->0->'slots'->0->>'presenter_en'$q$, :'slugag'), 'Mentor One');
select v40_test.val('B03 anon: the mentor booking page offers the provider and its 2 slots', format($q$select jsonb_array_length(x->'providers')::text || '/' || jsonb_array_length(x->'slots') from public.get_public_booking_page('%s') x$q$, :'slugbm'), '1/2');
select v40_test.val('B04 anon: the interview invitation opens the page', format($q$select (public.get_public_booking_page('%s', null, '%s'))->>'status'$q$, :'slugbi', :'tok'), 'open');
reset role;
select v40_test.val('B05 the platform distribution payload shows 2 companies, 2 mentors, 4 full sessions', format($q$select jsonb_array_length(x->'companies')::text || '/' || jsonb_array_length(x->'mentors') || '/' || jsonb_array_length(x->'sessions') || '/' || (select count(*) from jsonb_array_elements(x->'sessions') s where s->>'c' is not null) from (select app_private.distribution_payload('%s', false) x) y$q$, :'ds'), '2/2/4/4');

-- ================================================================= enrolment first: R1 + R2 become participants, F1 gets linked by the verified e-mail
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('P00 enroll_accepted enrolls the two accepted applicants of stage 1', format($q$select public.enroll_accepted('%s', '%s')::text$q$, :'proj', :'s1'), '2');
select id as pa1 from public.participants where form_response_id = '00000000-0000-4000-8000-0000000040b1' \gset
select id as pa2 from public.participants where form_response_id = '00000000-0000-4000-8000-0000000040b2' \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040f1","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('F00 the founder (verified e-mail of R1) sees the program, accepted', $q$select jsonb_array_length(public.list_my_programs())::text || '/' || (public.list_my_programs()->0->>'status')$q$, '1/accepted');
reset role;

-- ================================================================= WITHDRAW R1 on the Selection board (stage 1 item)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_withdrawn(:'i1', true, '  left the program  ') as r_w01 \gset
select v40_test.val('W01 set_item_withdrawn on the stage-1 item answers withdrawn:true and the participant id', format($q$select (%L::jsonb->>'withdrawn') || '/' || (%L::jsonb->>'participant_id')$q$, :'r_w01', :'r_w01'), 'true/' || :'pa1');
select v40_test.val('W02 ONE row only: the existing participant is withdrawn (its status was accepted), reason + restore status in the PM-only side table', format($q$select p.status || '/' || w.restore_status || '/' || w.reason from public.participants p join public.participant_withdrawals w on w.participant_id = p.id where p.id = '%s'$q$, :'pa1'), 'withdrawn/accepted/left the program');
select v40_test.val('W03 no list item carries the flag for an identity item (the participant row is the single truth)', format($q$select count(*)::text from public.list_items where project_id = '%s' and withdrawn_at is not null$q$, :'proj'), '0');
select v40_test.val('W04 stage 1 (default): R1 is gone, R2 + R3 remain', format($q$select string_agg(r->'display'->>'title_en', ',' order by r->'display'->>'title_en') from public.resolve_list('%s') r$q$, :'s1'), 'Resp Three,Resp Two');
select v40_test.val('W05 stage 1 (include_withdrawn): the PM still gets R1 with the flag, the date and the reason', format($q$select (r->>'withdrawn') || '/' || (r->'withdrawal'->>'reason') || '/' || ((r->'withdrawal'->>'at') is not null) || '/' || (r->>'status') from public.resolve_list('%s', '{"include_withdrawn":true}') r where r->'display'->>'title_en' = 'Resp One'$q$, :'s1'), 'true/left the program/true/accepted');
select v40_test.val('W06 the stage keeps the status accepted (withdrawn is not a stage)', format($q$select status from public.list_items where id = '%s'$q$, :'i1'), 'accepted');
select v40_test.val('W07 stage 1 approved port: the stage filter + withdrawn leaves only R2', format($q$select string_agg(r->'display'->>'title_en', ',') from public.resolve_list('%s', '{"status":["accepted"]}') r$q$, :'s1'), 'Resp Two');
select v40_test.val('W08 stage 2 (fed by stage 1 approved): R1 is gone even though its own stage-2 row says accepted', format($q$select string_agg(r->'display'->>'title_en', ',') from public.resolve_list('%s') r$q$, :'s2'), 'Resp Two');
select v40_test.val('W09 the company list (fed by stage 2) shows only R2; its own row of R1 is hidden too', format($q$select string_agg(r->'display'->>'title_en', ',') from public.resolve_list('%s') r$q$, :'lc'), 'Resp Two');
select v40_test.val('W10 the company list with include_withdrawn: R1 is back, flagged (the same participant row decides in every list)', format($q$select (r->>'withdrawn') from public.resolve_list('%s', '{"include_withdrawn":true}') r where r->'display'->>'title_en' = 'Resp One'$q$, :'lc'), 'true');
reset role;
select v40_test.val('W11 app_private.item_is_withdrawn agrees for the three items of R1 (stage 1, stage 2, list) and not for R2', format($q$select app_private.item_is_withdrawn('%s')::text || '/' || app_private.item_is_withdrawn('%s') || '/' || app_private.item_is_withdrawn('%s') || '/' || app_private.item_is_withdrawn('%s')$q$, :'i1', :'j1', :'c1', :'c2'), 'true/true/true/false');
select v40_test.val('W12 the consumers were told: the revision of the company list, stage 2, the distribution, the interview booking and the certificates node went up', format($q$select ((select rev from public.node_revisions where node_id = '%s') > %s)::text || '/' || ((select rev from public.node_revisions where node_id = '%s') > %s) || '/' || ((select rev from public.node_revisions where node_id = '%s') > %s) || '/' || ((select rev from public.node_revisions where node_id = '%s') > %s) || '/' || ((select rev from public.node_revisions where node_id = '%s') > %s)$q$, :'lc', :'rev_lc0', :'s2', :'rev_s20', :'ds', :'rev_ds0', :'bi', :'rev_bi0', :'cn', :'rev_cn0'), 'true/true/true/true/true');

-- public / platform surfaces (anon): R1 vanished
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v40_test.val('W20 anon: the Companies tab (Agenda host) lists ONLY R2, no PM-only key', format($q$select jsonb_array_length(x->'data'->'items')::text || '/' || (x->'data'->'items'->0->'display'->>'title_en') || '/' || (x->'data'->'items'->0 ? 'withdrawn')::text || '/' || (x->'data'->'items'->0 ? 'withdrawal')::text || '/' || (x->'data'->'items'->0 ? 'excluded')::text from (select public.get_public_tab('%s', '%s') x) y$q$, :'slugag', :'etab'), '1/Resp Two/false/false/false');
select v40_test.val('W21 anon: the list page itself (get_public_list) also omits R1', format($q$select jsonb_array_length(public.get_public_list('%s')->'data'->'items')::text$q$, :'sluglc'), '1');
reset role;
-- founder: the withdrawn founder sees a status-only card (03-6)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040f1","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('W30 founder: the Programs list hides the withdrawn program', $q$select public.list_my_programs()::text$q$, '[]');
select v40_test.val('W31 founder: asked for withdrawn, the card is restricted and carries the status only', $q$select (c->>'status') || '/' || (c->>'restricted') || '/' || (c ? 'cover_path')::text || '/' || (c ? 'start_date')::text from jsonb_array_elements(public.list_my_programs(true)) c$q$, 'withdrawn/true/false/false');
select v40_test.val('W32 founder: the Program page = header + status, no blocks', format($q$select (p->>'restricted') || '/' || jsonb_array_length(p->'blocks') || '/' || (p->'participant'->>'status') from (select public.get_founder_program_page('%s') p) x$q$, :'proj'), 'true/0/withdrawn');
select v40_test.fails('W33 founder: the lazy blocks are refused', format($q$select public.get_founder_block('%s', 'companies', '%s')$q$, :'proj', :'lc'), '42501');
select v40_test.val('W34 founder: the side table (the PM reason) is invisible to the founder through the API', $q$select count(*)::text from public.participant_withdrawals$q$, '0');
select v40_test.fails('W35 founder: cannot mark anybody withdrawn', format($q$select public.set_item_withdrawn('%s', true)$q$, :'i2'), '42501');
select v40_test.fails('W36 founder: cannot reinstate himself', format($q$select public.withdraw_participant('%s', false)$q$, :'pa1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a1","role":"authenticated"}', true);
set local role authenticated;
select v40_test.fails('W37 a project manager of another scope cannot withdraw (no membership)', format($q$select public.set_item_withdrawn('%s', true)$q$, :'i2'), '42501');
select v40_test.fails('W38 ... nor withdraw a participant', format($q$select public.withdraw_participant('%s', true)$q$, :'pa2'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('W39 the PM sees the reason through the API (RLS: the PM of the project)', format($q$select count(*)::text from public.participant_withdrawals where participant_id = '%s'$q$, :'pa1'), '1');

-- Distribution: the PM payload flags, the platform payload hides, the RPCs refuse
select v40_test.val('D10 PM payload: R1 + its sessions stay, the company is flagged withdrawn (2 companies, 1 flagged, 4 sessions)', format($q$select jsonb_array_length(x->'companies')::text || '/' || (select count(*) from jsonb_array_elements(x->'companies') c where (c->>'withdrawn')::boolean) || '/' || jsonb_array_length(x->'sessions') from public.get_distribution_payload('%s') x$q$, :'ds'), '2/1/4');
reset role;
select v40_test.val('D11 platform / public payload: 1 company, the withdrawn one is blank in its cells (4 sessions, 2 with a company), no flag value', format($q$select jsonb_array_length(x->'companies')::text || '/' || jsonb_array_length(x->'sessions') || '/' || (select count(*) from jsonb_array_elements(x->'sessions') s where s->>'c' is not null) || '/' || ((x->'companies'->0->>'withdrawn') is null)::text from (select app_private.distribution_payload('%s', false) x) y$q$, :'ds'), '1/4/2/true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.fails('D12 the manual assign refuses a withdrawn company', format($q$select public.set_distribution_session_companies('%s', jsonb_build_array(jsonb_build_object('session_id', (select id from public.distribution_sessions where day_id = '%s' and slot_index = 0 and mentor_item_id = '%s'), 'company_item_id', '%s')))$q$, :'ds', :'day1', :'m2', :'c1'), '22023', 'distribution_invalid');
select v40_test.fails('D13 regenerating with a withdrawn company in the rows is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m1', :'c1'), '22023', 'distribution_invalid');
select v40_test.okrun('D14 a regeneration WITHOUT the withdrawn company is accepted (the client filters the candidates)', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'), jsonb_build_object('day_id','%s','slot_index',1,'mentor_item_id','%s','company_item_id','%s')))$q$, :'ds', :'day1', :'day1', :'m1', :'c2', :'day1', :'m1', :'c2'));

-- E-mails and invitations
select v40_test.val('E10 the e-mails skip a withdrawn applicant: R1 acceptance e-mail answers "withdrawn"', format($q$select r.status from public.send_selection_emails('%s', 'acceptance', array['%s'::uuid], 'en') r$q$, :'s1', :'i1'), 'withdrawn');
select v40_test.fails('E11 create_invitations refuses a withdrawn item', format($q$select * from public.create_invitations('%s', array['%s'::uuid])$q$, :'bi', :'i1'), '22023', 'item_withdrawn');
select v40_test.val('E12 enroll_accepted skips the withdrawn R1 (R2 already enrolled: 0 new rows) and R1 stays withdrawn', format($q$select public.enroll_accepted('%s', '%s')::text || '/' || (select status from public.participants where id = '%s')$q$, :'proj', :'s1', :'pa1'), '0/withdrawn');
reset role;
select v40_test.val('E13 nothing was queued by the skipped sends', format($q$select ((select count(*) from app_private.email_outbox) = %s)::text$q$, :'n_out'), 'true');

-- ================================================================= WITHDRAW R3 (an interview-stage applicant that was never enrolled)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_withdrawn(:'i3', true, 'declined the interview') as r_n01 \gset
reset role;        -- source / source_node_id are PM-internal columns: not readable by the authenticated role since m43
select v40_test.val('N01 a never-enrolled applicant gets a participant row only to record the withdrawal (source selection, this stage, restore = not_enrolled)', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select p.status || '/' || p.source || '/' || (p.source_node_id = '%s')::text || '/' || w.restore_status || '/' || w.reason from public.participants p join public.participant_withdrawals w on w.participant_id = p.id where p.form_response_id = '00000000-0000-4000-8000-0000000040b3')$q$, :'r_n01', :'s1'), 'true/withdrawn/selection/true/not_enrolled/declined the interview');
set local role authenticated;
select v40_test.val('N02 the stage no longer lists R3 (default) and the interview port is empty; the PM still has all 3', format($q$select (select count(*) from public.resolve_list('%s', '{"status":["interview"]}'))::text || '/' || (select count(*) from public.resolve_list('%s', '{"include_withdrawn":true}'))$q$, :'s1', :'s1'), '0/3');
select v40_test.val('N03 list_participants: R1 + R3 are real rows with status withdrawn and the reason; R2 is accepted', format($q$select string_agg(coalesce(p->'display'->>'name_en', '?') || ':' || (p->>'status') || ':' || coalesce(p->>'withdrawal_reason', '-'), ',' order by p->'display'->>'name_en') from public.list_participants('%s') p$q$, :'proj'), 'Resp One:withdrawn:left the program,Resp Three:withdrawn:declined the interview,Resp Two:accepted:-');
select v40_test.val('N04 mark_all_attended touches only accepted rows (R2), never a withdrawn one', format($q$select public.mark_all_attended('%s')::text || '/' || (select count(*) from public.participants where project_id = '%s' and status = 'withdrawn')::text$q$, :'proj', :'proj'), '1/2');
reset role;
-- the invitation of R3
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v40_test.val('N05 anon: the invitation link of a withdrawn applicant no longer opens the interview page', format($q$select (public.get_public_booking_page('%s', null, '%s'))->>'status'$q$, :'slugbi', :'tok'), 'invitation_required');
select v40_test.fails('N06 anon: booking with that invitation is refused', format($q$select public.create_booking('%s', '%s', '{"name":"X","email":"x@example.invalid","base_url":"https://app.example.invalid"}'::jsonb, '%s')$q$, :'slugbi', :'sloti', :'tok'), '42501', 'invitation_required');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('N07 the PM booking extras flag the invited company and list the withdrawn items (id + name)', format($q$select ((x->'invitations'->0->>'withdrawn')::boolean)::text || '/' || (x->'withdrawn_items' @> jsonb_build_array(jsonb_build_object('id', '%s'::text)))::text from public.get_booking_extras('%s') x$q$, :'i3', :'bi'), 'true/true');

-- ================================================================= WITHDRAW the experts (M1 = a network expert, M3 = manual): the flag is on the item
select public.set_item_withdrawn(:'m1', true, 'cannot attend') as r_x01 \gset
select v40_test.val('X01 an expert item has no participant: the flag is written on the list item (reason, who, when); no new participant row', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select (withdrawn_at is not null)::text || '/' || (withdrawn_by = '00000000-0000-4000-8000-0000000040a0')::text || '/' || withdrawn_reason from public.list_items where id = '%s') || '/' || (select count(*) from public.participants where project_id = '%s')::text$q$, :'r_x01', :'m1', :'proj'), 'true/true/true/cannot attend/3');
select v40_test.val('X02 the expert list (default) no longer lists M1; the PM include_withdrawn does, flagged with the reason and the source', format($q$select (select count(*) from public.resolve_list('%s'))::text || '/' || (select (r->>'withdrawn') || '/' || (r->'withdrawal'->>'reason') || '/' || (r->'withdrawal'->>'source') from public.resolve_list('%s', '{"include_withdrawn":true}') r where r->>'item_id' = '%s')$q$, :'lm', :'lm', :'m1'), '2/true/cannot attend/item');
select v40_test.val('X03 a list fed by the expert list (Mentors copy) drops M1 too (the upstream feed filter)', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'lm2'), '0');
reset role;
select v40_test.val('X04 the distribution payload: the mentor is gone from the platform payload (mentors, day mentor ids and its sessions)', format($q$select jsonb_array_length(x->'mentors')::text || '/' || jsonb_array_length(x->'days'->0->'mentor_ids') || '/' || (select count(*) from jsonb_array_elements(x->'sessions') s where s->>'m' = '%s')::text from (select app_private.distribution_payload('%s', false) x) y$q$, :'m1', :'ds'), '1/1/0');
select v40_test.val('X05 ... and the PM payload keeps it, flagged', format($q$select jsonb_array_length(x->'mentors')::text || '/' || (select count(*) from jsonb_array_elements(x->'mentors') m where (m->>'withdrawn')::boolean)::text from (select app_private.distribution_payload('%s', true) x) y$q$, :'ds'), '2/1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.fails('X06 a regeneration that uses the withdrawn mentor is refused', format($q$select public.replace_distribution_sessions('%s', 'all', array['%s']::uuid[], jsonb_build_array(jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id',null)))$q$, :'ds', :'day1', :'day1', :'m1'), '22023', 'distribution_invalid');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v40_test.val('X07 anon: the Mentor booking page offers no provider and no slot of a withdrawn mentor', format($q$select jsonb_array_length(x->'providers')::text || '/' || jsonb_array_length(x->'slots') from public.get_public_booking_page('%s') x$q$, :'slugbm'), '0/0');
select v40_test.fails('X08 anon: booking that mentor''s slot directly is refused (slot_unavailable)', format($q$select public.create_booking('%s', '%s', '{"name":"X","email":"x@example.invalid"}'::jsonb)$q$, :'slugbm', :'slotm'), 'P0001', 'slot_unavailable');
select v40_test.val('X09 anon: the agenda session no longer names the withdrawn presenter', format($q$select coalesce(public.get_public_tab('%s', null)->'data'->'days'->0->'slots'->0->>'presenter_en', 'null')$q$, :'slugag'), 'null');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('X10 the PM booking extras list the withdrawn provider item', format($q$select (x->'withdrawn_items' @> jsonb_build_array(jsonb_build_object('id', '%s'::text)))::text from public.get_booking_extras('%s') x$q$, :'m1', :'bm'), 'true');

-- ================================================================= legacy "hidden" (excluded) -> converted to withdrawn, or restored
select public.exclude_item(:'m3', true);
select v40_test.val('H01 a hidden (legacy) item is still hidden from the default resolver and visible to the PM with excluded:true', format($q$select (select count(*) from public.resolve_list('%s'))::text || '/' || (select (r->>'excluded') || '/' || (r->>'withdrawn') from public.resolve_list('%s', '{"include_excluded":true,"include_withdrawn":true}') r where r->>'item_id' = '%s')$q$, :'lm', :'lm', :'m3'), '1/true/false');
select public.set_item_withdrawn(:'m3', true) as r_h02 \gset
select v40_test.val('H02 marking it withdrawn CONVERTS it (excluded cleared, withdrawn set)', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select excluded::text || '/' || (withdrawn_at is not null)::text from public.list_items where id = '%s')$q$, :'r_h02', :'m3'), 'true/false/true');
select public.set_item_withdrawn(:'m3', false) as r_h03 \gset
select v40_test.val('H03 reinstating clears the item flag completely (flag, who, reason)', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select (withdrawn_at is null)::text || '/' || (withdrawn_by is null)::text || '/' || (withdrawn_reason is null)::text from public.list_items where id = '%s')$q$, :'r_h03', :'m3'), 'false/true/true/true');
select v40_test.val('H04 reinstated: the expert is listed again', format($q$select (select count(*) from public.resolve_list('%s') r where r->>'item_id' = '%s')::text$q$, :'lm', :'m3'), '1');
select v40_test.fails('H05 a reason longer than 1000 characters is refused', format($q$select public.set_item_withdrawn('%s', true, repeat('x', 1001))$q$, :'m3'), '22023', 'withdrawn_invalid');

-- ================================================================= REINSTATE everything: the world comes back
select public.set_item_withdrawn(:'i3', false) as r_r01 \gset
select v40_test.val('R01 reinstating the never-enrolled R3 REMOVES its record row (it exists only to record the withdrawal)', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select count(*) from public.participants where form_response_id = '00000000-0000-4000-8000-0000000040b3')::text || '/' || (select count(*) from public.participant_withdrawals where participant_id in (select id from public.participants where form_response_id = '00000000-0000-4000-8000-0000000040b3'))::text$q$, :'r_r01'), 'false/0/0');
select v40_test.val('R02 R3 is back in the interview stage', format($q$select count(*)::text from public.resolve_list('%s', '{"status":["interview"]}')$q$, :'s1'), '1');
select public.set_item_withdrawn(:'i1', false) as r_r03 \gset
select v40_test.val('R03 reinstating R1 (an enrolled participant) restores ITS previous status (accepted) and drops the side row', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select status from public.participants where id = '%s') || '/' || (select count(*) from public.participant_withdrawals where participant_id = '%s')::text$q$, :'r_r03', :'pa1', :'pa1'), 'false/accepted/0');
select v40_test.val('R04 stage 1, stage 2 and the company list list R1 again', format($q$select (select count(*) from public.resolve_list('%s'))::text || '/' || (select count(*) from public.resolve_list('%s')) || '/' || (select count(*) from public.resolve_list('%s'))$q$, :'s1', :'s2', :'lc'), '3/2/2');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v40_test.val('R05 anon: the Companies tab lists both again', format($q$select jsonb_array_length(public.get_public_tab('%s', '%s')->'data'->'items')::text$q$, :'slugag', :'etab'), '2');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040f1","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('R06 the founder sees the program again, accepted, with its blocks page', format($q$select jsonb_array_length(public.list_my_programs())::text || '/' || (public.get_founder_program_page('%s')->>'restricted')$q$, :'proj'), '1/false');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.okrun('R07 reinstate the expert M1', format($q$select public.set_item_withdrawn('%s', false)$q$, :'m1'));
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v40_test.val('R08 anon: the mentor booking page offers the provider again and the agenda names the presenter', format($q$select (select jsonb_array_length(x->'providers')::text || '/' || jsonb_array_length(x->'slots') from public.get_public_booking_page('%s') x) || '/' || (public.get_public_tab('%s', null)->'data'->'days'->0->'slots'->0->>'presenter_en')$q$, :'slugbm', :'slugag'), '1/2/Mentor One');
select v40_test.val('R09 anon: the invitation of R3 opens again (the invitation itself was never revoked)', format($q$select (public.get_public_booking_page('%s', null, '%s'))->>'status'$q$, :'slugbi', :'tok'), 'open');
reset role;
select v40_test.val('R10 the platform distribution payload is whole again (2 mentors; the one company of the regenerated sessions)', format($q$select jsonb_array_length(x->'mentors')::text || '/' || jsonb_array_length(x->'companies') from (select app_private.distribution_payload('%s', false) x) y$q$, :'ds'), '2/1');

-- ================================================================= attended -> withdrawn -> reinstated = attended; certificates; the Participants page path
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('T00 R2 is attended after mark_all_attended (N04)', format($q$select status from public.participants where id = '%s'$q$, :'pa2'), 'attended');
select public.withdraw_participant(:'pa2', true, 'moved abroad') as r_t01 \gset
select v40_test.val('T01 withdrawn from the Participants page with a reason: status withdrawn', format($q$select (%L::jsonb->>'status') || '/' || (select status from public.participants where id = '%s')$q$, :'r_t01', :'pa2'), 'withdrawn/withdrawn');
select v40_test.val('T02 the side table remembers attended + the reason', format($q$select restore_status || '/' || reason from public.participant_withdrawals where participant_id = '%s'$q$, :'pa2'), 'attended/moved abroad');
reset role;
select v40_test.val('T03 certificate eligibility: a withdrawn participant is not_attended (no certificate can be issued)', format($q$select app_private.cert_issue_one('%s', '%s', '00000000-0000-4000-8000-0000000040a0', false)->>'status'$q$, :'pa2', :'cn'), 'not_attended');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select v40_test.val('T04 the withdrawn participant R2 disappears from every list (stage 1, stage 2, company list)', format($q$select (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp Two')::text || '/' || (select count(*) from public.resolve_list('%s')) || '/' || (select count(*) from public.resolve_list('%s'))$q$, :'s1', :'s2', :'lc'), '0/1/1');
select v40_test.okrun('T05a set_participant_status "accepted" reinstates a withdrawn participant (the m06c RPC keeps working)', format($q$select public.set_participant_status('%s', 'accepted')$q$, :'pa2'));
select v40_test.val('T05 ... status accepted, side row gone', format($q$select (select status from public.participants where id = '%s') || '/' || (select count(*) from public.participant_withdrawals where participant_id = '%s')::text$q$, :'pa2', :'pa2'), 'accepted/0');
select v40_test.okrun('T06 re-withdraw through the status RPC', format($q$select public.set_participant_status('%s', 'withdrawn')$q$, :'pa2'));
select public.withdraw_participant(:'pa2', false) as r_t07 \gset
select v40_test.val('T07 ... and reinstate through the dedicated action: back to the status before (accepted: T05 set it)', format($q$select %L::jsonb->>'status'$q$, :'r_t07'), 'accepted');
select v40_test.okrun('T08a back to attended', format($q$select public.set_participant_status('%s', 'attended')$q$, :'pa2'));
select public.withdraw_participant(:'pa2', true) as r_t08w \gset
select public.withdraw_participant(:'pa2', false) as r_t08r \gset
select v40_test.val('T08 attended -> withdrawn -> reinstated returns to attended', format($q$select (%L::jsonb->>'status') || '/' || (%L::jsonb->>'status') || '/' || (select status from public.participants where id = '%s')$q$, :'r_t08w', :'r_t08r', :'pa2'), 'withdrawn/attended/attended');

-- ================================================================= detach keeps the flag
select v40_test.okrun('Y01 withdraw R2 again (participant row) and detach its list item to a manual one', format($q$select public.withdraw_participant('%s', true, 'again'); select public.detach_item_to_manual('%s')$q$, :'pa2', :'c2'));
select v40_test.val('Y02 the detached (manual) item carries the withdrawal itself: flag, reason; it is out of the default list', format($q$select (withdrawn_at is not null)::text || '/' || withdrawn_reason || '/' || (select count(*) from public.resolve_list('%s') r where r->>'item_id' = '%s')::text from public.list_items where id = '%s'$q$, :'lc', :'c2', :'c2'), 'true/again/0');
select public.set_item_withdrawn(:'c2', false) as r_y03 \gset
select v40_test.val('Y03 reinstating the manual item clears its own flag', format($q$select (%L::jsonb->>'withdrawn') || '/' || (select count(*) from public.resolve_list('%s') r where r->>'item_id' = '%s')::text$q$, :'r_y03', :'lc', :'c2'), 'false/1');
select v40_test.okrun('Y04 reinstate the participant R2', format($q$select public.withdraw_participant('%s', false)$q$, :'pa2'));
reset role;

-- ================================================================= withdraw from a DOWNSTREAM list: the same participant row, still visible there with the chip
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_withdrawn(:'c1', true, 'from the company list') as r_v01 \gset
select v40_test.val('V01 withdrawing from the company list writes the SAME participant row: stage 1 and stage 2 lose R1 as well', format($q$select (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp One')::text || '/' || (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp One') || '/' || (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp One') || '/' || (select count(*) from public.participants where form_response_id = '00000000-0000-4000-8000-0000000040b1' and status = 'withdrawn')::text$q$, :'s1', :'s2', :'lc'), '0/0/0/1');
select v40_test.val('V02 ... and the company list still SHOWS it to the PM (include_withdrawn) with the chip data, so it can be reinstated from there', format($q$select (r->>'withdrawn') || '/' || (r->'withdrawal'->>'reason') from public.resolve_list('%s', '{"include_withdrawn":true}') r where r->'display'->>'title_en' = 'Resp One'$q$, :'lc'), 'true/from the company list');
select v40_test.val('V03 the participant keeps ITS status to come back to (accepted)', format($q$select w.restore_status from public.participant_withdrawals w where w.participant_id = '%s'$q$, :'pa1'), 'accepted');
select public.set_item_withdrawn(:'c1', false) as r_v04 \gset
select v40_test.val('V04 reinstating from the company list brings R1 back in every stage', format($q$select (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp One')::text || '/' || (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp One') || '/' || (select count(*) from public.resolve_list('%s') r where r->'display'->>'title_en' = 'Resp One')$q$, :'s1', :'s2', :'lc'), '1/1/1');
reset role;

-- ================================================================= final state check
select v40_test.val('Z01 at the end nothing stays withdrawn in the project', format($q$select (select count(*) from public.participants where project_id = '%s' and status = 'withdrawn')::text || '/' || (select count(*) from public.list_items where project_id = '%s' and withdrawn_at is not null) || '/' || (select count(*) from public.participant_withdrawals where project_id = '%s')$q$, :'proj', :'proj', :'proj'), '0/0/0');

select current_setting('v40.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v40: withdrawn tests FAILED'; end $$;
\endif
