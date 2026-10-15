export const meta = {
  name: 'network-experts-registry-2026-10-15',
  description: 'Athar Network experts registry (list, profile, programs joined and counts, add/edit/merge, photos via WebP) with independent review, fix and final verification',
  phases: [
    { title: 'Build', detail: 'Design check against the as-is features + build the experts registry' },
    { title: 'Review', detail: 'Security/DB, data integrity vs the 44 migrated experts, UX/i18n' },
    { title: 'Fix', detail: 'Fix confirmed findings' },
    { title: 'Verify', detail: 'Independent final verification' },
  ],
}

const COMMON = `
PROJECT: Athar platform refactor. Root: C:\\Users\\Abdullah Shaban\\Desktop\\Accelerator Project mangment workspace. Frontend in web/ (React 19 + JavaScript, Vite, Tailwind, TanStack Query), local Docker Supabase stack (running; DB: docker exec -i supabase_db_stack psql -U postgres -d postgres), SQL migrations/verify scripts in db/ (re-runnable; run 'ls db/migrations' and use numbers from m75 upward, never reuse a number: another builder is using m70-m74 in parallel).
READ FIRST: web/NODE-BUILD-BRIEF.md (shared rules), web/PROGRESS.md (handovers, status table, gotchas: cn() with custom font-size tokens, overflow-x clip), docs/design/08-decisions-log.md (OWNER DECISIONS OVERRIDE EVERYTHING; sections 16-22), docs/13-refactor-vision-and-decisions.md (the owner's description of Athar Network), docs/design/04-database-design.md (network_experts, v_network_expert_programs, network_expert_usage), docs/design/01-node-catalog.md (Lists, Booking providers), docs/03-frontend-events-and-entities.md and docs/05 (as-is ExpertManager, MasterExpertsList, ExpertCard/Viewer, mentors, ather_team_members features), web/src/data/people.js and web/src/shared/entities/* (EntityCard/Grid/Manager/Picker already reuse network experts), db/README.md.
HARD RULES: local stack ONLY. NEVER use Supabase MCP tools or the live project. Do not touch the old app (src/, root configs, supabase/); do not edit docs/ (append to web/PROGRESS.md, web/README.md, db/MIGRATION-LOG.md, db/README.md only). NO git commit/push/checkout. Never print secrets, tokens, national IDs or personal data (names of experts are fine). Do NOT restart/stop the Supabase stack or Docker. The Browser pane is SHARED with a parallel builder: always pass an explicit tabId, use your own tab and ONLY your own dev-server port given below (ports 5433-5632 and 5174 are reserved by Windows and fail with EACCES). Throwaway data only, cleaned up; record exact baseline counts first (network_experts by kind, list_items, programs, projects, nodes, edges, bookings, mentoring sessions, storage objects, users/profiles/roles) and restore them (document intentional deltas). Other agents edit shared files: keep edits to routes.jsx, queryKeys.js, errors.js, i18n dictionaries additive and minimal. Keep lint, tests and build green (npm run lint, npx vitest run, npm run build in web/). All image uploads go through the central WebP pipeline (web/src/lib/image, data/storage.js; expert photos are bucket public-assets, profile 'avatar'/'content' as appropriate). Staff and founder roles are mutually exclusive. Append to web/PROGRESS.md: done, deviations, open questions, handover. FINAL REPORT is structured data (concise, no secrets).`

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
YOUR TASK (migration numbers m75+, verify v75+, dev port 5901): build the ATHAR NETWORK EXPERTS REGISTRY. The owner's description (docs/13, Arabic, authoritative): "أثر نتورك: المكان اللي بيتجمع فيه كل المدربين اللي شاركوا قبل كده في البرامج بتاعتنا، وكل مدرب شارك في إيه برامج وكام مرة، ولينا بروفايل للموجّهين والخبراء." The owner now says: "عايزين نشتغل على الخبراء" (work on the experts). The page placeholder today is /network/experts ('coming in step 7') in the 'network' area (area name shown to users: Alumni Relations; the experts registry lives in the same area shell; check web/src/app/routes.jsx, NetworkShell and the nav tabs: the owner's screenshot shows tabs Programs / Experts / Companies / Library / Form library / Team / Mail: those are the staff 'Programs management' tabs; find where the Experts tab points and make it work, whichever area it belongs to, keeping the owner's navigation).
DEFAULT ASSUMPTIONS (the owner could not be asked; implement, flag in PROGRESS as 'assumed'): staff (project_manager, alumni_manager, super_admin) can view the registry; project_manager/alumni_manager/super_admin can create/edit; only super_admin can merge/delete; founders and anon have no access; profiles are NOT public (a program's public pages expose selected people only through Lists as today).
BUILD: (1) REGISTRY PAGE /network/experts (or the route the nav uses): fast searchable, sortable, paged list/cards of network_experts (44 today: 42 experts + 2 Athar team members, kind filter) with bilingual names, title, organisation, photo thumbnail (ui/Img, lazy), LinkedIn, tags; filters (kind, programs joined, expertise tags, has photo, has e-mail), counts; 'participation' column = number of programs and projects the person took part in and number of sessions (computed live from list_items by reference, booking sessions and mentoring-distribution sessions: use or extend the views/RPCs of docs/design/04 (v_network_expert_programs, network_expert_usage); NO stored counters, no duplicated data); Excel export (lazy xlsx). (2) PROFILE PAGE /network/experts/:id: photo, bilingual name/title/organisation/bio, links, contact (visible to staff only), expertise tags (lookup or free tags: design a small normalised model, bilingual), languages, notes (staff-only), and the PARTICIPATION HISTORY: per program and project where he appears (program name, project, list/node, role as mentor/trainer/provider, dates), booking sessions and distribution sessions held, totals and 'first/last participation', all derived live and navigable (links to the project/node for staff who have access; a PM only sees programs/projects he is a member of in the detail rows, but the totals are global: decide per RLS and document). (3) ADD / EDIT / PHOTO: create and edit forms (ar/en, validation, duplicate-name warning), photo upload through the WebP pipeline (avatar profile + thumbnail), remove photo, the 3 experts whose Drive photos could not be downloaded stay without photo (empty state with an 'add photo' action; the owner will provide them later: do not ask), soft-delete/archive (never hard delete an expert referenced by lists/bookings), restore. (4) MERGE DUPLICATES (super_admin): search similar names (trigram/normalised), side-by-side compare, merge keeping one canonical record and repointing every reference (list_items.network_expert_id, booking providers, distribution mentors, team members) in one server function with a dry-run preview and an audit entry in the migration/merge table pattern used by merge_companies; never lose data; test on throwaway rows only. (5) INTEGRATION: the Lists node 'pick from Athar Network' and the shared EntityPicker/people.js must keep working and show the same canonical fields; creating an expert from inside a Lists node should create the registry record (or link to the form) without duplicates; update shared data modules, do not fork them. (6) IMPORT: Excel import of experts with a preview and duplicate detection (reuse lib/export/xlsx), optional, light. (7) SQL: tables/columns/RPCs/views missing for the above in new re-runnable migrations with RLS (staff-only access per the assumptions, SECURITY DEFINER with search_path='' and NULL-safe guards: previous reviews found NULL three-valued-logic holes in IF guards, scan your own functions), indexes for the list queries, no anon access, verify scripts with role-switch tests; re-run the earlier verify scripts for regression. (8) UX: desktop-first for staff but usable at 375px, Arabic RTL and English, empty/loading/error states, accessible (labels, focus, tap targets >= 44px, contrast AA), plural-aware Arabic, Western digits, light lazy chunks. Tests: unit + component + SQL. Browser-verify with the migrated 44 experts (read-only) and throwaway edits (create, edit, photo upload, archive/restore, merge on throwaway duplicates), in ar/en desktop and 375px; clean up to baseline.`

phase('Build')
const built = await agent(BUILD, { label: 'build:network-experts', phase: 'Build', schema: RESULT })
if (!built) log('WARNING: builder returned null (agent died): re-run with resumeFromRunId')

phase('Review')
const REVIEW_COMMON = `
${COMMON}
You are an INDEPENDENT REVIEWER (not a builder). Do not trust the builder's report: verify from code, DB and the running app. Fix NOTHING; report findings with concrete evidence. Return verdict 'pass' only if there are no critical/high/medium findings.
Builder summary (context only): ${built ? built.summary : 'NOT COMPLETED'}`

const reviews = await parallel([
  () => agent(`${REVIEW_COMMON}
LENS = SECURITY and DATABASE (dev port 5911). RLS/privileges on every new table/function/view: who can read contact details, notes and the registry (anon none, founders none, PM vs alumni_manager vs super_admin as designed), SECURITY DEFINER hardening and NULL-safe guards (scan ALL new functions for NULL three-valued-logic holes in IF guards), merge function safety (atomic, repoints every reference including booking providers, distribution mentors, list items with overlay rows and unique indexes, team members; no data loss; permissions; dry-run does not write; concurrency/double merge), participation totals vs RLS (a PM must not learn about programs he is not a member of beyond what is decided), storage policies for expert photos (WebP only, own folder), injection/XSS through bios/notes, import abuse (formula injection in exported Excel: cells starting with = + - @), soft-delete semantics (archived experts disappear from pickers but stay on historical records). Regression: run EVERY verify script db/verify/v01..latest in order (v34 C05 only fails while throwaway rows exist). Clean up everything you create.`, { label: 'review:security-db', phase: 'Review', schema: FINDINGS }),
  () => agent(`${REVIEW_COMMON}
LENS = DATA INTEGRITY vs THE 44 MIGRATED EXPERTS (dev port 5912). Verify with SQL and the UI: the registry shows exactly the migrated 44 (42 experts + 2 team) with correct bilingual fields and photos (and 3 without photo as expected); participation numbers (programs, projects, sessions) equal direct SQL aggregates on list_items / bookings / mentoring sessions for 10 sampled experts including edge cases (an expert appearing in two lists of one project counts one project; withdrawn/hidden items; archived experts; experts with no participation); no stored counters or duplicated data; the Lists-node picker and EntityPicker still return the same people; creating from a Lists node does not create duplicates; merge on throwaway duplicates repoints references and leaves counts consistent; the Excel export columns/values match the UI; migrated data unchanged (checksums before/after). Clean up everything you create.`, { label: 'review:data', phase: 'Review', schema: FINDINGS }),
  () => agent(`${REVIEW_COMMON}
LENS = QUALITY, UX, i18n, PERFORMANCE (dev port 5913). Run lint, full tests and build; compare chunk sizes with web/PROGRESS.md (entry/routes must not regress; xlsx lazy). Walk through EVERY new screen in the browser in Arabic RTL and English LTR, desktop and 375px: registry (search/filter/sort/paging, empty/loading/error), profile page (history, totals, links), create/edit forms (validation messages, dirty state, keyboard, labels, focus, tap targets), photo upload and failure messages, archive/restore, merge UI, import preview; plural-aware Arabic, bidi for names/URLs/e-mails, Western digits, no horizontal overflow, no layout shift from images. Check the navigation: the Experts tab in the staff nav and any 'coming in step N' placeholder text for the network pages is gone or accurate; duplicated code/dead code; PROGRESS/README truthful. Clean up everything you create.`, { label: 'review:quality-ux', phase: 'Review', schema: FINDINGS }),
])

const allFindings = reviews.filter(Boolean).flatMap((r) => r.findings || [])
const failedReviews = reviews.filter((r) => !r).length
if (failedReviews > 0) log('WARNING: ' + failedReviews + ' reviewer(s) returned null (agent died): the review is INCOMPLETE; re-run with resumeFromRunId')
const blocking = allFindings.filter((f) => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium')
log('Review findings: ' + allFindings.length + ' total, ' + blocking.length + ' blocking')

phase('Fix')
let fix = null
if (blocking.length > 0) {
  fix = await agent(`${COMMON}
YOU ARE THE FIXER (dev port 5914). Reviewers found these issues in the experts registry work. Fix every critical/high/medium finding at the root cause (new re-runnable migration + verify script with the next free numbers; never edit an applied migration destructively without re-running it idempotently) plus the cheap low ones. Then re-run ALL verify scripts, lint, tests, build and a browser smoke test of the affected flows; restore the baseline.
BLOCKING FINDINGS (JSON):
${JSON.stringify(blocking, null, 2)}
LOW FINDINGS (JSON):
${JSON.stringify(allFindings.filter((f) => f.severity === 'low'), null, 2)}`, { label: 'fix:review-findings', phase: 'Fix', schema: RESULT })
} else {
  log('No blocking findings: skipping the fix phase')
}

phase('Verify')
const final = await agent(`${COMMON}
YOU ARE THE FINAL VERIFIER (dev port 5915). Build and fix nothing. Confirm: lint, vitest and build in web/ (counts + biggest chunks), every verify script db/verify/v01..latest against the local DB, the local DB at the expected baseline (list numbers), a secrets grep of web/ docs/ db/ supabase-new/ (private keys, tokens, service JWTs, bcrypt hashes) and that web/.env.local and local-db/ are git-ignored, and a short browser smoke test (throwaway super_admin: Programs, a project canvas, the experts registry and a profile page, the manager directory) in Arabic and English with no console errors. Verdict 'pass' only if everything is green. Run summary: build=${built ? 'done' : 'MISSING'}, reviewers failed=${failedReviews}, fix=${fix ? 'done' : 'not needed/MISSING'}.`, { label: 'verify:final', phase: 'Verify', schema: FINDINGS })

return { built, reviewFindings: allFindings, failedReviews, fix, final }
