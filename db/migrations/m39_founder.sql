-- m39_founder.sql  (Founder platform: the Programs list and the Program page, design 06 section 10 / 03 section 5 / decisions 02-7, 03-6, 06-6, docs/13 sections 4 + 11)
-- Adds ONLY what the founder side was missing. Re-runnable (create or replace). Local DB only. No business data is altered.
--
-- 1. app_private.my_participation(project)      the caller's participant row of a project (own user OR one of own companies), the "best"
--                                              one when there are two (attended > accepted > withdrawn). Every founder RPC below uses it.
-- 1b. app_private.link_my_participations()      a participant created from a FORM RESPONSE (accepted through Selection) has no account yet
--                                              (participants.form_response_id only). 02-8 decides "link by e-mail": when the founder opens the
--                                              platform, the participants whose response `founder_email` equals the VERIFIED e-mail of the
--                                              caller's founder account get `user_id` set (once, idempotent; never a staff account, 08 section
--                                              15; never an unverified e-mail; one participant per project and user). Called by the two RPCs below.
-- 2. app_private.founder_project_dates(project) first / last agenda day among the agenda nodes the PM EXPOSED (no dates leak otherwise).
-- 3. list_my_programs(include_withdrawn)        the founder Programs list: ONE card per project the caller participates in, with status,
--                                              cover, bilingual names, dates, completion. `withdrawn` is hidden by default (02-7); when asked
--                                              for it returns the card with STATUS ONLY (names, no cover / dates / location, 03-6).
-- 4. get_founder_program_page(project)          REPLACES the m06c stub (same signature, richer answer): the project header, the caller's
--                                              participation and the ORDERED list of ENABLED blocks (nothing by default, docs/13 section 11).
--                                              A `withdrawn` participant gets the header and NO blocks. A non-participant gets `forbidden`.
--                                              It reuses list_founder_agendas / list_founder_libraries / list_founder_landings /
--                                              list_my_certificates (never re-implements them).
-- 3b. get_founder_block(project, type, node, after) the lazy payload of the heavy blocks (agenda days for "next up", the people lists,
--                                              the distribution payload of "My schedule"), checked again against participation AND exposure.
--
-- What "enabled" means per block (one rule each, all server side):
--   description  projects.show_description AND a non-blank description (project, else program)
--   agenda       an agenda node: show_to_participants AND visibility platform/public AND a public ref to open (list_founder_agendas)
--   mentors      a LIST node of subkind `expert`  : show_to_participants AND platform/public AND at least one visible item
--   companies    a LIST node of subkind `company` : same
--   details      projects.show_details AND at least one of location / map link / offline days / transportation
--   library      list_founder_libraries     landing   list_founder_landings
--   schedule     a Mentoring Distribution node: show_to_participants AND platform/public AND PUBLISHED
--   certificate  list_my_certificates (issued, not revoked, attended, project completed, node exposed)
set search_path = public, extensions;

begin;

-- ================================================================= 1. the caller's participation
create or replace function app_private.my_participation(p_project uuid)
returns table (participant_id uuid, status text, withdrawal_requested boolean)
language sql stable security definer set search_path = '' as $$
  select pa.id, pa.status, pa.withdrawal_requested_at is not null
    from public.participants pa
   where pa.project_id = p_project
     and (select auth.uid()) is not null
     and (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids()))
   order by (pa.status = 'withdrawn'), (pa.status <> 'attended'), pa.created_at, pa.id
   limit 1
$$;
revoke all on function app_private.my_participation(uuid) from public, anon, authenticated;

-- ================================================================= 1b. link the caller's accepted form responses to the account (02-8)
create or replace function app_private.link_my_participations() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; k integer;
begin
  if v_uid is null then return 0; end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' then return 0; end if;
  if not exists (select 1 from public.user_roles r where r.user_id = v_uid and r.role_key = 'founder') then return 0; end if;
  with cand as (
    select distinct on (pa.project_id) pa.id
      from public.participants pa join public.form_responses fr on fr.id = pa.form_response_id
     where pa.user_id is null and lower(btrim(coalesce(fr.answers->>'founder_email', ''))) = v_email
       and not exists (select 1 from public.participants x where x.project_id = pa.project_id and x.user_id = v_uid)
     order by pa.project_id, pa.created_at, pa.id)
  update public.participants p set user_id = v_uid from cand where p.id = cand.id;
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function app_private.link_my_participations() from public, anon, authenticated;

