-- m21_merge_companies  (owner decision 08 s8 05-d and s10; STAGE 2a, LOCAL ONLY)
-- Runs the 20 approved merges (16 exact + 4 probable duplicates) through public.merge_companies(keep, drop) using the plan computed in m12.
--  * one canonical company is kept, every list item / booking / participant / founder / snapshot / invitation of the dropped row is repointed
--    to it, so the company still appears in every program it appears in today (checked per pair: programs before = programs after);
--  * same-list pairs (To7fa, Otaku) collapse into one list item; the dropped item's overlay is preserved in overlay.merged_from;
--  * the two exact pairs with different descriptions keep the MORE RECENT row (decided in m12); the other text stays in legacy.companies;
--  * the 4 probable pairs get the bilingual display name "English (Arabic)" of the first-listed copy, Arabic part also in name_ar;
--  * the dropped rows are removed from public.companies; they remain in legacy.companies (archive) and in migration.company_merges.
-- merge_companies() requires a super_admin caller: the transaction impersonates the owner account via request.jwt.claims (local to the txn).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m21_merge_companies') as id;
\o /dev/null

select set_config('request.jwt.claims',
  jsonb_build_object('sub', (select ur.user_id from public.user_roles ur join auth.users u on u.id = ur.user_id
                              where ur.role_key = 'super_admin' and lower(u.email) = 'abdullah.shaban@athareg.com'), 'role', 'authenticated')::text, true);

create temp table t_prog_before (keep_id uuid, drop_id uuid, programs uuid[]) on commit drop;

do $$
declare
  p record; v_res jsonb; v_before uuid[]; v_after uuid[]; k public.companies; d public.companies; n_items int;
begin
  for p in select * from migration.company_merge_plan mp
            where mp.drop_id not in (select drop_id from migration.company_merges)
            order by case mp.kind when 'exact' then 0 else 1 end, mp.keep_id, mp.drop_id loop
    select * into k from public.companies where id = p.keep_id;
    select * into d from public.companies where id = p.drop_id;
    if k.id is null or d.id is null then raise exception 'merge plan row % / % has no loaded company', p.keep_id, p.drop_id; end if;

    -- programs the pair covers today
    select coalesce(array_agg(distinct x order by x), '{}') into v_before from (
      select j.program_id x from public.list_items li join public.nodes n on n.id = li.list_node_id join public.projects j on j.id = n.project_id where li.company_id in (p.keep_id, p.drop_id)
      union select j.program_id from public.bookings b join public.projects j on j.id = b.project_id where b.booker_company_id in (p.keep_id, p.drop_id)
      union select j.program_id from public.participants pa join public.projects j on j.id = pa.project_id where pa.company_id in (p.keep_id, p.drop_id)
      union select j.program_id from public.companies c join public.projects j on j.id = c.origin_project_id where c.id in (p.keep_id, p.drop_id)) s;

    -- same-list duplicates: keep the overlay of the dropped item under overlay.merged_from
    update public.list_items ki set overlay = ki.overlay || jsonb_build_object('merged_from',
             coalesce(ki.overlay->'merged_from', '{}'::jsonb) || jsonb_build_object(di.id::text, di.overlay))
    from public.list_items di
    where di.company_id = p.drop_id and ki.company_id = p.keep_id and ki.list_node_id = di.list_node_id;
    get diagnostics n_items = row_count;

    -- fill ONLY empty columns of the canonical row from the dropped row (nothing is overwritten)
    update public.companies c set
      description_en = coalesce(c.description_en, d.description_en), description_ar = coalesce(c.description_ar, d.description_ar),
      industry_en = coalesce(c.industry_en, d.industry_en), industry_ar = coalesce(c.industry_ar, d.industry_ar),
      location_en = coalesce(c.location_en, d.location_en), location_ar = coalesce(c.location_ar, d.location_ar),
      governorate_en = coalesce(c.governorate_en, d.governorate_en), governorate_ar = coalesce(c.governorate_ar, d.governorate_ar),
      stage = coalesce(c.stage, d.stage), employees = coalesce(c.employees, d.employees), founding_year = coalesce(c.founding_year, d.founding_year),
      logo_path = coalesce(c.logo_path, d.logo_path), website_url = coalesce(c.website_url, d.website_url), linkedin_url = coalesce(c.linkedin_url, d.linkedin_url),
      links = case when c.links = '[]'::jsonb then d.links else c.links end,
      is_alumni = c.is_alumni or d.is_alumni
    where c.id = p.keep_id;
    if k.logo_path is null and d.logo_path is not null then
      insert into migration.asset_refs (ref_table, ref_id, ref_column, old_path, new_path, kind, project_id)
      select r.ref_table, p.keep_id::text, r.ref_column, r.old_path, r.new_path, r.kind, r.project_id
      from migration.asset_refs r where r.ref_table = 'companies' and r.ref_id = p.drop_id::text and r.ref_column = 'logo_path'
      on conflict do nothing;
    end if;

    -- probable pairs: bilingual display name of the first-listed copy, Arabic part into name_ar
    if p.kind = 'probable' then
      update public.companies c set name_ar = coalesce(c.name_ar, nullif(btrim(substring(c.name_en from '\(([^)]*)\)')), '')) where c.id = p.keep_id;
    end if;

    v_res := public.merge_companies(p.keep_id, p.drop_id)
             || jsonb_build_object('same_list_overlays_preserved', n_items);

    select coalesce(array_agg(distinct x order by x), '{}') into v_after from (
      select j.program_id x from public.list_items li join public.nodes n on n.id = li.list_node_id join public.projects j on j.id = n.project_id where li.company_id = p.keep_id
      union select j.program_id from public.bookings b join public.projects j on j.id = b.project_id where b.booker_company_id = p.keep_id
      union select j.program_id from public.participants pa join public.projects j on j.id = pa.project_id where pa.company_id = p.keep_id
      union select j.program_id from public.companies c join public.projects j on j.id = c.origin_project_id where c.id = p.keep_id) s;
    if not (v_before <@ v_after) then
      raise exception 'merge % -> % would remove the company from a program (before %, after %)', p.drop_id, p.keep_id, v_before, v_after;
    end if;
    insert into t_prog_before values (p.keep_id, p.drop_id, v_before);

    -- the dropped row is archived in legacy.companies; remove it from the live table
    delete from public.companies where id = p.drop_id;
    delete from migration.asset_refs where ref_table = 'companies' and ref_id = p.drop_id::text;

    insert into migration.company_merges (keep_id, drop_id, keep_name, drop_name, kind, result)
    values (p.keep_id, p.drop_id, k.name_en, d.name_en, p.kind, v_res);
    insert into migration.id_map (entity, old_id, new_id, note)
    values ('company_merged', p.drop_id::text, p.keep_id, p.kind || ' duplicate merged into the canonical company (08 s10)') on conflict do nothing;
    update migration.flags set resolved_at = now(),
           message = message || ' -- MERGED (owner decision 08 s10, ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ')'
    where code = 'company_duplicate' and ref_id = p.drop_id::text and resolved_at is null;
  end loop;
