-- m69_alumni_quarter_review_fixes.sql  (review of the quarterly snapshots + reminders: the data-correctness, audience and privilege findings)
-- Re-runnable (create or replace / drop ... if exists / grants are idempotent). Local DB only. Run AFTER m66, m67, m68. Verify with db/verify/v69_alumni_quarter_review_fixes.sql.
--
--  1. YEAR ROLL-UP (app_private.alumni_year_rollup, feeds analytics totals, the list table and the Excel export): employees_female is now taken from the SAME quarter as employees_total
--     (the latest reported quarter that has a total), and is never larger than it. Before, each figure took its own latest value, so a later total of 1 next to an earlier female count of 2 was possible.
--  2. STATUS AT THE END OF THE QUARTER: alumni_freeze_one (and the backfill path of correct_alumni_snapshot) stamp operating_status / closed_on as the company was at the quarter's last day
--     (closed only when closed_on <= that day; a closed company WITHOUT a date stays closed, the date being unknown). A late freeze or a backfill of an old quarter no longer counts a company
--     that closed later as already closed. correct_alumni_snapshot accepts operating_status ('open'|'closed'|null) and closed_on (date|null) on a reopened snapshot or a backfill; a backfill also
--     derives team_size / female_founders from the team of that quarter like a normal freeze (they were NULL).
--  3. PRIVILEGES: authenticated can read company_snapshots only through COLUMN grants that leave out the actor columns (frozen_by, corrected_by, reopened_by, updated_by); the same data
--     comes through get_company_figures. save_company_figures (founder) and confirm_company_figures refuse a company that is not an alumni company (a manager may still edit any company).
--  4. REMINDERS: the audience skips founders of CLOSED companies and banned / deleted accounts. The link address is the STORED app_base_url (a manager-supplied p_app_url only serves a manual send
--     while none is stored). With no address at all, only the in-platform notification is created (an e-mail whose only call to action is a relative path is useless): email_state 'no_link',
--     the campaign note 'no_app_url' (manual and scheduled).
--  5. alumni_snapshots_json also returns closed_on (the correction form edits it).
--  NOT changed (documented in db/README.md): the frozen rows are protected by the RPC code only (no guard trigger: the cascade of a company delete, the merge and the owner's own repair
--  scripts need to write them); alumni_freeze_due takes one advisory lock per company per run.
set search_path = public, extensions;

begin;

-- ================================================================= 1. the roll-up
create or replace view app_private.alumni_year_rollup as
select r.company_id, r.snapshot_type, r.period_year, r.revenue_total, r.funding_raised_total, r.employees_total,
       case when r.employees_female is not null and r.employees_total is not null then least(r.employees_female, r.employees_total) else r.employees_female end as employees_female,
       r.freelancers, r.traction, r.challenges, r.needs, r.quarters_reported, r.updated_at
  from (
    select s.company_id, 'annual'::text as snapshot_type, s.period_year,
           sum(s.revenue_total) filter (where s.reported)                                                                                                    as revenue_total,
           (array_agg(s.funding_raised_total order by s.period_key desc) filter (where s.reported and s.funding_raised_total is not null))[1]               as funding_raised_total,
           (array_agg(s.employees_total order by s.period_key desc) filter (where s.reported and s.employees_total is not null))[1]                          as employees_total,
           -- the female count of the SAME quarter as the total (null when that quarter has none: an earlier quarter's count does not describe today's staff)
           (array_agg(s.employees_female order by s.period_key desc) filter (where s.reported and s.employees_total is not null))[1]                         as employees_female,
           (array_agg(s.freelancers order by s.period_key desc) filter (where s.reported and s.freelancers is not null))[1]                                  as freelancers,
           (array_agg(s.traction order by s.period_key desc) filter (where s.reported and s.traction is not null))[1]                                        as traction,
           (array_agg(s.challenges order by s.period_key desc) filter (where s.reported and s.challenges is not null))[1]                                    as challenges,
           (array_agg(s.needs order by s.period_key desc) filter (where s.reported and s.needs is not null))[1]                                              as needs,
           (count(*) filter (where s.reported))::int                                                                                                         as quarters_reported,
           max(s.updated_at)                                                                                                                                 as updated_at
      from public.company_snapshots s
     where s.snapshot_type = 'quarter'
     group by s.company_id, s.period_year
    having bool_or(s.reported)) r;
