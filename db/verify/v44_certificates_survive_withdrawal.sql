-- v44_certificates_survive_withdrawal  (m44, owner decision 08 section 18.2: an ISSUED certificate stays valid and available after a withdrawal)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.
--
-- Fixture (all ids ...00000000d44x / c44x / f44x / a44x):
--   ADM = temporary super_admin (the PM)
--   company CO1 : founders F1 (Sara) + F2 (Omar), both with an ACCOUNT; participant A1 (company level). The PM issues to A1 -> F1 and F2 hold a certificate.
--   F5 joins CO1 AFTER the issue (a linked founder with NO certificate under an authorised participant: the "cannot claim while withdrawn" case)
--   company CO2 : founder F4; participant A2 (attended, NEVER issued to: the "withdrawn without a certificate" case)
--   F3 = outsider (founder of another company, not a participant)
-- Timeline: attended + issued -> WITHDRAWN (the PM mistake) -> reinstated -> accepted by mistake -> attended -> F5 claims -> withdrawn + revoke ONE ->
--           reinstated + re-issue -> withdrawn + revoke ALL; then the project / node gates that did NOT change.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v44.res', '', false) \gset

begin;
create schema v44_test;
grant usage on schema v44_test to public;
create or replace function v44_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v44.res', current_setting('v44.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v44_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v44_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v44_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v44_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v44_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v44_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v44_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v44_test.t(p_key, true, 'ok');
  exception when others then
    perform v44_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v44_test from public;
