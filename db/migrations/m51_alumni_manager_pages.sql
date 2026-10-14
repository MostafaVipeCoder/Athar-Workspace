-- m51_alumni_manager_pages.sql  (the SQL the MANAGER-side Alumni pages need beyond m49; builder task of 2026-10-14; design 09 sections 1.2 (M1 - M10), 13, 14.4)
-- Re-runnable (create or replace / if not exists / drop ... if exists). Local DB only. Run AFTER m49 and m50. Non-destructive: no row is changed or deleted.
--
-- What it adds (every function is SECURITY DEFINER with search_path = '' and manager-only unless said otherwise; anon executes none of them)
--   1. public.list_alumni_programs()              the programs and projects an alumni_manager may filter by (the programs / projects tables are closed to him by RLS)
--   2. public.list_alumni_table(...)              ONE page of the manager directory with ALL the owner's Excel columns as typed values (keys, not labels), server-side
--                                                 sort and paging, the same filter as the directory / export / analytics (alumni_filter_ids). The CEO's national ID is
--                                                 only ever MASKED here (reveal = get_alumni_founder, audited); the full number is in no list payload.
--   3. public.get_alumni_overview()               the dashboard aggregates that the analytics do not carry (completeness, review state, founders, invitations, notifications)
--   4. notifications: preview_notification_audience / send_alumni_notification / list_alumni_broadcasts. The audience is resolved ON THE SERVER (all founders, a
--                     program or project, companies, selected founders), one row per recipient ALWAYS with recipient_id, the text in the recipient's language, plain text.
--   5. opportunities: provider, archive, target filter (enforced by RLS for founders), type / length / link checks, application status vocabulary, and the
--                     manager may apply on behalf of a company (the m50 guard keeps founders honest).
--   6. public.import_alumni_preview(rows)         DRY RUN of the owner's Excel import (design 09 section 13): a plan per row, writes nothing
set search_path = public, extensions;

begin;

-- ================================================================= 1. programs + projects for the filters
create or replace function public.list_alumni_programs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  with ap as (select * from app_private.alumni_participations()),
       pc as (select p.program_id, count(distinct p.company_id)::int as n from ap p group by p.program_id),
       jc as (select p.project_id, count(distinct p.company_id)::int as n from ap p group by p.project_id)
  select jsonb_build_object('programs', coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar, 'program_type', g.program_type, 'year', g.year, 'archived', g.archived_at is not null,
           'companies', coalesce(pc.n, 0),
           'projects', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar, 'completed', j.completed_at is not null,
                                                                      'companies', coalesce(jc.n, 0)) order by j.created_at, j.id)
                                   from public.projects j left join jc on jc.project_id = j.id where j.program_id = g.id and j.deleted_at is null), '[]'::jsonb))
           order by g.created_at, g.id), '[]'::jsonb))
    into v from public.programs g left join pc on pc.program_id = g.id where g.deleted_at is null;
  return v;
end $$;

