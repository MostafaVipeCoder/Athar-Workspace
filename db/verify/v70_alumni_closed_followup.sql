-- v70_alumni_closed_followup  (m70: closed companies keep the quarterly reminders with a DIFFERENT template and form: "what are you doing now?")
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e70x users / c70x companies / f70x founders):  AM = alumni_manager (e701), PM = project_manager (e702),
--   F1 = founder of CO1 (CLOSED, e703) AND of CO4 (an ACTIVE alumni company), F2 = founder of CO2 (CLOSED, e704, profile language en), F6 = a SECOND founder of CO2 (e706),
--   F3 = founder of CO3 (CLOSED, e705), F5 = founder of CO5 (a CLOSED company that is NOT alumni, e707).
-- NEVER call an app_private helper while the session role is anon / authenticated (helpers run as the owner; the tick's clock is an argument).
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v70.res', '', false) \gset

begin;
create schema v70_test;
grant usage on schema v70_test to public;
create or replace function v70_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v70.res', current_setting('v70.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v70_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v70_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v70_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v70_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v70_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v70_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
revoke all on all functions in schema v70_test from public;
grant execute on all functions in schema v70_test to anon, authenticated, service_role;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e701','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-am@example.invalid','{"provisioned":true}','{"full_name":"V70 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e702','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-pm@example.invalid','{"provisioned":true}','{"full_name":"V70 PM"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e703','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-f1@example.invalid','{"provisioned":true}','{"full_name":"V70 Founder One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e704','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-f2@example.invalid','{"provisioned":true}','{"full_name":"V70 Founder Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e705','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-f3@example.invalid','{"provisioned":true}','{"full_name":"V70 Founder Three"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e706','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-f6@example.invalid','{"provisioned":true}','{"full_name":"V70 Founder Six"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e707','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v70-f5@example.invalid','{"provisioned":true}','{"full_name":"V70 Founder Five"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e701','alumni_manager'), ('00000000-0000-4000-8000-00000000e702','project_manager'),
  ('00000000-0000-4000-8000-00000000e703','founder'), ('00000000-0000-4000-8000-00000000e704','founder'), ('00000000-0000-4000-8000-00000000e705','founder'),
  ('00000000-0000-4000-8000-00000000e706','founder'), ('00000000-0000-4000-8000-00000000e707','founder');
update public.profiles set language = 'en' where id = '00000000-0000-4000-8000-00000000e704';
insert into public.companies (id, name_en, name_ar, created_by, is_alumni, operating_status, closed_on) values
  ('00000000-0000-4000-8000-00000000c701', 'V70 Nile Co', 'نيل V70', null, true, 'closed', date '2026-03-01'),
  ('00000000-0000-4000-8000-00000000c702', 'V70 Delta Co', 'دلتا V70', null, true, 'closed', date '2026-04-01'),
  ('00000000-0000-4000-8000-00000000c703', 'V70 Giza Co', 'الجيزة V70', null, true, 'closed', date '2026-05-01'),
  ('00000000-0000-4000-8000-00000000c704', 'V70 Active Co', 'نشطة V70', null, true, 'open', null),
  ('00000000-0000-4000-8000-00000000c705', 'V70 Not Alumni', null, null, false, 'closed', date '2026-06-01');
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f701', 'V70 One', 'واحد', 'zz-v70-f1@example.invalid', '00000000-0000-4000-8000-00000000e703'),
  ('00000000-0000-4000-8000-00000000f702', 'V70 Two', 'اثنان', 'zz-v70-f2@example.invalid', '00000000-0000-4000-8000-00000000e704'),
  ('00000000-0000-4000-8000-00000000f703', 'V70 Three', 'ثلاثة', 'zz-v70-f3@example.invalid', '00000000-0000-4000-8000-00000000e705'),
  ('00000000-0000-4000-8000-00000000f706', 'V70 Six', 'ستة', 'zz-v70-f6@example.invalid', '00000000-0000-4000-8000-00000000e706'),
  ('00000000-0000-4000-8000-00000000f705', 'V70 Five', 'خمسة', 'zz-v70-f5@example.invalid', '00000000-0000-4000-8000-00000000e707');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c701', '00000000-0000-4000-8000-00000000f701', true), ('00000000-0000-4000-8000-00000000c704', '00000000-0000-4000-8000-00000000f701', false),
  ('00000000-0000-4000-8000-00000000c702', '00000000-0000-4000-8000-00000000f702', true), ('00000000-0000-4000-8000-00000000c702', '00000000-0000-4000-8000-00000000f706', false),
  ('00000000-0000-4000-8000-00000000c703', '00000000-0000-4000-8000-00000000f703', true), ('00000000-0000-4000-8000-00000000c705', '00000000-0000-4000-8000-00000000f705', true);
select set_config('request.jwt.claims', '', true);
select set_config('v70.fixture_companies', '{00000000-0000-4000-8000-00000000c701,00000000-0000-4000-8000-00000000c702,00000000-0000-4000-8000-00000000c703,00000000-0000-4000-8000-00000000c704,00000000-0000-4000-8000-00000000c705}', false);
select set_config('v70.cur', app_private.alumni_period_key(now()), false);
-- the platform address (without one no e-mail is created, m69), a custom sector for the in-use check, and a known sector / stage key
update app_private.alumni_quarter_settings set app_base_url = 'https://athar.example/app';
insert into public.alumni_lookups (kind, key, parent_key, label_en, label_ar, sort_order, is_system) values ('sector', 'v70_sector', null, 'V70 Sector', 'قطاع V70', 900, false);

-- ================================================================= C. catalog / privileges
select v70_test.val('C01 the answer table: anon reads nothing; an API role cannot write it directly nor read the actor column; the content columns are readable', $q$select concat_ws('|',
  has_table_privilege('anon', 'public.company_after_closing', 'SELECT')::text, has_table_privilege('authenticated', 'public.company_after_closing', 'INSERT')::text,
  has_table_privilege('authenticated', 'public.company_after_closing', 'UPDATE')::text, has_table_privilege('authenticated', 'public.company_after_closing', 'DELETE')::text,
  has_column_privilege('authenticated', 'public.company_after_closing', 'answered_by', 'SELECT')::text, has_column_privilege('authenticated', 'public.company_after_closing', 'answer_type', 'SELECT')::text)$q$,
  'false|false|false|false|false|true');
select v70_test.val('C02 RLS is enabled AND forced on the answer table', $q$select (select relrowsecurity::text || '|' || relforcerowsecurity::text from pg_class where oid = 'public.company_after_closing'::regclass)$q$, 'true|true');
select v70_test.val('C03 the three new RPCs: authenticated yes, anon no, definer with an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_company_after_closing', 'save_company_after_closing', 'list_alumni_closed_followups')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and p.prosecdef and 'search_path=""' = any (p.proconfig)$q$, '3');
select v70_test.val('C04 the reminder RPCs keep exactly ONE definition each (no left-over overload) and stay closed to anon', $q$select concat_ws('|', count(*)::text,
  (count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))::text, (count(*) filter (where p.prosecdef and 'search_path=""' = any (p.proconfig)))::text) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('send_alumni_reminders', 'preview_alumni_reminders', 'save_alumni_reminder_template', 'reset_alumni_reminder_template', 'preview_alumni_reminder_template')$q$, '5|0|5');
select v70_test.val('C05 the helpers of the follow-up are closed to the API roles', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('alumni_after_closing_key', 'alumni_after_closing_text', 'alumni_reminder_audience_closed', 'alumni_reminder_audience_v', 'alumni_closed_text', 'alumni_after_closing_json', 'alumni_reminder_audience', 'alumni_reminders_send',
                    'alumni_reminder_default', 'alumni_template_check', 'alumni_reminder_render')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v70_test.val('C06 the templates: four rows (figures + closed, ar + en), ALL flagged not finalised ("wording to be finalised by the owner")', $q$select string_agg(t.variant || '.' || t.lang || ':' || t.finalised::text, ',' order by t.variant, t.lang)
  from app_private.alumni_reminder_templates t$q$, 'closed.ar:false,closed.en:false,figures.ar:false,figures.en:false');
select v70_test.val('C07 idempotency is per (founder, quarter, kind, VARIANT)', $q$select (pg_get_constraintdef(c.oid) = 'UNIQUE (founder_id, period_key, kind, variant)')::text from pg_constraint c
  where c.conrelid = 'app_private.alumni_reminder_log'::regclass and c.conname = 'alumni_reminder_log_idem_variant_key'$q$, 'true');
select v70_test.err('C08 the answer rows hold one shape per type (CHECK): a new venture with an employer is refused', $$insert into public.company_after_closing (company_id, answer_type, venture_name, field_key, employer) values ('00000000-0000-4000-8000-00000000c701', 'new_startup', 'x', 'technology', 'Employer')$$, '23514');

-- ================================================================= T. the closed templates (manager only)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select v70_test.val('T01 settings: the figures templates are unchanged (2, default), the closed ones come separately (2, default) with their own placeholders (no {deadline})', $q$select concat_ws('|',
  jsonb_array_length(public.get_alumni_quarter_settings()->'templates')::text, jsonb_array_length(public.get_alumni_quarter_settings()->'closed_templates')::text,
  (public.get_alumni_quarter_settings()->'closed_templates'->0->>'is_default'), (public.get_alumni_quarter_settings()->'closed_templates'->0->>'variant'), (public.get_alumni_quarter_settings()->'templates'->0->>'variant'),
  jsonb_array_length(public.get_alumni_quarter_settings()->'closed_placeholders')::text, jsonb_array_length(public.get_alumni_quarter_settings()->'placeholders')::text)$q$, '2|2|true|closed|figures|4|5');
select public.save_alumni_reminder_template('en', '{"notif_title":"Hi {founder_name}, {company_name} / {quarter} {link}","finalised":true}'::jsonb, 'closed') is not null as ok;
select v70_test.val('T02 save a CLOSED template: placeholders accepted; it is no longer the default; the FIGURES template of the same language is untouched', $q$select concat_ws('|',
  (public.get_alumni_quarter_settings()->'closed_templates'->1->>'notif_title'), (public.get_alumni_quarter_settings()->'closed_templates'->1->>'finalised'), (public.get_alumni_quarter_settings()->'closed_templates'->1->>'is_default'),
  (public.get_alumni_quarter_settings()->'templates'->1->>'is_default'), (public.get_alumni_quarter_settings()->'templates'->1->>'finalised'))$q$, 'Hi {founder_name}, {company_name} / {quarter} {link}|true|false|true|false');
select v70_test.err('T03 {deadline} is refused in a closed template (no deadline for this question)', $$select public.save_alumni_reminder_template('en', '{"notif_body":"by {deadline}"}'::jsonb, 'closed')$$, '22023');
select v70_test.val('T04 ... and still accepted in the figures template', $q$select (public.save_alumni_reminder_template('en', '{"notif_body":"by {deadline}"}'::jsonb, 'figures') is not null)::text$q$, 'true');
select v70_test.err('T05 an unknown placeholder is refused', $$select public.save_alumni_reminder_template('en', '{"email_body":"Hello {nope}"}'::jsonb, 'closed')$$, '22023');
select v70_test.err('T06 a national-ID-shaped number is refused', $$select public.save_alumni_reminder_template('en', '{"email_body":"ref 29901011234567"}'::jsonb, 'closed')$$, '22023');
select v70_test.err('T07 a bad variant is refused', $$select public.save_alumni_reminder_template('en', '{"notif_title":"x"}'::jsonb, 'weekly')$$, '22023');
select v70_test.err('T08 ... and a NULL variant', $$select public.reset_alumni_reminder_template('en', null)$$, '22023');
select v70_test.val('T09 the closed preview renders the closed wording with the closed link and sample values, escaped', $q$select concat_ws('|',
  public.preview_alumni_reminder_template('en', '{"notif_title":"{company_name} / {founder_name}","email_body":"a <b> {link}"}'::jsonb, 'closed')->>'notif_title',
  (public.preview_alumni_reminder_template('en', '{"notif_title":"x","email_body":"{link}"}'::jsonb, 'closed')->>'email_html' like '%https://example.org/alumni/founder/after-closing%')::text,
  (public.preview_alumni_reminder_template('en', '{"email_body":"a <b> {link}"}'::jsonb, 'closed')->>'email_html' like '%a &lt;b&gt;%')::text,
  public.preview_alumni_reminder_template('ar', null, 'closed')->>'variant', (public.preview_alumni_reminder_template('ar', null, 'closed')->>'notif_title' like 'ما أخبارك بعد%')::text)$q$, 'Nile Tech / Sara Ahmed|true|true|closed|true');
select v70_test.err('T10 the closed preview refuses {deadline}', $$select public.preview_alumni_reminder_template('en', '{"notif_title":"{deadline}"}'::jsonb, 'closed')$$, '22023');
select public.reset_alumni_reminder_template('en', 'closed') is not null as ok;
select public.reset_alumni_reminder_template('en', 'figures') is not null as ok;
select v70_test.val('T11 reset restores the default of THAT variant only and clears "finalised"', $q$select concat_ws('|', (public.get_alumni_quarter_settings()->'closed_templates'->1->>'is_default'), (public.get_alumni_quarter_settings()->'closed_templates'->1->>'finalised'),
  (public.get_alumni_quarter_settings()->'templates'->1->>'is_default'))$q$, 'true|false|true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e703","role":"authenticated"}', true);
set local role authenticated;
select v70_test.err('T20 a founder cannot edit a closed template', $$select public.save_alumni_reminder_template('en', '{"notif_title":"x"}'::jsonb, 'closed')$$, '42501');
select v70_test.err('T21 ... cannot preview the audiences', $$select public.preview_alumni_reminders(null, null, null, false, 'closed')$$, '42501');
select v70_test.err('T22 ... cannot send', $$select public.send_alumni_reminders(null, null, null, false, null, null, null, 'closed')$$, '42501');
select v70_test.err('T23 ... cannot read the follow-up list', $$select public.list_alumni_closed_followups()$$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e702","role":"authenticated"}', true);
set local role authenticated;
select v70_test.err('T24 a project manager cannot read the follow-up list', $$select public.list_alumni_closed_followups()$$, '42501');
select v70_test.err('T25 ... nor read an answer', $$select public.get_company_after_closing('00000000-0000-4000-8000-00000000c701')$$, '42501');
reset role;
-- (anon: no EXECUTE / SELECT is proven by C01 / C03 / C04 through the catalog: calling a function anon may not execute crashes this image)

-- ================================================================= A. the two audiences (preview)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.pre', public.preview_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[])::text, false);
select set_config('v70.pre_c', public.preview_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[], null, false, 'closed')::text, false);
select set_config('v70.pre_f', public.preview_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[], null, false, 'figures')::text, false);
reset role;
select v70_test.val('A01 two audiences: FIGURES = F1 (his active company CO4) = 1; CLOSED = F1 (CO1), F2 + F6 (CO2), F3 (CO3) = 4 (not F5: the company is not alumni); total 5; all have an e-mail', $q$select concat_ws('|',
  current_setting('v70.pre')::jsonb->>'recipients', current_setting('v70.pre')::jsonb->'closed'->>'recipients', current_setting('v70.pre')::jsonb->>'total', current_setting('v70.pre')::jsonb->'closed'->>'with_email',
  current_setting('v70.pre')::jsonb->'closed'->>'without_email', current_setting('v70.pre')::jsonb->>'confirm_above', current_setting('v70.pre')::jsonb->>'period')$q$, '1|4|5|4|0|100|' || current_setting('v70.cur'));
select v70_test.val('A02 the audience filter: "closed" only = figures zero / closed 4; "figures" only = closed zero / figures 1', $q$select concat_ws('|',
  current_setting('v70.pre_c')::jsonb->>'recipients', current_setting('v70.pre_c')::jsonb->'closed'->>'recipients', current_setting('v70.pre_c')::jsonb->>'total',
  current_setting('v70.pre_f')::jsonb->>'recipients', current_setting('v70.pre_f')::jsonb->'closed'->>'recipients', current_setting('v70.pre_f')::jsonb->>'total')$q$, '0|4|4|1|0|1');
select v70_test.val('A03 the closed sample names the closed companies and carries masked e-mails only', $q$select concat_ws('|', jsonb_array_length(current_setting('v70.pre')::jsonb->'closed'->'sample')::text,
  (current_setting('v70.pre')::jsonb::text like '%zz-v70-f1@example.invalid%')::text, (current_setting('v70.pre')::jsonb->'closed'->'sample'->0 ? 'email_masked')::text,
  (select (s->'companies_en')::text from jsonb_array_elements(current_setting('v70.pre')::jsonb->'closed'->'sample') s where s->>'founder_id' = '00000000-0000-4000-8000-00000000f701'))$q$, '4|false|true|["V70 Nile Co"]');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select v70_test.err('A04 a bad audience is refused (preview and send)', $$select public.preview_alumni_reminders(null, null, null, false, 'everyone')$$, '22023');
select v70_test.err('A05 ... send', $$select public.send_alumni_reminders(null, null, null, false, 'tok-v70-bad001', null, null, 'everyone')$$, '22023');
reset role;

-- ================================================================= M. manual sending: both audiences, idempotent per (founder, quarter, kind, variant)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.s1', public.send_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[], null, false, 'tok-v70-0001', null, null)::text, false);
select set_config('v70.s1b', public.send_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[], null, false, 'tok-v70-0001', null, null)::text, false);
reset role;
select v70_test.val('M01 the first send: figures 1 + closed 4 = 5 notifications and 5 e-mails queued (one campaign)', $q$select concat_ws('|', current_setting('v70.s1')::jsonb->>'sent', current_setting('v70.s1')::jsonb->'figures'->>'sent', current_setting('v70.s1')::jsonb->'closed'->>'sent',
  current_setting('v70.s1')::jsonb->>'no_email',
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text,
  (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.recipient_email::text like 'zz-v70-%')::text,
  (select count(*) from app_private.alumni_reminder_campaigns c where c.id = (current_setting('v70.s1')::jsonb->>'campaign_id')::uuid)::text)$q$, '5|1|4|0|5|5|1');
