# 10 — Consolidated Open Questions for the Owner

> Auto-assembled verbatim from each analysis document. These are things the analysts could not determine from code/DB alone.


---

**Source document: [01-app-shell-and-infrastructure.md](01-app-shell-and-infrastructure.md)**

## 01-app-shell-and-infrastructure.md — 16. Open Questions (for the owner)

1. Which deployment is authoritative: GitHub Pages (`deploy.yml`) or `athareg.com/EventsOperations` (Apache `.htaccess`)? Is the CI build ever used in production, and how are `VITE_BASE_PATH` / the `.htaccess` copy handled there?
2. Is `GOOGLE_APPS_SCRIPT_WEB_APP_URL` still needed? Who consumes it (edge function secret, older frontend code)?
3. Which Apps Script copy is deployed: `api-agennda-intervew.gs` (newer, shared/unique Meet link mode) or `google-apps-script/Code.gs`? Is `notify-google-apps-script` the only caller?
4. `.htaccess` redirects `/share` to `share-event`, but the repo function is named `share`. Which name is deployed, and does branded sharing (`?agenda=` flow in `App.jsx:100-116`) depend on it?
5. Is the intended role model one role per user (as `assignUserRole` states) or multiple roles (as the frontend supports)? Can a user be both `founder` and `project_manager`?
6. Should a `project_manager` be able to open founder routes (`AlumniRouteGuard` allows it) and should role-less authenticated users see the Dashboard?
7. How is the `profiles.avatar_url` column provisioned in production (only `scratch/add_avatar_url.sql` exists), and was `scratch/fix_infinite_recursion.sql` applied manually (not in migrations)?
8. Is `alumni/CertificateGenerator.jsx` meant to be used (no importer)? Is the `/verify-certificate` flow complete without it?
9. Is dark mode planned? There is no toggle but variables and a few `dark:` classes exist.
10. Are `nodemailer`, `@types/react*` and the second lockfile (`package-lock.json`) intentionally retained?
11. Who uses `refreshAuth`, `hasRole`, `isFounder`, etc. from the context (no callers found in scope), and who writes `user_profile_<uid>` (only cleared)?
12. `useLanguage` is "English-only" per comment but supports Arabic; what is the intended language policy for the alumni module versus the public portal (`?lang=`)?
13. Were the chat-export `.md` files and lint dumps meant to be part of the repository, or only local notes? Is `Dashboard.jsx.bak` safe to consider obsolete?
14. Are the test/scratch scripts expected to run against the production Supabase project (they use real event IDs)? Is there any intended test strategy?
15. Is the public `/view/:eventId/mentoring/*` unauthenticated exposure intentional (live view and matrix without login)?
16. Many files are untracked while `App.jsx` imports them - is the working tree the source of truth for deployment, and has CI been failing since those imports were added?
17. `EventDashboard` module cards use `prefetchKey` values `mentor-booking` and `mentoringDistribution` that do not exist in `prefetch`; was this deliberate?
18. Why is the Supabase client configured with a no-op lock (`supabase.js:22`) - was `NavigatorLockAcquireTimeoutError` observed in production, and are multi-tab session conflicts accepted?

---

**Source document: [02-data-access-layer-api.md](02-data-access-layer-api.md)**

## 02-data-access-layer-api.md — 10. Open Questions (for the owner)

