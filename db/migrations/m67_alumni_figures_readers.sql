-- m67_alumni_figures_readers.sql  (owner decision 21: every graph, aggregate, table and export of the alumni figures reads the FROZEN quarterly snapshots ONLY)
-- Re-runnable (create or replace). Local DB only. Run AFTER m66. Verify with db/verify/v67_alumni_figures_readers.sql.
--
--  1. The readers of the yearly model (directory, manager table, Excel export, analytics, overview, founder home, attention queue) are re-created ON THEIR CURRENT DEFINITIONS with one
--     change: the table `public.company_snapshots` they read is replaced by the view app_private.alumni_year_rollup (m66), a roll-up of the FROZEN, REPORTED quarters by year
--     (revenue = the sum of the year's reported quarters; every other figure = the latest reported value of the year). So their shape and the owner's 38-column Excel order do not change,
--     and none of them can see a draft: a number typed five minutes ago is not in any of them. (Generated from the live definitions by a script; each replacement was asserted.)
--       - the manager directory rows and the manager table rows carry `figures` = { status, period, updated_at, confirmed_at } (the DATA FRESHNESS indicator: status of the CALENDAR quarter)
--       - get_my_alumni_profile: each company carries `figures` { status, period, deadline, updated_at } (the founder's "update your figures" banner)
--       - list_alumni_attention: the "latest_figures" rule = a draft with a figure or any reported frozen quarter
--  2. public.get_alumni_portfolio(filters, from, to): the portfolio indicators BY QUARTER, from snapshots only: companies, reporting companies, total / median revenue, employment, female
--     employee share, freelancers, funding, team size, open / closed, survival rate and closing rate. Filters are the directory's (program, sector, governorate, ...; they use the company's
--     CURRENT classification); the NUMBERS come from the frozen rows. A period with no snapshot is returned empty (a continuous axis).
--       - flow / stock / cumulative semantics: see m66. Aggregates sum REPORTED snapshots only; survival and closing use the operating status frozen with every snapshot.
--       - closing rate of a quarter = companies open at the previous quarter's snapshot and closed at this one / companies open at the previous snapshot.
set search_path = public, extensions;

begin;

CREATE OR REPLACE FUNCTION app_private.alumni_directory_page(p_filters jsonb, p_audience text, p_limit integer, p_offset integer, p_sort text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lim integer; v_off integer := greatest(coalesce(p_offset, 0), 0); v_sort text := coalesce(nullif(p_sort, ''), 'name'); v_rows jsonb; v_total integer;
begin
  if v_sort not in ('name', 'updated', 'established', 'created') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  v_lim := least(greatest(coalesce(p_limit, 24), 1), case when p_audience = 'public' then 50 else 100 end);
  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, p_audience) i),
       ts as (select * from app_private.alumni_team_stats(app_private.alumni_today())),
       fa as (select * from app_private.alumni_founder_attrs(app_private.alumni_today())),
       ap as (select * from app_private.alumni_participations()),
       progs as (select ap.company_id, jsonb_agg(jsonb_build_object('program_id', g.id, 'program_name_en', g.name_en, 'program_name_ar', g.name_ar,
                                                  'project_id', j.id, 'project_name_en', j.name_en, 'project_name_ar', j.name_ar) order by g.created_at, g.id, j.created_at, j.id) as p
                   from ap join public.projects j on j.id = ap.project_id join public.programs g on g.id = ap.program_id group by ap.company_id),
       page as (
         select c.*,
                row_number() over (order by case when v_sort = 'updated' then c.updated_at end desc nulls last, case when v_sort = 'established' then c.established_on end desc nulls last,
                                            case when v_sort = 'created' then c.created_at end desc nulls last, lower(coalesce(c.name_en, c.name_ar)), c.id) as rn
           from public.companies c join ids on ids.id = c.id
          order by rn limit v_lim offset v_off)
  select coalesce(jsonb_agg(
           case when p_audience = 'manager' then
             jsonb_build_object('id', pg.id, 'name_en', pg.name_en, 'name_ar', pg.name_ar, 'logo_path', pg.logo_path, 'sector', pg.sector_key, 'subsector', pg.subsector_key,
               'stage', pg.stage, 'startup_type', pg.startup_type_key, 'legal_status', pg.legal_status_key, 'governorate', pg.governorate_code, 'established_on', pg.established_on,
               'founding_year', pg.founding_year, 'operating_status', pg.operating_status, 'is_alumni', pg.is_alumni, 'directory_visibility', pg.directory_visibility,
               'directory_hidden', coalesce(ci.directory_hidden, false), 'reviewed_at', ci.reviewed_at, 'updated_at', pg.updated_at, 'figures', jsonb_build_object('status', app_private.alumni_figures_status(pg.id, app_private.alumni_period_key(now())), 'period', app_private.alumni_period_key(now()), 'updated_at', (select f.updated_at from public.company_figures f where f.company_id = pg.id), 'confirmed_at', (select f.confirmed_at from public.company_figures f where f.company_id = pg.id and f.confirmed_period = app_private.alumni_period_key(now()))),
               'legacy', jsonb_build_object('industry_en', pg.industry_en, 'industry_ar', pg.industry_ar, 'governorate_en', pg.governorate_en, 'governorate_ar', pg.governorate_ar),
               'team', jsonb_build_object('size', ts.team_size, 'female_founders', ts.female_founders, 'under_35', ts.founders_under_35),
               'ceo', case when cf.id is not null then jsonb_build_object('founder_id', cf.id, 'name_en', cf.name_en, 'name_ar', cf.name_ar, 'gender', fa.gender, 'age', fa.age,
                                                                         'age_category', fa.age_category, 'governorate', fa.governorate_code, 'source', fa.source) end,
               'latest', (select jsonb_build_object('year', s.period_year, 'revenue_total', s.revenue_total, 'employees_total', s.employees_total, 'funding_raised_total', s.funding_raised_total)
                            from app_private.alumni_year_rollup s where s.company_id = pg.id and s.snapshot_type = 'annual' order by s.period_year desc limit 1),
               'programs', coalesce(progs.p, '[]'::jsonb),
               'completeness_percent', (app_private.alumni_completeness_json(app_private.alumni_company_missing(pg.id), 10)->>'percent')::int)
           else
             jsonb_build_object('id', pg.id, 'name_en', pg.name_en, 'name_ar', pg.name_ar, 'logo_path', pg.logo_path, 'description_en', left(pg.description_en, 280), 'description_ar', left(pg.description_ar, 280),
               'sector', pg.sector_key, 'subsector', pg.subsector_key, 'stage', pg.stage, 'startup_type', pg.startup_type_key, 'governorate', pg.governorate_code,
               'established_year', coalesce(extract(year from pg.established_on)::int, pg.founding_year), 'operating_status', pg.operating_status,
               'website_url', pg.website_url, 'app_url', pg.app_url, 'social', app_private.alumni_social_links(pg.links, pg.linkedin_url), 'programs', coalesce(progs.p, '[]'::jsonb))
           end order by pg.rn), '[]'::jsonb),
         (select count(*) from ids)::int
    into v_rows, v_total
    from page pg
    left join public.company_internal ci on ci.company_id = pg.id
    left join ts on ts.company_id = pg.id
    left join public.founders cf on cf.id = (case when p_audience = 'manager' then app_private.alumni_company_ceo(pg.id) end)
    left join fa on fa.founder_id = cf.id
    left join progs on progs.company_id = pg.id;
  return jsonb_build_object('audience', p_audience, 'total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $function$;

CREATE OR REPLACE FUNCTION public.list_alumni_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'name'::text, p_dir text DEFAULT 'asc'::text, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := app_private.alumni_today(); v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100); v_off integer := greatest(coalesce(p_offset, 0), 0);
        v_sort text := coalesce(nullif(p_sort, ''), 'name'); v_dir text := lower(coalesce(nullif(p_dir, ''), 'asc')); v_year integer; v_rows jsonb; v_total integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_sort not in ('name', 'updated', 'created', 'established', 'completeness', 'age', 'employees', 'funding', 'revenue', 'sector', 'stage') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  if v_dir not in ('asc', 'desc') then perform app_private.alumni_fail('dir', 'bad_value'); end if;
  v_year := coalesce(p_year, (select max(s.period_year) from app_private.alumni_year_rollup s where s.snapshot_type = 'annual')::int, 2023);
  if v_year < 1990 or v_year > 2100 then perform app_private.alumni_fail('year', 'out_of_range'); end if;

  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', v_today) i),
       ts as (select * from app_private.alumni_team_stats(v_today)),
       fa as (select * from app_private.alumni_founder_attrs(v_today)),
       ap as (select * from app_private.alumni_participations()),
       base as (
         select c.id, c.name_en, c.name_ar, c.logo_path, c.startup_type_key, c.sector_key, c.subsector_key, c.description_en, c.description_ar, c.stage, c.governorate_code,
                c.established_on, c.founding_year, c.app_url, c.website_url, c.links, c.linkedin_url, c.operating_status, c.closing_reason_key, c.closing_note, c.after_closing_key,
                c.legal_status_key, c.is_alumni, c.directory_visibility, c.updated_at, c.updated_source, c.created_at, c.industry_en, c.industry_ar, c.governorate_en, c.governorate_ar,
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
               from app_private.alumni_year_rollup s where s.company_id = c.id and s.snapshot_type = 'annual' and s.period_year <= v_year) m on true),
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
             'team', jsonb_build_object('size', ts.team_size, 'female_founders', ts.female_founders, 'under_35', ts.founders_under_35),
             'metrics', jsonb_build_object('employees_total', pg.employees_total, 'employees_female', pg.employees_female, 'freelancers', pg.freelancers,
                                           'funding_raised_total', pg.funding_raised_total, 'revenue_total', pg.revenue_year, 'challenges', pg.challenges, 'needs', pg.needs),
             'is_alumni', pg.is_alumni, 'directory_visibility', pg.directory_visibility, 'directory_hidden', coalesce(ci.directory_hidden, false),
             'reviewed_at', ci.reviewed_at, 'updated_at', pg.updated_at, 'updated_source', pg.updated_source, 'figures', jsonb_build_object('status', app_private.alumni_figures_status(pg.id, app_private.alumni_period_key(now())), 'period', app_private.alumni_period_key(now()), 'updated_at', (select f.updated_at from public.company_figures f where f.company_id = pg.id), 'confirmed_at', (select f.confirmed_at from public.company_figures f where f.company_id = pg.id and f.confirmed_period = app_private.alumni_period_key(now()))),
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
end $function$;

