-- v12_reconciliation_report  (STAGE 2a)  Read-only.  Emits the markdown of db/RECONCILIATION.md:
--   bash db/reconcile.sh        (runs this file with psql -At and writes db/RECONCILIATION.md)
-- Everything is read from migration.table_recon / event_totals / flags / fixups / company_merges / recon / asset_map (filled by m21..m80).
\pset tuples_only on
\pset format unaligned
\pset footer off
select '# Stage 2a reconciliation: legacy (old) vs public (new)';
select '';
select 'Generated from the LOCAL Docker Postgres (`supabase_db_stack`, database `postgres`) by `db/verify/v12_reconciliation_report.sql`. Source = schema `legacy` (the 48 old tables, untouched); target = schema `public` (+ `app_private`). No Storage object was moved or downloaded in stage 2a; no secret was copied.';
select '';
select '## 1. Verdict';
select '';
select '- Legacy rows (48 tables): **' || sum(old_count) || '**; represented in new tables **' || sum(represented_in_new) || '**, merged duplicates archived **' || sum(merged_archived)
       || '**, quarantined **' || sum(quarantined) || '**, deliberately not carried **' || sum(not_carried) || '** (secrets / dead or empty tables); **unaccounted: ' || sum(unaccounted) || '**.' from migration.table_recon;
select '- Legacy baseline (migration.baseline, captured before the move): **' || sum(row_count) || '** rows in 48 tables: ' || (case when sum(row_count) = (select sum(old_count) from migration.table_recon) then 'identical to the legacy tables now.' else 'DIFFERENT!' end)
from migration.baseline where table_name like 'public.%';
select '- Check rows (latest run of every phase): ok **' || count(*) filter (where status = 'ok') || '**, warn **' || count(*) filter (where status = 'warn') || '**, mismatch **' || count(*) filter (where status = 'mismatch') || '**.' from migration.v_recon_latest;
select '- Open `blocker` flags: **' || count(*) filter (where severity = 'blocker' and resolved_at is null) || '**; open `review` flags: **' || count(*) filter (where severity = 'review' and resolved_at is null) || '** (owner items, section 7); `info`: ' || count(*) filter (where severity = 'info') || '.' from migration.flags;
select '';
select '## 2. Every legacy table: old count vs new count vs archived vs quarantined';
select '';
select 'Rule: `old = represented in new + merged (archived) + quarantined + not carried`; `unaccounted` must be 0. "New rows" is the row count of the main target table (it can be larger than the represented rows because the model adds derived rows, e.g. nodes, edges, generated questions).';
select '';
select '| Legacy table | Old rows | Represented in new | Merged / archived | Quarantined | Not carried | Unaccounted | Target table | New rows | Disp. | Note |';
select '|---|--:|--:|--:|--:|--:|--:|---|--:|---|---|';
select '| `' || legacy_table || '` | ' || old_count || ' | ' || represented_in_new || ' | ' || merged_archived || ' | ' || quarantined || ' | ' || not_carried || ' | ' || unaccounted
       || ' | ' || coalesce(replace(new_table, '|', '/'), '-') || ' | ' || coalesce(new_count::text, '-') || ' | ' || coalesce(disposition, '') || ' | ' || coalesce(replace(note, '|', '/'), '') || ' |'
from migration.table_recon order by legacy_table;
select '| **Total** | **' || sum(old_count) || '** | **' || sum(represented_in_new) || '** | **' || sum(merged_archived) || '** | **' || sum(quarantined) || '** | **' || sum(not_carried) || '** | **' || sum(unaccounted) || '** | | | | |' from migration.table_recon;
select '';
select '## 3. New schema: row count of every table (and what the design expected)';
select '';
select '| Table | Rows | Origin |';
select '|---|--:|---|';
select '| `' || t.s || '.' || t.n || '` | ' || t.c || ' | ' || t.o || ' |'
from (select s, n, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', s, n), false, true, '')))[1]::text::bigint c,
             case when n in ('nodes','node_revisions','edges','public_links','public_link_slugs','lists','forms','booking_settings','distributions','distribution_days','distribution_day_mentors','distribution_mentor_rules','form_sections') then 'derived (model rows built from legacy data)'
                  when n in ('node_types','field_semantics','roles') then 'seed (stage 1) / lookup'
                  when n in ('email_outbox','email_log','integration_jobs','google_connections') then 'worker table: nothing to migrate (jobs only for future bookings without a calendar id: none)'
                  else 'loaded from legacy' end o
      from (select schemaname s, tablename n from pg_tables where schemaname in ('public','app_private')) x) t