1. Are `SUPABASE_URL` / `SUPABASE_ANON_KEY` intentionally hard-coded in `supabase.js`? What is the purpose of the modified `.env.example` (variable names?) if no code reads `import.meta.env`?
2. Is client-side Google Service Account JWT signing (googleSheets.js) intended? Which RLS policy on `google_settings` allows public form respondents to read the key? Is `google_settings.service_account_key` the same key used by the edge functions (`generate-google-meet`, `process-booking`)?
3. What does `process-booking` do vs the unreferenced `notify-google-apps-script` function and `google-apps-script/Code.gs`; is the latter obsolete? Why is the JS helper still called `notifyGoogleAppsScript`?
4. Which is the authoritative set of tables: the live database, the migrations in `supabase/migrations`, or `src/types/database.types.ts`? The type file lacks `form_sections`, `events.title`, `program_participations.graduation_date`, `companies.created_at`; are those columns/tables present in production? (Code seems to be written both ways.)
5. Is `form_sections` meant to exist (two migrations with similar names exist) or is the JSONB `event_forms.integrations.form_sections` the intended store?
6. What is the intended source of truth for experts: `experts` rows (event-local, denormalised copy) or `master_experts`? Why are profile fields copied rather than joined (`createExpert` 645-662), and what is `mentors` (mentorBooking) vs `experts` vs `master_experts`?
7. Which `companies` rows count as "alumni" (`is_alumni`)? Several analytics functions ignore the flag (3906, 4398, 4826). Is `sector` or `industry` the canonical field; why are both present? Why does `province` exist next to `governorate`?
8. Which snapshot data schema is canonical (`revenue_sar`... vs `revenue`/`annual_revenue`... vs full company row)? Who writes snapshots with `source:'me_team'` (MEWorkspace) and what keys do they use?
9. How are alumni invitation emails actually delivered (no email in `api.js`, no matching edge function in `supabase/functions`)? Does the UI copy the link manually?
10. Is `user_roles` single-role (`onConflict:'user_id'` comment) or multi-role (AuthContext/PM eligibility use arrays)? What did migration `fix_user_roles_drop_role_key` change? How does a `founder` role row get created after `acceptInvitation` (DB trigger?)
11. Which of the 27 never-imported exports are intentionally reserved for upcoming features (participations CRUD, investor requests admin, certificate issuing, opportunities edit/delete, `assignUserRole`)?
12. Does `acceptInvitation`'s `supabase.auth.signUp` replace the currently signed-in session when an admin/manager tests it (and what happens when email confirmation is required)?
13. Why are `project_managers` writes duplicated across `event_id/project_id`, `assigned_by/added_by`, `assigned_at/added_at` - is a column rename/migration in progress?
14. `duplicateEvent`: is it intentional that cloned `form_field_configs` keep the old `event_id` and that covers / responses / Join Athar data are not cloned?
15. `submitToForm`: why is phone validation run with default countries instead of the form's configured countries (`PhoneValidationConfig` exists)? Is the fire-and-forget integration step acceptable to lose failures?
16. Is `src/components/Dashboard.jsx.bak` and the `scratch/` SQL/JS (`scratch/add_avatar_url.sql`, `fix_infinite_recursion.sql`, ...) part of the deployed schema history or throw-away?
17. Should the 60 s cache TTL and whole-cache clearing be treated as a contract (do any screens depend on stale reads)?

---

**Source document: [03-frontend-events-and-entities.md](03-frontend-events-and-entities.md)**

## 03-frontend-events-and-entities.md — 8. Open Questions (for the product/code owner)

