# 02 - Data Access Layer: `src/lib/api.js` (and companion libs)

> Scope: `src/lib/api.js` (4,971 lines, 168 `export`s), `src/lib/supabase.js`, `src/lib/googleSheets.js`, `src/lib/phoneValidation.js`, `src/lib/useMentoringTimer.js`. Cross-references to `mentorBooking.js`, `atherTeamBooking.js`, `mentoringDistribution.js`, `excel.js` (covered in depth by other documents).
> Documentation only. This file describes the code **as it is**; no improvement proposals. No secret values are reproduced; only variable/column names.
> Notation: `file:line`. "T" = function throws the Supabase error; "S" = function swallows errors and returns a fallback (`[]`, `null`, default object, or `undefined`).

---

## 1. Overview

`api.js` is a single flat ES module that acts as the application's data-access layer. It:

1. Imports the shared Supabase client (`./supabase`) and three helpers (`./excel`, `./googleSheets`, `./phoneValidation`) (api.js:1-4).
2. Monkey-patches `supabase.from` to invalidate an in-memory cache on any write (api.js:45-59).
3. Exposes ~168 `export const` async functions, mostly one-per-operation CRUD, directly calling PostgREST via `supabase.from(...)`.
4. Contains no classes, no default export, no React code, no router code. Domain grouping is done only with banner comments (`// ====` / `// ───`).

All calls are made from the browser using the publishable (anon) key plus the logged-in user's JWT; there is no service-role usage in this layer. Authorization is therefore entirely delegated to Postgres RLS (policy definitions live in `supabase/migrations/*`, out of scope here); `api.js` performs no role checks of its own (the only role-aware functions are `getUserRoles`, `assignUserRole`, `removeUserRole`, `getAllEligibleProjectManagers`).

### 1.1 File structure (sections in order)

| Lines | Section (banner) | Content |
|---|---|---|
| 1-26 | imports + `notifyGoogleAppsScript` | Edge-function call `process-booking` |
| 28-37 | CONFIG & BRANDING | `SHARING_BASE_URL` constant (hard-coded `https://athareg.com/share`), `getShareUrl` |
| 39-78 | IN-MEMORY CACHE | `apiCache` Map, `clearApiCache`, `supabase.from` monkey-patch, `withCache` |
| 81-517 | (no banner) Events & agenda | events CRUD, slug/UUID resolution, `getFullAgenda`, `getAgendaTabs`, `duplicateEvent` |
| 519-758 | EXPERTS & COMPANIES | master experts hub, event experts, event companies |
| 760-815 | DAY APIs | `event_days` CRUD |
| 817-866 | SLOT APIs | `agenda_slots` CRUD |
| 867-895 | STORAGE APIs | `uploadImage` (bucket `event-assets`) |
| 897-947 | LIBRARY (resources) | `library_resources` CRUD |
| 949-1103 | (doc-comment) agenda sync | `importAgendaData`, `syncEventFromCloud` |
| 1105-1494 | REGISTRATION PORTALS APIs | legacy per-entity form config + submissions + approve/reject, `getDefaultFormConfig` |
| 1492-1656 | MULTI-FORM APIs | `event_forms` / `form_field_configs` by `form_id` |
| 1658-1700 | FORM COVERS | `form_covers` CRUD |
| 1702-1744 | FORM RESPONSES | `form_responses` read/delete/status |
| 1746-1796 | SHARE ANALYTICS EVENTS | `form_share_events` |
| 1798-1873 | DUPLICATE FORM (PHASE 6) | `duplicateEventForm` |
| 1875-2025 | SUBMIT TO FORM | `submitToForm` (unified submission + async integrations) |
| 2028-2300 | sheet/submission helpers | `extractPrimaryEmail`, `extractDynamicSheetFields`, `syncSubmissionsFromSheet` |
| 2302-2407 | ordering helpers | `updateSubmissionStatus`, `updateSlotsOrder`, `bulkUpdateExperts`, `bulkUpdateCompanies` |
| 2409-2471 | PROGRAMS | `programs` CRUD + `assignEventToProgram` |
| 2473-2883 | CENTRAL FORM LIBRARY | `library_forms` CRUD, import/save-to-library, analytics |
| 2885-3022 | FORM SECTIONS / STEPS | JSONB-first + optional relational table |
| 3024-3191 | JOIN ATHAR MODULE | `join_athar_*` pages/cards/presets/analytics |
| 3194-3680 | ALUMNI & IMPACT PLATFORM | founders, company links, participations, snapshots, certificates, opportunities, investors, alumni helpers |
| 3682-3888 | PHASE 1: ALUMNI AUTH, INVITATIONS & PROFILES | invitations + `acceptInvitation` (Supabase Auth sign-up) |
| 3889-4033 | (continued) alumni lists/profile | |
| 4035-4248 | ROLES & PERMISSIONS (PHASE 3) | `user_roles`, `profiles`, `project_managers` |
| 4250-4381 | ALUMNI PLATFORM PHASE 1 (FOUNDER) | founder company update/create, programs, notifications |
| 4383-4971 | ALUMNI MANAGER API (PHASE 2) | dashboard stats, charts, invitation list, bulk invites, broadcasts, analytics |

### 1.2 Cross-cutting patterns

| Pattern | Where | Description |
|---|---|---|
| Error contract | everywhere | Two coexisting conventions: (a) **T**: `if (error) throw error; return data;` (many on a single line: `if (error) throw error; return data;` e.g. api.js:343, 351, 739); (b) **S**: `try { ... } catch { console.error; return fallback }` (e.g. `getProjectManagers` 4147, `getAlumniManager*` 4387+). Several functions use a mix and silently ignore secondary errors (`getMasterExperts` ignores `expertLinks` error at 534; `updateMasterExpert` ignores the sync `update` error at 578). |
| Delete return | all `delete*` | `{ success: true }` (a few `removeProjectManager`, `deleteMasterExpert` too); `getSubmissions` etc. return raw arrays. Update/insert return the inserted/updated row via `.select().single()`. |
| Logging | many | `console.log('[Supabase] ...')` / `console.error('[Supabase Error] ...')` with inconsistent prefixes (`[Supabase]`, `[Supabase Error]`, `[API]`, `[Alumni]`, `[notifyGoogleAppsScript]`). |
| Id naming | many | Per-table PK names differ: `event_id`, `expert_id`, `company_id`, `day_id`, `slot_id`, `resource_id`, `form_id`, `cover_id`, `response_id`, `submission_id`, `program_id`, `founder_id`, `snapshot_id`, `certificate_id`, `opportunity_id` vs plain `id` on `master_experts`, `library_forms`, `alumni_invitations`, `program_participations`, `opportunity_applications`, `investor_requests`, `notifications`, `user_roles`, `join_athar_*`. |
| Identifier resolution | `getEvent`, `getExperts`, `getCompanies`, `getAgendaTabs`, `getLibraryResources`, `getFormConfig`, `getJoinAtharPage`, `saveJoinAtharPage` | Accept either a UUID or a human slug/name and resolve to a UUID through `getEvent` (which does `isUUID` test -> exact `eq('event_id')`; else `ilike` on `event_name` (twice: raw and with `-`/`_` replaced by spaces) -> in-memory normalised match across `getEvents()` on `event_name`, `event_name_ar`, `name` -> prefix match). Most other functions (`getEventDays`, `getSubmissions`, `getEventForms`, `saveFormConfig`...) require a UUID and do not resolve slugs. |
| Embedded selects | 31 selects | PostgREST relation embedding (`*, master:master_experts(*)`, `*, company_founders(*, founders(*))`, etc.). Listed in section 8. |
| Client-side aggregation | analytics functions | Stats (`getImpactStats`, `getLibraryAnalytics`, `getAlumniPlatformAnalytics`, `getJoinAtharAnalytics`, `getAlumniManagerChartsData`) pull whole tables to the browser and aggregate in JS. No `.rpc()` and no SQL view is used anywhere in `api.js` (grep: 0 `.rpc(`). |
| Non-atomic multi-step writes | `duplicateEvent`, `duplicateEventForm`, `saveFormConfig*`, `saveJoinAtharPage`, `createExpert`, `acceptInvitation`, `importFormFromLibrary`, `createFounderCompany`... | Sequential inserts/deletes without transaction; partial failure leaves partial state (e.g. `saveFormConfigById` deletes all fields then inserts, 1587-1630). |
| JSON-in-column fallbacks | `getFormConfigById`/`saveFormConfigById`, `getFormSections`/`saveFormSections` | `description`, `section_id` stored in `form_field_configs.validation_rules`; sections stored in `event_forms.integrations.form_sections`, with optional relational `form_sections` table. |

---

## 2. Supabase client, auth and cache

### 2.1 `src/lib/supabase.js` (34 lines)

| Aspect | Detail |
|---|---|
| Client creation | `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{...}})` (supabase.js:11-25). **Project URL and the publishable key are hard-coded string literals in source (supabase.js:3-4)**; there is no `import.meta.env` usage in this file (`.env.example` is modified in git status but is not consumed here; see Open Questions). |
| Singleton | Stored on `globalThis.__supabaseClient` to survive Vite HMR (supabase.js:8-11). |
| Auth options | `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`, `storage: window.localStorage`, custom `lock: async (_n,_t,fn) => fn()` that disables `navigator.locks` (supabase.js:15-23). |
| Visibility hook | On `visibilitychange` -> `visible`, calls `supabase.auth.getSession()` (supabase.js:28-34). |
| Typing | JSDoc type from `../types/database.types` (supabase.js:10); the generated type file (src/types/database.types.ts) is not used at runtime. |
| Throwing | `window.localStorage` is accessed at module load; would throw outside a browser. |

### 2.2 Auth handling inside `api.js`

* `api.js` never reads `supabase.auth.getSession()`; every query relies on the client automatically attaching the session JWT (or the anon key when logged out). Public flows (registration portals, `submitToForm`, `trackJoinAtharEvent`, `trackFormShareEvent`, `verifyCertificate`, `validateInvitationToken`) therefore depend on anon RLS policies.
* Only auth call: `supabase.auth.signUp` in `acceptInvitation` (api.js:3778-3788) with `options.data = { role:'founder', full_name, company_id }`; errors containing `'already registered'` are ignored (3790). The session returned (if email confirmation is off) is not explicitly handled.
* Role/profile helpers (`getUserRoles` 4037, `assignUserRole` 4079, `removeUserRole` 4098, `getUserProfile` 4113, `updateUserProfile` 4128) are consumed by `src/contexts/AuthContext.jsx`.
* `getUserRoles` has its **own** cache layer (not `withCache`): key `user_roles_<userId>` stored in **both** `sessionStorage` and `localStorage`, JSON `{roles, timestamp}`, 60 s TTL; legacy bare-array format also accepted (4040-4052); on Supabase error falls back to stale cache even if expired (4059-4067). `assignUserRole`/`removeUserRole` delete the cache keys (4091-4094, 4106-4109). `updateUserProfile` removes `sessionStorage['user_profile_<id>']` (4142), a key that **no code in api.js ever writes** (AuthContext.jsx:101, 190 also only removes it).

### 2.3 In-memory cache (api.js:39-78)