order by t.s desc, t.n;
select '';
select '## 4. Per-event business totals (old = new for every metric)';
select '';
select 'Metrics: ' || string_agg(distinct metric, '; ') || '.' from migration.event_totals;
select '';
select '| Event | ' || (select string_agg(metric, ' | ' order by metric) from (select distinct metric from migration.event_totals) m) || ' |';
select '|---|' || (select string_agg('--:', '|') from (select distinct metric from migration.event_totals) m) || '|';
select '| ' || left(e.event_name, 38) || ' (' || left(e.event_id::text, 8) || ') | ' ||
       (select string_agg(case when t.old_count = t.new_count then t.new_count::text else t.old_count || ' -> ' || t.new_count || ' MISMATCH' end, ' | ' order by t.metric) from migration.event_totals t where t.project_id = e.event_id) || ' |'
from legacy.events e order by e.created_at;
select '| **Total** | ' || (select string_agg(s::text, ' | ' order by metric) from (select metric, sum(new_count) s from migration.event_totals group by 1) x) || ' |';
select '';
select 'Mismatching cells: **' || count(*) filter (where old_count <> new_count) || '** of ' || count(*) || '. (Companies: the 2 same-event merged pairs To7fa and Otaku collapse into one list item each, shown already netted in the old column.)' from migration.event_totals;
select '';
select '## 5. Checksums and lossless checks (old side = new side)';
select '';
select '| Check | Old / expected | New / actual | Status |';
select '|---|---|---|---|';
select '| ' || check_key || ' | `' || left(expected, 40) || '` | `' || left(actual, 40) || '` | ' || status || ' |'
from migration.v_recon_latest
where check_key ~* '(checksum|lossless|PII|redact|national|secret|per event|per form node|Google calendar|Meet link|reproduces|per-event)' order by check_key;
select '';
select '## 6. Quarantined, archived and not-carried data (nothing is deleted: all stays in schema `legacy`)';
select '';
select '| What | Rows | Where it stays | Why |';
select '|---|--:|---|---|';
select '| mentoring_sessions without event id | ' || (select count(*) from legacy.v_quarantine_mentoring_sessions) || ' | `legacy.v_quarantine_mentoring_sessions` | cannot be attached to a project (04-6); superseded generation of event Green Tech Accelerator, see flag |';
select '| ather_team_members of a deleted event | ' || (select count(*) from legacy.v_quarantine_ather_team_members) || ' | `legacy.v_quarantine_ather_team_members` | event no longer exists |';
select '| ather_team_slots (deleted event) | ' || (select count(*) from legacy.v_quarantine_ather_team_slots) || ' | `legacy.v_quarantine_ather_team_slots` | event no longer exists |';
select '| ather_team_bookings (deleted event) | ' || (select count(*) from legacy.v_quarantine_ather_team_bookings) || ' | `legacy.v_quarantine_ather_team_bookings` | event no longer exists |';
select '| mentor_slots zero length | ' || (select count(*) from legacy.v_quarantine_mentor_slots) || ' | `legacy.v_quarantine_mentor_slots` | violates start < end |';
select '| mentor rules pointing at deleted experts | ' || (select count(*) from migration.flags where code = 'mentor_rule_dangling') || ' | `legacy.mentoring_distribution_config.mentor_availability` | expert no longer exists |';
select '| company duplicates merged (dropped rows) | ' || (select count(*) from migration.company_merges) || ' | `legacy.companies` (+ `migration.company_merges`) | owner decision 08 s10 |';
select '| national_id column values (non-empty) | ' || (select count(*) from legacy.company_submissions where national_id is not null and btrim(national_id) <> '') || ' | `legacy.company_submissions.national_id` | ARCHIVED, never carried (owner 05-b) |';
select '| national-id answer cells (5 headers) | ' || (select count(*) from legacy.company_submissions s, jsonb_each(s.additional_data) e where e.key ilike '%national id%' or e.key like '%القومي%') || ' | `legacy.company_submissions.additional_data` | ARCHIVED, never carried (owner 05-b) |';
select '| google_settings rows (service-account key) | ' || (select count(*) from legacy.google_settings) || ' | `legacy.google_settings` | secret, never copied (service account deleted by the owner) |';
select '| smtp_settings rows (password) | ' || (select count(*) from legacy.smtp_settings) || ' | `legacy.smtp_settings` | secret, never copied |';
select '| per-event copies of expert fields (experts) | ' || (select count(*) from legacy.experts) || ' | `legacy.experts` | equal to the master; only the list-item reference is carried (G1) |';
select '| unbooked mentor slots with a pre-generated Meet link | ' || (select count(*) from migration.flags where code = 'unbooked_slot_meet_link') || ' | `legacy.mentor_slots` | links are created at booking time (07-6) |';
select '';
select '## 7. The 20 company merges (owner decision 08 s8 / s10)';
select '';
select '| # | Kind | Canonical company kept | Dropped duplicate (archived in legacy) | Items moved | Items collapsed |';
select '|--:|---|---|---|--:|--:|';
select '| ' || row_number() over (order by kind, keep_name) || ' | ' || kind || ' | ' || replace(keep_name, '|', '/') || ' | ' || replace(drop_name, '|', '/') || ' | ' || (result->>'items_moved') || ' | ' || (result->>'items_collapsed') || ' |'
from migration.company_merges order by kind, keep_name;
select '';
select '## 8. Recorded fixups (old value kept)';
select '';
select '| Entity | Reference | Column | New value | Reason |';
select '|---|---|---|---|---|';
select '| ' || entity || ' | ' || case when entity = 'user_roles' then '(account ' || row_number() over (order by ref_id) || ')' else left(ref_id, 8) end || ' | ' || column_name || ' | ' || new_value || ' | ' || replace(left(reason, 160), '|', '/') || ' |'
from migration.fixups order by entity, ref_id;
select '';
select '## 9. Flags and open items (migration.flags)';
select '';
select '| Code | Severity | Open | Resolved | Example message |';
select '|---|---|--:|--:|---|';
select '| `' || code || '` | ' || severity || ' | ' || count(*) filter (where resolved_at is null) || ' | ' || count(*) filter (where resolved_at is not null) || ' | ' || replace(left(min(message), 150), '|', '/') || ' |'
from migration.flags group by code, severity order by severity desc, code;
select '';
select '## 10. Storage bookkeeping for stage 2b (nothing moved in stage 2a)';
select '';
select '| Source | Status | Distinct objects / URLs | Bytes |';
select '|---|---|--:|--:|';
select '| ' || source || ' | ' || status || ' | ' || count(*) || ' | ' || coalesce(sum(bytes)::text, '-') || ' |' from migration.asset_map group by source, status order by source, status;
select '';
select 'References recorded (which column gets which path): **' || count(*) || '** in `migration.asset_refs`; target paths are already written in the `*_path` columns, the files do not exist there yet (stage 2b copies / downloads them). `storage.objects` count unchanged: **' || (select count(*) from storage.objects) || '**.' from migration.asset_refs;
select '';
select '## 11. All check results of the latest run of every phase';
select '';
select '| Phase | Check | Expected | Actual | Status |';
select '|---|---|---|---|---|';
select '| ' || phase || ' | ' || replace(check_key, '|', '/') || ' | `' || replace(left(expected, 50), '|', '/') || '` | `' || replace(left(actual, 50), '|', '/') || '` | ' || status || ' |'
from migration.v_recon_latest order by phase, check_key;
select '';
select '## 12. Verification scripts (latest run of each)';
select '';
select '| Script phase | Result | Checks ok | Not ok / warn |';
select '|---|---|--:|--:|';
select '| ' || r.phase || ' | ' || r.status || ' | ' || count(*) filter (where c.status = 'ok') || ' | ' || count(*) filter (where c.status <> 'ok') || ' |'
from migration.run r join migration.recon c on c.run_id = r.id
where r.id in (select max(id) from migration.run where phase like '%verify%' group by phase)
group by r.id, r.phase, r.status order by r.phase;
select '';
select 'Reading notes: `warn` rows are informational (D03 owner review items, design-vs-data differences listed in `db/MIGRATION-LOG.md`); a `mismatch` would have aborted the phase transaction.';
