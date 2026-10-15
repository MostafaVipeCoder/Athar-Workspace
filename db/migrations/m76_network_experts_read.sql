-- m76_network_experts_read.sql  (Athar Network: the experts registry, part 2 = the READ side: list, profile, duplicate search, tags)
-- Re-runnable (create or replace). Local DB only. Run AFTER m75. Verify with db/verify/v76_network_experts_read.sql.
--
-- WHO MAY READ (assumed, the owner could not be asked): every STAFF role (project_manager, alumni_manager, super_admin). Founders and anonymous callers get nothing (42501).
-- WHAT A PROFILE SHOWS (decision recorded in db/README.md): the contact data and the staff notes of an expert are visible to staff only (every reader here is staff, and no public
-- RPC of the platform returns them: the resolvers pick explicit columns). The PARTICIPATION TOTALS (programs, projects, lists, sessions, first / last) are GLOBAL: every staff member sees how
-- often an expert took part anywhere. The per-engagement DETAIL ROWS (program name, project name, list, roles, sessions) are returned only for the projects the caller manages
-- (app_private.is_project_manager: a member of the project or of its program, or a super_admin); the rest come back as a COUNT ("hidden"), never as names. The program filter of the registry
-- honours only the programs the caller can see, so it cannot be used to probe a program of somebody else.
--
-- Errors are tokens (message "token: ..." + hint = token + detail = "field:reason"), mapped in web/src/data/errors.js:
--   expert_invalid (22023), expert_not_found (P0002), expert_stale / expert_in_use / expert_merge_blocked (P0001), 42501 for a role that may not.
set search_path = public, extensions;

begin;

-- ================================================================= helpers
-- a name / title / company as it is SHOWN: tabs and runs of spaces of the migrated records collapse to one space ('' -> null); the stored value is not touched
create or replace function app_private.expert_text(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '')
$$;

create or replace function app_private.expert_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin']), false)
$$;

