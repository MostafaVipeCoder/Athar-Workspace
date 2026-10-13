-- v43_review_fixes  (m43: the database findings of the independent review of m40 withdrawn / m41 WebP / m42 certificates per founder)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.
--   ADM = temporary super_admin (the PM)      PM2 = a project_manager of ANOTHER scope (no membership)      AL = an alumni_manager
--   F1 = founder of company ALPHA (a founders row)    F2 = founder of company GAMMA    F3 = an outsider founder    F4 = a USER-level participant
--   E1 / E2 / E3 = founders whose e-mail matches an accepted application (autoconfirmed / confirmation SENT then CLICKED / clicked then re-sent)
-- NOTE: a scalar sub-select in the SAME statement as a data-modifying function call sees the OLD snapshot, so every write is its own statement (\gset).
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v43.res', '', false) \gset

begin;
create schema v43_test;
grant usage on schema v43_test to public;
create or replace function v43_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v43.res', current_setting('v43.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v43_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v43_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v43_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v43_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v43_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v43_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v43_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v43_test.t(p_key, true, 'ok');
  exception when others then
    perform v43_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- how many of these statements succeed (each in its own sub-transaction)
create or replace function v43_test.countok(p_sqls text[]) returns int language plpgsql as $$
declare s text; k int := 0;
begin
  foreach s in array p_sqls loop
    begin execute s; k := k + 1; exception when others then null; end;
  end loop;
  return k;
end $$;
-- N verifier lookups, each with a different spoofed FIRST X-Forwarded-For entry and the same trusted LAST hop; returns how many were refused
create or replace function v43_test.limitrun(p_n int, p_first text, p_last text) returns int language plpgsql as $$
declare k int := 0; i int;
begin
  for i in 1 .. p_n loop
    perform set_config('request.headers', jsonb_build_object('x-forwarded-for', p_first || i || ', ' || p_last)::text, true);
    if not app_private.cert_verify_limit() then k := k + 1; end if;
  end loop;
  return k;
