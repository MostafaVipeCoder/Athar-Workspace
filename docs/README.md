# Project Documentation (As-Is) — Event Operations / Athar Accelerator Workspace

Snapshot date: 2026-10-10. This documentation describes the project **as it currently is**, including duplications and conflicts. It deliberately contains **no improvement plan**; it is the baseline for the planned full refactor.

## Stack at a glance
React 19 + Vite 7 (JavaScript, no TypeScript sources) · Tailwind 3 · react-router-dom 7 · Supabase (Postgres + Auth + Storage + Realtime + Edge Functions/Deno) · Google Calendar/Meet/Sheets · SMTP (nodemailer) · Google Apps Script (dormant) · deploy via GitHub Pages / Apache.

## Documents

| # | Document | Covers |
|---|---|---|
| 01 | [App shell & infrastructure](01-app-shell-and-infrastructure.md) | Config, build/CI, env, routes table, auth/session, hooks, i18n, styling, root-level clutter files |
| 02 | [Data access layer (`api.js`)](02-data-access-layer-api.md) | All 168 exports, function↔table matrices, usage map, dead exports, cache, companion libs |
| 03 | [Frontend: events & core entities](03-frontend-events-and-entities.md) | Dashboard, EventBuilder/Dashboard, Experts, Startups, Companies, Library, Lists, Agenda, analytics |
| 04 | [Frontend: forms, selection, Join Athar](04-frontend-forms-selection-join.md) | Form engine (legacy + new), builder, responses, library, integrations, selection board |
| 05 | [Frontend: booking & mentoring](05-frontend-booking-and-mentoring.md) | Mentor booking, Ather team booking, mentoring distribution, live view/timer, history logs |
| 06 | [Frontend: alumni platform & roles](06-frontend-alumni-platform-and-roles.md) | 22 alumni pages, role model, guards, role-vs-route matrix, invitations/certificates |
| 07 | [Database: schema, RLS, migrations](07-database-schema-rls-and-migrations.md) | Migration chronology, ER diagrams, RLS matrix, storage, repo-vs-live drift |
| 07a | [Database: table reference](07a-database-table-reference.md) | Per-table columns, constraints, indexes, triggers, RLS, origin |
| 08 | [Backend: edge functions & Apps Script](08-backend-edge-functions-and-google-apps-script.md) | 8 edge functions, Apps Script copies, Google integration, email templates, env vars |
| 09 | [Consolidated duplications, conflicts & anomalies](09-duplications-conflicts-anomalies.md) | All "as-is" findings from 01–08, in one place |
| 10 | [Consolidated open questions](10-open-questions.md) | Everything the analysts need the owner to explain |
| 11 | [Owner clarifications](11-owner-clarifications.md) | Owner's answers so far (RLS, roles, deploy target, Apps Script, key status) |
| 12 | [Apps Script poller behaviour](12-apps-script-poller-behavior.md) | What the deployed every-minute script does per booking row |

## Cross-cutting facts that span several documents
(Detail and references are in the linked documents.)

1. **Repo cannot rebuild the DB**: 17 base tables have no `CREATE` in migrations; live history differs from the repo (07).
2. **Live RLS is largely open** (`USING (true)` on ~33 tables), including `google_settings` which stores a service-account key that the browser reads (02, 04, 07, 08).
3. **Role model contradiction**: frontend supports multi-role; live `user_roles` has `UNIQUE(user_id)` and all 12 rows are `super_admin` (01, 06, 07).
4. **Two parallel form engines** (legacy submissions tables vs. `event_forms`/`form_responses`) and three question editors (03, 04).
5. **Mentor booking and Ather team booking are ~90% copy-paste**; mentoring distribution repeats generator logic (05).
6. **Google Meet generation exists in four places** with different timezone/attendee behaviour (05, 08).
7. **Many untracked source files** are required by tracked code (alumni/, forms/, RoleGuard, etc.), so a clean clone/CI build is not reproducible (01).
8. **Docs in repo root** (Arabic chat exports, ALUMNI_*.md, USER_ROLES_FIX.md) are historical and partly inaccurate versus the code (01, 05, 06, 08).

## Method and limits
- Static analysis of the repository by reading source files; the live Supabase project (read-only SELECT queries and advisors) was used for the database comparison. Nothing was executed against production, no source file was modified, and no migration was applied.
- Line numbers refer to the working tree at snapshot time (including uncommitted changes).
- No secret values are reproduced in these documents. Note that some secrets exist in repo files (see 08/09) and should be handled separately.
