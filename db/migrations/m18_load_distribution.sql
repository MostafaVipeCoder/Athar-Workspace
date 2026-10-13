-- m18_load_distribution  (05 phase 11; STAGE 2a, LOCAL ONLY)
-- distributions (2), distribution_days (per-day timing RECONSTRUCTED from the stored sessions: the naive derivation from the current config
-- would change 240 of 716 sessions, OD-9), distribution_day_mentors, distribution_mentor_rules, distribution_sessions (716).
-- The 432 sessions without an event id are quarantined (view legacy.v_quarantine_mentoring_sessions), never loaded (04-6).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m18_load_distribution') as id;
\o /dev/null

create or replace view legacy.v_quarantine_mentoring_sessions as
  select s.* from legacy.mentoring_sessions s where s.event_id not in (select event_id::text from legacy.events);
revoke all on legacy.v_quarantine_mentoring_sessions from public, anon, authenticated;

-- ---------------------------------------------------------------- distributions
insert into public.distributions (node_id, project_id, slot_duration_min, gap_min, start_time, unique_pairing, is_published, published_at, created_at, updated_at)
select migration.nid(c.event_id||':distribution'), c.event_id::uuid, c.slot_duration_minutes, 0, c.start_time, c.unique_pairing, c.is_published,
       case when c.is_published then coalesce(c.updated_at, c.created_at) end, coalesce(c.created_at, now()), coalesce(c.updated_at, c.created_at, now())
from legacy.mentoring_distribution_config c
where exists (select 1 from public.nodes n where n.id = migration.nid(c.event_id||':distribution'))
on conflict (node_id) do nothing;

-- ---------------------------------------------------------------- days (reconstructed timing)
create temp table t_sess on commit drop as
select s.* from legacy.mentoring_sessions s where s.event_id in (select event_id::text from legacy.events);

create temp table t_daybase on commit drop as
select event_id, day_index,
       min(slot_start_time) filter (where slot_index = 0) st0,
       ((extract(epoch from (min(slot_end_time) filter (where slot_index = 0) - min(slot_start_time) filter (where slot_index = 0)))::int + 86400) % 86400) / 60 dur_min,
       extract(epoch from coalesce(min(slot_start_time) filter (where slot_index = 1) - min(slot_end_time) filter (where slot_index = 0), interval '0'))::int / 60 gap_min
from t_sess group by 1, 2;

insert into public.distribution_days (id, project_id, node_id, day_index, day_date, start_time, total_round_min, slot_duration_min, gap_min)
select migration.nid(d.event_id||':dist-day:'||d.g::text), d.event_id::uuid, migration.nid(d.event_id||':distribution'), d.g, dc.day_date,
       coalesce(b.st0, dc.session_start_time, c.start_time), coalesce(dc.total_round_minutes, c.total_round_minutes),
       coalesce(b.dur_min, dc.slot_duration_minutes, c.slot_duration_minutes), coalesce(b.gap_min, dc.break_between_slots_minutes, 0)
from (select c.event_id, g from legacy.mentoring_distribution_config c, generate_series(0, c.num_days - 1) g
      union select event_id::text, day_index from legacy.mentoring_distribution_day_config
      union select event_id, day_index from t_sess) d
join legacy.mentoring_distribution_config c on c.event_id = d.event_id
left join legacy.mentoring_distribution_day_config dc on dc.event_id::text = d.event_id and dc.day_index = d.g
left join t_daybase b on b.event_id = d.event_id and b.day_index = d.g
where exists (select 1 from public.nodes n where n.id = migration.nid(d.event_id||':distribution'))
on conflict (id) do nothing;
insert into migration.id_map(entity, old_id, new_id, note)
select 'distribution_day', d.project_id::text || ':' || d.day_index::text, d.id, 'derived distribution day' from public.distribution_days d
join legacy.events e on e.event_id = d.project_id on conflict do nothing;

-- mentors per day: the day config list when present, else the mentors of the day's stored sessions
insert into public.distribution_day_mentors (day_id, mentor_item_id, project_id)
select distinct d.id, m.mid, d.project_id
from public.distribution_days d
cross join lateral (
  select unnest(dc.mentor_ids) mid
  from legacy.mentoring_distribution_day_config dc where dc.event_id = d.project_id and dc.day_index = d.day_index and dc.mentor_ids is not null
  union
  select s.mentor_id from t_sess s
  where s.event_id = d.project_id::text and s.day_index = d.day_index and s.mentor_id is not null
    and not exists (select 1 from legacy.mentoring_distribution_day_config dc2 where dc2.event_id = d.project_id and dc2.day_index = d.day_index and dc2.mentor_ids is not null)
) m
where exists (select 1 from public.list_items i where i.id = m.mid and i.project_id = d.project_id)
on conflict (day_id, mentor_item_id) do nothing;

