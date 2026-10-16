-- m70_alumni_closed_followup.sql  (owner decision 22, 2026-10-15: CLOSED companies keep receiving the quarterly reminders, with a DIFFERENT message and a DIFFERENT form: "what are you doing now?")
-- Re-runnable (create / alter ... if not exists, drop function if exists + create or replace, in-place patches that check themselves). Local DB only.
-- Run AFTER m49, m51, m66, m67, m68, m69 and AGAIN after any re-run of m68 / m69 (those re-create the single-audience reminder functions this file replaces).
-- Verify with db/verify/v70_alumni_closed_followup.sql.
--
-- THE MODEL
--  * ANSWER     public.company_after_closing: ONE row per CLOSED company = the LATEST answer to "what are you doing now?" (owner decision 21: no per-edit history, no per-edit log; only
--               `answered_at` / `answered_by` / `answered_source`). Three types, the keys of the existing `after_closing` lookup (nothing new in the vocabulary, no duplicated fact):
--                 new_startup  a NEW VENTURE: venture_name, field_key (sector lookup), venture_stage (stage lookup), venture_url (http / https), venture_description, wants_programs
--                              ("I am interested in joining Athar programs with this new project": the flag the team acts on);
--                 employed     EMPLOYED: employer, job_title, field_key (the sector / industry he settled in);
--                 other        free text (other_text).
--               The fields of the other types are always NULL (a CHECK; saving a new type replaces the whole answer). Free text never holds a national-ID-shaped number (the at-rest scan of v52).
--               ONE answer per company (not per founder): any founder of the company (or the alumni manager) writes it; the latest one wins and the reminders of the quarter stop for every founder of it.
--  * 'After closing'  the directory column / Excel column "After closing" (design 09 row 27) = the answer type when the company is closed and has an answer, otherwise the typed
--               companies.after_closing_key (unchanged). DERIVED at read time (app_private.alumni_after_closing_key / _text); never copied into companies. The Excel text adds the detail
--               (the venture's name / the employer). The company form still edits the typed key.
--  * REMINDERS  two VARIANTS of the quarterly reminder: 'figures' (m68, unchanged wording and audience) and 'closed'. The closed audience = founders (account + role founder, not banned / deleted)
--               of ALUMNI companies with operating_status = 'closed' whose quarter is not frozen and whose company has NOT answered in that quarter yet. One row per founder (his closed companies
--               listed together). A founder with an active and a closed company gets one reminder of each variant.
--               Templates: app_private.alumni_reminder_templates is keyed (lang, variant); the closed variant has its own ar / en wording (flagged finalised = false: "wording to be finalised by
--               the owner") with {founder_name} {company_name} {quarter} {link} ({deadline} is refused in it). The link is /alumni/founder/after-closing?company=<id>.
--               IDEMPOTENCY: app_private.alumni_reminder_log is unique on (founder, quarter, kind, VARIANT); the e-mail's idempotency key gets the suffix `:closed` for that variant.
--               ONE campaign (period, kind) covers both audiences (the scheduler, the retry and the manual send go through the same function); the campaign list shows the closed share.
--               Manual preview / send take `p_audience` = all | figures | closed; the preview returns the two audiences separately (recipients, with e-mail, already reminded, a sample) + `total`.
--  * MANAGER    public.list_alumni_closed_followups: the closed companies with the latest answer, filters (the directory filters + answered / not answered + type + interested), counts, sort, paging.
--  * FOUNDER    public.get_company_after_closing / public.save_company_after_closing (founder of the company, or the alumni manager / super_admin).
--  * LOOKUPS    the sector / stage / after_closing values an answer uses cannot be deleted from the vocabulary (delete_alumni_lookup is patched in place; deactivating stays possible).
--
-- Error tokens: `alumni_invalid` (22023, detail field:reason), `forbidden` (42501), `alumni_not_found` (P0002), `alumni_not_closed` (P0001), `alumni_confirm_required` (P0001, detail = the count).
-- NULL SAFETY: every guard fails closed (`coalesce`, `is not true`, `is distinct from`).
set search_path = public, extensions;

begin;

-- ================================================================= 1. the answer table
create table if not exists public.company_after_closing (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  answer_type       text not null check (answer_type in ('new_startup', 'employed', 'other')),
  venture_name      text,
  field_key         text,
  venture_stage     text,
  venture_url       text,
  venture_description text,
  wants_programs    boolean not null default false,
  employer          text,
  job_title         text,
  other_text        text,
  answered_at       timestamptz not null default now(),
  answered_by       uuid references auth.users (id) on delete set null,
  answered_source   text not null default 'founder' check (answered_source in ('founder', 'manager')),
  constraint company_after_closing_shape_chk check (
    (answer_type = 'new_startup' and venture_name is not null and field_key is not null and employer is null and job_title is null and other_text is null)
    or (answer_type = 'employed' and employer is not null and job_title is not null and field_key is not null and venture_name is null and venture_stage is null and venture_url is null
        and venture_description is null and not wants_programs and other_text is null)
    or (answer_type = 'other' and other_text is not null and venture_name is null and field_key is null and venture_stage is null and venture_url is null and venture_description is null
        and not wants_programs and employer is null and job_title is null)),
  constraint company_after_closing_len_chk check (
    (venture_name is null or char_length(venture_name) between 1 and 150) and (employer is null or char_length(employer) between 1 and 150) and (job_title is null or char_length(job_title) between 1 and 150)
    and (venture_description is null or char_length(venture_description) between 1 and 1000) and (other_text is null or char_length(other_text) between 1 and 1000)
    and (venture_url is null or (char_length(venture_url) <= 500 and venture_url ~* '^https?://[^[:space:]]+$')))
);
create index if not exists company_after_closing_answered_by_idx on public.company_after_closing (answered_by) where answered_by is not null;   -- the FK to auth.users (V02.1a of v10)
create index if not exists company_after_closing_wants_idx on public.company_after_closing (company_id) where wants_programs;
alter table public.company_after_closing enable row level security;
alter table public.company_after_closing force row level security;
drop policy if exists company_after_closing_select_own_mgr on public.company_after_closing;
create policy company_after_closing_select_own_mgr on public.company_after_closing for select to authenticated
  using (company_id in (select app_private.my_company_ids()) or (select app_private.has_any_role(array['alumni_manager', 'super_admin'])));
revoke all on public.company_after_closing from public, anon, authenticated;
-- the founders of the company and the managers read the answer; the actor column (answered_by) is not granted. Writes only through save_company_after_closing.
grant select (company_id, answer_type, venture_name, field_key, venture_stage, venture_url, venture_description, wants_programs, employer, job_title, other_text, answered_at, answered_source)
  on public.company_after_closing to authenticated;
grant select, insert, update, delete on public.company_after_closing to service_role;

-- ================================================================= 2. "After closing" derived from the answer
-- the key shown in the directory / table: the answer type of a CLOSED company that answered, otherwise the typed key
create or replace function app_private.alumni_after_closing_key(p_company uuid, p_typed text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.answer_type from public.company_after_closing a join public.companies c on c.id = a.company_id
                    where a.company_id = p_company and c.operating_status = 'closed'), p_typed)
$$;
-- the Excel text: the label (+ the detail of the answer: the venture's name / the employer)
create or replace function app_private.alumni_after_closing_text(p_company uuid, p_typed text, p_lang text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(concat_ws(' - ', app_private.alumni_label('after_closing', a.answer_type, p_lang),
                             case a.answer_type when 'new_startup' then a.venture_name when 'employed' then a.employer else left(a.other_text, 120) end), '')
       from public.company_after_closing a join public.companies c on c.id = a.company_id
      where a.company_id = p_company and c.operating_status = 'closed'),
    app_private.alumni_label('after_closing', p_typed, p_lang))
$$;

-- ================================================================= 3. readers patched IN PLACE on their current definitions (each patch is asserted)
do $$
declare v_def text; v_new text; f regprocedure;
begin
  -- the manager table (list_alumni_table): the "after_closing" value of every row
  f := 'public.list_alumni_table(jsonb,integer,integer,text,text,integer)'::regprocedure;
  v_def := pg_get_functiondef(f);
  v_new := replace(v_def, '''after_closing'', pg.after_closing_key', '''after_closing'', app_private.alumni_after_closing_key(pg.id, pg.after_closing_key)');
  if v_new = v_def and position('alumni_after_closing_key' in v_def) = 0 then raise exception 'm70: list_alumni_table has a shape this patch does not know'; end if;
  if v_new <> v_def then execute v_new; end if;

  -- the Excel export: the "After closing" column
  f := 'public.export_alumni_rows(jsonb,integer,text,date)'::regprocedure;
  v_def := pg_get_functiondef(f);
  v_new := replace(v_def, 'app_private.alumni_label(''after_closing'', c.after_closing_key, v_lang)', 'app_private.alumni_after_closing_text(c.id, c.after_closing_key, v_lang)');
  if v_new = v_def and position('alumni_after_closing_text' in v_def) = 0 then raise exception 'm70: export_alumni_rows has a shape this patch does not know'; end if;
  if v_new <> v_def then execute v_new; end if;

  -- a vocabulary value an answer uses cannot be deleted (deactivating it stays possible)
  f := 'public.delete_alumni_lookup(text,text)'::regprocedure;
  v_def := pg_get_functiondef(f);
  v_new := v_def;
  if position('company_after_closing' in v_new) = 0 then
    v_new := replace(v_new, 'exists (select 1 from public.companies c where c.sector_key = l.key) or', 'exists (select 1 from public.companies c where c.sector_key = l.key) or exists (select 1 from public.company_after_closing a where a.field_key = l.key) or');
    v_new := replace(v_new, 'when ''stage'' then exists (select 1 from public.companies c where c.stage = l.key)', 'when ''stage'' then exists (select 1 from public.companies c where c.stage = l.key) or exists (select 1 from public.company_after_closing a where a.venture_stage = l.key)');
    v_new := replace(v_new, 'when ''after_closing'' then exists (select 1 from public.companies c where c.after_closing_key = l.key)', 'when ''after_closing'' then exists (select 1 from public.companies c where c.after_closing_key = l.key) or exists (select 1 from public.company_after_closing a where a.answer_type = l.key)');
    if v_new = v_def then raise exception 'm70: delete_alumni_lookup has a shape this patch does not know'; end if;
    execute v_new;
  end if;

  -- the quarter status page counts the FIGURES reminders of a company only
  f := 'public.list_alumni_quarter_status(text,jsonb,text,integer,integer,text,text)'::regprocedure;
  v_def := pg_get_functiondef(f);
  v_new := replace(v_def, 'where l.period_key = v_period and cf.company_id in (select b.id from base b)', 'where l.period_key = v_period and l.variant = ''figures'' and cf.company_id in (select b.id from base b)');
  if v_new = v_def and position('l.variant = ''figures''' in v_def) = 0 then raise exception 'm70: list_alumni_quarter_status has a shape this patch does not know'; end if;
  if v_new <> v_def then execute v_new; end if;
end $$;

-- ================================================================= 4. the reminder tables get the VARIANT
alter table app_private.alumni_reminder_templates add column if not exists variant text not null default 'figures';
alter table app_private.alumni_reminder_templates drop constraint if exists alumni_reminder_templates_variant_check;
alter table app_private.alumni_reminder_templates add constraint alumni_reminder_templates_variant_check check (variant in ('figures', 'closed'));
do $$
declare v_pk text;
begin
  select c.conname into v_pk from pg_constraint c where c.conrelid = 'app_private.alumni_reminder_templates'::regclass and c.contype = 'p' and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (lang)';
  if v_pk is not null then
    execute format('alter table app_private.alumni_reminder_templates drop constraint %I', v_pk);
    alter table app_private.alumni_reminder_templates add primary key (lang, variant);
  end if;
end $$;

alter table app_private.alumni_reminder_log add column if not exists variant text not null default 'figures';
alter table app_private.alumni_reminder_log drop constraint if exists alumni_reminder_log_variant_check;
alter table app_private.alumni_reminder_log add constraint alumni_reminder_log_variant_check check (variant in ('figures', 'closed'));
alter table app_private.alumni_reminder_log drop constraint if exists alumni_reminder_log_idem_key;
do $$
begin
  if not exists (select 1 from pg_constraint c where c.conrelid = 'app_private.alumni_reminder_log'::regclass and c.conname = 'alumni_reminder_log_idem_variant_key') then
    alter table app_private.alumni_reminder_log add constraint alumni_reminder_log_idem_variant_key unique (founder_id, period_key, kind, variant);
  end if;
end $$;

-- the single-audience signatures of m68 / m69 are replaced by the variant-aware ones below (a left-over overload would be ambiguous for PostgREST)
drop function if exists app_private.alumni_reminder_default(text, text);
drop function if exists app_private.alumni_template_check(text, text, integer);
drop function if exists app_private.alumni_reminder_render(text, jsonb, jsonb);
drop function if exists app_private.alumni_reminders_send(text, text, text, uuid, uuid[], jsonb, boolean, text, timestamptz, text);
drop function if exists public.save_alumni_reminder_template(text, jsonb);
drop function if exists public.reset_alumni_reminder_template(text);
drop function if exists public.preview_alumni_reminder_template(text, jsonb);
drop function if exists public.preview_alumni_reminders(text, uuid[], jsonb, boolean);
drop function if exists public.send_alumni_reminders(text, uuid[], jsonb, boolean, text, integer, text);

-- ================================================================= 5. the default wording (inserted only when a (language, variant) has no row; a manager's edits are never overwritten by a re-run)
create or replace function app_private.alumni_reminder_default(p_lang text, p_field text, p_variant text default 'figures') returns text language sql immutable set search_path = '' as $$
  select case coalesce(p_variant, 'figures') || '.' || p_lang || '.' || p_field
    when 'figures.ar.notif_title'   then 'حدّث بيانات {company_name} قبل إغلاق {quarter}'
    when 'figures.ar.notif_body'    then 'مرحباً {founder_name}، يُقفل {quarter} بتاريخ {deadline}. ادخل إلى المنصة وحدّث أرقام شركتك (الإيرادات وعدد الموظفين والتمويل) أو أكّد أنها كما هي.'
    when 'figures.ar.email_subject' then 'تحديث بيانات {company_name} قبل إغلاق {quarter}'
    when 'figures.ar.email_body'    then E'مرحباً {founder_name}،\n\nيُقفل {quarter} بتاريخ {deadline}. من فضلك ادخل إلى المنصة وحدّث بيانات {company_name} (الإيرادات وعدد الموظفين والتمويل) أو أكّد أنها كما هي. هذا يساعدنا في معرفة من يمكن أن نفيده بالفرص القريبة.\n\n{link}\n\nشكراً،\nفريق أثر'
    when 'figures.en.notif_title'   then 'Update the figures of {company_name} before {quarter} closes'
    when 'figures.en.notif_body'    then 'Hello {founder_name}, {quarter} closes on {deadline}. Sign in and update your company''s figures (revenue, employees, funding) or confirm they are still right.'
    when 'figures.en.email_subject' then 'Update the figures of {company_name} before {quarter} closes'
    when 'figures.en.email_body'    then E'Hello {founder_name},\n\n{quarter} closes on {deadline}. Please sign in and update the figures of {company_name} (revenue, employees, funding) or confirm they are still right. It helps us know whom we can support with upcoming opportunities.\n\n{link}\n\nThank you,\nThe Athar team'
    when 'closed.ar.notif_title'    then 'ما أخبارك بعد {company_name}؟'
    when 'closed.ar.notif_body'     then 'مرحباً {founder_name}، نتمنى أن تكون بخير. نحب أن نعرف ماذا تفعل الآن بعد إغلاق {company_name}: بدأت مشروعاً جديداً، أم التحقت بوظيفة، أم شيئاً آخر؟ إجابة قصيرة منك تكفي، ويمكنك تغييرها في أي وقت.'
    when 'closed.ar.email_subject'  then 'ماذا تفعل الآن؟ نريد أن نطمئن عليك ({quarter})'
    when 'closed.ar.email_body'     then E'مرحباً {founder_name}،\n\nنتمنى أن تكون بخير. نحن في أثر نهتم بمسيرتك بعد إغلاق {company_name}: هل بدأت مشروعاً جديداً؟ أم التحقت بوظيفة؟ أم تفعل شيئاً آخر؟ ادخل من الرابط وأجب في أقل من دقيقة. وإن كان لديك مشروع جديد يسعدنا أن تنضم إلى برامجنا به.\n\n{link}\n\nشكراً،\nفريق أثر'
    when 'closed.en.notif_title'    then 'How are you doing after {company_name}?'
    when 'closed.en.notif_body'     then 'Hello {founder_name}, we hope you are well. We would love to know what you are doing now after {company_name} closed: a new venture, a job, or something else? A short answer is enough, and you can change it any time.'
    when 'closed.en.email_subject'  then 'What are you doing now? We would like to hear from you ({quarter})'
    when 'closed.en.email_body'     then E'Hello {founder_name},\n\nWe hope you are well. At Athar we care about your journey after {company_name} closed: did you start a new venture, take a job, or do something else? Open the link and answer in under a minute. If you have a new project, we would be glad to see you join our programs with it.\n\n{link}\n\nThank you,\nThe Athar team'
  end
$$;
insert into app_private.alumni_reminder_templates (lang, variant, notif_title, notif_body, email_subject, email_body)
select l, v, app_private.alumni_reminder_default(l, 'notif_title', v), app_private.alumni_reminder_default(l, 'notif_body', v), app_private.alumni_reminder_default(l, 'email_subject', v), app_private.alumni_reminder_default(l, 'email_body', v)
  from (values ('ar'), ('en')) a (l), (values ('figures'), ('closed')) b (v)
on conflict do nothing;

-- ================================================================= 6. text helpers (variant aware)
-- a template field: required, bounded, only the known placeholders of the variant ({deadline} belongs to the figures variant only), no national-ID-shaped number
create or replace function app_private.alumni_template_check(p_field text, p_text text, p_max integer, p_variant text default 'figures') returns text
language plpgsql stable set search_path = '' as $$
declare t text := btrim(coalesce(p_text, '')); m text; v_allowed text[] := case when coalesce(p_variant, 'figures') = 'closed' then array['founder_name', 'company_name', 'quarter', 'link']
                                                                               else array['founder_name', 'company_name', 'quarter', 'deadline', 'link'] end;
begin
  if t = '' then perform app_private.alumni_fail(p_field, 'required'); end if;
  if char_length(t) > p_max then perform app_private.alumni_fail(p_field, 'too_long'); end if;
  for m in select x[1] from regexp_matches(t, '\{([^{}]*)\}', 'g') x loop
    if m <> all (v_allowed) then perform app_private.alumni_fail(p_field, 'unknown_placeholder:' || left(m, 30)); end if;
  end loop;
  if app_private.contains_id(t) then perform app_private.alumni_fail(p_field, 'contains_id'); end if;
  return t;
end $$;

create or replace function app_private.alumni_reminder_render(p_lang text, p_vars jsonb, p_override jsonb default null, p_variant text default 'figures')
returns table (notif_title text, notif_body text, email_subject text, email_body_text text, email_html text)
language plpgsql stable security definer set search_path = '' as $$
declare t app_private.alumni_reminder_templates; v_vars_html jsonb; ti text; bo text; su text; eb text; v_var text := case when p_variant = 'closed' then 'closed' else 'figures' end;
begin
  select * into t from app_private.alumni_reminder_templates x where x.lang = p_lang and x.variant = v_var;
  ti := coalesce(p_override ->> 'notif_title', t.notif_title, app_private.alumni_reminder_default(p_lang, 'notif_title', v_var));
  bo := coalesce(p_override ->> 'notif_body', t.notif_body, app_private.alumni_reminder_default(p_lang, 'notif_body', v_var));
  su := coalesce(p_override ->> 'email_subject', t.email_subject, app_private.alumni_reminder_default(p_lang, 'email_subject', v_var));
  eb := coalesce(p_override ->> 'email_body', t.email_body, app_private.alumni_reminder_default(p_lang, 'email_body', v_var));
  v_vars_html := p_vars || jsonb_build_object('link', chr(1));
  notif_title := app_private.alumni_fill(ti, p_vars);
  notif_body := app_private.alumni_fill(bo, p_vars);
  email_subject := replace(replace(app_private.alumni_fill(su, p_vars), E'\n', ' '), E'\r', ' ');
  email_body_text := app_private.alumni_fill(eb, p_vars);
  email_html := app_private.alumni_email_html(app_private.alumni_fill(eb, v_vars_html), p_vars ->> 'link', p_lang);
  return next;
end $$;

-- ================================================================= 7. the audiences
-- FIGURES (m69 definition) + the variant filter of "already reminded"
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
      join public.companies c on c.id = cf.company_id and c.deleted_at is null and c.is_alumni and coalesce(c.operating_status, 'open') <> 'closed'
     where f.deleted_at is null and f.auth_user_id is not null
       and not exists (select 1 from auth.users bu where bu.id = f.auth_user_id and (bu.deleted_at is not null or (bu.banned_until is not null and bu.banned_until > now())))
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
   where not coalesce(p_only_new, false) or not exists (select 1 from app_private.alumni_reminder_log l where l.founder_id = x.xf and l.period_key = p_period and l.variant = 'figures')
   group by x.xf, x.xu, u.email, pr.language
   order by x.xf;
end $$;

-- CLOSED: founders of CLOSED alumni companies whose quarter is not frozen and that have not answered in this quarter
create or replace function app_private.alumni_reminder_audience_closed(p_period text, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false)
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
      join public.companies c on c.id = cf.company_id and c.deleted_at is null and c.is_alumni and c.operating_status = 'closed'
     where f.deleted_at is null and f.auth_user_id is not null
       and not exists (select 1 from auth.users bu where bu.id = f.auth_user_id and (bu.deleted_at is not null or (bu.banned_until is not null and bu.banned_until > now())))
       and exists (select 1 from public.user_roles r where r.user_id = f.auth_user_id and r.role_key = 'founder')
       and (p_company_ids is null or c.id = any (p_company_ids))
       and (v_ids is null or c.id = any (v_ids))
       and not exists (select 1 from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'quarter' and s.period_key = p_period)
       and not exists (select 1 from public.company_after_closing a where a.company_id = c.id and app_private.alumni_period_key(a.answered_at) = p_period))
  select x.xf, x.xu, (array_agg(x.xc order by x.xp desc, x.xcf, x.xc))[1], array_agg(x.xc order by x.xp desc, x.xcf, x.xc),
         array_agg(coalesce(x.cn_en, x.cn_ar) order by x.xp desc, x.xcf, x.xc), array_agg(coalesce(x.cn_ar, x.cn_en) order by x.xp desc, x.xcf, x.xc),
         max(x.f_en), max(x.f_ar), coalesce(u.email::text, max(x.f_email)), coalesce(pr.language, 'ar')
    from cand x
    left join auth.users u on u.id = x.xu
    left join public.profiles pr on pr.id = x.xu
   where not coalesce(p_only_new, false) or not exists (select 1 from app_private.alumni_reminder_log l where l.founder_id = x.xf and l.period_key = p_period and l.variant = 'closed')
   group by x.xf, x.xu, u.email, pr.language
   order by x.xf;
end $$;

create or replace function app_private.alumni_reminder_audience_v(p_variant text, p_period text, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false)
returns table (fid uuid, uid uuid, cid uuid, cids uuid[], names_en text[], names_ar text[], fn_en text, fn_ar text, email text, lang text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_variant = 'closed' then
    return query select * from app_private.alumni_reminder_audience_closed(p_period, p_company_ids, p_filters, p_only_new);
  else
    return query select * from app_private.alumni_reminder_audience(p_period, p_company_ids, p_filters, p_only_new);
  end if;
end $$;

-- ================================================================= 8. sending (the ONE path: the scheduler and the manager both come here; both audiences in one campaign)
create or replace function app_private.alumni_reminders_send(p_period text, p_kind text, p_trigger text, p_by uuid, p_company_ids uuid[], p_filters jsonb, p_only_new boolean,
                                                             p_app_url text, p_now timestamptz default now(), p_note text default null, p_audience text default 'all') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_camp uuid; r record; v_log uuid; v_base text; v_path text; v_link text; v_notif uuid; v_out uuid; v_lang text; rr record; ra record; re record;
        v_new integer; v_dup integer; v_total integer; v_noemail integer; v_url text; v_var text; v_res jsonb := '{}'::jsonb; v_all_new integer := 0; v_all_dup integer := 0; v_all_total integer := 0; v_all_noemail integer := 0;
        v_key text;
begin
  if not app_private.alumni_period_ok(p_period) or p_kind is null or p_kind !~ '^[a-z0-9:_-]{1,80}$' or p_trigger is null or p_trigger not in ('schedule', 'manual')
     or p_audience is null or p_audience not in ('all', 'figures', 'closed') then
    perform app_private.alumni_fail('reminder', 'bad_value');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_reminders:' || p_period || ':' || p_kind, 0));
  select * into s from app_private.alumni_quarter_settings;
  -- the STORED address wins; a manager-supplied address is used only by a manual send while none is stored (never to redirect the links of a configured platform)
  v_url := coalesce(s.app_base_url, case when p_trigger = 'manual' then nullif(btrim(p_app_url), '') end);
  if v_url is not null and v_url !~ '^https?://[^[:space:]"''<>]{1,255}$' then v_url := null; end if;
  v_base := rtrim(v_url, '/');
  insert into app_private.alumni_reminder_campaigns (period_key, trigger, kind, created_by, note) values (p_period, p_trigger, p_kind, p_by, left(p_note, 300))
  on conflict (period_key, kind) do nothing returning id into v_camp;
  if v_camp is null then select c.id into v_camp from app_private.alumni_reminder_campaigns c where c.period_key = p_period and c.kind = p_kind; end if;
  foreach v_var in array array['figures', 'closed'] loop
    v_new := 0; v_dup := 0; v_total := 0; v_noemail := 0;
    if p_audience in ('all', v_var) then
      for r in select * from app_private.alumni_reminder_audience_v(v_var, p_period, p_company_ids, p_filters, p_only_new) loop
        v_total := v_total + 1;
        insert into app_private.alumni_reminder_log (campaign_id, period_key, kind, variant, founder_id, user_id, company_id) values (v_camp, p_period, p_kind, v_var, r.fid, r.uid, r.cid)
        on conflict (founder_id, period_key, kind, variant) do nothing returning id into v_log;
        if v_log is null then v_dup := v_dup + 1; continue; end if;
        v_new := v_new + 1;
        v_lang := case when r.lang = 'en' then 'en' else 'ar' end;
        v_path := case when v_var = 'closed' then '/alumni/founder/after-closing?company=' else '/alumni/founder/progress?company=' end || r.cid::text;
        v_link := case when v_base is null then v_path else v_base || v_path end;
        select * into ra from app_private.alumni_reminder_render('ar', app_private.alumni_reminder_vars('ar', coalesce(r.fn_ar, r.fn_en), array_to_string((r.names_ar)[1:3], '، '), p_period, v_link), null, v_var);
        select * into re from app_private.alumni_reminder_render('en', app_private.alumni_reminder_vars('en', coalesce(r.fn_en, r.fn_ar), array_to_string((r.names_en)[1:3], ', '), p_period, v_link), null, v_var);
        if v_lang = 'ar' then rr := ra; else rr := re; end if;
        insert into public.notifications (recipient_id, founder_id, title, body, audience_type, audience_target_id, sent_by, metadata)
        values (r.uid, r.fid, rr.notif_title, rr.notif_body, 'founder', r.fid, p_by,
                jsonb_strip_nulls(jsonb_build_object('v', 1, 'kind', 'quarter_reminder', 'variant', v_var, 'period_key', p_period, 'company_id', r.cid, 'link', v_path,
                  'title_ar', ra.notif_title, 'title_en', re.notif_title, 'body_ar', ra.notif_body, 'body_en', re.notif_body)))
        returning id into v_notif;
        v_out := null;
        v_key := 'alumni_reminder:' || r.fid::text || ':' || p_period || ':' || p_kind || case when v_var = 'closed' then ':closed' else '' end;
        -- no address to put in the e-mail = no e-mail (its only call to action would be a dead relative link): the notification still goes out
        if v_base is not null and r.email is not null and r.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
          insert into app_private.email_outbox (email_key, recipient_email, subject, body_html, idempotency_key, created_by)
          values ('alumni_quarter_reminder', r.email::extensions.citext, rr.email_subject, rr.email_html, v_key, p_by)
          on conflict (idempotency_key) do nothing returning id into v_out;
        end if;
        if v_out is null then v_noemail := v_noemail + 1; end if;
        update app_private.alumni_reminder_log l set notification_id = v_notif, outbox_id = v_out,
               email_state = case when v_out is not null then 'queued' when v_base is null and r.email is not null then 'no_link' else 'no_email' end where l.id = v_log;
      end loop;
    end if;
    v_res := v_res || jsonb_build_object(v_var, jsonb_build_object('audience', v_total, 'sent', v_new, 'already_sent', v_dup, 'no_email', v_noemail));
    v_all_new := v_all_new + v_new; v_all_dup := v_all_dup + v_dup; v_all_total := v_all_total + v_total; v_all_noemail := v_all_noemail + v_noemail;
  end loop;
  update app_private.alumni_reminder_campaigns c set
    recipients = (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    notified = (select count(l.notification_id) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    emailed = (select count(l.outbox_id) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    no_email = (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id and l.email_state in ('no_email', 'no_link')),
    note = case when v_base is null then coalesce(c.note, 'no_app_url') else c.note end
   where c.id = v_camp;
  return jsonb_build_object('campaign_id', v_camp, 'period', p_period, 'kind', p_kind, 'audience', v_all_total, 'sent', v_all_new, 'already_sent', v_all_dup, 'no_email', v_all_noemail,
                            'link_has_address', v_base is not null, 'figures', v_res -> 'figures', 'closed', v_res -> 'closed');
end $$;

-- ================================================================= 9. settings + templates (manager)
create or replace function public.get_alumni_quarter_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_cur text := app_private.alumni_period_key(now()); v_tpl jsonb; v_tpl_closed jsonb; v_next jsonb := '[]'::jsonb; d integer; v_end_day date;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from app_private.alumni_quarter_settings;
  select coalesce(jsonb_agg(jsonb_build_object('lang', t.lang, 'variant', t.variant, 'notif_title', t.notif_title, 'notif_body', t.notif_body, 'email_subject', t.email_subject, 'email_body', t.email_body,
           'finalised', t.finalised, 'updated_at', t.updated_at,
           'is_default', t.notif_title = app_private.alumni_reminder_default(t.lang, 'notif_title', t.variant) and t.notif_body = app_private.alumni_reminder_default(t.lang, 'notif_body', t.variant)
                         and t.email_subject = app_private.alumni_reminder_default(t.lang, 'email_subject', t.variant) and t.email_body = app_private.alumni_reminder_default(t.lang, 'email_body', t.variant)) order by t.lang), '[]'::jsonb)
    into v_tpl from app_private.alumni_reminder_templates t where t.variant = 'figures';
  select coalesce(jsonb_agg(jsonb_build_object('lang', t.lang, 'variant', t.variant, 'notif_title', t.notif_title, 'notif_body', t.notif_body, 'email_subject', t.email_subject, 'email_body', t.email_body,
           'finalised', t.finalised, 'updated_at', t.updated_at,
           'is_default', t.notif_title = app_private.alumni_reminder_default(t.lang, 'notif_title', t.variant) and t.notif_body = app_private.alumni_reminder_default(t.lang, 'notif_body', t.variant)
                         and t.email_subject = app_private.alumni_reminder_default(t.lang, 'email_subject', t.variant) and t.email_body = app_private.alumni_reminder_default(t.lang, 'email_body', t.variant)) order by t.lang), '[]'::jsonb)
    into v_tpl_closed from app_private.alumni_reminder_templates t where t.variant = 'closed';
  v_end_day := (app_private.alumni_period_end(v_cur) at time zone app_private.alumni_tz())::date;
  foreach d in array coalesce(s.reminder_offsets, '{}'::integer[]) loop
    v_next := v_next || jsonb_build_array(jsonb_build_object('offset_days', d, 'due_at', ((v_end_day - d)::timestamp + make_interval(hours => s.send_hour)) at time zone app_private.alumni_tz(),
                'sent', exists (select 1 from app_private.alumni_reminder_campaigns c where c.period_key = v_cur and c.kind = 'd' || d)));
  end loop;
  return jsonb_build_object('first_period', s.first_period, 'auto_freeze', s.auto_freeze, 'auto_reminders', s.auto_reminders, 'reminder_offsets', to_jsonb(s.reminder_offsets), 'send_hour', s.send_hour,
           'app_base_url', s.app_base_url, 'timezone', app_private.alumni_tz(), 'current_period', v_cur, 'due', v_next, 'templates', v_tpl, 'closed_templates', v_tpl_closed,
           'placeholders', jsonb_build_array('founder_name', 'company_name', 'quarter', 'deadline', 'link'),
           'closed_placeholders', jsonb_build_array('founder_name', 'company_name', 'quarter', 'link'),
           'scheduler', app_private.alumni_quarter_scheduler_status());
end $$;

create or replace function public.save_alumni_reminder_template(p_lang text, p_patch jsonb, p_variant text default 'figures') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); k text; val jsonb; t app_private.alumni_reminder_templates;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('ar', 'en') then perform app_private.alumni_fail('lang', 'bad_value'); end if;
  if p_variant is null or p_variant not in ('figures', 'closed') then perform app_private.alumni_fail('variant', 'bad_value'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('template', 'not_an_object'); end if;
  select * into t from app_private.alumni_reminder_templates x where x.lang = p_lang and x.variant = p_variant for update;
  for k, val in select key, value from jsonb_each(p_patch) loop
    if jsonb_typeof(val) <> (case when k = 'finalised' then 'boolean' else 'string' end) then perform app_private.alumni_fail(k, 'bad_type'); end if;
    if k = 'notif_title' then t.notif_title := app_private.alumni_template_check(k, val #>> '{}', 200, p_variant);
    elsif k = 'notif_body' then t.notif_body := app_private.alumni_template_check(k, val #>> '{}', 1000, p_variant);
    elsif k = 'email_subject' then t.email_subject := app_private.alumni_template_check(k, val #>> '{}', 200, p_variant);
    elsif k = 'email_body' then t.email_body := app_private.alumni_template_check(k, val #>> '{}', 4000, p_variant);
    elsif k = 'finalised' then t.finalised := (val #>> '{}')::boolean;
    else perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  update app_private.alumni_reminder_templates x set notif_title = t.notif_title, notif_body = t.notif_body, email_subject = t.email_subject, email_body = t.email_body,
         finalised = t.finalised, updated_at = now(), updated_by = v_uid where x.lang = p_lang and x.variant = p_variant;
  return public.get_alumni_quarter_settings();
end $$;

create or replace function public.reset_alumni_reminder_template(p_lang text, p_variant text default 'figures') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('ar', 'en') then perform app_private.alumni_fail('lang', 'bad_value'); end if;
  if p_variant is null or p_variant not in ('figures', 'closed') then perform app_private.alumni_fail('variant', 'bad_value'); end if;
  update app_private.alumni_reminder_templates x set notif_title = app_private.alumni_reminder_default(p_lang, 'notif_title', p_variant), notif_body = app_private.alumni_reminder_default(p_lang, 'notif_body', p_variant),
         email_subject = app_private.alumni_reminder_default(p_lang, 'email_subject', p_variant), email_body = app_private.alumni_reminder_default(p_lang, 'email_body', p_variant),
         finalised = false, updated_at = now(), updated_by = v_uid where x.lang = p_lang and x.variant = p_variant;
  return public.get_alumni_quarter_settings();
end $$;

create or replace function public.preview_alumni_reminder_template(p_lang text, p_template jsonb default null, p_variant text default 'figures') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; k text; v_o jsonb := '{}'::jsonb; v_period text := app_private.alumni_period_key(now()); v_link text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('ar', 'en') then perform app_private.alumni_fail('lang', 'bad_value'); end if;
  if p_variant is null or p_variant not in ('figures', 'closed') then perform app_private.alumni_fail('variant', 'bad_value'); end if;
  if p_template is not null then
    if jsonb_typeof(p_template) <> 'object' then perform app_private.alumni_fail('template', 'not_an_object'); end if;
    for k in select jsonb_object_keys(p_template) loop
      if k not in ('notif_title', 'notif_body', 'email_subject', 'email_body') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
      if jsonb_typeof(p_template -> k) <> 'string' then perform app_private.alumni_fail(k, 'bad_type'); end if;
      v_o := v_o || jsonb_build_object(k, app_private.alumni_template_check(k, p_template ->> k, case k when 'notif_title' then 200 when 'email_subject' then 200 when 'notif_body' then 1000 else 4000 end, p_variant));
    end loop;
  end if;
  v_link := case when p_variant = 'closed' then 'https://example.org/alumni/founder/after-closing' else 'https://example.org/alumni/founder/progress' end;
  select * into r from app_private.alumni_reminder_render(p_lang, app_private.alumni_reminder_vars(p_lang, case when p_lang = 'ar' then 'سارة أحمد' else 'Sara Ahmed' end,
              case when p_lang = 'ar' then 'نايل تك' else 'Nile Tech' end, v_period, v_link), v_o, p_variant);
  return jsonb_build_object('notif_title', r.notif_title, 'notif_body', r.notif_body, 'email_subject', r.email_subject, 'email_html', r.email_html, 'email_text', r.email_body_text, 'period', v_period, 'variant', p_variant);
end $$;

-- ================================================================= 10. manual sending: the two audiences, separately
create or replace function public.preview_alumni_reminders(p_period text default null, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false,
                                                           p_audience text default 'all') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_period text := coalesce(p_period, app_private.alumni_period_key(now())); v_var text; v_n integer; v_mail integer; v_companies integer; v_sample jsonb; v_already integer; v_res jsonb := '{}'::jsonb; v_total integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(v_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if p_audience is null or p_audience not in ('all', 'figures', 'closed') then perform app_private.alumni_fail('audience', 'bad_value'); end if;
  if p_company_ids is not null and cardinality(p_company_ids) > 1000 then perform app_private.alumni_fail('company_ids', 'too_many'); end if;
  foreach v_var in array array['figures', 'closed'] loop
    v_n := 0; v_mail := 0; v_companies := 0; v_already := 0; v_sample := '[]'::jsonb;
    if p_audience in ('all', v_var) then
      select count(*)::int, (count(*) filter (where a.email is not null))::int, coalesce(sum(cardinality(a.cids)), 0)::int into v_n, v_mail, v_companies
        from app_private.alumni_reminder_audience_v(v_var, v_period, p_company_ids, p_filters, p_only_new) a;
      select count(*)::int into v_already from app_private.alumni_reminder_audience_v(v_var, v_period, p_company_ids, p_filters, false) a
       where exists (select 1 from app_private.alumni_reminder_log l where l.founder_id = a.fid and l.period_key = v_period and l.variant = v_var);
      select coalesce(jsonb_agg(jsonb_build_object('founder_id', s.fid, 'name_en', s.fn_en, 'name_ar', s.fn_ar, 'companies_en', to_jsonb(s.names_en), 'companies_ar', to_jsonb(s.names_ar),
                                                   'email_masked', case when s.email is null then null else regexp_replace(s.email, '^(.).*(@.*)$', '\1***\2') end)), '[]'::jsonb) into v_sample
        from (select * from app_private.alumni_reminder_audience_v(v_var, v_period, p_company_ids, p_filters, p_only_new) order by fid limit 10) s;
    end if;
    v_total := v_total + v_n;
    v_res := v_res || jsonb_build_object(v_var, jsonb_build_object('recipients', v_n, 'with_email', v_mail, 'without_email', v_n - v_mail, 'companies', v_companies, 'already_reminded', v_already, 'sample', v_sample));
  end loop;
  return (v_res -> 'figures') || jsonb_build_object('period', v_period, 'closed', v_res -> 'closed', 'total', v_total, 'confirm_above', 100);
end $$;

create or replace function public.send_alumni_reminders(p_period text default null, p_company_ids uuid[] default null, p_filters jsonb default null, p_only_new boolean default false,
                                                        p_token text default null, p_expected_count integer default null, p_app_url text default null, p_audience text default 'all') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_period text := coalesce(p_period, app_private.alumni_period_key(now())); v_n integer := 0; v_c integer := 0;
        v_token text := coalesce(nullif(btrim(p_token), ''), replace(gen_random_uuid()::text, '-', ''));
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(v_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if p_audience is null or p_audience not in ('all', 'figures', 'closed') then perform app_private.alumni_fail('audience', 'bad_value'); end if;
  if v_token !~ '^[A-Za-z0-9_-]{8,64}$' then perform app_private.alumni_fail('token', 'bad_value'); end if;
  if p_company_ids is not null and cardinality(p_company_ids) > 1000 then perform app_private.alumni_fail('company_ids', 'too_many'); end if;
  if p_app_url is not null and btrim(p_app_url) <> '' and btrim(p_app_url) !~ '^https?://[^[:space:]"''<>]{1,255}$' then perform app_private.alumni_fail('app_url', 'bad_url'); end if;
  if p_audience in ('all', 'figures') then select count(*)::int into v_n from app_private.alumni_reminder_audience_v('figures', v_period, p_company_ids, p_filters, p_only_new); end if;
  if p_audience in ('all', 'closed') then select count(*)::int into v_c from app_private.alumni_reminder_audience_v('closed', v_period, p_company_ids, p_filters, p_only_new); end if;
  v_n := v_n + v_c;
  if v_n > 100 and p_expected_count is distinct from v_n then
    raise exception 'alumni_confirm_required: % recipients; confirm the exact count to send', v_n using errcode = 'P0001', hint = 'alumni_confirm_required', detail = v_n::text;
  end if;
  return app_private.alumni_reminders_send(v_period, 'manual:' || lower(v_token), 'manual', v_uid, p_company_ids, p_filters, coalesce(p_only_new, false), p_app_url, now(), null, p_audience);
end $$;

-- the campaign list (m68) + the closed share of every campaign
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
           'closed_recipients', (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id and l.variant = 'closed'),
           'delivery', coalesce((select jsonb_object_agg(z.st, z.n) from (select app_private.email_state(o.status, o.blocked_reason) as st, count(*) as n
                                   from app_private.alumni_reminder_log l join app_private.email_outbox o on o.id = l.outbox_id where l.campaign_id = c.id group by 1) z), '{}'::jsonb),
           'read', (select count(*) from app_private.alumni_reminder_log l join public.notifications n on n.id = l.notification_id and n.is_read where l.campaign_id = c.id))
           order by c.created_at desc, c.id), '[]'::jsonb)
    into v_rows
    from (select * from app_private.alumni_reminder_campaigns x where p_period is null or x.period_key = p_period order by x.created_at desc, x.id limit v_lim offset v_off) c
    left join public.profiles pr on pr.id = c.created_by;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- ================================================================= 11. the answer: read / write (the founder of the company or the alumni manager)
-- one free-text field: trimmed, empty = NULL, bounded, never a national-ID-shaped number
create or replace function app_private.alumni_closed_text(p_data jsonb, p_key text, p_max integer) returns text
language plpgsql stable set search_path = '' as $$
declare t text;
begin
  if not (p_data ? p_key) or jsonb_typeof(p_data -> p_key) = 'null' then return null; end if;
  if jsonb_typeof(p_data -> p_key) <> 'string' then perform app_private.alumni_fail(p_key, 'bad_type'); end if;
  t := nullif(btrim(regexp_replace(p_data ->> p_key, '[[:cntrl:]]', ' ', 'g')), '');
  if t is null then return null; end if;
  if char_length(t) > p_max then perform app_private.alumni_fail(p_key, 'too_long'); end if;
  if app_private.contains_id(t) then perform app_private.alumni_fail(p_key, 'contains_id'); end if;
  return t;
end $$;

create or replace function app_private.alumni_after_closing_json(p_company uuid, p_manager boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; a public.company_after_closing; v_cur text := app_private.alumni_period_key(now());
begin
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null;
  if not found then return null; end if;
  select * into a from public.company_after_closing x where x.company_id = p_company;
  return jsonb_build_object('company_id', c.id, 'closed', c.operating_status = 'closed', 'closed_on', c.closed_on, 'current_period', v_cur,
    'answered_this_period', found and app_private.alumni_period_key(a.answered_at) = v_cur,
    'answer', case when a.company_id is null then null else jsonb_build_object('answer_type', a.answer_type, 'venture_name', a.venture_name, 'field', a.field_key, 'venture_stage', a.venture_stage,
        'venture_url', a.venture_url, 'venture_description', a.venture_description, 'wants_programs', a.wants_programs, 'employer', a.employer, 'job_title', a.job_title,
        'other_text', a.other_text, 'answered_at', a.answered_at, 'answered_source', a.answered_source) end);
end $$;

create or replace function public.get_company_after_closing(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if p_company is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null and (v_mgr or c.is_alumni)) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  return app_private.alumni_after_closing_json(p_company, v_mgr);
end $$;

-- saves the WHOLE answer (the latest one replaces the previous: no history). p_data keys: answer_type (required), venture_name, field, venture_stage, venture_url, venture_description,
-- wants_programs, employer, job_title, other_text. The fields of the other types are dropped.
create or replace function public.save_company_after_closing(p_company uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; k text; v_type text; v_name text; v_field text; v_stage text; v_url text; v_desc text; v_employer text; v_title text; v_other text; v_wants boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if p_company is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null and (v_mgr or c.is_alumni)) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform app_private.alumni_fail('data', 'not_an_object'); end if;
  for k in select jsonb_object_keys(p_data) loop
    if k not in ('answer_type', 'venture_name', 'field', 'venture_stage', 'venture_url', 'venture_description', 'wants_programs', 'employer', 'job_title', 'other_text') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  if not (p_data ? 'answer_type') or jsonb_typeof(p_data -> 'answer_type') <> 'string' then perform app_private.alumni_fail('answer_type', 'required'); end if;
  v_type := p_data ->> 'answer_type';
  if v_type not in ('new_startup', 'employed', 'other') then perform app_private.alumni_fail('answer_type', 'bad_value'); end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.operating_status = 'closed') then
    raise exception 'alumni_not_closed: only a closed company answers this question' using errcode = 'P0001', hint = 'alumni_not_closed';
  end if;
  v_name := app_private.alumni_closed_text(p_data, 'venture_name', 150);
  v_desc := app_private.alumni_closed_text(p_data, 'venture_description', 1000);
  v_employer := app_private.alumni_closed_text(p_data, 'employer', 150);
  v_title := app_private.alumni_closed_text(p_data, 'job_title', 150);
  v_other := app_private.alumni_closed_text(p_data, 'other_text', 1000);
  v_url := app_private.alumni_closed_text(p_data, 'venture_url', 500);
  if v_url is not null and v_url !~* '^https?://[^[:space:]]+$' then perform app_private.alumni_fail('venture_url', 'bad_url'); end if;
  v_field := app_private.alumni_closed_text(p_data, 'field', 80);
  if v_field is not null and not app_private.alumni_lookup_ok('sector', v_field) then perform app_private.alumni_fail('field', 'unknown'); end if;
  v_stage := app_private.alumni_closed_text(p_data, 'venture_stage', 80);
  if v_stage is not null and not app_private.alumni_lookup_ok('stage', v_stage) then perform app_private.alumni_fail('venture_stage', 'unknown'); end if;
  if p_data ? 'wants_programs' and jsonb_typeof(p_data -> 'wants_programs') not in ('boolean', 'null') then perform app_private.alumni_fail('wants_programs', 'bad_type'); end if;
  v_wants := coalesce((p_data ->> 'wants_programs')::boolean, false);
  if v_type = 'new_startup' then
    if v_name is null then perform app_private.alumni_fail('venture_name', 'required'); end if;
    if v_field is null then perform app_private.alumni_fail('field', 'required'); end if;
    v_employer := null; v_title := null; v_other := null;
  elsif v_type = 'employed' then
    if v_employer is null then perform app_private.alumni_fail('employer', 'required'); end if;
    if v_title is null then perform app_private.alumni_fail('job_title', 'required'); end if;
    if v_field is null then perform app_private.alumni_fail('field', 'required'); end if;
    v_name := null; v_stage := null; v_url := null; v_desc := null; v_wants := false; v_other := null;
  else
    if v_other is null then perform app_private.alumni_fail('other_text', 'required'); end if;
    v_name := null; v_field := null; v_stage := null; v_url := null; v_desc := null; v_wants := false; v_employer := null; v_title := null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_after_closing:' || p_company::text, 0));
  insert into public.company_after_closing (company_id, answer_type, venture_name, field_key, venture_stage, venture_url, venture_description, wants_programs, employer, job_title, other_text,
                                            answered_at, answered_by, answered_source)
  values (p_company, v_type, v_name, v_field, v_stage, v_url, v_desc, v_wants, v_employer, v_title, v_other, clock_timestamp(), v_uid, case when v_mgr then 'manager' else 'founder' end)
  on conflict (company_id) do update set answer_type = excluded.answer_type, venture_name = excluded.venture_name, field_key = excluded.field_key, venture_stage = excluded.venture_stage,
    venture_url = excluded.venture_url, venture_description = excluded.venture_description, wants_programs = excluded.wants_programs, employer = excluded.employer, job_title = excluded.job_title,
    other_text = excluded.other_text, answered_at = excluded.answered_at, answered_by = excluded.answered_by, answered_source = excluded.answered_source;
  return jsonb_build_object('saved', true) || app_private.alumni_after_closing_json(p_company, v_mgr);
end $$;

-- ================================================================= 12. the manager's follow-up list
-- every CLOSED alumni company with the founder's latest answer; the directory filters, plus p_status (answered | not_answered), p_type, p_interested; counts are over the directory filter only
create or replace function public.list_alumni_closed_followups(p_filters jsonb default '{}'::jsonb, p_status text default null, p_type text default null, p_interested boolean default null,
                                                               p_limit integer default 50, p_offset integer default 0, p_sort text default 'name', p_dir text default 'asc') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 500); v_off integer := greatest(coalesce(p_offset, 0), 0); v_sort text := coalesce(nullif(p_sort, ''), 'name');
        v_dir text := lower(coalesce(nullif(p_dir, ''), 'asc')); v_counts jsonb; v_rows jsonb; v_total integer; v_today date := app_private.alumni_today();
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('answered', 'not_answered') then perform app_private.alumni_fail('status', 'bad_value'); end if;
  if p_type is not null and p_type not in ('new_startup', 'employed', 'other') then perform app_private.alumni_fail('type', 'bad_value'); end if;
  if v_sort not in ('name', 'answered', 'closed', 'type') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  if v_dir not in ('asc', 'desc') then perform app_private.alumni_fail('dir', 'bad_value'); end if;

  with ids as (select i as id from app_private.alumni_filter_ids(coalesce(p_filters, '{}'::jsonb), 'manager', v_today) i),
       base as (
         select c.id, c.name_en, c.name_ar, c.logo_path, c.closed_on, c.closing_reason_key, a.answer_type, a.venture_name, a.field_key, a.venture_stage, a.venture_url, a.venture_description,
                a.wants_programs, a.employer, a.job_title, a.other_text, a.answered_at, a.answered_source
           from public.companies c join ids on ids.id = c.id
           left join public.company_after_closing a on a.company_id = c.id
          where c.deleted_at is null and c.is_alumni and c.operating_status = 'closed'),
       rem as (select cf.company_id, count(*)::int as n, max(l.created_at) as last_at
                 from app_private.alumni_reminder_log l join public.company_founders cf on cf.founder_id = l.founder_id
                where l.variant = 'closed' and cf.company_id in (select b.id from base b) group by cf.company_id),
       fnd as (select distinct on (cf.company_id) cf.company_id, f.name_en, f.name_ar, (select count(*) from public.company_founders z join public.founders zf on zf.id = z.founder_id and zf.deleted_at is null
                                                                                       where z.company_id = cf.company_id and zf.auth_user_id is not null)::int as with_account
                 from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
                where cf.company_id in (select b.id from base b) order by cf.company_id, cf.is_primary desc, cf.created_at, f.id),
       counts as (select jsonb_build_object('total', count(*), 'answered', count(*) filter (where answer_type is not null), 'not_answered', count(*) filter (where answer_type is null),
                                            'new_startup', count(*) filter (where answer_type = 'new_startup'), 'employed', count(*) filter (where answer_type = 'employed'),
                                            'other', count(*) filter (where answer_type = 'other'), 'interested', count(*) filter (where wants_programs)) as j from base),
       filtered as (select b.*, rem.n as rem_n, rem.last_at as rem_last, fnd.name_en as f_en, fnd.name_ar as f_ar, fnd.with_account as f_acc,
                           row_number() over (order by
                             case when v_sort = 'name' and v_dir = 'asc' then lower(coalesce(b.name_en, b.name_ar)) end asc,
                             case when v_sort = 'name' and v_dir = 'desc' then lower(coalesce(b.name_en, b.name_ar)) end desc,
                             case when v_sort = 'answered' and v_dir = 'asc' then extract(epoch from b.answered_at) end asc nulls first,
                             case when v_sort = 'answered' and v_dir = 'desc' then extract(epoch from b.answered_at) end desc nulls last,
                             case when v_sort = 'closed' and v_dir = 'asc' then b.closed_on end asc nulls first,
                             case when v_sort = 'closed' and v_dir = 'desc' then b.closed_on end desc nulls last,
                             case when v_sort = 'type' and v_dir = 'asc' then coalesce(b.answer_type, '~') end asc,
                             case when v_sort = 'type' and v_dir = 'desc' then coalesce(b.answer_type, '~') end desc,
                             lower(coalesce(b.name_en, b.name_ar)), b.id) as rn
                      from base b left join rem on rem.company_id = b.id left join fnd on fnd.company_id = b.id
                     where (p_status is null or (p_status = 'answered' and b.answer_type is not null) or (p_status = 'not_answered' and b.answer_type is null))
                       and (p_type is null or b.answer_type = p_type)
                       and (p_interested is null or (p_interested and coalesce(b.wants_programs, false)) or (not p_interested and not coalesce(b.wants_programs, false))))
  select (select j from counts), (select count(*) from filtered)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'logo_path', p.logo_path, 'closed_on', p.closed_on, 'closing_reason', p.closing_reason_key,
           'founder', jsonb_build_object('name_en', p.f_en, 'name_ar', p.f_ar, 'with_account', coalesce(p.f_acc, 0)),
           'answer', case when p.answer_type is null then null else jsonb_build_object('answer_type', p.answer_type, 'venture_name', p.venture_name, 'field', p.field_key, 'venture_stage', p.venture_stage,
                 'venture_url', p.venture_url, 'venture_description', p.venture_description, 'wants_programs', p.wants_programs, 'employer', p.employer, 'job_title', p.job_title,
                 'other_text', p.other_text, 'answered_at', p.answered_at, 'answered_source', p.answered_source) end,
           'reminders', jsonb_build_object('count', coalesce(p.rem_n, 0), 'last_at', p.rem_last)) order by p.rn), '[]'::jsonb)
    into v_counts, v_total, v_rows
    from (select * from filtered where rn > v_off and rn <= v_off + v_lim) p;
  return jsonb_build_object('current_period', app_private.alumni_period_key(now()), 'counts', v_counts, 'total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- ================================================================= 13. grants (nothing of the machinery is executable by an API role)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace
            and p.proname in ('alumni_after_closing_key', 'alumni_after_closing_text', 'alumni_reminder_default', 'alumni_template_check', 'alumni_reminder_render', 'alumni_reminder_audience',
                              'alumni_reminder_audience_closed', 'alumni_reminder_audience_v', 'alumni_reminders_send', 'alumni_closed_text', 'alumni_after_closing_json') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('get_alumni_quarter_settings', 'set_alumni_quarter_settings', 'save_alumni_reminder_template', 'reset_alumni_reminder_template', 'preview_alumni_reminder_template',
                              'preview_alumni_reminders', 'send_alumni_reminders', 'list_alumni_reminder_campaigns', 'list_alumni_quarter_status',
                              'get_company_after_closing', 'save_company_after_closing', 'list_alumni_closed_followups') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;

-- ================================================================= 14. self-check
do $$
begin
  if (select count(*) from app_private.alumni_reminder_templates) < 4 then raise exception 'm70: the default templates are missing'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_company_after_closing', 'save_company_after_closing', 'list_alumni_closed_followups', 'preview_alumni_reminders',
        'send_alumni_reminders', 'save_alumni_reminder_template', 'reset_alumni_reminder_template', 'preview_alumni_reminder_template') and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'm70: anon can execute a follow-up / reminder function';
  end if;
  if has_table_privilege('anon', 'public.company_after_closing', 'SELECT') or has_column_privilege('authenticated', 'public.company_after_closing', 'answered_by', 'SELECT')
     or has_table_privilege('authenticated', 'public.company_after_closing', 'INSERT') or has_table_privilege('authenticated', 'public.company_after_closing', 'UPDATE') then
    raise exception 'm70: the answer table is not closed as designed';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('send_alumni_reminders', 'preview_alumni_reminders', 'save_alumni_reminder_template',
        'reset_alumni_reminder_template', 'preview_alumni_reminder_template')) <> 5 then raise exception 'm70: a reminder function has a left-over overload'; end if;
  if position('alumni_after_closing_key' in pg_get_functiondef('public.list_alumni_table(jsonb,integer,integer,text,text,integer)'::regprocedure)) = 0
     or position('alumni_after_closing_text' in pg_get_functiondef('public.export_alumni_rows(jsonb,integer,text,date)'::regprocedure)) = 0 then raise exception 'm70: a reader patch is missing'; end if;
  raise notice 'm70 ok';
end $$;

commit;
