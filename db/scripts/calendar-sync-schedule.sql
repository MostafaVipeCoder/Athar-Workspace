-- calendar-sync-schedule.sql - schedule the calendar sync worker with pg_cron + pg_net (NOT run by any migration: it needs the project URL and the service key,
-- which are different in every environment and must never be written into a migration file).
--
-- WHO / WHEN: the database owner, ONCE per environment, AFTER `calendar-sync` is deployed (hosted: `supabase functions deploy calendar-sync`; local:
-- `bash db/scripts/dev-functions.sh up`). The worker is idempotent and takes row locks (SKIP LOCKED + a lease), so two overlapping invocations are safe.
--
-- 1. Put the service-role key into Vault ONCE, by hand in the SQL editor (never in a file, never in git):
--      select vault.create_secret('<the service role key>', 'calendar_sync_service_key');
-- 2. Run this file with the function URL:
--      psql -v url="https://<project-ref>.supabase.co/functions/v1/calendar-sync" -f db/scripts/calendar-sync-schedule.sql
--    (local stack, from inside the database container: -v url="http://kong:8000/functions/v1/calendar-sync")
-- 3. Check:  select jobid, schedule, active from cron.job where jobname = 'calendar-sync';
--            select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'calendar-sync') order by start_time desc limit 5;
--            select mode, last_run_at, last_run_summary from app_private.calendar_sync_config;      -- the worker heartbeat
-- 4. Stop it (cut-over rollback, maintenance):  select cron.unschedule('calendar-sync');
--
-- The mode (off | shadow | live) is NOT part of the schedule: the worker reads it from app_private.calendar_sync_config on every pass (default SHADOW).
-- A pass that finds nothing costs one indexed query; the function answers { ok, mode, claimed, done, ... } (counts only).
\set ON_ERROR_STOP on
\if :{?url}
\else
  \echo 'usage: psql -v url="https://<project-ref>.supabase.co/functions/v1/calendar-sync" -f db/scripts/calendar-sync-schedule.sql'
  \quit 1
\endif

select cron.unschedule(jobid) from cron.job where jobname = 'calendar-sync';
select cron.schedule('calendar-sync', '* * * * *', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_service_key'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$job$, :'url'));
select jobid, jobname, schedule, active from cron.job where jobname = 'calendar-sync';
