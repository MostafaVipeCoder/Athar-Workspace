-- m66_alumni_quarterly_figures.sql  (owner decision 21, 2026-10-15: the history of a company's figures = ONE FROZEN SNAPSHOT PER QUARTER; the figures themselves are a free-form DRAFT)
-- Re-runnable (create or replace / if not exists / drop ... if exists / every data step checks itself). Local DB only. Run AFTER m65. Verify with db/verify/v66_alumni_quarterly_figures.sql.
--
-- THE MODEL
--  * DRAFT   public.company_figures: ONE row per company = the figures the founder (or the manager) edits at any time. NO per-edit history: the row keeps only
--            updated_at / updated_by / updated_source ("last modified") and the confirmation ("Confirm my figures for this quarter": confirmed_period / confirmed_at / confirmed_by).
--            A save that changes nothing does not touch the row. Typing 10,000 and, five minutes later, 100,000 leaves ONE value: 100,000.
--  * SNAPSHOT public.company_snapshots (snapshot_type = 'quarter'): ONE frozen row per company per QUARTER (period_key '2026-Q4'). It is the ONLY data that graphs, portfolio aggregates,
--            the analytics / impact pages, the directory table and the Excel export read (m67). Freezing copies the CURRENT draft values at the quarter's close, so a typo corrected
--            minutes before the close never becomes a data point and no growth spike can exist between two edits.
--  * QUARTERS: calendar quarters (Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec) in the ONE documented zone app_private.alumni_tz() = 'Africa/Cairo'. A quarter closes at 00:00 Cairo time
--            of the first day of the next quarter.
--  * METRIC KINDS (how a draft value carries forward into the next quarter)
--      flow        revenue_total             the quarter's own value (EGP earned IN the quarter). At the freeze it is CLEARED from the draft (the next quarter starts empty: an un-updated
--                                            company must not look as if it earned the same again). The year's revenue = the sum of its reported quarters.
--      stock       employees_total, employees_female, freelancers, team_size, female_founders   the value AT the quarter's end. Carried forward unchanged into the next draft.
--      cumulative  funding_raised_total      the total raised so far (never a per-quarter amount). Carried forward unchanged.
--      text        traction, challenges, needs   the latest statement. Carried forward unchanged.
--      (team_size / female_founders are DERIVED at the freeze from the team of the company (the ID wins for gender); operating_status / closed_on are the company's state at the freeze,
--       so survival and closing rates are computed from snapshots too.)
--  * `reported`  a snapshot is "reported" when its quarter's draft was edited or confirmed IN that quarter (or a manager corrected / backfilled it). Graphs plot, and aggregates sum, reported
--            snapshots ONLY: a carried-forward stock value of a company that said nothing is not a data point. Un-reported snapshots still carry operating_status (survival).
--  * TARGET quarter of a company = the calendar quarter, or the quarter AFTER its latest frozen snapshot when a manager closed the current quarter early. Edits always belong to it.
--
-- FREEZING  app_private.alumni_freeze_one (idempotent: an existing snapshot is NEVER overwritten), app_private.alumni_freeze_due (every alumni company, every ended quarter from
--            the setting `first_period` on; the scheduler calls it, m68), public.freeze_due_quarters() (service role / manager), public.close_alumni_quarter(period, company?) ("Close
--            quarter now": a manager, current or past quarter, one company or all). Lazy freeze: a write to a company's draft first freezes its ended quarters, so a late scheduler can
--            never let next quarter's edit leak into the previous quarter.
-- REOPEN / CORRECT  public.reopen_alumni_quarter(period, company?) (status 'reopened') -> public.correct_alumni_snapshot(company, period, patch) (flags corrected_at / corrected_by, keeps the
--            ORIGINAL frozen value of each changed metric in previous_values ONLY - one value per metric, never a log; a correction back to the original removes the annotation; re-freezes)
--            -> public.refreeze_alumni_quarter (cancel a reopening). A quarter that ended and has NO snapshot can be backfilled through correct_alumni_snapshot (frozen_source 'manual').
--
-- Error tokens (message prefix = hint): `alumni_stale` (P0001), `alumni_invalid` (22023), `forbidden` (42501), `alumni_not_found` (P0002), `alumni_not_reopened` (P0001), `alumni_quarter_future` (22023).
-- NULL SAFETY: every guard is written so that NULL fails closed (`coalesce(..., false)`, `is not true`, `is distinct from`).
set search_path = public, extensions;

begin;

do $$
begin
  if exists (select 1 from public.company_snapshots s where s.snapshot_type = 'annual') then
    raise exception 'm66: annual snapshot rows exist; convert them to quarters before running this file (the local database has none)';
  end if;
end $$;

-- ================================================================= 1. the quarter calendar (one constant, pure helpers)
create or replace function app_private.alumni_tz() returns text language sql immutable set search_path = '' as $$ select 'Africa/Cairo'::text $$;

create or replace function app_private.alumni_period_ok(p text) returns boolean language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9]{4}-Q[1-4]$' then substr(p, 1, 4)::int between 2000 and 2100 else false end
$$;
create or replace function app_private.alumni_period_index(p text) returns integer language sql immutable set search_path = '' as $$
  select case when app_private.alumni_period_ok(p) then substr(p, 1, 4)::int * 4 + substr(p, 7, 1)::int - 1 end
$$;
create or replace function app_private.alumni_period_from_index(i integer) returns text language sql immutable set search_path = '' as $$
  select case when i is not null then (i / 4)::text || '-Q' || (i % 4 + 1)::text end
$$;
create or replace function app_private.alumni_period_next(p text) returns text language sql immutable set search_path = '' as $$
  select app_private.alumni_period_from_index(app_private.alumni_period_index(p) + 1)
$$;
create or replace function app_private.alumni_period_prev(p text) returns text language sql immutable set search_path = '' as $$
  select app_private.alumni_period_from_index(app_private.alumni_period_index(p) - 1)
$$;
create or replace function app_private.alumni_period_key(p_at timestamptz) returns text language sql stable set search_path = '' as $$
  select case when p_at is null then null
              else to_char(p_at at time zone app_private.alumni_tz(), 'YYYY') || '-Q' || to_char(p_at at time zone app_private.alumni_tz(), 'Q') end
