-- v33_selection  (m33: Selection node + participants RPCs)  Role-switch tests inside ONE transaction that is ROLLED BACK.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v33.res', '', false) \gset

begin;
create schema v33_test;
grant usage on schema v33_test to public;
create or replace function v33_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v33.res', current_setting('v33.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v33_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v33_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v33_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v33_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare h text;
begin
  begin
    execute p_sql;
    perform v33_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    perform v33_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or h = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(h, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v33_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v33_test.t(p_key, true, 'ok');
  exception when others then
    perform v33_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v33_test from public;
grant execute on all functions in schema v33_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v33_test.val('C01 m33 functions and table exist', $q$select (to_regprocedure('public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)') is not null and to_regprocedure('public.get_selection_extras(uuid)') is not null and to_regprocedure('public.set_selection_score(uuid,int,text)') is not null and to_regprocedure('public.ensure_participant(uuid,uuid,uuid,uuid)') is not null and to_regclass('public.selection_scores') is not null)::text$q$, 'true');
select v33_test.val('C02 m33 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('send_selection_emails','get_selection_extras','set_selection_score','ensure_participant','list_participants','enroll_accepted','selection_port_statuses','selection_enrolls','first_name','render_email_template','selection_booking_node','resolve_list_rows') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v33_test.val('C03 anon cannot execute the RPCs nor read scores', $q$select (has_function_privilege('anon','public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)','EXECUTE') or has_function_privilege('anon','public.set_selection_score(uuid,int,text)','EXECUTE') or has_function_privilege('anon','public.get_selection_extras(uuid)','EXECUTE') or has_function_privilege('anon','public.ensure_participant(uuid,uuid,uuid,uuid)','EXECUTE') or has_table_privilege('anon','public.selection_scores','SELECT'))::text$q$, 'false');
select v33_test.val('C04 selection_scores RLS enabled + forced, no client write', $q$select (c.relrowsecurity and c.relforcerowsecurity and not has_table_privilege('authenticated','public.selection_scores','INSERT') and not has_table_privilege('authenticated','public.selection_scores','UPDATE'))::text from pg_class c where c.oid = 'public.selection_scores'::regclass$q$, 'true');
select v33_test.val('C05 port statuses: approved = passing of the config', $q$select array_to_string(app_private.selection_port_statuses('{"stages":[{"key":"accepted","type":"accept"},{"key":"shortlist","type":"accept"},{"key":"no","type":"reject"},{"key":"wait","type":"hold"}],"passing":["accepted","shortlist"]}'::jsonb,'approved'), ',')$q$, 'accepted,shortlist');
select v33_test.val('C06 port statuses: rejected/holding by stage type, fallback to the port key', $q$select array_to_string(app_private.selection_port_statuses('{"stages":[{"key":"no","type":"reject"},{"key":"wait","type":"hold"}]}'::jsonb,'rejected'), ',') || '/' || array_to_string(app_private.selection_port_statuses('{"stages":[{"key":"no","type":"reject"},{"key":"wait","type":"hold"}]}'::jsonb,'holding'), ',') || '/' || array_to_string(app_private.selection_port_statuses('{}'::jsonb,'interview'), ',')$q$, 'no/wait/interview');
select v33_test.val('C07 first_name rule (07-5)', $q$select app_private.first_name('Dr. Abdel Rahman Ali') || '|' || app_private.first_name('عبد الله محمد') || '|' || app_private.first_name('Mona Fathy') || '|' || app_private.first_name('')$q$, 'Abdel Rahman|عبد الله|Mona|');
select v33_test.val('C08 renderer escapes values, converts plain text to <br>, drops unknown tokens', $q$select app_private.render_email_template(E'Hi {{first_name}} {company_name}\n{{nope}}', '{"first_name":"A<b>","company_name":"C&D"}'::jsonb, true)$q$, 'Hi A&lt;b&gt; C&amp;D<br>');
select v33_test.val('C09 renderer keeps subjects plain', $q$select app_private.render_email_template('Re: {{company_name}}', '{"company_name":"C&D"}'::jsonb, false)$q$, 'Re: C&D');

-- ================================================================= setup (as postgres + U1)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000a0d3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v33-admin@example.invalid','{"provisioned":true}','{"full_name":"V33 Admin"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000a0d3','super_admin');
update public.profiles set full_name = 'Mona Reviewer' where id = '00000000-0000-4000-8000-00000000a0d3';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V33 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V33 Project', null, 'Africa/Cairo')).id as proj \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V33 Form"}', 0, 0, '{}')).id as frm \gset
select (public.add_node(:'proj', 'selection', '{"en":"Stage 1"}', 0, 0, '{}')).id as s1 \gset
select (public.add_node(:'proj', 'selection', '{"en":"Stage 2"}', 0, 0, '{}')).id as s2 \gset
select (public.add_node(:'proj', 'list', '{"en":"Rejected archive"}', 0, 0, '{"subkind":"company"}')).id as lst \gset
select (public.add_node(:'proj', 'booking', '{"en":"Interviews"}', 0, 0, '{"mode":"interview"}')).id as bk \gset
select (public.connect(:'proj', :'frm', 'responses', :'s1', 'applicants', '{}')).id as e1 \gset
select (public.connect(:'proj', :'s1', 'approved', :'s2', 'applicants', '{}')).id as e2 \gset
select (public.connect(:'proj', :'s1', 'rejected', :'lst', 'items-in', '{}')).id as e3 \gset
select (public.connect(:'proj', :'s1', 'interview', :'bk', 'bookers', '{}')).id as e4 \gset
reset role;
update public.nodes set config = '{"stages":[{"key":"screening","type":"inbox"},{"key":"interview","type":"stage","email":"interview"},{"key":"holding","type":"hold"},{"key":"accepted","type":"accept","email":"acceptance"},{"key":"rejected","type":"reject","email":"rejection"}],"passing":["accepted"],
  "emails":{"interview":{"subject":"Interview: {{company_name}}","body_html":"Dear {{first_name}},\nBook here: {{booking_link}}\nFrom {{project_manager_name}} / {{program_name}}","cc":["cc@example.invalid"],"admin":["admin@example.invalid"]},
            "acceptance":{"subject":"Welcome {{company_name}}","body_html":"<p>Dear {{founder_name}}</p>","subject_ar":"مرحباً {{company_name}}","body_html_ar":"<p>عزيزي {{founder_name}}</p>"}}}'::jsonb
 where id = :'s1';