-- ================================================================= 2. the wide manager table
-- Same filter as the directory (alumni_filter_ids). One row per company with every typed value of the owner's 38 columns (lookups as KEYS: the browser labels them in
-- the UI language). Yearly metrics follow the export rule: revenue = the row of exactly `year`, the others the latest non-empty value up to `year`.
-- Sorts: name, updated, created, established, completeness, age (CEO), employees, funding, revenue, sector, stage; dir asc | desc.
create or replace function public.list_alumni_table(p_filters jsonb default '{}'::jsonb, p_limit integer default 25, p_offset integer default 0,
                                                    p_sort text default 'name', p_dir text default 'asc', p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := app_private.alumni_today(); v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100); v_off integer := greatest(coalesce(p_offset, 0), 0);
        v_sort text := coalesce(nullif(p_sort, ''), 'name'); v_dir text := lower(coalesce(nullif(p_dir, ''), 'asc')); v_year integer; v_rows jsonb; v_total integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_sort not in ('name', 'updated', 'created', 'established', 'completeness', 'age', 'employees', 'funding', 'revenue', 'sector', 'stage') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  if v_dir not in ('asc', 'desc') then perform app_private.alumni_fail('dir', 'bad_value'); end if;
  v_year := coalesce(p_year, (select max(s.period_year) from public.company_snapshots s where s.snapshot_type = 'annual')::int, 2023);
  if v_year < 1990 or v_year > 2100 then perform app_private.alumni_fail('year', 'out_of_range'); end if;

  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', v_today) i),
       ts as (select * from app_private.alumni_team_stats(v_today)),
       fa as (select * from app_private.alumni_founder_attrs(v_today)),
       ap as (select * from app_private.alumni_participations()),
       base as (
         select c.id, c.name_en, c.name_ar, c.logo_path, c.startup_type_key, c.sector_key, c.subsector_key, c.description_en, c.description_ar, c.stage, c.governorate_code,
                c.established_on, c.founding_year, c.app_url, c.website_url, c.links, c.linkedin_url, c.operating_status, c.closing_reason_key, c.closing_note, c.after_closing_key,
                c.legal_status_key, c.is_alumni, c.directory_visibility, c.updated_at, c.created_at, c.industry_en, c.industry_ar, c.governorate_en, c.governorate_ar,
                f.id as ceo_id, m.employees_total, m.employees_female, m.freelancers, m.funding_raised_total, m.traction, m.challenges, m.needs, m.revenue_year,
                (case when v_sort = 'completeness' then cardinality(app_private.alumni_company_missing(c.id)) end) as sk_missing
           from public.companies c
           join ids on ids.id = c.id
           left join public.founders f on f.id = app_private.alumni_company_ceo(c.id)
           left join lateral (
             select (array_agg(s.employees_total order by s.period_year desc) filter (where s.employees_total is not null))[1] as employees_total,
                    (array_agg(s.employees_female order by s.period_year desc) filter (where s.employees_female is not null))[1] as employees_female,
                    (array_agg(s.freelancers order by s.period_year desc) filter (where s.freelancers is not null))[1] as freelancers,
                    (array_agg(s.funding_raised_total order by s.period_year desc) filter (where s.funding_raised_total is not null))[1] as funding_raised_total,
                    (array_agg(s.traction order by s.period_year desc) filter (where s.traction is not null))[1] as traction,
                    (array_agg(s.challenges order by s.period_year desc) filter (where s.challenges is not null))[1] as challenges,
                    (array_agg(s.needs order by s.period_year desc) filter (where s.needs is not null))[1] as needs,
                    max(s.revenue_total) filter (where s.period_year = v_year) as revenue_year
               from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'annual' and s.period_year <= v_year) m on true),
       ordered as (
         select b.*, row_number() over (order by
                  case when v_dir = 'asc' then (case v_sort when 'name' then lower(coalesce(b.name_en, b.name_ar)) when 'sector' then b.sector_key when 'stage' then b.stage end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'name' then lower(coalesce(b.name_en, b.name_ar)) when 'sector' then b.sector_key when 'stage' then b.stage end) end desc nulls last,
                  case when v_dir = 'asc' then (case v_sort when 'updated' then extract(epoch from b.updated_at) when 'created' then extract(epoch from b.created_at)
                                                  when 'established' then extract(epoch from b.established_on::timestamp) when 'completeness' then (10 - b.sk_missing)::numeric
                                                  when 'age' then a.age::numeric when 'employees' then b.employees_total::numeric when 'funding' then b.funding_raised_total
                                                  when 'revenue' then b.revenue_year end) end asc nulls last,
                  case when v_dir = 'desc' then (case v_sort when 'updated' then extract(epoch from b.updated_at) when 'created' then extract(epoch from b.created_at)
                                                  when 'established' then extract(epoch from b.established_on::timestamp) when 'completeness' then (10 - b.sk_missing)::numeric
                                                  when 'age' then a.age::numeric when 'employees' then b.employees_total::numeric when 'funding' then b.funding_raised_total
                                                  when 'revenue' then b.revenue_year end) end desc nulls last,
                  lower(coalesce(b.name_en, b.name_ar)), b.id) as rn
           from base b left join fa a on a.founder_id = b.ceo_id),
       page as (select o.* from ordered o where o.rn > v_off and o.rn <= v_off + v_lim),
       progs as (select p.company_id,
                        jsonb_agg(distinct jsonb_build_object('id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar)) as programs,
                        jsonb_agg(distinct jsonb_build_object('id', j.id, 'name_en', j.name_en, 'name_ar', j.name_ar)) as projects
                   from ap p join public.projects j on j.id = p.project_id join public.programs g on g.id = p.program_id
                  where p.company_id in (select pg.id from page pg) group by p.company_id),
       supp as (select s.company_id, array_agg(distinct s.k order by s.k) as keys
                  from (select distinct p.company_id, k from ap p cross join lateral unnest(app_private.alumni_project_support(p.project_id)) k
                         where p.company_id in (select pg.id from page pg)) s group by s.company_id)
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', pg.id, 'name_en', pg.name_en, 'name_ar', pg.name_ar, 'logo_path', pg.logo_path,
             'programs', coalesce(pr.programs, '[]'::jsonb), 'projects', coalesce(pr.projects, '[]'::jsonb), 'support', to_jsonb(coalesce(su.keys, '{}'::text[])),
             'startup_type', pg.startup_type_key, 'hint', ci.hint, 'sector', pg.sector_key, 'subsector', pg.subsector_key,
             'description_en', pg.description_en, 'description_ar', pg.description_ar, 'stage', pg.stage,
             'governorate', pg.governorate_code, 'established_on', pg.established_on, 'founding_year', pg.founding_year,
             'app_url', pg.app_url, 'website_url', pg.website_url, 'social', app_private.alumni_social_links(pg.links, pg.linkedin_url), 'traction', pg.traction,
             'ceo', case when cf.id is not null then jsonb_build_object('founder_id', cf.id, 'name_en', cf.name_en, 'name_ar', cf.name_ar, 'phone', cf.phone, 'email', cf.email::text,
                      'id_masked', app_private.id_mask(idn.national_id), 'has_national_id', idn.national_id is not null, 'age', fa.age, 'age_category', fa.age_category,
                      'gender', fa.gender, 'governorate', fa.governorate_code, 'source', fa.source, 'education_status', cf.education_status) end,
             'operating_status', pg.operating_status, 'closing_reason', pg.closing_reason_key, 'closing_note', pg.closing_note, 'after_closing', pg.after_closing_key,
             'legal_status', pg.legal_status_key,
             'team', jsonb_build_object('size', coalesce(ts.team_size, 0), 'female_founders', coalesce(ts.female_founders, 0), 'under_35', coalesce(ts.founders_under_35, 0)),
             'metrics', jsonb_build_object('employees_total', pg.employees_total, 'employees_female', pg.employees_female, 'freelancers', pg.freelancers,
                                           'funding_raised_total', pg.funding_raised_total, 'revenue_total', pg.revenue_year, 'challenges', pg.challenges, 'needs', pg.needs),
             'is_alumni', pg.is_alumni, 'directory_visibility', pg.directory_visibility, 'directory_hidden', coalesce(ci.directory_hidden, false),
             'reviewed_at', ci.reviewed_at, 'updated_at', pg.updated_at,
             'completeness', app_private.alumni_completeness_json(app_private.alumni_company_missing(pg.id), 10),
             'legacy', jsonb_build_object('industry_en', pg.industry_en, 'industry_ar', pg.industry_ar, 'governorate_en', pg.governorate_en, 'governorate_ar', pg.governorate_ar))
           order by pg.rn), '[]'::jsonb),
         (select count(*) from ordered)::int
    into v_rows, v_total
    from page pg
    left join ts on ts.company_id = pg.id
    left join fa on fa.founder_id = pg.ceo_id
    left join public.company_internal ci on ci.company_id = pg.id
    left join public.founders cf on cf.id = pg.ceo_id
    left join public.founder_identities idn on idn.founder_id = pg.ceo_id
    left join progs pr on pr.company_id = pg.id
    left join supp su on su.company_id = pg.id;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'year', v_year, 'sort', v_sort, 'dir', v_dir, 'as_of', v_today, 'rows', v_rows);
end $$;

-- ================================================================= 3. dashboard aggregates (counts only; no person, no number)
create or replace function public.get_alumni_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_today date := app_private.alumni_today();
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  with c as (select co.id, co.is_alumni, co.operating_status, co.updated_at, ci.reviewed_at, app_private.alumni_company_missing(co.id) as missing
               from public.companies co left join public.company_internal ci on ci.company_id = co.id where co.deleted_at is null),
       al as (select * from c where c.is_alumni),
       ap as (select distinct p.company_id from app_private.alumni_participations() p),
       fo as (select f.id, f.auth_user_id, i.national_id is not null as has_id, (i.national_id is null and (i.self_birth_date is not null or i.self_gender is not null)) as self_only
                from public.founders f left join public.founder_identities i on i.founder_id = f.id where f.deleted_at is null),
       linked as (select distinct cf.founder_id from public.company_founders cf join al on al.id = cf.company_id),
       inv as (select case when i.status = 'pending' and i.sent_at + interval '14 days' <= now() then 'expired' else i.status end as st from public.alumni_invitations i),
       bc as (select n.broadcast_id, count(*) as n_rec, count(*) filter (where n.is_read) as n_read, min(n.created_at) as sent_at
                from public.notifications n where n.broadcast_id is not null group by n.broadcast_id),
       miss as (select k, count(*)::int as n from al cross join lateral unnest(al.missing) k group by k)
  select jsonb_build_object(
    'as_of', v_today,
    'latest_year', (select max(s.period_year) from public.company_snapshots s where s.snapshot_type = 'annual'),
    'companies', jsonb_build_object('total', (select count(*) from c), 'alumni', (select count(*) from al),
        'candidates', (select count(*) from c where not c.is_alumni and (c.id in (select company_id from ap) or exists (select 1 from public.company_founders cf where cf.company_id = c.id))),
        'open', (select count(*) from al where al.operating_status = 'open'), 'closed', (select count(*) from al where al.operating_status = 'closed')),
    'review', jsonb_build_object('current', (select count(*) from al where al.reviewed_at is not null and al.reviewed_at >= al.updated_at),
        'changed_since', (select count(*) from al where al.reviewed_at is not null and al.reviewed_at < al.updated_at), 'never', (select count(*) from al where al.reviewed_at is null)),
    'completeness', jsonb_build_object('average', (select round(avg((10 - cardinality(al.missing)) * 10.0)) from al), 'incomplete', (select count(*) from al where cardinality(al.missing) > 0),
        'complete', (select count(*) from al where cardinality(al.missing) = 0),
        'missing_by', (select coalesce(jsonb_agg(jsonb_build_object('key', miss.k, 'count', miss.n) order by miss.n desc, miss.k), '[]'::jsonb) from miss)),
    'founders', jsonb_build_object('total', (select count(*) from fo), 'with_account', (select count(*) from fo where fo.auth_user_id is not null),
        'alumni_founders', (select count(*) from linked), 'with_national_id', (select count(*) from fo where fo.has_id), 'self_declared', (select count(*) from fo where fo.self_only),
        'no_identity', (select count(*) from fo where not fo.has_id and not fo.self_only)),
    'invitations', jsonb_build_object('total', (select count(*) from inv), 'pending', (select count(*) from inv where inv.st = 'pending'), 'accepted', (select count(*) from inv where inv.st = 'accepted'),
        'expired', (select count(*) from inv where inv.st = 'expired'), 'revoked', (select count(*) from inv where inv.st = 'revoked')),
    'notifications', jsonb_build_object('broadcasts_30d', (select count(*) from bc where bc.sent_at > now() - interval '30 days'),
        'recipients_30d', (select coalesce(sum(bc.n_rec), 0) from bc where bc.sent_at > now() - interval '30 days'),
        'read_30d', (select coalesce(sum(bc.n_read), 0) from bc where bc.sent_at > now() - interval '30 days')))
    into v;
  return v;