create or replace function app_private.expert_fail(p_field text, p_reason text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'expert_invalid: %:%', p_field, p_reason using errcode = '22023', hint = 'expert_invalid', detail = p_field || ':' || p_reason;
end $$;

-- How alike are two people records? Returns a score (0..1) and the reasons.
--   1.00 same_linkedin   the same profile link (the strongest signal, also across scripts: the migrated "Osama Nageeb" / "أسامة نجيب")
--   0.95 same_email      the same e-mail (experts only: the two Athar team rows share the startups@ inbox)
--   0.95 same_name       the same normalised name in either language
--   0.85 same_name_translit  the same consonant skeleton (a Latin and an Arabic spelling of one name, "Mohamed" / "Muhammad")
--   x    similar_name    trigram similarity of the normalised names >= 0.6 (the score is the similarity)
-- >= 0.95 is BLOCKING for a create (the caller has to confirm); everything else is a warning.
create or replace function app_private.expert_match(p_en1 text, p_ar1 text, p_mail1 text, p_li1 text, p_kind1 text, p_skels1 text[],
                                                    p_en2 text, p_ar2 text, p_mail2 text, p_li2 text, p_kind2 text, p_skels2 text[],
                                                    out score numeric, out reasons text[])
language plpgsql stable set search_path = '' as $$
declare n1 text[]; n2 text[]; a text; b text; v_sim numeric := 0; v_exact boolean := false; s numeric; k1 text; k2 text;
begin
  score := 0; reasons := '{}'::text[];
  n1 := array(select x from unnest(array[app_private.expert_norm(p_en1), app_private.expert_norm(p_ar1)]) x where char_length(x) >= 3);
  n2 := array(select x from unnest(array[app_private.expert_norm(p_en2), app_private.expert_norm(p_ar2)]) x where char_length(x) >= 3);
  foreach a in array n1 loop
    foreach b in array n2 loop
      if a = b then v_exact := true; end if;
      s := extensions.similarity(a, b);
      if s > v_sim then v_sim := s; end if;
    end loop;
  end loop;
  k1 := app_private.expert_linkkey(p_li1); k2 := app_private.expert_linkkey(p_li2);
  if k1 <> '' and k1 = k2 and position('/' in k1) > 0 then reasons := array_append(reasons, 'same_linkedin'); score := 1; end if;
  if coalesce(p_kind1, 'expert') = 'expert' and coalesce(p_kind2, 'expert') = 'expert'
     and nullif(lower(btrim(coalesce(p_mail1, ''))), '') is not null and lower(btrim(coalesce(p_mail1, ''))) = lower(btrim(coalesce(p_mail2, ''))) then
    reasons := array_append(reasons, 'same_email'); score := greatest(score, 0.95);
  end if;
  if v_exact then reasons := array_append(reasons, 'same_name'); score := greatest(score, 0.95); end if;
  if not v_exact and coalesce(p_skels1, '{}'::text[]) && coalesce(p_skels2, '{}'::text[]) then reasons := array_append(reasons, 'same_name_translit'); score := greatest(score, 0.85); end if;
  if not v_exact and v_sim >= 0.6 then reasons := array_append(reasons, 'similar_name'); score := greatest(score, round(v_sim, 2)); end if;
end $$;

-- candidates for a record that is being typed / imported (the same engine as the pair finder)
create or replace function app_private.expert_find_similar(p_name_en text, p_name_ar text, p_email text, p_linkedin text, p_kind text, p_exclude uuid, p_min numeric, p_limit integer)
returns table (id uuid, score numeric, reasons text[])
language sql stable security definer set search_path = '' as $$
  with q as (select app_private.expert_skeleton(p_name_en) s_en, app_private.expert_skeleton(p_name_ar) s_ar)
  select ne.id, m.score, m.reasons
    from public.network_experts ne
    cross join q
    cross join lateral app_private.expert_match(p_name_en, p_name_ar, p_email, p_linkedin, coalesce(p_kind, 'expert'),
                                                array(select x from unnest(array[q.s_en, q.s_ar]) x where char_length(x) >= 4),
                                                ne.name_en, ne.name_ar, ne.email::text, ne.linkedin_url, ne.kind, ne.name_skels) m
   where ne.deleted_at is null and (p_exclude is null or ne.id <> p_exclude) and m.score >= coalesce(p_min, 0.6)
   order by m.score desc, ne.created_at, ne.id
   limit least(greatest(coalesce(p_limit, 6), 1), 50)
$$;

-- ================================================================= 1. list_network_experts: the registry list (search, filters, sort, paging) with the live participation numbers
-- p_filter keys (all optional): q (text: every word must match the name / title / company / e-mail / link / a tag, in either language), kind ('expert' | 'team'),
--   state ('active' default | 'archived' | 'deleted' (super_admin) | 'all' = active + archived), has_photo (bool), has_email (bool), tag_ids (uuid[]; any of them), language (iso code),
--   program_ids (uuid[]; experts that took part in ANY of the programs the caller can see), participated ('yes' | 'no').
-- p_sort: name | programs | projects | sessions | last | updated | created. p_lang decides which name sorts first. p_full adds bio, e-mail, phone and notes (the Excel export) and lifts the page cap to 5000.
-- -> { total, counts: { active, expert, team, archived, deleted, without_photo }, limit, offset, rows: [...] }
create or replace function public.list_network_experts(p_filter jsonb default '{}'::jsonb, p_sort text default 'name', p_dir text default 'asc', p_limit integer default 24,
                                                       p_offset integer default 0, p_lang text default 'en', p_full boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_f jsonb := case when jsonb_typeof(coalesce(p_filter, '{}'::jsonb)) = 'object' then coalesce(p_filter, '{}'::jsonb) else '{}'::jsonb end;
  v_full boolean := coalesce(p_full, false);
  v_lim integer := least(greatest(coalesce(p_limit, 24), 1), case when v_full then 5000 else 200 end);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(nullif(p_sort, ''), 'name');
  v_dir text := lower(coalesce(nullif(p_dir, ''), 'asc'));
  v_lang text := case when p_lang = 'ar' then 'ar' else 'en' end;
  v_sa boolean;
  v_terms text[]; v_kind text; v_state text; v_has_photo boolean; v_has_email boolean; v_tags uuid[] := '{}'; v_language text; v_part text;
  v_prog_req uuid[] := '{}'; v_prog_filter boolean := false; v_progs uuid[] := '{}';
  v_counts jsonb; v_rows jsonb; v_total integer;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sa := coalesce(app_private.is_super_admin(), false);
  if v_sort not in ('name', 'programs', 'projects', 'sessions', 'last', 'updated', 'created') then perform app_private.expert_fail('sort', 'bad_value'); end if;
  if v_dir not in ('asc', 'desc') then perform app_private.expert_fail('dir', 'bad_value'); end if;

  v_terms := array(select t from unnest(regexp_split_to_array(app_private.expert_norm(v_f->>'q'), ' ')) t where t <> '' limit 8);
  v_kind := nullif(v_f->>'kind', '');
  if v_kind is not null and v_kind not in ('expert', 'team') then perform app_private.expert_fail('kind', 'bad_value'); end if;
  v_state := coalesce(nullif(v_f->>'state', ''), 'active');
  if v_state not in ('active', 'archived', 'deleted', 'all') then perform app_private.expert_fail('state', 'bad_value'); end if;
  if v_state = 'deleted' and not v_sa then raise exception 'forbidden' using errcode = '42501'; end if;
  v_has_photo := case when jsonb_typeof(v_f->'has_photo') = 'boolean' then (v_f->>'has_photo')::boolean end;
  v_has_email := case when jsonb_typeof(v_f->'has_email') = 'boolean' then (v_f->>'has_email')::boolean end;
  if jsonb_typeof(v_f->'tag_ids') = 'array' then
    v_tags := array(select e::uuid from jsonb_array_elements_text(v_f->'tag_ids') e where e ~ c_uuid limit 20);
  end if;
  v_language := nullif(lower(btrim(coalesce(v_f->>'language', ''))), '');
  if v_language is not null and v_language !~ '^[a-z]{2,3}$' then perform app_private.expert_fail('language', 'bad_value'); end if;
  v_part := nullif(v_f->>'participated', '');
  if v_part is not null and v_part not in ('yes', 'no') then perform app_private.expert_fail('participated', 'bad_value'); end if;
  if jsonb_typeof(v_f->'program_ids') = 'array' then
    v_prog_req := array(select e::uuid from jsonb_array_elements_text(v_f->'program_ids') e where e ~ c_uuid limit 20);
    v_prog_filter := cardinality(v_prog_req) > 0;
  end if;
  if v_prog_filter then
    -- only programs the caller can see: a program of somebody else cannot be probed through the filter
    v_progs := coalesce((select array_agg(g.id) from public.programs g
                          where g.id = any (v_prog_req) and g.deleted_at is null
                            and (coalesce(app_private.is_program_member(g.id), false)
                                 or exists (select 1 from public.projects j where j.program_id = g.id and j.deleted_at is null and coalesce(app_private.is_project_manager(j.id), false)))), '{}'::uuid[]);
  end if;

  select jsonb_build_object(
           'active', count(*) filter (where ne.deleted_at is null and ne.archived_at is null),
           'expert', count(*) filter (where ne.deleted_at is null and ne.archived_at is null and ne.kind = 'expert'),
           'team', count(*) filter (where ne.deleted_at is null and ne.archived_at is null and ne.kind = 'team'),
           'archived', count(*) filter (where ne.deleted_at is null and ne.archived_at is not null),
           'deleted', case when v_sa then count(*) filter (where ne.deleted_at is not null and ne.merged_into is null) else 0 end,
           'without_photo', count(*) filter (where ne.deleted_at is null and ne.archived_at is null and ne.photo_path is null))
    into v_counts from public.network_experts ne;

  with pr as materialized (select * from app_private.expert_participation(null) x where not x.withdrawn),
       part as (select x.expert_id, count(distinct x.program_id)::int as programs, count(distinct x.project_id)::int as projects, count(*)::int as lists,
                       coalesce(sum(x.booking_sessions), 0)::int as bk, coalesce(sum(x.distribution_sessions), 0)::int as ds,
                       min(x.first_session_on) as first_on, max(x.last_session_on) as last_on
                  from pr x group by x.expert_id),
       filtered as (
         select ne.*, coalesce(pt.programs, 0) as n_programs, coalesce(pt.projects, 0) as n_projects, coalesce(pt.lists, 0) as n_lists,
                coalesce(pt.bk, 0) as n_bk, coalesce(pt.ds, 0) as n_ds, coalesce(pt.bk, 0) + coalesce(pt.ds, 0) as n_sessions, pt.first_on, pt.last_on,
                app_private.expert_norm(case when v_lang = 'ar' then coalesce(nullif(ne.name_ar, ''), ne.name_en) else coalesce(nullif(ne.name_en, ''), ne.name_ar) end) as sort_name,
                case when v_lang = 'ar' and coalesce(nullif(ne.name_ar, ''), ne.name_en) ~ '[؀-ۿ]' then 0 else 1 end as sort_rank
           from public.network_experts ne
           left join part pt on pt.expert_id = ne.id
          where (case v_state when 'active' then ne.deleted_at is null and ne.archived_at is null
                              when 'archived' then ne.deleted_at is null and ne.archived_at is not null
                              when 'deleted' then ne.deleted_at is not null and ne.merged_into is null
                              else ne.deleted_at is null end)
            and (v_kind is null or ne.kind = v_kind)
            and (v_has_photo is null or (ne.photo_path is not null) = v_has_photo)
            and (v_has_email is null or (ne.email is not null) = v_has_email)
            and (v_language is null or v_language = any (ne.languages))
            and (cardinality(v_tags) = 0 or exists (select 1 from public.network_expert_tags x where x.expert_id = ne.id and x.tag_id = any (v_tags)))
            and (v_part is null or (v_part = 'yes') = (coalesce(pt.lists, 0) > 0))
            and (not v_prog_filter or exists (select 1 from pr x where x.expert_id = ne.id and x.program_id = any (v_progs)))
            and (cardinality(v_terms) = 0 or not exists (
                   select 1 from unnest(v_terms) t
                    where not (coalesce(ne.search_text, '') like '%' || t || '%'
                               or exists (select 1 from public.network_expert_tags x join public.expert_tags et on et.id = x.tag_id
                                           where x.expert_id = ne.id and app_private.expert_norm(coalesce(et.name_en, '') || ' ' || coalesce(et.name_ar, '')) like '%' || t || '%')))) ),
       ordered as (
         select f.*, row_number() over (order by
                  case when v_dir = 'asc' then (case v_sort when 'name' then f.sort_rank end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'name' then f.sort_rank end) end desc nulls last,
                  case when v_dir = 'asc' then (case v_sort when 'name' then f.sort_name end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'name' then f.sort_name end) end desc nulls last,
                  case when v_dir = 'asc' then (case v_sort when 'programs' then f.n_programs::numeric when 'projects' then f.n_projects::numeric when 'sessions' then f.n_sessions::numeric
                                                  when 'last' then extract(epoch from f.last_on::timestamp) when 'updated' then extract(epoch from f.updated_at)
                                                  when 'created' then extract(epoch from f.created_at) end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'programs' then f.n_programs::numeric when 'projects' then f.n_projects::numeric when 'sessions' then f.n_sessions::numeric
                                                  when 'last' then extract(epoch from f.last_on::timestamp) when 'updated' then extract(epoch from f.updated_at)
                                                  when 'created' then extract(epoch from f.created_at) end) end desc nulls last,
                  f.sort_name, f.id) as rn
           from filtered f),
       page as (select o.* from ordered o where o.rn > v_off and o.rn <= v_off + v_lim),
       tagrows as (
         select x.expert_id, jsonb_agg(jsonb_build_object('id', et.id, 'name_en', app_private.expert_text(et.name_en), 'name_ar', app_private.expert_text(et.name_ar), 'archived', et.archived_at is not null)
                                       order by lower(coalesce(et.name_en, et.name_ar)), et.id) as tags
           from public.network_expert_tags x join public.expert_tags et on et.id = x.tag_id
          where x.expert_id in (select pg.id from page pg) group by x.expert_id)
  select (select count(*) from filtered)::int,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', pg.id, 'kind', pg.kind, 'name_en', app_private.expert_text(pg.name_en), 'name_ar', app_private.expert_text(pg.name_ar), 'title_en', app_private.expert_text(pg.title_en), 'title_ar', app_private.expert_text(pg.title_ar), 'company_en', app_private.expert_text(pg.company_en), 'company_ar', app_private.expert_text(pg.company_ar),
             'photo_path', pg.photo_path, 'linkedin_url', pg.linkedin_url, 'website_url', pg.website_url, 'links', pg.links, 'languages', to_jsonb(pg.languages),
             'has_email', pg.email is not null, 'archived_at', pg.archived_at, 'deleted_at', pg.deleted_at, 'created_at', pg.created_at, 'updated_at', pg.updated_at,
             'tags', coalesce(tr.tags, '[]'::jsonb),
             'programs_count', pg.n_programs, 'projects_count', pg.n_projects, 'lists_count', pg.n_lists, 'booking_sessions', pg.n_bk, 'distribution_sessions', pg.n_ds, 'sessions_count', pg.n_sessions,
             'first_session_on', pg.first_on, 'last_session_on', pg.last_on)
           || case when v_full then jsonb_build_object('bio_en', pg.bio_en, 'bio_ar', pg.bio_ar, 'email', pg.email, 'phone', pg.phone, 'notes', pg.notes) else '{}'::jsonb end
           order by pg.rn), '[]'::jsonb)
    into v_total, v_rows
    from page pg left join tagrows tr on tr.expert_id = pg.id;

  return jsonb_build_object('total', coalesce(v_total, 0), 'counts', v_counts, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- ================================================================= 2. get_network_expert: one profile with its participation history
-- -> { expert, tags, totals, participation: [...visible engagements...], hidden: { engagements, projects, programs }, merged_into, absorbed, can }
create or replace function public.get_network_expert(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ne public.network_experts; v_sa boolean; v_tags jsonb; v_tot jsonb; v_part jsonb; v_hidden jsonb; v_into jsonb := null; v_abs jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sa := coalesce(app_private.is_super_admin(), false);
  if p_id is null then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;
  select * into ne from public.network_experts x where x.id = p_id;
  if not found or (ne.deleted_at is not null and not v_sa) then raise exception 'expert_not_found: no such expert' using errcode = 'P0002', hint = 'expert_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', et.id, 'name_en', app_private.expert_text(et.name_en), 'name_ar', app_private.expert_text(et.name_ar), 'archived', et.archived_at is not null) order by lower(coalesce(et.name_en, et.name_ar)), et.id), '[]'::jsonb)
    into v_tags from public.network_expert_tags x join public.expert_tags et on et.id = x.tag_id where x.expert_id = p_id;

  with pr as (select * from app_private.expert_participation(p_id))
  select jsonb_build_object(
           'programs', count(distinct x.program_id) filter (where not x.withdrawn), 'projects', count(distinct x.project_id) filter (where not x.withdrawn),
           'lists', count(*) filter (where not x.withdrawn), 'booking_sessions', coalesce(sum(x.booking_sessions) filter (where not x.withdrawn), 0),
           'distribution_sessions', coalesce(sum(x.distribution_sessions) filter (where not x.withdrawn), 0),
           'sessions', coalesce(sum(x.booking_sessions + x.distribution_sessions) filter (where not x.withdrawn), 0),
           'first_session_on', min(x.first_session_on) filter (where not x.withdrawn), 'last_session_on', max(x.last_session_on) filter (where not x.withdrawn),
           'first_listed_at', min(x.added_at) filter (where not x.withdrawn), 'withdrawn', count(*) filter (where x.withdrawn))
    into v_tot from pr x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', x.item_id,
           'node', jsonb_build_object('id', n.id, 'type', n.type, 'name_en', app_private.expert_text(n.name_en), 'name_ar', app_private.expert_text(n.name_ar)),
           'project', jsonb_build_object('id', j.id, 'name_en', app_private.expert_text(j.name_en), 'name_ar', app_private.expert_text(j.name_ar), 'completed_at', j.completed_at),
           'program', jsonb_build_object('id', g.id, 'name_en', app_private.expert_text(g.name_en), 'name_ar', app_private.expert_text(g.name_ar), 'year', g.year),
           'withdrawn', x.withdrawn, 'roles', jsonb_build_object('provider', x.is_provider, 'mentor', x.is_mentor, 'presenter', x.is_presenter),
           'booking_sessions', x.booking_sessions, 'distribution_sessions', x.distribution_sessions,
           'first_session_on', x.first_session_on, 'last_session_on', x.last_session_on, 'added_at', x.added_at)
           order by coalesce(x.last_session_on, x.added_at::date) desc, g.name_en, j.name_en, x.item_id), '[]'::jsonb)
    into v_part
    from app_private.expert_participation(p_id) x
    join public.nodes n on n.id = x.node_id join public.projects j on j.id = x.project_id join public.programs g on g.id = x.program_id
   where coalesce(app_private.is_project_manager(x.project_id), false);

  select jsonb_build_object('engagements', count(*), 'projects', count(distinct x.project_id), 'programs', count(distinct x.program_id))
    into v_hidden
    from app_private.expert_participation(p_id) x
   where not x.withdrawn and not coalesce(app_private.is_project_manager(x.project_id), false);

  if ne.merged_into is not null then
    select jsonb_build_object('id', m.id, 'name_en', app_private.expert_text(m.name_en), 'name_ar', app_private.expert_text(m.name_ar)) into v_into from public.network_experts m where m.id = ne.merged_into;
  end if;
  if v_sa then
    select coalesce(jsonb_agg(jsonb_build_object('merge_id', mg.id, 'drop_id', mg.drop_id, 'drop_name', mg.drop_name, 'merged_at', mg.merged_at) order by mg.merged_at desc), '[]'::jsonb)
      into v_abs from app_private.network_expert_merges mg where mg.keep_id = p_id;
  end if;

  return jsonb_build_object(
    'expert', jsonb_build_object('id', ne.id, 'kind', ne.kind, 'name_en', app_private.expert_text(ne.name_en), 'name_ar', app_private.expert_text(ne.name_ar), 'title_en', app_private.expert_text(ne.title_en), 'title_ar', app_private.expert_text(ne.title_ar),
                                 'company_en', app_private.expert_text(ne.company_en), 'company_ar', app_private.expert_text(ne.company_ar), 'bio_en', ne.bio_en, 'bio_ar', ne.bio_ar, 'photo_path', ne.photo_path,
                                 'linkedin_url', ne.linkedin_url, 'website_url', ne.website_url, 'links', ne.links, 'email', ne.email, 'phone', ne.phone,
                                 'languages', to_jsonb(ne.languages), 'notes', ne.notes, 'archived_at', ne.archived_at, 'deleted_at', ne.deleted_at, 'merged_into', ne.merged_into,
                                 'created_at', ne.created_at, 'updated_at', ne.updated_at),
    'tags', v_tags, 'totals', v_tot, 'participation', v_part, 'hidden', v_hidden, 'merged_into', v_into, 'absorbed', v_abs,
    'can', jsonb_build_object('edit', ne.deleted_at is null, 'archive', ne.deleted_at is null, 'merge', v_sa and ne.deleted_at is null, 'delete', v_sa and ne.deleted_at is null, 'restore', v_sa and ne.deleted_at is not null and ne.merged_into is null));