grant execute on all functions in schema v44_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v44_test.val('C01 the m44 helper exists, search_path = empty, and NO API role executes it', $q$select (to_regprocedure('app_private.my_certificate_count(uuid)') is not null
  and (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'app_private.my_certificate_count(uuid)'::regprocedure)
  and not has_function_privilege('anon', 'app_private.my_certificate_count(uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'app_private.my_certificate_count(uuid)', 'EXECUTE'))::text$q$, 'true');
select v44_test.val('C02 the read paths no longer look at the participant status (verifier, render payload, template rule, list, RLS policy)', $q$select (
  pg_get_functiondef('public.get_public_certificate_verification(text)'::regprocedure) not like '%vp.status%'
  and pg_get_functiondef('public.get_certificate_render_payload(uuid)'::regprocedure) not like '%pa.status%'
  and pg_get_functiondef('public.cert_template_readable(text)'::regprocedure) not like '%pa.status%'
  and pg_get_functiondef('public.list_my_certificates(uuid)'::regprocedure) not like '%where c.revoked_at is null and pa.status%'
  and (select qual from pg_policies where schemaname = 'public' and tablename = 'certificates' and policyname = 'certificates_select_pm_alumni_own') not like '%attended%')::text$q$, 'true');
select v44_test.val('C03 CREATING a certificate still needs an attended participant (claim loop of list_my_certificates, cert_claim, cert_issue_one, cert_issue_person, reissue_certificate)', $q$select (
  pg_get_functiondef('public.list_my_certificates(uuid)'::regprocedure) like '%join public.participants pa on pa.id = g.participant_id and pa.status = ''attended''%'
  and pg_get_functiondef('app_private.cert_claim(uuid,uuid)'::regprocedure) like '%pa.status = ''attended''%'
  and pg_get_functiondef('app_private.cert_issue_one(uuid,uuid,uuid,boolean)'::regprocedure) like '%pa.status <> ''attended''%'
  and pg_get_functiondef('app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)'::regprocedure) like '%pa.status is distinct from ''attended''%'
  and pg_get_functiondef('public.reissue_certificate(uuid)'::regprocedure) like '%certificate_not_attended%')::text$q$, 'true');
select v44_test.val('C04 the m43 guards are intact (render payload NULL guard, cert_is_member coalesce)', $q$select (pg_get_functiondef('public.get_certificate_render_payload(uuid)'::regprocedure) like '%not coalesce(v_own, false)%'
  and pg_get_functiondef('app_private.cert_is_member(participants,uuid)'::regprocedure) like '%coalesce(%')::text$q$, 'true');
select v44_test.val('C05 the verifier is still the ONLY anon-executable certificate RPC; the founder RPCs are not anon', $q$select (has_function_privilege('anon','public.get_public_certificate_verification(text)','EXECUTE')
  and not has_function_privilege('anon','public.list_my_certificates(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_certificate_render_payload(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_founder_program_page(uuid)','EXECUTE') and not has_function_privilege('anon','public.list_my_programs(boolean)','EXECUTE'))::text$q$, 'true');
select v44_test.val('C06 the migrated data is untouched (0 certificates, 0 grants in the MIGRATED projects: hermetic)', $q$select (select count(*) from public.certificates where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text || '/' || (select count(*) from public.certificate_grants where project_id in (select p0.id from public.projects p0 where p0.created_at < (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a')))::text$q$, '0/0');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000d440','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v44-admin@example.invalid','{"provisioned":true}','{"full_name":"V44 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d441','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v44-f1@example.invalid','{"provisioned":true}','{"full_name":"profile one"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d442','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v44-f2@example.invalid','{"provisioned":true}','{"full_name":"profile two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d443','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v44-f3@example.invalid','{"provisioned":true}','{"full_name":"V44 Outsider"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v44-f4@example.invalid','{"provisioned":true}','{"full_name":"V44 Never Issued"}', now(), now()),
 ('00000000-0000-4000-8000-00000000d445','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v44-f5@example.invalid','{"provisioned":true}','{"full_name":"V44 Late Joiner"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000d440','super_admin'), ('00000000-0000-4000-8000-00000000d441','founder'),
  ('00000000-0000-4000-8000-00000000d442','founder'), ('00000000-0000-4000-8000-00000000d443','founder'), ('00000000-0000-4000-8000-00000000d444','founder'),
  ('00000000-0000-4000-8000-00000000d445','founder');
insert into public.companies (id, name_en, name_ar) values
  ('00000000-0000-4000-8000-00000000c441', 'V44 Nile Labs', 'مختبرات النيل V44'),
  ('00000000-0000-4000-8000-00000000c442', 'V44 Second Co', null),
  ('00000000-0000-4000-8000-00000000c443', 'V44 Third Co', null);
insert into public.founders (id, name_en, name_ar, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f441', 'Sara Ali', 'سارة علي', '00000000-0000-4000-8000-00000000d441'),
  ('00000000-0000-4000-8000-00000000f442', 'Omar Zaki', 'عمر زكي', '00000000-0000-4000-8000-00000000d442'),
  ('00000000-0000-4000-8000-00000000f443', 'V44 Outsider Founder', 'غريب', '00000000-0000-4000-8000-00000000d443'),
  ('00000000-0000-4000-8000-00000000f444', 'Never Issued', 'لم تصدر', '00000000-0000-4000-8000-00000000d444'),
  ('00000000-0000-4000-8000-00000000f445', 'Hadi Late', 'هادي المتأخر', '00000000-0000-4000-8000-00000000d445');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c441', '00000000-0000-4000-8000-00000000f441', true),
  ('00000000-0000-4000-8000-00000000c441', '00000000-0000-4000-8000-00000000f442', false),
  ('00000000-0000-4000-8000-00000000c443', '00000000-0000-4000-8000-00000000f443', true),
  ('00000000-0000-4000-8000-00000000c442', '00000000-0000-4000-8000-00000000f444', true);
-- F5 joins CO1 LATER (below)

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V44 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V44 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.add_node(:'proj', 'certificates', '{"en":"V44 Certificates","ar":"شهادات"}', 0, 0, '{}')).id as cn \gset
reset role;
insert into storage.objects (bucket_id, name) values ('certificate-templates', :'proj' || '/' || :'cn' || '/t1.webp');
insert into public.participants (id, project_id, company_id, user_id, source, status) values
  ('00000000-0000-4000-8000-00000000a441', :'proj', '00000000-0000-4000-8000-00000000c441', null, 'manual', 'accepted'),
  ('00000000-0000-4000-8000-00000000a442', :'proj', '00000000-0000-4000-8000-00000000c442', null, 'manual', 'accepted');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'),
  '{"config":{"language":"en","verifier":{"enabled":true,"showCertificate":true}},"show_to_participants":true}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.webp','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','person_name','x',0.5,'y',0.46,'w',0.6,'align','center','font','Tajawal','size',0.045,'color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',true),
      jsonb_build_object('var','company_name','x',0.5,'y',0.54,'w',0.5,'size',0.028,'weight',500,'shrink_to_fit',true,'align','center','font','Tajawal','color','#1a1a2e','direction','auto','max_lines',1),
      jsonb_build_object('var','program_name','x',0.5,'y',0.62,'w',0.7,'size',0.025,'align','center','font','Tajawal','color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',false),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015,'font','Manrope','weight',500),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved \gset
select public.set_participant_status('00000000-0000-4000-8000-00000000a441', 'attended');
select public.set_participant_status('00000000-0000-4000-8000-00000000a442', 'attended');
select public.complete_project(:'proj');
-- the PM issues to A1 ONLY: F1 and F2 (linked accounts) get their own certificates; A2 is attended but never issued to
select public.issue_certificates(:'cn', array['00000000-0000-4000-8000-00000000a441']::uuid[]) as r1 \gset
reset role;
insert into public.company_founders (company_id, founder_id, is_primary) values ('00000000-0000-4000-8000-00000000c441', '00000000-0000-4000-8000-00000000f445', false);
select id as cert1, code as code1 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d441' \gset
select id as cert2, code as code2 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d442' \gset
select v44_test.val('S01 fixture: the PM issued to A1: F1 and F2 hold ONE active certificate each, F5 (joined later) and A2 hold none', $q$select (select count(*) from public.certificates where revoked_at is null)::text || '/' || (select count(*) from public.certificate_grants where revoked_at is null)::text$q$, '2/1');

-- ================================================================= BASELINE (attended): what a founder gets, to compare with after the withdrawal
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('B01 attended: the verifier says valid (with the certificate drawn: the render block)', format($q$select (v->>'status') || '/' || (v->>'valid') || '/' || (v ? 'render')::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'valid/true/true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('B02 attended: F1 lists 1 certificate, reads 1 row, renders it, and the program page carries the certificate block', format($q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text || '/' || (public.get_certificate_render_payload('%s')->>'code') || '/' || (select count(*) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate')::text$q$, :'cert1', :'proj'), '1/1/' || :'code1' || '/1');
reset role;

-- ================================================================= W. the PM marks A1 WITHDRAWN (the mistake): the certificates stay
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', true, 'marked by mistake') as wd \gset
reset role;
select v44_test.val('W00 the participant is withdrawn, its certificates and its grant are untouched (nothing revoked)', $q$select (select status from public.participants where id = '00000000-0000-4000-8000-00000000a441') || '/' || (select count(*) from public.certificates where revoked_at is null)::text || '/' || (select count(*) from public.certificate_grants where revoked_at is null)::text$q$, 'withdrawn/2/1');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('W01 anon verifier: F1''s code STAYS valid (valid=true, revoked=false) and still draws the certificate', format($q$select (v->>'status') || '/' || (v->>'valid') || '/' || (v->>'revoked') || '/' || (v ? 'render')::text || '/' || (v->>'person_name') || '/' || (v->>'company_name') from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'valid/true/false/true/Sara Ali/V44 Nile Labs');
select v44_test.val('W02 ... the co-founder''s code too, and the legacy verify_certificate alias agrees', format($q$select (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.verify_certificate('%s')->>'status')$q$, :'code2', :'code1'), 'valid/valid');
select v44_test.val('W03 anon: the template file is readable while a valid certificate may show it (verifier rule)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '1');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('W04 F1 (his participant is withdrawn): he still LISTS his certificate (person, company, code)', $q$select jsonb_array_length(c)::text || '/' || (c->0->>'person_name') || '/' || (c->0->>'company_name') from (select public.list_my_certificates() c) x$q$, '1/Sara Ali/V44 Nile Labs');
select v44_test.val('W05 ... reads his own certificate row (RLS)', $q$select count(*)::text from public.certificates$q$, '1');
select v44_test.val('W06 ... and RENDERS it (the payload carries the template, the fields and the snapshot)', format($q$select (p->>'code') || '/' || (p->'snapshot'->>'person_name') || '/' || jsonb_array_length(p->'fields')::text from (select public.get_certificate_render_payload('%s') p) x$q$, :'cert1'), :'code1' || '/Sara Ali/5');
select v44_test.val('W07 ... the withdrawn Program page is still the STATUS-ONLY page: restricted, status withdrawn, the names, no cover / dates / agenda', format($q$select (p->>'restricted') || '/' || (p->'participant'->>'status') || '/' || (p->'project'->>'name_en') || '/' || (p->'project' ? 'cover_path')::text || '/' || (p->'project' ? 'start_date')::text from (select public.get_founder_program_page('%s') p) x$q$, :'proj'), 'true/withdrawn/V44 Project/false/false');
select v44_test.val('W08 ... and its ONLY block is the certificate (one item, his own code)', format($q$select jsonb_array_length(p->'blocks')::text || '/' || (p->'blocks'->0->>'type') || '/' || jsonb_array_length(p->'blocks'->0->'data'->'items')::text || '/' || (p->'blocks'->0->'data'->'items'->0->>'code') from (select public.get_founder_program_page('%s') p) x$q$, :'proj'), '1/certificate/1/' || :'code1');
select v44_test.val('W09 ... the Programs list hides the program by default, and the withdrawn card says he keeps 1 certificate', format($q$select jsonb_array_length(public.list_my_programs(false))::text || '/' || (x->>'status') || '/' || (x->>'restricted') || '/' || (x->>'certificate_count') || '/' || (x ? 'cover_path')::text from jsonb_array_elements(public.list_my_programs(true)) x where x->>'project_id' = '%s'$q$, :'proj'), '0/withdrawn/true/1/false');
reset role;
-- the owner rule of the storage policy (verifier switched OFF so only the owner branch can open the file)
update public.nodes set config = config || '{"verifier":{"enabled":false,"showCertificate":false}}'::jsonb where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('W10 the template FILE is readable by its owner through the owner rule while his participant is withdrawn (verifier off)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d443","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('W11 an outsider founder still cannot read the file (verifier off)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '0');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('W12 anon cannot either (verifier off)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t1.webp'), '0');
reset role;
update public.nodes set config = config || '{"verifier":{"enabled":true,"showCertificate":true}}'::jsonb where id = :'cn';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d442","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('W13 the CO-FOUNDER F2 keeps his own certificate the same way (list, row, page block) and sees only his own', format($q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text || '/' || (public.list_my_certificates()->0->>'person_name') || '/' || (select count(*) from jsonb_array_elements(public.get_founder_program_page('%s')->'blocks') b where b->>'type' = 'certificate')::text$q$, :'proj'), '1/1/Omar Zaki/1');
select v44_test.fails('W14 ... and cannot render his co-founder''s certificate', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;

-- F5: linked to the company, NO certificate yet, the participant is authorised but withdrawn: nothing can be created
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d445","role":"authenticated"}', true);
set local role authenticated;
select v44_test.fails('W20 F5 (no certificate yet) CANNOT claim one while the participant is withdrawn (42501)', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
select v44_test.val('W21 ... his list is empty and the claim created nothing', $q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text$q$, '0/0');
select v44_test.val('W22 ... his withdrawn Program page has NO blocks and his card keeps 0 certificates', format($q$select jsonb_array_length(p->'blocks')::text || '/' || (select (x->>'certificate_count') from jsonb_array_elements(public.list_my_programs(true)) x where x->>'project_id' = '%s') from (select public.get_founder_program_page('%s') p) qq$q$, :'proj', :'proj'), '0/0');
reset role;
select v44_test.val('W23 as the owner: still exactly the 2 certificates (nothing was created behind the scenes)', $q$select count(*)::text from public.certificates$q$, '2');

-- an outsider reads nothing of it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d443","role":"authenticated"}', true);
set local role authenticated;
select v44_test.fails('W24 an outsider cannot render F1''s certificate (42501)', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
select v44_test.val('W25 ... reads no certificate row and lists none', $q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text$q$, '0/0');
select v44_test.fails('W26 ... and has no Program page of the project (forbidden: no hint that it exists)', format($q$select public.get_founder_program_page('%s')$q$, :'proj'), '42501');
reset role;

-- the PM: still sees and can render everything; the panel is honest about F5
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('W30 PM panel: the row is `withdrawn`; F1 and F2 `issued` (certificates kept), F5 `not_eligible` (not "claimable": nothing can be created now); claimable = 0', format($q$select (x->>'status') || '|' || (select string_agg(f->>'name' || '=' || (f->>'state'), ',' order by f->>'name') from jsonb_array_elements(x->'founders') f) || '|' || (x->'counts'->>'claimable') || '|' || (x->'counts'->>'issued') from jsonb_array_elements(public.get_certificates_admin('%s')->'rows') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a441'$q$, :'cn'), 'withdrawn|Hadi Late=not_eligible,Omar Zaki=issued,Sara Ali=issued|0|2');
select v44_test.val('W31 PM: still renders the certificate of a withdrawn participant', format($q$select (public.get_certificate_render_payload('%s')->>'code')$q$, :'cert1'), :'code1');
-- ISSUING stays gated: bulk and explicit issue skip / refuse a withdrawn participant
select public.issue_certificates(:'cn', array['00000000-0000-4000-8000-00000000a441']::uuid[]) as r2 \gset
select v44_test.val('W32 "Issue to selected" on the withdrawn participant: not_attended, skipped, nothing created', format($q$select (x->'results'->0->>'status') || '/' || (x->>'skipped') || '/' || (x->>'issued') from (select '%s'::jsonb x) qq$q$, :'r2'), 'not_attended/1/0');
select v44_test.fails('W33 the single-issue RPC is refused (certificate_not_attended)', format($q$select public.issue_certificate('00000000-0000-4000-8000-00000000a441', '%s')$q$, :'cn'), '23514', 'certificate_not_attended');
reset role;
select v44_test.val('W35 the refused issuing changed nothing: still 2 certificates / 1 grant', $q$select (select count(*) from public.certificates)::text || '/' || (select count(*) from public.certificate_grants)::text$q$, '2/1');

-- ================================================================= R. reinstated: the same (and F5 becomes claimable again, but does not claim yet)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', false) as rw \gset
select v44_test.val('R01 reinstated: the participant is attended again, F5 is `claimable` again', format($q$select (x->>'status') || '|' || (select f->>'state' from jsonb_array_elements(x->'founders') f where f->>'name' = 'Hadi Late') from jsonb_array_elements(public.get_certificates_admin('%s')->'rows') x where x->>'participant_id' = '00000000-0000-4000-8000-00000000a441'$q$, :'cn'), 'attended|claimable');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('R02 reinstated: the verifier is valid (it never changed)', format($q$select public.get_public_certificate_verification('%s')->>'status'$q$, :'code1'), 'valid');
reset role;

-- ================================================================= M. attended -> ACCEPTED by mistake: the certificates stay too
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.set_participant_status('00000000-0000-4000-8000-00000000a441', 'accepted');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('M01 un-marked as attended (accepted): the verifier STILL says valid', format($q$select (v->>'status') || '/' || (v->>'valid') || '/' || (v ? 'render')::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'valid/true/true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('M02 F1: still lists, reads and renders his certificate', format($q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text || '/' || (public.get_certificate_render_payload('%s')->>'code')$q$, :'cert1'), '1/1/' || :'code1');
select v44_test.val('M03 ... the Program page is the NORMAL page (not restricted, status accepted) and carries the certificate block', format($q$select (p->>'restricted') || '/' || (p->'participant'->>'status') || '/' || (select count(*) from jsonb_array_elements(p->'blocks') b where b->>'type' = 'certificate')::text from (select public.get_founder_program_page('%s') p) x$q$, :'proj'), 'false/accepted/1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d445","role":"authenticated"}', true);
set local role authenticated;
select v44_test.fails('M04 F5 (no certificate yet) CANNOT claim while the participant is only `accepted` (42501)', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
select v44_test.val('M05 ... nothing was created for him', $q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text$q$, '0/0');
reset role;

-- ================================================================= attended again: a NEW certificate is created by the claim exactly as before (creation is unchanged)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.set_participant_status('00000000-0000-4000-8000-00000000a441', 'attended');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d445","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('N01 F5 on an ATTENDED participant: opening his page / listing claims HIS own certificate (creation is unchanged)', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '1');
select v44_test.val('N02 ... it is his own row, created by the claim (a separate statement: the claim is volatile)', $q$select (select count(*) from public.certificates)::text || '/' || (select origin from public.certificates limit 1)$q$, '1/claim');
reset role;
select id as cert5, code as code5 from public.certificates where user_id = '00000000-0000-4000-8000-00000000d445' \gset

-- ================================================================= X. withdrawn again; the PM's MANUAL revoke still works (ONE person) and ends availability for that person only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', true, 'again') as wd2 \gset
select public.revoke_certificate(:'cert1', 'issued to the wrong person');
select v44_test.fails('X01 re-issuing F1 while the participant is withdrawn is refused with the CLEAR token (certificate_not_attended), not "no longer linked"', format($q$select public.reissue_certificate('%s')$q$, :'cert1'), '23514', 'certificate_not_attended');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('X02 anon: the REVOKED code reads revoked / false and no longer draws the certificate; F2 and F5 stay valid', format($q$select (a->>'status') || '/' || (a->>'valid') || '/' || (a ? 'render')::text || '|' || (b->>'status') || '|' || (c->>'status') from (select public.get_public_certificate_verification('%s') a, public.get_public_certificate_verification('%s') b, public.get_public_certificate_verification('%s') c) x$q$, :'code1', :'code2', :'code5'), 'revoked/false/false|valid|valid');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('X03 F1: the revoked certificate is gone from his list and his rows; the withdrawn page has no block and the card keeps 0', format($q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.get_founder_program_page('%s')->'blocks')::text || '/' || (select (x->>'certificate_count') from jsonb_array_elements(public.list_my_programs(true)) x where x->>'project_id' = '%s')$q$, :'proj', :'proj'), '0/0/0/0');
select v44_test.fails('X04 ... and he cannot render it any more (42501)', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d442","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('X05 the co-founder F2 (same withdrawn participant) still holds his own', $q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text$q$, '1/1');
reset role;

-- ================================================================= Y. reinstated: re-issuing the revoked certificate works again (creation needs attended)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', false) as rw2 \gset
select public.reissue_certificate(:'cert1') as rei \gset
reset role;
select code as code1b from public.certificates where user_id = '00000000-0000-4000-8000-00000000d441' and revoked_at is null \gset
select v44_test.val('Y01 reinstated + re-issue: F1 holds ONE active certificate again with a NEW code; the old one stays revoked', format($q$select (select count(*) from public.certificates where user_id = '00000000-0000-4000-8000-00000000d441' and revoked_at is null)::text || '/' || (select (code <> '%s')::text from public.certificates where user_id = '00000000-0000-4000-8000-00000000d441' and revoked_at is null) || '/' || (select count(*) from public.certificates where id = '%s' and revoked_at is not null)::text$q$, :'code1', :'cert1'), '1/true/1');

-- ================================================================= Z. participant-level REVOKE ("Revoke all") on a withdrawn participant ends everything of that participant
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', true, 'third time') as wd3 \gset
select public.revoke_participant_certificates(:'cn', '00000000-0000-4000-8000-00000000a441', 'cohort cancelled') as rall \gset
reset role;
select v44_test.val('Z01 revoke-all: the 3 active certificates and the grant are revoked', format($q$select ('%s'::jsonb->>'revoked') || '/' || ('%s'::jsonb->>'grant_revoked')$q$, :'rall', :'rall'), '3/true');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('Z02 anon: every code of that participant now reads revoked (F1''s re-issued code, F2, F5)', format($q$select (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.get_public_certificate_verification('%s')->>'status') || '/' || (public.get_public_certificate_verification('%s')->>'status')$q$, :'code1b', :'code2', :'code5'), 'revoked/revoked/revoked');
reset role;

-- ================================================================= S9. a withdrawn participant WITHOUT any certificate: nothing to keep, nothing to claim
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a442', true, 'left') as wd4 \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d444","role":"authenticated"}', true);
set local role authenticated;
select v44_test.fails('U01 F4 (A2 withdrawn, never issued): claim is forbidden (42501)', format($q$select public.claim_my_certificate('%s')$q$, :'cn'), '42501');
select v44_test.val('U02 ... he lists and reads nothing; his withdrawn page has no blocks; his card keeps 0 certificates', format($q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.get_founder_program_page('%s')->'blocks')::text || '/' || (select (x->>'certificate_count') from jsonb_array_elements(public.list_my_programs(true)) x where x->>'project_id' = '%s')$q$, :'proj', :'proj'), '0/0/0/0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn', array['00000000-0000-4000-8000-00000000a442']::uuid[]) as r4 \gset
reset role;
select v44_test.val('U03 the PM cannot issue to him either (not_attended); no certificate and no grant exists for A2', format($q$select (x->'results'->0->>'status') || '/' || (select count(*) from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a442')::text || '/' || (select count(*) from public.certificate_grants where participant_id = '00000000-0000-4000-8000-00000000a442')::text from (select '%s'::jsonb x) qq$q$, :'r4'), 'not_attended/0/0');

-- ================================================================= G. what did NOT change: the project and node gates of the founder side (the verifier never looked at them)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a442', false) as rw3 \gset
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', false) as rw4 \gset
select public.issue_certificates(:'cn', array['00000000-0000-4000-8000-00000000a441']::uuid[]) as r5 \gset
reset role;
select v44_test.val('G00 fixture: A1 re-authorised -> F1 F2 F5 hold new active certificates (3)', $q$select count(*)::text from public.certificates where revoked_at is null$q$, '3');
select code as code1c from public.certificates where user_id = '00000000-0000-4000-8000-00000000d441' and revoked_at is null \gset
update public.projects set completed_at = null where id = :'proj';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('G01 a RE-OPENED project still hides the certificate from the founder (unchanged: PM exposure state, not the participant status)', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v44_test.val('G02 ... but the verifier never looked at completion: valid', format($q$select public.get_public_certificate_verification('%s')->>'status'$q$, :'code1c'), 'valid');
reset role;
update public.projects set completed_at = now() where id = :'proj';
update public.nodes set show_to_participants = false where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('G03 a node NOT shown to participants hides the certificate from the founder (unchanged)', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
reset role;
update public.nodes set show_to_participants = true where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d441","role":"authenticated"}', true);
set local role authenticated;
select v44_test.val('G04 both switches back on: it is listed again', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '1');
reset role;

-- ================================================================= H. "Issue to all attended" leaves a WITHDRAWN participant out (A2 is attended and is authorised)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d440","role":"authenticated"}', true);
set local role authenticated;
select public.withdraw_participant('00000000-0000-4000-8000-00000000a441', true, 'fourth time') as wd5 \gset
select public.issue_certificates(:'cn') as r6 \gset
reset role;
select v44_test.val('H01 the bulk action works on the attended A2 only (authorised 1, F4 gets 1 certificate) and has NO row for the withdrawn A1', format($q$select (x->>'authorised') || '/' || (x->>'issued') || '/' || (select count(*) from jsonb_array_elements(x->'results') r where r->>'participant_id' = '00000000-0000-4000-8000-00000000a441')::text from (select '%s'::jsonb x) qq$q$, :'r6'), '1/1/0');
select v44_test.val('H02 A1''s three certificates are untouched by the withdrawal and by the bulk run (still active)', $q$select count(*)::text from public.certificates where participant_id = '00000000-0000-4000-8000-00000000a441' and revoked_at is null$q$, '3');

-- ================================================================= final state check
select current_setting('v44.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v44: certificates-survive-withdrawal tests FAILED'; end $$;
\endif