end $$;

-- ================================================================= 4. notifications: the audience is resolved on the server
-- audience = { kind: 'all' | 'program' | 'company' | 'founder', program_id?, project_id?, company_ids?[], founder_ids?[] }
-- Returns one row per DISTINCT recipient (founder_id may be NULL for a participant account that has no founders row; user_id NULL = a founder record without an account).
create or replace function app_private.alumni_audience(p_audience jsonb) returns table (founder_id uuid, user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text; v_program uuid; v_project uuid; v_companies uuid[]; v_founders uuid[]; k text;
begin
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then perform app_private.alumni_fail('audience', 'not_an_object'); end if;
  for k in select jsonb_object_keys(p_audience) loop
    if k not in ('kind', 'program_id', 'project_id', 'company_ids', 'founder_ids') then perform app_private.alumni_fail('audience', 'unknown_key'); end if;
  end loop;
  v_kind := p_audience->>'kind';
  if v_kind is null or v_kind not in ('all', 'program', 'company', 'founder') then perform app_private.alumni_fail('audience', 'bad_value'); end if;
  if v_kind = 'all' then
    return query select f.id, f.auth_user_id from public.founders f where f.deleted_at is null;
    return;
  end if;
  if v_kind = 'program' then
    begin v_program := nullif(p_audience->>'program_id', '')::uuid; v_project := nullif(p_audience->>'project_id', '')::uuid;
    exception when others then perform app_private.alumni_fail('audience', 'bad_value'); end;
    if v_program is null and v_project is null then perform app_private.alumni_fail('audience', 'required'); end if;
    if v_project is not null then
      if not exists (select 1 from public.projects j where j.id = v_project and j.deleted_at is null and (v_program is null or j.program_id = v_program)) then perform app_private.alumni_fail('audience', 'unknown'); end if;
    elsif not exists (select 1 from public.programs g where g.id = v_program and g.deleted_at is null) then perform app_private.alumni_fail('audience', 'unknown');
    end if;
    return query
      select x.fid, x.uid from (
        select f.id as fid, f.auth_user_id as uid
          from app_private.alumni_participations() ap
          join public.company_founders cf on cf.company_id = ap.company_id
          join public.founders f on f.id = cf.founder_id and f.deleted_at is null
         where (v_project is not null and ap.project_id = v_project) or (v_project is null and ap.program_id = v_program)
        union
        select f.id, pa.user_id
          from public.participants pa
          join public.projects j on j.id = pa.project_id and j.deleted_at is null
          left join public.founders f on f.auth_user_id = pa.user_id and f.deleted_at is null
         where pa.user_id is not null and pa.status in ('accepted', 'attended')
           and ((v_project is not null and pa.project_id = v_project) or (v_project is null and j.program_id = v_program))
           and exists (select 1 from public.user_roles r where r.user_id = pa.user_id and r.role_key = 'founder')) x;
    return;
  end if;
  if v_kind = 'company' then
    begin select coalesce(array_agg(e::uuid), '{}') into v_companies from jsonb_array_elements_text(coalesce(p_audience->'company_ids', '[]'::jsonb)) e;
    exception when others then perform app_private.alumni_fail('audience', 'bad_value'); end;
    if cardinality(v_companies) = 0 then perform app_private.alumni_fail('audience', 'required'); end if;
    if cardinality(v_companies) > 200 then perform app_private.alumni_fail('audience', 'too_many'); end if;
    return query select distinct f.id, f.auth_user_id from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null where cf.company_id = any (v_companies);
    return;
  end if;
  begin select coalesce(array_agg(e::uuid), '{}') into v_founders from jsonb_array_elements_text(coalesce(p_audience->'founder_ids', '[]'::jsonb)) e;
  exception when others then perform app_private.alumni_fail('audience', 'bad_value'); end;
  if cardinality(v_founders) = 0 then perform app_private.alumni_fail('audience', 'required'); end if;
  if cardinality(v_founders) > 500 then perform app_private.alumni_fail('audience', 'too_many'); end if;
  return query select f.id, f.auth_user_id from public.founders f where f.deleted_at is null and f.id = any (v_founders);
end $$;

create or replace function public.preview_notification_audience(p_audience jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object('recipients', count(*) filter (where a.user_id is not null), 'without_account', count(*) filter (where a.user_id is null),
           'sample', coalesce((select jsonb_agg(jsonb_build_object('founder_id', s.founder_id, 'name_en', f.name_en, 'name_ar', f.name_ar))
                                 from (select x.founder_id from app_private.alumni_audience(p_audience) x where x.user_id is not null and x.founder_id is not null order by x.founder_id limit 5) s
                                 join public.founders f on f.id = s.founder_id), '[]'::jsonb))
    into v from app_private.alumni_audience(p_audience) a;
  return v;
end $$;

-- ONE row per recipient, ALWAYS with recipient_id; title / body in the recipient's profile language (ar default), the full bilingual text in metadata. Plain text (the
-- founder page renders it as text; markup is never interpreted). At least one language of the title and of the body.
-- p_link: an in-app path ("/alumni/founder/opportunities") or an http(s) URL; p_opportunity: an opportunity the founder page opens with one tap (both optional, both go to the metadata the
-- founder inbox already reads: metadata.link / metadata.opportunity_id)
drop function if exists public.send_alumni_notification(jsonb, text, text, text, text);
create or replace function public.send_alumni_notification(p_audience jsonb, p_title_en text, p_title_ar text, p_body_en text, p_body_ar text, p_link text default null, p_opportunity uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_kind text; v_te text := nullif(btrim(coalesce(p_title_en, '')), ''); v_ta text := nullif(btrim(coalesce(p_title_ar, '')), '');
        v_be text := nullif(btrim(coalesce(p_body_en, '')), ''); v_ba text := nullif(btrim(coalesce(p_body_ar, '')), ''); v_bid uuid := gen_random_uuid(); v_target uuid;
        v_n integer; v_without integer; v_meta jsonb; v_link text := nullif(btrim(coalesce(p_link, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_link is not null and (char_length(v_link) > 500 or (v_link !~ '^/[^/[:space:]][^[:space:]]*$' and v_link !~* '^https?://[^[:space:]]+$')) then perform app_private.alumni_fail('link', 'bad_url'); end if;
  if p_opportunity is not null and not exists (select 1 from public.opportunities o where o.opportunity_id = p_opportunity) then perform app_private.alumni_fail('opportunity', 'unknown'); end if;
  if coalesce(v_te, v_ta) is null then perform app_private.alumni_fail('title', 'required'); end if;
  if coalesce(v_be, v_ba) is null then perform app_private.alumni_fail('body', 'required'); end if;
  if char_length(coalesce(v_te, '')) > 200 or char_length(coalesce(v_ta, '')) > 200 then perform app_private.alumni_fail('title', 'too_long'); end if;
  if char_length(coalesce(v_be, '')) > 4000 or char_length(coalesce(v_ba, '')) > 4000 then perform app_private.alumni_fail('body', 'too_long'); end if;
  -- resolving the audience FIRST validates it (unknown key, bad id, unknown program ...) with an alumni_invalid error before any value is cast
  select count(*) filter (where a.user_id is not null), count(*) filter (where a.user_id is null) into v_n, v_without from app_private.alumni_audience(p_audience) a;
  if v_n = 0 then perform app_private.alumni_fail('audience', 'empty'); end if;
  if v_n > 5000 then perform app_private.alumni_fail('audience', 'too_many'); end if;
  v_kind := p_audience->>'kind';
  -- the single target (a program, a company or a founder) is kept in audience_target_id for the history; several targets stay in the metadata count
  if v_kind = 'program' then v_target := coalesce(nullif(p_audience->>'program_id', '')::uuid, (select j.program_id from public.projects j where j.id = nullif(p_audience->>'project_id', '')::uuid));
  elsif v_kind = 'company' and jsonb_array_length(coalesce(p_audience->'company_ids', '[]'::jsonb)) = 1 then v_target := (p_audience->'company_ids'->>0)::uuid;
  elsif v_kind = 'founder' and jsonb_array_length(coalesce(p_audience->'founder_ids', '[]'::jsonb)) = 1 then v_target := (p_audience->'founder_ids'->>0)::uuid;
  end if;
  v_meta := jsonb_strip_nulls(jsonb_build_object('title_en', v_te, 'title_ar', v_ta, 'body_en', v_be, 'body_ar', v_ba, 'v', 1, 'link', v_link, 'opportunity_id', p_opportunity,
              'project_id', nullif(p_audience->>'project_id', ''), 'targets', coalesce(jsonb_array_length(p_audience->'company_ids'), jsonb_array_length(p_audience->'founder_ids'))));
  insert into public.notifications (recipient_id, founder_id, title, body, audience_type, audience_target_id, broadcast_id, sent_by, metadata)
  select a.user_id, a.founder_id,
         case when coalesce(pr.language, 'ar') = 'ar' then coalesce(v_ta, v_te) else coalesce(v_te, v_ta) end,
         case when coalesce(pr.language, 'ar') = 'ar' then coalesce(v_ba, v_be) else coalesce(v_be, v_ba) end,
         v_kind, v_target, v_bid, v_uid, v_meta
    from app_private.alumni_audience(p_audience) a left join public.profiles pr on pr.id = a.user_id
   where a.user_id is not null;
  return jsonb_build_object('broadcast_id', v_bid, 'recipients', v_n, 'without_account', v_without);
end $$;

-- the history: one row per broadcast with its recipients and how many of them read it (a recipient count, no names; the names are one direct query away for a manager)
create or replace function public.list_alumni_broadcasts(p_limit integer default 20, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 100); v_off integer := greatest(coalesce(p_offset, 0), 0); v_rows jsonb; v_total integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  with b as (select n.broadcast_id, min(n.created_at) as sent_at, (array_agg(n.audience_type))[1] as audience_type, (array_agg(n.audience_target_id))[1] as target,
                    (array_agg(n.sent_by))[1] as sent_by, (array_agg(n.metadata))[1] as meta, (array_agg(n.title))[1] as title, (array_agg(n.body))[1] as body,
                    count(*)::int as recipients, (count(*) filter (where n.is_read))::int as reads
               from public.notifications n where n.broadcast_id is not null group by n.broadcast_id),
       pg as (select * from b order by b.sent_at desc, b.broadcast_id limit v_lim offset v_off)
  select coalesce(jsonb_agg(jsonb_build_object('broadcast_id', pg.broadcast_id, 'sent_at', pg.sent_at, 'audience_type', pg.audience_type, 'target_id', pg.target,
           'target_name_en', case pg.audience_type when 'program' then (select g.name_en from public.programs g where g.id = pg.target)
                                                   when 'company' then (select c.name_en from public.companies c where c.id = pg.target)
                                                   when 'founder' then (select f.name_en from public.founders f where f.id = pg.target) end,
           'target_name_ar', case pg.audience_type when 'program' then (select g.name_ar from public.programs g where g.id = pg.target)
                                                   when 'company' then (select c.name_ar from public.companies c where c.id = pg.target)
                                                   when 'founder' then (select f.name_ar from public.founders f where f.id = pg.target) end,
           'sent_by', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = pg.sent_by),
           'title_en', coalesce(pg.meta->>'title_en', pg.title), 'title_ar', coalesce(pg.meta->>'title_ar', pg.title),
           'body_en', coalesce(pg.meta->>'body_en', pg.body), 'body_ar', coalesce(pg.meta->>'body_ar', pg.body),
           'recipients', pg.recipients, 'reads', pg.reads) order by pg.sent_at desc, pg.broadcast_id), '[]'::jsonb)
    into v_rows from pg;
  select count(distinct n.broadcast_id)::int into v_total from public.notifications n where n.broadcast_id is not null;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- ================================================================= 5. opportunities: provider, archive, target filter, vocabulary checks
alter table public.opportunities add column if not exists provider_en text;
alter table public.opportunities add column if not exists provider_ar text;
alter table public.opportunities add column if not exists archived_at timestamptz;
alter table public.opportunities add column if not exists target jsonb not null default '{}'::jsonb;

-- NOT VALID: the new rule applies to every new / changed row; an old row is never rejected retroactively (the table is empty today)
alter table public.opportunities drop constraint if exists opportunities_type_chk;
alter table public.opportunities add constraint opportunities_type_chk check (type in ('grant', 'investment', 'event', 'competition', 'partnership', 'other')) not valid;
alter table public.opportunities drop constraint if exists opportunities_archived_chk;
alter table public.opportunities add constraint opportunities_archived_chk check (archived_at is null or not is_active) not valid;
alter table public.opportunities drop constraint if exists opportunities_text_chk;
alter table public.opportunities add constraint opportunities_text_chk check (
  char_length(title_ar) <= 200 and char_length(coalesce(title_en, '')) <= 200 and char_length(coalesce(description_ar, '')) <= 4000 and char_length(coalesce(description_en, '')) <= 4000
  and char_length(coalesce(eligibility, '')) <= 2000 and char_length(coalesce(provider_en, '')) <= 200 and char_length(coalesce(provider_ar, '')) <= 200) not valid;
alter table public.opportunities drop constraint if exists opportunities_link_chk;
alter table public.opportunities add constraint opportunities_link_chk check (link is null or (link ~* '^https?://[^[:space:]]+$' and char_length(link) <= 500)) not valid;

-- target = { program_ids?[], sectors?[], stages?[], governorates?[] } (every key optional; an empty list = no restriction on that key; {} = everybody). Validated here for every writer.
create or replace function app_private.opportunities_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb; e text; clean jsonb := '{}'::jsonb;
begin
  if new.target is null then new.target := '{}'::jsonb; end if;
  if jsonb_typeof(new.target) <> 'object' then perform app_private.alumni_fail('target', 'not_an_object'); end if;
  for k in select jsonb_object_keys(new.target) loop
    if k not in ('program_ids', 'sectors', 'stages', 'governorates') then perform app_private.alumni_fail('target', 'unknown_key'); end if;
    v := new.target->k;
    if jsonb_typeof(v) <> 'array' then perform app_private.alumni_fail(k, 'not_an_array'); end if;
    if jsonb_array_length(v) > 50 then perform app_private.alumni_fail(k, 'too_many'); end if;
    if jsonb_array_length(v) = 0 then continue; end if;
    for e in select jsonb_array_elements_text(v) loop
      if k = 'program_ids' then
        if e !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (select 1 from public.programs g where g.id = e::uuid) then perform app_private.alumni_fail(k, 'unknown'); end if;
      elsif k = 'sectors' then
        if not app_private.alumni_lookup_ok('sector', e) then perform app_private.alumni_fail(k, 'unknown'); end if;
      elsif k = 'stages' then
        if not app_private.alumni_lookup_ok('stage', e) then perform app_private.alumni_fail(k, 'unknown'); end if;
      else
        if e !~ '^[0-9]{1,2}$' or not exists (select 1 from app_private.eg_governorates() g where g.code = e::int and not g.is_abroad) then perform app_private.alumni_fail(k, 'unknown'); end if;
      end if;
    end loop;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  new.target := clean;
  return new;
end $$;
drop trigger if exists opportunities_biu_guard on public.opportunities;
create trigger opportunities_biu_guard before insert or update on public.opportunities for each row execute function app_private.opportunities_guard();

-- does a founder see an opportunity? target {} = everybody; otherwise ONE of his companies must match EVERY key given (a key's list is "any of"). Used by the RLS policy below
-- (executed as the founder: granted to `authenticated`, no other API role). Participation = app_private.alumni_participations() (the single definition).
create or replace function app_private.opportunity_visible_to_me(p_target jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_target, '{}'::jsonb) = '{}'::jsonb
      or exists (
           select 1 from public.companies c
            where c.id in (select app_private.my_company_ids()) and c.deleted_at is null
              and (jsonb_array_length(coalesce(p_target->'sectors', '[]'::jsonb)) = 0 or c.sector_key in (select jsonb_array_elements_text(p_target->'sectors')))
              and (jsonb_array_length(coalesce(p_target->'stages', '[]'::jsonb)) = 0 or c.stage in (select jsonb_array_elements_text(p_target->'stages')))
              and (jsonb_array_length(coalesce(p_target->'governorates', '[]'::jsonb)) = 0 or c.governorate_code::text in (select jsonb_array_elements_text(p_target->'governorates')))
              and (jsonb_array_length(coalesce(p_target->'program_ids', '[]'::jsonb)) = 0
                   or exists (select 1 from app_private.alumni_participations() ap where ap.company_id = c.id and ap.program_id::text in (select jsonb_array_elements_text(p_target->'program_ids')))))
$$;

drop policy if exists opportunities_select_roles on public.opportunities;
create policy opportunities_select_roles on public.opportunities for select to authenticated using (
  (select app_private.has_any_role(array['alumni_manager', 'super_admin']))
  or (is_active and (select app_private.has_role('project_manager')))
  or (is_active and (select app_private.has_role('founder')) and app_private.opportunity_visible_to_me(target)));

-- applications: a closed vocabulary; the manager may apply on behalf of any company (a founder: his own company only, an opportunity he can see). The m50 guard forces
-- status / applied_at / the note rules for a non-manager.
alter table public.opportunity_applications drop constraint if exists opportunity_applications_status_chk;
alter table public.opportunity_applications add constraint opportunity_applications_status_chk check (status in ('applied', 'reviewing', 'shortlisted', 'accepted', 'rejected')) not valid;
update public.opportunity_applications set status = 'applied' where status is null;
alter table public.opportunity_applications alter column status set not null;

drop policy if exists opportunity_applications_insert_own on public.opportunity_applications;
create policy opportunity_applications_insert_own on public.opportunity_applications for insert to authenticated with check (
  ((select app_private.has_any_role(array['alumni_manager', 'super_admin']))
   or (company_id in (select app_private.my_company_ids()) and (founder_id is null or founder_id in (select app_private.my_founder_ids()))))
  and exists (select 1 from public.opportunities o where o.opportunity_id = opportunity_applications.opportunity_id));

-- ================================================================= 6. the owner's Excel import: a DRY-RUN preview (design 09 section 13; NOTHING is written, nothing is logged)
-- Input: a JSON array (<= 500) of objects keyed by the owner's header texts (matched case / space / punctuation insensitively; the typo "Date of company stabilished" is accepted too).
-- Output: a plan per row (create / update / error) with every problem, the lookup values that match nothing (PROPOSED as new vocabulary values, never created here) and the header
-- report. Matching (design 09 13.3): the CEO's national ID, then the CEO's e-mail, then the name; two different companies = `ambiguous_match` (an error for the manager, never a silent
-- merge). The national ID is NEVER echoed (a masked value and the derived age / gender / governorate only); derived columns of the sheet are ignored (and compared as a warning).
create or replace function app_private.alumni_issue(p_field text, p_code text, p_level text, p_value text default null) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('field', p_field, 'code', p_code, 'level', p_level, 'value', left(p_value, 80)))
$$;

-- a lookup value typed as its key, its English label or its Arabic label (case / punctuation / alef-ya-ta-marbuta insensitive) -> the key, else NULL
create or replace function app_private.alumni_resolve_lookup(p_kind text, p_text text, p_parent text default null) returns text
language sql stable security definer set search_path = '' as $$
  select l.key from public.alumni_lookups l
   where l.kind = p_kind and (p_parent is null or l.parent_key = p_parent) and nullif(btrim(coalesce(p_text, '')), '') is not null
     and (l.key = lower(btrim(p_text)) or app_private.alumni_norm_text(l.label_en) = app_private.alumni_norm_text(p_text) or app_private.alumni_norm_text(l.label_ar) = app_private.alumni_norm_text(p_text))
   order by l.sort_order, l.key limit 1
$$;

create or replace function app_private.alumni_to_number(p text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare s text := replace(replace(replace(btrim(coalesce(p, '')), ',', ''), ' ', ''), E' ', '');
begin
  if s = '' then return null; end if;
  if s !~ '^-?[0-9]{1,15}(\.[0-9]{1,4})?$' then return null; end if;
  return s::numeric;
end $$;

-- ISO date / year only / d/m/y (Egypt) -> date; NULL when it is not one
create or replace function app_private.alumni_to_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, '')); m text[];
begin
  if s = '' then return null; end if;
  if s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then return left(s, 10)::date; end if;
  if s ~ '^[0-9]{4}$' then return make_date(s::int, 1, 1); end if;
  m := regexp_match(s, '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$');
  if m is not null then return make_date(m[3]::int, m[2]::int, m[1]::int); end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.import_alumni_preview(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app_private.alumni_today(); v_n integer; v_i integer := 0; r jsonb; nr jsonb; v_issues jsonb; v_props jsonb := '[]'::jsonb; v_out jsonb := '[]'::jsonb;
  v_known text[] := array['startupname', 'programscope', 'programname', 'supportprovided', 'startuptype', 'hint', 'sector', 'subsector', 'description', 'stage', 'governerate', 'governorate',
    'dateofcompanyestablished', 'dateofcompanystabilished', 'app', 'website', 'socialmedia', 'tractionvalidation', 'ceoname', 'phone', 'email', 'id', 'ceoage', 'agecategory', 'studentgraduate',
    'ceogender', 'openclosed', 'reasonforclosing', 'afterclosing', 'legalstatus', 'foundingteamsize', 'femalefounders', 'nuoffoundersbelow35', 'nuofemployees', 'nuoffemaleemployees',
    'numberoffreelancers', 'fundingraised', 'challenges', 'needs'];
  v_derived_names text[] := array['Program Scope', 'Program Name', 'Support provided', 'CEO Age', 'Age Category', 'CEO Gender', 'Founding team size', 'Female founders', 'Nu. of founders below 35'];
  v_owner_headers text[] := array['Startup Name', 'Program Scope', 'Program Name', 'Support provided', 'Startup type', 'Hint', 'Sector', 'Sub sector', 'Description', 'Stage', 'Governerate',
    'Date of company established', 'App', 'Website', 'Social media', 'Traction/Validation', 'CEO Name', 'Phone', 'Email', 'ID', 'CEO Age', 'Age Category', 'Student/Graduate', 'CEO Gender',
    'Open/Closed', 'Reason for closing', 'After closing', 'Legal Status', 'Founding team size', 'Female founders', 'Nu. of founders below 35', 'Nu. of employees', 'Nu. of female employees',
    'Number of freelancers', 'Funding raised', 'Revenue (<year>) (Total)', 'Challenges', 'Needs'];
  v_present text[]; v_unknown jsonb; v_missing jsonb; v_year integer; v_plan text; v_company uuid; v_cand uuid[]; v_name text; v_idraw text; v_id text; v_reason text; v_email text; v_val text;
  v_sector text; v_key text; v_num numeric; v_num2 numeric; v_d date; v_gender text; v_age integer; v_ag_typed numeric; v_has_id boolean; v_ceo jsonb; v_idx integer := 0; v_errs integer; v_warns integer;
  v_sum_create integer := 0; v_sum_update integer := 0; v_sum_error integer := 0; v_sum_warn integer := 0; v_status text; h record; k text; kv record;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then perform app_private.alumni_fail('rows', 'not_an_array'); end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then perform app_private.alumni_fail('rows', 'required'); end if;
  if v_n > 500 then perform app_private.alumni_fail('rows', 'too_many'); end if;

  -- header report: which headers of the sheet are known / unknown, which owner headers are absent
  select coalesce(array_agg(distinct app_private.alumni_norm_text(x.k)), '{}') into v_present from (select jsonb_object_keys(e) as k from jsonb_array_elements(p_rows) e where jsonb_typeof(e) = 'object') x;
  select coalesce(jsonb_agg(distinct x.k), '[]'::jsonb) into v_unknown from (select jsonb_object_keys(e) as k from jsonb_array_elements(p_rows) e where jsonb_typeof(e) = 'object') x
   where app_private.alumni_norm_text(x.k) <> all (v_known) and app_private.alumni_norm_text(x.k) !~ '^revenue[0-9]{4}total$';
  select coalesce(jsonb_agg(h2.hdr order by h2.o), '[]'::jsonb) into v_missing from unnest(v_owner_headers) with ordinality h2(hdr, o)
   where case when h2.hdr = 'Revenue (<year>) (Total)' then not exists (select 1 from unnest(v_present) p where p ~ '^revenue[0-9]{4}total$')
              when h2.hdr = 'Governerate' then not ('governerate' = any (v_present) or 'governorate' = any (v_present))
              when h2.hdr = 'Date of company established' then not ('dateofcompanyestablished' = any (v_present) or 'dateofcompanystabilished' = any (v_present))
              else not (app_private.alumni_norm_text(h2.hdr) = any (v_present)) end;

  for r in select e from jsonb_array_elements(p_rows) e loop
    v_idx := v_idx + 1; v_issues := '[]'::jsonb; v_plan := 'create'; v_company := null; v_ceo := null; v_has_id := false; v_gender := null; v_age := null;
    if jsonb_typeof(r) <> 'object' then
      v_i := v_i + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('row', v_idx, 'name', null, 'plan', 'error', 'issues', jsonb_build_array(app_private.alumni_issue('row', 'not_an_object', 'error')), 'errors', 1, 'warnings', 0));
      v_sum_error := v_sum_error + 1; continue;
    end if;
    select coalesce(jsonb_object_agg(app_private.alumni_norm_text(kv2.k), nullif(btrim(kv2.v), '')), '{}'::jsonb) into nr from jsonb_each_text(r) kv2(k, v);
    -- an entirely blank row is skipped, not reported
    if not exists (select 1 from jsonb_each_text(nr) q where q.value is not null) then continue; end if;
    v_i := v_i + 1;

    v_name := nr->>'startupname';
    if v_name is null then v_issues := v_issues || app_private.alumni_issue('Startup Name', 'required', 'error');
    elsif char_length(v_name) > 200 then v_issues := v_issues || app_private.alumni_issue('Startup Name', 'too_long', 'error'); end if;

    -- ---- the CEO's national ID: validated by the database rules, never echoed
    v_idraw := nr->>'id';
    if v_idraw is not null then
      v_id := app_private.id_normalize(v_idraw);
      v_reason := app_private.id_invalid_reason(v_id, v_today);
      if v_reason is not null then v_issues := v_issues || app_private.alumni_issue('ID', 'invalid_id', 'error', v_reason);
      else
        v_has_id := true; v_age := app_private.id_age(v_id, v_today); v_gender := app_private.id_gender(v_id);
        v_ceo := jsonb_build_object('age', v_age, 'age_category', app_private.id_age_category(v_age), 'gender', v_gender, 'governorate', app_private.id_governorate_code(v_id),
                                        'id_masked', app_private.id_mask(v_id), 'source', 'id');
        -- the derived columns of the sheet are ignored; a disagreement is worth a warning
        v_val := app_private.alumni_resolve_lookup('gender', nr->>'ceogender');
        if v_val is not null and v_val <> v_gender then v_issues := v_issues || app_private.alumni_issue('CEO Gender', 'derived_mismatch', 'warning', v_val); end if;
        v_ag_typed := app_private.alumni_to_number(nr->>'ceoage');
        if v_ag_typed is not null and abs(v_ag_typed - v_age) > 1 then v_issues := v_issues || app_private.alumni_issue('CEO Age', 'derived_mismatch', 'warning', v_ag_typed::text); end if;
      end if;
    elsif nr->>'ceogender' is not null or nr->>'ceoage' is not null then
      v_issues := v_issues || app_private.alumni_issue('ID', 'self_declared_only', 'warning');
    end if;

    -- ---- matching: ID, then e-mail, then name. Two different companies = ambiguous.
    v_email := lower(nr->>'email');
    if v_email is not null and (v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254) then
      v_issues := v_issues || app_private.alumni_issue('Email', 'bad_email', 'error'); v_email := null;
    end if;
    select coalesce(array_agg(distinct x.cid), '{}') into v_cand from (
      select cf.company_id as cid from public.founder_identities i join public.company_founders cf on cf.founder_id = i.founder_id join public.companies c on c.id = cf.company_id and c.deleted_at is null
       where v_has_id and i.national_id = v_id
      union all
      select cf.company_id from public.founders f join public.company_founders cf on cf.founder_id = f.id join public.companies c on c.id = cf.company_id and c.deleted_at is null
       where v_email is not null and f.deleted_at is null and lower(f.email::text) = v_email
      union all
      select c.id from public.companies c where v_name is not null and c.deleted_at is null and (lower(btrim(c.name_en)) = lower(v_name) or lower(btrim(c.name_ar)) = lower(v_name))) x;
    if cardinality(v_cand) = 1 then v_plan := 'update'; v_company := v_cand[1];
    elsif cardinality(v_cand) > 1 then v_plan := 'error'; v_issues := v_issues || app_private.alumni_issue('Startup Name', 'ambiguous_match', 'error', cardinality(v_cand)::text); end if;

    -- ---- vocabulary values: a label that matches nothing is PROPOSED as a new value (open lists) or refused (closed lists)
    v_sector := null;
    for h in select * from (values ('startuptype', 'Startup type', 'startup_type', true), ('sector', 'Sector', 'sector', true), ('subsector', 'Sub sector', 'subsector', true), ('stage', 'Stage', 'stage', true),
                                   ('legalstatus', 'Legal Status', 'legal_status', true), ('reasonforclosing', 'Reason for closing', 'closing_reason', true),
                                   ('afterclosing', 'After closing', 'after_closing', true), ('studentgraduate', 'Student/Graduate', 'education_status', false),
                                   ('openclosed', 'Open/Closed', 'operating_status', false)) t(hk, hdr, kind, open_list) loop
      v_val := nr->>h.hk;
      if v_val is null then continue; end if;
      if h.kind = 'subsector' then v_key := app_private.alumni_resolve_lookup('subsector', v_val, v_sector);
      elsif h.kind = 'sector' then v_key := coalesce(app_private.alumni_resolve_lookup('sector', v_val), app_private.alumni_sector_from_text(v_val)); v_sector := v_key;
      else v_key := app_private.alumni_resolve_lookup(h.kind, v_val); end if;
      if h.kind = 'operating_status' and v_key is null then v_key := case when app_private.alumni_norm_text(v_val) in ('open', 'مفتوح', 'مفتوحه', 'active', 'نشط') then 'open'
                                                                          when app_private.alumni_norm_text(v_val) in ('closed', 'مغلق', 'مغلقه', 'inactive') then 'closed' end; end if;
      if v_key is null then
        v_issues := v_issues || app_private.alumni_issue(h.hdr, case when h.open_list then 'unknown_value' else 'closed_vocabulary' end, 'error', v_val);
        if h.open_list then v_props := v_props || jsonb_build_array(jsonb_build_object('kind', h.kind, 'value', v_val, 'parent', case when h.kind = 'subsector' then v_sector end, 'header', h.hdr)); end if;
      elsif h.kind = 'operating_status' then v_status := v_key; end if;
    end loop;
    if v_status = 'open' and (nr->>'reasonforclosing' is not null or nr->>'afterclosing' is not null) then v_issues := v_issues || app_private.alumni_issue('Reason for closing', 'requires_closed', 'warning'); end if;
    v_status := null;

    -- ---- governorate (company location / fallback), established date, URLs, numbers
    v_val := coalesce(nr->>'governerate', nr->>'governorate');
    if v_val is not null and app_private.eg_governorate_from_text(v_val) is null then v_issues := v_issues || app_private.alumni_issue('Governerate', 'unknown_value', 'error', v_val); end if;
    v_val := coalesce(nr->>'dateofcompanyestablished', nr->>'dateofcompanystabilished');
    if v_val is not null then
      v_d := app_private.alumni_to_date(v_val);
      if v_d is null then v_issues := v_issues || app_private.alumni_issue('Date of company established', 'bad_date', 'error', v_val);
      elsif v_d > v_today then v_issues := v_issues || app_private.alumni_issue('Date of company established', 'future', 'error', v_val);
      elsif v_d < date '1900-01-01' then v_issues := v_issues || app_private.alumni_issue('Date of company established', 'bad_date', 'error', v_val);
      elsif v_val ~ '^[0-9]{4}$' then v_issues := v_issues || app_private.alumni_issue('Date of company established', 'year_only', 'info', v_val); end if;
    end if;
    for h in select * from (values ('app', 'App'), ('website', 'Website')) t(hk, hdr) loop
      v_val := nr->>h.hk;
      if v_val is null then continue; end if;
      if v_val ~* '^https?://[^[:space:]]+$' and char_length(v_val) <= 500 then null;
      elsif v_val ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/[^[:space:]]*)?$' then v_issues := v_issues || app_private.alumni_issue(h.hdr, 'url_scheme_added', 'info', v_val);
      else v_issues := v_issues || app_private.alumni_issue(h.hdr, 'bad_url', 'error', v_val); end if;
    end loop;
    for h in select * from (values ('nuofemployees', 'Nu. of employees'), ('nuoffemaleemployees', 'Nu. of female employees'), ('numberoffreelancers', 'Number of freelancers'), ('fundingraised', 'Funding raised')) t(hk, hdr) loop
      v_val := nr->>h.hk;
      if v_val is null then continue; end if;
      v_num := app_private.alumni_to_number(v_val);
      if v_num is null then v_issues := v_issues || app_private.alumni_issue(h.hdr, 'not_a_number', 'error', v_val);
      elsif v_num < 0 or v_num > 1000000000000 then v_issues := v_issues || app_private.alumni_issue(h.hdr, 'out_of_range', 'error', v_val); end if;
    end loop;
    v_num := app_private.alumni_to_number(nr->>'nuofemployees'); v_num2 := app_private.alumni_to_number(nr->>'nuoffemaleemployees');
    if v_num is not null and v_num2 is not null and v_num2 > v_num then v_issues := v_issues || app_private.alumni_issue('Nu. of female employees', 'exceeds_total', 'error', v_num2::text); end if;
    -- the year of "Revenue (YYYY) (Total)" comes from the header
    for kv in select a.k3, nr->>a.k3 as v3 from (select jsonb_object_keys(nr) as k3) a where a.k3 ~ '^revenue[0-9]{4}total$' and nr->>a.k3 is not null loop
      v_year := substring(kv.k3 from '[0-9]{4}')::int;
      v_num := app_private.alumni_to_number(kv.v3);
      if v_num is null then v_issues := v_issues || app_private.alumni_issue('Revenue (' || v_year || ') (Total)', 'not_a_number', 'error', kv.v3);
      elsif v_num < 0 or v_num > 1000000000000 then v_issues := v_issues || app_private.alumni_issue('Revenue (' || v_year || ') (Total)', 'out_of_range', 'error', kv.v3);
      elsif v_year < 1990 or v_year > extract(year from v_today)::int then v_issues := v_issues || app_private.alumni_issue('Revenue (' || v_year || ') (Total)', 'bad_year', 'error', v_year::text); end if;
    end loop;

    select count(*) filter (where i->>'level' = 'error'), count(*) filter (where i->>'level' = 'warning') into v_errs, v_warns from jsonb_array_elements(v_issues) i;
    if v_errs > 0 then v_plan := 'error'; end if;
    if v_plan = 'create' then v_sum_create := v_sum_create + 1; elsif v_plan = 'update' then v_sum_update := v_sum_update + 1; else v_sum_error := v_sum_error + 1; end if;
    v_sum_warn := v_sum_warn + v_warns;
    v_out := v_out || jsonb_build_array(jsonb_build_object('row', v_idx, 'name', v_name, 'plan', v_plan, 'company_id', v_company,
               'company_name_en', (select c.name_en from public.companies c where c.id = v_company), 'company_name_ar', (select c.name_ar from public.companies c where c.id = v_company),
               'ceo', v_ceo, 'issues', v_issues, 'errors', v_errs, 'warnings', v_warns));
  end loop;

  return jsonb_build_object('count', v_i, 'summary', jsonb_build_object('create', v_sum_create, 'update', v_sum_update, 'error', v_sum_error, 'warnings', v_sum_warn),
    'headers', jsonb_build_object('unknown', v_unknown, 'missing', v_missing, 'ignored_derived', (select coalesce(jsonb_agg(d), '[]'::jsonb) from unnest(v_derived_names) d where app_private.alumni_norm_text(d) = any (v_present))),
    'proposed_lookups', (select coalesce(jsonb_agg(jsonb_build_object('kind', q.kind, 'value', q.value, 'parent', q.parent, 'header', q.header, 'count', q.n) order by q.kind, q.value), '[]'::jsonb)
                           from (select p->>'kind' as kind, min(p->>'value') as value, max(p->>'parent') as parent, min(p->>'header') as header, count(*)::int as n
                                   from jsonb_array_elements(v_props) p group by p->>'kind', app_private.alumni_norm_text(p->>'value'), coalesce(p->>'parent', '')) q),
    'rows', v_out);
end $$;

-- ================================================================= 6b. one more filter for the shared directory / export / analytics / table filter: the CEO's education status (Student / Graduate)
-- (manager only, like the other person filters). alumni_filter_ids is patched IN PLACE (the m49 technique: an anchor must be found exactly once; a re-run finds the new text and does nothing).
create or replace function pg_temp.m51_patch(p_fn regprocedure, p_old text, p_new text, p_expect int default 1) returns text
language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  if position(p_new in v_def) > 0 then return 'already  ' || p_fn::text; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_expect then raise exception 'm51_patch: % anchor found % times (expected %): %', p_fn, v_n, p_expect, left(p_old, 90); end if;
  execute replace(v_def, p_old, p_new);
  return 'patched   ' || p_fn::text;
end $$;
select pg_temp.m51_patch('app_private.alumni_filter_ids(jsonb,text,date)'::regprocedure, 'v_gender text; v_age text;', 'v_gender text; v_age text; v_edu text;');
select pg_temp.m51_patch('app_private.alumni_filter_ids(jsonb,text,date)'::regprocedure, '''directory_hidden'', ''scope'', ''incomplete'') then', '''directory_hidden'', ''scope'', ''incomplete'', ''education_status'') then');
select pg_temp.m51_patch('app_private.alumni_filter_ids(jsonb,text,date)'::regprocedure, 'v_age := nullif(v->>''age_category'', ''''); v_vis := nullif(v->>''directory_visibility'', '''');',
  'v_age := nullif(v->>''age_category'', ''''); v_vis := nullif(v->>''directory_visibility'', ''''); v_edu := nullif(v->>''education_status'', ''''); ' ||
  'if v_edu is not null and v_edu not in (''student'', ''graduate'', ''other'') then perform app_private.alumni_fail(''education_status'', ''bad_value''); end if;');
select pg_temp.m51_patch('app_private.alumni_filter_ids(jsonb,text,date)'::regprocedure, 'left join fa on fa.founder_id = (case when v_mgr then app_private.alumni_company_ceo(c.id) end)',
  'left join fa on fa.founder_id = (case when v_mgr then app_private.alumni_company_ceo(c.id) end) left join public.founders cef on cef.id = (case when v_mgr then app_private.alumni_company_ceo(c.id) end)');
select pg_temp.m51_patch('app_private.alumni_filter_ids(jsonb,text,date)'::regprocedure, 'and (v_age is null or fa.age_category = v_age)', 'and (v_age is null or fa.age_category = v_age) and (v_edu is null or cef.education_status = v_edu)');

-- ================================================================= 7. grants (new functions have NO API privilege by default)
do $$
declare s text; r record;
  v_auth text[] := array[
    'public.list_alumni_programs()', 'public.list_alumni_table(jsonb,integer,integer,text,text,integer)', 'public.get_alumni_overview()',
    'public.preview_notification_audience(jsonb)', 'public.send_alumni_notification(jsonb,text,text,text,text,text,uuid)', 'public.list_alumni_broadcasts(integer,integer)',
    'public.import_alumni_preview(jsonb)'];
begin
  foreach s in array v_auth loop
    if to_regprocedure(s) is null then raise exception 'm51: function missing: %', s; end if;
    execute format('revoke all on function %s from public, anon, authenticated', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;
  -- the RLS policy evaluates this one AS the founder: it needs EXECUTE for `authenticated` (and nobody else)
  revoke all on function app_private.opportunity_visible_to_me(jsonb) from public, anon, authenticated;
  grant execute on function app_private.opportunity_visible_to_me(jsonb) to authenticated;
  revoke all on function app_private.opportunities_guard() from public, anon, authenticated;
  -- every alumni_* helper stays closed to the API roles (v49 C03), the new audience resolver included
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^(alumni_|id_|eg_)' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;

analyze public.opportunities;
analyze public.opportunity_applications;

-- ================================================================= 8. self-check
do $$
declare v_bad integer;
begin
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_alumni_programs', 'list_alumni_table', 'get_alumni_overview',
    'preview_notification_audience', 'send_alumni_notification', 'list_alumni_broadcasts', 'import_alumni_preview') and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    or not p.prosecdef or not (p.proconfig @> array['search_path=""']));
  if v_bad > 0 then raise exception 'm51: % manager RPC(s) with a wrong grant / security mode', v_bad; end if;
  if has_function_privilege('anon', 'app_private.opportunity_visible_to_me(jsonb)', 'EXECUTE') then raise exception 'm51: anon must not execute opportunity_visible_to_me'; end if;
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^(alumni_|id_|eg_)'
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then raise exception 'm51: % app_private helper(s) executable by an API role', v_bad; end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.opportunities'::regclass and t.tgname = 'opportunities_biu_guard' and not t.tgisinternal) then raise exception 'm51: opportunities guard missing'; end if;
  raise notice 'm51 ok';
end $$;

commit;
