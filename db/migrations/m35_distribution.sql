-- m35_distribution.sql  (Mentoring Distribution node; design 01 section 3.7, 02 section 4/12, 03 section 9.4, 04 section 3.10/3.17;
--                        decisions 01-7 / 02-9 / 02-12 / 02-13)
-- Re-runnable (create or replace / if not exists). Local DB only. No business data is altered (the 2 distributions, 9 days, 139 day
-- mentors, 3 rules and 716 sessions are untouched; the new nullable `room` column stays NULL for them and the new timer table is
-- empty until a project manager starts a timer).
--
-- 1. schema
--    distribution_mentor_rules.room             optional room/table label of a mentor ("which room do I go to", the Agenda tab shows it)
--    distribution_timers                        ONE row per node: the shared countdown as SERVER TIMESTAMPS (status, ends_at while running,
--                                               remaining_s while paused, the current round pointer, a version). Clients compute the
--                                               remaining time locally from `ends_at - server clock`; nothing writes per second.
--                                               RLS: project managers read; there is NO client write policy, only the PM-guarded RPC
--                                               below writes. Visitors read through get_distribution_timer (never a table, never a
--                                               public control channel: the as-is broadcast channel SEC-5 is gone).
--    node_types.distribution.save_children_fn   = save_children_distribution (Edit/Setup saves the node's settings, days, per-day
--                                               mentors and mentor rules in the SAME save_node transaction, with the revision check)
-- 2. helpers (app_private): distribution_slots (slots per round = (total + gap) / (slot + gap), 01-7: total = slots + gaps),
--    distribution_eff (effective timing of a day), distribution_timer_json, distribution_payload (THE whitelisted payload shared by the
--    PM preview, the public Matrix/Live pages and the Agenda tab: names resolved by reference, never stored on the session).
-- 3. save_children_distribution(node, children)  validated write of settings / days / day mentors / rules; locked days cannot change.
-- 4. PM RPCs: replace_distribution_sessions (persist a generation: validated server-side, atomic, never touches locked days),
--    set_distribution_session_companies (move / swap / clear with conflict checks, Undo = the inverse change), set_distribution_day_lock,
--    set_distribution_published (touches ONLY the publish columns: as-is BUG-1 fixed), distribution_timer_control (PM only),
--    get_distribution_payload (PM payload + timer, no link needed), get_distribution_timer_state (the PM's light timer poll).
-- 5. Public RPCs (anon + authenticated; the DB decides the audience and ENFORCES the publish flag): get_distribution_view(ref, view_key) for
--    /view/:ref/matrix|live and get_distribution_timer(ref) (read-only; both resolve the migrated slugs AND the legacy project id of the old
--    /view/<event id>/mentoring/... links through app_private.distribution_resolve); get_public_tab re-created (m32 body) with the distribution
--    branch on the same payload; get_agenda_view re-created (m06d body) ONLY to title the second tab of a distribution node "My schedule".
--
-- Verified by db/verify/v35_distribution.sql (role-switch checks inside a rolled-back transaction). PM-guarded functions are proven closed to
-- anon through the privilege catalog: executing one under `set local role anon` segfaults the local Postgres container (see PROGRESS).
set search_path = public, extensions;

begin;

-- ================================================================= 1. schema
alter table public.distribution_mentor_rules add column if not exists room text;
alter table public.distribution_mentor_rules drop constraint if exists distribution_mentor_rules_room_chk;
alter table public.distribution_mentor_rules add constraint distribution_mentor_rules_room_chk check (room is null or char_length(room) <= 80);

create table if not exists public.distribution_timers (
  node_id     uuid primary key references public.distributions (node_id) on delete cascade,
  project_id  uuid not null,
  status      text not null default 'idle' check (status in ('idle', 'running', 'paused')),
  day_id      uuid references public.distribution_days (id) on delete set null,
  slot_index  smallint check (slot_index is null or slot_index >= 0),
  duration_s  integer not null default 0 check (duration_s >= 0),
  ends_at     timestamptz,
  remaining_s integer check (remaining_s is null or remaining_s >= 0),
  version     bigint not null default 0,
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  check ((status = 'running') = (ends_at is not null)),
  check ((status = 'paused') = (remaining_s is not null))
);
create index if not exists distribution_timers_project_idx on public.distribution_timers (project_id);
alter table public.distribution_timers enable row level security;
alter table public.distribution_timers force row level security;
drop policy if exists distribution_timers_select_pm on public.distribution_timers;
create policy distribution_timers_select_pm on public.distribution_timers for select to authenticated
  using ((select app_private.is_project_manager(project_id)));
revoke all on public.distribution_timers from public, anon, authenticated;
grant select on public.distribution_timers to authenticated;
drop trigger if exists distribution_timers_bu_project on public.distribution_timers;
create trigger distribution_timers_bu_project before update of project_id on public.distribution_timers for each row execute function app_private.forbid_project_change();

update public.node_types set save_children_fn = 'save_children_distribution'
 where key = 'distribution' and save_children_fn is distinct from 'save_children_distribution';

-- ================================================================= 2. helpers
-- slots in a round (01-7): total round = n * slot + (n - 1) * gap  =>  n = floor((total + gap) / (slot + gap)); same formula as lib/time/slots
create or replace function app_private.distribution_slots(p_total int, p_slot int, p_gap int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case when coalesce(p_total, 0) > 0 and coalesce(p_slot, 0) > 0
              then greatest(0, floor((p_total + greatest(coalesce(p_gap, 0), 0))::numeric / (p_slot + greatest(coalesce(p_gap, 0), 0))))::int
              else 0 end
$$;
revoke all on function app_private.distribution_slots(int, int, int) from public, anon, authenticated;

-- effective timing of a day: the day's own values over the node defaults (04 section 3.10)
create or replace function app_private.distribution_eff(p_day uuid)
returns table (node_id uuid, project_id uuid, day_index int, is_locked boolean, start_min int, total_min int, slot_min int, gap_min int, slots int)
language sql stable security definer set search_path = '' as $$
  select dd.node_id, dd.project_id, dd.day_index::int, dd.is_locked,
         (extract(epoch from coalesce(dd.start_time, d.start_time)) / 60)::int,
         coalesce(dd.total_round_min, 0)::int,
         coalesce(dd.slot_duration_min, d.slot_duration_min)::int,
         coalesce(dd.gap_min, d.gap_min)::int,
         app_private.distribution_slots(dd.total_round_min, coalesce(dd.slot_duration_min, d.slot_duration_min), coalesce(dd.gap_min, d.gap_min))
    from public.distribution_days dd
    join public.distributions d on d.node_id = dd.node_id
   where dd.id = p_day
$$;
revoke all on function app_private.distribution_eff(uuid) from public, anon, authenticated;

-- the shared countdown as a small payload: the client computes the remaining time from ends_at and the server clock (server_now)
create or replace function app_private.distribution_timer_json(p_node uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(t.status, 'idle'), 'day_id', t.day_id, 'slot_index', t.slot_index, 'duration_s', coalesce(t.duration_s, 0),
    'ends_at', t.ends_at,
    'remaining_s', case when t.status = 'running' then greatest(0, ceil(extract(epoch from (t.ends_at - clock_timestamp()))))::int else t.remaining_s end,
    'version', coalesce(t.version, 0), 'server_now', clock_timestamp())
  from (select 1) one left join public.distribution_timers t on t.node_id = p_node
$$;
revoke all on function app_private.distribution_timer_json(uuid) from public, anon, authenticated;

-- THE payload (PM preview, public Matrix/Live, Agenda tab). Items are referenced by their list-item id; names/photos are resolved here
-- by reference (network expert / company / form response / manual fields + the item's display override), never stored on a session.
-- The PM variant adds session ids, the manual-override flag, locks, the seed and the effective timing of every day.
create or replace function app_private.distribution_payload(p_node uuid, p_pm boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes; d public.distributions; v_rev bigint; v_proj jsonb; v_days jsonb; v_mentors jsonb; v_companies jsonb; v_sessions jsonb; v_mine jsonb;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found then return null; end if;
  select * into d from public.distributions where node_id = p_node;
  if not found then return null; end if;
  select r.rev into v_rev from public.node_revisions r where r.node_id = p_node;
  select jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar, 'timezone', j.timezone) into v_proj from public.projects j where j.id = n.project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', dd.id, 'day_index', dd.day_index, 'agenda_day_id', dd.agenda_day_id,
           'date', coalesce(dd.day_date, ad.day_date), 'name_en', ad.name_en, 'name_ar', ad.name_ar,
           'start_time', to_char(coalesce(dd.start_time, d.start_time), 'HH24:MI'),
           'total_round_min', coalesce(dd.total_round_min, 0),
           'slot_duration_min', coalesce(dd.slot_duration_min, d.slot_duration_min),
           'gap_min', coalesce(dd.gap_min, d.gap_min),
           'slots', app_private.distribution_slots(dd.total_round_min, coalesce(dd.slot_duration_min, d.slot_duration_min), coalesce(dd.gap_min, d.gap_min)),
           'is_locked', case when p_pm then dd.is_locked end,
           'own_start', case when p_pm then to_char(dd.start_time, 'HH24:MI') end,
           'own_slot', case when p_pm then dd.slot_duration_min end,
           'own_gap', case when p_pm then dd.gap_min end,
           'own_date', case when p_pm then dd.day_date end,
           'mentor_ids', coalesce((select jsonb_agg(m.mentor_item_id order by m.mentor_item_id) from public.distribution_day_mentors m where m.day_id = dd.id), '[]'::jsonb))
           order by dd.day_index), '[]'::jsonb)
    into v_days
    from public.distribution_days dd
    left join public.agenda_days ad on ad.id = dd.agenda_day_id
   where dd.node_id = p_node;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'd', s.day_id, 's', s.slot_index, 'm', s.mentor_item_id, 'c', s.company_item_id,
           'manual', case when p_pm then s.is_manual_override end) order by dd.day_index, s.slot_index, s.mentor_item_id), '[]'::jsonb)
    into v_sessions
    from public.distribution_sessions s
    join public.distribution_days dd on dd.id = s.day_id
   where s.node_id = p_node
     and (p_pm or (s.slot_index < app_private.distribution_slots(dd.total_round_min, coalesce(dd.slot_duration_min, d.slot_duration_min), coalesce(dd.gap_min, d.gap_min))
                   and exists (select 1 from public.distribution_day_mentors m where m.day_id = s.day_id and m.mentor_item_id = s.mentor_item_id)));
  if not p_pm then v_sessions := coalesce((select jsonb_agg(x - 'id' - 'manual') from jsonb_array_elements(v_sessions) x), '[]'::jsonb); end if;

  with used as (
    select m.mentor_item_id as item_id, true as is_mentor from public.distribution_day_mentors m join public.distribution_days dd on dd.id = m.day_id where dd.node_id = p_node
    union select s.mentor_item_id, true from public.distribution_sessions s where s.node_id = p_node
    union select s.company_item_id, false from public.distribution_sessions s where s.node_id = p_node and s.company_item_id is not null),
  disp as (
    select li.id, u.is_mentor,
           btrim(regexp_replace(coalesce(nullif(li.overlay->'display_override'->>'title_en', ''),
             case when ne.id is not null then ne.name_en when co.id is not null then co.name_en when fr.id is not null then fr.answers->>'company_name'
                  else li.manual_fields->>'title_en' end, li.source_label, ''), '[[:space:]]+', ' ', 'g')) as name_en,
           btrim(regexp_replace(coalesce(nullif(li.overlay->'display_override'->>'title_ar', ''),
             case when ne.id is not null then ne.name_ar when co.id is not null then co.name_ar when fr.id is not null then fr.answers->>'company_name'
                  else li.manual_fields->>'title_ar' end, ''), '[[:space:]]+', ' ', 'g')) as name_ar,
           coalesce(nullif(li.overlay->'display_override'->>'subtitle_en', ''),
             case when ne.id is not null then ne.title_en when co.id is not null then co.industry_en when fr.id is not null then fr.answers->>'founder_name'
                  else li.manual_fields->>'subtitle_en' end) as sub_en,
           coalesce(nullif(li.overlay->'display_override'->>'subtitle_ar', ''),
             case when ne.id is not null then ne.title_ar when co.id is not null then co.industry_ar when fr.id is not null then fr.answers->>'founder_name'
                  else li.manual_fields->>'subtitle_ar' end) as sub_ar,
           coalesce(nullif(li.overlay->'display_override'->>'image_path', ''),
             case when ne.id is not null then ne.photo_path when co.id is not null then co.logo_path when fr.id is not null then fr.answers->>'logo'
                  else li.manual_fields->>'image_path' end) as image_path,
           (li.company_id is null and li.network_expert_id is null and li.form_response_id is null and li.source_kind is not null) as missing
      from (select item_id, bool_or(is_mentor) as is_mentor from used group by item_id) u
      join public.list_items li on li.id = u.item_id
      left join public.network_experts ne on ne.id = li.network_expert_id
      left join public.companies co on co.id = li.company_id
      left join public.form_responses fr on fr.id = li.form_response_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name_en', x.name_en, 'name_ar', x.name_ar, 'sub_en', x.sub_en, 'sub_ar', x.sub_ar,
                      'image_path', x.image_path, 'room', r.room, 'missing', case when p_pm then x.missing end)
                      order by lower(x.name_en), x.id) filter (where x.is_mentor), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name_en', x.name_en, 'name_ar', x.name_ar, 'sub_en', x.sub_en, 'sub_ar', x.sub_ar,
                      'image_path', x.image_path, 'missing', case when p_pm then x.missing end)
                      order by lower(x.name_en), x.id) filter (where not x.is_mentor), '[]'::jsonb)
    into v_mentors, v_companies
    from disp x
    left join public.distribution_mentor_rules r on r.node_id = p_node and r.mentor_item_id = x.id;

  -- the caller's own company items (a founder participant): canonical companies linked to the caller through company_founders
  if (select auth.uid()) is not null then
    select coalesce(jsonb_agg(distinct s.company_item_id), '[]'::jsonb) into v_mine
      from public.distribution_sessions s join public.list_items li on li.id = s.company_item_id
     where s.node_id = p_node and li.company_id in (select app_private.my_company_ids());
  else
    v_mine := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'node_id', n.id, 'revision', v_rev, 'name_en', n.name_en, 'name_ar', n.name_ar, 'project', v_proj,
    'config', jsonb_build_object('slot_duration_min', d.slot_duration_min, 'gap_min', d.gap_min, 'start_time', to_char(d.start_time, 'HH24:MI'),
                                 'unique_pairing', d.unique_pairing, 'seed', case when p_pm then d.seed end,
                                 'timer', coalesce(n.config->'timer', '{}'::jsonb)),
    'published', d.is_published, 'published_at', d.published_at,
    'days', v_days, 'mentors', v_mentors, 'companies', v_companies, 'sessions', v_sessions, 'my_company_ids', v_mine);
