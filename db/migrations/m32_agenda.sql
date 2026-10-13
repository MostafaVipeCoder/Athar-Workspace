-- m32_agenda.sql  (Dynamic Agenda node + the project view page, design 01 section 3.1 / 02 section 4 / 04 sections 3.11 + 5.5)
-- Adds the few pieces the Agenda node and the public view page need beyond m04/m06b/m06d/m30. Re-runnable
-- (create or replace). Local DB only. No business data is altered by applying this file.
--
-- 1. app_private.agenda_public_config(cfg)  the WHITELISTED public part of an agenda node's config: showDayNames, header
--                                           (visible/type/color/height/title/titleColor/dim/brandName), theme.accent,
--                                           footerPath. `legacySheetUrl` and anything unknown never reach a visitor.
-- 2. get_public_tab(...) replaced            same body as m30; the agenda branch now carries `data.config` (the whitelist
--                                           above) and `data.timezone` (the project zone the wall-clock times belong to),
--                                           so the host page can render the header/day names without a second query.
--                                           Additive: every other branch is unchanged.
-- 3. list_founder_agendas(project)           founder exposure (docs/13 section 4 and 11, 01 section 3.1): the agenda nodes
--                                           of a project a participant may open ("Program Agenda" button per enabled
--                                           node): show_to_participants = true AND visibility platform/public, with the
--                                           public ref to open (the node's own `agenda` link, else the project page link
--                                           when the node is a tab of the implicit host). Callable by participants of the
--                                           project and its PMs only; anon never.
set search_path = public, extensions;

begin;

-- ================================================================= 1. public config whitelist (no authorisation: callers check)
create or replace function app_private.agenda_public_config(p_config jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'showDayNames', case when jsonb_typeof(p_config->'showDayNames') = 'boolean' then p_config->'showDayNames' end,
    'header', case when jsonb_typeof(p_config->'header') = 'object' then
      jsonb_strip_nulls(jsonb_build_object(
        'visible',    case when jsonb_typeof(p_config->'header'->'visible') = 'boolean' then p_config->'header'->'visible' end,
        'type',       case when jsonb_typeof(p_config->'header'->'type') = 'string' then p_config->'header'->'type' end,
        'color',      case when jsonb_typeof(p_config->'header'->'color') = 'string' then p_config->'header'->'color' end,
        'height',     case when jsonb_typeof(p_config->'header'->'height') = 'string' then p_config->'header'->'height' end,
        'title',      case when jsonb_typeof(p_config->'header'->'title') = 'object' then p_config->'header'->'title' end,
        'titleColor', case when jsonb_typeof(p_config->'header'->'titleColor') = 'string' then p_config->'header'->'titleColor' end,
        'dim',        case when jsonb_typeof(p_config->'header'->'dim') = 'number' then p_config->'header'->'dim' end,
        'brandName',  case when jsonb_typeof(p_config->'header'->'brandName') = 'string' then p_config->'header'->'brandName' end)) end,
    'theme', case when jsonb_typeof(p_config->'theme') = 'object' then
      jsonb_strip_nulls(jsonb_build_object('accent', case when jsonb_typeof(p_config->'theme'->'accent') = 'string' then p_config->'theme'->'accent' end)) end,
    'footerPath', case when jsonb_typeof(p_config->'footerPath') = 'string' then p_config->'footerPath' end))
$$;
revoke all on function app_private.agenda_public_config(jsonb) from public, anon, authenticated;

