-- m68_alumni_quarter_reminders.sql  (owner decision 21.4, 2026-10-15: a quarterly reminder to every alumni founder, by in-platform notification AND e-mail, before the quarter closes)
-- Re-runnable (create or replace / if not exists / drop ... if exists / every data step checks itself). Local DB only. Run AFTER m66, m67 and m62. Verify with db/verify/v68_alumni_quarter_reminders.sql.
--
-- THE MODEL
--  * SCHEDULE   app_private.alumni_quarter_settings (m66): reminder_offsets (default {14,3} = 14 and 3 days before the quarter closes), send_hour (Cairo, default 10), auto_reminders,
--               auto_freeze, app_base_url (the address e-mail links start with). Editable by alumni_manager / super_admin through public.set_alumni_quarter_settings.
--               "N days before the quarter closes" counts from the closing instant (00:00 Cairo of the next quarter's first day): 14 days -> 18 Dec 10:00, 3 days -> 29 Dec 10:00 (deadline 31 Dec).
--  * AUDIENCE   founders with an account (role `founder`) linked to an ALUMNI company whose figures for the quarter are NOT confirmed and whose quarter is not closed (status
--               not_updated | updated). One row per founder (his unconfirmed companies listed together). Confirmed companies are skipped.
--  * IDEMPOTENCY  app_private.alumni_reminder_log is unique on (founder, period, reminder kind): the scheduler, a retry, two managers clicking at once or a crash in the middle of a
--               run can never send the same reminder twice. Kinds: 'd14' / 'd3' (scheduled, one per configured offset), 'manual:<token>' (one manual send; the token comes from the
--               dialog, so a double click is one send; a deliberate "Resend" is a new token = a new kind).
--  * CHANNELS   public.notifications (one row per founder, in his profile language, both languages in the metadata, the link to /alumni/founder/progress?company=<id>) AND
--               app_private.email_outbox (email_key 'alumni_quarter_reminder', sent by the system sender; the e-mail DELIVERY is done by the outbox worker of m62: this file only enqueues).
--  * TEMPLATES  app_private.alumni_reminder_templates (ar / en): notification title + body, e-mail subject + body. Placeholders {founder_name} {company_name} {quarter} {deadline} {link}.
--               SAFE TEXT: the body is plain text; the e-mail HTML is built from the escaped text (never raw HTML from the manager). Unknown placeholders and national-ID-shaped numbers
--               are refused. The defaults are flagged `finalised = false` ("wording to be finalised by the owner").
--  * SENDING    automatically: app_private.alumni_quarter_tick() (freezes due quarters, then sends the due reminder of the current quarter; late scheduler = only the LATEST due kind is sent,
--               the earlier ones are recorded as superseded) scheduled by pg_cron through app_private.alumni_quarter_scheduler_enable() (NOT scheduled by this file; db/scripts/alumni-quarter-schedule.sh).
--               Manually: public.preview_alumni_reminders / public.send_alumni_reminders (a recipients preview first; more than 100 recipients need the confirmed count) and the campaign history
--               public.list_alumni_reminder_campaigns.
--  * QUARTER STATUS  public.list_alumni_quarter_status: per quarter, every alumni company: confirmed / updated-not-confirmed / not-updated (or closed), last modified, who confirmed, reminders sent.
--
-- Error tokens (message prefix = hint): `alumni_invalid` (22023), `forbidden` (42501), `alumni_confirm_required` (P0001, detail = the real recipient count).
-- NULL SAFETY: every guard fails closed (`coalesce`, `is not true`, `is distinct from`).
set search_path = public, extensions;

begin;

-- ================================================================= 1. e-mail plumbing: a node-less platform e-mail sent by the system sender
alter table app_private.email_outbox drop constraint if exists email_outbox_scope_chk;
alter table app_private.email_outbox add constraint email_outbox_scope_chk check (
  (project_id is not null and node_id is not null and sender_connection_id is not null)
  or (email_key in ('staff_invitation', 'alumni_quarter_reminder') and project_id is null and node_id is null)
  or (email_key = any (array['form_new_response', 'acceptance', 'rejection', 'interview', 'booking_confirmation', 'booking_cancellation']) and project_id is not null and node_id is not null));

-- email_pick_sender: the reminder is sent by the system sender (the default mode of a template-less platform e-mail), patched IN PLACE on its current definition
do $$
declare f regprocedure := 'app_private.email_pick_sender(app_private.email_outbox)'::regprocedure; v_def text; v_new text;
begin
  v_def := pg_get_functiondef(f);
  v_new := replace(v_def, 'case when p_row.email_key = ''form_new_response'' then ''system'' else ''acting_pm'' end',
                          'case when p_row.email_key in (''form_new_response'', ''alumni_quarter_reminder'') then ''system'' else ''acting_pm'' end');
  if v_new = v_def and position('alumni_quarter_reminder' in v_def) = 0 then raise exception 'm68: email_pick_sender has a shape this patch does not know'; end if;
  if v_new <> v_def then execute v_new; end if;
end $$;

-- ================================================================= 2. tables
create table if not exists app_private.alumni_reminder_templates (
  lang          text primary key check (lang in ('ar', 'en')),
  notif_title   text not null check (char_length(notif_title) between 1 and 200),
  notif_body    text not null check (char_length(notif_body) between 1 and 1000),
  email_subject text not null check (char_length(email_subject) between 1 and 200),
  email_body    text not null check (char_length(email_body) between 1 and 4000),
  finalised     boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null
);
alter table app_private.alumni_reminder_templates enable row level security;
alter table app_private.alumni_reminder_templates force row level security;
revoke all on app_private.alumni_reminder_templates from public, anon, authenticated;

create table if not exists app_private.alumni_reminder_campaigns (
  id          uuid primary key default gen_random_uuid(),
  period_key  text not null check (period_key ~ '^[0-9]{4}-Q[1-4]$'),
  trigger     text not null check (trigger in ('schedule', 'manual')),
  kind        text not null check (kind ~ '^[a-z0-9:_-]{1,80}$'),
  status      text not null default 'done' check (status in ('done', 'superseded')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  recipients  integer not null default 0,
  notified    integer not null default 0,
  emailed     integer not null default 0,
  no_email    integer not null default 0,
  note        text check (note is null or char_length(note) <= 300),
  constraint alumni_reminder_campaigns_kind_key unique (period_key, kind)
);
alter table app_private.alumni_reminder_campaigns enable row level security;
alter table app_private.alumni_reminder_campaigns force row level security;
revoke all on app_private.alumni_reminder_campaigns from public, anon, authenticated;

create table if not exists app_private.alumni_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references app_private.alumni_reminder_campaigns (id) on delete cascade,
  period_key      text not null,
  kind            text not null,
  founder_id      uuid not null references public.founders (id) on delete cascade,
  user_id         uuid,
  company_id      uuid,
  notification_id uuid,
  outbox_id       uuid,
  email_state     text check (email_state is null or email_state in ('queued', 'no_email')),
  created_at      timestamptz not null default now(),
  constraint alumni_reminder_log_idem_key unique (founder_id, period_key, kind)
);
create index if not exists alumni_reminder_log_campaign_idx on app_private.alumni_reminder_log (campaign_id);
create index if not exists alumni_reminder_log_period_idx on app_private.alumni_reminder_log (period_key, founder_id);
alter table app_private.alumni_reminder_log enable row level security;
alter table app_private.alumni_reminder_log force row level security;
revoke all on app_private.alumni_reminder_log from public, anon, authenticated;

-- the DEFAULT wording ("to be finalised by the owner"): inserted only when a language has no row yet; a manager's edits are never overwritten by a re-run
create or replace function app_private.alumni_reminder_default(p_lang text, p_field text) returns text language sql immutable set search_path = '' as $$
  select case p_lang || '.' || p_field
    when 'ar.notif_title'   then 'حدّث بيانات {company_name} قبل إغلاق {quarter}'
    when 'ar.notif_body'    then 'مرحباً {founder_name}، يُقفل {quarter} بتاريخ {deadline}. ادخل إلى المنصة وحدّث أرقام شركتك (الإيرادات وعدد الموظفين والتمويل) أو أكّد أنها كما هي.'
    when 'ar.email_subject' then 'تحديث بيانات {company_name} قبل إغلاق {quarter}'
    when 'ar.email_body'    then E'مرحباً {founder_name}،\n\nيُقفل {quarter} بتاريخ {deadline}. من فضلك ادخل إلى المنصة وحدّث بيانات {company_name} (الإيرادات وعدد الموظفين والتمويل) أو أكّد أنها كما هي. هذا يساعدنا في معرفة من يمكن أن نفيده بالفرص القريبة.\n\n{link}\n\nشكراً،\nفريق أثر'
    when 'en.notif_title'   then 'Update the figures of {company_name} before {quarter} closes'
    when 'en.notif_body'    then 'Hello {founder_name}, {quarter} closes on {deadline}. Sign in and update your company''s figures (revenue, employees, funding) or confirm they are still right.'
    when 'en.email_subject' then 'Update the figures of {company_name} before {quarter} closes'
    when 'en.email_body'    then E'Hello {founder_name},\n\n{quarter} closes on {deadline}. Please sign in and update the figures of {company_name} (revenue, employees, funding) or confirm they are still right. It helps us know whom we can support with upcoming opportunities.\n\n{link}\n\nThank you,\nThe Athar team'
  end
$$;
insert into app_private.alumni_reminder_templates (lang, notif_title, notif_body, email_subject, email_body)
select l, app_private.alumni_reminder_default(l, 'notif_title'), app_private.alumni_reminder_default(l, 'notif_body'), app_private.alumni_reminder_default(l, 'email_subject'), app_private.alumni_reminder_default(l, 'email_body')
  from (values ('ar'), ('en')) v (l)
on conflict (lang) do nothing;

-- ================================================================= 3. text helpers (placeholders, escaping, validation)
-- the placeholder fill: plain text in, plain text out (the values come from the database, never from the request)
create or replace function app_private.alumni_fill(p_text text, p_vars jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare k text; v text := p_text;
begin
  if v is null then return null; end if;
  foreach k in array array['founder_name', 'company_name', 'quarter', 'deadline', 'link'] loop
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  end loop;
  return v;
end $$;

-- plain text -> the e-mail's HTML: everything is escaped; paragraphs at blank lines; ONE anchor, for the link (an absolute http(s) address only)
create or replace function app_private.alumni_email_html(p_text text, p_link text, p_lang text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := coalesce(p_text, ''); v_link text := coalesce(p_link, ''); v_esc_link text;
begin
  v := replace(replace(replace(replace(replace(v, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
  v := replace(v, E'\r', '');
  v := '<p>' || replace(v, E'\n\n', '</p><p>') || '</p>';
  v := replace(v, E'\n', '<br>');
  v_esc_link := replace(replace(replace(replace(replace(v_link, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
  v := replace(v, chr(1), case when v_link ~ '^https?://[^[:space:]"''<>]+$' then '<a href="' || v_esc_link || '">' || v_esc_link || '</a>' else v_esc_link end);
  return '<div dir="' || case when p_lang = 'ar' then 'rtl' else 'ltr' end || '" style="font-family:' || case when p_lang = 'ar' then 'Tajawal' else 'Manrope' end
         || ',Arial,sans-serif;font-size:15px;line-height:1.7">' || v || '</div>';
end $$;

-- a template field: required, bounded, only the five known placeholders, no national-ID-shaped number
create or replace function app_private.alumni_template_check(p_field text, p_text text, p_max integer) returns text
language plpgsql stable set search_path = '' as $$
declare t text := btrim(coalesce(p_text, '')); m text;
begin
  if t = '' then perform app_private.alumni_fail(p_field, 'required'); end if;
  if char_length(t) > p_max then perform app_private.alumni_fail(p_field, 'too_long'); end if;
  for m in select x[1] from regexp_matches(t, '\{([^{}]*)\}', 'g') x loop
    if m not in ('founder_name', 'company_name', 'quarter', 'deadline', 'link') then perform app_private.alumni_fail(p_field, 'unknown_placeholder:' || left(m, 30)); end if;
  end loop;
  if app_private.contains_id(t) then perform app_private.alumni_fail(p_field, 'contains_id'); end if;
  return t;
end $$;

-- the values of one reminder (the manager preview uses sample values)
create or replace function app_private.alumni_reminder_vars(p_lang text, p_founder_name text, p_company_name text, p_period text, p_link text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('founder_name', p_founder_name, 'company_name', p_company_name, 'quarter', app_private.alumni_period_label(p_period, p_lang),
                            'deadline', app_private.alumni_deadline_label(p_period, p_lang), 'link', p_link)
$$;

-- renders the four texts of one language (a template jsonb overrides the stored one: the live preview of an unsaved edit)
create or replace function app_private.alumni_reminder_render(p_lang text, p_vars jsonb, p_override jsonb default null)
returns table (notif_title text, notif_body text, email_subject text, email_body_text text, email_html text)
language plpgsql stable security definer set search_path = '' as $$
declare t app_private.alumni_reminder_templates; v_vars_html jsonb; ti text; bo text; su text; eb text;
begin
  select * into t from app_private.alumni_reminder_templates x where x.lang = p_lang;
  ti := coalesce(p_override ->> 'notif_title', t.notif_title, app_private.alumni_reminder_default(p_lang, 'notif_title'));
  bo := coalesce(p_override ->> 'notif_body', t.notif_body, app_private.alumni_reminder_default(p_lang, 'notif_body'));
  su := coalesce(p_override ->> 'email_subject', t.email_subject, app_private.alumni_reminder_default(p_lang, 'email_subject'));
  eb := coalesce(p_override ->> 'email_body', t.email_body, app_private.alumni_reminder_default(p_lang, 'email_body'));
  v_vars_html := p_vars || jsonb_build_object('link', chr(1));
  notif_title := app_private.alumni_fill(ti, p_vars);
  notif_body := app_private.alumni_fill(bo, p_vars);
  email_subject := replace(replace(app_private.alumni_fill(su, p_vars), E'\n', ' '), E'\r', ' ');
  email_body_text := app_private.alumni_fill(eb, p_vars);
  email_html := app_private.alumni_email_html(app_private.alumni_fill(eb, v_vars_html), p_vars ->> 'link', p_lang);
  return next;
end $$;

-- ================================================================= 4. the audience
-- founders (account + role founder) of ALUMNI companies whose figures for p_period are not confirmed and whose quarter is not closed. One row per founder.
create or replace function app_private.alumni_reminder_audience(p_period text, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false)
returns table (fid uuid, uid uuid, cid uuid, cids uuid[], names_en text[], names_ar text[], fn_en text, fn_ar text, email text, lang text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_ids uuid[];
begin
  if not app_private.alumni_period_ok(p_period) then return; end if;
  if p_filters is not null and p_filters <> '{}'::jsonb then
    select coalesce(array_agg(i), '{}'::uuid[]) into v_ids from app_private.alumni_filter_ids(p_filters, 'manager', app_private.alumni_today()) i;
  end if;
  return query
  with cand as (
    select f.id as xf, f.auth_user_id as xu, c.id as xc, c.name_en as cn_en, c.name_ar as cn_ar, cf.is_primary as xp, cf.created_at as xcf, f.name_en as f_en, f.name_ar as f_ar, f.email::text as f_email
      from public.founders f
      join public.company_founders cf on cf.founder_id = f.id
      join public.companies c on c.id = cf.company_id and c.deleted_at is null and c.is_alumni
     where f.deleted_at is null and f.auth_user_id is not null
       and exists (select 1 from public.user_roles r where r.user_id = f.auth_user_id and r.role_key = 'founder')
       and (p_company_ids is null or c.id = any (p_company_ids))
       and (v_ids is null or c.id = any (v_ids))
       and app_private.alumni_figures_status(c.id, p_period) in ('updated', 'not_updated'))
  select x.xf, x.xu, (array_agg(x.xc order by x.xp desc, x.xcf, x.xc))[1], array_agg(x.xc order by x.xp desc, x.xcf, x.xc),
         array_agg(coalesce(x.cn_en, x.cn_ar) order by x.xp desc, x.xcf, x.xc), array_agg(coalesce(x.cn_ar, x.cn_en) order by x.xp desc, x.xcf, x.xc),
         max(x.f_en), max(x.f_ar), coalesce(u.email::text, max(x.f_email)), coalesce(pr.language, 'ar')
    from cand x
    left join auth.users u on u.id = x.xu
    left join public.profiles pr on pr.id = x.xu
   where not coalesce(p_only_new, false) or not exists (select 1 from app_private.alumni_reminder_log l where l.founder_id = x.xf and l.period_key = p_period)
   group by x.xf, x.xu, u.email, pr.language
   order by x.xf;
end $$;

-- ================================================================= 5. sending (the ONE path: the scheduler and the manager both come here)
create or replace function app_private.alumni_reminders_send(p_period text, p_kind text, p_trigger text, p_by uuid, p_company_ids uuid[], p_filters jsonb, p_only_new boolean,
                                                             p_app_url text, p_now timestamptz default now(), p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_camp uuid; r record; v_log uuid; v_base text; v_path text; v_link text; v_notif uuid; v_out uuid; v_lang text; rr record; ra record; re record;
        v_new integer := 0; v_dup integer := 0; v_total integer := 0; v_noemail integer := 0; v_url text;
begin
  if not app_private.alumni_period_ok(p_period) or p_kind is null or p_kind !~ '^[a-z0-9:_-]{1,80}$' or p_trigger is null or p_trigger not in ('schedule', 'manual') then
    perform app_private.alumni_fail('reminder', 'bad_value');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_reminders:' || p_period || ':' || p_kind, 0));
  select * into s from app_private.alumni_quarter_settings;
  v_url := coalesce(nullif(btrim(p_app_url), ''), s.app_base_url);
  if v_url is not null and v_url !~ '^https?://[^[:space:]"''<>]{1,255}$' then v_url := null; end if;
  v_base := rtrim(v_url, '/');
  insert into app_private.alumni_reminder_campaigns (period_key, trigger, kind, created_by, note) values (p_period, p_trigger, p_kind, p_by, left(p_note, 300))
  on conflict (period_key, kind) do nothing returning id into v_camp;
  if v_camp is null then select c.id into v_camp from app_private.alumni_reminder_campaigns c where c.period_key = p_period and c.kind = p_kind; end if;
  for r in select * from app_private.alumni_reminder_audience(p_period, p_company_ids, p_filters, p_only_new) loop
    v_total := v_total + 1;
    insert into app_private.alumni_reminder_log (campaign_id, period_key, kind, founder_id, user_id, company_id) values (v_camp, p_period, p_kind, r.fid, r.uid, r.cid)
    on conflict (founder_id, period_key, kind) do nothing returning id into v_log;
    if v_log is null then v_dup := v_dup + 1; continue; end if;
    v_new := v_new + 1;
    v_lang := case when r.lang = 'en' then 'en' else 'ar' end;
    v_path := '/alumni/founder/progress?company=' || r.cid::text;
    v_link := case when v_base is null then v_path else v_base || v_path end;
    select * into ra from app_private.alumni_reminder_render('ar', app_private.alumni_reminder_vars('ar', coalesce(r.fn_ar, r.fn_en), array_to_string((r.names_ar)[1:3], '، '), p_period, v_link));
    select * into re from app_private.alumni_reminder_render('en', app_private.alumni_reminder_vars('en', coalesce(r.fn_en, r.fn_ar), array_to_string((r.names_en)[1:3], ', '), p_period, v_link));
    if v_lang = 'ar' then rr := ra; else rr := re; end if;
    insert into public.notifications (recipient_id, founder_id, title, body, audience_type, audience_target_id, sent_by, metadata)
    values (r.uid, r.fid, rr.notif_title, rr.notif_body, 'founder', r.fid, p_by,
            jsonb_strip_nulls(jsonb_build_object('v', 1, 'kind', 'quarter_reminder', 'period_key', p_period, 'company_id', r.cid, 'link', v_path,
              'title_ar', ra.notif_title, 'title_en', re.notif_title, 'body_ar', ra.notif_body, 'body_en', re.notif_body)))
    returning id into v_notif;
    v_out := null;
    if r.email is not null and r.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      insert into app_private.email_outbox (email_key, recipient_email, subject, body_html, idempotency_key, created_by)
      values ('alumni_quarter_reminder', r.email::extensions.citext, rr.email_subject, rr.email_html, 'alumni_reminder:' || r.fid::text || ':' || p_period || ':' || p_kind, p_by)
      on conflict (idempotency_key) do nothing returning id into v_out;
    end if;
    if v_out is null and (r.email is null or r.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then v_noemail := v_noemail + 1; end if;
    update app_private.alumni_reminder_log l set notification_id = v_notif, outbox_id = v_out, email_state = case when v_out is not null then 'queued' else 'no_email' end where l.id = v_log;
  end loop;
  update app_private.alumni_reminder_campaigns c set
    recipients = (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    notified = (select count(l.notification_id) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    emailed = (select count(l.outbox_id) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    no_email = (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id and l.email_state = 'no_email'),
    note = case when v_base is null and p_trigger = 'schedule' then coalesce(c.note, 'no_app_url') else c.note end
   where c.id = v_camp;
  return jsonb_build_object('campaign_id', v_camp, 'period', p_period, 'kind', p_kind, 'audience', v_total, 'sent', v_new, 'already_sent', v_dup, 'no_email', v_noemail, 'link_has_address', v_base is not null);
end $$;

-- ================================================================= 6. the tick: freeze the due quarters, then send the due reminder of the current quarter
create or replace function app_private.alumni_quarter_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_cur text := app_private.alumni_period_key(coalesce(p_now, now())); v_freeze jsonb := '{}'::jsonb; v_end timestamptz; v_end_day date; d integer;
        v_due timestamptz; v_sent jsonb := '[]'::jsonb; v_due_list integer[] := '{}'; v_latest integer; v_res jsonb; v_offs integer[];
begin
  select * into s from app_private.alumni_quarter_settings;
  if coalesce(s.auto_freeze, false) then v_freeze := app_private.alumni_freeze_due(coalesce(p_now, now()), 'auto', null); end if;
  if coalesce(s.auto_reminders, false) and app_private.alumni_period_index(v_cur) >= app_private.alumni_period_index(s.first_period) then
    v_end := app_private.alumni_period_end(v_cur);
    v_end_day := (v_end at time zone app_private.alumni_tz())::date;
    select coalesce(array_agg(x order by x desc), '{}'::integer[]) into v_offs from unnest(coalesce(s.reminder_offsets, '{}'::integer[])) x;
    foreach d in array v_offs loop
      v_due := ((v_end_day - d)::timestamp + make_interval(hours => s.send_hour)) at time zone app_private.alumni_tz();
      if coalesce(p_now, now()) >= v_due and coalesce(p_now, now()) < v_end
         and not exists (select 1 from app_private.alumni_reminder_campaigns c where c.period_key = v_cur and c.kind = 'd' || d) then
        v_due_list := v_due_list || d;
      end if;
    end loop;
    if cardinality(v_due_list) > 0 then
      -- several are due only when the scheduler was down: ONLY the latest (smallest offset) is sent, the earlier ones are recorded as superseded
      select min(x) into v_latest from unnest(v_due_list) x;
      foreach d in array v_due_list loop
        if d = v_latest then
          v_res := app_private.alumni_reminders_send(v_cur, 'd' || d, 'schedule', null, null, null, false, null, coalesce(p_now, now()));
          v_sent := v_sent || jsonb_build_array(v_res);
        else
          insert into app_private.alumni_reminder_campaigns (period_key, trigger, kind, status, note) values (v_cur, 'schedule', 'd' || d, 'superseded', 'superseded by d' || v_latest)
          on conflict (period_key, kind) do nothing;
        end if;
      end loop;
    end if;
  end if;
  return jsonb_build_object('now', coalesce(p_now, now()), 'period', v_cur, 'freeze', v_freeze, 'reminders', v_sent);
end $$;

-- the scheduler (pg_cron, in the database: no HTTP, no secret). NOT started by this file. `postgres` runs these (db/scripts/alumni-quarter-schedule.sh); closed to every API role.
create or replace function app_private.alumni_quarter_scheduler_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j record; r record;
begin
  select * into j from cron.job where jobname = 'alumni-quarter-tick' limit 1;
  if j.jobid is null then return jsonb_build_object('enabled', false); end if;
  select d.status, d.start_time into r from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1;
  return jsonb_build_object('enabled', coalesce(j.active, false), 'schedule', j.schedule, 'jobid', j.jobid, 'last_run_at', r.start_time, 'last_status', r.status);
end $$;
create or replace function app_private.alumni_quarter_scheduler_enable(p_cron text default '*/15 * * * *') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_cron is null or p_cron !~ '^[0-9*/,-]+( [0-9*/,-]+){4}$' then raise exception 'bad cron expression' using errcode = '22023'; end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'alumni-quarter-tick';
  perform cron.schedule('alumni-quarter-tick', p_cron, 'select app_private.alumni_quarter_tick()');
  return app_private.alumni_quarter_scheduler_status();
end $$;
create or replace function app_private.alumni_quarter_scheduler_disable() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'alumni-quarter-tick';
  return app_private.alumni_quarter_scheduler_status();
end $$;

-- ================================================================= 7. settings + templates (manager)
create or replace function public.get_alumni_quarter_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_cur text := app_private.alumni_period_key(now()); v_tpl jsonb; v_next jsonb := '[]'::jsonb; d integer; v_end_day date;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from app_private.alumni_quarter_settings;
  select coalesce(jsonb_agg(jsonb_build_object('lang', t.lang, 'notif_title', t.notif_title, 'notif_body', t.notif_body, 'email_subject', t.email_subject, 'email_body', t.email_body,
           'finalised', t.finalised, 'updated_at', t.updated_at,
           'is_default', t.notif_title = app_private.alumni_reminder_default(t.lang, 'notif_title') and t.notif_body = app_private.alumni_reminder_default(t.lang, 'notif_body')
                         and t.email_subject = app_private.alumni_reminder_default(t.lang, 'email_subject') and t.email_body = app_private.alumni_reminder_default(t.lang, 'email_body')) order by t.lang), '[]'::jsonb)
    into v_tpl from app_private.alumni_reminder_templates t;
  v_end_day := (app_private.alumni_period_end(v_cur) at time zone app_private.alumni_tz())::date;
  foreach d in array coalesce(s.reminder_offsets, '{}'::integer[]) loop
    v_next := v_next || jsonb_build_array(jsonb_build_object('offset_days', d, 'due_at', ((v_end_day - d)::timestamp + make_interval(hours => s.send_hour)) at time zone app_private.alumni_tz(),
                'sent', exists (select 1 from app_private.alumni_reminder_campaigns c where c.period_key = v_cur and c.kind = 'd' || d)));
  end loop;
  return jsonb_build_object('first_period', s.first_period, 'auto_freeze', s.auto_freeze, 'auto_reminders', s.auto_reminders, 'reminder_offsets', to_jsonb(s.reminder_offsets), 'send_hour', s.send_hour,
           'app_base_url', s.app_base_url, 'timezone', app_private.alumni_tz(), 'current_period', v_cur, 'due', v_next, 'templates', v_tpl, 'placeholders', jsonb_build_array('founder_name', 'company_name', 'quarter', 'deadline', 'link'),
           'scheduler', app_private.alumni_quarter_scheduler_status());
end $$;

create or replace function public.set_alumni_quarter_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); k text; val jsonb; s app_private.alumni_quarter_settings; v_offsets integer[]; v_hour integer; v_url text; e jsonb; n integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('settings', 'not_an_object'); end if;
  select * into s from app_private.alumni_quarter_settings;
  for k, val in select key, value from jsonb_each(p_patch) loop
    if k = 'auto_freeze' then
      if jsonb_typeof(val) <> 'boolean' then perform app_private.alumni_fail(k, 'not_a_boolean'); end if; s.auto_freeze := (val #>> '{}')::boolean;
    elsif k = 'auto_reminders' then
      if jsonb_typeof(val) <> 'boolean' then perform app_private.alumni_fail(k, 'not_a_boolean'); end if; s.auto_reminders := (val #>> '{}')::boolean;
    elsif k = 'send_hour' then
      if jsonb_typeof(val) <> 'number' or (val #>> '{}') !~ '^[0-9]{1,2}$' then perform app_private.alumni_fail(k, 'bad_value'); end if;
      v_hour := (val #>> '{}')::int; if v_hour > 23 then perform app_private.alumni_fail(k, 'out_of_range'); end if; s.send_hour := v_hour;
    elsif k = 'reminder_offsets' then
      if jsonb_typeof(val) <> 'array' then perform app_private.alumni_fail(k, 'not_an_array'); end if;
      v_offsets := '{}'; n := 0;
      for e in select x from jsonb_array_elements(val) x loop
        n := n + 1;
        if jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[0-9]{1,2}$' then perform app_private.alumni_fail(k, 'bad_value'); end if;
        if (e #>> '{}')::int not between 1 and 90 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        if (e #>> '{}')::int = any (v_offsets) then perform app_private.alumni_fail(k, 'duplicate'); end if;
        v_offsets := v_offsets || (e #>> '{}')::int;
      end loop;
      if n > 6 then perform app_private.alumni_fail(k, 'too_many'); end if;
      s.reminder_offsets := v_offsets;
    elsif k = 'app_base_url' then
      if jsonb_typeof(val) = 'null' then s.app_base_url := null;
      elsif jsonb_typeof(val) <> 'string' then perform app_private.alumni_fail(k, 'not_a_string');
      else
        v_url := nullif(btrim(val #>> '{}'), '');
        if v_url is not null and v_url !~ '^https?://[^[:space:]"''<>]{1,255}$' then perform app_private.alumni_fail(k, 'bad_url'); end if;
        s.app_base_url := rtrim(v_url, '/');
      end if;
    else
      perform app_private.alumni_fail(k, 'unknown_key');
    end if;
  end loop;
  update app_private.alumni_quarter_settings x set auto_freeze = s.auto_freeze, auto_reminders = s.auto_reminders, reminder_offsets = s.reminder_offsets, send_hour = s.send_hour,
         app_base_url = s.app_base_url, updated_at = now(), updated_by = v_uid;
  return public.get_alumni_quarter_settings();
end $$;

create or replace function public.save_alumni_reminder_template(p_lang text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); k text; val jsonb; t app_private.alumni_reminder_templates;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('ar', 'en') then perform app_private.alumni_fail('lang', 'bad_value'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('template', 'not_an_object'); end if;
  select * into t from app_private.alumni_reminder_templates x where x.lang = p_lang for update;
  for k, val in select key, value from jsonb_each(p_patch) loop
    if jsonb_typeof(val) <> (case when k = 'finalised' then 'boolean' else 'string' end) then perform app_private.alumni_fail(k, 'bad_type'); end if;
    if k = 'notif_title' then t.notif_title := app_private.alumni_template_check(k, val #>> '{}', 200);
    elsif k = 'notif_body' then t.notif_body := app_private.alumni_template_check(k, val #>> '{}', 1000);
    elsif k = 'email_subject' then t.email_subject := app_private.alumni_template_check(k, val #>> '{}', 200);
    elsif k = 'email_body' then t.email_body := app_private.alumni_template_check(k, val #>> '{}', 4000);
    elsif k = 'finalised' then t.finalised := (val #>> '{}')::boolean;
    else perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  update app_private.alumni_reminder_templates x set notif_title = t.notif_title, notif_body = t.notif_body, email_subject = t.email_subject, email_body = t.email_body,
         finalised = t.finalised, updated_at = now(), updated_by = v_uid where x.lang = p_lang;
  return public.get_alumni_quarter_settings();
end $$;

create or replace function public.reset_alumni_reminder_template(p_lang text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('ar', 'en') then perform app_private.alumni_fail('lang', 'bad_value'); end if;
  update app_private.alumni_reminder_templates x set notif_title = app_private.alumni_reminder_default(p_lang, 'notif_title'), notif_body = app_private.alumni_reminder_default(p_lang, 'notif_body'),
         email_subject = app_private.alumni_reminder_default(p_lang, 'email_subject'), email_body = app_private.alumni_reminder_default(p_lang, 'email_body'),
         finalised = false, updated_at = now(), updated_by = v_uid where x.lang = p_lang;
  return public.get_alumni_quarter_settings();
end $$;

-- live preview: renders a (possibly unsaved) template with sample values; the same code path as the real send (escaping included). -> { notif_title, notif_body, email_subject, email_html, email_text }
create or replace function public.preview_alumni_reminder_template(p_lang text, p_template jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; k text; v_o jsonb := '{}'::jsonb; v_period text := app_private.alumni_period_key(now()); v_link text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('ar', 'en') then perform app_private.alumni_fail('lang', 'bad_value'); end if;
  if p_template is not null then
    if jsonb_typeof(p_template) <> 'object' then perform app_private.alumni_fail('template', 'not_an_object'); end if;
    for k in select jsonb_object_keys(p_template) loop
      if k not in ('notif_title', 'notif_body', 'email_subject', 'email_body') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
      if jsonb_typeof(p_template -> k) <> 'string' then perform app_private.alumni_fail(k, 'bad_type'); end if;
      v_o := v_o || jsonb_build_object(k, app_private.alumni_template_check(k, p_template ->> k, case k when 'notif_title' then 200 when 'email_subject' then 200 when 'notif_body' then 1000 else 4000 end));
    end loop;
  end if;
  v_link := 'https://example.org/alumni/founder/progress';
  select * into r from app_private.alumni_reminder_render(p_lang, app_private.alumni_reminder_vars(p_lang, case when p_lang = 'ar' then 'سارة أحمد' else 'Sara Ahmed' end,
              case when p_lang = 'ar' then 'نايل تك' else 'Nile Tech' end, v_period, v_link), v_o);
  return jsonb_build_object('notif_title', r.notif_title, 'notif_body', r.notif_body, 'email_subject', r.email_subject, 'email_html', r.email_html, 'email_text', r.email_body_text, 'period', v_period);
end $$;

-- ================================================================= 8. manual sending: preview, send, history
create or replace function public.preview_alumni_reminders(p_period text default null, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_period text := coalesce(p_period, app_private.alumni_period_key(now())); v_n integer; v_mail integer; v_companies integer; v_sample jsonb; v_already integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(v_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if p_company_ids is not null and cardinality(p_company_ids) > 1000 then perform app_private.alumni_fail('company_ids', 'too_many'); end if;
  select count(*)::int, (count(*) filter (where a.email is not null))::int, coalesce(sum(cardinality(a.cids)), 0)::int into v_n, v_mail, v_companies
    from app_private.alumni_reminder_audience(v_period, p_company_ids, p_filters, p_only_new) a;
  select count(*)::int into v_already from app_private.alumni_reminder_audience(v_period, p_company_ids, p_filters, false) a
   where exists (select 1 from app_private.alumni_reminder_log l where l.founder_id = a.fid and l.period_key = v_period);
  select coalesce(jsonb_agg(jsonb_build_object('founder_id', s.fid, 'name_en', s.fn_en, 'name_ar', s.fn_ar, 'companies_en', to_jsonb(s.names_en), 'companies_ar', to_jsonb(s.names_ar),
                                               'email_masked', case when s.email is null then null else regexp_replace(s.email, '^(.).*(@.*)$', '\1***\2') end)), '[]'::jsonb) into v_sample
    from (select * from app_private.alumni_reminder_audience(v_period, p_company_ids, p_filters, p_only_new) order by fid limit 10) s;
  return jsonb_build_object('period', v_period, 'recipients', v_n, 'with_email', v_mail, 'without_email', v_n - v_mail, 'companies', v_companies, 'already_reminded', v_already,
                            'confirm_above', 100, 'sample', v_sample);
end $$;

create or replace function public.send_alumni_reminders(p_period text default null, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false,
                                                        p_token text default null, p_expected_count integer default null, p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_period text := coalesce(p_period, app_private.alumni_period_key(now())); v_n integer; v_token text := coalesce(nullif(btrim(p_token), ''), replace(gen_random_uuid()::text, '-', ''));
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(v_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if v_token !~ '^[A-Za-z0-9_-]{8,64}$' then perform app_private.alumni_fail('token', 'bad_value'); end if;
  if p_company_ids is not null and cardinality(p_company_ids) > 1000 then perform app_private.alumni_fail('company_ids', 'too_many'); end if;
  if p_app_url is not null and btrim(p_app_url) <> '' and btrim(p_app_url) !~ '^https?://[^[:space:]"''<>]{1,255}$' then perform app_private.alumni_fail('app_url', 'bad_url'); end if;
  select count(*)::int into v_n from app_private.alumni_reminder_audience(v_period, p_company_ids, p_filters, p_only_new);
  if v_n > 100 and p_expected_count is distinct from v_n then
    raise exception 'alumni_confirm_required: % recipients; confirm the exact count to send', v_n using errcode = 'P0001', hint = 'alumni_confirm_required', detail = v_n::text;
  end if;
  return app_private.alumni_reminders_send(v_period, 'manual:' || lower(v_token), 'manual', v_uid, p_company_ids, p_filters, coalesce(p_only_new, false), p_app_url, now(), null);
end $$;

create or replace function public.list_alumni_reminder_campaigns(p_period text default null, p_limit integer default 20, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 100); v_off integer := greatest(coalesce(p_offset, 0), 0); v_rows jsonb; v_total integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_period is not null and not app_private.alumni_period_ok(p_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  select count(*)::int into v_total from app_private.alumni_reminder_campaigns c where p_period is null or c.period_key = p_period;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'period_key', c.period_key, 'trigger', c.trigger, 'kind', case when c.kind like 'manual:%' then 'manual' else c.kind end, 'status', c.status,
           'created_at', c.created_at, 'created_by_name', nullif(btrim(pr.full_name), ''), 'recipients', c.recipients, 'notified', c.notified, 'emailed', c.emailed, 'no_email', c.no_email, 'note', c.note,
           'delivery', coalesce((select jsonb_object_agg(z.st, z.n) from (select app_private.email_state(o.status, o.blocked_reason) as st, count(*) as n
                                   from app_private.alumni_reminder_log l join app_private.email_outbox o on o.id = l.outbox_id where l.campaign_id = c.id group by 1) z), '{}'::jsonb),
           'read', (select count(*) from app_private.alumni_reminder_log l join public.notifications n on n.id = l.notification_id and n.is_read where l.campaign_id = c.id))
           order by c.created_at desc, c.id), '[]'::jsonb)
    into v_rows
    from (select * from app_private.alumni_reminder_campaigns x where p_period is null or x.period_key = p_period order by x.created_at desc, x.id limit v_lim offset v_off) c
    left join public.profiles pr on pr.id = c.created_by;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- ================================================================= 9. the quarter status page
create or replace function public.list_alumni_quarter_status(p_period text default null, p_filters jsonb default '{}'::jsonb, p_status text default null, p_limit integer default 50,
                                                             p_offset integer default 0, p_sort text default 'name', p_dir text default 'asc') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_period text := coalesce(p_period, app_private.alumni_period_key(now())); v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 500); v_off integer := greatest(coalesce(p_offset, 0), 0);
        v_sort text := coalesce(nullif(p_sort, ''), 'name'); v_dir text := lower(coalesce(nullif(p_dir, ''), 'asc')); v_counts jsonb; v_rows jsonb; v_total integer; v_today date := app_private.alumni_today();
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(v_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if p_status is not null and p_status not in ('confirmed', 'updated', 'not_updated', 'closed') then perform app_private.alumni_fail('status', 'bad_value'); end if;
  if v_sort not in ('name', 'status', 'modified', 'reminded') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  if v_dir not in ('asc', 'desc') then perform app_private.alumni_fail('dir', 'bad_value'); end if;

  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', v_today) i),
       base as (
         select c.id, c.name_en, c.name_ar, c.logo_path, f.updated_at as f_updated, f.updated_source, f.updated_by, f.confirmed_at, f.confirmed_by, f.confirmed_period,
                sn.frozen_at, sn.frozen_source, sn.reported as sn_reported, sn.corrected_at, sn.status as sn_status,
                case when sn.id is not null then 'closed'
                     when f.confirmed_period = v_period and f.confirmed_at >= f.updated_at then 'confirmed'
                     when f.period_key = v_period then 'updated' else 'not_updated' end as st
           from public.companies c join ids on ids.id = c.id
           left join public.company_figures f on f.company_id = c.id
           left join public.company_snapshots sn on sn.company_id = c.id and sn.snapshot_type = 'quarter' and sn.period_key = v_period),
       rem as (select cf.company_id, count(*)::int as n, max(l.created_at) as last_at
                 from app_private.alumni_reminder_log l join public.company_founders cf on cf.founder_id = l.founder_id
                where l.period_key = v_period and cf.company_id in (select b.id from base b) group by cf.company_id),
       fnd as (select cf.company_id, count(*)::int as total, (count(*) filter (where f.auth_user_id is not null))::int as with_account
                 from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
                where cf.company_id in (select b.id from base b) group by cf.company_id),
       counts as (select jsonb_build_object('total', count(*), 'confirmed', count(*) filter (where st = 'confirmed'), 'updated', count(*) filter (where st = 'updated'),
                                            'not_updated', count(*) filter (where st = 'not_updated'), 'closed', count(*) filter (where st = 'closed')) as j from base),
       filtered as (select b.*, rem.n as rem_n, rem.last_at as rem_last, fnd.total as f_total, fnd.with_account as f_acc,
                           row_number() over (order by
                             case when v_sort = 'name' and v_dir = 'asc' then lower(coalesce(b.name_en, b.name_ar)) end asc,
                             case when v_sort = 'name' and v_dir = 'desc' then lower(coalesce(b.name_en, b.name_ar)) end desc,
                             case when v_sort = 'status' and v_dir = 'asc' then case b.st when 'not_updated' then 0 when 'updated' then 1 when 'confirmed' then 2 else 3 end end asc,
                             case when v_sort = 'status' and v_dir = 'desc' then case b.st when 'not_updated' then 0 when 'updated' then 1 when 'confirmed' then 2 else 3 end end desc,
                             case when v_sort = 'modified' and v_dir = 'asc' then extract(epoch from b.f_updated) end asc nulls first,
                             case when v_sort = 'modified' and v_dir = 'desc' then extract(epoch from b.f_updated) end desc nulls last,
                             case when v_sort = 'reminded' and v_dir = 'asc' then coalesce(rem.n, 0) end asc,
                             case when v_sort = 'reminded' and v_dir = 'desc' then coalesce(rem.n, 0) end desc,
                             lower(coalesce(b.name_en, b.name_ar)), b.id) as rn
                      from base b left join rem on rem.company_id = b.id left join fnd on fnd.company_id = b.id
                     where p_status is null or b.st = p_status)
  select (select j from counts), (select count(*) from filtered)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'logo_path', p.logo_path, 'status', p.st,
           'last_modified', p.f_updated, 'updated_source', p.updated_source, 'updated_by_name', nullif(btrim(pu.full_name), ''),
           'confirmed_at', case when p.confirmed_period = v_period then p.confirmed_at end, 'confirmed_by_name', nullif(btrim(pc.full_name), ''),
           'snapshot', case when p.frozen_at is not null then jsonb_build_object('frozen_at', p.frozen_at, 'source', p.frozen_source, 'reported', p.sn_reported, 'corrected', p.corrected_at is not null, 'status', p.sn_status) end,
           'reminders', jsonb_build_object('count', coalesce(p.rem_n, 0), 'last_at', p.rem_last),
           'founders', jsonb_build_object('total', coalesce(p.f_total, 0), 'with_account', coalesce(p.f_acc, 0))) order by p.rn), '[]'::jsonb)
    into v_counts, v_total, v_rows
    from (select * from filtered where rn > v_off and rn <= v_off + v_lim) p
    left join public.profiles pu on pu.id = p.updated_by
    left join public.profiles pc on pc.id = p.confirmed_by;
  return jsonb_build_object('period', jsonb_build_object('key', v_period, 'start', app_private.alumni_period_start(v_period), 'end', app_private.alumni_period_end(v_period),
           'deadline', ((app_private.alumni_period_end(v_period) at time zone app_private.alumni_tz())::date - 1), 'is_current', v_period = app_private.alumni_period_key(now()),
           'timezone', app_private.alumni_tz()),
         'counts', v_counts, 'total', v_total, 'limit', v_lim, 'offset', v_off, 'status', p_status, 'rows', v_rows);
end $$;

-- ================================================================= 10. grants (nothing of the machinery is executable by an API role)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace
            and p.proname in ('alumni_reminder_default', 'alumni_fill', 'alumni_email_html', 'alumni_template_check', 'alumni_reminder_vars', 'alumni_reminder_render', 'alumni_reminder_audience',
                              'alumni_reminders_send', 'alumni_quarter_tick', 'alumni_quarter_scheduler_status', 'alumni_quarter_scheduler_enable', 'alumni_quarter_scheduler_disable') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('get_alumni_quarter_settings', 'set_alumni_quarter_settings', 'save_alumni_reminder_template', 'reset_alumni_reminder_template', 'preview_alumni_reminder_template',
                              'preview_alumni_reminders', 'send_alumni_reminders', 'list_alumni_reminder_campaigns', 'list_alumni_quarter_status') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;

-- ================================================================= 11. self-check
do $$
begin
  if (select count(*) from app_private.alumni_reminder_templates) < 2 then raise exception 'm68: the default templates are missing'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_alumni_quarter_settings', 'set_alumni_quarter_settings', 'save_alumni_reminder_template',
        'reset_alumni_reminder_template', 'preview_alumni_reminder_template', 'preview_alumni_reminders', 'send_alumni_reminders', 'list_alumni_reminder_campaigns', 'list_alumni_quarter_status')
        and has_function_privilege('anon', p.oid, 'EXECUTE')) then raise exception 'm68: anon can execute a reminder function'; end if;
  if has_table_privilege('authenticated', 'app_private.alumni_reminder_log', 'SELECT') or has_table_privilege('authenticated', 'app_private.alumni_reminder_templates', 'SELECT') then
    raise exception 'm68: an API role can read the reminder tables';
  end if;
  if position('alumni_quarter_reminder' in pg_get_functiondef('app_private.email_pick_sender(app_private.email_outbox)'::regprocedure)) = 0 then raise exception 'm68: the sender patch is missing'; end if;
  raise notice 'm68 ok';
end $$;

commit;