revoke all on app_private.alumni_year_rollup from public, anon, authenticated;

-- ================================================================= 2..4. functions (each re-created on its m66 / m68 definition with the changes above)

create or replace function app_private.alumni_freeze_one(p_company uuid, p_period text, p_source text, p_by uuid, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.companies; d public.company_figures; v_has boolean; v_use boolean; v_rep boolean; v_conf boolean; v_ts record; v_src text; v_end timestamptz; v_day date; v_last date; v_closed boolean;
begin
  if p_company is null or not app_private.alumni_period_ok(p_period) or p_source is null or p_source not in ('auto', 'manual') then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_quarter:' || p_company::text, 0));
  if exists (select 1 from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'quarter' and s.period_key = p_period) then return 'exists'; end if;
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null and x.is_alumni;
  if not found then return 'not_alumni'; end if;
  v_end := app_private.alumni_period_end(p_period);
  if c.created_at >= v_end then return 'not_yet_existing'; end if;
  -- the company's state AT THE END OF THE QUARTER, not today's: a company that closed LATER is still open in this quarter (survival / closing rates)
  v_last := (v_end at time zone app_private.alumni_tz())::date - 1;
  v_closed := (c.closed_on is not null and c.closed_on <= v_last) or (c.closed_on is null and coalesce(c.operating_status, 'open') = 'closed');
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
          case when v_use then d.needs end, v_ts.team_size, v_ts.female_founders, case when v_closed then 'closed' else 'open' end, case when v_closed and c.closed_on <= v_last then c.closed_on end, p_by, coalesce(p_now, now()));
  -- carry forward: the flow metric starts empty in the next quarter; stock / cumulative / text values stay (the last human edit stamp is not touched)
  if v_use then update public.company_figures f set revenue_total = null where f.company_id = p_company; end if;
  return 'frozen';
end $$;

