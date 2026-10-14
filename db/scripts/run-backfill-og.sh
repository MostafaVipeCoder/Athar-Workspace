#!/usr/bin/env bash
# JPEG link-preview backfill runner (LOCAL ONLY): dry run by default, `--apply` writes og-images/<owner>/<kind>/<uuid>.jpg through the Storage API.
#   SHARP_DIR=/path/to/dir-with-node_modules/sharp bash db/scripts/run-backfill-og.sh [--apply] [--limit N] [--report out.json] [--verbose]
# Needs: the local supabase stack running, Docker, m45 applied, and a scratch directory OUTSIDE the repository with `npm i sharp` (SHARP_DIR).
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${SHARP_DIR:?set SHARP_DIR to a directory containing node_modules/sharp}"
SRK="$(cd "$ROOT/local-db/stack" && npx supabase status -o env 2>/dev/null | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
export SERVICE_ROLE_KEY="$SRK"
docker exec -i supabase_db_stack psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "select to_regprocedure('app_private.og_missing_refs()') is not null as m45_applied" | grep -q t || { echo "apply db/migrations/m45_originals_and_og.sql first"; exit 1; }
node "$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")/db/scripts/backfill-og-images.mjs" "$@"
