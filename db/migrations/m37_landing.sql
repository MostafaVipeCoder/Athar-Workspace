-- m37_landing.sql  (Landing Page node, design 01 section 3.9 / 04 sections 3.11 + 3.12 / 07 sections 5 + 6 / decisions 01-13, 01-14, 07-13)
-- Adds what the Landing node needs beyond m04/m06b/m06d. Re-runnable (create or replace / if not exists). Local DB only.
-- No business data is altered by applying this file (the 4 migrated cards, the node and the 26 events stay as they are).
--
-- 1. app_private.landing_safe_url(text)          URL whitelist for card links (http(s), mailto, tel, /path, #anchor): a PM cannot
--                                                store `javascript:` / `data:` targets that a visitor's browser would execute.
-- 2. app_private.landing_public_config(cfg)      the WHITELISTED public part of a landing node's config (hero, nav, cardsSection,
--                                                personalize, share, seo, analytics.enabled, layoutColumns, legacy title).
-- 3. app_private.landing_target_link(node)       { kind, slug, view_key } of the enabled public link of a node a card points at
--                                                (the `link` port: a Form / Booking / Agenda ... binding, never a copied URL).
-- 4. app_private.landing_public_payload(node)    THE public payload: config + cards (+ per card presets and resolved links) + frames.
--                                                No contact data, no analytics, no PM-only key. Shared by the page and the Agenda tab.
-- 5. get_public_landing(ref)                     anon-callable: the landing page on its own link (kind 'landing', or kind 'view' with
--                                                view_key 'landing'); audience from resolve_link (private -> null, PMs see everything).
-- 6. get_public_tab(...)                         ONLY its landing branch is rewritten to call (4). The function body is patched in
--                                                place from the CURRENT definition (so other builders' branches survive) and the
--                                                patch is idempotent.
-- 7. track_landing_event(ref, type, card, platform, node)   anon-callable analytics write: closed event/platform vocabulary, the card
--                                                must belong to the node, the node's analytics toggle is honoured, PM visits are not
--                                                counted, a per-(node, hashed caller) rate limit (120 / 10 min) drops the excess
--                                                silently. No IP / user agent is ever stored (only a one-way bucket hash in a
--                                                private counter table). Works for the node's own page AND as an Agenda/project tab.
-- 8. get_landing_analytics(node, days)           PM-only aggregate rows for the Analytics tab (no raw event table access needed).
-- 9. save_children_landing_page(...)             re-created: same stable-id upsert as m06b (a card keeps its id across saves, so analytics
--                                                survive; removed cards are deleted by id) PLUS validation: <= 24 cards, <= 8 frames,
--                                                URL whitelist, images must live under the project's own storage folder, platform
--                                                vocabulary and length of share presets, bilingual text lengths.
-- 10. list_founder_landings(project)           founder exposure: the landing pages a participant may be offered (show_to_participants + platform/public + an own link).
set search_path = public, extensions;

begin;

-- ================================================================= 1. URL whitelist
create or replace function app_private.landing_safe_url(p text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p is null or p = '' or p ~* '^(https?://[^[:space:]]+|mailto:[^[:space:]]+|tel:[+0-9 ()-]+|/[^[:space:]]*|#[^[:space:]]*)$'
$$;
revoke all on function app_private.landing_safe_url(text) from public, anon, authenticated;

-- ================================================================= 2. public config whitelist (no authorisation: callers check)
create or replace function app_private.landing_public_config(p_config jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title',         case when jsonb_typeof(p_config->'title') = 'string' then p_config->'title' end,
    'layoutColumns', case when jsonb_typeof(p_config->'layoutColumns') = 'number' then p_config->'layoutColumns' end,
    'hero',          case when jsonb_typeof(p_config->'hero') = 'object' then p_config->'hero' end,
    'nav',           case when jsonb_typeof(p_config->'nav') = 'object' then p_config->'nav' end,
    'cardsSection',  case when jsonb_typeof(p_config->'cardsSection') = 'object' then p_config->'cardsSection' end,
    'personalize',   case when jsonb_typeof(p_config->'personalize') = 'object' then p_config->'personalize' end,
    'share',         case when jsonb_typeof(p_config->'share') = 'object' then p_config->'share' end,
    'seo',           case when jsonb_typeof(p_config->'seo') = 'object' then p_config->'seo' end,
    'analytics',     case when jsonb_typeof(p_config->'analytics'->'enabled') = 'boolean'
                          then jsonb_build_object('enabled', p_config->'analytics'->'enabled') end))
$$;
revoke all on function app_private.landing_public_config(jsonb) from public, anon, authenticated;

-- ================================================================= 3. the public link of a node a card points at
create or replace function app_private.landing_target_link(p_node uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('kind', l.kind, 'slug', sl.slug, 'view_key', l.view_key))
    from public.public_links l
    join public.public_link_slugs sl on sl.link_id = l.id and sl.is_current
    join public.nodes n on n.id = l.node_id and n.deleted_at is null and n.visibility <> 'private'
   where l.node_id = p_node and l.is_enabled and (l.expires_at is null or l.expires_at > now())
   order by case l.kind when 'form' then 0 when 'booking' then 1 when 'landing' then 2 when 'agenda' then 3 else 4 end, l.created_at
   limit 1
$$;
revoke all on function app_private.landing_target_link(uuid) from public, anon, authenticated;

-- ================================================================= 4. THE public payload (no authorisation: callers check)
create or replace function app_private.landing_public_payload(s public.nodes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'node_id', s.id,
    'config', app_private.landing_public_config(s.config),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'cover_path', c.cover_path, 'chip_label_en', c.chip_label_en, 'chip_label_ar', c.chip_label_ar,
        'title_en', c.title_en, 'title_ar', c.title_ar, 'body_en', c.body_en, 'body_ar', c.body_ar, 'see_more_lines', c.see_more_lines,
        'cta_label_en', c.cta_label_en, 'cta_label_ar', c.cta_label_ar, 'cta_url', c.cta_url,
        'cta_link', case when c.cta_node_id is not null then app_private.landing_target_link(c.cta_node_id) end,
        'cta_dot', c.cta_dot, 'share_enabled', c.share_enabled, 'share_url', c.share_url,
        'share_link', case when c.share_node_id is not null then app_private.landing_target_link(c.share_node_id) end,
        'presets', coalesce((select jsonb_object_agg(p.platform, p.body) from public.landing_share_presets p where p.card_id = c.id), '{}'::jsonb))
        order by c.sort_order, c.created_at)
      from public.landing_cards c where c.node_id = s.id), '[]'::jsonb),
    'frames', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'image_path', f.image_path, 'aspect', f.aspect,
        'window_x', f.window_x, 'window_y', f.window_y, 'window_w', f.window_w, 'window_h', f.window_h, 'window_shape', f.window_shape)
        order by f.sort_order, f.id)
      from public.landing_frames f where f.node_id = s.id), '[]'::jsonb))
