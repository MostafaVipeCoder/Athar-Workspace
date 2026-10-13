#!/usr/bin/env bash
# Universal-WebP converter runner (LOCAL ONLY): dry run by default, `--apply` to convert what current data references.
#   SHARP_DIR=/path/to/dir-with-node_modules/sharp bash db/scripts/run-convert-images.sh [--apply] [--buckets public-assets,resources] [--report out.json] [--verbose]
# Needs: the local supabase stack running, Docker, and a scratch directory OUTSIDE the repository with `npm i sharp`. Never deletes an original.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${SHARP_DIR:?set SHARP_DIR to a directory containing node_modules/sharp}"
SRK="$(cd "$ROOT/local-db/stack" && npx supabase status -o env 2>/dev/null | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
export SERVICE_ROLE_KEY="$SRK"
docker exec -i supabase_db_stack psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "select to_regprocedure('app_private.storage_dangling_refs()') is not null as m41_applied" | grep -q t || { echo "apply db/migrations/m41_webp.sql first"; exit 1; }
node "$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")/db/scripts/convert-images.mjs" "$@"
