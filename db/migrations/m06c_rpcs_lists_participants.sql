-- m06c_rpcs_lists_participants  (04 5.3 lists/items/entities, 5.4 participants and completion)
-- Reference + overlay model (02): list membership is virtual; rows in list_items exist only after ensure_item.
set search_path = public, extensions;

begin;

-- ================================================================= selection config helpers
create or replace function app_private.selection_stage_keys(p_config jsonb) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array(select s->>'key' from jsonb_array_elements(
           case when jsonb_typeof(p_config->'stages') = 'array' then p_config->'stages' else '[]'::jsonb end) s
           where s->>'key' is not null), '{}')
$$;

-- statuses that "pass" the selection (terminal accepted stage); default approved/accepted [Decided-by-delegation 01-16: displayed -> accepted]
create or replace function app_private.selection_passing(p_config jsonb) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(p_config->'passing') = 'array'
              then array(select jsonb_array_elements_text(p_config->'passing'))
              else array['approved','accepted'] end
$$;

-- ================================================================= the resolver core (no authorisation: callers check)
-- Row shape: {item_id, source{kind,id,state}, display, contact, fields?, overlay, status, sort_order, excluded, cursor{s,k}}
create or replace function app_private.resolve_list_rows(
  p_list uuid, p_filter jsonb default '{}'::jsonb, p_limit int default 100, p_after jsonb default null,
  p_with_fields boolean default false)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  with params as (
    select least(greatest(coalesce(p_limit, 100), 1), 200) as lim,
           coalesce((p_filter->>'include_excluded')::boolean, false) as inc_excl,
           case when p_filter ? 'status' then
                  case jsonb_typeof(p_filter->'status')
                    when 'array' then array(select jsonb_array_elements_text(p_filter->'status'))
                    else array[p_filter->>'status'] end
           end as statuses
  ),
  feed as (
    select 'form_response'::text as kind, fr.id as sid, e.order_index as ord
      from public.edges e
      join public.form_responses fr on fr.node_id = e.from_node_id and fr.deleted_at is null
     where e.to_node_id = p_list and e.is_enabled and e.family = 'rows:form-response'
    union all
    select u.source_kind, coalesce(u.form_response_id, u.network_expert_id, u.company_id), e.order_index
      from public.edges e
      join public.list_items u on u.list_node_id = e.from_node_id and u.source_kind is not null and not u.excluded
     where e.to_node_id = p_list and e.is_enabled and e.family = 'rows:list-item'
       and coalesce(u.form_response_id, u.network_expert_id, u.company_id) is not null
       and (not (e.filter ? 'status_in') or u.status in (select jsonb_array_elements_text(e.filter->'status_in')))
       and (e.from_port not in ('approved','rejected','holding','interview') or u.status = e.from_port)
    union all
    select li.source_kind, coalesce(li.network_expert_id, li.company_id), 0
      from public.list_items li
     where li.list_node_id = p_list and li.source_kind in ('network_expert','company')
       and coalesce(li.network_expert_id, li.company_id) is not null
  ),
  src as (select distinct on (kind, sid) kind, sid, ord from feed order by kind, sid, ord),
  joined as (
    select s.kind, s.sid, li.id as item_id, li.status, li.sort_order, li.excluded, li.overlay, li.manual_fields, li.source_label,
           fr.answers as answers, ne as ne_row, co as co_row,
           case when s.kind = 'network_expert' and ne.deleted_at is not null then 'missing'
                when s.kind = 'company' and co.deleted_at is not null then 'missing'
                else 'ok' end as state
    from src s
    left join public.list_items li on li.list_node_id = p_list and (
         (s.kind = 'form_response'  and li.form_response_id  = s.sid)
      or (s.kind = 'network_expert' and li.network_expert_id = s.sid)
      or (s.kind = 'company'        and li.company_id        = s.sid))
    left join public.form_responses  fr on s.kind = 'form_response'  and fr.id = s.sid
    left join public.network_experts ne on s.kind = 'network_expert' and ne.id = s.sid
    left join public.companies       co on s.kind = 'company'        and co.id = s.sid
    union all
    -- manual items
    select 'manual', null::uuid, li.id, li.status, li.sort_order, li.excluded, li.overlay, li.manual_fields, null,
           null::jsonb, null, null, 'ok'
    from public.list_items li where li.list_node_id = p_list and li.source_kind is null
    union all
    -- tombstones: the source row was hard-deleted (FK set null); cached label only
    select li.source_kind, null::uuid, li.id, li.status, li.sort_order, li.excluded, li.overlay, null, li.source_label,
           null::jsonb, null, null, 'missing'
    from public.list_items li
    where li.list_node_id = p_list and li.source_kind is not null
      and li.form_response_id is null and li.network_expert_id is null and li.company_id is null
  ),
  final as (
    select j.*, coalesce(j.sort_order, 2147483647) as sk, coalesce(j.item_id, j.sid) as k
    from joined j, params
    where (params.inc_excl or not coalesce(j.excluded, false))
      and (params.statuses is null or j.status = any (params.statuses))
  )
  select jsonb_build_object(
      'item_id', f.item_id,
      'source', jsonb_build_object('kind', f.kind, 'id', f.sid, 'state', f.state),
      'display',
        (case f.kind
           when 'form_response' then jsonb_build_object(
               'title_en', f.answers->>'company_name', 'title_ar', f.answers->>'company_name',
               'subtitle_en', f.answers->>'founder_name', 'subtitle_ar', f.answers->>'founder_name',
               'image_path', f.answers->>'logo', 'bio_en', f.answers->>'bio', 'bio_ar', f.answers->>'bio')
           when 'network_expert' then jsonb_build_object(
               'title_en', (f.ne_row).name_en, 'title_ar', (f.ne_row).name_ar,
               'subtitle_en', (f.ne_row).title_en, 'subtitle_ar', (f.ne_row).title_ar,
               'organization_en', (f.ne_row).company_en, 'organization_ar', (f.ne_row).company_ar,
               'image_path', (f.ne_row).photo_path, 'bio_en', (f.ne_row).bio_en, 'bio_ar', (f.ne_row).bio_ar,
               'linkedin_url', (f.ne_row).linkedin_url)
           when 'company' then jsonb_build_object(
               'title_en', (f.co_row).name_en, 'title_ar', (f.co_row).name_ar,
               'subtitle_en', (f.co_row).industry_en, 'subtitle_ar', (f.co_row).industry_ar,
               'image_path', (f.co_row).logo_path, 'bio_en', (f.co_row).description_en, 'bio_ar', (f.co_row).description_ar,
               'website_url', (f.co_row).website_url, 'linkedin_url', (f.co_row).linkedin_url)
           when 'manual' then coalesce(f.manual_fields, '{}'::jsonb)
           else jsonb_build_object('title_en', f.source_label, 'title_ar', f.source_label)
         end) || coalesce(f.overlay->'display_override', '{}'::jsonb),
      'contact', case f.kind
           when 'form_response' then jsonb_build_object('email', f.answers->>'founder_email', 'phone', f.answers->>'phone')
           when 'network_expert' then jsonb_build_object('email', (f.ne_row).email)
           when 'manual' then jsonb_build_object('email', f.manual_fields->>'email')
           else '{}'::jsonb end,
      'fields', case when p_with_fields then f.answers end,
      'overlay', coalesce(f.overlay, '{}'::jsonb),
      'status', f.status, 'sort_order', f.sort_order, 'excluded', coalesce(f.excluded, false),
      'cursor', jsonb_build_object('s', f.sk, 'k', f.k))
  from final f, params
  where p_after is null or (f.sk, f.k) > ((p_after->>'s')::int, (p_after->>'k')::uuid)
  order by f.sk, f.k
  limit (select lim from params)