| Element | Behaviour |
|---|---|
| `apiCache` | module-level `Map`. |
| `withCache(key, fetcher, ttl=60000)` | Returns cached `data` if younger than ttl; if an in-flight `promise` exists returns it (request de-dup); else stores `{promise, timestamp:0}`, resolves to `{data, timestamp, promise:null}`; on rejection deletes the key. Default TTL 60 s; no function passes a different TTL. |
| `clearApiCache()` | `apiCache.clear()` (whole cache, no per-key invalidation). Exported; 13 internal references; **no component imports it** (usage map). |
| Monkey-patch | Replaces `supabase.from` on the **shared singleton** so that calling `.insert/.update/.delete/.upsert` on any query builder first calls `clearApiCache()` **at call time** (before the request is sent/awaited) (api.js:46-59). Consequences (factual): it applies to every module using the same client once `api.js` has been evaluated (including `mentorBooking.js`, `atherTeamBooking.js`, `mentoringDistribution.js`, components that call `supabase.from` directly); it does not cover `supabase.rpc`, `supabase.storage`, `supabase.auth`, `functions.invoke`; a read issued between the clear and the write completing can re-populate the cache with pre-write data. |
| Redundant clears | Many mutating functions also call `clearApiCache()` explicitly after the write (e.g. 515, 3126, 3268, 3314, 3382, 3474, 3486, 3497, 3851, 4031, 4289, 4331), duplicating what the patch already does. |
| Cached getters (key -> function) | `events` (getEvents 81), `event_<id>` (getEvent 112), `fullAgenda_<id>` (175), `experts_<id>` (227), `companies_<id>` (248), `agenda_tabs_<id>` (263), `startups` (298), `master_experts` (523), `library_resources_<id|global>` (901), `library_data_<id>` (944), `programs` (2413), `founders` (3200), `opportunities_<json>` (3452), `alumni_companies_<json>` (3581). All other getters are uncached. |
| Key aliasing | Because the key embeds whatever identifier the caller passes, the same event cached under its slug and under its UUID are separate entries (e.g. `event_<uuid>` vs `event_<slug>`; `fullAgenda_<slug>` also triggers `getEvent(<slug>)`). |

---

## 3. Exported functions by domain

Legend for the Tables column: only PostgREST tables unless stated. Return shapes are abbreviated; "row" = a single table row object.

### 3.1 Integration / config helpers

| Function (line) | Params | Behaviour | Touches | Returns / errors |
|---|---|---|---|---|
| `notifyGoogleAppsScript` (7) | `bookingId`, `isAtherTeam` | Invokes Edge Function `process-booking` with body `{booking_id, is_ather_team}` ("to avoid CORS issues", comment at 6). Despite the name it does **not** call Google Apps Script directly. Logs and rethrows. | edge fn `process-booking` | `data` from the function. T. Only consumers: `mentorBooking.js:282`, `atherTeamBooking.js:249` (3-retry loop there). |
| `getShareUrl` (35) | `eventId` | `https://athareg.com/share?id=<eventId>` using hard-coded `SHARING_BASE_URL` (31). | - | string. **Unused** (no importer). |
| `isUUID` (96) | any | Regex test on `String(str||'')`. | - | boolean. Internal only (8 refs). |
| `getEventSlug` (98) | event object or string | Builds URL slug: strips non word/Arabic chars, spaces/underscores to `-`; falls back to `event_id`. | - | string. Used by Dashboard, EventBuilder, EventDashboard, EventVisualManager. |
| `clearApiCache` (43) | - | See 2.3. | - | void |

### 3.2 Events, agenda, days, slots (tables `events`, `event_days`, `agenda_slots`)

| Function (line) | Params | Behaviour | Touches | Returns / errors |
|---|---|---|---|---|
| `getEvents` (81) | - | All events, `created_at` desc. **Cached** `events`. | `events` | array. T |
| `getEvent` (112) | `identifier` (UUID or slug/name) | See 1.2 resolution chain (UUID -> `.single()`; else 2x `ilike`, then scan of cached `getEvents()` matching `event_name`/`event_name_ar`/`name`, then prefix match). Errors of the two `ilike` lookups are discarded (only `data` destructured, 134, 145). **Cached** `event_<id>`. | `events` | row. Throws `Error('Event not found for identifier: ...')` (172) or the Supabase error (UUID path only). |
| `getFullAgenda` (175) | `identifier` | `getEvent` then parallel fetch of experts (with `master:master_experts(*)`), companies, event_days; then agenda_slots for those days; flattens `{...exp.master, ...exp}`. **Cached** `fullAgenda_<id>`. | `events`, `experts`, `master_experts`, `companies`, `event_days`, `agenda_slots` | `{event, days:[{...day, slots}], experts, companies}`. T |
| `getExperts` (227) | `identifier` | Resolves slug, selects experts + master, flattens. Cached `experts_<id>`. | `experts`, `master_experts`, (`events` via getEvent) | array. T |
| `getCompanies` (248) | `identifier` | Companies of an event ordered by `name`. Cached. | `companies` | array. T |
| `getAgendaTabs` (263) | `identifier` | Builds visible public tabs list by calling `getFullAgenda`, `getLibraryData`, `getJoinAtharPage` in parallel (each `.catch` -> null/empty). Tab ids: `agenda`, `experts`, `companies`, `library`, `join-athar`; labels hard-coded EN/AR; expert label overridable via `event.header_settings.customExpertsLabel[Ar]`. Cached. | indirect: events, experts, companies, event_days, agenda_slots, library_resources, join_athar_* | array of `{id,labelEn,labelAr}`; default `[agenda]`. S for sub-calls. |
| `getStartups` (298) | - | **All** companies across all events, `created_at` desc, cached `startups`. | `companies` | array. T. Used by CompaniesPage only. |
| `createEvent` (306) | `eventData` | Inserts whitelisted columns with defaults (`header_height '16rem'`, `experts_color '#9333ea'`, `startups_color '#059669'`, `show_day_names true`). | `events` | row. T |
| `updateEvent` (336) | `eventId`, `updates` | Generic update by `event_id`. | `events` | row. T |
| `deleteEvent` (346) | `eventId` | Delete by `event_id` (cascade is DB-side). | `events` | `{success}`. T |
| `duplicateEvent` (354) | `originalEventId`, `newEventName` | Clones event + experts + companies + days + slots (re-mapping `expert_ids`/`company_ids` arrays inside slots using id maps), then best-effort clone of `library_resources`, `event_forms` and their `form_field_configs` inside try/catch (warn only). Strips `event_id,id,name,created_at,updated_at`. Experts are cloned including `master_id`. Ends with `clearApiCache()`. Note: `form_covers`, `join_athar_*`, `form_responses`, programs participations are not cloned. | events, experts, companies, event_days, agenda_slots, library_resources, event_forms, form_field_configs | new event row. T for core steps; S for library/forms steps. |
| `getEventDays` (764) | `eventId` | Days by `day_number`. Uncached (but `getFullAgenda` loads the same). | `event_days` | array. T |
| `createDay` (773) / `updateDay` (788) / `deleteDay` (809) | day fields / `dayId`,`updates` / `dayId` | CRUD. `createDay` whitelists `event_id, day_number, day_name, day_name_ar, day_date`. | `event_days` | row / row / `{success}`. T. `updateDay` has verbose error logging. |
| `getAgendaSlots` (821) | `dayId` | Slots by `sort_order`. | `agenda_slots` | array. T |
| `createSlot` (830) / `updateSlot` (850) / `deleteSlot` (860) | slot fields / `slotId`,`updates` / `slotId` | CRUD; `createSlot` whitelists and defaults (`sort_order 999`, bullet arrays). **Names collide with `mentorBooking.js` `createSlot/updateSlot/deleteSlot`** (different tables). | `agenda_slots` | row / row / `{success}`. T |
| `updateSlotsOrder` (2320) | `slots[]` | Splits slots into new (no `slot_id` or `temp-` prefix -> `insert`) and existing (`upsert`); strips `isOptimistic`. Log text says "Revise Split Logic". | `agenda_slots` | `{inserted, upserted}`. T |
| `assignEventToProgram` (2461) | `eventId`, `programId|null` | Sets `events.program_id`. | `events` | row. T |

### 3.3 Experts, master experts, companies

| Function (line) | Params | Behaviour | Touches | Returns / errors |
|---|---|---|---|---|
| `getMasterExperts` (523) | - | All master experts by `name` + second query on `experts` joined `events(event_id,event_name)` to compute `linked_events` (virtual field). Cached. | `master_experts`, `experts`, `events` | array with `linked_events`. T (second query error ignored). |
| `updateMasterExpert` (555) | `id`, `data` | Strips `linked_events` and `id`; updates master; then **pushes profile fields to every `experts` row with the same `master_id`** (ignoring result/error, 578). | `master_experts`, `experts` | updated master row. T |
| `deleteMasterExpert` (586) | `id` | Sets `experts.master_id = null` for linked rows, then deletes master. | `experts`, `master_experts` | `{success}`. T |
| `createExpert` (605) | expert fields incl. `master_id?`, `event_id`, `sort_order` | If no `master_id`: find master by exact `name` (`maybeSingle`), update it with provided data if found (calls `updateMasterExpert`, which also re-syncs all linked experts) else insert new master. Re-fetches master, inserts event-specific `experts` row copying master profile fields (denormalised), returns flattened row. | `master_experts`, `experts` | flattened expert. T |
| `updateExpert` (675) | `expertId`, `expertData` | Updates local expert profile columns (`maybeSingle`), then (if `master_id`) pushes profile to master via `updateMasterExpert` (non-fatal try/catch). `display_config`, `event_id`, `rest` destructured and discarded (unused). | `experts`, `master_experts` | local row or `null`. T for local, S for master sync. |
| `deleteExpert` (725) | `expertId` | Delete by `expert_id`. | `experts` | `{success}`. T |
| `bulkUpdateExperts` (2370) | `updates[{expert_id|id, sort_order}]` | Validates all have ids, then one `update` per row via `Promise.all`; throws first error. | `experts` | void. T |
| `createCompany` (733) / `updateCompany` (742) / `deleteCompany` (752) | data / `companyId`,`updates` / `companyId` | Raw pass-through CRUD (no whitelisting on create/update). | `companies` | row / row / `{success}`. T |
| `bulkUpdateCompanies` (2396) | `updates[{company_id|id, sort_order}]` | Single `upsert(..., {onConflict:'company_id'})` with only `company_id, sort_order` (an upsert of partial rows; would insert if id missing). | `companies` | void. T |
| `importAgendaData` (953) | `eventId`, `data{experts,companies}`, `previewOnly=false` | Differential sync from sheet data: match by normalised `name`, compare fields, add/update/skip; preview mode returns `changes` without writing. Despite name/docblock ("days and slots") it only syncs experts and companies (days/slots sections absent; numbering jumps "1. SYNC EXPERTS" to "4. SYNC COMPANIES", 974, 1025); `stats.days/slots` and `changes.slots` always remain zero/empty. Writes ignore per-row errors (no `error` check on inserts/updates). | `experts`, `companies` | `{success, stats, changes}`. T (outer catch rethrows) |
| `syncEventFromCloud` (1090) | `eventId`, `previewOnly` | `getEvent` -> requires `events.gsheets_url` -> `fetchAndParseGoogleSheet` (excel.js; plain `fetch` to `docs.google.com/.../export?format=xlsx`) -> `importAgendaData`. | events (+ external Google Docs export) | `importAgendaData` result. T |

### 3.4 Library resources (agenda "Resources Library")

| Function (line) | Params | Behaviour | Touches | Returns |
|---|---|---|---|---|
| `getLibraryResources` (901) | `identifier?` | Resolves slug; returns rows where `event_id = X OR is_central = true`, or only central if no id. Cached `library_resources_<id|global>`. | `library_resources`, events | array. T |
| `createLibraryResource` / `updateLibraryResource` / `deleteLibraryResource` (917/926/936) | data / `resourceId`,`updates` / `resourceId` | CRUD by `resource_id`. | `library_resources` | row/row/`{success}`. T |
| `getLibraryData` (944) | `eventId` | Wraps `getLibraryResources` as `{resources}`. Cached again under `library_data_<id>`. | `library_resources` | `{resources}` |

### 3.5 Storage

| Function (line) | Params | Behaviour | Touches | Returns |
|---|---|---|---|---|
| `uploadImage` (871) | `file`, `path='covers'` | Random name `<rand>_<Date.now()>.<ext>`, sanitises `path` segments, uploads to bucket **`event-assets`**, returns public URL. No size/type validation, no deletion counterpart anywhere in api.js. | storage bucket `event-assets` | public URL string. T on upload error. Used by 13 components. Bucket `event-assets` is also used directly in `components/alumni/CertificateGenerator.jsx:133-138`. |

### 3.6 Legacy registration portals (company/expert) and submissions

