-- m12_load_entities  (05 phase 5; STAGE 2a, LOCAL ONLY)
-- network_experts (42 'expert' from master_experts + 2 'team' from ather_team_members of existing events),
-- companies (161, one row per old row, ids preserved), merge plan + the 20 duplicate flags (the merges themselves run in m20).
-- Re-run safe: rows whose company was already merged (migration.company_merges) are not re-created.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m12_load_entities') as id;
\o /dev/null

-- ---------------------------------------------------------------- network_experts: kind expert (per-event Arabic copies promoted when the master has none)
insert into public.network_experts (id, kind, name_en, name_ar, title_en, title_ar, company_en, company_ar, bio_en, bio_ar,
                                    photo_path, linkedin_url, email, created_at, updated_at)
select m.id, 'expert', m.name, coalesce(nullif(btrim(m.name_ar),''), x.name_ar), nullif(btrim(m.title),''),
       coalesce(nullif(btrim(m.title_ar),''), x.title_ar), nullif(btrim(m.company),''), coalesce(nullif(btrim(m.company_ar),''), x.company_ar),
       nullif(btrim(m.bio),''), coalesce(nullif(btrim(m.bio_ar),''), x.bio_ar),
       migration.register_asset('expert-photo', null, m.photo_url, 'network_experts', m.id::text, 'photo_path'),
       nullif(btrim(m.linkedin_url),''), null, m.created_at, m.updated_at
from legacy.master_experts m
left join lateral (select max(nullif(btrim(e.name_ar),'')) name_ar, max(nullif(btrim(e.title_ar),'')) title_ar,
                          max(nullif(btrim(e.company_ar),'')) company_ar, max(nullif(btrim(e.bio_ar),'')) bio_ar
                   from legacy.experts e where e.master_id = m.id) x on true
on conflict (id) do nothing;

-- Athar team (events that still exist); the member of the deleted event is not loaded (quarantined, see legacy.v_quarantine_*)
insert into public.network_experts (id, kind, name_en, bio_en, photo_path, email, created_at, updated_at)
select t.id, 'team', t.name, nullif(btrim(t.bio),''),
       migration.register_asset('expert-photo', null, t.photo_url, 'network_experts', t.id::text, 'photo_path'),
       nullif(btrim(t.email),''), t.created_at, t.updated_at
from legacy.ather_team_members t
where t.event_id in (select event_id::text from legacy.events)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- merge plan (16 exact + 4 probable; owner decision 08 section 10)
create table if not exists migration.company_merge_plan (
  drop_id uuid primary key, keep_id uuid not null, kind text not null check (kind in ('exact','probable')), reason text
);
revoke all on migration.company_merge_plan from public, anon, authenticated;

with c as (
  select co.company_id, co.name, co.event_id, e.created_at ev_created,
         regexp_replace(lower(co.name), '\s+', '', 'g') k,
         md5(regexp_replace(lower(coalesce(co.description, co.bio, '')), '\s+', '', 'g')) dh,
         (select count(*) from legacy.ather_team_bookings b
           where b.event_id = co.event_id::text and lower(btrim(b.company_name)) = lower(btrim(co.name)))
         + (select count(*) from legacy.bookings b
             where b.event_id = co.event_id::text and lower(btrim(b.company_name)) = lower(btrim(co.name))) refs
  from legacy.companies co join legacy.events e on e.event_id = co.event_id
), g as (
  select k from c group by k having count(*) = 2
), pairs as (
  select a.company_id a_id, b.company_id b_id, a.dh <> b.dh desc_differs, a.refs a_refs, b.refs b_refs,
         a.ev_created a_ev, b.ev_created b_ev
  from c a join c b on a.k = b.k and a.company_id < b.company_id
  where a.k in (select k from g)
), pick as (
  select p.*,
    case when p.desc_differs then (case when p.b_ev > p.a_ev then p.b_id when p.a_ev > p.b_ev then p.a_id else greatest(p.a_id, p.b_id) end)
         when p.a_refs <> p.b_refs then (case when p.a_refs > p.b_refs then p.a_id else p.b_id end)
         else (case when p.a_ev <= p.b_ev then p.a_id else p.b_id end) end keep_id,
    case when p.desc_differs then 'description differs: more recent row is canonical (owner default 08 s10)'
         when p.a_refs <> p.b_refs then 'canonical = the row referenced by more bookings'
         else 'identical rows: canonical = older row' end reason
  from pairs p
)
insert into migration.company_merge_plan (drop_id, keep_id, kind, reason)
select case when keep_id = a_id then b_id else a_id end, keep_id, 'exact', reason from pick
on conflict (drop_id) do nothing;

-- the 4 probable pairs named by the owner: keep = first-listed copy
insert into migration.company_merge_plan (drop_id, keep_id, kind, reason)
select d.company_id, k.company_id, 'probable', 'owner-approved probable duplicate; display name = bilingual form of the first-listed copy'
from (values ('To7fa (تحفة)', 'تحفة To7fa'), ('Otaku (أوتاكو)', 'أوتاكو-Otaku'),
             ('Moni Cake (موني كيك)', 'موني كيك (Moni Cake)'), ('Cocorra (كوكورا)', 'كوكورا cocorra')) v(keep_name, drop_name)