update public.nodes set config = '{"stages":[{"key":"screening","type":"inbox"},{"key":"accepted","type":"accept"},{"key":"rejected","type":"reject"}],"passing":["accepted"]}'::jsonb where id = :'s2';
insert into public.form_responses (id, project_id, node_id, answers) values
 ('00000000-0000-4000-8000-00000000a3f1', :'proj', :'frm', '{"company_name":"Resp Co","founder_name":"Abdel Rahman Ali","founder_email":"F1@example.invalid"}'),
 ('00000000-0000-4000-8000-00000000a3f2', :'proj', :'frm', '{"company_name":"Second Co","founder_name":"Mona","founder_email":"f2@example.invalid"}'),
 ('00000000-0000-4000-8000-00000000a3f3', :'proj', :'frm', '{"company_name":"No Mail Co"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;

-- ================================================================= chain: Stage 1 approved -> Stage 2 applicants (02 §7.2, 01-16)
select v33_test.val('B01 stage 1 sees the 3 responses (virtual)', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'s1'), '3');
select v33_test.val('B02 stage 2 sees nothing before a decision', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'s2'), '0');
select public.ensure_item(:'s1', 'form_response', '00000000-0000-4000-8000-00000000a3f1') as i1 \gset
select public.ensure_item(:'s1', 'form_response', '00000000-0000-4000-8000-00000000a3f2') as i2 \gset
select public.ensure_item(:'s1', 'form_response', '00000000-0000-4000-8000-00000000a3f3') as i3 \gset
select v33_test.okrun('B03 set_item_status accepted (configured stage)', format($q$select public.set_item_status('%s', 'accepted', 'strong team')$q$, :'i1'));
select v33_test.fails('B04 set_item_status refuses a status outside the stage vocabulary', format($q$select public.set_item_status('%s', 'approved')$q$, :'i2'), '22023');
select v33_test.val('B05 stage 2 sees exactly the accepted applicant, referencing the ORIGINAL response', format($q$select (count(*) = 1 and bool_and(r->'source'->>'id' = '00000000-0000-4000-8000-00000000a3f1' and r->'source'->>'kind' = 'form_response' and r->>'item_id' is null))::text from public.resolve_list('%s') r$q$, :'s2'), 'true');
select public.ensure_item(:'s2', 'form_response', '00000000-0000-4000-8000-00000000a3f1') as j1 \gset
select v33_test.okrun('B06 stage 2 overlay row created lazily for the chained item', format($q$select public.patch_item_overlay('%s', '{"notes":"stage 2 note"}')$q$, :'j1'));
select v33_test.okrun('B07 stage 1 moves the applicant to holding (origin recorded)', format($q$select public.set_item_status('%s', 'holding', 'wait list')$q$, :'i1'));
select v33_test.val('B08 holding -> origin_stage = accepted', format($q$select origin_stage from public.selection_reviews where item_id = '%s'$q$, :'i1'), 'accepted');
select v33_test.val('B09 membership is live: stage 2 pool is empty while on hold', format($q$select count(*)::text from public.resolve_list('%s')$q$, :'s2'), '0');
select v33_test.okrun('B10 back to accepted', format($q$select public.set_item_status('%s', 'accepted')$q$, :'i1'));
select v33_test.val('B11 stage 2 row kept (same item id, note intact)', format($q$select (r->>'item_id' = '%s' and r->'overlay'->>'notes' = 'stage 2 note')::text from public.resolve_list('%s') r$q$, :'j1', :'s2'), 'true');
select v33_test.okrun('B12 reject the second applicant', format($q$select public.set_item_status('%s', 'rejected', 'out of scope')$q$, :'i2'));
select v33_test.val('B13 the list fed by the rejected port sees only the rejected one', format($q$select string_agg(r->'display'->>'title_en', ',') from public.resolve_list('%s') r$q$, :'lst'), 'Second Co');
select v33_test.val('B14 the booking fed by the interview port (edge) is the stage booking node', format($q$select (public.get_selection_extras('%s')->'booking'->>'node_id')$q$, :'s1'), :'bk');

