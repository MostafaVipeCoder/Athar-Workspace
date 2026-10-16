-- v69_alumni_quarter_review_fixes  (m69: year roll-up consistency, status at the end of the quarter, snapshot column privileges, alumni-only founder saves, the reminder audience and link)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e69x users / c69x companies / f69x founders):  AM = alumni_manager (e691), F1 = founder of CO1 (e693, alumni), F2 = founder of CO2 (e694, alumni, CLOSED on 2026-09-01),
--   F3 = founder of CO3 (e695, NOT alumni), F4 = founder of CO4 (e696, alumni, a BANNED account)
-- NEVER call an app_private helper while the session role is anon / authenticated: helpers are called as the owner.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v69.res', '', false) \gset

begin;
create schema v69_test;
grant usage on schema v69_test to public;
create or replace function v69_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v69.res', current_setting('v69.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v69_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v69_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v69_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v69_test.err(p_key text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v69_test.t(p_key, false, 'no error, wanted ' || p_expect);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v69_test.t(p_key, sqlstate = p_expect or coalesce(v_hint, '') = p_expect, 'got ' || sqlstate || '/' || coalesce(v_hint, '-') || ': ' || left(sqlerrm, 100) || ', want ' || p_expect);
  end;
end $$;
create or replace function v69_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v69_test.t(p_key, true, 'ok');
  exception when others then
    perform v69_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v69_test from public;
grant execute on all functions in schema v69_test to anon, authenticated, service_role;

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until) values
 ('00000000-0000-4000-8000-00000000e691','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v69-am@example.invalid','{"provisioned":true}','{"full_name":"V69 Alumni Manager"}', now(), now(), null),
 ('00000000-0000-4000-8000-00000000e693','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v69-f1@example.invalid','{"provisioned":true}','{"full_name":"V69 Founder One"}', now(), now(), null),
 ('00000000-0000-4000-8000-00000000e694','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v69-f2@example.invalid','{"provisioned":true}','{"full_name":"V69 Founder Two"}', now(), now(), null),
 ('00000000-0000-4000-8000-00000000e695','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v69-f3@example.invalid','{"provisioned":true}','{"full_name":"V69 Founder Three"}', now(), now(), null),
 ('00000000-0000-4000-8000-00000000e696','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v69-f4@example.invalid','{"provisioned":true}','{"full_name":"V69 Founder Four"}', now(), now(), now() + interval '30 days');
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e691','alumni_manager'),
  ('00000000-0000-4000-8000-00000000e693','founder'), ('00000000-0000-4000-8000-00000000e694','founder'), ('00000000-0000-4000-8000-00000000e695','founder'), ('00000000-0000-4000-8000-00000000e696','founder');
insert into public.companies (id, name_en, name_ar, created_by, is_alumni, created_at) values
  ('00000000-0000-4000-8000-00000000c691', 'V69 Roll Co', 'رول V69', '00000000-0000-4000-8000-00000000e693', true, '2025-01-01'),
  ('00000000-0000-4000-8000-00000000c692', 'V69 Closed Co', 'مغلقة V69', '00000000-0000-4000-8000-00000000e694', true, '2025-01-01'),
  ('00000000-0000-4000-8000-00000000c693', 'V69 Not Alumni Co', null, '00000000-0000-4000-8000-00000000e695', false, '2025-01-01'),
  ('00000000-0000-4000-8000-00000000c694', 'V69 Banned Co', null, '00000000-0000-4000-8000-00000000e696', true, '2025-01-01');
update public.companies set operating_status = 'closed', closed_on = '2026-09-01' where id = '00000000-0000-4000-8000-00000000c692';
insert into public.founders (id, name_en, name_ar, email, auth_user_id) values
  ('00000000-0000-4000-8000-00000000f691', 'V69 One', 'واحد', 'zz-v69-f1@example.invalid', '00000000-0000-4000-8000-00000000e693'),
  ('00000000-0000-4000-8000-00000000f692', 'V69 Two', 'اثنان', 'zz-v69-f2@example.invalid', '00000000-0000-4000-8000-00000000e694'),
  ('00000000-0000-4000-8000-00000000f693', 'V69 Three', 'ثلاثة', 'zz-v69-f3@example.invalid', '00000000-0000-4000-8000-00000000e695'),
  ('00000000-0000-4000-8000-00000000f694', 'V69 Four', 'أربعة', 'zz-v69-f4@example.invalid', '00000000-0000-4000-8000-00000000e696');