| Function (line) | Params | Behaviour | Touches | Returns |
|---|---|---|---|---|
| `getFormConfig` (1114) | `eventId` (UUID or slug), `entityType` ('company'/'expert'/...) | Finds first `event_forms` row with `target_module=entityType` (ordered `created_at`), reads `form_field_configs` filtered by `event_id`, `entity_type` (+ `form_id` if found); returns `getDefaultFormConfig(entityType)` if none. | `event_forms`, `form_field_configs` | array of field configs. T (form lookup errors ignored) |
| `saveFormConfig` (1160) | `eventId`, `entityType`, `fields[]` | Find or create "Default {Expert|Startup} Form"; **delete** all `form_field_configs` for event+entity(+form), then insert with `display_order = idx`. `newForm` insert error ignored. | `event_forms`, `form_field_configs` | inserted rows. T on final insert only |
| `getDefaultFormConfig` (1398, **not exported**) | `entityType` | Hard-coded default fields for `company` (startup_name, logo_url, industry, location) and `expert` (expert_name, photo_url, title, company, bio); `[]` otherwise. | - | array |
| `submitCompanyRegistration` (1221) | `eventId`, `formData` | Inserts `company_submissions` (`startup_name, logo_url, industry, location, additional_data`, `status:'screening'`). | `company_submissions` | row. T |
| `submitExpertRegistration` (1249) | `eventId`, `formData` | Inserts `expert_submissions` (`expert_name, photo_url, title, company, bio, additional_data`, `status:'pending'`). | `expert_submissions` | row. T |
| `getSubmissions` (1279) | `eventId`, `entityType`, `status='all'` | Picks table by entityType (`company` -> `company_submissions`, otherwise `expert_submissions`); order `submitted_at` desc. | `company_submissions` / `expert_submissions` | array. T |
| `approveSubmission` (1301) | `submissionId`, `entityType` | Reads submission, maps to `companies` row (spreading `additional_data` into the row) or calls `createExpert(...)` (master linking) for experts; then sets submission `status='approved'`, `reviewed_at`. `targetData` for experts is built (1326-1334) but unused on the expert path. | `company_/expert_submissions`, `companies`, `experts`, `master_experts` | updated submission. T |
| `rejectSubmission` (1377) | `submissionId`, `entityType`, `reason` | Sets `status='rejected'`, `reviewed_at`, `rejection_reason`. | submissions table | row. T |
| `updateSubmissionStatus` (2305) | `submissionId`, `newStatus`, `additionalUpdates` | **Company submissions only**: generic status update, sets `reviewed_at` only for approved/rejected (else `null`). Overlaps with `rejectSubmission` (company branch). | `company_submissions` | row. T |
| `extractPrimaryEmail` (2028) | `additionalData` | Heuristic email extraction from a submission's `additional_data` using `_column_order`, Arabic/English header keywords, excluding "second member". Pure function. | - | string or null. Used by SelectionProcessManager. |
| `extractDynamicSheetFields` (2094) | `row`, `headers` | Heuristic header-keyword extraction (timestamp, founder name, company name, email, national id, phone) in AR/EN. Pure. | - | object. **Unused outside api.js** (1 internal ref, 2222). |
| `syncSubmissionsFromSheet` (2186) | `eventId`, `url` | `fetchAndParseGenericGoogleSheet(url)`; picks sheet named one of `total responces` (sic), `total responses`, `selection prosses` (sic), `selection process`, `responses`, `form responses 1`, else first sheet; per row extracts fields, finds an existing `company_submissions` of the same event by priority national_id > email > phone > company+founder name, then update or insert (`status:'screening'`). Row-level errors are logged and skipped. | `company_submissions` | `{success,count,inserted,updated}`. T for fetch/parse. |

### 3.7 Multi-form engine (`event_forms`, `form_field_configs`, `form_covers`, `form_responses`, `form_share_events`)

| Function (line) | Params | Behaviour | Touches | Returns |
|---|---|---|---|---|
| `getEventForms` (1499) | `eventId` | Forms by `created_at` asc. | `event_forms` | array. T |
| `createEventForm` (1512) | `eventId`, `formName`, `targetModule` | Inserts form then seeds `form_field_configs` from `getDefaultFormConfig(targetModule)`. | `event_forms`, `form_field_configs` | form row. T |
| `updateEventForm` (1543) | `formId`, `updates` | Update + `updated_at`. | `event_forms` | row. T |
| `deleteEventForm` (1556) | `formId` | Delete (relies on DB cascade, comment 1554). | `event_forms` | `{success}` |
| `getFormConfigById` (1567) | `formId` | Fields ordered by `display_order`, normalising `description`/`help_text`/`section_id` from either column or `validation_rules.*` (1574-1578). | `form_field_configs` | array. T |
| `saveFormConfigById` (1585) | `formId`, `eventId`, `targetModule`, `fields[]` | Delete all fields of form then bulk insert a cleaned subset (writes `description` and `section_id` only inside `validation_rules`, and `help_text`). Returns normalised rows. | `form_field_configs` | array. T |
| `getEventFormById` (1648) | `formId` | `event_forms` with `form_covers(*)` embed. | `event_forms`, `form_covers` | row. T |
| `duplicateEventForm` (1802) | `formId` | Clones form (name suffix `(نسخة)`, `is_active:true`, cover/thank-you/share/integrations copied) + fields (`help_text`, `validation_rules` copied verbatim). `library_form_id` is **not** copied. | `event_forms`, `form_field_configs` | cloned form. T |
| `getEventCovers` / `createFormCover` / `updateFormCover` / `deleteFormCover` (1662/1672/1682/1693) | `eventId` / `eventId,name,imageUrl` / `coverId,updates` / `coverId` | CRUD on covers. | `form_covers` | array/row/row/`{success}`. `updateFormCover` is **unused** by components. |
| `getFormResponses` (1706) / `getEventFormsResponses` (1716) | `formId` / `eventId` | All responses newest first (no pagination: fetches `*`). | `form_responses` | array. T |
| `deleteFormResponse` (1726) / `updateFormResponseStatus` (1735) | `responseId` / `responseId,status` | Delete / update status + `updated_at`. | `form_responses` | `{success}` / row |
| `trackFormShareEvent` (1750) | `formId`, `platform` | Inserts share click with `navigator.userAgent`. | `form_share_events` | row or `null`. S (error only logged; returns `data` which is null on error). |
| `getFormShareEvents` (1769) / `getEventShareEvents` (1779) | `formId` / `eventId` | Click lists; the event variant first loads form ids of the event then `in('form_id', ids)`. | `form_share_events`, `event_forms` | array. T |
| `submitToForm` (1879) | `formId`, `eventId`, `targetModule`, `formData`, `trackingMeta={}` | The unified public submission path (see 3.7.1). | `form_responses`, `event_forms`, then integration tables | `primaryResponse` row or `{success:true}`. S |
| `getFormSections` (2889) | `formId` | Returns `event_forms.integrations.form_sections` if non-empty; else tries relational `form_sections` ordered by `order_index`; else `[]`. All S. | `event_forms`, `form_sections` | array |
| `saveFormSections` (2924) | `formId`, `sections[]` | Writes sections into `event_forms.integrations.form_sections` (read-modify-write of whole `integrations` JSON); then, only if a probe select on `form_sections` succeeds, deletes + re-inserts rows (ids starting `sec_` dropped so DB generates). All errors swallowed. | `event_forms`, `form_sections` | the `sections` input |
| `deleteFormSection` (2983) | `sectionId`, `formId` | Removes from JSON and (if table exists) from `form_sections`. **Unused.** | same | `{success}` |

#### 3.7.1 `submitToForm` internals (api.js:1879-2025)
1. Derives `source` = `trackingMeta.source || formData.source || formData.utm_source || 'direct'`.
2. Sanitises phone answers: any string value whose **key contains** `phone`, `tel`, `mobile` or equals `whatsapp` is passed through `validatePhoneNumber(val)` (default countries EG/SA/AE) and replaced by the E.164 value if valid (1886-1892). (Substring `tel` matches e.g. `hotel`, `intellectual_property`.)
3. Looks up `event_forms.library_form_id` (errors swallowed) and inserts into `form_responses` with `tracking_data` (utm_*/channel/ref plus `...trackingMeta`), `answers`, `status:'submitted'`. Insert failures are only logged.
4. Fire-and-forget IIFE (not awaited) that: loads form meta via `getEventFormById`; then runs optional integrations driven by `event_forms.integrations` flags:
   * `google_sheets` + `google_sheets_url` -> `appendFormResponseToSheet` (googleSheets.js, client-side Google API call).
   * `selection_process` -> inserts into `company_submissions` (`startup_name` derived from `startup_name | company_name | first key | 'Applicant'`).
   * `companies_list` -> inserts into `companies` (name from `company_name|startup_name|name`).
   * `mentors_list` or `attendees_list` -> inserts into `experts` (title default `'Mentor'`, writes `email` column).
   * `targetModule === 'alumni_annual_update'` and `answers.company_id` present -> `createSnapshotFromFormResponse(...)` (3663).
5. Returns before integrations finish; integration failures are not surfaced to the caller. These inserts bypass `createExpert` (no master linking) unlike `approveSubmission`.

### 3.8 Programs

| Function (line) | Params | Touches | Notes |
|---|---|---|---|
| `getPrograms` (2413) | - | `programs` | cached `programs`; `created_at` asc. T |
| `createProgram` (2426) | `name`, `description=''` | `programs` | trims name. T |
| `updateProgram` (2440) / `deleteProgram` (2451) | `programId`,... | `programs` | delete relies on `events.program_id ON DELETE SET NULL` (comment 2452). |

### 3.9 Central form library (`library_forms`) and import/export of forms

| Function (line) | Params | Behaviour | Touches |
|---|---|---|---|
| `getLibraryForms` (2482) | `{scope, eventId}` | `scope` filter, or when `eventId` given `scope.eq.global OR (scope.eq.specific AND event_id.eq.X)` via `.or()` string interpolation. | `library_forms` |
| `getLibraryFormById` (2505) | `id` | single. Used internally only. | `library_forms` |
| `createLibraryForm` (2519) | payload | Inserts with many defaults (default `social_channels_config` with 5 channels, `integrations` with 3 flags, `import_count:0`). | `library_forms` |
| `updateLibraryForm` (2568) / `deleteLibraryForm` (2591) / `duplicateLibraryForm` (2604) | ... | update forces `event_id=null` if scope global; duplicate clones via `createLibraryForm` with `(Copy)` / `(نسخة)` suffix (English and Arabic suffix style differ from `duplicateEventForm`, which uses only `(نسخة)`). | `library_forms` |
| `saveProjectFormToLibrary` (2618) | `formId`, `{scope,eventId,formName,formNameAr,description}` | Reads project form + fields and writes a portable template to `library_forms.fields`. | `event_forms`, `form_field_configs`, `library_forms` |
| `importFormFromLibrary` (2666) | `{libraryFormId,eventId,importMode='blank_copy'|'with_history',reLinkModule,googleSheetsUrl}` | Creates `event_forms` row, recomputes integration flags from `reLinkModule`, saves fields through `saveFormConfigById`, for `with_history` copies all `form_responses` having that `library_form_id`, and increments `library_forms.import_count` (read-modify-write, not atomic). | `library_forms`, `event_forms`, `form_field_configs`, `form_responses` |
| `getLibraryFormResponses` (2777) | `libraryFormId` | All responses across projects + event titles from `events.title`. S (returns `[]`). | `form_responses`, `events` |
| `getLibraryAnalytics` (2815) | - | Client-side aggregation over entire `library_forms`, `event_forms`, `form_responses`, `events` tables. S (returns zeros). | same |

### 3.10 Join Athar module