1. **Role-less users on `/`**: `RoleGuard` on `/` has no `allowedRoles` and its "unauthorised" fallback also redirects to `/` (`RoleGuard.jsx:60-68`). Is it intended that an authenticated user with no role (or any future role) can open the project dashboard, and is access to events then purely enforced by Supabase RLS? Where is the RLS that makes `project_managers` assignments matter (the empty-state text says managers "gain access to this project", `ProjectManagersManager.jsx:180`), and does `getEvents()` really return only assigned events for project managers?
2. **Are the public portals (`CompanyPortal`, `ExpertPortal`) currently broken in production**, or is a different build/version deployed? The `translations.ar/en` lookups (`ExpertPortal.jsx:33`, `CompanyPortal.jsx:35`) look wrong against `lib/translations.js`. Which of the registration portal URL families (`/events/:id/register/...`, `/forms/...`, `GenericFormPortal`) is the supported one for expert/company intake?
3. **Company submission statuses**: is a process (Selection Process module, Edge Function, DB trigger) responsible for moving `screening -> pending`, or is `StartupManager`'s "Review Desk" legacy now that Selection Process exists (`SelectionProcessManager`)? Which module is the intended approval path for companies?
4. **Where should `display_config` live?** Is the per-expert/per-company `display_config` (modal toggles) meant to be retired in favour of global `form_field_configs.show_in_card`? `experts` has no such column and the API drops the value, but `companies` has it.
5. **`duplicateEvent`** (`lib/api.js:354-517`): does `agenda_slots` really have `expert_ids`/`company_ids` columns in the live database (they are missing from `types/database.types.ts`), and is the PK of `experts` `expert_id` or `id` in production? Has this function been run successfully on events that have slots and experts?
6. **Why does `getCompanies` order by `name` while the UI persists `sort_order`** (`lib/api.js:259`, `bulkUpdateCompanies`)? Is manual company order supposed to appear in the public Startup list?
7. **Are `/event/:id/experts`, `/startups`, `/visuals`, `/analytics` and `/companies` meant to remain reachable?** No in-scope component links to them; are they bookmarked/shared internally? Is `CompaniesPage` ("Companies Hub", cohort management) a planned alumni feature or superseded by the alumni directory?
8. **Event vs Project vs Program wording**: should the UI keep calling `events` "projects" and what is the business definition of a Program versus an Event (programs only group events and have `program_type`, `year`, `status` that no screen edits)?
9. **Public link strategy**: which of the four link builders is canonical (`?agenda=` redirect, `#/agenda/<slug>`, `getShareUrl`'s external sharing URL for social previews)? Is the slug-from-name design intentional given that renaming an event breaks existing links and that two similarly named events collide?
10. **Two header editors**: is the `EventBuilder` "Visual Settings" tab or `EventVisualManager` the intended home for event visuals? Does anything else read the `event_header_settings_<eventId>` key that `AgendaViewer` looks up in `localStorage`?
11. **`google_settings` / service account key**: `EventDashboard` contains code to read and upsert `google_settings.service_account_key` directly from the browser (`:60-130`) but no UI renders it. Is this feature abandoned (the Edge Functions read the table server-side)? If it is intended, should a secret ever be fetched into the client?
12. **`EventDashboard` module list**: should Experts, Startups, Analytics and Visuals appear as cards? Prefetch keys for `mentor-booking` and `mentoringDistribution` are referenced but not defined (`App.jsx:64-79`).
13. **Owner vs collaborator** project-manager roles: what permissions differ? Only the label states "Can manage other PMs".
14. **Duplicate `project_managers` columns** (`event_id`/`project_id`, `assigned_*`/`added_*`) and duplicate event identifiers (`events.id` / `event_id`, `name` / `event_name`): which are legacy?
15. **`bulkUpdateCompanies` uses `upsert` with a partial row** (`company_id`, `sort_order`, `lib/api.js:2396-2407`): does it succeed against a `companies` table with NOT NULL columns (e.g. `name`)? Same question for `updateSlotsOrder`'s whole-row upsert of agenda slots.
16. **`master_experts` lifecycle**: masters are created by name matching only (`lib/api.js:615-619`, exact, case-sensitive). Is the global library supposed to be edited only through `MasterExpertsList`, and should it support manual creation/merge of duplicates?
17. **Mentors vs experts**: how are rows in `mentors` created (Mentor Booking admin, outside this scope) relative to event `experts`, and why does `ListsManager` label the experts list "Mentors"?
18. **Marketing analytics source**: should `SubmissionAnalytics` also count `form_responses` (the generic form engine) since `submitToForm` records `source` and `tracking_data` there (`lib/api.js:1880-1930`)?
19. **`Dashboard.jsx.bak`** - keep as reference or remove? Branding changed from "Athar Planner" to "AtharOS" - which name is current?

---

**Source document: [04-frontend-forms-selection-join.md](04-frontend-forms-selection-join.md)**

## 04-frontend-forms-selection-join.md — 10. Open Questions (for the owner)

1. **Migrations `20260908` and `20260909`** both create `form_sections` and `form_field_configs.section_id`: have either/both been applied in production? The generated types (`database.types.ts`) show neither the table nor the column, while the later `join_athar_*` migration is reflected. Which store (`integrations.form_sections` vs relational) is intended as canonical, and what is the role of the unused `event_forms.sections` column?
2. Where are `CREATE TABLE` statements for `event_forms`, `form_field_configs`, `company_submissions`, `expert_submissions`, `companies`, `experts`, `events`? They are not in `supabase/migrations`. Is there an out-of-band baseline?
3. Is the **legacy engine** (`CompanyPortal`, `ExpertPortal`, `getFormConfig`, `expert_submissions`, `StartupManager`/`ExpertManager` form-config editors) still in production use, or fully superseded by `GenericFormPortal`? Should `target_module = 'company' | 'expert'` still be creatable?
4. What is `target_module = 'alumni_annual_update'` supposed to be created from (no UI produces it) and how do founders reach such a form with a `company_id` answer?
5. What should "Display Publicly" (`displayed` status) do? Nothing in the frontend reads that status; is a DB trigger or external flow expected to move such companies into `companies` / public viewers?
6. Intended behaviour when `integrations.selection_process` is off but `target_module = 'selection_process'`: should such forms feed the Selection board by default (the code in `FormIntegrationsTab` suggests yes, the DB default says no)?
7. Should `/forms/:formId` (no `eventId`) be a supported public URL? As implemented it cannot store a response (`event_id NOT NULL`).
8. Is it intentional that a respondent sees success when the primary `form_responses` insert fails?
9. Which of the following are intended: (a) copying historical responses on `with_history` import (duplicates rows), (b) library-wide counting of those copies, (c) `blank_copy` still enabling module integrations?
10. `events.title` vs `event_name`: is there a `title` column/view in the live DB (the library screens depend on it)?
11. Are `share_description` / `share_image_url` on forms meant to feed an OG-tag edge function like `share` does for events? Today they are dead data.
12. What is the expected public link for Join Athar: `#/view/:id/join-athar` or `?agenda=:id&tabs=join-athar` (which resolves to the agenda viewer)? Does `ViewerWrapper` honour `tabs=join-athar` by redirecting?
13. How is `smtp_settings` populated and how is `verify_jwt` configured for the three email functions? Who is allowed to invoke them?
14. Should `reviewed_by`, `rejection_reason`, `email_audit_log` be surfaced in the Selection UI? (Columns/tables exist; the UI uses `additional_data` free-text instead.)
15. Intended UI language policy: should admin screens be bilingual, English-only or Arabic-only? (Library screens are Arabic/RTL, hub is English/LTR.)
16. Are the supported phone countries meant to be limited to EG/SA/AE, or should KW/QA/BH/OM/JO have real validators (they are selectable but fall through to a generic 7–15-digit check)?
17. `google_settings.service_account_key` public SELECT policy and in-browser JWT signing: is this a known accepted trade-off, or a placeholder until the Sheets append moves server-side?

---


---

**Source document: [05-frontend-booking-and-mentoring.md](05-frontend-booking-and-mentoring.md)**

## 05-frontend-booking-and-mentoring.md — 10. Open Questions (for the owner)

1. **Intended single source of truth for mentors.** Why do three mentor concepts exist (`mentors` for booking, `experts` for distribution, `ather_team_members`)? Should the 1-1 distribution and the self-service booking ever be linked (e.g. a mentor in distribution who also has slots)?
2. **Is `process-booking` the intended final pipeline** (and are `send-booking-notifications`, `notify-google-apps-script`, `Code.gs`, `api-agennda-intervew.gs`, `booking_notifications` obsolete)? Is the Apps Script poller still deployed/triggered in production?
3. **Live RLS policies.** Migrations give anonymous users INSERT on bookings but SELECT/UPDATE only to `authenticated`, yet the public page does `INSERT ... RETURNING` and an UPDATE on the slot. Were extra policies added directly in the dashboard? What are the actual live policies for `bookings`, `mentor_slots`, `ather_team_*`, `google_settings`, `mentoring_*`?
4. **Mentor e-mail template and `admin_email` setting.** Should the template in the Mentor Settings tab actually be used for a notification? Where is `events.admin_email` supposed to be edited (no input exists in the Mentor tab)?
5. **Meet links.** Is the slot-level `meet_link` (pre-generated by the Generate button) meant to be the link used for the booking, or is the per-booking link created by `process-booking` authoritative? Should shared mode apply to mentors as well as interviews (it currently does)?
6. **Cancellation semantics.** Should cancelling a booking delete the Google Calendar event and notify attendees? (`calendar_event_id` is stored but unused.)
7. **Duplicate-booking prevention.** Is it intended that a company can book multiple slots with the same mentor and that two people can race for a slot?
8. **Distribution break model.** Are global `break_slots` still wanted, or replaced by per-day `break_between_slots_minutes`? Should total round include gaps (CON-9)?
9. **Finalized days vs "Generate".** Should the full "Generate" ever overwrite locked days?
10. **Timer authority.** Should the public Live/Matrix pages be allowed to control the timer? Should `timer_state` be persisted/synchronised server-side?
11. **Per-mentor custom availability** (`max_slots`, `slot_indices`, time window) - should it also apply in the full "Generate"? Is `slot_indices` editable anywhere? (No UI found.)
12. **Types of IDs.** `experts.expert_id` and `companies.company_id` are strings in generated types while `mentoring_sessions.mentor_id/company_id` are `uuid`; are all current IDs valid UUIDs? What column types exist in production?
13. **Time zones.** Is the event always in Africa/Cairo? Which zone should admins' slot times, viewers' times and Live View "today" use?
14. **Public Live/Matrix gating.** Should unpublished data be protected server-side?
15. **`EventDashboard`** has cards for mentor booking and mentoring distribution but none for Ather team booking; is the embedded Selection Process tab the only intended entry?
16. **Who is the audience of the interview invitation's `{{booking_link}}`?** Should it point to each team member's public page or a chooser page?
17. **Rejected scope**: the Arabic logs mention a "Schedule" tab for Mentor Booking that was moved to Distribution. Is the remaining `mentor_day_config` table/engine to be dropped or reused?

---


---

**Source document: [06-frontend-alumni-platform-and-roles.md](06-frontend-alumni-platform-and-roles.md)**

## 06-frontend-alumni-platform-and-roles.md — 13. Open Questions (for the owner)

1. **How does a self-registered founder receive the `founder` role?** `acceptInvitation` only sets `user_metadata.role`; `user_roles` accepts writes from `super_admin` only; no trigger exists in the repo. Is there a trigger/Edge Function/manual step in the live project not present in `supabase/migrations`?
2. Is **e-mail confirmation** enabled in Supabase Auth? It decides whether the post-signup redirect to `/alumni/founder/profile?welcome=true` lands logged in.
3. Is the intended behaviour for **role-less authenticated users** to see the main Dashboard (`/`) and all `/alumni/founder/*` pages?
4. Migration `20260929000000` assigns **all existing `profiles` as `super_admin`**. Was that intentional for production, and how are subsequent managers/PMs/founders meant to be granted roles (no UI calls `assignUserRole`)?
5. Should `assignUserRole` be "one role per user" (as coded and commented) or multi-role (as the DB unique key and `USER_ROLES_FIX.md` state)?
6. What is the live schema of `opportunities` and `investor_requests`? The hub/profile forms write columns (`provider`, `amount_sar`, `external_url`, `investor_*`) that are absent in repo types - was the live DB altered separately, or are these features currently failing?
7. Is `program_participations.graduation_date` intended (analytics reads it) - and should the 94/86/74 fallback survival percentages be real defaults or placeholders?
8. Which is the canonical field for sector (`sector` vs `industry`) and geography (`province` vs `governorate` vs `location`)?
9. What currency/country is the target (SAR/Saudi in docs, seeds and most forms; USD "$" and "Iraq/Baghdad/Erbil" in `FounderDashboard`; "IQD/USD" in analytics export)?
10. Is `CertificateGenerator` supposed to be mounted somewhere (and who issues certificates - managers or founders)? Who calls `issueCertificate`, and when should a certificate exist (graduation trigger)?
11. Should founders really be able to "Add Snapshot" (source recorded as `me_team`) and "Request Investor Intro" from the shared `CompanyProfilePage`?
12. Is the public SELECT on `alumni_invitations` (all rows, tokens included) and the broad "Public access" RLS policies on founders/certificates/opportunity_applications intentional?
13. Should alumni portals share `UserNavDropdown` (change password, profile) or stay separate? Currently founders/managers cannot change their password inside the alumni UI.
14. Is the manager portal meant to stay English-only (hook comment) or become bilingual (hook supports `setLang` but nothing calls it)?
15. How should the "M&E team", "investor/partner" and "company" actors be modelled - as roles (enum has none) or as sub-views of `alumni_manager`?
16. Where do annual-update forms (`targetModule === 'alumni_annual_update'`) get their `company_id` answer from, and what is the expected `answers` key structure compared with the snapshot `data` keys the dashboards read?
17. Notifications addressed to unregistered founders are stored with `recipient_id = NULL` and are visible to all authenticated users - is this intended as "announcements" or an unintended side effect?

---

**Source document: [07-database-schema-rls-and-migrations.md](07-database-schema-rls-and-migrations.md)**

## 07-database-schema-rls-and-migrations.md — 11. Open Questions (for the owner)

1. **`form_sections`:** were migrations 20260908/20260909 applied and later rolled back, or recorded without executing? Is the relational table intended (code probes for it) or is the JSONB `integrations.form_sections` the final design? Should `event_forms.sections`, `library_forms.sections`, `form_field_configs.section_id` exist?
2. **`user_roles` uniqueness:** who created `UNIQUE(user_id)` and when, and is "one role per user" intended (it contradicts the multi-role design of `app_role` and `UNIQUE(user_id, role)` in migration 20260929000000, and the one-user-two-roles row in the backup)? Where did the extra `alumni_manager` row in the backup go?
3. **Migration 20261004000000** was applied but is not in the migration history. How was it applied (SQL editor vs MCP vs CLI)? Are other changes applied the same way?
4. **Base tables:** where is the DDL for `events`, `experts`, `master_experts`, `companies`, `company_submissions`, `expert_submissions`, `event_days`, `agenda_slots`, `event_forms`, `form_field_configs`, `library_resources`, `profiles`, `roles`, `smtp_settings`, `email_audit_log` (and original `user_roles`, `project_managers`)? Is there an older repository (the debug log references `…\Coding\agenda-builder`)?
5. Why do `events` have extra `name` and `id` columns and `company_snapshots` an extra `id` column? Are they used?
6. Why is RLS disabled on `ather_team_bookings` (migration enables it), `master_experts`, `email_audit_log`, and never enabled on `booking_notifications` — deliberate or accidental?
7. Is the fully-open anon write model intentional (the migrations call it "standard pattern used in the project"), given roles `super_admin` / `project_manager` / `alumni_manager` / `founder` and role-based policies that currently have no effect on most tables?
8. Which bucket should join-athar images use: `event-assets` (what the code uses) or `event-covers` (what the storage policies reference)? Was `event-covers` ever created?
9. The `roles` table (4 rows, legacy `key`) — is it still used by anything (the code grep found no `.from('roles')` and no `role_key`)?
10. `mentors` vs `master_experts` vs `experts`: should mentors link to `master_experts` (type is `text` and un-FK'd)? What produces `mentors.photo_url` and `advance_notice_minutes` (live-only)?
11. Why are there two day-configuration tables (`mentor_day_config`, `mentoring_distribution_day_config`) and why is one keyed by TEXT `event_id` and the other by UUID? `mentor_day_config` has 0 rows — is it used by the front-end (3 call sites found)?
12. `form_responses` has 0 rows while `company_submissions` has ~384: which one is authoritative for the form-builder going forward? Was `scratch/backfill_responses.js` executed?
13. Is `google_settings` meant to be readable by anon (service-account key column)? Where is its value consumed — client or edge functions?
14. `company_snapshots`: `snapshot_type` values in comments (`6_month_followup`) vs seed (`six_month`) — which is canonical? Are `company_snapshots.id` and `.snapshot_id` both required?
15. `profiles` (5) vs `user_roles` (12): who are the 7 extra role holders and how were they created (the signup trigger creates profiles only)?
16. `project_role` enum is unused; should `project_managers.role_in_project` use it?
17. The meaning/usage of `events.company_portal_enabled`, `expert_portal_enabled`, `header_settings`, `show_day_names`, `experts_color`, `startups_color` (base columns) is not documented in any migration.
18. `supabase/seed_alumni.sql` appears syntactically broken (missing `$$`, nested `DECLARE`) — was it ever executed as-is, or was it pasted into the SQL editor after edits?

---

**Source document: [08-backend-edge-functions-and-google-apps-script.md](08-backend-edge-functions-and-google-apps-script.md)**

## 08-backend-edge-functions-and-google-apps-script.md — 12. Open Questions (for the owner)

1. **Which Apps Script copy (if any) is actually deployed**, and is the `/exec` URL in `notify-google-apps-script` still alive? Is the time-driven trigger for `pollForNewBookings` active? Can `Code.gs` and `api-agennda-intervew.gs` be reconciled, and why is the root copy named `agennda-intervew`?
2. Is `notify-google-apps-script` still deployed in Supabase? Same question for `send-booking-notifications`: is it intentionally unused, or was a different trigger (DB webhook / external) expected to call it? The logs show it deployed and used for booking confirmations earlier.
3. **How does production authenticate to Google Calendar?** The logs show a service account plus Domain-Wide Delegation steps, but also "no access to the Google admin console for `startups@...`". Is `impersonate_email` populated by SQL for the real row? (No UI writes it.) Does the Calendar API accept attendees from the service account in the deployed configuration?
4. Which `google_settings` rows exist in production (global row? per-event rows?) and is the key in them the same one pasted in the log? Has that key been rotated after being pasted into a markdown log?
5. Which `verify_jwt` setting is used for each deployed function (no `config.toml`)? Particularly `share` (must be public), `generate-google-meet` (logged as `false`), and the email/booking functions.
6. In shared-link mode, does Google actually accept the hand-built `conferenceData.entryPoints` payload in `process-booking`, or is the link only effective through `location`/`description`? Which behaviour is intended when shared mode has an empty link?
7. Where is `smtp_settings` populated (no UI found) and which account/limits are used? Are Gmail quotas a concern with 100 recipients per invocation, and what are the edge-function wall-clock limits in practice?
8. Intended greeting rule: full two-unit name (current `nameParser`) or first name only (as in the `mostafa shaban` request)? Is `{{first_name}}` meant to differ from `{{founder_name}}`?
9. What is `project_manager_name` meant to resolve to (hard-coded `Athar Team` today)?
10. Should the mentor-booking e-mail templates (`events.mentor_email_template_*`) be applied by some function? Today they are stored and edited but never rendered.
11. What serves `https://athareg.com/share` - a rewrite to the `share` function? Is `getShareUrl` meant to be used somewhere?
12. Are `company_submissions`, `smtp_settings`, `email_audit_log`, base `events` created by a migration outside this folder (or by the dashboard)? Is `events.id` (nullable) a legacy column still needed by `share`?
13. Is the "Google Calendar Integration" section in `EventDashboard.jsx` supposed to remain (user asked to remove it in the Meet log), given that it is the only UI that writes `google_settings`?
14. The guide and `.env.example` still describe the Apps Script webhook flow - should they be treated as historical?
15. Do the scratch SQL files (`add_avatar_url.sql`, `fix_infinite_recursion.sql`) correspond to changes already applied in the database/migrations?
16. Are the personal e-mail addresses and real UUIDs in `test-meet-generation.js` / `scratch/*` meant to stay in the repo?