-- ================================================================= scores (per reviewer)
select v33_test.okrun('S01 set own score + note', format($q$select public.set_selection_score('%s', 4, 'good')$q$, :'i1'));
select v33_test.val('S02 score visible with the reviewer name', format($q$select (s->>'score') || '/' || (s->>'reviewer_name') from jsonb_array_elements(public.get_selection_extras('%s')->'scores') s$q$, :'s1'), '4/Mona Reviewer');
select v33_test.fails('S03 score out of range', format($q$select public.set_selection_score('%s', 9, null)$q$, :'i1'), '22023');
select public.add_manual_item(:'lst', '{"title_en":"Manual Co"}') as man \gset
select v33_test.fails('S04 scores belong to selection stages only', format($q$select public.set_selection_score('%s', 3, null)$q$, :'man'), '22023');
select v33_test.okrun('S05 null/null removes the own score', format($q$select public.set_selection_score('%s', null, null)$q$, :'i1'));
select v33_test.val('S06 no scores left', format($q$select jsonb_array_length(public.get_selection_extras('%s')->'scores')::text$q$, :'s1'), '0');
select v33_test.val('S07 reviews carry reason + reviewer', format($q$select (r->>'reason') || '/' || (r->>'reviewer_name') from jsonb_array_elements(public.get_selection_extras('%s')->'reviews') r where r->>'item_id' = '%s'$q$, :'s1', :'i2'), 'out of scope/Mona Reviewer');

