-- m06b_rpcs_graph  (04 5.2: programs/projects/members, graph, nodes, revisions; per-type child writers)
-- All functions: SECURITY DEFINER, search_path = '', first statement re-checks the caller.
-- EXECUTE grants are issued in m07 (default: nobody; authenticated for the listed RPCs).
set search_path = public, extensions;

begin;

-- ================================================================= programs / projects / members
create or replace function public.create_program(
  p_name_en text, p_name_ar text default null, p_description_en text default null, p_description_ar text default null,
  p_program_type text default null, p_year smallint default null)
returns public.programs language plpgsql security definer set search_path = '' as $$
declare v public.programs;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (app_private.has_role('project_manager') or app_private.is_super_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.programs (name_en, name_ar, description_en, description_ar, program_type, year, created_by)
  values (p_name_en, p_name_ar, p_description_en, p_description_ar, p_program_type, p_year, (select auth.uid()))
  returning * into v;                                -- trigger programs_ai_owner makes the caller the owner
  return v;
end $$;

create or replace function public.create_project(
  p_program uuid, p_name_en text, p_name_ar text default null, p_timezone text default 'Africa/Cairo')
returns public.projects language plpgsql security definer set search_path = '' as $$
declare v public.projects;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.is_program_member(p_program) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.programs g where g.id = p_program and g.deleted_at is null) then
    raise exception 'program not found' using errcode = 'P0002';
  end if;
  insert into public.projects (program_id, name_en, name_ar, timezone, created_by)
  values (p_program, p_name_en, p_name_ar, coalesce(p_timezone, 'Africa/Cairo'), (select auth.uid()))
  returning * into v;                                -- trigger projects_ai_owner makes the caller the project owner
  -- the implicit view-page host (08 01-3): hidden system node, deletable never
  insert into public.nodes (project_id, type, name_en, name_ar, is_system, created_by)
  values (v.id, 'view_host', 'Project page', 'صفحة المشروع', true, (select auth.uid()));
  return v;
end $$;

create or replace function public.add_member(p_scope text, p_scope_id uuid, p_user uuid, p_role text default 'manager')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('owner','manager') then raise exception 'invalid member role' using errcode = '22023'; end if;
  if not (app_private.is_super_admin() or exists (
        select 1 from public.user_roles r where r.user_id = p_user and r.role_key in ('project_manager','super_admin'))) then
    raise exception 'the user must hold the project_manager role' using errcode = '22023';
  end if;
  if p_scope = 'program' then
    if not app_private.is_program_owner(p_scope_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    insert into public.program_members (program_id, user_id, member_role, added_by)
    values (p_scope_id, p_user, p_role, (select auth.uid()))
    on conflict (program_id, user_id) do update set member_role = excluded.member_role;
  elsif p_scope = 'project' then
    if not app_private.is_project_owner(p_scope_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    insert into public.project_members (project_id, user_id, member_role, added_by)
    values (p_scope_id, p_user, p_role, (select auth.uid()))
    on conflict (project_id, user_id) do update set member_role = excluded.member_role;
  else
    raise exception 'scope must be program or project' using errcode = '22023';
  end if;
end $$;

-- ================================================================= graph reads
create or replace function public.get_project_graph(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'project', (select jsonb_build_object('id', j.id, 'program_id', j.program_id, 'name_en', j.name_en, 'name_ar', j.name_ar,
                       'timezone', j.timezone, 'visibility', j.visibility, 'cover_path', j.cover_path, 'completed_at', j.completed_at)
                from public.projects j where j.id = p_project and j.deleted_at is null),
    'nodes', coalesce((select jsonb_agg(jsonb_build_object(
                'id', n.id, 'type', n.type, 'type_version', n.type_version, 'name_en', n.name_en, 'name_ar', n.name_ar,
                'visibility', n.visibility, 'show_to_participants', n.show_to_participants,
                'position_x', n.position_x, 'position_y', n.position_y, 'is_system', n.is_system) order by n.created_at, n.id)
              from public.nodes n where n.project_id = p_project and n.deleted_at is null), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object(
                'id', e.id, 'from_node_id', e.from_node_id, 'from_port', e.from_port, 'to_node_id', e.to_node_id,
                'to_port', e.to_port, 'family', e.family, 'is_enabled', e.is_enabled, 'audience', e.audience,
                'label_en', e.label_en, 'label_ar', e.label_ar, 'order_index', e.order_index, 'filter', e.filter)
                order by e.order_index, e.created_at)
              from public.edges e
              join public.nodes f on f.id = e.from_node_id and f.deleted_at is null
              join public.nodes t on t.id = e.to_node_id and t.deleted_at is null
              where e.project_id = p_project), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('node_id', r.node_id, 'rev', r.rev))
              from public.node_revisions r where r.project_id = p_project), '[]'::jsonb));
