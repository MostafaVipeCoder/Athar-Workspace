-- m06d_rpcs_public_booking_certificates  (04 5.5 public access and links, 5.6 booking, 5.7 certificates, 5.8 e-mail/jobs/maintenance)
-- Anonymous callers never touch tables: every public read/write is a SECURITY DEFINER RPC with an explicit column whitelist.
-- Public exposure rule: effective visibility = the node's (or project's) visibility; the link must be enabled and unexpired;
-- slugs identify, they never authorise.
set search_path = public, extensions;

begin;

-- ================================================================= link resolution core
-- Returns the link row plus the caller's effective audience: 'pm' | 'participant' | 'public'.  No row = no access (no existence leak).
create or replace function app_private.resolve_link(p_kind text, p_ref text)
returns table (link_id uuid, node_id uuid, project_id uuid, kind text, view_key text, visibility text, slug text,
               title_en text, title_ar text, audience text)
language sql stable security definer set search_path = '' as $$
  with match as (
    select l.*
    from public.public_links l
    where (nullif(p_kind, '') is null or l.kind = p_kind)
      and (l.id in (select s.link_id from public.public_link_slugs s where s.slug = lower(btrim(p_ref)))
           or (btrim(p_ref) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and l.legacy_ref = btrim(p_ref)::uuid))
  ),
  eff as (
    select m.id as link_id, m.node_id, m.project_id, m.kind, m.view_key,
           coalesce(n.visibility, j.visibility) as visibility,
           (select s.slug from public.public_link_slugs s where s.link_id = m.id and s.is_current) as slug,
           coalesce(n.name_en, j.name_en) as title_en, coalesce(n.name_ar, j.name_ar) as title_ar,
           case
             when app_private.is_project_manager(m.project_id) then 'pm'
             when m.is_enabled and (m.expires_at is null or m.expires_at > now())
                  and coalesce(n.visibility, j.visibility) = 'public' then 'public'
             when m.is_enabled and (m.expires_at is null or m.expires_at > now())
                  and coalesce(n.visibility, j.visibility) = 'platform' and app_private.is_participant(m.project_id) then 'participant'
           end as audience
    from match m
    join public.projects j on j.id = m.project_id and j.deleted_at is null
    left join public.nodes n on n.id = m.node_id
    where m.node_id is null or n.deleted_at is null
  )
  select e.link_id, e.node_id, e.project_id, e.kind, e.view_key, e.visibility, e.slug, e.title_en, e.title_ar, e.audience
  from eff e where e.audience is not null
$$;

create or replace function public.resolve_ref(p_kind text, p_ref text)
returns table (link_id uuid, node_id uuid, project_id uuid, kind text, visibility text, slug text, title_en text, title_ar text)
language sql stable security definer set search_path = '' as $$
  select r.link_id, r.node_id, r.project_id, r.kind, r.visibility, r.slug, r.title_en, r.title_ar
  from app_private.resolve_link(p_kind, p_ref) r
$$;