$$;
revoke all on function app_private.landing_public_payload(public.nodes) from public, anon, authenticated;

-- ================================================================= 5. the landing page on its own public link
create or replace function public.get_public_landing(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; s public.nodes; v_rev bigint;
begin
  select * into l from app_private.resolve_link(null, p_ref) r
   where r.node_id is not null and (r.kind = 'landing' or (r.kind = 'view' and r.view_key = 'landing')) limit 1;
  if not found then return null; end if;                          -- unknown / private / disabled: no existence leak
  select * into s from public.nodes n where n.id = l.node_id and n.type = 'landing_page' and n.deleted_at is null;
  if not found then return null; end if;
  select r.rev into v_rev from public.node_revisions r where r.node_id = s.id;
  return jsonb_build_object('type', 'landing_page', 'node_id', s.id, 'revision', v_rev, 'viewer', l.audience,
    'title_en', s.name_en, 'title_ar', s.name_ar,
    'project', (select jsonb_build_object('name_en', j.name_en, 'name_ar', j.name_ar, 'cover_path', j.cover_path) from public.projects j where j.id = s.project_id),
    'data', app_private.landing_public_payload(s));
end $$;
revoke all on function public.get_public_landing(text) from public;
grant execute on function public.get_public_landing(text) to anon, authenticated;

-- ================================================================= 6. get_public_tab: patch ONLY the landing branch, in place
do $patch$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure) into v_def;
  if position('landing_public_payload' in v_def) > 0 then
    raise notice 'm37: get_public_tab already carries the landing payload';
    return;
  end if;
  v_new := regexp_replace(v_def,
    'elsif s\.type = ''landing_page'' then.*?(?=elsif s\.type = ''distribution'' then)',
    E'elsif s.type = ''landing_page'' then\n    v := app_private.landing_public_payload(s);\n  ', 'i');
  if v_new = v_def then
    raise exception 'm37: could not find the landing_page branch of get_public_tab to patch';
  end if;
  execute v_new;
