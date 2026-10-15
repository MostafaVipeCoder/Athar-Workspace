export const meta = {
  name: 'alumni-quarterly-snapshots-and-reminders-2026-10-15',
  description: 'Replace the per-edit alumni audit log by quarterly frozen snapshots (graphs read snapshots only) + automatic quarterly reminders (notification + e-mail); independent review, fix, final verify',
  phases: [
    { title: 'Build', detail: 'Quarterly snapshot model, freezing, reopen, graphs, reminders' },
    { title: 'Review', detail: 'Data correctness vs the typo scenario, security/DB, UX/i18n' },
    { title: 'Fix', detail: 'Fix confirmed findings' },
    { title: 'Verify', detail: 'Independent final verification' },
  ],
}

const COMMON = `
PROJECT: Athar platform refactor. Root: C:\\Users\\Abdullah Shaban\\Desktop\\Accelerator Project mangment workspace. Frontend in web/ (React 19 + JavaScript, Vite, Tailwind, TanStack Query), local Docker Supabase stack (running; DB: docker exec -i supabase_db_stack psql -U postgres -d postgres), SQL migrations/verify scripts in db/ (re-runnable; run 'ls db/migrations' to see the latest number; do not reuse numbers), edge function sources in supabase-new/functions (not deployed).
READ FIRST: web/NODE-BUILD-BRIEF.md, web/PROGRESS.md (handovers, status table, gotchas: cn() with custom font-size tokens, overflow-x clip), docs/design/08-decisions-log.md (OWNER DECISIONS OVERRIDE EVERYTHING; READ sections 19, 20 and 21 fully), docs/design/09-alumni-pages-and-profile-model.md, db/README.md, db/MIGRATION-LOG.md.
HARD RULES: local stack ONLY. NEVER use Supabase MCP tools or the live project; never call real Google endpoints (a fake Google server exists under db/scripts/fake-google). Do not touch the old app (src/, root configs, supabase/); do not edit docs/ except where your task says so (append to web/PROGRESS.md, web/README.md, db/MIGRATION-LOG.md, db/README.md otherwise). NO git commit/push/checkout. Never print secrets, tokens, national IDs or personal data. Do NOT restart/stop the Supabase stack or Docker. The Browser pane is SHARED: always pass an explicit tabId, use your own tab and your own dev-server port given below (ports 5433-5532 and 5174 are reserved by Windows and fail with EACCES; only use the given ports). Throwaway data only, cleaned up; record exact baseline counts first and restore them (document intentional deltas). Keep lint, tests and build green (npm run lint, npx vitest run, npm run build in web/; node --test for pure edge-function logic). All image uploads go through the central WebP pipeline. Staff roles and founder are mutually exclusive. Append to web/PROGRESS.md: done, deviations, open questions, handover. FINAL REPORT is structured data (concise, no secrets).`

const RESULT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    migrations: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    lintClean: { type: 'boolean' },
    testsPassing: { type: 'boolean' },
    testCount: { type: 'number' },
    buildOk: { type: 'boolean' },
    browserVerified: { type: 'boolean' },
    baselineRestored: { type: 'boolean' },
    deviations: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'lintClean', 'testsPassing', 'buildOk', 'browserVerified', 'baselineRestored'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'issues'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          area: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'area', 'description', 'evidence'],
      },
    },
  },
  required: ['verdict', 'summary', 'findings'],
}