-- ---------------------------------------------------------------- mentor rules ('all' needs no row; 'excluded' = no days; a list = those days)
insert into public.distribution_mentor_rules (node_id, mentor_item_id, project_id, days)
select migration.nid(c.event_id||':distribution'), a.key::uuid, c.event_id::uuid,
       case when jsonb_typeof(a.value) = 'array' then (select coalesce(array_agg(x::smallint order by x::smallint), '{}'::smallint[]) from jsonb_array_elements_text(a.value) x) else '{}'::smallint[] end
from legacy.mentoring_distribution_config c cross join lateral jsonb_each(coalesce(c.mentor_availability, '{}'::jsonb)) a
where not (jsonb_typeof(a.value) = 'string' and a.value #>> '{}' = 'all')
  and (jsonb_typeof(a.value) = 'array' or a.value #>> '{}' = 'excluded')
  and exists (select 1 from public.list_items i where i.id = a.key::uuid and i.project_id = c.event_id::uuid)
  and exists (select 1 from public.nodes n where n.id = migration.nid(c.event_id||':distribution'))
on conflict (node_id, mentor_item_id) do nothing;

select migration.flag('mentor_rule_dangling', 'review', 'mentoring_distribution_config', c.event_id || ':' || a.key,
  'mentor_availability key points at an expert that no longer exists; rule not loaded (kept in legacy)')
from legacy.mentoring_distribution_config c cross join lateral jsonb_each(coalesce(c.mentor_availability, '{}'::jsonb)) a
where not (jsonb_typeof(a.value) = 'string' and a.value #>> '{}' = 'all')
  and not exists (select 1 from public.list_items i where i.id = a.key::uuid and i.project_id = c.event_id::uuid);

-- finalized days become locked days (none today)
update public.distribution_days d set is_locked = true
from legacy.mentoring_distribution_config c
where d.project_id = c.event_id::uuid and d.day_index = any (coalesce(c.finalized_days, '{}'::int[])) and not d.is_locked;

-- ---------------------------------------------------------------- sessions
insert into public.distribution_sessions (id, project_id, node_id, day_id, slot_index, mentor_item_id, company_item_id, is_manual_override, created_at, updated_at)
select s.id, s.event_id::uuid, migration.nid(s.event_id||':distribution'), migration.nid(s.event_id||':dist-day:'||s.day_index::text), s.slot_index, s.mentor_id,
       (select i.id from public.list_items i where i.id = s.company_id and i.project_id = s.event_id::uuid),
       coalesce(s.is_manual_override, false), coalesce(s.created_at, now()), coalesce(s.updated_at, s.created_at, now())
from t_sess s
where s.mentor_id is not null and exists (select 1 from public.list_items i where i.id = s.mentor_id and i.project_id = s.event_id::uuid)
  and exists (select 1 from public.distribution_days d where d.id = migration.nid(s.event_id||':dist-day:'||s.day_index::text))
on conflict (id) do nothing;

-- ---------------------------------------------------------------- quarantine / guards
select migration.flag('quarantine_mentoring_sessions', 'review', 'mentoring_sessions', 'empty-event-id',
  (select count(*) from legacy.v_quarantine_mentoring_sessions)::text || ' sessions without an event id are not loaded (04-6). Evidence: created '
  || (select min(created_at)::date::text || '..' || max(created_at)::date::text from legacy.v_quarantine_mentoring_sessions)
  || '; derivable event: ' || coalesce((select string_agg(distinct left(e.event_name, 40), ', ') from legacy.v_quarantine_mentoring_sessions q
       join legacy.experts x on x.expert_id = q.mentor_id join legacy.events e on e.event_id = x.event_id), 'n/a')
  || '; collide with live (day,slot,mentor) rows: ' || (select count(*) from legacy.v_quarantine_mentoring_sessions q join t_sess l
       on l.day_index = q.day_index and l.slot_index = q.slot_index and l.mentor_id = q.mentor_id)::text)
where exists (select 1 from legacy.v_quarantine_mentoring_sessions);
select migration.flag('unloaded_table_not_empty', 'blocker', 'table', 'mentor_day_config', 'mentor_day_config has rows but no destination exists')
where exists (select 1 from legacy.mentor_day_config);
select migration.flag('distribution_day_without_date', 'info', 'distribution_days', d.id::text,
  'no calendar date stored for this day (legacy day config had none); v_distribution_sessions.starts_at is null until the PM sets day_date or links an agenda day')
from public.distribution_days d where d.day_date is null and d.agenda_day_id is null;

-- ================================================================= verification
select migration.check((select id from _r), 'V11.1 distributions', (select count(*)::text from legacy.mentoring_distribution_config where event_id in (select event_id::text from legacy.events)),
  (select count(*)::text from public.distributions));
select migration.check((select id from _r), 'V11.1 sessions: legacy = loaded + quarantined', (select count(*)::text from legacy.mentoring_sessions),
  ((select count(*) from public.distribution_sessions) + (select count(*) from legacy.v_quarantine_mentoring_sessions))::text);
select migration.check((select id from _r), 'V11.1 sessions per event',
  (select string_agg(left(event_id, 8) || '=' || n, ',' order by event_id) from (select event_id, count(*) n from t_sess group by 1) x),
  (select string_agg(left(project_id::text, 8) || '=' || n, ',' order by project_id::text) from (select project_id, count(*) n from public.distribution_sessions group by 1) x));
select migration.check((select id from _r), 'V11.1 sessions without a company', (select count(*)::text from t_sess where company_id is null),
  (select count(*)::text from public.distribution_sessions where company_item_id is null));
select migration.check((select id from _r), 'V11.2 sessions checksum md5(id||slot||mentor||company)',
  (select md5(string_agg(id::text || slot_index::text || mentor_id::text || coalesce(company_id::text, ''), ',' order by id)) from t_sess),
  (select md5(string_agg(id::text || slot_index::text || mentor_item_id::text || coalesce(company_item_id::text, ''), ',' order by id)) from public.distribution_sessions));
select migration.check((select id from _r), 'V11.3 reconstructed day timing reproduces every stored session time (start and end)', '0',
  (select count(*)::text from t_sess o join public.distribution_sessions s on s.id = o.id
     join public.distribution_days d on d.id = s.day_id join public.distributions ds on ds.node_id = s.node_id
    where o.slot_start_time is distinct from ((coalesce(d.start_time, ds.start_time) + make_interval(mins => s.slot_index * (coalesce(d.slot_duration_min, ds.slot_duration_min) + coalesce(d.gap_min, ds.gap_min))))::time)
       or o.slot_end_time   is distinct from ((coalesce(d.start_time, ds.start_time) + make_interval(mins => s.slot_index * (coalesce(d.slot_duration_min, ds.slot_duration_min) + coalesce(d.gap_min, ds.gap_min)) + coalesce(d.slot_duration_min, ds.slot_duration_min)))::time)));
select migration.check((select id from _r), 'V11.3 view v_distribution_sessions agrees (rows that have a day date)', '0',
  (select count(*)::text from t_sess o join public.v_distribution_sessions v on v.id = o.id join public.projects j on j.id = v.project_id
    where v.starts_at is not null and (o.slot_start_time is distinct from (v.starts_at at time zone j.timezone)::time
                                    or o.slot_end_time   is distinct from (v.ends_at   at time zone j.timezone)::time)));
select migration.check((select id from _r), 'V11.4 mentor / company items exist in the same project', '0',
  (select count(*)::text from public.distribution_sessions s
    where not exists (select 1 from public.list_items i where i.id = s.mentor_item_id and i.project_id = s.project_id)
       or (s.company_item_id is not null and not exists (select 1 from public.list_items i where i.id = s.company_item_id and i.project_id = s.project_id))));
select migration.check((select id from _r), 'V11.6 quarantined sessions = 432', '432', (select count(*)::text from legacy.v_quarantine_mentoring_sessions));
select migration.check_design((select id from _r), 'D11.1 design: distributions 2 / days 9 / day mentors 139 / rules 3 / sessions 716', '2/9/139/3/716',
  (select (select count(*) from public.distributions) || '/' || (select count(*) from public.distribution_days) || '/' || (select count(*) from public.distribution_day_mentors) || '/' ||
          (select count(*) from public.distribution_mentor_rules) || '/' || (select count(*) from public.distribution_sessions)));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