join legacy.companies k on k.name = v.keep_name
join legacy.companies d on d.name = v.drop_name
on conflict (drop_id) do nothing;

-- ---------------------------------------------------------------- companies (one row per old row; merged rows are not re-created)
insert into public.companies (id, name_en, name_ar, description_en, description_ar, industry_en, industry_ar, location_en, location_ar,
                              governorate_en, governorate_ar, stage, employees, founding_year, logo_path, website_url, linkedin_url, links,
                              is_alumni, origin_project_id, created_at, updated_at)
select c.company_id, c.name, nullif(btrim(c.name_ar),''),
       coalesce(nullif(btrim(c.description),''), nullif(btrim(c.bio),'')), nullif(btrim(c.description_ar),''),
       coalesce(nullif(btrim(c.industry),''), nullif(btrim(c.sector),'')), nullif(btrim(c.industry_ar),''),
       nullif(btrim(c.location),''), nullif(btrim(c.location_ar),''),
       coalesce(nullif(btrim(c.governorate),''), nullif(btrim(c.province),'')), nullif(btrim(c.governorate_ar),''),
       nullif(btrim(c.stage),''), nullif(btrim(c.employees),''), c.founding_year,
       migration.register_asset('company-logo', null, c.logo_url, 'companies', c.company_id::text, 'logo_path'),
       nullif(btrim(c.website_url),''), nullif(btrim(c.linkedin_url),''),
       coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('type', l->>'icon', 'url', l->>'url', 'label', l->>'label')))
                 from jsonb_array_elements(case when jsonb_typeof(c.links) = 'array' then c.links else '[]'::jsonb end) l), '[]'::jsonb),
       coalesce(c.is_alumni, false), c.event_id, e.created_at, e.created_at
from legacy.companies c
left join legacy.events e on e.event_id = c.event_id
where c.company_id not in (select drop_id from migration.company_merges)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- flags: 20 duplicate candidates (resolved by m20 when merged)
select migration.flag('company_duplicate', 'review', 'company', p.drop_id::text,
       p.kind || ' duplicate of "' || (select name from legacy.companies where company_id = p.keep_id) || '" (canonical ' || p.keep_id::text || '): ' || p.reason)
from migration.company_merge_plan p;

-- ================================================================= verification
select migration.check((select id from _r), 'V05.1 network_experts expert = master_experts', (select count(*)::text from legacy.master_experts),
  (select count(*)::text from public.network_experts where kind = 'expert'));
select migration.check((select id from _r), 'V05.1 network_experts team = members of existing events',
  (select count(*)::text from legacy.ather_team_members t where t.event_id in (select event_id::text from legacy.events)),
  (select count(*)::text from public.network_experts where kind = 'team'));
select migration.check((select id from _r), 'V05.2 no per-event Arabic copy lost', '0',
  (select count(*)::text from legacy.experts e join public.network_experts n on n.id = e.master_id
    where (nullif(btrim(e.name_ar),'') is not null and n.name_ar is null) or (nullif(btrim(e.title_ar),'') is not null and n.title_ar is null)
       or (nullif(btrim(e.company_ar),'') is not null and n.company_ar is null) or (nullif(btrim(e.bio_ar),'') is not null and n.bio_ar is null)));
select migration.check((select id from _r), 'V05.3 companies = legacy - merged',
  ((select count(*) from legacy.companies) - (select count(*) from migration.company_merges))::text, (select count(*)::text from public.companies));
select migration.check((select id from _r), 'V05.3 companies checksum (rows outside the merge plan)',
  (select md5(string_agg(company_id::text || name || coalesce(nullif(btrim(description),''), nullif(btrim(bio),''), '') || coalesce(nullif(btrim(industry),''), nullif(btrim(sector),''), '') || coalesce(nullif(btrim(governorate),''), nullif(btrim(province),''), ''), ',' order by company_id))
     from legacy.companies where company_id not in (select drop_id from migration.company_merge_plan union select keep_id from migration.company_merge_plan)),
  (select md5(string_agg(id::text || name_en || coalesce(description_en, '') || coalesce(industry_en, '') || coalesce(governorate_en, ''), ',' order by id))
     from public.companies where id not in (select drop_id from migration.company_merge_plan union select keep_id from migration.company_merge_plan)));
select migration.check((select id from _r), 'V05.4 company link objects preserved (rows outside merged)',
  (select coalesce(sum(jsonb_array_length(links)),0)::text from legacy.companies where company_id not in (select drop_id from migration.company_merges)),
  (select coalesce(sum(jsonb_array_length(links)),0)::text from public.companies));
select migration.check((select id from _r), 'V05.6 duplicate flags (open + resolved)', '20', (select count(*)::text from migration.flags where code = 'company_duplicate'));
select migration.check((select id from _r), 'V05.6 merge plan: 16 exact + 4 probable', '16/4',
  (select (select count(*) from migration.company_merge_plan where kind = 'exact') || '/' || (select count(*) from migration.company_merge_plan where kind = 'probable')));
select migration.check_design((select id from _r), 'D05.1 design: network_experts 44 / companies 161 (before merges)', '44/161',
  (select (select count(*) from public.network_experts) || '/' || ((select count(*) from public.companies) + (select count(*) from migration.company_merges))));

select migration.finish_run((select id from _r));
\o
select check_key, expected, actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