end $$;

-- one node with its config (the canvas list excludes config; 04 6.8)
create or replace function public.get_node(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select to_jsonb(n) || jsonb_build_object('rev', r.rev) into v
  from public.nodes n join public.node_revisions r on r.node_id = n.id
  where n.id = p_node and n.deleted_at is null and app_private.is_project_manager(n.project_id);
  if v is null then raise exception 'forbidden or not found' using errcode = '42501'; end if;
  return v;
end $$;

-- effective revision = hash of own rev and every upstream (ancestor) rev; terminates on the union graph even if it is cyclic
create or replace function public.get_graph_revisions(p_project uuid)
returns table (node_id uuid, rev bigint, eff_rev bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.is_project_manager(p_project) or app_private.is_participant(p_project)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with recursive anc(n, a) as (
    select nd.id, nd.id from public.nodes nd where nd.project_id = p_project and nd.deleted_at is null
    union
    select x.n, e.from_node_id from anc x
      join public.edges e on e.to_node_id = x.a and e.project_id = p_project and e.is_enabled
  )
  select x.n, own.rev,
         hashtextextended(string_agg(x.a::text || ':' || ar.rev::text, ',' order by x.a), 0)
  from anc x
  join public.node_revisions own on own.node_id = x.n
  join public.node_revisions ar  on ar.node_id = x.a
  group by x.n, own.rev;
end $$;

-- ================================================================= node lifecycle
create or replace function public.add_node(
  p_project uuid, p_type text, p_name jsonb default '{}'::jsonb,
  p_x double precision default 0, p_y double precision default 0, p_options jsonb default '{}'::jsonb)
returns public.nodes language plpgsql security definer set search_path = '' as $$
declare t public.node_types; v public.nodes;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.projects j where j.id = p_project and j.deleted_at is null) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  select * into t from public.node_types where key = p_type;
  if not found then raise exception 'unknown node type %', p_type using errcode = '22023'; end if;
  if t.is_system then raise exception 'system node types are created by the platform' using errcode = '42501'; end if;
  if t.is_singleton and exists (select 1 from public.nodes n where n.project_id = p_project and n.type = p_type and n.deleted_at is null) then
    raise exception 'node type % is a singleton per project', p_type using errcode = '23505';
  end if;

  insert into public.nodes (project_id, type, type_version, name_en, name_ar, position_x, position_y, created_by)
  values (p_project, p_type, t.latest_version,
          coalesce(nullif(p_name->>'en', ''), case when nullif(p_name->>'ar', '') is null then t.name_en end),
          coalesce(nullif(p_name->>'ar', ''), case when nullif(p_name->>'en', '') is null then t.name_ar end),
          coalesce(p_x, 0), coalesce(p_y, 0), (select auth.uid()))
  returning * into v;

  -- extension rows pin the node type (04 2.5)
  if p_type = 'form_builder' then
    insert into public.forms (node_id, project_id) values (v.id, v.project_id);
  elsif p_type = 'list' then
    insert into public.lists (node_id, project_id, subkind)
    values (v.id, v.project_id, coalesce(nullif(p_options->>'subkind', ''), 'generic'));
  elsif p_type = 'booking' then
    insert into public.booking_settings (node_id, project_id, mode)
    values (v.id, v.project_id, coalesce(nullif(p_options->>'mode', ''), 'mentor'));
  elsif p_type = 'distribution' then
    insert into public.distributions (node_id, project_id) values (v.id, v.project_id);
  end if;
  return v;
end $$;

-- atomic save with optimistic concurrency (04 8.4, 02 5.4)
create or replace function public.save_node(
  p_node uuid, p_expected_rev bigint, p_patch jsonb, p_children jsonb default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid; v_type text; v_rev bigint; v_fn text; v_schema jsonb; v_key text; v_ok boolean;
  v_allowed text[] := array['name_en','name_ar','visibility','show_to_participants','config','type_version'];
begin
  select n.project_id, n.type into v_project, v_type
    from public.nodes n where n.id = p_node and n.deleted_at is null for update;
  if not found or not app_private.is_project_manager(v_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then raise exception 'patch key % is not allowed', v_key using errcode = '22023'; end if;
  end loop;

  select r.rev into v_rev from public.node_revisions r where r.node_id = p_node for update;
  if v_rev is distinct from p_expected_rev and not coalesce(p_force, false) then
    -- NOT 40001: PostgREST retries a serialization failure for ever (a stale save would hang the request; found in the m50 review, fixed by m52). P0001 + hint token + detail = the current rev.
    raise exception 'revision_conflict: current rev %', v_rev using errcode = 'P0001', hint = 'revision_conflict', detail = v_rev::text;
  end if;
  if coalesce(p_force, false) and v_rev is distinct from p_expected_rev and not app_private.is_project_owner(v_project) then
    raise exception 'only the project owner may overwrite a newer revision' using errcode = '42501';
  end if;

  -- config validation: JSON Schema when pg_jsonschema is installed, else object type + size cap (CHECK on the column)
  if p_patch ? 'config' then
    if jsonb_typeof(p_patch->'config') <> 'object' then raise exception 'config must be an object' using errcode = '22023'; end if;
    select nt.config_schema into v_schema from public.node_types nt where nt.key = v_type;
    if v_schema is not null and to_regprocedure('extensions.jsonb_matches_schema(json,jsonb)') is not null then
      execute 'select extensions.jsonb_matches_schema($1::json, $2)' into v_ok using v_schema, p_patch->'config';
      if not coalesce(v_ok, false) then raise exception 'config violates the schema of node type %', v_type using errcode = '22023'; end if;
    end if;
  end if;

  perform set_config('app_private.in_save_node', '1', true);   -- children/own triggers must not bump: we bump once below

  update public.nodes set
      name_en = case when p_patch ? 'name_en' then p_patch->>'name_en' else name_en end,
      name_ar = case when p_patch ? 'name_ar' then p_patch->>'name_ar' else name_ar end,
      visibility = coalesce(p_patch->>'visibility', visibility),
      show_to_participants = coalesce((p_patch->>'show_to_participants')::boolean, show_to_participants),
      config = case when p_patch ? 'config' then p_patch->'config' else config end,
      type_version = coalesce((p_patch->>'type_version')::smallint, type_version)
    where id = p_node;

  select nt.save_children_fn into v_fn from public.node_types nt where nt.key = v_type;
  if p_children is not null then
    if v_fn is null then raise exception 'node type % has no typed children', v_type using errcode = '22023'; end if;
    execute format('select app_private.%I($1, $2)', v_fn) using p_node, p_children;
  end if;

  update public.node_revisions set rev = rev + 1, updated_at = now() where node_id = p_node returning rev into v_rev;
  perform set_config('app_private.in_save_node', '', true);
  return jsonb_build_object('rev', v_rev);
end $$;

-- layout only: never bumps a revision (nodes_au_bump ignores position columns)
create or replace function public.move_nodes(p_project uuid, p_positions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.nodes n set position_x = x.x, position_y = x.y
  from jsonb_to_recordset(p_positions) as x(id uuid, x double precision, y double precision)
  where n.id = x.id and n.project_id = p_project;
end $$;

-- soft delete / undo; returns the impact list (04 5.2)
create or replace function public.delete_node(p_node uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.nodes; v_edges int; v_links int; v_dependents jsonb;
begin
  select * into v from public.nodes where id = p_node and deleted_at is null for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v.is_system then raise exception 'system nodes cannot be deleted' using errcode = '42501'; end if;
  select count(*) into v_edges from public.edges e where e.from_node_id = p_node or e.to_node_id = p_node;
  select count(*) into v_links from public.public_links l where l.node_id = p_node;
  select coalesce(jsonb_agg(distinct e.to_node_id), '[]'::jsonb) into v_dependents from public.edges e where e.from_node_id = p_node;
  update public.nodes set deleted_at = now() where id = p_node;
  return jsonb_build_object('node_id', p_node, 'edges', v_edges, 'public_links', v_links, 'dependents', v_dependents);
end $$;

create or replace function public.restore_node(p_node uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.nodes;
begin
  select * into v from public.nodes where id = p_node and deleted_at is not null for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.nodes set deleted_at = null where id = p_node;
end $$;

-- ================================================================= edges
create or replace function public.connect(
  p_project uuid, p_from_node uuid, p_from_port text, p_to_node uuid, p_to_port text, p_config jsonb default '{}'::jsonb)
returns public.edges language plpgsql security definer set search_path = '' as $$
declare v_family text; v public.edges;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select p->'families'->>0 into v_family
    from public.nodes n join public.node_types nt on nt.key = n.type, jsonb_array_elements(nt.ports) p
   where n.id = p_from_node and n.project_id = p_project and p->>'key' = p_from_port and p->>'direction' = 'out';
  if v_family is null then raise exception 'unknown output port' using errcode = '23514'; end if;
  insert into public.edges (project_id, from_node_id, from_port, to_node_id, to_port, family,
                            is_enabled, audience, label_en, label_ar, order_index, filter)
  values (p_project, p_from_node, p_from_port, p_to_node, p_to_port, v_family,
          coalesce((p_config->>'is_enabled')::boolean, true), coalesce(p_config->>'audience', 'platform'),
          p_config->>'label_en', p_config->>'label_ar', coalesce((p_config->>'order_index')::int, 0),
          coalesce(p_config->'filter', '{}'::jsonb))
  returning * into v;                                  -- validate_edge trigger: ports, family, kind, cardinality, cycles
  return v;
end $$;

create or replace function public.update_edge(p_edge uuid, p_patch jsonb) returns public.edges
language plpgsql security definer set search_path = '' as $$
declare v public.edges;
begin
  select * into v from public.edges where id = p_edge for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.edges set
      is_enabled  = coalesce((p_patch->>'is_enabled')::boolean, is_enabled),
      audience    = coalesce(p_patch->>'audience', audience),
      label_en    = case when p_patch ? 'label_en' then p_patch->>'label_en' else label_en end,
      label_ar    = case when p_patch ? 'label_ar' then p_patch->>'label_ar' else label_ar end,
      order_index = coalesce((p_patch->>'order_index')::int, order_index),
      filter      = coalesce(p_patch->'filter', filter)
    where id = p_edge returning * into v;
  return v;
end $$;

create or replace function public.disconnect(p_edge uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.edges;
begin
  select * into v from public.edges where id = p_edge for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.edges where id = p_edge;
end $$;

-- ================================================================= per-type atomic child writers (called by save_node)
-- Agenda: { "days": [ { id?, sort_order, day_date, name_en, name_ar, slots: [ {id?, sort_order, start_time, end_time,
--           title_en, title_ar, presenter_en, presenter_ar, presenter_item_id, show_presenter, bullets} ] } ] }
create or replace function app_private.save_children_agenda(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; d record; v_day uuid; keep_days uuid[] := '{}'; keep_slots uuid[];
begin
  select project_id into v_project from public.nodes where id = p_node;
  if p_children ? 'days' then
    if exists (select 1 from jsonb_to_recordset(p_children->'days') as x(id uuid)
               join public.agenda_days a on a.id = x.id where a.node_id <> p_node) then
      raise exception 'a day id belongs to another node' using errcode = '42501';
    end if;
    for d in select * from jsonb_to_recordset(p_children->'days')
             as x(id uuid, sort_order smallint, day_date date, name_en text, name_ar text, slots jsonb)
    loop
      insert into public.agenda_days (id, project_id, node_id, sort_order, day_date, name_en, name_ar)
      values (coalesce(d.id, gen_random_uuid()), v_project, p_node, d.sort_order, d.day_date, d.name_en, d.name_ar)
      on conflict (id) do update set sort_order = excluded.sort_order, day_date = excluded.day_date,
        name_en = excluded.name_en, name_ar = excluded.name_ar
      returning id into v_day;
      keep_days := keep_days || v_day;
      if d.slots is not null then
        keep_slots := '{}';
        if exists (select 1 from jsonb_to_recordset(d.slots) as s(id uuid)
                   join public.agenda_slots a on a.id = s.id where a.day_id <> v_day) then
          raise exception 'a slot id belongs to another day' using errcode = '42501';
        end if;
        with up as (
          insert into public.agenda_slots (id, project_id, day_id, sort_order, start_time, end_time, title_en, title_ar,
                      presenter_en, presenter_ar, presenter_item_id, show_presenter, bullets)
          select coalesce(s.id, gen_random_uuid()), v_project, v_day, s.sort_order, s.start_time, s.end_time, s.title_en,
                 s.title_ar, s.presenter_en, s.presenter_ar, s.presenter_item_id, coalesce(s.show_presenter, true),
                 coalesce(s.bullets, '[]'::jsonb)
          from jsonb_to_recordset(d.slots) as s(id uuid, sort_order smallint, start_time time, end_time time, title_en text,
               title_ar text, presenter_en text, presenter_ar text, presenter_item_id uuid, show_presenter boolean, bullets jsonb)
          on conflict (id) do update set sort_order = excluded.sort_order, start_time = excluded.start_time,
            end_time = excluded.end_time, title_en = excluded.title_en, title_ar = excluded.title_ar,
            presenter_en = excluded.presenter_en, presenter_ar = excluded.presenter_ar,
            presenter_item_id = excluded.presenter_item_id, show_presenter = excluded.show_presenter, bullets = excluded.bullets
          returning id)
        select array_agg(id) into keep_slots from up;
        delete from public.agenda_slots where day_id = v_day and id <> all (coalesce(keep_slots, '{}'));
      end if;
    end loop;
    delete from public.agenda_days where node_id = p_node and id <> all (keep_days);
  end if;
end $$;

-- Form: { "form": {is_active, opens_at, closes_at, max_responses, one_response_per_email, export_sheet_id, export_sheet_tab,
--         cover_id, template_id}, "sections": [..], "questions": [..] }  (ids stable; missing ones are deleted)
create or replace function app_private.save_children_form_builder(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; keep_s uuid[]; keep_q uuid[]; f jsonb := p_children->'form';
begin
  select project_id into v_project from public.nodes where id = p_node;
  if f is not null then
    update public.forms set
      is_active = coalesce((f->>'is_active')::boolean, is_active),
      opens_at = case when f ? 'opens_at' then (f->>'opens_at')::timestamptz else opens_at end,
      closes_at = case when f ? 'closes_at' then (f->>'closes_at')::timestamptz else closes_at end,
      max_responses = case when f ? 'max_responses' then (f->>'max_responses')::int else max_responses end,
      one_response_per_email = coalesce((f->>'one_response_per_email')::boolean, one_response_per_email),
      export_sheet_id = case when f ? 'export_sheet_id' then f->>'export_sheet_id' else export_sheet_id end,
      export_sheet_tab = case when f ? 'export_sheet_tab' then f->>'export_sheet_tab' else export_sheet_tab end,
      cover_id = case when f ? 'cover_id' then (f->>'cover_id')::uuid else cover_id end,
      template_id = case when f ? 'template_id' then (f->>'template_id')::uuid else template_id end
    where node_id = p_node;
  end if;
  if p_children ? 'sections' then
    if exists (select 1 from jsonb_to_recordset(p_children->'sections') as x(id uuid)
               join public.form_sections s on s.id = x.id where s.node_id <> p_node) then
      raise exception 'a section id belongs to another form' using errcode = '42501';
    end if;
    with up as (
      insert into public.form_sections (id, project_id, node_id, title_en, title_ar, description_en, description_ar, order_index)
      select coalesce(x.id, gen_random_uuid()), v_project, p_node, x.title_en, x.title_ar, x.description_en, x.description_ar,
             coalesce(x.order_index, 0)
      from jsonb_to_recordset(p_children->'sections') as x(id uuid, title_en text, title_ar text, description_en text,
           description_ar text, order_index int)
      on conflict (id) do update set title_en = excluded.title_en, title_ar = excluded.title_ar,
        description_en = excluded.description_en, description_ar = excluded.description_ar, order_index = excluded.order_index
      returning id)
    select array_agg(id) into keep_s from up;
    -- questions first reference sections; sections not kept are removed after questions are written
  end if;
  if p_children ? 'questions' then
    if exists (select 1 from jsonb_to_recordset(p_children->'questions') as x(id uuid)
               join public.form_questions q on q.id = x.id where q.node_id <> p_node) then
      raise exception 'a question id belongs to another form' using errcode = '42501';
    end if;
    with up as (
      insert into public.form_questions (id, project_id, node_id, section_id, key, type, semantic, label_en, label_ar,
                  description_en, description_ar, placeholder_en, placeholder_ar, is_required, options, validation, order_index)
      select coalesce(x.id, gen_random_uuid()), v_project, p_node, x.section_id, x.key, x.type, x.semantic, x.label_en, x.label_ar,
             x.description_en, x.description_ar, x.placeholder_en, x.placeholder_ar, coalesce(x.is_required, false),
             x.options, x.validation, coalesce(x.order_index, 0)
      from jsonb_to_recordset(p_children->'questions') as x(id uuid, section_id uuid, key text, type text, semantic text,
           label_en text, label_ar text, description_en text, description_ar text, placeholder_en text, placeholder_ar text,
           is_required boolean, options jsonb, validation jsonb, order_index int)
      on conflict (id) do update set section_id = excluded.section_id, key = excluded.key, type = excluded.type,
        semantic = excluded.semantic, label_en = excluded.label_en, label_ar = excluded.label_ar,
        description_en = excluded.description_en, description_ar = excluded.description_ar,
        placeholder_en = excluded.placeholder_en, placeholder_ar = excluded.placeholder_ar,
        is_required = excluded.is_required, options = excluded.options, validation = excluded.validation,
        order_index = excluded.order_index
      returning id)
    select array_agg(id) into keep_q from up;
    delete from public.form_questions where node_id = p_node and id <> all (coalesce(keep_q, '{}'));
  end if;
  if p_children ? 'sections' then
    delete from public.form_sections where node_id = p_node and id <> all (coalesce(keep_s, '{}'));
  end if;
end $$;

-- Landing page: { "cards": [ {id?, sort_order, cover_path, chip_label_*, title_*, body_*, see_more_lines, cta_label_*, cta_url,
--                 cta_node_id, cta_dot, share_enabled, share_url, share_node_id, presets: {"whatsapp": "text {link}", ...}} ],
--                 "frames": [ {id?, name, image_path, aspect, window_x, window_y, window_w, window_h, window_shape, sort_order} ] }
create or replace function app_private.save_children_landing_page(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; c record; v_card uuid; keep_c uuid[] := '{}'; keep_f uuid[]; pr record;
begin
  select project_id into v_project from public.nodes where id = p_node;
  if p_children ? 'cards' then
    if exists (select 1 from jsonb_to_recordset(p_children->'cards') as x(id uuid)
               join public.landing_cards a on a.id = x.id where a.node_id <> p_node) then
      raise exception 'a card id belongs to another node' using errcode = '42501';
    end if;
    for c in select * from jsonb_to_recordset(p_children->'cards') as x(
        id uuid, sort_order int, cover_path text, chip_label_en text, chip_label_ar text, title_en text, title_ar text,
        body_en text, body_ar text, see_more_lines smallint, cta_label_en text, cta_label_ar text, cta_url text,
        cta_node_id uuid, cta_dot boolean, share_enabled boolean, share_url text, share_node_id uuid, presets jsonb)
    loop
      insert into public.landing_cards (id, project_id, node_id, sort_order, cover_path, chip_label_en, chip_label_ar, title_en,
          title_ar, body_en, body_ar, see_more_lines, cta_label_en, cta_label_ar, cta_url, cta_node_id, cta_dot,
          share_enabled, share_url, share_node_id)
      values (coalesce(c.id, gen_random_uuid()), v_project, p_node, coalesce(c.sort_order, 0), c.cover_path, c.chip_label_en,
          c.chip_label_ar, c.title_en, c.title_ar, c.body_en, c.body_ar, c.see_more_lines, c.cta_label_en, c.cta_label_ar,
          c.cta_url, c.cta_node_id, coalesce(c.cta_dot, false), coalesce(c.share_enabled, false), c.share_url, c.share_node_id)
      on conflict (id) do update set sort_order = excluded.sort_order, cover_path = excluded.cover_path,
          chip_label_en = excluded.chip_label_en, chip_label_ar = excluded.chip_label_ar, title_en = excluded.title_en,
          title_ar = excluded.title_ar, body_en = excluded.body_en, body_ar = excluded.body_ar,
          see_more_lines = excluded.see_more_lines, cta_label_en = excluded.cta_label_en, cta_label_ar = excluded.cta_label_ar,
          cta_url = excluded.cta_url, cta_node_id = excluded.cta_node_id, cta_dot = excluded.cta_dot,
          share_enabled = excluded.share_enabled, share_url = excluded.share_url, share_node_id = excluded.share_node_id
      returning id into v_card;
      keep_c := keep_c || v_card;
      if c.presets is not null then
        delete from public.landing_share_presets where card_id = v_card;
        for pr in select key as platform, value #>> '{}' as body from jsonb_each(c.presets) loop
          insert into public.landing_share_presets (card_id, platform, project_id, body) values (v_card, pr.platform, v_project, pr.body);
        end loop;
      end if;
    end loop;
    delete from public.landing_cards where node_id = p_node and id <> all (keep_c);
  end if;
  if p_children ? 'frames' then
    if exists (select 1 from jsonb_to_recordset(p_children->'frames') as x(id uuid)
               join public.landing_frames a on a.id = x.id where a.node_id <> p_node) then
      raise exception 'a frame id belongs to another node' using errcode = '42501';
    end if;
    with up as (
      insert into public.landing_frames (id, project_id, node_id, name, image_path, aspect, window_x, window_y, window_w, window_h,
                  window_shape, sort_order)
      select coalesce(x.id, gen_random_uuid()), v_project, p_node, x.name, x.image_path, coalesce(x.aspect, '4:5'), x.window_x,
             x.window_y, x.window_w, x.window_h, coalesce(x.window_shape, 'rect'), coalesce(x.sort_order, 0)
      from jsonb_to_recordset(p_children->'frames') as x(id uuid, name text, image_path text, aspect text, window_x smallint,
           window_y smallint, window_w smallint, window_h smallint, window_shape text, sort_order int)
      on conflict (id) do update set name = excluded.name, image_path = excluded.image_path, aspect = excluded.aspect,
          window_x = excluded.window_x, window_y = excluded.window_y, window_w = excluded.window_w,
          window_h = excluded.window_h, window_shape = excluded.window_shape, sort_order = excluded.sort_order
      returning id)
    select array_agg(id) into keep_f from up;
    delete from public.landing_frames where node_id = p_node and id <> all (coalesce(keep_f, '{}'));
  end if;
end $$;

commit;
