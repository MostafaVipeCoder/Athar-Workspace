-- s2b_b_apply_paths (STAGE 2b, LOCAL ONLY, idempotent). Run AFTER migrate-storage.mjs.
-- done   -> asset_map.status = 'done' (set by the script); *_path columns already hold the deterministic path (re-asserted here).
-- failed -> *_path column set to NULL (design 05 phase 13 step 5 / OD-10); the original URL stays in asset_map.old_path and the owning
--           row stays in asset_refs; a 'review' flag + migration.v_asset_failures list them for the owner (db/ASSET-REPORT.md).
\set ON_ERROR_STOP on
begin;
-- re-assert paths of done external refs (idempotent restore after an earlier failed attempt)
update public.companies c set logo_path = r.new_path
  from migration.asset_refs r join migration.asset_map m using (old_path)
  where r.ref_table='companies' and r.ref_column='logo_path' and r.ref_id = c.id::text and m.status='done' and c.logo_path is distinct from r.new_path;
update public.network_experts e set photo_path = r.new_path
  from migration.asset_refs r join migration.asset_map m using (old_path)
  where r.ref_table='network_experts' and r.ref_column='photo_path' and r.ref_id = e.id::text and m.status='done' and e.photo_path is distinct from r.new_path;
-- blank failed refs (recorded, never silent)
update public.companies c set logo_path = null
  from migration.asset_refs r join migration.asset_map m using (old_path)
  where r.ref_table='companies' and r.ref_column='logo_path' and r.ref_id = c.id::text and m.status='failed' and c.logo_path is not null;
update public.network_experts e set photo_path = null
  from migration.asset_refs r join migration.asset_map m using (old_path)
  where r.ref_table='network_experts' and r.ref_column='photo_path' and r.ref_id = e.id::text and m.status='failed' and e.photo_path is not null;

create or replace view migration.v_asset_failures as
select m.old_path as original_url, m.kind, r.ref_table as entity_kind,
       case r.ref_table when 'companies' then (select coalesce(c.name_en, c.name_ar) from public.companies c where c.id::text = r.ref_id)
                        when 'network_experts' then (select coalesce(e.name_en, e.name_ar) from public.network_experts e where e.id::text = r.ref_id)
                        else r.ref_id end as display_name,
       r.ref_column, a.reason
from migration.asset_map m join migration.asset_refs r on r.old_path = m.old_path
left join migration.asset_result a on a.old_path = m.old_path
where m.status = 'failed';
revoke all on migration.v_asset_failures from public, anon, authenticated;

select migration.flag('asset_image_unreachable', 'review', 'migration.asset_map', old_path,
  'external image not downloadable (' || coalesce((select reason from migration.asset_result a where a.old_path = m.old_path), '?') || '); path column set NULL, original URL kept in asset_map; see db/ASSET-REPORT.md')
from migration.asset_map m where status = 'failed';
commit;
