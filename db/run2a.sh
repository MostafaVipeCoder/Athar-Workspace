#!/usr/bin/env bash
# Stage 2a runner: runs db/migrations/m10..m90 (business-data load) and/or db/verify/v10+ against the LOCAL Docker Postgres.
#   bash db/run2a.sh                 # m10..m90 then v10..
#   bash db/run2a.sh load            # only m10..m90
#   bash db/run2a.sh verify          # only db/verify/v10* (post-load verification) + v01/v03
#   bash db/run2a.sh file db/migrations/m12_load_entities.sql
# Env: DB_CONTAINER (default supabase_db_stack), DB_NAME (default postgres)
set -euo pipefail
export MSYS_NO_PATHCONV=1
CONTAINER="${DB_CONTAINER:-supabase_db_stack}"; DB_NAME="${DB_NAME:-postgres}"; DB_USER="${DB_USER:-postgres}"
case "$CONTAINER" in supabase_db_*) ;; *) echo "refusing: $CONTAINER is not a local supabase_db_* container" >&2; exit 2;; esac
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$(cygpath -m "$DIR" 2>/dev/null || echo "$DIR")"
LOG_DIR="$DIR/../local-db/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stage2a-$(date +%Y%m%d-%H%M%S).log"
docker exec "$CONTAINER" rm -rf /tmp/db
docker cp "$HOST_DIR" "$CONTAINER:/tmp/db"
psql_file() {
  echo "=== $1" | tee -a "$LOG"
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -v ON_ERROR_STOP=1 -f "/tmp/db/$1" 2>&1 | tee -a "$LOG"
  test "${PIPESTATUS[0]}" -eq 0 || { echo "FAILED: $1 (see $LOG)" >&2; exit 1; }
}
mode="${1:-all}"; shift || true
case "$mode" in
  all)    for f in "$DIR"/migrations/m[1-9][0-9]_*.sql; do psql_file "migrations/$(basename "$f")"; done
          for f in "$DIR"/verify/v10_*.sql "$DIR"/verify/v11_*.sql; do psql_file "verify/$(basename "$f")"; done ;;
  load)   for f in "$DIR"/migrations/m[1-9][0-9]_*.sql; do psql_file "migrations/$(basename "$f")"; done ;;
  verify) for f in "$DIR"/verify/v01_*.sql "$DIR"/verify/v10_*.sql "$DIR"/verify/v11_*.sql; do psql_file "verify/$(basename "$f")"; done ;;
  file)   for f in "$@"; do psql_file "${f#db/}"; done ;;
  *) echo "unknown mode $mode" >&2; exit 2 ;;
esac
echo "OK (log: $LOG)"
