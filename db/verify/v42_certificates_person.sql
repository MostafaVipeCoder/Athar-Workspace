-- v42_certificates_person  (m42: certificates PER FOUNDER = person name + company name; grants; claim on demand; revocation per person and per participant; WebP template bucket)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.
--   ADM = temporary super_admin (the PM)
--   company CO  : founders F1 + F2 (both with an ACCOUNT), F4 (a founder WITHOUT an account); participant P1 (company level, attended)
--   F5 = a founder who JOINS the company AFTER the PM issued (gets hers on demand)      F8 = joins after a participant-level revocation
--   F3 = outsider (founder of another company, not a participant)                        F6 = founder of company C2 whose participant stays `accepted`
--   F7 = a user-level participant (participants.user_id, no founders row: the profile name is printed)       F9 = a user-level participant with NO name at all
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v42.res', '', false) \gset

begin;
create schema v42_test;
grant usage on schema v42_test to public;
create or replace function v42_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v42.res', current_setting('v42.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v42_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v42_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v42_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v42_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v42_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v42_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v42_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v42_test.t(p_key, true, 'ok');
  exception when others then
    perform v42_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v42_test from public;
grant execute on all functions in schema v42_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v42_test.val('C01 m42 functions exist', $q$select (to_regprocedure('public.claim_my_certificate(uuid)') is not null and to_regprocedure('public.reissue_certificate(uuid)') is not null and to_regprocedure('public.revoke_participant_certificates(uuid,uuid,text)') is not null and to_regprocedure('app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)') is not null and to_regprocedure('app_private.cert_claim(uuid,uuid)') is not null and to_regprocedure('app_private.cert_person_name(uuid,text)') is not null and to_regprocedure('app_private.cert_backfill_person()') is not null and to_regclass('public.certificate_grants') is not null)::text$q$, 'true');
select v42_test.val('C02 every m42 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('claim_my_certificate','reissue_certificate','revoke_participant_certificates','cert_issue_person','cert_issue_one','cert_claim','cert_person_name','cert_company_name','cert_is_member','cert_accounts','cert_people','cert_pick_name','cert_clean','cert_backfill_person','issue_certificates','issue_certificate','issue_certificates_bulk','get_certificates_admin','list_my_certificates','get_certificate_render_payload','get_public_certificate_verification','cert_template_readable','cert_fields_json','cert_render_json','save_children_certificates','cert_issue_checks') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v42_test.val('C03 anon cannot execute any founder / PM certificate function; it still executes the verifier', $q$select (not has_function_privilege('anon','public.claim_my_certificate(uuid)','EXECUTE') and not has_function_privilege('anon','public.reissue_certificate(uuid)','EXECUTE') and not has_function_privilege('anon','public.revoke_participant_certificates(uuid,uuid,text)','EXECUTE') and not has_function_privilege('anon','public.list_my_certificates(uuid)','EXECUTE') and not has_function_privilege('anon','public.issue_certificates(uuid,uuid[])','EXECUTE') and not has_function_privilege('anon','public.get_certificates_admin(uuid)','EXECUTE') and has_function_privilege('anon','public.get_public_certificate_verification(text)','EXECUTE') and has_function_privilege('anon','public.verify_certificate(text)','EXECUTE'))::text$q$, 'true');
select v42_test.val('C04 no API role executes a helper (claim core, person issue, people, account list, backfill)', $q$select (has_function_privilege('authenticated','app_private.cert_claim(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)','EXECUTE') or has_function_privilege('authenticated','app_private.cert_people(uuid,text)','EXECUTE') or has_function_privilege('authenticated','app_private.cert_accounts(uuid)','EXECUTE') or has_function_privilege('authenticated','app_private.cert_backfill_person()','EXECUTE') or has_function_privilege('anon','app_private.cert_person_name(uuid,text)','EXECUTE'))::text$q$, 'false');
select v42_test.val('C05 certificate_grants: RLS enabled + forced, anon nothing, authenticated SELECT only (writes only through the RPCs)', $q$select (select relrowsecurity::text || relforcerowsecurity::text from pg_class where oid = 'public.certificate_grants'::regclass) || '/' || (has_table_privilege('anon','public.certificate_grants','SELECT'))::text || '/' || has_table_privilege('authenticated','public.certificate_grants','SELECT')::text || '/' || (has_table_privilege('authenticated','public.certificate_grants','INSERT') or has_table_privilege('authenticated','public.certificate_grants','UPDATE') or has_table_privilege('authenticated','public.certificate_grants','DELETE'))::text$q$, 'truetrue/false/true/false');
select v42_test.val('C06 one ACTIVE certificate per (node, participant, ACCOUNT): the index carries user_id', $q$select (exists (select 1 from pg_indexes where indexname = 'certificates_active_key' and indexdef like '%user_id%' and indexdef like '%revoked_at IS NULL%'))::text$q$, 'true');
select v42_test.val('C07 the template variable CHECK accepts person_name and the legacy participant_name', $q$select (pg_get_constraintdef(oid) like '%person_name%' and pg_get_constraintdef(oid) like '%participant_name%' and pg_get_constraintdef(oid) like '%company_name%')::text from pg_constraint where conname = 'certificate_template_fields_var_check'$q$, 'true');
select v42_test.val('C08 the template bucket is WebP ONLY (no PNG / JPEG / PDF) and two restrictive policies guard its objects', $q$select ((select allowed_mime_types from storage.buckets where id = 'certificate-templates') = array['image/webp'])::text || '/' || (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('webp_only_cert_insert','webp_only_cert_update') and permissive = 'RESTRICTIVE')::text$q$, 'true/2');
select v42_test.val('C09 the policies call no function (an RLS function needs EXECUTE for the caller: the m36 lesson)', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('webp_only_cert_insert','webp_only_cert_update') and (coalesce(with_check,'') ~* '(app_private|public)\.[a-z_]+\(')$q$, '0');
select v42_test.val('C10 the m38 data is untouched (0 certificates, 0 grants, 0 templates in the MIGRATED projects: hermetic)', $q$select (select count(*) from public.certificates where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text || '/' || (select count(*) from public.certificate_grants where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text || '/' || (select count(*) from public.certificate_templates where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text$q$, '0/0/0');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000d420','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-admin@example.invalid','{"provisioned":true}','{"full_name":"V42 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d421','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f1@example.invalid','{"provisioned":true}','{"full_name":"profile name one"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d422','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f2@example.invalid','{"provisioned":true}','{"full_name":"profile name two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d423','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f3@example.invalid','{"provisioned":true}','{"full_name":"V42 Outsider"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d425','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f5@example.invalid','{"provisioned":true}','{"full_name":"V42 Late Joiner"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d426','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f6@example.invalid','{"provisioned":true}','{"full_name":"V42 Accepted Only"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d427','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f7@example.invalid','{"provisioned":true}','{"full_name":"  V42   Solo   Founder "}', now(), now()),
 ('00000000-0000-4000-8000-00000000d428','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f8@example.invalid','{"provisioned":true}','{"full_name":"V42 Very Late"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d429','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v42-f9@example.invalid','{"provisioned":true}','{"full_name":"x"}', now(), now());
update public.profiles set full_name = null where id = '00000000-0000-4000-8000-00000000d429';
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000d420','super_admin'), ('00000000-0000-4000-8000-00000000d421','founder'),
  ('00000000-0000-4000-8000-00000000d422','founder'), ('00000000-0000-4000-8000-00000000d423','founder'), ('00000000-0000-4000-8000-00000000d425','founder'),
  ('00000000-0000-4000-8000-00000000d426','founder'), ('00000000-0000-4000-8000-00000000d427','founder'), ('00000000-0000-4000-8000-00000000d428','founder'), ('00000000-0000-4000-8000-00000000d429','founder');

-- companies, founders (bilingual names; F2 has only an Arabic name + untidy spaces in the English one), the company -> founders links
insert into public.companies (id, name_en, name_ar) values
  ('00000000-0000-4000-8000-00000000c001', 'V42  Nile   Labs', 'مختبرات النيل V42'),
  ('00000000-0000-4000-8000-00000000c002', 'V42 Second Co', null),
  ('00000000-0000-4000-8000-00000000c003', 'V42 Third Co', null);
insert into public.founders (id, name_en, name_ar, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f001', 'Sara Ali', 'سارة علي', '00000000-0000-4000-8000-00000000d421'),
  ('00000000-0000-4000-8000-00000000f002', '  Omar   Zaki ', 'عمر زكي', '00000000-0000-4000-8000-00000000d422'),
  ('00000000-0000-4000-8000-00000000f003', 'V42 Outsider Founder', 'غريب', '00000000-0000-4000-8000-00000000d423'),
  ('00000000-0000-4000-8000-00000000f004', 'Lina Unlinked', 'لينا غير مرتبطة', null),
  ('00000000-0000-4000-8000-00000000f005', 'Hadi Late', 'هادي المتأخر', '00000000-0000-4000-8000-00000000d425'),
  ('00000000-0000-4000-8000-00000000f006', 'V42 Accepted Founder', 'مقبول', '00000000-0000-4000-8000-00000000d426'),
  ('00000000-0000-4000-8000-00000000f008', 'Very Late', 'متأخر جدا', '00000000-0000-4000-8000-00000000d428');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000f001', true),
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000f002', false),
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000f004', false),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000f003', true),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000f006', true);
-- F5 and F8 join company CO LATER (below)

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V42 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V42 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.create_project(:'prog', 'V42 Other project', null, 'Asia/Riyadh')).id as proj2 \gset
select (public.add_node(:'proj', 'certificates', '{"en":"V42 Certificates","ar":"شهادات"}', 0, 0, '{}')).id as cn \gset
select (public.add_node(:'proj', 'certificates', '{"en":"V42 Empty certificates"}', 0, 100, '{}')).id as cn2 \gset
select (public.add_node(:'proj2', 'certificates', '{"en":"V42 Foreign certificates"}', 0, 0, '{}')).id as cnx \gset
reset role;
insert into storage.objects (bucket_id, name) values
  ('certificate-templates', :'proj' || '/' || :'cn' || '/t1.webp'),
  ('certificate-templates', :'proj' || '/' || :'cn' || '/t2.webp'),
  ('certificate-templates', :'proj' || '/' || :'cn2' || '/t1.webp'),
  ('certificate-templates', :'proj2' || '/' || :'cnx' || '/t1.webp');
-- participants (company level + user level)
insert into public.participants (id, project_id, company_id, user_id, source, status) values
  ('00000000-0000-4000-8000-00000000a001', :'proj', '00000000-0000-4000-8000-00000000c001', null, 'manual', 'accepted'),
  ('00000000-0000-4000-8000-00000000a002', :'proj', '00000000-0000-4000-8000-00000000c002', null, 'manual', 'accepted'),
  ('00000000-0000-4000-8000-00000000a003', :'proj', null, '00000000-0000-4000-8000-00000000d427', 'manual', 'accepted'),
  ('00000000-0000-4000-8000-00000000a004', :'proj', null, '00000000-0000-4000-8000-00000000d429', 'manual', 'accepted');

-- ================================================================= template save: person_name + company_name, the legacy alias, WebP paths
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'),
  '{"config":{"language":"en","verifier":{"enabled":true,"showCertificate":true}},"show_to_participants":false}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.webp','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','participant_name','x',0.5,'y',0.46,'w',0.6,'align','center','font','Tajawal','size',0.045,'color','#1A1A2E','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',true),
      jsonb_build_object('var','company_name','x',0.5,'y',0.54,'w',0.5,'size',0.028,'weight',500,'shrink_to_fit',true),
      jsonb_build_object('var','program_name','x',0.5,'y',0.62,'w',0.7,'size',0.025),
      jsonb_build_object('var','completion_date','x',0.2,'y',0.84,'w',0.25,'size',0.02),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015,'font','Manrope','weight',500),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved \gset
reset role;
select v42_test.val('S01 the legacy key participant_name is stored as person_name (6 fields: person, company, program, date, code, QR)', format($q$select (select string_agg(f.var, ',' order by f.var) from public.certificate_template_fields f join public.certificate_templates t on t.id = f.template_id where t.node_id = '%s')$q$, :'cn'), 'company_name,completion_date,person_name,program_name,verification_code,verification_qr');
select v42_test.val('S02 the template of a node keeps its WebP file and size', format($q$select right(file_path, 7) || '/' || width_px::text from public.certificate_templates where node_id = '%s'$q$, :'cn'), 't1.webp/3508');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'), '{}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.webp','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','person_name','x',0.5,'y',0.46,'w',0.6,'align','center','font','Tajawal','size',0.045,'color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',true),
      jsonb_build_object('var','company_name','x',0.5,'y',0.54,'w',0.5,'size',0.028,'weight',500,'shrink_to_fit',true,'align','center','font','Tajawal','color','#1a1a2e','direction','auto','max_lines',1),
      jsonb_build_object('var','program_name','x',0.5,'y',0.62,'w',0.7,'size',0.025,'align','center','font','Tajawal','color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',false),
      jsonb_build_object('var','completion_date','x',0.2,'y',0.84,'w',0.25,'size',0.02),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015,'font','Manrope','weight',500),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved2 \gset
reset role;
select v42_test.val('S03 saving the same template under the new key creates NO new version', format($q$select count(*)::text from public.certificate_templates where node_id = '%s'$q$, :'cn'), '1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, %%L::jsonb)$q$, :'cn', :'cn') as savesql \gset
select v42_test.fails('S05 the same variable under both keys is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.webp','width_px',2000,'height_px',1400,'fields','[{"var":"person_name","x":0.5,"y":0.5,"w":0.5},{"var":"participant_name","x":0.5,"y":0.6,"w":0.5}]'::jsonb))), '22023', 'certificate_invalid');
select v42_test.fails('S06 a PDF template is still refused (images only)', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.webp','file_kind','pdf','width_px',2000,'height_px',1400,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
-- the template bucket: only .webp objects can be stored by a PM
select v42_test.okrun('S07 a PM can store a WebP template object', format($q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('certificate-templates', %L, %L, '{"mimetype":"image/webp"}')$q$, :'proj' || '/' || :'cn' || '/t3.webp', '00000000-0000-4000-8000-00000000d420'));
select v42_test.fails('S08 a PNG object is refused by the restrictive policy (42501)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('certificate-templates', %L, %L)$q$, :'proj' || '/' || :'cn' || '/t4.png', '00000000-0000-4000-8000-00000000d420'), '42501');
select v42_test.fails('S09 a JPEG object is refused', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('certificate-templates', %L, %L)$q$, :'proj' || '/' || :'cn' || '/t4.jpg', '00000000-0000-4000-8000-00000000d420'), '42501');
select v42_test.fails('S10 a PDF object is refused', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('certificate-templates', %L, %L)$q$, :'proj' || '/' || :'cn' || '/t4.pdf', '00000000-0000-4000-8000-00000000d420'), '42501');
select v42_test.fails('S11 a .webp name that claims a PNG mimetype is refused', format($q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('certificate-templates', %L, %L, '{"mimetype":"image/png"}')$q$, :'proj' || '/' || :'cn' || '/t5.webp', '00000000-0000-4000-8000-00000000d420'), '42501');
reset role;

-- ================================================================= issuing rules (completion, attendance, template)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.set_participant_status('00000000-0000-4000-8000-00000000a001', 'attended');
select public.set_participant_status('00000000-0000-4000-8000-00000000a003', 'attended');
select public.set_participant_status('00000000-0000-4000-8000-00000000a004', 'attended');
select v42_test.fails('I01 issuing BEFORE the project is completed is rejected (certificate_project_not_completed)', format($q$select public.issue_certificates('%s')$q$, :'cn'), '23514', 'certificate_project_not_completed');
select v42_test.fails('I02 the single-issue name too', format($q$select public.issue_certificate('00000000-0000-4000-8000-00000000a001', '%s')$q$, :'cn'), '23514', 'certificate_project_not_completed');
select v42_test.fails('I03 a PM is not a linked founder: claim_my_certificate is forbidden for him too',format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
select public.complete_project(:'proj');
select v42_test.fails('I04 a node without a template: certificate_template_missing', format($q$select public.issue_certificates('%s')$q$, :'cn2'), 'P0002', 'certificate_template_missing');
reset role;

-- ================================================================= "Issue to all attended": the grant + a certificate per linked ACCOUNT
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn') as r1 \gset
reset role;
select v42_test.val('A01 the bulk result: 4 person certificates (F1, F2 of the company; the two user-level participants), 3 participants authorised (F9 has no name: no_name), nothing skipped but F9', format($q$select ('%s'::jsonb->>'issued') || '/' || ('%s'::jsonb->>'authorised') || '/' || ('%s'::jsonb->>'existing') || '/' || ('%s'::jsonb->>'skipped')$q$, :'r1', :'r1', :'r1', :'r1'), '3/2/0/1');
select v42_test.val('A02 the company participant: status issued, 2 certificates created, 2 linked accounts, 1 founder with no account', format($q$select (x->>'status') || '/' || (x->>'created') || '/' || (x->>'linked') || '/' || (x->>'unlinked') from jsonb_array_elements('%s'::jsonb->'results') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'r1'), 'issued/2/2/1');
select v42_test.val('A03 the nameless account F9: authorised but NO certificate (no_name), never a made-up name', format($q$select (x->>'status') || '/' || (select count(*) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a004')::text from jsonb_array_elements('%s'::jsonb->'results') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a004'$q$, :'r1'), 'no_name/0');
select v42_test.val('A04 the accepted-only participants got nothing: 3 grants, 3 certificates in total', format($q$select (select count(*) from public.certificate_grants where node_id = '%s')::text || '/' || (select count(*) from public.certificates where node_id = '%s')::text$q$, :'cn', :'cn'), '3/3');
select v42_test.val('A05 TWO FOUNDERS OF ONE COMPANY: two certificates, two different codes, two different person names, the SAME company name', format($q$select count(*)::text || '/' || count(distinct code)::text || '/' || count(distinct snapshot->>'person_name')::text || '/' || count(distinct snapshot->>'company_name')::text || '/' || min(snapshot->>'company_name') from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001'$q$, :'cn'), '2/2/2/1/V42 Nile Labs');
select v42_test.val('A06 the names are the ACCOUNTS'' own founders rows, whitespace collapsed (English template: name_en; the profile name is NOT used when a founders row exists)', format($q$select string_agg(snapshot->>'person_name', '|' order by snapshot->>'person_name') from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001'$q$, :'cn'), 'Omar Zaki|Sara Ali');
select v42_test.val('A07 a user-level participant without a founders row prints the PROFILE name, whitespace collapsed', $q$select snapshot->>'person_name' || '|' || coalesce(snapshot->>'company_name', '-') from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a003'$q$, 'V42 Solo Founder|');
select v42_test.val('A08 each person certificate belongs to ITS account (user_id) and to the ONE grant of the participant', $q$select count(distinct user_id)::text || '/' || count(distinct grant_id)::text from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001'$q$, '2/1');
select v42_test.val('A09 the snapshot froze program, project, dates and the template version in the template language', format($q$select snapshot->>'program_name' || '|' || (snapshot->>'project_name') || '|' || (snapshot->>'completed_on') || '|' || (snapshot->>'issued_on') || '|' || (snapshot->>'language') || '|' || (snapshot->>'template_version') from public.certificates where user_id = '00000000-0000-4000-8000-00000000d421'$q$), 'V42 Program|V42 Project|' || (select (now() at time zone 'Asia/Riyadh')::date::text) || '|' || (select (now() at time zone 'Asia/Riyadh')::date::text) || '|en|1');
select v42_test.val('A10 origin = issue for the certificates created by the PM action', $q$select string_agg(distinct origin, ',') from public.certificates$q$, 'issue');
select user_id as u1 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d421' \gset
select id as cert1, code as code1 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d421' \gset
select id as cert2, code as code2 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d422' \gset
select id as cert7, code as code7 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d427' \gset

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn') as r2 \gset
reset role;
select v42_test.val('A11 issuing again is IDEMPOTENT: nothing created, the same 3 certificates, the same codes', format($q$select ('%s'::jsonb->>'issued') || '/' || ('%s'::jsonb->>'authorised') || '/' || (select count(*) from public.certificates where node_id = '%s')::text || '/' || (select code from public.certificates where id = '%s')$q$, :'r2', :'r2', :'cn', :'cert1'), '0/0/3/' || :'code1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn', array['00000000-0000-4000-8000-00000000a002']::uuid[]) as r3 \gset
select public.issue_certificates(:'cn', array['11111111-1111-4111-8111-111111111111']::uuid[]) as r3b \gset
reset role;
select v42_test.val('A12 a NON-attended participant selected by hand gets nothing (not_attended, no grant, no row)', format($q$select ('%s'::jsonb->'results'->0->>'status') || '/' || (select count(*) from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a002')::text || '/' || (select count(*) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a002')::text$q$, :'r3'), 'not_attended/0/0');
select v42_test.val('A13 an unknown participant id answers not_found', format($q$select '%s'::jsonb->'results'->0->>'status'$q$, :'r3b'), 'not_found');

-- ================================================================= the PM panel
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.get_certificates_admin(:'cn') as adm \gset
reset role;
select v42_test.val('P01 the panel: 3 participants (+ the accepted ones counted as others), template present with the person name field', format($q$select jsonb_array_length('%s'::jsonb->'rows')::text || '/' || ('%s'::jsonb->>'others') || '/' || ('%s'::jsonb->'template'->>'has_name_field')$q$, :'adm', :'adm', :'adm'), '3/1/true');
select v42_test.val('P02 the company row lists its founders: Sara issued, Omar issued, Lina NOT LINKED (no certificate, no claim)', format($q$select string_agg((f->>'name') || ':' || (f->>'state') || ':' || (f->>'linked'), ',' order by f->>'name') from jsonb_array_elements('%s'::jsonb->'rows') r, jsonb_array_elements(r->'founders') f where r->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'adm'), 'Lina Unlinked:not_linked:false,Omar Zaki:issued:true,Sara Ali:issued:true');
select v42_test.val('P03 the company row counts: 3 people, 2 linked, 1 not linked, 2 issued, 0 claimable, 0 revoked', format($q$select (r->'counts'->>'people') || '/' || (r->'counts'->>'linked') || '/' || (r->'counts'->>'unlinked') || '/' || (r->'counts'->>'issued') || '/' || (r->'counts'->>'claimable') || '/' || (r->'counts'->>'revoked') from jsonb_array_elements('%s'::jsonb->'rows') r where r->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'adm'), '3/2/1/2/0/0');
select v42_test.val('P04 the company row carries the company name and an active grant; a person certificate carries its code', format($q$select (r->>'company_name') || '/' || ((r->'grant'->>'revoked_at') is null)::text || '/' || (select count(*) from jsonb_array_elements(r->'founders') f where f->'certificate'->>'code' is not null)::text from jsonb_array_elements('%s'::jsonb->'rows') r where r->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'adm'), 'V42 Nile Labs/true/2');
select v42_test.val('P05 NO account id leaves the database in the panel payload', format($q$select ('%s' like '%%d421%%' or '%s' like '%%d422%%' or '%s' like '%%user_id%%')::text$q$, :'adm', :'adm', :'adm'), 'false');
select v42_test.val('P06 the totals: 5 people listed (3 company founders + 2 user-level accounts), 3 certificates issued, 1 not linked, 0 claimable, 0 revoked', format($q$select (t->>'people') || '/' || (t->>'issued') || '/' || (t->>'unlinked') || '/' || (t->>'claimable') || '/' || (t->>'revoked') from (select '%s'::jsonb->'totals' t) x$q$, :'adm'), '5/3/1/0/0');
select v42_test.val('P07 the nameless linked account is flagged no_name in the panel (neither issued nor claimable)', format($q$select (f->>'state') from jsonb_array_elements('%s'::jsonb->'rows') r, jsonb_array_elements(r->'founders') f where r->>'participant_id' = '00000000-0000-4000-8000-00000000a004'$q$, :'adm'), 'no_name');

-- ================================================================= a founder reads ONLY HIS OWN certificate (RLS) and downloads from HIS OWN interface
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('F01 founder 1: the table shows ONE row = his own, not his co-founder''s (the m07 policy was per company)', $q$select count(*)::text || '/' || min(code) from public.certificates$q$, '1/' || :'code1');
select v42_test.val('F02 founder 1: nothing to download while the node is not shown to participants', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
reset role;
update public.nodes set show_to_participants = true where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('F03 founder 1 (own interface): ONE certificate with HIS name, the company name and his own code', $q$select jsonb_array_length(public.list_my_certificates())::text || '|' || (public.list_my_certificates()->0->>'person_name') || '|' || (public.list_my_certificates()->0->>'company_name') || '|' || (public.list_my_certificates()->0->>'code')$q$, '1|Sara Ali|V42 Nile Labs|' || :'code1');
select v42_test.val('F04 the alias participant_name still answers the person name (older clients)', $q$select public.list_my_certificates()->0->>'participant_name'$q$, 'Sara Ali');
select v42_test.val('F05 founder 1: narrowing by another project -> 0', format($q$select jsonb_array_length(public.list_my_certificates('%s'))::text$q$, :'proj2'), '0');
select v42_test.val('F06 founder 1: the render payload of HIS certificate carries his snapshot (person + company) and 6 fields incl. person_name', format($q$select (v->>'code' = '%s')::text || '/' || jsonb_array_length(v->'fields')::text || '/' || (v->'snapshot'->>'person_name') || '/' || (v->'snapshot'->>'company_name') || '/' || (select string_agg(x->>'var', ',' order by x->>'var') from jsonb_array_elements(v->'fields') x where x->>'var' like '%%name') from (select public.get_certificate_render_payload('%s') v) x$q$, :'code1', :'cert1'), 'true/6/Sara Ali/V42 Nile Labs/company_name,person_name,program_name');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.fails('F07 founder 1 CANNOT fetch his co-founder''s render payload (42501)', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert2'), '42501');
reset role;
update public.nodes set config = jsonb_set(jsonb_set(config, '{verifier,enabled}', 'false'), '{verifier,showCertificate}', 'false') where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('F09 verifier off: founder 1 still reads the template file (his own certificate)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d422","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('F10 founder 2 (same company, HIS own interface): ONE certificate with HIS name, the same company, a DIFFERENT code', format($q$select jsonb_array_length(public.list_my_certificates())::text || '|' || (public.list_my_certificates()->0->>'person_name') || '|' || (public.list_my_certificates()->0->>'company_name') || '|' || ((public.list_my_certificates()->0->>'code') <> '%s')::text$q$, :'code1'), '1|Omar Zaki|V42 Nile Labs|true');
select v42_test.fails('F11 founder 2 CANNOT fetch founder 1''s render payload', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
select v42_test.val('F12 founder 2: the table shows only his own row', $q$select count(*)::text from public.certificates$q$, '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d423","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('F13 the outsider founder: no certificate row, nothing to download, no template file', format($q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from storage.objects where bucket_id = 'certificate-templates' and name = '%s')::text$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '0/0/0');
select v42_test.fails('F14 the outsider founder: claim_my_certificate is forbidden (not linked to any attended participant)', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
select v42_test.fails('F15 the outsider cannot fetch a render payload', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
select v42_test.fails('F16 the outsider cannot read the grants table (RLS: 0 rows) ... and cannot write it (no grant)', $q$insert into public.certificate_grants (project_id, node_id, participant_id) select project_id, id, null from public.nodes limit 1$q$, '42501');
select v42_test.val('F17 the outsider sees 0 grants', $q$select count(*)::text from public.certificate_grants$q$, '0');
select v42_test.fails('F18 a founder cannot read the Issue panel / issue / revoke / re-issue / revoke the participant', format($q$select public.get_certificates_admin('%s')$q$, :'cn'), '42501');
select v42_test.fails('F19 nor issue', format($q$select public.issue_certificates('%s')$q$, :'cn'), '42501');
select v42_test.fails('F20 nor revoke a certificate', format($q$select public.revoke_certificate('%s', 'x')$q$, :'cert1'), '42501');
select v42_test.fails('F21 nor re-issue one', format($q$select public.reissue_certificate('%s')$q$, :'cert1'), '42501');
select v42_test.fails('F22 nor revoke a participant', format($q$select public.revoke_participant_certificates('%s', '00000000-0000-4000-8000-00000000a001', 'x')$q$, :'cn'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d426","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('F23 an ACCEPTED-only participant''s founder: nothing', format($q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text$q$), '0/0');
select v42_test.fails('F24 ... and claim is forbidden', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v42_test.fails('F25 anon cannot read certificates', $q$select count(*) from public.certificates$q$, '42501');
select v42_test.fails('F26 anon cannot read the grants', $q$select count(*) from public.certificate_grants$q$, '42501');
reset role;
-- the verifier switches back on
update public.nodes set config = jsonb_set(jsonb_set(config, '{verifier,enabled}', 'true'), '{verifier,showCertificate}', 'true') where id = :'cn';

-- ================================================================= the public verifier: person + company + program + dates, nothing else
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v42_test.val('V01 anon: BOTH codes are valid, each with ITS person name and the same company name', format($q$select (a->>'status') || '|' || (a->>'person_name') || '|' || (a->>'company_name') || '|' || (b->>'status') || '|' || (b->>'person_name') || '|' || (b->>'company_name') from (select public.get_public_certificate_verification('%s') a, public.get_public_certificate_verification('%s') b) x$q$, :'code1', :'code2'), 'valid|Sara Ali|V42 Nile Labs|valid|Omar Zaki|V42 Nile Labs');
select v42_test.val('V02 anon: program + dates + issuer, and NO ids / e-mail / account data', format($q$select (v->>'program_name') || '|' || (v->>'completed_on') || '|' || (not (v ? 'participant_id'))::text || '|' || (not (v ? 'user_id'))::text || '|' || (not (v ? 'node_id'))::text || '|' || (not (v ? 'certificate_id'))::text || '|' || (not (v::text like '%%@%%'))::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'V42 Program|' || (select (now() at time zone 'Asia/Riyadh')::date::text) || '|true|true|true|true|true');
select v42_test.val('V03 anon: the render payload carries ONLY the values the template prints (person, company, program, date) and the 6 fields', format($q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(v->'render'->'snapshot') k) || '/' || jsonb_array_length(v->'render'->'fields')::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'company_name,completed_on,person_name,program_name/6');
select v42_test.val('V04 anon: a lower-case, dash-less code works; the old verify_certificate name answers the same', format($q$select (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.verify_certificate('%s')->>'person_name')$q$, lower(replace(:'code2', '-', '')), :'code2'), 'valid/Omar Zaki');
select v42_test.val('V05 anon: the template FILE is readable while a valid certificate may show it', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '1');
select v42_test.val('V06 anon: an unknown code is not_found (no detail)', $q$select (public.get_public_certificate_verification('ZZZZ-ZZZZ-ZZZZ'))::text$q$, '{"valid": false, "status": "not_found"}');
reset role;

-- ================================================================= a founder who JOINS later claims HIS OWN certificate on demand (idempotent)
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000f005', false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.get_certificates_admin(:'cn') as adm2 \gset
reset role;
select v42_test.val('L01 the panel says: Hadi (linked after the issue) is CLAIMABLE', format($q$select string_agg((f->>'name') || ':' || (f->>'state'), ',' order by f->>'name') from jsonb_array_elements('%s'::jsonb->'rows') r, jsonb_array_elements(r->'founders') f where r->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'adm2'), 'Hadi Late:claimable,Lina Unlinked:not_linked,Omar Zaki:issued,Sara Ali:issued');
select v42_test.val('L02 nothing was created by the join itself (3 certificates)', format($q$select count(*)::text from public.certificates where node_id = '%s'$q$, :'cn'), '3');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d425","role":"authenticated"}', true);
set local role authenticated;
select public.claim_my_certificate(:'cn') as cl1 \gset
select public.claim_my_certificate(:'cn') as cl2 \gset
select v42_test.val('L03 claim_my_certificate: issued the FIRST time, existing the second (same code), with HIS name', format($q$select ('%s'::jsonb->>'status') || '/' || ('%s'::jsonb->>'status') || '/' || (('%s'::jsonb->>'code') = ('%s'::jsonb->>'code'))::text$q$, :'cl1', :'cl2', :'cl1', :'cl2'), 'issued/existing/true');
select v42_test.val('L04 the founder''s own list shows HIS certificate: Hadi Late + the company name', $q$select jsonb_array_length(public.list_my_certificates())::text || '|' || (public.list_my_certificates()->0->>'person_name') || '|' || (public.list_my_certificates()->0->>'company_name')$q$, '1|Hadi Late|V42 Nile Labs');
select v42_test.val('L05 he reads only his own row', $q$select count(*)::text from public.certificates$q$, '1');
reset role;
select v42_test.val('L06 origin = claim, issued by the PM who authorised (not by the founder), a THIRD distinct code for the company', format($q$select origin || '/' || (issued_by = '00000000-0000-4000-8000-00000000d420')::text || '/' || (select count(distinct code)::text from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001') from public.certificates where user_id = '00000000-0000-4000-8000-00000000d425'$q$), 'claim/true/3');
-- on-demand through list_my_certificates (a founder who never calls claim): F8 links, then only opens the block
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000f008', false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d428","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('L07 opening the block (list_my_certificates) claims on demand: ONE certificate for the late founder', $q$select jsonb_array_length(public.list_my_certificates())::text || '|' || (public.list_my_certificates()->0->>'person_name')$q$, '1|Very Late');
select v42_test.val('L08 the Program page RPC carries it too (certificate block)', format($q$select (b->'data'->'items'->0->>'person_name') from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate'$q$, :'proj'), 'Very Late');
reset role;
select v42_test.val('L09 calling it again did not create a second certificate', format($q$select count(*)::text from public.certificates where user_id = '00000000-0000-4000-8000-00000000d428' and node_id = '%s'$q$, :'cn'), '1');
-- not exposed / project re-opened: forbidden
update public.nodes set show_to_participants = false where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.fails('L10 a node that is not shown to participants: claim is forbidden', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
reset role;
update public.nodes set show_to_participants = true where id = :'cn';
update public.projects set completed_at = null where id = :'proj';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.fails('L11 a RE-OPENED project: claim is forbidden', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
select v42_test.val('L12 a RE-OPENED project: nothing to download', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
reset role;
update public.projects set completed_at = now() where id = :'proj';

-- ================================================================= withdrawn / name-less
update public.participants set status = 'withdrawn' where id = '00000000-0000-4000-8000-00000000a003';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d427","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('W01 a WITHDRAWN participant: the certificate STAYS readable and listed (m44 / 08 s18.2 supersedes m42: only the PM revokes; a NEW one still needs attended, W02)', $q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text$q$, '1/1');
select v42_test.fails('W02 ... and claim is forbidden', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
reset role;
update public.participants set status = 'attended' where id = '00000000-0000-4000-8000-00000000a003';

-- ================================================================= revocation: ONE certificate only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select v42_test.fails('R01 a reason over 500 characters is refused', format($q$select public.revoke_certificate('%s', repeat('a', 501))$q$, :'cert1'), '22023', 'certificate_invalid');
select public.revoke_certificate(:'cert1', '  duplicate record  ');
reset role;
select v42_test.val('R02 ONLY founder 1''s certificate is revoked (reason trimmed); the co-founders'' certificates are untouched', format($q$select count(*) filter (where revoked_at is not null)::text || '/' || count(*) filter (where revoked_at is null)::text || '/' || (select revoked_reason from public.certificates where id = '%s') from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001'$q$, :'cert1'), '1/3/duplicate record');
select v42_test.val('R03 the grant stays active (a person revocation is not a participant revocation)', format($q$select ((select revoked_at from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a001') is null)::text$q$), 'true');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v42_test.val('R04 anon: the revoked code answers revoked (name + company, NO render payload), the other code is still valid', format($q$select (a->>'status') || '|' || (a->>'person_name') || '|' || (a->>'company_name') || '|' || (a ? 'render')::text || '|' || (b->>'status') || '|' || (b ? 'render')::text from (select public.get_public_certificate_verification('%s') a, public.get_public_certificate_verification('%s') b) x$q$, :'code1', :'code2'), 'revoked|Sara Ali|V42 Nile Labs|false|valid|true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('R05 founder 1: his revoked certificate disappears (table, list)', $q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text$q$, '0/0');
select v42_test.val('R06 founder 1: claim answers revoked, creates nothing', format($q$select public.claim_my_certificate('%s')->>'status'$q$, :'cn'), 'revoked');
select v42_test.fails('R07 founder 1: the revoked render payload is forbidden', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
select v42_test.val('R07b opening the block and claiming did NOT re-create it: still exactly ONE certificate row for founder 1', $q$select count(*)::text from public.certificates where user_id = '00000000-0000-4000-8000-00000000d421'$q$, '1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d422","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('R08 founder 2 is not affected: his certificate is still listed and still renders', format($q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (public.get_certificate_render_payload('%s')->>'code' = '%s')::text$q$, :'cert2', :'code2'), '1/true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn') as r4 \gset
reset role;
select v42_test.val('R09 "issue to all" does NOT re-issue a person revoked on purpose (status existing, still 5 certificates, no new one for founder 1)', format($q$select (x->>'status') || '/' || (x->>'revoked') || '/' || (select count(*) from public.certificates where node_id = '%s')::text from jsonb_array_elements('%s'::jsonb->'results') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'cn', :'r4'), 'existing/1/5');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.get_certificates_admin(:'cn') as adm3 \gset
select v42_test.val('R10 the panel: Sara is REVOKED (with the reason), the others unchanged', format($q$select string_agg((f->>'name') || ':' || (f->>'state'), ',' order by f->>'name') from jsonb_array_elements('%s'::jsonb->'rows') r, jsonb_array_elements(r->'founders') f where r->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'adm3'), 'Hadi Late:issued,Lina Unlinked:not_linked,Omar Zaki:issued,Sara Ali:revoked,Very Late:issued');
select public.reissue_certificate(:'cert1') as re1 \gset
select public.reissue_certificate(:'cert1') as re2 \gset
reset role;
select v42_test.val('R11 Issue AGAIN to ONE person: a NEW certificate with a NEW code for Sara, the old one stays revoked, a second click is idempotent', format($q$select ('%s'::jsonb->>'status') || '/' || ('%s'::jsonb->>'status') || '/' || (('%s'::jsonb->>'code') <> '%s')::text || '/' || (('%s'::jsonb->>'code') = ('%s'::jsonb->>'code'))::text || '/' || (select count(*) from public.certificates where user_id = '00000000-0000-4000-8000-00000000d421')::text || '/' || (select origin from public.certificates where id = ('%s'::jsonb->>'certificate_id')::uuid)$q$, :'re1', :'re2', :'re1', :'code1', :'re1', :'re2', :'re1'), 'issued/existing/true/true/2/reissue');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d421","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('R12 founder 1 downloads again: his NEW certificate, same name + company, the new code', format($q$select (public.list_my_certificates()->0->>'code' = '%s')::text || '/' || (public.list_my_certificates()->0->>'person_name')$q$, (select code from public.certificates where user_id = '00000000-0000-4000-8000-00000000d421' and revoked_at is null)), 'true/Sara Ali');
reset role;

-- ================================================================= revocation: the PARTICIPANT (all of its person certificates + the grant)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select v42_test.fails('R13 a reason over 500 characters is refused here too', format($q$select public.revoke_participant_certificates('%s', '00000000-0000-4000-8000-00000000a001', repeat('a', 501))$q$, :'cn'), '22023', 'certificate_invalid');
select v42_test.fails('R14 a participant of ANOTHER project is not found', format($q$select public.revoke_participant_certificates('%s', '00000000-0000-4000-8000-00000000a001', 'x')$q$, :'cnx'), 'P0002');
select public.revoke_participant_certificates(:'cn', '00000000-0000-4000-8000-00000000a001', 'cohort withdrawn') as rp \gset
reset role;
select v42_test.val('R15 participant-level revocation: every ACTIVE person certificate of the participant + the grant (4 revoked incl. the re-issued one)', format($q$select ('%s'::jsonb->>'revoked') || '/' || ('%s'::jsonb->>'grant_revoked') || '/' || (select count(*) filter (where revoked_at is null) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001')::text || '/' || (select count(*) from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a001' and revoked_at is null)::text$q$, :'rp', :'rp'), '4/true/0/0');
select v42_test.val('R16 the other participant is untouched (F7 still holds his certificate)', $q$select count(*)::text from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a003' and revoked_at is null$q$, '1');
select code as code5 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d425' \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v42_test.val('R17 anon: ALL of the company''s codes are revoked now', format($q$select (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.get_public_certificate_verification('%s')->>'status')$q$, :'code1', :'code2', :'code5'), 'revoked/revoked/revoked');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d425","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('R18 a founder of the revoked participant: nothing, and claim is FORBIDDEN (no active grant)', format($q$select jsonb_array_length(public.list_my_certificates())::text$q$), '0');
select v42_test.fails('R19 ... claim forbidden', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn') as r5 \gset
reset role;
select v42_test.val('R21 "issue to all" SKIPS a participant whose grant was revoked (skipped_revoked, no certificate created)', format($q$select (x->>'status') || '/' || (select count(*) filter (where revoked_at is null) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001')::text from jsonb_array_elements('%s'::jsonb->'results') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'r5'), 'skipped_revoked/0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select v42_test.fails('R20 a person re-issue needs an ACTIVE grant: certificate_grant_revoked', format($q$select public.reissue_certificate('%s')$q$, :'cert2'), '23514', 'certificate_grant_revoked');
select public.issue_certificates(:'cn', array['00000000-0000-4000-8000-00000000a001']::uuid[]) as r6 \gset
reset role;
select v42_test.val('R22 selecting the participant on purpose re-authorises: a NEW grant and NEW certificates (new codes) for the 4 linked accounts, the old ones stay revoked', format($q$select (x->>'status') || '/' || (x->>'created') || '/' || (select count(*) filter (where revoked_at is null) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001')::text || '/' || (select count(*) filter (where revoked_at is not null) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001')::text || '/' || (select count(*) from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a001')::text || '/' || (select count(distinct code) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a001')::text from jsonb_array_elements('%s'::jsonb->'results') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a001'$q$, :'r6'), 'issued/4/4/5/2/9');

-- ================================================================= the legacy data path (m38 rows migrate without loss)
update public.certificates set user_id = null, grant_id = null, snapshot = (snapshot - 'person_name') || jsonb_build_object('participant_name', snapshot->'person_name') where id = :'cert7';
delete from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a003';
select app_private.cert_backfill_person()::text as bf \gset
select v42_test.val('M01 backfill: a legacy participant-level row (no grant, no account, old snapshot key) gets a GRANT, the participant''s own ACCOUNT and the new snapshot key', format($q$select (select count(*) from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a003' and revoked_at is null)::text || '/' || (user_id = '00000000-0000-4000-8000-00000000d427')::text || '/' || (grant_id is not null)::text || '/' || (snapshot->>'person_name') || '/' || (snapshot ? 'participant_name')::text from public.certificates where id = '%s'$q$, :'cert7'), '1/true/true/V42 Solo Founder/true');
select v42_test.val('M02 backfill is idempotent (a second run changes nothing)', $q$select app_private.cert_backfill_person()::text$q$, '{"users": 0, "fields": 0, "grants": 0, "snapshots": 0}');
select v42_test.val('M03 the legacy-shaped row is readable by its owner after the backfill', format($q$select count(*)::text from public.certificates where id = '%s' and user_id = '00000000-0000-4000-8000-00000000d427'$q$, :'cert7'), '1');
-- a legacy template field is renamed when nothing references it; a referenced template keeps it (immutable) and the payload emits person_name anyway
insert into public.certificate_templates (id, project_id, node_id, version, language, file_path, file_kind, width_px, height_px) values
  ('00000000-0000-4000-8000-00000000e001', :'proj', :'cn2', 1, 'ar', :'proj' || '/' || :'cn2' || '/t1.webp', 'image', 2000, 1400);
insert into public.certificate_template_fields (template_id, project_id, var, x, y, w) values ('00000000-0000-4000-8000-00000000e001', :'proj', 'participant_name', 0.5, 0.5, 0.5);
select app_private.cert_backfill_person()::text as bf2 \gset
select v42_test.val('M04 backfill renames the legacy field of an UNREFERENCED template to person_name', $q$select var from public.certificate_template_fields where template_id = '00000000-0000-4000-8000-00000000e001'$q$, 'person_name');
select v42_test.val('M05 the field emitted for the renderer is person_name for any template', $q$select app_private.cert_fields_json('00000000-0000-4000-8000-00000000e001')->0->>'var'$q$, 'person_name');

-- ================================================================= the PM payload after the story
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d420","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('G01 the PM reads the grants of his project (RLS) and the panel keeps the REVOKED history of the participant', format($q$select (select count(*) from public.certificate_grants where node_id = '%s')::text || '/' || (select count(*) from public.certificate_grants where node_id = '%s' and revoked_at is not null)::text$q$, :'cn', :'cn'), '4/1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d423","role":"authenticated"}', true);
set local role authenticated;
select v42_test.val('G02 a founder of ANOTHER company reads 0 grants and 0 certificates', $q$select (select count(*) from public.certificate_grants)::text || '/' || (select count(*) from public.certificates)::text$q$, '0/0');
reset role;

-- ================================================================= rate limit of the verifier still holds (m38)
delete from app_private.certificate_verify_limits;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare i int; v_ok boolean := true; v_hint text; v_n int := 0;
begin
  begin
    for i in 1..45 loop
      perform public.get_public_certificate_verification('ZZZZ-ZZZZ-ZZZZ');
      v_n := i;
    end loop;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_ok := v_hint = 'certificate_rate_limited';
  end;
  perform v42_test.t('X01 the 41st lookup in the window is rate limited (hint certificate_rate_limited)', v_ok and v_n = 40, 'got ' || v_n || ' ok lookups, hint ' || coalesce(v_hint, '-'));
end $$;
reset role;
delete from app_private.certificate_verify_limits;

select current_setting('v42.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v42: person certificates RPC tests FAILED'; end $$;
\endif