-- ================================================================= 2. dates of the project, only from agendas the PM exposed
create or replace function app_private.founder_project_dates(p_project uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('start', min(d.day_date), 'end', max(d.day_date))
    from public.agenda_days d
    join public.nodes n on n.id = d.node_id and n.type = 'agenda' and n.deleted_at is null
     and n.show_to_participants and n.visibility in ('platform', 'public')
   where n.project_id = p_project and d.day_date is not null
$$;
revoke all on function app_private.founder_project_dates(uuid) from public, anon, authenticated;

-- ================================================================= 3. the Programs list
create or replace function public.list_my_programs(p_include_withdrawn boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform app_private.link_my_participations();
  return coalesce((
    select jsonb_agg(x.j order by x.done, x.sort_key desc nulls last, x.pid)
      from (
        select b.pid,
               (j.completed_at is not null and b.status <> 'withdrawn') as done,
               coalesce((app_private.founder_project_dates(b.pid)->>'start')::date, j.created_at::date) as sort_key,
               case when b.status = 'withdrawn' then
                 jsonb_build_object('participant_id', b.participant_id, 'project_id', b.pid, 'program_id', j.program_id, 'status', b.status, 'restricted', true,
                   'project_name_en', j.name_en, 'project_name_ar', j.name_ar, 'program_name_en', g.name_en, 'program_name_ar', g.name_ar)
               else
                 jsonb_build_object('participant_id', b.participant_id, 'project_id', b.pid, 'program_id', j.program_id, 'status', b.status, 'restricted', false,
                   'project_name_en', j.name_en, 'project_name_ar', j.name_ar, 'program_name_en', g.name_en, 'program_name_ar', g.name_ar,
                   'cover_path', coalesce(j.cover_path, g.cover_path), 'timezone', j.timezone,
                   'completed', j.completed_at is not null, 'completed_at', j.completed_at,
                   'start_date', app_private.founder_project_dates(b.pid)->'start', 'end_date', app_private.founder_project_dates(b.pid)->'end',
                   'location_en', case when j.show_details then nullif(btrim(coalesce(j.location_en, '')), '') end,
                   'location_ar', case when j.show_details then nullif(btrim(coalesce(j.location_ar, '')), '') end,
                   'withdrawal_requested', b.withdrawal_requested)
               end as j
          from (select distinct on (pa.project_id) pa.id as participant_id, pa.project_id as pid, pa.status, pa.withdrawal_requested_at is not null as withdrawal_requested
                  from public.participants pa
                 where pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids())
                 order by pa.project_id, (pa.status = 'withdrawn'), (pa.status <> 'attended'), pa.created_at, pa.id) b
          join public.projects j on j.id = b.pid and j.deleted_at is null
          join public.programs g on g.id = j.program_id and g.deleted_at is null
         where p_include_withdrawn or b.status <> 'withdrawn') x), '[]'::jsonb);
end $$;
revoke all on function public.list_my_programs(boolean) from public, anon, authenticated;
grant execute on function public.list_my_programs(boolean) to authenticated;

-- ================================================================= 4. the Program page (replaces the m06c stub)
create or replace function public.get_founder_program_page(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.projects; g public.programs; me record; v_blocks jsonb := '[]'::jsonb; v_arr jsonb; v_desc_en text; v_desc_ar text; r record; v_dates jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform app_private.link_my_participations();
  select * into me from app_private.my_participation(p_project);
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.projects where id = p_project and deleted_at is null;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into g from public.programs where id = j.program_id and deleted_at is null;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;

  -- withdrawn: the header with the NAMES and the status only (03-6); no cover, dates, blocks or links
  if me.status = 'withdrawn' then
    return jsonb_build_object(
      'project', jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar,
                  'program', jsonb_build_object('id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar)),
      'participant', jsonb_build_object('id', me.participant_id, 'status', me.status, 'withdrawal_requested', me.withdrawal_requested),
      'restricted', true, 'blocks', '[]'::jsonb);
  end if;

  -- description
  v_desc_en := coalesce(nullif(btrim(coalesce(j.description_en, '')), ''), nullif(btrim(coalesce(g.description_en, '')), ''));
  v_desc_ar := coalesce(nullif(btrim(coalesce(j.description_ar, '')), ''), nullif(btrim(coalesce(g.description_ar, '')), ''));
  if j.show_description and (v_desc_en is not null or v_desc_ar is not null) then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'description', 'data',
      jsonb_build_object('description_en', v_desc_en, 'description_ar', v_desc_ar)));
  end if;

  -- agenda (one entry per exposed node that has a link to open)
  select coalesce(jsonb_agg(a), '[]'::jsonb) into v_arr from jsonb_array_elements(public.list_founder_agendas(p_project)) a where a->>'ref' is not null;
  if jsonb_array_length(v_arr) > 0 then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'agenda', 'data', jsonb_build_object('items', v_arr)));
  end if;

  -- mentors, then companies: the exposed lists of that kind that have something to show
  for r in
    select n.id, n.name_en, n.name_ar, l.subkind
      from public.nodes n join public.lists l on l.node_id = n.id
     where n.project_id = p_project and n.type = 'list' and n.deleted_at is null and n.show_to_participants
       and n.visibility in ('platform', 'public') and l.subkind in ('expert', 'company')
     order by (l.subkind = 'company'), n.created_at, n.id
  loop
    if exists (select 1 from app_private.resolve_list_rows(r.id, '{}'::jsonb, 1, null, false)) then
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', case r.subkind when 'expert' then 'mentors' else 'companies' end,
        'node_id', r.id, 'data', jsonb_build_object('node_id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar)));
    end if;
  end loop;

  -- details (Project Details, only when the PM turned the toggle on AND filled something in)
  if j.show_details and (nullif(btrim(coalesce(j.location_en, '')), '') is not null or nullif(btrim(coalesce(j.location_ar, '')), '') is not null
                         or j.map_url is not null or coalesce(j.offline_days, 0) > 0 or j.transportation is not null) then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'details', 'data', jsonb_strip_nulls(jsonb_build_object(
      'location_en', nullif(btrim(coalesce(j.location_en, '')), ''), 'location_ar', nullif(btrim(coalesce(j.location_ar, '')), ''),
      'map_url', j.map_url, 'offline_days', case when coalesce(j.offline_days, 0) > 0 then j.offline_days end, 'transportation', j.transportation))));
  end if;

  -- library / landing: the existing exposure RPCs
  select coalesce(jsonb_agg(a), '[]'::jsonb) into v_arr from jsonb_array_elements(public.list_founder_libraries(p_project)) a where a->>'ref' is not null;
  if jsonb_array_length(v_arr) > 0 then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'library', 'data', jsonb_build_object('items', v_arr)));
  end if;
  select coalesce(jsonb_agg(a), '[]'::jsonb) into v_arr from jsonb_array_elements(public.list_founder_landings(p_project)) a where a->>'ref' is not null;
  if jsonb_array_length(v_arr) > 0 then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'landing', 'data', jsonb_build_object('items', v_arr)));
  end if;

  -- My schedule / Who do I meet next (a PUBLISHED Mentoring Distribution node the PM exposed)
  select coalesce(jsonb_agg(jsonb_build_object('node_id', n.id, 'name_en', n.name_en, 'name_ar', n.name_ar) order by n.created_at, n.id), '[]'::jsonb) into v_arr
    from public.nodes n join public.distributions d on d.node_id = n.id and d.is_published
   where n.project_id = p_project and n.type = 'distribution' and n.deleted_at is null and n.show_to_participants and n.visibility in ('platform', 'public');
  if jsonb_array_length(v_arr) > 0 then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'schedule', 'data', jsonb_build_object('items', v_arr)));
  end if;

  -- certificate (decided in the DB: issued, not revoked, attended, project completed, node exposed)
  v_arr := public.list_my_certificates(p_project);
  if jsonb_array_length(v_arr) > 0 then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'certificate', 'data', jsonb_build_object('items', v_arr)));
  end if;

  v_dates := app_private.founder_project_dates(p_project);
  return jsonb_build_object(
    'project', jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar,
                'program', jsonb_build_object('id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar),
                'cover_path', coalesce(j.cover_path, g.cover_path), 'timezone', j.timezone,
                'completed', j.completed_at is not null, 'completed_at', j.completed_at,
                'start_date', v_dates->'start', 'end_date', v_dates->'end'),
    'participant', jsonb_build_object('id', me.participant_id, 'status', me.status, 'withdrawal_requested', me.withdrawal_requested),
    'restricted', false, 'blocks', v_blocks);