end $$;
revoke all on function app_private.distribution_payload(uuid, boolean) from public, anon, authenticated;

-- ================================================================= 3. save_children_distribution (called by save_node; revision bumped once there)
create or replace function app_private.save_children_distribution(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.nodes; d public.distributions; s jsonb; v_slot int; v_gap int; v_start time; v_unique boolean;
  r jsonb; v_id uuid; v_old public.distribution_days; v_idx int; v_total int; v_dslot int; v_dgap int; v_dstart time; v_date date; v_agenda uuid;
  v_ids uuid[] := '{}'; v_seen_idx int[] := '{}'; v_mentors uuid[]; v_cur uuid[]; v_k int := 0; v_from time; v_to time; v_max int; v_room text; v_rdays int[];
  v_rule_items uuid[] := '{}'; m uuid;
begin
  if p_children is null or jsonb_typeof(p_children) <> 'object' then return; end if;
  select * into n from public.nodes where id = p_node;
  select * into d from public.distributions where node_id = p_node for update;
  if not found then raise exception 'distribution row missing' using errcode = 'P0002'; end if;

  -- ---- node settings
  s := p_children->'settings';
  if s is not null and jsonb_typeof(s) = 'object' then
    v_slot := coalesce(nullif(s->>'slot_duration_min', '')::int, d.slot_duration_min);
    v_gap := coalesce(nullif(s->>'gap_min', '')::int, d.gap_min);
    v_start := coalesce(nullif(s->>'start_time', '')::time, d.start_time);
    v_unique := coalesce((s->>'unique_pairing')::boolean, d.unique_pairing);
    if v_slot < 1 or v_slot > 600 then raise exception 'distribution_invalid: slot duration' using errcode = '22023', hint = 'distribution_invalid', detail = 'slot_duration_min:invalid'; end if;
    if v_gap < 0 or v_gap > 240 then raise exception 'distribution_invalid: gap' using errcode = '22023', hint = 'distribution_invalid', detail = 'gap_min:invalid'; end if;
    update public.distributions set slot_duration_min = v_slot, gap_min = v_gap, start_time = v_start, unique_pairing = v_unique where node_id = p_node;
  end if;

  -- ---- days (+ their mentor lists)
  if p_children ? 'days' and jsonb_typeof(p_children->'days') = 'array' then
    if jsonb_array_length(p_children->'days') > 60 then raise exception 'distribution_invalid: at most 60 days' using errcode = '22023', hint = 'distribution_invalid', detail = 'days:too_many'; end if;
    -- phase 1: validate + park the existing indexes (non-deferrable unique (node, day_index): reorders go through negative temporaries)
    for r in select * from jsonb_array_elements(p_children->'days') loop
      v_idx := (r->>'day_index')::int;
      if v_idx is null or v_idx < 0 or v_idx = any (v_seen_idx) then raise exception 'distribution_invalid: day index' using errcode = '22023', hint = 'distribution_invalid', detail = 'day_index:invalid'; end if;
      v_seen_idx := v_seen_idx || v_idx;
      v_total := coalesce(nullif(r->>'total_round_min', '')::int, 0);
      v_dslot := nullif(r->>'slot_duration_min', '')::int;
      v_dgap := nullif(r->>'gap_min', '')::int;
      v_dstart := nullif(r->>'start_time', '')::time;
      if v_total < 0 or v_total > 1440 or (v_dslot is not null and (v_dslot < 1 or v_dslot > 600)) or (v_dgap is not null and (v_dgap < 0 or v_dgap > 240)) then
        raise exception 'distribution_invalid: day timing' using errcode = '22023', hint = 'distribution_invalid', detail = 'day:timing';
      end if;
      if nullif(r->>'id', '') is not null then
        v_id := (r->>'id')::uuid;
        select * into v_old from public.distribution_days where id = v_id and node_id = p_node;
        if not found then raise exception 'distribution_invalid: unknown day' using errcode = '22023', hint = 'distribution_invalid', detail = 'day:unknown'; end if;
        v_ids := v_ids || v_id;
        if v_old.is_locked then
          v_agenda := nullif(r->>'agenda_day_id', '')::uuid; v_date := nullif(r->>'day_date', '')::date;
          select coalesce(array_agg(x::uuid order by x::uuid), '{}') into v_mentors from jsonb_array_elements_text(coalesce(r->'mentor_item_ids', '[]'::jsonb)) x;
          select coalesce(array_agg(mm.mentor_item_id order by mm.mentor_item_id), '{}') into v_cur from public.distribution_day_mentors mm where mm.day_id = v_id;
          if coalesce(v_old.total_round_min, 0) <> v_total
             or v_old.start_time is distinct from v_dstart or v_old.slot_duration_min is distinct from v_dslot or v_old.gap_min is distinct from v_dgap
             or v_old.agenda_day_id is distinct from v_agenda or v_old.day_date is distinct from v_date or v_mentors is distinct from v_cur then
            raise exception 'distribution_day_locked: unlock the day to change it' using errcode = 'P0001', hint = 'distribution_day_locked', detail = v_id::text;
          end if;
        end if;
      end if;
    end loop;
    -- removed days: allowed only when unlocked (their sessions go with them: the client confirmed)
    if exists (select 1 from public.distribution_days x where x.node_id = p_node and x.is_locked and not (x.id = any (v_ids))) then
      raise exception 'distribution_day_locked: a locked day cannot be removed' using errcode = 'P0001', hint = 'distribution_day_locked';
    end if;
    delete from public.distribution_days x where x.node_id = p_node and not (x.id = any (v_ids));
    for v_id in select x.id from public.distribution_days x where x.node_id = p_node order by x.day_index loop
      v_k := v_k + 1;
      update public.distribution_days set day_index = -v_k where id = v_id;
    end loop;
    -- phase 2: write
    for r in select * from jsonb_array_elements(p_children->'days') loop
      v_idx := (r->>'day_index')::int;
      v_total := coalesce(nullif(r->>'total_round_min', '')::int, 0);
      v_dslot := nullif(r->>'slot_duration_min', '')::int;
      v_dgap := nullif(r->>'gap_min', '')::int;
      v_dstart := nullif(r->>'start_time', '')::time;
      v_agenda := nullif(r->>'agenda_day_id', '')::uuid;
      v_date := case when v_agenda is null then nullif(r->>'day_date', '')::date end;
      if nullif(r->>'id', '') is not null then
        v_id := (r->>'id')::uuid;
        update public.distribution_days
           set day_index = v_idx, agenda_day_id = v_agenda, day_date = v_date, start_time = v_dstart,
               total_round_min = nullif(v_total, 0), slot_duration_min = v_dslot, gap_min = v_dgap
         where id = v_id and not is_locked;
        if not found then   -- locked and unchanged: only its index may move
          update public.distribution_days set day_index = v_idx where id = v_id;
        end if;
      else
        insert into public.distribution_days (project_id, node_id, day_index, agenda_day_id, day_date, start_time, total_round_min, slot_duration_min, gap_min)
        values (n.project_id, p_node, v_idx, v_agenda, v_date, v_dstart, nullif(v_total, 0), v_dslot, v_dgap) returning id into v_id;
      end if;
      -- the day's mentors (a locked day keeps its list: it was verified equal above)
      if not exists (select 1 from public.distribution_days where id = v_id and is_locked) then
        select coalesce(array_agg(distinct x::uuid), '{}') into v_mentors from jsonb_array_elements_text(coalesce(r->'mentor_item_ids', '[]'::jsonb)) x;
        if exists (select 1 from unnest(v_mentors) u where not exists (select 1 from public.list_items li where li.id = u and li.project_id = n.project_id)) then
          raise exception 'distribution_invalid: unknown mentor' using errcode = '22023', hint = 'distribution_invalid', detail = 'mentor:unknown';
        end if;
        delete from public.distribution_day_mentors where day_id = v_id and not (mentor_item_id = any (v_mentors));
        insert into public.distribution_day_mentors (day_id, mentor_item_id, project_id)
          select v_id, u, n.project_id from unnest(v_mentors) u on conflict (day_id, mentor_item_id) do nothing;
      end if;
    end loop;
  end if;

  -- ---- mentor rules (availability keyed by the list item; a row exists only when it restricts something or carries a room)
  if p_children ? 'rules' and jsonb_typeof(p_children->'rules') = 'array' then
    for r in select * from jsonb_array_elements(p_children->'rules') loop
      v_id := (r->>'mentor_item_id')::uuid;
      if not exists (select 1 from public.list_items li where li.id = v_id and li.project_id = n.project_id) then
        raise exception 'distribution_invalid: unknown mentor' using errcode = '22023', hint = 'distribution_invalid', detail = 'mentor:unknown';
      end if;
      v_rdays := case when jsonb_typeof(r->'days') = 'array' then (select coalesce(array_agg(x::int order by x::int), '{}') from jsonb_array_elements_text(r->'days') x) end;
      v_from := nullif(r->>'available_from', '')::time; v_to := nullif(r->>'available_to', '')::time;
      v_max := nullif(r->>'max_slots', '')::int; v_room := nullif(btrim(coalesce(r->>'room', '')), '');
      if (v_from is not null and v_to is not null and v_to <= v_from) or (v_max is not null and v_max < 1) or (v_room is not null and char_length(v_room) > 80) then
        raise exception 'distribution_invalid: mentor rule' using errcode = '22023', hint = 'distribution_invalid', detail = 'rule:invalid';
      end if;
      if v_rdays is null and v_from is null and v_to is null and v_max is null and v_room is null then
        delete from public.distribution_mentor_rules where node_id = p_node and mentor_item_id = v_id;
      else
        insert into public.distribution_mentor_rules (node_id, mentor_item_id, project_id, days, max_slots, available_from, available_to, room)
        values (p_node, v_id, n.project_id, v_rdays, v_max, v_from, v_to, v_room)
        on conflict (node_id, mentor_item_id) do update
          set days = excluded.days, max_slots = excluded.max_slots, available_from = excluded.available_from, available_to = excluded.available_to, room = excluded.room;
        v_rule_items := v_rule_items || v_id;
      end if;
    end loop;
    delete from public.distribution_mentor_rules where node_id = p_node
       and mentor_item_id not in (select (x->>'mentor_item_id')::uuid from jsonb_array_elements(p_children->'rules') x);
  end if;
end $$;
revoke all on function app_private.save_children_distribution(uuid, jsonb) from public, anon, authenticated;

-- ================================================================= 4. PM RPCs
-- Persist a generation. The matching algorithm is ONE pure implementation in the client (web/src/nodes/distribution/matching.js);
-- this function never trusts it: every row is validated (day unlocked and targeted, slot in the round, mentor on that day and inside
-- the mentor's availability / max, company in the project, no double booking, unique pairing) and the replacement is atomic.
-- scope 'all'      = replace every session of the target days (locked days are never targets);
-- scope 'unlocked' = same, but sessions flagged is_manual_override are kept (the PM's manual edits are pins).
create or replace function public.replace_distribution_sessions(p_node uuid, p_scope text, p_days uuid[], p_sessions jsonb, p_seed bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; d public.distributions; v_targets uuid[]; v_bad int; v_deleted int := 0; v_inserted int := 0; v_unmatched int := 0;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_scope is null or p_scope not in ('all', 'unlocked') then raise exception 'distribution_invalid: scope' using errcode = '22023', hint = 'distribution_invalid', detail = 'scope:invalid'; end if;
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) > 20000 then
    raise exception 'distribution_invalid: sessions' using errcode = '22023', hint = 'distribution_invalid', detail = 'sessions:invalid';
  end if;
  select * into d from public.distributions where node_id = p_node for update;
  if not found then raise exception 'distribution row missing' using errcode = 'P0002'; end if;

  if p_days is not null and exists (select 1 from unnest(p_days) u where not exists (select 1 from public.distribution_days x where x.id = u and x.node_id = p_node)) then
    raise exception 'distribution_invalid: unknown day' using errcode = '22023', hint = 'distribution_invalid', detail = 'day:unknown';
  end if;
  if p_days is not null and exists (select 1 from public.distribution_days x where x.node_id = p_node and x.id = any (p_days) and x.is_locked) then
    raise exception 'distribution_day_locked: a locked day cannot be generated' using errcode = 'P0001', hint = 'distribution_day_locked';
  end if;
  select coalesce(array_agg(x.id), '{}') into v_targets from public.distribution_days x
   where x.node_id = p_node and not x.is_locked and (p_days is null or x.id = any (p_days));

  -- every row must target an unlocked target day (a row for a locked day is the "generate never overwrites locked days" rule)
  select count(*) into v_bad from jsonb_to_recordset(p_sessions) as r(day_id uuid) where r.day_id is null or not (r.day_id = any (v_targets));
  if v_bad > 0 then
    if exists (select 1 from jsonb_to_recordset(p_sessions) as r(day_id uuid) join public.distribution_days x on x.id = r.day_id and x.node_id = p_node and x.is_locked) then
      raise exception 'distribution_day_locked: a locked day cannot be generated' using errcode = 'P0001', hint = 'distribution_day_locked';
    end if;
    raise exception 'distribution_invalid: day is not a target' using errcode = '22023', hint = 'distribution_invalid', detail = 'day:not_target';
  end if;

  -- slot inside the round, mentor on that day, mentor availability (days / window)
  select count(*) into v_bad
    from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean)
    cross join lateral app_private.distribution_eff(r.day_id) f
   where r.slot_index is null or r.slot_index < 0 or r.slot_index >= f.slots;
  if v_bad > 0 then raise exception 'distribution_invalid: slot outside the round' using errcode = '22023', hint = 'distribution_invalid', detail = 'slot:outside_round'; end if;
  select count(*) into v_bad
    from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean)
   where r.mentor_item_id is null or not exists (select 1 from public.distribution_day_mentors m where m.day_id = r.day_id and m.mentor_item_id = r.mentor_item_id);
  if v_bad > 0 then raise exception 'distribution_invalid: mentor is not on that day' using errcode = '22023', hint = 'distribution_invalid', detail = 'mentor:not_in_day'; end if;
  select count(*) into v_bad
    from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean)
    cross join lateral app_private.distribution_eff(r.day_id) f
    join public.distribution_mentor_rules u on u.node_id = p_node and u.mentor_item_id = r.mentor_item_id
   where (u.days is not null and not (f.day_index = any (u.days)))
      or (u.available_from is not null and f.start_min + r.slot_index * (f.slot_min + f.gap_min) < extract(epoch from u.available_from) / 60)
      or (u.available_to is not null and f.start_min + r.slot_index * (f.slot_min + f.gap_min) + f.slot_min > extract(epoch from u.available_to) / 60);
  if v_bad > 0 then raise exception 'distribution_invalid: outside the mentor availability' using errcode = '22023', hint = 'distribution_invalid', detail = 'mentor:outside_window'; end if;
  select count(*) into v_bad from (
    select r.day_id, r.mentor_item_id, u.max_slots, count(*) filter (where r.company_item_id is not null) as n_company
      from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean)
      join public.distribution_mentor_rules u on u.node_id = p_node and u.mentor_item_id = r.mentor_item_id and u.max_slots is not null
     group by r.day_id, r.mentor_item_id, u.max_slots) z where z.n_company > z.max_slots;
  if v_bad > 0 then raise exception 'distribution_invalid: mentor over the maximum' using errcode = '22023', hint = 'distribution_invalid', detail = 'mentor:over_max'; end if;
  select count(*) into v_bad from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean)
   where r.company_item_id is not null and not exists (select 1 from public.list_items li where li.id = r.company_item_id and li.project_id = n.project_id);
  if v_bad > 0 then raise exception 'distribution_invalid: unknown company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:unknown'; end if;

  -- no double booking inside the payload (mentor in one slot twice / company in one slot twice)
  select count(*) into v_bad from (
    select 1 from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid) group by r.day_id, r.slot_index, r.mentor_item_id having count(*) > 1) z;
  if v_bad > 0 then raise exception 'distribution_mentor_double_booked: a mentor appears twice in one slot' using errcode = '23505', hint = 'distribution_mentor_double_booked'; end if;
  select count(*) into v_bad from (
    select 1 from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, company_item_id uuid) where r.company_item_id is not null
     group by r.day_id, r.slot_index, r.company_item_id having count(*) > 1) z;
  if v_bad > 0 then raise exception 'distribution_company_double_booked: a company appears twice in one slot' using errcode = '23505', hint = 'distribution_company_double_booked'; end if;

  -- unique pairing: a (mentor, company) pair may not appear twice over the new rows + everything that stays (locked / untargeted days, kept pins)
  if d.unique_pairing then
    select count(*) into v_bad from (
      with new_rows as (select r.mentor_item_id as m, r.company_item_id as c
                          from jsonb_to_recordset(p_sessions) as r(mentor_item_id uuid, company_item_id uuid) where r.company_item_id is not null),
           kept as (select s.mentor_item_id as m, s.company_item_id as c from public.distribution_sessions s
                     where s.node_id = p_node and s.company_item_id is not null and (not (s.day_id = any (v_targets)) or (p_scope = 'unlocked' and s.is_manual_override)))
      select m, c from new_rows group by m, c having count(*) > 1
      union all select nr.m, nr.c from new_rows nr join kept k on k.m = nr.m and k.c = nr.c) z;
    if v_bad > 0 then raise exception 'distribution_pair_repeated: a mentor would meet the same company twice' using errcode = 'P0001', hint = 'distribution_pair_repeated'; end if;
  end if;

  delete from public.distribution_sessions s
   where s.node_id = p_node and s.day_id = any (v_targets) and (p_scope = 'all' or not s.is_manual_override);
  get diagnostics v_deleted = row_count;
  begin
    insert into public.distribution_sessions (project_id, node_id, day_id, slot_index, mentor_item_id, company_item_id, is_manual_override)
    select n.project_id, p_node, r.day_id, r.slot_index, r.mentor_item_id, r.company_item_id, coalesce(r.is_manual_override, false)
      from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean);
    get diagnostics v_inserted = row_count;
  exception when unique_violation then
    raise exception 'distribution_conflict: a row collides with a kept manual session' using errcode = '23505', hint = 'distribution_conflict';
  end;
  select count(*) into v_unmatched from jsonb_to_recordset(p_sessions) as r(company_item_id uuid) where r.company_item_id is null;
  if p_seed is not null then update public.distributions set seed = p_seed where node_id = p_node; end if;
  return jsonb_build_object('inserted', v_inserted, 'deleted', v_deleted, 'unmatched', v_unmatched, 'days', to_jsonb(v_targets));