-- ================================================================= link management (PM)
create or replace function public.ensure_public_link(p_node uuid, p_kind text, p_view_key text default null, p_project uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_id uuid; v_slug text; i int := 0;
begin
  if p_node is not null then
    select n.project_id into v_project from public.nodes n where n.id = p_node and n.deleted_at is null;
  else
    v_project := p_project;
  end if;
  if v_project is null or not app_private.is_project_manager(v_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind not in ('project','agenda','form','landing','booking','view') then raise exception 'invalid link kind' using errcode = '22023'; end if;
  if (p_kind = 'project') <> (p_node is null) then raise exception 'project links have no node; every other kind needs one' using errcode = '22023'; end if;

  insert into public.public_links (project_id, node_id, kind, view_key, created_by)
  values (v_project, p_node, p_kind, p_view_key, (select auth.uid()))
  on conflict (project_id, node_id, kind, view_key) do nothing
  returning id into v_id;
  if v_id is null then
    select l.id into v_id from public.public_links l
     where l.project_id = v_project and l.node_id is not distinct from p_node and l.kind = p_kind and l.view_key is not distinct from p_view_key;
  end if;
  if not exists (select 1 from public.public_link_slugs s where s.link_id = v_id) then
    loop
      i := i + 1; v_slug := app_private.gen_slug();
      begin
        insert into public.public_link_slugs (slug, link_id, is_current) values (v_slug, v_id, true);
        exit;
      exception when unique_violation then
        if i > 5 then raise; end if;
      end;
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.set_public_slug(p_link uuid, p_slug text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; s text := lower(btrim(p_slug));
begin
  select project_id into v_project from public.public_links where id = p_link;
  if v_project is null or not app_private.is_project_manager(v_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{2,63}$' then raise exception 'invalid slug' using errcode = '22023'; end if;
  if exists (select 1 from public.public_link_slugs x where x.slug = s and x.link_id = p_link) then
    update public.public_link_slugs set is_current = (slug = s) where link_id = p_link;
    return s;
  end if;
  update public.public_link_slugs set is_current = false where link_id = p_link and is_current;
  begin
    insert into public.public_link_slugs (slug, link_id, is_current) values (s, p_link, true);
  exception when unique_violation then
    update public.public_link_slugs set is_current = true
      where link_id = p_link and slug = (select slug from public.public_link_slugs where link_id = p_link order by created_at desc limit 1);
    raise exception 'slug already taken' using errcode = '23505';
  end;
  return s;
end $$;

-- rotation: a fresh current slug; the old slug is kept (is_current = false) and the legacy ref stops working
create or replace function public.rotate_public_link(p_link uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_slug text; i int := 0;
begin
  select project_id into v_project from public.public_links where id = p_link;
  if v_project is null or not app_private.is_project_manager(v_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.public_links set legacy_ref = null where id = p_link;
  update public.public_link_slugs set is_current = false where link_id = p_link and is_current;
  loop
    i := i + 1; v_slug := app_private.gen_slug();
    begin
      insert into public.public_link_slugs (slug, link_id, is_current) values (v_slug, p_link, true);
      exit;
    exception when unique_violation then if i > 5 then raise; end if;
    end;
  end loop;
  return v_slug;
end $$;

-- ================================================================= public view host / tabs
-- tab visibility for an audience (pm sees all; participant: public+platform edges on platform/public sources; public: public only)
create or replace function app_private.tab_visible(p_audience text, p_edge_audience text, p_source_visibility text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case p_audience
    when 'pm' then true
    when 'participant' then p_edge_audience in ('public','platform','participants') and p_source_visibility in ('platform','public')
    when 'public' then p_edge_audience = 'public' and p_source_visibility = 'public'
    else false end
$$;

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
             'title_en', coalesce(e.label_en, s.name_en), 'title_ar', coalesce(e.label_ar, s.name_ar), 'order', e.order_index)
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

-- one tab's whitelisted data (lazy per tab).  p_edge NULL = the agenda host's built-in agenda tab.
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
    select jsonb_build_object('items', coalesce(jsonb_agg((r - 'contact' - 'overlay' - 'fields')
                                || jsonb_build_object('card', r->'overlay'->'card')), '[]'::jsonb),
                              'next', (array_agg(r->'cursor'))[count(*)])
      into v
      from app_private.resolve_list_rows(s.id,
             case when s.type = 'selection' then jsonb_build_object('status', to_jsonb(app_private.selection_passing(s.config))) else '{}'::jsonb end,
             100, p_after, false) r;
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

-- ================================================================= forms (public definition, submit, analytics)
create or replace function public.get_public_form(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; n public.nodes; f public.forms;
begin
  select * into l from app_private.resolve_link('form', p_ref) r limit 1;
  if not found then return null; end if;
  select * into n from public.nodes where id = l.node_id and type = 'form_builder' and deleted_at is null;
  if not found then return null; end if;
  select * into f from public.forms where node_id = n.id;
  return jsonb_build_object(
    'node_id', n.id, 'project_id', n.project_id, 'name_en', n.name_en, 'name_ar', n.name_ar,
    'is_open', f.is_active and (f.opens_at is null or f.opens_at <= now()) and (f.closes_at is null or f.closes_at > now())
               and (f.max_responses is null or (select count(*) from public.form_responses fr where fr.node_id = n.id and fr.deleted_at is null) < f.max_responses),
    'opens_at', f.opens_at, 'closes_at', f.closes_at,
    'cover_path', (select c.image_path from public.form_covers c where c.id = f.cover_id),
    'thank_you', n.config->'thank_you',
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title_en', s.title_en, 'title_ar', s.title_ar,
                 'description_en', s.description_en, 'description_ar', s.description_ar, 'order_index', s.order_index) order by s.order_index)
                 from public.form_sections s where s.node_id = n.id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'section_id', q.section_id, 'key', q.key, 'type', q.type,
                 'semantic', q.semantic, 'label_en', q.label_en, 'label_ar', q.label_ar, 'description_en', q.description_en,
                 'description_ar', q.description_ar, 'placeholder_en', q.placeholder_en, 'placeholder_ar', q.placeholder_ar,
                 'is_required', q.is_required, 'options', q.options, 'validation', q.validation, 'order_index', q.order_index) order by q.order_index)
                 from public.form_questions q where q.node_id = n.id), '[]'::jsonb));
end $$;

-- called by the edge function after CAPTCHA / rate limit (service role); never granted to anon
create or replace function public.submit_form_response(p_ref text, p_answers jsonb, p_tracking jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l record; n public.nodes; f public.forms; v_id uuid; v_key text; q record; v_email text; v_cnt bigint;
begin
  select * into l from app_private.resolve_link('form', p_ref) r where r.audience = 'public' limit 1;
  if not found then raise exception 'form not found' using errcode = 'P0002'; end if;
  select * into n from public.nodes where id = l.node_id and type = 'form_builder' and deleted_at is null;
  select * into f from public.forms where node_id = n.id;
  if not found then raise exception 'form not found' using errcode = 'P0002'; end if;
  if not f.is_active or (f.opens_at is not null and f.opens_at > now()) or (f.closes_at is not null and f.closes_at <= now()) then
    raise exception 'form_closed' using errcode = 'P0001';
  end if;
  if f.max_responses is not null then
    select count(*) into v_cnt from public.form_responses fr where fr.node_id = n.id and fr.deleted_at is null;
    if v_cnt >= f.max_responses then raise exception 'form_full' using errcode = 'P0001'; end if;
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'answers must be an object' using errcode = '22023'; end if;
  for v_key in select jsonb_object_keys(p_answers) loop           -- key whitelist
    if not exists (select 1 from public.form_questions fq where fq.node_id = n.id and fq.key = v_key) then
      raise exception 'unknown answer key' using errcode = '22023';
    end if;
  end loop;
  for q in select fq.key from public.form_questions fq where fq.node_id = n.id and fq.is_required and fq.type <> 'hidden' loop
    if coalesce(nullif(btrim(p_answers->>q.key), ''), '') = '' and not (p_answers ? q.key and jsonb_typeof(p_answers->q.key) in ('array','object','boolean','number')) then
      raise exception 'missing required answer' using errcode = '22023';
    end if;
  end loop;
  if f.one_response_per_email then
    v_email := lower(coalesce(p_answers->>'founder_email', p_answers->>'email'));
    if v_email is not null and exists (select 1 from public.form_responses fr
                  where fr.node_id = n.id and fr.deleted_at is null and lower(coalesce(fr.answers->>'founder_email', fr.answers->>'email')) = v_email) then
      raise exception 'duplicate_response' using errcode = '23505';
    end if;
  end if;
  insert into public.form_responses (project_id, node_id, answers, source, tracking)
  values (n.project_id, n.id, p_answers, nullif(p_tracking->>'source', ''), coalesce(p_tracking, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.track_node_event(p_ref text, p_type text, p_card uuid default null, p_platform text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select * into l from app_private.resolve_link(null, p_ref) r where r.audience in ('public','participant','pm') and r.node_id is not null limit 1;
  if not found then return; end if;     -- silent: no existence leak
  if p_card is not null and not exists (select 1 from public.landing_cards c where c.id = p_card and c.node_id = l.node_id) then return; end if;
  insert into public.node_events (project_id, node_id, event_type, card_id, platform)
  values (l.project_id, l.node_id, p_type, p_card, left(p_platform, 32));
exception when check_violation then return;     -- unknown event type: ignore
end $$;

-- ================================================================= booking
create or replace view public.v_booking_slots_open with (security_invoker = true) as
select s.id, s.project_id, s.node_id, s.provider_id, s.starts_at, s.ends_at
from public.booking_slots s
join public.booking_providers p on p.id = s.provider_id and p.is_active
join public.booking_settings bs on bs.node_id = s.node_id
where not s.is_blocked
  and s.starts_at >= now() + make_interval(mins => coalesce(p.advance_notice_min, bs.default_advance_notice_min))
  and not exists (select 1 from public.bookings b where b.slot_id = s.id and b.status = 'confirmed');

create or replace function app_private.invite_for(p_node uuid, p_token text) returns public.booking_invitations
language sql stable security definer set search_path = '' as $$
  select i.* from public.booking_invitations i
  where i.node_id = p_node and p_token is not null
    and i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
$$;

create or replace function public.get_public_booking_page(p_ref text, p_host uuid default null, p_invite text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; n public.nodes; bs public.booking_settings; inv public.booking_invitations;
begin
  select * into l from app_private.resolve_link('booking', p_ref) r limit 1;
  if not found then return null; end if;
  select * into n from public.nodes where id = l.node_id and type = 'booking' and deleted_at is null;
  select * into bs from public.booking_settings where node_id = n.id;
  if not found then return null; end if;
  if bs.mode = 'interview' then
    inv := app_private.invite_for(n.id, p_invite);
    if inv.id is null then return jsonb_build_object('status', 'invitation_required', 'mode', bs.mode); end if;
    if exists (select 1 from public.bookings b where b.invitation_id = inv.id and b.status = 'confirmed') then
      return jsonb_build_object('status', 'already_booked', 'mode', bs.mode);
    end if;
  end if;
  return jsonb_build_object('status', 'open', 'mode', bs.mode, 'node_id', n.id, 'name_en', n.name_en, 'name_ar', n.name_ar,
    'timezone', (select j.timezone from public.projects j where j.id = n.project_id),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id,
          'name_en', coalesce(ne.name_en, li.manual_fields->>'title_en'), 'name_ar', coalesce(ne.name_ar, li.manual_fields->>'title_ar'),
          'title_en', coalesce(ne.title_en, li.manual_fields->>'subtitle_en'), 'title_ar', coalesce(ne.title_ar, li.manual_fields->>'subtitle_ar'),
          'photo_path', coalesce(ne.photo_path, li.manual_fields->>'image_path'), 'bio_en', ne.bio_en, 'bio_ar', ne.bio_ar)
          order by p.sort_order nulls last, p.created_at)
        from public.booking_providers p
        join public.list_items li on li.id = p.list_item_id
        left join public.network_experts ne on ne.id = li.network_expert_id
        where p.node_id = n.id and p.is_active and (p_host is null or p.id = p_host)), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'provider_id', o.provider_id, 'starts_at', o.starts_at, 'ends_at', o.ends_at)
          order by o.starts_at)
        from (select * from public.v_booking_slots_open v where v.node_id = n.id and (p_host is null or v.provider_id = p_host)
              order by v.starts_at limit 500) o), '[]'::jsonb));