select v70_test.val('M02 the SAME dialog sent twice (same token) = NO duplicates: 0 new, 5 already sent, still 5 + 5 rows', $q$select concat_ws('|', current_setting('v70.s1b')::jsonb->>'sent', current_setting('v70.s1b')::jsonb->>'already_sent',
  (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text,
  (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and o.recipient_email::text like 'zz-v70-%')::text)$q$, '0|5|5|5');
select v70_test.val('M03 F1 (an active AND a closed company) got ONE reminder of each variant, each with ITS link; the log keeps (founder, quarter, kind, variant) unique', $q$select string_agg(l.variant || ':' || (n.metadata->>'link'), ',' order by l.variant)
  from app_private.alumni_reminder_log l join public.notifications n on n.id = l.notification_id where l.founder_id = '00000000-0000-4000-8000-00000000f701'$q$,
  'closed:/alumni/founder/after-closing?company=00000000-0000-4000-8000-00000000c701,figures:/alumni/founder/progress?company=00000000-0000-4000-8000-00000000c704');
select v70_test.val('M04 the CLOSED wording is used (not the figures one): arabic for F1, english for F2 (his profile language), both languages in the metadata, variant closed', $q$select concat_ws('|',
  (select (n.title like 'ما أخبارك بعد%نيل V70%' and n.metadata->>'variant' = 'closed' and (n.metadata->>'title_en') like 'How are you doing after V70 Nile Co%')::text from public.notifications n
    where n.founder_id = '00000000-0000-4000-8000-00000000f701' and n.metadata->>'variant' = 'closed'),
  (select (n.title = 'How are you doing after V70 Delta Co?' and n.body like '%what you are doing now%')::text from public.notifications n where n.founder_id = '00000000-0000-4000-8000-00000000f702'),
  (select count(*)::text from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and n.metadata->>'variant' = 'closed' and (n.title ilike '%figures%' or n.body ilike '%revenue%')))$q$, 'true|true|0');
select v70_test.val('M05 the closed e-mail: its link opens the after-closing form of HIS company with the app address, no deadline text, a separate idempotency key (suffix :closed), the figures e-mail of F1 keeps the old key', $q$select concat_ws('|',
  (select (o.body_html like '%https://athar.example/app/alumni/founder/after-closing?company=00000000-0000-4000-8000-00000000c701%')::text from app_private.email_outbox o where o.idempotency_key like 'alumni_reminder:00000000-0000-4000-8000-00000000f701:%:closed'),
  (select (o.idempotency_key = 'alumni_reminder:00000000-0000-4000-8000-00000000f701:' || current_setting('v70.cur') || ':manual:tok-v70-0001:closed')::text from app_private.email_outbox o where o.idempotency_key like 'alumni_reminder:00000000-0000-4000-8000-00000000f701:%:closed'),
  (select count(*)::text from app_private.email_outbox o where o.idempotency_key = 'alumni_reminder:00000000-0000-4000-8000-00000000f701:' || current_setting('v70.cur') || ':manual:tok-v70-0001'),
  (select count(*)::text from app_private.email_outbox o where o.idempotency_key like '%:closed' and o.recipient_email::text like 'zz-v70-%'))$q$, 'true|true|1|4');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.s2', public.send_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[], null, true, 'tok-v70-0002', null, null)::text, false);
select set_config('v70.s3', public.send_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[], null, false, 'tok-v70-0003', null, null, 'closed')::text, false);
select v70_test.val('M06 "only founders not reminded yet" after a first send: nobody left in EITHER audience (the variant is part of "already reminded")', $q$select concat_ws('|', current_setting('v70.s2')::jsonb->>'sent', current_setting('v70.s2')::jsonb->'closed'->>'audience')$q$, '0|0');
reset role;
select v70_test.val('M07 a deliberate resend to the CLOSED audience only (a new token): 4 more closed reminders, no figures reminder', $q$select concat_ws('|', current_setting('v70.s3')::jsonb->'closed'->>'sent', current_setting('v70.s3')::jsonb->'figures'->>'sent',
  (select count(*) from app_private.alumni_reminder_log l where l.variant = 'closed' and l.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text,
  (select count(*) from app_private.alumni_reminder_log l where l.variant = 'figures' and l.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text)$q$, '4|0|8|1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select v70_test.val('M08 the campaign list shows the closed share of every campaign', $q$select string_agg((r->>'recipients') || ':' || (r->>'closed_recipients'), ',' order by (r->>'recipients')::int desc)
  from jsonb_array_elements(public.list_alumni_reminder_campaigns(current_setting('v70.cur'))->'rows') r where (r->>'recipients')::int in (4, 5)$q$, '5:4,4:4');
select v70_test.val('M09 the quarter status page counts only the FIGURES reminders of a company: the closed company CO2 shows 0', $q$select (r->'reminders'->>'count')
  from jsonb_array_elements(public.list_alumni_quarter_status(current_setting('v70.cur'), '{}'::jsonb, null, 500)->'rows') r where r->>'name_en' = 'V70 Delta Co'$q$, '0');
reset role;

-- ================================================================= R. the answer: founders, validation, one row, no history
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e705","role":"authenticated"}', true);
set local role authenticated;
select v70_test.val('R01 F3 opens the form of his CLOSED company: closed = true, no answer yet, this quarter not answered', $q$select concat_ws('|', public.get_company_after_closing('00000000-0000-4000-8000-00000000c703')->>'closed',
  (public.get_company_after_closing('00000000-0000-4000-8000-00000000c703')->'answer')::text, public.get_company_after_closing('00000000-0000-4000-8000-00000000c703')->>'answered_this_period',
  public.get_company_after_closing('00000000-0000-4000-8000-00000000c703')->>'current_period')$q$, 'true|null|false|' || current_setting('v70.cur'));
select v70_test.err('R02 ... another founder''s company is forbidden (read)', $$select public.get_company_after_closing('00000000-0000-4000-8000-00000000c701')$$, '42501');
select v70_test.err('R03 ... and (write)', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c701', '{"answer_type":"other","other_text":"x"}'::jsonb)$$, '42501');
select v70_test.err('R04 a missing answer type', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"other_text":"x"}'::jsonb)$$, '22023');
select v70_test.err('R05 an unknown answer type', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"retired"}'::jsonb)$$, '22023');
select v70_test.err('R06 a new venture needs its name', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","field":"technology"}'::jsonb)$$, '22023');
select v70_test.err('R07 ... and its field', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"X"}'::jsonb)$$, '22023');
select v70_test.err('R08 ... a field that is not in the vocabulary', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"X","field":"nope"}'::jsonb)$$, '22023');
select v70_test.err('R09 ... a stage that is not in the vocabulary', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"X","field":"technology","venture_stage":"nope"}'::jsonb)$$, '22023');
select v70_test.err('R10 ... a javascript: link', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"X","field":"technology","venture_url":"javascript:alert(1)"}'::jsonb)$$, '22023');
select v70_test.err('R11 ... a national-ID-shaped number in the description', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"X","field":"technology","venture_description":"id 29901011234567"}'::jsonb)$$, '22023');
select v70_test.err('R12 ... a too long name', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', jsonb_build_object('answer_type', 'new_startup', 'venture_name', repeat('x', 151), 'field', 'technology'))$$, '22023');
select v70_test.err('R13 ... an unknown key', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"other","other_text":"x","admin":true}'::jsonb)$$, '22023');
select v70_test.err('R14 ... wants_programs must be a boolean', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"X","field":"technology","wants_programs":"yes"}'::jsonb)$$, '22023');
select v70_test.err('R15 employed needs the employer, the role and the field', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"employed","job_title":"Dev","field":"technology"}'::jsonb)$$, '22023');
select v70_test.err('R16 ... the role', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"employed","employer":"ACME","field":"technology"}'::jsonb)$$, '22023');
select v70_test.err('R17 other needs its text', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"other","other_text":"   "}'::jsonb)$$, '22023');
select v70_test.err('R18 a NULL / non-object payload', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', null)$$, '22023');
select v70_test.err('R19 a NULL company', $$select public.save_company_after_closing(null, '{"answer_type":"other","other_text":"x"}'::jsonb)$$, 'P0002');
select v70_test.val('R20 nothing was written by the refused attempts', $q$select count(*)::text from public.company_after_closing$q$, '0');
select set_config('v70.r21', public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"new_startup","venture_name":"  V70 Venture  ","field":"technology","venture_stage":"idea_stage","venture_url":"https://venture.example/x","venture_description":"A short text","wants_programs":true,"employer":"ignored","other_text":"ignored"}'::jsonb)::text, false);
select v70_test.val('R21 F3 saves a NEW VENTURE: trimmed, fields of the other types dropped, the interest flag kept, this quarter answered, answered_source founder', $q$select concat_ws('|',
  current_setting('v70.r21')::jsonb->>'saved', current_setting('v70.r21')::jsonb->'answer'->>'answer_type', current_setting('v70.r21')::jsonb->'answer'->>'venture_name', current_setting('v70.r21')::jsonb->'answer'->>'field',
  current_setting('v70.r21')::jsonb->'answer'->>'wants_programs', (current_setting('v70.r21')::jsonb->'answer'->>'employer'), (current_setting('v70.r21')::jsonb->'answer'->>'other_text'),
  current_setting('v70.r21')::jsonb->>'answered_this_period', current_setting('v70.r21')::jsonb->'answer'->>'answered_source', ((current_setting('v70.r21')::jsonb->'answer'->>'answered_at') is not null)::text,
  (current_setting('v70.r21')::jsonb->'answer' ? 'answered_by')::text)$q$, 'true|new_startup|V70 Venture|technology|true|true|founder|true|false');
select v70_test.val('R22 he can read his own row directly (RLS), the actor column is not readable', $q$select concat_ws('|', count(*)::text, min(answer_type), min(venture_name)) from public.company_after_closing$q$, '1|new_startup|V70 Venture');
select v70_test.err('R23 ... but cannot write the table directly', $$update public.company_after_closing set wants_programs = false$$, '42501');
select v70_test.err('R24 ... nor read the actor column', $$select answered_by from public.company_after_closing$$, '42501');
select public.save_company_after_closing('00000000-0000-4000-8000-00000000c703', '{"answer_type":"employed","employer":"ACME","job_title":"Developer","field":"technology","wants_programs":true,"venture_name":"old"}'::jsonb) is not null as ok;
select v70_test.val('R25 he changes his answer to EMPLOYED: the latest answer replaces the previous (ONE row, no history), the venture fields and the interest flag are cleared', $q$select concat_ws('|', count(*)::text, min(answer_type), min(employer), min(job_title),
  coalesce(min(venture_name), '-'), min(wants_programs::text), coalesce(min(venture_url), '-'))
  from public.company_after_closing$q$, '1|employed|ACME|Developer|-|false|-');
select v70_test.val('R26 the history of answers is NOT kept (no table, no log of the edits)', $q$select count(*)::text from information_schema.tables where table_schema in ('public', 'app_private') and table_name ~ '(after_closing|closed_followup).*(history|log|audit)'$q$, '0');
reset role;
select v70_test.val('R27 the row of F3: his own account stamped it, the source is founder', $q$select concat_ws('|', (a.answered_by = '00000000-0000-4000-8000-00000000e705')::text, a.answered_source, (a.answered_at > now() - interval '1 minute')::text)
  from public.company_after_closing a where a.company_id = '00000000-0000-4000-8000-00000000c703'$q$, 'true|founder|true');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e703","role":"authenticated"}', true);
set local role authenticated;
select v70_test.val('R28 F1 (founder of CO1 and CO4) sees no row of another company', $q$select count(*)::text from public.company_after_closing$q$, '0');
select v70_test.err('R29 ... his ACTIVE company has no such question', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c704', '{"answer_type":"other","other_text":"x"}'::jsonb)$$, 'alumni_not_closed');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e707","role":"authenticated"}', true);
set local role authenticated;
select v70_test.err('R30 F5: a closed company that is NOT alumni is not part of this (not found)', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c705', '{"answer_type":"other","other_text":"x"}'::jsonb)$$, 'P0002');
select v70_test.val('R31 ... and F5 reads no row at all', $q$select count(*)::text from public.company_after_closing$q$, '0');
reset role;

-- ================================================================= S. a company that answered leaves the closed audience for THIS quarter
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select v70_test.val('S01 after F3 answered: the closed audience is 3 (F1, F2, F6); the figures audience is untouched', $q$select concat_ws('|', public.preview_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[])->'closed'->>'recipients',
  public.preview_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[])->>'recipients')$q$, '3|1');
-- the manager fills the answer of CO2 on behalf of the founders; the co-founder reminders stop for this quarter
select set_config('v70.r32', public.save_company_after_closing('00000000-0000-4000-8000-00000000c702', '{"answer_type":"new_startup","venture_name":"V70 Venture Two","field":"v70_sector","wants_programs":true}'::jsonb)::text, false);
select v70_test.val('S02 the manager saves the answer of CO2 (source manager); BOTH founders of CO2 leave the audience (one answer per company): closed = 1 (F1)', $q$select concat_ws('|', current_setting('v70.r32')::jsonb->'answer'->>'answered_source',
  public.preview_alumni_reminders(null, current_setting('v70.fixture_companies')::uuid[])->'closed'->>'recipients')$q$, 'manager|1');
select v70_test.err('S03 the manager is refused for an OPEN company too (not closed)', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c704', '{"answer_type":"other","other_text":"x"}'::jsonb)$$, 'alumni_not_closed');
select v70_test.err('S04 a vocabulary value an answer uses cannot be deleted from the vocabulary', $$select public.delete_alumni_lookup('sector', 'v70_sector')$$, '23503');
reset role;

-- ================================================================= L. the manager's follow-up list
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.l1', public.list_alumni_closed_followups('{}'::jsonb)::text, false);
select v70_test.val('L01 the closed alumni companies of the fixture are listed (not the active CO4, not the non-alumni CO5); the real closed companies of the database are included in the count', $q$select concat_ws('|',
  (select count(*)::text from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->>'name_en' like 'V70 %'), (select count(*)::text from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->>'name_en' in ('V70 Active Co', 'V70 Not Alumni')),
  current_setting('v70.l1')::jsonb->>'current_period')$q$, '3|0|' || current_setting('v70.cur'));
select v70_test.val('L02 counts over the closed companies: answered / not answered / types / interested (the fixture: answered 2 = employed 1 + new_startup 1; not answered 1 = CO1; interested 1)', $q$select concat_ws('|',
  (select count(*) from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->>'name_en' like 'V70 %' and r->'answer' <> 'null'::jsonb),
  (select count(*) from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->>'name_en' like 'V70 %' and r->'answer' = 'null'::jsonb),
  (select count(*) from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->'answer'->>'answer_type' = 'employed'),
  (select count(*) from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->'answer'->>'answer_type' = 'new_startup' and (r->'answer'->>'wants_programs')::boolean))$q$, '2|1|1|1');
select v70_test.val('L03 a row carries the latest answer (type, venture, field, employer, answered date) and the founder', $q$select concat_ws('|', r->'answer'->>'answer_type', r->'answer'->>'employer', r->'answer'->>'job_title', r->'answer'->>'field', ((r->'answer'->>'answered_at') is not null)::text,
  r->'founder'->>'name_en', r->>'closed_on')
  from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->>'name_en' = 'V70 Giza Co'$q$, 'employed|ACME|Developer|technology|true|V70 Three|2026-05-01');
select v70_test.val('L04 reminders of the closed variant are counted per company (CO1: F1 was reminded twice = 2; CO3: F3 twice = 2)', $q$select string_agg(r->>'name_en' || ':' || (r->'reminders'->>'count'), ',' order by r->>'name_en')
  from jsonb_array_elements(current_setting('v70.l1')::jsonb->'rows') r where r->>'name_en' in ('V70 Nile Co', 'V70 Giza Co')$q$, 'V70 Giza Co:2,V70 Nile Co:2');
select v70_test.val('L05 filter: NOT ANSWERED yet = CO1 only (of the fixture)', $q$select string_agg(r->>'name_en', ',') from jsonb_array_elements(public.list_alumni_closed_followups('{}'::jsonb, 'not_answered')->'rows') r where r->>'name_en' like 'V70 %'$q$, 'V70 Nile Co');
select v70_test.val('L06 filter: type employed = CO3; type new_startup = CO2', $q$select concat_ws('|', (select string_agg(r->>'name_en', ',') from jsonb_array_elements(public.list_alumni_closed_followups('{}'::jsonb, null, 'employed')->'rows') r where r->>'name_en' like 'V70 %'),
  (select string_agg(r->>'name_en', ',') from jsonb_array_elements(public.list_alumni_closed_followups('{}'::jsonb, null, 'new_startup')->'rows') r where r->>'name_en' like 'V70 %'))$q$, 'V70 Giza Co|V70 Delta Co');
select v70_test.val('L07 filter: interested in programs = CO2; not interested = CO1 + CO3', $q$select concat_ws('|', (select string_agg(r->>'name_en', ',') from jsonb_array_elements(public.list_alumni_closed_followups('{}'::jsonb, null, null, true)->'rows') r where r->>'name_en' like 'V70 %'),
  (select string_agg(r->>'name_en', ',' order by r->>'name_en') from jsonb_array_elements(public.list_alumni_closed_followups('{}'::jsonb, null, null, false)->'rows') r where r->>'name_en' like 'V70 %'))$q$, 'V70 Delta Co|V70 Giza Co,V70 Nile Co');
select v70_test.val('L08 paging + sort: the newest answer first, one row per page, the total is kept', $q$select concat_ws('|', (public.list_alumni_closed_followups('{}'::jsonb, 'answered', null, null, 1, 0, 'answered', 'desc')->>'total'),
  jsonb_array_length(public.list_alumni_closed_followups('{}'::jsonb, 'answered', null, null, 1, 0, 'answered', 'desc')->'rows')::text,
  (public.list_alumni_closed_followups('{}'::jsonb, 'answered', null, null, 1, 0, 'answered', 'desc')->'rows'->0->>'name_en'))$q$, '2|1|V70 Delta Co');
select v70_test.err('L09 a bad status / type / sort / direction is refused', $$select public.list_alumni_closed_followups('{}'::jsonb, 'maybe')$$, '22023');
select v70_test.err('L10 ... type', $$select public.list_alumni_closed_followups('{}'::jsonb, null, 'retired')$$, '22023');
select v70_test.err('L11 ... sort', $$select public.list_alumni_closed_followups('{}'::jsonb, null, null, null, 50, 0, 'drop', 'asc')$$, '22023');
select v70_test.val('L12 a limit above 500 is capped; a NULL filter is accepted', $q$select concat_ws('|', public.list_alumni_closed_followups(null, null, null, null, 100000)->>'limit', (public.list_alumni_closed_followups(null)->>'total') is not null)$q$, '500|t');
reset role;

-- ================================================================= D. "After closing" in the directory table and the Excel export is filled from the answer
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.tb', public.list_alumni_table('{"scope":"all","q":"v70"}'::jsonb, 25, 0, 'name', 'asc', 2026)::text, false);
select set_config('v70.ex', public.export_alumni_rows('{"scope":"all","q":"v70"}'::jsonb, 2026, 'en', null)::text, false);
select set_config('v70.exar', public.export_alumni_rows('{"scope":"all","q":"v70"}'::jsonb, 2026, 'ar', null)::text, false);
reset role;
select v70_test.val('D01 the manager table: "after_closing" = the answer type (employed / new_startup); the company without an answer shows its typed value (none)', $q$select string_agg((r->>'name_en') || ':' || coalesce(r->>'after_closing', '-'), ',' order by r->>'name_en')
  from jsonb_array_elements(current_setting('v70.tb')::jsonb->'rows') r where r->>'name_en' like 'V70 %'$q$, 'V70 Active Co:-,V70 Delta Co:new_startup,V70 Giza Co:employed,V70 Nile Co:-,V70 Not Alumni:-');
select v70_test.val('D02 the Excel export: the "After closing" column carries the label and the detail (the venture name / the employer), in both languages', $q$select concat_ws('|',
  (current_setting('v70.ex') like '%Started a new venture - V70 Venture Two%')::text, (current_setting('v70.ex') like '%Took a job - ACME%')::text, (current_setting('v70.exar') like '%بدأ مشروعًا جديدًا - V70 Venture Two%')::text)$q$, 'true|true|true');
-- typed value stays the fallback; an answer overrides it; a reopened company shows the typed value again (none: the CHECK clears it)
update public.companies set after_closing_key = 'studying' where id = '00000000-0000-4000-8000-00000000c701';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.tb2', public.list_alumni_table('{"scope":"all","q":"v70"}'::jsonb, 25, 0, 'name', 'asc', 2026)::text, false);
reset role;
select v70_test.val('D03 a closed company WITHOUT an answer keeps its typed "After closing" (studying)', $q$select r->>'after_closing' from jsonb_array_elements(current_setting('v70.tb2')::jsonb->'rows') r where r->>'name_en' = 'V70 Nile Co'$q$, 'studying');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e703","role":"authenticated"}', true);
set local role authenticated;
select public.save_company_after_closing('00000000-0000-4000-8000-00000000c701', '{"answer_type":"other","other_text":"Travelling for a year"}'::jsonb) is not null as ok;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.tb3', public.list_alumni_table('{"scope":"all","q":"v70"}'::jsonb, 25, 0, 'name', 'asc', 2026)::text, false);
reset role;
select v70_test.val('D04 ... and once the founder answered, the answer wins (other)', $q$select r->>'after_closing' from jsonb_array_elements(current_setting('v70.tb3')::jsonb->'rows') r where r->>'name_en' = 'V70 Nile Co'$q$, 'other');

-- ================================================================= K. the scheduler: next quarter the same founders are asked again, with the closed wording
select set_config('v70.tick', app_private.alumni_quarter_tick('2027-03-29 12:00:00+02'::timestamptz)::text, false);
select v70_test.val('K01 in the NEXT quarter (2027-Q1) the founders who answered are reminded AGAIN (reminders continue every quarter): closed variant F1, F2, F6, F3 = 4 + figures F1 = 1, ONE campaign d3', $q$select concat_ws('|',
  (select count(*) from app_private.alumni_reminder_log l where l.period_key = '2027-Q1' and l.variant = 'closed' and l.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text,
  (select count(*) from app_private.alumni_reminder_log l where l.period_key = '2027-Q1' and l.variant = 'figures' and l.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text,
  (select string_agg(c.kind || ':' || c.status, ',' order by c.kind) from app_private.alumni_reminder_campaigns c where c.period_key = '2027-Q1'))$q$, '4|1|d14:superseded,d3:done');
select set_config('v70.tick2', app_private.alumni_quarter_tick('2027-03-29 12:30:00+02'::timestamptz)::text, false);
select v70_test.val('K02 the tick run again changes nothing (idempotent per founder, quarter, kind, variant)', $q$select (select count(*) from app_private.alumni_reminder_log l where l.period_key = '2027-Q1' and l.founder_id::text like '00000000-0000-4000-8000-00000000f70%')::text$q$, '5');
select v70_test.val('K03 the 2026-Q4 quarter was frozen by the tick, and a FROZEN quarter has no closed audience any more (nothing to ask for a closed quarter)', $q$select concat_ws('|',
  (select count(*) from public.company_snapshots s where s.period_key = '2026-Q4' and s.company_id = '00000000-0000-4000-8000-00000000c703')::text,
  (select count(*) from app_private.alumni_reminder_audience_closed(current_setting('v70.cur'), current_setting('v70.fixture_companies')::uuid[], null, false))::text)$q$, '1|0');

-- ================================================================= O. a company that is OPEN again leaves everything; the answer stays on record but is not shown as "After closing"
update public.companies set operating_status = 'open', closed_on = null, closing_reason_key = null, after_closing_key = null, closing_note = null where id = '00000000-0000-4000-8000-00000000c701';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e701","role":"authenticated"}', true);
set local role authenticated;
select set_config('v70.tb4', public.list_alumni_table('{"scope":"all","q":"v70"}'::jsonb, 25, 0, 'name', 'asc', 2026)::text, false);
select v70_test.val('O01 the reopened company is gone from the follow-up list and its "After closing" is empty again', $q$select concat_ws('|',
  (select count(*)::text from jsonb_array_elements(public.list_alumni_closed_followups('{}'::jsonb)->'rows') r where r->>'name_en' = 'V70 Nile Co'),
  (select coalesce(r->>'after_closing', '-') from jsonb_array_elements(current_setting('v70.tb4')::jsonb->'rows') r where r->>'name_en' = 'V70 Nile Co'))$q$, '0|-');
select v70_test.val('O02 the form says the company is not closed (the app shows the figures instead)', $q$select public.get_company_after_closing('00000000-0000-4000-8000-00000000c701')->>'closed'$q$, 'false');
select v70_test.err('O03 ... and refuses a new answer', $$select public.save_company_after_closing('00000000-0000-4000-8000-00000000c701', '{"answer_type":"other","other_text":"x"}'::jsonb)$$, 'alumni_not_closed');
reset role;

-- ================================================================= N. no national ID anywhere in what the follow-up wrote
select v70_test.val('N01 no answer text, notification, e-mail subject / body of the campaigns holds an ID-shaped number', $q$select (
  (select count(*) from public.company_after_closing a where app_private.contains_id(concat_ws(' ', a.venture_name, a.venture_description, a.employer, a.job_title, a.other_text, a.venture_url)))
  + (select count(*) from public.notifications n where n.metadata->>'kind' = 'quarter_reminder' and (app_private.contains_id(n.title) or app_private.contains_id(n.body) or app_private.contains_id(n.metadata::text)))
  + (select count(*) from app_private.email_outbox o where o.email_key = 'alumni_quarter_reminder' and (app_private.contains_id(o.subject) or app_private.contains_id(o.body_html))))::text$q$, '0');

-- ================================================================= final state check
select current_setting('v70.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v70: closed follow-up tests FAILED'; end $$;
\endif
