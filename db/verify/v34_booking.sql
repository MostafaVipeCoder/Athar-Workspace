-- v34_booking  (m34: Booking node RPCs)  Role-switch tests inside ONE transaction that is ROLLED BACK.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin; public calls run as anon.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v34.res', '', false) \gset

begin;
create schema v34_test;
grant usage on schema v34_test to public;
create or replace function v34_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v34.res', current_setting('v34.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v34_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v34_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v34_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v34_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare h text;
begin
  begin
    execute p_sql;
    perform v34_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    perform v34_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or h = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(h, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v34_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v34_test.t(p_key, true, 'ok');
  exception when others then
    perform v34_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v34_test from public;
grant execute on all functions in schema v34_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v34_test.val('C01 m34 functions exist', $q$select (to_regprocedure('public.add_booking_slots(uuid,uuid,jsonb)') is not null and to_regprocedure('public.reschedule_booking(uuid,uuid)') is not null and to_regprocedure('public.restore_booking(uuid)') is not null and to_regprocedure('public.retry_calendar_job(uuid)') is not null and to_regprocedure('public.get_booking_extras(uuid)') is not null and to_regprocedure('app_private.save_children_booking(uuid,jsonb)') is not null and to_regprocedure('app_private.booking_queue_email(uuid,text,text)') is not null)::text$q$, 'true');
select v34_test.val('C02 m34 functions have search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('add_booking_slots','reschedule_booking','restore_booking','retry_calendar_job','get_booking_extras','save_children_booking','booking_queue_email','booking_vars','booking_token_ok','booking_default_template','get_public_booking_page','create_booking','cancel_booking') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v34_test.val('C03 anon may execute only the public trio', $q$select (has_function_privilege('anon','public.get_public_booking_page(text,uuid,text)','EXECUTE') and has_function_privilege('anon','public.create_booking(text,uuid,jsonb,text)','EXECUTE') and has_function_privilege('anon','public.cancel_booking(uuid,text)','EXECUTE') and not has_function_privilege('anon','public.add_booking_slots(uuid,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.reschedule_booking(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.restore_booking(uuid)','EXECUTE') and not has_function_privilege('anon','public.retry_calendar_job(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_booking_extras(uuid)','EXECUTE') and not has_function_privilege('anon','app_private.booking_queue_email(uuid,text,text)','EXECUTE') and not has_function_privilege('authenticated','app_private.booking_queue_email(uuid,text,text)','EXECUTE'))::text$q$, 'true');
select v34_test.val('C04 bookings columns + outbox scope + children fn', $q$select (exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='cancel_token_hash') and exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='lang') and (select save_children_fn from public.node_types where key='booking') = 'save_children_booking')::text$q$, 'true');
select v34_test.val('C05 migrated bookings untouched by the new columns', $q$select (count(*) filter (where cancel_token_hash is not null or lang is not null))::text || '/' || count(*)::text from public.bookings$q$, '0/30');
select v34_test.val('C06 renderer: cancel/meet links become anchors only when they are URLs', $q$select app_private.render_email_template('{{cancel_link}}|{{meet_link}}', '{"cancel_link":"https://x.y/b?cancel=1&token=t","meet_link":"soon"}'::jsonb, true)$q$, '<a href="https://x.y/b?cancel=1&amp;token=t">https://x.y/b?cancel=1&amp;token=t</a>|soon');
select v34_test.val('C07 default templates in both languages', $q$select (app_private.booking_default_template('booking_confirmation','en')->>'subject') || '|' || (app_private.booking_default_template('booking_cancellation','ar')->>'subject')$q$, 'Your session with {{provider_name}} is confirmed|تم إلغاء جلستك مع {{provider_name}}');

-- ================================================================= setup (as postgres + U1)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000a0d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v34-admin@example.invalid','{"provisioned":true}','{"full_name":"V34 Admin"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000a0d4','super_admin');
insert into public.network_experts (id, name_en, name_ar, title_en, email) values ('00000000-0000-4000-8000-00000000e0a1', 'Mentor One', 'منتور واحد', 'CEO', 'mentor1@example.invalid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V34 Program', 'برنامج', null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V34 Project', null, 'Africa/Cairo')).id as proj \gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors"}', 0, 0, '{"subkind":"expert"}')).id as lst \gset
select (public.add_node(:'proj', 'booking', '{"en":"Mentor sessions"}', 0, 0, '{"mode":"mentor"}')).id as bkm \gset
select (public.add_node(:'proj', 'booking', '{"en":"Interviews"}', 0, 0, '{"mode":"interview"}')).id as bki \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"Apply"}', 0, 0, '{}')).id as frm \gset
select (public.add_node(:'proj', 'selection', '{"en":"Stage"}', 0, 0, '{}')).id as sel \gset
select (public.connect(:'proj', :'lst', 'items', :'bkm', 'mentors', '{}')).id as e1 \gset
select (public.connect(:'proj', :'lst', 'items', :'bki', 'mentors', '{}')).id as e2 \gset
select (public.connect(:'proj', :'frm', 'responses', :'sel', 'applicants', '{}')).id as e3 \gset
select (public.connect(:'proj', :'sel', 'interview', :'bki', 'bookers', '{}')).id as e4 \gset
select public.add_network_pick(:'lst', '00000000-0000-4000-8000-00000000e0a1') as item \gset
select v34_test.val('S01 the booking_settings rows were created by add_node with the preset mode', format($q$select string_agg(mode, ',' order by mode) from public.booking_settings where node_id in ('%s','%s')$q$, :'bkm', :'bki'), 'interview,mentor');
-- providers are list-item references written under RLS (PM policy)
insert into public.booking_providers (project_id, node_id, list_item_id, booking_email) values (:'proj', :'bkm', :'item', 'book-me@example.invalid') returning id as pvm \gset
insert into public.booking_providers (project_id, node_id, list_item_id) values (:'proj', :'bki', :'item') returning id as pvi \gset
select v34_test.val('S02 provider rows readable by the PM', format($q$select count(*)::text from public.booking_providers where node_id in ('%s','%s')$q$, :'bkm', :'bki'), '2');

-- ================================================================= slots (bulk, overlap skipped)
select to_char(date_trunc('hour', now() + interval '3 days'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as base \gset
select v34_test.val('L01 add_booking_slots creates 3, skips 1 overlap and 1 invalid', format($q$select (r->>'created') || '/' || (r->>'overlapped') || '/' || (r->>'invalid') from public.add_booking_slots('%s', '%s', jsonb_build_array(
    jsonb_build_object('starts_at', '%s'::timestamptz, 'ends_at', '%s'::timestamptz + interval '30 minutes'),
    jsonb_build_object('starts_at', '%s'::timestamptz + interval '35 minutes', 'ends_at', '%s'::timestamptz + interval '65 minutes'),
    jsonb_build_object('starts_at', '%s'::timestamptz + interval '70 minutes', 'ends_at', '%s'::timestamptz + interval '100 minutes'),
    jsonb_build_object('starts_at', '%s'::timestamptz + interval '10 minutes', 'ends_at', '%s'::timestamptz + interval '20 minutes'),
    jsonb_build_object('starts_at', '%s'::timestamptz + interval '200 minutes', 'ends_at', '%s'::timestamptz + interval '190 minutes'))) r$q$,
    :'bkm', :'pvm', :'base', :'base', :'base', :'base', :'base', :'base', :'base', :'base', :'base', :'base'), '3/1/1');
-- one slot inside the notice window (default 1440 min): must never be bookable
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (:'proj', :'bkm', :'pvm', now() + interval '30 minutes', now() + interval '50 minutes') returning id as soon_slot \gset
select id as slot1 from public.booking_slots where node_id = :'bkm' and starts_at = :'base'::timestamptz \gset
select id as slot2 from public.booking_slots where node_id = :'bkm' and starts_at = :'base'::timestamptz + interval '35 minutes' \gset
select id as slot3 from public.booking_slots where node_id = :'bkm' and starts_at = :'base'::timestamptz + interval '70 minutes' \gset
select v34_test.fails('L02 add_booking_slots refuses another node''s provider', format($q$select public.add_booking_slots('%s', '%s', '[]'::jsonb)$q$, :'bki', :'pvm'), 'P0002');
select v34_test.val('L03 provider rev bumped by the slot writes', format($q$select (rev > 1)::text from public.node_revisions where node_id = '%s'$q$, :'bkm'), 'true');

-- ================================================================= settings through save_node children
select rev as revm from public.node_revisions where node_id = :'bkm' \gset
select v34_test.fails('T01 shared Meet mode without a link is refused at save time (C-3)', format($q$select public.save_node('%s', %s, '{"config":{}}'::jsonb, '{"settings":{"meeting_link_mode":"shared","shared_meet_link":""}}'::jsonb)$q$, :'bkm', :'revm'), '22023', 'booking_shared_link_required');
select v34_test.val('T02 save_node writes settings + config in one call', format($q$select (public.save_node('%s', %s, '{"config":{"rules":{"max_bookings_per_email":1},"page":{"title":{"en":"Book","ar":"احجز"}}}}'::jsonb, '{"settings":{"default_advance_notice_min":60,"meeting_link_mode":"shared","shared_meet_link":"https://meet.google.com/abc-defg-hij"}}'::jsonb)->>'rev')::int = %s + 1$q$, :'bkm', :'revm', :'revm')::text, 'true');
select v34_test.val('T03 booking_settings row updated', format($q$select default_advance_notice_min::text || '/' || meeting_link_mode || '/' || shared_meet_link from public.booking_settings where node_id = '%s'$q$, :'bkm'), '60/shared/https://meet.google.com/abc-defg-hij');
select rev as revm from public.node_revisions where node_id = :'bkm' \gset
select v34_test.fails('T04 unknown Google connection refused', format($q$select public.save_node('%s', %s, '{}'::jsonb, '{"settings":{"organizer_connection_id":"00000000-0000-4000-8000-0000000000ff"}}'::jsonb)$q$, :'bkm', :'revm'), '22023', 'booking_invalid');
select v34_test.okrun('T05 node made public with its booking link', format($q$select public.save_node('%s', %s, '{"visibility":"public"}'::jsonb); select public.ensure_public_link('%s', 'booking', null, null)$q$, :'bkm', :'revm', :'bkm'));
select s.slug as slugm from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'bkm' and l.kind = 'booking' \gset
select v34_test.val('T06 extras: settings, no jobs yet, connections list empty on this stack', format($q$select (x->'settings'->>'meeting_link_mode') || '/' || jsonb_array_length(x->'jobs') || '/' || jsonb_array_length(x->'connections') || '/' || (x->>'timezone') from public.get_booking_extras('%s') x$q$, :'bkm'), 'shared/0/0/Africa/Cairo');

-- ================================================================= public page + booking as anon
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v34_test.val('P01 anon page: open, mode, providers, free slots (the too-soon slot is hidden), page config', format($q$select (x->>'status') || '/' || (x->>'mode') || '/' || jsonb_array_length(x->'providers') || '/' || jsonb_array_length(x->'slots') || '/' || (x->'config'->'page'->'title'->>'en') || '/' || (x->>'default_advance_notice_min') from public.get_public_booking_page('%s') x$q$, :'slugm'), 'open/mentor/1/3/Book/60');
select v34_test.val('P02 no meet link and no provider e-mail in the public payload', format($q$select (x::text not like '%%meet.google%%' and x::text not like '%%book-me@%%' and x->'providers'->0->>'name_en' = 'Mentor One')::text from public.get_public_booking_page('%s') x$q$, :'slugm'), 'true');
select v34_test.val('P03 host filter keeps only that provider''s slots', format($q$select jsonb_array_length(x->'slots')::text from public.get_public_booking_page('%s', '%s') x$q$, :'slugm', :'pvi'), '0');
select v34_test.fails('P04 create_booking: invalid e-mail', format($q$select public.create_booking('%s', '%s', '{"email":"nope","name":"A"}'::jsonb)$q$, :'slugm', :'slot1'), '22023', 'booking_invalid');
select v34_test.fails('P05 create_booking: name required', format($q$select public.create_booking('%s', '%s', '{"email":"a@example.invalid"}'::jsonb)$q$, :'slugm', :'slot1'), '22023', 'booking_invalid');
select v34_test.fails('P06 create_booking: slot inside the notice window', format($q$select public.create_booking('%s', '%s', '{"email":"a@example.invalid","name":"A"}'::jsonb)$q$, :'slugm', :'soon_slot'), 'P0001', 'slot_too_soon');
select v34_test.val('P07 create_booking: confirmed, shared Meet link returned at once, cancel token once', format($q$select (x->>'status') || '/' || (x->>'meet_link') || '/' || (length(x->>'cancel_token') > 20)::text || '/' || (x->>'lang') from public.create_booking('%s', '%s', '{"email":"Founder@Example.invalid","name":"Mona Fathy","company_name":"Delta Farms","lang":"ar","base_url":"https://app.example.invalid/"}'::jsonb) x$q$, :'slugm', :'slot1'), 'confirmed/https://meet.google.com/abc-defg-hij/true/ar');
select v34_test.fails('P08 second attempt on the same slot is rejected', format($q$select public.create_booking('%s', '%s', '{"email":"b@example.invalid","name":"B"}'::jsonb)$q$, :'slugm', :'slot1'), 'P0001', 'slot_unavailable');
select v34_test.fails('P09 max bookings per e-mail (1) reached', format($q$select public.create_booking('%s', '%s', '{"email":"founder@example.invalid","name":"Mona Fathy"}'::jsonb)$q$, :'slugm', :'slot2'), 'P0001', 'booking_limit_reached');
select v34_test.val('P10 the booked slot left the public page', format($q$select jsonb_array_length(x->'slots')::text from public.get_public_booking_page('%s') x$q$, :'slugm'), '2');
reset role;
select id as bk1 from public.bookings where slot_id = :'slot1' \gset
select v34_test.val('P11 booking row: e-mail lower-cased, company free text, lang, hashed token, shared link copied', format($q$select (booker_email::text = 'founder@example.invalid' and booker_company_name = 'Delta Farms' and booker_company_id is null and lang = 'ar' and length(cancel_token_hash) = 64 and meet_link = 'https://meet.google.com/abc-defg-hij' and status = 'confirmed')::text from public.bookings where id = '%s'$q$, :'bk1'), 'true');
select v34_test.val('P12 calendar_create job pending with no connection (OAuth not shipped) and the idempotency key', format($q$select (j.status || '/' || (j.connection_id is null)::text || '/' || j.idempotency_key) from app_private.integration_jobs j where j.booking_id = '%s'$q$, :'bk1'), 'pending/true/cal:' || :'bk1' || ':calendar_create');
select v34_test.val('P13 confirmation e-mail queued in Arabic with rendered placeholders, null sender, cancel link anchor', format($q$select (o.email_key = 'booking_confirmation' and o.sender_connection_id is null and o.recipient_email::text = 'founder@example.invalid' and o.subject = 'تأكيد حجزك مع منتور واحد' and o.body_html like '%%Africa/Cairo%%' and o.body_html like '%%<a href="https://app.example.invalid/book/%s?cancel=%s&amp;token=%%' and o.body_html like '%%https://meet.google.com/abc-defg-hij%%' and o.status = 'queued')::text from app_private.email_outbox o where o.booking_id = '%s'$q$, :'slugm', :'bk1', :'bk1'), 'true');
select v34_test.val('P14 e-mail audit record', format($q$select count(*)::text from app_private.email_log l join app_private.email_outbox o on o.id = l.outbox_id where o.booking_id = '%s' and l.event = 'queued'$q$, :'bk1'), '1');
select substring(o.body_html from 'token=([A-Za-z0-9_-]+)') as tok from app_private.email_outbox o where o.booking_id = :'bk1' \gset

-- ================================================================= cancel via the token (anon), restore / reschedule (PM)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v34_test.fails('K01 cancel with a wrong token is forbidden', format($q$select public.cancel_booking('%s', 'wrong-token')$q$, :'bk1'), '42501');
select v34_test.fails('K02 cancel without a token is forbidden for anon', format($q$select public.cancel_booking('%s')$q$, :'bk1'), '42501');
select v34_test.okrun('K03 cancel with the e-mailed token', format($q$select public.cancel_booking('%s', '%s')$q$, :'bk1', :'tok'));
select v34_test.val('K04 the slot is free again on the public page', format($q$select jsonb_array_length(x->'slots')::text from public.get_public_booking_page('%s') x$q$, :'slugm'), '3');
reset role;
select v34_test.val('K05 cancelled + calendar_cancel job + cancellation e-mail (Arabic)', format($q$select b.status || '/' || (select count(*) from app_private.integration_jobs j where j.booking_id = b.id and j.kind = 'calendar_cancel')::text || '/' || (select o.subject from app_private.email_outbox o where o.booking_id = b.id and o.email_key = 'booking_cancellation') from public.bookings b where b.id = '%s'$q$, :'bk1'), 'cancelled/1/تم إلغاء جلستك مع منتور واحد');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select v34_test.okrun('K06 PM restores the cancelled booking (undo)', format($q$select public.restore_booking('%s')$q$, :'bk1'));
reset role;
select v34_test.val('K07 confirmed again, confirmation round 2 queued', format($q$select b.status || '/' || (select count(*) from app_private.email_outbox o where o.booking_id = b.id and o.email_key = 'booking_confirmation')::text from public.bookings b where b.id = '%s'$q$, :'bk1'), 'confirmed/2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select v34_test.val('K08 reschedule to a free slot', format($q$select (x->>'changed') || '/' || (x->>'slot_id') from public.reschedule_booking('%s', '%s') x$q$, :'bk1', :'slot2'), 'true/' || :'slot2');
select v34_test.fails('K09 reschedule onto a blocked slot is refused', format($q$update public.booking_slots set is_blocked = true where id = '%s'; select public.reschedule_booking('%s', '%s')$q$, :'slot3', :'bk1', :'slot3'), 'P0001', 'slot_unavailable');
reset role;
select v34_test.val('K10 calendar_update job + third confirmation e-mail', format($q$select (select count(*) from app_private.integration_jobs j where j.booking_id = '%s' and j.kind = 'calendar_update')::text || '/' || (select count(*) from app_private.email_outbox o where o.booking_id = '%s' and o.email_key = 'booking_confirmation')::text$q$, :'bk1', :'bk1'), '1/3');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select v34_test.val('K11 PM cancel (no token) + retry of failed jobs', format($q$select public.cancel_booking('%s'); select public.retry_calendar_job('%s')::text$q$, :'bk1', :'bk1'), '0');
reset role;
update app_private.integration_jobs set status = 'failed', error = 'boom' where booking_id = :'bk1' and kind = 'calendar_create';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select v34_test.val('K12 retry_calendar_job re-queues the failed job', format($q$select public.retry_calendar_job('%s')::text$q$, :'bk1'), '1');
reset role;
select v34_test.val('K12b the job is pending again', format($q$select j.status from app_private.integration_jobs j where j.booking_id = '%s' and j.kind = 'calendar_create'$q$, :'bk1'), 'pending');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select v34_test.val('K13 extras expose jobs, e-mails and names', format($q$select jsonb_array_length(x->'jobs')::text || '/' || jsonb_array_length(x->'emails')::text || '/' || (x->'project_name'->>'en') from public.get_booking_extras('%s') x$q$, :'bkm'), '4/5/V34 Project');
select v34_test.val('K14 a booked slot cannot be deleted (FK RESTRICT, BUG-9 fixed)', format($q$select count(*)::text from (select 1 from public.booking_slots where id = '%s' and exists (select 1 from public.bookings b where b.slot_id = '%s')) x$q$, :'slot2', :'slot2'), '1');
select v34_test.fails('K15 delete of the booked slot raises 23503', format($q$delete from public.booking_slots where id = '%s'$q$, :'slot2'), '23503');

-- ================================================================= interview mode: invitation tokens (01-15)
select rev as revi from public.node_revisions where node_id = :'bki' \gset
select v34_test.okrun('I01 interview node public + link', format($q$select public.save_node('%s', %s, '{"visibility":"public"}'::jsonb); select public.ensure_public_link('%s', 'booking', null, null)$q$, :'bki', :'revi', :'bki'));
select s.slug as slugi from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'bki' and l.kind = 'booking' \gset
select v34_test.val('I02 interview slots', format($q$select (r->>'created') from public.add_booking_slots('%s', '%s', jsonb_build_array(jsonb_build_object('starts_at', '%s'::timestamptz + interval '1 day', 'ends_at', '%s'::timestamptz + interval '1 day 30 minutes'), jsonb_build_object('starts_at', '%s'::timestamptz + interval '1 day 40 minutes', 'ends_at', '%s'::timestamptz + interval '1 day 70 minutes'))) r$q$, :'bki', :'pvi', :'base', :'base', :'base', :'base'), '2');
select id as islot1 from public.booking_slots where node_id = :'bki' order by starts_at limit 1 \gset
select id as islot2 from public.booking_slots where node_id = :'bki' order by starts_at desc limit 1 \gset
reset role;
insert into public.form_responses (id, project_id, node_id, answers) values ('00000000-0000-4000-8000-00000000b3f1', :'proj', :'frm', '{"company_name":"Nile Robotics","founder_name":"Abdel Rahman Ali","founder_email":"ar@example.invalid"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select public.ensure_item(:'sel', 'form_response', '00000000-0000-4000-8000-00000000b3f1') as appl \gset
select token as itok from public.create_invitations(:'bki', array[:'appl'::uuid]) \gset
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v34_test.val('I03 without a token the interview page asks for an invitation (no providers, no slots)', format($q$select (x->>'status') || '/' || (x->>'mode') || '/' || (x ? 'slots')::text from public.get_public_booking_page('%s') x$q$, :'slugi'), 'invitation_required/interview/false');
select v34_test.val('I04 with the token: open + invitee prefill', format($q$select (x->>'status') || '/' || (x->'invitee'->>'company_en') || '/' || (x->'invitee'->>'email') || '/' || jsonb_array_length(x->'slots') from public.get_public_booking_page('%s', null, '%s') x$q$, :'slugi', :'itok'), 'open/Nile Robotics/ar@example.invalid/2');
select v34_test.fails('I05 create_booking without the token is refused', format($q$select public.create_booking('%s', '%s', '{"email":"ar@example.invalid","name":"Abdel Rahman Ali"}'::jsonb)$q$, :'slugi', :'islot1'), '42501', 'invitation_required');
select v34_test.val('I06 create_booking with the token links the selection item', format($q$select (x->>'status') || '/' || coalesce(x->>'meet_link', 'null') from public.create_booking('%s', '%s', '{"email":"ar@example.invalid","name":"Abdel Rahman Ali","lang":"en"}'::jsonb, '%s') x$q$, :'slugi', :'islot1', :'itok'), 'confirmed/null');
select v34_test.val('I07 a second visit shows the existing booking', format($q$select (x->>'status') || '/' || (x->'booking'->>'provider_name_en') from public.get_public_booking_page('%s', null, '%s') x$q$, :'slugi', :'itok'), 'already_booked/Mentor One');
select v34_test.fails('I08 a second booking on the same invitation is refused', format($q$select public.create_booking('%s', '%s', '{"email":"ar@example.invalid","name":"Abdel Rahman Ali"}'::jsonb, '%s')$q$, :'slugi', :'islot2', :'itok'), 'P0001', 'already_booked');
reset role;
select v34_test.val('I09 booking row carries booker_item_id, invitation_id, company name from the answers, unique mode -> no meet link yet', format($q$select (b.booker_item_id = '%s' and b.invitation_id is not null and b.booker_company_name = 'Nile Robotics' and b.meet_link is null)::text from public.bookings b where b.node_id = '%s'$q$, :'appl', :'bki'), 'true');
select v34_test.val('I10 confirmation e-mail says the link will follow', format($q$select (o.body_html like '%%the meeting link will follow by e-mail%%')::text from app_private.email_outbox o where o.node_id = '%s' and o.email_key = 'booking_confirmation'$q$, :'bki'), 'true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a0d4","role":"authenticated"}', true);
set local role authenticated;
select v34_test.val('I11 extras list the invitation as used with the company name', format($q$select (i->>'used') || '/' || (i->>'company_en') from jsonb_array_elements(public.get_booking_extras('%s')->'invitations') i$q$, :'bki'), 'true/Nile Robotics');
reset role;

-- ================================================================= visibility gate
update public.nodes set visibility = 'private' where id = :'bkm';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v34_test.val('V01 a private node is null for anon (no existence leak)', format($q$select coalesce(public.get_public_booking_page('%s')::text, 'null')$q$, :'slugm'), 'null');
select v34_test.fails('V02 create_booking on a private node: not found', format($q$select public.create_booking('%s', '%s', '{"email":"c@example.invalid","name":"C"}'::jsonb)$q$, :'slugm', :'slot3'), 'P0002', 'booking_not_found');
reset role;

select current_setting('v34.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v34: booking RPC tests FAILED'; end $$;
\endif
