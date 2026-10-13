-- m30_list.sql  (Lists node, design 01 section 3.3 / 02 section 3 / 04 section 5.3)
-- Adds the few RPCs the Lists node needs that m06c/m06d did not provide. Re-runnable (create or replace). Local DB only.
-- No business data is altered.
--
-- 1. update_manual_item(item, fields)      edit the manual_fields of a manual item (m06c only had add_manual_item)
-- 2. delete_list_item(item)                remove a manual item or a network/company pick row; form-fed overlay rows are
--                                          never deleted here (hide them with exclude_item: the row keeps the overlay)
-- 3. app_private.list_public_payload(...)  ONE whitelisted public payload for a list/selection node: items without
--                                          contact / overlay / fields / status, plus the card config the public card
--                                          renderer needs ({kind, card}); used by get_public_tab AND get_public_list
-- 4. get_public_list(ref, after)           a list rendered on its own public page (/view/:ref/list-tab) through a
--                                          public link of kind 'view' (ensure_public_link(node,'view','list-tab'));
--                                          audience/visibility rules of app_private.resolve_link apply
-- 5. get_public_tab(...) replaced          same body as m06d, the list/selection branch now calls list_public_payload so a
--                                          list tab inside the Agenda host receives its card config (additive: new key
--                                          `config` inside `data`; everything else unchanged)
set search_path = public, extensions;

begin;

-- ================================================================= 1. update_manual_item
create or replace function public.update_manual_item(p_item uuid, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items;
begin
  v := app_private.item_for_write(p_item);
  if v.source_kind is not null then raise exception 'only manual items have editable fields' using errcode = '22023'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'fields must be an object' using errcode = '22023'; end if;
  update public.list_items set manual_fields = jsonb_strip_nulls(p_fields) where id = p_item;
end $$;
revoke all on function public.update_manual_item(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_manual_item(uuid, jsonb) to authenticated;

-- ================================================================= 2. delete_list_item
create or replace function public.delete_list_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items;
begin
  v := app_private.item_for_write(p_item);
  if v.source_kind = 'form_response' then
    raise exception 'a form-fed item cannot be deleted; hide it with exclude_item' using errcode = '22023';
  end if;
  delete from public.list_items where id = p_item;   -- FK RESTRICT (sessions, providers) surfaces as 23503 when referenced
end $$;
revoke all on function public.delete_list_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_list_item(uuid) to authenticated;

-- ================================================================= 3. public payload (no authorisation: callers check)
-- Whitelist: item_id, source{kind,id,state}, display, sort_order, cursor, card (= overlay.card). Dropped: contact, overlay,
-- fields, status, excluded (excluded rows are already omitted by the resolver).
create or replace function app_private.list_public_payload(p_node public.nodes, p_filter jsonb, p_after jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'items', coalesce(jsonb_agg((r - 'contact' - 'overlay' - 'fields' - 'status' - 'excluded')
                                || jsonb_build_object('card', r->'overlay'->'card')), '[]'::jsonb),
    'next', (array_agg(r->'cursor'))[count(*)],
    'config', jsonb_build_object(
       'kind', coalesce((select l.subkind from public.lists l where l.node_id = p_node.id), 'generic'),
       'card', coalesce(p_node.config->'card', '{}'::jsonb)))
  from app_private.resolve_list_rows(p_node.id, coalesce(p_filter, '{}'::jsonb), 100, p_after, false) r
$$;
revoke all on function app_private.list_public_payload(public.nodes, jsonb, jsonb) from public, anon, authenticated;

-- ================================================================= 4. get_public_list
create or replace function public.get_public_list(p_ref text, p_after jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; s public.nodes; v_rev bigint;
begin
  select * into l from app_private.resolve_link('view', p_ref) r limit 1;
  if not found or l.node_id is null then return null; end if;
  select * into s from public.nodes n where n.id = l.node_id and n.type = 'list' and n.deleted_at is null;
  if not found then return null; end if;
  select rev into v_rev from public.node_revisions where node_id = s.id;
  return jsonb_build_object('type', s.type, 'node_id', s.id, 'revision', v_rev, 'viewer', l.audience, 'slug', l.slug,
           'title_en', s.name_en, 'title_ar', s.name_ar,
           'data', app_private.list_public_payload(s, '{}'::jsonb, p_after));
end $$;
revoke all on function public.get_public_list(text, jsonb) from public, anon, authenticated;
grant execute on function public.get_public_list(text, jsonb) to anon, authenticated;

-- ================================================================= 5. get_public_tab (m06d body; list branch -> list_public_payload)
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
    v := jsonb_build_object('days', coalesce((
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
-- grants of m07 (anon + authenticated) are kept by create or replace; restated so a fresh DB gets them too
grant execute on function public.get_public_tab(text, uuid, jsonb) to anon, authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.update_manual_item(uuid,jsonb)') is null or to_regprocedure('public.delete_list_item(uuid)') is null
     or to_regprocedure('public.get_public_list(text,jsonb)') is null or to_regprocedure('app_private.list_public_payload(public.nodes,jsonb,jsonb)') is null then
    raise exception 'm30: a function is missing';
  end if;
  if has_function_privilege('anon', 'public.update_manual_item(uuid,jsonb)', 'EXECUTE') or has_function_privilege('anon', 'public.delete_list_item(uuid)', 'EXECUTE') then
    raise exception 'm30: anon must not execute the write RPCs';
  end if;
  raise notice 'm30 ok';
end $$;

commit;