end $$;
revoke all on function public.replace_distribution_sessions(uuid, text, uuid[], jsonb, bigint) from public, anon, authenticated;
grant execute on function public.replace_distribution_sessions(uuid, text, uuid[], jsonb, bigint) to authenticated;

-- Manual edits: set the company of one or more sessions atomically. A swap = two changes, a move = one change onto an empty cell, "remove" =
-- null. The inverse change list is the Undo. Rows are flagged is_manual_override unless the change carries the flag to restore.
-- Hard conflicts raise (day locked, company in two places at one slot, unknown company); repeated pairs under unique pairing are
-- returned as warnings (the PM may override a pairing on purpose).
create or replace function public.set_distribution_session_companies(p_node uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; d public.distributions; r record; v_ids uuid[]; v_n int := 0; v_warn jsonb := '[]'::jsonb; v_dup int;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 500 then
    raise exception 'distribution_invalid: changes' using errcode = '22023', hint = 'distribution_invalid', detail = 'changes:invalid';
  end if;
  select * into d from public.distributions where node_id = p_node for update;
  select coalesce(array_agg(c.session_id), '{}') into v_ids from jsonb_to_recordset(p_changes) as c(session_id uuid, company_item_id uuid, is_manual_override boolean);
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'distribution_invalid: duplicate session' using errcode = '22023', hint = 'distribution_invalid', detail = 'changes:duplicate';
  end if;
  if (select count(*) from public.distribution_sessions s where s.node_id = p_node and s.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'distribution_invalid: unknown session' using errcode = '22023', hint = 'distribution_invalid', detail = 'session:unknown';
  end if;
  if exists (select 1 from public.distribution_sessions s join public.distribution_days x on x.id = s.day_id where s.id = any (v_ids) and x.is_locked) then
    raise exception 'distribution_day_locked: unlock the day to edit it' using errcode = 'P0001', hint = 'distribution_day_locked';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_changes) as c(session_id uuid, company_item_id uuid, is_manual_override boolean)
              where c.company_item_id is not null and not exists (select 1 from public.list_items li where li.id = c.company_item_id and li.project_id = n.project_id)) then
    raise exception 'distribution_invalid: unknown company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:unknown';
  end if;
  -- a company may not be at two places in one slot: after the change, no other session of that slot (outside the changed set) may hold it,
  -- and the changed set itself may not hold it twice in one slot
  select count(*) into v_dup from (
    select 1 from jsonb_to_recordset(p_changes) as c(session_id uuid, company_item_id uuid, is_manual_override boolean)
      join public.distribution_sessions s on s.id = c.session_id
     where c.company_item_id is not null
       and exists (select 1 from public.distribution_sessions o where o.day_id = s.day_id and o.slot_index = s.slot_index and o.company_item_id = c.company_item_id and not (o.id = any (v_ids)))
    union all
    select 1 from jsonb_to_recordset(p_changes) as c(session_id uuid, company_item_id uuid, is_manual_override boolean)
      join public.distribution_sessions s on s.id = c.session_id where c.company_item_id is not null
     group by s.day_id, s.slot_index, c.company_item_id having count(*) > 1) z;
  if v_dup > 0 then raise exception 'distribution_company_double_booked: that company is already in another room at that time' using errcode = '23505', hint = 'distribution_company_double_booked'; end if;

  begin
    update public.distribution_sessions s set company_item_id = null where s.id = any (v_ids);
    for r in select c.session_id, c.company_item_id, c.is_manual_override from jsonb_to_recordset(p_changes) as c(session_id uuid, company_item_id uuid, is_manual_override boolean) loop
      update public.distribution_sessions s set company_item_id = r.company_item_id, is_manual_override = coalesce(r.is_manual_override, true) where s.id = r.session_id;
      v_n := v_n + 1;
    end loop;
  exception when unique_violation then
    raise exception 'distribution_company_double_booked: that company is already in another room at that time' using errcode = '23505', hint = 'distribution_company_double_booked';
  end;

  if d.unique_pairing then
    select coalesce(jsonb_agg(jsonb_build_object('code', 'repeat_pair', 'session_id', s.id, 'mentor_item_id', s.mentor_item_id, 'company_item_id', s.company_item_id)), '[]'::jsonb) into v_warn
      from public.distribution_sessions s
     where s.id = any (v_ids) and s.company_item_id is not null
       and exists (select 1 from public.distribution_sessions o where o.node_id = p_node and o.id <> s.id and o.mentor_item_id = s.mentor_item_id and o.company_item_id = s.company_item_id);
  end if;
  return jsonb_build_object('applied', v_n, 'warnings', v_warn);
