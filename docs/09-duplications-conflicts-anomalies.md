# 09 — Consolidated Duplications, Conflicts & Anomalies (as-is)

> Auto-assembled verbatim from each analysis document. Line references point to the code at analysis time (2026-10-10). Each section keeps its original numbering; see the source file for context.


---

<!-- source: 01-app-shell-and-infrastructure.md -->
**Source document: [01-app-shell-and-infrastructure.md](01-app-shell-and-infrastructure.md)**

## 01-app-shell-and-infrastructure.md — 15. Duplications, Conflicts & Anomalies (as-is)

### 15.1 Routing and guards

1. **Duplicate routes with different prefixes**: nearly every event-scoped admin route is declared twice (`/event/:eventId/...` and `/events/:eventId/...`) - `App.jsx:160-169, 171-181, 321-419`. The mentor-booking, ather-team-booking and mentoring-distribution routes exist only under `/event/` (`:443-468`). Public registration routes use `/events/` only (`:431-436`), and public views use `/view/` or `/agenda/`. Three different prefixes (`event`, `events`, `view`) plus `forms`.
2. **Duplicate route definition**: `/verify-certificate/:code` is declared twice (`App.jsx:198` and `:439`), first one wins.
3. **Multiple routes -> same component**: `GenericFormPortal` has four URL shapes (`:433-436`); `FormLibraryManager` has two (`/form-library`, `/forms-library`, `:183-193`); `AlumniLoginPage` has two (`/alumni/login`, `/alumni/signin`, `:195-196`).
4. **Routes order is not grouped**: alumni routes are in the middle of the file, then event sub-routes continue (`:321+`), then public, then more admin routes (mentor-booking etc.).
5. **Three guard implementations with overlapping responsibility**: `RoleGuard` (used), `AlumniRouteGuard` (used), `ProtectedRoute` (unused, no importers, ignores `loading`). `RoleGuard` embeds alumni-specific redirects too (`RoleGuard.jsx:21-49`), so the alumni routing rules are split across two guards, and the two guards disagree on edge cases: e.g. `AlumniRouteGuard` lets a `project_manager` (no founder role) into founder routes (`:52-57`), while `RoleGuard` is never applied to `/alumni/*`.
6. **No catch-all route** (`*`) and no 404 page.
7. **Root `/alumni` route** renders `<AlumniRouteGuard><div/></AlumniRouteGuard>`; relies on the guard always redirecting (`:201`).
8. **Wrapper layout pattern**: `PublicLayout` uses `<Outlet/>` while `AlumniManagerLayout`/`FounderLayout` wrap children per route - two layout styles. `/view/:eventId/mentoring/*` are "view" URLs but sit outside `PublicLayout` (`:469-470`).
9. **Public mentor booking routes lack the guard** (`/book/:mentorId`, `/ather-team-book/:memberId`, `:453,461`) - consistent with being public booking pages, but record that all `/events/:id/register/*`, `/forms/*` and `/book/*` are unauthenticated by design.
10. **Role-less authenticated users** pass `RoleGuard` on `/` and `/profile` (no `allowedRoles`) and get `Dashboard`; PM-only routes redirect them to `/`, which again renders `Dashboard` (`RoleGuard.jsx:52-65`).
11. **Identical branches**: in `RoleGuard.jsx:56-59` the `project_manager` branch and the default both return `<Navigate to="/">`.
12. **Login redirect is not role-aware**: `LoginPage.jsx:15,25` goes to `from.pathname` or `/`; founders/alumni managers rely on RoleGuard redirects. Alumni login (`AlumniLoginPage`) is a separate page and sign-out in `UserNavDropdown` always goes to `/login` (`:73`), including for founders/alumni managers.

### 15.2 Auth and role model

13. **Multi-role vs single-role**: frontend sorts by `ROLE_PRIORITY` among an array of roles (`AuthContext.jsx:7-12,153-156`) and `getUserRoles` returns a set; `api.assignUserRole` comment and upsert enforce one role per user (`api.js:4081-4086`). `USER_ROLES_FIX.md` records an earlier mismatch (two role columns).
14. **Role cache duplicated in two storages and in two modules**: `api.getUserRoles` writes to both `sessionStorage` and `localStorage` (`api.js:4067-4071`) with a 60 s TTL read gate; `AuthContext` writes only localStorage with its own timestamp (`:81`) and reads either (`:45,71,92`). Cached roles are used as fast-path to avoid layout flashing and as timeout fallback; a stale cache can keep revoked privileges in the UI (`:78`).
15. **`user_profile_<uid>` keys**: cleared in three places (`AuthContext.jsx:101,190`, `api.js:4142`) but never set in scope (dead cache invalidation).
16. **`value` object not memoized**; context consumers re-render on every provider render. `signIn/signUp/changePassword/updateProfile/signOut` are not stabilized with `useCallback`.
17. **`signUp` in context is unused**; real signup path is `api.acceptInvitation` (`api.js:3778`) calling `supabase.auth.signUp` directly, bypassing the context.
18. **Profile data in two places**: `AuthContext` loads `profiles.*`; `usePresence` separately loads `profiles(full_name, avatar_color)` again (`usePresence.js:22-26`) and keeps its own `profile` state, returned but not used by the two callers.
19. **Custom auth `lock: fn => fn()`** removes cross-tab locking (`supabase.js:22`) and a global `visibilitychange` refresh adds extra `getSession()` calls (`:28-32`); `TOKEN_REFRESHED` events re-run full role+profile fetch (`AuthContext.jsx:134`).
20. **Timeout path leaves `profile` unset** (`AuthContext.jsx:69-74`), so UI shows fallback names until a later event.
21. **Hardcoded credentials/URLs**: Supabase URL and anon key are in source (`supabase.js:3-4`), plus in `test-meet-generation.js` and `scratch/test_fetch_events.js`; they are public-by-design anon keys but are not environment-driven, so there is no way to point the build at another Supabase project.

### 15.3 Config, build and deployment

22. **Two deployment targets implied**: GitHub Pages (`deploy.yml`, `package.json:4` homepage, `.nojekyll`) and Apache/athareg.com (`.htaccess`, `VITE_BASE_PATH=/EventsOperations`, `utils.js:3-14`). The CI build does not set `VITE_BASE_PATH`, so the `/EventsOperations` fallback is baked into share links even when served from GitHub Pages' `/Event_Operaation/` path.
23. **`GOOGLE_APPS_SCRIPT_WEB_APP_URL`** appears in `.env.example:2` and `.env` but is read nowhere; it lacks the `VITE_` prefix.
24. **`.htaccess` redirect target name mismatch**: points to `.../share-event` while the deployed folder in repo is `share` (`.htaccess:6` vs `supabase/functions/share/`). Also `RewriteBase /` while the app lives in a subpath.
25. **Two lockfiles** (`bun.lock`, `package-lock.json`) with different dates; only Bun is exercised by CI.
26. **CI has no lint/test/typecheck** and uses `bun-version: latest`; `package.json` has no `engines`, no `test` script.
27. **Unused/undeclared dependencies**: `nodemailer` (devDependency, not imported from `package.json` consumers; edge functions use `npm:` specifiers); `@types/react*` (no TS consumers); `dotenv` imported in `scratch/get_schema.js` but undeclared; `html-to-image` is used only by a component with no importers (`CertificateGenerator`).
28. **`xlsx` import style split**: via `lib/excel.js` and directly (`import * as XLSX`) in three alumni pages; `vite.config.js:23` isolates `xlsx` in a manual chunk, but only `excel.js`/alumni pages load it.
29. **Fonts loaded twice** (`index.html:20` and `index.css:1`) with different weight lists; `font-taguel` and `font-arabic` utilities both map to Tajawal; `.font-hepta`/`.font-jomhuria` are defined but their usage was not verified.
30. **`line-clamp-1/2/3` re-declared in `index.css`** while Tailwind 3.4 ships `line-clamp-*` built in.
31. **Dark mode is configured but unreachable**: `.dark` variables and `darkMode:["class"]` exist, no toggle code; a few components carry `dark:` classes.
32. **ESLint**: `react-refresh/only-export-components` is violated by `App.jsx` (exports `prefetch` and default component) and by `UserNavDropdown.jsx` (exports `ROLE_LABELS` constant next to a component); the rule `no-unused-vars` with `^[A-Z_]` pattern also hides unused capitalized constants. `lint-output.txt`/`lint_output.txt` show previous errors that are checked in as files.
33. **`vite.config.js:20` manual chunk** `id.includes('supabase')` is a loose substring test.
34. **Package name/homepage** (`event-operation`, `Event_Operaation` with typo) differ from product name ("Athar Programs Platform"), the Login page ("Project Manager") and the old folder name (`agenda-builder`).
35. **Empty `src/assets/`**, **empty `docs/`**.

### 15.4 Duplicated or dead code (shell scope)

36. `Dashboard.jsx.bak` (387 lines) tracked next to `Dashboard.jsx` (769 lines).
37. `api-agennda-intervew.gs` vs `google-apps-script/Code.gs`: two diverged copies of the same Apps Script.
38. `ProtectedRoute.jsx`: no importers. `alumni/CertificateGenerator.jsx`: no importers found (and it is the only user of `html-to-image`).
39. `utils.exportToCSV`, `utils.extractGoogleDriveId`/`getGoogleDriveFullSizeUrls` (internal only), `excel.parseGenericExcel`, `AuthContext.refreshAuth`/`signUp`/`hasRole`/`isProjectManager`/`isAlumniManager`/`isFounder`/`isSuperAdmin` have no external callers in the files checked (guards re-derive roles from `roles` instead of using the helpers).
40. Prefetch map entries unused/misnamed (see 5.5).
41. Drive-URL predicate duplicated in two functions (`utils.js:118-123` and `:153-158`); `LazyImage`'s `urlsDep` memo; `UserProfile`/`UserNavDropdown` both compute `initials`, `roleConfig` fallback, and sign-out logic separately.
42. `exportToExcel` exists in `lib/excel.js:433` but `AlumniDirectory.jsx:87`, `ImpactDashboard`, `MEWorkspace` re-implement export locally with raw `XLSX.writeFile`.
43. `test-founder-name.js` re-implements `extractSmartFirstName` locally (copy of logic from `supabase/functions/_shared/nameParser.ts`).
44. `scratch/test_persistence.js` and `test_api.js` import `./src/lib/api.js` using paths that are wrong relative to their location (scratch) or that need a browser environment.

### 15.5 Language / copy inconsistencies

45. Mixed languages and direction per component: `LoginPage` (Arabic, RTL fixed), `ChangePasswordModal`/`ErrorBoundary`/`LoadingFallback`/`ActiveUsers` (English), `SyncButton` (Arabic), `UserNavDropdown` ("English / Arabic" combined strings), `ExpandableText` (en/ar props).
46. `useLanguage` comment claims English-only fixed language but the hook supports `ar`; it is used by 3 of ~22 alumni pages while others use `translations.Alumni` + URL param.
47. `translations.js` has a `GenericFormPortal` section but `GenericFormPortal` was not found importing the dictionary; indentation style of `CompanyCard` section differs.
48. Login page copyright year `2026` hardcoded (`LoginPage.jsx:135`).
49. `README.md` is the unmodified Vite template.

### 15.6 Repository hygiene

50. 11 chat-export markdown files and 2 lint dumps are tracked at repo root; one chat export has a heading that does not match its content (`مشكلة تعدي المينتوردينج ديستريبيوشن.md`).
51. Large volume of untracked work (see 14.6) vs committed state; commit messages "1".
52. `supabase/backups/` data backup is outside `.gitignore`; `supabase/.temp/` is partially tracked.
53. Root scripts with real event IDs, an email address and anon keys are tracked (`test-meet-generation.js`, `test_api.js`, `scratch/verify_library.js`).

---


---

<!-- source: 02-data-access-layer-api.md -->
**Source document: [02-data-access-layer-api.md](02-data-access-layer-api.md)**

## 02-data-access-layer-api.md — 9. Duplications, Conflicts & Anomalies (as-is)

### 9.1 Near-duplicate / overlapping functions inside `api.js`

| # | Items | Observation |
|---|---|---|
| 1 | `getFormConfig` (1114) / `saveFormConfig` (1160) vs `getFormConfigById` (1567) / `saveFormConfigById` (1585) | Two generations of the same form-field persistence. The legacy pair keys by (`event_id`,`entity_type`) and stores `help_text` only; the by-id pair also stores `description` and `section_id` inside `validation_rules`. `getFormConfig` returns raw rows (no description/section normalisation) whereas `getFormConfigById` normalises. Legacy pair still used by ExpertManager, StartupManager, CompanyPortal, ExpertPortal, ExpertViewer, StartupViewer; the by-id pair by FormEditor and GenericFormPortal. |
| 2 | `submitCompanyRegistration` (1221) / `submitExpertRegistration` (1249) vs `submitToForm` (1879) | Two submission paths: legacy writes straight into `company_submissions` / `expert_submissions`; the unified path writes to `form_responses` and optionally fans out to `company_submissions`, `companies`, `experts`. |
| 3 | `rejectSubmission` (1377) vs `updateSubmissionStatus` (2305) | Both can mark a company submission rejected; one sets `rejection_reason`, the other `additionalUpdates`; `updateSubmissionStatus` is company-only. |
| 4 | `approveSubmission` (1301) expert path vs `submitToForm` `mentors_list` path (1991-2007) | First goes through `createExpert` (master linking, denormalised copy); second inserts directly into `experts` with a different field mapping and `email`. |
| 5 | `getExperts` (227) vs `getMasterExperts` (523) vs `getFullAgenda().experts` (175) | Three ways to fetch experts: per event (flattened master+local), global hub with `linked_events`, and as a part of the agenda; the flattening code `{...exp.master, ...exp, master: undefined}` is repeated 3x (197, 241, 668). Local row fields override master fields; master profile fields are also denormalised into `experts` and re-synchronised by `updateMasterExpert` (two sources of truth). |
| 6 | `getCompanies` (248) vs `getStartups` (298) | Same table; per-event ordered by `name` vs global ordered by `created_at`. `getCompanies` is used in StartupManager/StartupViewer, `getStartups` only in CompaniesPage (the term "startups" and "companies" are used interchangeably; the `companies` table also stores alumni companies, see 9.4). |
| 7 | `getLibraryResources` (901) vs `getLibraryData` (944) vs `getLibraryForms` (2482) | "Library" has two distinct meanings (agenda resource library `library_resources` vs central form library `library_forms`). Function naming does not distinguish them; `getLibraryData` merely wraps `getLibraryResources` and both are cached under different keys. |
| 8 | `getAlumniInvitations` (3889) vs `getAlumniInvitationsList` (4504) | Two list functions on the same table: unpaginated ordered by `sent_at` (unused) vs paginated ordered by `created_at` with search. |
| 9 | `getUniqueAlumniCompanies` (3902) / `getAlumniAdminStats` (3975) vs `getAlumniManagerDashboardStats` (4387) | Two stats implementations for the same dashboard concept (invite counts); older one is unused. |
| 10 | `getAlumniCompanies` (3581) vs `getUniqueAlumniCompanies` (3902) vs `getAlumniCompanyProfile` (3644) vs `getAlumniPlatformAnalytics` (4824) | Four different "alumni companies" fetchers with differing filters: `is_alumni=true` (3585, 3609) vs **no** `is_alumni` filter (3906, 4826, 4398, 4442, 4789). Dashboard/analytics numbers therefore count all companies including non-alumni event companies. |
| 11 | `updateAlumniCompany` (4023) vs `updateCompany` (742) vs `updateFounderCompanyWithSnapshot` (4252) | Same update with/without snapshot. |
| 12 | `sendAlumniInvitation` (3717) vs `sendBulkAlumniInvitations` (4555) vs `resendAlumniInvitation` (3746) | Three insertion/update paths with different token formats (dashless 32-char UUID at 3720/3747 vs dashed UUID at 4561), different return shapes (`{...data, token, success, invitation, inviteLink}` vs `{success, invitation}`), and normalisation (`trim().toLowerCase()` in all). |
| 13 | `linkFounderToCompany` (3261) vs inline insert in `createFounderCompany` (4310) and in `acceptInvitation` | Role value `'founder'` (default), `'Founder'` (3840), both `role` and `role_in_company` columns only in 4313-4314. Two columns carry the same meaning. |
| 14 | `createSnapshot` (3368) vs inline `company_snapshots` inserts (4266, 4323) | Different `snapshot_type` values (`annual_update` via form, `founder_update`, `founder_create`, caller-supplied from MEWorkspace/CompanyProfilePage); `data` is a whole company row in two cases and a form-answers object in the other, so consumers (`getImpactStats`, `compareSnapshots`, `getAlumniPlatformAnalytics`) read different key names: `revenue_sar` / `funding_raised_sar` / `employees_count` / `jobs_created` (3396, 3628-3630) vs `revenue` / `annual_revenue` / `employees` / `team_size` / `jobs_created` (4881, 4884). |
| 15 | `uploadImage` (871) vs inline storage code in `CertificateGenerator.jsx:131-138` | Same bucket, parallel implementations. |
| 16 | `updateSlotsOrder` (2320), `bulkUpdateExperts` (2370), `bulkUpdateCompanies` (2396) | Three different bulk-sort strategies: split insert/upsert; N parallel updates; one upsert with partial rows. |
| 17 | `duplicateEvent` (354) vs `duplicateEventForm` (1802) vs `duplicateLibraryForm` (2604) | Three duplicate routines with different copy rules (suffix `" (Copy)"` vs `" (نسخة)"`; `library_form_id` and covers handled differently). `duplicateEvent`'s form cloning copies `event_forms` rows including `library_form_id` and `cover_id`, and copies `form_field_configs` using `event_forms.form_id` of **old** form (`oldForm.form_id`, 500) correctly but without `event_id` override on fields (`...fieldToCopy` keeps the **old** `event_id`, 503-504). |
| 18 | `getEventSlug` + `getEvent` slug resolution vs raw-UUID functions | Some APIs accept slug (`getExperts`, `getCompanies`, `getFormConfig`, `getJoinAtharPage`, `saveJoinAtharPage`, `getLibraryResources`, `getAgendaTabs`), others only UUID; `saveFormConfig` and `getEventForms` do not resolve slugs while `getFormConfig` does. |
| 19 | `getJoinAtharPage`'s name resolution happens before every `saveJoinAtharPage` and cache keys by identifier | `getJoinAtharPage` is not cached while `getAgendaTabs` (cached) calls it, so a stale `agenda_tabs_*` entry can persist until any write clears the whole cache. |

