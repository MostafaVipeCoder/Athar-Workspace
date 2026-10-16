#!/usr/bin/env bash
# calendar-sync-run.sh - run ONE pass of the calendar sync worker on the LOCAL stack (what pg_cron does every minute on a real project).
#
#   bash db/scripts/dev-functions.sh up        # the Edge Runtime + the fake Google (once)
#   bash db/scripts/calendar-sync-run.sh       # one pass: prints the summary (counts only)
#   bash db/scripts/calendar-sync-run.sh --loop 20   # a pass every 20 seconds until Ctrl-C (a poor man's cron for manual testing)
#
# The mode decides what a pass does (Settings > Calendar, super_admin; or `update app_private.calendar_sync_config set mode = 'live'`):
#   off = nothing, shadow = plan + log, no Google call (default), live = claim, call Google (the FAKE one locally), write back.
# The service-role key is read from `supabase status` and never printed. Nothing here can reach a real Google endpoint: the function itself refuses
# GOOGLE_* address overrides unless local-db/functions.env has ALLOW_FAKE_GOOGLE=1 and, without any override, it would call the real Google ONLY if
# real credentials were configured (docs/design/10-google-integration-setup.md).
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK="$ROOT/local-db/stack"
API="${SUPABASE_API_URL:-http://127.0.0.1:54321}"

loop=0
if [ "${1:-}" = "--loop" ]; then loop="${2:-20}"; fi

keys="$(cd "$STACK" && npx supabase status -o env 2>/dev/null)"
SERVICE_KEY="$(printf '%s\n' "$keys" | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
ANON_KEY="$(printf '%s\n' "$keys" | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')"
[ -n "$SERVICE_KEY" ] && [ -n "$ANON_KEY" ] || { echo "cannot read the local stack keys (is the stack running?)" >&2; exit 1; }

pass() {
  curl -s -m 150 -X POST "$API/functions/v1/calendar-sync" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' -d '{}'
  echo
}
if [ "$loop" = "0" ]; then pass; exit 0; fi
echo "a pass every ${loop}s (Ctrl-C to stop)"
while true; do pass; sleep "$loop"; done
