-- v31_form  (m31: Form Builder RPCs)  Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v31.res', '', false) \gset

begin;
create schema v31_test;
grant usage on schema v31_test to public;
create or replace function v31_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v31.res', current_setting('v31.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v31_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v31_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v31_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v31_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v31_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v31_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v31_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v31_test.t(p_key, true, 'ok');
  exception when others then
    perform v31_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v31_test from public;
grant execute on all functions in schema v31_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v31_test.val('C01 m31 functions exist', $q$select (to_regprocedure('public.submit_public_form(text,jsonb,jsonb,text)') is not null and to_regprocedure('app_private.form_check_answers(uuid,jsonb)') is not null and to_regprocedure('app_private.form_upload_allowed(text)') is not null and to_regprocedure('public.restore_form_response(uuid)') is not null)::text$q$, 'true');
select v31_test.val('C02 m31 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('submit_public_form','form_check_answers','form_upload_allowed','restore_form_response','get_public_form','save_children_form_builder','form_phone_e164') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v31_test.val('C03 anon executes submit_public_form + get_public_form only', $q$select (has_function_privilege('anon','public.submit_public_form(text,jsonb,jsonb,text)','EXECUTE') and has_function_privilege('anon','public.get_public_form(text)','EXECUTE') and not has_function_privilege('anon','public.submit_form_response(text,jsonb,jsonb)','EXECUTE') and not has_function_privilege('anon','app_private.form_check_answers(uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.restore_form_response(uuid)','EXECUTE'))::text$q$, 'true');
select v31_test.val('C04 rate-limit table is closed to API roles', $q$select (has_table_privilege('anon','app_private.form_rate_limits','SELECT') or has_table_privilege('authenticated','app_private.form_rate_limits','SELECT'))::text$q$, 'false');
select v31_test.val('C05 upload policy exists for form-uploads inserts', $q$select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname='form_uploads_insert_public' and cmd='INSERT'$q$, '1');
select v31_test.val('C06 phone normaliser: Arabic digits + 00 prefix -> E.164', $q$select app_private.form_phone_e164('٠٠٢٠ ١٠١-٢٣٤ ٥٦٧٨')$q$, '+201012345678');
select v31_test.val('C07 phone normaliser rejects letters', $q$select coalesce(app_private.form_phone_e164('abc'), 'NULL')$q$, 'NULL');
select v31_test.val('C08 phone normaliser: national number takes the first allowed country', $q$select app_private.form_phone_e164('0512345678', array['SA'])$q$, '+966512345678');
select v31_test.val('C09 phone normaliser: +0... is not E.164', $q$select coalesce(app_private.form_phone_e164('+0123456789'), 'NULL')$q$, 'NULL');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000b0d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v31-admin@example.invalid','{"provisioned":true}','{"full_name":"V31 Admin"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000b0d1','super_admin');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d1","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V31 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V31 Project', null, 'Africa/Cairo')).id as proj \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V31 Apply"}', 0, 0, '{}')).id as frm \gset
select (public.add_node(:'proj', 'list', '{"en":"V31 Companies"}', 0, 0, '{"subkind":"company"}')).id as lst \gset
select (public.connect(:'proj', :'frm', 'responses', :'lst', 'items-in', '{}')).id as e1 \gset
select r.rev as rev0 from public.node_revisions r where r.node_id = :'frm' \gset
-- questions: a legacy-style key (q010) that will be re-keyed later, plus typed questions
select v31_test.okrun('S01 save_node writes sections + questions + form row', format($q$select public.save_node('%s', %s, '{"config":{"notify_pm":true,"thank_you":{"message":{"en":"Thanks {name}","ar":"شكراً"}}}}',
  '{"form":{"is_active":true,"one_response_per_email":true,"export_sheet_id":"sheet-abc"},
    "sections":[{"id":"00000000-0000-4000-8000-00000000b0a1","title_en":"Company","order_index":0}],
    "questions":[
      {"id":"00000000-0000-4000-8000-00000000b0e1","key":"company_name","type":"text","semantic":"company_name","label_en":"Company","is_required":true,"order_index":0,"section_id":"00000000-0000-4000-8000-00000000b0a1"},
      {"id":"00000000-0000-4000-8000-00000000b0e2","key":"q010","type":"email","label_en":"E-mail","is_required":true,"order_index":1},
      {"id":"00000000-0000-4000-8000-00000000b0e3","key":"mobile","type":"tel","label_en":"Phone","is_required":false,"order_index":2,"validation":{"allowed_countries":["EG"]}},
      {"id":"00000000-0000-4000-8000-00000000b0e4","key":"employees","type":"number","label_en":"Employees","order_index":3,"validation":{"min":1,"max":500}},
      {"id":"00000000-0000-4000-8000-00000000b0e5","key":"city","type":"select","label_en":"City","order_index":4,"options":[{"value":"Cairo","label_en":"Cairo"},{"value":"Other","label_en":"Other","is_other":true}]},
      {"id":"00000000-0000-4000-8000-00000000b0e6","key":"deck","type":"file","label_en":"Deck","order_index":5},
      {"id":"00000000-0000-4000-8000-00000000b0e7","key":"ref","type":"hidden","label_en":"ref","order_index":6}
    ]}')$q$, :'frm', :'rev0'));
select public.ensure_public_link(:'frm', 'form', null, null) as link \gset
reset role;
select s.slug as slug from public.public_link_slugs s where s.link_id = :'link' and s.is_current \gset
select v31_test.val('S02 7 questions stored', format($q$select count(*)::text from public.form_questions where node_id='%s'$q$, :'frm'), '7');

-- ================================================================= anonymous: private form is invisible
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v31_test.val('A01 anon: private form -> get_public_form null', format($q$select (public.get_public_form('%s') is null)::text$q$, :'slug'), 'true');
select v31_test.fails('A02 anon: private form -> submit refused (no leak: not found)', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"a@b.co"}', '{}', null)$q$, :'slug'), 'P0002', 'form_not_found');
reset role;
update public.nodes set visibility = 'public' where id = :'frm';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v31_test.val('A03 anon: public form served with questions + additive keys', format($q$select (jsonb_array_length(public.get_public_form('%s')->'questions') = 7 and (public.get_public_form('%s')->>'allow_uploads')::boolean and public.get_public_form('%s')->>'audience' = 'public' and (public.get_public_form('%s')->>'is_open')::boolean)::text$q$, :'slug', :'slug', :'slug', :'slug'), 'true');
select v31_test.val('A04 anon: honeypot filled -> accepted=false and nothing stored', format($q$select (public.submit_public_form('%s', '{"company_name":"Bot"}', '{}', 'http://spam')->>'accepted')$q$, :'slug'), 'false');
select v31_test.fails('A05 anon: unknown key refused', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"a@b.co","nope":"1"}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select v31_test.fails('A06 anon: missing required refused', format($q$select public.submit_public_form('%s', '{"company_name":"X"}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select v31_test.fails('A07 anon: bad e-mail refused', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"not-an-email"}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select v31_test.fails('A08 anon: bad phone refused', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"a@b.co","mobile":"12"}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select v31_test.fails('A09 anon: number above max refused', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"a@b.co","employees":"9999"}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select v31_test.fails('A10 anon: unknown select option refused (is_other allows free text only for the Other option... any text accepted when an is_other option exists)', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"a@b.co","city":["Cairo","Alex"]}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select v31_test.fails('A11 anon: file path outside the form folder refused', format($q$select public.submit_public_form('%s', '{"company_name":"X","q010":"a@b.co","deck":"other/path.pdf"}', '{}', null)$q$, :'slug'), '22023', 'form_invalid');
select public.submit_public_form(:'slug', '{"company_name":"  Nile Robotics ","q010":"Founder@Example.INVALID","mobile":"010 1234 5678","employees":"12","city":"Cairo","ref":"fb"}', '{"source":"facebook","utm_medium":"paid","junk":"x"}', null)->>'id' as resp \gset
select v31_test.val('A12 anon: valid submission accepted', format($q$select ('%s' <> '')::text$q$, :'resp'), 'true');
select v31_test.fails('A13 anon: same e-mail again refused (one_response_per_email)', format($q$select public.submit_public_form('%s', '{"company_name":"Dup","q010":"founder@example.invalid"}', '{}', null)$q$, :'slug'), '23505', 'form_duplicate');
reset role;
select v31_test.val('A14 answers sanitised: trimmed, e-mail lower, phone E.164, number numeric', format($q$select (answers->>'company_name') || ';' || (answers->>'q010') || ';' || (answers->>'mobile') || ';' || jsonb_typeof(answers->'employees') from public.form_responses where id='%s'$q$, :'resp'), 'Nile Robotics;founder@example.invalid;+201012345678;number');
select v31_test.val('A15 tracking whitelisted + source column', format($q$select source || ';' || (tracking->>'utm_medium') || ';' || coalesce(tracking->>'junk', '-') from public.form_responses where id='%s'$q$, :'resp'), 'facebook;paid;-');
select v31_test.val('A16 PM notification queued once per manager (outbox, no sender yet)', format($q$select count(*)::text from app_private.email_outbox where email_key='form_new_response' and node_id='%s' and status='queued' and sender_connection_id is null$q$, :'frm'), '1');
select v31_test.val('A17 Google Sheet append queued as an integration job', format($q$select count(*)::text from app_private.integration_jobs where kind='sheets_append' and form_response_id='%s' and payload->>'sheet_id'='sheet-abc'$q$, :'resp'), '1');
select v31_test.val('A18 form revision bumped by the insert (lists refresh)', format($q$select (r.rev > %s)::text from public.node_revisions r where r.node_id='%s'$q$, :'rev0', :'frm'), 'true');
select v31_test.val('A19 anon never has a session: submitted_by is null', format($q$select (submitted_by is null)::text from public.form_responses where id='%s'$q$, :'resp'), 'true');

-- ================================================================= rate limit and closed states
update app_private.form_rate_limits set hits = 20 where bucket = md5(:'frm' || '|unknown');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v31_test.fails('R01 anon: 21st submission in the window is rate limited', format($q$select public.submit_public_form('%s', '{"company_name":"Y","q010":"y@b.co"}', '{}', null)$q$, :'slug'), 'P0001', 'form_rate_limited');
reset role;
delete from app_private.form_rate_limits where bucket = md5(:'frm' || '|unknown');
update public.forms set closes_at = now() - interval '1 minute' where node_id = :'frm';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v31_test.val('R02 anon: closed form reports closed_reason', format($q$select public.get_public_form('%s')->>'closed_reason'$q$, :'slug'), 'closed');
select v31_test.fails('R03 anon: closed form refuses submissions server-side', format($q$select public.submit_public_form('%s', '{"company_name":"Z","q010":"z@b.co"}', '{}', null)$q$, :'slug'), 'P0001', 'form_closed');
reset role;
update public.forms set closes_at = null, max_responses = 1 where node_id = :'frm';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v31_test.fails('R04 anon: max_responses reached -> form_full', format($q$select public.submit_public_form('%s', '{"company_name":"Z","q010":"z@b.co"}', '{}', null)$q$, :'slug'), 'P0001', 'form_full');
reset role;
update public.forms set max_responses = null where node_id = :'frm';

-- ================================================================= uploads policy helper
select v31_test.val('U01 upload allowed under <project>/<form>/<uuid>.pdf while open + public + file question', format($q$select app_private.form_upload_allowed('%s/%s/00000000-0000-4000-8000-00000000b0c1.pdf')::text$q$, :'proj', :'frm'), 'true');
select v31_test.val('U02 upload refused with a bad extension', format($q$select app_private.form_upload_allowed('%s/%s/00000000-0000-4000-8000-00000000b0c1.exe')::text$q$, :'proj', :'frm'), 'false');
select v31_test.val('U03 upload refused outside the form folder', format($q$select app_private.form_upload_allowed('%s/other/x.pdf')::text$q$, :'proj'), 'false');
update public.nodes set visibility = 'private' where id = :'frm';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select v31_test.val('U04 anonymous caller (no uid) is refused when the form is private', format($q$select app_private.form_upload_allowed('%s/%s/00000000-0000-4000-8000-00000000b0c1.pdf')::text$q$, :'proj', :'frm'), 'false');
select set_config('request.jwt.claims', '', true);
update public.nodes set visibility = 'public' where id = :'frm';

-- ================================================================= list resolver sees the response through the semantic keys; key rename re-keys answers
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d1","role":"authenticated"}', true);
set local role authenticated;
select v31_test.val('L01 list resolver shows the response with company_name as title', format($q$select r->'display'->>'title_en' from public.resolve_list('%s') r limit 1$q$, :'lst'), 'Nile Robotics');
select v31_test.val('L02 before re-keying: no founder_email contact', format($q$select coalesce(r->'contact'->>'email', '-') from public.resolve_list('%s') r limit 1$q$, :'lst'), '-');
select r.rev as rev1 from public.node_revisions r where r.node_id = :'frm' \gset
select v31_test.okrun('L03 save_node assigns semantic founder_email to q010 (key changes)', format($q$select public.save_node('%s', %s, '{}',
  '{"questions":[
      {"id":"00000000-0000-4000-8000-00000000b0e1","key":"company_name","type":"text","semantic":"company_name","label_en":"Company","is_required":true,"order_index":0},
      {"id":"00000000-0000-4000-8000-00000000b0e2","key":"founder_email","type":"email","semantic":"founder_email","label_en":"E-mail","is_required":true,"order_index":1},
      {"id":"00000000-0000-4000-8000-00000000b0e3","key":"phone","type":"tel","semantic":"phone","label_en":"Phone","order_index":2}
    ]}')$q$, :'frm', :'rev1'));
select v31_test.val('L04 stored answers re-keyed (q010 -> founder_email, mobile -> phone)', format($q$select (answers - 'company_name' - 'employees' - 'city' - 'ref')::text from public.form_responses where id='%s'$q$, :'resp'), '{"phone": "+201012345678", "founder_email": "founder@example.invalid"}');
select v31_test.val('L05 list resolver now exposes the contact e-mail', format($q$select r->'contact'->>'email' from public.resolve_list('%s') r limit 1$q$, :'lst'), 'founder@example.invalid');
select v31_test.val('L06 questions not in the payload were deleted (3 left)', format($q$select count(*)::text from public.form_questions where node_id='%s'$q$, :'frm'), '3');
select v31_test.okrun('L07 PM soft-deletes a response (update under RLS)', format($q$update public.form_responses set deleted_at = now() where id='%s'$q$, :'resp'));
select v31_test.val('L08 soft-deleted response leaves the list', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'lst'), '0');
select v31_test.okrun('L09 restore_form_response undoes it', format($q$select public.restore_form_response('%s')$q$, :'resp'));
select v31_test.val('L10 response is back in the list', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'lst'), '1');
reset role;

select current_setting('v31.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v31: form RPC tests FAILED'; end $$;
\endif