$$;
create or replace function app_private.alumni_period_start(p text) returns timestamptz language sql stable set search_path = '' as $$
  select case when app_private.alumni_period_ok(p)
              then (make_date(substr(p, 1, 4)::int, (substr(p, 7, 1)::int - 1) * 3 + 1, 1)::timestamp) at time zone app_private.alumni_tz() end
$$;
-- exclusive end = the start of the next quarter
create or replace function app_private.alumni_period_end(p text) returns timestamptz language sql stable set search_path = '' as $$
  select app_private.alumni_period_start(app_private.alumni_period_next(p))
$$;
create or replace function app_private.alumni_period_label(p text, p_lang text default 'en') returns text language sql immutable set search_path = '' as $$
  select case when not app_private.alumni_period_ok(p) then null
              when p_lang = 'ar' then (array['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'])[substr(p, 7, 1)::int] || ' ' || substr(p, 1, 4)
              else 'Q' || substr(p, 7, 1) || ' ' || substr(p, 1, 4) end
$$;
-- the last day of the quarter as a date label ("31 December 2026" / "31 ديسمبر 2026")
create or replace function app_private.alumni_deadline_label(p text, p_lang text default 'en') returns text language sql stable set search_path = '' as $$
  select case when not app_private.alumni_period_ok(p) then null
         else (select extract(day from d)::int::text || ' ' ||
                      case when p_lang = 'ar' then (array['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'])[extract(month from d)::int]
                           else (array['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])[extract(month from d)::int] end
                      || ' ' || extract(year from d)::int::text
                 from (select ((app_private.alumni_period_end(p) at time zone app_private.alumni_tz())::date - 1) as d) x) end
$$;

-- ================================================================= 2. settings (one row; the reminder schedule lives here too, m68 edits it)
create table if not exists app_private.alumni_quarter_settings (
  id               boolean primary key default true check (id),
  first_period     text not null default '2026-Q4' check (first_period ~ '^[0-9]{4}-Q[1-4]$'),
  auto_freeze      boolean not null default true,
  auto_reminders   boolean not null default true,
  reminder_offsets integer[] not null default '{14,3}' check (cardinality(reminder_offsets) <= 6),
  send_hour        integer not null default 10 check (send_hour between 0 and 23),
  app_base_url     text check (app_base_url is null or app_base_url ~ '^https?://[^[:space:]"''<>]{1,255}$'),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null
);
-- (a regex repetition count above 255 is invalid in Postgres: the address pattern is {1,255})
alter table app_private.alumni_quarter_settings drop constraint if exists alumni_quarter_settings_app_base_url_check;
alter table app_private.alumni_quarter_settings add constraint alumni_quarter_settings_app_base_url_check check (app_base_url is null or app_base_url ~ '^https?://[^[:space:]"''<>]{1,255}$');
insert into app_private.alumni_quarter_settings (id) values (true) on conflict do nothing;
alter table app_private.alumni_quarter_settings enable row level security;
alter table app_private.alumni_quarter_settings force row level security;
revoke all on app_private.alumni_quarter_settings from public, anon, authenticated;

-- ================================================================= 3. the draft
create table if not exists public.company_figures (
  company_id           uuid primary key references public.companies (id) on delete cascade,
  period_key           text not null check (period_key ~ '^[0-9]{4}-Q[1-4]$'),
  revenue_total        numeric(16, 2),
  funding_raised_total numeric(16, 2),
  employees_total      integer,
  employees_female     integer,
  freelancers          integer,
  traction             text,
  challenges           text,
  needs                text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,
  updated_source       text check (updated_source is null or updated_source in ('founder', 'manager', 'import', 'system')),
  confirmed_period     text check (confirmed_period is null or confirmed_period ~ '^[0-9]{4}-Q[1-4]$'),
  confirmed_at         timestamptz,
  confirmed_by         uuid references auth.users (id) on delete set null,
  constraint company_figures_confirm_chk check ((confirmed_period is null) = (confirmed_at is null)),
  constraint company_figures_numbers_chk check (
    (revenue_total is null or (revenue_total >= 0 and revenue_total <= 1000000000000)) and (funding_raised_total is null or (funding_raised_total >= 0 and funding_raised_total <= 1000000000000))
    and (employees_total is null or (employees_total >= 0 and employees_total <= 1000000)) and (employees_female is null or (employees_female >= 0 and employees_female <= 1000000))
    and (freelancers is null or (freelancers >= 0 and freelancers <= 1000000)) and (employees_female is null or employees_total is null or employees_female <= employees_total)),
  constraint company_figures_text_chk check ((traction is null or char_length(traction) <= 4000) and (challenges is null or char_length(challenges) <= 4000) and (needs is null or char_length(needs) <= 4000))
);
create index if not exists company_figures_period_idx on public.company_figures (period_key);
create index if not exists company_figures_confirmed_idx on public.company_figures (confirmed_period) where confirmed_period is not null;
create index if not exists company_figures_confirmed_by_idx on public.company_figures (confirmed_by) where confirmed_by is not null;   -- the FK to auth.users (V02.1a of v10)
alter table public.company_figures enable row level security;
alter table public.company_figures force row level security;
drop policy if exists company_figures_select_own_mgr on public.company_figures;
create policy company_figures_select_own_mgr on public.company_figures for select to authenticated
  using (company_id in (select app_private.my_company_ids()) or (select app_private.has_any_role(array['alumni_manager', 'super_admin'])));
revoke all on public.company_figures from public, anon, authenticated;
grant select on public.company_figures to authenticated;
grant select, insert, update, delete on public.company_figures to service_role;

-- ================================================================= 4. the snapshot (company_snapshots becomes the quarterly table; it was the empty yearly table of m49)
alter table public.company_snapshots add column if not exists period_key     text;
alter table public.company_snapshots add column if not exists status         text not null default 'frozen';
alter table public.company_snapshots add column if not exists frozen_at      timestamptz;
alter table public.company_snapshots add column if not exists frozen_source  text;
alter table public.company_snapshots add column if not exists frozen_by      uuid;
alter table public.company_snapshots add column if not exists reported       boolean not null default false;
alter table public.company_snapshots add column if not exists confirmed      boolean not null default false;
alter table public.company_snapshots add column if not exists team_size      integer;
alter table public.company_snapshots add column if not exists female_founders integer;
alter table public.company_snapshots add column if not exists operating_status text;
alter table public.company_snapshots add column if not exists closed_on      date;
alter table public.company_snapshots add column if not exists corrected_at   timestamptz;
alter table public.company_snapshots add column if not exists corrected_by   uuid;
alter table public.company_snapshots add column if not exists previous_values jsonb;
alter table public.company_snapshots add column if not exists reopened_at    timestamptz;
alter table public.company_snapshots add column if not exists reopened_by    uuid;
-- the "reviewed" checkpoint of a yearly row is replaced by the frozen quarter
alter table public.company_snapshots drop column if exists reviewed_at;
alter table public.company_snapshots drop column if exists reviewed_by;

drop index if exists public.company_snapshots_annual_year_key;
alter table public.company_snapshots drop constraint if exists company_snapshots_type_chk;
alter table public.company_snapshots add constraint company_snapshots_type_chk check (snapshot_type in ('quarter', 'baseline', 'followup', 'manual'));
alter table public.company_snapshots drop constraint if exists company_snapshots_year_chk;
alter table public.company_snapshots add constraint company_snapshots_year_chk check ((snapshot_type <> 'quarter' or period_year is not null) and (period_year is null or period_year between 1990 and 2100));
alter table public.company_snapshots drop constraint if exists company_snapshots_quarter_chk;
alter table public.company_snapshots add constraint company_snapshots_quarter_chk check (
  snapshot_type <> 'quarter'
  or (period_key ~ '^[0-9]{4}-Q[1-4]$' and period_year = substr(period_key, 1, 4)::int and status in ('frozen', 'reopened') and frozen_at is not null
      and frozen_source in ('auto', 'manual') and (team_size is null or team_size between 0 and 1000000) and (female_founders is null or female_founders between 0 and 1000000)
      and (team_size is null or female_founders is null or female_founders <= team_size)
      and (operating_status is null or operating_status in ('open', 'closed')) and (previous_values is null or jsonb_typeof(previous_values) = 'object')));
create unique index if not exists company_snapshots_quarter_key on public.company_snapshots (company_id, period_key) where snapshot_type = 'quarter';
create index if not exists company_snapshots_period_idx on public.company_snapshots (period_key) where snapshot_type = 'quarter';

-- ================================================================= 5. who is a founder of a company, and the status of the figures of a quarter
-- status of the figures of ONE company for ONE quarter: closed (a snapshot exists) | confirmed | updated (edited in that quarter) | not_updated
create or replace function app_private.alumni_figures_status(p_company uuid, p_period text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_company is null or p_period is null then null
    when exists (select 1 from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'quarter' and s.period_key = p_period) then 'closed'
    when exists (select 1 from public.company_figures f where f.company_id = p_company and f.confirmed_period = p_period and f.confirmed_at >= f.updated_at) then 'confirmed'
    when exists (select 1 from public.company_figures f where f.company_id = p_company and f.period_key = p_period) then 'updated'
    else 'not_updated' end
$$;

-- the quarter a company's edits belong to (see the header)
create or replace function app_private.alumni_target_period(p_company uuid, p_now timestamptz default now()) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when l.k is null then cur.k
    when app_private.alumni_period_index(app_private.alumni_period_next(l.k)) > app_private.alumni_period_index(cur.k) then app_private.alumni_period_next(l.k)
    else cur.k end
    from (select app_private.alumni_period_key(coalesce(p_now, now())) as k) cur
    left join lateral (select max(s.period_key) as k from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'quarter') l on true
$$;

-- ================================================================= 6. validation of a figures patch (draft AND correction)
create or replace function app_private.alumni_clean_figures(p_data jsonb, p_derived boolean default false) returns jsonb
language plpgsql set search_path = '' as $$
declare k text; val jsonb; t text; v jsonb := '{}'::jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform app_private.alumni_fail('data', 'not_an_object'); end if;
  for k, val in select key, value from jsonb_each(p_data) loop
    if k not in ('revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers', 'traction', 'challenges', 'needs')
       and not (p_derived and k in ('team_size', 'female_founders')) then
      perform app_private.alumni_fail(k, 'unknown_key');
    end if;
    if jsonb_typeof(val) = 'null' then v := v || jsonb_build_object(k, null); continue; end if;
    if k in ('traction', 'challenges', 'needs') then
      if jsonb_typeof(val) <> 'string' then perform app_private.alumni_fail(k, 'not_a_string'); end if;
      t := nullif(btrim(val #>> '{}'), '');
      if t is not null and char_length(t) > 4000 then perform app_private.alumni_fail(k, 'too_long'); end if;
      v := v || jsonb_build_object(k, app_private.redact_ids_text(t));   -- a national ID typed into a free text is removed, never stored
    else
      if jsonb_typeof(val) not in ('number', 'string') then perform app_private.alumni_fail(k, 'not_a_number'); end if;
      t := btrim(val #>> '{}');
      if t !~ '^[0-9]+(\.[0-9]{1,2})?$' then perform app_private.alumni_fail(k, 'not_a_number'); end if;
      if k in ('revenue_total', 'funding_raised_total') then
        if t::numeric > 1000000000000 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        v := v || jsonb_build_object(k, t::numeric);
      else
        if t !~ '^[0-9]+$' or length(t) > 7 or t::int > 1000000 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        v := v || jsonb_build_object(k, t::int);
      end if;
    end if;
  end loop;
  return v;
end $$;

-- ================================================================= 7. freezing
-- ONE company, ONE quarter. -> 'frozen' | 'exists' (never overwritten) | 'not_alumni' | 'not_yet_existing' | 'invalid'
create or replace function app_private.alumni_freeze_one(p_company uuid, p_period text, p_source text, p_by uuid, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.companies; d public.company_figures; v_has boolean; v_use boolean; v_rep boolean; v_conf boolean; v_ts record; v_src text; v_end timestamptz; v_day date;
begin
  if p_company is null or not app_private.alumni_period_ok(p_period) or p_source is null or p_source not in ('auto', 'manual') then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_quarter:' || p_company::text, 0));
  if exists (select 1 from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'quarter' and s.period_key = p_period) then return 'exists'; end if;
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null and x.is_alumni;
  if not found then return 'not_alumni'; end if;
  v_end := app_private.alumni_period_end(p_period);
  if c.created_at >= v_end then return 'not_yet_existing'; end if;
  select * into d from public.company_figures x where x.company_id = p_company for update;
  v_has := found;
  -- the draft belongs to this quarter or an earlier one; a draft already edited for a LATER quarter is not consumed by a past quarter
  v_use := v_has and d.period_key <= p_period;
  v_rep := v_use and (d.period_key = p_period or coalesce(d.confirmed_period = p_period, false));
  v_conf := v_use and coalesce(d.confirmed_period = p_period and d.confirmed_at >= d.updated_at, false);
  v_day := least((v_end at time zone app_private.alumni_tz())::date - 1, (coalesce(p_now, now()) at time zone app_private.alumni_tz())::date);
  select * into v_ts from app_private.alumni_team_stats(v_day, p_company);
  v_src := case when v_use and d.updated_source in ('founder', 'manager', 'import') then d.updated_source else 'import' end;
  insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, period_key, status, frozen_at, frozen_source, frozen_by, reported, confirmed,
                                        revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs,
                                        team_size, female_founders, operating_status, closed_on, updated_by, updated_at)
  values (p_company, 'quarter', v_day, v_src, substr(p_period, 1, 4)::int, p_period, 'frozen', coalesce(p_now, now()), p_source, p_by, coalesce(v_rep, false), coalesce(v_conf, false),
          case when v_use then d.revenue_total end, case when v_use then d.funding_raised_total end, case when v_use then d.employees_total end,
          case when v_use then d.employees_female end, case when v_use then d.freelancers end, case when v_use then d.traction end, case when v_use then d.challenges end,
          case when v_use then d.needs end, v_ts.team_size, v_ts.female_founders, coalesce(c.operating_status, 'open'), c.closed_on, p_by, coalesce(p_now, now()));
  -- carry forward: the flow metric starts empty in the next quarter; stock / cumulative / text values stay (the last human edit stamp is not touched)
  if v_use then update public.company_figures f set revenue_total = null where f.company_id = p_company; end if;
  return 'frozen';
end $$;

-- every ended quarter (from the setting first_period) of ONE company that has no snapshot yet
create or replace function app_private.alumni_freeze_company_due(p_company uuid, p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_cur text := app_private.alumni_period_key(coalesce(p_now, now())); i integer; v_n integer := 0; v_first integer;
begin
  select * into s from app_private.alumni_quarter_settings;
  if not coalesce(s.auto_freeze, false) then return 0; end if;
  v_first := greatest(app_private.alumni_period_index(s.first_period), app_private.alumni_period_index(v_cur) - 40);
  for i in v_first .. app_private.alumni_period_index(v_cur) - 1 loop
    if app_private.alumni_freeze_one(p_company, app_private.alumni_period_from_index(i), 'auto', null, p_now) = 'frozen' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ALL alumni companies, every ended quarter: the scheduler's job (idempotent: a second call freezes nothing)
create or replace function app_private.alumni_freeze_due(p_now timestamptz default now(), p_source text default 'auto', p_by uuid default null, p_limit integer default 20000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s app_private.alumni_quarter_settings; v_cur text := app_private.alumni_period_key(coalesce(p_now, now())); i integer; r record; v_res text; v_n integer := 0; v_ex integer := 0; v_periods text[] := '{}';
        v_left integer := greatest(coalesce(p_limit, 20000), 1); v_first integer;
begin
  select * into s from app_private.alumni_quarter_settings;
  if p_source = 'auto' and not coalesce(s.auto_freeze, false) then return jsonb_build_object('frozen', 0, 'skipped', 'auto_freeze_off', 'periods', '[]'::jsonb); end if;
  v_first := greatest(app_private.alumni_period_index(s.first_period), app_private.alumni_period_index(v_cur) - 40);
  for i in v_first .. app_private.alumni_period_index(v_cur) - 1 loop
    exit when v_left <= 0;
    for r in select co.id from public.companies co
              where co.is_alumni and co.deleted_at is null and co.created_at < app_private.alumni_period_end(app_private.alumni_period_from_index(i))
                and not exists (select 1 from public.company_snapshots x where x.company_id = co.id and x.snapshot_type = 'quarter' and x.period_key = app_private.alumni_period_from_index(i))
              order by co.id limit v_left loop
      v_res := app_private.alumni_freeze_one(r.id, app_private.alumni_period_from_index(i), p_source, p_by, p_now);
      if v_res = 'frozen' then
        v_n := v_n + 1; v_left := v_left - 1;
        if not (app_private.alumni_period_from_index(i) = any (v_periods)) then v_periods := v_periods || app_private.alumni_period_from_index(i); end if;
      else v_ex := v_ex + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('frozen', v_n, 'not_frozen', v_ex, 'periods', to_jsonb(v_periods), 'now', coalesce(p_now, now()));
end $$;

-- the scheduler / service role entry point (also callable by a manager). A plain call with no JWT is refused unless it is the service role.
create or replace function public.freeze_due_quarters() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif not app_private.alumni_is_manager() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return app_private.alumni_freeze_due(now(), case when v_uid is null then 'auto' else 'manual' end, v_uid);
end $$;

-- "Close quarter now": a manager closes the current or a past quarter for one company or for all. An existing snapshot is NEVER overwritten (reopen + correct for that).
create or replace function public.close_alumni_quarter(p_period text, p_company uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r record; v_res text; v_n integer := 0; v_ex integer := 0; v_other integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(p_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if app_private.alumni_period_start(p_period) > now() then
    raise exception 'alumni_quarter_future: a quarter that has not started cannot be closed' using errcode = '22023', hint = 'alumni_quarter_future';
  end if;
  if p_company is not null and not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  for r in select co.id from public.companies co where co.is_alumni and co.deleted_at is null and (p_company is null or co.id = p_company) order by co.id loop
    v_res := app_private.alumni_freeze_one(r.id, p_period, 'manual', v_uid, now());
    if v_res = 'frozen' then v_n := v_n + 1; elsif v_res = 'exists' then v_ex := v_ex + 1; else v_other := v_other + 1; end if;
  end loop;
  return jsonb_build_object('period', p_period, 'frozen', v_n, 'already_frozen', v_ex, 'skipped', v_other);
end $$;

-- ================================================================= 8. reopen / correct / re-freeze
create or replace function public.reopen_alumni_quarter(p_period text, p_company uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_n integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(p_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  update public.company_snapshots s set status = 'reopened', reopened_at = now(), reopened_by = v_uid
   where s.snapshot_type = 'quarter' and s.period_key = p_period and s.status = 'frozen' and (p_company is null or s.company_id = p_company);
  get diagnostics v_n = row_count;
  if p_company is not null and v_n = 0 and not exists (select 1 from public.company_snapshots s where s.snapshot_type = 'quarter' and s.period_key = p_period and s.company_id = p_company) then
    raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found';
  end if;
  return jsonb_build_object('period', p_period, 'reopened', v_n);
end $$;

create or replace function public.refreeze_alumni_quarter(p_period text, p_company uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_n integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.alumni_period_ok(p_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  update public.company_snapshots s set status = 'frozen', reopened_at = null, reopened_by = null
   where s.snapshot_type = 'quarter' and s.period_key = p_period and s.status = 'reopened' and (p_company is null or s.company_id = p_company);
  get diagnostics v_n = row_count;
  return jsonb_build_object('period', p_period, 'refrozen', v_n);
end $$;

-- the correction: a REOPENED snapshot is patched (patch semantics: present keys are written, null clears, absent keys stay) and frozen again.
-- previous_values keeps the ORIGINAL frozen value of every metric that differs from it (one value per metric); a correction back to the original removes it.
create or replace function public.correct_alumni_snapshot(p_company uuid, p_period text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v jsonb; s public.company_snapshots; v_found boolean; k text; v_old jsonb; v_new jsonb; v_prev jsonb; v_changed boolean := false;
        v_total integer; v_female integer; v_ft integer; v_ff integer; c public.companies; v_day date; v_end timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_company is null or not app_private.alumni_period_ok(p_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  v := app_private.alumni_clean_figures(p_data, true);
  perform pg_advisory_xact_lock(hashtextextended('alumni_quarter:' || p_company::text, 0));
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  select * into s from public.company_snapshots x where x.company_id = p_company and x.snapshot_type = 'quarter' and x.period_key = p_period for update;
  v_found := found;
  if not v_found then
    -- BACKFILL of a quarter that ended and was never frozen (the company was not flagged alumni then, the scheduler was off): a manual snapshot made from the patch
    v_end := app_private.alumni_period_end(p_period);
    if v_end > now() then raise exception 'alumni_quarter_future: an open quarter is closed with close_alumni_quarter, not backfilled' using errcode = '22023', hint = 'alumni_quarter_future'; end if;
    v_total := (v->>'employees_total')::int; v_female := (v->>'employees_female')::int;
    if v_total is not null and v_female is not null and v_female > v_total then perform app_private.alumni_fail('employees_female', 'exceeds_total'); end if;
    v_ft := (v->>'team_size')::int; v_ff := (v->>'female_founders')::int;
    if v_ft is not null and v_ff is not null and v_ff > v_ft then perform app_private.alumni_fail('female_founders', 'exceeds_total'); end if;
    v_day := (v_end at time zone app_private.alumni_tz())::date - 1;
    insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, period_key, status, frozen_at, frozen_source, frozen_by, reported, confirmed,
                                          revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs, team_size, female_founders,
                                          operating_status, closed_on, updated_by, updated_at)
    values (p_company, 'quarter', v_day, 'manager', substr(p_period, 1, 4)::int, p_period, 'frozen', now(), 'manual', v_uid, true, false,
            (v->>'revenue_total')::numeric, (v->>'funding_raised_total')::numeric, v_total, v_female, (v->>'freelancers')::int, v->>'traction', v->>'challenges', v->>'needs', v_ft, v_ff,
            coalesce(c.operating_status, 'open'), c.closed_on, v_uid, now());
    return jsonb_build_object('saved', true, 'backfilled', true, 'snapshots', app_private.alumni_snapshots_json(p_company));
  end if;
  if s.status is distinct from 'reopened' then
    raise exception 'alumni_not_reopened: reopen the quarter before correcting it' using errcode = 'P0001', hint = 'alumni_not_reopened';
  end if;
  v_total := case when v ? 'employees_total' then (v->>'employees_total')::int else s.employees_total end;
  v_female := case when v ? 'employees_female' then (v->>'employees_female')::int else s.employees_female end;
  if v_total is not null and v_female is not null and v_female > v_total then perform app_private.alumni_fail('employees_female', 'exceeds_total'); end if;
  v_ft := case when v ? 'team_size' then (v->>'team_size')::int else s.team_size end;
  v_ff := case when v ? 'female_founders' then (v->>'female_founders')::int else s.female_founders end;
  if v_ft is not null and v_ff is not null and v_ff > v_ft then perform app_private.alumni_fail('female_founders', 'exceeds_total'); end if;
  v_prev := coalesce(s.previous_values, '{}'::jsonb);
  for k in select jsonb_object_keys(v) loop
    v_old := coalesce(to_jsonb(s) -> k, 'null'::jsonb);
    v_new := coalesce(v -> k, 'null'::jsonb);
    if v_old is distinct from v_new then
      v_changed := true;
      if v_prev ? k then
        if (v_prev -> k) is not distinct from v_new then v_prev := v_prev - k; end if;     -- back to the original frozen value: no annotation
      else
        v_prev := v_prev || jsonb_build_object(k, v_old);                                  -- the ORIGINAL frozen value, once
      end if;
    end if;
  end loop;
  update public.company_snapshots x set
    revenue_total = case when v ? 'revenue_total' then (v->>'revenue_total')::numeric else x.revenue_total end,
    funding_raised_total = case when v ? 'funding_raised_total' then (v->>'funding_raised_total')::numeric else x.funding_raised_total end,
    employees_total = v_total, employees_female = v_female,
    freelancers = case when v ? 'freelancers' then (v->>'freelancers')::int else x.freelancers end,
    traction = case when v ? 'traction' then v->>'traction' else x.traction end,
    challenges = case when v ? 'challenges' then v->>'challenges' else x.challenges end,
    needs = case when v ? 'needs' then v->>'needs' else x.needs end,
    team_size = v_ft, female_founders = v_ff,
    previous_values = nullif(v_prev, '{}'::jsonb),
    reported = x.reported or v_changed,
    corrected_at = case when v_changed then now() else x.corrected_at end, corrected_by = case when v_changed then v_uid else x.corrected_by end,
    status = 'frozen', reopened_at = null, reopened_by = null, updated_by = v_uid, updated_at = now()
   where x.id = s.id;
  -- every figure back at its original value: the snapshot is not "corrected" any more
  update public.company_snapshots x set corrected_at = null, corrected_by = null where x.id = s.id and x.previous_values is null and v_changed;
  return jsonb_build_object('saved', true, 'changed', v_changed, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

-- ================================================================= 9. the draft: save + confirm
create or replace function public.save_company_figures(p_company uuid, p_data jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; v jsonb; d public.company_figures; v_has boolean; v_target text; v_changed boolean; v_total integer; v_female integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if p_company is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  v := app_private.alumni_clean_figures(p_data, false);
  perform pg_advisory_xact_lock(hashtextextended('alumni_quarter:' || p_company::text, 0));
  perform app_private.alumni_freeze_company_due(p_company, now());       -- an ended quarter is frozen BEFORE this edit can reach it
  v_target := app_private.alumni_target_period(p_company, now());
  select * into d from public.company_figures x where x.company_id = p_company for update;
  v_has := found;
  if p_expected is not null then
    if (v_has and (p_expected = '-infinity'::timestamptz or d.updated_at is distinct from p_expected)) or (not v_has and p_expected <> '-infinity'::timestamptz) then
      raise exception 'alumni_stale: the figures were changed by someone else; reload them' using errcode = 'P0001', hint = 'alumni_stale', detail = coalesce(d.updated_at::text, '');
    end if;
  end if;
  v_total := case when v ? 'employees_total' then (v->>'employees_total')::int else d.employees_total end;
  v_female := case when v ? 'employees_female' then (v->>'employees_female')::int else d.employees_female end;
  if v_total is not null and v_female is not null and v_female > v_total then perform app_private.alumni_fail('employees_female', 'exceeds_total'); end if;
  if v_has then
    v_changed := (v ? 'revenue_total' and (v->>'revenue_total')::numeric is distinct from d.revenue_total)
              or (v ? 'funding_raised_total' and (v->>'funding_raised_total')::numeric is distinct from d.funding_raised_total)
              or (v ? 'employees_total' and (v->>'employees_total')::int is distinct from d.employees_total)
              or (v ? 'employees_female' and (v->>'employees_female')::int is distinct from d.employees_female)
              or (v ? 'freelancers' and (v->>'freelancers')::int is distinct from d.freelancers)
              or (v ? 'traction' and v->>'traction' is distinct from d.traction)
              or (v ? 'challenges' and v->>'challenges' is distinct from d.challenges)
              or (v ? 'needs' and v->>'needs' is distinct from d.needs);
    -- the draft already belongs to the target quarter and nothing changes: the row (and its "last modified") stays as it is
    if not v_changed and d.period_key = v_target then return jsonb_build_object('saved', true, 'changed', false) || app_private.alumni_figures_json(p_company, v_mgr); end if;
  else
    v_changed := v <> '{}'::jsonb;
    if not v_changed then return jsonb_build_object('saved', true, 'changed', false) || app_private.alumni_figures_json(p_company, v_mgr); end if;
  end if;
  insert into public.company_figures (company_id, period_key, revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs,
                                      updated_at, updated_by, updated_source)
  values (p_company, v_target, (v->>'revenue_total')::numeric, (v->>'funding_raised_total')::numeric, (v->>'employees_total')::int, (v->>'employees_female')::int,
          (v->>'freelancers')::int, v->>'traction', v->>'challenges', v->>'needs', clock_timestamp(), v_uid, case when v_mgr then 'manager' else 'founder' end)
  on conflict (company_id) do update set
    period_key = v_target,
    revenue_total = case when v ? 'revenue_total' then (v->>'revenue_total')::numeric else public.company_figures.revenue_total end,
    funding_raised_total = case when v ? 'funding_raised_total' then (v->>'funding_raised_total')::numeric else public.company_figures.funding_raised_total end,
    employees_total = case when v ? 'employees_total' then (v->>'employees_total')::int else public.company_figures.employees_total end,
    employees_female = case when v ? 'employees_female' then (v->>'employees_female')::int else public.company_figures.employees_female end,
    freelancers = case when v ? 'freelancers' then (v->>'freelancers')::int else public.company_figures.freelancers end,
    traction = case when v ? 'traction' then v->>'traction' else public.company_figures.traction end,
    challenges = case when v ? 'challenges' then v->>'challenges' else public.company_figures.challenges end,
    needs = case when v ? 'needs' then v->>'needs' else public.company_figures.needs end,
    updated_at = clock_timestamp(), updated_by = v_uid, updated_source = case when v_mgr then 'manager' else 'founder' end;
  return jsonb_build_object('saved', true, 'changed', true) || app_private.alumni_figures_json(p_company, v_mgr);
end $$;

-- "Confirm my figures for this quarter": a founder of the company says the draft is right (reminders skip the company); any later edit makes it unconfirmed again
create or replace function public.confirm_company_figures(p_company uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_target text; v_cal text := app_private.alumni_period_key(now());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_company is null or not app_private.has_role('founder') or not exists (select 1 from app_private.my_company_ids() m where m = p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_quarter:' || p_company::text, 0));
  perform app_private.alumni_freeze_company_due(p_company, now());
  v_target := app_private.alumni_target_period(p_company, now());
  insert into public.company_figures (company_id, period_key, updated_at, updated_by, updated_source) values (p_company, v_target, clock_timestamp(), v_uid, 'founder') on conflict (company_id) do nothing;
  update public.company_figures f set confirmed_period = v_target, confirmed_at = clock_timestamp(), confirmed_by = v_uid where f.company_id = p_company;
  return jsonb_build_object('confirmed', true, 'period', v_target, 'calendar_period', v_cal) || app_private.alumni_figures_json(p_company, false);
end $$;

-- ================================================================= 10. readers
create or replace function app_private.alumni_snapshots_json(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'period_key', s.period_key, 'year', s.period_year, 'status', s.status, 'reported', s.reported, 'confirmed', s.confirmed,
           'frozen_at', s.frozen_at, 'frozen_source', s.frozen_source, 'corrected', s.corrected_at is not null, 'corrected_at', s.corrected_at, 'previous_values', s.previous_values,
           'revenue_total', s.revenue_total, 'funding_raised_total', s.funding_raised_total, 'employees_total', s.employees_total, 'employees_female', s.employees_female,
           'freelancers', s.freelancers, 'team_size', s.team_size, 'female_founders', s.female_founders, 'traction', s.traction, 'challenges', s.challenges, 'needs', s.needs,
           'operating_status', s.operating_status) order by s.period_key desc), '[]'::jsonb)
    from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'quarter'
$$;

-- the whole figures state of one company: the draft, the status of the calendar quarter, the frozen quarters. Names (who edited / confirmed) only for a manager.
create or replace function app_private.alumni_figures_json(p_company uuid, p_mgr boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.company_figures; v_has boolean; v_cal text := app_private.alumni_period_key(now()); v_target text := app_private.alumni_target_period(p_company, now()); v_draft jsonb;
        v_uname text; v_cname text;
begin
  select * into d from public.company_figures x where x.company_id = p_company;
  v_has := found;
  if v_has then
    if coalesce(p_mgr, false) then
      select pr.full_name into v_uname from public.profiles pr where pr.id = d.updated_by;
      select pr.full_name into v_cname from public.profiles pr where pr.id = d.confirmed_by;
    end if;
    v_draft := jsonb_build_object('period_key', d.period_key, 'revenue_total', d.revenue_total, 'funding_raised_total', d.funding_raised_total, 'employees_total', d.employees_total,
                'employees_female', d.employees_female, 'freelancers', d.freelancers, 'traction', d.traction, 'challenges', d.challenges, 'needs', d.needs,
                'updated_at', d.updated_at, 'updated_source', d.updated_source, 'confirmed_period', d.confirmed_period, 'confirmed_at', d.confirmed_at,
                'confirmed', coalesce(d.confirmed_period = v_target and d.confirmed_at >= d.updated_at, false))
              || case when coalesce(p_mgr, false) then jsonb_build_object('updated_by_name', v_uname, 'confirmed_by_name', v_cname) else '{}'::jsonb end;
  end if;
  return jsonb_build_object('company_id', p_company, 'calendar_period', v_cal, 'target_period', v_target,
           'period_start', app_private.alumni_period_start(v_cal), 'period_end', app_private.alumni_period_end(v_cal),
           'deadline', ((app_private.alumni_period_end(v_cal) at time zone app_private.alumni_tz())::date - 1),
           'status', app_private.alumni_figures_status(p_company, v_cal), 'target_status', app_private.alumni_figures_status(p_company, v_target),
           'draft', v_draft, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

create or replace function public.get_company_figures(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if p_company is null or (not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company))) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  return app_private.alumni_figures_json(p_company, v_mgr);
end $$;

-- ================================================================= 11. the compat layer for the readers that speak "year": a view over the FROZEN quarters only
--   revenue = the sum of the year's reported quarters (a flow); every other figure = its latest reported non-empty value of the year; a year with no reported quarter has no row.
create or replace view app_private.alumni_year_rollup as
select s.company_id, 'annual'::text as snapshot_type, s.period_year,
       sum(s.revenue_total) filter (where s.reported)                                                                                                    as revenue_total,
       (array_agg(s.funding_raised_total order by s.period_key desc) filter (where s.reported and s.funding_raised_total is not null))[1]               as funding_raised_total,
       (array_agg(s.employees_total order by s.period_key desc) filter (where s.reported and s.employees_total is not null))[1]                          as employees_total,
       (array_agg(s.employees_female order by s.period_key desc) filter (where s.reported and s.employees_female is not null))[1]                        as employees_female,
       (array_agg(s.freelancers order by s.period_key desc) filter (where s.reported and s.freelancers is not null))[1]                                  as freelancers,
       (array_agg(s.traction order by s.period_key desc) filter (where s.reported and s.traction is not null))[1]                                        as traction,
       (array_agg(s.challenges order by s.period_key desc) filter (where s.reported and s.challenges is not null))[1]                                    as challenges,
       (array_agg(s.needs order by s.period_key desc) filter (where s.reported and s.needs is not null))[1]                                              as needs,
       (count(*) filter (where s.reported))::int                                                                                                         as quarters_reported,
       max(s.updated_at)                                                                                                                                 as updated_at
  from public.company_snapshots s
 where s.snapshot_type = 'quarter'
 group by s.company_id, s.period_year
having bool_or(s.reported);
revoke all on app_private.alumni_year_rollup from public, anon, authenticated;

-- the completeness item `annual_update` keeps its key (the web labels it "Quarterly figures"): missing when the company has neither touched / confirmed its figures in this or the
-- previous quarter nor a reported frozen quarter in them
create or replace function app_private.alumni_company_missing(p_company uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when c.name_en is null and c.name_ar is null then 'name' end,
    case when c.description_en is null and c.description_ar is null then 'description' end,
    case when c.startup_type_key is null then 'startup_type' end,
    case when c.sector_key is null then 'sector' end,
    case when c.stage is null then 'stage' end,
    case when c.legal_status_key is null then 'legal_status' end,
    case when c.governorate_code is null then 'governorate' end,
    case when c.established_on is null then 'established_on' end,
    case when c.website_url is null and c.app_url is null and jsonb_array_length(app_private.alumni_social_links(c.links, c.linkedin_url)) = 0 then 'online_presence' end,
    case when not exists (select 1 from public.company_figures f where f.company_id = c.id
                             and (f.period_key >= app_private.alumni_period_prev(app_private.alumni_period_key(now())) or coalesce(f.confirmed_period >= app_private.alumni_period_prev(app_private.alumni_period_key(now())), false)))
              and not exists (select 1 from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'quarter' and s.reported
                             and s.period_key >= app_private.alumni_period_prev(app_private.alumni_period_key(now()))) then 'annual_update' end], null)
    from public.companies c where c.id = p_company
$$;

-- ================================================================= 12. merge_companies carries the figures: the kept company's frozen quarters win; the drop's draft only fills what the kept draft lacks
create or replace function app_private.alumni_merge_company_data(p_keep uuid, p_drop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- frozen quarters: a quarter the kept company has stays untouched (never overwritten silently); the others move over
  delete from public.company_snapshots d using public.company_snapshots k
   where d.company_id = p_drop and d.snapshot_type = 'quarter' and k.company_id = p_keep and k.snapshot_type = 'quarter' and k.period_key = d.period_key;
  update public.company_snapshots x set company_id = p_keep where x.company_id = p_drop;
  -- the draft
  if exists (select 1 from public.company_figures f where f.company_id = p_keep) then
    update public.company_figures x set
      revenue_total = coalesce(x.revenue_total, d.revenue_total), funding_raised_total = coalesce(x.funding_raised_total, d.funding_raised_total),
      employees_total = coalesce(x.employees_total, d.employees_total),
      employees_female = case when coalesce(x.employees_female, d.employees_female) <= coalesce(x.employees_total, d.employees_total, 1000000) then coalesce(x.employees_female, d.employees_female) else x.employees_female end,
      freelancers = coalesce(x.freelancers, d.freelancers), traction = coalesce(x.traction, d.traction), challenges = coalesce(x.challenges, d.challenges), needs = coalesce(x.needs, d.needs)
     from public.company_figures d where x.company_id = p_keep and d.company_id = p_drop;
    delete from public.company_figures d where d.company_id = p_drop;
  else
    update public.company_figures x set company_id = p_keep where x.company_id = p_drop;
  end if;

  insert into public.company_internal (company_id, hint, directory_hidden, reviewed_at, reviewed_by, updated_by)
    select p_keep, d.hint, d.directory_hidden, d.reviewed_at, d.reviewed_by, d.updated_by from public.company_internal d where d.company_id = p_drop
  on conflict (company_id) do update set hint = coalesce(public.company_internal.hint, excluded.hint),
    directory_hidden = public.company_internal.directory_hidden or excluded.directory_hidden,
    reviewed_at = coalesce(public.company_internal.reviewed_at, excluded.reviewed_at), reviewed_by = coalesce(public.company_internal.reviewed_by, excluded.reviewed_by), updated_at = now();
  delete from public.company_internal d where d.company_id = p_drop;

  update public.companies x set
    startup_type_key = coalesce(x.startup_type_key, d.startup_type_key),
    sector_key = coalesce(x.sector_key, d.sector_key),
    subsector_key = case when x.subsector_key is not null then x.subsector_key
                         when x.sector_key is null and d.sector_key is not null then d.subsector_key
                         when x.sector_key is not distinct from d.sector_key then d.subsector_key end,
    stage = coalesce(x.stage, d.stage), legal_status_key = coalesce(x.legal_status_key, d.legal_status_key), governorate_code = coalesce(x.governorate_code, d.governorate_code),
    established_on = coalesce(x.established_on, d.established_on), app_url = coalesce(x.app_url, d.app_url), website_url = coalesce(x.website_url, d.website_url),
    linkedin_url = coalesce(x.linkedin_url, d.linkedin_url), logo_path = coalesce(x.logo_path, d.logo_path),
    description_en = coalesce(x.description_en, d.description_en), description_ar = coalesce(x.description_ar, d.description_ar),
    location_en = coalesce(x.location_en, d.location_en), location_ar = coalesce(x.location_ar, d.location_ar), is_alumni = x.is_alumni or d.is_alumni
   from public.companies d where x.id = p_keep and d.id = p_drop;
end $$;

-- ================================================================= 13. grants
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace
            and p.proname in ('alumni_tz', 'alumni_period_ok', 'alumni_period_index', 'alumni_period_from_index', 'alumni_period_next', 'alumni_period_prev', 'alumni_period_key',
                              'alumni_period_start', 'alumni_period_end', 'alumni_period_label', 'alumni_deadline_label', 'alumni_figures_status', 'alumni_target_period',
                              'alumni_clean_figures', 'alumni_freeze_one', 'alumni_freeze_company_due', 'alumni_freeze_due', 'alumni_snapshots_json', 'alumni_figures_json',
                              'alumni_company_missing', 'alumni_merge_company_data') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('freeze_due_quarters', 'close_alumni_quarter', 'reopen_alumni_quarter', 'refreeze_alumni_quarter', 'correct_alumni_snapshot',
                              'save_company_figures', 'confirm_company_figures', 'get_company_figures') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
  grant execute on function public.freeze_due_quarters() to service_role;
end $$;

-- ================================================================= 14. self-check
do $$
begin
  if app_private.alumni_period_key('2026-12-31 22:30:00+00'::timestamptz) <> '2027-Q1' then raise exception 'm66: 2026-12-31 22:30 UTC is already 2027-Q1 in Cairo'; end if;
  if app_private.alumni_period_key('2026-09-30 20:30:00+00'::timestamptz) <> '2026-Q3' then raise exception 'm66: 2026-09-30 20:30 UTC is still Q3 in Cairo'; end if;
  if app_private.alumni_period_next('2026-Q4') <> '2027-Q1' or app_private.alumni_period_prev('2027-Q1') <> '2026-Q4' then raise exception 'm66: period arithmetic'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('save_company_figures', 'confirm_company_figures', 'correct_alumni_snapshot', 'close_alumni_quarter', 'reopen_alumni_quarter',
             'refreeze_alumni_quarter', 'get_company_figures', 'freeze_due_quarters') and has_function_privilege('anon', p.oid, 'EXECUTE')) then raise exception 'm66: anon can execute a figures function'; end if;
  if has_table_privilege('authenticated', 'public.company_figures', 'INSERT') or has_table_privilege('authenticated', 'public.company_figures', 'UPDATE') or has_table_privilege('anon', 'public.company_figures', 'SELECT') then
    raise exception 'm66: an API role can write the draft table or anon can read it';
  end if;
  raise notice 'm66 ok';
end $$;

commit;