-- ================================================================= participants (02 §7.3 gated on the stage toggle)
select v33_test.val('P01 no virtual participant while no stage enrolls', format($q$select count(*)::text from public.list_participants('%s')$q$, :'proj'), '0');
select v33_test.fails('P02 enroll_accepted refuses a non-enrolling stage', format($q$select public.enroll_accepted('%s', '%s')$q$, :'proj', :'s1'), '22023', 'selection_not_enrolling');
reset role;
update public.nodes set config = config || '{"participantRule":{"onAccept":"create_participant"}}'::jsonb where id = :'s1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select v33_test.val('P03 the accepted applicant is an eligible (virtual) participant with its stage id', format($q$select (p->>'virtual') || '/' || (p->>'status') || '/' || (p->>'source_node_id') || '/' || (p->>'email') from public.list_participants('%s') p$q$, :'proj'), 'true/accepted/' || :'s1' || '/F1@example.invalid');
select public.ensure_participant(:'proj', :'s1', null, '00000000-0000-4000-8000-00000000a3f1') as pa1 \gset
select v33_test.val('P04 ensure_participant materialised ONE row (source selection)', format($q$select (p->>'virtual') || '/' || (p->>'source') || '/' || (p->>'participant_id') from public.list_participants('%s') p$q$, :'proj'), 'false/selection/' || :'pa1');
select v33_test.val('P05 ensure_participant is idempotent', format($q$select public.ensure_participant('%s', '%s', null, '00000000-0000-4000-8000-00000000a3f1')::text$q$, :'proj', :'s1'), :'pa1');
select v33_test.fails('P06 a rejected applicant cannot be enrolled', format($q$select public.ensure_participant('%s', '%s', null, '00000000-0000-4000-8000-00000000a3f2')$q$, :'proj', :'s1'), '22023');
select v33_test.val('P07 mark_all_attended then unmark one (01-6)', format($q$select public.mark_all_attended('%s')::text$q$, :'proj'), '1');
select v33_test.okrun('P08 set_participant_status accepted (absentee unmarked)', format($q$select public.set_participant_status('%s', 'accepted')$q$, :'pa1'));
select v33_test.val('P09 extras list the participant status for the stage item', format($q$select (p->>'status') from jsonb_array_elements(public.get_selection_extras('%s')->'participants') p$q$, :'s1'), 'accepted');
select v33_test.okrun('P10 reverting the acceptance flags the participant (02-7)', format($q$select public.set_item_status('%s', 'holding')$q$, :'i1'));
select v33_test.val('P11 needs_review = true, row kept', format($q$select (p->>'needs_review') from public.list_participants('%s') p where p->>'participant_id' = '%s'$q$, :'proj', :'pa1'), 'true');
select v33_test.okrun('P12 back to accepted', format($q$select public.set_item_status('%s', 'accepted')$q$, :'i1'));
select v33_test.val('P13 enroll_accepted counts 0 (already enrolled)', format($q$select public.enroll_accepted('%s', '%s')::text$q$, :'proj', :'s1'), '0');

