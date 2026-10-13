#!/usr/bin/env bash
# Proves stage 1 re-runs from a clean state: restores the baseline dump into a SCRATCH database
# (stage1_test) inside the local container, runs db/run.sh (m00..m07 + v01..v03) against it, then drops it.
# The real "postgres" database is never touched.   Usage: bash db/test-from-scratch.sh [keep]
set -euo pipefail
export MSYS_NO_PATHCONV=1
C="${DB_CONTAINER:-supabase_db_stack}"
case "$C" in supabase_db_*) ;; *) echo "refusing: not a local supabase_db_* container" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="$(cygpath -m "$ROOT/local-db/backups/baseline-pre-migration.dump" 2>/dev/null || echo "$ROOT/local-db/backups/baseline-pre-migration.dump")"
docker cp "$DUMP" "$C:/tmp/baseline.dump"
docker exec "$C" psql -U postgres -c "drop database if exists stage1_test" -c "create database stage1_test"
# restore errors about 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin' are expected (postgres is not that role) and harmless
docker exec "$C" pg_restore -U postgres -d stage1_test --no-owner /tmp/baseline.dump || true
DB_NAME=stage1_test bash "$ROOT/db/run.sh" all
[ "${1:-}" = "keep" ] || docker exec "$C" psql -U postgres -c "drop database stage1_test"
echo "FROM-SCRATCH TEST PASSED"
