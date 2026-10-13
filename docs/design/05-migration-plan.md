# Design 05 - Migration Plan (current schema to target schema, and application cut-over) (DRAFT for owner review)

Status: **design only. Nothing was implemented or executed.** No migration file was written, no persistent object was created and no row was changed in any database. Every fact about the current data was obtained with read-only `SELECT`s on the **local database copy** (`docker exec supabase_db_stack psql ...`, a Docker Postgres loaded from the live export of **2026-10-11T08:34Z**). Every transform shown as proven was run as `SELECT` / `CREATE TEMP TABLE` inside a transaction that was **rolled back** (section 11). The live Supabase project was never touched.

Labels: **[Decided]** = owner said so (`docs/11`, `docs/13`); **[Decided-by-delegation]** = recorded in `08-decisions-log.md` (authoritative, applied here, not reopened); **[As-is]** = measured on the local copy or found in code/docs (table, column or `docs/0x` section named); **[Proposal]** = this document's recommendation (reason, alternatives); **[Dry-run proven]** = the query was executed in a rolled-back transaction on the local copy and the result is quoted. Terms follow `00-conceptual-model.md`; table and column names of the target follow `04-database-design.md`.

Related documents: `01` node catalogue (which node absorbs which table), `02` data flow (edges, list items), `03` roles and RLS (rollout order, founder role rules), `04` target schema and crosswalk (this document verifies and completes its section 4), `06` frontend (legacy redirect table, env, cut-over of the client), `07` e-mail, Calendar, Apps Script retirement, secrets, `08` decisions (**authoritative**, especially section 7 database decisions).

Contents: 1 Principles - 2 Baseline measured on the local copy - 3 Migration architecture - 4 Crosswalk (4.1 tables, 4.2 every column, 4.3 value maps, 4.4 derived nodes and edges per event) - 5 Ordered phases with SQL approach and verification - 6 Verification framework and expected target numbers - 7 Data-risk register - 8 Cut-over plan - 9 Runbook of the future migration files - 10 Test plan - 11 Dry-run evidence - 12 Open Decisions for the Owner - 13 Notes on 00..08.

---

## 1. Principles [Proposal, applying `00`-`04` and `08`]