-- ================================================================= e-mails (07 §1.5/1.6, 01-12, 01-15, 07-12)
select v33_test.fails('E01 interview template needs a base URL for the booking link', format($q$select * from public.send_selection_emails('%s', 'interview', array['%s'::uuid], 'en', null)$q$, :'s1', :'i1'), '22023', 'selection_bad_base_url');
select v33_test.fails('E02 unknown e-mail key', format($q$select * from public.send_selection_emails('%s', 'welcome', array['%s'::uuid])$q$, :'s1', :'i1'), '22023');
select v33_test.val('E03 rejection without an override uses the node-type default template', format($q$select r.status from public.send_selection_emails('%s', 'rejection', array['%s'::uuid]) r$q$, :'s1', :'i2'), 'queued');
reset role;
select v33_test.val('E03b default subject rendered, body with the program name', format($q$select (o.subject = 'Thank You for Your Application' and o.body_html like 'Dear Mona,<br><br>Thank you for your application to V33 Program.%%')::text from app_private.email_outbox o where o.node_id = '%s' and o.email_key = 'rejection'$q$, :'s1'), 'true');
update public.nodes set config = jsonb_set(config, '{emails,rejection}', '{"enabled": false}'::jsonb) where id = :'s1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select v33_test.fails('E03c a disabled e-mail cannot be sent', format($q$select * from public.send_selection_emails('%s', 'rejection', array['%s'::uuid], 'en', null, true)$q$, :'s1', :'i2'), '22023', 'selection_no_template');
select v33_test.fails('E04 more than 100 recipients need confirmation', format($q$select * from public.send_selection_emails('%s', 'acceptance', array_fill('%s'::uuid, array[101]))$q$, :'s1', :'i1'), '22023', 'selection_confirm_required');
select v33_test.val('E05 interview e-mail queued with a tokenised booking link', format($q$select string_agg(r.status, ',' order by r.status) from public.send_selection_emails('%s', 'interview', array['%s'::uuid, '%s'::uuid], 'en', 'https://app.example.invalid/', false, false) r$q$, :'s1', :'i1', :'i3'), 'no_recipient,queued');
reset role;
select v33_test.val('E06 outbox row: recipient lower-cased, subject + body rendered, cc merged, no sender yet', format($q$select (o.recipient_email::text = 'f1@example.invalid' and o.subject = 'Interview: Resp Co' and o.body_html like 'Dear Abdel Rahman,<br>Book here: <a href="https://app.example.invalid/book/%%?invite=%%">%%' and o.body_html like '%%From Mona Reviewer / V33 Program' and o.cc = array['admin@example.invalid','cc@example.invalid'] and o.sender_connection_id is null and o.status = 'queued' and o.created_by = '00000000-0000-4000-8000-00000000a0d3')::text from app_private.email_outbox o where o.node_id = '%s' and o.list_item_id = '%s'$q$, :'s1', :'i1'), 'true');
select v33_test.val('E07 booking invitation stored hashed for the item (01-15)', format($q$select (count(*) = 1 and bool_and(length(token_hash) = 64 and revoked_at is null and expires_at > now()))::text from public.booking_invitations where node_id = '%s' and booker_item_id = '%s'$q$, :'bk', :'i1'), 'true');
select v33_test.val('E08 booking public link created lazily', format($q$select count(*)::text from public.public_links where node_id = '%s' and kind = 'booking'$q$, :'bk'), '1');
select v33_test.val('E09 audit record in email_log (rejection + interview)', format($q$select count(*)::text from app_private.email_log l join app_private.email_outbox o on o.id = l.outbox_id where o.node_id = '%s' and l.event = 'queued'$q$, :'s1'), '2');
select v33_test.val('E10 the invitation token in the link validates the booking page', format($q$select (public.get_public_booking_page((select s.slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id where l.node_id = '%s' and l.kind = 'booking'), null, substring(o.body_html from 'invite=([A-Za-z0-9_-]+)'))->>'status') from app_private.email_outbox o where o.node_id = '%s' and o.list_item_id = '%s'$q$, :'bk', :'s1', :'i1'), 'open');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select v33_test.val('E11 sending again skips the already-sent item', format($q$select r.status from public.send_selection_emails('%s', 'interview', array['%s'::uuid], 'en', 'https://app.example.invalid') r$q$, :'s1', :'i1'), 'already_sent');
reset role;
update app_private.email_outbox set created_at = created_at - interval '2 minutes' where node_id = :'s1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select v33_test.val('E12 resend queues a new round with a new token', format($q$select r.status from public.send_selection_emails('%s', 'interview', array['%s'::uuid], 'en', 'https://app.example.invalid', true) r$q$, :'s1', :'i1'), 'queued');
reset role;
select v33_test.val('E13 two interview rows for the item, distinct idempotency keys, old invitation revoked', format($q$select (select count(*) from app_private.email_outbox where node_id = '%s' and list_item_id = '%s')::text || '/' || (select count(distinct idempotency_key) from app_private.email_outbox where node_id = '%s')::text || '/' || (select count(*) from public.booking_invitations where booker_item_id = '%s' and revoked_at is not null)::text$q$, :'s1', :'i1', :'s1', :'i1'), '2/3/1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select v33_test.val('E14 acceptance in Arabic uses the Arabic template (no booking needed)', format($q$select r.status from public.send_selection_emails('%s', 'acceptance', array['%s'::uuid], 'ar') r$q$, :'s1', :'i1'), 'queued');
reset role;
select v33_test.val('E15 Arabic subject rendered, HTML body kept as HTML', format($q$select o.subject || '|' || o.body_html from app_private.email_outbox o where o.node_id = '%s' and o.email_key = 'acceptance'$q$, :'s1'), 'مرحباً Resp Co|<p>عزيزي Abdel Rahman Ali</p>');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select v33_test.val('E16 extras expose per-recipient outbox statuses', format($q$select jsonb_array_length(public.get_selection_extras('%s')->'emails')::text$q$, :'s1'), '4');
select v33_test.val('E17 item of another stage is refused per row', format($q$select r.status from public.send_selection_emails('%s', 'acceptance', array['%s'::uuid]) r$q$, :'s1', :'j1'), 'item_not_found');
reset role;
-- NOTE: anon is kept out by the EXECUTE privileges (C03: PostgREST refuses the call before the body runs). Calling a PM-guarded
-- SECURITY DEFINER RPC under `set local role anon` segfaults this local stack (pre-existing: public.resolve_list of m06c does the
-- same), so no anon role-switch call is made here; v30/v31/v32 only call public RPCs as anon for the same reason.

select current_setting('v33.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v33: selection RPC tests FAILED'; end $$;
\endif
