#!/usr/bin/env bash
# Stage 2b runner (LOCAL ONLY). Needs: local stack running, Docker, a scratch dir with `npm i sharp` (SHARP_DIR).
#   SHARP_DIR=/path/to/scratch bash db/scripts/run-stage2b.sh [--all]
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${SHARP_DIR:?set SHARP_DIR to a directory containing node_modules/sharp}"
SRK="$(cd "$ROOT/local-db/stack" && npx supabase status -o env 2>/dev/null | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
export SERVICE_ROLE_KEY="$SRK"
C=supabase_db_stack
docker exec -i $C psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < "$ROOT/db/migrations/s2b_a_asset_result.sql"
node "$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")/db/scripts/migrate-storage.mjs" "$@"
docker exec -i $C psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < "$ROOT/db/migrations/s2b_b_apply_paths.sql"
echo "stage 2b run complete; verify with: bash db/scripts/verify-stage2b.sh"