| Function (line) | Params | Behaviour | Touches |
|---|---|---|---|
| `getJoinAtharPage` (3028) | `projectId` (UUID/slug) | Page by `project_id` (`maybeSingle`), then cards (`order_index`) and share presets; presets reduced to `{platform: preset_message}`. | `join_athar_pages`, `join_athar_cards`, `join_athar_share_presets` (+events) |
| `saveJoinAtharPage` (3069) | `projectId`, `{...fields, cards, presets}` | Upsert page (`onConflict:'project_id'`); if `cards` is an array: **delete all cards of page then insert** (delete error ignored, 3095); presets upsert `onConflict:'page_id,platform'`; `clearApiCache()`; returns reloaded page. | same |
| `trackJoinAtharEvent` (3130) | `pageId`, `eventType`, `cardId`, `platform` | Insert analytics row; errors fully swallowed. | `join_athar_analytics` |
| `getJoinAtharAnalytics` (3145) | `pageId` | Counts `tab_view`, `card_share`, `image_upload`, `image_download`, by platform/card, `conversionRate` = downloads/tab views; `recentEvents` 50. | `join_athar_analytics` |

### 3.11 Alumni & Impact platform

**Founders and links**

| Function (line) | Params | Touches | Notes |
|---|---|---|---|
| `getFounders` (3200) | - | `founders` | cached `founders`, ordered `name_ar`. |
| `getFounderById` (3209) | `founderId` | `founders`, `company_founders`, `companies` | **unused**. |
| `createFounder` (3219) / `updateFounder` (3229) / `deleteFounder` (3240) | ... | `founders` | `deleteFounder` **unused**. |
| `getCompanyFounders` (3251) | `companyId` | `company_founders`, `founders` | primary first. |
| `linkFounderToCompany` (3261) | `founderId`, `companyId`, `role='founder'`, `isPrimary=false` | `company_founders` | upsert `onConflict:'company_id,founder_id'`; writes `role` only (not `role_in_company`) while `createFounderCompany` writes both (4313-4314). |
| `unlinkFounderFromCompany` (3272) | ids | `company_founders` | |
| `getFounderProfileByAuth` (3990) | `authUserId`, `userEmail` | `founders` (+company_founders, companies) | lookup by `auth_user_id`, fallback by lowercase email; on email match **writes back** `auth_user_id` (self-healing link, 4010). |
| `getFounderPrograms` (4335) | `founderId` | `company_founders`, `program_participations` (+programs, events, companies) | S |
| `getFounderNotifications` (4358) / `markAllNotificationsAsRead` (4373) | `authUserId` | `notifications` | `recipient_id = me OR recipient_id IS NULL`; mark-read updates only `recipient_id = me` (broadcast rows with null recipient are never marked). S |
| `updateFounderCompanyWithSnapshot` (4252) | `companyId`, `updatedFields`, `source='founder'` | `companies`, `company_snapshots` | Snapshots the **pre-update** company row as `snapshot_type:'founder_update'`, then updates (snapshot failure only warns). |
| `createFounderCompany` (4293) | `{founderId, companyData}` | `companies`, `company_founders`, `company_snapshots` | Insert with `is_alumni:true` and client-set `created_at` (the `companies` type in `database.types.ts` has no `created_at` column), link as primary, initial snapshot `founder_create`. |
| `updateAlumniCompany` (4023) | `companyId`, `updates` | `companies` | **unused**; functionally identical to `updateCompany` (742) plus `clearApiCache`. |

**Participations, snapshots, certificates, opportunities, investors**

| Function (line) | Touches | Notes |
|---|---|---|
| `getProgramParticipations` (3284) | `program_participations` (+programs, events) | used internally only (in `getAlumniCompanyProfile`). |
| `getCompaniesInProgram` (3294), `createParticipation` (3307), `updateParticipationStatus` (3318), `deleteParticipation` (3331) | `program_participations` | **all unused** by components (no UI writes participations through api.js). |
| `getCompanySnapshots` (3343), `getLatestSnapshot` (3353, unused), `createSnapshot` (3368), `compareSnapshots` (3386) | `company_snapshots` | Append-only by convention (comment 3340-3341); `compareSnapshots` diffs hard-coded numeric keys `revenue_sar, employees_count, jobs_created, funding_raised_sar`. |
| `createSnapshotFromFormResponse` (3663) | `form_responses`, `company_snapshots` | Used only from `submitToForm`. |
| `getCertificates` (3409), `verifyCertificate` (3419), `issueCertificate` (3429, unused), `updateCertificatePdfUrl` (3439) | `certificates` (+programs, events, founders) | `issued_by` default `'Athar'`. Verification is a public select by `verification_code`. |
| `getOpportunities` (3452) | `opportunities` | cached key includes `JSON.stringify(filters)`; always filters `is_active=true`; `filters.type`, `filters.upcoming` (deadline >= today). |
| `createOpportunity` (3467), `updateOpportunity` (3478, unused), `deleteOpportunity` (3490, unused) | `opportunities` | |
| `getOpportunityApplications` (3502), `getCompanyApplications` (3512), `applyToOpportunity` (3522), `updateApplicationStatus` (3532) | `opportunity_applications` | `applyToOpportunity` upserts `onConflict:'opportunity_id,company_id'` and resets `status:'applied'` and `applied_at` on re-apply. |
| `submitInvestorRequest` (3547); `getInvestorRequests` (3557, unused); `updateInvestorRequestStatus` (3568, unused) | `investor_requests` | admin side of investor requests has no UI consumers. |

**Alumni lists / stats**

| Function (line) | Behaviour | Touches |
|---|---|---|
| `getAlumniCompanies` (3581) | Companies where `is_alumni=true` with founders; filters `sector` (applied to column **`industry`**), `stage`, `province`, `program_id` (pre-query on `program_participations`). Cached. | `companies`, `company_founders`, `founders`, `program_participations` |
| `getImpactStats` (3607) | Alumni companies + all snapshots + all certificates; latest snapshot per company; sums `revenue_sar`, `jobs_created`, `funding_raised_sar` (snapshot keys). Returns strings via `toFixed` for rates. T for companies, others ignored. | `companies`, `company_snapshots`, `certificates` |
| `getAlumniCompanyProfile` (3644) | Parallel: company + `getCompanyFounders` + `getProgramParticipations` + `getCompanySnapshots`. | several |
| `getUniqueAlumniCompanies` (3902) | **All** companies (no `is_alumni` filter) + all invitations + all participations; computes `foundersCount`, `programsCount`, `inviteStatus` (`not_invited|invited|joined`), filters `status/sector/search`. Used internally by `getAlumniAdminStats` (itself unused), so effectively **dead**. | `companies`, `company_founders`, `founders`, `alumni_invitations`, `program_participations`, `programs` |
| `getAlumniAdminStats` (3975) | Counts built on `getUniqueAlumniCompanies`. **Unused.** | same |

**Invitations**

| Function (line) | Behaviour | Touches |
|---|---|---|
| `validateInvitationToken` (3684) | Loads invitation by `token` with nested companies/participations/programs; statuses `accepted` -> `already_used`, `expired`; computes **14-day expiry from `sent_at`** (hard-coded 3705) and marks it `expired` in DB (write from an unauthenticated flow). Returns `{valid, reason?, invitation?}` (never throws). | `alumni_invitations` |
| `sendAlumniInvitation` (3717) | Inserts invitation with token = `crypto.randomUUID()` with dashes removed (fallback timestamp+random), builds link `<origin>/#/alumni/signup?token=<t>` (hash-router URL, 3741). **Does not send any email**; only creates the DB row and returns `inviteLink`. | `alumni_invitations` |
| `resendAlumniInvitation` (3746) | Regenerates token (same method), sets status `pending`, new `sent_at`, returns link. No email. | `alumni_invitations` |
| `acceptInvitation` (3770) | Validates token; `auth.signUp` (role metadata `founder`); finds founder by email -> update or insert (`name_ar` and `name_en` both set to `fullName`); `linkFounderToCompany(..., 'Founder', true)` (note capital `F`, vs default `'founder'` elsewhere); marks invitation `accepted`. | `alumni_invitations`, Auth, `founders`, `company_founders` |
| `inviteCoFounder` (3855) | Blocks if email already linked to company; reuses pending invite (resend) else sends new. | `company_founders`, `founders`, `alumni_invitations` |
| `getAlumniInvitations` (3889) | Invitation list (optionally per company), ordered `sent_at`. **Unused.** | `alumni_invitations`, `companies` |
| `getAlumniInvitationsList` (4504) | Paginated (`page`,`limit`=15) list with status and email `ilike` search, ordered **`created_at`**; S. Used by AlumniInvitationsPage. | `alumni_invitations`, `companies`, `founders` |
| `getUnregisteredFounders` (4539) | Founders with `auth_user_id IS NULL`. S | `founders` |
| `sendBulkAlumniInvitations` (4555) | Sequential per-invite insert; token is `crypto.randomUUID()` **with dashes** (unlike 3720 which strips dashes); returns per-item results; progress callback. No link returned. | `alumni_invitations` |
| `revokeAlumniInvitation` (4594) | Sets status `revoked`. (Status `revoked` is not handled in `validateInvitationToken` or in `getUniqueAlumniCompanies` / dashboard counts, which only know pending/accepted/expired.) | `alumni_invitations` |

**Manager (phase 2) analytics and notifications**

| Function (line) | Behaviour | Touches |
|---|---|---|
| `getAlumniManagerDashboardStats` (4387) | Head-count queries for founders with/without `auth_user_id`, companies; snapshots last 30 days (unique companies); invitation status counts + response rate. S -> zeros. | `founders`, `companies`, `company_snapshots`, `alumni_invitations` |
| `getAlumniManagerChartsData` (4439) | Registrations per month (12 months), sector and province distribution (uses `companies.sector`, `companies.province`). S | `founders`, `companies` |
| `sendManagerBroadcastNotification` (4607) | Builds one `notifications` row per target founder for audience `all | founder | company | program` (shared `broadcast_id`), fallback single row without recipient. | `founders`, `company_founders`, `program_participations`, `companies`, `notifications` |
| `getAlumniManagerNotificationsLog` (4740) | Last 300 notifications grouped by `broadcast_id` (or id) with read counts. S | `notifications`, `founders` |
| `getAlumniFilterOptions` (4786) | Programs, distinct sectors/provinces/years; hard-coded stage list `['Idea','MVP','Early Traction','Growth','Scale','Matured']`. S | `programs`, `companies` |
| `getAlumniPlatformAnalytics` (4824) | Loads **all companies** with nested participations/programs/snapshots, filters client-side (`sector`, `province`, `programId`, `year`, `stage`), computes active/inactive, revenue, jobs, survival at 6/12/24 months from `pp.graduation_date`, revenue timeline, province distribution; **falls back to hard-coded survival percentages 94/86/74 when no eligible data exists and companies > 0** (4933-4935). Reads snapshot keys `revenue|annual_revenue`, `employees|team_size|jobs_created`. S | `companies`, `program_participations`, `programs`, `company_snapshots` |

### 3.12 Roles, profiles, project managers

| Function (line) | Params | Behaviour | Touches |
|---|---|---|---|
| `getUserRoles` (4037) | `userId` | Cached (storage-based, 60 s) read of `user_roles.role`, unique array. S -> `[]`. | `user_roles` |
| `assignUserRole` (4079) | `userId`, `roleName` | Upsert `{user_id, role}` with `onConflict:'user_id'` ("one role per user", comment 4081). **Unused** by components (AuthContext/UI do not call it). | `user_roles` |
| `removeUserRole` (4098) | `userId` | Deletes all roles of user. **Unused.** | `user_roles` |
| `getUserProfile` (4113) / `updateUserProfile` (4128) | `userId`(,`updates`) | `profiles` select `*` / update + `updated_at`. | `profiles` |
| `getProjectManagers` (4147) | `eventId` | `project_managers` for event, then separate `profiles` query merged client-side into `profile`. S | `project_managers`, `profiles` |
| `assignProjectManager` (4175) | `{eventId,userId,roleInProject='collaborator',assignedBy}` | Insert writing **both** `event_id` and `project_id`, `assigned_by` and `added_by`, `assigned_at` and `added_at` (duplicate legacy/new column pairs). | `project_managers` |
| `updateProjectManagerRole` (4196) / `removeProjectManager` (4210) | | by `event_id`+`user_id` | `project_managers` |
| `getAllEligibleProjectManagers` (4222) | - | `user_roles` with role in (`project_manager`,`super_admin`) + `profiles`, merged. S | `user_roles`, `profiles` |