end $patch$;

-- ================================================================= 7. analytics write (anon-callable, closed vocabulary, rate limited)
create table if not exists app_private.landing_event_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);
alter table app_private.landing_event_limits enable row level security;
alter table app_private.landing_event_limits force row level security;
revoke all on app_private.landing_event_limits from public, anon, authenticated;

create or replace function public.track_landing_event(p_ref text, p_type text, p_card uuid default null, p_platform text default null, p_node uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare l record; s public.nodes; v_headers jsonb; v_ip text; v_bucket text; v_hits int; v_hosts uuid[];
begin
  if p_type is null or p_type not in ('tab_view','card_share','share_copy','cta_click','image_upload','image_download') then return; end if;
  if p_platform is not null and p_platform not in ('whatsapp','facebook','linkedin','instagram','telegram','x','copy','native') then p_platform := null; end if;

  select * into l from app_private.resolve_link(null, p_ref) r where r.node_id is not null or r.kind = 'project' limit 1;
  if not found then return; end if;                                -- silent: no existence leak
  if l.audience = 'pm' then return; end if;                        -- a manager previewing is not a visit

  if p_node is null then
    if not (l.kind = 'landing' or (l.kind = 'view' and l.view_key = 'landing')) then return; end if;
    select * into s from public.nodes n where n.id = l.node_id and n.type = 'landing_page' and n.deleted_at is null;
  else
    -- the landing node reached as a TAB of the agenda / project page the visitor opened
    select * into s from public.nodes n where n.id = p_node and n.type = 'landing_page' and n.deleted_at is null and n.project_id = l.project_id;
    if found and s.id is distinct from l.node_id then
      select array_agg(h.id) into v_hosts from public.nodes h
       where h.project_id = l.project_id and h.deleted_at is null
         and ((l.node_id is not null and h.id = l.node_id and h.type = 'agenda') or (h.type = 'view_host' and (l.kind = 'project' or h.id = l.node_id or l.node_id is null)));
      if not exists (select 1 from public.edges e
                      where e.from_node_id = s.id and e.to_node_id = any (coalesce(v_hosts, '{}')) and e.to_port = 'tabs' and e.is_enabled
                        and app_private.tab_visible(l.audience, e.audience, s.visibility)) then
        return;
      end if;
    end if;
  end if;
  if s.id is null then return; end if;
  if coalesce(s.config->'analytics'->>'enabled', 'true') = 'false' then return; end if;
  if p_card is not null and not exists (select 1 from public.landing_cards c where c.id = p_card and c.node_id = s.id) then return; end if;

  -- rate limit per (node, caller): 120 events / 10 minutes; the caller is only ever seen as a one-way hash
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(v_headers->>'cf-connecting-ip', nullif(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), ''), v_headers->>'x-real-ip', 'unknown');
  v_bucket := md5(s.id::text || '|' || btrim(v_ip));
  insert into app_private.landing_event_limits (bucket, window_start, hits) values (v_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when app_private.landing_event_limits.window_start < now() - interval '10 minutes' then 1 else app_private.landing_event_limits.hits + 1 end,
    window_start = case when app_private.landing_event_limits.window_start < now() - interval '10 minutes' then now() else app_private.landing_event_limits.window_start end
  returning hits into v_hits;
  if random() < 0.02 then delete from app_private.landing_event_limits where window_start < now() - interval '1 day'; end if;
  if v_hits > 120 then return; end if;

  insert into public.node_events (project_id, node_id, event_type, card_id, platform)
  values (s.project_id, s.id, p_type, p_card, p_platform);
end $$;
revoke all on function public.track_landing_event(text, text, uuid, text, uuid) from public;
grant execute on function public.track_landing_event(text, text, uuid, text, uuid) to anon, authenticated;

-- ================================================================= 8. analytics read (PM only)
create or replace function public.get_landing_analytics(p_node uuid, p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_project uuid; v_days int := greatest(1, least(coalesce(p_days, 90), 365)); v_since timestamptz;
begin
  select n.project_id into v_project from public.nodes n where n.id = p_node and n.type = 'landing_page' and n.deleted_at is null;
  if v_project is null or not app_private.is_project_manager(v_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_since := now() - make_interval(days => v_days);
  return jsonb_build_object(
    'days', v_days,
    'totals', coalesce((select jsonb_object_agg(x.event_type, x.n) from (
        select e.event_type, count(*) n from public.node_events e where e.node_id = p_node and e.created_at >= v_since group by 1) x), '{}'::jsonb),
    'all_time', (select count(*) from public.node_events e where e.node_id = p_node),
    'by_card', coalesce((select jsonb_agg(jsonb_build_object('card_id', x.card_id, 'event_type', x.event_type, 'n', x.n)) from (
        select e.card_id, e.event_type, count(*) n from public.node_events e
         where e.node_id = p_node and e.created_at >= v_since and e.card_id is not null group by 1, 2) x), '[]'::jsonb),
    'by_platform', coalesce((select jsonb_agg(jsonb_build_object('platform', x.platform, 'event_type', x.event_type, 'n', x.n)) from (
        select e.platform, e.event_type, count(*) n from public.node_events e
         where e.node_id = p_node and e.created_at >= v_since and e.platform is not null group by 1, 2) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'event_type', x.event_type, 'n', x.n) order by x.day) from (
        select (e.created_at at time zone 'UTC')::date as day, e.event_type, count(*) n from public.node_events e
         where e.node_id = p_node and e.created_at >= v_since group by 1, 2) x), '[]'::jsonb));
end $$;
revoke all on function public.get_landing_analytics(uuid, integer) from public, anon;
grant execute on function public.get_landing_analytics(uuid, integer) to authenticated;

-- ================================================================= 9. save_children_landing_page (stable ids + validation)
-- children = { cards: [{ id?, sort_order, cover_path, chip_label_*, title_*, body_*, see_more_lines, cta_label_*, cta_url | cta_node_id,
--                        cta_dot, share_enabled, share_url | share_node_id, presets: { platform: text } }],
--              frames: [{ id?, name, image_path, aspect, window_x/y/w/h, window_shape, sort_order }] }
-- Either key may be omitted (the other part is then left untouched). A card/frame id belonging to ANOTHER node is refused.
create or replace function app_private.save_children_landing_page(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_prefix text; c record; f record; v_card uuid; keep_c uuid[] := '{}'; keep_f uuid[] := '{}'; pr record;
begin
  select project_id into v_project from public.nodes where id = p_node;
  v_prefix := v_project::text || '/';

  if p_children ? 'cards' then
    if jsonb_typeof(p_children->'cards') <> 'array' then
      raise exception 'landing_invalid: cards must be an array' using errcode = '22023', hint = 'landing_invalid', detail = 'cards:type';
    end if;
    if jsonb_array_length(p_children->'cards') > 24 then
      raise exception 'landing_invalid: at most 24 cards' using errcode = '22023', hint = 'landing_invalid', detail = 'cards:too_many';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_children->'cards') as x(id uuid)
               join public.landing_cards a on a.id = x.id where a.node_id <> p_node) then
      raise exception 'a card id belongs to another node' using errcode = '42501';
    end if;
    for c in select * from jsonb_to_recordset(p_children->'cards') as x(
        id uuid, sort_order int, cover_path text, chip_label_en text, chip_label_ar text, title_en text, title_ar text,
        body_en text, body_ar text, see_more_lines smallint, cta_label_en text, cta_label_ar text, cta_url text,
        cta_node_id uuid, cta_dot boolean, share_enabled boolean, share_url text, share_node_id uuid, presets jsonb)
    loop
      if not app_private.landing_safe_url(c.cta_url) then
        raise exception 'landing_invalid: the button link is not allowed' using errcode = '22023', hint = 'landing_invalid', detail = 'cta_url:invalid';
      end if;
      if not app_private.landing_safe_url(c.share_url) then
        raise exception 'landing_invalid: the share link is not allowed' using errcode = '22023', hint = 'landing_invalid', detail = 'share_url:invalid';
      end if;
      if nullif(c.cover_path, '') is not null and left(c.cover_path, length(v_prefix)) <> v_prefix then
        raise exception 'landing_invalid: the cover must be stored in this project' using errcode = '22023', hint = 'landing_invalid', detail = 'cover_path:invalid';
      end if;
      if length(coalesce(c.title_en, '')) > 300 or length(coalesce(c.title_ar, '')) > 300 or length(coalesce(c.body_en, '')) > 5000 or length(coalesce(c.body_ar, '')) > 5000
         or length(coalesce(c.chip_label_en, '')) > 80 or length(coalesce(c.chip_label_ar, '')) > 80
         or length(coalesce(c.cta_label_en, '')) > 120 or length(coalesce(c.cta_label_ar, '')) > 120 then
        raise exception 'landing_invalid: a text is too long' using errcode = '22023', hint = 'landing_invalid', detail = 'text:too_long';
      end if;

      insert into public.landing_cards (id, project_id, node_id, sort_order, cover_path, chip_label_en, chip_label_ar, title_en,
          title_ar, body_en, body_ar, see_more_lines, cta_label_en, cta_label_ar, cta_url, cta_node_id, cta_dot,
          share_enabled, share_url, share_node_id)
      values (coalesce(c.id, gen_random_uuid()), v_project, p_node, coalesce(c.sort_order, 0), nullif(c.cover_path, ''), c.chip_label_en,
          c.chip_label_ar, c.title_en, c.title_ar, c.body_en, c.body_ar,
          case when c.see_more_lines between 1 and 20 then c.see_more_lines end, c.cta_label_en, c.cta_label_ar,
          case when c.cta_node_id is null then nullif(c.cta_url, '') end, c.cta_node_id, coalesce(c.cta_dot, false),
          coalesce(c.share_enabled, false), case when c.share_node_id is null then nullif(c.share_url, '') end, c.share_node_id)
      on conflict (id) do update set sort_order = excluded.sort_order, cover_path = excluded.cover_path,
          chip_label_en = excluded.chip_label_en, chip_label_ar = excluded.chip_label_ar, title_en = excluded.title_en,
          title_ar = excluded.title_ar, body_en = excluded.body_en, body_ar = excluded.body_ar,
          see_more_lines = excluded.see_more_lines, cta_label_en = excluded.cta_label_en, cta_label_ar = excluded.cta_label_ar,
          cta_url = excluded.cta_url, cta_node_id = excluded.cta_node_id, cta_dot = excluded.cta_dot,
          share_enabled = excluded.share_enabled, share_url = excluded.share_url, share_node_id = excluded.share_node_id
      returning id into v_card;
      keep_c := keep_c || v_card;

      if c.presets is not null then
        if jsonb_typeof(c.presets) <> 'object' then
          raise exception 'landing_invalid: presets must be an object' using errcode = '22023', hint = 'landing_invalid', detail = 'presets:type';
        end if;
        delete from public.landing_share_presets where card_id = v_card;
        for pr in select key as platform, value #>> '{}' as body from jsonb_each(c.presets) loop
          if pr.platform not in ('whatsapp','facebook','linkedin','instagram','telegram','x','copy') then
            raise exception 'landing_invalid: unknown share platform' using errcode = '22023', hint = 'landing_invalid', detail = 'presets:platform';
          end if;
          if length(coalesce(pr.body, '')) > 2000 then
            raise exception 'landing_invalid: a share text is too long' using errcode = '22023', hint = 'landing_invalid', detail = 'presets:too_long';
          end if;
          if nullif(btrim(coalesce(pr.body, '')), '') is not null then
            insert into public.landing_share_presets (card_id, platform, project_id, body) values (v_card, pr.platform, v_project, pr.body);
          end if;
        end loop;
      end if;
    end loop;
    delete from public.landing_cards where node_id = p_node and id <> all (keep_c);
  end if;

  if p_children ? 'frames' then
    if jsonb_typeof(p_children->'frames') <> 'array' then
      raise exception 'landing_invalid: frames must be an array' using errcode = '22023', hint = 'landing_invalid', detail = 'frames:type';
    end if;
    if jsonb_array_length(p_children->'frames') > 8 then
      raise exception 'landing_invalid: at most 8 frames' using errcode = '22023', hint = 'landing_invalid', detail = 'frames:too_many';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_children->'frames') as x(id uuid)
               join public.landing_frames a on a.id = x.id where a.node_id <> p_node) then
      raise exception 'a frame id belongs to another node' using errcode = '42501';
    end if;
    for f in select * from jsonb_to_recordset(p_children->'frames') as x(id uuid, name text, image_path text, aspect text,
             window_x smallint, window_y smallint, window_w smallint, window_h smallint, window_shape text, sort_order int)
    loop
      if nullif(f.image_path, '') is null or left(f.image_path, length(v_prefix)) <> v_prefix then
        raise exception 'landing_invalid: the frame must be stored in this project' using errcode = '22023', hint = 'landing_invalid', detail = 'image_path:invalid';
      end if;
      if length(coalesce(f.name, '')) > 80 then
        raise exception 'landing_invalid: the frame name is too long' using errcode = '22023', hint = 'landing_invalid', detail = 'name:too_long';
      end if;
      with up as (
        insert into public.landing_frames (id, project_id, node_id, name, image_path, aspect, window_x, window_y, window_w, window_h, window_shape, sort_order)
        values (coalesce(f.id, gen_random_uuid()), v_project, p_node, f.name, f.image_path, '4:5', f.window_x, f.window_y, f.window_w, f.window_h,
                case when f.window_shape = 'circle' then 'circle' else 'rect' end, coalesce(f.sort_order, 0))
        on conflict (id) do update set name = excluded.name, image_path = excluded.image_path, aspect = excluded.aspect,
            window_x = excluded.window_x, window_y = excluded.window_y, window_w = excluded.window_w,
            window_h = excluded.window_h, window_shape = excluded.window_shape, sort_order = excluded.sort_order
        returning id)
      select keep_f || up.id into keep_f from up;
    end loop;
    delete from public.landing_frames where node_id = p_node and id <> all (keep_f);
  end if;