insert into public.company_founders (company_id, founder_id, is_primary) values
  ('00000000-0000-4000-8000-00000000c691', '00000000-0000-4000-8000-00000000f691', true),
  ('00000000-0000-4000-8000-00000000c692', '00000000-0000-4000-8000-00000000f692', true),
  ('00000000-0000-4000-8000-00000000c693', '00000000-0000-4000-8000-00000000f693', true),
  ('00000000-0000-4000-8000-00000000c694', '00000000-0000-4000-8000-00000000f694', true);
select set_config('v69.n_snap0', (select count(*) from public.company_snapshots)::text, false);
select set_config('v69.n_notif0', (select count(*) from public.notifications)::text, false);

-- ================================================================= A. the year roll-up takes the female count from the quarter of the total
insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, period_key, status, frozen_at, frozen_source, reported, employees_total, employees_female) values
  ('00000000-0000-4000-8000-00000000c691', 'quarter', '2026-09-30', 'founder', 2026, '2026-Q3', 'frozen', now(), 'auto', true, 4, 2),
  ('00000000-0000-4000-8000-00000000c691', 'quarter', '2026-12-31', 'founder', 2026, '2026-Q4', 'frozen', now(), 'auto', true, 1, null);
select v69_test.val('A01 total 1 in Q4 and female count only in Q3: the roll-up gives 1 / NULL (never 1 / 2)', $q$select concat_ws('|', r.employees_total::text, coalesce(r.employees_female::text, 'NULL'))
  from app_private.alumni_year_rollup r where r.company_id = '00000000-0000-4000-8000-00000000c691' and r.period_year = 2026$q$, '1|NULL');
insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, period_key, status, frozen_at, frozen_source, reported, employees_total, employees_female) values
  ('00000000-0000-4000-8000-00000000c691', 'quarter', '2027-03-31', 'founder', 2027, '2027-Q1', 'frozen', now(), 'auto', true, 5, 3),
  ('00000000-0000-4000-8000-00000000c691', 'quarter', '2027-06-30', 'founder', 2027, '2027-Q2', 'frozen', now(), 'auto', true, null, 4);
select v69_test.val('A02 a female count of a later quarter without a total is ignored: total 5 with female 3 (the same quarter)', $q$select concat_ws('|', r.employees_total::text, r.employees_female::text)
  from app_private.alumni_year_rollup r where r.company_id = '00000000-0000-4000-8000-00000000c691' and r.period_year = 2027$q$, '5|3');
select v69_test.val('A03 the list table agrees (year 2026: employees 1, female NULL)', $q$select concat_ws('|', (x->>'employees_total'), coalesce(x->>'employees_female', 'NULL'))
  from (select r as x from (select to_jsonb(r) r from app_private.alumni_year_rollup r where r.company_id = '00000000-0000-4000-8000-00000000c691' and r.period_year = 2026) q) z$q$, '1|NULL');
delete from public.company_snapshots where company_id = '00000000-0000-4000-8000-00000000c691';