end $$;
revoke all on function public.get_founder_program_page(uuid) from public, anon, authenticated;
grant execute on function public.get_founder_program_page(uuid) to authenticated;

-- ================================================================= 3b. the lazy payloads of the heavy blocks
-- type: 'agenda' (days for "next up"), 'mentors' | 'companies' (the list payload, same whitelist as the public tab), 'schedule' (the distribution
-- payload with `my_company_ids`). The node must be exposed (show_to_participants, platform/public) and belong to the project; the caller must be
-- an accepted / attended participant. A node that is not exposed answers null (nothing to tell about it).
create or replace function public.get_founder_block(p_project uuid, p_type text, p_node uuid, p_after jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes; v jsonb; v_kind text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_type not in ('agenda', 'mentors', 'companies', 'schedule') then raise exception 'invalid block' using errcode = '22023'; end if;
  if not app_private.is_participant(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into n from public.nodes x
   where x.id = p_node and x.project_id = p_project and x.deleted_at is null and x.show_to_participants and x.visibility in ('platform', 'public');
  if not found then return null; end if;

  if p_type = 'agenda' then
    if n.type <> 'agenda' then return null; end if;
    v := jsonb_build_object('config', app_private.agenda_public_config(n.config),
      'timezone', (select j.timezone from public.projects j where j.id = n.project_id),
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
        from public.agenda_days d where d.node_id = n.id), '[]'::jsonb));
  elsif p_type in ('mentors', 'companies') then
    if n.type <> 'list' then return null; end if;
    select l.subkind into v_kind from public.lists l where l.node_id = n.id;
    if v_kind is distinct from (case when p_type = 'mentors' then 'expert' else 'company' end) then return null; end if;
    v := app_private.list_public_payload(n, '{}'::jsonb, p_after);
  else
    if n.type <> 'distribution' or not coalesce((select d.is_published from public.distributions d where d.node_id = n.id), false) then return null; end if;
    v := app_private.distribution_payload(n.id, false);
  end if;
  return jsonb_build_object('type', p_type, 'node_id', n.id, 'viewer', 'participant', 'data', v);