---

## 4. Direct fetches / external services

| Where | Target | Mechanism | Notes |
|---|---|---|---|
| `api.js:9` | Edge Function `process-booking` | `supabase.functions.invoke` (user JWT attached automatically) | Named "GoogleAppsScript" in JS; the function itself lives in `supabase/functions/process-booking/index.ts`. A function directory `supabase/functions/notify-google-apps-script` also exists but **nothing in `src/` references it** (grep). |
| `api.js:1097` via `excel.js:407-432` | `https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx` | Browser `fetch`, no auth (sheet must be public/link-shared) | Used by `syncEventFromCloud`. |
| `api.js:2188` via `excel.js:352-385` | same export URL | Browser `fetch` | Used by `syncSubmissionsFromSheet`. Spreadsheet-ID regex is duplicated 3x (excel.js:353, 409; googleSheets.js:10). |
| `api.js:1946` -> `googleSheets.js:165-234` | `https://oauth2.googleapis.com/token`, `https://sheets.googleapis.com/v4/spreadsheets/<id>/values/A1:append` | Browser `fetch` with a self-signed service-account JWT | See section 6.1. |
| `api.js:882` | Supabase Storage bucket `event-assets` | `supabase.storage` | Only bucket used by api.js. |
| Not in api.js | `generate-google-meet` (MentorBookingAdmin.jsx:98, AtherTeamBookingAdmin.jsx:57), `send-interview-invitations`, `send-rejection-emails`, `send-acceptance-emails` (SelectionProcessManager.jsx:458, 483, 508, 551) | Components call `supabase.functions.invoke` directly | Email sending for invitations (alumni) does not exist in api.js at all. |

No `fetch()` appears in `api.js` itself. There is no `.rpc()` call in `api.js` (the DB functions `has_role`, `is_project_manager`, `is_project_owner`, `is_super_admin`, `get_user_roles` listed in `database.types.ts:2541-2553` are not invoked from this layer).

---

## 5. Usage map (components -> api functions)

Generated by statically parsing all `import {...} from '.../api'` statements in `src/**` (59 importing files: 56 components, `AuthContext.jsx`, `mentorBooking.js`, `atherTeamBooking.js`; no `import * as`, no dynamic `import()`). "Internal refs" = additional occurrences inside api.js. Caveat: it records imports, not call sites; an imported-but-uncalled name would still count as used.

| Export (line) | Imported by | Internal refs in api.js |
|---|---|---|
| `notifyGoogleAppsScript` (L7) | lib/atherTeamBooking.js, lib/mentorBooking.js | 2 |
| `getShareUrl` (L35) | **none** | 0 |
| `clearApiCache` (L43) | **none** | 13 |
| `getEvents` (L81) | Dashboard.jsx, FormLibraryManager.jsx | 2 |
| `isUUID` (L96) | **none** | 8 |
| `getEventSlug` (L98) | Dashboard.jsx, EventBuilder.jsx, EventDashboard.jsx, EventVisualManager.jsx | 0 |
| `getEvent` (L112) | CompanyPortal.jsx, EventBuilder.jsx, EventDashboard.jsx, EventVisualManager.jsx, ExpertManager.jsx, ExpertPortal.jsx, ExpertViewer.jsx, GenericFormPortal.jsx, PublicLayout.jsx, SelectionProcessManager.jsx, StartupViewer.jsx | 10 |
| `getFullAgenda` (L175) | AgendaViewer.jsx | 2 |
| `getExperts` (L227) | AgendaViewer.jsx, ExpertManager.jsx, ExpertViewer.jsx | 0 |
| `getCompanies` (L248) | StartupManager.jsx, StartupViewer.jsx | 0 |
| `getAgendaTabs` (L263) | EventDashboard.jsx | 0 |
| `getStartups` (L298) | CompaniesPage.jsx | 0 |
| `createEvent` (L306) | Dashboard.jsx | 1 |
| `updateEvent` (L336) | EventBuilder.jsx, EventDashboard.jsx, EventVisualManager.jsx, ExpertManager.jsx, SelectionProcessManager.jsx | 0 |
| `deleteEvent` (L346) | Dashboard.jsx | 0 |
| `duplicateEvent` (L354) | EventDashboard.jsx | 0 |
| `getMasterExperts` (L523) | ExpertManager.jsx, MasterExpertsList.jsx, MentorBookingAdmin.jsx | 1 |
| `updateMasterExpert` (L555) | MasterExpertsList.jsx | 2 |
| `deleteMasterExpert` (L586) | MasterExpertsList.jsx | 0 |
| `createExpert` (L605) | ExpertManager.jsx | 2 |
| `updateExpert` (L675) | ExpertManager.jsx | 1 |
| `deleteExpert` (L725) | ExpertManager.jsx | 0 |
| `createCompany` (L733) | StartupManager.jsx | 0 |
| `updateCompany` (L742) | StartupManager.jsx | 0 |
| `deleteCompany` (L752) | StartupManager.jsx | 0 |
| `getEventDays` (L764) | EventBuilder.jsx | 0 |
| `createDay` (L773) | EventBuilder.jsx | 0 |
| `updateDay` (L788) | EventBuilder.jsx | 1 |
| `deleteDay` (L809) | EventBuilder.jsx | 0 |
| `getAgendaSlots` (L821) | EventBuilder.jsx | 0 |
| `createSlot` (L830) | EventBuilder.jsx | 0 |
| `updateSlot` (L850) | EventBuilder.jsx | 0 |
| `deleteSlot` (L860) | EventBuilder.jsx | 0 |
| `uploadImage` (L871) | alumni/AlumniSignupPage.jsx, alumni/FounderProfilePage.jsx, CompanyPortal.jsx, EventBuilder.jsx, EventVisualManager.jsx, ExpertManager.jsx, ExpertPortal.jsx, forms/CoverLibraryModal.jsx, forms/FormSettingsTab.jsx, GenericFormPortal.jsx, JoinAtharDashboard.jsx, LibraryManager.jsx, StartupManager.jsx | 0 |
| `getLibraryResources` (L901) | LibraryManager.jsx | 1 |
| `createLibraryResource` (L917) | LibraryManager.jsx | 0 |
| `updateLibraryResource` (L926) | LibraryManager.jsx | 0 |
| `deleteLibraryResource` (L936) | LibraryManager.jsx | 0 |
| `getLibraryData` (L944) | LibraryViewer.jsx | 1 |
| `importAgendaData` (L953) | EventBuilder.jsx | 1 |
| `syncEventFromCloud` (L1090) | EventBuilder.jsx, SyncButton.jsx | 1 |
| `getFormConfig` (L1114) | CompanyPortal.jsx, ExpertManager.jsx, ExpertPortal.jsx, ExpertViewer.jsx, StartupManager.jsx, StartupViewer.jsx | 0 |
| `saveFormConfig` (L1160) | ExpertManager.jsx, StartupManager.jsx | 0 |
| `submitCompanyRegistration` (L1221) | CompanyPortal.jsx | 0 |
| `submitExpertRegistration` (L1249) | ExpertPortal.jsx | 0 |
| `getSubmissions` (L1279) | ExpertManager.jsx, SelectionProcessManager.jsx, StartupManager.jsx, SubmissionAnalytics.jsx | 0 |
| `approveSubmission` (L1301) | ExpertManager.jsx, StartupManager.jsx | 0 |
| `rejectSubmission` (L1377) | ExpertManager.jsx, StartupManager.jsx | 0 |
| `getEventForms` (L1499) | FormEditor.jsx, forms/GlobalFormsAnalytics.jsx | 0 |
| `createEventForm` (L1512) | FormEditor.jsx | 0 |
| `updateEventForm` (L1543) | FormEditor.jsx, forms/FormIntegrationsTab.jsx, forms/FormSettingsTab.jsx, forms/SourceTrackingToolbar.jsx | 0 |
| `deleteEventForm` (L1556) | FormEditor.jsx | 0 |
| `getFormConfigById` (L1567) | FormEditor.jsx, GenericFormPortal.jsx | 2 |
| `saveFormConfigById` (L1585) | FormEditor.jsx | 1 |
| `getEventFormById` (L1648) | GenericFormPortal.jsx | 2 |
| `getEventCovers` (L1662) | forms/CoverLibraryModal.jsx | 0 |
| `createFormCover` (L1672) | forms/CoverLibraryModal.jsx | 0 |
| `updateFormCover` (L1682) | **none** | 0 |
| `deleteFormCover` (L1693) | forms/CoverLibraryModal.jsx | 0 |
| `getFormResponses` (L1706) | forms/FormAnalyticsTab.jsx, forms/FormClicksAnalyticsTab.jsx, forms/FormResponsesTab.jsx | 0 |
| `getEventFormsResponses` (L1716) | forms/GlobalFormsAnalytics.jsx | 0 |
| `deleteFormResponse` (L1726) | forms/FormResponsesTab.jsx | 0 |
| `updateFormResponseStatus` (L1735) | forms/FormResponsesTab.jsx | 0 |
| `trackFormShareEvent` (L1750) | GenericFormPortal.jsx | 0 |
| `getFormShareEvents` (L1769) | forms/FormClicksAnalyticsTab.jsx | 0 |
| `getEventShareEvents` (L1779) | forms/GlobalFormsAnalytics.jsx | 0 |
| `duplicateEventForm` (L1802) | FormEditor.jsx | 0 |
| `submitToForm` (L1879) | GenericFormPortal.jsx | 0 |
| `extractPrimaryEmail` (L2028) | SelectionProcessManager.jsx | 1 |
| `extractDynamicSheetFields` (L2094) | **none** | 1 |
| `syncSubmissionsFromSheet` (L2186) | SelectionProcessManager.jsx | 1 |
| `updateSubmissionStatus` (L2305) | SelectionProcessManager.jsx | 0 |
| `updateSlotsOrder` (L2320) | EventBuilder.jsx | 1 |
| `bulkUpdateExperts` (L2370) | ExpertManager.jsx | 0 |
| `bulkUpdateCompanies` (L2396) | StartupManager.jsx | 0 |
| `getPrograms` (L2413) | alumni/AlumniDirectory.jsx, Dashboard.jsx | 1 |
| `createProgram` (L2426) | Dashboard.jsx | 1 |
| `updateProgram` (L2440) | Dashboard.jsx | 0 |
| `deleteProgram` (L2451) | Dashboard.jsx | 0 |
| `assignEventToProgram` (L2461) | Dashboard.jsx | 0 |
| `getLibraryForms` (L2482) | FormLibraryManager.jsx, forms/ImportFromLibraryModal.jsx | 1 |
| `getLibraryFormById` (L2505) | **none** | 2 |
| `createLibraryForm` (L2519) | FormLibraryManager.jsx | 3 |
| `updateLibraryForm` (L2568) | FormLibraryManager.jsx | 1 |
| `deleteLibraryForm` (L2591) | FormLibraryManager.jsx | 0 |
| `duplicateLibraryForm` (L2604) | FormLibraryManager.jsx | 0 |
| `saveProjectFormToLibrary` (L2618) | forms/SaveToLibraryModal.jsx | 0 |
| `importFormFromLibrary` (L2666) | forms/ImportFromLibraryModal.jsx | 0 |
| `getLibraryFormResponses` (L2777) | FormLibraryManager.jsx | 1 |
| `getLibraryAnalytics` (L2815) | forms/LibraryAnalyticsDashboard.jsx | 1 |
| `getFormSections` (L2889) | FormEditor.jsx, GenericFormPortal.jsx | 1 |
| `saveFormSections` (L2924) | FormEditor.jsx | 1 |
| `deleteFormSection` (L2983) | **none** | 0 |
| `getJoinAtharPage` (L3028) | JoinAtharDashboard.jsx, JoinAtharView.jsx | 2 |
| `saveJoinAtharPage` (L3069) | JoinAtharDashboard.jsx | 0 |
| `trackJoinAtharEvent` (L3130) | JoinAtharView.jsx | 0 |
| `getJoinAtharAnalytics` (L3145) | JoinAtharDashboard.jsx | 0 |
| `getFounders` (L3200) | alumni/AlumniNotificationsPage.jsx | 0 |
| `getFounderById` (L3209) | **none** | 0 |
| `createFounder` (L3219) | alumni/CompanyProfilePage.jsx | 0 |
| `updateFounder` (L3229) | alumni/FounderProfilePage.jsx | 0 |
| `deleteFounder` (L3240) | **none** | 0 |
| `getCompanyFounders` (L3251) | alumni/FounderProfilePage.jsx | 1 |
| `linkFounderToCompany` (L3261) | alumni/CompanyProfilePage.jsx | 1 |
| `unlinkFounderFromCompany` (L3272) | alumni/CompanyProfilePage.jsx | 0 |
| `getProgramParticipations` (L3284) | **none** | 1 |
| `getCompaniesInProgram` (L3294) | **none** | 0 |
| `createParticipation` (L3307) | **none** | 0 |
| `updateParticipationStatus` (L3318) | **none** | 0 |
| `deleteParticipation` (L3331) | **none** | 0 |
| `getCompanySnapshots` (L3343) | alumni/MEWorkspace.jsx | 1 |
| `getLatestSnapshot` (L3353) | **none** | 0 |
| `createSnapshot` (L3368) | alumni/CompanyProfilePage.jsx, alumni/MEWorkspace.jsx | 1 |
| `compareSnapshots` (L3386) | alumni/CompanyProfilePage.jsx | 0 |
| `getCertificates` (L3409) | alumni/CertificateGenerator.jsx, alumni/CompanyProfilePage.jsx, alumni/FounderDashboard.jsx, alumni/FounderProgramsPage.jsx | 0 |
| `verifyCertificate` (L3419) | alumni/CertificateVerifier.jsx | 0 |
| `issueCertificate` (L3429) | **none** | 0 |
| `updateCertificatePdfUrl` (L3439) | alumni/CertificateGenerator.jsx | 0 |
| `getOpportunities` (L3452) | alumni/FounderDashboard.jsx, alumni/FounderOpportunitiesPage.jsx, alumni/OpportunitiesHub.jsx | 0 |
| `createOpportunity` (L3467) | alumni/OpportunitiesHub.jsx | 0 |
| `updateOpportunity` (L3478) | **none** | 0 |
| `deleteOpportunity` (L3490) | **none** | 0 |
| `getOpportunityApplications` (L3502) | alumni/OpportunitiesHub.jsx | 0 |
| `getCompanyApplications` (L3512) | alumni/CompanyProfilePage.jsx | 0 |
| `applyToOpportunity` (L3522) | alumni/FounderOpportunitiesPage.jsx, alumni/OpportunitiesHub.jsx | 0 |
| `updateApplicationStatus` (L3532) | alumni/OpportunitiesHub.jsx | 0 |
| `submitInvestorRequest` (L3547) | alumni/CompanyProfilePage.jsx | 0 |
| `getInvestorRequests` (L3557) | **none** | 0 |
| `updateInvestorRequestStatus` (L3568) | **none** | 0 |
| `getAlumniCompanies` (L3581) | alumni/AlumniDirectory.jsx, alumni/AlumniNotificationsPage.jsx, alumni/ImpactDashboard.jsx, alumni/MEWorkspace.jsx, alumni/OpportunitiesHub.jsx | 0 |
| `getImpactStats` (L3607) | alumni/AlumniDirectory.jsx, alumni/ImpactDashboard.jsx, alumni/MEWorkspace.jsx | 0 |
| `getAlumniCompanyProfile` (L3644) | alumni/CompanyProfilePage.jsx | 0 |
| `createSnapshotFromFormResponse` (L3663) | **none** | 1 |
| `validateInvitationToken` (L3684) | alumni/AlumniSignupPage.jsx | 1 |
| `sendAlumniInvitation` (L3717) | alumni/AlumniInvitationsPage.jsx | 1 |
| `resendAlumniInvitation` (L3746) | alumni/AlumniInvitationsPage.jsx | 1 |
| `acceptInvitation` (L3770) | alumni/AlumniSignupPage.jsx | 0 |
| `inviteCoFounder` (L3855) | alumni/FounderProfilePage.jsx | 0 |
| `getAlumniInvitations` (L3889) | **none** | 0 |
| `getUniqueAlumniCompanies` (L3902) | **none** | 1 |
| `getAlumniAdminStats` (L3975) | **none** | 0 |
| `getFounderProfileByAuth` (L3990) | alumni/FounderDashboard.jsx, alumni/FounderLayout.jsx, alumni/FounderOpportunitiesPage.jsx, alumni/FounderProfilePage.jsx, alumni/FounderProgramsPage.jsx | 0 |
| `updateAlumniCompany` (L4023) | **none** | 0 |
| `getUserRoles` (L4037) | contexts/AuthContext.jsx | 0 |
| `assignUserRole` (L4079) | **none** | 0 |
| `removeUserRole` (L4098) | **none** | 0 |
| `getUserProfile` (L4113) | contexts/AuthContext.jsx | 0 |
| `updateUserProfile` (L4128) | contexts/AuthContext.jsx | 0 |
| `getProjectManagers` (L4147) | ProjectManagersManager.jsx | 0 |
| `assignProjectManager` (L4175) | ProjectManagersManager.jsx | 0 |
| `updateProjectManagerRole` (L4196) | ProjectManagersManager.jsx | 0 |
| `removeProjectManager` (L4210) | ProjectManagersManager.jsx | 0 |
| `getAllEligibleProjectManagers` (L4222) | ProjectManagersManager.jsx | 0 |
| `updateFounderCompanyWithSnapshot` (L4252) | alumni/FounderDashboard.jsx | 0 |
| `createFounderCompany` (L4293) | alumni/FounderDashboard.jsx | 0 |
| `getFounderPrograms` (L4335) | alumni/FounderDashboard.jsx, alumni/FounderProgramsPage.jsx | 0 |
| `getFounderNotifications` (L4358) | alumni/FounderLayout.jsx, alumni/FounderNotificationsPage.jsx | 0 |
| `markAllNotificationsAsRead` (L4373) | alumni/FounderNotificationsPage.jsx | 0 |
| `getAlumniManagerDashboardStats` (L4387) | alumni/AlumniManagerDashboard.jsx | 0 |
| `getAlumniManagerChartsData` (L4439) | alumni/AlumniManagerDashboard.jsx | 0 |
| `getAlumniInvitationsList` (L4504) | alumni/AlumniInvitationsPage.jsx | 0 |
| `getUnregisteredFounders` (L4539) | alumni/AlumniInvitationsPage.jsx | 0 |
| `sendBulkAlumniInvitations` (L4555) | alumni/AlumniInvitationsPage.jsx | 0 |
| `revokeAlumniInvitation` (L4594) | alumni/AlumniInvitationsPage.jsx | 0 |
| `sendManagerBroadcastNotification` (L4607) | alumni/AlumniNotificationsPage.jsx | 0 |
| `getAlumniManagerNotificationsLog` (L4740) | alumni/AlumniNotificationsPage.jsx | 0 |
| `getAlumniFilterOptions` (L4786) | alumni/AlumniAnalyticsPage.jsx, alumni/AlumniNotificationsPage.jsx | 0 |
| `getAlumniPlatformAnalytics` (L4824) | alumni/AlumniAnalyticsPage.jsx | 0 |