CREATE OR REPLACE FUNCTION public.export_alumni_rows(p_filters jsonb DEFAULT '{}'::jsonb, p_year integer DEFAULT NULL::integer, p_lang text DEFAULT 'en'::text, p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_lang text := case when lower(coalesce(p_lang, 'en')) = 'ar' then 'ar' else 'en' end; v_today date := coalesce(p_as_of, app_private.alumni_today());
        v_year integer; v_rows jsonb; v_n integer; v_cols jsonb; v_src_id integer; v_src_self integer;
begin
  perform app_private.alumni_post_only();   -- m52: personal data never travels in a URL (GET / HEAD refused)
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_year := coalesce(p_year, (select max(s.period_year) from app_private.alumni_year_rollup s where s.snapshot_type = 'annual')::int, 2023);
  if v_year < 1990 or v_year > 2100 then perform app_private.alumni_fail('year', 'out_of_range'); end if;
  v_cols := jsonb_build_array(
    jsonb_build_object('key', 'startup_name', 'header', 'Startup Name', 'type', 'text'),
    jsonb_build_object('key', 'program_scope', 'header', 'Program Scope', 'type', 'text'),
    jsonb_build_object('key', 'program_name', 'header', 'Program Name', 'type', 'text'),
    jsonb_build_object('key', 'support_provided', 'header', 'Support provided', 'type', 'text'),
    jsonb_build_object('key', 'startup_type', 'header', 'Startup type', 'type', 'text'),
    jsonb_build_object('key', 'hint', 'header', 'Hint', 'type', 'text'),
    jsonb_build_object('key', 'sector', 'header', 'Sector', 'type', 'text'),
    jsonb_build_object('key', 'sub_sector', 'header', 'Sub sector', 'type', 'text'),
    jsonb_build_object('key', 'description', 'header', 'Description', 'type', 'text'),
    jsonb_build_object('key', 'stage', 'header', 'Stage', 'type', 'text'),
    jsonb_build_object('key', 'governerate', 'header', 'Governerate', 'type', 'text'),
    jsonb_build_object('key', 'established', 'header', 'Date of company established', 'type', 'date'),
    jsonb_build_object('key', 'app', 'header', 'App', 'type', 'text'),
    jsonb_build_object('key', 'website', 'header', 'Website', 'type', 'text'),
    jsonb_build_object('key', 'social_media', 'header', 'Social media', 'type', 'text'),
    jsonb_build_object('key', 'traction', 'header', 'Traction/Validation', 'type', 'text'),
    jsonb_build_object('key', 'ceo_name', 'header', 'CEO Name', 'type', 'text'),
    jsonb_build_object('key', 'phone', 'header', 'Phone', 'type', 'text'),
    jsonb_build_object('key', 'email', 'header', 'Email', 'type', 'text'),
    jsonb_build_object('key', 'national_id', 'header', 'ID', 'type', 'text'),
    jsonb_build_object('key', 'ceo_age', 'header', 'CEO Age', 'type', 'number'),
    jsonb_build_object('key', 'age_category', 'header', 'Age Category', 'type', 'text'),
    jsonb_build_object('key', 'student_graduate', 'header', 'Student/Graduate', 'type', 'text'),
    jsonb_build_object('key', 'ceo_gender', 'header', 'CEO Gender', 'type', 'text'),
    jsonb_build_object('key', 'open_closed', 'header', 'Open/Closed', 'type', 'text'),
    jsonb_build_object('key', 'reason_for_closing', 'header', 'Reason for closing', 'type', 'text'),
    jsonb_build_object('key', 'after_closing', 'header', 'After closing', 'type', 'text'),
    jsonb_build_object('key', 'legal_status', 'header', 'Legal Status', 'type', 'text'),
    jsonb_build_object('key', 'founding_team_size', 'header', 'Founding team size', 'type', 'number'),
    jsonb_build_object('key', 'female_founders', 'header', 'Female founders', 'type', 'number'),
    jsonb_build_object('key', 'founders_below_35', 'header', 'Nu. of founders below 35', 'type', 'number'),
    jsonb_build_object('key', 'employees', 'header', 'Nu. of employees', 'type', 'number'),
    jsonb_build_object('key', 'female_employees', 'header', 'Nu. of female employees', 'type', 'number'),
    jsonb_build_object('key', 'freelancers', 'header', 'Number of freelancers', 'type', 'number'),
    jsonb_build_object('key', 'funding_raised', 'header', 'Funding raised', 'type', 'number'),
    jsonb_build_object('key', 'revenue', 'header', 'Revenue (' || v_year || ') (Total)', 'type', 'number'),
    jsonb_build_object('key', 'challenges', 'header', 'Challenges', 'type', 'text'),
    jsonb_build_object('key', 'needs', 'header', 'Needs', 'type', 'text'));

  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', v_today) i),
       ts as (select * from app_private.alumni_team_stats(v_today)),
       fa as (select * from app_private.alumni_founder_attrs(v_today)),
       ap as (select * from app_private.alumni_participations()),
       progs as (select ap.company_id,
                        string_agg(distinct case when v_lang = 'ar' then coalesce(g.name_ar, g.name_en) else coalesce(g.name_en, g.name_ar) end, '; ') as scope_txt,
                        string_agg(distinct case when v_lang = 'ar' then coalesce(j.name_ar, j.name_en) else coalesce(j.name_en, j.name_ar) end, '; ') as name_txt
                   from ap join public.projects j on j.id = ap.project_id join public.programs g on g.id = ap.program_id group by ap.company_id),
       supp as (select s.company_id, string_agg(case when v_lang = 'ar' then l.label_ar else l.label_en end, '; ' order by l.sort_order, l.key) as txt
                  from (select distinct ap.company_id, k from ap cross join lateral unnest(app_private.alumni_project_support(ap.project_id)) k) s
                  join public.alumni_lookups l on l.kind = 'support_kind' and l.key = s.k group by s.company_id),
       rows as (
         select jsonb_build_array(
           case when v_lang = 'ar' then coalesce(c.name_ar, c.name_en) else coalesce(c.name_en, c.name_ar) end,
           progs.scope_txt, progs.name_txt, supp.txt,
           app_private.alumni_label('startup_type', c.startup_type_key, v_lang),
           ci.hint,
           coalesce(app_private.alumni_label('sector', c.sector_key, v_lang), case when v_lang = 'ar' then coalesce(c.industry_ar, c.industry_en) else coalesce(c.industry_en, c.industry_ar) end),
           app_private.alumni_label('subsector', c.subsector_key, v_lang),
           case when v_lang = 'ar' then coalesce(c.description_ar, c.description_en) else coalesce(c.description_en, c.description_ar) end,
           coalesce(app_private.alumni_label('stage', c.stage, v_lang), c.stage),
           coalesce(app_private.eg_governorate_name(fa.governorate_code, v_lang), app_private.eg_governorate_name(c.governorate_code, v_lang),
                    case when v_lang = 'ar' then coalesce(c.governorate_ar, c.governorate_en) else coalesce(c.governorate_en, c.governorate_ar) end),
           coalesce(c.established_on::text, c.founding_year::text),
           c.app_url, c.website_url, app_private.alumni_social_text(c.links, c.linkedin_url),
           m.traction,
           case when v_lang = 'ar' then coalesce(f.name_ar, f.name_en) else coalesce(f.name_en, f.name_ar) end,
           f.phone, f.email::text, idn.national_id,
           fa.age, app_private.alumni_label('age_category', fa.age_category, v_lang), app_private.alumni_label('education_status', f.education_status, v_lang),
           app_private.alumni_label('gender', fa.gender, v_lang),
           app_private.alumni_label('operating_status', c.operating_status, v_lang),
           nullif(concat_ws(' - ', app_private.alumni_label('closing_reason', c.closing_reason_key, v_lang), c.closing_note), ''),
           app_private.alumni_label('after_closing', c.after_closing_key, v_lang),
           app_private.alumni_label('legal_status', c.legal_status_key, v_lang),
           ts.team_size, ts.female_founders, ts.founders_under_35,
           m.employees_total, m.employees_female, m.freelancers, m.funding_raised_total, m.revenue_year, m.challenges, m.needs) as r,
           lower(coalesce(c.name_en, c.name_ar)) as sort_key, c.id as cid, fa.source as src
           from public.companies c
           join ids on ids.id = c.id
           left join public.company_internal ci on ci.company_id = c.id
           left join ts on ts.company_id = c.id
           left join progs on progs.company_id = c.id
           left join supp on supp.company_id = c.id
           left join public.founders f on f.id = app_private.alumni_company_ceo(c.id)
           left join fa on fa.founder_id = f.id
           left join public.founder_identities idn on idn.founder_id = f.id
           left join lateral (
             select (array_agg(s.employees_total order by s.period_year desc) filter (where s.employees_total is not null))[1] as employees_total,
                    (array_agg(s.employees_female order by s.period_year desc) filter (where s.employees_female is not null))[1] as employees_female,
                    (array_agg(s.freelancers order by s.period_year desc) filter (where s.freelancers is not null))[1] as freelancers,
                    (array_agg(s.funding_raised_total order by s.period_year desc) filter (where s.funding_raised_total is not null))[1] as funding_raised_total,
                    (array_agg(s.traction order by s.period_year desc) filter (where s.traction is not null))[1] as traction,
                    (array_agg(s.challenges order by s.period_year desc) filter (where s.challenges is not null))[1] as challenges,
                    (array_agg(s.needs order by s.period_year desc) filter (where s.needs is not null))[1] as needs,
                    max(s.revenue_total) filter (where s.period_year = v_year) as revenue_year
               from app_private.alumni_year_rollup s where s.company_id = c.id and s.snapshot_type = 'annual' and s.period_year <= v_year) m on true)
  select coalesce(jsonb_agg(rows.r order by rows.sort_key, rows.cid), '[]'::jsonb), count(*)::int, (count(*) filter (where rows.src = 'id'))::int, (count(*) filter (where rows.src = 'self'))::int
    into v_rows, v_n, v_src_id, v_src_self from rows;
  insert into app_private.founder_identity_access_log (accessed_by, via, row_count) values (v_uid, 'export', v_n);
  -- meta.ceo_source tells the manager how many CEO age / gender / governorate cells come from an ID, how many are self-declared and how many are unknown
  return jsonb_build_object('columns', v_cols, 'rows', v_rows, 'meta', jsonb_build_object('year', v_year, 'lang', v_lang, 'as_of', v_today, 'count', v_n, 'generated_at', now(),
    'ceo_source', jsonb_build_object('id', v_src_id, 'self', v_src_self, 'none', v_n - v_src_id - v_src_self)));
end $function$;

CREATE OR REPLACE FUNCTION public.get_alumni_analytics(p_filters jsonb DEFAULT '{}'::jsonb, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_year integer; v jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_year := coalesce(p_year, (select max(s.period_year) from app_private.alumni_year_rollup s where s.snapshot_type = 'annual')::int, extract(year from app_private.alumni_today())::int - 1);
  if v_year < 1990 or v_year > 2100 then perform app_private.alumni_fail('year', 'out_of_range'); end if;
  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', app_private.alumni_today()) i),
       ts as (select * from app_private.alumni_team_stats(app_private.alumni_today())),
       fa as (select * from app_private.alumni_founder_attrs(app_private.alumni_today())),
       ap as (select * from app_private.alumni_participations()),
       x as (
         select c.id, c.sector_key, c.stage, c.startup_type_key, c.legal_status_key, c.governorate_code, c.operating_status,
                fa.governorate_code as ceo_gov, fa.gender as ceo_gender, fa.age_category as ceo_age_cat,
                coalesce(ts.team_size, 0) as team_size, coalesce(ts.female_founders, 0) as female_founders, coalesce(ts.founders_under_35, 0) as under_35,
                m.employees_total, m.employees_female, m.freelancers, m.funding_raised_total, m.revenue_year, m.reporting
           from public.companies c
           join ids on ids.id = c.id
           left join ts on ts.company_id = c.id
           left join fa on fa.founder_id = app_private.alumni_company_ceo(c.id)
           left join lateral (
             select (array_agg(s.employees_total order by s.period_year desc) filter (where s.employees_total is not null))[1] as employees_total,
                    (array_agg(s.employees_female order by s.period_year desc) filter (where s.employees_female is not null))[1] as employees_female,
                    (array_agg(s.freelancers order by s.period_year desc) filter (where s.freelancers is not null))[1] as freelancers,
                    (array_agg(s.funding_raised_total order by s.period_year desc) filter (where s.funding_raised_total is not null))[1] as funding_raised_total,
                    max(s.revenue_total) filter (where s.period_year = v_year) as revenue_year,
                    bool_or(s.period_year = v_year) as reporting
               from app_private.alumni_year_rollup s where s.company_id = c.id and s.snapshot_type = 'annual' and s.period_year <= v_year) m on true)
  select jsonb_build_object(
    'year', v_year,
    'totals', (select jsonb_build_object('companies', count(*), 'open', count(*) filter (where operating_status = 'open'), 'closed', count(*) filter (where operating_status = 'closed'),
                 'survival_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where operating_status = 'open') / count(*), 1) end,
                 'with_program', count(*) filter (where exists (select 1 from ap where ap.company_id = x.id)),
                 'reporting_year', count(*) filter (where coalesce(reporting, false)),
                 'founders', coalesce(sum(team_size), 0), 'female_founders', coalesce(sum(female_founders), 0), 'founders_under_35', coalesce(sum(under_35), 0),
                 'employees', coalesce(sum(employees_total), 0), 'female_employees', coalesce(sum(employees_female), 0), 'freelancers', coalesce(sum(freelancers), 0),
                 'funding_raised', coalesce(sum(funding_raised_total), 0), 'revenue', coalesce(sum(revenue_year), 0)) from x),
    'by_sector', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select sector_key k, count(*) n from x group by sector_key) q),
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select stage k, count(*) n from x group by stage) q),
    'by_startup_type', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select startup_type_key k, count(*) n from x group by startup_type_key) q),
    'by_legal_status', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select legal_status_key k, count(*) n from x group by legal_status_key) q),
    'by_governorate', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select governorate_code::text k, count(*) n from x group by governorate_code) q),
    'by_ceo_governorate', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select ceo_gov::text k, count(*) n from x group by ceo_gov) q),
    'by_ceo_gender', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select ceo_gender k, count(*) n from x group by ceo_gender) q),
    'by_ceo_age_category', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select ceo_age_cat k, count(*) n from x group by ceo_age_cat) q),
    'by_program', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'program_name_en', pn_en, 'program_name_ar', pn_ar, 'count', n) order by n desc, k), '[]'::jsonb)
                     from (select g.id::text k, g.name_en pn_en, g.name_ar pn_ar, count(distinct ap.company_id) n from ap join x on x.id = ap.company_id join public.programs g on g.id = ap.program_id group by g.id, g.name_en, g.name_ar) q),
    'by_year', (select coalesce(jsonb_agg(jsonb_build_object('year', yy, 'companies_reporting', n, 'revenue', rev, 'funding_raised', fund, 'employees', emp, 'female_employees', femp, 'freelancers', fl) order by yy), '[]'::jsonb)
                  from (select s.period_year yy, count(distinct s.company_id) n, sum(s.revenue_total) rev, sum(s.funding_raised_total) fund, sum(s.employees_total) emp, sum(s.employees_female) femp, sum(s.freelancers) fl
                          from app_private.alumni_year_rollup s join x on x.id = s.company_id where s.snapshot_type = 'annual' group by s.period_year) q))
    into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.get_alumni_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'latest_year', (select max(s.period_year) from app_private.alumni_year_rollup s where s.snapshot_type = 'annual'),
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
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_alumni_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_f uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_f := app_private.alumni_ensure_founder(v_uid);
  return jsonb_build_object('founder', app_private.alumni_founder_json(v_f, true, false),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar, 'logo_path', c.logo_path, 'stage', c.stage, 'sector', c.sector_key,
                'operating_status', c.operating_status, 'role', cf.role, 'is_primary', cf.is_primary, 'directory_visibility', c.directory_visibility, 'is_alumni', c.is_alumni,
                'completeness', app_private.alumni_completeness_json(app_private.alumni_company_missing(c.id), 10),
                'latest_snapshot_year', (select max(s.period_year) from app_private.alumni_year_rollup s where s.company_id = c.id and s.snapshot_type = 'annual'), 'updated_at', c.updated_at,
                'figures', jsonb_build_object('status', app_private.alumni_figures_status(c.id, app_private.alumni_period_key(now())), 'period', app_private.alumni_period_key(now()),
                           'deadline', ((app_private.alumni_period_end(app_private.alumni_period_key(now())) at time zone app_private.alumni_tz())::date - 1),
                           'updated_at', (select f.updated_at from public.company_figures f where f.company_id = c.id)))
                order by cf.is_primary desc, c.created_at, c.id)
              from public.company_founders cf join public.companies c on c.id = cf.company_id and c.deleted_at is null where cf.founder_id = v_f), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.list_alumni_attention(p_filters jsonb DEFAULT '{}'::jsonb, p_rules text[] DEFAULT NULL::text[], p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'missing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb := coalesce(p_filters, '{}'::jsonb); k text; v_today date := app_private.alumni_today(); v_year integer := extract(year from app_private.alumni_today())::int;
  v_scope text; v_q text; v_program uuid; v_project uuid; v_missing text; v_sev text; v_account boolean; v_invited boolean; v_lim integer; v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(nullif(p_sort, ''), 'missing'); v_rules text[]; v_n integer; v_all text[]; v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_lim := least(greatest(coalesce(p_limit, 25), 1), 5000);
  if jsonb_typeof(v) <> 'object' then perform app_private.alumni_fail('filters', 'not_an_object'); end if;
  for k in select jsonb_object_keys(v) loop
    if k not in ('scope', 'q', 'program_id', 'project_id', 'missing', 'severity', 'has_account', 'invited') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  if v_sort not in ('missing', 'completeness', 'name', 'updated') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  select array_agg(c.key order by c.sort) into v_all from app_private.alumni_attention_catalog() c;
  v_rules := coalesce(p_rules, v_all);
  if cardinality(v_rules) = 0 then perform app_private.alumni_fail('rules', 'required'); end if;
  if exists (select 1 from unnest(v_rules) r where r <> all (v_all)) then perform app_private.alumni_fail('rules', 'unknown'); end if;
  v_n := cardinality(v_rules);
  v_scope := coalesce(nullif(v ->> 'scope', ''), 'all');
  if v_scope not in ('all', 'alumni', 'candidates') then perform app_private.alumni_fail('scope', 'bad_value'); end if;
  v_q := nullif(lower(btrim(v ->> 'q')), '');
  if v_q is not null and char_length(v_q) > 100 then perform app_private.alumni_fail('q', 'too_long'); end if;
  begin v_program := nullif(v ->> 'program_id', '')::uuid; exception when others then perform app_private.alumni_fail('program_id', 'bad_value'); end;
  begin v_project := nullif(v ->> 'project_id', '')::uuid; exception when others then perform app_private.alumni_fail('project_id', 'bad_value'); end;
  v_missing := nullif(v ->> 'missing', '');
  if v_missing is not null and v_missing <> all (v_all) then perform app_private.alumni_fail('missing', 'unknown'); end if;
  v_sev := nullif(v ->> 'severity', '');
  if v_sev is not null and v_sev not in ('required', 'recommended') then perform app_private.alumni_fail('severity', 'bad_value'); end if;
  begin v_account := nullif(v ->> 'has_account', '')::boolean; exception when others then perform app_private.alumni_fail('has_account', 'bad_value'); end;
  begin v_invited := nullif(v ->> 'invited', '')::boolean; exception when others then perform app_private.alumni_fail('invited', 'bad_value'); end;

  with ap as (select * from app_private.alumni_participations()),
       base as (
         select c.* from public.companies c
          where c.deleted_at is null
            and (v_scope = 'all' or (v_scope = 'alumni' and c.is_alumni)
                 or (v_scope = 'candidates' and not c.is_alumni and (exists (select 1 from ap where ap.company_id = c.id) or exists (select 1 from public.company_founders cf where cf.company_id = c.id))))
            and (v_q is null or strpos(lower(coalesce(c.name_en, '')), v_q) > 0 or strpos(lower(coalesce(c.name_ar, '')), v_q) > 0)
            and (v_program is null or exists (select 1 from ap where ap.company_id = c.id and ap.program_id = v_program))
            and (v_project is null or exists (select 1 from ap where ap.company_id = c.id and ap.project_id = v_project))),
       ceo as (
         select b.id as company_id, f.id as fid, f.phone, f.email, f.education_status, i.national_id is not null as has_id
           from base b
           left join lateral (select cf.founder_id from public.company_founders cf join public.founders f2 on f2.id = cf.founder_id and f2.deleted_at is null
                               where cf.company_id = b.id order by cf.is_primary desc, cf.created_at, cf.founder_id limit 1) x on true
           left join public.founders f on f.id = x.founder_id
           left join public.founder_identities i on i.founder_id = f.id),
       fig as (select f.company_id from public.company_figures f
                where f.revenue_total is not null or f.funding_raised_total is not null or f.employees_total is not null or f.employees_female is not null or f.freelancers is not null
               union select s.company_id from public.company_snapshots s where s.snapshot_type = 'quarter' and s.reported),
       flags as (
         select b.id, array_remove(array[
           case when ceo.fid is null then 'ceo' end,
           case when ceo.fid is null or not ceo.has_id then 'ceo_id' end,
           case when ceo.fid is null or (ceo.phone is null and ceo.email is null) then 'contact' end,
           case when b.sector_key is null then 'sector' end,
           case when b.governorate_code is null then 'governorate' end,
           case when fig.company_id is null then 'latest_figures' end,
           case when b.description_en is null and b.description_ar is null then 'description' end,
           case when b.logo_path is null then 'logo' end,
           case when b.established_on is null then 'established_on' end,
           case when b.stage is null then 'stage' end,
           case when b.startup_type_key is null then 'startup_type' end,
           case when b.subsector_key is null then 'subsector' end,
           case when b.legal_status_key is null then 'legal_status' end,
           case when b.website_url is null and b.app_url is null and jsonb_array_length(app_private.alumni_social_links(b.links, b.linkedin_url)) = 0 then 'online_presence' end,
           case when ceo.fid is null or ceo.education_status is null then 'ceo_education' end], null) as miss
           from base b join ceo on ceo.company_id = b.id left join fig on fig.company_id = b.id),
       t as (
         select fl.id as company_id, m.miss as missing,
                (select count(*) from unnest(m.miss) x join app_private.alumni_attention_catalog() c on c.key = x where c.severity = 'required')::int as req,
                (select count(*) from unnest(m.miss) x join app_private.alumni_attention_catalog() c on c.key = x where c.severity = 'recommended')::int as rec,
                round(100.0 * (v_n - cardinality(m.miss)) / v_n)::int as pct
           from flags fl cross join lateral (select array(select x from unnest(fl.miss) x where x = any (v_rules)) as miss) m),
       counts as (
         select jsonb_build_object('total', count(*), 'with_issues', count(*) filter (where cardinality(t.missing) > 0), 'complete', count(*) filter (where cardinality(t.missing) = 0),
                  'by_rule', coalesce((select jsonb_object_agg(z.k, z.n) from (select x as k, count(*)::int as n from t t2, unnest(t2.missing) x group by x) z), '{}'::jsonb)) as j
           from t),
       sel as (
         select t.*, c.name_en, c.name_ar, c.logo_path, c.is_alumni, c.updated_at, c.updated_source
           from t join public.companies c on c.id = t.company_id
           left join lateral (select bool_or(f.auth_user_id is not null) as has_account from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null where cf.company_id = t.company_id) a on true
           left join lateral (select count(*)::int as pending from public.alumni_invitations i where i.company_id = t.company_id and i.status = 'pending' and i.sent_at + interval '14 days' > now()) iv on true
          where (v_missing is null or v_missing = any (t.missing))
            and (v_sev is null or exists (select 1 from unnest(t.missing) x join app_private.alumni_attention_catalog() cc on cc.key = x where cc.severity = v_sev))
            and (v_account is null or coalesce(a.has_account, false) = v_account)
            and (v_invited is null or (coalesce(iv.pending, 0) > 0) = v_invited)),
       page as (
         select s.*, row_number() over (order by
                  case when v_sort = 'missing' then s.req end desc nulls last, case when v_sort = 'missing' then cardinality(s.missing) end desc nulls last,
                  case when v_sort = 'completeness' then s.pct end asc nulls last, case when v_sort = 'updated' then s.updated_at end asc nulls last,
                  lower(coalesce(s.name_en, s.name_ar)), s.company_id) as rn
           from sel s)
  select jsonb_build_object('total', (select count(*) from sel), 'limit', v_lim, 'offset', v_off, 'sort', v_sort, 'as_of', v_today,
           'rules', (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'severity', c.severity, 'section', c.section, 'selected', c.key = any (v_rules),
                       'count', coalesce(((select cn.j from counts cn) -> 'by_rule' ->> c.key)::int, 0)) order by c.sort), '[]'::jsonb) from app_private.alumni_attention_catalog() c),
           'counts', (select cn.j from counts cn),
           'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', p.company_id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'logo_path', p.logo_path, 'is_alumni', p.is_alumni, 'missing', to_jsonb(p.missing),
                      'required_missing', p.req, 'recommended_missing', p.rec, 'completeness_percent', p.pct,
                      'last_update', jsonb_build_object('at', p.updated_at, 'source', p.updated_source),
                      'has_account', coalesce(a.has_account, false), 'pending_invitations', coalesce(iv.pending, 0),
                      'ceo', case when cf.id is not null then jsonb_build_object('founder_id', cf.id, 'name_en', cf.name_en, 'name_ar', cf.name_ar, 'email', cf.email::text, 'phone', cf.phone, 'has_account', cf.auth_user_id is not null) end,
                      'programs', coalesce(pr.programs, '[]'::jsonb)) order by p.rn), '[]'::jsonb)
                      from (select * from page where rn > v_off and rn <= v_off + v_lim) p
                      left join public.founders cf on cf.id = app_private.alumni_company_ceo(p.company_id)
                      left join lateral (select bool_or(f.auth_user_id is not null) as has_account from public.company_founders c2 join public.founders f on f.id = c2.founder_id and f.deleted_at is null where c2.company_id = p.company_id) a on true
                      left join lateral (select count(*)::int as pending from public.alumni_invitations i where i.company_id = p.company_id and i.status = 'pending' and i.sent_at + interval '14 days' > now()) iv on true
                      left join lateral (select jsonb_agg(distinct jsonb_build_object('program_name_en', g.name_en, 'program_name_ar', g.name_ar)) as programs
                                           from app_private.alumni_participations() ap2 join public.programs g on g.id = ap2.program_id where ap2.company_id = p.company_id) pr on true))
    into v_result;
  return v_result;