end $$;
revoke all on function public.set_distribution_session_companies(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_distribution_session_companies(uuid, jsonb) to authenticated;

create or replace function public.set_distribution_day_lock(p_day uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.distribution_days;
begin
  select * into x from public.distribution_days where id = p_day for update;
  if not found or not app_private.is_project_manager(x.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.distribution_days set is_locked = coalesce(p_locked, false) where id = p_day;
end $$;
revoke all on function public.set_distribution_day_lock(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_distribution_day_lock(uuid, boolean) to authenticated;

-- publish toggle: touches ONLY the two publish columns (as-is BUG-1: the old upsert reset unrelated config columns)
create or replace function public.set_distribution_published(p_node uuid, p_published boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; d public.distributions;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.distributions set is_published = coalesce(p_published, false),
         published_at = case when coalesce(p_published, false) then now() else published_at end
   where node_id = p_node returning * into d;
  if not found then raise exception 'distribution row missing' using errcode = 'P0002'; end if;
  return jsonb_build_object('published', d.is_published, 'published_at', d.published_at);
end $$;
revoke all on function public.set_distribution_published(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_distribution_published(uuid, boolean) to authenticated;

-- The shared timer. PM only (authenticated + is_project_manager); a visitor has no function to call at all. Actions:
--   set_round {day_id, slot_index, run?}  point at a round (paused at the full duration, or running when run = true)
--   start | resume                        paused -> running (ends_at = now + remaining)
--   pause                                 running -> paused (remaining = ends_at - now)
--   adjust {seconds}                      +/- seconds on a running or paused round (never below zero)
--   reset                                 the same round, paused at the full duration
--   next | previous {run?}                the following / preceding round of the whole schedule (day by day)
--   clear                                 no round: the live view falls back to the wall clock
create or replace function public.distribution_timer_control(p_node uuid, p_action text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n public.nodes; t public.distribution_timers; f record; v_day uuid; v_slot int; v_run boolean; v_secs int; v_dur int; v_rem int;
  v_pos record;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('set_round', 'start', 'resume', 'pause', 'adjust', 'reset', 'next', 'previous', 'clear') then
    raise exception 'distribution_invalid: unknown timer action' using errcode = '22023', hint = 'distribution_invalid', detail = 'action:invalid';
  end if;
  p_args := coalesce(p_args, '{}'::jsonb);
  if not exists (select 1 from public.distributions where node_id = p_node) then raise exception 'distribution row missing' using errcode = 'P0002'; end if;
  insert into public.distribution_timers (node_id, project_id) values (p_node, n.project_id) on conflict (node_id) do nothing;
  select * into t from public.distribution_timers where node_id = p_node for update;
  v_run := coalesce((p_args->>'run')::boolean, false);

  if p_action in ('set_round', 'next', 'previous') then
    if p_action = 'set_round' then
      v_day := nullif(p_args->>'day_id', '')::uuid; v_slot := (p_args->>'slot_index')::int;
    else
      if t.day_id is null or t.slot_index is null then raise exception 'timer_no_round: no round is selected' using errcode = 'P0001', hint = 'timer_no_round'; end if;
      with seq as (
        select dd.id as day_id, g.i as slot_index, row_number() over (order by dd.day_index, g.i) as pos
          from public.distribution_days dd
          join public.distributions di on di.node_id = dd.node_id
          cross join lateral generate_series(0, app_private.distribution_slots(dd.total_round_min, coalesce(dd.slot_duration_min, di.slot_duration_min), coalesce(dd.gap_min, di.gap_min)) - 1) g(i)
         where dd.node_id = p_node)
      select s2.day_id, s2.slot_index into v_day, v_slot
        from seq s1 join seq s2 on s2.pos = s1.pos + case when p_action = 'next' then 1 else -1 end
       where s1.day_id = t.day_id and s1.slot_index = t.slot_index;
      if v_day is null then raise exception 'timer_no_next: there is no such round' using errcode = 'P0001', hint = 'timer_no_next'; end if;
    end if;
    select * into f from app_private.distribution_eff(v_day);
    if not found or f.node_id <> p_node or v_slot is null or v_slot < 0 or v_slot >= f.slots then
      raise exception 'distribution_invalid: unknown round' using errcode = '22023', hint = 'distribution_invalid', detail = 'round:invalid';
    end if;
    v_dur := f.slot_min * 60;
    update public.distribution_timers set day_id = v_day, slot_index = v_slot, duration_s = v_dur,
           status = case when v_run then 'running' else 'paused' end,
           ends_at = case when v_run then clock_timestamp() + make_interval(secs => v_dur) end,
           remaining_s = case when v_run then null else v_dur end,
           version = version + 1, updated_by = (select auth.uid()), updated_at = now()
     where node_id = p_node;
  elsif p_action in ('start', 'resume') then
    if t.status = 'idle' then raise exception 'timer_no_round: no round is selected' using errcode = 'P0001', hint = 'timer_no_round'; end if;
    if t.status = 'paused' then
      update public.distribution_timers set status = 'running', ends_at = clock_timestamp() + make_interval(secs => t.remaining_s), remaining_s = null,
             version = version + 1, updated_by = (select auth.uid()), updated_at = now() where node_id = p_node;
    end if;
  elsif p_action = 'pause' then
    if t.status = 'running' then
      update public.distribution_timers set status = 'paused', remaining_s = greatest(0, ceil(extract(epoch from (t.ends_at - clock_timestamp())))::int), ends_at = null,
             version = version + 1, updated_by = (select auth.uid()), updated_at = now() where node_id = p_node;
    end if;
  elsif p_action = 'adjust' then
    v_secs := (p_args->>'seconds')::int;
    if v_secs is null or v_secs < -3600 or v_secs > 3600 then raise exception 'distribution_invalid: seconds' using errcode = '22023', hint = 'distribution_invalid', detail = 'seconds:invalid'; end if;
    if t.status = 'idle' then raise exception 'timer_no_round: no round is selected' using errcode = 'P0001', hint = 'timer_no_round'; end if;
    if t.status = 'running' then
      update public.distribution_timers set ends_at = greatest(clock_timestamp(), t.ends_at + make_interval(secs => v_secs)),
             version = version + 1, updated_by = (select auth.uid()), updated_at = now() where node_id = p_node;
    else
      v_rem := greatest(0, t.remaining_s + v_secs);
      update public.distribution_timers set remaining_s = v_rem, version = version + 1, updated_by = (select auth.uid()), updated_at = now() where node_id = p_node;
    end if;
  elsif p_action = 'reset' then
    if t.status = 'idle' then raise exception 'timer_no_round: no round is selected' using errcode = 'P0001', hint = 'timer_no_round'; end if;
    update public.distribution_timers set status = 'paused', ends_at = null, remaining_s = t.duration_s,
           version = version + 1, updated_by = (select auth.uid()), updated_at = now() where node_id = p_node;
  elsif p_action = 'clear' then
    update public.distribution_timers set status = 'idle', day_id = null, slot_index = null, duration_s = 0, ends_at = null, remaining_s = null,
           version = version + 1, updated_by = (select auth.uid()), updated_at = now() where node_id = p_node;
  end if;
  return app_private.distribution_timer_json(p_node);
end $$;
revoke all on function public.distribution_timer_control(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.distribution_timer_control(uuid, text, jsonb) to authenticated;

-- PM payload (names resolved, session ids, locks, seed) + the timer: Edit and the PM preview read this ONE call, no public link needed
create or replace function public.get_distribution_payload(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.distribution_payload(p_node, true) || jsonb_build_object('viewer', 'pm', 'timer', app_private.distribution_timer_json(p_node));
end $$;
revoke all on function public.get_distribution_payload(uuid) from public, anon, authenticated;
grant execute on function public.get_distribution_payload(uuid) to authenticated;

-- the PM's own light read of the timer (the Edit "Live" tab polls this; visitors poll get_distribution_timer through their link)
create or replace function public.get_distribution_timer_state(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes;
begin
  select * into n from public.nodes where id = p_node and type = 'distribution' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.distribution_timer_json(p_node);
end $$;
revoke all on function public.get_distribution_timer_state(uuid) from public, anon, authenticated;
grant execute on function public.get_distribution_timer_state(uuid) to authenticated;

-- ================================================================= 5. public RPCs
-- link resolution for the two views. A slug or a legacy ref resolves through resolve_link; the as-is share links were /view/<event id>/mentoring/matrix
-- (the event id IS the project id, decision 04-8), so a bare project id also resolves to that project's matrix/live link (03-9: legacy links keep working).
create or replace function app_private.distribution_resolve(p_ref text, p_keys text[])
returns table (link_id uuid, node_id uuid, project_id uuid, kind text, view_key text, visibility text, slug text, title_en text, title_ar text, audience text)
language plpgsql stable security definer set search_path = '' as $$
declare v_slug text;
begin
  return query select r.* from app_private.resolve_link('view', p_ref) r where r.view_key = any (p_keys) limit 1;
  if found then return; end if;
  if btrim(coalesce(p_ref, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select sl.slug into v_slug from public.public_links pl join public.public_link_slugs sl on sl.link_id = pl.id and sl.is_current
     where pl.project_id = btrim(p_ref)::uuid and pl.kind = 'view' and pl.view_key = any (p_keys) order by pl.created_at limit 1;
    if v_slug is not null then
      return query select r.* from app_private.resolve_link('view', v_slug) r where r.view_key = any (p_keys) limit 1;
    end if;
  end if;
end $$;
revoke all on function app_private.distribution_resolve(text, text[]) from public, anon, authenticated;

-- /view/:ref/matrix | /view/:ref/live. The audience comes from the link and the node's visibility (resolve_link); an unpublished node answers
-- only `published: false` to visitors (the publish gate is enforced HERE, as-is it was UI-only, CON-17). A private node answers null.
create or replace function public.get_distribution_view(p_ref text, p_view_key text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; n public.nodes; d public.distributions;
begin
  select * into l from app_private.distribution_resolve(p_ref, case when p_view_key is null then array['matrix', 'live'] else array[p_view_key] end) r limit 1;
  if not found or l.node_id is null then return null; end if;
  select * into n from public.nodes where id = l.node_id and type = 'distribution' and deleted_at is null;
  if not found then return null; end if;
  select * into d from public.distributions where node_id = n.id;
  if not found then return null; end if;
  if not d.is_published and l.audience <> 'pm' then
    return jsonb_build_object('node_id', n.id, 'viewer', l.audience, 'view_key', l.view_key, 'published', false, 'name_en', n.name_en, 'name_ar', n.name_ar,
      'project', (select jsonb_build_object('name_en', j.name_en, 'name_ar', j.name_ar, 'timezone', j.timezone) from public.projects j where j.id = n.project_id));
  end if;
  return app_private.distribution_payload(n.id, l.audience = 'pm')
         || jsonb_build_object('viewer', l.audience, 'view_key', l.view_key, 'slug', l.slug, 'timer', app_private.distribution_timer_json(n.id));
end $$;

-- the tiny poll of the live view (a few hundred bytes): the timer + the revision, so a client refetches the full payload only when it changed
create or replace function public.get_distribution_timer(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; n public.nodes; d public.distributions; v_rev bigint;
begin
  select * into l from app_private.distribution_resolve(p_ref, array['live']) r limit 1;
  if not found or l.node_id is null then return null; end if;
  select * into n from public.nodes where id = l.node_id and type = 'distribution' and deleted_at is null;
  if not found then return null; end if;
  select * into d from public.distributions where node_id = n.id;
  if not found then return null; end if;
  select r.rev into v_rev from public.node_revisions r where r.node_id = n.id;
  return app_private.distribution_timer_json(n.id) || jsonb_build_object('published', d.is_published or l.audience = 'pm', 'revision', v_rev, 'viewer', l.audience);
end $$;
revoke all on function public.get_distribution_view(text, text), public.get_distribution_timer(text) from public;
grant execute on function public.get_distribution_view(text, text), public.get_distribution_timer(text) to anon, authenticated;

-- get_agenda_view: the m06d body; ONLY the tab titles changed: a Distribution node contributes TWO tabs (the matrix and "My schedule"), so without a
-- label override the second one is titled "My schedule"/"جدولي" instead of repeating the node name (a PM can still override it per edge).
create or replace function public.get_agenda_view(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; v_host public.nodes; v_tabs jsonb; v_revs jsonb; v_proj jsonb;
begin
  select * into l from app_private.resolve_link(null, p_ref) r where r.kind in ('agenda','project','view') limit 1;
  if not found then return null; end if;
  if l.node_id is not null then
    select * into v_host from public.nodes n where n.id = l.node_id and n.type in ('agenda','view_host') and n.deleted_at is null;
  end if;
  if v_host.id is null then
    select * into v_host from public.nodes n where n.project_id = l.project_id and n.type = 'view_host' and n.deleted_at is null
      order by n.created_at limit 1;
  end if;
  if v_host.id is null then return null; end if;

  select jsonb_agg(t order by (t->>'order')::int, t->>'edge_id') into v_tabs from (
    select jsonb_build_object('edge_id', null, 'node_id', v_host.id, 'type', 'agenda', 'view_key', 'agenda',
             'title_en', v_host.name_en, 'title_ar', v_host.name_ar, 'order', -1) as t
      where v_host.type = 'agenda'
    union all
    select jsonb_build_object('edge_id', e.id, 'node_id', s.id, 'type', s.type, 'view_key', e.from_port,
             'title_en', coalesce(e.label_en, case when s.type = 'distribution' and e.from_port = 'my-meetings-tab' then 'My schedule' else s.name_en end),
             'title_ar', coalesce(e.label_ar, case when s.type = 'distribution' and e.from_port = 'my-meetings-tab' then 'جدولي' else s.name_ar end), 'order', e.order_index)
      from public.edges e
      join public.nodes s on s.id = e.from_node_id and s.deleted_at is null
     where e.to_node_id = v_host.id and e.to_port = 'tabs' and e.is_enabled
       and app_private.tab_visible(l.audience, e.audience, s.visibility)
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('node_id', r.node_id, 'rev', r.rev)), '[]'::jsonb) into v_revs
    from public.node_revisions r
   where r.node_id = v_host.id or r.node_id in (select (t->>'node_id')::uuid from jsonb_array_elements(coalesce(v_tabs, '[]'::jsonb)) t);

  select jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar, 'cover_path', j.cover_path,
                            'timezone', j.timezone, 'completed', j.completed_at is not null) into v_proj
    from public.projects j where j.id = l.project_id;

  return jsonb_build_object('viewer', l.audience, 'project', v_proj,
           'host', jsonb_build_object('id', v_host.id, 'type', v_host.type, 'name_en', v_host.name_en, 'name_ar', v_host.name_ar),
           'tabs', coalesce(v_tabs, '[]'::jsonb), 'revisions', v_revs);
end $$;
grant execute on function public.get_agenda_view(text) to anon, authenticated;

-- get_public_tab: the m32 body; ONLY the distribution branch changed (the shared payload instead of the flat names-on-rows list)
create or replace function public.get_public_tab(p_ref text, p_edge uuid, p_after jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; v_host public.nodes; s public.nodes; e public.edges; v jsonb; v_next jsonb; v_rev bigint;
begin
  select * into l from app_private.resolve_link(null, p_ref) r where r.kind in ('agenda','project','view') limit 1;
  if not found then return null; end if;
  if l.node_id is not null then
    select * into v_host from public.nodes n where n.id = l.node_id and n.type in ('agenda','view_host') and n.deleted_at is null;
  end if;
  if v_host.id is null then
    select * into v_host from public.nodes n where n.project_id = l.project_id and n.type = 'view_host' and n.deleted_at is null
      order by n.created_at limit 1;
  end if;
  if v_host.id is null then return null; end if;

  if p_edge is null then
    if v_host.type <> 'agenda' then return null; end if;
    s := v_host;
  else
    select * into e from public.edges x where x.id = p_edge and x.to_node_id = v_host.id and x.to_port = 'tabs' and x.is_enabled;
    if not found then return null; end if;
    select * into s from public.nodes n where n.id = e.from_node_id and n.deleted_at is null;
    if not found or not app_private.tab_visible(l.audience, e.audience, s.visibility) then return null; end if;
  end if;
  select rev into v_rev from public.node_revisions where node_id = s.id;

  if s.type = 'agenda' then
    v := jsonb_build_object(
      'config', app_private.agenda_public_config(s.config),
      'timezone', (select j.timezone from public.projects j where j.id = s.project_id),
      'days', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'sort_order', d.sort_order, 'day_date', d.day_date, 'name_en', d.name_en, 'name_ar', d.name_ar,
        'slots', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'start_time', a.start_time, 'end_time', a.end_time,
            'title_en', a.title_en, 'title_ar', a.title_ar, 'bullets', a.bullets,
            'presenter_en', case when a.show_presenter then coalesce(a.presenter_en, ne.name_en) end,
            'presenter_ar', case when a.show_presenter then coalesce(a.presenter_ar, ne.name_ar) end) order by a.sort_order, a.start_time)
          from public.agenda_slots a
          left join public.list_items pi on pi.id = a.presenter_item_id
          left join public.network_experts ne on ne.id = pi.network_expert_id and ne.deleted_at is null
          where a.day_id = d.id), '[]'::jsonb)) order by d.sort_order)
      from public.agenda_days d where d.node_id = s.id), '[]'::jsonb));
  elsif s.type in ('list','selection') then
    v := app_private.list_public_payload(s,
           case when s.type = 'selection' then jsonb_build_object('status', to_jsonb(app_private.selection_passing(s.config))) else '{}'::jsonb end,
           p_after);
  elsif s.type = 'library' then
    v := jsonb_build_object('resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title_en', x.title_en, 'title_ar', x.title_ar, 'type', x.type,
               'url', x.url, 'has_file', x.file_path is not null, 'mime', x.mime) order by x.sort_order nulls last, x.id)
      from (select rr.* from public.resources rr
             where rr.deleted_at is null and (rr.node_id = s.id
                or rr.id in (select ls.resource_id from public.library_selections ls where ls.node_id = s.id))) x), '[]'::jsonb));
  elsif s.type = 'landing_page' then
    v := jsonb_build_object('config', s.config, 'cards', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'cover_path', c.cover_path, 'chip_label_en', c.chip_label_en, 'chip_label_ar', c.chip_label_ar,
               'title_en', c.title_en, 'title_ar', c.title_ar, 'body_en', c.body_en, 'body_ar', c.body_ar, 'see_more_lines', c.see_more_lines,
               'cta_label_en', c.cta_label_en, 'cta_label_ar', c.cta_label_ar, 'cta_url', c.cta_url, 'cta_node_id', c.cta_node_id,
               'cta_dot', c.cta_dot, 'share_enabled', c.share_enabled, 'share_url', c.share_url, 'share_node_id', c.share_node_id) order by c.sort_order)
      from public.landing_cards c where c.node_id = s.id), '[]'::jsonb));
  elsif s.type = 'distribution' then
    if not coalesce((select d.is_published from public.distributions d where d.node_id = s.id), false) and l.audience <> 'pm' then
      return null;       -- the publish flag is enforced server-side
    end if;
    v := app_private.distribution_payload(s.id, l.audience = 'pm');
  else
    v := jsonb_build_object('note', 'no public data for this node type');
  end if;
  return jsonb_build_object('type', s.type, 'node_id', s.id, 'revision', v_rev, 'data', v);