end $$;

-- HMAC cancel token (secret = database setting app.settings.booking_hmac_key, never stored in a table); NULL when not configured
create or replace function app_private.booking_cancel_token(p_booking uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(current_setting('app.settings.booking_hmac_key', true), '') is null then null
              else encode(extensions.hmac(p_booking::text, current_setting('app.settings.booking_hmac_key', true), 'sha256'), 'hex') end
$$;

create or replace function public.create_booking(p_ref text, p_slot uuid, p_booker jsonb, p_invite text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record; n public.nodes; bs public.booking_settings; sl public.booking_slots; pv public.booking_providers; inv public.booking_invitations;
  v_email text := lower(btrim(p_booker->>'email')); v_id uuid; v_notice int; v_company uuid := nullif(p_booker->>'company_id', '')::uuid;
  v_item uuid; v_max int;
begin
  select * into l from app_private.resolve_link('booking', p_ref) r limit 1;
  if not found then raise exception 'booking page not found' using errcode = 'P0002'; end if;
  select * into n from public.nodes where id = l.node_id and type = 'booking' and deleted_at is null;
  select * into bs from public.booking_settings where node_id = n.id;
  if not found then raise exception 'booking page not found' using errcode = 'P0002'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid e-mail' using errcode = '22023'; end if;

  select * into sl from public.booking_slots where id = p_slot and node_id = n.id for update;      -- serialises concurrent bookers
  if not found or sl.is_blocked then raise exception 'slot_unavailable' using errcode = 'P0001'; end if;
  select * into pv from public.booking_providers where id = sl.provider_id;
  v_notice := coalesce(pv.advance_notice_min, bs.default_advance_notice_min);
  if not pv.is_active or sl.starts_at < now() + make_interval(mins => v_notice) then raise exception 'slot_unavailable' using errcode = 'P0001'; end if;

  if bs.mode = 'interview' then
    inv := app_private.invite_for(n.id, p_invite);
    if inv.id is null then raise exception 'invitation_required' using errcode = '42501'; end if;
    if exists (select 1 from public.bookings b where b.invitation_id = inv.id and b.status = 'confirmed') then
      raise exception 'already_booked' using errcode = 'P0001';
    end if;
    v_item := inv.booker_item_id;
    select li.company_id into v_company from public.list_items li where li.id = v_item;
  else
    v_max := nullif(n.config->'rules'->>'max_bookings_per_email', '')::int;
    if v_max is not null and (select count(*) from public.bookings b where b.node_id = n.id and b.status = 'confirmed' and b.booker_email = v_email) >= v_max then
      raise exception 'booking_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.bookings (project_id, node_id, slot_id, booker_email, booker_name, booker_item_id, booker_company_id,
                                 booker_company_name, invitation_id, meet_link, calendar_owner_connection_id)
    values (n.project_id, n.id, sl.id, v_email, nullif(btrim(p_booker->>'name'), ''), v_item, v_company,
            case when v_company is null then nullif(btrim(p_booker->>'company_name'), '') end, inv.id,
            case when bs.meeting_link_mode = 'shared' then bs.shared_meet_link end, bs.organizer_connection_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';       -- concurrent loser: UNIQUE (slot_id) WHERE confirmed
  end;

  -- sync state lives in the job queue; the booking is never rolled back because Google fails
  insert into app_private.integration_jobs (kind, project_id, booking_id, connection_id, idempotency_key, payload)
  values ('calendar_create', n.project_id, v_id, bs.organizer_connection_id, 'cal:' || v_id || ':calendar_create', '{}'::jsonb)
  on conflict (idempotency_key) do nothing;

  -- confirmation e-mail only when the node has a template and a sender exists (otherwise stage-2 content)
  if n.config->'emails'->'booking_confirmation' is not null then
    insert into app_private.email_outbox (project_id, node_id, email_key, sender_connection_id, recipient_email, booking_id,
                                          subject, body_html, idempotency_key)
    select n.project_id, n.id, 'booking_confirmation', c.id, v_email, v_id,
           coalesce(n.config->'emails'->'booking_confirmation'->>'subject', ''),
           coalesce(n.config->'emails'->'booking_confirmation'->>'body_html', ''),
           encode(extensions.digest(n.id::text || ':booking_confirmation:' || v_id::text || ':1', 'sha256'), 'hex')
    from app_private.google_connections c
    where c.status = 'active' and (c.id = bs.organizer_connection_id or c.kind = 'system')
    order by (c.id = bs.organizer_connection_id) desc limit 1
    on conflict (idempotency_key) do nothing;
  end if;
  return jsonb_build_object('booking_id', v_id, 'slot_id', sl.id, 'starts_at', sl.starts_at, 'ends_at', sl.ends_at, 'status', 'confirmed');
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_token text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_tok text; bs public.booking_settings; allowed boolean := false;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if app_private.is_project_manager(b.project_id) then
    allowed := true;
  elsif p_token is not null then
    v_tok := app_private.booking_cancel_token(p_booking);
    allowed := v_tok is not null and v_tok = p_token;
  end if;
  if not allowed then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.status = 'cancelled' then return; end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()) where id = p_booking;
  select * into bs from public.booking_settings where node_id = b.node_id;
  insert into app_private.integration_jobs (kind, project_id, booking_id, connection_id, idempotency_key, payload)
  values ('calendar_cancel', b.project_id, b.id, coalesce(b.calendar_owner_connection_id, bs.organizer_connection_id),
          'cal:' || b.id || ':calendar_cancel', '{}'::jsonb)
  on conflict (idempotency_key) do nothing;
end $$;

-- server-side only: returns the clear tokens once; only sha256 is stored
create or replace function public.create_invitations(p_node uuid, p_items uuid[]) returns table (item_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; it uuid; t text;
begin
  select * into n from public.nodes where id = p_node and type = 'booking' and deleted_at is null;
  if not found then raise exception 'booking node not found' using errcode = 'P0002'; end if;
  if not (app_private.is_project_manager(n.project_id) or (select auth.role()) = 'service_role') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  foreach it in array p_items loop
    if not exists (select 1 from public.list_items li where li.id = it and li.project_id = n.project_id) then
      raise exception 'item % is not in this project', it using errcode = '22023';
    end if;
    update public.booking_invitations set revoked_at = now() where node_id = p_node and booker_item_id = it and revoked_at is null;
    t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
    insert into public.booking_invitations (project_id, node_id, booker_item_id, token_hash, expires_at)
    values (n.project_id, p_node, it, encode(extensions.digest(t, 'sha256'), 'hex'), now() + interval '30 days');
    item_id := it; token := t; return next;
  end loop;
end $$;

-- ================================================================= certificates
create or replace function app_private.cert_participant_name(p public.participants) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(c.name_en, c.name_ar, fr.answers->>'founder_name', fr.answers->>'company_name', pr.full_name)
  from (select 1) one
  left join public.companies c on c.id = p.company_id
  left join public.form_responses fr on fr.id = p.form_response_id
  left join public.profiles pr on pr.id = p.user_id
$$;

create or replace function app_private.issue_certificate_internal(p_participant uuid, p_node uuid, p_actor uuid) returns public.certificates
language plpgsql security definer set search_path = '' as $$
declare pa public.participants; j public.projects; g public.programs; n public.nodes; t public.certificate_templates; v public.certificates;
        v_lang text; i int := 0; v_code text;
begin
  select * into pa from public.participants where id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null and project_id = pa.project_id;
  if not found then raise exception 'certificates node not found in the participant''s project' using errcode = 'P0002'; end if;
  select * into j from public.projects where id = pa.project_id;
  select * into g from public.programs where id = j.program_id;
  if pa.status <> 'attended' then raise exception 'only attended participants receive certificates' using errcode = '23514'; end if;
  if j.completed_at is null then raise exception 'the project is not completed' using errcode = '23514'; end if;

  select * into v from public.certificates where node_id = p_node and participant_id = p_participant;
  if found then return v; end if;               -- idempotent

  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  select * into t from public.certificate_templates where node_id = p_node and language = v_lang order by version desc limit 1;
  if not found then raise exception 'no certificate template for language %', v_lang using errcode = 'P0002'; end if;

  loop
    i := i + 1; v_code := app_private.gen_cert_code();
    begin
      insert into public.certificates (project_id, node_id, participant_id, template_id, code, snapshot, issued_by)
      values (pa.project_id, p_node, p_participant, t.id, v_code,
              jsonb_build_object('participant_name', app_private.cert_participant_name(pa),
                                 'company_name', (select coalesce(c.name_en, c.name_ar) from public.companies c where c.id = pa.company_id),
                                 'program_name', coalesce(g.name_en, g.name_ar), 'project_name', coalesce(j.name_en, j.name_ar),
                                 'completed_on', (j.completed_at at time zone j.timezone)::date, 'template_version', t.version),
              p_actor)
      returning * into v;
      exit;
    exception when unique_violation then
      select * into v from public.certificates where node_id = p_node and participant_id = p_participant;
      if found then return v; end if;         -- lost a race: return the winner
      if i > 5 then raise; end if;
    end;
  end loop;
  return v;
end $$;

create or replace function public.issue_certificate(p_participant uuid, p_node uuid) returns public.certificates
language plpgsql security definer set search_path = '' as $$
declare pa public.participants;
begin
  select * into pa from public.participants where id = p_participant;
  if not found or not app_private.is_project_manager(pa.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.issue_certificate_internal(p_participant, p_node, (select auth.uid()));
end $$;

create or replace function public.issue_certificates_bulk(p_node uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; r record; k int := 0; before_id uuid;
begin
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select pa.id from public.participants pa where pa.project_id = n.project_id and pa.status = 'attended'
           and not exists (select 1 from public.certificates c where c.node_id = p_node and c.participant_id = pa.id) loop
    perform app_private.issue_certificate_internal(r.id, p_node, (select auth.uid()));
    k := k + 1;
  end loop;
  return k;
end $$;

create or replace function public.revoke_certificate(p_cert uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_cert for update;
  if not found or not app_private.is_project_manager(c.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.certificates set revoked_at = coalesce(revoked_at, now()), revoked_by = (select auth.uid()),
         revoked_reason = coalesce(p_reason, revoked_reason) where id = p_cert;
end $$;

create or replace function public.get_certificate_render_payload(p_cert uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.certificates; t public.certificate_templates; pa public.participants; v_own boolean;
begin
  select * into c from public.certificates where id = p_cert;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pa from public.participants where id = c.participant_id;
  v_own := (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids()))
           and pa.status = 'attended' and c.revoked_at is null;
  if not (app_private.is_project_manager(c.project_id) or v_own) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.certificate_templates where id = c.template_id;
  return jsonb_build_object('code', c.code, 'snapshot', c.snapshot, 'revoked', c.revoked_at is not null,
    'template', jsonb_build_object('id', t.id, 'file_path', t.file_path, 'file_kind', t.file_kind, 'width_px', t.width_px,
                'height_px', t.height_px, 'language', t.language, 'version', t.version, 'bucket', 'certificate-templates'),
    'fields', coalesce((select jsonb_agg(to_jsonb(f) - 'project_id' - 'template_id' - 'id' order by f.var)
                        from public.certificate_template_fields f where f.template_id = t.id), '[]'::jsonb));
end $$;

create or replace function public.verify_certificate(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.certificates; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_code !~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$' then return jsonb_build_object('valid', false); end if;
  select * into c from public.certificates where code = v_code;
  if not found then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', c.revoked_at is null, 'revoked', c.revoked_at is not null,
    'participant_name', c.snapshot->>'participant_name', 'program_name', c.snapshot->>'program_name',
    'completed_on', c.snapshot->>'completed_on', 'issuer', 'Athar');
end $$;

-- ================================================================= e-mail queue and job workers (service role / integration role)
create or replace function public.enqueue_email(p_node uuid, p_email_key text, p_item_ids uuid[], p_round int default 1, p_confirm boolean default false)
returns table (outbox_id uuid, status text)
language plpgsql security definer set search_path = '' as $$
declare
  n public.nodes; v_sender uuid; v_acting uuid := (select auth.uid()); it uuid; li public.list_items; v_email text; v_name text; v_company text;
  v_tpl jsonb; v_subj text; v_body text; v_id uuid; v_key text; v_today int; v_prog text; v_proj text;
begin
  select * into n from public.nodes where id = p_node and deleted_at is null;
  if not found then raise exception 'node not found' using errcode = 'P0002'; end if;
  if not (app_private.is_project_manager(n.project_id) or (select auth.role()) = 'service_role') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if cardinality(p_item_ids) > 100 and not coalesce(p_confirm, false) then
    raise exception 'confirmation required for more than 100 recipients' using errcode = 'P0001';
  end if;
  -- sender: the acting PM's connection, falling back to the system sender [Decided-by-delegation 07-3]
  select c.id into v_sender from app_private.google_connections c where c.status = 'active'
    and (c.owner_user_id = v_acting or c.kind = 'system') order by (c.owner_user_id = v_acting) desc nulls last limit 1;
  if v_sender is null then raise exception 'no active sender connection' using errcode = 'P0002'; end if;
  select count(*) into v_today from app_private.email_outbox o
    where o.sender_connection_id = v_sender and o.status in ('queued','sending','sent') and o.created_at >= date_trunc('day', now());
  if v_today + cardinality(p_item_ids) > 1500 then raise exception 'daily sending cap (1500) would be exceeded' using errcode = 'P0001'; end if;

  v_tpl := n.config->'emails'->p_email_key;
  select coalesce(g.name_en, g.name_ar), coalesce(j.name_en, j.name_ar) into v_prog, v_proj
    from public.projects j join public.programs g on g.id = j.program_id where j.id = n.project_id;
  foreach it in array p_item_ids loop
    select * into li from public.list_items where id = it and project_id = n.project_id;
    if not found then outbox_id := null; status := 'item_not_found'; return next; continue; end if;
    select coalesce(fr.answers->>'founder_email', li.manual_fields->>'email', ne.email::text),
           coalesce(fr.answers->>'founder_name', li.manual_fields->>'title_en', ne.name_en),
           coalesce(fr.answers->>'company_name', co.name_en, li.manual_fields->>'title_en')
      into v_email, v_name, v_company
      from (select 1) one
      left join public.form_responses fr on fr.id = li.form_response_id
      left join public.network_experts ne on ne.id = li.network_expert_id
      left join public.companies co on co.id = li.company_id;
    if v_email is null or btrim(v_email) = '' then outbox_id := null; status := 'no_recipient'; return next; continue; end if;
    v_subj := coalesce(v_tpl->>'subject', ''); v_body := coalesce(v_tpl->>'body_html', '');
    v_subj := replace(replace(replace(replace(replace(v_subj, '{founder_name}', coalesce(v_name, '')), '{first_name}', split_part(coalesce(v_name, ''), ' ', 1)),
                '{company_name}', coalesce(v_company, '')), '{program_name}', coalesce(v_prog, '')), '{project_name}', coalesce(v_proj, ''));
    v_body := replace(replace(replace(replace(replace(v_body, '{founder_name}', coalesce(v_name, '')), '{first_name}', split_part(coalesce(v_name, ''), ' ', 1)),
                '{company_name}', coalesce(v_company, '')), '{program_name}', coalesce(v_prog, '')), '{project_name}', coalesce(v_proj, ''));
    v_key := encode(extensions.digest(p_node::text || ':' || p_email_key || ':' || it::text || ':' || coalesce(p_round, 1)::text, 'sha256'), 'hex');
    insert into app_private.email_outbox (project_id, node_id, email_key, sender_connection_id, recipient_email, list_item_id,
                                          subject, body_html, idempotency_key, created_by)
    values (n.project_id, p_node, p_email_key, v_sender, v_email, it, v_subj, v_body, v_key, v_acting)
    on conflict (idempotency_key) do nothing returning id into v_id;
    outbox_id := coalesce(v_id, (select o.id from app_private.email_outbox o where o.idempotency_key = v_key));
    status := case when v_id is null then 'duplicate' else 'queued' end;
    return next;
  end loop;
end $$;

create or replace function public.claim_email_batch(p_sender uuid, p_limit int default 20) returns setof app_private.email_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  update app_private.email_outbox o set status = 'sending', attempts = o.attempts + 1
  where o.id in (select x.id from app_private.email_outbox x
                 where x.status = 'queued' and x.next_attempt_at <= now() and x.sender_connection_id = p_sender
                 order by x.next_attempt_at limit least(greatest(p_limit, 1), 100) for update skip locked)
  returning o.*;
end $$;

create or replace function public.complete_email(p_id uuid, p_gmail_message_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  update app_private.email_outbox set status = 'sent', sent_at = now(), gmail_message_id = p_gmail_message_id,
         error_code = null, error_message = null where id = p_id;
  insert into app_private.email_log (outbox_id, event, detail) values (p_id, 'sent', p_gmail_message_id);
end $$;

create or replace function public.fail_email(p_id uuid, p_code text, p_msg text, p_retry boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare a int;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  select attempts into a from app_private.email_outbox where id = p_id for update;
  update app_private.email_outbox set
      status = case when p_retry and a < 5 then 'queued' when p_retry then 'dead' else 'failed' end,
      next_attempt_at = now() + make_interval(mins => a * a), error_code = p_code, error_message = left(p_msg, 500)
  where id = p_id;
  insert into app_private.email_log (outbox_id, event, detail) values (p_id, 'failed', coalesce(p_code, '') || ': ' || left(coalesce(p_msg, ''), 300));
end $$;

create or replace function public.claim_integration_jobs(p_kind text, p_limit int default 10) returns setof app_private.integration_jobs
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  update app_private.integration_jobs j set status = 'processing', attempts = j.attempts + 1, locked_until = now() + interval '5 minutes'
  where j.id in (select x.id from app_private.integration_jobs x
                 where x.kind = p_kind and x.next_attempt_at <= now()
                   and (x.status in ('pending','failed') or (x.status = 'processing' and x.locked_until < now()))
                 order by x.next_attempt_at limit least(greatest(p_limit, 1), 100) for update skip locked)
  returning j.*;
end $$;

create or replace function public.complete_job(p_id uuid, p_result jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  update app_private.integration_jobs set status = 'done', result = p_result, locked_until = null, error = null where id = p_id;
end $$;

create or replace function public.fail_job(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare a int;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  select attempts into a from app_private.integration_jobs where id = p_id for update;
  update app_private.integration_jobs set status = case when a >= 5 then 'dead' else 'failed' end, locked_until = null,
         next_attempt_at = now() + make_interval(mins => a * a), error = left(p_error, 500) where id = p_id;
end $$;

-- ---- Apps Script poller bridge (03 10.2 option B): role 'integration' only, over integration_jobs
create or replace function public.poller_claim_bookings(p_limit int default 20)
returns table (job_id uuid, booking_id uuid, kind text, starts_at timestamptz, ends_at timestamptz, booker_email text, booker_name text,
               provider_email text, meeting_link_mode text, shared_meet_link text, calendar_event_id text, mode text)
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.has_role('integration') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with c as (
    update app_private.integration_jobs j set status = 'processing', attempts = j.attempts + 1, locked_until = now() + interval '5 minutes'
    where j.id in (select x.id from app_private.integration_jobs x
                   where x.kind in ('calendar_create','calendar_update','calendar_cancel') and x.next_attempt_at <= now()
                     and (x.status in ('pending','failed') or (x.status = 'processing' and x.locked_until < now()))
                   order by x.next_attempt_at limit least(greatest(p_limit, 1), 50) for update skip locked)
    returning j.id, j.booking_id, j.kind)
  select c.id, b.id, c.kind, s.starts_at, s.ends_at, b.booker_email::text, b.booker_name,
         coalesce(p.booking_email, ne.email)::text, bs.meeting_link_mode, bs.shared_meet_link, b.calendar_event_id, bs.mode
  from c
  join public.bookings b on b.id = c.booking_id
  join public.booking_slots s on s.id = b.slot_id
  join public.booking_providers p on p.id = s.provider_id
  join public.list_items li on li.id = p.list_item_id
  left join public.network_experts ne on ne.id = li.network_expert_id
  join public.booking_settings bs on bs.node_id = b.node_id;
end $$;

create or replace function public.poller_complete_booking(p_job uuid, p_meet_link text, p_calendar_event_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare j app_private.integration_jobs; b public.bookings;
begin
  if not app_private.has_role('integration') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from app_private.integration_jobs where id = p_job for update;
  if not found then raise exception 'job not found' using errcode = 'P0002'; end if;
  select * into b from public.bookings where id = j.booking_id for update;
  if found and j.kind <> 'calendar_cancel' then
    update public.bookings set meet_link = coalesce(p_meet_link, meet_link),
           legacy_calendar_event_id = case when p_calendar_event_id is not null and p_calendar_event_id <> replace(b.id::text, '-', '')
                                           then p_calendar_event_id else legacy_calendar_event_id end
    where id = b.id;
  end if;
  update app_private.integration_jobs set status = 'done', locked_until = null, error = null,
         result = jsonb_build_object('meet_link_set', p_meet_link is not null) where id = p_job;
end $$;

create or replace function public.poller_fail_booking(p_job uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare a int;
begin
  if not app_private.has_role('integration') then raise exception 'forbidden' using errcode = '42501'; end if;
  select attempts into a from app_private.integration_jobs where id = p_job for update;
  update app_private.integration_jobs set status = case when a >= 5 then 'dead' else 'failed' end, locked_until = null,
         next_attempt_at = now() + make_interval(mins => a * a), error = left(p_error, 500) where id = p_job;
end $$;

-- ================================================================= alumni invitations (03 4.4)
create or replace function public.validate_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.alumni_invitations; c text; e text;
begin
  select * into i from public.alumni_invitations x
   where x.token = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and x.status = 'pending' and x.sent_at + interval '14 days' > now();
  if not found then return jsonb_build_object('valid', false); end if;
  select coalesce(co.name_en, co.name_ar) into c from public.companies co where co.id = i.company_id;
  e := regexp_replace(i.founder_email, '^(.).*(@.*)$', '\1***\2');
  return jsonb_build_object('valid', true, 'company_name', c, 'masked_email', e);
end $$;

-- existing account: same rules as the signup trigger (token hash, pending, 14 days, same e-mail, single use)
create or replace function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.alumni_invitations; v_uid uuid := (select auth.uid()); v_email text; v_founder uuid; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select u.email, coalesce(p.full_name, split_part(u.email, '@', 1)) into v_email, v_name
    from auth.users u left join public.profiles p on p.id = u.id where u.id = v_uid;
  select * into i from public.alumni_invitations x
   where x.token = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and x.status = 'pending' and x.sent_at + interval '14 days' > now() and lower(x.founder_email) = lower(coalesce(v_email, ''))
   for update;
  if not found then return jsonb_build_object('accepted', false); end if;
  select f.id into v_founder from public.founders f where f.auth_user_id = v_uid;
  if v_founder is null then
    insert into public.founders (name_ar, name_en, email, auth_user_id) values (v_name, v_name, v_email, v_uid) returning id into v_founder;
  end if;
  insert into public.user_roles (user_id, role_key) values (v_uid, 'founder') on conflict do nothing;
  insert into public.company_founders (company_id, founder_id, role) values (i.company_id, v_founder, 'founder') on conflict do nothing;
  update public.alumni_invitations set status = 'accepted', accepted_at = now(), founder_id = v_founder where id = i.id;
  return jsonb_build_object('accepted', true, 'company_id', i.company_id);
end $$;

-- ================================================================= maintenance (service role / super_admin; pg_cron scheduling is stage 3)
create or replace function public.purge_soft_deleted(p_older_than interval default interval '90 days') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text; k bigint; res jsonb := '{}'::jsonb;
begin
  if not ((select auth.role()) = 'service_role' or app_private.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  foreach t in array array['form_responses','resources','nodes','projects','programs','companies','network_experts','founders'] loop
    begin
      execute format('delete from public.%I where deleted_at is not null and deleted_at < now() - $1', t) using p_older_than;
      get diagnostics k = row_count;
      res := res || jsonb_build_object(t, k);
    exception when foreign_key_violation then
      res := res || jsonb_build_object(t, 'blocked by references');
    end;
  end loop;
  return res;
end $$;

create or replace function public.prune_email_bodies(p_older_than interval default interval '90 days') returns bigint
language plpgsql security definer set search_path = '' as $$
declare k bigint;
begin
  if not ((select auth.role()) = 'service_role' or app_private.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update app_private.email_outbox set subject = null, body_html = null
   where created_at < now() - p_older_than and (subject is not null or body_html is not null);
  get diagnostics k = row_count;
  return k;
end $$;

create or replace function public.report_orphan_assets() returns table (bucket_id text, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ((select auth.role()) = 'service_role' or app_private.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with refs(path) as (
    select cover_path from public.programs union select cover_path from public.projects
    union select photo_path from public.network_experts union select logo_path from public.companies
    union select photo_path from public.founders union select image_path from public.form_covers
    union select cover_path from public.landing_cards union select image_path from public.landing_frames
    union select file_path from public.resources union select file_path from public.certificate_templates
    union select og_image_path from public.public_links union select avatar_path from public.profiles)
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('public-assets','form-uploads','founder-assets','certificate-templates','resources')
    and not exists (select 1 from refs r where r.path is not null and (r.path = o.name or regexp_replace(o.name, '_t(\.[a-z0-9]+)$', '\1') = r.path));
end $$;

-- ================================================================= derived views (security_invoker: they inherit the caller's RLS)
create or replace view public.v_programs with (security_invoker = true) as
select g.*,
       count(j.id) filter (where j.deleted_at is null)                                  as projects_total,
       count(j.id) filter (where j.deleted_at is null and j.completed_at is not null)   as completed_projects,
       (count(j.id) filter (where j.deleted_at is null) > 0
        and count(j.id) filter (where j.deleted_at is null) = count(j.id) filter (where j.deleted_at is null and j.completed_at is not null)) as is_completed
from public.programs g left join public.projects j on j.program_id = g.id
group by g.id;

create or replace view public.v_network_expert_programs with (security_invoker = true) as
select ne.id as expert_id, j.id as project_id, j.program_id, li.list_node_id, li.created_at as first_used_at
from public.network_experts ne
join public.list_items li on li.network_expert_id = ne.id
join public.nodes n on n.id = li.list_node_id and n.deleted_at is null
join public.projects j on j.id = n.project_id and j.deleted_at is null;

create or replace view public.v_network_expert_usage with (security_invoker = true) as
select expert_id, count(distinct project_id) as projects_count, count(distinct program_id) as programs_count
from public.v_network_expert_programs group by expert_id;

create or replace view public.v_company_programs with (security_invoker = true) as
select u.company_id, u.project_id, j.program_id, u.via
from (select pa.company_id, pa.project_id, 'participant'::text as via from public.participants pa where pa.company_id is not null
      union
      select li.company_id, li.project_id, 'list'::text from public.list_items li where li.company_id is not null) u
join public.projects j on j.id = u.project_id and j.deleted_at is null;

create or replace view public.v_company_usage with (security_invoker = true) as
select company_id, count(distinct project_id) as projects_count, count(distinct program_id) as programs_count
from public.v_company_programs group by company_id;

-- alumni analytics compatibility (legacy program_participations); start/end derived from the project's agenda days
create or replace view public.v_program_participations with (security_invoker = true) as
select pa.id, pa.company_id, j.program_id, pa.project_id, pa.status as graduation_status, pa.notes,
       (select min(d.day_date) from public.agenda_days d join public.nodes n on n.id = d.node_id and n.deleted_at is null where n.project_id = pa.project_id) as start_date,
       (select max(d.day_date) from public.agenda_days d join public.nodes n on n.id = d.node_id and n.deleted_at is null where n.project_id = pa.project_id) as end_date,
       pa.created_at, pa.updated_at
from public.participants pa join public.projects j on j.id = pa.project_id
where pa.company_id is not null;

create or replace view public.v_node_event_counts with (security_invoker = true) as
select project_id, node_id, event_type, (created_at at time zone 'UTC')::date as day, count(*) as events
from public.node_events group by project_id, node_id, event_type, (created_at at time zone 'UTC')::date;

-- the owner sees only the status of their own Google connection (no vault_secret_id); definer view by design
create or replace view public.my_google_connection with (security_barrier = true) as
select c.id, c.email::text as email, c.kind, c.scopes, c.status, c.last_ok_at, c.last_error, c.created_at
from app_private.google_connections c where c.owner_user_id = (select auth.uid());

commit;