create or replace function public.correct_alumni_snapshot(p_company uuid, p_period text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v jsonb; s public.company_snapshots; v_found boolean; k text; v_old jsonb; v_new jsonb; v_prev jsonb; v_changed boolean := false;
        v_total integer; v_female integer; v_ft integer; v_ff integer; c public.companies; v_day date; v_end timestamptz; v_st text; v_cl text; v_last date; v_ts record;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_company is null or not app_private.alumni_period_ok(p_period) then perform app_private.alumni_fail('period', 'bad_value'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform app_private.alumni_fail('data', 'not_an_object'); end if;
  v := app_private.alumni_clean_figures(p_data - 'operating_status' - 'closed_on', true);
  -- the status the company had at the END of the quarter can be corrected too (operating_status open|closed, closed_on a date or null)
  if p_data ? 'operating_status' then
    if jsonb_typeof(p_data -> 'operating_status') = 'null' then v := v || jsonb_build_object('operating_status', null);
    elsif jsonb_typeof(p_data -> 'operating_status') = 'string' and (p_data ->> 'operating_status') in ('open', 'closed') then v := v || jsonb_build_object('operating_status', p_data ->> 'operating_status');
    else perform app_private.alumni_fail('operating_status', 'bad_value'); end if;
  end if;
  if p_data ? 'closed_on' then
    if jsonb_typeof(p_data -> 'closed_on') = 'null' then v := v || jsonb_build_object('closed_on', null);
    elsif jsonb_typeof(p_data -> 'closed_on') = 'string' and (p_data ->> 'closed_on') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v := v || jsonb_build_object('closed_on', to_char((p_data ->> 'closed_on')::date, 'YYYY-MM-DD'));
      exception when others then perform app_private.alumni_fail('closed_on', 'bad_value'); end;
      if to_char((p_data ->> 'closed_on')::date, 'YYYY-MM-DD') <> p_data ->> 'closed_on' then perform app_private.alumni_fail('closed_on', 'bad_value'); end if;
    else perform app_private.alumni_fail('closed_on', 'bad_value'); end if;
  end if;
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
    v_last := v_day;
    -- the status of a backfilled quarter is the status AT ITS END (a later closing does not count), unless the manager states it
    v_st := case when v ? 'operating_status' then v->>'operating_status'
                 when (c.closed_on is not null and c.closed_on <= v_last) or (c.closed_on is null and coalesce(c.operating_status, 'open') = 'closed') then 'closed' else 'open' end;
    v_cl := case when v ? 'closed_on' then v->>'closed_on' when v_st = 'closed' and c.closed_on <= v_last then c.closed_on::text end;
    if v_st is distinct from 'closed' and v_cl is not null then perform app_private.alumni_fail('closed_on', 'not_closed'); end if;
    if v_cl is not null and v_cl::date > v_last then perform app_private.alumni_fail('closed_on', 'after_quarter'); end if;
    -- the team of the quarter is derived like a normal freeze does, unless the manager states it
    select * into v_ts from app_private.alumni_team_stats(v_day, p_company);
    if not (v ? 'team_size') then v_ft := v_ts.team_size; end if;
    if not (v ? 'female_founders') then v_ff := v_ts.female_founders; end if;
    if v_ft is not null and v_ff is not null and v_ff > v_ft then v_ff := v_ft; end if;
    insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, period_key, status, frozen_at, frozen_source, frozen_by, reported, confirmed,
                                          revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs, team_size, female_founders,
                                          operating_status, closed_on, updated_by, updated_at)
    values (p_company, 'quarter', v_day, 'manager', substr(p_period, 1, 4)::int, p_period, 'frozen', now(), 'manual', v_uid, true, false,
            (v->>'revenue_total')::numeric, (v->>'funding_raised_total')::numeric, v_total, v_female, (v->>'freelancers')::int, v->>'traction', v->>'challenges', v->>'needs', v_ft, v_ff,
            v_st, v_cl::date, v_uid, now());
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
  v_st := case when v ? 'operating_status' then v->>'operating_status' else s.operating_status end;
  v_cl := case when v ? 'closed_on' then v->>'closed_on' else s.closed_on::text end;
  v_last := (app_private.alumni_period_end(p_period) at time zone app_private.alumni_tz())::date - 1;
  if v_st is distinct from 'closed' and v_cl is not null then perform app_private.alumni_fail('closed_on', 'not_closed'); end if;
  if v_cl is not null and v_cl::date > v_last then perform app_private.alumni_fail('closed_on', 'after_quarter'); end if;
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
    team_size = v_ft, female_founders = v_ff, operating_status = v_st, closed_on = v_cl::date,
    previous_values = nullif(v_prev, '{}'::jsonb),
    reported = x.reported or v_changed,
    corrected_at = case when v_changed then now() else x.corrected_at end, corrected_by = case when v_changed then v_uid else x.corrected_by end,
    status = 'frozen', reopened_at = null, reopened_by = null, updated_by = v_uid, updated_at = now()
   where x.id = s.id;
  -- every figure back at its original value: the snapshot is not "corrected" any more
  update public.company_snapshots x set corrected_at = null, corrected_by = null where x.id = s.id and x.previous_values is null and v_changed;
  return jsonb_build_object('saved', true, 'changed', v_changed, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

create or replace function public.save_company_figures(p_company uuid, p_data jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; v jsonb; d public.company_figures; v_has boolean; v_target text; v_changed boolean; v_total integer; v_female integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if p_company is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null and (v_mgr or c.is_alumni)) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
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

create or replace function public.confirm_company_figures(p_company uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_target text; v_cal text := app_private.alumni_period_key(now());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_company is null or not app_private.has_role('founder') or not exists (select 1 from app_private.my_company_ids() m where m = p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null and c.is_alumni) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('alumni_quarter:' || p_company::text, 0));
  perform app_private.alumni_freeze_company_due(p_company, now());
  v_target := app_private.alumni_target_period(p_company, now());
  insert into public.company_figures (company_id, period_key, updated_at, updated_by, updated_source) values (p_company, v_target, clock_timestamp(), v_uid, 'founder') on conflict (company_id) do nothing;
  update public.company_figures f set confirmed_period = v_target, confirmed_at = clock_timestamp(), confirmed_by = v_uid where f.company_id = p_company;
  return jsonb_build_object('confirmed', true, 'period', v_target, 'calendar_period', v_cal) || app_private.alumni_figures_json(p_company, false);
end $$;

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
   where not coalesce(p_only_new, false) or not exists (select 1 from app_private.alumni_reminder_log l where l.founder_id = x.xf and l.period_key = p_period)
   group by x.xf, x.xu, u.email, pr.language
   order by x.xf;
end $$;

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
  -- the STORED address wins; a manager-supplied address is used only by a manual send while none is stored (never to redirect the links of a configured platform)
  v_url := coalesce(s.app_base_url, case when p_trigger = 'manual' then nullif(btrim(p_app_url), '') end);
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
    -- no address to put in the e-mail = no e-mail (its only call to action would be a dead relative link): the notification still goes out
    if v_base is not null and r.email is not null and r.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      insert into app_private.email_outbox (email_key, recipient_email, subject, body_html, idempotency_key, created_by)
      values ('alumni_quarter_reminder', r.email::extensions.citext, rr.email_subject, rr.email_html, 'alumni_reminder:' || r.fid::text || ':' || p_period || ':' || p_kind, p_by)
      on conflict (idempotency_key) do nothing returning id into v_out;
    end if;
    if v_out is null then v_noemail := v_noemail + 1; end if;
    update app_private.alumni_reminder_log l set notification_id = v_notif, outbox_id = v_out, email_state = case when v_out is not null then 'queued' when v_base is null and r.email is not null then 'no_link' else 'no_email' end where l.id = v_log;
  end loop;
  update app_private.alumni_reminder_campaigns c set
    recipients = (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    notified = (select count(l.notification_id) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    emailed = (select count(l.outbox_id) from app_private.alumni_reminder_log l where l.campaign_id = c.id),
    no_email = (select count(*) from app_private.alumni_reminder_log l where l.campaign_id = c.id and l.email_state in ('no_email', 'no_link')),
    note = case when v_base is null then coalesce(c.note, 'no_app_url') else c.note end
   where c.id = v_camp;
  return jsonb_build_object('campaign_id', v_camp, 'period', p_period, 'kind', p_kind, 'audience', v_total, 'sent', v_new, 'already_sent', v_dup, 'no_email', v_noemail, 'link_has_address', v_base is not null);
end $$;


-- ================================================================= 3. privileges
revoke select on public.company_snapshots from authenticated;
grant select (id, company_id, snapshot_type, snapshot_date, source, period_year, period_key, status, frozen_at, frozen_source, reported, confirmed, revenue_total, funding_raised_total,
              employees_total, employees_female, freelancers, traction, challenges, needs, team_size, female_founders, operating_status, closed_on, corrected_at, reopened_at, updated_at)
  on public.company_snapshots to authenticated;

-- ================================================================= 4. reminder log states
alter table app_private.alumni_reminder_log drop constraint if exists alumni_reminder_log_email_state_check;
alter table app_private.alumni_reminder_log add constraint alumni_reminder_log_email_state_check check (email_state is null or email_state in ('queued', 'no_email', 'no_link'));

-- ================================================================= 5. self-check
do $$
begin
  if has_column_privilege('authenticated', 'public.company_snapshots', 'frozen_by', 'SELECT') or has_column_privilege('authenticated', 'public.company_snapshots', 'corrected_by', 'SELECT')
     or has_column_privilege('authenticated', 'public.company_snapshots', 'reopened_by', 'SELECT') or has_column_privilege('authenticated', 'public.company_snapshots', 'updated_by', 'SELECT') then
    raise exception 'm69: an API role can read an actor column of the snapshots';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('correct_alumni_snapshot', 'save_company_figures', 'confirm_company_figures') and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'm69: anon can execute a figures function';
  end if;
  raise notice 'm69 ok';
end $$;

commit;