end $$;
grant execute on function public.get_public_tab(text, uuid, jsonb) to anon, authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)') is null
     or to_regprocedure('public.set_distribution_session_companies(uuid,jsonb)') is null
     or to_regprocedure('public.set_distribution_day_lock(uuid,boolean)') is null
     or to_regprocedure('public.set_distribution_published(uuid,boolean)') is null
     or to_regprocedure('public.distribution_timer_control(uuid,text,jsonb)') is null
     or to_regprocedure('public.get_distribution_payload(uuid)') is null
     or to_regprocedure('public.get_distribution_view(text,text)') is null
     or to_regprocedure('public.get_distribution_timer(text)') is null
     or to_regprocedure('public.get_distribution_timer_state(uuid)') is null
     or to_regprocedure('app_private.save_children_distribution(uuid,jsonb)') is null
     or to_regprocedure('app_private.distribution_payload(uuid,boolean)') is null then
    raise exception 'm35: a function is missing';
  end if;
  if (select save_children_fn from public.node_types where key = 'distribution') is distinct from 'save_children_distribution' then raise exception 'm35: node_types.distribution.save_children_fn'; end if;
  -- the timer can be written by NOBODY except the PM RPC: no client write grant, no anon execute on any control / PM function
  if has_table_privilege('authenticated', 'public.distribution_timers', 'INSERT') or has_table_privilege('authenticated', 'public.distribution_timers', 'UPDATE')
     or has_table_privilege('anon', 'public.distribution_timers', 'SELECT') then
    raise exception 'm35: distribution_timers must be read-only for clients';
  end if;
  if has_function_privilege('anon', 'public.distribution_timer_control(uuid,text,jsonb)', 'EXECUTE') or has_function_privilege('anon', 'public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_distribution_session_companies(uuid,jsonb)', 'EXECUTE') or has_function_privilege('anon', 'public.get_distribution_payload(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.get_distribution_timer_state(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.distribution_payload(uuid,boolean)', 'EXECUTE') then
    raise exception 'm35: anon must not reach the PM functions';
  end if;
  if not has_function_privilege('anon', 'public.get_distribution_view(text,text)', 'EXECUTE') or not has_function_privilege('anon', 'public.get_distribution_timer(text)', 'EXECUTE') then
    raise exception 'm35: anon must execute the read-only public RPCs';
  end if;
  if app_private.distribution_slots(130, 30, 0) <> 4 or app_private.distribution_slots(120, 10, 0) <> 12 or app_private.distribution_slots(55, 20, 5) <> 2 or app_private.distribution_slots(0, 20, 5) <> 0 then
    raise exception 'm35: distribution_slots self-check failed';
  end if;
  raise notice 'm35 ok';
end $$;

commit;