end $$;

-- ================================================================= 3. duplicates
-- Candidates for a record that is being typed (the create / edit form calls it as the name is entered): -> [{ id, score, reasons[], blocking, expert: {...light...} }]
create or replace function public.find_similar_network_experts(p_name_en text default null, p_name_ar text default null, p_email text default null, p_linkedin text default null,
                                                               p_exclude uuid default null, p_kind text default 'expert', p_limit integer default 6) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_kind, 'expert') not in ('expert', 'team') then perform app_private.expert_fail('kind', 'bad_value'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'score', s.score, 'reasons', to_jsonb(s.reasons), 'blocking', s.score >= 0.95,
                       'expert', jsonb_build_object('id', ne.id, 'kind', ne.kind, 'name_en', app_private.expert_text(ne.name_en), 'name_ar', app_private.expert_text(ne.name_ar), 'title_en', app_private.expert_text(ne.title_en), 'title_ar', app_private.expert_text(ne.title_ar),
                                                    'company_en', app_private.expert_text(ne.company_en), 'company_ar', app_private.expert_text(ne.company_ar), 'photo_path', ne.photo_path, 'archived_at', ne.archived_at))
                     order by s.score desc, ne.created_at, ne.id)
      from app_private.expert_find_similar(p_name_en, p_name_ar, p_email, p_linkedin, coalesce(p_kind, 'expert'), p_exclude, 0.6, p_limit) s
      join public.network_experts ne on ne.id = s.id), '[]'::jsonb);
