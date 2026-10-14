#!/usr/bin/env bash
# Universal-WebP converter runner (LOCAL ONLY). Dry run by default; two explicit steps (they cannot be combined):
#   SHARP_DIR=/path/to/dir-with-node_modules/sharp bash db/scripts/run-convert-images.sh                       # dry run: nothing is written
#   SHARP_DIR=... bash db/scripts/run-convert-images.sh --apply                                                 # step 1: WebP siblings + every reference rewritten, nothing deleted
#   SHARP_DIR=... bash db/scripts/run-convert-images.sh --delete-originals --dry-run                            # step 2 preview
#   SHARP_DIR=... bash db/scripts/run-convert-images.sh --delete-originals                                      # step 2: manifest first, then delete through the Storage API
#   other flags: [--buckets public-assets,resources] [--limit N] [--report out.json] [--manifest file.csv] [--verbose]
# Needs: the local supabase stack running, Docker, m41 + m45 applied, and a scratch directory OUTSIDE the repository with `npm i sharp` (SHARP_DIR).
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${SHARP_DIR:?set SHARP_DIR to a directory containing node_modules/sharp}"
SRK="$(cd "$ROOT/local-db/stack" && npx supabase status -o env 2>/dev/null | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
export SERVICE_ROLE_KEY="$SRK"
docker exec -i supabase_db_stack psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "select to_regclass('app_private.image_conversions') is not null and to_regprocedure('app_private.storage_dangling_refs()') is not null as m41_m45_applied" | grep -q t || { echo "apply db/migrations/m41_webp.sql and m45_originals_and_og.sql first"; exit 1; }
node "$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")/db/scripts/convert-images.mjs" "$@"
