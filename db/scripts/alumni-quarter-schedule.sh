#!/usr/bin/env bash
# alumni-quarter-schedule.sh - the SCHEDULER of the quarterly alumni figures (m66 - m68, owner decision 21): turns the pg_cron job `alumni-quarter-tick` on / off on the LOCAL stack.
#
#   bash db/scripts/alumni-quarter-schedule.sh enable [--cron '*/15 * * * *']   # one pg_cron job: select app_private.alumni_quarter_tick()
#   bash db/scripts/alumni-quarter-schedule.sh disable                          # removes the job (back to the baseline: nothing is scheduled)
#   bash db/scripts/alumni-quarter-schedule.sh status                           # enabled?, the cron expression, the last run, the settings, the campaigns of this quarter
#   bash db/scripts/alumni-quarter-schedule.sh tick                             # ONE tick now (the same function the job runs); a tick with nothing due changes nothing
#
# WHAT THE TICK DOES (idempotent, safe to run as often as you like; a pass that finds nothing costs a few indexed queries):
#   1. freezes every ENDED quarter (from the setting first_period on) of every alumni company that has no snapshot yet (never overwrites a frozen quarter)
#   2. sends the due reminder of the CURRENT quarter (notification + e-mail queued in the outbox) to the alumni founders whose company has not confirmed:
#      one reminder per configured "days before the close" (default 14 and 3, 10:00 Cairo time); a late scheduler sends only the latest due one
#
# Why a separate, explicit step: the migrations schedule NOTHING by themselves (a migration that starts sending mail on its own would be a surprise), and e-mail DELIVERY is a different
# job again (db/scripts/email-worker-schedule.sh enables the outbox worker). The tick only ENQUEUES e-mails.
# No HTTP, no secret: pg_cron runs the SQL inside the database. PRODUCTION: the same two functions exist there; run once in the SQL editor
#   select app_private.alumni_quarter_scheduler_enable();      -- every 15 minutes (pg_cron must be enabled in the project)
# and edit the schedule / wording in the platform (Alumni > Quarters > Reminder settings).
set -euo pipefail
export MSYS_NO_PATHCONV=1

DB_CONTAINER="supabase_db_stack"
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
psql_stdin() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1; }

command -v docker >/dev/null 2>&1 || die "docker is not on the PATH (is Docker Desktop running?)"
[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || echo false)" = "true" ] || die "the local stack is not running ($DB_CONTAINER)"
if [ "$(printf "select to_regprocedure('app_private.alumni_quarter_tick(timestamptz)') is not null;" | psql_stdin)" != "t" ]; then
  die "m68 is not applied: run db/migrations/m65 .. m68 first (docker exec -i $DB_CONTAINER psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m68_alumni_quarter_reminders.sql)"
fi

sub="${1:-}"; [ $# -gt 0 ] && shift || true
case "$sub" in
  enable)
    cron='*/15 * * * *'
    while [ $# -gt 0 ]; do
      case "$1" in
        --cron) [ $# -ge 2 ] || die "--cron needs a value"; cron="$2"; shift 2 ;;
        *) die "unknown option: $1" ;;
      esac
    done
    printf "select jsonb_pretty(app_private.alumni_quarter_scheduler_enable('%s'));\n" "${cron//\'/}" | psql_stdin ;;
  disable)
    printf "select jsonb_pretty(app_private.alumni_quarter_scheduler_disable());\n" | psql_stdin ;;
  status)
    psql_stdin <<'SQL'
select 'scheduler', jsonb_pretty(app_private.alumni_quarter_scheduler_status());
select 'settings', first_period || ' | auto_freeze=' || auto_freeze || ' | auto_reminders=' || auto_reminders || ' | offsets=' || reminder_offsets::text || ' | hour=' || send_hour || ' | app_base_url=' || coalesce(app_base_url, '(none)')
  from app_private.alumni_quarter_settings;
select 'current quarter', app_private.alumni_period_key(now());
select 'campaigns', period_key || ' ' || kind || ' ' || status || ' recipients=' || recipients || ' notified=' || notified || ' emailed=' || emailed
  from app_private.alumni_reminder_campaigns order by created_at desc limit 5;
SQL
    ;;
  tick)
    printf "select jsonb_pretty(app_private.alumni_quarter_tick());\n" | psql_stdin ;;
  *)
    sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
