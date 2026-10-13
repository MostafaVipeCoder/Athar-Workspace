-- v38_certificates  (m38: Certificates node: template save, issuing rules, revocation, public verifier, founder access, template files)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin (PM), U2 = founder participant (attended), U3 = founder
-- without participation, U4 = founder participant who stays `accepted`.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v38.res', '', false) \gset

begin;
create schema v38_test;
grant usage on schema v38_test to public;
create or replace function v38_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v38.res', current_setting('v38.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v38_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v38_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v38_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v38_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v38_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v38_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v38_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v38_test.t(p_key, true, 'ok');
  exception when others then
    perform v38_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v38_test from public;
grant execute on all functions in schema v38_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v38_test.val('C01 m38 functions exist', $q$select (to_regprocedure('app_private.save_children_certificates(uuid,jsonb)') is not null and to_regprocedure('app_private.cert_issue_one(uuid,uuid,uuid,boolean)') is not null and to_regprocedure('app_private.cert_names(public.participants,text)') is not null and to_regprocedure('public.issue_certificates(uuid,uuid[])') is not null and to_regprocedure('public.get_certificates_admin(uuid)') is not null and to_regprocedure('public.list_my_certificates(uuid)') is not null and to_regprocedure('public.get_public_certificate_verification(text)') is not null and to_regprocedure('public.cert_template_readable(text)') is not null)::text$q$, 'true');
select v38_test.val('C02 every m38 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('save_children_certificates','cert_issue_one','cert_issue_checks','cert_names','cert_fields_json','cert_render_json','cert_verify_limit','cert_normalize_code','issue_certificates','get_certificates_admin','list_my_certificates','get_public_certificate_verification','cert_template_readable','verify_certificate','revoke_certificate','get_certificate_render_payload') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v38_test.val('C03 anon executes the verifier, verify_certificate and the storage wrapper only', $q$select (has_function_privilege('anon','public.get_public_certificate_verification(text)','EXECUTE') and has_function_privilege('anon','public.verify_certificate(text)','EXECUTE') and has_function_privilege('anon','public.cert_template_readable(text)','EXECUTE') and not has_function_privilege('anon','public.issue_certificates(uuid,uuid[])','EXECUTE') and not has_function_privilege('anon','public.get_certificates_admin(uuid)','EXECUTE') and not has_function_privilege('anon','public.list_my_certificates(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_certificate_render_payload(uuid)','EXECUTE') and not has_function_privilege('anon','public.revoke_certificate(uuid,text)','EXECUTE'))::text$q$, 'true');
select v38_test.val('C04 no API role executes a helper', $q$select (has_function_privilege('authenticated','app_private.save_children_certificates(uuid,jsonb)','EXECUTE') or has_function_privilege('authenticated','app_private.cert_issue_one(uuid,uuid,uuid,boolean)','EXECUTE') or has_function_privilege('authenticated','app_private.cert_names(public.participants,text)','EXECUTE') or has_function_privilege('anon','app_private.cert_render_json(public.certificates,boolean)','EXECUTE'))::text$q$, 'false');
select v38_test.val('C05 rate-limit table: RLS forced and no client grant', $q$select (select relforcerowsecurity from pg_class where oid = 'app_private.certificate_verify_limits'::regclass)::text || '/' || (has_table_privilege('anon','app_private.certificate_verify_limits','SELECT') or has_table_privilege('authenticated','app_private.certificate_verify_limits','INSERT'))::text$q$, 'true/false');
select v38_test.val('C06 code normalisation (case, dashes, Crockford look-alikes, junk)', $q$select coalesce(app_private.cert_normalize_code('abcd-efgh-jkmn'), '-') || ' ' || coalesce(app_private.cert_normalize_code('0O0O 1I1L 0000'), '-') || ' ' || coalesce(app_private.cert_normalize_code('ABCDEFGHJKMNP'), '-') || ' ' || coalesce(app_private.cert_normalize_code('ABCD-EFGH-IJKU'), '-') || ' ' || coalesce(app_private.cert_normalize_code(null), '-')$q$, 'ABCD-EFGH-JKMN 0000-1111-0000 - - -');
select v38_test.val('C07 one ACTIVE certificate per participant per node: partial unique index, the old full unique is gone', $q$select (exists (select 1 from pg_indexes where indexname = 'certificates_active_key' and indexdef like '%revoked_at IS NULL%') and not exists (select 1 from pg_constraint where conname = 'certificates_node_id_participant_id_key'))::text$q$, 'true');
select v38_test.val('C08 node type: save_children_fn and an optional participants port', $q$select (save_children_fn = 'save_children_certificates' and (ports->0->>'required') = 'false')::text from public.node_types where key = 'certificates'$q$, 'true');
select v38_test.val('C09 the template path CHECK exists', $q$select (exists (select 1 from pg_constraint where conname = 'certificate_templates_path_chk'))::text$q$, 'true');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000b0d8','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v38-admin@example.invalid','{"provisioned":true}','{"full_name":"V38 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000b0f8','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v38-founder2@example.invalid','{"provisioned":true}','{"full_name":"  أحمد   بن  علي  "}', now(), now()),
 ('00000000-0000-4000-8000-00000000b0f9','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v38-founder3@example.invalid','{"provisioned":true}','{"full_name":"V38 Outsider"}', now(), now()),
 ('00000000-0000-4000-8000-00000000b0fa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v38-founder4@example.invalid','{"provisioned":true}','{"full_name":"V38 Accepted Only"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000b0d8','super_admin'), ('00000000-0000-4000-8000-00000000b0f8','founder'),
  ('00000000-0000-4000-8000-00000000b0f9','founder'), ('00000000-0000-4000-8000-00000000b0fa','founder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V38 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V38 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.create_project(:'prog', 'V38 Other project', null, 'Asia/Riyadh')).id as proj2 \gset
select (public.add_node(:'proj', 'certificates', '{"en":"V38 Certificates","ar":"شهادات"}', 0, 0, '{}')).id as cn \gset
select (public.add_node(:'proj', 'certificates', '{"en":"V38 Empty certificates"}', 0, 100, '{}')).id as cn2 \gset
select (public.add_node(:'proj2', 'certificates', '{"en":"V38 Foreign certificates"}', 0, 0, '{}')).id as cnx \gset
reset role;
insert into storage.objects (bucket_id, name) values
  ('certificate-templates', :'proj' || '/' || :'cn' || '/t1.png'),
  ('certificate-templates', :'proj' || '/' || :'cn' || '/t2.png'),
  ('certificate-templates', :'proj' || '/' || :'cn2' || '/t1.png'),
  ('certificate-templates', :'proj2' || '/' || :'cnx' || '/t1.png');
insert into public.participants (project_id, user_id, source, status) values
  (:'proj', '00000000-0000-4000-8000-00000000b0f8', 'manual', 'accepted'),
  (:'proj', '00000000-0000-4000-8000-00000000b0fa', 'manual', 'accepted');
select id as p2 from public.participants where project_id = :'proj' and user_id = '00000000-0000-4000-8000-00000000b0f8' \gset
select id as p4 from public.participants where project_id = :'proj' and user_id = '00000000-0000-4000-8000-00000000b0fa' \gset

-- ================================================================= template save (one save_node, children)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'),
  '{"config":{"language":"en","verifier":{"enabled":true,"showCertificate":true}},"show_to_participants":false}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','participant_name','x',0.5,'y',0.46,'w',0.6,'align','center','font','Tajawal','size',0.045,'color','#1A1A2E','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',true),
      jsonb_build_object('var','program_name','x',0.5,'y',0.58,'w',0.7,'size',0.025),
      jsonb_build_object('var','completion_date','x',0.2,'y',0.84,'w',0.25,'size',0.02),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015,'font','Manrope','weight',500),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved \gset
reset role;
select v38_test.val('S01 the save wrote ONE template (v1, en) with 5 fields', format($q$select count(*)::text || '/' || max(version)::text || '/' || (select count(*) from public.certificate_template_fields where template_id in (select id from public.certificate_templates where node_id='%s'))::text from public.certificate_templates where node_id='%s'$q$, :'cn', :'cn'), '1/1/5');
select v38_test.val('S02 the colour is stored lower-case and the QR keeps w = size', format($q$select (select color from public.certificate_template_fields f join public.certificate_templates t on t.id=f.template_id where t.node_id='%s' and f.var='participant_name') || ' ' || (select (w = size)::text from public.certificate_template_fields f join public.certificate_templates t on t.id=f.template_id where t.node_id='%s' and f.var='verification_qr')$q$, :'cn', :'cn'), '#1a1a2e true');
select v38_test.val('S03 the node language and the verifier flags are in the config', format($q$select config->>'language' || ' ' || (config->'verifier'->>'showCertificate') from public.nodes where id='%s'$q$, :'cn'), 'en true');
select id as t1 from public.certificate_templates where node_id = :'cn' and version = 1 \gset

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'), '{}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','file_kind','image','width_px',3508,'height_px',2480,
    'fields', jsonb_build_array(
      jsonb_build_object('var','participant_name','x',0.5,'y',0.46,'w',0.6,'align','center','font','Tajawal','size',0.045,'color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',true),
      jsonb_build_object('var','program_name','x',0.5,'y',0.58,'w',0.7,'size',0.025,'align','center','font','Tajawal','color','#1a1a2e','weight',700,'direction','auto','max_lines',1,'shrink_to_fit',false),
      jsonb_build_object('var','completion_date','x',0.2,'y',0.84,'w',0.25,'size',0.02),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015,'font','Manrope','weight',500),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved \gset
reset role;
select v38_test.val('S04 an UNCHANGED template does not create a new version', format($q$select count(*)::text || '/' || max(version)::text from public.certificate_templates where node_id='%s'$q$, :'cn'), '1/1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'), '{}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t2.png','file_kind','image','width_px',2480,'height_px',3508,
    'fields', jsonb_build_array(
      jsonb_build_object('var','participant_name','x',0.5,'y',0.4,'w',0.7,'size',0.05),
      jsonb_build_object('var','program_name','x',0.5,'y',0.5,'w',0.7,'size',0.03),
      jsonb_build_object('var','completion_date','x',0.2,'y',0.84,'w',0.25,'size',0.02),
      jsonb_build_object('var','verification_code','x',0.82,'y',0.93,'w',0.2,'size',0.015),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved \gset
reset role;
select v38_test.val('S05 a changed template that nothing references is UPDATED IN PLACE (same id, new file, new fields)', format($q$select count(*)::text || '/' || max(version)::text || '/' || (id = '%s')::text || '/' || right(file_path, 6) || '/' || width_px::text || '/' || (select max(y)::text from public.certificate_template_fields where template_id = '%s' and var = 'participant_name') from public.certificate_templates where node_id='%s' group by id, file_path, width_px$q$, :'t1', :'t1', :'cn'), '1/1/true/t2.png/2480/0.40000');

-- ================================================================= template validation (as the PM)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, %%L::jsonb)$q$, :'cn', :'cn') as savesql \gset
select v38_test.fails('V01 an unknown variable is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[{"var":"email","x":0.5,"y":0.5,"w":0.5}]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V02 a variable placed twice is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[{"var":"participant_name","x":0.5,"y":0.5,"w":0.5},{"var":"participant_name","x":0.5,"y":0.6,"w":0.5}]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V03 a position outside 0..1 is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[{"var":"participant_name","x":1.5,"y":0.5,"w":0.5}]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V04 a font size above 0.2 is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[{"var":"participant_name","x":0.5,"y":0.5,"w":0.5,"size":0.5}]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V05 a bad colour is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[{"var":"participant_name","x":0.5,"y":0.5,"w":0.5,"color":"red"}]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V06 a font name with markup is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[{"var":"participant_name","x":0.5,"y":0.5,"w":0.5,"font":"x;}<b>"}]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V07 a file of ANOTHER project is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj2' || '/' || :'cnx' || '/t1.png','width_px',2000,'height_px',1400,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V08 a file of ANOTHER node of the same project is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn2' || '/t1.png','width_px',2000,'height_px',1400,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V09 a file that was never uploaded is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/ghost.png','width_px',2000,'height_px',1400,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V10 a PDF template is refused (images only in this build)', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','file_kind','pdf','width_px',2000,'height_px',1400,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V11 an unknown language is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','fr','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V12 a template size out of range is refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',100,'height_px',100,'fields','[]'::jsonb))), '22023', 'certificate_invalid');
select v38_test.fails('V13 more than 12 fields refused', format(:'savesql', jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t1.png','width_px',2000,'height_px',1400,'fields',(select jsonb_agg('{"var":"participant_name","x":0.5,"y":0.5,"w":0.5}'::jsonb) from generate_series(1,13))))), '22023', 'certificate_invalid');
select v38_test.val('V14 nothing of the refused saves persisted', format($q$select count(*)::text || '/' || (select count(*) from public.certificate_template_fields where template_id = '%s')::text from public.certificate_templates where node_id='%s'$q$, :'t1', :'cn'), '1/5');
select v38_test.okrun('V15 a save WITHOUT the template key leaves it alone', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{}'::jsonb)$q$, :'cn', :'cn'));
select v38_test.okrun('V16 a PM uploads a template under the node folder of their project', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('certificate-templates', %L, %L)$q$, :'proj' || '/' || :'cn' || '/t3.png', '00000000-0000-4000-8000-00000000b0d8'));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f9","role":"authenticated"}', true);
set local role authenticated;
select v38_test.fails('V17 a founder cannot upload a template (42501)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('certificate-templates', %L, %L)$q$, :'proj' || '/' || :'cn' || '/t9.png', '00000000-0000-4000-8000-00000000b0f9'), '42501');
select v38_test.fails('V18 a founder cannot save the node (forbidden)', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"template":{"language":"en"}}'::jsonb)$q$, :'cn', :'cn'), '42501');
select v38_test.fails('V19 nor read the Issue panel payload (forbidden)', format($q$select public.get_certificates_admin('%s')$q$, :'cn'), '42501');
select v38_test.fails('V20 nor issue (forbidden)', format($q$select public.issue_certificates('%s')$q$, :'cn'), '42501');
reset role;

-- ================================================================= issuing rules
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select public.set_participant_status(:'p2', 'attended');
select v38_test.fails('I01 issuing BEFORE the project is completed is rejected server-side (hint certificate_project_not_completed)', format($q$select public.issue_certificates('%s')$q$, :'cn'), '23514', 'certificate_project_not_completed');
select v38_test.fails('I02 the single-issue name too', format($q$select public.issue_certificate('%s', '%s')$q$, :'p2', :'cn'), '23514', 'certificate_project_not_completed');
select v38_test.val('I03 the Issue panel says: not completed, template present, 1 attended row, 1 other', format($q$select ((v->'project'->>'completed_at') is null)::text || '/' || (v->'template'->>'has_name_field') || '/' || jsonb_array_length(v->'rows')::text || '/' || (v->>'others') from (select public.get_certificates_admin('%s') v) x$q$, :'cn'), 'true/true/1/1');
select public.complete_project(:'proj');
select v38_test.fails('I04 a node without a template: certificate_template_missing', format($q$select public.issue_certificates('%s')$q$, :'cn2'), 'P0002', 'certificate_template_missing');
select public.issue_certificates(:'cn') as r1 \gset
select v38_test.val('I05 "all" issues ONLY the attended participant (accepted ones get nothing)', format($q$select '%s'::jsonb->>'issued' || '/' || ('%s'::jsonb->>'skipped') || '/' || jsonb_array_length('%s'::jsonb->'results')::text$q$, :'r1', :'r1', :'r1'), '1/0/1');
select v38_test.val('I06 exactly ONE certificate row exists, for the attended participant, none for the accepted one', format($q$select count(*)::text || '/' || count(*) filter (where participant_id = '%s')::text from public.certificates where node_id = '%s'$q$, :'p2', :'cn'), '1/1');
select public.issue_certificates(:'cn') as r2 \gset
select v38_test.val('I07 issuing again is IDEMPOTENT (existing, same code, still one row)', format($q$select ('%s'::jsonb->>'existing') || '/' || ('%s'::jsonb->>'issued') || '/' || (select count(*)::text from public.certificates where node_id = '%s') || '/' || (('%s'::jsonb->'results'->0->>'code') = ('%s'::jsonb->'results'->0->>'code'))::text$q$, :'r2', :'r2', :'cn', :'r1', :'r2'), '1/0/1/true');
select public.issue_certificates(:'cn', array[:'p4']::uuid[]) as r3 \gset
select v38_test.val('I08 a NON-attended participant selected by hand gets nothing (not_attended, no row)', format($q$select ('%s'::jsonb->'results'->0->>'status') || '/' || (select count(*)::text from public.certificates where participant_id = '%s')$q$, :'r3', :'p4'), 'not_attended/0');
select public.issue_certificates(:'cn', array['11111111-1111-4111-8111-111111111111']::uuid[]) as r3b \gset
select v38_test.val('I09 an unknown participant id answers not_found', format($q$select '%s'::jsonb->'results'->0->>'status'$q$, :'r3b'), 'not_found');
select v38_test.val('I10 the snapshot froze the name (whitespace collapsed, as stored), program, project and dates in the template language', format($q$select snapshot->>'participant_name' || '|' || (snapshot->>'program_name') || '|' || (snapshot->>'project_name') || '|' || (snapshot->>'completed_on') || '|' || (snapshot->>'language') || '|' || (snapshot->>'template_version') from public.certificates where participant_id = '%s'$q$, :'p2'), 'أحمد بن علي|V38 Program|V38 Project|' || (select (now() at time zone 'Asia/Riyadh')::date::text) || '|en|1');
select v38_test.val('I11 the code is 12 Crockford characters', format($q$select (code ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$')::text from public.certificates where participant_id = '%s'$q$, :'p2'), 'true');
select code as code1, id as cert1 from public.certificates where participant_id = :'p2' \gset
reset role;
-- a template without a participant name field cannot be used
update public.nodes set config = config || '{"language":"ar"}' where id = :'cn2';
insert into public.certificate_templates (project_id, node_id, version, language, file_path, file_kind, width_px, height_px) values (:'proj', :'cn2', 1, 'ar', :'proj' || '/' || :'cn2' || '/t1.png', 'image', 2000, 1400);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.fails('I12 a template with no participant name field: certificate_template_incomplete', format($q$select public.issue_certificates('%s')$q$, :'cn2'), '23514', 'certificate_template_incomplete');
select v38_test.val('I13 the Issue panel row: attended, certificate present, name as it will be printed', format($q$select (r->>'status') || '/' || (r->'certificate'->>'code' = '%s')::text || '/' || (r->>'name') from (select jsonb_array_elements(public.get_certificates_admin('%s')->'rows') r) x where (r->>'participant_id') = '%s'$q$, :'code1', :'cn', :'p2'), 'attended/true/أحمد بن علي');
reset role;

-- ================================================================= the public verifier
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v38_test.val('P01 anon: valid, name + program + dates, no ids', format($q$select (v->>'status') || '|' || (v->>'valid') || '|' || (v->>'participant_name') || '|' || (v->>'program_name') || '|' || (v->>'completed_on') || '|' || (not (v ? 'participant_id'))::text || '|' || (not (v ? 'node_id'))::text || '|' || (not (v ? 'certificate_id'))::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'valid|true|أحمد بن علي|V38 Program|' || (select (now() at time zone 'Asia/Riyadh')::date::text) || '|true|true|true');
select v38_test.val('P02 anon: a lower-case, dash-less code works too', format($q$select (public.get_public_certificate_verification('%s')->>'status')$q$, lower(replace(:'code1', '-', ''))), 'valid');
select v38_test.val('P03 anon: an unknown code is not_found (no detail)', $q$select (public.get_public_certificate_verification('ZZZZ-ZZZZ-ZZZZ'))::text$q$, '{"valid": false, "status": "not_found"}');
select v38_test.val('P04 anon: junk is not_found', $q$select (public.get_public_certificate_verification('hello world'))->>'status'$q$, 'not_found');
select v38_test.val('P05 anon: the render payload carries ONLY the values the template prints (no company_name, no project_name)', format($q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(v->'render'->'snapshot') k) from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'completed_on,participant_name,program_name');
select v38_test.val('P06 anon: the render payload carries the template path and the fields, but no participant / issuer ids', format($q$select (v->'render'->'template'->>'bucket') || '/' || jsonb_array_length(v->'render'->'fields')::text || '/' || (not (v->'render' ? 'id'))::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'certificate-templates/5/true');
select v38_test.val('P07 anon: the old verify_certificate name answers the same', format($q$select (public.verify_certificate('%s')->>'valid')$q$, :'code1'), 'true');
select v38_test.fails('P08 anon cannot read the certificates table (no grant)', $q$select count(*) from public.certificates$q$, '42501');
select v38_test.fails('P09 anon cannot read the templates table', $q$select count(*) from public.certificate_templates$q$, '42501');
select v38_test.val('P10 anon: the template FILE is readable while a valid certificate may show it', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t2.png'), '1');
select v38_test.val('P11 anon: a template with NO certificate is not readable', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn2' || '/t1.png'), '0');
select v38_test.val('P12 anon: another project''s file is not readable', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj2' || '/' || :'cnx' || '/t1.png'), '0');
reset role;
-- verifier switches
update public.nodes set config = jsonb_set(config, '{verifier,showCertificate}', 'false') where id = :'cn';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v38_test.val('P13 showCertificate off: still valid, NO render payload', format($q$select (v->>'status') || '/' || (v ? 'render')::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'valid/false');
select v38_test.val('P14 showCertificate off: the template file is no longer readable by anon', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t2.png'), '0');
reset role;
update public.nodes set config = jsonb_set(config, '{verifier,enabled}', 'false') where id = :'cn';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v38_test.val('P15 verifier disabled: not_found (no existence leak)', format($q$select public.get_public_certificate_verification('%s')->>'status'$q$, :'code1'), 'not_found');
reset role;
update public.nodes set config = jsonb_set(jsonb_set(config, '{verifier,enabled}', 'true'), '{verifier,showCertificate}', 'true') where id = :'cn';

-- ================================================================= the founder (owner)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('F01 owner: the table shows only their OWN certificate row', $q$select count(*)::text from public.certificates$q$, '1');
select v38_test.val('F02 owner: nothing to download while the node is not shown to participants', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
select v38_test.fails('F03 owner: the render payload is forbidden while the node is not shown to participants', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
update public.nodes set show_to_participants = true where id = :'cn';
-- the verifier switched off: only the owner reads the template (the owner rule)
update public.nodes set config = jsonb_set(jsonb_set(config, '{verifier,enabled}', 'false'), '{verifier,showCertificate}', 'false') where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('F04 owner: shown to participants + project completed -> 1 certificate with the printed facts', $q$select jsonb_array_length(public.list_my_certificates())::text || '/' || (public.list_my_certificates()->0->>'participant_name')$q$, '1/أحمد بن علي');
select v38_test.val('F05 owner: narrowing by project works (other project -> 0)', format($q$select jsonb_array_length(public.list_my_certificates('%s'))::text$q$, :'proj2'), '0');
select v38_test.val('F06 owner: the render payload carries the full snapshot, template and 5 fields', format($q$select (v->>'code' = '%s')::text || '/' || jsonb_array_length(v->'fields')::text || '/' || (v->'snapshot' ? 'company_name')::text from (select public.get_certificate_render_payload('%s') v) x$q$, :'code1', :'cert1'), 'true/5/true');
select v38_test.val('F07 owner: the template FILE is readable through the owner rule (verifier off)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t2.png'), '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f9","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('F08 outsider founder: sees no certificate row', $q$select count(*)::text from public.certificates$q$, '0');
select v38_test.val('F09 outsider founder: list_my_certificates is empty', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
select v38_test.fails('F10 outsider founder: another founder''s render payload is forbidden', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
select v38_test.val('F11 outsider founder: the template file is not readable', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t2.png'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0fa","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('F12 an accepted-only participant: nothing', $q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text$q$, '0/0');
reset role;
-- the project is re-opened: the owner can no longer download (issued certificates stay)
update public.projects set completed_at = null where id = :'proj';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('F13 re-opened project: the owner sees nothing to download', $q$select jsonb_array_length(public.list_my_certificates())::text$q$, '0');
select v38_test.val('F14 re-opened project: the template file is closed to the owner', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t2.png'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('F15 re-opened project: the PM still sees the issued row and the Issue panel says so', format($q$select ((v->'project'->>'completed_at') is null)::text || '/' || jsonb_array_length(v->'rows')::text from (select public.get_certificates_admin('%s') v) x$q$, :'cn'), 'true/1');
select v38_test.fails('F16 re-opened project: issuing is rejected again', format($q$select public.issue_certificates('%s')$q$, :'cn'), '23514', 'certificate_project_not_completed');
select public.complete_project(:'proj');
reset role;
update public.nodes set config = jsonb_set(jsonb_set(config, '{verifier,enabled}', 'true'), '{verifier,showCertificate}', 'true') where id = :'cn';

-- ================================================================= revocation (manual) and re-issue
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.fails('R00 a founder cannot revoke', format($q$select public.revoke_certificate('%s', 'x')$q$, :'cert1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.fails('R01 a reason over 500 characters is refused', format($q$select public.revoke_certificate('%s', repeat('a', 501))$q$, :'cert1'), '22023', 'certificate_invalid');
select public.revoke_certificate(:'cert1', '  duplicate record  ');
reset role;
select v38_test.val('R02 revoked: reason trimmed, who/when stored', format($q$select (revoked_at is not null)::text || '/' || revoked_reason || '/' || (revoked_by = '00000000-0000-4000-8000-00000000b0d8')::text from public.certificates where id = '%s'$q$, :'cert1'), 'true/duplicate record/true');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v38_test.val('R03 anon: the revoked certificate verifies as revoked, with name + program', format($q$select (v->>'status') || '/' || (v->>'valid') || '/' || (v->>'revoked') || '/' || (v->>'participant_name') || '/' || (v ? 'render')::text from (select public.get_public_certificate_verification('%s') v) x$q$, :'code1'), 'revoked/false/true/أحمد بن علي/false');
select v38_test.val('R04 anon: the template file closes (no valid certificate)', format($q$select count(*)::text from storage.objects where bucket_id = 'certificate-templates' and name = '%s'$q$, :'proj' || '/' || :'cn' || '/t2.png'), '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.val('R05 owner: a revoked certificate disappears (table, list)', $q$select (select count(*) from public.certificates)::text || '/' || jsonb_array_length(public.list_my_certificates())::text$q$, '0/0');
select v38_test.fails('R06 owner: the revoked render payload is forbidden', format($q$select public.get_certificate_render_payload('%s')$q$, :'cert1'), '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select public.issue_certificates(:'cn') as r4 \gset
select v38_test.val('R07 "issue to all attended" does NOT silently re-issue a revoked certificate (skipped_revoked, still 1 row)', format($q$select ('%s'::jsonb->'results'->0->>'status') || '/' || (select count(*)::text from public.certificates where node_id = '%s')$q$, :'r4', :'cn'), 'skipped_revoked/1');
select public.issue_certificates(:'cn', array[:'p2']::uuid[]) as r5 \gset
select v38_test.val('R08 selecting the participant on purpose re-issues: a NEW certificate with a NEW code, the old one stays revoked', format($q$select ('%s'::jsonb->'results'->0->>'status') || '/' || (select count(*)::text from public.certificates where node_id = '%s') || '/' || (select count(*)::text from public.certificates where node_id = '%s' and revoked_at is null) || '/' || (('%s'::jsonb->'results'->0->>'code') <> '%s')::text$q$, :'r5', :'cn', :'cn', :'r5', :'code1'), 'issued/2/1/true');
select v38_test.val('R09 the Issue panel shows the ACTIVE certificate of the participant', format($q$select (r->'certificate'->>'revoked_at' is null)::text || '/' || (r->'certificate'->>'code' <> '%s')::text from (select jsonb_array_elements(public.get_certificates_admin('%s')->'rows') r) x where (r->>'participant_id') = '%s'$q$, :'code1', :'cn', :'p2'), 'true/true');
select v38_test.val('R10 a certificate keeps its ORIGINAL template version after later template changes (immutable once referenced)', format($q$select count(*)::text from public.certificate_templates where node_id = '%s'$q$, :'cn'), '1');
select v38_test.fails('R11 the referenced template cannot be edited directly (23514)', format($q$update public.certificate_templates set width_px = 999 where node_id = '%s'$q$, :'cn'), '23514');
-- a template change AFTER issuing creates the next version (the issued certificates keep rendering from v1)
select public.save_node(:'cn', (select r.rev from public.node_revisions r where r.node_id = :'cn'), '{}'::jsonb,
  jsonb_build_object('template', jsonb_build_object('language','en','file_path', :'proj' || '/' || :'cn' || '/t2.png','file_kind','image','width_px',2480,'height_px',3508,
    'fields', jsonb_build_array(
      jsonb_build_object('var','participant_name','x',0.5,'y',0.35,'w',0.7,'size',0.05),
      jsonb_build_object('var','verification_qr','x',0.82,'y',0.8,'w',0.1,'size',0.1))))) as saved3 \gset
reset role;
select v38_test.val('R12 a change after issuing creates version 2 (version 1 and its 5 fields intact)', format($q$select count(*)::text || '/' || max(version)::text || '/' || (select count(*) from public.certificate_template_fields f where f.template_id = (select id from public.certificate_templates where node_id='%s' and version = 1))::text from public.certificate_templates where node_id='%s'$q$, :'cn', :'cn'), '2/2/5');
select v38_test.val('R13 the new language certificate uses the template version it was issued with (v1)', format($q$select (snapshot->>'template_version') || '/' || (select version::text from public.certificate_templates t where t.id = c.template_id) from public.certificates c where node_id = '%s' and revoked_at is null$q$, :'cn'), '1/1');

-- ================================================================= template files that issued certificates reference are protected
select v38_test.val('D01 a template image referenced by an issued certificate is NOT deletable (the storage delete / update policies ask)', format($q$select (select public.cert_template_deletable('%s'))::text$q$, :'proj' || '/' || :'cn' || '/t2.png'), 'false');
select v38_test.val('D02 an unreferenced file (abandoned draft) stays deletable', format($q$select (select public.cert_template_deletable('%s'))::text$q$, :'proj' || '/' || :'cn' || '/t3.png'), 'true');
select v38_test.val('D03 the delete / update policies carry the guard', $q$select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('certificate_templates_delete_pm', 'certificate_templates_update_pm') and qual like '%cert_template_deletable%'$q$, '2');
select v38_test.val('D04 anon cannot execute the guard (it is for the storage policy of signed-in PMs)', $q$select has_function_privilege('anon', 'public.cert_template_deletable(text)', 'EXECUTE')::text$q$, 'false');

-- ================================================================= the Arabic template language: names as stored in the template language
update public.nodes set config = jsonb_set(config, '{language}', '"ar"') where id = :'cn';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d8","role":"authenticated"}', true);
set local role authenticated;
select v38_test.fails('L01 no template for the NEW language: certificate_template_missing', format($q$select public.issue_certificates('%s')$q$, :'cn'), 'P0002', 'certificate_template_missing');
reset role;
update public.nodes set config = jsonb_set(config, '{language}', '"en"') where id = :'cn';

-- ================================================================= rate limit (last: it fills the caller bucket)
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
  perform v38_test.t('X01 the 41st lookup in the window is rate limited (hint certificate_rate_limited)', v_ok and v_n = 40, 'got ' || v_n || ' ok lookups, hint ' || coalesce(v_hint, '-'));
end $$;
reset role;
delete from app_private.certificate_verify_limits;

select current_setting('v38.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v38: certificates RPC tests FAILED'; end $$;
\endif