### 5.1 Exported but never imported elsewhere (27)

| Function | Line | Internal refs | Status |
|---|---|---|---|
| `getShareUrl` | 35 | 0 | dead |
| `clearApiCache` | 43 | 13 | internal only |
| `isUUID` | 96 | 8 | internal only |
| `updateFormCover` | 1682 | 0 | dead |
| `extractDynamicSheetFields` | 2094 | 1 | internal only |
| `getLibraryFormById` | 2505 | 2 | internal only |
| `deleteFormSection` | 2983 | 0 | dead |
| `getFounderById` | 3209 | 0 | dead |
| `deleteFounder` | 3240 | 0 | dead |
| `getProgramParticipations` | 3284 | 1 | internal only |
| `getCompaniesInProgram` | 3294 | 0 | dead |
| `createParticipation` | 3307 | 0 | dead |
| `updateParticipationStatus` | 3318 | 0 | dead |
| `deleteParticipation` | 3331 | 0 | dead |
| `getLatestSnapshot` | 3353 | 0 | dead |
| `issueCertificate` | 3429 | 0 | dead |
| `updateOpportunity` | 3478 | 0 | dead |
| `deleteOpportunity` | 3490 | 0 | dead |
| `getInvestorRequests` | 3557 | 0 | dead |
| `updateInvestorRequestStatus` | 3568 | 0 | dead |
| `createSnapshotFromFormResponse` | 3663 | 1 | internal only (used by `submitToForm`) |
| `getAlumniInvitations` | 3889 | 0 | dead |
| `getUniqueAlumniCompanies` | 3902 | 1 | used only by dead `getAlumniAdminStats` |
| `getAlumniAdminStats` | 3975 | 0 | dead |
| `updateAlumniCompany` | 4023 | 0 | dead |
| `assignUserRole` | 4079 | 0 | dead |
| `removeUserRole` | 4098 | 0 | dead |

Strictly dead (no importer and no internal reference): 20 - `getShareUrl`, `updateFormCover`, `deleteFormSection`, `getFounderById`, `deleteFounder`, `getCompaniesInProgram`, `createParticipation`, `updateParticipationStatus`, `deleteParticipation`, `getLatestSnapshot`, `issueCertificate`, `updateOpportunity`, `deleteOpportunity`, `getInvestorRequests`, `updateInvestorRequestStatus`, `getAlumniInvitations`, `getAlumniAdminStats`, `updateAlumniCompany`, `assignUserRole`, `removeUserRole`. `getUniqueAlumniCompanies` is transitively dead (only caller is the dead `getAlumniAdminStats`). Non-exported helper `getDefaultFormConfig` (1398) is live (used at 1148, 1522).

### 5.2 Components that bypass `api.js` and call Supabase directly

| File | What it calls directly |
|---|---|
| `contexts/AuthContext.jsx` | `supabase.auth.getSession/onAuthStateChange/signInWithPassword/signOut/signUp/updateUser` (also imports `getUserRoles`, `getUserProfile`, `updateUserProfile` from api) |
| `hooks/usePresence.js` | table `profiles` (23), realtime `supabase.channel` (58) |
| `components/EventDashboard.jsx` | table `google_settings` (63, 106) |
| `components/MentoringDistributionAdmin.jsx` | tables `event_days` (194), `experts` (212; also `delete` at 510), `companies` (228) |
| `components/MentoringLiveView.jsx` | `experts` (+`master_experts`), `companies`, `event_days` (143-146) |
| `components/MentoringMatrixView.jsx` | `experts`, `event_days` (49-51) |
| `components/alumni/MEWorkspace.jsx` | `company_snapshots` select with `companies(name, industry)` (55) |
| `components/alumni/CertificateGenerator.jsx` | storage bucket `event-assets` upload + public URL (133-138), duplicating `uploadImage` |
| `components/SelectionProcessManager.jsx` | edge functions `send-interview-invitations`, `send-rejection-emails`, `send-acceptance-emails` (458-551) |
| `components/MentorBookingAdmin.jsx`, `AtherTeamBookingAdmin.jsx` | edge function `generate-google-meet` |
| `lib/useMentoringTimer.js` | realtime broadcast channel `mentoring_timer_<eventId>` |
| `lib/mentoringDistribution.js` | tables `mentoring_distribution_config`, `mentoring_sessions`, `mentoring_distribution_day_config` |
| `lib/mentorBooking.js`, `lib/atherTeamBooking.js` | `events`, `mentors`, `mentor_slots`, `bookings`, `mentor_day_config`, `master_experts`; `ather_team_members/slots/bookings` |

