#!/usr/bin/env bash
# Proves stage 2a re-runs from the checkpoint: restores local-db/backups/pre-stage2a.dump into a SCRATCH database (stage2a_test) inside the local
# container, runs db/run2a.sh (m10..m90 + v10/v11) against it, runs the whole sequence a SECOND time (idempotency), compares a
# fingerprint (catalog + row counts + content checksums, db/verify/v13_fingerprint.sql) of the scratch DB (after run 1 and after run 2)
# with the real DB, then drops the scratch DB.  The real "postgres" database is only READ.   Usage: bash db/test-stage2a-from-scratch.sh [keep]
set -euo pipefail
export MSYS_NO_PATHCONV=1
C="${DB_CONTAINER:-supabase_db_stack}"
case "$C" in supabase_db_*) ;; *) echo "refusing: not a local supabase_db_* container" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="$(cygpath -m "$ROOT/local-db/backups/pre-stage2a.dump" 2>/dev/null || echo "$ROOT/local-db/backups/pre-stage2a.dump")"
TMP="${TMPDIR:-/tmp}"
docker cp "$DUMP" "$C:/tmp/pre-stage2a.dump"
docker exec "$C" psql -U postgres -c "drop database if exists stage2a_test" -c "create database stage2a_test"
docker exec "$C" pg_restore -U postgres -d stage2a_test --no-owner /tmp/pre-stage2a.dump || true      # supabase_admin default-privilege errors are expected
fp() { docker exec -i "$C" psql -U postgres -d "$1" -X -q < "$ROOT/db/verify/v13_fingerprint.sql"; }
echo "--- run 1 (from the checkpoint)"
DB_NAME=stage2a_test bash "$ROOT/db/run2a.sh" all
fp stage2a_test > "$TMP/fp_scratch_run1.txt"
echo "--- run 2 (idempotency: the whole sequence again on the loaded scratch DB)"
DB_NAME=stage2a_test bash "$ROOT/db/run2a.sh" load
fp stage2a_test > "$TMP/fp_scratch_run2.txt"
fp postgres > "$TMP/fp_real.txt"
echo "--- compare"
diff "$TMP/fp_scratch_run1.txt" "$TMP/fp_real.txt" > "$TMP/fp_diff_real.txt" && echo "scratch(run1) == real: IDENTICAL ($(wc -l < "$TMP/fp_real.txt") fingerprint lines)" || { echo "DIFF scratch(run1) vs real:"; head -40 "$TMP/fp_diff_real.txt"; }
diff "$TMP/fp_scratch_run1.txt" "$TMP/fp_scratch_run2.txt" > "$TMP/fp_diff_rerun.txt" && echo "scratch(run1) == scratch(run2): IDEMPOTENT" || { echo "DIFF run1 vs run2:"; head -40 "$TMP/fp_diff_rerun.txt"; }
[ "${1:-}" = "keep" ] || docker exec "$C" psql -U postgres -c "drop database stage2a_test"
test ! -s "$TMP/fp_diff_real.txt" && test ! -s "$TMP/fp_diff_rerun.txt" && echo "STAGE 2a FROM-SCRATCH + IDEMPOTENCY TEST PASSED"