-- ================================================================= B. the status at the END of the quarter
select v69_test.val('B01 freezing 2026-Q1 of a company that closed on 2026-09-01 records it OPEN, without a closing date', $q$select app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c692', '2026-Q1', 'manual', '00000000-0000-4000-8000-00000000e691')$q$, 'frozen');
select v69_test.val('B02 ... the stamp', $q$select concat_ws('|', s.operating_status, coalesce(s.closed_on::text, 'NULL')) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c692' and s.period_key = '2026-Q1'$q$, 'open|NULL');
select v69_test.val('B03 freezing 2026-Q3 (the quarter it closed in) records it CLOSED with its date', $q$select app_private.alumni_freeze_one('00000000-0000-4000-8000-00000000c692', '2026-Q3', 'manual', '00000000-0000-4000-8000-00000000e691')$q$, 'frozen');
select v69_test.val('B04 ... the stamp', $q$select concat_ws('|', s.operating_status, coalesce(s.closed_on::text, 'NULL')) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c692' and s.period_key = '2026-Q3'$q$, 'closed|2026-09-01');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e691","role":"authenticated"}', true);
set local role authenticated;
select v69_test.val('B05 a BACKFILL of 2026-Q2 for the closed company is accepted', $q$select (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c692', '2026-Q2', '{"revenue_total":10}'::jsonb) ->> 'backfilled')$q$, 'true');
select v69_test.val('B05b ... it records the company OPEN at that quarter end, without a closing date, and derives the team size', $q$select concat_ws(',', s.operating_status, coalesce(s.closed_on::text, 'NULL'), (s.team_size is not null)::text) from public.company_snapshots s where s.company_id = '00000000-0000-4000-8000-00000000c692' and s.period_key = '2026-Q2'$q$, 'open,NULL,true');
select v69_test.val('B06 a backfill may state the status itself (closed in 2026-Q1, closed_on inside the quarter)', $q$select (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c691', '2026-Q1', '{"revenue_total":5,"operating_status":"closed","closed_on":"2026-02-10"}'::jsonb) ->> 'backfilled')$q$, 'true');
select v69_test.err('B07 a closing date after the quarter is refused', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c691', '2026-Q2', '{"revenue_total":5,"operating_status":"closed","closed_on":"2026-09-10"}'::jsonb)$$, 'alumni_invalid');
select v69_test.err('B08 a closing date on an open company is refused', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c691', '2026-Q2', '{"revenue_total":5,"operating_status":"open","closed_on":"2026-04-10"}'::jsonb)$$, 'alumni_invalid');
select v69_test.err('B09 a bad status value / an impossible date is refused', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c691', '2026-Q2', '{"operating_status":"gone"}'::jsonb)$$, 'alumni_invalid');
select v69_test.err('B10 an impossible calendar date is refused', $$select public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c691', '2026-Q2', '{"operating_status":"closed","closed_on":"2026-02-31"}'::jsonb)$$, 'alumni_invalid');
-- reopen + correct the status of an existing snapshot
select v69_test.okrun('B11 reopen 2026-Q1 of company 1', $$select public.reopen_alumni_quarter('2026-Q1', '00000000-0000-4000-8000-00000000c691')$$);
select v69_test.val('B12 the reopened snapshot can be corrected to OPEN (and the original value is kept in previous_values)', $q$select (public.correct_alumni_snapshot('00000000-0000-4000-8000-00000000c691', '2026-Q1', '{"operating_status":"open","closed_on":null}'::jsonb) ->> 'changed')$q$, 'true');
reset role;
select v69_test.val('B13 ... stored', $q$select concat_ws('|', s.operating_status, coalesce(s.closed_on::text, 'NULL'), s.status, (s.previous_values ? 'operating_status')::text) from public.company_snapshots s
  where s.company_id = '00000000-0000-4000-8000-00000000c691' and s.period_key = '2026-Q1'$q$, 'open|NULL|frozen|true');

-- ================================================================= C. privileges
select v69_test.val('C01 the actor columns of the snapshots are closed to the API roles, the figures are open', $q$select concat_ws('|',
  has_column_privilege('authenticated', 'public.company_snapshots', 'frozen_by', 'SELECT')::text, has_column_privilege('authenticated', 'public.company_snapshots', 'corrected_by', 'SELECT')::text,
  has_column_privilege('authenticated', 'public.company_snapshots', 'reopened_by', 'SELECT')::text, has_column_privilege('authenticated', 'public.company_snapshots', 'updated_by', 'SELECT')::text,
  has_column_privilege('authenticated', 'public.company_snapshots', 'revenue_total', 'SELECT')::text, has_column_privilege('anon', 'public.company_snapshots', 'revenue_total', 'SELECT')::text)$q$, 'false|false|false|false|true|false');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e693","role":"authenticated"}', true);
set local role authenticated;
select v69_test.err('C02 a founder cannot read frozen_by of his own company snapshots', $$select frozen_by from public.company_snapshots where company_id = '00000000-0000-4000-8000-00000000c691'$$, '42501');
select v69_test.val('C03 he can still read his figures (the rows of his own company only)', $q$select count(*)::text from public.company_snapshots where revenue_total is not null or true$q$, '1');
select v69_test.val('C04 get_company_figures still returns the snapshots to him', $q$select jsonb_array_length(public.get_company_figures('00000000-0000-4000-8000-00000000c691') -> 'snapshots')::text$q$, '1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e695","role":"authenticated"}', true);
set local role authenticated;
select v69_test.err('C05 a founder of a NON-alumni company cannot save figures', $$select public.save_company_figures('00000000-0000-4000-8000-00000000c693', '{"revenue_total":1}'::jsonb)$$, 'alumni_not_found');
select v69_test.err('C06 ... nor confirm them', $$select public.confirm_company_figures('00000000-0000-4000-8000-00000000c693')$$, 'alumni_not_found');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e691","role":"authenticated"}', true);
set local role authenticated;
select v69_test.val('C07 the alumni manager may still edit the draft of any company', $q$select (public.save_company_figures('00000000-0000-4000-8000-00000000c693', '{"revenue_total":1}'::jsonb) ->> 'saved')$q$, 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e694","role":"authenticated"}', true);
set local role authenticated;
select v69_test.val('C08 an alumni founder still saves and confirms', $q$select concat_ws('|', (public.save_company_figures('00000000-0000-4000-8000-00000000c692', '{"revenue_total":2}'::jsonb) ->> 'saved'), (public.confirm_company_figures('00000000-0000-4000-8000-00000000c692') ->> 'confirmed'))$q$, 'true|true');
reset role;

-- ================================================================= D. the reminders: audience and link
select v69_test.val('D01 the audience skips the founder of a CLOSED company and a BANNED account (only F1 and the not-yet-alumni excluded one remain)', $q$select count(*)::text
  from app_private.alumni_reminder_audience('2026-Q4', array['00000000-0000-4000-8000-00000000c691', '00000000-0000-4000-8000-00000000c692', '00000000-0000-4000-8000-00000000c693', '00000000-0000-4000-8000-00000000c694']::uuid[], null, false)$q$, '1');
select set_config('v69.base0', coalesce((select app_base_url from app_private.alumni_quarter_settings), ''), false);
update app_private.alumni_quarter_settings set app_base_url = null;
select set_config('v69.r', app_private.alumni_reminders_send('2026-Q4', 'manual:v69a', 'manual', '00000000-0000-4000-8000-00000000e691', array['00000000-0000-4000-8000-00000000c691']::uuid[], null, false, null)::text, false);
select v69_test.val('D02 no stored address and none given: the founder gets the notification but NO e-mail, the log says no_link', $q$select concat_ws('|',
  (current_setting('v69.r')::jsonb ->> 'sent'), (current_setting('v69.r')::jsonb ->> 'link_has_address'),
  (select count(*) from public.notifications n where n.founder_id = '00000000-0000-4000-8000-00000000f691')::text,
  (select count(*) from app_private.email_outbox o where o.recipient_email = 'zz-v69-f1@example.invalid')::text,
  (select l.email_state from app_private.alumni_reminder_log l where l.founder_id = '00000000-0000-4000-8000-00000000f691' and l.kind = 'manual:v69a'),
  (select c.note from app_private.alumni_reminder_campaigns c where c.kind = 'manual:v69a'))$q$, '1|false|1|0|no_link|no_app_url');
select set_config('v69.r', app_private.alumni_reminders_send('2026-Q4', 'manual:v69b', 'manual', '00000000-0000-4000-8000-00000000e691', array['00000000-0000-4000-8000-00000000c691']::uuid[], null, false, 'https://one.example')::text, false);
select v69_test.val('D03 a manual send may bring its own address while none is stored', $q$select concat_ws('|', (current_setting('v69.r')::jsonb ->> 'link_has_address'),
  (select (o.body_html like '%https://one.example/alumni/founder/progress%')::text from app_private.email_outbox o where o.recipient_email = 'zz-v69-f1@example.invalid' and o.idempotency_key like '%manual:v69b'))$q$, 'true|true');
update app_private.alumni_quarter_settings set app_base_url = 'https://stored.example';
select set_config('v69.r', app_private.alumni_reminders_send('2026-Q4', 'manual:v69c', 'manual', '00000000-0000-4000-8000-00000000e691', array['00000000-0000-4000-8000-00000000c691']::uuid[], null, false, 'https://evil.example')::text, false);
select v69_test.val('D04 once an address is stored, a manager-supplied address is IGNORED', $q$select concat_ws('|', (current_setting('v69.r')::jsonb ->> 'sent'),
  (select (o.body_html like '%https://stored.example/alumni/founder/progress%' and o.body_html not like '%evil.example%')::text from app_private.email_outbox o where o.idempotency_key like '%manual:v69c'))$q$, '1|true');
select v69_test.val('D05 the campaign counters treat no_link as "no e-mail"', $q$select c.no_email::text from app_private.alumni_reminder_campaigns c where c.kind = 'manual:v69a'$q$, '1');

-- ================================================================= E. catalog
select v69_test.val('E01 the three changed public functions are SECURITY DEFINER, closed to anon', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('correct_alumni_snapshot', 'save_company_figures', 'confirm_company_figures') and p.prosecdef and 'search_path=""' = any (p.proconfig) and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '3');
select v69_test.val('E02 the roll-up view stays closed to the API roles', $q$select has_table_privilege('authenticated', 'app_private.alumni_year_rollup', 'SELECT')::text$q$, 'false');

-- ================================================================= final state check
select current_setting('v69.res', true) as res, current_setting('v69.n_snap0') as n_snap0, current_setting('v69.n_notif0') as n_notif0 \gset
rollback;

select count(*) as n_snap1 from public.company_snapshots \gset
select count(*) as n_notif1 from public.notifications \gset
select (:n_snap0 = :n_snap1 and :n_notif0 = :n_notif1) as state_ok \gset

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, regexp_replace(line, '^[^|]*[|][^|]*[|]', '') as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or not (:'state_ok')::boolean) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v69: review-fix tests FAILED'; end $$;
\endif
