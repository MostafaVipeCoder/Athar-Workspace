#!/usr/bin/env bash
# Regenerates db/RECONCILIATION.md from the LOCAL database (read-only).   bash db/reconcile.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
C="${DB_CONTAINER:-supabase_db_stack}"; DB="${DB_NAME:-postgres}"
case "$C" in supabase_db_*) ;; *) echo "refusing: not a local supabase_db_* container" >&2; exit 2;; esac
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker exec -i "$C" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$DIR/verify/v12_reconciliation_report.sql" > "$DIR/RECONCILIATION.md"
echo "wrote $DIR/RECONCILIATION.md ($(wc -l < "$DIR/RECONCILIATION.md") lines)"
