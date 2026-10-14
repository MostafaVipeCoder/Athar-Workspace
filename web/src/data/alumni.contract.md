# Alumni contract (m49 / design 09): what the founder-side and the manager-side builders share

Reasoning and the full model: `docs/design/09-alumni-pages-and-profile-model.md`. The database side is DONE and proved (`db/migrations/m49_alumni_profile_model.sql`, `db/verify/v49_alumni_profile_model.sql`, 320 checks). The data layer is DONE: `web/src/data/alumni.js` (one function per RPC + hooks, pinned by `alumni.test.js`) and the pure helpers `web/src/lib/alumni.js`. **Pages import these; they never call `rpc('...')` or a table directly for anything listed here.**

No TypeScript: the shapes below are the contract (JSON as the RPC returns it; amounts are numbers, dates are ISO strings, ids are uuid strings, `null` = empty).

## 0. Ground rules

1. **Patches, not forms**: save RPCs take `p_patch`, an object with ONLY the keys to change (absent = untouched, `null` = clear). Build it with `diffPatch(base, next, keys)`. A key the RPC does not know is refused (`alumni_invalid` detail `<key>:unknown_key`).
2. **Keys, not labels**: payloads carry lookup **keys** (`sector: "technology"`) and the governorate as a numeric **code** (`25`). Labels come from `useAlumniLookups()` + `lookupLabel(lookups, kind, key, lang)` / `lookupOptions` / `subsectorOptions` (bilingual, `active` flag, server order). Never hard-code a list.
3. **The national ID** is typed in ONE place (`NationalIdField`), sent in a POST body only, shown in full only to its owner and in the manager's explicit reveal, never in a URL, query key, toast, log line or analytics event. **No JavaScript rule of the ID exists**: validity and the derived values come from `previewNationalId` (the same SQL as the database). `digitsOnly` only formats the input.
4. **Derived values are read-only**: Program Scope / Program Name / Support provided, CEO age / age category / gender / governorate, team counts. A form never offers them as inputs. The typed `self_birth_date` / `self_gender` fields exist ONLY while the founder has no ID (`identity.has_national_id === false`).
5. **Soft failure**: `saveMyFounderProfile` can RESOLVE with `{ saved: false, error: 'national_id_conflict' }`. Check `result.saved`. Everything else refused is a thrown `AppError`.
6. Optimistic concurrency: send `p_expected` = the `company.updated_at` the form loaded; `alumni_stale` means "reload". A manager's note does not move it.
7. **One write path (m52)**: a page never writes `founders` or the typed columns of `companies` through PostgREST (`.from('founders')` has no INSERT / UPDATE privilege any more; `companies` refuses `id`, `created_at`, `deleted_at`, `created_by` / `origin_project_id` updates and applies the RPC's url / length / logo checks to a direct write). Use the RPCs. Every function that takes or returns a national ID refuses GET / HEAD with HTTP 405 (`post_only`): use `rpc()` (POST), never a hand-built GET.
8. **Unknown is not zero (m52)**: `counts.team_size` / `female_founders` / `founders_under_35` (and `team.size` ...) are `null` when nobody is recorded or no gender / age is known: show a dash, never `0`. The Excel export writes a blank cell.
9. Mobile-first founder pages, desktop-first manager pages, RTL + English, empty / loading / error states, `ConfirmDialog` only for irreversible actions, 44 px targets. No page loads "all companies": directory pages page (`limit` ≤ 100, 24 default).

## 1. Files and ownership

| Founder-side builder | Manager-side builder |
|---|---|
| `src/app/pages/founder/*` (profile, company, progress, notifications, opportunities, Home enrichment); sign-up / invitation / recovery pages next to `LoginPage.jsx` | `src/app/pages/alumni-admin/*` |
| i18n `alumni.founder.*`, `alumni.auth.*` | i18n `alumni.admin.*` |
| creates **`src/shared/alumni/*`** (section 5) FIRST | imports `shared/alumni/*`; admin-only blocks may live in `alumni-admin/` |
| replaces its ComingSoon routes in `routes.jsx` (`/signup`, `/invite/:token`, `/forgot-password`, `/reset-password`, `/alumni/founder/{profile,company/:id,progress,notifications,opportunities}`; add `/alumni/founder/company/new`) | replaces `/alumni/admin/*` (dashboard, invitations, notifications, analytics, opportunities, impact, workspace, directory, company/:id) |

Shared (`common`) i18n: `alumni.common.*` (lookups labels are NOT i18n: they come from the database). Error tokens: add to `data/errors.js` `TOKEN_KEYS` (additive) and map SQLSTATE `P0002` to `not_found`.

## 2. RPCs (all POST; names, argument names and returns are pinned by `data/alumni.test.js`)

| Function in `data/alumni.js` | RPC | Who | Returns |
|---|---|---|---|
| `getAlumniLookups` / `useAlumniLookups` | `list_alumni_lookups()` | anon, any | vocabulary, section 3.1 |
| `saveAlumniLookup`, `deleteAlumniLookup` | `save_alumni_lookup`, `delete_alumni_lookup` | manager | row / void |
| `previewNationalId(id)` | `preview_national_id(p_id)` | signed in | `{ valid:false, reason }` / `{ valid:true, birth_date, age, age_category, gender, governorate:{ code, name_en, name_ar, is_abroad } }` |
| `getMyAlumniProfile` | `get_my_alumni_profile()` | founder | section 3.2 |
| `saveMyFounderProfile(patch)` | `save_my_founder_profile(p_patch)` | founder | `{ saved:true, replaced[], founder }` or `{ saved:false, error }` |
| `getMyCompanyProfile(id)` | `get_my_company_profile(p_company)` | founder (member) | company payload, 3.3 |
| `saveMyCompanyProfile(id\|null, patch, expected)` | `save_my_company_profile(p_company, p_patch, p_expected)` | founder | `{ saved:true, ...company payload }` (null id creates; the founder becomes primary) |
| `saveCompanyTeamMember(company, founder\|null, patch)` | `save_company_team_member` | founder (member) / manager | `{ saved, founder_id, ...payload }` |
| `removeCompanyTeamMember`, `setCompanyCeo` | `remove_company_team_member`, `set_company_ceo` | founder (records only) / manager | `{ saved, ...payload }` |
| `upsertCompanySnapshot(company, year, data)` | `upsert_company_snapshot` | founder (member) / manager | `{ saved, snapshot, snapshots[] }` |
| `deleteCompanySnapshot(company, year)` | `delete_company_snapshot` | manager | `{ deleted, snapshots[] }` |
| `listAlumniDirectory({ filters, limit, offset, sort })` | `list_alumni_directory` | manager (all alumni) / founder, PM (visible ones) | `{ audience, total, limit, offset, rows[] }`, 3.4 |
| `listPublicAlumniDirectory` | `list_public_alumni_directory` | anon | same envelope, whitelisted rows |
| `getAlumniCompany(id)` | `get_alumni_company` | manager | company payload + manager fields |
| `getAlumniFounder(id, { reveal })` | `get_alumni_founder` | manager | founder block (+ his companies); `reveal` = full ID, **logged** |
| `saveAlumniCompany(id\|null, patch, expected)` | `save_alumni_company` | manager | `{ saved:true, ...payload }` |
| `saveAlumniFounder(id, patch)` | `save_alumni_founder` | manager | `{ saved, replaced[], founder }` |
| `setCompaniesAlumni(ids, value)` | `set_companies_alumni` | manager | `{ changed, requested }` |
| `exportAlumniRows({ filters, year, lang, asOf })` | `export_alumni_rows` | manager | `{ columns[38], rows[][38], meta }` |
| `getAlumniAnalytics({ filters, year })` | `get_alumni_analytics` | manager | 3.5 |
| `createAlumniInvitation`, `revokeAlumniInvitation`, `listAlumniInvitations` | `create_alumni_invitation`, `revoke_alumni_invitation`, `list_alumni_invitations` | manager / founder (own companies) | `{ id, email, token, link, expires_at }` (token ONCE) / void / `{ total, rows[] }` (no token) |
| `validateInvitation(token)`, `acceptInvitation(token)` | `validate_invitation`, `accept_invitation` (existing) | anon / founder | `{ valid, company_name, masked_email }` / `{ accepted, company_id }` |

Used from the Alumni pages but **not** wrapped here (direct, existing RLS): `notifications` (founder: select own + update `is_read`; manager: insert one row per recipient, **always with `recipient_id`**), `opportunities` (founder: select active; manager: CRUD), `opportunity_applications` (founder: insert for an own company; manager: update status), `investor_requests`, `merge_companies` (manager). Not covered by m49 (ask the lead for a migration number): a server-side notification broadcast, e-mail delivery of invitations, `merge_founders`, a server-side Excel import.

## 3. Payload shapes

### 3.1 `list_alumni_lookups()`

```json
{ "governorates": [{ "code": 25, "key": "assiut", "name_en": "Assiut", "name_ar": "أسيوط", "is_abroad": false }],
  "sectors": [{ "key": "technology", "label_en": "Technology", "label_ar": "التكنولوجيا", "sort": 40, "active": true, "system": false,
               "subsectors": [{ "key": "robotics", "label_en": "Robotics", "label_ar": "الروبوتات", "sort": 40, "active": true, "system": false }] }],
  "stages": [{ "key": "mvp", "label_en": "MVP", "label_ar": "...", "sort": 40, "active": true, "system": false }],
  "startup_types": [], "legal_statuses": [], "closing_reasons": [], "after_closing": [], "support_kinds": [], "age_categories": [],
  "genders": [], "education_statuses": [], "operating_statuses": [], "directory_visibilities": [], "version": "2026-10-14T..." }
```

`governorates` = the 27 company locations + code 88 (`is_abroad`, only for "born abroad": do not offer it for a company). Kinds for `lookupLabel`: `governorate`, `sector`, `subsector`, `stage`, `startup_type`, `legal_status`, `closing_reason`, `after_closing`, `support_kind`, `age_category`, `gender`, `education_status`, `operating_status`, `directory_visibility`.

### 3.2 `get_my_alumni_profile()`

```json
{ "founder": { "id": "uuid", "name_en": "Sara Ali", "name_ar": "سارة علي", "email": "sara@example.com", "phone": "+201012345678", "linkedin_url": null,
    "photo_path": null, "bio_en": null, "bio_ar": null, "education_status": "graduate", "has_account": true, "updated_at": "...",
    "identity": { "source": "id", "has_national_id": true, "national_id": "29501010101234", "id_masked": "**********1234", "self_birth_date": null, "self_gender": null,
                  "derived": { "birth_date": "1995-01-01", "age": 31, "age_category": "age_25_34", "gender": "male", "governorate": 1 } },
    "completeness": { "percent": 75, "missing": ["education_status"] } },
  "companies": [{ "id": "uuid", "name_en": "...", "name_ar": "...", "logo_path": null, "stage": "mvp", "sector": "healthcare", "operating_status": "open",
                  "role": "founder", "is_primary": true, "directory_visibility": "private", "is_alumni": false,
                  "completeness": { "percent": 80, "missing": ["description", "annual_update"] }, "latest_snapshot_year": 2024, "updated_at": "..." }] }
```

`identity.source`: `"id"`, `"self"` (typed fallback, flag it "self-declared") or `null`. `derived.governorate` = the **governorate of origin** (a code). Without an ID, `derived.governorate` is `null`. `missing` keys: founder `name, phone, identity, education_status`; company `name, description, startup_type, sector, stage, legal_status, governorate, established_on, online_presence, annual_update`.

### 3.3 Company payload (`get_my_company_profile`, `get_alumni_company`, and after every company / team / CEO save)

```json
{ "company": { "id": "uuid", "name_en": "", "name_ar": "", "description_en": "", "description_ar": "", "logo_path": null,
    "startup_type": "startup", "sector": "healthcare", "subsector": "biotech", "stage": "mvp", "legal_status": "llc",
    "governorate": 25, "location_en": "", "location_ar": "", "established_on": "2021-03-01", "founding_year": 2021,
    "website_url": "https://...", "app_url": null, "linkedin_url": null,
    "links": [{ "kind": "facebook", "url": "https://...", "label": "Facebook" }],
    "operating_status": "open", "closed_on": null, "closing_reason": null, "after_closing": null, "closing_note": null,
    "directory_visibility": "private", "directory_blocked": false, "is_alumni": false,
    "legacy": { "industry_en": null, "industry_ar": null, "governorate_en": null, "governorate_ar": null },
    "completeness": { "percent": 90, "missing": ["annual_update"] }, "created_at": "...", "updated_at": "...",
    "internal": { "hint": null, "directory_hidden": false, "reviewed_at": null, "reviewed_by": null }, "created_by": "uuid", "origin_project_id": null },
  "team": [{ "founder_id": "uuid", "name_en": "", "name_ar": "", "role": "founder", "is_primary": true, "has_account": true, "is_me": true,
             "gender": "male", "age": 31, "age_category": "age_25_34", "birth_date": "1995-01-01", "source": "id" }],
  "counts": { "team_size": 2, "female_founders": 1, "founders_under_35": 1 },
  "ceo_founder_id": "uuid",
  "programs": [{ "program_id": "uuid", "program_name_en": "", "program_name_ar": "", "program_type": "accelerator", "project_id": "uuid",
                 "project_name_en": "", "project_name_ar": "", "completed": false, "start_date": null, "end_date": null, "support": ["mentoring", "training"] }],
  "snapshots": [{ "id": "uuid", "year": 2024, "revenue_total": 260000.0, "funding_raised_total": 100000.0, "employees_total": 12, "employees_female": 4, "freelancers": 3,
                  "traction": "", "challenges": null, "needs": "", "source": "founder", "updated_at": "..." }] }
```

- `internal`, `created_by`, `origin_project_id` and the extra team keys (`governorate`, `id_masked`, `email`, `phone`, `education_status`) are present **only in the manager payload**. A founder payload has `directory_blocked` (boolean) instead of the notes.
- `team[].gender / age / age_category / birth_date / source` are present for the viewer himself, for a record without an account (`has_account: false`) and for managers; **never** for another registered founder.
- `company.links` is canonical (`kind` in facebook, instagram, x, tiktok, youtube, telegram, whatsapp, deck, video, other): the entries that only repeat `website_url` / `linkedin_url` are removed. Save it back as it is.
- `programs` = Program Scope (`program_name_*`), Program Name (`project_name_*`), Support provided (`support[]`, labels from the `support_kind` lookup). Read-only, derived.

**Company patch keys** (founder and manager): `name_en`, `name_ar`, `description_en`, `description_ar`, `logo_path`, `startup_type`, `sector`, `subsector`, `stage`, `legal_status`, `governorate` (code), `location_en`, `location_ar`, `established_on` (`YYYY-MM-DD`), `website_url`, `app_url`, `linkedin_url`, `links` (array, ≤ 12), `operating_status` (`open`/`closed`), `closed_on`, `closing_reason`, `after_closing`, `closing_note`, `directory_visibility`. **Manager only**: `is_alumni` (boolean), `internal: { hint, directory_hidden, reviewed }`.
**Founder patch keys**: `name_en`, `name_ar`, `bio_en`, `bio_ar`, `phone`, `linkedin_url`, `photo_path`, `education_status` (`student`/`graduate`/`other`), `national_id`, `self_birth_date`, `self_gender`; **manager only**: `email`.
**Team member patch**: `role` (free label ≤ 60) + name / phone / education / self-declared values (a founder cannot enter a national ID for somebody else; a manager can).
**Snapshot data keys**: `revenue_total`, `funding_raised_total` (EGP, funding is cumulative to the year end), `employees_total`, `employees_female` (≤ total), `freelancers`, `traction`, `challenges`, `needs`.

### 3.4 Directory

Manager row (`audience: "manager"`): `{ id, name_en, name_ar, logo_path, sector, subsector, stage, startup_type, legal_status, governorate, established_on, founding_year, operating_status, is_alumni, directory_visibility, directory_hidden, reviewed_at, updated_at, legacy{...}, team:{ size, female_founders, under_35 }, ceo:{ founder_id, name_en, name_ar, gender, age, age_category, governorate /*of ORIGIN, from the ID*/, source }, latest:{ year, revenue_total, employees_total, funding_raised_total }, programs:[{ program_id, program_name_*, project_id, project_name_* }], completeness_percent }`. **Show both governorates with clear labels**: `governorate` = "Company location", `ceo.governorate` = "CEO from (ID)".
Member / public row (`audience: "member" | "public"`): exactly `{ id, name_en, name_ar, logo_path, description_en, description_ar (280 chars), sector, subsector, stage, startup_type, governorate, established_year, operating_status, website_url, app_url, social:[{kind,url}], programs:[{...names}] }`. No person, contact or metric: do not add any.
Filters: `q, program_id, project_id, sector, subsector, stage, startup_type, legal_status, governorate, operating_status`; manager only: `scope` (`alumni` default | `candidates` | `all`), `ceo_governorate, ceo_gender, age_category, has_female_founder, reviewed, directory_visibility, directory_hidden, incomplete`. Sorts: `name`, `updated`, `established`, `created`.

### 3.5 Analytics

`{ year, totals:{ companies, open, closed, survival_rate, with_program, reporting_year, founders, female_founders, founders_under_35, employees, female_employees, freelancers, funding_raised, revenue }, by_sector[], by_stage[], by_startup_type[], by_legal_status[], by_governorate[], by_ceo_governorate[], by_ceo_gender[], by_ceo_age_category[], by_program[{ key, program_name_en, program_name_ar, count }], by_year[{ year, companies_reporting, revenue, funding_raised, employees, female_employees, freelancers }] }` where each `by_*` is `[{ key, count }]` (a `null` key = not specified). Same `filters` as the directory (manager).

### 3.6 Export

`columns` = 38 `{ key, header, type }` in the owner's order; `rows` = arrays of 38 cells aligned with `columns`; `meta` = `{ year, lang, as_of, count, generated_at, ceo_source:{ id, self, none } }`. The browser writes the sheet with `lib/export/xlsx.js` using `columns[].header` as the header row **unchanged** (the owner's workflow keys on those texts, typos included). Show `meta.ceo_source` as a data-quality hint.