end $$;
revoke all on function public.get_founder_block(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_founder_block(uuid, text, uuid, jsonb) to authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('app_private.my_participation(uuid)') is null or to_regprocedure('app_private.founder_project_dates(uuid)') is null
     or to_regprocedure('public.list_my_programs(boolean)') is null or to_regprocedure('public.get_founder_program_page(uuid)') is null
     or to_regprocedure('public.get_founder_block(uuid,text,uuid,jsonb)') is null or to_regprocedure('app_private.link_my_participations()') is null then
    raise exception 'm39: a function is missing';
  end if;
  if has_function_privilege('anon', 'public.list_my_programs(boolean)', 'EXECUTE') or has_function_privilege('anon', 'public.get_founder_program_page(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_founder_block(uuid,text,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.my_participation(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.link_my_participations()', 'EXECUTE') or has_function_privilege('anon', 'app_private.founder_project_dates(uuid)', 'EXECUTE') then
    raise exception 'm39: anon must not execute the founder functions';
  end if;
  if not (has_function_privilege('authenticated', 'public.list_my_programs(boolean)', 'EXECUTE') and has_function_privilege('authenticated', 'public.get_founder_program_page(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.get_founder_block(uuid,text,uuid,jsonb)', 'EXECUTE')) then
    raise exception 'm39: authenticated must execute the founder RPCs';
  end if;
end $$;

commit;