end $$;

-- pending asset records that no longer have a reference (dropped company logos duplicated by the canonical row)
update migration.asset_map m set status = 'unreferenced', note = 'reference removed by a company merge; object stays in the legacy bucket'
where m.status = 'pending' and not exists (select 1 from migration.asset_refs r where r.old_path = m.old_path);

-- ================================================================= verification
select migration.check((select id from _r), 'V21.1 merges executed', '20', (select count(*)::text from migration.company_merges));
select migration.check((select id from _r), 'V21.1 exact / probable', '16/4',
  (select (select count(*) from migration.company_merges where kind = 'exact') || '/' || (select count(*) from migration.company_merges where kind = 'probable')));
select migration.check((select id from _r), 'V21.2 companies = legacy - merged', ((select count(*) from legacy.companies) - 20)::text, (select count(*)::text from public.companies));
select migration.check((select id from _r), 'V21.2 no reference to a dropped company remains', '0',
  (select ((select count(*) from public.list_items where company_id in (select drop_id from migration.company_merges)) +
           (select count(*) from public.bookings where booker_company_id in (select drop_id from migration.company_merges)) +
           (select count(*) from public.participants where company_id in (select drop_id from migration.company_merges)) +
           (select count(*) from public.company_founders where company_id in (select drop_id from migration.company_merges)) +
           (select count(*) from public.companies where id in (select drop_id from migration.company_merges)))::text));
-- the per-pair "programs before are a subset of programs after" assertion RAISES inside the merge loop above; here: no canonical company is left without any program
select migration.check((select id from _r), 'V21.3 every canonical company is still in at least one program/project', '0',
  (select count(*)::text from migration.company_merges m
    where not exists (select 1 from public.list_items li where li.company_id = m.keep_id)
      and not exists (select 1 from public.companies c where c.id = m.keep_id and c.origin_project_id is not null)));
select migration.check((select id from _r), 'V21.3 company list items: programs covered per company (merged pairs)', 'ok',
  (select case when bool_and(exists (select 1 from public.list_items li where li.company_id = m.keep_id)) then 'ok' else 'missing' end from migration.company_merges m));
select migration.check((select id from _r), 'V21.3 dropped companies remain in the legacy archive', '20',
  (select count(*)::text from migration.company_merges m join legacy.companies c on c.company_id = m.drop_id));
select migration.check((select id from _r), 'V21.4 company list items = 614 company+selection+expert+team minus collapsed',
  ((select count(*) from legacy.companies) - (select sum((result->>'items_collapsed')::int) from migration.company_merges))::text,
  (select count(*)::text from public.list_items where source_kind = 'company'));
select migration.check((select id from _r), 'V21.5 same-program pairs collapsed (To7fa, Otaku)', '2', (select sum((result->>'items_collapsed')::int)::text from migration.company_merges));
select migration.check((select id from _r), 'V21.6 description-differing pairs keep the more recent row', 'true',
  (select coalesce(bool_and(c.description_en is not distinct from nullif(btrim(l.description), '')), true)::text from migration.company_merges m
     join public.companies c on c.id = m.keep_id join legacy.companies l on l.company_id = m.keep_id
     join legacy.companies ld on ld.company_id = m.drop_id
     where m.kind = 'exact' and md5(regexp_replace(lower(coalesce(l.description,'')), '\s+', '', 'g')) <> md5(regexp_replace(lower(coalesce(ld.description,'')), '\s+', '', 'g'))));
select migration.check((select id from _r), 'V21.7 probable pairs: bilingual name and Arabic name_ar', '4',
  (select count(*)::text from migration.company_merges m join public.companies c on c.id = m.keep_id
    where m.kind = 'probable' and c.name_en ~ '\(.*\)' and c.name_ar is not null and c.name_en like '%(' || c.name_ar || ')'));
select migration.check((select id from _r), 'V21.8 open duplicate flags', '0', (select count(*)::text from migration.flags where code = 'company_duplicate' and resolved_at is null));
select migration.check((select id from _r), 'V21.9 interview bookings still linked to a company', '17',
  (select count(*)::text from public.bookings where booker_company_id is not null));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
select m.kind, m.keep_name, left(m.drop_name, 30) dropped, m.result->>'items_moved' moved, m.result->>'items_collapsed' collapsed from migration.company_merges m order by m.kind, m.keep_name;
commit;
