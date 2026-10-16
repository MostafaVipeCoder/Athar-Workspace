#!/usr/bin/env bash
# trigger-email-worker.sh - run the e-mail worker ONCE, right now (design 07 section 1.6; the manual twin of the pg_cron job).
#
#   bash db/scripts/trigger-email-worker.sh                       # LOCAL stack: http://127.0.0.1:54321/functions/v1/email-worker, secret from local-db/functions.env
#   bash db/scripts/trigger-email-worker.sh --max-messages 5 --max-seconds 30 --per-minute 10
#   EMAIL_WORKER_SECRET=... bash db/scripts/trigger-email-worker.sh --url https://<project-ref>.supabase.co/functions/v1/email-worker      # a deployment
#
# What it does: ONE POST with the header x-worker-secret. The function claims due rows (leases, per-sender quota), sends them through Gmail (the FAKE Google
# locally) and answers a summary of COUNTS (claimed / sent / retried / failed / needs_review / blocked ...), which is printed. It never prints the secret
# (the header travels through `curl -K -`, so it is not in the process list either), and nothing in the request can name a recipient: the function sends only
# what the database claimed. Use it when the pg_cron scheduler is not enabled (db/scripts/email-worker-schedule.sh enable) or to force a run in a test.
# Production scheduling without pg_cron: any scheduler that can POST this URL with the header every minute works (the dashboard's scheduled functions,
# GitHub Actions, a cron on a server). The function is safe to call as often as you like: two overlapping runs never send the same row (m62 lease + advisory lock).
set -euo pipefail
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/local-db/functions.env"
URL="${SUPABASE_API_URL:-http://127.0.0.1:54321}/functions/v1/email-worker"
body='{}'
NL=$'\n'

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
envval() { [ -f "$ENV_FILE" ] || return 0; { grep -m1 -E "^$1=" "$ENV_FILE" || true; } | cut -d= -f2- | tr -d '\r'; }

max_messages=""; max_seconds=""; per_minute=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || die "--url needs a value"; URL="$2"; shift 2 ;;
    --max-messages) [ $# -ge 2 ] || die "--max-messages needs a number"; max_messages="$2"; shift 2 ;;
    --max-seconds) [ $# -ge 2 ] || die "--max-seconds needs a number"; max_seconds="$2"; shift 2 ;;
    --per-minute) [ $# -ge 2 ] || die "--per-minute needs a number"; per_minute="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done
for v in "$max_messages" "$max_seconds" "$per_minute"; do
  case "$v" in ""|*[!0-9]*) [ -z "$v" ] || die "limits must be whole numbers" ;; esac
done
case "$URL" in http://*|https://*) ;; *) die "--url must start with http:// or https://" ;; esac
fields=()
[ -n "$max_messages" ] && fields+=("\"maxMessages\":$max_messages")
[ -n "$max_seconds" ] && fields+=("\"maxRunSeconds\":$max_seconds")
[ -n "$per_minute" ] && fields+=("\"perMinute\":$per_minute")
if [ ${#fields[@]} -gt 0 ]; then body="{$(IFS=,; echo "${fields[*]}")}"; fi

secret="${EMAIL_WORKER_SECRET:-$(envval EMAIL_WORKER_SECRET)}"
[ -n "$secret" ] || die "no secret: set EMAIL_WORKER_SECRET in the environment, or run 'bash db/scripts/dev-functions.sh up' (it adds it to local-db/functions.env)"
command -v curl >/dev/null 2>&1 || die "curl is needed"

# (no -o file: a native Windows curl would write /tmp/... somewhere else than Git Bash reads it)
resp="$(printf 'header = "x-worker-secret: %s"\n' "$secret" | curl -sS -K - -m 150 -X POST -H 'Content-Type: application/json' -d "$body" -w "${NL}%{http_code}" "$URL" || true)"
code="${resp##*"$NL"}"
text="${resp%"$NL"*}"
case "$code" in
  200) printf '%s\n' "$text" ;;
  401) die "401: the secret was refused (EMAIL_WORKER_SECRET differs from the function's; after changing local-db/functions.env run 'dev-functions.sh up')" ;;
  503) printf '%s\n' "$text" >&2; die "503: the function is not configured (the answer above lists the missing env NAMES)" ;;
  404) die "404: /functions/v1/email-worker does not exist (is it synced and served? 'bash db/scripts/dev-functions.sh up')" ;;
  "") die "no answer from $URL" ;;
  *) printf '%s\n' "$text" >&2; die "HTTP $code from $URL" ;;
esac