end $$;
revoke all on function app_private.save_children_landing_page(uuid, jsonb) from public, anon, authenticated;


-- ================================================================= 10. founder exposure (01 section 3.9 "showToParticipants")
-- The landing pages of a project a participant may be offered: show_to_participants AND visibility platform/public AND an enabled own link
-- (`/view/<ref>/landing`). Callable by participants of the project and its PMs only (anon never). The step-8 founder Program page renders a
-- button per row; nothing is returned while no node is exposed.
create or replace function public.list_founder_landings(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (app_private.is_project_manager(p_project) or app_private.is_participant(p_project)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('node_id', n.id, 'name_en', n.name_en, 'name_ar', n.name_ar, 'ref', own.slug) order by n.created_at, n.id)
      from public.nodes n
      join lateral (
        select s.slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current
         where l.node_id = n.id and l.kind = 'view' and l.view_key = 'landing' and l.is_enabled and (l.expires_at is null or l.expires_at > now())
         limit 1) own on true
     where n.project_id = p_project and n.type = 'landing_page' and n.deleted_at is null
       and n.show_to_participants and n.visibility in ('platform','public')), '[]'::jsonb);
end $$;
revoke all on function public.list_founder_landings(uuid) from public, anon, authenticated;
grant execute on function public.list_founder_landings(uuid) to authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.get_public_landing(text)') is null or to_regprocedure('public.track_landing_event(text,text,uuid,text,uuid)') is null
     or to_regprocedure('public.get_landing_analytics(uuid,integer)') is null or to_regprocedure('public.list_founder_landings(uuid)') is null
     or to_regprocedure('app_private.landing_public_payload(public.nodes)') is null then
    raise exception 'm37: a function is missing';
  end if;
  if position('landing_public_payload' in pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'm37: get_public_tab does not carry the landing payload';
  end if;
  if has_function_privilege('anon', 'public.get_landing_analytics(uuid,integer)', 'EXECUTE') or has_function_privilege('anon', 'public.list_founder_landings(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.landing_public_payload(public.nodes)', 'EXECUTE') then
    raise exception 'm37: anon must not execute the PM / founder / helper functions';
  end if;
  if not (has_function_privilege('anon', 'public.get_public_landing(text)', 'EXECUTE') and has_function_privilege('anon', 'public.track_landing_event(text,text,uuid,text,uuid)', 'EXECUTE')) then
    raise exception 'm37: anon must execute the public landing RPCs';
  end if;
  if app_private.landing_safe_url('javascript:alert(1)') or not app_private.landing_safe_url('https://athareg.com') then
    raise exception 'm37: the URL whitelist is wrong';
  end if;
end $$;

commit;