const BUILD = `
${COMMON}
YOUR TASK (migration numbers: take the next free ones after the latest in db/migrations; verify scripts v-numbered accordingly; dev port 5701): implement owner decision 21 (docs/design/08-decisions-log.md section 21), which REPLACES the per-edit audit-log history built in m60 (decision 20.4 working default).
OWNER'S WORDS (Arabic, authoritative): "مش هينفع يكون في سجل كامل لكل حفظ. لو بيانات الإيرادات كانت 10000 جنيه وبعد خمس دقايق كتبتها 100 ألف، مينفعش أحفظ نسخة من كل تعديل لأن وارد الشخص ينسى صفر. أنا بحفظ الـ snapshots بتاعت تعديلاتهم على بيانات الشركة علشان نعمل منها graph بيعرض التغييرات اللي حصلت في كل بزنس، وكمان مؤشر مجمّع لأداء كل الشركات. فالنظام اللي اقترحته ممكن الجراف يقول إن المبيعات زادت من 10 آلاف لـ 100 ألف في 5 دقايق، وده مش قياس مظبوط." ... "هيكون ربع سنوي، وبيتبعت إشعار بشكل تلقائي قبل ما ربع السنة يقفل لكل الألومناي، نوتفكيشن على المنصة وإيميل لكل فاوندر، إنه يدخل يحدّث بيانات، لأن ده بيساعدنا نعرف مين اللي ممكن نفيده بالفرص القريبة. وهنشوف صيغة الإيميل والنوتفكيشن هتكون إزاي."
BUILD: (1) DATA MODEL: figures (revenue, funding, employees, female employees, freelancers, team size and the other yearly-figure fields of docs/design/09) are edited as a free-form DRAFT for the current quarter (no per-edit history; keep only updated_at/updated_by on the row, shown in the UIs as 'last modified'); a FROZEN SNAPSHOT per company per QUARTER (period_key like 2026-Q4, with per-metric kind: flow metrics such as revenue are per-quarter values, stock metrics such as employees are values at quarter end, cumulative metrics such as funding raised keep their cumulative meaning; document the semantics and how draft values carry forward into the next quarter) is the ONLY data that graphs and portfolio aggregates read. Quarter boundaries: calendar quarters, timezone Africa/Cairo (one constant, documented). Freezing: automatic at quarter close via a SQL function freeze_due_quarters() that is idempotent and callable by a scheduler (pg_cron if available on this image, otherwise the existing edge-runtime/worker tick or a documented script; check what exists after the e-mail worker work: db/scripts, supabase-new/functions) and by the manager manually ('Close quarter now'); freezing copies the CURRENT draft values into the snapshot (so a 5-minute typo correction before quarter end never creates a data point), records frozen_at and source ('auto'|'manual'), never overwrites an existing frozen snapshot silently. REOPEN/CORRECT: alumni_manager and super_admin can reopen a closed quarter for a company (or for all) and correct it; the corrected snapshot is flagged corrected_at/by and keeps the original frozen value in one 'previous_value' field per metric ONLY if needed for the graph annotation (otherwise none), never a per-edit log. A founder 'Confirm my figures for this quarter' action (marks 'confirmed_at' on the draft for the quarter; reminders skip confirmed companies; the manager sees who confirmed). (2) REMOVE THE AUDIT LOG: look at what m60 (alumni edit + audit log) created (alumni_change_log, triggers, history viewer UI, alumni_state_as_of, coalescing) and remove or disable it cleanly in a new re-runnable migration (drop triggers/functions/table and the UI viewer; keep the manager editing features, the needs-attention queue and the last-modified indicators; the audit log must not remain half-alive; national IDs must still never be logged anywhere). Update verify scripts that asserted the log (v60..) and the web tests accordingly (say so in PROGRESS). (3) GRAPHS AND PORTFOLIO INDICATORS: manager screens: per-company performance graph over quarters (accessible line/bar chart, lazy-loaded chart code, table alternative, ar/en, RTL-safe) for revenue, employees, funding; portfolio aggregates by quarter (total/median revenue, employment, female share, survival/closing rates) computed from frozen snapshots ONLY, filter by program/sector/governorate, Excel export; analytics/impact dashboard pages built last run must be rewired to snapshots (no hard-coded numbers). TEST THE OWNER'S SCENARIO IN SQL AND IN THE BROWSER: draft revenue 10,000 then 100,000 five minutes later in the same open quarter, then quarter close => the graph has ONE point for that quarter with 100,000 and no growth spike between; and the same with a correction after close via reopen. (4) QUARTERLY REMINDERS: a reminder campaign model: configurable schedule (default two reminders: 14 days and 3 days before quarter end; stored as settings editable by alumni_manager/super_admin), audience = alumni founders (role founder, linked to an alumni company) whose company has NOT confirmed the current quarter, per-founder idempotency key (founder, quarter, reminder_kind) so nobody gets duplicates, channels: in-platform notification (notifications table) AND e-mail via the existing email_outbox (templates ar/en with placeholders {founder_name} {company_name} {quarter} {deadline} {link}, editable by the manager in the UI with live preview, safe text not raw HTML, defaults provided but flagged 'wording to be finalised by the owner'); sending: automatic on schedule through the scheduler, plus manual 'Send reminders now' / 'Resend to unconfirmed' from the platform with a recipients preview and confirm dialog above 100 recipients, plus a campaign history (counts, who/when). The e-mail DELIVERY is done by the outbox worker (check whether it exists in the tree; if the worker is not finished, enqueue only and document). Founder side: notification links to the profile/company page with a clear 'Update your figures for Q4 2026 / confirm' banner while the quarter is open and not confirmed; in-app notification list shows it. (5) Manager 'Quarter status' page: per quarter, table of companies: confirmed / updated-not-confirmed / not-updated, last modified, reminder history, filters, bulk 'send reminder to these', export; data freshness indicator in the directory. (6) SQL verify script (role-switch checks, idempotent freeze, no overwrite of a frozen snapshot, reopen permissions, reminder idempotency, founders cannot freeze/reopen/read other companies' snapshots, anon nothing, null-safe guards: previous reviews found NULL three-valued-logic holes in IF guards, scan your functions for it), unit tests, component tests, browser-verify with throwaway manager+founders in ar/en desktop and 375px, clean up to baseline (migrated data unchanged). Re-run the previous verify scripts for regression (update only those encoding the removed audit log).`

phase('Build')
const built = await agent(BUILD, { label: 'build:quarterly-snapshots-reminders', phase: 'Build', schema: RESULT })
if (!built) log('WARNING: builder returned null (agent died): re-run with resumeFromRunId')