## 4. Error tokens (message prefix = `hint`; `detail` = `field:reason` where marked)

| Token | SQLSTATE | Meaning / UI | Suggested i18n key |
|---|---|---|---|
| `alumni_invalid` | 22023 | a refused value: show on the field named in `detail` (`parseAlumniError(err)`). Reasons: `too_long`, `unknown` (a lookup key), `unknown_key`, `bad_value`, `bad_url`, `bad_date`, `future`, `required`, `manager_only`, `id_wins`, `parent_mismatch`, `needs_sector`, `requires_closed`, `exceeds_total`, `out_of_range`, `not_a_number`, `not_your_folder`, `file_missing`, `bad_path`, `already_member`, `use_my_profile`, `closed_vocabulary`, `system_value` | `alumni.err.invalid` + `alumni.reason.<reason>` |
| `national_id_invalid` | 22023 | detail `national_id:<empty\|digits\|length\|century\|date\|future\|governorate>` | `alumni.err.nid.<reason>` |
| `national_id_conflict` | soft `{ saved:false }` (founder) / 23505 (manager, detail = other founder id) | "this number is already registered; contact the Athar team" | `alumni.err.nidConflict` |
| `alumni_company_exists` | 23505 | a company with this name exists; do not reveal more | `alumni.err.companyExists` |
| `alumni_stale` | P0001 (never 40001: PostgREST 14 retries a serialization failure for ever; the same rule applies to `revision_conflict` of `save_node`, m52) | reload the company, re-apply the edit | `alumni.err.stale` |
| `alumni_not_found` | P0002 | row missing / invitation not pending | `alumni.err.notFound` |
| `alumni_rate_limited` | P0001 | too many ID attempts (5 / hour) or invitations (20 / day) | `alumni.err.rateLimited` |
| `alumni_in_use` | 23503 | a lookup value used by companies: deactivate instead | `alumni.err.inUse` |
| `forbidden` | 42501 | wrong role or not a member of the company | existing |

