-- v68_alumni_quarter_reminders  (m68: the quarterly reminder campaign: schedule settings, templates, audience, idempotent sending (notification + e-mail), the tick, the quarter status page)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e68x users / c68x companies / f68x founders):  AM = alumni_manager (e681), PM = project_manager (e682),
--   F1 = founder of CO1 (e683), F2 = founder of CO2 (e684, profile language en), F3 = founder of CO3 (e685), F6 = a SECOND founder of CO1 (e686),
--   F5 = founder of CO5 (e687, a company that is NOT alumni), F7 = a founder RECORD with no account on CO1. 105 bulk founders (b-companies) for the "more than 100" confirmation.
-- NEVER call an app_private helper while the session role is anon / authenticated (helpers run as the owner; the tick's clock is an argument).
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v68.res', '', false) \gset

begin;
create schema v68_test;
grant usage on schema v68_test to public;
create or replace function v68_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v68.res', current_setting('v68.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v68_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v68_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v68_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v68_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v68_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v68_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
revoke all on all functions in schema v68_test from public;
grant execute on all functions in schema v68_test to anon, authenticated, service_role;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e681','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-am@example.invalid','{"provisioned":true}','{"full_name":"V68 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e682','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-pm@example.invalid','{"provisioned":true}','{"full_name":"V68 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e683','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-f1@example.invalid','{"provisioned":true}','{"full_name":"V68 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e684','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-f2@example.invalid','{"provisioned":true}','{"full_name":"V68 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e685','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-f3@example.invalid','{"provisioned":true}','{"full_name":"V68 Founder Three"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e686','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-f6@example.invalid','{"provisioned":true}','{"full_name":"V68 Founder Six"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e687','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v68-f5@example.invalid','{"provisioned":true}','{"full_name":"V68 Founder Five"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e681','alumni_manager'), ('00000000-0000-4000-8000-00000000e682','project_manager'),
  ('00000000-0000-4000-8000-00000000e683','founder'), ('00000000-0000-4000-8000-00000000e684','founder'), ('00000000-0000-4000-8000-00000000e685','founder'),
  ('00000000-0000-4000-8000-00000000e686','founder'), ('00000000-0000-4000-8000-00000000e687','founder');
update public.profiles set language = 'en' where id = '00000000-0000-4000-8000-00000000e684';
insert into public.companies (id, name_en, name_ar, created_by, is_alumni) values
  ('00000000-0000-4000-8000-00000000c681', 'V68 Nile Co', 'نيل V68', null, true),
  ('00000000-0000-4000-8000-00000000c682', 'V68 Delta Co', 'دلتا V68', null, true),
  ('00000000-0000-4000-8000-00000000c683', 'V68 Giza Co', null, null, true),
  ('00000000-0000-4000-8000-00000000c685', 'V68 Not Alumni', null, null, false);
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f681', 'V68 One', 'واحد', 'zz-v68-f1@example.invalid', '00000000-0000-4000-8000-00000000e683'),
  ('00000000-0000-4000-8000-00000000f682', 'V68 Two', 'اثنان', 'zz-v68-f2@example.invalid', '00000000-0000-4000-8000-00000000e684'),
  ('00000000-0000-4000-8000-00000000f683', 'V68 Three', 'ثلاثة', 'zz-v68-f3@example.invalid', '00000000-0000-4000-8000-00000000e685'),
  ('00000000-0000-4000-8000-00000000f686', 'V68 Six', 'ستة', 'zz-v68-f6@example.invalid', '00000000-0000-4000-8000-00000000e686'),
  ('00000000-0000-4000-8000-00000000f685', 'V68 Five', 'خمسة', 'zz-v68-f5@example.invalid', '00000000-0000-4000-8000-00000000e687'),
  ('00000000-0000-4000-8000-00000000f687', 'V68 Seven (no account)', 'سبعة', 'zz-v68-f7@example.invalid', null);
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c681', '00000000-0000-4000-8000-00000000f681', true), ('00000000-0000-4000-8000-00000000c681', '00000000-0000-4000-8000-00000000f686', false),
  ('00000000-0000-4000-8000-00000000c681', '00000000-0000-4000-8000-00000000f687', false),
  ('00000000-0000-4000-8000-00000000c682', '00000000-0000-4000-8000-00000000f682', true), ('00000000-0000-4000-8000-00000000c683', '00000000-0000-4000-8000-00000000f683', true),
  ('00000000-0000-4000-8000-00000000c685', '00000000-0000-4000-8000-00000000f685', true);
select set_config('request.jwt.claims', '', true);
select set_config('v68.fixture_companies', '{00000000-0000-4000-8000-00000000c681,00000000-0000-4000-8000-00000000c682,00000000-0000-4000-8000-00000000c683,00000000-0000-4000-8000-00000000c685}', false);
select set_config('v68.cur', app_private.alumni_period_key(now()), false);
-- expected values that need an app_private helper are computed HERE, as the owner (a helper called while the session role is authenticated crashes this image)
select set_config('v68.exp11', 'Nile Tech / ' || app_private.alumni_period_label(app_private.alumni_period_key(now()), 'en') || ' / ' || app_private.alumni_deadline_label(app_private.alumni_period_key(now()), 'en')
  || '|' || 'نايل تك / ' || app_private.alumni_period_label(app_private.alumni_period_key(now()), 'ar'), false);

-- ================================================================= C. catalog / privileges
select v68_test.val('C01 the machinery is closed to the API roles', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('alumni_fill', 'alumni_email_html', 'alumni_template_check', 'alumni_reminder_vars', 'alumni_reminder_render', 'alumni_reminder_audience', 'alumni_reminders_send', 'alumni_quarter_tick',
                    'alumni_quarter_scheduler_status', 'alumni_quarter_scheduler_enable', 'alumni_quarter_scheduler_disable', 'alumni_reminder_default')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v68_test.val('C02 the nine manager RPCs: authenticated yes, anon no, definer with an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_alumni_quarter_settings', 'set_alumni_quarter_settings', 'save_alumni_reminder_template', 'reset_alumni_reminder_template', 'preview_alumni_reminder_template', 'preview_alumni_reminders',
                    'send_alumni_reminders', 'list_alumni_reminder_campaigns', 'list_alumni_quarter_status')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and p.prosecdef and 'search_path=""' = any (p.proconfig)$q$, '9');
select v68_test.val('C03 no API role reads the templates / campaigns / log / settings', $q$select concat_ws('|', has_table_privilege('authenticated', 'app_private.alumni_reminder_templates', 'SELECT')::text, has_table_privilege('authenticated', 'app_private.alumni_reminder_campaigns', 'SELECT')::text,
  has_table_privilege('authenticated', 'app_private.alumni_reminder_log', 'SELECT')::text, has_table_privilege('authenticated', 'app_private.alumni_quarter_settings', 'SELECT')::text, has_table_privilege('anon', 'public.notifications', 'SELECT')::text)$q$, 'false|false|false|false|false');
select v68_test.val('C04 the defaults: two templates, ar + en, flagged NOT finalised ("wording to be finalised by the owner")', $q$select string_agg(t.lang || ':' || t.finalised::text, ',' order by t.lang) from app_private.alumni_reminder_templates t where t.variant = 'figures'$q$, 'ar:false,en:false');
select v68_test.val('C05 the default schedule: 14 and 3 days, 10:00 Cairo, automatic reminders + freezing on, first tracked quarter 2026-Q4', $q$select concat_ws('|', s.reminder_offsets::text, s.send_hour::text, s.auto_reminders::text, s.auto_freeze::text, s.first_period) from app_private.alumni_quarter_settings s$q$, '{14,3}|10|true|true|2026-Q4');
select v68_test.val('C06 the e-mail row of a reminder is a platform e-mail without a node (scope check) and is sent by the system sender (patched pick)', $q$select concat_ws('|',
  (pg_get_constraintdef((select oid from pg_constraint where conname = 'email_outbox_scope_chk')) like '%alumni_quarter_reminder%')::text,
  (position('alumni_quarter_reminder' in pg_get_functiondef('app_private.email_pick_sender(app_private.email_outbox)'::regprocedure)) > 0)::text)$q$, 'true|true');

-- ================================================================= T. templates (manager only), safe text, live preview
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select v68_test.val('T01 settings read: the schedule, both templates, the scheduler state (off: nothing is scheduled by a migration), the due dates of this quarter', $q$select concat_ws('|', (public.get_alumni_quarter_settings()->>'timezone'), jsonb_array_length(public.get_alumni_quarter_settings()->'templates')::text,
  (public.get_alumni_quarter_settings()->'scheduler'->>'enabled'), jsonb_array_length(public.get_alumni_quarter_settings()->'due')::text, (public.get_alumni_quarter_settings()->'templates'->0->>'is_default'))$q$, 'Africa/Cairo|2|false|2|true');
select public.save_alumni_reminder_template('en', '{"notif_title":"Hi {founder_name}: {quarter}","finalised":true}'::jsonb) is not null as ok;
select v68_test.val('T02 save a template: valid placeholders accepted; the template is no longer the default; finalised can be set', $q$select concat_ws('|',
  (public.get_alumni_quarter_settings()->'templates'->1->>'notif_title'), (public.get_alumni_quarter_settings()->'templates'->1->>'finalised'), (public.get_alumni_quarter_settings()->'templates'->1->>'is_default'))$q$, 'Hi {founder_name}: {quarter}|true|false');
select v68_test.err('T03 an unknown placeholder is refused', $$select public.save_alumni_reminder_template('en', '{"email_body":"Hello {nope}"}'::jsonb)$$, '22023');
select v68_test.err('T04 a national-ID-shaped number is refused (nothing of the kind is stored or sent)', $$select public.save_alumni_reminder_template('en', '{"email_body":"ref 29901011234567"}'::jsonb)$$, '22023');
select v68_test.err('T05 an empty field is refused', $$select public.save_alumni_reminder_template('en', '{"notif_title":"   "}'::jsonb)$$, '22023');
select v68_test.err('T06 a too long field is refused', $$select public.save_alumni_reminder_template('en', jsonb_build_object('notif_body', repeat('x', 1001)))$$, '22023');
select v68_test.err('T07 an unknown field / a bad language / a non-object', $$select public.save_alumni_reminder_template('en', '{"html":"<b>x</b>"}'::jsonb)$$, '22023');
select v68_test.err('T08 ... bad language', $$select public.save_alumni_reminder_template('fr', '{"notif_title":"x"}'::jsonb)$$, '22023');
select v68_test.err('T09 ... NULL patch', $$select public.save_alumni_reminder_template('en', null)$$, '22023');
select set_config('v68.pv', public.preview_alumni_reminder_template('en', '{"email_body":"Hello {founder_name}\n\n<script>alert(1)</script> & \"q\"\n\n{link}"}'::jsonb)::text, false);
select v68_test.val('T10 SAFE TEXT: the preview HTML escapes everything the manager typed (no raw <script>), keeps paragraphs, and turns ONLY the link into an anchor', $q$select concat_ws('|',
  (current_setting('v68.pv')::jsonb->>'email_html' like '%&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;%')::text, (current_setting('v68.pv')::jsonb->>'email_html' not like '%<script%')::text,
  (current_setting('v68.pv')::jsonb->>'email_html' like '%<p>Hello Sara Ahmed</p><p>%')::text, (current_setting('v68.pv')::jsonb->>'email_html' like '%<a href="https://example.org/alumni/founder/progress">%')::text,
  (select count(*) from regexp_matches(current_setting('v68.pv')::jsonb->>'email_html', '<a ', 'g'))::text)$q$, 'true|true|true|true|1');
select v68_test.val('T11 the preview of an UNSAVED edit uses the placeholders with sample values (company, quarter, deadline)', $q$select concat_ws('|', public.preview_alumni_reminder_template('en', '{"notif_title":"{company_name} / {quarter} / {deadline}"}'::jsonb)->>'notif_title',
  public.preview_alumni_reminder_template('ar', '{"notif_title":"{company_name} / {quarter}"}'::jsonb)->>'notif_title')$q$,
  current_setting('v68.exp11'));
select v68_test.err('T12 the preview refuses an unknown placeholder like the save does', $$select public.preview_alumni_reminder_template('en', '{"notif_title":"{x}"}'::jsonb)$$, '22023');
select public.reset_alumni_reminder_template('en') is not null as ok;
select v68_test.val('T13 reset restores the default wording and clears "finalised"', $q$select concat_ws('|', (public.get_alumni_quarter_settings()->'templates'->1->>'is_default'), (public.get_alumni_quarter_settings()->'templates'->1->>'finalised'))$q$, 'true|false');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e683","role":"authenticated"}', true);
set local role authenticated;
select v68_test.err('T20 a founder cannot read the settings / templates', $$select public.get_alumni_quarter_settings()$$, '42501');
select v68_test.err('T21 ... cannot edit a template', $$select public.save_alumni_reminder_template('en', '{"notif_title":"x"}'::jsonb)$$, '42501');
select v68_test.err('T22 ... cannot preview recipients', $$select public.preview_alumni_reminders(null)$$, '42501');
select v68_test.err('T23 ... cannot send reminders', $$select public.send_alumni_reminders(null)$$, '42501');
select v68_test.err('T24 ... cannot read the campaigns / the quarter status', $$select public.list_alumni_reminder_campaigns()$$, '42501');
select v68_test.err('T25 ... nor the status page', $$select public.list_alumni_quarter_status()$$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e682","role":"authenticated"}', true);
set local role authenticated;
select v68_test.err('T26 a project manager cannot send reminders either', $$select public.send_alumni_reminders(null)$$, '42501');
reset role;

-- ================================================================= S. the schedule settings (manager)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select public.set_alumni_quarter_settings('{"reminder_offsets":[30,7,1],"send_hour":8,"app_base_url":"https://athar.example/app/","auto_freeze":true}'::jsonb) is not null as ok;
select v68_test.val('S01 the manager edits the schedule: offsets [30, 7, 1], 8:00, the app address; validated and normalised', $q$select concat_ws('|',
  (public.get_alumni_quarter_settings()->>'send_hour'), (public.get_alumni_quarter_settings()->'reminder_offsets')::text, (public.get_alumni_quarter_settings()->>'app_base_url'))$q$, '8|[30, 7, 1]|https://athar.example/app');
select v68_test.err('S02 a zero offset', $$select public.set_alumni_quarter_settings('{"reminder_offsets":[0]}'::jsonb)$$, '22023');
select v68_test.err('S03 an offset above 90', $$select public.set_alumni_quarter_settings('{"reminder_offsets":[91]}'::jsonb)$$, '22023');
select v68_test.err('S04 a duplicate offset', $$select public.set_alumni_quarter_settings('{"reminder_offsets":[3,3]}'::jsonb)$$, '22023');
select v68_test.err('S05 seven offsets', $$select public.set_alumni_quarter_settings('{"reminder_offsets":[1,2,3,4,5,6,7]}'::jsonb)$$, '22023');
select v68_test.err('S06 a bad hour', $$select public.set_alumni_quarter_settings('{"send_hour":24}'::jsonb)$$, '22023');
select v68_test.err('S07 a bad boolean', $$select public.set_alumni_quarter_settings('{"auto_reminders":"yes"}'::jsonb)$$, '22023');
select v68_test.err('S08 a bad URL (javascript:)', $$select public.set_alumni_quarter_settings('{"app_base_url":"javascript:alert(1)"}'::jsonb)$$, '22023');
select v68_test.err('S09 the first tracked quarter is not editable here', $$select public.set_alumni_quarter_settings('{"first_period":"2020-Q1"}'::jsonb)$$, '22023');
select v68_test.err('S10 NULL / non-object patch', $$select public.set_alumni_quarter_settings(null)$$, '22023');
select public.set_alumni_quarter_settings('{"reminder_offsets":[14,3],"send_hour":10,"app_base_url":null}'::jsonb) is not null as ok;
select v68_test.val('S11 back to the default schedule', $q$select (public.get_alumni_quarter_settings()->'reminder_offsets')::text$q$, '[14, 3]');
reset role;
-- m69: with NO app address only the notification is created (no e-mail with a dead relative link; covered by v69 D02). The scenarios below test the e-mail path, so an address is stored from here on.
update app_private.alumni_quarter_settings set app_base_url = 'https://athar.example/app';

-- ================================================================= A. the audience + the preview (confirm dialog data)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select set_config('v68.pre', public.preview_alumni_reminders(null, current_setting('v68.fixture_companies')::uuid[])::text, false);
reset role;
select v68_test.val('A01 the audience = founders WITH an account of ALUMNI companies not confirmed: F1, F6 (CO1), F2, F3 = 4 (not F5: company not alumni; not F7: no account); all four have an e-mail', $q$select concat_ws('|', current_setting('v68.pre')::jsonb->>'recipients',
  current_setting('v68.pre')::jsonb->>'with_email', current_setting('v68.pre')::jsonb->>'without_email', current_setting('v68.pre')::jsonb->>'confirm_above', current_setting('v68.pre')::jsonb->>'period')$q$, '4|4|0|100|' || current_setting('v68.cur'));
select v68_test.val('A02 the preview carries names and MASKED e-mails only, never an address', $q$select concat_ws('|', (current_setting('v68.pre')::jsonb::text like '%zz-v68-f1@example.invalid%')::text, (current_setting('v68.pre')::jsonb->'sample'->0 ? 'email_masked')::text)$q$, 'false|true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e684","role":"authenticated"}', true);
set local role authenticated;
select public.confirm_company_figures('00000000-0000-4000-8000-00000000c682') is not null as ok;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select v68_test.val('A03 a company that CONFIRMED its figures leaves the audience (F2 gone): 3 recipients', $q$select public.preview_alumni_reminders(null, current_setting('v68.fixture_companies')::uuid[])->>'recipients'$q$, '3');
reset role;

-- ================================================================= M. manual sending: idempotent per (founder, quarter, kind); history
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select set_config('v68.s1', public.send_alumni_reminders(null, current_setting('v68.fixture_companies')::uuid[], null, false, 'tok-manual-0001', null, 'https://athar.example/app')::text, false);
select set_config('v68.s1b', public.send_alumni_reminders(null, current_setting('v68.fixture_companies')::uuid[], null, false, 'tok-manual-0001', null, 'https://athar.example/app')::text, false);
reset role;
select v68_test.val('M01 the first send: 3 founders, 3 notifications + 3 e-mails queued, nobody without e-mail', $q$select concat_ws('|', current_setting('v68.s1')::jsonb->>'audience', current_setting('v68.s1')::jsonb->>'sent', current_setting('v68.s1')::jsonb->>'already_sent', current_setting('v68.s1')::jsonb->>'no_email',
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.founder_id::text like '00000000-0000-4000-8000-00000000f68%')::text,
  (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.recipient_email::text like 'zz-v68-%')::text)$q$, '3|3|0|0|3|3');
select v68_test.val('M02 the SAME dialog sent twice (same token) = NO duplicates: 0 new, 3 already sent, still 3 + 3 rows', $q$select concat_ws('|', current_setting('v68.s1b')::jsonb->>'sent', current_setting('v68.s1b')::jsonb->>'already_sent',
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.founder_id::text like '00000000-0000-4000-8000-00000000f68%')::text,
  (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.recipient_email::text like 'zz-v68-%')::text,
  (select count(*) from app_private.alumni_reminder_log l where l.founder_id::text like '00000000-0000-4000-8000-00000000f68%')::text)$q$, '0|3|3|3|3');
select v68_test.val('M03 the notification: the recipient''s own language (F2 english, the others arabic), both languages in the metadata, the in-app link to the figures page of HIS company, sent_by the manager', $q$select string_agg(
  case n.founder_id when '00000000-0000-4000-8000-00000000f681' then 'f1' when '00000000-0000-4000-8000-00000000f686' then 'f6' when '00000000-0000-4000-8000-00000000f683' then 'f3' end || ':' ||
  (n.title like '%V68 Nile Co%' or n.title like '%نيل V68%')::text || ':' || (n.body ~ '[ء-ي]')::text || ':' || (n.metadata->>'link' like '/alumni/founder/progress?company=%')::text || ':' || (n.sent_by = '00000000-0000-4000-8000-00000000e681')::text, ',' order by n.founder_id)
  from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.founder_id::text like '00000000-0000-4000-8000-00000000f68%'$q$,
  'f1:true:true:true:true,f3:false:true:true:true,f6:true:true:true:true');
select v68_test.val('M04 ... F2 (english, confirmed) got nothing; the English text is checked on a founder who is reminded below', $q$select count(*)::text from public.notifications n where n.founder_id = '00000000-0000-4000-8000-00000000f682'$q$, '0');
select v68_test.val('M05 the e-mail row: platform e-mail without a node / project / sender (the worker picks the system sender), per-founder idempotency key, subject + escaped HTML body, the app address in the link', $q$select concat_ws('|',
  (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.project_id is null and o.node_id is null and o.sender_connection_id is null and o.status = 'queued' and o.recipient_email::text like 'zz-v68-%')::text,
  (select count(distinct o.idempotency_key) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.recipient_email::text like 'zz-v68-%')::text,
  (select (o.idempotency_key = 'alumni_reminder:00000000-0000-4000-8000-00000000f681:' || current_setting('v68.cur') || ':manual:tok-manual-0001')::text from app_private.email_outbox o where o.recipient_email::text = 'zz-v68-f1@example.invalid'),
  (select (o.body_html like '%https://athar.example/app/alumni/founder/progress?company=00000000-0000-4000-8000-00000000c681%')::text from app_private.email_outbox o where o.recipient_email::text = 'zz-v68-f1@example.invalid'),
  (select (o.subject like '%V68 Nile Co%' or o.subject like '%نيل V68%')::text from app_private.email_outbox o where o.recipient_email::text = 'zz-v68-f1@example.invalid'))$q$, '3|3|true|true|true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select set_config('v68.s2', public.send_alumni_reminders(null, current_setting('v68.fixture_companies')::uuid[], null, true, 'tok-manual-0002', null, null)::text, false);
select set_config('v68.s3', public.send_alumni_reminders(null, current_setting('v68.fixture_companies')::uuid[], null, false, 'tok-manual-0003', null, null)::text, false);
reset role;
select v68_test.val('M06 "Send reminders now" (only founders NOT reminded yet this quarter) after a first send: nobody left (0)', $q$select concat_ws('|', current_setting('v68.s2')::jsonb->>'audience', current_setting('v68.s2')::jsonb->>'sent')$q$, '0|0');
select v68_test.val('M07 "Resend to unconfirmed" (a new token = a deliberate resend): the 3 unconfirmed founders get a SECOND reminder (6 notifications, 6 e-mails), every row keeps its own key', $q$select concat_ws('|', current_setting('v68.s3')::jsonb->>'sent',
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.founder_id::text like '00000000-0000-4000-8000-00000000f68%')::text,
  (select count(distinct o.idempotency_key) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.recipient_email::text like 'zz-v68-%')::text)$q$, '3|6|6');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select v68_test.err('M08 a bad period / token / URL / too many companies are refused', $$select public.send_alumni_reminders('2026-Q9')$$, '22023');
select v68_test.err('M09 ... a token that is too short', $$select public.send_alumni_reminders(null, null, null, false, 'x')$$, '22023');
select v68_test.err('M10 ... a javascript: address', $$select public.send_alumni_reminders(null, null, null, false, 'tok-manual-0009', null, 'javascript:alert(1)')$$, '22023');
select v68_test.err('M11 ... a preview with a bad period', $$select public.preview_alumni_reminders('nope')$$, '22023');
select v68_test.val('M12 the campaign history: counts per campaign, who sent it (name), the e-mail delivery state (queued: the worker delivers), how many read', $q$select concat_ws('|', (r->>'kind'), (r->>'trigger'), (r->>'recipients'), (r->>'notified'), (r->>'emailed'), (r->>'created_by_name'), (r->'delivery'->>'queued'), (r->>'read'))
  from jsonb_array_elements(public.list_alumni_reminder_campaigns(current_setting('v68.cur'))->'rows') r where r->>'recipients' = '3' order by r->>'created_at' limit 1$q$, 'manual|manual|3|3|3|V68 Alumni Manager|3|0');
select v68_test.val('M13 ... three campaigns of this quarter (first send, the empty "now", the resend)', $q$select (public.list_alumni_reminder_campaigns(current_setting('v68.cur'))->>'total')$q$, '3');
reset role;
-- a founder reads ONLY his own notifications, and can mark them read
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e683","role":"authenticated"}', true);
set local role authenticated;
select v68_test.val('M20 founder F1 sees only his own reminders (2: the first send and the resend)', $q$select count(*)::text from public.notifications n where n.metadata->>'kind' = 'quarter_reminder'$q$, '2');
select v68_test.val('M21 ... and the link points at HIS company', $q$select count(*)::text from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.metadata->>'link' = '/alumni/founder/progress?company=00000000-0000-4000-8000-00000000c681'$q$, '2');
update public.notifications set is_read = true where metadata->>'kind' = 'quarter_reminder';
select v68_test.val('M22 ... he can mark them read (the only column a founder can change)', $q$select count(*)::text from public.notifications n where n.is_read and n.metadata->>'kind' = 'quarter_reminder'$q$, '2');
select v68_test.err('M23 ... but not edit the text', $$update public.notifications set title = 'x' where metadata->>'kind' = 'quarter_reminder'$$, '42501');
reset role;

-- ================================================================= B. more than 100 recipients need the exact count confirmed
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-v68-bulk' || g || '@example.invalid', '{"provisioned":true}', '{"full_name":"V68 Bulk"}', now(), now()
    from generate_series(1, 105) g;
insert into public.user_roles (user_id, role_key) select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, 'founder' from generate_series(1, 105) g;
insert into public.companies (id, name_en, is_alumni) select ('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid, 'V68 Bulk ' || g, true from generate_series(1, 105) g;
insert into public.founders (id, name_en, name_ar, email, auth_user_id) select ('00000000-0000-4000-b000-' || lpad(g::text, 12, '0'))::uuid, 'V68 Bulk ' || g, 'ب' || g, 'zz-v68-bulk' || g || '@example.invalid', ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 105) g;
insert into public.company_founders (company_id, founder_id, is_primary) select ('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-4000-b000-' || lpad(g::text, 12, '0'))::uuid, true from generate_series(1, 105) g;
select set_config('v68.bulk', (select array_agg(('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid)::text from generate_series(1, 105) g), false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select v68_test.val('B01 the preview counts 105 recipients (confirm above 100)', $q$select public.preview_alumni_reminders(null, current_setting('v68.bulk')::uuid[])->>'recipients'$q$, '105');
select v68_test.err('B02 105 recipients WITHOUT the confirmed count: refused (alumni_confirm_required), nothing is sent', $$select public.send_alumni_reminders(null, current_setting('v68.bulk')::uuid[], null, false, 'tok-bulk-00001', null, null)$$, 'alumni_confirm_required');
select v68_test.err('B03 ... with a WRONG count: refused too', $$select public.send_alumni_reminders(null, current_setting('v68.bulk')::uuid[], null, false, 'tok-bulk-00001', 104, null)$$, 'alumni_confirm_required');
reset role;
select v68_test.val('B04 ... the refusals sent nothing: no log row of a bulk founder yet', $q$select (select count(*) from app_private.alumni_reminder_log l where l.founder_id::text like '00000000-0000-4000-b000-%')::text$q$, '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select v68_test.val('B05 ... with the exact count: sent to all 105', $q$select public.send_alumni_reminders(null, current_setting('v68.bulk')::uuid[], null, false, 'tok-bulk-00001', 105, null)->>'sent'$q$, '105');
select v68_test.val('B06 up to 100 recipients no confirmation is needed (a 3-founder send above worked with p_expected_count NULL)', $q$select current_setting('v68.s1')::jsonb->>'sent'$q$, '3');
reset role;

-- ================================================================= Q. the quarter status page
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select set_config('v68.qs', public.list_alumni_quarter_status(null, '{"q":"v68 "}'::jsonb, null, 500, 0, 'name', 'asc')::text, false);
select set_config('v68.qs_nu', public.list_alumni_quarter_status(null, '{"q":"v68 "}'::jsonb, 'not_updated', 50, 0, 'status', 'asc')::text, false);
reset role;
select v68_test.val('Q01 the quarter status: the period (deadline, timezone), counts by state: CO2 confirmed, the others not updated', $q$select concat_ws('|', current_setting('v68.qs')::jsonb->'period'->>'key', current_setting('v68.qs')::jsonb->'period'->>'timezone', current_setting('v68.qs')::jsonb->'period'->>'is_current',
  (current_setting('v68.qs')::jsonb->'counts'->>'confirmed'), (current_setting('v68.qs')::jsonb->'counts'->>'closed'))$q$, current_setting('v68.cur') || '|Africa/Cairo|true|1|0');
select v68_test.val('Q02 per company: status, who confirmed (the manager sees the name), last modified, reminders sent (CO1 = 2 founders x 2 sends = 4), the founders with an account', $q$select concat_ws('|', r->>'status', r->>'confirmed_by_name', ((r->>'last_modified') is not null)::text, r->'reminders'->>'count', r->'founders'->>'with_account', r->'founders'->>'total')
  from jsonb_array_elements(current_setting('v68.qs')::jsonb->'rows') r where r->>'name_en' = 'V68 Delta Co'$q$, 'confirmed|V68 Founder Two|true|0|1|1');
select v68_test.val('Q03 ... Nile (two founders with an account, one record without): not updated, 4 reminders', $q$select concat_ws('|', r->>'status', r->'reminders'->>'count', r->'founders'->>'with_account', r->'founders'->>'total')
  from jsonb_array_elements(current_setting('v68.qs')::jsonb->'rows') r where r->>'name_en' = 'V68 Nile Co'$q$, 'not_updated|4|2|3');
select v68_test.val('Q04 the status filter: only the not-updated companies (the 4 fixture alumni companies minus the confirmed one = 2 + the 105 bulk = 107; the non-alumni company is excluded by the default scope)', $q$select (current_setting('v68.qs_nu')::jsonb->>'total')$q$, '107');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e681","role":"authenticated"}', true);
set local role authenticated;
select v68_test.err('Q05 a bad status / sort / period', $$select public.list_alumni_quarter_status(null, '{}'::jsonb, 'nope')$$, '22023');
select v68_test.err('Q06 ... bad sort', $$select public.list_alumni_quarter_status(null, '{}'::jsonb, null, 10, 0, 'nope')$$, '22023');
select v68_test.err('Q07 ... bad period', $$select public.list_alumni_quarter_status('2026-Q9')$$, '22023');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e682","role":"authenticated"}', true);
set local role authenticated;
select v68_test.err('Q08 a project manager cannot read the quarter status', $$select public.list_alumni_quarter_status()$$, '42501');
reset role;

-- ================================================================= K. the tick (the scheduler's job): freezes the due quarters, sends the due reminder, once
select set_config('request.jwt.claims', '', true);
-- a clean slate for the scheduler: no campaigns of the manual part, so the counts below are about the tick alone
delete from app_private.alumni_reminder_log;
delete from app_private.alumni_reminder_campaigns;
delete from public.notifications where metadata->>'kind' = 'quarter_reminder';
delete from app_private.email_outbox where email_key = 'alumni_quarter_reminder';
update public.company_figures set confirmed_period = null, confirmed_at = null, confirmed_by = null;
select set_config('v68.tick0', app_private.alumni_quarter_tick('2026-12-18 09:59:00+02'::timestamptz)::text, false);
select v68_test.val('K01 14 days before the close, one minute BEFORE the send hour (09:59 Cairo): nothing is sent', $q$select (jsonb_array_length(current_setting('v68.tick0')::jsonb->'reminders'))::text || '|' || (select count(*) from app_private.alumni_reminder_campaigns)::text$q$, '0|0');
select set_config('v68.tick1', app_private.alumni_quarter_tick('2026-12-18 10:00:00+02'::timestamptz)::text, false);
select v68_test.val('K02 at 10:00 Cairo, 14 days before the close: kind d14 goes out to every unconfirmed alumni founder (4 fixtures: F1, F6, F2, F3 + 105 bulk = 109) as a scheduled campaign with NO sender', $q$select concat_ws('|', (current_setting('v68.tick1')::jsonb->'reminders'->0->>'kind'), (current_setting('v68.tick1')::jsonb->'reminders'->0->>'sent'),
  (select c.trigger || ':' || coalesce(c.created_by::text, 'none') from app_private.alumni_reminder_campaigns c where c.kind = 'd14'))$q$, 'd14|109|schedule:none');
select set_config('v68.tick2', app_private.alumni_quarter_tick('2026-12-18 10:15:00+02'::timestamptz)::text, false);
select v68_test.val('K03 the next tick (15 minutes later) sends NOTHING: one campaign, 109 log rows, 109 notifications, 109 e-mails', $q$select concat_ws('|', jsonb_array_length(current_setting('v68.tick2')::jsonb->'reminders')::text, (select count(*) from app_private.alumni_reminder_campaigns)::text,
  (select count(*) from app_private.alumni_reminder_log)::text, (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder')::text, (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder')::text)$q$, '0|1|109|109|109');
select v68_test.val('K04 the scheduled notification has no sender (sent_by NULL) and the e-mail no creator; the e-mail has an address to point to (m69: stored below)', $q$select concat_ws('|',
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.sent_by is not null)::text, (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.created_by is not null)::text,
  (select coalesce(c.note, 'none') from app_private.alumni_reminder_campaigns c where c.kind = 'd14'))$q$, '0|0|none');
-- someone confirms in between: the 3-day reminder skips him
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e684","role":"authenticated"}', true);
set local role authenticated;
select public.confirm_company_figures('00000000-0000-4000-8000-00000000c682') is not null as ok;
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('v68.tick3', app_private.alumni_quarter_tick('2026-12-29 10:00:00+02'::timestamptz)::text, false);
select v68_test.val('K05 3 days before the close: kind d3 goes to the founders who still have not confirmed (108: F2 confirmed in between); the d14 log rows stay (a different kind)', $q$select concat_ws('|', (current_setting('v68.tick3')::jsonb->'reminders'->0->>'kind'), (current_setting('v68.tick3')::jsonb->'reminders'->0->>'sent'),
  (select count(*) from app_private.alumni_reminder_log l where l.kind = 'd14')::text, (select count(*) from app_private.alumni_reminder_log l where l.kind = 'd3')::text)$q$, 'd3|108|109|108');
select v68_test.val('K06 a founder never has two reminders of one kind in one quarter (the unique key)', $q$select count(*)::text from (select l.founder_id, l.period_key, l.kind from app_private.alumni_reminder_log l group by 1, 2, 3 having count(*) > 1) x$q$, '0');
-- a late scheduler (down for two weeks): both offsets are due at once -> ONLY the latest is sent, the earlier one is recorded as superseded
select set_config('v68.tick4', app_private.alumni_quarter_tick('2027-03-30 12:00:00+02'::timestamptz)::text, false);
select v68_test.val('K07 a scheduler that was down: in 2027-Q1 BOTH d14 and d3 are due at once: only d3 is sent, d14 is recorded as superseded (nobody gets two mails on one day)', $q$select concat_ws('|',
  (select string_agg(c.kind || ':' || c.status, ',' order by c.kind) from app_private.alumni_reminder_campaigns c where c.period_key = '2027-Q1'),
  (select (r->>'kind') from jsonb_array_elements(current_setting('v68.tick4')::jsonb->'reminders') r limit 1))$q$, 'd14:superseded,d3:done|d3');
select v68_test.val('K08 the tick ALSO froze the ended quarter 2026-Q4 for every alumni company (one snapshot each, 3 alumni fixtures + 105 bulk)', $q$select (select count(*) from public.company_snapshots s where s.period_key = '2026-Q4' and s.frozen_source = 'auto')::text$q$, '108');
update app_private.alumni_quarter_settings set auto_reminders = false;
select set_config('v68.tick5', app_private.alumni_quarter_tick('2027-06-29 12:00:00+02'::timestamptz)::text, false);
select v68_test.val('K09 auto_reminders OFF: the tick still freezes (2027-Q1) but sends no reminder', $q$select concat_ws('|', jsonb_array_length(current_setting('v68.tick5')::jsonb->'reminders')::text, (select count(*) from app_private.alumni_reminder_campaigns c where c.period_key = '2027-Q2')::text)$q$, '0|0');
update app_private.alumni_quarter_settings set auto_reminders = true;
select v68_test.val('K10 a quarter BEFORE the first tracked quarter never sends reminders (the 2026-Q3 tick)', $q$select jsonb_array_length(app_private.alumni_quarter_tick('2026-09-20 12:00:00+02'::timestamptz)->'reminders')::text$q$, '0');

-- ================================================================= P. the scheduler switch (pg_cron): a function, NOT a migration side effect
select v68_test.val('P01 nothing is scheduled by the migration', $q$select count(*)::text from cron.job where jobname = 'alumni-quarter-tick'$q$, '0');
select set_config('v68.en', app_private.alumni_quarter_scheduler_enable('*/10 * * * *')->>'enabled', false);
select v68_test.val('P02 enable schedules ONE job running the tick; status says so', $q$select concat_ws('|', current_setting('v68.en'), (select count(*) from cron.job where jobname = 'alumni-quarter-tick')::text, (select command from cron.job where jobname = 'alumni-quarter-tick'),
  (select schedule from cron.job where jobname = 'alumni-quarter-tick'))$q$, 'true|1|select app_private.alumni_quarter_tick()|*/10 * * * *');
select set_config('v68.dis', app_private.alumni_quarter_scheduler_disable()->>'enabled', false);
select v68_test.val('P02b disable removes it (back to nothing scheduled)', $q$select concat_ws('|', current_setting('v68.dis'), (select count(*) from cron.job where jobname = 'alumni-quarter-tick')::text)$q$, 'false|0');
select v68_test.err('P03 a bad cron expression is refused', $$select app_private.alumni_quarter_scheduler_enable('every minute please')$$, '22023');

-- ================================================================= N. no national ID anywhere in what the campaign wrote
select v68_test.val('N01 no notification, e-mail subject / body or campaign note of the campaign holds an ID-shaped number', $q$select (
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and (app_private.contains_id(n.title) or app_private.contains_id(n.body) or app_private.contains_id(n.metadata::text)))
  + (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and (app_private.contains_id(o.subject) or app_private.contains_id(o.body_html)))
  + (select count(*) from app_private.alumni_reminder_campaigns c where app_private.contains_id(coalesce(c.note, ''))))::text$q$, '0');

-- ================================================================= final state check
select current_setting('v68.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v68: reminders tests FAILED'; end $$;
\endif
