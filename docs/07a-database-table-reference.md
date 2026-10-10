# 07a — Database Table Reference (as-is)

> Companion to `07-database-schema-rls-and-migrations.md`. Exhaustive per-table reference for the `public` schema of Supabase project `nipunwrewluxaikyfbzg` (Postgres 17.6.x per `supabase/.temp/postgres-version`).
>
> **Method.** Column, constraint, index, trigger and RLS facts were read **read-only from the live database** (information_schema, pg_constraint, pg_indexes, pg_policies, pg_proc, pg_trigger, pg_stat_user_tables) on 2026-10-10 and cross-checked against `supabase/migrations/*.sql` and `src/types/database.types.ts`. The generated types file matches the live schema column-for-column for all 48 tables. No source file was modified and no migration was applied.
>
> **Legend.**
> - Types: `tstz` = timestamptz, `tstz?` = nullable. `genuuid` = `gen_random_uuid()`. `NN` = NOT NULL. A column without `NN` is nullable.
> - **Origin**: `M:<timestamp>` = created/altered by that migration in `supabase/migrations/`; `base` = exists in the live DB but **no CREATE statement exists in the repo** (created before the migration history, via the dashboard or an untracked tool); `live-only` = a column that exists live but is added by no migration.
> - **Rows** = approximate live row count (`pg_stat_user_tables.n_live_tup`, 2026-10-10).
> - Policy details are summarised per table here; the full matrix and analysis is in doc 07 section 6.