Tables used by the other libs but never by `api.js`: `mentors`, `mentor_slots`, `bookings`, `mentor_day_config`, `ather_team_members`, `ather_team_slots`, `ather_team_bookings`, `mentoring_*`, `google_settings`, `booking_notifications`, `smtp_settings`, `email_audit_log`, `roles` (from `database.types.ts` table list).

---

## 6. Companion libraries

### 6.1 `src/lib/googleSheets.js` (234 lines)

| Export | Line | Purpose |
|---|---|---|
| `extractSpreadsheetId(url)` | 8 | Regex `/spreadsheets/d/<id>`. |
| `safeParseServiceAccount(rawKey)` | 19 | Tolerant JSON parser (strips invalid escapes, handles double-stringified JSON). |
| `getGoogleSheetsAccessToken(eventId=null)` | 91 | Reads **`google_settings`** row from Supabase via the browser client (event-specific row preferred, else row with `event_id IS NULL`; `.or('event_id.eq.X,event_id.is.null').order('event_id',{ascending:false}).limit(1).single()`), parses `service_account_key` (JSON containing `client_email` and `private_key`), optional `impersonate_email` -> JWT `sub`, signs an RS256 JWT **in the browser** with Web Crypto (`importPrivateKey`, 47) with scopes `spreadsheets` + `drive`, POSTs to `https://oauth2.googleapis.com/token`, returns `access_token` or `null` (all failures swallowed, logged). |
| `appendFormResponseToSheet({sheetUrl,eventId,formName,fields,answers,source,submittedAt})` | 165 | Builds a row `[submittedAt (en-US locale string), source, ...answers per field]` (objects JSON-stringified) and POSTs to Sheets API `values/A1:append`. `formName` is accepted but unused. Returns `{success,...}` objects, never throws. |

Observations (as-is): the service-account private key is stored in a table and **read into the browser** to sign tokens client-side (the RLS on `google_settings` therefore must allow reads by whichever role submits the form, including anonymous respondents because `submitToForm` runs in public portals); `EventDashboard.jsx:63,106` also reads/writes the same table directly. The only importer of `googleSheets.js` is `api.js` (`submitToForm`).

### 6.2 `src/lib/phoneValidation.js` (217 lines)