-- ================================================================= 2. get_public_tab (m30 body; agenda branch + config/timezone)
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
    v := jsonb_build_object('sessions', coalesce((
      select jsonb_agg(jsonb_build_object('day_index', x.day_index, 'slot_index', x.slot_index, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
               'mentor_en', ne.name_en, 'mentor_ar', ne.name_ar, 'company_en', coalesce(co.name_en, c_fr.answers->>'company_name'),
               'company_ar', coalesce(co.name_ar, c_fr.answers->>'company_name')) order by x.day_index, x.slot_index, ne.name_en)
      from public.v_distribution_sessions x
      join public.list_items mi on mi.id = x.mentor_item_id
      left join public.network_experts ne on ne.id = mi.network_expert_id
      left join public.list_items ci on ci.id = x.company_item_id
      left join public.companies co on co.id = ci.company_id
      left join public.form_responses c_fr on c_fr.id = ci.form_response_id
      where x.node_id = s.id), '[]'::jsonb));
  else
    v := jsonb_build_object('note', 'no public data for this node type');
  end if;
  return jsonb_build_object('type', s.type, 'node_id', s.id, 'revision', v_rev, 'data', v);
end $$;
grant execute on function public.get_public_tab(text, uuid, jsonb) to anon, authenticated;

-- ================================================================= 3. founder exposure: the agendas a participant may open
-- Returns [{ node_id, name_en, name_ar, ref, via }] ordered by creation. `ref` = the current slug of the node's own public
-- link (kind 'agenda', via 'node'), else the project page link when the agenda is an enabled tab of the implicit host
-- (via 'host'), else null (the PM has not created a link yet). Only nodes the PM exposed (show_to_participants) and whose
-- visibility is platform/public are listed; private nodes stay invisible even to participants (00 section 6).
create or replace function public.list_founder_agendas(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_host uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (app_private.is_project_manager(p_project) or app_private.is_participant(p_project)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select n.id into v_host from public.nodes n where n.project_id = p_project and n.type = 'view_host' and n.deleted_at is null order by n.created_at limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'node_id', a.id, 'name_en', a.name_en, 'name_ar', a.name_ar,
             'ref', coalesce(own.slug, host.slug),
             'via', case when own.slug is not null then 'node' when host.slug is not null then 'host' end)
           order by a.created_at, a.id)
    from public.nodes a
    left join lateral (
      select s.slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current
       where l.node_id = a.id and l.kind = 'agenda' and l.is_enabled and (l.expires_at is null or l.expires_at > now())
       limit 1) own on true
    left join lateral (
      select s.slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current
       where l.project_id = p_project and l.is_enabled and (l.expires_at is null or l.expires_at > now())
         and ((l.node_id = v_host and l.kind = 'agenda') or (l.node_id is null and l.kind = 'project'))
         and exists (select 1 from public.edges e where e.from_node_id = a.id and e.from_port = 'agenda' and e.to_node_id = v_host and e.to_port = 'tabs' and e.is_enabled)
       order by (l.node_id is not null) desc limit 1) host on true
    where a.project_id = p_project and a.type = 'agenda' and a.deleted_at is null
      and a.show_to_participants and a.visibility in ('platform','public')), '[]'::jsonb);
end $$;
revoke all on function public.list_founder_agendas(uuid) from public, anon, authenticated;
grant execute on function public.list_founder_agendas(uuid) to authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('app_private.agenda_public_config(jsonb)') is null or to_regprocedure('public.list_founder_agendas(uuid)') is null
     or to_regprocedure('public.get_public_tab(text,uuid,jsonb)') is null then
    raise exception 'm32: a function is missing';
  end if;
  if has_function_privilege('anon', 'public.list_founder_agendas(uuid)', 'EXECUTE') or has_function_privilege('anon', 'app_private.agenda_public_config(jsonb)', 'EXECUTE') then
    raise exception 'm32: anon must not execute the founder/helper functions';
  end if;
  if not has_function_privilege('anon', 'public.get_public_tab(text,uuid,jsonb)', 'EXECUTE') then
    raise exception 'm32: anon must execute get_public_tab';
  end if;
  if (app_private.agenda_public_config('{"legacySheetUrl":"x","showDayNames":false,"header":{"brandName":"B","fontFamily":"f"}}'::jsonb)) <> '{"header":{"brandName":"B"},"showDayNames":false}'::jsonb then
    raise exception 'm32: agenda_public_config whitelist is wrong';
  end if;
end $$;

commit;