phase('Review')
const REVIEW_COMMON = `
${COMMON}
You are an INDEPENDENT REVIEWER (not a builder). Do not trust the builder's report: verify from code, DB and the running app. Fix NOTHING; report findings with concrete evidence. Return verdict 'pass' only if there are no critical/high/medium findings.
Builder summary (context only): ${built ? built.summary : 'NOT COMPLETED'}`

const reviews = await parallel([
  () => agent(`${REVIEW_COMMON}
LENS = DATA CORRECTNESS and DATABASE SECURITY (dev port 5711). (1) The OWNER'S SCENARIO with real SQL + UI: draft revenue 10,000 then 100,000 minutes later inside an open quarter then quarter close => exactly one snapshot point 100,000, no intermediate point in ANY graph/aggregate/export; a post-close correction via reopen produces a flagged corrected snapshot; frozen snapshots are never silently overwritten (try re-running freeze, concurrent freezes, freezing at the exact boundary instants 23:59:59/00:00:00 Africa/Cairo and DST edges); flow/stock/cumulative metric semantics are applied consistently in graphs and portfolio aggregates (compare aggregates against direct SQL on the snapshot table for 5 numbers). (2) No per-edit log remains (tables, triggers, functions, UI) and national IDs appear nowhere in logs. (3) Reminders: idempotency under double clicks and two schedulers, audience correctness (confirmed excluded, non-alumni excluded, withdrawn/inactive handled), templates are safe text (no HTML/script injection into notifications or e-mails), e-mails enqueue to the outbox only with recipients derived server-side. (4) RLS/privileges on every new table/function: founder reads only his own company's data, cannot freeze/reopen, anon nothing, alumni_manager/super_admin as designed, SECURITY DEFINER hardening and NULL-safe guards (scan all new functions for NULL three-valued-logic holes). (5) Regression: run EVERY verify script db/verify/v01..latest in order (note v34 C05 only fails while throwaway rows exist), node --test suites. Clean up everything you create.`, { label: 'review:data-security', phase: 'Review', schema: FINDINGS }),
  () => agent(`${REVIEW_COMMON}
LENS = QUALITY, UX, i18n, PERFORMANCE (dev port 5712). Run lint, full tests, node --test and build; compare chunk sizes with web/PROGRESS.md (chart code must be lazy; entry chunk must not grow). Walk through every new/changed screen in the browser in Arabic RTL and English LTR, desktop and 375px: per-company graph + data table alternative (accessibility: labels, keyboard, contrast, no colour-only encoding), portfolio dashboard, Quarter status page, reminder settings/templates/preview/manual send/history, founder banner + confirm action + notification, directory freshness, manager edit forms; empty/loading/error states; plural-aware Arabic; Western-digit consistency; dates/quarters formatted per locale; tap targets >= 44px. Check duplicated code/dead code (leftovers of the removed audit log), that PROGRESS/README describe the snapshot model truthfully and that the 'wording to be finalised by the owner' flag is visible to managers. Clean up everything you create.`, { label: 'review:quality-ux', phase: 'Review', schema: FINDINGS }),
])

const allFindings = reviews.filter(Boolean).flatMap((r) => r.findings || [])
const blocking = allFindings.filter((f) => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium')
log('Review findings: ' + allFindings.length + ' total, ' + blocking.length + ' blocking')

phase('Fix')
let fix = null
if (blocking.length > 0) {
  fix = await agent(`${COMMON}
YOU ARE THE FIXER (dev port 5713). Reviewers found these issues in the quarterly-snapshot/reminder work. Fix every critical/high/medium finding at the root cause (new re-runnable migration + verify script with the next free numbers; never edit an applied migration destructively without re-running it idempotently) plus the cheap low ones. Then re-run ALL verify scripts, node --test, lint, tests, build and a browser smoke test of the affected flows; restore the baseline.
BLOCKING FINDINGS (JSON):
${JSON.stringify(blocking, null, 2)}
LOW FINDINGS (JSON):
${JSON.stringify(allFindings.filter((f) => f.severity === 'low'), null, 2)}`, { label: 'fix:review-findings', phase: 'Fix', schema: RESULT })
} else {
  log('No blocking findings: skipping the fix phase')
}

phase('Verify')
const final = await agent(`${COMMON}
YOU ARE THE FINAL VERIFIER (dev port 5714). Build and fix nothing. Confirm: lint, vitest, node --test and build in web/ (counts + biggest chunks), every verify script db/verify/v01..latest against the local DB, the local DB at the expected baseline, a secrets grep of web/ docs/ db/ supabase-new/ (private keys, tokens, client secrets, service JWTs, bcrypt hashes) and that web/.env.local and local-db/ are git-ignored, plus a short browser smoke test (throwaway super_admin: Programs, a project canvas, the manager directory, the quarter status page, the founder Programs page) in Arabic and English with no console errors. Verdict 'pass' only if everything is green. Run summary: build=${built ? 'done' : 'MISSING'}, fix=${fix ? 'done' : 'not needed/MISSING'}.`, { label: 'verify:final', phase: 'Verify', schema: FINDINGS })

return { built, reviewFindings: allFindings, fix, final }