Contents: [A. Events, experts, startups](#a-events-experts-startups-and-agenda) · [B. Forms](#b-forms) · [C. Mentor booking](#c-mentor-booking) · [D. Ather-team booking](#d-ather-team-booking) · [E. Mentoring distribution](#e-mentoring-distribution) · [F. Alumni](#f-alumni-and-impact-platform) · [G. Roles/auth](#g-roles-auth-and-settings) · [H. Join Athar](#h-join-athar) · [I. Google / email settings](#i-google-and-email-settings-tables)

---

## A. Events, experts, startups and agenda

### `events` — base (no CREATE in repo) · ~16 rows
Central "project/event/cohort" entity. Referred to as "project" in the UI/roles code (`project_managers.project_id` points here) and as "cohort" in alumni comments.

| Column | Type | Null/Default | Origin |
|---|---|---|---|
| event_id (PK) | uuid | NN genuuid | base |
| event_name | text | NN | base |
| header_image_url, background_image_url, footer_image_url | text | null | base |
| header_height | text | '16rem' | base |
| created_at | tstz | now() | base |
| status | text | 'active' | base |
| company_portal_enabled, expert_portal_enabled | bool | true | base |
| company_portal_message, expert_portal_message | text | null | base |
| submission_deadline | tstz | null | base |
| experts_color / startups_color | text | '#9333ea' / '#059669' | base |
| header_settings | jsonb | '{}' | base |
| gsheets_url | text | null | base |
| form_cover_image_url | text | null | base |
| seo_title, seo_description, seo_image_url | text | null | base |
| show_day_names | bool | true | base |
| event_name_ar | text | null | base |
| admin_email | text | null | M:20260708000000 |
| selection_process_gsheets_url | text | null | M:20260708000002 |
| interview_admin_emails | text[] | '{}' | M:20260709000000 |
| interview_email_template_subject / _body | text | default English template | M:20260709000000 |
| **name** | text | null | live-only (duplicates event_name) |
| **id** | uuid | null, no default | live-only (duplicates event_id; not a key) |
| interview_cc_emails | text[] | '{}' | M:20260713000000 |
| rejection_admin_emails, rejection_cc_emails | text[] | '{}' | M:20260721000000 |
| rejection_email_template_subject / _body | text | default English template | M:20260721000000 |
| program_id | uuid | null, FK programs ON DELETE SET NULL | M:20260721100000 |
| acceptance_admin_emails, acceptance_cc_emails | text[] | '{}' | M:20260721200000 |
| acceptance_email_template_subject / _body | text | null | M:20260721200000 |
| meeting_link_mode | text | 'unique' | M:20260810000000 |
| shared_google_meet_link | text | '' | M:20260810000000 |
| mentor_admin_emails, mentor_cc_emails | text[] | '{}' | M:20260820000000 |
| mentor_email_template_subject / _body | text | default English template | M:20260820000000 |

- **Constraints:** PK(event_id); FK program_id → programs(program_id) SET NULL. No CHECK on `status`, `meeting_link_mode`.
- **Indexes:** `idx_events_program_id`.
- **Triggers:** none.
- **RLS (8 policies):** `Public CRUD events` (ALL, anon+authenticated, true) and `Write access for authenticated users on events` (ALL) coexist with role-based `events_select_by_pm_or_admin`, `events_insert_by_pm_or_admin`, `events_update_by_owner_or_admin`, `events_delete_by_owner_or_admin` (from M:20261004) and two public SELECT policies. Because permissive policies are OR-ed, the role-based policies grant nothing beyond the public ones.
- **Notes:** Doc 07 section 8 (events carries four email-template groups; duplicated name/id columns).

### `programs` — M:20260721100000, extended M:20260924000001 · 3 rows
| Column | Type | Null/Default |
|---|---|---|
| program_id (PK) | uuid | NN genuuid |
| name | text | NN |
| description | text | null |
| created_at, updated_at | tstz | now() |
| name_ar | text | null (M:20260924000001) |
| program_type | text | 'accelerator' (comment: accelerator/bootcamp/fellowship/workshop/other; no CHECK) |
| year | smallint | null |
| status | text | 'active' (comment: active/completed/archived; no CHECK) |

- **Triggers:** `programs_updated_at` BEFORE UPDATE → `update_programs_updated_at()`.
- **RLS (4 policies):** all four commands require `auth.role() = 'authenticated'` (roles `{public}` but body restricts) — the only domain table not readable by anon.
- **Note:** migration 20260721100000 file begins with a UTF-8 BOM.

### `experts` — base · ~65 rows
Per-event expert (speaker/mentor profile shown on the public agenda).

| Column | Type | Null/Default |
|---|---|---|
| expert_id (PK) | uuid | NN genuuid |
| event_id | uuid | FK events(event_id) ON DELETE CASCADE |
| name | text | NN |
| role, title, company, bio, photo_url, linkedin_url | text | null |
| sort_order | int4 | 999 |
| master_id | uuid | FK master_experts(id) ON DELETE SET NULL |
| name_ar, title_ar, company_ar, bio_ar | text | null |

- **Indexes:** `idx_experts_event_id`. **Triggers:** `trg_auto_index_expert` AFTER INSERT/UPDATE → `handle_expert_auto_index()` (SECURITY DEFINER; upserts into `master_experts` by `name` and writes back `experts.master_id`).
- **RLS (5):** `Public CRUD experts` ALL true (anon+auth); `Write access for authenticated…` ALL; `Allow anonymous insert/update on experts`; public SELECT → fully open.

### `master_experts` — base · ~42 rows
Global expert registry ("master record") auto-populated from `experts`.

Columns: id (PK uuid genuuid), name NN, title, company, bio, photo_url, linkedin_url, created_at, updated_at (now()), name_ar, title_ar, company_ar, bio_ar.
- **Indexes:** `master_experts_name_idx` UNIQUE(name) (this is what `ON CONFLICT (name)` in `handle_expert_auto_index` relies on).
- **Triggers:** `trg_broadcast_master_expert` AFTER UPDATE → `broadcast_master_expert_updates()` (SECURITY DEFINER; pushes name/title/company/bio/photo/linkedin to all linked `experts`; does not propagate the `_ar` columns).
- **RLS: DISABLED** (Supabase advisor `rls_disabled_in_public`, ERROR). No policies.

### `expert_submissions` — base · 0 rows
Columns: submission_id (PK uuid `uuid_generate_v4()`), event_id (FK events CASCADE), status ('pending'; CHECK in pending/approved/rejected), expert_name NN, photo_url, title, company, bio, additional_data jsonb '{}', submitted_at, reviewed_at, reviewed_by (text), rejection_reason, created_at, updated_at, form_id (FK event_forms ON DELETE SET NULL).
- **Index:** `idx_expert_submissions_event (event_id, status)`. **Trigger:** `update_expert_submissions_updated_at`.
- **RLS (5):** public INSERT x2; public SELECT x2 (`using true` — any visitor can read all submissions); UPDATE any authenticated. No DELETE policy.

### `companies` — base, extended M:20260924000001 · ~161 rows
Startup/company record. Used both for per-event "startups" shown publicly and (since the alumni work) as the alumni company master (`is_alumni`).

| Column | Type | Null/Default | Origin |
|---|---|---|---|
| company_id (PK) | uuid | NN genuuid | base |
| event_id | uuid | FK events CASCADE | base |
| name | text | NN | base |
| sector, industry, founder, location, employees (text), status, bio, logo_url, website_url, linkedin_url, description, stage, governorate, role | text | null | base |
| links | jsonb | '[]' | base |
| sort_order | int4 | 0 | base |
| display_config | jsonb | `{"show_role":true,"show_links":true,"show_stage":true,…}` | base |
| name_ar, description_ar, industry_ar, founder_ar, location_ar, governorate_ar | text | null | base |
| is_alumni | bool | false | M:20260924000001 |
| founding_year | smallint | null | M:20260924000001 |
| province | text | null | M:20260924000001 |

- The migration also does `ADD COLUMN IF NOT EXISTS description_ar, website_url` — both already existed (no-ops).
- **Indexes:** `idx_companies_event_id` (base), `idx_companies_is_alumni`.
- **RLS (5):** all open to anon (ALL true, anon INSERT, anon UPDATE, public SELECT) plus an authenticated ALL.
- **Note:** `event_id` is a single FK, so a company row belongs to exactly one event; cross-cohort membership is modelled separately in `program_participations`.

### `company_submissions` — base · ~384 rows
Applications submitted via the public company form (selection process).

Columns: submission_id (PK uuid `uuid_generate_v4()`), event_id (FK events CASCADE), status ('pending'; CHECK in screening/pending/interview/approved/holding/rejected/displayed), startup_name NN, logo_url, industry, location, additional_data jsonb '{}', submitted_at, reviewed_at, reviewed_by, rejection_reason, created_at, updated_at, form_id (FK event_forms SET NULL), founder_name, company_name, founder_email, national_id, phone, email_send_count jsonb '{}'.
- **Index:** `idx_company_submissions_event (event_id, status)`. **Trigger:** `update_company_submissions_updated_at`.
- **Realtime:** the only table in the `supabase_realtime` publication.
- **RLS (5):** public INSERT x2, public SELECT x2 (every visitor can read all rows, including `founder_email`, `national_id`, `phone`), authenticated UPDATE. No DELETE policy.
- **Note:** `startup_name` (NN) and `company_name` (nullable) both exist; see doc 07 section 8.

### `event_days` — base · ~37 rows
Columns: day_id (PK uuid genuuid), event_id (FK events CASCADE), day_number int4, day_name NN, day_date date, day_name_ar. Index `idx_event_days_event_id`. RLS: four overlapping policies, all effectively public ALL.

### `agenda_slots` — base · ~248 rows
Columns: slot_id (PK uuid genuuid), day_id (FK event_days CASCADE), start_time text, end_time text (times stored as text), slot_title NN, presenter_name, show_presenter bool false, sort_order int4 999, bullet_points jsonb '[]', slot_title_ar, presenter_name_ar, bullet_points_ar jsonb '[]'. Index `idx_agenda_slots_day_id`. RLS: four overlapping policies, effectively public ALL.

### `library_resources` — base · ~23 rows
Columns: resource_id (PK uuid `uuid_generate_v4()`), event_id (FK events CASCADE; null allowed for central items), title_en NN, title_ar NN, resource_type NN (CHECK `valid_resource_type`: readable/audible/visual/link), url NN, is_central bool false, sort_order int4 0, created_at. Index `idx_library_resources_event_id`. RLS (3): `Admin All Resources` (authenticated), `Public CRUD library_resources` (ALL true anon+auth), public SELECT → public ALL.
- **Note:** despite the name this is unrelated to `library_forms` (the form library).

---

## B. Forms

### `event_forms` — base, extended M:20260824000000, M:20260907000000 · ~7 rows
A form instance attached to an event (selection process / company / expert registration).

| Column | Type | Null/Default | Origin |
|---|---|---|---|
| form_id (PK) | uuid | NN genuuid | base |
| event_id | uuid | FK events CASCADE | base |
| form_name | text | NN | base |
| target_module | text | NN, CHECK in (company, expert, selection_process) | base |
| is_active | bool | true | base |
| created_at, updated_at | tstz | now() | base |
| cover_id | uuid | FK form_covers SET NULL | M:20260824 |
| cover_image_url, thank_you_message, thank_you_image_url, share_title, share_description, share_image_url, description, form_name_ar | text | null | M:20260824 |
| show_thank_you_image | bool | true | M:20260824 |
| social_channels_config | jsonb | `{facebook,whatsapp,linkedin,instagram,telegram: true, custom: []}` | M:20260824 |
| integrations | jsonb | `{"selection_process":false,"companies_list":false,"attendees_list":false}` | M:20260824 |
| library_form_id | uuid | FK library_forms SET NULL | M:20260907 |

- **Not present live (despite migrations 20260908 / 20260909):** `sections jsonb`. The frontend instead stores sections inside `integrations.form_sections` (api.js ~2898–3000).
- **Indexes:** `idx_event_forms_event_id` (base), `idx_event_forms_library_form_id`. **Triggers:** none (no `updated_at` trigger).
- **RLS (4):** `Authenticated insert/update/delete event_forms` are named "Authenticated" but have roles `{public}` and `true` — anyone can write. Public SELECT.

### `form_field_configs` — base · ~93 rows
Per-question configuration for the dynamic form builder.

Columns: config_id (PK uuid `uuid_generate_v4()`), event_id (FK events CASCADE), entity_type NN (CHECK company/expert/selection_process), field_name NN, field_label NN, field_type NN (CHECK text/textarea/email/url/select/multiselect/number/tel/file/date/hidden), field_options jsonb '[]', is_required bool false, show_in_card bool false, placeholder, help_text, validation_rules jsonb '{}', display_order int4 0, created_at, updated_at, is_custom bool false, form_id (FK event_forms CASCADE).
- **UNIQUE(event_id, entity_type, field_name)** — constrains per event+entity, not per form (two forms on the same event+entity cannot reuse a field_name).
- **Indexes:** `idx_form_configs_event (event_id, entity_type)`, `idx_form_field_configs_form_id`. **Trigger:** `update_form_field_configs_updated_at`.
- **Not present live:** `section_id` (migrations 20260908/09 add it, with FK to the non-existent `form_sections`). `field_type` CHECK has no `phone`/`radio`/`checkbox` although migration 20260908 is titled "…phone_validation" (it contains no phone-related SQL).
- **RLS (3):** public SELECT x2; authenticated ALL (`auth.uid() is not null`).

### `form_covers` — M:20260824000000 · ~3 rows
Columns: cover_id (PK uuid genuuid), event_id (FK events CASCADE), name NN, image_url NN, created_at, updated_at. No indexes besides PK, no updated_at trigger. RLS: `Public all form_covers` (ALL true) + `Public read form_covers`.

### `form_responses` — M:20260824000000 (re-declared M:20260906000000), extended M:20260907000000 · 0 rows
Columns: response_id (PK uuid genuuid), form_id NN (FK event_forms CASCADE), event_id NN (FK events CASCADE), source text 'direct', tracking_data jsonb '{}', answers jsonb NN '{}', status text 'submitted', submitted_at, created_at, updated_at (now()), library_form_id (FK library_forms SET NULL, M:20260907).
- **Indexes live:** only `idx_form_responses_library_form_id`. Migration 20260906000000 declares `idx_form_responses_form_id`, `_event_id`, `_submitted_at` — **absent live**.
- **RLS (3):** `Public all form_responses` (ALL true), plus public INSERT and SELECT (redundant) — every response is publicly readable/editable/deletable.
- **Note:** 0 rows although `company_submissions` has ~384; `scratch/backfill_responses.js` is a one-off script to copy submissions into `form_responses` (not in migrations). `company_snapshots.form_response_id` references this table.

### `form_share_events` — M:20260824000000 · 0 rows
Columns: id (PK uuid genuuid), form_id NN (FK event_forms CASCADE), platform NN, clicked_at now(), user_agent. RLS: public INSERT + SELECT. (No FK to library forms; no index on form_id.)

### `library_forms` — M:20260907000000 · ~1 row
Reusable "central" form templates.

Columns: id (PK uuid genuuid), form_name NN, form_name_ar, description, target_module text 'selection_process' (no CHECK, unlike event_forms), scope text 'global' CHECK in (global, specific), event_id (FK events SET NULL; ON DELETE differs from event_forms' CASCADE), fields jsonb '[]', cover_id (FK form_covers SET NULL), cover_image_url, thank_you_message, thank_you_image_url, show_thank_you_image true, share_title, share_description, share_image_url, social_channels_config jsonb (same default), integrations jsonb `{"selection_process":false,"companies_list":false,"mentors_list":false}`, import_count int4 0, created_at, updated_at.
- **Indexes:** `idx_library_forms_scope`, `idx_library_forms_event_id`. No updated_at trigger.
- **RLS (4):** public SELECT/INSERT/UPDATE/DELETE (`true`).
- **Not present live:** `sections jsonb` (migration 20260908).

### `form_sections` — **DOES NOT EXIST LIVE** (in repo only)
Created by both `20260908000000_create_form_sections_and_phone_validation.sql` and `20260909000000_create_form_sections.sql` (identical DDL: id uuid PK, form_id FK event_forms CASCADE, title NN, description, order_index int 0, created_at, updated_at; indexes on form_id and order_index; RLS with `Public select` + `Public all`). Both migrations are listed in the live migration history (`list_migrations`), yet the table, `form_field_configs.section_id`, `event_forms.sections`, `library_forms.sections` and the related indexes are absent from the live DB and from `database.types.ts`. Frontend code (`src/lib/api.js` ~2905–3015) probes for the table ("only if it exists in DB") and falls back to JSON in `event_forms.integrations.form_sections`.

---

## C. Mentor booking

### `mentors` — M:20260707000000 (+ M:20260707000001) · ~4 rows
Columns: id (PK uuid genuuid), event_id **text** NN, name NN, email NN, created_at, updated_at, bio (M:…0001), master_id **text** (M:…0001; no FK), **photo_url** text (live-only), **advance_notice_minutes** int4 1440 (live-only).
- **UNIQUE(event_id, email)**. Indexes `idx_mentors_master_id`.
- **RLS (5):** public SELECT x2; INSERT/UPDATE/DELETE authenticated. (Roles `{public}` with an `auth.role()` body.)
- **Notes:** `event_id` is TEXT with no FK to `events`; `master_id` is TEXT while `experts.master_id` is UUID FK → `master_experts`.

### `mentor_slots` — M:20260707000000 (+ M:20260716000001) · ~10 rows
Columns: id PK, mentor_id NN (FK mentors CASCADE), event_id text NN, start_time tstz NN, end_time tstz NN, is_available bool true, created_at, updated_at, meet_link text (M:…0716). Indexes `idx_mentor_slots_mentor_id`, `idx_mentor_slots_start_time`. RLS (6): public SELECT x2; INSERT/DELETE authenticated; UPDATE authenticated **and** `Allow anyone to update slot availability on mentor_slots` (anon, true — live-only policy; lets any visitor mutate any slot).

### `bookings` — M:20260707000000 (+0716000001, 0716000005, 0717000000) · ~2 rows
Columns: id PK, slot_id NN (FK mentor_slots CASCADE), mentor_id NN (FK mentors CASCADE), event_id text NN, company_name NN, booker_email NN, created_at, updated_at, meet_link, status text 'pending' (no CHECK), error_message, calendar_event_id, start_time tstz, end_time tstz, mentor_name text, mentor_email text (denormalised copies).
- **No uniqueness** on slot_id (a slot can be double-booked at DB level; `is_available` is managed by app/edge function).
- Indexes `idx_bookings_slot_id`, `idx_bookings_mentor_id`.
- **RLS (5):** INSERT x3 (`Allow anyone to insert into bookings`, `Allow public to create bookings`, repo-named `Allow everyone to insert bookings` is not present live); SELECT/UPDATE/DELETE authenticated.

### `booking_notifications` — M:20260708000001 · 0 rows
Columns: id PK, booking_id NN (FK bookings CASCADE), recipients text[] NN, data jsonb NN, sent_at, status 'pending', created_at, updated_at. Index `idx_booking_notifications_booking_id`. **RLS never enabled** (migration has no ENABLE ROW LEVEL SECURITY; advisor ERROR).

### `mentor_day_config` — M:20260806000000 · 0 rows
Columns: id PK, event_id text NN, day_number int NN, day_date date, session_start_time time '09:00', session_end_time time '17:00', slot_duration_minutes 30, break_between_slots_minutes 5, created_at, updated_at. UNIQUE(event_id, day_number); indexes `idx_mentor_day_config_event`, `…_event_day` (the latter duplicates the unique index). Trigger `mentor_day_config_updated_at`. RLS: `Allow all` ALL true (public).

---

## D. Ather-team booking

Parallel structure to section C for internal Athar team members (interviews with startups). Introduced by M:20260709000001.

### `ather_team_members` · ~3 rows
Columns: id PK, event_id text NN, name NN, email (nullable since M:20260711000001), photo_url, bio, created_at, updated_at, **advance_notice_minutes** int4 1440 (live-only).
- Unique **partial** index `idx_ather_team_members_event_id_email (event_id,email) WHERE email IS NOT NULL` (created in M:20260709000001 and again in M:20260711000002 after dropping the `ather_team_members_event_id_email_key` constraint that the original migration never created — the "drop" is a no-op).
- RLS (4): public SELECT; INSERT/UPDATE/DELETE authenticated.

### `ather_team_slots` · ~54 rows
Columns: id PK, ather_team_member_id NN (FK CASCADE), event_id text NN, start_time/end_time tstz NN, is_available true, created_at, updated_at, meet_link. Indexes member_id, start_time. RLS (5): public SELECT; INSERT/DELETE authenticated; UPDATE authenticated + anon `Allow anyone to update slot availability` (live-only).

### `ather_team_bookings` · ~29 rows
Columns: id PK, slot_id NN (FK ather_team_slots CASCADE), ather_team_member_id NN (FK CASCADE), event_id text NN, company_name NN, submission_id **text** (comment says it links to a company submission; no FK, type differs from `company_submissions.submission_id uuid`), booker_email NN, created_at, updated_at, meet_link, status 'pending', error_message, calendar_event_id, start_time, end_time, mentor_name, mentor_email (copied columns; names say "mentor" though the table is for team members).
- Indexes slot_id, member_id.
- **RLS DISABLED live** although the table has 4 policies (advisor ERROR `policy_exists_rls_disabled`). The repo migration 20260709000001 executes `ENABLE ROW LEVEL SECURITY`, so it was disabled afterwards by an untracked change.

---

## E. Mentoring distribution

### `mentoring_distribution_config` — M:20260725000001 (+0728, 0730, 0821) · ~2 rows
Columns: id PK, event_id **text** NN, start_time time '09:00', num_days int 1, total_round_minutes 300, slot_duration_minutes 15, break_slots jsonb '[]', is_published bool false, created_at, updated_at, unique_pairing bool true (M:0728), mentor_availability jsonb '{}' (M:0728), finalized_days int4[] '{}' (M:0821), timer_state jsonb (M:0821).
- UNIQUE(event_id) `mentoring_distribution_config_event_id_key` (declared inline in 0725 and re-asserted by 0730 because PostgREST upsert returned 400). Redundant index `idx_mentoring_config_event`.
- Trigger `mentoring_config_updated_at`. RLS: `Allow all` (ALL true, public). Migration comment says "Allow all authenticated users" but the policy is not restricted.

### `mentoring_distribution_day_config` — M:20260806000100 · ~3 rows
Columns: id PK, event_id **uuid** NN (no FK; parent table uses text), day_index NN, day_date, session_start_time '09:00', session_end_time, total_round_minutes, slot_duration_minutes, break_between_slots_minutes 0, mentor_ids uuid[] '{}', created_at, updated_at. UNIQUE(event_id, day_index); indexes duplicate the unique; trigger `md_day_config_updated_at`; RLS ALL true.

### `mentoring_sessions` — M:20260725000001 (+0821) · ~1148 rows
Columns: id PK, event_id text NN, day_index 0, slot_index 0, mentor_id uuid (comment "FK to mentors" – no FK), mentor_name, company_id uuid ("optional FK" – no FK), company_name, is_break false, has_conflict false, conflict_reason, slot_start_time time, slot_end_time time, created_at, updated_at, is_manual_override bool false (M:0821).
- Indexes `idx_mentoring_sessions_event`, `idx_mentoring_sessions_day_slot (event_id, day_index, slot_index)` — **not unique**. Trigger `mentoring_sessions_updated_at`. RLS ALL true.
- Largest table by row count.

---

## F. Alumni and impact platform

All created by `20260924000001_alumni_platform_foundation.sql` unless noted. All have 0 rows live except `companies`.

### `founders` · 0 rows
Columns: founder_id PK, name_ar NN, name_en, email, phone, linkedin_url, photo_url, bio_ar, bio_en, created_at, updated_at, auth_user_id uuid FK auth.users(id) ON DELETE SET NULL (M:20260925000000). Indexes `idx_founders_email` (not unique), `idx_founders_auth_user_id`. Trigger `trg_founders_updated_at`. RLS: `Public access founders` ALL true — any visitor can read all founder email/phone and write.

### `company_founders` · 0 rows
Columns: id PK, company_id NN (FK companies CASCADE), founder_id NN (FK founders CASCADE), role text 'founder', is_primary false, created_at, role_in_company text 'founder' (M:20260929000002; duplicate of `role`, no sync). UNIQUE(company_id, founder_id). Indexes on company_id, founder_id. RLS ALL true.

### `program_participations` · 0 rows
Columns: id PK, company_id NN (FK CASCADE), program_id NN (FK programs CASCADE), event_id (FK events SET NULL), start_date, end_date, graduation_status 'active' (active/graduated/dropped, comment only), notes, created_at, updated_at. UNIQUE(company_id, program_id, event_id) (NULL event_id rows are not de-duplicated). Indexes: `idx_program_participations_company` **and** `…_comp`, `…_program` **and** `…_prog`, `…_event` (4 duplicate indexes on 2 columns, M:20260924 and M:20260930). Trigger `trg_program_participations_updated_at`. RLS ALL true.

### `company_snapshots` · 0 rows
Append-only historical metrics per company.
Columns: **snapshot_id** PK uuid genuuid, company_id NN (FK CASCADE), snapshot_type NN (no default live; comments list program_start/graduation/annual_update/6_month_followup/manual_import), snapshot_date date CURRENT_DATE, source text 'founder' (founder/me_team/imported/system), data jsonb NN '{}', form_response_id (FK form_responses SET NULL), created_at, **id** uuid (nullable, default genuuid, not a key; added M:20260929000002).
- Indexes: company, type, date, `(company_id, snapshot_date DESC)`.
- RLS (4): public INSERT + public SELECT (from 20260924) plus authenticated `snapshots_insert_policy` / `snapshots_select_policy` (role/ownership-based, from 20260929000002). No UPDATE/DELETE policy ⇒ immutable via the API. The ownership-based SELECT is moot because `Public read snapshots` returns every row to everyone.
- `20260929000002` contains `CREATE TABLE IF NOT EXISTS company_snapshots (id PK, snapshot_id …)`, a different shape from the real table (skipped because it already existed).

### `certificates` · 0 rows
Columns: certificate_id PK, founder_id NN (FK CASCADE), program_id NN (FK CASCADE), event_id (FK events SET NULL), template_id text, issue_date date CURRENT_DATE, verification_code text NN UNIQUE default `left(gen_random_uuid()::text,12)`, pdf_url, issued_by, created_at. Indexes founder, program, code (duplicate of the unique index). RLS ALL true (public) — enumerable verification codes.

### `opportunities` · 0 rows
Columns: opportunity_id PK, type NN 'grant' (grant/investment/event/competition/partnership/other, comment only), title_ar NN, title_en, description_ar, description_en, deadline date, eligibility, link, image_url, is_active true, order_index 0, created_at, updated_at. Indexes type, is_active, deadline. Trigger `trg_opportunities_updated_at`. RLS: public SELECT; authenticated ALL.

### `opportunity_applications` · 0 rows
Columns: id PK, opportunity_id NN (FK CASCADE), company_id NN (FK CASCADE), founder_id (FK SET NULL), status 'applied' (applied/shortlisted/accepted/rejected, comment only), notes, applied_at. UNIQUE(opportunity_id, company_id). RLS ALL true.

### `investor_requests` · 0 rows
Columns: id PK, requester_name NN, requester_email NN, requester_org, company_id (FK companies SET NULL), request_type 'data_room', message, status 'pending', created_at. Indexes company, status. RLS: public INSERT; SELECT/UPDATE for any authenticated user (not role-limited).

### `alumni_invitations` — M:20260925000000 (+M:20260930000000) · 0 rows
Columns: id PK, company_id NN (FK companies CASCADE), founder_email NN, token NN UNIQUE, status NN 'pending' CHECK (pending/accepted/expired/revoked), sent_at, accepted_at, sent_by uuid (no FK), created_at, founder_id (FK founders SET NULL, M:0930). Indexes: token (duplicate of unique), company, founder, status, created_at DESC.
- RLS (4): public SELECT x2 (two identical policies; any visitor can list all invitation tokens and emails — the stated intent was "read by token"); authenticated ALL `true` (any signed-in user, including founders, can manage invitations) and `invitations_manager_all` (role-based, redundant given the previous).

### `notifications` — M:20260929000002 (+M:20260930000000) · 0 rows
Columns: id PK, recipient_id (FK auth.users CASCADE), founder_id (FK founders CASCADE), title NN, body NN, is_read false, created_at (utc now), sent_by (FK auth.users SET NULL), audience_type text 'founder', audience_target_id uuid, broadcast_id uuid, metadata jsonb '{}'. Indexes recipient, is_read, broadcast_id, created_at DESC.
- RLS (3, authenticated): SELECT own OR `recipient_id IS NULL` OR super_admin OR alumni_manager; UPDATE own/admin/manager; INSERT admin/manager/self. No DELETE. `recipient_id IS NULL` rows are readable by every authenticated user.

---

## G. Roles, auth and settings

### `profiles` — base · ~5 rows
Columns: id PK (FK auth.users CASCADE), full_name, avatar_color, updated_at, avatar_url (added by `scratch/add_avatar_url.sql`, never migrated). Populated by trigger `on_auth_user_created` on `auth.users` → `handle_new_user()` (SECURITY DEFINER, search_path=public; sets full_name = email local-part and a random avatar_color). RLS: public SELECT (all profiles viewable by everyone), INSERT/UPDATE own row. 5 profiles vs 12 user_roles rows (see anomalies).

### `user_roles` — base, restructured M:20260929000000, M:20261004000000 · 12 rows
Live columns: user_id NN (FK auth.users CASCADE), assigned_at tstz NN now(), id PK uuid genuuid, role **app_role** NN, created_at, updated_at (utc now). 
- **Live uniqueness: `user_roles_user_id_unique` UNIQUE(user_id)** (one role per user). The migrations define `user_roles_user_id_role_unique UNIQUE(user_id, role)`; that constraint is **absent live** and no file in the repo creates `UNIQUE(user_id)`.
- Indexes `idx_user_roles_user_id`, `idx_user_roles_role`.
- `role_key` (text) existed in the base table and was dropped by M:20261004000000 (`DROP COLUMN … CASCADE`); the trigger `trg_sync_user_roles` / function `sync_user_roles_role_columns()` were dropped by the same migration.
- Live data: 12 rows, all `super_admin`; 0 users with multiple roles. Backup file `supabase/backups/user_roles_backup_20261004.json` holds 13 rows for 12 distinct users (12 super_admin + 1 alumni_manager).
- RLS (2): SELECT own or super_admin; ALL super_admin.

### `roles` — base · 4 rows
Columns: id PK, key text NN UNIQUE, name_ar NN, name_en NN, description. Legacy lookup table that `user_roles.role_key` used to reference by value; now unreferenced by any FK or by the enum. RLS (1): SELECT authenticated. Contents not read.

### `project_managers` — base, restructured M:20260929000000 · 0 rows
Live columns: id PK, event_id NN (FK events CASCADE), user_id NN (FK auth.users CASCADE), role_in_project text NN 'collaborator' CHECK (owner/collaborator), assigned_at NN now(), assigned_by (FK auth.users, **no** ON DELETE action), project_id (FK events CASCADE), added_at (utc now), added_by (FK auth.users SET NULL).
- UNIQUE(event_id, user_id). Indexes event, project, user.
- Trigger `trg_sync_project_managers` BEFORE INSERT/UPDATE → `sync_project_managers_columns()` mirrors event_id↔project_id, assigned_at↔added_at, assigned_by↔added_by.
- RLS (4): SELECT own or super_admin; INSERT/UPDATE/DELETE super_admin or project owner (via SECURITY DEFINER helpers).
- Enum `project_role` (owner, collaborator) exists but the column is TEXT + CHECK, not the enum.

### `smtp_settings` — base · 1 row
Columns: id bigint PK (no default listed), smtp_host 'smtp.gmail.com', smtp_port 465, smtp_user NN, **smtp_pass NN (plaintext column; value not read)**, created_at. RLS enabled with **no policies** (nothing reachable via anon/authenticated API; only service role/edge functions). Referenced by 4 `.from('smtp_settings')` calls in src/supabase functions (see doc on edge functions).

### `email_audit_log` — base · 0 rows
Columns: id bigint PK (sequence `email_audit_log_id_seq`), event_id **text** NN, submission_id text, email_type NN, recipient NN, status NN, error_message, sent_by text, sent_at. Indexes event_id, submission_id. **RLS disabled** (advisor ERROR).

---

## H. Join Athar

Created together by M:20260911000000; each has a single `Public access … ` policy (ALL true).

| Table | Columns | Constraints / indexes | Rows |
|---|---|---|---|
| `join_athar_pages` | id PK; project_id **text** NN; cover_url; main_title NN 'Join Athar'; layout_columns NN 3; canvas_background_url; canvas_overlay_position jsonb `{"x":100,"y":100,"width":200,"height":200}`; created_at; updated_at | UNIQUE(project_id) + redundant `idx_join_athar_pages_project_id`; project_id has no FK to events | 1 |
| `join_athar_cards` | id PK; page_id NN (FK pages CASCADE); image_url; title NN ''; description; button_text NN 'Join Now'; button_url NN '#'; order_index NN 0; created_at; updated_at | indexes page_id, order_index | 4 |
| `join_athar_share_presets` | id PK; page_id NN (FK CASCADE); platform NN; preset_message ''; created_at; updated_at | UNIQUE(page_id, platform); index page_id (redundant) | 0 |
| `join_athar_analytics` | id PK; page_id NN (FK CASCADE); event_type NN (tab_view/card_share/image_upload/image_download, comment); card_id (FK cards SET NULL); platform; "timestamp" tstz now() | indexes page_id, event_type | 26 |

No `updated_at` triggers on these tables.

---

## I. Google and email settings tables

### `google_settings` — M:20260716000002 (+0003, 0004) · 2 rows
Columns: id PK, event_id **text** (nullable; UNIQUE since M:0003), service_account_key text (a Google service-account credential stored as plain text), calendar_id 'primary', created_at, updated_at, impersonate_email.
- RLS: public SELECT, INSERT, UPDATE (`true`). **The credential column is therefore readable by any anonymous API caller** (value not read for this document). No DELETE policy. No `updated_at` trigger.
- Indexes: unique `google_settings_event_id_key` + redundant `idx_google_settings_event_id`.

(See also `smtp_settings` in section G.)

---

## Triggers (live, public schema)

| Table | Trigger | Timing / events | Function |
|---|---|---|---|
| company_submissions | update_company_submissions_updated_at | BEFORE UPDATE | update_updated_at_column() |
| expert_submissions | update_expert_submissions_updated_at | BEFORE UPDATE | update_updated_at_column() |
| experts | trg_auto_index_expert | AFTER INSERT, UPDATE | handle_expert_auto_index() |
| form_field_configs | update_form_field_configs_updated_at | BEFORE UPDATE | update_updated_at_column() |
| founders | trg_founders_updated_at | BEFORE UPDATE | update_updated_at_column() |
| master_experts | trg_broadcast_master_expert | AFTER UPDATE | broadcast_master_expert_updates() |
| mentor_day_config | mentor_day_config_updated_at | BEFORE UPDATE | update_mentor_day_config_updated_at() |
| mentoring_distribution_config | mentoring_config_updated_at | BEFORE UPDATE | update_mentoring_updated_at() |
| mentoring_distribution_day_config | md_day_config_updated_at | BEFORE UPDATE | update_md_day_config_updated_at() |
| mentoring_sessions | mentoring_sessions_updated_at | BEFORE UPDATE | update_mentoring_updated_at() |
| opportunities | trg_opportunities_updated_at | BEFORE UPDATE | update_updated_at_column() |
| program_participations | trg_program_participations_updated_at | BEFORE UPDATE | update_updated_at_column() |
| programs | programs_updated_at | BEFORE UPDATE | update_programs_updated_at() |
| project_managers | trg_sync_project_managers | BEFORE INSERT, UPDATE | sync_project_managers_columns() |
| auth.users | on_auth_user_created | (auth schema) | handle_new_user() |

Five near-identical `updated_at` trigger functions exist live (`update_updated_at_column`, `update_programs_updated_at`, `update_mentoring_updated_at`, `update_mentor_day_config_updated_at`, `update_md_day_config_updated_at`). Tables with an `updated_at` column but no trigger: event_forms, form_covers, form_responses, library_forms, join_athar_*, mentors, mentor_slots, bookings, booking_notifications, ather_team_*, google_settings, profiles.