## 5. Shared UI blocks (`src/shared/alumni/*`, created by the founder-side builder first; extend `ui/`, do not fork it)

| Block | Purpose |
|---|---|
| `useAlumniLookups` consumers: `LookupSelect`, **`ChipSelect`** (single / multi, `aria-pressed`, ≥ 44 px, RTL) | every lookup field (stage, startup type, legal status, closing reason, after closing, education, visibility) |
| **`SectorPicker`** | sector then sub sector (`subsectorOptions`); changing the sector clears the sub sector |
| **`GovernoratePicker`** | the 27 company locations (`lookupOptions(l, 'governorate', lang)`), never 88 |
| **`NationalIdField`** | digits input (`digitsOnly`), calls `previewNationalId` at 14 digits, shows the derived card ("Born 1995-01-01 · 31 · Male · From: Cairo"), the reason of an invalid number, the self-declared date / gender inputs **only while there is no ID**, the `replaced` notice, the masked value for managers, the conflict message |
| **`DerivedValue`** | a read-only value with its origin badge ("from your ID" / "self-declared") |
| `ProfileSection` + `FounderIdentitySection`, `CompanyBasicsSection`, `CompanyClassificationSection`, `CompanyLocationSection`, `CompanyOnlineSection` (website, app, LinkedIn, social links), `CompanyStatusSection` (open / closed + reason + after closing), `DirectoryVisibilitySection` | the forms of F4 / F5 / M3 |
| **`TeamEditor`** | records without an account (add / edit / remove), CEO radio, `has_account` badge, derived counts |
| **`ProgramsReadOnlyList`** | derived Program Scope / Program Name / Support (chips) |
| **`MetricsTable`** | metrics as rows, years as columns, "add year" (`missingYears`), `female ≤ total`, source / updated-at hint; delete a year = manager only |
| **`CompletenessMeter`** | `percent` + the missing keys with links to the section (`completenessTone`) |
| **`DirectoryFilters`** + `CompanyCard` / `CompanyRow` | the member and manager directories (the manager version adds the manager filters) |
| `exportToXlsx(result)` | turns the `export_alumni_rows` payload into a sheet with `lib/export/xlsx.js` |