### 9.2 Overlaps with other libs (cross-reference only)

| Item | api.js | Other file | Note |
|---|---|---|---|
| `getEvent` | api.js:112 (full row, cached, slug aware) | `mentorBooking.js:5`, `atherTeamBooking.js:5` (each selects a different column subset by `event_id`, uncached, `.single()`) | Three exported functions with identical name and different semantics/return columns. |
| `createSlot`, `updateSlot`, `deleteSlot` | api.js:830/850/860 -> `agenda_slots` | `mentorBooking.js:190/199/209` -> `mentor_slots` | Same names, different tables/PKs. |
| `getEvents` / events notification settings | api.js `updateEvent` generic | `mentorBooking.js:16 updateMentorNotificationSettings` also updates `events` | Parallel writer for the same row. |
| `ADVANCE_NOTICE_OPTIONS`, `isSlotWithinNoticeWindow` | - | **Identical copies** in `mentorBooking.js:123-146` and `atherTeamBooking.js:72-93` | Verbatim duplicate (including mixed EN/AR labels). |
| `calculateDaySlotTimes` | - | `mentorBooking.js:422` (config: `session_start_time`, `session_end_time`, ...; returns an **object** `{slotTimes,...}` but early-returns an **array** `[]` at the guard line) vs `mentoringDistribution.js:643` (config: `start_time`, `slots_per_day`; returns an **array**) | Same exported name, different input/output shapes. |
| `getBookings` / `createBooking` / `deleteBooking` vs `getAtherTeamBookings` / `createAtherTeamBooking` / `deleteAtherTeamBooking` | - | mentorBooking.js:222-321 vs atherTeamBooking.js:167-290 | Parallel copies of the same flow (both call `notifyGoogleAppsScript` with 3-retry loops at mentorBooking.js:277-300 / atherTeamBooking.js:245+). |
| Mentors | `master_experts`/`experts` in api.js | `mentors` table in mentorBooking.js (with `master_experts` lookup at 50, 79) and `experts` queried directly in `MentoringDistributionAdmin/LiveView/MatrixView` | Three notions of "mentor": `experts`, `master_experts`, `mentors`. |
| Spreadsheet id extraction | - | `googleSheets.extractSpreadsheetId`, inline regex in `excel.js:353,409` | Triplicated. |
| `notifyGoogleAppsScript` | api.js:7 | consumed only by the two booking libs | A booking concern living in the generic `api.js`; creates the dependency `mentorBooking.js -> api.js` (which also triggers the `supabase.from` monkey patch). |

### 9.3 Conflicts between code and the generated DB types (`src/types/database.types.ts`)

`database.types.ts` is a snapshot and may be older/newer than the live DB (see Open Questions). Differences noticed:

| api.js reference | Type file | Detail |
|---|---|---|
| `events.title` selected at api.js:2794 and 2821 | `events` has `event_name`, `event_name_ar`, `id` ... and **no `title`** (types 902-1056) | `getLibraryFormResponses` / `getLibraryAnalytics` map `eventMap[event_id] = ev.title` and ask for `title`; the `events` query errors are not checked (S), so project names would resolve to fallbacks `'Unknown Project'` / `'Unnamed Project'` / `'General'`. |
| `form_sections` table (2908, 2949, 3010) | not present in `Tables` list | Code treats it as optional (probe), comments "if it exists". Migrations `20260908000000_create_form_sections_and_phone_validation.sql` and `20260909000000_create_form_sections.sql` both exist. |
| `pp.graduation_date` (4911) | `program_participations` has `start_date`, `end_date`, `graduation_status`, no `graduation_date` | Survival-rate calculations (6/12/24 months) would never be eligible and hit the hard-coded fallback 94/86/74. |
| `companies.created_at` set in `createFounderCompany` (4302) | `companies` has no `created_at` | Possibly stale types; the insert would fail on an unknown column if the column does not exist. |
| `companies.sector` / `province` used by manager analytics vs `industry` | Both `industry` and `sector` columns exist | `getAlumniCompanies` filters `sector` filter value against `industry` (3588); `getAlumniManagerChartsData`, `getAlumniFilterOptions`, `getAlumniPlatformAnalytics` use `sector`; `getUniqueAlumniCompanies` accepts either (3964). |
| `alumni_invitations` order by `created_at` (4509) vs `sent_at` elsewhere | Both columns exist | Mixed. |
| `user_roles` upsert `onConflict:'user_id'` (4085) | types show no unique hints; migration `20261004000000_fix_user_roles_drop_role_key.sql` | The comment "one role per user" depends on a unique constraint on `user_id`, while the migration name suggests a `role_key` constraint was dropped; `getAllEligibleProjectManagers`/AuthContext treat roles as arrays (multiple roles per user). |
| `project_managers` double columns (4180-4185) | table has both `event_id`/`project_id`, `assigned_by`/`added_by`, `assigned_at`/`added_at` | Writes both pairs always; reads only `event_id` (4152). |
| Enum `app_role` | `super_admin | project_manager | alumni_manager | founder` | `acceptInvitation` writes `role:'founder'` only as auth metadata (not into `user_roles`; how `user_roles` gets the `founder` row is not visible in api.js: possibly a DB trigger, see `20260929000001_fix_sync_triggers.sql`). |

### 9.4 Inconsistencies, hazards and anomalies

