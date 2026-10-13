#!/usr/bin/env bash
# STAGE 1 runner (m00..m07 + v01..v03 only; stage 2a files m10..m90 are run by db/run2a.sh).  Runs the Stage-1 LOCAL migration files against the local Docker Postgres.
#   bash db/run.sh                 # all stage-1 migrations in order, then the verification files
#   bash db/run.sh migrations      # only db/migrations/*.sql
#   bash db/run.sh verify          # only db/verify/*.sql
#   bash db/run.sh rollback        # prints how to return to the baseline (restore the dump)
#   bash db/run.sh file db/migrations/m03_xxx.sql [more files]
# Env: DB_CONTAINER (default supabase_db_stack), DB_USER (default postgres), DB_NAME (default postgres)
# SAFETY: refuses to run unless the container name starts with "supabase_db_" (the local stack).
set -euo pipefail
export MSYS_NO_PATHCONV=1            # Git Bash on Windows: do not rewrite container paths like /tmp/db
CONTAINER="${DB_CONTAINER:-supabase_db_stack}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
case "$CONTAINER" in supabase_db_*) ;; *) echo "refusing: $CONTAINER is not a local supabase_db_* container" >&2; exit 2;; esac

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$(cygpath -m "$DIR" 2>/dev/null || echo "$DIR")"   # docker.exe needs a Windows path for the host side
LOG_DIR="$DIR/../local-db/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stage1-$(date +%Y%m%d-%H%M%S).log"

docker exec "$CONTAINER" rm -rf /tmp/db
docker cp "$HOST_DIR" "$CONTAINER:/tmp/db"

psql_file() {   # $1 = path relative to db/
  echo "=== $1" | tee -a "$LOG"
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -v ON_ERROR_STOP=1 -f "/tmp/db/$1" 2>&1 | tee -a "$LOG"
  test "${PIPESTATUS[0]}" -eq 0 || { echo "FAILED: $1 (see $LOG)" >&2; exit 1; }
}

mode="${1:-all}"; shift || true
case "$mode" in
  all)        for f in "$DIR"/migrations/m0*.sql; do psql_file "migrations/$(basename "$f")"; done
              for f in "$DIR"/verify/v0*.sql;     do psql_file "verify/$(basename "$f")"; done ;;
  verify)     for f in "$DIR"/verify/v0*.sql;     do psql_file "verify/$(basename "$f")"; done ;;
  migrations) for f in "$DIR"/migrations/m0*.sql; do psql_file "migrations/$(basename "$f")"; done ;;
  rollback)   echo "No in-place rollback script: stage 1 only adds objects and moves the old tables to schema legacy. To return to the baseline restore local-db/backups/baseline-pre-migration.dump (see db/README.md)." >&2; exit 2 ;;
  file)       for f in "$@"; do psql_file "${f#db/}"; done ;;
  *) echo "unknown mode $mode" >&2; exit 2 ;;
esac
echo "OK (log: $LOG)"