| # | Principle | How it is met |
|---|---|---|
| M1 | **Nothing is lost** [Decided: "existing data must be migrated, nothing lost"]. | Every current column is either carried (with a value map), merged, or listed as "not carried" in 4.2 **and stays untouched in the `legacy` schema** until the owner signs off. Rows that cannot be loaded are *quarantined*, never deleted. |
| M2 | **Idempotent and re-runnable.** | Every loader is an `INSERT ... ON CONFLICT (id) DO UPDATE` (or replaces one node's children inside one transaction) keyed on **preserved or deterministic ids** (M5). Running a phase twice yields the same rows. Loaders refuse to run once `migration.state.cutover_done = true` (so a re-run can never overwrite work done in the new app). |
| M3 | **Verified.** | Every phase ends with machine-checked reconciliation rows (`migration.recon`): row counts, referential checks, per-event business totals, column checksums. A mismatch raises an exception and the phase's transaction rolls back (section 6). |
| M4 | **Reversible.** | Old tables are **moved** to schema `legacy` (a metadata-only `ALTER TABLE ... SET SCHEMA`), never dropped or rewritten, so rollback is the reverse move plus dropping the new objects (section 8.6). Source data is deleted only after the written sign-off and a cool-off period (default 30 days). |
| M5 | **Old primary keys are preserved** [Decided-by-delegation 04-8]. Where one old row becomes one new row the old uuid is the new id; where the model creates a row that did not exist (system node, edge, list item for a provider, Legacy program) the id is a **deterministic UUIDv5** of the old id plus a role name, so re-runs and rehearsals produce identical ids. Verified: the preserved id spaces do not collide with each other (0 collisions among experts, companies and submissions; providers; slots; bookings; links) [Dry-run proven]. |
| M6 | **Faithful first, tidy later.** | Text is carried column-for-column (`name` to `name_en`, `name_ar` to `name_ar`, empty strings to `NULL`) with **no language heuristics**: the display rule `pick(lang)` with fallback renders exactly what renders today. Optional tidy steps (split bilingual strings, place Arabic-only text in `_ar`) are listed as a separate, post-sign-off, owner-approved step (OD-13); the numbers are given in 7. |
| M7 | **Legacy archive schema.** | `legacy` holds the 48 old tables intact (plus the old functions, enum and triggers). Quarantined rows are *views over those tables* (rule + flag), not second copies (G1). `legacy` has no grant for `anon`/`authenticated`, is not exposed by PostgREST, and holds the PII and secrets that the new schema must not carry (`national_id`, SMTP password, Google key) until they are destroyed. |
| M8 | **No secrets in the new schema.** | Plaintext secrets are not read by any loader. They are rotated/moved by owner actions (section 5 phase 14) and then nulled in `legacy`. |
| M9 | **Local first, live later, owner-approved.** | Everything is developed and rehearsed on the local stack. This document never changes the live project; section 8.8 lists what must be redone live, only after the owner approves. |
| M10 | **One source of truth after the move.** | After cut-over the new tables are the only live ones; no dual-write and no compatibility views in `public` (R1/G1). |

---

## 2. Baseline: what the local copy contains [As-is, measured]

Export date 2026-10-11T08:34Z (`local-db/export/VERIFY.md`). PostgreSQL 17.6. Database size 19 MB (public tables 6.7 MB; largest `company_submissions` 3.5 MB). **Every number below must be re-measured on a fresh export just before the real run** (the live data may have changed since); the migration asserts against `migration.baseline` captured at freeze (section 3.3), not against these numbers.

### 2.1 Row counts of the 48 public tables (the "before" side of the reconciliation)

| Table | Rows | Table | Rows | Table | Rows |
|---|---:|---|---:|---|---:|
| `agenda_slots` | 248 | `form_covers` | 3 | `mentors` | 4 |
| `alumni_invitations` | 0 | `form_field_configs` | 56 | `notifications` | 0 |
| `ather_team_bookings` | 29 | `form_responses` | 0 | `opportunities` | 0 |
| `ather_team_members` | 3 | `form_share_events` | 0 | `opportunity_applications` | 0 |
| `ather_team_slots` | 54 | `founders` | 0 | `profiles` | 12 |
| `booking_notifications` | 0 | `google_settings` | 2 | `program_participations` | 0 |
| `bookings` | 2 | `investor_requests` | 0 | `programs` | 3 |
| `certificates` | 0 | `join_athar_analytics` | 26 | `project_managers` | 0 |
| `companies` | 161 | `join_athar_cards` | 4 | `roles` | 4 |
| `company_founders` | 0 | `join_athar_pages` | 1 | `smtp_settings` | 1 |
| `company_snapshots` | 0 | `join_athar_share_presets` | 0 | `user_roles` | 12 |
| `company_submissions` | 384 | `library_forms` | 1 | | |
| `email_audit_log` | 0 | `library_resources` | 26 | | |
| `event_days` | 37 | `master_experts` | 42 | | |
| `event_forms` | 7 | `mentor_day_config` | 0 | | |
| `events` | 16 | `mentor_slots` | 10 | | |
| `expert_submissions` | 0 | `mentoring_distribution_config` | 2 | | |
| `experts` | 65 | `mentoring_distribution_day_config` | 3 | | |
| | | `mentoring_sessions` | 1,148 | | |

Also: `auth.users` 12, `auth.identities` 12 (all provider `email`, all confirmed, all addresses on the `athareg.com` domain), `storage.buckets` 1 (`event-assets`, public, no limits), `storage.objects` 112 (about 70 MB; 94 files exist, **18 are metadata-only**), 132 public policies + 5 storage policies, 145 indexes, 60 foreign keys, 14 triggers, 13 functions, publication `supabase_realtime` contains only `company_submissions`. Installed extensions: `pgcrypto`, `uuid-ossp`, `supabase_vault`, `pg_graphql`, `pg_net`, `pg_stat_statements`. **`citext`, `pg_trgm`, `btree_gist`, `fuzzystrmatch`, `pg_jsonschema`, `pg_cron` are available but NOT installed** (design 04 section 2.3 assumes `citext`; the first migration must `CREATE EXTENSION` them).

### 2.2 Business totals per event (the "checksum" side: must be identical after migration)

| Event (id prefix) | Name | Days | Agenda slots | Forms | Questions | Submissions | Companies | Experts | Mentors | Mentor slots | Mentor bookings | Team members | Team slots | Team bookings | Library | Dist. sessions | Form covers |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| c1522ab6 | Athar MSMEs incubation program_R1 | 6 | 35 | 1 | 0 | 0 | 73 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 850a186e | Athar Green Tech Accelerator | 3 | 19 | 0 | 0 | 0 | 20 | 12 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 240 | 0 |
| bc32fb64 | Athar MSMEs incubation program_Startups R2 | 2 | 12 | 0 | 0 | 0 | 16 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 9c5a305c | Technation Hackathon | 3 | 11 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 05163f32 | Athar MSMEs incubation program_R3 | 5 | 26 | 1 | 5 | 0 | 25 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2c84e330 | EBRD / Executive Management Workshop | 3 | 24 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| bdf987a0 | ClimAccelerator | 3 | 22 | 0 | 0 | 153 | 22 | 17 | 1 | 0 | 0 | 1 | 26 | 22 | 7 | 476 | 0 |
| 2ef83e04 | Technation Hackathon (Asyut) | 3 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3750a84e | Athar Green Tech / IR Bootcamp | 2 | 33 | 2 | 9 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 17 | 0 | 0 |
| 99cb10ba | Athar Green Tech Hackathon - 2nd Cycle | 0 | 0 | 0 | 0 | 147 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| c82e422f | Founder Camp | 0 | 0 | 1 | 5 | 65 | 0 | 0 | 0 | 0 | 0 | 1 | 20 | 6 | 0 | 0 | 0 |
| f5223948 | test | 1 | 1 | 1 | 37 | 1 | 0 | 0 | 1 | 9 | 2 | 0 | 0 | 0 | 0 | 0 | 3 |
| 6e283730 | Upper Egypt AI Hackathon | 3 | 18 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| b06f4d8c | ClimAccelerator / Climate Impact Workshop | 3 | 31 | 0 | 0 | 0 | 5 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 7b415db5 | founder | 0 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ae07c865 | Technation Hackathon R2 | 0 | 0 | 0 | 0 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | 16 events | 37 | **248** | 7 | 56 | **384** | **161** | 65 | 4 | 10 | 2 | 3 | 54 | 29 | 26 | **716** | 3 |

Not attached to any of the 16 events (orphans, section 7): 432 `mentoring_sessions` (empty `event_id`), and for one **deleted event** (`bdb9e11d-...`) 1 `ather_team_members`, 8 `ather_team_slots`, 1 `ather_team_bookings` (so 54 team slots = 46 migrated + 8 orphan; 29 team bookings = 28 + 1; 3 team members = 2 + 1). Programs: Finland 5 projects, Plan Asyut 5, Cerateiva Minya 3, **no program 3** (EBRD workshop, Founder Camp, `test`).

### 2.3 Findings that shape the plan (each quantified on the local copy)

| # | Finding [As-is] | Consequence in this plan |
|---|---|---|
| F1 | All 11 TEXT `event_id` columns hold **uuid-shaped values, 0 slugs** (`mentoring_sessions` 716 matching + 432 empty; `ather_team_*` have 54+3+29 uuid values of which 8+1+1 point at a deleted event). Slug-style URLs exist only through `getEvent()` matching **event names** (`api.js:111-170`). | Casting TEXT to uuid is safe for the 16 events; orphans are quarantined (7); the 16 name-derived slugs become public slugs (4.4) so name-style links keep working. |
| F2 | `company_submissions.form_id` is NULL on **382 of 384** rows; the answers are keyed by **Google-Sheet column headers** (multi-line bilingual text, 140 distinct headers in 5 events), not by question keys; typed columns `founder_*`, `phone`, `national_id`, `company_name` are filled for only 81 rows. | Each such event gets a "Legacy import" Form node whose questions are generated from the headers; answers are **re-keyed** (`q001`...), lossless (13,428 answered cells old = 13,428 new) [Dry-run proven]. |
| F3 | **National id is in the answers too**, not only in the column: 365 of 384 rows carry it (column or header "National ID" / "second member"); 5 distinct headers in 3 events. | `national_id` and every national-id answer key are **stripped from `form_responses.answers` and kept only in `legacy`** (04-5); owner gets a one-time export first (OD-5). |
| F4 | `master_experts` 42, `experts` 65 (all 65 point to a master, 42 distinct masters; no master is unused), `mentors` 4 (all with `master_id`, **2 of the 4 mentors are not in the event's expert list**), `ather_team_members` 3 (two share one e-mail but have different names). Per-event copies differ from the master only in empty-vs-NULL Arabic columns (2 rows hold an Arabic name the master lacks). | `network_experts` 42 + 2 team; experts become list items by reference; provider-only mentors get a **hidden** list item; the 2 Arabic names are promoted to the master (nothing lost). |
| F5 | **Naive derivation of session times would change the schedule**: stored `slot_start_time` differs from "day start + slot x (duration + gap)" computed from the *current* config for **240 of 716** sessions (all of event 850a: sessions were generated with 10-minute slots from 12:21 and the config was changed later to 16:32 / 20 min). | Per-day timing is **reconstructed from the stored sessions** (0 mismatches in 716) so the derived view `v_distribution_sessions` reproduces today's times exactly (OD-9). |
| F6 | The 432 orphan sessions all belong to event 850a (derivable by company/mentor), were created 2026-07-25 (a superseded generation; the live run is 2026-08-02) and **280 of them collide** with live rows on `(day, slot, mentor)`. | Quarantine is right (04-6); the evidence is attached so the owner can confirm. |
| F7 | `companies.role` is filled on **47** rows and `companies.founder` on 47 (design 04 says role/status are all NULL; `status` is, `role` is not). `display_config` is set on all 161 rows (3 variants); `sort_order` on all. | Founder text, role, `display_config` and `sort_order` go to the company **list item overlay** (no loss). |
| F8 | One agenda slot has `end_time <= start_time` (13:30-04:30) and one mentor slot has zero length; the target CHECKs reject both. | Fix list for the owner (OD-7); defaults described in 7. |
| F9 | 18 storage objects are metadata-only (all under `experts/c1522ab6-...`) and **none of them is referenced**; 59 further objects (40 MB) are not referenced by any row; 98 image references are external (Google Drive 97, `googleusercontent` 1). | Only the 46 referenced objects are re-pathed (30 MB, 5 over 1 MB); the rest stays in `event-assets` untouched; Drive images need a decision (OD-10). |
| F10 | E-mail templates: 16 events x 4 templates = 64 cells hold **7 distinct non-null variants** (3 defaults, 4 overrides); acceptance is NULL on 14 events. | One default set per node type plus **4 overrides** (4.4). |
| F11 | Three events have no program (3); `events.program_id` is `ON DELETE SET NULL`. | The Legacy program receives them (04-3). |
| F12 | `bookings` 2 are `pending` with no Meet link but their **slots carry the link**; 29 team bookings are `confirmed` with calendar event ids of Google format (26 chars). 7 unbooked mentor slots also carry pre-generated links. | A booking inherits the slot's Meet link; Google ids go to `legacy_calendar_event_id`; unbooked slot links stay in `legacy`. |
| F13 | `events.name` and `events.id` are `GENERATED ALWAYS` mirrors; `project_managers` and every alumni table are empty. | Never insert into generated columns; membership starts empty (super admins see all). |
| F14 | Realtime publication contains `company_submissions`; 3 edge functions read `smtp_settings`, 2 read `google_settings`, 4 read `events`/`company_submissions`. | Publication and function dependencies are handled in the cut-over (8). |

---

## 3. Migration architecture

### 3.1 Strategy: in-place, one freeze window, old tables moved to `legacy` [Proposal]
The target reuses 14 table names of the current schema (`programs`, `companies`, `agenda_slots`, `bookings`, `certificates`, `founders`, `company_founders`, `company_snapshots`, `form_covers`, `form_responses`, `profiles`, `roles`, `user_roles`, `alumni_invitations`, ...), so old and new tables cannot live side by side in `public`. The chosen sequence is: **(1)** freeze writers, **(2)** `ALTER TABLE ... SET SCHEMA legacy` for every old table (metadata-only, instant, transactional), **(3)** create the target in `public` (04/03 DDL), **(4)** load from `legacy.*`, **(5)** verify inside the transaction, **(6)** switch the application. All DDL in PostgreSQL is transactional, so steps 2-5 can be run as phase transactions that roll back cleanly when a check fails.

| Alternative | Verdict |
|---|---|
| **A. In-place move to `legacy` (chosen)** | Same project, same auth users and passwords, same storage URLs, same API keys. Downtime is the freeze window only (data is 19 MB: loads take seconds; the window is dominated by verification and deploy). Rollback = reverse move (8.6). |
| B. New Supabase project, copy data | Cleanest separation and trivially reversible by switching env back, but: new URL / anon key / JWT secret (all sessions invalid), `auth.users` and password hashes must be copied, every stored public storage URL (`.../object/public/event-assets/...`) breaks, and the Apps Script and edge-function configuration change. Kept as the **fallback** if rehearsals on A fail. |
| C. Build target in a shadow schema (`next`) and swap names | Rejected: policies, triggers and `search_path = ''` function bodies in 04/03 use schema-qualified names (`public.nodes`); a rename-swap would leave function bodies pointing at the wrong schema. |
| D. Dual-write or compatibility views in `public` | Rejected: violates G1 (two truths) and G2; the schema is small enough for a clean cut. |

### 3.2 Schemas
| Schema | Content | Exposure |
|---|---|---|
| `legacy` | the 48 old tables (rows untouched), old functions (`has_role`, `get_user_roles`, `handle_*`, `update_*`, `sync_project_managers_columns`, ...), enum `app_role`, old triggers, old policies | **no grant** to `anon`/`authenticated`; not in PostgREST `db-schemas`; removed from the `supabase_realtime` publication |
| `migration` | audit and control tables (3.3), loader functions `migration.load_*()`, check functions `migration.check_*()` | service role / `postgres` only |
| `app_private` | helpers, workers (04 section 2.1) | not exposed |
| `public` | target tables and RPCs (04) | per 03 |

### 3.3 Control tables in schema `migration` [Proposal; sketch]
```sql
create table migration.run        (id bigint generated always as identity primary key, phase text not null,
                                   started_at timestamptz default now(), finished_at timestamptz, status text, note text);
create table migration.baseline   (table_name text primary key, row_count bigint not null, captured_at timestamptz default now()); -- captured at freeze
create table migration.recon      (run_id bigint references migration.run, check_key text, expected text, actual text,
                                   status text check (status in ('ok','mismatch','warn')), detail jsonb, primary key (run_id, check_key));
create table migration.id_map     (entity text, old_id text, new_id uuid, note text, primary key (entity, old_id));  -- only where the id is NOT preserved
create table migration.asset_map  (old_path text primary key, bucket text, new_path text, kind text, bytes bigint, status text); -- storage (phase 13)
create table migration.flags      (id bigint generated always as identity primary key, code text, severity text check (severity in ('info','review','blocker')),
                                   entity text, ref_id text, message text, resolved_at timestamptz, resolved_by uuid);       -- items for owner/PM review
create table migration.fixups     (entity text, ref_id text, column_name text, new_value text, reason text, approved_by text,
                                   primary key (entity, ref_id, column_name));                                                 -- owner-approved corrections, applied by loaders (never by editing legacy)
create table migration.state      (key text primary key, value text);                                                          -- cutover_done, frozen_at, ...
```
`migration.fixups` is the only way to correct data (for example the agenda slot with end before start): loaders read it, so the correction is repeatable and the legacy row stays pristine.

### 3.4 Id strategy [Proposal; applies 04-8]
| New row | Id rule |
|---|---|
| `programs`, `projects`, `network_experts` (from `master_experts`), `companies`, `form_covers`, `form_templates`, `forms` / form `nodes`, landing `node`, `form_questions`, `form_responses`, `list_items` (from `experts`, `companies`, `company_submissions`), `agenda_days`, `agenda_slots`, `booking_providers`, `booking_slots`, `bookings`, `distribution_sessions`, `resources`, `landing_cards`, `certificates` | **old uuid preserved** |
| `network_experts` of kind `team` | old `ather_team_members.id` preserved (it is also the provider id: different tables, no clash, verified) |
| system and derived nodes (`view_host`, `agenda`, `list_*`, `selection`, `booking_*`, `distribution`, `library`, legacy-import form), `edges`, `public_links`, provider-only list items, `distribution_days`, Legacy program | `uuid_generate_v5(<fixed namespace>, <old id> \|\| ':' \|\| <role>)` (the extension is installed; 82 node ids computed in the dry run, 0 collisions) |
| `public_link_slugs` | current slug of an agenda link = **name-derived legacy slug** (16 unique valid values); forms, hosts and views = deterministic 10-character code from `sha256(legacy_ref)` (17); 33 slugs for 33 links |

### 3.5 Phase transactions and loader shape [Proposal]
Each phase of section 5 is one SQL file = one transaction (`BEGIN` ... checks ... `COMMIT`). Loaders are plain SQL functions so they can be re-run and unit-tested:
```sql
create function migration.load_companies() returns bigint language plpgsql as $$
declare n bigint;
begin
  insert into public.companies (id, name_en, name_ar, description_en, description_ar, industry_en, industry_ar, location_en, location_ar,
                                governorate_en, governorate_ar, stage, employees, founding_year, logo_path, website_url, linkedin_url, links,
                                is_alumni, origin_project_id, created_at, updated_at)
  select c.company_id, c.name, nullif(btrim(c.name_ar),''), coalesce(nullif(btrim(c.description),''), nullif(btrim(c.bio),'')), nullif(btrim(c.description_ar),''),
         ... , migration.asset_path('company-logo', c.logo_url), ..., c.event_id, <created_at>, now()
  from legacy.companies c
  on conflict (id) do update set name_en = excluded.name_en, ...;      -- idempotent
  get diagnostics n = row_count;
  return n;
end $$;
```
(`name_key` is `GENERATED`: never listed in the INSERT. `bookings.calendar_event_id` is `GENERATED`: the old Google id goes to `legacy_calendar_event_id`.)

### 3.6 How old and new coexist while testing on the local stack [Proposal]
Two PostgREST/Auth/Storage stacks cannot share one database, and one database cannot hold both schemas (3.1). So coexistence is **two stacks**, not two schemas:

| Stack | Purpose | Port set | Database |
|---|---|---|---|
| **A** `stack` (exists: `local-db/stack`, API 54321, DB 54322) | frozen **baseline**: runs the *current* app (a build of the current branch) exactly as live behaves today; source of truth for before/after comparisons | 543xx | restored from the export, never migrated |
| **B** `stack_next` (a copy of `local-db/stack` with `project_id = stack_next` and ports +1000: API 55321, DB 55322, Studio 55323) | **migration target**: restored from the same export (`local-db/run-import.sh` pointed at 55322), then migrations `m00`-`m20` (section 9), then storage migration, then the *new* app (`VITE_SUPABASE_URL=http://127.0.0.1:55321`) | 553xx | rebuilt on demand |

Rehearsal loop: wipe B, import the export, run the migration set, run the verification report (section 6), run the compare harness (10.2: the same public pages and RPC outputs from A and B, normalised, diffed) and the acceptance scenarios (section 10). A rehearsal is "clean" when the report has zero `mismatch` rows and zero `blocker` flags; **three consecutive clean rehearsals plus one on a fresh export of live** are a cut-over gate (8.2). Because A is never migrated, "before" numbers can be re-queried at any time and the old app can be demonstrated side by side.

---

## 4. Crosswalk: every current table and column [As-is, verified on the local copy; refines `04` section 4.2]

Disposition codes: **C** carried (renamed / typed), **M** merged into another target column, **D** moved into node `config` / edge / link, **O** moved into a list-item **overlay**, **Q** quarantined (not loaded, flagged, stays in `legacy`), **X** not carried (reason given; the column stays in `legacy.<table>` until sign-off). Everything marked X or Q is therefore still recoverable.

### 4.1 Table level (48 tables)

| Current table | Rows | Target | Expected target rows | Disposition |
|---|--:|---|--:|---|
| `programs` | 3 | `programs` (+ Legacy program) | 4 | C; `status` X |
| `events` | 16 | `projects` + `nodes` (system/derived) + `edges` + `public_links`/`public_link_slugs` + node configs | 16 projects | C/D (4.2) |
| `event_days` | 37 | `agenda_days` | 37 | C |
| `agenda_slots` | 248 | `agenda_slots` | 248 (1 with fixup) | C |
| `event_forms` | 7 | form `nodes` + `forms` + `public_links` (+og) | 7 | C |
| `form_field_configs` | 56 | `form_questions` | 56 | C |
| `form_covers` | 3 | `form_covers` (project-scoped) | 3 (+2 from `events.form_cover_image_url`) | C |
| `library_forms` | 1 | `form_templates` (global) | 1 | C |
| `form_responses` | 0 | `form_responses` | 0 | C (generic rule) |
| `form_share_events` | 0 | `node_events` | 0 | C (generic rule) |
| `company_submissions` | 384 | `form_responses` + `list_items`(selection) + `selection_reviews` (+ generated Legacy-import forms and questions) | 384 + 384 + 201; 148 generated questions | C/M/D |
| `expert_submissions` | 0 | `form_responses` + selection items | 0 | C (generic rule) |
| `master_experts` | 42 | `network_experts` (`kind='expert'`) | 42 | C |
| `experts` | 65 | `list_items(network_expert_id)` in expert lists | 65 | O |
| `mentors` | 4 | `booking_providers` (+ hidden list items for 2) | 4 (+2) | C |
| `ather_team_members` | 3 | `network_experts(kind='team')` + team list items + `booking_providers` | 2 each; 1 member Q | C/Q |
| `companies` | 161 | `companies` + `list_items(company_id)` | 161 + 161 | C/O |
| `mentor_slots` | 10 | `booking_slots` | 9 (1 zero-length Q) | C/Q |
| `ather_team_slots` | 54 | `booking_slots` | 46 (8 Q) | C/Q |
| `bookings` | 2 | `bookings` (mode mentor) | 2 | C |
| `ather_team_bookings` | 29 | `bookings` (mode interview) | 28 (1 Q) | C/Q |
| `mentor_day_config` | 0 | none | 0 | X (dead) |
| `mentoring_distribution_config` | 2 | `distributions` + `distribution_days` + `distribution_mentor_rules` | 2; 9; 3 | C/D |
| `mentoring_distribution_day_config` | 3 | `distribution_days` + `distribution_day_mentors` | (in the 9 days; 139 day-mentor rows total) | C |
| `mentoring_sessions` | 1,148 | `distribution_sessions` | 716 (432 Q) | C/Q |
| `library_resources` | 26 | `resources` (+ `library_selections` none) | 26 | C |
| `join_athar_pages` | 1 | landing `node` (+ `config`) | 1 | C/D |
| `join_athar_cards` | 4 | `landing_cards` | 4 | C |
| `join_athar_share_presets` | 0 | `landing_share_presets` (per page to per card) | 0 | C (generic rule) |
| `join_athar_analytics` | 26 | `node_events` | 26 | C |
| `certificates` | 0 | `certificates` | 0 | C (generic rule) |
| `program_participations` | 0 | `participants` | 0 | C (generic rule) |
| `project_managers` | 0 | `project_members` / `program_members` | 0 | C (generic rule) |
| `profiles` | 12 | `profiles` | 12 | C |
| `roles` | 4 | `roles` | 5 (+`integration`) | C |
| `user_roles` | 12 | `user_roles` | 12 | C |
| `founders`, `company_founders`, `company_snapshots`, `alumni_invitations`, `notifications`, `opportunities`, `opportunity_applications`, `investor_requests` | 0 each | same names (alumni, kept) | 0 each | C (generic rule) |
| `google_settings` | 2 | none (non-secret columns only to `migration.flags`/report) | 0 | X (secret; rotate) |
| `smtp_settings` | 1 | none | 0 | X (secret) |
| `email_audit_log` | 0 | `email_log` | 0 | C (generic rule) |
| `booking_notifications` | 0 | none | 0 | X (empty, replaced) |

**Generic rule for empty tables.** A table that is empty on the local copy may not be empty on live at cut-over (the export is a point in time). Every such table has a loader written from the same crosswalk so that rows present at freeze are migrated; the `recon` row for it is `old = new`, not `0 = 0`. Tables that **have no loader because no destination exists** (`mentor_day_config`, `booking_notifications`, `google_settings`, `smtp_settings`) get a **blocker flag** at freeze if they are non-empty (except the two secret tables, which are always kept in `legacy` and handled by owner actions).

### 4.2 Column level

#### `programs` (9 columns)
| Column | Disp | Target / transform |
|---|---|---|
| `program_id` | C | `programs.id` (preserved) |
| `name`, `name_ar` | C | `name_en`, `name_ar` (empty to NULL) |
| `description` | C | `description_en` (all NULL locally) |
| `program_type`, `year` | C | same names |
| `created_at`, `updated_at` | C | same |
| `status` | X | always `active` (3/3); completion is derived from projects (04 3.3) |
New columns: `visibility = 'private'`, `cover_path = NULL`, `archived_at = NULL`, `created_by = NULL`. **Legacy program**: one extra row, id `uuid_v5('program:legacy')`, `name_en = 'Legacy projects'` (name to be confirmed, OD-4).

#### `events` (46 columns, 2 generated)
| Column | Disp | Target / transform |
|---|---|---|
| `event_id` | C | `projects.id` (preserved), `public_links.legacy_ref` of the agenda link, seed of the derived node ids |
| `event_name`, `event_name_ar` | C | `projects.name_en`, `name_ar` |
| `name`, `id` (GENERATED) | X | mirrors of `event_name` / `event_id` (equal on 16/16 rows); never inserted |
| `program_id` | C | `projects.program_id`; NULL (3 rows) to the Legacy program |
| `created_at` | C | `projects.created_at` |
| `status` | X | always `active`; `completed_at` stays NULL |
| `header_image_url` | C | `projects.cover_path` after storage re-path (8 events; all in the bucket) |
| `background_image_url`, `footer_image_url` | D | agenda node `config.backgroundPath` / `config.footerPath` (0 rows set) |
| `header_height` | D | agenda `config.headerHeight` only when different from the node default (all 16 = `16rem`, so not stored) |
| `header_settings` (jsonb) | D | `{type, visible, fontSize, fontFamily, fontWeight}` to agenda `config.header`; `customExpertsLabel` / `customExpertsLabelAr` to the **experts tab edge** `label_en` / `label_ar` (1 event: "Trainer"); `hideExpertListTitle` to the expert list `config.hideTitle` |
| `show_day_names` | D | agenda `config.showDayNames` (10 true, 6 false) |
| `gsheets_url` | D | agenda `config.legacySheetUrl` (inert; Sheet import UI is dropped, 01-9) - 6 events; kept so nothing is lost |
| `selection_process_gsheets_url` | D | selection `config.sheetImport = {enabled:false, url}` (5 events) |
| `experts_color`, `startups_color` | D | list `config.accent` only if different from the node default (16/16 are `#9333ea` / `#059669`, so not stored) |
| `company_portal_enabled`, `expert_portal_enabled`, `company_portal_message`, `expert_portal_message`, `submission_deadline` | X | the legacy company/expert portals are replaced by public form pages (01 3.2); flags are `true` on 16/16, messages empty, deadline NULL on 16/16. If a deadline is non-NULL at freeze it becomes `forms.closes_at` of that event's forms (rule in loader) |
| `form_cover_image_url` | D | **2 events set** and the value is neither a registered `form_covers` row nor a form's cover, so it is **not a duplicate**: each becomes a project-scoped `form_covers` row named "Default form cover (migrated)" (deviation from 04, which drops it; Note 04-3) |
| `seo_title`, `seo_description`, `seo_image_url` | D | `public_links.og_title_en`, `og_description_en`, `og_image_path` of the agenda link (1 event) |
| `admin_email` | X | no UI reads it (04 4.1 #10); 1 row non-empty, flagged `info`, kept in `legacy` |
| `interview_admin_emails`, `interview_cc_emails`, `rejection_*`, `acceptance_*` (admin and cc arrays) | D | selection node `config.emailTemplates.<key>.admin` / `.cc` when non-empty (interview cc 1 event, acceptance cc 1, interview admin 1 on `c82e`) |
| `interview_email_template_subject/body`, `rejection_*`, `acceptance_*` | D | **only when different from the node-type default**: selection `config.emailTemplates.<key>` (4 overrides: interview 1, rejection 1, acceptance 2; 4.3) |
| `mentor_admin_emails`, `mentor_cc_emails` | D | booking(mentor) node `config.emails.booking_*.admin/.cc` (1 event, `f522`) |
| `mentor_email_template_subject/body` | D | identical on 16/16 (the default): not stored |
| `meeting_link_mode`, `shared_google_meet_link` | D | `booking_settings.meeting_link_mode`, `shared_meet_link` of every booking node of the event (1 event is `shared`, link present; 15 `unique`) |

#### `event_days` (6 columns) to `agenda_days`
`day_id` C `id`; `event_id` C `project_id` + `node_id` (derived agenda node); `day_number` C `sort_order`; `day_name` C `name_en`; `day_name_ar` C `name_ar` (empty to NULL); `day_date` C `day_date`. (`unique (node_id, sort_order)`: 0 duplicates.)

#### `agenda_slots` (12 columns) to `agenda_slots`
`slot_id` C `id`; `day_id` C `day_id`; `start_time`, `end_time` C `time` (cast of `HH:MM` / `HH:MM:SS` text: 0 failures; **1 row with end <= start**, fixup); `slot_title` C `title_en`; `slot_title_ar` C `title_ar`; `presenter_name`, `presenter_name_ar` C `presenter_en`, `presenter_ar`; `show_presenter` C (NULL to true); `sort_order` C; `bullet_points` + `bullet_points_ar` M `bullets jsonb` = `[{en, ar}]` zipped by position (28 + 0 items preserved) [Dry-run proven].

#### `event_forms` (20 columns) to form node + `forms` + link
| Column | Disp | Target |
|---|---|---|
| `form_id` | C | node id and `forms.node_id` (preserved), `public_links.legacy_ref` |
| `event_id` | C | `project_id` |
| `form_name`, `form_name_ar` | C | node `name_en`, `name_ar` |
| `target_module` | D | drives the edge Form to Selection when `selection_process` (5 forms); `company` / `expert` forms keep no edge (legacy portals) |
| `is_active` | C | `forms.is_active` (7/7 true) |
| `created_at`, `updated_at` | C | node timestamps |
| `cover_id` | C | `forms.cover_id` |
| `cover_image_url` | X | duplicate of the cover's image (matches 1/1) |
| `thank_you_message`, `thank_you_image_url`, `show_thank_you_image` | D | node `config.thankYou` (image re-pathed) |
| `share_title`, `share_description`, `share_image_url` | D | `public_links.og_*` of the form link |
| `social_channels_config` | D | node `config.social` |
| `integrations` | D | the five booleans become **edges** (all `false` on 7/7: no edge); `form_sections` becomes `form_sections` rows (6 rows); `google_sheets_url` key (none set) would become `forms.export_sheet_id` |
| `description` | D | node `config.description` (1 row) |
| `library_form_id` | C | `forms.template_id` (1 form) |

#### `form_field_configs` (17 columns) to `form_questions`
`config_id` C `id`; `form_id` C `node_id`; `event_id` X (redundant, equals the form's event 56/56) but kept as `project_id`; `entity_type` X (legacy engine; `selection_process` 42, `expert` 10, `company` 4); `field_name` C `key` (stable: 42 `custom_<ts>` keys and 14 core names, 0 duplicates per form; **no semantic is auto-assigned**, the PM maps semantics later); `field_label` C `label_en` (37 labels mix scripts; carried whole, M6); `field_type` C `type` (all 10 values are in the target CHECK); `field_options` C `options` (array; shape `["EN / AR", ...]` becomes `[{value, label_en}]`); `is_required` C; `show_in_card` D list card config (14 true) - flagged for the PM; `placeholder` C `placeholder_en`; `help_text` C `description_en`; `validation_rules` M `validation` (minus `section_id`, minus `description` which becomes `description_en`); `validation_rules.section_id` C `section_id` (37 questions; 0 dangling); `display_order` C `order_index`; `created_at`, `updated_at` C; `is_custom` X (derivable from key shape).

#### `form_covers` (6), `library_forms` (21)
`form_covers`: `cover_id` C; `event_id` C `project_id` (all 3 set, so none is global); `name` C; `image_url` C `image_path` (re-pathed); timestamps C. `library_forms`: `id` C; `form_name(_ar)`, `description` C `name_en/ar`, `description_en`; `target_module` X (modules are gone); `scope`='global' + `event_id` NULL C `project_id` NULL; `fields` M `definition.questions` (37) with the thank-you, share and social columns M `definition.settings`; `cover_id` C; `cover_image_url`, `share_image_url`, `thank_you_image_url` re-pathed inside `definition`; `integrations` X; `import_count` X (derived); `created_at`, `updated_at` C.

#### `company_submissions` (21 columns) to response + selection item + review
| Column | Disp | Target / transform |
|---|---|---|
| `submission_id` | C | `form_responses.id` **and** the selection `list_items.id` (different tables; no clash) |
| `event_id` | C | `project_id` |
| `form_id` | C | `node_id` = `form_id` for 2 rows; NULL (382) to the derived **Legacy-import form node** `uuid_v5(event_id:form_legacy)` |
| `submitted_at` | C | `form_responses.submitted_at` |
| `created_at`, `updated_at` | C | same |
| `additional_data` | M | `answers`: headers re-keyed to `q001...` (per event, ordered by frequency then text), `_column_order` dropped (used only to order the generated questions), `rejected_reason`/`holding_reason`/`approved_reason`/`tech_status` extracted (below), **national-id keys stripped (F3)**, the other keys kept (13,428 answered cells preserved) |
| `startup_name`, `company_name` | M | `answers.company_name` (= `startup_name`; `company_name` equals it on all 81 rows where set) |
| `founder_name`, `founder_email`, `phone` | C | `answers.founder_name`, `.founder_email`, `.phone` (semantic keys; 81 / 80 / 81 rows) |
| `location`, `industry`, `logo_url` | C | `answers.location`, `.industry`, `.logo` (legacy-import questions only where used; logo re-pathed) |
| `national_id` | **Q/X** | **not carried** (04-5); stays in `legacy.company_submissions` (restricted); 65 rows |
| `status` | C | selection `list_items.status` via the value map 4.3 (`displayed` keeps `overlay.legacy_status = 'displayed'`) |
| `rejection_reason` | X | never written (0 rows) |
| `reviewed_at` | C | `selection_reviews.reviewed_at` (190 rows: all approved + rejected) |
| `reviewed_by` | X | text, 0 rows set |
| `email_send_count` | X | 0 rows non-empty; if non-empty at freeze, migrated to `email_log` (07 1.8) |
| `additional_data.rejected_reason` / `.holding_reason` / `.approved_reason` | C | `selection_reviews.reason` = the reason of the **current** status (43 rows); the other 115 stale reasons go to `list_items.overlay.previous_reasons` (nothing lost) |
| `additional_data.tech_status` | O | `list_items.overlay.tech_status` (35 rows; PM custom column) |

#### `expert_submissions` (16), empty
`submission_id` C response id; `event_id` C; `status` C status map; `expert_name`, `photo_url`, `title`, `company`, `bio` M `answers` keys of a generated "Legacy expert import" form (same method as company submissions); `additional_data` M; `submitted_at`/`reviewed_at`/`reviewed_by`/`rejection_reason`/`created_at`/`updated_at`/`form_id` as for `company_submissions`. Loader exists, 0 rows now.

#### `form_responses` (11) to `form_responses`
`response_id` C `id`; `form_id` C `node_id`; `event_id` C `project_id`; `source` C; `tracking_data` C `tracking`; `answers` C `answers` (keys are question keys already: copied; the staging check verifies every key exists in `form_questions`); `status` C (map: anything not `reviewed`/`spam` to `submitted`); `submitted_at`, `created_at`, `updated_at` C; `library_form_id` X (lineage kept on the form). 0 rows.

#### `form_share_events` (5), `join_athar_analytics` (6) to `node_events`
`form_share_events`: `id` X (identity), `form_id` C `node_id`, `platform` C, `clicked_at` C `created_at`, `user_agent` X (PII-adjacent, dropped by 04), event_type = `form_share`. `join_athar_analytics`: `id` X, `page_id` C `node_id` (= page id preserved as the landing node id), `event_type` C (all 26 values are in the CHECK), `card_id` C (26/26 are NULL: the old save replaced card ids), `platform` C, `timestamp` C `created_at`.

#### `master_experts` (13) to `network_experts`
`id` C; `name`, `title`, `company`, `bio` C `name_en`, `title_en`, `company_en`, `bio_en`; `name_ar`, `title_ar`, `company_ar`, `bio_ar` C (empty to NULL; **if empty, taken from the per-event copies** `experts.*_ar`: 2 rows gain `name_ar`); `photo_url` C `photo_path` (18 rows point into the bucket and are re-pathed, 23 are Drive links (OD-10), 1 is empty); `linkedin_url` C; `created_at`, `updated_at` C; new `kind='expert'`, `email=NULL`, `created_by=NULL`.

#### `experts` (15) to `list_items`
`expert_id` C `list_items.id` (preserved: lets `mentoring_sessions.mentor_id` and `mentor_availability` keys resolve unchanged); `event_id` C `project_id` + `list_node_id` (derived expert list); `master_id` C `network_experts` FK (65/65 set, 0 duplicates per event); `name`, `title`, `company`, `bio`, `photo_url`, `linkedin_url`, `name_ar`, `title_ar`, `company_ar`, `bio_ar` X (copies of the master; equal to the master on every column except empty-vs-NULL Arabic, handled above); `role` O `overlay.role` (0 rows); `sort_order` C `list_items.sort_order`.

#### `mentors` (10), `ather_team_members` (9) to providers and experts
`mentors`: `id` C `booking_providers.id`; `event_id` C node; `name`, `bio`, `photo_url` X (copies of the master); `email` C `booking_providers.booking_email` (override; the master has no e-mail); `master_id` (TEXT) C cast to uuid: the provider's `list_item_id` is the event's existing expert item for that master, else a **hidden** provider-only item (`excluded = true`, 2 of 4); `advance_notice_minutes` C `advance_notice_min` when different from 1440 (0 of 4); `created_at`, `updated_at` C. `ather_team_members`: `id` C `network_experts.id` and `booking_providers.id`; `event_id` C; `name` C `name_en`; `email` C `network_experts.email`; `photo_url` C `photo_path`; `bio` C `bio_en`; `advance_notice_minutes` C (1 of 2 migrated differs: 60); `created_at`, `updated_at` C. A team list item `uuid_v5(team-item:<id>)` links the expert to the event's "Athar team" list.

#### `companies` (29 columns) to `companies` + list item
| Column | Disp | Target |
|---|---|---|
| `company_id` | C | `companies.id` and list item id (preserved) |
| `event_id` | C | `companies.origin_project_id` and the item's `project_id` + derived company list |
| `name`, `name_ar` | C | `name_en`, `name_ar` (`name_ar` is empty on 161/161; bilingual names sit in `name`: 28 Arabic-only, 26 mixed, kept as is, M6) |
| `description`, `bio` | M | `description_en` = description, else bio (bio 0 rows) |
| `description_ar`, `industry_ar`, `location_ar`, `governorate_ar` | C | `_ar` (0 rows set) |
| `industry`, `sector` | M | `industry_en` = industry, else sector (sector 0) |
| `location`, `governorate`, `province` | C/M | `location_en`, `governorate_en` (= governorate, else province: 0) |
| `stage`, `employees`, `founding_year`, `is_alumni` | C | same (stage 159, employees 0, founding_year 0, is_alumni 0 rows set) |
| `logo_url` | C | `logo_path` (4 in the bucket, 42 Drive, 1 googleusercontent, 114 empty) |
| `website_url`, `linkedin_url` | C | same (60 / 0 set) |
| `links` | C | `links` `[{type, url, label}]`: old `{icon, url, label}` with `icon` renamed to `type` (80 link objects preserved) [Dry-run proven] |
| `founder`, `founder_ar`, `role` | O | `overlay.founder_name`, `founder_name_ar`, `founder_role` (47 / 0 / 47 rows) |
| `display_config` | O | `overlay.card.show` (161 rows, 3 variants) |
| `sort_order` | C | `list_items.sort_order` (73 distinct values; ties by id) |
| `status` | X | 0 rows set |
New: `name_key` (generated). The 16 duplicate candidates are **not merged** here (4.5, OD-2).

#### `mentor_slots` (9), `ather_team_slots` (9) to `booking_slots`
`id` C; `mentor_id` / `ather_team_member_id` C `provider_id`; `event_id` C node; `start_time`, `end_time` C `starts_at`, `ends_at` (a zero-length slot is Q, an overlap would violate the GiST exclusion: 0 overlaps); `is_available` M `is_blocked` = `NOT is_available AND no booking` (0 admin-blocked: every unavailable slot is booked); `meet_link` M onto the booking of that slot (2 mentor + 29 team), and for the 7 **unbooked** mentor slots into `legacy` only; `created_at`, `updated_at` C/X.

#### `bookings` (16), `ather_team_bookings` (17) to `bookings`
`id` C; `slot_id` C; `mentor_id`, `ather_team_member_id` X (via slot to provider); `event_id` X (via node); `company_name` C `booker_company_name`, and for interview bookings matched by exact name to `booker_company_id` (17 of 28 match a company of the same event); `booker_email` C; `submission_id` X (never set); `meet_link` C `meet_link` **or the slot's link when the booking has none** (2 mentor bookings inherit) [Dry-run proven: 30 of 30 keep a link]; `status` M (4.3); `error_message` X (sync state belongs to `integration_jobs`); `calendar_event_id` C `legacy_calendar_event_id` (28 of 30); `start_time`, `end_time`, `mentor_name`, `mentor_email` X (copies; verified equal to the slot, 0 differences); `created_at`, `updated_at` C. `calendar_owner_connection_id` is set after the system connection exists (phase 14).

#### `booking_notifications` (8), `email_audit_log` (9)
Empty; `booking_notifications` X (replaced). `email_audit_log` to `email_log`: loader creates a synthetic `email_outbox` row (status per old `status`, `idempotency_key = 'legacy:'||id`, `sender_connection_id` NULL allowed for legacy rows, `email_key` from `email_type`) and an `email_log` row, so history is kept if rows exist at freeze (07 1.8).

#### `mentoring_distribution_config` (14) to `distributions` + `distribution_days` + rules
`id` X; `event_id` C node; `start_time` C `distributions.start_time` (node default for future generation); `num_days` M (days rows); `total_round_minutes` C `distribution_days.total_round_min` default; `slot_duration_minutes` C `distributions.slot_duration_min`; `break_slots` X (`[]` on 2/2); `is_published` C (2/2 true); `unique_pairing` C; `mentor_availability` M `distribution_mentor_rules` (23 entries: 16 `all` need no row; 3 are loaded (`excluded` becomes `days = '{}'`, a day list becomes `days = {..}`); **4 keys point at deleted experts and are Q**) [Dry-run proven]; `finalized_days` M `distribution_days.is_locked` (`{}` on 2/2: nothing locked); `timer_state` X (unused, runtime broadcast); `created_at`, `updated_at` C. `gap_min` default = 0 (every stored day has gap 0).

#### `mentoring_distribution_day_config` (12) to `distribution_days`
`id` X; `event_id` C node; `day_index` C; `day_date` C `day_date` (the agenda reference `agenda_day_id` is **not** set automatically: no implicit schedule connection exists today); `session_start_time` C `start_time`; `session_end_time` X (derived: start + rounds); `total_round_minutes` C; `slot_duration_minutes` C (overridden by the reconstruction below); `break_between_slots_minutes` C `gap_min`; `mentor_ids` M `distribution_day_mentors` (51 elements, all resolve); `created_at`, `updated_at` C. **Days without a row** (4 of 7 for `bdf9`, 2 of 2 for `850a`) are created from `num_days`.

#### `mentoring_sessions` (16) to `distribution_sessions`
`id` C; `event_id` (TEXT) C cast to uuid, **empty string Q** (432); `day_index` C `day_id` (derived `distribution_days` row); `slot_index` C; `mentor_id` C `mentor_item_id` (= `experts.expert_id`, preserved item id: 716 of 716 resolve in the same event); `company_id` C `company_item_id` (578 non-null, all resolve in the same event; 138 NULL kept); `mentor_name`, `company_name` X (equal to the source on 716 / 578 rows); `is_break` X (0 true); `has_conflict`, `conflict_reason` X (recomputed by validation; 0 true); `slot_start_time`, `slot_end_time` X **but used to reconstruct day timing (F5)**; `is_manual_override` C (0 true); `created_at`, `updated_at` C.

#### `library_resources` (9) to `resources`
`resource_id` C; `event_id` C node (derived library node); `title_en`, `title_ar` C (empty to NULL); `resource_type` C (`readable`/`visual`/`link` already inside the CHECK; anything else to `link`); `url` C: bucket URLs (5) become `file_path` (bucket `resources`), external URLs stay `url` (21); `is_central` X (0 true: central = `node_id NULL`); `sort_order`, `created_at` C. `mime`, `bytes` filled from `storage.objects` for the 5 files.

#### `join_athar_pages` (9), `join_athar_cards` (10), `join_athar_share_presets` (6)
`join_athar_pages`: `id` C landing node id; `project_id` (TEXT) C cast to the event; `cover_url` C node `config.hero.coverPath` (re-pathed); `main_title` C `config.title`; `layout_columns` C `config.layoutColumns`; `canvas_background_url`, `canvas_overlay_position` X (no UI); timestamps C. `join_athar_cards`: `id` C; `page_id` C `node_id`; `image_url` C `cover_path`; `title` C `title_en`; `description` C `body_en`; `button_text` C `cta_label_en`; `button_url` C `cta_url` (4 of 4 are the placeholder `#`; kept); `order_index` C `sort_order`; timestamps C. `join_athar_share_presets`: `page_id` + `platform` + `preset_message` M one `landing_share_presets` row **per card per platform** (page-level preset copied to each card; 0 rows now).

#### `certificates` (10), `program_participations` (10), `project_managers` (9)
Empty. `certificates`: `certificate_id` C `id`; `founder_id` M via the participant; `program_id`, `event_id` M via participant to project; `template_id` (text) X; `issue_date` C `issued_at`; `verification_code` C `code` (old 12-hex codes do not satisfy the new `code` CHECK: 0 rows today; if rows exist at freeze the loader keeps the old code in `snapshot.legacy_code`, issues a new code and the old one stays verifiable through a lookup in `verify_certificate`; Note 04-5); `pdf_url` X; `issued_by` C text to `issued_by` NULL + note. `program_participations`: `company_id` + `event_id` C one `participants` row per old row (`status` map: `graduation_status` to `accepted`/`attended`/`withdrawn`), `program_id` M via project, `start_date`, `end_date` X (derivable), `notes` C. `project_managers`: `event_id`/`project_id` M one `project_members` row, `user_id` C, `role_in_project` M (`owner` to `owner`, `collaborator` to `manager`), `assigned_at`/`added_at` M `created_at`, `assigned_by`/`added_by` M `added_by`.

#### Identity: `profiles` (5), `roles` (5), `user_roles` (6), `auth.users`
`profiles.id` C; `full_name` C; `avatar_url` C `avatar_path` (0 rows set); `avatar_color` X (derived from id, 12 values dropped); `updated_at` C; new `language='ar'` (default), `created_at` = `updated_at`. `roles`: `key` C PK; `name_ar`, `name_en`, `description` C; `id` X; plus the new row `integration` (and `is_staff` true for the three staff roles). `user_roles`: `user_id` C; `role` (enum) C `role_key` text; `id`, `updated_at` X; `assigned_at`, `created_at` M `created_at = least(...)`; `granted_by` NULL. `auth.users`/`auth.identities`: **untouched** (same ids, same hashes).

#### Alumni and founders (0 rows each)
`founders`: `founder_id` C `id`; `photo_url` C `photo_path`; `name_ar`, `name_en`, `email` (to `citext`, unique where not null), `phone`, `linkedin_url`, `bio_ar`, `bio_en`, `created_at`, `updated_at`, `auth_user_id` C. `company_founders`: `id` X; `role` M `role_in_company` (coalesce) C `role`; `is_primary`, `created_at` C; PK becomes `(company_id, founder_id)`. `company_snapshots`: `snapshot_id` C `id` (the nullable duplicate `id` column is dropped); other columns C; `form_response_id` FK now points at the unified `form_responses`. `alumni_invitations`, `notifications`, `opportunities`, `opportunity_applications`, `investor_requests`: all columns C unchanged (`company_id` FKs now reference the new `companies.id`, which equals the old id).

#### Secrets tables
`google_settings` (`id`, `event_id`, `service_account_key`, `calendar_id`, `created_at`, `updated_at`, `impersonate_email`): **X** - see phase 14; non-secret columns are copied to a report view `migration.v_google_settings_meta` (no key column). `smtp_settings` (`id`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `created_at`): **X** - same.

### 4.3 Value maps and rules

| Topic | Old | New |
|---|---|---|
| Selection status | `screening`, `interview`, `holding`, `rejected`, `approved`, `displayed` | `screening`, `interview`, `holding`, `rejected`, `accepted`, `accepted`; `displayed` also writes `overlay.legacy_status = 'displayed'` (08 01-16). Counts: 174 / 8 / 11 / 143 / 47 / 1 [Dry-run proven] |
| Response status | `form_responses.status`, `company_submissions` has none | `submitted` for all (stage decisions live in the selection item) |
| Booking status | `confirmed` 28, `pending` 2 | `confirmed` 30; the 2 `pending` (test event, past start) keep `legacy_status` in the report; a `calendar_create` job is created **only** for confirmed bookings with start in the future and no calendar id (0 today) |
| Booking `is_available` | true/false | `is_blocked`; slot availability is derived |
| Question types | `text, textarea, select, file, number, multiselect, email, url, tel, hidden` | identical (all in the CHECK) |
| Resource type | `readable` 14, `visual` 3, `link` 9 | identical |
| Roles | one `super_admin` per user | `(user_id, 'super_admin')` x 12; no `founder` row is created (no founder accounts exist) |
| Event visibility | all public by id today | nodes that back a public URL today (view host, agenda, experts, companies, library, landing, active forms, booking hosts, distribution matrix/live) get `visibility='public'`; everything else (selection, team list, Legacy-import form, certificates) `private`; `projects.visibility='public'` (OD-8) |
| E-mail templates | 4 groups x 16 events | node-type defaults (code) + **4 overrides**: interview `bdf9`; rejection `bdf9`; acceptance `bdf9`, `c82e`. 14 events have acceptance NULL (= default) |
| Language placement | `x` / `x_ar` | exact column mapping (M6); optional tidy later |

### 4.4 Derived nodes and edges per event [Dry-run proven]
Rules (a node exists only when the event actually uses it; "the agenda tab always exists today" is honoured by creating the Agenda node whenever there is any agenda data):

| Node | Created when (data test) | Count |
|---|---|--:|
| `view_host` (system) | always | 16 |
| `agenda` | days exist **or** any header image / background / footer / `header_settings` / `gsheets_url` | 14 |
| `list` subkind `expert` ("Experts") | `experts` rows or `mentors` rows exist | 12 (the 2 mentor-only lists hold only hidden provider items) |
| `list` subkind `company` | `companies` rows exist | 6 |
| `list` subkind `expert` ("Athar team") | non-orphan `ather_team_members` exist | 2 |
| `form_builder` | one per `event_forms` row (id preserved) + one **Legacy import** per event that has submissions without `form_id` | 7 + 5 = 12 |
| `selection` | submissions exist **or** a form has `target_module = 'selection_process'` | 8 |
| `booking` mode `mentor` / `interview` | `mentors` / non-orphan `ather_team_members` exist | 4 / 2 |
| `distribution` | `mentoring_distribution_config` row exists | 2 |
| `library` | `library_resources` exist | 3 |
| `landing_page` | `join_athar_pages.project_id` = the event | 1 |
| `certificates` | none (0 certificates, no template) | 0 |
| **Total nodes** | | **82** (all ids distinct) |

Edges reproduce **today's implicit connections** (`getAgendaTabs` computes tabs from data existence, `api.js:263-296`; `event_forms.integrations` flags are `false` on 7/7 forms so **no flag-derived edge exists**):

| Edge | Rule | Count |
|---|---|--:|
| tab: Agenda / Experts / Companies / Library / Landing to the `view_host` `tabs` port (`family view`, `audience public`) | one per tab-contributing node; the Experts tab only when the event has `experts` rows (today's tab test) | 14 + 10 + 6 + 3 + 1 = 34 |
| Form `responses` to Selection `applications` (`rows:form-response`) | each form with `target_module = 'selection_process'` and each Legacy-import form | 9 |
| Expert list `items` to Distribution `mentors`; Company list `items` to Distribution `companies` | for events with a distribution node (Distribution reads the event's experts and companies today) | 4 |
| Expert list `items` to Booking(mentor) `providers`; Athar-team list `items` to Booking(interview) `providers` | providers come from these lists | 6 |
| **Total edges** | | **53** |

Deliberately **not** created: Selection(`stage:interview`) to Booking(`bookers`) (would newly restrict who can book; today the booking page is open: PM decision), Agenda `schedule` to Distribution (no connection exists today; Distribution keeps its own `day_date`), Distribution `view` to the host (matrix and live are separate public URLs today; they get public links instead). Per-node outcome table (82 nodes) is in 11 (dry-run output).

Public links created (all `visibility`-gated, `legacy_ref` for old URLs): 16 agenda links (`legacy_ref` = event id; current slug = the 16 name-derived slugs), 7 form links (`legacy_ref` = form id), 6 booking-host links (`kind='booking'`, `view_key` = provider id, `legacy_ref` = mentor / team-member id: a clarification of 04's `view_key`, Note 04-6), 4 distribution links (`view` matrix and live for 2 nodes) = **33** [Dry-run proven]; 0 `legacy_ref` duplicates.

### 4.5 Duplicate company candidates (for the owner to confirm; names only) [Dry-run proven]
**Exact duplicates (same name ignoring case and spaces; 16 groups, 32 rows, always one row in each of two events; website and description match in every group except two where only the description differs):** AgriEagle; Boutique Nona (description differs); Cow Care Cam; Eco Fin; GeoCycle; Glowmetra; Green Pyramids; HerHealth; Natural and Healthy (description differs); P-Vita; REDS Technologies; ScalaVerse; Service Agent; Smart Agro-Automation Team (SAAT); Sokkary.net; Ultra Biotech (UB).
**Probable duplicates, same name written in the other language order (4 pairs, found with trigram / Levenshtein similarity on the local copy):** "To7fa (تحفة)" / "تحفة To7fa" (same event); "Otaku (أوتاكو)" / "أوتاكو-Otaku" (same event); "Moni Cake (موني كيك)" / "موني كيك (Moni Cake)" (two events); "Cocorra (كوكورا)" / "كوكورا cocorra" (two events). Similar names that are **not** duplicates: Handix / Radix; Re-Lax / Reblox / Replay.
Rule: the migration **loads all 161 rows unchanged** (one company row per old row, `origin_project_id` set) and writes 20 `review` flags (16 exact + 4 probable). `merge_companies(keep, drop)` runs **only after the owner confirms each pair** (OD-2). Which row is kept: the one referenced by more list items / bookings (ties: the older `created_at`); the repoint covers `list_items`, `participants`, `bookings.booker_company_id`, `company_founders`, `company_snapshots`, `alumni_invitations`. Within one event, two rows with the same name would collide on the unique `(list_node_id, company_id)` index only if merged: the merge keeps one list item and moves the overlay of the dropped item into `overlay.merged_from`.

---

## 5. Ordered phases, SQL approach and verification

Conventions: SQL below is shown against the legacy tables as they will be named after phase 1 (`legacy.<table>`); in the dry runs (section 11) the same statements ran against the unmoved `public.<table>`. `nid(x)` = `uuid_generate_v5(<fixed namespace>, x)`. Check ids `Vnn.k` are rows written to `migration.recon`; "expected" values are the local-copy numbers and are re-derived at runtime from `migration.baseline` and from the legacy tables themselves (never hard-coded in the migration). **Rollback of every phase** = roll back its transaction (nothing is visible before `COMMIT`); after commit, see 8.6.

### Phase 0 - Preparation (before any freeze; additive or owner actions)
| Step | What |
|---|---|
| 0.1 Owner decisions | OD-1..OD-20 (section 12); at minimum OD-1, 2, 4, 5, 7, 8, 9 before the first rehearsal that is meant to be final. |
| 0.2 Owner actions that do not depend on the migration | **Rotate the Google service-account key** (08 section 4 #1) and purge the exposing repo file from history; export `national_id` values once (OD-5); review the 12 accounts (which keep `super_admin`; 08 section 4 #3); decide the Apps Script retirement date (#5). |
| 0.3 Fresh export | Re-export live read-only into stack B and re-measure section 2 (counts may have changed since 2026-10-11). Diff against this document's baseline; update expected numbers; new alumni or founder rows would turn "generic rule" loaders into real ones. |
| 0.4 Migration `m00` (additive, can run on live ahead of time) | `CREATE SCHEMA legacy, migration, app_private`; `CREATE EXTENSION citext, pg_trgm, btree_gist` (+ `pg_jsonschema` if available, OD-9 of 04); the `migration.*` tables of 3.3; `migration.capture_baseline()`; `migration.asset_path()` (pure function). No existing object is touched. |
| 0.5 Backups | `pg_dump -Fc` of all schemas (public, auth, storage metadata) + full download of the `event-assets` bucket + Supabase point-in-time/daily backup noted; SHA-256 of each file recorded in the runbook log. |
| 0.6 Pre-freeze storage copy | Phase 13 steps 1-3 can run now (additive): new objects are uuid-named and immutable, so a second pass at freeze only copies objects created since. |
| 0.7 Rehearsals | Section 3.6 loop until the cut-over gate (8.2) is satisfied. |

### Phase 1 - Freeze, baseline, isolate the legacy schema (`m01`; freeze starts)
1. **Freeze writers.** App banner + maintenance mode (8.3); pause the Apps Script time trigger; disable public form intake (`event_forms.is_active = false` is *not* used, it would alter data: the frontend serves a static "maintenance" page and the three `send-*` functions are undeployed). In SQL, `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated` closes the REST write path immediately (reversible by `GRANT`).
2. `select migration.capture_baseline();` writes one row per legacy table (`count(*)`), per auth/storage table, plus the business totals of 2.2.
3. Move objects (one transaction, instant):
```sql
-- 48 tables
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I set schema legacy', t);
  end loop;
end $$;
-- old functions and the enum
alter type public.app_role set schema legacy;
do $$ declare f oid; begin
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace loop
    execute format('alter function %s set schema legacy', f::regprocedure);
  end loop;
end $$;
-- lock the archive down
revoke all on schema legacy from public, anon, authenticated;
revoke all on all tables in schema legacy from anon, authenticated;
-- Realtime and auth hooks of the old model
alter publication supabase_realtime drop table legacy.company_submissions;
drop trigger if exists on_auth_user_created on auth.users;       -- re-created in phase 2 with the new function
```
Sequences (2) and policies move with their tables; policies stay but are unreachable (no schema usage).
**Verify:** V01.1 `count(*) from information_schema.tables where table_schema='public'` = 0 base tables (before phase 2); V01.2 every `migration.baseline` row equals `count(*)` of the moved table (frozen: nothing changed between capture and move); V01.3 `has_schema_privilege('anon','legacy','USAGE') = false` and the same for `authenticated`; V01.4 `auth.users` count = 12 and the aggregate hash of `encrypted_password` is unchanged (`md5(string_agg(encrypted_password, ',' order by id))`, never printed).

### Phase 2 - Create the target schema (`m02`-`m07`; DDL from 04 and 03)
Extensions, `public.*` tables of 04 section 3, constraints/indexes, `app_private` helpers, triggers (`touch_updated_at`, `bump_node_revs`, `BEFORE DELETE` tombstone), RPCs of 04 section 5, RLS policies and grants of 03 section 8 (the `anon` revoke), storage buckets and policies (04 section 6.9), publication `ALTER PUBLICATION supabase_realtime ADD TABLE public.node_revisions`, the new `handle_new_user` trigger on `auth.users` (creates `profiles`; grants `founder` only per 03 section 4.4). `node_types` and `field_semantics` are **seeded by the migration** from the frontend manifests (`06` section 4: CI step). The new RLS must not be what blocks the loaders: loaders run as `postgres`/service role (bypass RLS). **Verify:** V02.1 CI query of 04 section 6.2 (every FK column indexed, no duplicate index); V02.2 every public table has RLS enabled; V02.3 `node_types` has the 10 keys; V02.4 `select count(*) from public.<each target table>` = 0 (clean slate before loading).

### Phase 3 - Reference and identity data (`m10`)
```sql
insert into public.roles (key, name_en, name_ar, description, is_staff)
select r.key, r.name_en, r.name_ar, r.description, r.key in ('super_admin','project_manager','alumni_manager')
from legacy.roles r
on conflict (key) do update set name_en = excluded.name_en, name_ar = excluded.name_ar;
insert into public.roles (key, name_en, name_ar, is_staff) values ('integration','Integration','تكامل', false) on conflict do nothing;

insert into public.profiles (id, full_name, avatar_path, language, created_at, updated_at)
select p.id, p.full_name, null, 'ar', p.updated_at, p.updated_at from legacy.profiles p
on conflict (id) do update set full_name = excluded.full_name;

insert into public.user_roles (user_id, role_key, granted_by, created_at)
select ur.user_id, ur.role::text, null, least(ur.assigned_at, ur.created_at) from legacy.user_roles ur
on conflict (user_id, role_key) do nothing;
```
**Founder-role rules** (03 section 4): no existing user is given `founder` (`founders` is empty; the 12 users are staff). The migration **does not create founder accounts** and does not link `founders` to users (08 03-8). The 12 `super_admin` rows are preserved so the owner cannot be locked out; demotions are a *post-cut-over super-admin action* after the review of 08 section 4 #3 (the new trigger "cannot remove the last super_admin" protects the last one). Existing users keep their `auth.users.raw_app_meta_data` (one carries `role`/`roles`: inert; roles are read only from `user_roles`). `profiles` rows are never re-created by the new `handle_new_user` for existing users (it is an `AFTER INSERT` trigger).
**Verify:** V03.1 roles = 4 + `integration`; V03.2 `user_roles` = 12 = legacy; every `auth.users` id has a profile and at least one role; V03.3 the multi-role PK works: a rollback-only test inserts `(user, 'project_manager')` next to `super_admin`; V03.4 at least one `super_admin` remains.

### Phase 4 - Programs, projects, members (`m11`)
```sql
insert into public.programs (id, name_en, name_ar, description_en, program_type, year, visibility, created_at, updated_at)
select program_id, name, nullif(btrim(name_ar),''), nullif(btrim(description),''), program_type, year, 'private', created_at, updated_at
from legacy.programs
union all select migration.nid('program:legacy'), 'Legacy projects', null, 'Projects migrated without a program', null, null, 'private', now(), now()
where exists (select 1 from legacy.events where program_id is null)
on conflict (id) do update set name_en = excluded.name_en;

insert into public.projects (id, program_id, name_en, name_ar, cover_path, timezone, visibility, created_at, updated_at)
select e.event_id, coalesce(e.program_id, migration.nid('program:legacy')), e.event_name, nullif(btrim(e.event_name_ar),''),
       migration.asset_path('project-cover', e.event_id, e.header_image_url), 'Africa/Cairo', 'public', e.created_at, e.created_at
from legacy.events e
on conflict (id) do update set name_en = excluded.name_en, program_id = excluded.program_id;
```
`projects.description_*`, `location_*`, `map_url`, `offline_days`, `transportation` start NULL and `show_description`/`show_details` false (nothing appears by default, [Decided]). The Legacy program is the only invented row.
**Membership:** `project_managers` is empty, so `program_members` / `project_members` start **empty**; the 12 super admins see everything (03 section 3.2). If `project_managers` has rows at freeze: one `project_members` row per row (`owner` to `owner`, `collaborator` to `manager`), and a `program_members` row only if the owner asks (a program member would gain access to all projects of the program: not implied by old data).
**Verify:** V04.1 programs = legacy + 1 (4); V04.2 projects = 16 = `events`; V04.3 every project has a program; V04.4 3 projects in the Legacy program; V04.5 project names equal `events.event_name` (checksum); V04.6 projects with a cover path = 8 (`header_image_url` non-empty).

### Phase 5 - Entities: network experts and companies (`m12`)
`network_experts` (42 experts + 2 team) and `companies` (161). The expert query is [Dry-run proven] (`t_ne`):
```sql
insert into public.network_experts (id, kind, name_en, name_ar, title_en, title_ar, company_en, company_ar, bio_en, bio_ar,
                                    photo_path, linkedin_url, email, created_at, updated_at)
select m.id, 'expert', m.name, coalesce(nullif(btrim(m.name_ar),''), x.name_ar), m.title, coalesce(nullif(btrim(m.title_ar),''), x.title_ar),
       m.company, coalesce(nullif(btrim(m.company_ar),''), x.company_ar), m.bio, coalesce(nullif(btrim(m.bio_ar),''), x.bio_ar),
       migration.asset_path('expert-photo', m.id, m.photo_url), m.linkedin_url, null, m.created_at, m.updated_at
from legacy.master_experts m
left join lateral (select max(nullif(btrim(e.name_ar),'')) name_ar, max(nullif(btrim(e.title_ar),'')) title_ar,
                          max(nullif(btrim(e.company_ar),'')) company_ar, max(nullif(btrim(e.bio_ar),'')) bio_ar
                   from legacy.experts e where e.master_id = m.id) x on true
on conflict (id) do update set name_en = excluded.name_en, name_ar = excluded.name_ar;
-- Athar team (events that still exist); the orphan member of the deleted event is not loaded
insert into public.network_experts (id, kind, name_en, bio_en, photo_path, email, created_at, updated_at)
select t.id, 'team', t.name, nullif(btrim(t.bio),''), migration.asset_path('expert-photo', t.id, t.photo_url), t.email, t.created_at, t.updated_at
from legacy.ather_team_members t where t.event_id in (select event_id::text from legacy.events)
on conflict (id) do update set name_en = excluded.name_en;
```
Companies: the `t_companies` select of 3.5 (`links` rewritten with `jsonb_agg(jsonb_build_object('type', l->>'icon', 'url', l->>'url', 'label', l->>'label'))`). Duplicate detection: `insert into migration.flags select 'company_duplicate','review','company', company_id, 'same normalized name as <other id>' from ...` (16 groups by `lower(btrim(name))`; the 4 probable pairs by `similarity() > 0.6` / `levenshtein()`, evaluated inside a rolled-back `CREATE EXTENSION fuzzystrmatch` or with the installed `pg_trgm`).
**Verify:** V05.1 `network_experts` kind expert = 42, kind team = 2 (= 3 minus 1 quarantined); V05.2 no Arabic value of a per-event copy is lost (`count(*)` of per-event non-empty `*_ar` where the master's resulting `*_ar` is NULL = 0) [Dry-run proven: 0]; V05.3 `companies` = 161 and checksum `md5(string_agg(id||name||description||industry||governorate order by id))` old = new [Dry-run proven: `93ab1196...` both]; V05.4 link objects 80 = 80; V05.5 founder/role/display_config counts (47 / 47 / 161) are verified in phase 8 where they land; V05.6 flags: 20 `company_duplicate`.

### Phase 6 - The graph: nodes, revisions, edges, public links (`m13`)
Nodes are created **before** their children (all child tables have composite FKs `(project_id, node_id)`). The node plan is one SQL statement per node type of 4.4 [Dry-run proven, 82 nodes]:
```sql
insert into public.nodes (id, project_id, type, type_version, name_en, visibility, is_system, created_at, updated_at)
select migration.nid(e.event_id||':view_host'), e.event_id, 'view_host', 1, 'Project page', 'public', true, e.created_at, e.created_at from legacy.events e
union all select migration.nid(e.event_id||':agenda'), e.event_id, 'agenda', 1, 'Agenda', 'public', false, e.created_at, e.created_at
  from legacy.events e where exists (select 1 from legacy.event_days d where d.event_id = e.event_id) or <header visuals or header_settings or gsheets_url>
union all ... -- list (expert/company/team), form (event_forms: id = form_id; Legacy import), selection, booking (mentor/interview), distribution, library, landing (id = join page id)
on conflict (id) do update set name_en = excluded.name_en;
insert into public.node_revisions (node_id, project_id) select id, project_id from public.nodes on conflict do nothing;   -- rev = 1
insert into public.lists (node_id, project_id, subkind) ...;  insert into public.forms ...;  insert into public.booking_settings ...;  insert into public.distributions ...;  -- extension rows
```
Edges: the four statements of 4.4 (tabs, selection inputs, distribution inputs, booking providers) with `family`, `audience`, `order_index` (tab order = Agenda, Experts, Companies, Library, Landing as in `getAgendaTabs`), `label_en/ar` from `header_settings.customExpertsLabel(Ar)`. `public_links` + `public_link_slugs`:
```sql
insert into public.public_links (id, project_id, node_id, kind, legacy_ref, og_title_en, og_description_en, og_image_path)
select migration.nid(e.event_id||':link:agenda'), e.event_id, migration.nid(e.event_id||':view_host'), 'agenda', e.event_id,
       nullif(e.seo_title,''), nullif(e.seo_description,''), migration.asset_path('og', e.event_id, e.seo_image_url) from legacy.events e
union all <forms: legacy_ref = form_id, og from share_*> union all <booking hosts: kind 'booking', view_key = provider id, legacy_ref = provider id>
union all <distribution: view_key 'matrix' and 'live'>;
insert into public.public_link_slugs (slug, link_id, is_current)
select trim(both '-' from regexp_replace(lower(btrim(e.event_name)),'[^a-z0-9]+','-','g')), migration.nid(e.event_id||':link:agenda'), true from legacy.events e;   -- 16 unique, all match the slug CHECK; the other 17 links get a code from sha256(legacy_ref)
```
**Verify:** V06.1 nodes = 82 and per-type counts of 4.4; V06.2 every node has a revision row; V06.3 edges = 53; no edge violates a composite FK (project mismatch = 0); V06.4 the DAG check function returns no cycle; V06.5 `public_links` = 33, `legacy_ref` distinct; V06.6 slugs = 33 (16 name-derived on the agenda links, 17 deterministic codes for forms, hosts and views), unique, each link has exactly one current slug; V06.7 per event: the node-key list equals the list in section 11 (dry-run output) - the recon stores the sorted `string_agg(type)` per project.

### Phase 7 - Forms (`m14`)
- **Covers and template:** `form_covers` (3, project-scoped) + 2 covers created from `events.form_cover_image_url`; `form_templates` from `library_forms` (`definition` = `{schema_version:1, questions: fields, settings:{thank-you, share, social}}`).
- **Native forms:** `forms` rows (`is_active`, `cover_id`, `template_id`), `form_sections` from `event_forms.integrations->'form_sections'` (6; old section ids are preserved in `migration.id_map` and used to resolve `validation_rules.section_id`), `form_questions` from `form_field_configs` (56) [Dry-run proven].
- **Legacy-import forms (5 events):** questions generated from the answer headers: `with headers as (select s.event_id, k as header, count(*) n from legacy.company_submissions s, jsonb_object_keys(s.additional_data) k where s.form_id is null and k <> '_column_order' and not (k ilike '%national id%' or k like '%القومي%') group by 1,2)` then `row_number() over (partition by event_id order by n desc, header)` gives `q001...`; the **header text becomes the question label** (`label_en` = the full multi-line bilingual header, so the selection detail modal shows labels, not keys); the PII headers are excluded; typed semantic questions `company_name`, `founder_name`, `founder_email`, `phone`, `location` (+`industry`, `logo`) are added only where used (148 questions in total) with `semantic` set so `answers->>'founder_email'` works for the e-mails; `type` is `text`/`textarea` by value length (>= 200 chars to `textarea`), `options` empty. Question order follows `_column_order` of the first row of each event.
- **Responses:** [Dry-run proven] `t_responses` + `t_answers`:
```sql
insert into public.form_responses (id, project_id, node_id, answers, external_key, status, submitted_at, created_at, updated_at)
select s.submission_id, s.event_id, coalesce(s.form_id, migration.nid(s.event_id||':form_legacy')),
       migration.rekey_answers(s),            -- header -> qNNN, strip national-id keys, add typed semantic keys, native-form core keys for the 2 attached rows
       'legacy:'||s.submission_id, 'submitted', s.submitted_at, s.created_at, s.updated_at
from legacy.company_submissions s
on conflict (id) do update set answers = excluded.answers;
```
(The 2 rows attached to the native company form map the typed columns to that form's core keys `startup_name`, `industry`, `location`, `logo_url`.) `legacy.form_responses` / `expert_submissions` rows (0) use the same function.
**Verify:** V07.1 forms 12 (7 + 5), sections 6, questions 56 + 148 = 204; V07.2 `form_responses` = 384 = `company_submissions` + `expert_submissions` + `form_responses`; V07.3 per form node counts (153 / 147 / 65 / 16 / 1 on Legacy-import nodes, 2 on the IR company form); V07.4 **lossless cells**: sum of non-PII, non-meta header keys of legacy answers = number of `qNNN` keys of new answers = 13,428 [Dry-run proven]; V07.5 **PII**: `select count(*) from public.form_responses where answers::text ~* 'national|القومي'` = 0 and no key in `form_questions.label_en` matches the PII pattern; V07.6 every answer key exists in `form_questions` of its node; V07.7 `max(octet_length(answers::text)) <= 65536` (dry run: 54,476); V07.8 no orphan question section reference.

### Phase 8 - Lists, selection items, participants (`m15`)
```sql
-- expert list items: id = old expert_id; provider-only mentors get hidden items (excluded = true)       [Dry-run proven: 67]
insert into public.list_items (id, project_id, list_node_id, source_kind, network_expert_id, excluded, sort_order, overlay, created_at)
select e.expert_id, e.event_id, migration.nid(e.event_id||':list_experts'), 'network_expert', e.master_id, false, e.sort_order,
       coalesce(jsonb_build_object('role', nullif(btrim(e.role),'')) - (case when nullif(btrim(e.role),'') is null then 'role' end), '{}'), now()
from legacy.experts e
union all select migration.nid('provider-item:'||m.id), m.event_id::uuid, migration.nid(m.event_id||':list_experts'), 'network_expert', m.master_id::uuid, true, null, '{}', now()
from legacy.mentors m where not exists (select 1 from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id)
union all <Athar team items: id nid('team-item:'||t.id), network_expert_id = t.id>;
-- company list items: id = old company_id; founder text, role, card config, sort order                [Dry-run proven: 161]
insert into public.list_items (id, project_id, list_node_id, source_kind, company_id, sort_order, overlay)
select c.company_id, c.event_id, migration.nid(c.event_id||':list_companies'), 'company', c.company_id, c.sort_order,
       jsonb_strip_nulls(jsonb_build_object('founder_name', nullif(btrim(c.founder),''), 'founder_name_ar', nullif(btrim(c.founder_ar),''),
         'founder_role', nullif(btrim(c.role),''), 'card', jsonb_build_object('show', coalesce(c.display_config,'{}'))))
from legacy.companies c;
-- selection items: id = old submission_id                                                              [Dry-run proven: 384]
insert into public.list_items (id, project_id, list_node_id, source_kind, form_response_id, status, overlay, created_at)
select s.submission_id, s.event_id, migration.nid(s.event_id||':selection'), 'form_response', s.submission_id,
       case s.status when 'approved' then 'accepted' when 'displayed' then 'accepted' else s.status end,
       jsonb_strip_nulls(jsonb_build_object('tech_status', nullif(s.additional_data->>'tech_status',''),
         'legacy_status', case when s.status = 'displayed' then 'displayed' end,
         'previous_reasons', <the other *_reason keys that differ from the current status>)), s.created_at
from legacy.company_submissions s;
insert into public.selection_reviews (item_id, project_id, reason, reviewed_at)      -- 201 rows: a reason or a review date
select s.submission_id, s.event_id, nullif(s.additional_data->>(s.status||'_reason'),''), s.reviewed_at from legacy.company_submissions s
where nullif(s.additional_data->>(s.status||'_reason'),'') is not null or s.reviewed_at is not null;
```
**Participants:** none are materialised. 48 selection items are in the terminal stage `accepted`; they are **virtual participants** (04 3.8: rows are created lazily when the PM acts or clicks "Enrol all accepted") [Decided-by-delegation 02-7]. The 0 rows of `program_participations` are loaded by the generic rule (a loader exists). **Provider-only mentors** (2) are `excluded = true` list items so the Experts tab shows exactly what it shows today.
**Verify:** V08.1 `list_items` = 614 (experts 67 incl. 2 hidden, team 2, companies 161, selection 384) [Dry-run proven]; V08.2 the three unique-by-source indexes hold (0 duplicates); V08.3 selection status histogram old(mapped) = new: `screening 174, interview 8, holding 11, rejected 143, accepted 48` and checksum `md5(id||status)` equal [Dry-run proven `56747f81...`]; V08.4 `founder_name` in overlay = 47 = non-empty `companies.founder`; `founder_role` 47; `card.show` 161; V08.5 `selection_reviews` 201; V08.6 reasons: 43 current-status reasons + 115 stale reasons present in overlay (sum of non-empty `*_reason` = 158 = 43 + 115) [Dry-run proven]; V08.7 `tech_status` 35; V08.8 `overlay.legacy_status = 'displayed'` on exactly 1 item.

### Phase 9 - Agenda, library, landing, analytics (`m16`)
```sql
insert into public.agenda_days (id, project_id, node_id, sort_order, day_date, name_en, name_ar)
select d.day_id, d.event_id, migration.nid(d.event_id||':agenda'), d.day_number, d.day_date, d.day_name, nullif(btrim(d.day_name_ar),'') from legacy.event_days d;
insert into public.agenda_slots (id, project_id, day_id, sort_order, start_time, end_time, title_en, title_ar, presenter_en, presenter_ar, show_presenter, bullets)
select s.slot_id, d.event_id, s.day_id, s.sort_order, s.start_time::time,
       coalesce((select (f.new_value)::time from migration.fixups f where f.entity='agenda_slots' and f.ref_id=s.slot_id::text and f.column_name='end_time'), s.end_time::time),
       s.slot_title, nullif(btrim(s.slot_title_ar),''), nullif(btrim(s.presenter_name),''), nullif(btrim(s.presenter_name_ar),''), coalesce(s.show_presenter,true),
       coalesce((select jsonb_agg(jsonb_build_object('en', coalesce(s.bullet_points->>(i-1),''), 'ar', coalesce(s.bullet_points_ar->>(i-1),'')) order by i)
                 from generate_series(1, greatest(coalesce(jsonb_array_length(s.bullet_points),0), coalesce(jsonb_array_length(s.bullet_points_ar),0))) i), '[]')
from legacy.agenda_slots s join legacy.event_days d on d.day_id = s.day_id;
```
The `CHECK (end_time > start_time)` rejects the one bad slot until the owner provides the corrected end time in `migration.fixups` (OD-7); with no answer the **fallback** is `start + 60 minutes`, flagged `blocker` for the owner to confirm before the freeze ends. `resources`: [Dry-run proven] bucket URLs become `file_path` (bucket `resources`) with `mime`/`bytes` from `storage.objects`; external URLs stay in `url`. `landing_cards` (4) with `cta_url = '#'` kept; node config of the landing page: `hero.coverPath`, `title`, `layoutColumns`; `node_events` from `join_athar_analytics` (26, `card_id` NULL as today) and `form_share_events` (0). `landing_share_presets`: per old page preset, one row per card per platform (0 now).
**Verify:** V09.1 `agenda_days` 37, `agenda_slots` 248, and **per-event slot counts** equal section 2.2 (26/24/16/33/18/19/11/31/12/22/35/1) and the checksum `md5(id||start||end||title||title_ar||presenter||sort_order)` old = new [Dry-run proven `0e10e7cb...`; computed over rows with a valid range, the fixup row is compared after the fix]; V09.2 bullet items 28 = 28; V09.3 `resources` 26 by event (7/17/2); V09.4 `landing_cards` 4, `node_events` 26; V09.5 every `*_path` column that is non-NULL resolves in the asset map.

### Phase 10 - Booking (`m17`)
[Dry-run proven] statements (`t_providers`, `t_slots`, `t_bookings`):
```sql
insert into public.booking_providers (id, project_id, node_id, list_item_id, advance_notice_min, booking_email, sort_order)
select m.id, m.event_id::uuid, migration.nid(m.event_id||':booking_mentor'),
       coalesce((select e.expert_id from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id),
                migration.nid('provider-item:'||m.id)), nullif(m.advance_notice_minutes,1440), m.email, null
from legacy.mentors m where m.event_id in (select event_id::text from legacy.events)
union all select t.id, t.event_id::uuid, migration.nid(t.event_id||':booking_interview'), migration.nid('team-item:'||t.id), nullif(t.advance_notice_minutes,1440), null, null
from legacy.ather_team_members t where t.event_id in (select event_id::text from legacy.events);
-- slots: orphan providers and the zero-length slot are not loaded (flagged); is_blocked = unavailable AND not booked
insert into public.booking_slots (id, project_id, node_id, provider_id, starts_at, ends_at, is_blocked) select ... from legacy.mentor_slots ... union all ... legacy.ather_team_slots ...;
-- bookings: status map, company match for interview mode, meet link inherited from the slot, Google id preserved
insert into public.bookings (id, project_id, node_id, slot_id, status, booker_email, booker_company_id, booker_company_name,
                             meet_link, legacy_calendar_event_id, created_at, updated_at)
select b.id, sl.project_id, sl.node_id, b.slot_id, case when b.status = 'cancelled' then 'cancelled' else 'confirmed' end, b.booker_email,
       (select c.company_id from legacy.companies c where c.event_id = sl.project_id and lower(btrim(c.name)) = lower(btrim(b.company_name)) order by c.company_id limit 1),
       b.company_name, coalesce(b.meet_link, sl.legacy_slot_meet_link), b.calendar_event_id, b.created_at, b.updated_at
from legacy.ather_team_bookings b join <slots plan> sl on sl.id = b.slot_id
union all <same for legacy.bookings (mentor mode)>;
```
`booking_settings`: `mode`, `meeting_link_mode`, `shared_meet_link` from `events` (1 shared event), `default_advance_notice_min = 1440`; slot-generation defaults none. `booking_invitations`: none (interview links were open; OD for the PM). **Verify:** V10.1 providers 6 (4 + 2); V10.2 slots 55 (9 mentor + 46 interview) + 9 quarantined (8 orphan + 1 zero-length); V10.3 bookings 30 (2 + 28) + 1 quarantined; V10.4 **per-event** bookings: `bdf9` 22, `c82e` 6, `f522` 2 [from 2.2]; V10.5 **every migrated booking keeps its Meet link** (30 of 30; 2 inherited from the slot) and 28 keep the Google calendar id; V10.6 no slot has two confirmed bookings (unique index); V10.7 no overlapping slots per provider (the GiST exclusion accepts all rows); V10.8 booking checksum `md5(id||slot_id||lower(booker_email)||meet_link)` old = new [Dry-run proven `41a34f7b...`]; V10.9 derived start/end of migrated bookings equal the old `start_time`/`end_time` (0 differences) [Dry-run proven]; V10.10 17 of 28 interview bookings are linked to a company, 11 keep free text (flag `info`).

### Phase 11 - Distribution (`m18`)
Day timing is **reconstructed from the stored sessions** (F5) and merged with the day config; mentor-per-day lists come from the day config or, when absent, from the sessions [Dry-run proven]:
```sql
with sess as (select event_id, day_index, slot_index, slot_start_time s, slot_end_time e from legacy.mentoring_sessions where event_id in (select event_id::text from legacy.events)),
base as (select event_id, day_index,
         min(s) filter (where slot_index = 0) st0,
         ((extract(epoch from (min(e) filter (where slot_index = 0) - min(s) filter (where slot_index = 0)))::int + 86400) % 86400) / 60 dur_min,   -- handles the 23:34 -> 00:04 day
         coalesce(min(s) filter (where slot_index = 1) - min(e) filter (where slot_index = 0), interval '0') gap
         from sess group by 1,2),
days as (select event_id, g from legacy.mentoring_distribution_config c, generate_series(0, c.num_days-1) g
         union select event_id::text, day_index from legacy.mentoring_distribution_day_config union select event_id, day_index from sess)
insert into public.distribution_days (id, project_id, node_id, day_index, day_date, start_time, total_round_min, slot_duration_min, gap_min)
select migration.nid(d.event_id||':dist-day:'||d.g), d.event_id::uuid, migration.nid(d.event_id||':distribution'), d.g, dc.day_date,
       coalesce(b.st0, dc.session_start_time, c.start_time), coalesce(dc.total_round_minutes, c.total_round_minutes),
       coalesce(b.dur_min, dc.slot_duration_minutes, c.slot_duration_minutes), coalesce(extract(epoch from b.gap)/60, dc.break_between_slots_minutes, 0)
from days d join legacy.mentoring_distribution_config c on c.event_id = d.event_id
left join legacy.mentoring_distribution_day_config dc on dc.event_id::text = d.event_id and dc.day_index = d.g
left join base b on b.event_id = d.event_id and b.day_index = d.g;
```
Then `distributions` (2), `distribution_day_mentors` (config `mentor_ids` else the day's session mentors: 139 rows), `distribution_mentor_rules` (3), and `distribution_sessions` (716) with `mentor_item_id = old mentor_id` (= the preserved expert list item id) and `company_item_id = old company_id`; sessions with an empty `event_id` are **not loaded** and get one `review` flag each group (event derivable: 850a). `finalized_days` become `is_locked` (none).
**Verify:** V11.1 `distributions` 2, `distribution_days` 9 (7 + 2), `distribution_sessions` 716 = 476 + 240 (per event), 138 without company; V11.2 sessions checksum `md5(id||slot_index||mentor||company)` old = new [Dry-run proven `1e98f5e1...`]; V11.3 **the view reproduces stored times**: `v_distribution_sessions.starts_at/ends_at` equals the old `slot_start_time`/`slot_end_time` for 716 of 716 [Dry-run proven: 0 mismatches vs 240 with naive derivation]; V11.4 all `mentor_item_id` / `company_item_id` exist in the same project (716 / 578); V11.5 unique keys hold; V11.6 quarantined = 432 and `legacy` view `v_quarantine_mentoring_sessions` has 432 rows.

### Phase 12 - Node configs, e-mail overrides, labels, visibility (`m19`)
One statement per node type writes `nodes.config` **only for keys that differ from the node-type default** (so an unmodified project carries `{}`):
| Node | Keys written | Source |
|---|---|---|
| agenda | `header`, `showDayNames` (when false), `legacySheetUrl`, `backgroundPath`, `footerPath` | `events.header_settings`, `show_day_names`, `gsheets_url`, `background_image_url`, `footer_image_url` |
| list (expert) | `hideTitle` | `header_settings.hideExpertListTitle` |
| selection | `sheetImport`, `emailTemplates.interview/rejection/acceptance` (4 overrides) with `admin`/`cc` | `events.*` |
| booking | `emails.*.admin/cc` (1 event) | `mentor_admin_emails`, `mentor_cc_emails` |
| form | `thankYou`, `social`, `description` | `event_forms.*` |
| landing | `hero`, `title`, `layoutColumns` | `join_athar_pages` |
Tab edge labels: `customExpertsLabel(Ar)` to `edges.label_en/ar` (1). `show_to_participants` stays `false` everywhere ([Decided]: nothing by default). Each node's `type_version` = `node_types.latest_version`. After all loaders: `update public.node_revisions set rev = rev + 1` once per node (so any client cache built before the cut-over is invalidated).
**Verify:** V12.1 nodes whose config is `{}` are exactly the nodes with no differing key (count recorded); V12.2 the 4 template overrides are present on the right events (`bdf9`: interview, rejection, acceptance; `c82e`: acceptance); V12.3 `node_types.config_schema` validation (or `save_node` dry validation) passes for every config; V12.4 config size cap OK.

### Phase 13 - Storage (script `scripts/migrate-storage` + `m20` path updates)
Non-transactional, therefore **idempotent per object and verified afterwards**. Scope: the **46 referenced objects** (30 MB: 23 JPEG, 18 PNG, 5 PDF; 5 objects over 1 MB, 19 MB) [Dry-run proven].
1. `migration.asset_map` is filled in SQL by `migration.asset_path(kind, row_id, old_url)`: `bucket` and a **deterministic** `new_path` = `<project_id or 'global'>/<kind>/<uuid_v5(old_path)>.webp` for images and `.../<uuid_v5>.pdf` for PDFs; the DB columns (`*_path`) are written by the loaders with these paths, so loaders do not wait for the files.
2. The script reads each `old_path` with the service role (the public URL also works), then: **images**: decode, resize to max 1600 px (`full`) and 320 px (`_t`), encode WebP, upload `<uuid>.webp` and `<uuid>_t.webp` with `cache-control: max-age=31536000, immutable`; **PDFs** and other files: copy unchanged (bucket `resources`). Objects shared by several rows (20) are uploaded once.
3. Buckets of 04 6.9: `public-assets` (covers, logos, photos, landing, og), `resources` (library files; private, signed), `form-uploads`, `founder-assets`, `certificate-templates` (empty). Kind to bucket: expert-photo, company-logo, project-cover, form-cover, landing, og, answer-logo to `public-assets`; resource to `resources`.
4. **Not migrated, kept in `event-assets`:** the 59 unreferenced objects (40 MB; includes `experts/` 31 files / 32 MB, `visuals/` 18 / 8 MB) and the 18 metadata-only rows (no file exists; **none is referenced**). The bucket is made read-only (policies: SELECT only) so old URLs keep working until the owner decides (OD-6, 8.7).
5. **External images** (98 rows; Drive 97, googleusercontent 1): the script tries a one-time fetch of each Drive link (`file/d/<id>` and `open?id=<id>` forms) and, when it returns an image, treats it like a bucket object; failures stay as `migration.flags` `review` ("photo not reachable") and the column is NULL (OD-10). Application of the fetch result updates `photo_path` / `logo_path` in a second pass (idempotent).
6. **Re-pathing of the 87 references:** `update` of each `*_path` column from `asset_map` where `status = 'copied'`; references whose object did not copy stay NULL with a flag.
**Verify:** V13.1 `asset_map` rows = 46 distinct objects + external attempts; V13.2 every non-NULL `*_path` in the new schema exists in `storage.objects` (join; 0 missing); V13.3 byte-size of each PDF equals the original (5/5); V13.4 every image has `_t.webp`; V13.5 total new size reported (expected a few MB instead of 30); V13.6 `event-assets` object count unchanged (112; nothing deleted); V13.7 a sample of 10 public URLs returns HTTP 200 with the right content type.

### Phase 14 - Secrets, integrations, functions, auth hooks (`m21` + owner actions)
| Item | Handling |
|---|---|
| `google_settings.service_account_key` (2 rows, plaintext) | **Not read by any loader.** Owner rotates the key (Phase 0). After rotation: `update legacy.google_settings set service_account_key = null` (or drop the table). The non-secret columns (`event_id`, `calendar_id`, `impersonate_email`) go to the view `migration.v_google_settings_meta` for the report. The key is **not** copied to Vault: OAuth tokens are created by the new connection flow (07 section 1.4), never by migration. |
| `smtp_settings` (1 row; `smtp_pass`) | Until the new `send-email` worker ships, the three `send-*` functions are replaced at cut-over by ports that read the password from **Edge Function secrets** (`supabase secrets set SMTP_HOST SMTP_USER SMTP_PASS`, an owner action using the value held outside the repo) instead of a table. After the worker is live: set `legacy.smtp_settings.smtp_pass = null`, then unset the secrets. A Vault secret is an option if a function must read it from SQL (`select vault.create_secret(...)` performed by the owner in the SQL editor; the password never appears in a migration file). |
| `google_connections` | Cannot be created by migration: each row needs the PM's (or `startups@athareg.com`'s) OAuth consent. After cut-over each PM clicks "Connect Google"; then `update public.bookings set calendar_owner_connection_id = <system connection> where legacy_calendar_event_id is not null` (28 bookings created by the `startups@` poller). |
| Edge functions | 8 deployed functions read old tables (8.5): redeployed or retired at cut-over. |
| Auth | `auth.users`, identities, hashes and sessions untouched. Email confirmation and CAPTCHA settings (03 section 4.4 rules 5) are dashboard settings, outside SQL: checklist item. |
| Realtime | `supabase_realtime` now publishes `public.node_revisions` only. |
**Verify:** V14.1 `select count(*) from legacy.google_settings where service_account_key is not null` = 0 once rotated (a **gate for deleting legacy**, not for cut-over); V14.2 no table in `public` or `app_private` contains a column named like `*key*`, `*pass*`, `*secret*`, `*token*` with plaintext (query over `information_schema.columns` plus a scan for the old key's prefix inside `public` text columns: 0 hits); V14.3 the security advisor shows zero "RLS disabled", zero "policy always true", zero anon-executable SECURITY DEFINER (03 section 13).

### Phase 15 - Final verification and the report (`m22`)
Runs every `migration.check_*()` again against the committed state, `ANALYZE`s all tables, writes the report (section 6.3) and **blocks the cut-over** unless: zero `mismatch` rows, zero `blocker` flags, all `review` flags either resolved or explicitly accepted by the owner in `migration.flags.resolved_*`.

### Phase 16 - Cut-over switch
See section 8 (config switch, redirects, Apps Script, edge functions, reopening writes).

### Phase 17 - Sign-off and removal of the archive
After the owner's written sign-off and the cool-off period (default 30 days; 8.7): migration `m90` drops `legacy` (or keeps selected tables: OD-18), nulls the remaining secret columns first, drops `migration.id_map`/`fixups` after export, and archives `migration.recon`/`flags` (as a JSON file in the repo's private archive, not in `public`).

---

## 6. Verification framework and expected target numbers

### 6.1 Check families (every phase uses these; results go to `migration.recon`)
| Family | Query pattern | Failure |
|---|---|---|
| Row-count reconciliation | `expected` computed from `legacy.*` with the same filter the loader uses (for example "events that exist", "slots with a migrated provider"), `actual = count(*)` of the target | `mismatch` raises an exception, the phase rolls back |
| Quarantine accounting | `legacy rows = loaded rows + quarantined rows` for every table that loses rows (sessions 1,148 = 716 + 432; team slots 54 = 46 + 8; mentor slots 10 = 9 + 1; team bookings 29 = 28 + 1; team members 3 = 2 + 1) | `mismatch` |
| Referential | generic orphan scan over `pg_constraint` (all FKs of the target); the same scan over the **old** schema returns 0 orphans on 60 FKs [Dry-run proven], plus the 11 TEXT soft references checked by hand: 0 orphans except the known 1 + 8 + 1 (deleted event) and 432 (empty) | any orphan in the target is a `mismatch` |
| Business checksums | `md5(string_agg(<business columns> order by id))` old side vs new side, ids preserved (agenda slots, companies, selection statuses, sessions, bookings) [Dry-run proven, section 11] | `mismatch` |
| Per-event totals | the table of 2.2 recomputed from the target (agenda slots, responses, bookings, sessions, library, companies, experts per project) | `mismatch` |
| Lossless-content | counted cells (answers), bullet items, links, overlay keys | `mismatch` |
| Negative checks | no PII in `answers`; no secret-like column or value in `public`; no `anon` grant on any table | `mismatch` |
| Flags | quarantine, fixups and review items listed with a severity | `blocker` stops the cut-over; `review` needs an owner decision |

### 6.2 Expected target row counts after a clean run (local copy)
| Target | Rows | Target | Rows | Target | Rows |
|---|--:|---|--:|---|--:|
| `roles` | 5 | `network_experts` | 44 | `booking_settings` | 6 |
| `user_roles` | 12 | `companies` | 161 | `booking_providers` | 6 |
| `profiles` | 12 | `list_items` | 614 | `booking_slots` | 55 |
| `programs` | 4 | `selection_reviews` | 201 | `bookings` | 30 |
| `projects` | 16 | `participants` | 0 | `booking_invitations` | 0 |
| `program_members` / `project_members` | 0 / 0 | `lists` | 20 | `distributions` | 2 |
| `nodes` | 82 | `forms` | 12 | `distribution_days` | 9 |
| `node_revisions` | 82 | `form_sections` | 6 | `distribution_day_mentors` | 139 |
| `edges` | 53 | `form_questions` | 204 | `distribution_mentor_rules` | 3 |
| `public_links` | 33 | `form_responses` | 384 | `distribution_sessions` | 716 |
| `public_link_slugs` | 33 | `form_covers` | 5 | `agenda_days` | 37 |
| `form_templates` | 1 | `resources` | 26 | `agenda_slots` | 248 |
| `landing_cards` | 4 | `node_events` | 26 | `certificates`, `email_*`, `integration_jobs`, `google_connections`, alumni tables | 0 |

### 6.3 Before/after report format
One file per run, `migration-report-<run id>.md` plus `.json`, produced by `migration.report()`:
```text
Run 42  phase=all  source=export 2026-10-11T08:34Z  target=stack_next  result=PASS|FAIL
1. Table reconciliation   | legacy table | legacy rows | loaded | quarantined | target table | target rows | status |
2. Business totals        | check key (e.g. agenda_slots/<event>) | old | new | status |
3. Checksums              | key | old md5 | new md5 | status |
4. Quarantine and fixups  | code | entity | ref id | message | severity | resolved by |
5. Flags for owner        | duplicates (20), mixed-script labels (13), unsplit names (26), external images (98), test events, ... |
6. Negative checks        | PII in answers: 0 | secrets in public: 0 | anon grants: 0 |
7. Timing                 | per phase seconds, rows/s |
```
The owner signs the report of the **final** run (section 8.7).

---

## 7. Data-risk register [As-is quantified on the local copy; handling is a Proposal]

| # | Risk | Quantified | Handling | Residual |
|---|---|---|---|---|
| R1 | 432 `mentoring_sessions` with empty `event_id` | all belong to event 850a (derivable), created 2026-07-25, 280 collide with live rows, 396 mentors resolve, 36 mentors deleted | Quarantine (04-6) as view `legacy.v_quarantine_mentoring_sessions` + flag; evidence in the report | none if owner confirms; recovery possible from `legacy` |
| R2 | Orphans of a **deleted event** (`bdb9e11d-...`): 1 team member, 8 slots, 1 booking | not in 04 | Quarantine; flag `review` (owner may want a stub project) | data kept in `legacy` |
| R3 | TEXT `event_id` columns cast to uuid | 11 columns, 0 slugs, 0 uncastable; 1 empty string table | Loader casts only after `where event_id ~* uuid-regex`; non-matching rows quarantined, never coerced | none |
| R4 | Generated columns | `events.name`, `events.id`; target `companies.name_key`, `bookings.calendar_event_id` | never listed in INSERT; checks compare source columns | none |
| R5 | Duplicate companies | 16 exact groups (32 rows) + 4 probable pairs | no merge at migration; 20 flags; `merge_companies` after owner confirmation | duplicates persist until confirmed |
| R6 | Mixed status vocabularies | selection 6 values (`displayed` 1), booking `pending` 2, response none | value maps 4.3; original kept in overlay or report | none |
| R7 | PII: `national_id` column (65 rows) and national-id answer keys (365 rows) | 5 headers in 3 events | stripped from the new schema, kept only in restricted `legacy`; one-time owner export; negative check V07.5 | PII stays in `legacy` until destroyed |
| R8 | Re-keying answers (header to `qNNN`) | 140 headers; 13,428 cells; max answer 54,476 bytes vs 64 KB cap | lossless-cell check; header text kept as the question label; PII headers excluded; cap check | answer near cap: raise the cap if a live export is larger |
| R9 | Derived session times | naive derivation wrong for 240 of 716 | reconstruct per-day timing from sessions; check 716/716 | later config edits re-time all days of a node (expected) |
| R10 | Rows violating target CHECKs | 1 agenda slot (13:30-04:30), 1 zero-length mentor slot | fixups (owner value) or fallback (+60 min, blocker flag); zero-length slot quarantined | one agenda value is an owner correction |
| R11 | Stale decision reasons | 115 reasons of other statuses | overlay `previous_reasons` | none |
| R12 | Duplicate applicants in one event | 13 | kept as separate responses, flagged | PM review |
| R13 | Meet links and Google ids | 30 bookings keep links; 7 unbooked slot links; 2 pending test bookings | link inheritance, `legacy_calendar_event_id`, slot links stay in `legacy`; poller paused at freeze | double Meet event if the poller runs after cut-over (8.5) |
| R14 | Storage | 18 metadata-only objects (not referenced), 59 unreferenced (40 MB), 98 external images, 443 Drive URLs inside answers | copy only the 46 referenced; keep bucket read-only; fetch-or-flag external images; answer URLs untouched | Drive links depend on Google permissions |
| R15 | Mixed-language text | 26 company names mixed, 13 form labels not cleanly splittable, 60 descriptions mixed | faithful column mapping (M6); optional tidy report | cosmetic |
| R16 | Circulated URLs | hash routes, `/agenda/:id`, name slugs, `/book/:mentorId`, `/forms/...`, `/register/company|expert` | `legacy_ref`, name slugs, redirect table (8.4) | legacy registration portals have no equivalent (redirect to the project page) |
| R17 | Server code bound to old tables | 8 edge functions, Apps Script, Realtime on `company_submissions` | cut-over gates 8.2, 8.5 | functions must be ready |
| R18 | Access lock-out or open data | 12 `super_admin`, RLS strict, anon revoked | seed roles first; loaders bypass RLS; frontend switched in the same window | none |
| R19 | Secrets | Google key (2 rows), SMTP password (1) in plaintext, also in the local DB and in backups | rotate first; never read by loaders; null after sign-off; local export folder stays git-ignored | backups still hold the old key (rotation makes it dead) |
| R20 | Time zones | agenda times are text (no zone); bookings are `timestamptz` | agenda times interpreted in `projects.timezone = 'Africa/Cairo'` (as the live code does); bookings unchanged | owner confirms the zone per project |
| R21 | Export drift | live changed after 2026-10-11 | fresh export before final rehearsal; runtime baseline | numbers in this document change |
| R22 | Trigger side effects | `trg_auto_index_expert` and `trg_broadcast_master_expert` rewrite experts/masters on write | loaders only read legacy; corrections only via `migration.fixups`; the triggers move with the tables | none |
| R23 | Test data | events `test`, `founder`; bookings from companies "test", "test2" | migrated like the rest, flagged `info`; owner may archive (OD-3) | clutter |
| R24 | Lock waits at freeze | `SET SCHEMA` needs exclusive locks | `lock_timeout`, retry, writers stopped first | seconds |
| R25 | Rollback after new writes | new app writes after reopen | rollback only before reopening; afterwards forward-fix (8.6) | defined window |
| R26 | Live alumni/founder data may exist later | 0 locally | generic-rule loaders | needs rehearsal on fresh export |

---

## 8. Cut-over plan [Proposal]

### 8.1 Roles and timeline
Run by one engineer with the owner reachable. Suggested window: low-traffic day, 2-3 hours, announced to PMs a week before.
| T | Step |
|---|---|
| T-7d | Announce; owner decisions closed; fresh export rehearsed (clean). |
| T-1d | Backups (0.5); storage pre-copy; Google key rotated; new functions deployed **disabled**; DNS/hosting ready; new frontend build ready with env (8.3). |
| T-0:00 | Freeze (phase 1): maintenance page, write grants revoked, Apps Script trigger paused, old functions undeployed. |
| T-0:10 | Phase 1 move, phase 2 schema, phases 3-12 loads. |
| T-0:40 | Storage delta + path pass (13); phase 14; phase 15 report. |
| T-1:00 | Go/no-go on the report. Go: deploy frontend, enable new functions. |
| T-1:15 | Smoke tests (section 10.4) as super admin, PM, anon, founder test account. |
| T-1:45 | Reopen: remove maintenance page; `migration.state.cutover_done = true`. Point of no return. |

### 8.2 Gates (all must hold)
Three consecutive clean rehearsals + one on a fresh live export; zero `blocker` flags; owner decisions OD-1, 2, 4, 5, 7, 8, 9 closed; Google key rotated; replacement of the three `send-*` e-mail functions and of `share` available (new `send-email` worker or ports of the old ones reading Edge secrets); calendar path decided (new `calendar-sync` or poller bridge, 8.5); frontend build passes the section 10 scenarios on stack B; owner approval in writing.

### 8.3 Switching the application configuration
The current client hard-codes the project URL and key (`src/lib/supabase.js:3`); design 06 moves them to env. Final values, set at build time: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same live project: unchanged values), `VITE_BASE_PATH` (`/` or `/EventsOperations`, 06-2), a `VITE_APP_VERSION`. Local: stack A for the old build, stack B for the new. Because strategy A keeps the same project, **no key or URL changes on live**; the switch is the deploy of the new bundle plus the SQL.

### 8.4 URL redirects and `legacy_ref`
| Old URL | Mechanism |
|---|---|
| `/#/agenda/:eventId`, `/?agenda=:eventId`, `/agenda/:eventId` | hash shim then `resolve_ref('agenda', :id)` finds `public_links.legacy_ref` (16) |
| name slugs such as `/agenda/climaccelerator` | `public_link_slugs` (16 name-derived slugs) |
| `/view/:eventId/(experts|startups|library|join-athar)` | redirect to `/agenda/<ref>/<tab>` |
| `/view/:eventId/mentoring/(matrix|live)` | node lookup by type in project `:eventId`, then the distribution link (4 links) |
| `/forms/:formId`, `/events/:id/(register/)form/:formId`, `/forms/:eventId/:formId` | `legacy_ref` = form id (7) |
| `/book/:mentorId`, `/ather-team-book/:memberId` | `public_links.view_key` = provider id, `legacy_ref` (6) |
| `/events/:id/register/company|expert` | no equivalent: redirect to the project page (legacy portals are gone) |
| `/verify-certificate/:code` | `/verify/:code` (0 certificates today) |
| old storage URLs | keep working: `event-assets` stays read-only until OD-6 |

### 8.5 Apps Script poller, edge functions, Realtime
Order (07 2.3, 03 10): **(1)** capture the Executions page and the rows with `failed` or no meet link (evidence); **(2)** at freeze, disable the time-driven trigger and unpublish the web app; **(3)** after cut-over either (a) `calendar-sync` is live: it handles bookings created from now on, and the 28 migrated bookings with `legacy_calendar_event_id` are never touched, or (b) a bridge: the poller runs as the `integration` user through the three `poller_*` RPCs against `integration_jobs` (03 10.2); **(4)** archive the script project 30 days, then delete and revoke; **(5)** retire `process-booking`, `generate-google-meet`, `notify-google-apps-script`, `send-booking-notifications`.
Edge functions that read old tables: `send-acceptance-emails`, `send-rejection-emails`, `send-interview-invitations` (`smtp_settings`, `events`, `company_submissions`, `email_audit_log`), `send-booking-notifications` (`smtp_settings`, `booking_notifications`), `process-booking` and `generate-google-meet` (`google_settings`), `share` (`events`). Each is replaced or retired in the window; leaving one deployed only produces 404s, not damage. Realtime: `company_submissions` removed from the publication (phase 1), `node_revisions` added (phase 2).

### 8.6 Rollback
| Point | Rollback |
|---|---|
| During phases 1-15 | roll back the failing transaction; if phase 1 committed and a later phase cannot be fixed within the window: `migration.rollback()` = drop all `public` target objects registered at creation, `alter table legacy.<t> set schema public` for the 48 tables and the functions/enum, restore grants, re-create the old trigger and publication membership, redeploy the old bundle and functions, resume the trigger. Data unchanged because nothing in `legacy` was ever written. |
| After deploy, before reopening writes | same script; no user data was written to the new schema (only smoke-test rows, deleted by the script). |
| After reopening | **no automatic rollback**. Within the cool-off, a forward fix, or a reverse export of rows created since (`created_at > cutover`) into the old shapes by a one-off script, owner decision. Full fallback: restore the pre-freeze backup (loses new writes). |
Rollback is rehearsed on stack B in every rehearsal.

### 8.7 Sign-off and archive
Owner signs the final report; cool-off default 30 days; then `m90` (OD-18). Until then `legacy` is read-only and unexposed. The `event-assets` bucket stays until the owner decides about old URLs.

### 8.8 What must be redone on the live project later (only after the owner approves; nothing is done by this document)
Everything in sections 5 and 8: pre-freeze `m00`; backup; rehearsal on a fresh live export; the freeze sequence; storage copy against the live bucket; owner actions in Google Cloud (key rotation, OAuth client) and the Supabase dashboard (email confirmation, CAPTCHA, leaked-password protection, redirect URLs); function deploys and secrets; hosting deploy (`mod_rewrite`, 06-2); advisor run; sign-off; `m90`.

---

## 9. Runbook of the future migration files (plan only; none exists)
Names use `<timestamp>_mNN_<name>.sql` under `supabase/migrations/`; storage and checks are scripts. Each file is one transaction unless noted.
| File | Phase | What it does |
|---|---|---|
| `m00_preflight` | 0 | schemas `legacy`, `migration`, `app_private`; extensions; `migration.*` tables; `capture_baseline()`, `asset_path()`, `nid()`; additive |
| `m01_freeze_and_isolate_legacy` | 1 | baseline, revoke writes, move 48 tables + functions + enum to `legacy`, lock down, publication and auth trigger |
| `m02_schema_identity_structure_graph` | 2 | roles, profiles, user_roles, programs, projects, members, node_types, nodes, revisions, edges, links, slugs |
| `m03_schema_entities_forms_lists` | 2 | network_experts, companies, founders, forms, questions, responses, list_items, selection_reviews, participants |
| `m04_schema_modules` | 2 | agenda, library, landing, booking, distribution, certificates, node_events |
| `m05_schema_internal` | 2 | `app_private` workers: outbox, log, jobs, google_connections |
| `m06_functions_triggers_rpcs` | 2 | helpers, revision triggers, RPCs of 04 section 5 |
| `m07_rls_grants_storage_policies` | 2 | policies and grants of 03, buckets |
| `m10_load_reference` | 3 | roles, profiles, user_roles |
| `m11_load_programs_projects` | 4 | Legacy program, projects, members |
| `m12_load_entities` | 5 | network_experts, companies, duplicate flags |
| `m13_load_graph` | 6 | nodes, revisions, edges, links, slugs |
| `m14_load_forms` | 7 | covers, templates, forms, sections, questions, responses |
| `m15_load_lists_selection` | 8 | list_items, selection_reviews |
| `m16_load_agenda_library_landing` | 9 | days, slots, resources, cards, node_events |
| `m17_load_booking` | 10 | providers, slots, bookings, settings |
| `m18_load_distribution` | 11 | distributions, days, mentors, rules, sessions |
| `m19_load_node_configs` | 12 | configs, template overrides, labels, revision bump |
| `scripts/migrate-storage` (+ `m20_apply_asset_paths`) | 13 | copy, resize, thumbnails, path updates |
| `m21_integrations_and_security_checks` | 14 | meta view, security assertions |
| `m22_final_verification_and_report` | 15 | all checks, report, ANALYZE |
| `m90_drop_legacy` | 17 | after sign-off only |
`migration.rollback()` ships with `m01`. Re-running `m10`-`m22` on an already loaded database is safe until `cutover_done` is set.

---

## 10. Test plan

### 10.1 Layers
Per-phase recon checks (6); compare harness (10.2); acceptance scenarios on migrated data (10.3); smoke at cut-over (10.4); RLS matrix per table (03 section 13): anon, founder, participant, PM-member, PM-other, alumni_manager, super_admin.

### 10.2 Compare harness
A script calls the old public read paths on stack A and the new RPCs on stack B for each of the 16 events, normalises (ids, order, language fallback) and diffs: agenda days and slots, experts, companies, library, landing cards, booking pages, distribution matrix. Expected diff: only intended changes (image URLs, hidden provider-only items).

### 10.3 Acceptance scenarios (migrated data)
| # | Scenario | Expected |
|---|---|---|
| A1 | Open the public agenda of ClimAccelerator (`bdf987a0`) by old id, by slug `climaccelerator` and by the old hash link | 3 days, 22 slots, identical times and titles to stack A; redirects land on the new URL |
| A2 | Every event's slot count and an md5 of times/titles | equals 2.2 and checksum `0e10e7cb...` (after the owner's fixup) |
| A3 | Experts tab of ClimAccelerator | 17 experts in the old order; the event with the "Trainer" label shows it; EBRD shows no Experts tab although its mentor exists |
| A4 | Companies tab | 22 for ClimAccelerator; card fields follow each company's old `display_config` |
| A5 | Library of Athar Green Tech / IR Bootcamp | 17 resources; the 5 stored PDFs open through signed URLs; external links unchanged |
| A6 | Public interview booking of Founder Camp (`/ather-team-book/<old member id>`) | page resolves; booked slots are not offered; 6 bookings visible to the PM with their Meet links |
| A7 | A migrated booking of ClimAccelerator | keeps its Meet link and Google event id (`legacy_calendar_event_id`); cancelling it enqueues a calendar cancel job targeting the system connection |
| A8 | Mentor bookings of event `test` | 2 bookings with the link inherited from the slot; 7 unbooked slot links are not exposed publicly |
| A9 | Distribution matrix of ClimAccelerator and of Green Tech Accelerator | 476 and 240 cells; each cell's mentor, company and time equal stack A; no cell from the 432 quarantined rows |
| A10 | Selection board per event | ClimAccelerator 86/8/21/38 (screening/interview/accepted/rejected); Hackathon 2nd cycle 5/0/26/105 + 11 holding; Founder Camp 65 screening; the `displayed` item shows as accepted with its legacy flag; detail modal shows question labels |
| A11 | Search the whole new schema for national-id values and headers | 0 hits; `legacy` still holds them; anon and authenticated cannot reach `legacy` |
| A12 | Send an acceptance e-mail from a migrated Selection node | uses the node-type default for events without an override, the override for `bdf987a0` and `c82e422f` |
| A13 | Log in as each of the 12 accounts | all succeed with the old passwords; roles = `super_admin`; add `project_manager` to one (multi-role) |
| A14 | New founder signup (invitation and open) | role `founder` only, no link to old rows; sees no project |
| A15 | PM without membership | sees no program or project; after being added to a program sees all its projects |
| A16 | Landing page of event `test` | 4 cards, hero cover, analytics 26 events retained |
| A17 | Anonymous REST access to any table | denied; public pages work only through RPCs |
| A18 | Storage | all 46 referenced objects load at new paths with thumbnails; a 24 MB photo is served as a small WebP |
| A19 | Duplicate companies | `merge_companies` on one confirmed pair repoints list items and bookings and keeps one overlay |

### 10.4 Cut-over smoke (30 minutes)
Login; open a project canvas; public agenda; public form submit (a test form, then deleted); interview booking page; PM saves a node (revision bumps); Realtime revision channel; security advisor; one e-mail through the new worker or ported function.

---

## 11. Dry-run evidence (local database, all rolled back)
Scripts were run with `begin; ... rollback;` through `docker exec -i supabase_db_stack psql`; temp tables only; no persistent object. Representative results:
| Dry run | Result |
|---|---|
| Node plan | 82 nodes (agenda 14, booking 4+2, distribution 2, form_builder 12, landing 1, library 3, list company 6 / expert 14, selection 8, view_host 16); 0 id collisions; edges 53 (tabs 34, selection inputs 9, distribution 4, booking providers 6); flag-derived edges 0 |
| Per-event node sets | for example `bdf987a0`: agenda, booking_interview, booking_mentor, distribution, form_legacy, library, list_companies, list_experts, list_team, selection, view_host; `c82e422f`: booking_interview, form_legacy, form (native), list_team, selection, view_host; `f5223948`: agenda, booking_mentor, form_legacy, form (native), landing, list_experts, selection, view_host |
| Experts / booking | network_experts 44 (42 + 2), 2 Arabic names promoted, 0 lost; expert items 67 (2 hidden), team items 2; providers 6; slots 56 of which 1 zero-length (so 55); bookings 30; 30 keep a link; 17 of 28 interview bookings match a company |
| Companies / forms | companies 161, 80 links preserved, 47 founder texts preserved; 16 duplicate groups; forms 7 + 5; questions 56 + 148; sections 6; responses 384; answers 13,428 = 13,428 cells; PII rows 365; max answer 54,476 bytes |
| Selection | 384 items; map 174/8/11/143/48; 43 current reasons, 115 stale; tech_status 35; 13 duplicate applicant names |
| Agenda / distribution | agenda_days 37, slots 248 (1 bad range), bullets 28 = 28; distribution days 9, sessions 716, mentors per day 139, rules 3 (+4 dangling), reconstructed timing 0 mismatches vs 240 naive |
| Storage | 87 references, 46 objects, 30 MB; 5 objects over 1 MB; 0 referenced object missing; 59 unreferenced; 18 missing not referenced |
| Checksums | agenda `0e10e7cb3ad8c19df14082124b4710b2`, companies `93ab119605b6887525f7d4a9c1c443b9`, selection `56747f81a959732b973b5dd80d6d479f`, sessions `1e98f5e1bcef20f3ad8c366b6ad6098d`, bookings `41a34f7bb78809d600b88035128c02e0`: old = new in every case |
| Referential | 60 FKs, 0 orphans in the old schema; soft references: 1 + 8 + 1 (deleted event) and 432 (empty) |
| Templates / links | 64 template cells, 7 distinct non-null variants (4 overrides); 33 public links, 0 duplicate `legacy_ref`; 16 valid unique name slugs |

---

## 12. Open Decisions for the Owner
| # | Decision | Options | Recommendation |
|---|---|---|---|
| OD-1 | Migration strategy | (a) in place, old tables to `legacy` (3.1); (b) new Supabase project | (a); (b) only if rehearsals fail |
| OD-2 | The 16 exact and 4 probable duplicate companies (4.5) | merge now / after confirmation / keep | confirm pair by pair, merge after cut-over with `merge_companies` |
| OD-3 | Test-looking data (events `test`, `founder`, test bookings) | migrate flagged / archive | migrate flagged; owner archives later |
| OD-4 | Name of the Legacy program and whether the 3 projects get real programs | "Legacy projects" / assign now | assign them to real programs when known; otherwise Legacy |
| OD-5 | `national_id` (365 rows incl. answer keys) | one-time export then destroy / keep encrypted | export once, keep only in restricted `legacy`, destroy at sign-off |
| OD-6 | Unreferenced storage (59 objects, 40 MB) and the old bucket | keep / delete / archive offline | keep `event-assets` read-only until URLs are retired; offline copy of the 59 |
| OD-7 | The agenda slot with end 04:30 (start 13:30) | owner gives the end / fallback +60 min | owner gives the value before the final run |
| OD-8 | Visibility of migrated items | preserve today's public access / private by default | preserve, then PMs tighten |
| OD-9 | Distribution timing | reconstruct from sessions (recommended) / derive from config (changes 240 sessions) / store times | reconstruct |
| OD-10 | 98 external images (Drive) | fetch and copy / keep as external URL column / drop | fetch; failures flagged; if the owner wants a fallback, add nullable external-URL columns (Note 04-8) |
| OD-11 | Answer re-keying and labels of Legacy-import forms | as designed / keep sheet headers as keys | as designed |
| OD-12 | Where the `displayed` flag lives | `overlay.legacy_status` / a column on `selection_reviews` | overlay (no schema change) |
| OD-13 | Optional language tidy (split mixed names/labels) | after sign-off / never | after sign-off, as a reviewed report |
| OD-14 | Cut-over date, window length, Apps Script retirement date, who operates | | window of 2-3 hours, poller paused at freeze |
| OD-15 | Calendar path at cut-over | new `calendar-sync` ready / poller bridge | `calendar-sync`; bridge only as fallback |
| OD-16 | Two Athar-team members share one e-mail | keep two experts / merge | keep (names differ), flag |
| OD-17 | Materialise the 48 accepted selection items as participants now | virtual (08 02-7) / materialise | virtual; no founder accounts exist yet |
| OD-18 | Archive retention | drop all after 30 days / keep selected legacy tables | drop after 30 days, keeping an offline dump |
| OD-19 | Provider-only mentors (2) | hidden list item / show in the Experts tab | hidden |
| OD-20 | Legacy registration portals (`/register/company|expert`) | redirect to project page / redirect to a chosen form | project page |
| OD-21 | Rehearsal environment on the cloud | local only / Supabase branch | local (branching has no production data) |

---

## 13. Notes on 00..08

### Notes on 00-conceptual-model
1. 00 section 7 says Selection writes participant records on acceptance; 08 02-7 makes them lazy. This plan creates **no** participant rows (48 virtual).
2. 00 does not mention the Legacy program or archive schema; added here.

### Notes on 01-node-catalog
1. 01 3.4 stage key `accepted` replaces legacy `approved`; `displayed` maps with a flag (01-16).
2. 01 6 booking providers are list items: 2 of 4 mentors need hidden provider-only items (not in 01).
3. 01 3.2 says legacy portals vanish: `/register/company|expert` URLs have no target (OD-20).

### Notes on 02-data-flow
1. 02 section 9 says migrate Selection facts to overlay; the plan keeps decisions in `list_items.status` + `selection_reviews` (as 04) and puts only `tech_status`, previous reasons and the legacy flag in overlay.
2. 02 says matching submissions to responses uses `(form_id, submitted_at, answers)`; locally `form_responses` has 0 rows, so no matching is needed.
3. 02 tab edges "for events that currently show those tabs": implemented with today's exact tab test (4.4); Experts tab needs actual `experts` rows.

### Notes on 03-roles
1. 03 3.1 and 04: `project_managers` empty, so membership starts empty and only super admins see projects after cut-over; PMs must be added (owner action before reopening).
2. 03 6.2 `token = event_id` is realised as `public_links.legacy_ref` (04-4).
3. 03 13 order (data migration before dropping old policies) is superseded: old policies move with their tables into an unexposed schema.
4. Founder role rules: no founder rows are created by migration.

### Notes on 04-database-design
1. 04 3.6/4.1 #21 say `role` and `status` of `companies` are all NULL: `role` is filled on 47 rows (and `founder` on 47); carried in overlay.
2. 04 4.1 #1 lists `experts.display_config`: the column does not exist; `display_config` exists on `companies` only.
3. 04 4.2 says `events.form_cover_image_url` is dropped as a duplicate: it is not (2 distinct values); preserved as project-scoped `form_covers`.
4. 04 3.10/OD-12 derives session times: 240 of 716 would change; per-day timing is reconstructed.
5. 04 3.13 `certificates.code` CHECK vs old 12-hex codes: 0 rows now; a `legacy_code` path is needed if rows exist.
6. 04 `public_links.view_key` is used here for per-host booking links (provider id) and matrix/live.
7. 04 2.6 `companies.links` shape `{type,url}` lacks `label`; the as-is shape `{icon,url,label}` is carried as `{type,url,label}`.
8. 04 rejects external image URLs at save; 98 existing Drive/Google image references need a rule (OD-10), possibly nullable `*_external_url` columns.
9. 04 6 assumes `citext`, `pg_trgm`, `btree_gist`, `pg_jsonschema`, `pg_cron` "available": they are available but not installed locally.
10. 04 4.1 #6 mentions only 432 orphans; also 1 team member, 8 slots, 1 booking for a deleted event, 1 zero-length slot, 4 dangling mentor-availability keys.
11. 04 `answers` cap 64 KB: re-keyed legacy answers reach 54,476 bytes.
12. 04 3.7 says the legacy store has avg 8 KB answers; re-keyed answers keep the sheet headers as labels (larger label text, but stored once per question, not per row).

### Notes on 06-frontend-architecture
1. 06 2.7 assumes project id = former event id: confirmed (preserved).
2. 06 2.7 per-host booking redirect needs the `legacy_ref` per provider (4.4).
3. The old client hard-codes the URL/key; the env switch (8.3) must ship with the new build.

### Notes on 07-emails-integrations
1. 07 1.8 migrates `email_send_count` and `email_audit_log` into `email_log`: both are empty locally; the generic loader covers live.
2. 07 2.3 step 4 (set `calendar_owner_connection_id` to the system connection) is done after the connection exists, not by migration.
3. 07 2.2 puts sync columns on bookings; 04 uses `integration_jobs`; the plan creates jobs only for future unsynced bookings (0 today).
4. 8 edge functions read old tables and must be handled in the window.

### Notes on 08-decisions-log
1. 08 section 5 is outdated: 04 and now 05 exist.
2. 08 04-6 (quarantine) and 04-8 (preserved ids) are applied exactly; 04-3 (Legacy program) applied; 04-5 (`national_id`) extended to answer keys (F3).
3. 08 needs-owner #3 (review the 12 accounts) and #1 (rotate the key) are cut-over gates here.
