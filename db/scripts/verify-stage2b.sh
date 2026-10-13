#!/usr/bin/env bash
# Stage 2b verification (LOCAL ONLY). Prints PASS/FAIL lines; exit 1 on any FAIL.
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API=http://127.0.0.1:54321
ANON="$(cd "$ROOT/local-db/stack" && npx supabase status -o env 2>/dev/null | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')"
db() { docker exec -i supabase_db_stack psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 -c "$1"; }
fail=0
chk() { if [ "$2" = "$3" ]; then echo "PASS $1 ($3)"; else echo "FAIL $1 expected=$2 actual=$3"; fail=1; fi; }

# every migrated path column / reference that is still set
PATHS="select 'projects.cover_path' s, cover_path p from public.projects where cover_path is not null
 union all select 'network_experts.photo_path', photo_path from public.network_experts where photo_path is not null
 union all select 'companies.logo_path', logo_path from public.companies where logo_path is not null
 union all select 'form_covers.image_path', image_path from public.form_covers where image_path is not null
 union all select 'landing_cards.cover_path', cover_path from public.landing_cards where cover_path is not null
 union all select 'public_links.og_image_path', og_image_path from public.public_links where og_image_path is not null
 union all select 'resources.file_path', file_path from public.resources where file_path is not null
 union all select 'profiles.avatar_path', avatar_path from public.profiles where avatar_path is not null
 union all select 'founders.photo_path', photo_path from public.founders where photo_path is not null
 union all select 'nodes.config.hero.coverPath', config#>>'{hero,coverPath}' from public.nodes where config#>>'{hero,coverPath}' is not null
 union all select 'form_templates.definition', r.new_path from migration.asset_refs r where r.ref_table='form_templates'
   and exists (select 1 from public.form_templates f where f.id::text = r.ref_id and position(r.new_path in f.definition::text) > 0)
 union all select 'answers.logo_url', coalesce(answers->>'logo_url', answers->>'logo') from public.form_responses where coalesce(answers->>'logo_url', answers->>'logo') is not null"
chk "V13.2 non-NULL path values registered in asset_map" 0 "$(db "select count(*) from ($PATHS) t where not exists (select 1 from migration.asset_map m where m.new_path = t.p)")"
chk "V13.2 non-NULL path values with a missing object in storage.objects" 0 "$(db "select count(*) from ($PATHS) t join migration.asset_map m on m.new_path = t.p where not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = t.p)")"
chk "V13.4 every done image has its _t.webp thumbnail" 0 "$(db "select count(*) from migration.asset_map m where m.status='done' and m.new_path like '%.webp' and not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = replace(m.new_path,'.webp','_t.webp'))")"
chk "V13.1 asset_map: no pending, 1 skipped_static" "0|1" "$(db "select count(*) filter (where status='pending') || '|' || count(*) filter (where status='skipped_static') from migration.asset_map")"
chk "V13.1 done + failed = 107 (46 bucket + 61 external)" 107 "$(db "select count(*) from migration.asset_map where status in ('done','failed')")"
chk "failed refs have NULL path columns (companies/experts)" 0 "$(db "select count(*) from migration.v_asset_failures f join public.network_experts e on e.id::text = (select ref_id from migration.asset_refs r where r.old_path = f.original_url limit 1) where e.photo_path is not null")"
chk "V13.6 event-assets object count unchanged" 112 "$(db "select count(*) from storage.objects where bucket_id='event-assets'")"
chk "V13.3 PDF bytes = original (5/5)" 0 "$(db "select count(*) from migration.asset_result r join migration.asset_map m using (old_path) where m.bucket='resources' and (r.original_bytes <> r.full_bytes or r.original_bytes <> (select (o.metadata->>'size')::bigint from storage.objects o where o.bucket_id='resources' and o.name=m.new_path))")"
chk "asset_map keeps the original URL of every external row" 61 "$(db "select count(*) from migration.asset_map where source='external' and old_path like 'http%'")"
chk "bucket asset_map rows not done (file-less production orphans must not be referenced)" 0 "$(db "select count(*) from migration.asset_map m where m.source='bucket' and m.status <> 'done'")"

echo "--- event-assets: objects with metadata but no file (expected 18 = production orphans)"
miss=0
for n in $(db "select name from storage.objects where bucket_id='event-assets' and name not like '%.emptyFolderPlaceholder' order by 1"); do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$API/storage/v1/object/public/event-assets/$n"); [ "$c" = 200 ] || miss=$((miss+1))
done
chk "event-assets objects without a file" 18 "$miss"

echo "--- HTTP: public-assets public URLs"
ok=0; n=0
for p in $(db "select bucket||'/'||new_path from migration.asset_map where status='done' and bucket='public-assets' order by random() limit 12") ; do
  n=$((n+1)); c=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$API/storage/v1/object/public/$p"); [ "$c" = "200 image/webp" ] && ok=$((ok+1))
  t=$(curl -s -o /dev/null -w '%{http_code}' "$API/storage/v1/object/public/${p%.webp}_t.webp"); [ "$t" = 200 ] || ok=$((ok-1))
done
chk "public-assets sample full + thumbnail = 200 image/webp" "$n" "$ok"

echo "--- storage RLS: anon"
rp="$(db "select new_path from migration.asset_map where bucket='resources' limit 1")"
c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$API/storage/v1/object/resources/$rp")
case "$c" in 400|401|403|404) echo "PASS anon cannot read private bucket 'resources' directly ($c)";; *) echo "FAIL anon read private object ($c)"; fail=1;; esac
c=$(curl -s -o /dev/null -w '%{http_code}' "$API/storage/v1/object/public/resources/$rp")
case "$c" in 200) echo "FAIL private bucket served via /public ($c)"; fail=1;; *) echo "PASS private bucket not served via /public ($c)";; esac
c=$(curl -s -o /dev/null -w '%{http_code}' "$API/storage/v1/object/public/migration-archive/external/x")
[ "$c" != 200 ] && echo "PASS migration-archive private ($c)" || { echo "FAIL migration-archive public"; fail=1; }
chk "anon JSON list of private bucket returns no object" 0 "$(curl -s -X POST -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{"prefix":"","limit":5}' "$API/storage/v1/object/list/resources" | grep -o '"name"' | wc -l)"
chk "anon storage policies: only public-assets/event-assets SELECT" 0 "$(db "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and 'anon' = any(roles) and cmd <> 'SELECT'")"

echo "--- totals"
db "select 'event-assets before: 112 objects / 72911628 bytes (baseline)'"
db "select bucket_id||': '||count(*)||' objects, '||coalesce(sum((metadata->>'size')::bigint),0)||' bytes' from storage.objects group by bucket_id order by 1"
db "select 'external originals: '||count(*)||' files, '||sum(original_bytes)||' bytes -> full '||sum(full_bytes)||' + thumbs '||sum(thumb_bytes) from migration.asset_result where archive_path is not null and outcome='done'"
db "select 'bucket images originals: '||sum(original_bytes)||' bytes -> full '||sum(full_bytes)||' + thumbs '||sum(thumb_bytes) from migration.asset_result r join migration.asset_map m using(old_path) where m.source='bucket' and m.bucket='public-assets' and outcome='done'"
exit $fail