**Images**: company logo = `uploadImage(file, { ownerId: 'alumni/' + userId, kind: 'logo', profile: 'avatar' })` (WebP only, no SVG; server rule: the founder writes only `public-assets/alumni/<own uid>/logo/…`; the path is then sent as `logo_path`, the RPC checks the folder and that the file exists). Founder photo = `storeImage(file, { bucket: 'founder-assets', profile: 'avatar', path: (ext) => 'founders/' + userId + '/photo/' + newId() + '.' + ext })`, sent as `photo_path`, displayed through a signed URL (private bucket). Never call `.upload()` directly (lint rule).

## 6. Query keys and refresh

`alumniKeys` in `data/alumni.js` (`root`, `lookups`, `me`, `myCompany(id)`, `directory(params)`, `adminCompany(id)`, `adminFounder(id)`, `analytics(params)`, `invitations(params)`). `useAlumniMutations()` invalidates everything under `['alumni']` after any save (the payloads are small and a save changes several); vocabulary mutations refresh only the lookups. A reveal is never cached by key. Directory pages use `placeholderData` (kept previous page while paging).

## 7. Tests the builders add

Components render with the sample payloads above (Arabic + English, 375 px); `NationalIdField` never renders the full number unless it is the owner's own form; a founder payload test proves no `internal` and no other founder's derived values are rendered; the export page test proves the header texts and order are used unchanged. Keep `npm run lint`, `npx vitest run`, `npm run build` green.