end $$;

-- All probable duplicate PAIRS of the registry (super_admin): -> { pairs: [{ score, reasons[], a: {...}, b: {...} }], dismissed }
create or replace function public.list_expert_duplicate_pairs(p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_pairs jsonb; v_dismissed integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(app_private.is_super_admin(), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into v_dismissed from app_private.network_expert_nondup d
    join public.network_experts a on a.id = d.a and a.deleted_at is null join public.network_experts b on b.id = d.b and b.deleted_at is null;
  with cand as (
    select a.id as a_id, b.id as b_id, m.score, m.reasons
      from public.network_experts a
      join public.network_experts b on a.id < b.id and a.deleted_at is null and b.deleted_at is null and a.kind = b.kind
      cross join lateral app_private.expert_match(a.name_en, a.name_ar, a.email::text, a.linkedin_url, a.kind, a.name_skels, b.name_en, b.name_ar, b.email::text, b.linkedin_url, b.kind, b.name_skels) m
     where m.score >= 0.6 and not exists (select 1 from app_private.network_expert_nondup d where d.a = a.id and d.b = b.id)
     order by m.score desc, a.created_at, a.id, b.id
     limit least(greatest(coalesce(p_limit, 60), 1), 200))
  select coalesce(jsonb_agg(jsonb_build_object('score', c.score, 'reasons', to_jsonb(c.reasons),
           'a', jsonb_build_object('id', a.id, 'kind', a.kind, 'name_en', app_private.expert_text(a.name_en), 'name_ar', app_private.expert_text(a.name_ar), 'title_en', app_private.expert_text(a.title_en), 'title_ar', app_private.expert_text(a.title_ar), 'company_en', app_private.expert_text(a.company_en), 'company_ar', app_private.expert_text(a.company_ar), 'photo_path', a.photo_path, 'archived_at', a.archived_at),
           'b', jsonb_build_object('id', b.id, 'kind', b.kind, 'name_en', app_private.expert_text(b.name_en), 'name_ar', app_private.expert_text(b.name_ar), 'title_en', app_private.expert_text(b.title_en), 'title_ar', app_private.expert_text(b.title_ar), 'company_en', app_private.expert_text(b.company_en), 'company_ar', app_private.expert_text(b.company_ar), 'photo_path', b.photo_path, 'archived_at', b.archived_at))
         order by c.score desc, a.created_at, a.id, b.id), '[]'::jsonb)
    into v_pairs
    from cand c join public.network_experts a on a.id = c.a_id join public.network_experts b on b.id = c.b_id;
  return jsonb_build_object('pairs', v_pairs, 'dismissed', v_dismissed);
end $$;

-- ================================================================= 4. tags
-- -> [{ id, name_en, name_ar, archived, uses }] (uses = live experts carrying it); archived tags only when asked
create or replace function public.list_expert_tags(p_include_archived boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.expert_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name_en', app_private.expert_text(t.name_en), 'name_ar', app_private.expert_text(t.name_ar), 'archived', t.archived_at is not null,
                       'uses', (select count(*) from public.network_expert_tags x join public.network_experts ne on ne.id = x.expert_id and ne.deleted_at is null where x.tag_id = t.id))
                     order by lower(coalesce(t.name_en, t.name_ar)), t.id)
      from public.expert_tags t where coalesce(p_include_archived, false) or t.archived_at is null), '[]'::jsonb);
end $$;

-- ================================================================= grants (authenticated only; never anon; the helpers stay closed)
revoke all on function app_private.expert_text(text), app_private.expert_is_staff(), app_private.expert_fail(text, text),
  app_private.expert_match(text, text, text, text, text, text[], text, text, text, text, text, text[]),
  app_private.expert_find_similar(text, text, text, text, text, uuid, numeric, integer) from public, anon, authenticated;
revoke all on function public.list_network_experts(jsonb, text, text, integer, integer, text, boolean), public.get_network_expert(uuid),
  public.find_similar_network_experts(text, text, text, text, uuid, text, integer), public.list_expert_duplicate_pairs(integer),
  public.list_expert_tags(boolean) from public, anon;
grant execute on function public.list_network_experts(jsonb, text, text, integer, integer, text, boolean), public.get_network_expert(uuid),
  public.find_similar_network_experts(text, text, text, text, uuid, text, integer), public.list_expert_duplicate_pairs(integer),
  public.list_expert_tags(boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_network_experts', 'get_network_expert', 'find_similar_network_experts', 'list_expert_duplicate_pairs', 'list_expert_tags')
              and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'm76: anon can execute a registry function';
  end if;
  raise notice 'm76 ok';
end $$;

commit;