Pure, dependency-free module. Exports: `SUPPORTED_COUNTRIES` (8 countries EG, SA, AE, KW, QA, BH, OM, JO with flag/dial code), `cleanPhoneInput`, `validateAndSanitizeEgypt` (mobile `10|11|12|15` + 8 digits; landline prefix list; output `+20...`), `validateAndSanitizeSaudi` (`5xxxxxxxx`), `validateAndSanitizeUAE` (`5xxxxxxxx`), `validateAndSanitizeGeneral` (7-15 digits, E.164-ish), `validatePhoneNumber(raw, allowedCountries=[])` (empty input is valid; default countries EG/SA/AE; only EG/SA/AE have specific validators, so KW/QA/BH/OM/JO fall to the general validator; single-country mode returns that country's specific error). Error messages are in Arabic and returned as strings. Importers: `api.js` (`submitToForm`), `components/GenericFormPortal.jsx:12`, `components/forms/PhoneValidationConfig.jsx:3` (SUPPORTED_COUNTRIES).

### 6.3 `src/lib/useMentoringTimer.js` (222 lines)

React hook `useMentoringTimer({eventId, initialSeconds=900, dayIndex=0, slotIndex=0, isMaster=false})`. Local countdown (1 s interval), pause/adjust/reset/sync actions, Web Audio beeps in the last 7 s (700 Hz ticks, 988 Hz for last 3 s, 3-tone finish), mute flag in `localStorage['mentoring_timer_muted']`. Cross-client sync via Supabase Realtime broadcast channel `mentoring_timer_<eventId>` (`broadcast.self=false`), event `timer_action` with payload types `PAUSE | RESUME | ADJUST | RESET | SYNC`. Observations: `isMaster` parameter is accepted but never read (222 lines, no reference); every client can send actions (no master-only guard); `dayIndex/slotIndex` are sent in payload but ignored on receive; `togglePause` calls `broadcastAction` inside a `setState` updater (side-effect in updater). Importers: `MentoringDistributionAdmin.jsx:37`, `MentoringLiveView.jsx:15`, `MentoringMatrixView.jsx:16`. Uses no tables.

---

## 7. Matrices

### 7.1 Function -> tables touched (generated from `.from('...')` / `functions.invoke` occurrences within each exported function; dynamic-table functions annotated manually)

Embedded relations (section 8) also read the related tables but are not listed here; only explicit `.from()` roots are.

| Function (line) | Tables / buckets / edge fns touched |
|---|---|
| `notifyGoogleAppsScript` (L7) | `edge:process-booking` |
| `getEvents` (L81) | `events` |
| `getEvent` (L112) | `events` |
| `getFullAgenda` (L175) | `experts`, `companies`, `event_days`, `agenda_slots` |
| `getExperts` (L227) | `experts` |
| `getCompanies` (L248) | `companies` |
| `getStartups` (L298) | `companies` |
| `createEvent` (L306) | `events` |
| `updateEvent` (L336) | `events` |
| `deleteEvent` (L346) | `events` |
| `duplicateEvent` (L354) | `events`, `experts`, `companies`, `event_days`, `agenda_slots`, `library_resources`, `event_forms`, `form_field_configs` |
| `getMasterExperts` (L523) | `master_experts`, `experts` |
| `updateMasterExpert` (L555) | `master_experts`, `experts` |
| `deleteMasterExpert` (L586) | `experts`, `master_experts` |
| `createExpert` (L605) | `master_experts`, `experts` |
| `updateExpert` (L675) | `experts` |
| `deleteExpert` (L725) | `experts` |
| `createCompany` (L733) | `companies` |
| `updateCompany` (L742) | `companies` |
| `deleteCompany` (L752) | `companies` |
| `getEventDays` (L764) | `event_days` |
| `createDay` (L773) | `event_days` |
| `updateDay` (L788) | `event_days` |
| `deleteDay` (L809) | `event_days` |
| `getAgendaSlots` (L821) | `agenda_slots` |
| `createSlot` (L830) | `agenda_slots` |
| `updateSlot` (L850) | `agenda_slots` |
| `deleteSlot` (L860) | `agenda_slots` |
| `getLibraryResources` (L901) | `library_resources` |
| `createLibraryResource` (L917) | `library_resources` |
| `updateLibraryResource` (L926) | `library_resources` |
| `deleteLibraryResource` (L936) | `library_resources` |
| `importAgendaData` (L953) | `experts`, `companies` |
| `getFormConfig` (L1114) | `event_forms`, `form_field_configs` |
| `saveFormConfig` (L1160) | `event_forms`, `form_field_configs` |
| `submitCompanyRegistration` (L1221) | `company_submissions` |
| `submitExpertRegistration` (L1249) | `expert_submissions` |
| `getEventForms` (L1499) | `event_forms` |
| `createEventForm` (L1512) | `event_forms`, `form_field_configs` |
| `updateEventForm` (L1543) | `event_forms` |
| `deleteEventForm` (L1556) | `event_forms` |
| `getFormConfigById` (L1567) | `form_field_configs` |
| `saveFormConfigById` (L1585) | `form_field_configs` |
| `getEventFormById` (L1648) | `event_forms` |
| `getEventCovers` (L1662) | `form_covers` |
| `createFormCover` (L1672) | `form_covers` |
| `updateFormCover` (L1682) | `form_covers` |
| `deleteFormCover` (L1693) | `form_covers` |
| `getFormResponses` (L1706) | `form_responses` |
| `getEventFormsResponses` (L1716) | `form_responses` |
| `deleteFormResponse` (L1726) | `form_responses` |
| `updateFormResponseStatus` (L1735) | `form_responses` |
| `trackFormShareEvent` (L1750) | `form_share_events` |
| `getFormShareEvents` (L1769) | `form_share_events` |
| `getEventShareEvents` (L1779) | `event_forms`, `form_share_events` |
| `duplicateEventForm` (L1802) | `event_forms`, `form_field_configs` |
| `submitToForm` (L1879) | `event_forms`, `form_responses`, `company_submissions`, `companies`, `experts` |
| `syncSubmissionsFromSheet` (L2186) | `company_submissions` |
| `updateSubmissionStatus` (L2305) | `company_submissions` |
| `updateSlotsOrder` (L2320) | `agenda_slots` |
| `bulkUpdateExperts` (L2370) | `experts` |
| `bulkUpdateCompanies` (L2396) | `companies` |
| `getPrograms` (L2413) | `programs` |
| `createProgram` (L2426) | `programs` |
| `updateProgram` (L2440) | `programs` |
| `deleteProgram` (L2451) | `programs` |
| `assignEventToProgram` (L2461) | `events` |
| `getLibraryForms` (L2482) | `library_forms` |
| `getLibraryFormById` (L2505) | `library_forms` |
| `createLibraryForm` (L2519) | `library_forms` |
| `updateLibraryForm` (L2568) | `library_forms` |
| `deleteLibraryForm` (L2591) | `library_forms` |
| `importFormFromLibrary` (L2666) | `event_forms`, `form_responses`, `library_forms` |
| `getLibraryFormResponses` (L2777) | `form_responses`, `events` |
| `getLibraryAnalytics` (L2815) | `library_forms`, `event_forms`, `form_responses`, `events` |
| `getFormSections` (L2889) | `event_forms`, `form_sections` |
| `saveFormSections` (L2924) | `event_forms`, `form_sections` |
| `deleteFormSection` (L2983) | `event_forms`, `form_sections` |
| `getJoinAtharPage` (L3028) | `join_athar_pages`, `join_athar_cards`, `join_athar_share_presets` |
| `saveJoinAtharPage` (L3069) | `join_athar_pages`, `join_athar_cards`, `join_athar_share_presets` |
| `trackJoinAtharEvent` (L3130) | `join_athar_analytics` |
| `getJoinAtharAnalytics` (L3145) | `join_athar_analytics` |
| `getFounders` (L3200) | `founders` |
| `getFounderById` (L3209) | `founders` |
| `createFounder` (L3219) | `founders` |
| `updateFounder` (L3229) | `founders` |
| `deleteFounder` (L3240) | `founders` |
| `getCompanyFounders` (L3251) | `company_founders` |
| `linkFounderToCompany` (L3261) | `company_founders` |
| `unlinkFounderFromCompany` (L3272) | `company_founders` |
| `getProgramParticipations` (L3284) | `program_participations` |
| `getCompaniesInProgram` (L3294) | `program_participations` |
| `createParticipation` (L3307) | `program_participations` |
| `updateParticipationStatus` (L3318) | `program_participations` |
| `deleteParticipation` (L3331) | `program_participations` |
| `getCompanySnapshots` (L3343) | `company_snapshots` |
| `getLatestSnapshot` (L3353) | `company_snapshots` |
| `createSnapshot` (L3368) | `company_snapshots` |
| `compareSnapshots` (L3386) | `company_snapshots` |
| `getCertificates` (L3409) | `certificates` |
| `verifyCertificate` (L3419) | `certificates` |
| `issueCertificate` (L3429) | `certificates` |
| `updateCertificatePdfUrl` (L3439) | `certificates` |
| `getOpportunities` (L3452) | `opportunities` |
| `createOpportunity` (L3467) | `opportunities` |
| `updateOpportunity` (L3478) | `opportunities` |
| `deleteOpportunity` (L3490) | `opportunities` |
| `getOpportunityApplications` (L3502) | `opportunity_applications` |
| `getCompanyApplications` (L3512) | `opportunity_applications` |
| `applyToOpportunity` (L3522) | `opportunity_applications` |
| `updateApplicationStatus` (L3532) | `opportunity_applications` |
| `submitInvestorRequest` (L3547) | `investor_requests` |
| `getInvestorRequests` (L3557) | `investor_requests` |
| `updateInvestorRequestStatus` (L3568) | `investor_requests` |
| `getAlumniCompanies` (L3581) | `companies`, `program_participations` |
| `getImpactStats` (L3607) | `companies`, `company_snapshots`, `certificates` |
| `getAlumniCompanyProfile` (L3644) | `companies` |
| `createSnapshotFromFormResponse` (L3663) | `form_responses` |
| `validateInvitationToken` (L3684) | `alumni_invitations` |
| `sendAlumniInvitation` (L3717) | `alumni_invitations` |
| `resendAlumniInvitation` (L3746) | `alumni_invitations` |
| `acceptInvitation` (L3770) | `auth.signUp`, `founders`, `alumni_invitations` |
| `inviteCoFounder` (L3855) | `company_founders`, `alumni_invitations` |
| `getAlumniInvitations` (L3889) | `alumni_invitations` |
| `getUniqueAlumniCompanies` (L3902) | `companies`, `alumni_invitations`, `program_participations` |
| `getFounderProfileByAuth` (L3990) | `founders` |
| `updateAlumniCompany` (L4023) | `companies` |
| `getUserRoles` (L4037) | `user_roles` |
| `assignUserRole` (L4079) | `user_roles` |
| `removeUserRole` (L4098) | `user_roles` |
| `getUserProfile` (L4113) | `profiles` |
| `updateUserProfile` (L4128) | `profiles` |
| `getProjectManagers` (L4147) | `project_managers`, `profiles` |
| `assignProjectManager` (L4175) | `project_managers` |
| `updateProjectManagerRole` (L4196) | `project_managers` |
| `removeProjectManager` (L4210) | `project_managers` |
| `getAllEligibleProjectManagers` (L4222) | `user_roles`, `profiles` |
| `updateFounderCompanyWithSnapshot` (L4252) | `companies`, `company_snapshots` |
| `createFounderCompany` (L4293) | `companies`, `company_founders`, `company_snapshots` |
| `getFounderPrograms` (L4335) | `company_founders`, `program_participations` |
| `getFounderNotifications` (L4358) | `notifications` |
| `markAllNotificationsAsRead` (L4373) | `notifications` |
| `getAlumniManagerDashboardStats` (L4387) | `founders`, `companies`, `company_snapshots`, `alumni_invitations` |
| `getAlumniManagerChartsData` (L4439) | `founders`, `companies` |
| `getAlumniInvitationsList` (L4504) | `alumni_invitations` |
| `getUnregisteredFounders` (L4539) | `founders` |
| `sendBulkAlumniInvitations` (L4555) | `alumni_invitations` |
| `revokeAlumniInvitation` (L4594) | `alumni_invitations` |
| `sendManagerBroadcastNotification` (L4607) | `founders`, `company_founders`, `program_participations`, `notifications` |
| `getAlumniManagerNotificationsLog` (L4740) | `notifications` |
| `getAlumniFilterOptions` (L4786) | `programs`, `companies` |
| `getAlumniPlatformAnalytics` (L4824) | `companies` |
| `getSubmissions` (L1279) | `company_submissions`, `expert_submissions` |
| `approveSubmission` (L1301) | `company_submissions`, `expert_submissions` |
| `rejectSubmission` (L1377) | `company_submissions`, `expert_submissions` |

Manual addition: `uploadImage` (871) touches storage bucket `event-assets` (the generator did not tag it because the `.storage` and `.from(` calls are on different lines).

### 7.2 Table -> functions touching it

| Table / resource | Functions in api.js that touch it |
|---|---|
| `agenda_slots` | `getFullAgenda`, `duplicateEvent`, `getAgendaSlots`, `createSlot`, `updateSlot`, `deleteSlot`, `updateSlotsOrder` |
| `alumni_invitations` | `validateInvitationToken`, `sendAlumniInvitation`, `resendAlumniInvitation`, `acceptInvitation`, `inviteCoFounder`, `getAlumniInvitations`, `getUniqueAlumniCompanies`, `getAlumniManagerDashboardStats`, `getAlumniInvitationsList`, `sendBulkAlumniInvitations`, `revokeAlumniInvitation` |
| `auth.signUp` | `acceptInvitation` |
| `certificates` | `getCertificates`, `verifyCertificate`, `issueCertificate`, `updateCertificatePdfUrl`, `getImpactStats` |
| `companies` | `getFullAgenda`, `getCompanies`, `getStartups`, `duplicateEvent`, `createCompany`, `updateCompany`, `deleteCompany`, `importAgendaData`, `submitToForm`, `bulkUpdateCompanies`, `getAlumniCompanies`, `getImpactStats`, `getAlumniCompanyProfile`, `getUniqueAlumniCompanies`, `updateAlumniCompany`, `updateFounderCompanyWithSnapshot`, `createFounderCompany`, `getAlumniManagerDashboardStats`, `getAlumniManagerChartsData`, `getAlumniFilterOptions`, `getAlumniPlatformAnalytics` |
| `company_founders` | `getCompanyFounders`, `linkFounderToCompany`, `unlinkFounderFromCompany`, `inviteCoFounder`, `createFounderCompany`, `getFounderPrograms`, `sendManagerBroadcastNotification` |
| `company_snapshots` | `getCompanySnapshots`, `getLatestSnapshot`, `createSnapshot`, `compareSnapshots`, `getImpactStats`, `updateFounderCompanyWithSnapshot`, `createFounderCompany`, `getAlumniManagerDashboardStats` |
| `company_submissions` | `submitCompanyRegistration`, `submitToForm`, `syncSubmissionsFromSheet`, `updateSubmissionStatus`, `getSubmissions`, `approveSubmission`, `rejectSubmission` |
| `edge:process-booking` | `notifyGoogleAppsScript` |
| `event_days` | `getFullAgenda`, `duplicateEvent`, `getEventDays`, `createDay`, `updateDay`, `deleteDay` |
| `event_forms` | `duplicateEvent`, `getFormConfig`, `saveFormConfig`, `getEventForms`, `createEventForm`, `updateEventForm`, `deleteEventForm`, `getEventFormById`, `getEventShareEvents`, `duplicateEventForm`, `submitToForm`, `importFormFromLibrary`, `getLibraryAnalytics`, `getFormSections`, `saveFormSections`, `deleteFormSection` |
| `events` | `getEvents`, `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`, `duplicateEvent`, `assignEventToProgram`, `getLibraryFormResponses`, `getLibraryAnalytics` |
| `expert_submissions` | `submitExpertRegistration`, `getSubmissions`, `approveSubmission`, `rejectSubmission` |
| `experts` | `getFullAgenda`, `getExperts`, `duplicateEvent`, `getMasterExperts`, `updateMasterExpert`, `deleteMasterExpert`, `createExpert`, `updateExpert`, `deleteExpert`, `importAgendaData`, `submitToForm`, `bulkUpdateExperts` |
| `form_covers` | `getEventCovers`, `createFormCover`, `updateFormCover`, `deleteFormCover` |
| `form_field_configs` | `duplicateEvent`, `getFormConfig`, `saveFormConfig`, `createEventForm`, `getFormConfigById`, `saveFormConfigById`, `duplicateEventForm` |
| `form_responses` | `getFormResponses`, `getEventFormsResponses`, `deleteFormResponse`, `updateFormResponseStatus`, `submitToForm`, `importFormFromLibrary`, `getLibraryFormResponses`, `getLibraryAnalytics`, `createSnapshotFromFormResponse` |
| `form_sections` | `getFormSections`, `saveFormSections`, `deleteFormSection` |
| `form_share_events` | `trackFormShareEvent`, `getFormShareEvents`, `getEventShareEvents` |
| `founders` | `getFounders`, `getFounderById`, `createFounder`, `updateFounder`, `deleteFounder`, `acceptInvitation`, `getFounderProfileByAuth`, `getAlumniManagerDashboardStats`, `getAlumniManagerChartsData`, `getUnregisteredFounders`, `sendManagerBroadcastNotification` |
| `investor_requests` | `submitInvestorRequest`, `getInvestorRequests`, `updateInvestorRequestStatus` |
| `join_athar_analytics` | `trackJoinAtharEvent`, `getJoinAtharAnalytics` |
| `join_athar_cards` | `getJoinAtharPage`, `saveJoinAtharPage` |
| `join_athar_pages` | `getJoinAtharPage`, `saveJoinAtharPage` |
| `join_athar_share_presets` | `getJoinAtharPage`, `saveJoinAtharPage` |
| `library_forms` | `getLibraryForms`, `getLibraryFormById`, `createLibraryForm`, `updateLibraryForm`, `deleteLibraryForm`, `importFormFromLibrary`, `getLibraryAnalytics` |
| `library_resources` | `duplicateEvent`, `getLibraryResources`, `createLibraryResource`, `updateLibraryResource`, `deleteLibraryResource` |
| `master_experts` | `getMasterExperts`, `updateMasterExpert`, `deleteMasterExpert`, `createExpert` |
| `notifications` | `getFounderNotifications`, `markAllNotificationsAsRead`, `sendManagerBroadcastNotification`, `getAlumniManagerNotificationsLog` |
| `opportunities` | `getOpportunities`, `createOpportunity`, `updateOpportunity`, `deleteOpportunity` |
| `opportunity_applications` | `getOpportunityApplications`, `getCompanyApplications`, `applyToOpportunity`, `updateApplicationStatus` |
| `profiles` | `getUserProfile`, `updateUserProfile`, `getProjectManagers`, `getAllEligibleProjectManagers` |
| `program_participations` | `getProgramParticipations`, `getCompaniesInProgram`, `createParticipation`, `updateParticipationStatus`, `deleteParticipation`, `getAlumniCompanies`, `getUniqueAlumniCompanies`, `getFounderPrograms`, `sendManagerBroadcastNotification` |
| `programs` | `getPrograms`, `createProgram`, `updateProgram`, `deleteProgram`, `getAlumniFilterOptions` |
| `project_managers` | `getProjectManagers`, `assignProjectManager`, `updateProjectManagerRole`, `removeProjectManager` |
| `user_roles` | `getUserRoles`, `assignUserRole`, `removeUserRole`, `getAllEligibleProjectManagers` |
| `storage: event-assets` | `uploadImage` |

---

## 8. Embedded (joined) selects used in api.js

| api.js line | select string |
|---|---|
| 187 | `*, master:master_experts(*)` |
| 236 | `*, master:master_experts(*)` |
| 536 | `master_id, event_id, events(event_id, event_name)` |
| 663 | `*, master:master_experts(*)` |
| 1651 | `*, form_covers(*)` |
| 3212 | `*, company_founders(*, companies(*))` |
| 3254 | `*, founders(*)` |
| 3287 | `*, programs(*), events(event_id, event_name, event_name_ar)` |
| 3297 | `*, companies(*)` |
| 3412 | `*, programs(name, name_ar), events(event_name, event_name_ar)` |
| 3422 | `*, founders(*), programs(*), events(event_name, event_name_ar)` |
| 3505 | `*, companies(*), founders(*)` |
| 3515 | `*, opportunities(*)` |
| 3560 | `*, companies(name, logo_url, industry, stage)` |
| 3584 | `*, company_founders(*, founders(*))` |
| 3688 | `*, companies(*, program_participations(*, programs(*)))` |
| 3735 | `*, companies(name)` |
| 3861 | `*, founders(*)` |
| 3892 | `*, companies(name, name_ar, logo_url)` |
| 3906 | `*, company_founders(*, founders(*))` |
| 3914 | `*, programs(*)` |
| 3997 | `*, company_founders(*, companies(*))` |
| 4006 | `*, company_founders(*, companies(*))` |
| 4347 | `*, programs(*), events(*), companies(*)` |
| 4508 | `*, companies(company_id, name, sector), founders(founder_id, name_ar, name_en, email)` |
| 4543 | `*, company_founders(*, companies(*))` |
| 4672 | `founder_id, founders(founder_id, auth_user_id)` |
| 4693 | `company_id, company_founders:companies(company_founders(founders(founder_id, auth_user_id)))` |
| 4744 | `id, broadcast_id, title, body, audience_type, audience_target_id, created_at, is_read, sent_by, recipient_id, founder_id, founders(name_ar, name_en, email)` |
| 4826 | `*, program_participations(*, programs(*)), company_snapshots(*)` |

---

## 9. Duplications, Conflicts & Anomalies (as-is)

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

## 10. Open Questions (for the owner)

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