$$;

create or replace function public.resolve_list(
  p_list uuid, p_filter jsonb default '{}'::jsonb, p_limit int default 100, p_after jsonb default null)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.nodes n where n.id = p_list and n.type in ('list','selection') and n.deleted_at is null
                 and app_private.is_project_manager(n.project_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from app_private.resolve_list_rows(p_list, p_filter, p_limit, p_after, coalesce((p_filter->>'with_fields')::boolean, false));
end $$;

-- ================================================================= ensure_item and the row-level writers
create or replace function app_private.ensure_item_internal(p_list uuid, p_kind text, p_source uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_node public.nodes; v_sub text; v_id uuid;
begin
  select * into v_node from public.nodes where id = p_list and type in ('list','selection') and deleted_at is null;
  if not found then raise exception 'list not found' using errcode = 'P0002'; end if;

  if p_kind = 'form_response' then
    if not exists (select 1 from public.form_responses fr where fr.id = p_source and fr.deleted_at is null and fr.project_id = v_node.project_id)
       and not exists (select 1 from public.form_responses fr where fr.id = p_source and fr.project_id = v_node.project_id) then
      raise exception 'form response not found in this project' using errcode = 'P0002';
    end if;
    -- reachable: a connected form feeds the list, or a connected upstream list/selection carries the same response
    if not exists (
         select 1 from public.edges e join public.form_responses fr on fr.id = p_source
          where e.to_node_id = p_list and e.is_enabled and (
                (e.family = 'rows:form-response' and e.from_node_id = fr.node_id)
             or (e.family = 'rows:list-item' and exists (
                   select 1 from public.list_items u where u.list_node_id = e.from_node_id and u.form_response_id = p_source)))) then
      raise exception 'the response is not reachable from this list through a connection' using errcode = '23514';
    end if;
    insert into public.list_items (project_id, list_node_id, source_kind, form_response_id, created_by)
    values (v_node.project_id, p_list, 'form_response', p_source, p_actor)
    on conflict (list_node_id, form_response_id) where form_response_id is not null
      do update set updated_at = public.list_items.updated_at
    returning id into v_id;
  elsif p_kind = 'network_expert' then
    select subkind into v_sub from public.lists where node_id = p_list;
    if v_sub is not null and v_sub <> 'expert' and v_sub <> 'generic' then raise exception 'this list does not hold experts' using errcode = '23514'; end if;
    if not exists (select 1 from public.network_experts x where x.id = p_source) then raise exception 'expert not found' using errcode = 'P0002'; end if;
    insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id, created_by)
    values (v_node.project_id, p_list, 'network_expert', p_source, p_actor)
    on conflict (list_node_id, network_expert_id) where network_expert_id is not null
      do update set updated_at = public.list_items.updated_at
    returning id into v_id;
  elsif p_kind = 'company' then
    select subkind into v_sub from public.lists where node_id = p_list;
    if v_sub is not null and v_sub <> 'company' and v_sub <> 'generic' then raise exception 'this list does not hold companies' using errcode = '23514'; end if;
    if not exists (select 1 from public.companies x where x.id = p_source) then raise exception 'company not found' using errcode = 'P0002'; end if;
    insert into public.list_items (project_id, list_node_id, source_kind, company_id, created_by)
    values (v_node.project_id, p_list, 'company', p_source, p_actor)
    on conflict (list_node_id, company_id) where company_id is not null
      do update set updated_at = public.list_items.updated_at
    returning id into v_id;
  else
    raise exception 'unknown source kind %', p_kind using errcode = '22023';
  end if;
  return v_id;
end $$;

create or replace function public.ensure_item(p_list uuid, p_kind text, p_source uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.nodes n where n.id = p_list and app_private.is_project_manager(n.project_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return app_private.ensure_item_internal(p_list, p_kind, p_source, (select auth.uid()));
end $$;

create or replace function public.ensure_items(p_list uuid, p_sources jsonb) returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if not exists (select 1 from public.nodes n where n.id = p_list and app_private.is_project_manager(n.project_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for s in select * from jsonb_to_recordset(p_sources) as x(kind text, id uuid) loop
    return next app_private.ensure_item_internal(p_list, s.kind, s.id, (select auth.uid()));
  end loop;
end $$;

-- common guard: the item's project must be managed by the caller
create or replace function app_private.item_for_write(p_item uuid) returns public.list_items
language plpgsql security definer set search_path = '' as $$
declare v public.list_items;
begin
  select * into v from public.list_items where id = p_item for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.patch_item_overlay(p_item uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items;
begin
  v := app_private.item_for_write(p_item);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'patch must be an object' using errcode = '22023'; end if;
  update public.list_items set overlay = jsonb_strip_nulls(overlay || p_patch) where id = p_item;   -- null value removes the key
end $$;

create or replace function public.set_item_status(p_item uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items; n public.nodes; stages text[]; passing text[];
begin
  v := app_private.item_for_write(p_item);
  select * into n from public.nodes where id = v.list_node_id;
  stages := app_private.selection_stage_keys(n.config);
  if n.type = 'selection' and cardinality(stages) > 0 and p_status is not null and not (p_status = any (stages)) then
    raise exception 'status % is not a configured stage of this selection', p_status using errcode = '22023';
  end if;
  update public.list_items set status = p_status where id = p_item;
  if n.type = 'selection' then
    insert into public.selection_reviews (item_id, project_id, reason, origin_stage, reviewed_at, reviewed_by)
    values (p_item, v.project_id, p_reason, case when p_status = 'holding' then v.status end, now(), (select auth.uid()))
    on conflict (item_id) do update set
      reason = coalesce(excluded.reason, public.selection_reviews.reason),
      origin_stage = case when p_status = 'holding' then v.status else public.selection_reviews.origin_stage end,
      reviewed_at = now(), reviewed_by = (select auth.uid());
    -- reverting a decision after enrolment flags the participant, never deletes it [Decided-by-delegation 02-7]
    passing := app_private.selection_passing(n.config);
    if v.status = any (passing) and not (coalesce(p_status, '') = any (passing)) then
      update public.participants set needs_review = true
      where project_id = v.project_id and source_node_id = v.list_node_id
        and ((v.company_id is not null and company_id = v.company_id)
          or (v.form_response_id is not null and form_response_id = v.form_response_id));
    end if;
  end if;
end $$;

create or replace function public.reorder_items(p_list uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.nodes n where n.id = p_list and app_private.is_project_manager(n.project_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_ids) u(id) where not exists (select 1 from public.list_items li where li.id = u.id and li.list_node_id = p_list)) then
    raise exception 'every id must be an existing item of this list (call ensure_item first)' using errcode = '22023';
  end if;
  update public.list_items li set sort_order = o.ord
  from unnest(p_ids) with ordinality as o(id, ord)
  where li.id = o.id and li.list_node_id = p_list;
end $$;

create or replace function public.exclude_item(p_item uuid, p_excluded boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items;
begin
  v := app_private.item_for_write(p_item);
  update public.list_items set excluded = coalesce(p_excluded, true) where id = p_item;
end $$;

create or replace function public.add_manual_item(p_list uuid, p_fields jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_node public.nodes; v_id uuid;
begin
  select * into v_node from public.nodes where id = p_list and type in ('list','selection') and deleted_at is null;
  if not found or not app_private.is_project_manager(v_node.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'fields must be an object' using errcode = '22023'; end if;
  insert into public.list_items (project_id, list_node_id, manual_fields, created_by)
  values (v_node.project_id, p_list, p_fields, (select auth.uid())) returning id into v_id;
  return v_id;
end $$;

create or replace function public.add_network_pick(p_list uuid, p_expert uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.nodes n where n.id = p_list and app_private.is_project_manager(n.project_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return app_private.ensure_item_internal(p_list, 'network_expert', p_expert, (select auth.uid()));
end $$;

create or replace function public.add_company_pick(p_list uuid, p_company uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.nodes n where n.id = p_list and app_private.is_project_manager(n.project_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return app_private.ensure_item_internal(p_list, 'company', p_company, (select auth.uid()));
end $$;

-- one-time, user-initiated copy of the current display fields into manual fields (04 1.3)
create or replace function public.detach_item_to_manual(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items; m jsonb;
begin
  v := app_private.item_for_write(p_item);
  if v.source_kind is null then return; end if;
  if v.source_kind = 'network_expert' then
    select jsonb_strip_nulls(jsonb_build_object('title_en', x.name_en, 'title_ar', x.name_ar, 'subtitle_en', x.title_en,
           'subtitle_ar', x.title_ar, 'image_path', x.photo_path, 'email', x.email::text)) into m
      from public.network_experts x where x.id = v.network_expert_id;
  elsif v.source_kind = 'company' then
    select jsonb_strip_nulls(jsonb_build_object('title_en', x.name_en, 'title_ar', x.name_ar, 'subtitle_en', x.industry_en,
           'subtitle_ar', x.industry_ar, 'image_path', x.logo_path)) into m
      from public.companies x where x.id = v.company_id;
  else
    select jsonb_strip_nulls(jsonb_build_object('title_en', x.answers->>'company_name', 'title_ar', x.answers->>'company_name',
           'subtitle_en', x.answers->>'founder_name', 'email', x.answers->>'founder_email')) into m
      from public.form_responses x where x.id = v.form_response_id;
  end if;
  m := coalesce(m, jsonb_build_object('title_en', v.source_label, 'title_ar', v.source_label));
  update public.list_items set source_kind = null, form_response_id = null, network_expert_id = null, company_id = null,
         manual_fields = m where id = p_item;
end $$;

-- ================================================================= merge_companies (05-d / 08 section 10)
-- Keeps p_keep, repoints every reference of p_drop (list items, participants, bookings, founders, snapshots, ...), collapses
-- same-list duplicates into one item, soft-deletes p_drop (the loader archives the row).  Returns counters.
create or replace function public.merge_companies(p_keep uuid, p_drop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record; k uuid; moved int := 0; collapsed int := 0; v_parts int := 0;
begin
  if not (app_private.is_super_admin() or app_private.has_role('alumni_manager')) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_keep = p_drop then raise exception 'keep and drop must differ' using errcode = '22023'; end if;
  if not exists (select 1 from public.companies where id = p_keep and deleted_at is null) then raise exception 'keep company not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.companies where id = p_drop) then raise exception 'drop company not found' using errcode = 'P0002'; end if;

  -- list items: per list, either move the item or collapse it into the kept company's item
  for r in select li.id, li.list_node_id, li.overlay, li.status from public.list_items li where li.company_id = p_drop loop
    select li2.id into k from public.list_items li2 where li2.list_node_id = r.list_node_id and li2.company_id = p_keep;
    if k is null then
      update public.list_items set company_id = p_keep where id = r.id; moved := moved + 1;
    else
      -- keep wins on conflicting overlay keys / status; everything that pointed at the dropped item now points at the kept one
      update public.list_items set overlay = r.overlay || overlay, status = coalesce(status, r.status) where id = k;
      update public.agenda_slots set presenter_item_id = k where presenter_item_id = r.id;
      update public.distribution_sessions set company_item_id = k where company_item_id = r.id;
      update public.bookings set booker_item_id = k where booker_item_id = r.id;
      update app_private.email_outbox set list_item_id = k where list_item_id = r.id;
      delete from public.booking_invitations i where i.booker_item_id = r.id
        and exists (select 1 from public.booking_invitations j where j.node_id = i.node_id and j.booker_item_id = k and j.revoked_at is null);
      update public.booking_invitations set booker_item_id = k where booker_item_id = r.id;
      delete from public.selection_reviews where item_id = r.id and exists (select 1 from public.selection_reviews s2 where s2.item_id = k);
      update public.selection_reviews set item_id = k where item_id = r.id;
      delete from public.list_items where id = r.id;
      collapsed := collapsed + 1;
    end if;
  end loop;

  -- participants: unique per (project, company)
  for r in select pa.id, pa.project_id from public.participants pa where pa.company_id = p_drop loop
    if exists (select 1 from public.participants k2 where k2.project_id = r.project_id and k2.company_id = p_keep) then
      if exists (select 1 from public.certificates c where c.participant_id = r.id) then
        raise exception 'manual review needed: the dropped company has a certificate in project %', r.project_id using errcode = '23514';
      end if;
      delete from public.participants where id = r.id;
    else
      update public.participants set company_id = p_keep where id = r.id; v_parts := v_parts + 1;
    end if;
  end loop;

  update public.bookings set booker_company_id = p_keep where booker_company_id = p_drop;
  insert into public.company_founders (company_id, founder_id, role, is_primary)
    select p_keep, founder_id, role, is_primary from public.company_founders where company_id = p_drop
    on conflict do nothing;
  delete from public.company_founders where company_id = p_drop;
  update public.company_snapshots set company_id = p_keep where company_id = p_drop;
  update public.alumni_invitations set company_id = p_keep where company_id = p_drop;
  update public.investor_requests set company_id = p_keep where company_id = p_drop;
  delete from public.opportunity_applications a where a.company_id = p_drop
    and exists (select 1 from public.opportunity_applications b where b.company_id = p_keep and b.opportunity_id = a.opportunity_id);
  update public.opportunity_applications set company_id = p_keep where company_id = p_drop;
  update public.companies set deleted_at = now() where id = p_drop;
  return jsonb_build_object('items_moved', moved, 'items_collapsed', collapsed, 'participants_moved', v_parts);
end $$;

-- ================================================================= Athar Network usage (definer: counts across all programs, ids only)
create or replace function public.network_expert_usage(p_expert uuid)
returns table (project_id uuid, program_id uuid, list_node_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_any_role(array['project_manager','alumni_manager','super_admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select distinct j.id, j.program_id, li.list_node_id
    from public.list_items li
    join public.nodes n on n.id = li.list_node_id and n.deleted_at is null
    join public.projects j on j.id = n.project_id and j.deleted_at is null
    where li.network_expert_id = p_expert;
end $$;

-- ================================================================= 5.4 participants and completion
create or replace function app_private.participants_display(p public.participants) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name_en', coalesce(c.name_en, fr.answers->>'company_name', pr.full_name),
    'name_ar', coalesce(c.name_ar, fr.answers->>'company_name', pr.full_name),
    'logo_path', c.logo_path)
  from (select 1) one
  left join public.companies c on c.id = p.company_id
  left join public.form_responses fr on fr.id = p.form_response_id
  left join public.profiles pr on pr.id = p.user_id
$$;

create or replace function public.list_participants(p_project uuid, p_status text default null) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.is_project_manager(p_project) or app_private.has_role('alumni_manager')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select jsonb_build_object('participant_id', pa.id, 'virtual', false, 'source', pa.source, 'status', pa.status,
         'company_id', pa.company_id, 'user_id', pa.user_id, 'form_response_id', pa.form_response_id,
         'needs_review', pa.needs_review, 'withdrawal_requested_at', pa.withdrawal_requested_at,
         'display', app_private.participants_display(pa))
  from public.participants pa
  where pa.project_id = p_project and (p_status is null or pa.status = p_status)
  union all
  select jsonb_build_object('participant_id', null, 'virtual', true, 'source', 'selection', 'status', 'accepted',
         'company_id', li.company_id, 'user_id', null, 'form_response_id', li.form_response_id,
         'needs_review', false, 'withdrawal_requested_at', null,
         'display', jsonb_build_object('name_en', coalesce(c.name_en, fr.answers->>'company_name'),
                                       'name_ar', coalesce(c.name_ar, fr.answers->>'company_name'), 'logo_path', c.logo_path))
  from public.nodes n
  join public.list_items li on li.list_node_id = n.id and not li.excluded
  left join public.companies c on c.id = li.company_id
  left join public.form_responses fr on fr.id = li.form_response_id
  where n.project_id = p_project and n.type = 'selection' and n.deleted_at is null
    and li.status = any (app_private.selection_passing(n.config))
    and (li.company_id is not null or li.form_response_id is not null)
    and (p_status is null or p_status = 'accepted')
    and not exists (select 1 from public.participants x where x.project_id = p_project
                    and ((li.company_id is not null and x.company_id = li.company_id)
                      or (li.form_response_id is not null and x.form_response_id = li.form_response_id)));
end $$;

create or replace function public.enroll_accepted(p_project uuid, p_selection_node uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; k int;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into n from public.nodes where id = p_selection_node and project_id = p_project and type = 'selection' and deleted_at is null;
  if not found then raise exception 'selection node not found' using errcode = 'P0002'; end if;
  with ins as (
    insert into public.participants (project_id, company_id, form_response_id, source, source_node_id, status, created_by)
    select p_project, li.company_id, case when li.company_id is null then li.form_response_id end,
           'selection', p_selection_node, 'accepted', (select auth.uid())
    from public.list_items li
    where li.list_node_id = p_selection_node and not li.excluded
      and li.status = any (app_private.selection_passing(n.config))
      and (li.company_id is not null or li.form_response_id is not null)
    on conflict do nothing
    returning 1)
  select count(*) into k from ins;
  return k;
end $$;

create or replace function public.assign_participant(p_project uuid, p_company uuid default null, p_user uuid default null)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare v public.participants;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_company is null and p_user is null then raise exception 'a company or a user is required' using errcode = '22023'; end if;
  insert into public.participants (project_id, company_id, user_id, source, status, created_by)
  values (p_project, p_company, p_user, 'manual', 'accepted', (select auth.uid()))
  returning * into v;
  return v;
end $$;

create or replace function public.set_participant_status(p_participant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.participants;
begin
  select * into v from public.participants where id = p_participant for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('accepted','attended','withdrawn') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.participants set status = p_status where id = p_participant;
end $$;

create or replace function public.mark_all_attended(p_project uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare k int;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.participants set status = 'attended' where project_id = p_project and status = 'accepted';
  get diagnostics k = row_count;
  return k;
end $$;

create or replace function public.request_withdrawal(p_participant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.participants;
begin
  select * into v from public.participants where id = p_participant for update;
  if not found or not (v.user_id = (select auth.uid()) or v.company_id in (select app_private.my_company_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.participants set withdrawal_requested_at = coalesce(withdrawal_requested_at, now()) where id = p_participant;
end $$;

create or replace function public.complete_project(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.projects set completed_at = coalesce(completed_at, now()), completed_by = coalesce(completed_by, (select auth.uid()))
  where id = p_project and deleted_at is null;
end $$;

create or replace function public.reopen_project(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.projects set completed_at = null, completed_by = null where id = p_project;
end $$;

create or replace function public.complete_all_projects(p_program uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare k int;
begin
  if not app_private.is_program_member(p_program) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.projects set completed_at = now(), completed_by = (select auth.uid())
  where program_id = p_program and deleted_at is null and completed_at is null;
  get diagnostics k = row_count;
  return k;
end $$;

-- founder Programs list: participant rows of the caller (own user or own companies); withdrawn rows return status only
create or replace function public.get_my_programs() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select case when pa.status = 'withdrawn'
           then jsonb_build_object('participant_id', pa.id, 'project_id', pa.project_id, 'status', pa.status)
           else jsonb_build_object('participant_id', pa.id, 'project_id', pa.project_id, 'program_id', j.program_id,
                  'status', pa.status, 'project_name_en', j.name_en, 'project_name_ar', j.name_ar, 'cover_path', coalesce(j.cover_path, g.cover_path),
                  'program_name_en', g.name_en, 'program_name_ar', g.name_ar, 'completed', j.completed_at is not null,
                  'withdrawal_requested', pa.withdrawal_requested_at is not null) end
  from public.participants pa
  join public.projects j on j.id = pa.project_id and j.deleted_at is null
  join public.programs g on g.id = j.program_id and g.deleted_at is null
  where (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids()))
$$;

create or replace function public.get_founder_program_page(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j public.projects; g public.programs; v_attended boolean; v_blocks jsonb;
begin
  if not app_private.is_participant(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.projects where id = p_project and deleted_at is null;
  select * into g from public.programs where id = j.program_id;
  select exists (select 1 from public.participants pa where pa.project_id = p_project and pa.status = 'attended'
                 and (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids()))) into v_attended;
  select coalesce(jsonb_agg(jsonb_build_object('node_id', n.id, 'type', n.type, 'name_en', n.name_en, 'name_ar', n.name_ar)
                            order by n.created_at, n.id), '[]'::jsonb)
    into v_blocks
    from public.nodes n
   where n.project_id = p_project and n.deleted_at is null and n.show_to_participants
     and n.visibility in ('platform','public')
     and (n.type <> 'certificates' or (v_attended and j.completed_at is not null));
  return jsonb_build_object(
    'project', jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar, 'cover_path', coalesce(j.cover_path, g.cover_path),
        'completed', j.completed_at is not null,
        'description_en', case when j.show_description then coalesce(j.description_en, g.description_en) end,
        'description_ar', case when j.show_description then coalesce(j.description_ar, g.description_ar) end,
        'details', case when j.show_details then jsonb_build_object('location_en', j.location_en, 'location_ar', j.location_ar,
                  'map_url', j.map_url, 'offline_days', j.offline_days, 'transportation', j.transportation) end),
    'blocks', v_blocks);
end $$;

-- ================================================================= views used by the participant/public RPCs
create or replace view public.v_distribution_sessions with (security_invoker = true) as
select s.id, s.project_id, s.node_id, s.day_id, s.slot_index, s.mentor_item_id, s.company_item_id, s.is_manual_override,
       d.day_index,
       coalesce(d.day_date, ad.day_date) as day_date,
       (((coalesce(d.day_date, ad.day_date) + coalesce(d.start_time, ds.start_time))
         + make_interval(mins => s.slot_index * (coalesce(d.slot_duration_min, ds.slot_duration_min) + coalesce(d.gap_min, ds.gap_min))))
         at time zone j.timezone) as starts_at,
       (((coalesce(d.day_date, ad.day_date) + coalesce(d.start_time, ds.start_time))
         + make_interval(mins => s.slot_index * (coalesce(d.slot_duration_min, ds.slot_duration_min) + coalesce(d.gap_min, ds.gap_min))
                              + coalesce(d.slot_duration_min, ds.slot_duration_min)))
         at time zone j.timezone) as ends_at
from public.distribution_sessions s
join public.distribution_days d on d.id = s.day_id
join public.distributions ds on ds.node_id = s.node_id
join public.projects j on j.id = s.project_id
left join public.agenda_days ad on ad.id = d.agenda_day_id;

-- sessions of the caller's own company items, only for published distributions
create or replace function public.my_meetings(p_project uuid) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_participant(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select jsonb_build_object('session_id', v.id, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'day_index', v.day_index,
           'slot_index', v.slot_index,
           'mentor', (select jsonb_build_object('name_en', ne.name_en, 'name_ar', ne.name_ar, 'title_en', ne.title_en,
                        'title_ar', ne.title_ar, 'photo_path', ne.photo_path)
                      from public.list_items mi left join public.network_experts ne on ne.id = mi.network_expert_id
                      where mi.id = v.mentor_item_id))
  from public.v_distribution_sessions v
  join public.distributions d on d.node_id = v.node_id and d.is_published
  join public.list_items ci on ci.id = v.company_item_id
  where v.project_id = p_project and ci.company_id in (select app_private.my_company_ids())
  order by v.starts_at, v.slot_index;
end $$;

commit;