1. **Hard-coded Supabase URL and publishable key in source** (supabase.js:3-4) while `.env.example` exists; no env usage.
2. **Service-account private key is read to the browser** (googleSheets.js:93-106) and Google OAuth is performed client-side (see 6.1).
3. **Cache invalidation by monkey-patching** `supabase.from` (api.js:46-59); invalidation happens before the write completes (race), and is whole-cache. Redundant explicit `clearApiCache()` in ~12 functions.
4. **`duplicateEvent` field clone keeps old `event_id`** on `form_field_configs` (api.js:502-505): `...fieldToCopy` only removes `id, created_at, updated_at, form_id`, so `event_id` stays the original event's value (not remapped to `newEventId`). Also `form_responses`, `form_covers` (referenced by `cover_id`), Join Athar pages are not cloned.
5. **`importAgendaData` docs vs behaviour** (see 3.3): claims days and slots, handles only experts and companies; writes ignore errors; `normalize(existing.photo_url)` comparisons; companies update compares 8 of 10 fields (omits `governorate`, `links`); `governorate` fallback to `location`.
6. **`approveSubmission` for companies spreads `additional_data` into the `companies` row** (1323), so arbitrary form keys (possibly non-columns) become insert columns; no whitelist.
7. **`submitToForm` phone key heuristic** `key.includes('tel')` etc. (1886) matches unintended keys; Phone validation runs with default countries even if the form configured others (the form's allowed countries are not passed).
8. **Errors swallowed in many multi-step writes** (`saveFormSections`, `deleteFormSection`, `trackJoinAtharEvent`, `trackFormShareEvent`, `saveFormConfig` form creation, `updateMasterExpert` sync, `importAgendaData` writes, `saveJoinAtharPage` card delete). Contrast with other functions that throw.
9. **Non-atomic delete-then-insert** for `form_field_configs` (1187-1213, 1587-1630) and `join_athar_cards` (3095-3108), `form_sections`.
10. **Read-modify-write on JSON column**: `saveFormSections` and `deleteFormSection` overwrite `event_forms.integrations` using a previously-read copy (concurrent edits to integrations by `updateEventForm` can be lost); `importFormFromLibrary` increments `import_count` non-atomically.
11. **Invitation flow does not send email in api.js**; `sendAlumniInvitation` returns `inviteLink` for the caller to deliver (how it is delivered is outside this file). Expiry (14 days) is computed client-side and persisted by `validateInvitationToken` (write from public flow). Status `revoked` has no handling in validation.
12. **Different invitation link base**: `origin || window.location.origin` + `/#/alumni/signup?token=` (HashRouter style) versus `getShareUrl` building `https://athareg.com/share?id=` (non-hash).
13. **`getAlumniPlatformAnalytics` hard-coded fallback percentages** (94/86/74) are returned as real stats when no data is eligible; `activeCount || totalCompanies` also forces totals when zero active.
14. **`getImpactStats` string vs number**: `toFixed()` returns strings for `survivalRate` / `snapshotsCoverage` but `0` (number) otherwise; same in `getJoinAtharAnalytics.conversionRate`, `compareSnapshots.pctChange`, `getAlumniAdminStats.responseRate`.
15. **`markAllNotificationsAsRead` ignores broadcast rows** with `recipient_id IS NULL` that `getFounderNotifications` returns (4363 vs 4378).
16. **Sheet-name literals with typos** (`total responces`, `selection prosses`) in `syncSubmissionsFromSheet` (2192) - intentionally matching real sheet names, presumably.
17. **Unused destructured/dead variables**: `updateExpert` (`display_config, event_id, rest`, `_le, _id, _eid`), `approveSubmission` (`targetData` for expert path), `appendFormResponseToSheet` (`formName`), `useMentoringTimer` (`isMaster`).
18. **Backup file** `src/components/Dashboard.jsx.bak` exists in the tree (component directory listing); not part of this layer but contains old code.
19. **Language/label hard-coding in the data layer**: Arabic strings in `duplicateEventForm` (`(نسخة)`), Arabic/English tab labels in `getAgendaTabs`, Arabic error messages in `phoneValidation.js` and `excel.js`, stage names in `getAlumniFilterOptions`; `translations.js` exists but is not used here.
20. **Mixed responsibilities in one file**: events/agenda, forms, library, alumni, roles/profile, notifications and Google integration share one module of ~5k lines; imports from `./excel` (xlsx library pulled in for every importer of `api.js`).
21. **Logging**: many `console.log` calls for normal operations (e.g. 83, 114, 176, 307, 355, 789, 879, 955, 2321, 2371, 2414) in production paths.
22. **Naming**: verbs vary (`submit*`, `apply*`, `issue*`, `send*`, `invite*`, `assign*`, `link*`); singular/plural for the same entity (`getAlumniCompanies`, `getUniqueAlumniCompanies`, `getStartups`/`getCompanies`); parameter objects vs positional parameters are mixed (e.g. `createParticipation({..})` vs `createDay(dayData)` vs `createFormCover(eventId,name,imageUrl)`).
23. **Hash vs history routing leaks into data layer** (`/#/alumni/signup`).
24. **Unbounded selects**: `getFormResponses`, `getEventFormsResponses`, analytics functions fetch full tables without pagination/limit (only `getAlumniInvitationsList` paginates; `getAlumniManagerNotificationsLog` limits 300).
25. **`getEvent` fallback scan** loads all events and matches client-side; the two `ilike` calls pass user input (decoded identifier) as a pattern, so `%`/`_` in a slug act as wildcards. `getLibraryResources` and `getLibraryForms` interpolate ids into `.or()` strings (901-909, 2491) without escaping (ids are normally UUIDs).
26. **Hidden dependency on build/runtime**: `supabase.js` uses `window.localStorage` at import; `getUserRoles` uses `sessionStorage`/`localStorage` without feature checks outside try blocks (the initial `sessionStorage.getItem` at 4040 is not inside try/catch).

---


---

<!-- source: 03-frontend-events-and-entities.md -->
**Source document: [03-frontend-events-and-entities.md](03-frontend-events-and-entities.md)**

## 03-frontend-events-and-entities.md — 7. Duplications, Conflicts & Anomalies (as-is)

Items are ordered roughly by how likely they are to affect runtime behaviour. "Verified" means checked by reading the code and, where noted, by executing a script against the file.

### 7.1 Runtime-breaking or suspected-broken

1. **Registration portals read nonexistent translation keys.** `CompanyPortal.jsx:35` and `ExpertPortal.jsx:33` compute `translations.ar` / `translations.en`. `lib/translations.js` exports only per-component keys (`AgendaViewer, CompanyCard, CompanyPortal, ExpertCard, ExpertPortal, ExpertViewer, GenericFormPortal, LibraryViewer, PublicLayout, StartupViewer, Alumni`); verified by importing the file in Node: top-level keys contain no `ar`/`en`. The intended objects are `translations.CompanyPortal.<lang>` and `translations.ExpertPortal.<lang>`. As written `t` is `undefined`, and `t.closedError`, `t.loading` (`ExpertPortal.jsx:156`, `CompanyPortal.jsx:177`) etc. throw. The `catch` blocks read `t.loadError` (`ExpertPortal.jsx:77`, `CompanyPortal.jsx:89`), which would throw again. Consequence: both public portals cannot render without hitting the `ErrorBoundary`.
2. **`CompaniesPage` references an unimported icon**: `AlertCircle` used at `CompaniesPage.jsx:130`, import list at `:2` lacks it, so the error state throws `ReferenceError`. Also: "Add Company" button has no handler (`:90`), search and key use `startup_name`/`startup_id` (`:34,146`) which are not columns of `companies` (`types/database.types.ts`), so search by name never matches and list keys are `undefined`.
3. **Company review desk likely never receives new submissions.** `submitCompanyRegistration` and the Selection-Process branch of `submitToForm` insert `company_submissions` with `status: 'screening'` (`lib/api.js:1232,1970`), but `StartupManager` loads `getSubmissions(eventId,'company','pending')` (`StartupManager.jsx:93`). Expert submissions use `'pending'` (`lib/api.js:1261`) and match `ExpertManager.jsx:101`. Unless another process rewrites `screening -> pending`, the startup "Review Desk" is empty for forms created through these paths.
4. **Per-expert `display_config` is never persisted.** `ExpertManager.jsx:76-82,860-1029` edits `formData.display_config`, but `updateExpert` destructures `display_config` and `event_id` and drops them (`lib/api.js:679-685,689-695`), `createExpert` ignores it (`lib/api.js:605-673`), and `experts` has no `display_config` column in the types. In addition `ExpertCard` prefers the global `config` array whenever one is passed (`ExpertCard.jsx:57-66`), which both manager and viewer always do. The "Show on Card / عرض على الكارت" switches in the expert modal therefore have no effect.
5. **`duplicateEvent` expert/slot handling looks inconsistent with the schema.** It reads `rawExperts` and maps `oldExp.id -> newExperts[idx].id` (`lib/api.js:393-407`) but `experts` is keyed `expert_id` (`ExpertManager.jsx:318`, `lib/api.js:728`); it strips `id` but not `expert_id` before insert (`:393`), so the copy carries the original primary key. For slots it writes `expert_ids` and `company_ids` on every inserted slot (`lib/api.js:453-461`), columns that do not exist on `agenda_slots` in `types/database.types.ts`. Whether duplication succeeds depends on the live database, not on this code (Open Q 5).
6. **`EventBuilder.jsx` time-format comparison**: `validateAgendaOrder` compares times as strings (`:852`) while `serializeState` explicitly normalises `HH:MM:SS` vs `HH:MM` (`:295-301`). Slots loaded from the DB carry `HH:MM:SS` and locally edited ones `HH:MM`, so equal boundary times can compare as "overlap" in mixed lists.
7. **`handleDragEnd` bypasses the staged-save model.** Drag reorder in `EventBuilder` immediately calls `updateSlotsOrder` for that whole day (`:909-914`), persisting any unsaved edits of that day's slots and inserting temp slots, while the header banner still claims "unsaved changes" and while days deletions stay pending.
8. **`EventBuilder` "Event Branding Name" input is never saved.** It edits `eventDetails.event_name` locally (`:1771`) but neither `handleSaveImages` (`:418-423`) nor `handleFinalSave` (`:1030-1032`) writes `event_name`.
9. **`headerSettings` in `EventBuilder` is write-only.** Initial state is a hard-coded default object (`:273-286`); it is never hydrated from `events.header_settings`, although `handleSaveImages` writes it back (`:420`). Re-opening the builder and pressing "Save Changes" overwrites any stored settings with defaults (including values written elsewhere, e.g. `ExpertManager`'s `customExpertsLabel` keys, because the whole `header_settings` JSON object is replaced). Likewise `imageUrls.height` defaults to `'400px'` (`:289`) while public pages default to `'16rem'`.
10. **`MasterExpertsList.ExpertEditModal` posts the whole row** including `linked_events` and id (`:410-422,557`); it relies on `updateMasterExpert` to strip them (`lib/api.js:558-562`). `LibraryManager` does the same with Global Pool rows (`:397`) but there nothing strips `resource_id`/`created_at` before the update.
11. **Closed registration portals still show the form shell.** On `closedError`/`deadlineError` the portals set `error` and `return` while `event` is set (`ExpertPortal.jsx:53-62`, `CompanyPortal.jsx:58-70`); the "error and no event" screen only triggers for `!event` (`:162`/`:184`), so a disabled/expired portal falls through to the main layout with an empty form and the error text rendered under it.
12. **`StartupManager` modal reset inconsistent.** Closing with the X resets `formData` to a different shape (`startup_name`, no `name`, `founder`, `role`, `*_ar`, `show_logo`; `:690-706`) than the initial shape (`:62-87`); the Cancel button (`:1120`) resets nothing and keeps `editingCompany`; only the successful submit path resets properly (`:240-266`).
13. **`ImageSection` defined inside `EventVisualManager` render** (`:92-140`) re-creates the component each render, remounting its subtree on every state change (e.g. each `uploading` toggle).

### 7.2 Dead, unused or orphaned code

| Item | Evidence |
|---|---|
| `Dashboard.jsx.bak` | not imported; superseded by `Dashboard.jsx` (see 4.2) |
| `EventBuilder`: `handleImportExcel` (`:434-450`), `handleGoogleSheetSync` (`:452-475`), `syncError`/`syncReport`/`lastSyncTime` panels (`:1193-1279`), `TIME_OPTIONS` (`:184`), `to12h`/`to24h` (`:192-208`), `isSubmittingDay` (`:182`), `_selectedDay`/`_dayError`/`_isSyncing`/`_gsheetsUrl`, imports `useRef, useNavigate, createSlot, updateSlot, syncEventFromCloud, generateAgendaTemplate, FileSpreadsheet, Download, UploadCloud` | ESLint no-unused-vars + manual read: no UI invokes the import/sync handlers |
| `EventDashboard`: Google Settings (state `:49-52`, `:60-130`), `_saveTheme` (`:138-151`), `isSyncOpen` (`:28`), unused icons (`Rocket, Settings, Palette, BarChart3, ChevronUp`) | not rendered |
| `Dashboard.jsx`: imports `useAuth` (`:14`), `supabase` (`:20`) unused; `ChevronRight` used only in program header | ESLint |
| `AgendaViewer`: `experts` state and `getExperts` request (`:14,57-62`), `Linkedin`, `index` param (`:276`), localStorage read for a never-written key (`:43`) | ESLint + `grep` |
| `ExpertCard` / `CompanyCard`: list variants (`ExpertCard.jsx:83-221`, `CompanyCard.jsx:113-260`), unused imports (`MapPin, Twitter, ExternalLink, Globe`; `Plus, Banknote`) | both viewers pass constant `viewMode='grid'` |
| `ExpertManager`: `_selectedFile`, `_setIsSearchExpanded`, `isSearchExpanded` effectively constant, `_verticalListSortingStrategy` import | ESLint |
| `StartupManager`: `verticalListSortingStrategy` import | ESLint |
| `ProjectManagersManager`: `eventName` prop unused | ESLint |
| `ListsManager`: imports `Filter, LayoutGrid, MoreVertical, Search` unused; `Settings` button inert | read |
| `MasterExpertsList`: `_error` state set but never shown (`:20,36`) | read |
| `AgendaViewer` translation keys `experts, companies, from, to` (`translations.js`) unused here | grep |
| `CompanyCard` legacy mock fallbacks (`sector`, `logoUrl`, `bio`, `status==='Profitable'`) | `:55-64,283-292` |
| `.bak` link `/mentor-booking-admin` | no such route |

### 7.3 Contradictions between layers

- **Card visibility has three overlapping sources**: global `form_field_configs.show_in_card` (modal "Card Settings"), per-row `display_config` (modal toggles), and hard-coded flags in `CompanyCard` (`show_name: true`, `:99`). Only one is honoured depending on whether `config` is passed (`ExpertCard.jsx:57-76`, `CompanyCard.jsx:76-108`).
- **Two places edit the event header/visuals**: `EventBuilder` "Visual Settings" tab + "Agenda Cover" card write `header_image_url`, `header_settings`, `header_height`; `EventVisualManager` writes `background_image_url`, `footer_image_url`. `EventBuilder` has two separate state copies of the header image (`coverImageUrl :255` saved immediately, `imageUrls.header :288` saved on "Save Changes") that both write `events.header_image_url`.
- **Immediate vs staged persistence** is inconsistent: `EventBuilder` days/slots staged, cover upload immediate, drag-reorder immediate, "Save Changes" in the visual tab separate; `EventVisualManager` staged; `ExpertManager`/`StartupManager` drag-reorder immediate, forms explicit.
- **Order is saved but not read back for companies**: `bulkUpdateCompanies` writes `sort_order` (`lib/api.js:2396-2407`) but `getCompanies` orders by `name` (`lib/api.js:259`), so manual company order is lost after reload; experts are read by `sort_order` (`:238`). The two grids also differ in whether public viewers show manager order.
- **Search while dragging**: `ExpertManager` can drag within a filtered subset and then computes indexes against the unfiltered `experts` array (`:318-321` using `filteredExperts` ids), while `StartupManager` disables sorting when a search term is present (`:552`).
- **Status vocabulary**: expert submissions `'pending'`, company submissions `'screening'`, review tabs query `'pending'` for both; `approveSubmission` sets `'approved'`; `updateSubmissionStatus` is company-only (`lib/api.js:2305`).
- **Field-name vocabularies differ between form config, card, manager and defaults** (see 7.4).
- **Roles**: route guard admits `project_manager`, but `ProjectManagersManager` assumes super-admin only and states "Owner (Can manage other PMs)" without enforcement visible in scope. `/` admits users with no role.
- **Entity naming**: UI says "Mentors" for the `experts` list, while a separate `mentors` table backs Mentor Booking (`lib/mentorBooking.js:36`) with its own `master_id` link.
- **Public tab label vs list title**: `customExpertsLabel` (set in the expert settings modal) feeds both the public tab (`lib/api.js:281`) and the `ExpertViewer` heading (`ExpertViewer.jsx:102-104`), but the admin screen is titled "Mentors Hub" regardless.
- **Program UI vs schema**: program only has `name` editable; `programs` also stores `name_ar`, `program_type`, `year`, `status`.
- **Experts PK naming**: code uses `expert.expert_id || expert.id` in 8+ places (`ExpertManager.jsx:262,318-319,326,636,642`, `ExpertCard.jsx:22,210,264`), whereas `master_experts` uses `id`; `duplicateEvent` uses `id`.
- **Duplicate DB columns** written together: `project_managers` (`event_id/project_id`, `assigned_*/added_*`, `lib/api.js:4179-4188`); `events` has both `name` and `event_name`/`id` and `event_id` (types), and `getEvent` still compares `ev.name` (`lib/api.js:159`).
- **`events.description` / `*_portal_message_ar`** are read in `AgendaViewer.jsx:88`, `ExpertPortal.jsx:295-297`, `CompanyPortal.jsx:318-320`, but are absent from the generated types (`events` Row).

### 7.4 Naming mismatch for company fields

| Meaning | `getDefaultFormConfig` (`lib/api.js:1398-1437`) | `StartupManager` form / `isFieldRequired` | `CompanyCard` visibility lookup (`:80-88`) | `submitCompanyRegistration` | `companies` column |
|---|---|---|---|---|---|
| name | `startup_name` | `name` (`:728-730`) | `startup_name` | `startup_name` | `name` |
| founder | - | `founder` (`:794`) | `founder_name` | in `additional_data` | `founder` |
| role | - | `role` (`:834`) | `founder_role` | in `additional_data` | `role` |
| stage | - | `stage` (`:866`) | `startup_stage` | in `additional_data` | `stage` |
| link | - | `links[]` | `website_url` | in `additional_data` | `links` / `website_url` |
| location | `location` | `governorate` (+`location_ar`) | `location` | `location` | `governorate`, `location` |

Consequences (as written): `isFieldRequired('name')` and the card-visibility toggles for founder/role/stage/links never match the default config names (the lookup returns `undefined`, and `undefined !== false` makes the field visible), so those "Card View" switches cannot hide them unless a custom form uses exactly those names. `approveSubmission` for companies spreads `additional_data` straight into the `companies` insert (`lib/api.js:1317-1324`), so any custom form field key must also be a `companies` column.

`CompanyCard` additionally computes `governorate` from `location_ar` in Arabic (`:60`) although the manager stores `governorate_ar` (`StartupManager.jsx:62-87`), and `location_ar` has no input in the modal.

### 7.5 Copy/paste divergences worth recording

- Three `display_config` default objects in `StartupManager` use `show_founder/show_role/show_stage/show_governorate/show_industry/show_description/show_links` (`:78-86,148-156,257-265`); the fourth (close-X reset) uses a different set including `show_logo` and `startup_name` (`:691-705`). `CompanyCard`'s legacy branch maps `show_logo` from `show_photo` (`:98`).
- Expert modal `required` attributes are driven by `isFieldRequired`, but only for 6 hard-coded field names (`ExpertManager.jsx:811-992`); config rows with other names have no effect in the modal.
- Expert approval does not refresh the curated grid, startup approval does (`ExpertManager.jsx:190-202` vs `StartupManager.jsx:181-194`).
- English vs Arabic dropdowns in `EventDashboard` differ by whether `sm:left-0` is applied (`:480` vs `:556`).
- Loading/error screens have different tones and copy in each viewer (e.g. "Syncing with workspace..." vs "Establishing Visionary Signal..." vs "Scanning Ecosystem...").
- `EventBuilder.jsx:1060` uses `max-w-[1600]` (missing unit) so the class has no effect; `EventDashboard.jsx:402` has the stray token `; top-0` inside a `className` (probably intended `sticky top-0`).
- `toast` type `'warning'` (`EventBuilder.jsx:905`) is rendered with the error colours (`:2117`).
- `EventBuilder.handleToggleDayNames` is `async` but contains no `await` (`:787-791`).
- `ExpertManager` library-modal fetch has no `catch` (`:388-393`), so the modal can stay in a loading state on failure.
- `SubmissionAnalytics` sorts localised date strings by re-parsing them (`:193`), which is locale/format dependent.
- `LibraryManager` title search assumes `title_ar` non-null (`:144`) while `LibraryViewer` guards for null (`:40-41`).
- `AgendaViewer` timer polling every 30 s re-fetches experts too (`getFullAgenda` already includes them).
- `getAgendaTabs` always returns at least the agenda tab (`lib/api.js:295`), including when the event lookup failed.
- `App.jsx:99-116` converts `?agenda=` URLs before React mounts and defaults `lang=ar` when absent, while `AgendaViewer` itself defaults to English when `?lang` is missing (`AgendaViewer.jsx:19`).

---


---

<!-- source: 04-frontend-forms-selection-join.md -->
**Source document: [04-frontend-forms-selection-join.md](04-frontend-forms-selection-join.md)**

## 04-frontend-forms-selection-join.md — 9. Duplications, Conflicts & Anomalies (as-is)

Numbered for cross-reference. `file:line` references are to the current working tree.

### 9.1 Duplication

| # | Finding | Where |
|---|---|---|
| A-1 | Three question editors (project `QuestionsBuilder`, library inline editor, legacy editors in `StartupManager`/`ExpertManager`); library editor lacks sections/description/placeholder/validation/`multiselect` entry. | `QuestionsBuilder.jsx`; `FormLibraryManager.jsx:381-513`; `StartupManager.jsx:503`, `ExpertManager.jsx:579` |
| A-2 | `isCoreField` + `getIconForType` duplicated in `FormEditor` (unused) and `QuestionsBuilder`. | `FormEditor.jsx:56-72` vs `QuestionsBuilder.jsx:25-41` |
| A-3 | Two admin shells for forms: `FormEditor` (EN/LTR) and `FormLibraryManager` (AR/RTL) each re-implement list/filter/create/details/responses. | — |
| A-4 | `SaveToLibraryModal` and the "library saved" toast are rendered twice in `FormEditor`; the second instance (list view, guarded by `editingForm`) is unreachable because `editingForm` is null in that branch. | `FormEditor.jsx:449-471` vs `:699-722` |
| A-5 | Sections stored in **three** places (`integrations.form_sections`, relational `form_sections`, `event_forms.sections` column that nobody reads) and `section_id` stored in `validation_rules` *and* a `form_field_configs.section_id` column; migrations `20260908` and `20260909` create the same table/column/index/policies twice (the second is titled "Fix for 404"). Migration `20260908` is named `…_and_phone_validation` but contains no phone-validation DDL. | §6.3 |
| A-6 | Question description stored three ways: `help_text`, `validation_rules.description`, in-memory `description`. Same for `integrations` carrying both config and `form_sections`. | `api.js:1574-1579, 1601-1622` |
| A-7 | `PLATFORM_META` (platform list) defined separately in `JoinAtharView.jsx:8-14` and `JoinAtharDashboard.jsx:22-28`; social platform lists are redefined in `SourceTrackingToolbar`, `GenericFormPortal`, `FormClicksAnalyticsTab`, `FormResponsesTab` (colours). | — |
| A-8 | `send-rejection-emails` ≈ `send-acceptance-emails` (and the interview one differs by ~10 lines); recipient/name extraction re-implemented in `api.extractPrimaryEmail`, `SelectionProcessManager.getFounderDisplayName`, `excel/extractDynamicSheetFields`, and the edge function. | `supabase/functions/send-*/index.ts`, `api.js:2028-2181`, `SelectionProcessManager.jsx:46-108` |
| A-8b | Two URL-prefill mechanisms for form fields (portal + renderer) — the renderer's `useEffect` depends on `[fields]` and calls `onChange({...values, ...prefilled})`, so each time the multi-step wizard swaps `fields` it re-applies URL params over whatever the respondent typed for same-named fields. | `GenericFormPortal.jsx:73-78`, `DynamicFormBuilder.jsx:17-33` |
| A-8c | Module vocabularies differ between engines: `selection_process/company/expert` vs `selection_process/companies_list/mentors_list/attendees_list` vs `alumni_annual_update`. | §4.2 |
| A-8d | `integrations.mentors_list` and `attendees_list` kept in sync by hand "for backward compatibility". | `FormIntegrationsTab.jsx:41-43, 263-270` |

### 9.2 Conflicts / contradictions between UI promises and behaviour

| # | Finding | Where |
|---|---|---|
| A-9 | UI promises "saved in E.164" (`PhoneValidationConfig.jsx:32`), but the portal validates and **stores the raw typed value**; sanitisation happens only in `submitToForm`, only for keys containing `phone/tel/mobile` or `whatsapp`, and with default countries EG/SA/AE rather than the field's `allowed_countries`. Builder-created fields are named `custom_<timestamp>`, so a question of type `tel` is validated but **not sanitised**. Key match on `tel` also catches names like `hotel…`, `telegram…`. | `GenericFormPortal.jsx:147-153`; `api.js:1883-1892` |
| A-10 | Phone "allowed countries": for ≥2 allowed countries any 7–15-digit international number passes through the general fallback (`phoneValidation.js:209-210`), and KW/QA/BH/OM/JO can be ticked but have no specific validator. | `phoneValidation.js:175-217` |
| A-11 | Field type `phone` (library editor + default library questions) is not a type the renderer knows → question silently disappears from the public form; required-ness is still enforced by the portal for the hidden question (it is in `fields`), which would block submission. Builder dropdown has no `phone` option either (select shows empty). | `FormLibraryManager.jsx:450, 853`; `DynamicFormBuilder.jsx:384`; `QuestionsBuilder.jsx:229-237` |
| A-12 | Response `status` workflow (`submitted/reviewed/approved/rejected`) has API (`updateFormResponseStatus`), badge styles, a filter state, but no UI to change or filter it. | `FormResponsesTab.jsx:13, 51-61, 78, 275-283` |
| A-13 | "Hide channel" in `SourceTrackingToolbar` only dims the card; link copying stays active and the public portal ignores the config. Instagram is a tracked/configurable channel but has no share button/handler in the portal. | `SourceTrackingToolbar.jsx:168-205`; `GenericFormPortal.jsx:316-340, 427-472` |
| A-14 | Thank-you tokens: Settings offers `{name} {company} {email} {phone}`; the portal replaces `{name}`, `{company}`, the Arabic tokens `{اسم_المشارك}`, `{اسم_الشركة}`, `{البريد_الإلكتروني}`, `{رقم_الهاتف}` and `{<field_label>}` — but **never** `{email}` or `{phone}` (variables computed at `:283-284` are only used by the Arabic tokens). `{name}` falls back to the *first key of formValues* when no `startup_name/expert_name/name` answer exists (builder fields are `custom_*`), and label tokens are used as an **unescaped RegExp** (`new RegExp(labelToken,'g')`). | `FormSettingsTab.jsx:246-267`; `GenericFormPortal.jsx:274-307` |
| A-15 | `FormIntegrationsTab` shows Selection default = `target_module==='selection_process'`, but because DB default JSON is non-null it never applies: a new `selection_process` form does **not** feed the Selection Process until the toggle is turned on and saved. The tab also gives the default state `{}` (from `duplicateEventForm`) a pass as "set". | `FormIntegrationsTab.jsx:10-17`; migration `20260824`; `api.js:1835` |
| A-16 | Stale-state overwrite risk: `FormIntegrationsTab` initialises its state from `form.integrations` once and saves the **whole** object; `handleSaveQuestions` writes sections into the DB `integrations.form_sections` without refreshing `editingForm`. Saving integrations after editing sections in the same session can overwrite `form_sections` with the stale/absent value. | `FormEditor.jsx:272-291`; `FormIntegrationsTab.jsx:35-44`; `api.js:2924-2945` |
| A-17 | `submitToForm` always returns success: a failed `form_responses` insert (RLS, `event_id` NOT NULL, network) is only logged, and the visitor sees "Submitted successfully". With route `/forms/:formId` (no `eventId`) `eventId` is `undefined` → the insert would violate `event_id NOT NULL`, and the async integrations would run with `event_id: undefined`. | `api.js:1931-1935, 2024`; `App.jsx:436`; `GenericFormPortal.jsx:20` |
| A-18 | Integration copies use raw `formData`, the primary store uses sanitised phone numbers (`sanitizedAnswers`) → same submission holds two different phone representations. | `api.js:1884-1925` vs `:1951, 1969, 1976-2006` |
| A-19 | Selection integration inserts `additional_data = formData` keyed by `field_name` (`custom_*`), whereas the Selection UI heuristics (`getFounderDisplayName`, `getCompanyDisplayName`, detail modal labels) are written for sheet **header text**; for form-sourced rows the founder/company are derived mostly from the fallback `startup_name` (first answer value), and the detail modal prints raw `custom_…` keys instead of question labels. | `api.js:1957-1971`; `SelectionProcessManager.jsx:46-108, 1538-1551` |
| A-20 | Sheet re-sync overwrites `company_submissions.additional_data` with the fresh sheet row, discarding reviewer data kept in the same object (`tech_status`, `<status>_reason`, `origin_stage`). Status itself is preserved. | `api.js:2255-2271` vs `SelectionProcessManager.jsx:358-368` |
| A-21 | Sync matching reads `existing.email` (no such column in `company_submissions` types) and sheet-inserted rows have no `form_id`/`submitted_at`. | `api.js:2238-2240, 2255-2264` |
| A-22 | Join Athar share link goes through `?agenda=<id>&tabs=join-athar` (rewritten to `#/agenda/<id>?…`), i.e. the agenda viewer filtered to the join tab; the admin-copied "public link" is `#/view/<id>/join-athar`. Two different URLs for the same page. Presets replace only the first `{link}`. | `JoinAtharView.jsx:51-57`; `JoinAtharDashboard.jsx:193`; `App.jsx:99-116` |
| A-23 | `eventId` in the Selection screen can be a slug (the router does not normalise); `getSubmissions` filters `company_submissions.event_id = <that value>` and the edge functions look up `events.event_id` by it, so only UUID URLs work end-to-end (other screens use `getEvent` to resolve slugs, e.g. `getJoinAtharPage`, `getFormConfig`). | `SelectionProcessManager.jsx:111-114, 254-258`; `api.js:1279-1294` |
| A-24 | `CoverLibraryModal` opened from `FormEditor` list view has no `onSelectCover`; clicking any tile throws. Footer text about live cover updates is untrue (no update path). Deleting a cover sets `cover_id` NULL by FK but leaves `cover_image_url` populated on forms. | `FormEditor.jsx:676-680`; `CoverLibraryModal.jsx:180, 205, 255` |
| A-25 | `events` has no `title` column (it has `event_name`/`event_name_ar`) but library code selects `events.title` (`api.js:2794, 2821`) and renders `ev.title` in dropdowns (`FormLibraryManager.jsx:372, 949`). `getLibraryFormResponses`/`getLibraryAnalytics` ignore the resulting error, so projects appear as "Unknown/Unnamed Project" and the scope=`specific` selector shows blank names. (Based on `database.types.ts`; verify against the live DB.) | — |
| A-26 | `importFormFromLibrary(with_history)` **copies** every historical response row (keeping `library_form_id`), so the same logical response exists in several projects and is counted multiple times in library analytics; subsequent imports copy the copies as well. `updateLibraryForm` is called with the whole object (including `import_count`) from stale UI state and may overwrite counters. | `api.js:2729-2752, 2815-2863`; `FormLibraryManager.jsx:123` |
| A-27 | `duplicateEventForm` drops field `description` (copies `help_text` and `validation_rules` only), drops `field_label_ar` (never stored anyway), resets `is_active = true`, does not copy `library_form_id`; the clone shares section ids with the original via the copied `integrations` JSON. | `api.js:1802-1873` |
| A-28 | `saveFormConfigById` and `saveFormConfig` replace field sets with **DELETE then INSERT** (no transaction): a failed insert after the delete leaves a form with no questions; `config_id`s change on every save. | `api.js:1585-1643, 1160-1214` |
| A-29 | CSV export produces invalid CSV for object/array values (inner quotes not escaped); it exports only `filteredResponses` though the button is disabled/enabled by `filteredResponses.length` and the guard checks `responses.length`. | `FormResponsesTab.jsx:93-125` |
| A-30 | `bulk` e-mail sends: toast type `'warning'` is passed (`:574`) but the toast renders only `success` vs "else = error" styling (`:1683`); the bulk path re-sends to everyone in the stage every time; `bulkConfirmModal` wording says "startups". | `SelectionProcessManager.jsx:526-582, 1683` |
| A-31 | Email template defaults conflict: the Selection UI default **subject** contains HTML and `{{booking_link}}`, `{{project_manager_name}}` (`:265`), but the edge function substitutes only `company_name/founder_name/first_name` in subjects, and the UI help text lists `{{company_name}} {{founder_name}} {{project_manager_name}} {{booking_link}}` but not `{{first_name}}` that the defaults use. Edge-function fallback bodies are plain text with `{{founder_name}}`; UI defaults are HTML with `{{first_name}}`. `project_manager_name` is a constant `'Athar Team'`. | `SelectionProcessManager.jsx:265-278, 859, 1104, 1221`; `send-interview-invitations/index.ts:177-196` |
| A-32 | `reviewed_at` is set to `now` for `approved|rejected` and to `NULL` for every other status, so moving a rejected item back to screening erases the review date; the column `reviewed_by`/`rejection_reason` are never written by this screen (reasons go into `additional_data`). | `api.js:2305-2318` |

### 9.3 Dead code / unreachable / unused

| # | Finding | Where |
|---|---|---|
| A-33 | `FormEditor`: unused `isCoreField`, `getIconForType`; lucide imports `GripVertical` and `AlertCircle` never used, and `Upload, FileText, Mail, Hash, Phone, Globe` referenced only by the dead `getIconForType`; `fieldsLoading` is set but never read for display; `MODULE_META.company/expert` only serve legacy data. | `FormEditor.jsx:1-72` |
| A-34 | `FormResponsesTab`: `selectedStatus`, `handleStatusChange`. `FormLibraryManager`: `moduleFilter` (no setter UI), imports that appear only in the import list (`Edit3, Download, ChevronDown, History, BookmarkPlus, Sparkles, ArrowLeft, AlertCircle, FileSpreadsheet`, and `Filter` only in a comment). `QuestionsBuilder`: unused icons. `SelectionProcessManager`: `_error`, `_event`, `columns`. | see above |
| A-35 | API exports unused by any component: `updateFormCover`, `deleteFormSection`, `getLibraryFormById` (internal only), `updateFormResponseStatus` (imported, unused). `DynamicFormBuilder.renderHelp()` stub. `field_label_ar`/`help_text_ar`/`placeholder_ar` read by the renderer but never produced by the builder. | `api.js`; `DynamicFormBuilder.jsx:124` |
| A-36 | `canvas_background_url` / `canvas_overlay_position` exist in Join Athar schema/API but have no UI and are reset on each save; `byCard` analytics are computed (`api.js:3171-3173`) but never displayed. Card ids change at every save (delete-all + insert), and `join_athar_analytics.card_id` is `ON DELETE SET NULL`, so per-card history detaches after every save. | `api.js:3084-3108, 3145-3191` |
| A-37 | Share metadata `share_description` / `share_image_url` are persisted but not consumed; OG tags are only produced for events by the `share` edge function. | `FormSettingsTab.jsx:32-36`; `supabase/functions/share/index.ts` |
| A-38 | Status `displayed` ("Display Publicly") is set by the Selection screen but nothing in `src` reads it (no viewer filters on it; no SQL mentions it). | `SelectionProcessManager.jsx:1428, 1581` |

### 9.4 Inconsistencies (naming, routing, UI)

| # | Finding |
|---|---|
| A-39 | Singular/plural route duplication (`/event/…` and `/events/…`) for every admin route; components link to either (`JoinAtharDashboard` → `/event/:id`, `FormEditor` → `/events/:id`, `SelectionProcessManager` → `/event/:id`). |
| A-40 | `eventId` param read as `params.eventId || params.id` in some components (`FormEditor`, `GenericFormPortal`, `JoinAtharDashboard`) but only `useParams().eventId` in others (`JoinAtharView`, `SelectionProcessManager`). |
| A-41 | `join_athar_pages.project_id` is `TEXT` while every other table uses `UUID event_id`; the API resolves slugs to UUIDs before reads/writes but nothing enforces it. |
| A-42 | Language per screen: English (FormEditor + tabs), Arabic (library screens, ChipsOptionInput, PhoneValidationConfig), mixed (QuestionsBuilder labels, toasts with Arabic inside English screens), validation messages follow label script, thank-you/closed screens follow *form name* script. No i18n layer is used here (`translations.js` only has `joinAthar` nav labels). |
| A-43 | Two `Google` access models: inbound Selection sync requires a publicly shared sheet fetched without credentials; outbound form append requires a service account row in `google_settings`; plus a separate `events.gsheets_url` column (agenda import) and `events.selection_process_gsheets_url`. |
| A-44 | Cache invalidation: `api.js:46-59` monkey-patches `supabase.from` to clear the whole in-memory cache on any `insert/update/delete/upsert`; all form reads in this area are uncached (not wrapped in `withCache`), except `getEvent`/`getEvents` used here. |
| A-45 | `FormSettingsTab` default texts are written into state and saved even if untouched (thank-you message, share description) — an unedited form gets those strings persisted on the first Settings save. |

### 9.5 Security-relevant observations (as-is, not remediation)

| # | Finding | Evidence |
|---|---|---|
| S-1 | A Google service-account JSON (private key) is stored in `google_settings.service_account_key`, which has a public (`USING (true)`) SELECT policy, and is **read and used to sign a JWT in the browser** on every public submission that has Sheets integration enabled. | `googleSheets.js:91-137`; migration `20260716000002` |
| S-2 | `form_responses`, `form_covers`, `form_sections`, `library_forms`, `join_athar_*` have `FOR ALL USING (true)` or equivalent public policies: any anonymous client can read, update or delete responses (which contain personal data) and edit/delete templates. | migrations `20260824`, `0906`, `0907`, `0908/0909`, `0911` |
| S-3 | The public portal fetches the whole `event_forms` row (`select('*, form_covers(*)')`), which includes `integrations` (e.g. the target Google Sheet URL). | `api.js:1648-1656` |
| S-4 | Public file upload to the `event-assets` bucket (`portal-uploads/`) from the portal; no size/type check beyond the `accept` attribute. | `GenericFormPortal.jsx:270-272`; `api.js:871-895` |
| S-5 | Responses to Sheets use `valueInputOption=USER_ENTERED`, so answer text beginning with `=` is interpreted as a formula by Sheets. | `googleSheets.js:210` |
| S-6 | No bot/duplicate protection on submit (no captcha, honeypot, rate limit, uniqueness by e-mail); `is_active` is enforced client-side. | `GenericFormPortal.jsx` |
| S-7 | E-mail edge functions accept `{eventId, submissionIds}` with CORS `*`, use the service-role key, do not verify event ownership or caller role in code; `verify_jwt` configuration is not in the repo. | `send-*/index.ts` |

---


---

<!-- source: 05-frontend-booking-and-mentoring.md -->
**Source document: [05-frontend-booking-and-mentoring.md](05-frontend-booking-and-mentoring.md)**

## 05-frontend-booking-and-mentoring.md — 9. Duplications, Conflicts & Anomalies (as-is)

IDs: **DUP** duplication, **CON** contradiction between parts, **BUG** behaviour that appears unintended, **DEAD** unused code, **SEC** security-relevant observation, **INC** inconsistency.

### 9.1 Duplicated logic between Systems A and B (copy-paste)

| # | What | A location | B location |
|---|---|---|---|
| DUP-1 | `ADVANCE_NOTICE_OPTIONS` (identical 8 entries) | `mentorBooking.js:123-132` | `atherTeamBooking.js:72-81` |
| DUP-2 | `isSlotWithinNoticeWindow` | `mentorBooking.js:138-143` | `atherTeamBooking.js:87-92` |
| DUP-3 | Available-slot query + client notice filter | `mentorBooking.js:165-188` | `atherTeamBooking.js:110-133` |
| DUP-4 | Booking creation (check, insert, mark unavailable, notify with 3 retries) | `mentorBooking.js:238-307` | `atherTeamBooking.js:183-276` |
| DUP-5 | Booking deletion that frees slot | `mentorBooking.js:309-331` | `atherTeamBooking.js:278-300` |
| DUP-6 | Slot-series creation (`handleCreateSlot`) | `MentorBookingAdmin.jsx:299-349` | `AtherTeamBookingAdmin.jsx:147-196` |
| DUP-7 | `generateMeetLink` (edge call + alerts) | `MentorBookingAdmin.jsx:90-127` | `AtherTeamBookingAdmin.jsx:49-86` (only `summary` text differs) |
| DUP-8 | Slots table, edit row, bulk delete, tabs, modals | `MentorBookingAdmin.jsx:662-867` | `AtherTeamBookingAdmin.jsx:489-693` |
| DUP-9 | Public booking page (grouping by date, form, success) | `MentorBookingPage.jsx` | `AtherTeamBookingPage.jsx` (differences: texts, Drive photo helper, `ather_team_member_id`) |
| DUP-10 | `getEvent` (different select lists) | `mentorBooking.js:5-13` | `atherTeamBooking.js:5-13` |
| DUP-11 | Default `1440` notice minutes repeated as a literal | `mentorBooking.js:138,141,184,250`; `MentorBookingAdmin.jsx:550,611,808` | `atherTeamBooking.js:87,90,129,206`; `AtherTeamBookingAdmin.jsx:35,385,441,634,796` |
| DUP-12 | Default slot form values `30 / 5 / 1` | `MentorBookingAdmin.jsx:65-73,334-342,679-687` | `AtherTeamBookingAdmin.jsx:36-44,182-190,506-513` |

### 9.2 Duplicated time / slot math

| # | What | Locations |
|---|---|---|
| DUP-13 | `HH:MM` parse + format helpers | `mentorBooking.js:401-413`; `mentoringDistribution.js:250-274` (`calculateSlotTime`, local `fmt`), `:643-671` (`calculateDaySlotTimes`, another local `fmt`, line 661) |
| DUP-14 | Two exported functions named `calculateDaySlotTimes` with different signatures and return types | `mentorBooking.js:422` (takes `session_start_time/session_end_time`, returns `{slotTimes, slotsCount, totalMinutes, totalHours}` or `[]`) vs `mentoringDistribution.js:643` (takes effective config with `slots_per_day`, returns array) |
| DUP-15 | 12-hour formatter in three places | `MentoringDistributionAdmin.jsx:590-596` (`timeTo12Hour`), `MentoringMatrixView.jsx:30-36` (`timeTo12Hour`), `MentoringLiveView.jsx:768-774` (`format12`) |
| DUP-16 | "Current slot from wall clock" implemented three times | `mentoringDistribution.js:495-520` (`getCurrentSlotIndex`, unused), `MentoringLiveView.jsx:271-284`, `MentoringMatrixView.jsx:118-131` (the two component copies are identical) |
| DUP-17 | Seconds-until-slot-end | `mentoringDistribution.js:525-542` (unused) vs inline in `MentoringLiveView.jsx:305-318` and `MentoringMatrixView.jsx:164-176` |
| DUP-18 | Per-day availability resolution (global `mentor_availability` + `mentor_ids`) | `MentoringLiveView.jsx:326-341`, `MentoringMatrixView.jsx:86-101`, `mentoringDistribution.js:715-719` and `858-862`; plus `isMentorAvailableOnDay` (170-188) |
| DUP-19 | The core matching loop pasted three times (candidate filter, conflict-reason text, sort, tracker updates) | `mentoringDistribution.js:286-400`, `678-795`, `801-979` |
| DUP-20 | Day/Matrix/Live "load data" blocks (config, sessions, experts, day configs, event days) with identical try/catch IIFEs | `MentoringLiveView.jsx:131-182`, `MentoringMatrixView.jsx:38-65`, `MentoringDistributionAdmin.jsx:137-238` |
| DUP-21 | Timer control bars (-1m, +1m, pause, reset, mute) | `MentoringDistributionAdmin.jsx:1717-1758`, `MentoringMatrixView.jsx:354-396`, `MentoringLiveView.jsx:62-106` |
| DUP-22 | Time/slot concepts appear in three data models: `mentor_day_config`, `mentoring_distribution_day_config`, and `mentoring_distribution_config.break_slots` | migrations `20260806000000`, `20260806000100`, `20260725000001` |
| DUP-23 | Two Google Apps Script copies | `google-apps-script/Code.gs`, `api-agennda-intervew.gs` (450 vs 477 lines) |
| DUP-24 | Calendar-event creation implemented in four places (two edge functions, two GAS files) | `process-booking/index.ts:112-187`, `generate-google-meet/index.ts:136-191`, `Code.gs:112-252`, `api-agennda-intervew.gs:112-283` |

Timezone handling duplication / divergence (relevant to DUP-13..17): see CON-9 to CON-11.

Excel export: none of the seven components or four libs in this scope exports Excel/CSV (grep for `xlsx|excel|export` yields only component names). The only "export" is `window.print()` in `MentoringMatrixView.jsx:276`.

### 9.3 Contradictions between systems / parts

| # | Contradiction | Evidence |
|---|---|---|
| CON-1 | Slot timestamps built two different ways. UI path: `new Date('YYYY-MM-DD')` (UTC midnight) then local `setHours`; library engine: `new Date(date + 'T00:00:00')` (local midnight). Same wall-clock input can resolve to different instants outside UTC+0..+N. | `MentorBookingAdmin.jsx:307-308`, `AtherTeamBookingAdmin.jsx:155-156` vs `mentorBooking.js:415-420` |
| CON-2 | "Generate" Meet link vs automatic Meet link: the admin can pre-generate a link and store it in `meet_link` of one or many slots, but in `unique` mode `process-booking` creates a *new* Meet for each booking and overwrites `slot.meet_link` (lines 363-400); in `shared` mode it uses `events.shared_google_meet_link` and also overwrites the slot's link. The pre-generated link is therefore not used by the booking flow, and each Generate click leaves an orphan event in the calendar. | `MentorBookingAdmin.jsx:98-106,1327-1354`; `process-booking/index.ts:363-400`; `generate-google-meet/index.ts:148-191` |
| CON-3 | Calendar time zone differs by function: `Africa/Cairo` in `process-booking` (lines 126-133), `UTC` in `generate-google-meet` (150-157); both pass ISO strings from timestamptz. | idem |
| CON-4 | Alert threshold: hook uses 7 s (`useMentoringTimer.js:4`), live view declares `ALERT_SECONDS_THRESHOLD = 10` (`MentoringLiveView.jsx:114`, unused) and its on-screen text says "last 7 seconds" (line 58); the chat history records a request for 10 s. | files named |
| CON-5 | `break_slots` (global breaks "after slot N") is editable (Break Slots card, `Admin.jsx:1611-1670`) and persisted, but the generators actually used (`generateDistributionFlexible`, `...WithFinalizedDays`), the matrix and the live view ignore it; only the unused `generateDistribution`, `calculateSlotTime`, `getCurrentSlotIndex`, `getSecondsUntilSlotEnd` read it. The per-day "Gap (Min)" (`break_between_slots_minutes`) is the only break that affects the schedule. | `mentoringDistribution.js:250-260, 495-520, 525-542` |
| CON-6 | Per-mentor custom start/end/`max_slots` (Participants tab) is honoured only by "Regenerate unfinalized" (`isMentorAvailableInSlot`, line 878) and **not** by the main "Generate" (`generateDistributionFlexible`), so the same settings produce different timetables depending on the button. | `mentoringDistribution.js:729-735` vs `876-906` |
| CON-7 | Full "Generate" wipes every day, including finalized (locked) days (`clearDistributionSessions`, `Admin.jsx:567`) although the UI promises locking; the confirmation dialog only warns in text (541-553). | idem |
| CON-8 | "End Time (override)" field has no effect in the default flow: `getDayConfigOrDefault` pre-fills `total_round_minutes` with the global value (`Admin.jsx:606`) and `resolveDayEffectiveConfig` only derives the total from `session_end_time` when `total_round_minutes` is falsy (`mentoringDistribution.js:612`). | files named |
| CON-9 | Number of slots ignores the gap: `slots_per_day = floor(total/duration)` (line 620) but slots are then laid out with `+ break_between_slots_minutes` (667), so a day with gaps ends later than `start + total_round_minutes` (e.g. 300/20 = 15 slots with 5 min gaps -> 70 min longer). The admin's capacity preview and the viewers use the same functions, so they agree with each other but not with the "Total Round" label. | `mentoringDistribution.js:620, 667` |
| CON-10 | "Today" detection in Live View uses UTC date (`toISOString().slice(0,10)`) while slot detection uses the viewer's local clock (`getHours()`); around local midnight in UTC+2/+3 the two refer to different dates. | `MentoringLiveView.jsx:209,225,366` vs `273-275` |
| CON-11 | Slot editors in A/B show UTC wall time while list rows show browser-local time: the edit input is `value={start_time.slice(0,16)}` on an ISO string (UTC), the row text is `toLocaleString()`. | `MentorBookingAdmin.jsx:735,740`, `AtherTeamBookingAdmin.jsx:561,566` |
| CON-12 | Who gets e-mailed: the Mentor Settings tab promises templated notifications ("isolated notification system", variables `{{company_name}}`...) but the only invoked path (`process-booking`) sends Google Calendar invitations, ignoring the template; the SMTP function that could use admin e-mail lists (`send-booking-notifications`) is never called and ignores the template too. | `MentorBookingAdmin.jsx:932-938,1046-1071` |
| CON-13 | `{{booking_link}}` in interview invitations resolves to `/#/event/<eventId>/ather-team-booking` (the **admin** route behind `RoleGuard`), whereas the public booking page is `/#/ather-team-book/:memberId`. | `send-interview-invitations/index.ts:180` vs `App.jsx:456-461` |
| CON-14 | Mentor identity differs per system: `mentors.master_id text` (A), `ather_team_members` (B), `experts.expert_id` string (C) - while `mentoring_sessions.mentor_id` and `company_id` are `uuid` and the migration comment calls `mentor_id` an FK to `mentors` (`20260725000001:25-26`). IDs of `experts`/`companies` are typed `string` in `database.types.ts`. |
| CON-15 | `event_id` type: `TEXT` in all booking and config tables, `UUID` in `mentoring_distribution_day_config` (`20260806000100:7`). |
| CON-16 | Photos: A uses `master_experts.photo_url` fallback and `getGoogleDriveFallbackUrls` + `LazyImage urls=[]`; B uses raw `photo_url` with `LazyImage`; C uses plain `<img>` with `getGoogleDriveFallbackUrls(...)[0]` (no multi-URL fallback) and in the matrix view **does not join `master_experts`** at all, so names/photos stored only in `master` are blank there (`MentoringMatrixView.jsx:49` vs `MentoringDistributionAdmin.jsx:211-224` and `MentoringLiveView.jsx:143-157`). |
| CON-17 | Published state is enforced only in UI: Live View shows data when no config row exists (`config && !config.is_published`, line 385) while Matrix View shows "not configured" in that case (line 200); both fetch data with the anonymous client regardless. |
| CON-18 | `isMentorAvailableOnDay` default branch returns `true` for unknown shapes (line 187), but the Participants UI treats a string other than `'all'`, `'excluded'`, `'none'`, `'day_N'` as not covered (`Admin.jsx:481-485`). Minor, but the two normalisers (`handleToggleMentorDay` 471-502 and `handleMentorCustomTimingChange` 455-469) differ: one returns `'all'`/`'excluded'` strings, the other converts to `{available_days}` objects and `'excluded'` -> `available_days: []`. |

### 9.4 Bugs / defects found while reading

| # | Defect | Evidence |
|---|---|---|
| BUG-1 | Publish/unpublish resets other config columns. `publishDistribution` -> `saveDistributionConfig(eventId,{is_published})`; the upsert always writes `unique_pairing: true`, `mentor_availability: {}`, `finalized_days: []`, `timer_state: null` when those keys are absent. In the DB, toggling Published wipes mentor availability and finalized days and resets unique pairing; the admin's local state still shows old values until reload. | `mentoringDistribution.js:39-56,156-158`; `Admin.jsx:699-707` |
| BUG-2 | `validateSessionMove` is called with positional arguments `(sessions, sourceSession, targetDay, targetSlot, targetMentorId, uniquePairing)` but is defined to take a single destructured object. All fields are `undefined`, `movingCompanyId` is falsy, so it always returns `{valid:true}` - move validation never fires. Also `targetMentor` is expected as an object but an id is passed. | `Admin.jsx:356-363` vs `mentoringDistribution.js:984-1036` |
| BUG-3 | After generation, `setSessions(newSessions)` stores sessions without database ids (the INSERT result of `saveDistributionSessions` is not used). Subsequent drag/swap only calls `updateSession` `if (sourceSession.id)` / `if (targetSession.id)` yet updates local state unconditionally, so edits made before a reload look saved but are not persisted. | `Admin.jsx:331,567-570,386-399,412-420` |
| BUG-4 | Number-of-days preset buttons call `setConfig(p => ({...p, num_days: p.value}))` where the updater parameter `p` shadows the preset `p`; `p.value` is `config.value` (undefined). Only the numeric input works. | `Admin.jsx:1056-1061` |
| BUG-5 | `calculateDaySlotTimes` in `mentorBooking.js` returns `[]` for invalid input (line 429) but an object otherwise; `generateMentorSlotsForDay` destructures `{slotTimes}` and then reads `slotTimes.length`, which throws `TypeError` instead of the intended message (line 515-518). (Dead code, see DEAD-1.) | `mentorBooking.js:422-451,514-518` |
| BUG-6 | `detectMentorSlotConflicts` sets `has_booking: !!existing.bookings || !existing.is_available ? true : false` (operator precedence makes the ternary apply to the whole `||`). `bookings` is never selected by `getSlots`. | `mentorBooking.js:506` |
| BUG-7 | "Generate" then silent success: booking is committed and slot is marked unavailable even if the calendar/Meet step fails; retries happen only when the *invoke* throws, not when `{success:false}` is returned, and the UI always shows "Booking Confirmed". The booking row stays `status='pending'` with no `meet_link`; only the legacy Apps Script poller (if still deployed) would pick it up. A retry after a partial failure inside the function (event created, DB update failed) creates another calendar event. | `mentorBooking.js:272-304`, `atherTeamBooking.js:236-273`, `process-booking/index.ts:354-400` |
| BUG-8 | Race condition / double booking is possible (see 2.6); additionally the admin can set `is_available = true` on a booked slot (edit row checkbox) producing a second booking for the same slot. | `MentorBookingAdmin.jsx:801-806`, schema |
| BUG-9 | Deleting a slot, a mentor, or a team member cascades to bookings (`ON DELETE CASCADE`) without confirmation text about bookings; booking cancel does not cancel the Google event or notify anyone. | migrations `20260707000000:15,27-28`, `20260709000001:21,33-34`; `deleteBooking` |
| BUG-10 | `useMentoringTimer.togglePause` broadcasts from inside a `setState` updater (side effect inside a pure function; double-invoked in React StrictMode). | `useMentoringTimer.js:142-148` |
| BUG-11 | `isMaster` parameter of the timer hook is accepted but never used; `slotIndex` is fixed at `0` in the admin hook call (`Admin.jsx:254-259`). | `useMentoringTimer.js:11` |
| BUG-12 | New team member form reset omits `advance_notice_minutes`; "Add Slot" button resets `newSlot` without `meet_link` (controlled/uncontrolled input switch). | `AtherTeamBookingAdmin.jsx:118, 505-513` |
| BUG-13 | Generation uses `dayConfigs` from saved state; per-day edits that are unsaved (`dayEdits`, `configDirtyByDay`) and `selectedMentorsByDay` changes are silently ignored by "Generate". "Apply to All" only stages edits and replaces `configDirtyByDay` with a new object (previous dirty flags are dropped). | `Admin.jsx:560-565, 628-647` |
| BUG-14 | `handleRemoveMentor` in the distribution page deletes the row from the **event-wide `experts` list**, not from the distribution (`Admin.jsx:504-527`), and does not delete that mentor's sessions. | |
| BUG-15 | Distribution matrix (admin tab) draws `activeMatrixSlotTimes` rows but `buildMatrix(... slotsPerDay ...)` computed at line 726-728 uses the *global* slots-per-day and is never used by JSX (`matrix` is dead). Matrix View passes the active day's slot count for *all* days (`MentoringMatrixView.jsx:110-113`), so cells of other days beyond that count are dropped (only the active day is rendered, so effect is hidden). | |
| BUG-16 | Slot-level `max_slots` check counts only assigned sessions (`mentorSlotsAssignedToday`), not free slots; skipped slots are emitted as warnings so the matrix shows "Free Slot" after the quota. Unique pairing limit text is attributed even if unrelated reasons apply. | `mentoringDistribution.js:866-868,968` |

### 9.5 Dead code / unused exports

| # | Item | Evidence |
|---|---|---|
| DEAD-1 | Entire mentor-booking day-config engine (`getMentorDayConfigs`, `saveMentorDayConfig`, `deleteMentorDayConfig`, `bulkCreateMentorSlots`, `bulkDeleteMentorSlots`, `calculateDaySlotTimes`, `buildMentorSlotsPayload`, `detectMentorSlotConflicts`, `generateMentorSlotsForDay`) and table `mentor_day_config` | `mentorBooking.js:333-571` |
| DEAD-2 | `generateDistribution`, `calculateSlotTime`, `getCurrentSlotIndex`, `getSecondsUntilSlotEnd`, `isMentorAvailableInSlot` import in admin, `DEFAULT_PER_DAY_CONFIG` import; `_hasOverride` field | `mentoringDistribution.js:250,286,495,525,548,630`; `Admin.jsx:19,24,26,35` |
| DEAD-3 | `isWithin24Hours` in `MentorBookingAdmin.jsx:423-430` (never called; its role was taken by `isSlotWithinNoticeWindow`); `AtherTeamBookingAdmin.jsx:1-3` imports `useMemo`, `Search`, `Loader2`, `Briefcase`, `Database`, `AlertTriangle`, `Settings` that the component does not use; its `event` state (lines 28, 106) is set but never read | |
| DEAD-4 | `genResultByDay` state set only to `null` (`Admin.jsx:663`); its success/error banner can never render | `Admin.jsx:123,1573-1601` |
| DEAD-5 | `timer_state` column + code that loads/saves it | `mentoringDistribution.js:32,48`; `Admin.jsx:94,153` |
| DEAD-6 | `send-booking-notifications`, `notify-google-apps-script`, both `.gs` files (see 5.3); `mentor_email_template_*` columns | |
| DEAD-7 | `notifyGoogleAppsScript` name no longer matches behaviour (calls `process-booking`); error text still says Google Apps Script (`api.js:17,23`, `mentorBooking.js:274-303`) | |
| DEAD-8 | `ather_team_bookings.submission_id` never populated; `getEvent()` call at `atherTeamBooking.js:237` result discarded | |
| DEAD-9 | `docs`: guide `دليل-إعداد-Google-Apps-Script.md` tells the operator to edit `const webAppUrl` in `atherTeamBooking.js` / `mentorBooking.js`; no such constant exists now | |

### 9.6 Security-relevant observations (descriptive)

| # | Observation | Evidence |
|---|---|---|
| SEC-1 | Public `SELECT` on slots returns `*` including `meet_link` and joined `mentors(*)` (email, bio); the public pages display the mentor's e-mail. | `mentorBooking.js:165-188`; `MentorBookingPage.jsx:141`; `AtherTeamBookingPage.jsx:139`; RLS `USING (true)` |
| SEC-2 | `google_settings` (column `service_account_key`) has RLS policies allowing public SELECT, INSERT and UPDATE. | `20260716000002_add_google_settings_table.sql:15-27` |
| SEC-3 | A Google service-account JSON (including a private key) is present in plain text inside a historical chat log in the repo root (`مشكلة روابط جوجل ميت لا تعمل.md`, near the end of the file). Value deliberately not reproduced here. | |
| SEC-4 | The Apps Script files embed a Supabase publishable key and the project URL in their headers (lines 4-5 of `Code.gs` and `api-agennda-intervew.gs`); `notify-google-apps-script/index.ts:4` embeds a script web-app URL. | |
| SEC-5 | `mentoring_distribution_config`, `mentoring_sessions`, `mentoring_distribution_day_config`, `mentor_day_config` have `FOR ALL USING (true) WITH CHECK (true)` policies - anyone with the anon key can read/write them. The Realtime timer channel is unauthenticated, and the public pages include write controls (4.7). | migrations `20260725000001:45-49`, `20260806000000:25-26`, `20260806000100:26-27` |
| SEC-6 | `process-booking` accepts any `booking_id` from any caller (CORS `*`, service-role client inside); history states `generate-google-meet` was deployed without JWT verification, allowing anonymous creation of calendar events. | `process-booking/index.ts:6-10,205-208` |
| SEC-7 | `localStorage` key `mentorBookingEmails` stores mentor booking e-mails per admin browser (`MentorBookingAdmin.jsx:26-42`). | |

### 9.7 Other inconsistencies

- INC-1 Mixed language: Arabic strings inside admin and live pages (e.g. `Admin.jsx:806,817,1289-1292,1696-1700`, `MentoringLiveView.jsx:52,80-86`, `MentoringMatrixView.jsx:337`, `MentorBookingPage.jsx:200`) while the history log records a request to make Live View fully English.
- INC-2 Terminology: "booker_email", "mentor_name/mentor_email" in Ather tables; "startup", "company", "founder" used interchangeably; "slot" in A/B is a row, in C a column index.
- INC-3 Naming: `notifyGoogleAppsScript` (api.js) vs edge function `process-booking`; file `api-agennda-intervew.gs` (typo) in repo root; the Arabic file `مشكلة تعدي المينتوردينج ديستريبيوشن.md` has an H1 of another log ("حل مشكلة تحميل الصورة").
- INC-4 Admin pages use inline styles `font-manrope`/hex colours (`#1a27c9`, `#0d0e0e`) in A/B, theme tokens (`athar-blue`, `bg-card`) in C.
- INC-5 Confirm dialogs use `window.confirm`/`alert` in all three; toasts exist only in Mentor Settings (`MentorBookingAdmin.jsx:85-88`).
- INC-6 Migration history does not match code: columns `mentors.photo_url`, `mentors.advance_notice_minutes`, `ather_team_members.advance_notice_minutes`, tables `experts`, `companies`, `master_experts`, `event_days`, `smtp_settings` have no migration in `supabase/migrations`.
- INC-7 Booking pages allow the same company/e-mail to book unlimited slots with the same mentor; nothing links `booker_email` to a registered startup, `company_name` is free text.
- INC-8 Search/ordering: slots tab lists all slots of the event unpaginated; bookings list shows `mentor_slots.start_time` (joined) whereas the booking row also stores its own `start_time` copy.
- INC-9 `mentor_slots.is_available` is the only source of truth for "booked"; booking rows duplicate `start_time/end_time/mentor_name/mentor_email` (denormalised copies) so editing a slot's time later does not update the booking or the calendar event.

---


---

<!-- source: 06-frontend-alumni-platform-and-roles.md -->
**Source document: [06-frontend-alumni-platform-and-roles.md](06-frontend-alumni-platform-and-roles.md)**

## 06-frontend-alumni-platform-and-roles.md — 12. Duplications, Conflicts & Anomalies (as-is)

### 12.1 Broken or mismatched calls

| # | Location | What happens |
|---|---|---|
| 1 | `FounderDashboard.jsx:134-150` vs `api.js:4252` | UI calls `updateFounderCompanyWithSnapshot({companyId, founderId, name, name_ar, province, employees_count, annual_revenue, snapshotData})` (one object) while the function signature is `(companyId, updatedFields, source)`. The object becomes `companyId`, `updatedFields` is `undefined` -> `.eq('company_id', <object>)` / `.update(undefined)`; the feature "Update Metrics" cannot work as written. The prepared `snapshotData` is never used. |
| 2 | `FounderDashboard.jsx:174-191` vs `api.js:4293` | UI passes `{founderId, companyData, initialSnapshot}`; function ignores `initialSnapshot` and creates the snapshot from the new company row. Company is created with `sector`, `stage:'Early Traction'`, `is_alumni:true`. |
| 3 | `FounderDashboard.jsx:73-79,338-341` | `latestSnap` reads `company.company_snapshots`, but `getFounderProfileByAuth` embeds `company_founders(*, companies(*))` without snapshots -> "Latest snapshot" box and Team/Revenue stats are always empty. |
| 4 | `FounderDashboard.jsx:109-117` | Pre-fills columns that do not exist on `companies` (`employees_count`, `revenue_sar`, `annual_revenue`, `net_profit_sar`, `challenges`, `new_products`) - `database.types.ts:453-484` has `employees` (text) and no financial columns. |
| 5 | `FounderProfilePage.jsx:459-462` vs `getCompanyFounders` | expects flat founder fields; function returns `{..., founders: {...}}`. |
| 6 | `FounderProfilePage.jsx:110-118` | `jobTitle` input never saved. |
| 7 | `CertificateGenerator.jsx:24` vs `api.js:3412` | founder name join missing. |
| 8 | `FounderLayout.jsx:29-35` | unread badge never refreshed after mark-all-read (separate component instance state). |
| 9 | `FounderOpportunitiesPage.jsx:56-66` | external-link opportunities never create an application, "apply" ignores which company when a founder has several. |

### 12.2 Runtime errors (undeclared identifiers)

| # | Location | Identifier | Trigger |
|---|---|---|---|
| 1 | `AlumniDirectory.jsx:311,317` | `isRtl` (never declared in the component; `lang` is `const 'en'` at L15) | rendering the grid/list when `filteredCompanies.length > 0` -> `ReferenceError` (error boundary at `App.jsx:120`) |
| 2 | `AlumniDirectory.jsx:57-60` | `setSearchParams` undefined (`toggleLanguage`, never called - dead) | - |
| 3 | `AlumniAnalyticsPage.jsx:92` | `lang` undeclared in `clearAllFilters` | clicking "Reset Filters" |
| 4 | `ALUMNI_BUGFIX.md`/`HOOKS_FIX.md` | claim these classes of error were fixed | records partially fixed |

### 12.3 Schema mismatches (frontend vs `database.types.ts` / migrations)

| Frontend | DB |
|---|---|
| `OpportunitiesHub.handleCreate` inserts `provider`, `amount_sar`, `eligibility_criteria_ar`, `external_url` (`L72-86`) | `opportunities` has `eligibility`, `link`, `image_url`, no `provider`/`amount_sar`/`eligibility_criteria_ar`/`external_url` -> insert would be rejected by PostgREST (unknown columns) unless live DB differs |
| `FounderOpportunitiesPage` reads `opp.link`, `opp.eligibility` | matches DB (so hub-created data would never feed them) |
| Hub grid displays `opp.provider`, `opp.amount_sar` | columns absent |
| `CompanyProfilePage.handleInvestorRequest` inserts `investor_name, investor_entity, investor_email, investor_type, ticket_size_min_sar, notes` (`L151-159`) | `investor_requests` has `requester_name, requester_email, requester_org, request_type, message, company_id, status` (NOT NULL: `requester_name`, `requester_email`) -> insert fails. Form has no e-mail input (state `investor_email` unused). |
| `getInvestorRequests` selects `companies(name, logo_url, industry, stage)` | fine, but no UI uses it |
| `startup_name`, `startup_name_ar` used in 6 components (`CompanyProfilePage:195`, `AlumniDirectory`, `MEWorkspace`, `OpportunitiesHub`) | no such columns; Arabic company name is `name_ar` |
| `company.governorate`, `company.location`, `company.employees` fallbacks | columns exist (`governorate`, `location`, `employees`) alongside new `province` - three overlapping geography fields |
| `sector` vs `industry` | both exist on `companies`; manager dashboard/analytics/notifications use `sector`, Directory/Impact/MEWorkspace/CompanyProfile use `industry`; `getAlumniCompanies` filters `sector` filter on `industry` (`api.js:3588`); `getUniqueAlumniCompanies` checks both |
| Snapshot type `'6_month_followup'` (UI option) | seed uses `six_month`; docs `six_month` |
| Notification `recipient_id`, `sent_by` typed `UUID` -> `auth.users` | invitation `sent_by` receives a founder_id in co-founder invites (no FK on `alumni_invitations.sent_by`) |
| `company_founders.role` vs `role_in_company` | both exist; reads use `cf.role_in_company || cf.role`, writes vary |
| `founders.name_ar` is `NOT NULL`; `acceptInvitation` inserts `name_ar = name_en = fullName` | Arabic name field is filled with the entered (often English) name |
| `getAlumniManagerDashboardStats` counts `companies` (all) | vs `is_alumni` flag elsewhere |

### 12.4 Duplications

| Duplicate | Locations |
|---|---|
| Two guards for two route families | `RoleGuard.jsx`, `AlumniRouteGuard.jsx`; plus unused `ProtectedRoute.jsx` |
| `/verify-certificate/:code` registered twice | `App.jsx:198` and `:439` |
| Role-derivation helpers | `AuthContext` (`isAlumniManager` etc., unused) vs recomputation in `AlumniRouteGuard.jsx:22-25` and `RoleGuard.jsx:30,56-62` |
| `unregistered founders` / `manual founders` | `getUnregisteredFounders` + stats via `auth_user_id IS NULL`; and `getUniqueAlumniCompanies`/`getAlumniAdminStats` compute invitation status per company (unused) - two parallel "invitation status" models (per-invitation vs per-company `not_invited/invited/joined`) |
| Snapshot creation UI | `CompanyProfilePage` modal and `MEWorkspace` modal duplicate the same form/handler; `FounderDashboard` a third variant; `submitToForm` a fourth route |
| Impact computation | `getImpactStats` vs `getAlumniPlatformAnalytics` vs `getAlumniManagerDashboardStats`/`getAlumniManagerChartsData` (distinct filters, keys) |
| Founder lookup | every founder page + layout re-runs `getFounderProfileByAuth` (up to 2 identical network calls per page) |
| Invitation link builder | in `api.js:3741,3765`, `AlumniInvitationsPage.jsx:200,493`, `FounderProfilePage` (via API) |
| Role cache read | `AuthContext.parseCachedRoles` and `getUserRoles` both parse the same storage key with different shape tolerance |
| Opportunities browsing | `OpportunitiesHub` (manager; also lets managers apply) vs `FounderOpportunitiesPage` (type configs duplicated, different type lists) |
| `ROLE_LABELS` | defined in `UserNavDropdown.jsx`, imported by `UserProfile.jsx`, not by alumni layouts which hard-code labels |
| Manager layout vs main `Dashboard` header | both show brand + user controls; alumni portals do not reuse `UserNavDropdown` |
| `Dashboard.jsx.bak` | backup copy in `src/components` |

### 12.5 Data-key / business-logic inconsistencies

* **Revenue / jobs keys**: snapshots written by UI use `revenue_sar`, `employees_count`, `jobs_created`, `funding_raised_sar`, `is_active`; `getImpactStats` reads those; `getAlumniPlatformAnalytics` reads `revenue`/`annual_revenue`, `employees`/`team_size`/`jobs_created`, `status === 'closed'` (`api.js:4874-4894`) and Excel export uses `revenue`, `employees` (`AlumniAnalyticsPage.jsx:115-116`). Net: analytics revenue = 0 for UI-created snapshots; jobs partially (`jobs_created` fallback only).
* **Currency**: SAR in CompanyProfile/Impact/MEWorkspace/Hub; `$` in `FounderDashboard` (labels and values `L395,542,556`); "IQD/USD" in analytics export header; founder UI defaults location to "Iraq/العراق" (`FounderDashboard.jsx:373`) while seed and placeholders use Saudi data (`+966`, "Saudi" companies in `ALUMNI_PLATFORM.md`).
* **Survival rate**: `getImpactStats.survivalRate` = share of alumni with latest snapshot `is_active !== false` (including companies with *no* snapshot being counted only in denominator); analytics uses `program_participations.graduation_date` which is **not a column** in `program_participations` (`end_date` exists; `graduation_date` absent from migration and from the select) -> eligible counts are always 0 -> the displayed 6/12/24-month values are the **hard-coded fallbacks 94 / 86 / 74** whenever any company matches (`api.js:4932-4936`). `activeCount: activeCount || totalCompanies` (`L4948`) also masks zero.
* Analytics `isActive` for survival uses only `c.status !== 'inactive'`, ignoring snapshot `is_active`.
* `getAlumniPlatformAnalytics` mutates embedded arrays with `.sort` in place and runs for **all** companies (not only alumni).
* `getAlumniManagerChartsData` "registration trends" count `founders.created_at`, including manually imported founders, not registrations.
* `getUserRoles` cached 60 s, AuthContext timeout 9 s: a revoked role persists in `localStorage` indefinitely (until sign-out) because empty server results do not overwrite a non-empty cache (`AuthContext.jsx:78`).
* `acceptInvitation` runs sequential writes with no transaction; failure after `signUp` leaves an auth user without founder linkage; `authError` containing "already registered" is swallowed and `authUserId` becomes `null`, linking the founder with `auth_user_id` unchanged.
* `getFounderProfileByAuth` auto-writes `founders.auth_user_id` when a logged-in user's e-mail matches a founder row (`api.js:4009-4014`) - any authenticated account with the same e-mail inherits that founder identity.
* `sendBulkAlumniInvitations` inserts without duplicate checks; one pending invitation per (company, e-mail) is only enforced in `inviteCoFounder`.
* Pagination in invitations list uses `created_at` ordering while UI shows `sent_at`.
* `getAlumniManagerNotificationsLog` limit 300 rows (per recipient), so history for big broadcasts is truncated.
* HTML injection surface: `dangerouslySetInnerHTML` on manager-authored notification body (`AlumniNotificationsPage.jsx:419`), unsanitised.
* Role-less users see main `Dashboard` (and the "Alumni Platform" link) - the app has no "default deny" for authenticated users without roles.
* `UserNavDropdown.handleSignOut` navigates to `/login` regardless of the portal; alumni layouts navigate to `/alumni/login`.
* `AlumniManagerLayout` shows badge "MANAGER" for super admins; `FounderLayout` shows "Founder" for anyone, including super admin/PM with no founder row.
* `/alumni/founder/company/:id` accepts any company id; UI does not check membership (only RLS could).

### 12.6 Dead / unused code

* `CertificateGenerator.jsx` (not mounted), `issueCertificate`, `updateOpportunity`, `deleteOpportunity`, `getInvestorRequests`, `updateInvestorRequestStatus`, `getUniqueAlumniCompanies`, `getAlumniAdminStats`, `getAlumniInvitations`, `assignUserRole`, `removeUserRole`, `getFounderById`, `getCompaniesInProgram`, `createParticipation`, `updateParticipationStatus`, `deleteParticipation`, `getLatestSnapshot`, `createFounder`/`deleteFounder` (only `createFounder` imported unused in CompanyProfilePage), `unlinkFounderFromCompany`.
* `ProtectedRoute.jsx`; `AuthContext` flags `hasRole/isProjectManager/isAlumniManager/isFounder`, `refreshAuth`, `changePassword` (used by modal), `signUp` wrapper (unused: `acceptInvitation` calls `supabase.auth.signUp` directly).
* `RoleGuard` alumni-path branches (`isFounderPath`, `isManagerPath`, `isAlumniPath` login target).
* State/vars: `resetSent` (`AlumniLoginPage`), `selectedProgram` (`AlumniDirectory:29`), `showAddFounderModal`, `filterStatus` (MEWorkspace), `priority` (notifications), `photoFile` (FounderProfilePage).
* Unused imports across many alumni files (e.g. `useNavigate`, `Link`, many lucide icons).
* `FounderProgressPage` milestone data is fully static.

### 12.7 Documentation/behaviour drift summary

See section 11 (file names, routes, role mechanism, hooks, sidebar vs top-nav, `assignUserRole` signature, certificate generator placement).

---


---

<!-- source: 07-database-schema-rls-and-migrations.md -->
**Source document: [07-database-schema-rls-and-migrations.md](07-database-schema-rls-and-migrations.md)**

## 07-database-schema-rls-and-migrations.md — 8. Duplications, Conflicts & Anomalies (as-is)

### 8.1 Repo vs live — objects that do not match
| # | Finding | Evidence |
|---|---|---|
| 1 | **`form_sections` is defined in two migrations (20260908, 20260909) but does not exist live**, nor does `form_field_configs.section_id`, `event_forms.sections`, `library_forms.sections`, `idx_form_sections_*`, `idx_form_field_configs_section_id`. Both migrations are nonetheless in the live migration history. | `information_schema` (live); `list_migrations`; `database.types.ts` has no such table. |
| 2 | Application code deals with the missing table by probing it and storing sections in `event_forms.integrations.form_sections` (JSONB) instead. | `src/lib/api.js` ~2898–3015 ("only if it exists in DB"). |
| 3 | `20260906…` indexes `idx_form_responses_form_id/_event_id/_submitted_at` are absent live; only `idx_form_responses_library_form_id` exists. | pg_indexes. |
| 4 | `20261004000000_fix_user_roles_drop_role_key` is applied live (no `role_key`, functions rewritten, events policies replaced) but **missing from the live migration history**. | list_migrations stops at 20260930000000. |
| 5 | `user_roles` live has `UNIQUE(user_id)` (`user_roles_user_id_unique`) whereas migrations create `UNIQUE(user_id, role)` (`user_roles_user_id_role_unique`) — which is absent live. No repo file creates `UNIQUE(user_id)`. The 20261004 header mentions "unique constraint handling" but has no such statement. The backup JSON (13 rows / 12 users, one user with both alumni_manager and super_admin) vs live (12 rows, all super_admin) suggests a duplicate role row was removed when `UNIQUE(user_id)` was added. | pg_constraint; backups file. This inference is not documented anywhere. |
| 6 | `mentors.photo_url`, `mentors.advance_notice_minutes`, `ather_team_members.advance_notice_minutes`, `profiles.avatar_url`, `events.name`, `events.id`, `company_snapshots.id` exist live and are in no migration (`avatar_url` only in `scratch/add_avatar_url.sql`). | information_schema; scratch file. |
| 7 | `ather_team_bookings` RLS is **disabled** live; the migration enables it (and 4 policies exist). | pg_class / advisor. |
| 8 | `booking_notifications` never had RLS enabled; `master_experts` and `email_audit_log` (base tables) have RLS off. | pg_class. |
| 9 | Triggers/functions `handle_expert_auto_index`, `broadcast_master_expert_updates`, `handle_new_user` + `on_auth_user_created`, the `update_updated_at_column` triggers on base tables, `get_user_roles` (original), the `roles` table, the unique `master_experts_name_idx`, `company_submissions` realtime membership, the storage bucket and its policies, and ~25 live policies are not in any migration. | pg_proc / pg_trigger / pg_policies. |
| 10 | 17 tables (all "base") cannot be recreated from the repo: migrations `ALTER`/reference `events`, `companies`, `event_forms`, `profiles`, `user_roles`, `project_managers` that are never created by repo SQL (`supabase db reset` would fail). | Migration 20260708000000 onward. |
| 11 | Seed file `supabase/seed_alumni.sql`: (a) the `DO` block has no `$$` delimiters, (b) a second `DECLARE` is nested mid-block (`DECLARE v_prog1…`), (c) inserts `companies(description)` while the alumni schema added `description_ar`, (d) uses `snapshot_type = 'six_month'` while the migration comments list `6_month_followup`, (e) file starts with a BOM, (f) `ON CONFLICT DO NOTHING` without conflict targets on tables with no natural unique key (`programs`, `founders`, `companies`) → re-runs duplicate rows. Live alumni tables are empty (0 founders, 0 snapshots), so the seed was not left applied. | seed_alumni.sql lines 42–130. |

### 8.2 Migrations overriding / duplicating each other
| Group | Detail |
|---|---|
| form_sections | 20260908 and 20260909 create the same table/column/indexes/policies; 0909's comment: "Fix for 404 on form_sections table". 0908 additionally adds `sections` JSONB to `event_forms`/`library_forms`. Both silently idempotent. |
| form_responses | Created in 20260824, re-declared in 20260906 (same DDL + 3 indexes), column added in 20260907. The same three policies are re-asserted; `Public all form_responses` (ALL) makes the separate INSERT/SELECT policies redundant. |
| user_roles | 20260929000000 (adds `role` enum + sync trigger, keeps `role_key`) → 20260929000001 (rewrites sync function) → 20261004000000 (drops trigger, function, `role_key`; rewrites helpers). Helpers `is_super_admin` / `has_role` therefore exist in 3 versions (the first checks `role`, `role::text` and `role_key`). A manual change (`UNIQUE(user_id)`) is on top, see 8.1 #5. |
| project_managers | 20260929000000 adds alias columns and a sync trigger (kept live). 20260929000001 rewrites the function. Section "6. Point 2.4" (user_roles/project_managers policies) is duplicated verbatim within 20260929000000. `scratch/fix_infinite_recursion.sql` repeats the helper functions and policies already in 20260929000000 (identical bodies) — an earlier manual hot-fix whose content was later also placed in the migration. |
| Unique constraints | `ather_team_members`: 20260709 creates the partial unique index, 20260711000002 "fixes" it with a DROP of a constraint that was never created and re-creates the same index. `mentoring_distribution_config`: 20260725 inline UNIQUE, 20260730 re-adds it and repeats columns from 20260728. `google_settings` UNIQUE added in a separate migration. |
| Alumni | 20260924 (foundation) and 20260925 (phase1: `alumni_invitations`, `founders.auth_user_id`) are consecutive and complementary but not duplicative; 20260929000002 and 20260930 add columns to tables from both (`role_in_company`, `notifications.*`, `alumni_invitations.founder_id`). The "ensure company_snapshots exists" block in 20260929000002 describes a different PK (`id` PK, `snapshot_id` plain) from the foundation table (`snapshot_id` PK); live has `snapshot_id` PK plus a stray nullable `id`. |
| events policies | Created outside the repo, replaced in 20261004 (they referenced `ur.role_key`). Coexist with 4 older/other policies that make them ineffective. |
| booking INSERT policies | 20260707 (`Allow public to create bookings`) and 20260714 (`Allow everyone to insert bookings`) both exist in the repo for `bookings`; live has `Allow public to create bookings` + `Allow anyone to insert into bookings`. |

### 8.3 Overlapping / duplicated tables and columns
| Area | Duplication |
|---|---|
| Day config | `mentor_day_config` (event_id TEXT, session start/end, slot duration, break) and `mentoring_distribution_day_config` (event_id UUID, session start/end, slot duration, break, mentor_ids) are near-twins; `mentoring_distribution_config` also holds start_time/num_days/slot_duration. |
| Booking | `mentors/mentor_slots/bookings` vs `ather_team_members/ather_team_slots/ather_team_bookings` are structural clones; the Ather bookings table carries `mentor_name`/`mentor_email` columns. `bookings` stores denormalised `mentor_name`, `mentor_email`, `start_time`, `end_time` alongside `slot_id` and `mentor_id`. |
| Experts | `experts` (per-event), `master_experts` (global, auto-indexed by trigger on `name`), `mentors` (per-event bookable, `master_id TEXT`), `expert_submissions` (form intake, 0 rows). `master_experts` has `_ar` columns that the broadcast trigger does not propagate. |
| Startups | `companies` (event-scoped showcase, now also "alumni master"), `company_submissions` (intake, 384 rows, has `startup_name` NN **and** `company_name`), `form_responses` (the "decoupled single source of truth", 0 rows; backfill script `scratch/backfill_responses.js` copies submissions). `companies` has overlapping location fields `location`/`governorate`/`province` (+`_ar`), `sector`/`industry`, `bio`/`description`, `founder` text vs `founders` table, `employees` as text. |
| Events | `event_name`/`name`, `event_id`/`id` (both extra columns live-only), `gsheets_url` / `selection_process_gsheets_url`; four email groups (`interview_*`, `rejection_*`, `acceptance_*`, `mentor_*`) of admin_emails/cc_emails/subject/body flattened into 16 columns on `events`. |
| Forms | `event_forms` and `library_forms` copy the same ~12 presentation columns; `library_forms.fields` JSONB vs `form_field_configs` rows; sections kept in JSONB `integrations.form_sections`; `event_forms.cover_id` + `cover_image_url`. `integrations` default JSON differs (`attendees_list` vs `mentors_list`). `form_field_configs` is keyed by `(event_id, entity_type, field_name)` while also carrying `form_id`. |
| Roles | `roles` table (legacy `key`), `app_role` enum on `user_roles.role`, `project_role` enum (unused), `project_managers.role_in_project` TEXT+CHECK; `user_roles.assigned_at` vs `created_at`; `project_managers` event_id/project_id, assigned_at/added_at, assigned_by/added_by pairs kept in sync by trigger; `company_founders.role` vs `role_in_company` (no sync trigger). |
| Snapshots | `company_snapshots.snapshot_id` (PK) vs extra `id`; `form_response_id` column and a `data.form_response_id` key documented in the migration comment. |

### 8.4 Naming and type inconsistencies
- **Primary-key naming:** `id` (mentors, mentor_slots, bookings, ather_team_*, google_settings, notifications, alumni_invitations, join_athar_*, roles, user_roles, project_managers, program_participations, company_founders, mentoring_*, library_forms, form_share_events), `<entity>_id` (events.event_id, programs.program_id, companies.company_id, founders.founder_id, opportunities.opportunity_id, certificates.certificate_id, event_forms.form_id, form_covers.cover_id, form_responses.response_id, experts.expert_id, event_days.day_id, agenda_slots.slot_id, *_submissions.submission_id, form_field_configs.config_id, library_resources.resource_id, company_snapshots.snapshot_id) — two conventions in the same schema.
- **`event_id` type:** `uuid` with FK in events-related tables; **`text` without FK** in `mentors`, `mentor_slots`, `bookings`, `ather_team_*`, `google_settings`, `mentor_day_config`, `mentoring_distribution_config`, `mentoring_sessions`, `email_audit_log`, `join_athar_pages.project_id`; `uuid` without FK in `mentoring_distribution_day_config`. Joining the two families needs casts.
- **`master_id`:** `experts.master_id uuid` (FK) vs `mentors.master_id text`.
- **`submission_id`:** `ather_team_bookings.submission_id text`, `email_audit_log.submission_id text` vs `uuid` PK in the submissions tables.
- **Logical FKs declared only in comments:** `mentoring_sessions.mentor_id` ("FK to mentors"), `.company_id` ("FK optional").
- **UUID defaults:** `gen_random_uuid()` (migrations, most base) vs `uuid_generate_v4()` (company_submissions, expert_submissions, form_field_configs, library_resources).
- **Timestamps:** `TIMESTAMP WITH TIME ZONE DEFAULT NOW()` vs `TIMESTAMPTZ DEFAULT now()` vs `timezone('utc', now())` (roles/alumni_invitations/notifications) — equivalent values, three spellings. `agenda_slots.start_time/end_time` are TEXT while booking slots are timestamptz and distribution sessions are TIME.
- **Plural vs singular:** tables are plural (`events`, `bookings`), except `join_athar_*` (mixed), `mentoring_distribution_config` (singular suffix), `ather_team_*`; the word "project" in code/`project_managers.project_id`/`join_athar_pages.project_id` means `events.event_id`.
- **Arabic suffix:** `_ar` on `companies`, `experts`, `master_experts`, `event_days`, `agenda_slots`, `events`, `programs`, `opportunities`, `founders` (`name_ar` NN as the *primary* name with `name_en` optional — reversed relative to other tables where the base column is the primary and `_ar` the translation).
- **Casing/spelling:** `ather_team` (Ather) vs `athar` (join_athar, "Athar" in text templates).
- **CHECK vs comment-only enums:** `event_forms.target_module`, `company_submissions.status`, `library_forms.scope`, `alumni_invitations.status` have CHECKs; `programs.program_type/status`, `program_participations.graduation_status`, `opportunities.type`, `opportunity_applications.status`, `investor_requests.status`, `bookings.status`, `snapshot_type/source`, `join_athar_analytics.event_type` are free text documented in comments.

### 8.5 Permissive and duplicate RLS policies (factual list)
1. Full anonymous write access on 33 tables (section 6.2) — all `USING (true) WITH CHECK (true)`.
2. Identical or subsuming duplicates: `alumni_invitations` SELECT x2; `company_submissions`/`expert_submissions` INSERT x2 and SELECT x2; `form_field_configs` SELECT x2; `form_responses` ALL + INSERT + SELECT; `form_covers` ALL + SELECT; `events` 8 policies; `companies`/`experts` 5 each; `agenda_slots`/`event_days` 4 each; `bookings` INSERT x2; `mentors` SELECT x2; `mentor_slots` SELECT x2 and UPDATE x2; `library_resources` 3; `company_snapshots` 4 (public + role-based).
3. Names that contradict behaviour: `Authenticated insert/update/delete event_forms` (open to public); `Allow all authenticated users to read programs` is actually the only restricted one; `Public can read their own submissions` is `USING (true)` (all rows); migration comment on `mentoring_*` "Allow all authenticated users" but policy open to public; `company_snapshots` migration comment "no UPDATE/DELETE" is true, but "Public insert/read" negates the ownership policies added later.
4. Sensitive data exposed by SELECT policies: `google_settings.service_account_key` (public SELECT), `founders` email/phone, `company_submissions` national_id/phone/email, `alumni_invitations` token + email (the migration comment says "read invitation by token" but the policy is `true`), `certificates` codes, `notifications` rows with NULL recipient (to all authenticated).
5. `alumni_invitations`: `Allow auth users to manage invitations` (ALL, `true`, any authenticated user incl. founders) alongside the role-based `invitations_manager_all`.
6. `investor_requests` SELECT/UPDATE open to any authenticated user (not manager-only).
7. `get_user_roles(p_user_id)` and the `is_*`/`has_role` helpers accept an arbitrary user id and are callable as RPC by anon.

### 8.6 Index anomalies (duplicate / redundant)
Unique constraint + separate plain index on the same columns: `alumni_invitations.token`, `certificates.verification_code`, `google_settings.event_id`, `mentoring_distribution_config.event_id`, `mentor_day_config (event_id, day_number)`, `mentoring_distribution_day_config (event_id, day_index)`, `join_athar_pages.project_id`, `join_athar_share_presets.page_id` (partly), `idx_form_configs_event` partially overlapping `form_field_configs_event_id_entity_type_field_name_key`. `program_participations` has four plain indexes on two columns (`…_company`/`…_comp`, `…_program`/`…_prog`, from 20260924 and 20260930). Missing but implied: indexes on `mentor_slots.event_id`, `bookings.event_id`, `form_share_events.form_id`, `form_covers.event_id`; `bookings` has no unique constraint on `slot_id`.

### 8.7 Other anomalies
- `smtp_settings.smtp_pass` and `google_settings.service_account_key` store secrets as plain text columns (values not read).
- `project_managers.assigned_by` FK has no ON DELETE action (blocks deleting an auth user who assigned a PM), unlike `added_by` (SET NULL).
- `profiles` count (5) is less than `user_roles` count (12): migration 20260929000000 seeded `user_roles` from `profiles`, so at least 7 `user_roles` rows pre-date or bypass `profiles` (or the base table had its own rows); the `handle_new_user` trigger creates only profiles, never roles.
- `project_managers` is empty (0 rows) while the `events_select_by_pm_or_admin` policy and the "project manager" role design depend on it.
- `events.status`, `meeting_link_mode`, `company_portal_enabled` etc. have no CHECK constraints.
- No FK from `google_settings.event_id`, `join_athar_pages.project_id`, `mentoring_*` to `events` → orphan rows survive event deletion (CASCADE only on UUID-FK tables).
- `database.types.ts` lists functions `get_user_roles`, `has_role`, `is_project_manager`, `is_project_owner`, `is_super_admin` and the two enums; trigger functions are omitted (normal for the generator).
- Edge Function source files under `supabase/functions/` use tables such as `smtp_settings`, `email_audit_log`, `google_settings`, `bookings`; they are outside this document's scope, but `smtp_settings` has RLS-without-policies (service role only), whereas `email_audit_log` (RLS off) and `google_settings` (public read) are reachable by anon.
- Security advisor snapshot (2026-10-10): ERRORs — RLS disabled on `master_experts`, `booking_notifications`, `ather_team_bookings`, `email_audit_log`; policies exist but RLS disabled on `ather_team_bookings`. WARNs — 9 functions with mutable `search_path`; 8 SECURITY DEFINER functions executable by anon and by authenticated; leaked-password protection disabled. INFO — RLS enabled with no policy on `smtp_settings`. (Performance advisors were not run.)

---


---

<!-- source: 08-backend-edge-functions-and-google-apps-script.md -->
**Source document: [08-backend-edge-functions-and-google-apps-script.md](08-backend-edge-functions-and-google-apps-script.md)**

## 08-backend-edge-functions-and-google-apps-script.md — 11. Duplications, Conflicts & Anomalies (as-is)

Numbered factual observations (not recommendations).

**Security / secrets exposure**
- A-1. The log `مشكلة روابط جوجل ميت لا تعمل.md` contains a full Google service-account key (type, project id, private key id, **private key**, client email/id) at lines 441-452 and 822-833, and the log states the same key was inserted into `google_settings` as the global row. The file is a root-level, tracked-or-trackable markdown file. (Value not reproduced here.)
- A-2. `google_settings` stores `service_account_key` as plain `TEXT` and has RLS policies `USING (true)` / `WITH CHECK (true)` for **SELECT, INSERT and UPDATE** for everyone (`20260716000002_add_google_settings_table.sql:17-28`). `src/lib/googleSheets.js:93-106` indeed reads the key into the browser and signs a JWT client-side with it (scopes `spreadsheets` + `drive`).
- A-3. `smtp_settings.smtp_pass` is stored in plaintext in a table with no migration/RLS definition in the repo.
- A-4. The Apps Script web app is deployed `ANYONE_ANONYMOUS` with no shared secret in `doPost`; `notify-google-apps-script` forwards any JSON without checking the caller; edge functions use the service-role key and never check the caller (see §3.4).
- A-5. A Supabase publishable key is hard-coded in `Code.gs:5`, `api-agennda-intervew.gs:5`, `src/lib/supabase.js:4`, `test-meet-generation.js:7`, `scratch/test_fetch_events.js:4` (publishable keys are designed to be public, but note the 5 copies).
- A-6. `share/index.ts` interpolates event title/description/image URL into HTML without escaping (`:65-97`).

**Dead / orphan code**
- A-7. `notify-google-apps-script` (no caller), `send-booking-notifications` (no caller), the whole Apps Script layer (`Code.gs`, `api-agennda-intervew.gs`, guide), `getRecipientDisplayNameWithFallback` (unused), `getShareUrl` (unused), the "direct mode" (`company_email`) branch of the three `send-*` functions (no FE caller), `appsscript.json` scope `script.send_mail` (no mail API used), FE helper name `notifyGoogleAppsScript` (misleading).
- A-8. `.env.example` variable `GOOGLE_APPS_SCRIPT_WEB_APP_URL` unused; `.env.example` has no `VITE_SUPABASE_*` although `scratch/get_schema.js:16-17` expects them.
- A-9. `scratch/test_fetch.js` never invokes `test()`; `scratch/test_persistence.js` contains no test; `test_api.js` imports an unused `deleteDay`.

**Logic quirks (observed in code)**
- A-10. FE retry loops (`atherTeamBooking.js:236-271`, `mentorBooking.js:274-304`) re-invoke a non-idempotent function on any non-2xx, possibly creating duplicate Calendar events/invitations.
- A-11. `process-booking` returns 500 for every error class and records no failure state on the booking; a failed run leaves `status='pending'`, `meet_link` null.
- A-12. **Global Google settings are only half-applied.** When the per-event `google_settings` row is missing (or has no key) the key is taken from the global row, but `calendar_id` and `impersonate_email` are still read from the per-event variable (`generate-google-meet:283-284`, `process-booking:294-295`), so the global row's `calendar_id`/`impersonate_email` are ignored (defaults `"primary"`/none).
- A-13. No FE code writes `google_settings.impersonate_email` (`EventDashboard.jsx` upsert at `:106-115` writes `event_id, service_account_key, calendar_id, updated_at`); only readers exist (`googleSheets.js:122`, both edge functions).
- A-14. `generate-google-meet` creates a Calendar event as a side-effect of every Generate click and never removes it; the event has no attendees and `slot_id` from the FE is a throw-away random UUID for new slots.
- A-15. `booking_notifications.booking_id` FK -> `bookings(id)` only; the function's fallback insert for Athar-Team bookings would reference `ather_team_bookings` ids. The row is also written with `sent_at = now()` although nothing was sent.
- A-16. `send-booking-notifications`: CC recipients are sent as individual `To` messages; sending stops at the first SMTP failure; ICS description contains a raw newline and `undefined` when no link; `ORGANIZER` differs from the SMTP sender; footer `© 2024`.
- A-17. `send-*` functions: HTTP 200 + `success:true` even when every message failed; `sent_by` never supplied by FE; `email_send_count` read-modify-write on a stale row (concurrent calls can lose increments); `smtp_settings` row selected without ordering (nondeterministic if multiple rows); 100 submissions per invocation are sent sequentially in one request.
- A-18. Subject rendering replaces fewer variables than body rendering (`project_manager_name`, `booking_link` not replaced in subjects), and `project_manager_name` is a constant `'Athar Team'` regardless of the actual project manager.
- A-19. FE fallback for interview **subject** is a multi-line HTML body-like string (`SelectionProcessManager.jsx:265`).
- A-20. `isFounderNameColumn` matches very broad tokens (`مؤسس`, `فاوندر`, `full name`) and `nameParser` treats the Arabic article `ال` and many first names as compound prefixes; behaviour on edge cases is determined by array order in `COMPOUND_PREFIXES` (e.g. `["abd","al"]` before `["abd"]`). Header comment says "exactly 2 units", code returns 1 compound unit when the first unit is compound.
- A-21. Apps Script: `supabaseRequest` for `events` and both booking tables pulls **entire tables** (no filter/limit) for every booking/poll; `setHeader`/`setStatusCode` on `TextOutput` are noted as undocumented in-code; `doOptions` is not a standard web-app handler; `processBooking` redeclares `var updates`/`bookingTable` several times; `failed` bookings are never re-polled.
- A-22. `share`: event looked up by `id` instead of `event_id`; hard-coded production domain; any `bot` substring in UA triggers the meta page.
- A-23. Mixed `std` versions: `deno.land/std@0.168.0` (most) vs `0.192.0` (`notify-google-apps-script`); `esm.sh/@supabase/supabase-js@2` unpinned; `npm:nodemailer` unpinned.
- A-24. `supabase/migrations` omit tables the functions require (`smtp_settings`, `email_audit_log`, `company_submissions`, base `events`) - the schema is not reproducible from the repo alone for the email features.
- A-25. `google_settings.event_id` is `TEXT` with a UNIQUE constraint (`20260716000003`) while NULL global rows are allowed multiple times (Postgres unique allows many NULLs), so more than one "global" row can exist and `.limit(1).maybeSingle()` picks an arbitrary one.
- A-26. Timezone mismatches (C-7): events created from Generate use UTC, from `process-booking` use Cairo; the ICS uses UTC `Z`.
- A-27. `README.md` is the unmodified Vite template and documents none of this backend.

---