end $$;
revoke all on all functions in schema v43_test from public;
grant execute on all functions in schema v43_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v43_test.val('C01 the m43 objects exist', $q$select (to_regprocedure('public.set_items_withdrawn(uuid[],boolean,text)') is not null and to_regprocedure('app_private.withdraw_item_core(uuid,boolean,text)') is not null and to_regprocedure('app_private.auth_email_verified(uuid)') is not null and to_regprocedure('app_private.withdrawn_expert_lock(uuid,uuid)') is not null and to_regprocedure('app_private.participant_notes(uuid)') is not null and to_regprocedure('app_private.list_items_inherit_withdrawn()') is not null)::text$q$, 'true');
select v43_test.val('C02 every new / replaced function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('set_items_withdrawn','withdraw_item_core','auth_email_verified','withdrawn_expert_lock','participant_notes','list_items_inherit_withdrawn','request_withdrawal','cert_is_member','cert_verify_limit','set_item_withdrawn') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v43_test.val('C03 anon executes none of them; authenticated executes only the two PM RPCs + the notes helper (the view needs it)', $q$select (not has_function_privilege('anon','public.set_items_withdrawn(uuid[],boolean,text)','EXECUTE') and has_function_privilege('authenticated','public.set_items_withdrawn(uuid[],boolean,text)','EXECUTE') and not has_function_privilege('authenticated','app_private.withdraw_item_core(uuid,boolean,text)','EXECUTE') and not has_function_privilege('authenticated','app_private.auth_email_verified(uuid)','EXECUTE') and not has_function_privilege('authenticated','app_private.withdrawn_expert_lock(uuid,uuid)','EXECUTE') and has_function_privilege('authenticated','app_private.participant_notes(uuid)','EXECUTE') and not has_function_privilege('anon','app_private.participant_notes(uuid)','EXECUTE') and not has_function_privilege('anon','public.request_withdrawal(uuid)','EXECUTE'))::text$q$, 'true');
select v43_test.val('C04 no function in public / app_private keeps a NULL-unsafe `auth.role() <> ''service_role''` guard or an un-coalesced `= ''service_role''` inside `not (...)`', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace,'app_private'::regnamespace) and p.prokind = 'f' and (p.prosrc like '%(select auth.role()) <> ''service\_role''%' or p.prosrc like '%not ((select auth.role()) = ''service\_role''%' or p.prosrc like '%or (select auth.role()) = ''service\_role'')%')$q$, '0');
select v43_test.val('C05 the guards that were NULL-unsafe are null-safe now (catalog: request_withdrawal, cert_is_member, the render payload, the re-issue guard)', $q$select ((pg_get_functiondef('public.request_withdrawal(uuid)'::regprocedure) like '%coalesce(v.user_id = v_uid, false)%') and (pg_get_functiondef('app_private.cert_is_member(participants,uuid)'::regprocedure) like '%select coalesce(%') and (pg_get_functiondef('public.get_certificate_render_payload(uuid)'::regprocedure) like '%not coalesce(v_own, false)%') and (pg_get_functiondef('app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)'::regprocedure) like '%coalesce(app_private.cert_is_member(pa, p_user), false)%'))::text$q$, 'true');
select v43_test.val('C06 participants: a founder-readable row no longer carries the PM-internal columns (notes, needs_review, status_changed_by, source, source_node_id, created_by); the columns the founder UI reads stay', $q$select (not has_column_privilege('authenticated','public.participants','notes','SELECT') and not has_column_privilege('authenticated','public.participants','needs_review','SELECT') and not has_column_privilege('authenticated','public.participants','status_changed_by','SELECT') and not has_column_privilege('authenticated','public.participants','source','SELECT') and not has_column_privilege('authenticated','public.participants','source_node_id','SELECT') and not has_column_privilege('authenticated','public.participants','created_by','SELECT') and has_column_privilege('authenticated','public.participants','status','SELECT') and has_column_privilege('authenticated','public.participants','withdrawal_requested_at','SELECT') and has_column_privilege('authenticated','public.participants','user_id','SELECT'))::text$q$, 'true');
select v43_test.val('C07 certificates: UPDATE only on the three revocation columns; the template tables are read-only for authenticated', $q$select (has_column_privilege('authenticated','public.certificates','revoked_at','UPDATE') and has_column_privilege('authenticated','public.certificates','revoked_by','UPDATE') and has_column_privilege('authenticated','public.certificates','revoked_reason','UPDATE') and not has_column_privilege('authenticated','public.certificates','snapshot','UPDATE') and not has_column_privilege('authenticated','public.certificates','code','UPDATE') and not has_column_privilege('authenticated','public.certificates','user_id','UPDATE') and not has_column_privilege('authenticated','public.certificates','participant_id','UPDATE') and not has_column_privilege('authenticated','public.certificates','template_id','UPDATE') and not has_column_privilege('authenticated','public.certificates','node_id','UPDATE') and not has_table_privilege('authenticated','public.certificate_templates','UPDATE') and not has_table_privilege('authenticated','public.certificate_templates','INSERT') and not has_table_privilege('authenticated','public.certificate_template_fields','UPDATE') and not has_table_privilege('authenticated','public.certificate_template_fields','DELETE') and has_table_privilege('authenticated','public.certificate_templates','SELECT'))::text$q$, 'true');
select v43_test.val('C08 two RESTRICTIVE extension allow-list policies (insert + update) that call no function', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('ext_allow_insert','ext_allow_update') and permissive = 'RESTRICTIVE' and roles @> array['anon','authenticated']::name[] and coalesce(with_check,'') !~* '(app_private|public)\.[a-z_]+\('$q$, '2');
select v43_test.val('C09 the inherit trigger, the two audit-FK indexes and the cert_claim participant lock are in place', $q$select (exists (select 1 from pg_trigger where tgrelid='public.list_items'::regclass and tgname='list_items_bi_inherit_withdrawn' and not tgisinternal) and exists (select 1 from pg_indexes where indexname='list_items_withdrawn_by_idx') and exists (select 1 from pg_indexes where indexname='participant_withdrawals_withdrawn_by_idx') and pg_get_functiondef('app_private.cert_claim(uuid,uuid)'::regprocedure) like '%pg_advisory_xact_lock(hashtextextended(p_node::text || r.participant_id::text, 0))%')::text$q$, 'true');
select v43_test.val('C10 the migrated data is untouched (0 participants / certificates / grants, 612 items, nothing withdrawn in the MIGRATED projects: hermetic)', $q$with mig as (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')) select (select count(*) from public.participants where project_id in (select id from mig))::text || '/' || (select count(*) from public.certificates where project_id in (select id from mig)) || '/' || (select count(*) from public.certificate_grants where project_id in (select id from mig)) || '/' || (select count(*) from public.list_items where project_id in (select id from mig)) || '/' || (select count(*) from public.list_items where withdrawn_at is not null and project_id in (select id from mig))$q$, '0/0/0/612/0');
select v43_test.val('C11 the verifier rate limit reads only the proxy-trusted hop, has a global bucket and purges expired buckets (catalog)', $q$select (pg_get_functiondef('app_private.cert_verify_limit()'::regprocedure) like '%v_xff[cardinality(v_xff)]%' and pg_get_functiondef('app_private.cert_verify_limit()'::regprocedure) like '%cert|*%' and pg_get_functiondef('app_private.cert_verify_limit()'::regprocedure) like '%delete from app_private.certificate_verify_limits where window_start < now() - interval ''10 minutes''%')::text$q$, 'true');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000043a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-admin@example.invalid','{"provisioned":true}','{"full_name":"V43 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-pm2@example.invalid','{"provisioned":true}','{"full_name":"V43 Other PM"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-al@example.invalid','{"provisioned":true}','{"full_name":"V43 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-f1@example.invalid','{"provisioned":true}','{"full_name":"V43 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-f2@example.invalid','{"provisioned":true}','{"full_name":"V43 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043f3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-f3@example.invalid','{"provisioned":true}','{"full_name":"V43 Outsider"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v43-f4@example.invalid','{"provisioned":true}','{"full_name":"V43 User Participant"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1@example.invalid','{"provisioned":true}','{"full_name":"V43 Autoconfirmed"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e2@example.invalid','{"provisioned":true}','{"full_name":"V43 Really Confirmed"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043e3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e3@example.invalid','{"provisioned":true}','{"full_name":"V43 Confirmed Then Resent"}', now(), now()),
 ('00000000-0000-4000-8000-0000000043e4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e4@example.invalid','{"provisioned":true}','{"full_name":"V43 Never Confirmed"}', now(), now());
-- e-mail confirmation as Auth leaves it: E1 = Confirm email OFF (confirmed at sign-up, nothing sent); E2 = a confirmation SENT then CLICKED; E3 = clicked BEFORE a later re-send; E4 = never clicked
update auth.users set email_confirmed_at = created_at where id = '00000000-0000-4000-8000-0000000043e1';
update auth.users set confirmation_sent_at = now() - interval '5 minutes', email_confirmed_at = now() - interval '1 minute' where id = '00000000-0000-4000-8000-0000000043e2';
update auth.users set email_confirmed_at = now() - interval '5 minutes', confirmation_sent_at = now() - interval '1 minute' where id = '00000000-0000-4000-8000-0000000043e3';
update auth.users set confirmation_sent_at = now() - interval '5 minutes' where id = '00000000-0000-4000-8000-0000000043e4';
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-0000000043a0','super_admin'), ('00000000-0000-4000-8000-0000000043a1','project_manager'), ('00000000-0000-4000-8000-0000000043a2','alumni_manager'),
  ('00000000-0000-4000-8000-0000000043f1','founder'), ('00000000-0000-4000-8000-0000000043f2','founder'), ('00000000-0000-4000-8000-0000000043f3','founder'), ('00000000-0000-4000-8000-0000000043f4','founder'),
  ('00000000-0000-4000-8000-0000000043e1','founder'), ('00000000-0000-4000-8000-0000000043e2','founder'), ('00000000-0000-4000-8000-0000000043e3','founder'), ('00000000-0000-4000-8000-0000000043e4','founder');
insert into public.network_experts (id, name_en, name_ar, title_en, email) values ('00000000-0000-4000-8000-0000000043b1', 'V43 Mentor One', 'منتور واحد', 'CEO', 'mentor1@example.invalid');
insert into public.companies (id, name_en, name_ar) values
 ('00000000-0000-4000-8000-0000000043c1', 'V43 Alpha Co', 'ألفا'), ('00000000-0000-4000-8000-0000000043c2', 'V43 Gamma Co', 'جاما'), ('00000000-0000-4000-8000-0000000043c3', 'V43 Delta Co', 'دلتا'),
 ('00000000-0000-4000-8000-0000000043c4', 'V43 Eps Co', 'إبسيلون'), ('00000000-0000-4000-8000-0000000043c5', 'V43 Zeta Co', 'زيتا'), ('00000000-0000-4000-8000-0000000043c6', 'V43 Eta Co', 'إيتا');
insert into public.founders (id, name_en, name_ar, auth_user_id) values
 ('00000000-0000-4000-8000-00000000f431', 'Sara Ali', 'سارة علي', '00000000-0000-4000-8000-0000000043f1'),
 ('00000000-0000-4000-8000-00000000f432', 'Omar Zaki', 'عمر زكي', '00000000-0000-4000-8000-0000000043f2');
insert into public.company_founders (company_id, founder_id, is_primary) values
 ('00000000-0000-4000-8000-0000000043c1', '00000000-0000-4000-8000-00000000f431', true), ('00000000-0000-4000-8000-0000000043c2', '00000000-0000-4000-8000-00000000f432', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V43 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V43 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.create_project(:'prog', 'V43 Other project', null, 'Asia/Riyadh')).id as proj2 \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V43 Form"}', 0, 0, '{}')).id as frm \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors"}', 0, 0, '{"subkind":"expert"}')).id as lm \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors copy"}', 0, 0, '{"subkind":"expert"}')).id as lm3 \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors copy 2"}', 0, 0, '{"subkind":"expert"}')).id as lm4 \gset
select (public.add_node(:'proj', 'list', '{"en":"Companies"}', 0, 0, '{"subkind":"company"}')).id as lc \gset
select (public.add_node(:'proj2', 'list', '{"en":"Mentors elsewhere"}', 0, 0, '{"subkind":"expert"}')).id as lmx \gset
select (public.add_node(:'proj', 'distribution', '{"en":"Mentoring"}', 0, 0, '{}')).id as ds \gset
select (public.add_node(:'proj', 'booking', '{"en":"Mentor sessions"}', 0, 0, '{"mode":"mentor"}')).id as bm \gset
select (public.add_node(:'proj', 'agenda', '{"en":"Agenda"}', 0, 0, '{}')).id as ag \gset
select (public.add_node(:'proj', 'certificates', '{"en":"Certificates"}', 0, 0, '{}')).id as cn \gset
select (public.connect(:'proj', :'lm', 'items', :'lm3', 'items-in', '{}')).id as e5 \gset
reset role;
update public.nodes set visibility = 'public', show_to_participants = true where id in (:'bm', :'ag', :'lm', :'lm3', :'cn');
insert into storage.objects (bucket_id, name) values ('certificate-templates', :'proj' || '/' || :'cn' || '/t1.webp');

-- participants: ALPHA / GAMMA (company level), F4 (user level), three accepted APPLICATIONS (response level) for the e-mail link tests
insert into public.form_responses (id, project_id, node_id, answers) values
 ('00000000-0000-4000-8000-0000000043d1', :'proj', :'frm', '{"company_name":"Resp E1","founder_name":"E One","founder_email":"E1@example.invalid"}'),
 ('00000000-0000-4000-8000-0000000043d2', :'proj', :'frm', '{"company_name":"Resp E2","founder_name":"E Two","founder_email":" e2@example.invalid "}'),
 ('00000000-0000-4000-8000-0000000043d3', :'proj', :'frm', '{"company_name":"Resp E3","founder_name":"E Three","founder_email":"e3@example.invalid"}'),
 ('00000000-0000-4000-8000-0000000043d4', :'proj', :'frm', '{"company_name":"Resp E4","founder_name":"E Four","founder_email":"e4@example.invalid"}');
insert into public.participants (id, project_id, company_id, user_id, form_response_id, source, status) values
 ('00000000-0000-4000-8000-0000000043a9', :'proj', '00000000-0000-4000-8000-0000000043c1', null, null, 'manual', 'accepted'),
 ('00000000-0000-4000-8000-0000000043aa', :'proj', '00000000-0000-4000-8000-0000000043c2', null, null, 'manual', 'accepted'),
 ('00000000-0000-4000-8000-0000000043ab', :'proj', null, '00000000-0000-4000-8000-0000000043f4', null, 'manual', 'accepted');
insert into public.participants (id, project_id, form_response_id, source, status) values
 ('00000000-0000-4000-8000-0000000043e9', :'proj', '00000000-0000-4000-8000-0000000043d1', 'selection', 'accepted'),
 ('00000000-0000-4000-8000-0000000043ea', :'proj', '00000000-0000-4000-8000-0000000043d2', 'selection', 'accepted'),
 ('00000000-0000-4000-8000-0000000043eb', :'proj', '00000000-0000-4000-8000-0000000043d3', 'selection', 'accepted'),
 ('00000000-0000-4000-8000-0000000043ec', :'proj', '00000000-0000-4000-8000-0000000043d4', 'selection', 'accepted');
update public.participants set notes = 'ZZPMNOTE internal' where id = '00000000-0000-4000-8000-0000000043a9';

-- ================================================================= A. request_withdrawal: the three-valued-logic hole (m06c)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f2","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('A01 a founder of ANOTHER company (GAMMA) cannot flag the ALPHA participant (company level, user_id NULL)', $q$select public.request_withdrawal('00000000-0000-4000-8000-0000000043a9')$q$, '42501');
select v43_test.fails('A02 ... nor a user-level participant (company_id NULL)', $q$select public.request_withdrawal('00000000-0000-4000-8000-0000000043ab')$q$, '42501');
select v43_test.fails('A03 ... nor an unknown participant id', $q$select public.request_withdrawal('00000000-0000-4000-8000-00000000dead')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f3","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('A04 an outsider founder (no company at all) cannot flag it either', $q$select public.request_withdrawal('00000000-0000-4000-8000-0000000043a9')$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('A05 a project_manager of ANOTHER scope cannot flag it', $q$select public.request_withdrawal('00000000-0000-4000-8000-0000000043a9')$q$, '42501');
reset role;
select v43_test.val('A06 after all those attempts nothing was flagged', $q$select count(*)::text from public.participants where id in ('00000000-0000-4000-8000-0000000043a9','00000000-0000-4000-8000-0000000043ab') and withdrawal_requested_at is not null$q$, '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.okrun('A07 the founder of ALPHA CAN request the withdrawal of his own company-level participant', $q$select public.request_withdrawal('00000000-0000-4000-8000-0000000043a9')$q$);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f4","role":"authenticated"}', true);
set local role authenticated;
select v43_test.okrun('A08 the user-level participant CAN request his own withdrawal', $q$select public.request_withdrawal('00000000-0000-4000-8000-0000000043ab')$q$);
reset role;
select v43_test.val('A09 both flags are set now', $q$select count(*)::text from public.participants where id in ('00000000-0000-4000-8000-0000000043a9','00000000-0000-4000-8000-0000000043ab') and withdrawal_requested_at is not null$q$, '2');

-- ================================================================= B. certificates: the render payload / membership guards with a NULL account, re-issue to an unlinked founder
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'),
  '{"config":{"language":"en","verifier":{"enabled":true,"showCertificate":true}},"show_to_participants":true}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.webp','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','person_name','x',0.5,'y',0.46,'w',0.6,'align','center','font','Tajawal','size',0.045,'color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',true),
      jsonb_build_object('var','company_name','x',0.5,'y',0.54,'w',0.5,'size',0.028,'weight',500,'shrink_to_fit',true,'align','center','font','Tajawal','color','#1a1a2e','direction','auto','max_lines',1),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015,'font','Manrope','weight',500))))) as saved \gset
select public.set_participant_status('00000000-0000-4000-8000-0000000043a9', 'attended');
select public.set_participant_status('00000000-0000-4000-8000-0000000043aa', 'attended');
select public.set_participant_status('00000000-0000-4000-8000-0000000043ab', 'attended');
select public.complete_project(:'proj');
select public.issue_certificates(:'cn') as r1 \gset
reset role;
select v43_test.val('B00 fixture: 3 certificates (F1 of ALPHA, F2 of GAMMA, F4 user-level), one participant authorised each', format($q$select ('%s'::jsonb->>'issued') || '/' || ('%s'::jsonb->>'authorised')$q$, :'r1', :'r1'), '3/3');
select id as cert1, code as code1 from public.certificates where user_id = '00000000-0000-4000-8000-0000000043f1' \gset
select id as cert2, code as code2 from public.certificates where user_id = '00000000-0000-4000-8000-0000000043f2' \gset
select id as cert4, code as code4 from public.certificates where user_id = '00000000-0000-4000-8000-0000000043f4' \gset
select v43_test.val('B01 cert_is_member never answers NULL: member / non-member / NULL account, for a company-level and a user-level participant', $q$select (select app_private.cert_is_member(p, '00000000-0000-4000-8000-0000000043f1')::text from public.participants p where id = '00000000-0000-4000-8000-0000000043a9') || '/' || (select app_private.cert_is_member(p, '00000000-0000-4000-8000-0000000043f3')::text from public.participants p where id = '00000000-0000-4000-8000-0000000043a9') || '/' || (select app_private.cert_is_member(p, '00000000-0000-4000-8000-0000000043f1')::text from public.participants p where id = '00000000-0000-4000-8000-0000000043ab') || '/' || (select coalesce(app_private.cert_is_member(p, null)::text, 'NULL') from public.participants p where id = '00000000-0000-4000-8000-0000000043a9') || '/' || (select app_private.cert_is_member(p, '00000000-0000-4000-8000-0000000043f4')::text from public.participants p where id = '00000000-0000-4000-8000-0000000043ab')$q$, 'true/false/false/false/true');
-- the account of F1's certificate is deleted (certificates.user_id ON DELETE SET NULL): simulate it
update public.certificates set user_id = null where id = :'cert1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f3","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('B02 an ORPHANED certificate (user_id NULL): an unrelated founder cannot read its render payload', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('B03 ... nor the PM of another program', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('B04 ... nor a founder of the SAME company (he is not the owner of that row)', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('B05 the project PM still reads it', format($q$select (public.get_certificate_render_payload('%s') ? 'id')::text$q$, :'cert1'), 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f2","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('B06 the OWNER still reads his own certificate (the guard did not become too strict)', format($q$select (public.get_certificate_render_payload('%s') ? 'id')::text$q$, :'cert2'), 'true');
reset role;
-- re-issue to a founder who is NO LONGER linked to the company
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.revoke_certificate(:'cert2', 'test') as rv2 \gset
reset role;
delete from public.company_founders where founder_id = '00000000-0000-4000-8000-00000000f432';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('B07 reissue_certificate for an unlinked founder is refused (certificate_not_linked), no new certificate', format($q$select public.reissue_certificate('%s')$q$, :'cert2'), '23514', 'certificate_not_linked');
reset role;
select v43_test.val('B08 ... and nothing new exists for him', $q$select count(*)::text from public.certificates where user_id = '00000000-0000-4000-8000-0000000043f2' and revoked_at is null$q$, '0');

-- ================================================================= C. the verifier needs an ATTENDED participant (withdrawn / un-marked = not valid until reinstated)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('C20 anon verifier: the attended participant (F4) is valid', format($q$select public.get_public_certificate_verification('%s')->>'status'$q$, :'code4'), 'valid');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-0000000043ab', true, 'left') as wd \gset
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('C21 ... withdrawn: the same code reads revoked / not valid (the row is untouched)', format($q$select (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.get_public_certificate_verification('%s')->>'valid')$q$, :'code4', :'code4'), 'revoked/false');
reset role;
select v43_test.val('C22 ... the certificate row itself is not revoked', format($q$select (revoked_at is null)::text from public.certificates where id = '%s'$q$, :'cert4'), 'true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-0000000043ab', false) as wd2 \gset
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('C23 ... reinstated: valid again', format($q$select public.get_public_certificate_verification('%s')->>'status'$q$, :'code4'), 'valid');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_participant_status('00000000-0000-4000-8000-0000000043ab', 'accepted');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('C24 ... un-marked as attended: not valid; marked again: valid', format($q$select (public.get_public_certificate_verification('%s')->>'status')$q$, :'code4'), 'revoked');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_participant_status('00000000-0000-4000-8000-0000000043ab', 'attended');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('C25 ... valid again once attended', format($q$select public.get_public_certificate_verification('%s')->>'status'$q$, :'code4'), 'valid');
reset role;
-- a claim after a participant-level revocation stays forbidden
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.revoke_participant_certificates(:'cn', '00000000-0000-4000-8000-0000000043ab', 'x') as rp \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f4","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('C26 after a participant-level revocation a claim is forbidden (the lock + the grant re-read)', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
reset role;

-- ================================================================= D. a withdrawn EXPERT leaves every consumer (the chained copy included)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.add_network_pick(:'lm', '00000000-0000-4000-8000-0000000043b1') as m1 \gset
select public.ensure_item(:'lm3', 'network_expert', '00000000-0000-4000-8000-0000000043b1') as m3 \gset
select public.add_network_pick(:'lmx', '00000000-0000-4000-8000-0000000043b1') as mx \gset
select public.add_manual_item(:'lm', '{"title_en":"Manual Mentor","email":"mm@example.invalid"}') as mm \gset
select public.ensure_item(:'lc', 'company', '00000000-0000-4000-8000-0000000043c1') as c1 \gset
select public.ensure_item(:'lc', 'company', '00000000-0000-4000-8000-0000000043c2') as c2 \gset
select public.ensure_item(:'lc', 'company', '00000000-0000-4000-8000-0000000043c3') as c3 \gset
select rev as rv from public.node_revisions where node_id = :'ds' \gset
select v43_test.okrun('D00 distribution: one day, the mentor is the COPY (m3)', format($q$select public.save_node('%s', %s, '{"visibility":"public"}'::jsonb, jsonb_build_object(
   'settings', jsonb_build_object('slot_duration_min', 20, 'gap_min', 0, 'start_time', '10:00', 'unique_pairing', false),
   'days', jsonb_build_array(jsonb_build_object('day_index', 0, 'day_date', '2030-10-12', 'start_time', '10:00', 'total_round_min', 20, 'mentor_item_ids', jsonb_build_array('%s')))))$q$, :'ds', :'rv', :'m3'));
select public.set_distribution_published(:'ds', true);
select id as day1 from public.distribution_days where node_id = :'ds' and day_index = 0 \gset
select v43_test.val('D01 one session stored (the copy mentor meets ALPHA)', format($q$select (x->>'inserted') from public.replace_distribution_sessions('%s', 'all', null, jsonb_build_array(
   jsonb_build_object('day_id','%s','slot_index',0,'mentor_item_id','%s','company_item_id','%s'))) x$q$, :'ds', :'day1', :'m3', :'c1'), '1');
reset role;
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email) values (:'proj', :'bm', :'m3', 'copy@example.invalid') returning id as pv3 \gset
select to_char(date_trunc('hour', now() + interval '3 days'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as base \gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values
  (:'proj', :'bm', :'pv3', :'base'::timestamptz, :'base'::timestamptz + interval '30 minutes'),
  (:'proj', :'bm', :'pv3', :'base'::timestamptz + interval '40 minutes', :'base'::timestamptz + interval '70 minutes'),
  (:'proj', :'bm', :'pv3', :'base'::timestamptz + interval '80 minutes', :'base'::timestamptz + interval '110 minutes'),
  (:'proj', :'bm', :'pv3', :'base'::timestamptz + interval '120 minutes', :'base'::timestamptz + interval '150 minutes');
select id as slot1 from public.booking_slots where node_id = :'bm' order by starts_at limit 1 offset 0 \gset
select id as slot2 from public.booking_slots where node_id = :'bm' order by starts_at limit 1 offset 1 \gset
select id as slot3 from public.booking_slots where node_id = :'bm' order by starts_at limit 1 offset 2 \gset
select id as slot4 from public.booking_slots where node_id = :'bm' order by starts_at limit 1 offset 3 \gset
insert into public.agenda_days (project_id, node_id, sort_order, day_date, name_en) values (:'proj', :'ag', 0, date '2030-10-12', 'Day 1') returning id as agday \gset
insert into public.agenda_slots (project_id, day_id, sort_order, start_time, end_time, title_en, presenter_item_id, show_presenter) values (:'proj', :'agday', 0, '10:00', '11:00', 'Keynote', :'m3', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.ensure_public_link(:'bm', 'booking', null, null) as lkbm \gset
select public.ensure_public_link(:'ag', 'agenda', null, null) as lkag \gset
reset role;
select s.slug as slugbm from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'bm' and l.kind = 'booking' \gset
select s.slug as slugag from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'ag' and l.kind = 'agenda' \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('D02 BEFORE: anon sees the copy provider with 4 slots and the presenter', format($q$select jsonb_array_length(x->'providers')::text || '/' || jsonb_array_length(x->'slots') || '/' || coalesce(public.get_public_tab('%s', null)->'data'->'days'->0->'slots'->0->>'presenter_en', '-') from public.get_public_booking_page('%s') x$q$, :'slugag', :'slugbm'), '1/4/V43 Mentor One');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_withdrawn(:'m1', true, 'left the program') as wdm \gset
reset role;
select v43_test.val('D03 the flag sits on EVERY row of that expert in THIS project (Mentors + the copy), not in the other project, not on the manual item', format($q$select (select count(*) from public.list_items where project_id = '%s' and network_expert_id = '00000000-0000-4000-8000-0000000043b1' and withdrawn_at is not null)::text || '/' || (select count(*) from public.list_items where project_id = '%s' and withdrawn_at is not null) || '/' || (select count(*) from public.list_items where project_id = '%s' and withdrawn_at is not null) || '/' || (select (withdrawn_at is null)::text from public.list_items where id = '%s')$q$, :'proj', :'proj', :'proj2', :'mm'), '2/2/0/true');
select v43_test.val('D04 item_is_withdrawn: the upstream item AND the chained copy (the review''s I02); the item of the other project is not', format($q$select app_private.item_is_withdrawn('%s')::text || '/' || app_private.item_is_withdrawn('%s') || '/' || app_private.item_is_withdrawn('%s') || '/' || app_private.item_is_withdrawn('%s')$q$, :'m1', :'m3', :'mx', :'mm'), 'true/true/false/false');
select v43_test.val('D05 the withdrawal carries its reason on the copy too (PM view)', format($q$select (app_private.withdrawal_detail(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at, li.withdrawn_reason)->>'reason') from public.list_items li where li.id = '%s'$q$, :'m3'), 'left the program');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('D06 anon: the copy provider and every slot are gone, the agenda hides the expert''s name', format($q$select coalesce(jsonb_array_length(x->'providers')::text, '0') || '/' || coalesce(jsonb_array_length(x->'slots')::text, '0') || '/' || coalesce(public.get_public_tab('%s', null)->'data'->'days'->0->'slots'->0->>'presenter_en', 'NULL') from public.get_public_booking_page('%s') x$q$, :'slugag', :'slugbm'), '0/0/NULL');
select v43_test.fails('D07 anon: create_booking on a slot of the copy provider is refused (slot_unavailable)', format($q$select public.create_booking('%s', '%s', '{"name":"X","email":"x@example.invalid"}'::jsonb)$q$, :'slugbm', :'slot1'), 'P0001', 'slot_unavailable');
reset role;
select v43_test.val('D08 the platform distribution payload drops the mentor and its session (the review''s I06)', format($q$select jsonb_array_length(x->'mentors')::text || '/' || jsonb_array_length(x->'sessions') from (select app_private.distribution_payload('%s', false) x) y$q$, :'ds'), '0/0');
select v43_test.val('D09 the PM payload keeps the mentor, flagged withdrawn', format($q$select jsonb_array_length(x->'mentors')::text || '/' || (x->'mentors'->0->>'withdrawn') from (select app_private.distribution_payload('%s', true) x) y$q$, :'ds'), '1/true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('D10 the chained copy list no longer lists the expert (default resolver); the PM still sees it with include_withdrawn', format($q$select (select count(*) from public.resolve_list('%s'))::text || '/' || (select count(*) from public.resolve_list('%s', '{"include_withdrawn":true}'))$q$, :'lm3', :'lm3'), '0/1');
-- a copy materialised AFTER the withdrawal inherits the flag (BEFORE INSERT trigger)
select public.ensure_item(:'lm4', 'network_expert', '00000000-0000-4000-8000-0000000043b1') as m4 \gset
reset role;        -- (a role-switched call of a function the role may NOT execute segfaults this local Postgres image: app_private helpers are called as the owner)
select v43_test.val('D11 a copy materialised later is withdrawn from the start (reason included)', format($q$select app_private.item_is_withdrawn('%s')::text || '/' || (select withdrawn_reason from public.list_items where id = '%s')$q$, :'m4', :'m4'), 'true/left the program');
set local role authenticated;
-- reinstating FROM A COPY reinstates the person everywhere
select public.set_item_withdrawn(:'m4', false) as rw \gset
select v43_test.val('D12 reinstating from a copy clears every row of the expert in the project (3 copies)', format($q$select (select count(*) from public.list_items where project_id = '%s' and network_expert_id = '00000000-0000-4000-8000-0000000043b1' and withdrawn_at is not null)::text || '/' || (('%s'::jsonb)->>'copies')$q$, :'proj', :'rw'), '0/3');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v43_test.val('D13 anon: the provider, its 4 slots and the presenter are back', format($q$select jsonb_array_length(x->'providers')::text || '/' || jsonb_array_length(x->'slots') || '/' || coalesce(public.get_public_tab('%s', null)->'data'->'days'->0->'slots'->0->>'presenter_en', '-') from public.get_public_booking_page('%s') x$q$, :'slugag', :'slugbm'), '1/4/V43 Mentor One');
reset role;
-- a MANUAL item has no identity: only that item
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_withdrawn(:'mm', true, null) as rmm \gset
select v43_test.val('D14 a manual item is withdrawn on its own (1 row), the experts untouched', format($q$select (('%s'::jsonb)->>'copies') || '/' || (select count(*) from public.list_items where project_id = '%s' and withdrawn_at is not null)$q$, :'rmm', :'proj'), '0/1');
select public.set_item_withdrawn(:'mm', false) as rmm2 \gset

-- ================================================================= E. the BULK RPC: one atomic call
select public.set_items_withdrawn(array[:'m1', :'c2', :'c3']::uuid[], true, 'bulk reason') as rb \gset
select v43_test.val('E01 bulk withdraw: 3 items in ONE call (an expert with its copies, 2 companies)', format($q$select ('%s'::jsonb->>'count') || '/' || (select count(*) from public.list_items where project_id = '%s' and network_expert_id is not null and withdrawn_at is not null) || '/' || (select count(*) from public.participants where project_id = '%s' and status = 'withdrawn' and company_id in ('00000000-0000-4000-8000-0000000043c2','00000000-0000-4000-8000-0000000043c3'))$q$, :'rb', :'proj', :'proj'), '3/3/2');
select public.set_items_withdrawn(array[:'m1', :'c2', :'c3']::uuid[], false) as rb2 \gset
select v43_test.val('E02 bulk reinstate in ONE call: nothing stays withdrawn (the never-enrolled GAMMA / DELTA rows that existed only to record it are gone / restored)', format($q$select (select count(*) from public.list_items where project_id = '%s' and withdrawn_at is not null)::text || '/' || (select count(*) from public.participants where project_id = '%s' and status = 'withdrawn') || '/' || (select count(*) from public.participants where project_id = '%s' and company_id = '00000000-0000-4000-8000-0000000043c3')$q$, :'proj', :'proj', :'proj'), '0/0/0');
select v43_test.fails('E03 bulk is ATOMIC: an item of another project the PM does not manage rolls the whole call back (nothing changes)', format($q$select public.set_items_withdrawn(array['%s','%s']::uuid[], true)$q$, :'c1', '00000000-0000-4000-8000-00000000dead'), '42501');
select v43_test.val('E04 ... verified: ALPHA was not withdrawn by the failed call', format($q$select count(*)::text from public.participants where id = '00000000-0000-4000-8000-0000000043a9' and status = 'withdrawn'$q$), '0');
select v43_test.fails('E05 more than 500 items per call is refused (withdrawn_invalid)', $q$select public.set_items_withdrawn((select array_agg(gen_random_uuid()) from generate_series(1, 501)), true)$q$, '22023', 'withdrawn_invalid');
select v43_test.val('E06 an empty list is a no-op', $q$select (public.set_items_withdrawn('{}'::uuid[], true)->>'count')$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('E07 a PM of another scope cannot use the bulk RPC (forbidden)', format($q$select public.set_items_withdrawn(array['%s']::uuid[], true)$q$, :'m1'), '42501');
reset role;

-- ================================================================= F. create_booking (mentor mode): the client company id is not trusted
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select public.create_booking(:'slugbm', :'slot1', jsonb_build_object('name', 'Spoofer', 'email', 'spoof@example.invalid', 'company_name', 'Typed Co', 'company_id', '00000000-0000-4000-8000-0000000043c3')) as bk1 \gset
select v43_test.val('F02 garbage in company_id is ignored, not an error', format($q$select (public.create_booking('%s', '%s', jsonb_build_object('name', 'G', 'email', 'g@example.invalid', 'company_id', 'not-a-uuid'))->>'status')$q$, :'slugbm', :'slot2'), 'confirmed');
reset role;
select v43_test.val('F01 anon naming a company id (DELTA) is booked under the TYPED company name; no company id is recorded', $q$select coalesce(booker_company_id::text, 'NULL') || '/' || coalesce(booker_company_name, '-') from public.bookings where booker_email = 'spoof@example.invalid'$q$, 'NULL/Typed Co');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f1","role":"authenticated"}', true);
set local role authenticated;
select public.create_booking(:'slugbm', :'slot3', jsonb_build_object('name', 'Sara', 'email', 'sara@example.invalid', 'company_id', '00000000-0000-4000-8000-0000000043c1')) as bk3 \gset
select public.create_booking(:'slugbm', :'slot4', jsonb_build_object('name', 'Sara', 'email', 'sara2@example.invalid', 'company_id', '00000000-0000-4000-8000-0000000043c2')) as bk4 \gset
reset role;
select v43_test.val('F03 a signed-in founder naming HIS OWN company: the company id is recorded', $q$select coalesce(booker_company_id::text, 'NULL') from public.bookings where booker_email = 'sara@example.invalid'$q$, '00000000-0000-4000-8000-0000000043c1');
select v43_test.val('F04 ... naming somebody ELSE''s company: ignored (NULL)', $q$select coalesce(booker_company_id::text, 'NULL') from public.bookings where booker_email = 'sara2@example.invalid'$q$, 'NULL');

-- ================================================================= G. link by a GENUINELY verified e-mail
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043e1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('G01 Confirm-email OFF signature (confirmed at sign-up, nothing sent): the program is NOT linked / listed', $q$select jsonb_array_length(public.list_my_programs())::text$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043e3","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('G02 a confirmation clicked BEFORE the last send (a re-send): not trusted', $q$select jsonb_array_length(public.list_my_programs())::text$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043e4","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('G03 a confirmation that was sent but never clicked: not linked', $q$select jsonb_array_length(public.list_my_programs())::text$q$, '0');
reset role;
select v43_test.val('G04 so far no response participant has an account', $q$select count(*)::text from public.participants where form_response_id::text like '00000000-0000-4000-8000-0000000043d%' and user_id is not null$q$, '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043e2","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('G05 a confirmation that was SENT and then CLICKED (case and spaces ignored): linked, the program is listed', $q$select jsonb_array_length(public.list_my_programs())::text || '/' || (public.list_my_programs()->0->>'status')$q$, '1/accepted');
reset role;
select v43_test.val('G06 exactly E2''s participant got its account', $q$select string_agg(right(user_id::text, 2), ',') from public.participants where form_response_id::text like '00000000-0000-4000-8000-0000000043d%' and user_id is not null$q$, 'e2');
select v43_test.val('G07 auth_email_verified: the five signatures', $q$select app_private.auth_email_verified('00000000-0000-4000-8000-0000000043e1')::text || '/' || app_private.auth_email_verified('00000000-0000-4000-8000-0000000043e2') || '/' || app_private.auth_email_verified('00000000-0000-4000-8000-0000000043e3') || '/' || app_private.auth_email_verified('00000000-0000-4000-8000-0000000043e4') || '/' || app_private.auth_email_verified('00000000-0000-4000-8000-00000000dead')$q$, 'false/true/false/false/false');

-- ================================================================= H. participants: PM-internal columns
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('H01 a founder cannot read participants.notes of his own row (the review''s ZZPMNOTE marker)', $q$select notes from public.participants where id = '00000000-0000-4000-8000-0000000043a9'$q$, '42501');
select v43_test.fails('H02 ... nor select *', $q$select * from public.participants where id = '00000000-0000-4000-8000-0000000043a9'$q$, '42501');
select v43_test.fails('H03 ... nor needs_review / status_changed_by / source / source_node_id', $q$select needs_review, status_changed_by, source, source_node_id from public.participants$q$, '42501');
select v43_test.val('H04 ... but reads the columns the founder UI needs (his own row only)', $q$select count(*)::text || '/' || max(status) from (select id, status, withdrawal_requested_at, user_id, company_id from public.participants) x$q$, '1/attended');
select v43_test.val('H05 the compat view v_program_participations shows a founder nothing (the project row is not his to read) and in particular no notes', $q$select count(*)::text || '/' || coalesce(max(notes), 'NULL') from public.v_program_participations$q$, '0/NULL');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a2","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('H06 an alumni_manager gets the notes through the definer helper (the view is gated by the project RLS as before)', $q$select coalesce(app_private.participant_notes('00000000-0000-4000-8000-0000000043a9'), 'NULL')$q$, 'ZZPMNOTE internal');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('H07 the project PM reads them through list_participants (definer) and the view', format($q$select coalesce((select max(p->>'notes') from public.list_participants('%s') p where p->>'notes' is not null), 'NULL') || '/' || coalesce((select max(notes) from public.v_program_participations where company_id = '00000000-0000-4000-8000-0000000043c1'), 'NULL')$q$, :'proj'), 'ZZPMNOTE internal/ZZPMNOTE internal');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('H08 a PM of another scope sees no row and no notes', $q$select count(*)::text from public.v_program_participations$q$, '0');
reset role;

-- ================================================================= I. certificates: tamper evidence
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('I01 the PM cannot rewrite the frozen snapshot name through PostgREST (the review''s D01)', format($q$update public.certificates set snapshot = jsonb_set(snapshot, '{person_name}', '"Forged"') where id = '%s'$q$, :'cert4'), '42501');
select v43_test.fails('I02 ... nor re-point it to another account (D02)', format($q$update public.certificates set user_id = '00000000-0000-4000-8000-0000000043f3' where id = '%s'$q$, :'cert4'), '42501');
select v43_test.fails('I03 ... nor change its code or template', format($q$update public.certificates set code = 'AAAAAAAAAAAA' where id = '%s'$q$, :'cert4'), '42501');
select v43_test.fails('I04 ... nor edit a template or its fields', $q$update public.certificate_template_fields set size = 0.5$q$, '42501');
select v43_test.okrun('I05 revoking still works through the RPC', format($q$select public.revoke_certificate('%s', 'tamper test')$q$, :'cert4'));
select v43_test.val('I06 and the three revocation columns stay writable (a reason edit)', format($q$with u as (update public.certificates set revoked_reason = 'edited' where id = '%s' returning 1) select count(*)::text from u$q$, :'cert4'), '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.val('I07 a PM of another program updates nothing', format($q$with u as (update public.certificates set revoked_reason = 'x' where id = '%s' returning 1) select count(*)::text from u$q$, :'cert4'), '0');
reset role;

-- ================================================================= J. storage: the extension allow-list (positive list per bucket)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('J01 public-assets: an .html name is refused (the review''s H matrix)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', '%s/x/a.html', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0', '{"mimetype":"image/webp"}')$q$, :'proj'), '42501');
select v43_test.fails('J02 public-assets: a .pdf name is refused', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', '%s/x/a.pdf', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0', '{"mimetype":"image/webp"}')$q$, :'proj'), '42501');
select v43_test.fails('J03 public-assets: an .svg OUTSIDE a logo folder is refused', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', '%s/cover/a.svg', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0', '{"mimetype":"image/svg+xml"}')$q$, :'proj'), '42501');
select v43_test.okrun('J04 public-assets: an .svg UNDER <owner>/logo/ is accepted (the vector company logo)', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', '%s/logo/00000000-0000-4000-8000-0000000043e0.svg', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0', '{"mimetype":"image/svg+xml"}')$q$, :'proj'));
select v43_test.okrun('J05 public-assets: .webp and its _t.webp are accepted', format($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('public-assets', '%s/cover/00000000-0000-4000-8000-0000000043e1.webp', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0', '{"mimetype":"image/webp"}'), ('public-assets', '%s/cover/00000000-0000-4000-8000-0000000043e1_t.webp', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0', '{"mimetype":"image/webp"}')$q$, :'proj', :'proj'));
select v43_test.fails('J06 resources: an .html name is refused', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', '%s/a.html', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0')$q$, :'proj'), '42501');
select v43_test.fails('J07 resources: an .svg name is refused', format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', '%s/a.svg', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0')$q$, :'proj'), '42501');
select v43_test.val('J08 resources: every library file type is accepted (pdf docx xlsx pptx mp3 m4a wav ogg mp4 webp)', format($q$select v43_test.countok(array(select format($i$insert into storage.objects (bucket_id, name, owner, owner_id) values ('resources', '%s/f43.%%s', '00000000-0000-4000-8000-0000000043a0', '00000000-0000-4000-8000-0000000043a0')$i$, e) from unnest(array['pdf','docx','xlsx','pptx','mp3','m4a','wav','ogg','mp4','webp']) e))::text$q$, :'proj'), '10');
select v43_test.fails('J09 UPDATE: renaming a stored WebP to .html is refused', format($q$update storage.objects set name = '%s/cover/00000000-0000-4000-8000-0000000043e1.html' where bucket_id = 'public-assets' and name = '%s/cover/00000000-0000-4000-8000-0000000043e1.webp'$q$, :'proj', :'proj'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043f1","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('J10 founder-assets: a founder cannot store an .html in his own folder', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('founder-assets', 'founders/00000000-0000-4000-8000-0000000043f1/a.html', '00000000-0000-4000-8000-0000000043f1', '00000000-0000-4000-8000-0000000043f1')$q$, '42501');
select v43_test.fails('J11 founder-assets: ... nor an .svg or .pdf', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('founder-assets', 'founders/00000000-0000-4000-8000-0000000043f1/a.svg', '00000000-0000-4000-8000-0000000043f1', '00000000-0000-4000-8000-0000000043f1'), ('founder-assets', 'founders/00000000-0000-4000-8000-0000000043f1/a.pdf', '00000000-0000-4000-8000-0000000043f1', '00000000-0000-4000-8000-0000000043f1')$q$, '42501');
select v43_test.okrun('J12 founder-assets: his own .webp is accepted', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('founder-assets', 'founders/00000000-0000-4000-8000-0000000043f1/00000000-0000-4000-8000-0000000043e5.webp', '00000000-0000-4000-8000-0000000043f1', '00000000-0000-4000-8000-0000000043f1', '{"mimetype":"image/webp"}')$q$);
reset role;

-- ================================================================= K. the verifier rate limit: only the proxy-trusted hop counts
select v43_test.val('K01 the bucket is the LAST hop: 45 lookups with a different spoofed FIRST entry each are limited after 40 (5 refused)', $q$select v43_test.limitrun(45, 'spoof-', '9.9.9.9')::text$q$, '5');
select set_config('request.headers', '{"x-forwarded-for":"spoof, 8.8.8.8"}', true);
select v43_test.val('K02 another trusted address starts a fresh bucket (allowed)', $q$select app_private.cert_verify_limit()::text$q$, 'true');
select set_config('request.headers', '{"cf-connecting-ip":"7.7.7.7","x-forwarded-for":"spoof, 9.9.9.9"}', true);
select v43_test.val('K03 the Cloudflare header outranks X-Forwarded-For (a fresh bucket although 9.9.9.9 is spent)', $q$select app_private.cert_verify_limit()::text$q$, 'true');
select v43_test.val('K04 the GLOBAL bucket exists and counted every lookup of this test (>= 47)', $q$select (hits >= 47)::text from app_private.certificate_verify_limits where bucket = 'cert|*'$q$, 'true');
update app_private.certificate_verify_limits set hits = 1500 where bucket = 'cert|*';
select set_config('request.headers', '{"x-forwarded-for":"5.5.5.5"}', true);
select v43_test.val('K05 once the global cap is reached everybody is refused (and no per-address row is created)', $q$select app_private.cert_verify_limit()::text || '/' || (select count(*) from app_private.certificate_verify_limits where bucket = md5('cert|5.5.5.5'))$q$, 'false/0');
select set_config('request.headers', '', true);

-- ================================================================= L. merge_companies: withdrawn status and certificate grants
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select (public.assign_participant(:'proj', '00000000-0000-4000-8000-0000000043c3')).id as pdelta \gset
select (public.assign_participant(:'proj', '00000000-0000-4000-8000-0000000043c4')).id as peps \gset
select (public.assign_participant(:'proj', '00000000-0000-4000-8000-0000000043c5')).id as pzeta \gset
select (public.assign_participant(:'proj', '00000000-0000-4000-8000-0000000043c6')).id as peta \gset
select public.withdraw_participant(:'peps', true, 'withdrew before the merge') as wpe \gset
select public.merge_companies('00000000-0000-4000-8000-0000000043c3', '00000000-0000-4000-8000-0000000043c4') as mres \gset
reset role;
select v43_test.val('L01 merge (keep DELTA, drop EPS who is WITHDRAWN): the kept participant becomes withdrawn WITH the dropped company''s reason; EPS has no participant left', format($q$select p.status || '/' || w.reason || '/' || (select count(*) from public.participants where company_id = '00000000-0000-4000-8000-0000000043c4') from public.participants p join public.participant_withdrawals w on w.participant_id = p.id where p.company_id = '00000000-0000-4000-8000-0000000043c3' and p.project_id = '%s'$q$, :'proj'), 'withdrawn/withdrew before the merge/0');
insert into public.certificate_grants (project_id, node_id, participant_id) values (:'proj', :'cn', :'peta');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000043a0","role":"authenticated"}', true);
set local role authenticated;
select v43_test.fails('L02 merge where the DROPPED participant holds a certificate GRANT (no certificate yet): the friendly manual-review error (23514), not a raw FK violation', $q$select public.merge_companies('00000000-0000-4000-8000-0000000043c5', '00000000-0000-4000-8000-0000000043c6')$q$, '23514');
reset role;

-- ================================================================= final state check
select current_setting('v43.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v43: review-fix tests FAILED'; end $$;
\endif