end $function$;

-- ================================================================= 2. the portfolio indicators by quarter
create or replace function public.get_alumni_portfolio(p_filters jsonb default '{}'::jsonb, p_from text default null, p_to text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_latest text; v_to text; v_from text; v_rows jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is not null and not app_private.alumni_period_ok(p_from) then perform app_private.alumni_fail('from', 'bad_value'); end if;
  if p_to is not null and not app_private.alumni_period_ok(p_to) then perform app_private.alumni_fail('to', 'bad_value'); end if;
  select max(s.period_key) into v_latest from public.company_snapshots s where s.snapshot_type = 'quarter';
  v_to := coalesce(p_to, v_latest);
  if v_to is null then
    perform count(*) from app_private.alumni_filter_ids(p_filters, 'manager', app_private.alumni_today());   -- validates the filters even when there is nothing to show
    return jsonb_build_object('latest', null, 'from', null, 'to', null, 'periods', '[]'::jsonb);
  end if;
  v_from := coalesce(p_from, app_private.alumni_period_from_index(greatest(app_private.alumni_period_index(v_to) - 7, 8000)));
  if app_private.alumni_period_index(v_from) > app_private.alumni_period_index(v_to) then perform app_private.alumni_fail('from', 'after_to'); end if;
  if app_private.alumni_period_index(v_to) - app_private.alumni_period_index(v_from) > 39 then perform app_private.alumni_fail('range', 'too_long'); end if;

  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', app_private.alumni_today()) i),
       s as (select sn.*, lag(sn.operating_status) over (partition by sn.company_id order by sn.period_key) as prev_status
               from public.company_snapshots sn join ids on ids.id = sn.company_id where sn.snapshot_type = 'quarter'),
       agg as (
         select s.period_key,
                count(*)::int as companies,
                (count(*) filter (where s.reported))::int as reporting,
                sum(s.revenue_total) filter (where s.reported) as revenue_total,
                (count(s.revenue_total) filter (where s.reported))::int as revenue_n,
                percentile_cont(0.5) within group (order by s.revenue_total) filter (where s.reported and s.revenue_total is not null) as revenue_median,
                sum(s.employees_total) filter (where s.reported) as employees_total,
                sum(s.employees_female) filter (where s.reported and s.employees_total is not null and s.employees_female is not null) as employees_female_known,
                sum(s.employees_total) filter (where s.reported and s.employees_total is not null and s.employees_female is not null) as employees_total_known,
                sum(s.freelancers) filter (where s.reported) as freelancers,
                sum(s.funding_raised_total) filter (where s.reported) as funding_total,
                sum(s.team_size) as team_size, sum(s.female_founders) as female_founders,
                (count(*) filter (where s.operating_status = 'open'))::int as open_n,
                (count(*) filter (where s.operating_status = 'closed'))::int as closed_n,
                (count(*) filter (where s.operating_status = 'closed' and s.prev_status = 'open'))::int as closed_new,
                (count(*) filter (where s.prev_status = 'open'))::int as at_risk,
                (count(*) filter (where s.corrected_at is not null))::int as corrected
           from s group by s.period_key)
  select coalesce(jsonb_agg(jsonb_build_object(
           'period_key', g.k, 'companies', coalesce(a.companies, 0), 'reporting', coalesce(a.reporting, 0),
           'revenue_total', a.revenue_total, 'revenue_median', a.revenue_median, 'revenue_n', coalesce(a.revenue_n, 0),
           'employees_total', a.employees_total, 'employees_female', a.employees_female_known,
           'female_share', case when coalesce(a.employees_total_known, 0) > 0 then round(100.0 * a.employees_female_known / a.employees_total_known, 1) end,
           'freelancers', a.freelancers, 'funding_total', a.funding_total, 'team_size', a.team_size, 'female_founders', a.female_founders,
           'open', coalesce(a.open_n, 0), 'closed', coalesce(a.closed_n, 0),
           'survival_rate', case when coalesce(a.open_n, 0) + coalesce(a.closed_n, 0) > 0 then round(100.0 * a.open_n / (a.open_n + a.closed_n), 1) end,
           'closed_new', coalesce(a.closed_new, 0), 'at_risk', coalesce(a.at_risk, 0),
           'closing_rate', case when coalesce(a.at_risk, 0) > 0 then round(100.0 * a.closed_new / a.at_risk, 1) end,
           'corrected', coalesce(a.corrected, 0)) order by g.k), '[]'::jsonb)
    into v_rows
    from (select app_private.alumni_period_from_index(i) as k from generate_series(app_private.alumni_period_index(v_from), app_private.alumni_period_index(v_to)) i) g
    left join agg a on a.period_key = g.k;
  return jsonb_build_object('latest', v_latest, 'from', v_from, 'to', v_to, 'periods', v_rows);
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_alumni_portfolio' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;

-- ================================================================= 3. self-check
do $$
declare v_n integer; v_ok text[] := array['alumni_freeze_one', 'alumni_freeze_due', 'alumni_freeze_company_due', 'alumni_figures_status', 'alumni_target_period', 'alumni_snapshots_json',
      'alumni_figures_json', 'reopen_alumni_quarter', 'refreeze_alumni_quarter', 'correct_alumni_snapshot', 'close_alumni_quarter', 'alumni_company_missing', 'alumni_merge_company_data',
      'get_alumni_portfolio', 'list_alumni_attention', 'alumni_quarter_rows', 'list_alumni_quarter_status', 'alumni_reminder_audience', 'alumni_year_rollup'];
begin
  -- the ONLY functions that read public.company_snapshots directly belong to the quarterly model itself
  select count(*) into v_n from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ilike '%public.company_snapshots%' and not (p.proname = any (v_ok));
  if v_n > 0 then
    raise exception 'm67: % function(s) read company_snapshots outside the quarterly model: %', v_n,
      (select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and p.prosrc ilike '%public.company_snapshots%' and not (p.proname = any (v_ok)));
  end if;
  raise notice 'm67 ok';
end $$;

commit;
