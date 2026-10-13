# Stage 2a reconciliation: legacy (old) vs public (new)

Generated from the LOCAL Docker Postgres (`supabase_db_stack`, database `postgres`) by `db/verify/v12_reconciliation_report.sql`. Source = schema `legacy` (the 48 old tables, untouched); target = schema `public` (+ `app_private`). No Storage object was moved or downloaded in stage 2a; no secret was copied.

## 1. Verdict

- Legacy rows (48 tables): **2366**; represented in new tables **1900**, merged duplicates archived **20**, quarantined **443**, deliberately not carried **3** (secrets / dead or empty tables); **unaccounted: 0**.
- Legacy baseline (migration.baseline, captured before the move): **2366** rows in 48 tables: identical to the legacy tables now.
- Check rows (latest run of every phase): ok **152**, warn **2**, mismatch **0**.
- Open `blocker` flags: **0**; open `review` flags: **34** (owner items, section 7); `info`: 34.

## 2. Every legacy table: old count vs new count vs archived vs quarantined

Rule: `old = represented in new + merged (archived) + quarantined + not carried`; `unaccounted` must be 0. "New rows" is the row count of the main target table (it can be larger than the represented rows because the model adds derived rows, e.g. nodes, edges, generated questions).

| Legacy table | Old rows | Represented in new | Merged / archived | Quarantined | Not carried | Unaccounted | Target table | New rows | Disp. | Note |
|---|--:|--:|--:|--:|--:|--:|---|--:|---|---|
| `agenda_slots` | 248 | 248 | 0 | 0 | 0 | 0 | agenda_slots | 248 | C | 1 slot with owner-approved end-time fixup (04:30 -> 16:30), logged in migration.fixups |
| `alumni_invitations` | 0 | 0 | 0 | 0 | 0 | 0 | alumni_invitations | 0 | C | generic loader (token stored as sha256) |
| `ather_team_bookings` | 29 | 28 | 0 | 1 | 0 | 0 | bookings (interview) | 28 | C/Q | booking of the deleted event quarantined |
| `ather_team_members` | 3 | 2 | 0 | 1 | 0 | 0 | network_experts (team) | 2 | C/Q | member of the deleted event quarantined |
| `ather_team_slots` | 54 | 46 | 0 | 8 | 0 | 0 | booking_slots (interview) | 46 | C/Q | 8 slots of the deleted event quarantined |
| `booking_notifications` | 0 | 0 | 0 | 0 | 0 | 0 | - | - | X | empty, replaced by app_private.email_outbox (blocker flag if ever non-empty) |
| `bookings` | 2 | 2 | 0 | 0 | 0 | 0 | bookings (mentor) | 2 | C | 2 pending test bookings loaded as confirmed (no Meet link existed) |
| `certificates` | 0 | 0 | 0 | 0 | 0 | 0 | certificates | 0 | C | empty (blocker flag if ever non-empty: needs a template) |
| `companies` | 161 | 141 | 20 | 0 | 0 | 0 | companies | 141 | C | 20 duplicates merged (16 exact + 4 probable); dropped rows archived in legacy.companies |
| `company_founders` | 0 | 0 | 0 | 0 | 0 | 0 | company_founders | 0 | C | generic loader |
| `company_snapshots` | 0 | 0 | 0 | 0 | 0 | 0 | company_snapshots | 0 | C | generic loader |
| `company_submissions` | 384 | 384 | 0 | 0 | 0 | 0 | form_responses (+ list_items selection, selection_reviews) | 384 | C/M | national_id column (65 non-empty) and the 5 national-id answer headers (665 cells) archived in legacy only; 1 pasted id redacted in a free-text cell |
| `email_audit_log` | 0 | 0 | 0 | 0 | 0 | 0 | - | - | C | empty (blocker flag if ever non-empty) |
| `event_days` | 37 | 37 | 0 | 0 | 0 | 0 | agenda_days | 37 | C |  |
| `event_forms` | 7 | 7 | 0 | 0 | 0 | 0 | forms (+ form nodes, public_links) | 12 | C | 5 Legacy-import forms added |
| `events` | 16 | 16 | 0 | 0 | 0 | 0 | projects (+ nodes, edges, public_links) | 16 | C/D | 82 nodes, 53 edges, 33 links derived |
| `expert_submissions` | 0 | 0 | 0 | 0 | 0 | 0 | - | - | C | empty (blocker flag if ever non-empty) |
| `experts` | 65 | 65 | 0 | 0 | 0 | 0 | list_items (expert lists) | 69 | O | per-event copies became list items by reference to network_experts (+2 hidden provider-only, +2 team) |
| `form_covers` | 3 | 3 | 0 | 0 | 0 | 0 | form_covers | 5 | C | +2 default covers from events.form_cover_image_url |
| `form_field_configs` | 56 | 56 | 0 | 0 | 0 | 0 | form_questions | 204 | C | +148 generated questions for the Legacy-import forms |
| `form_responses` | 0 | 0 | 0 | 0 | 0 | 0 | form_responses | 384 | C | empty (generic loader) |
| `form_share_events` | 0 | 0 | 0 | 0 | 0 | 0 | node_events | 26 | C | empty (generic loader) |
| `founders` | 0 | 0 | 0 | 0 | 0 | 0 | founders | 0 | C | generic loader |
| `google_settings` | 2 | 0 | 0 | 0 | 2 | 0 | - | - | X | SECRET: never copied; metadata only via migration.v_google_settings_meta; stays in the closed legacy archive |
| `investor_requests` | 0 | 0 | 0 | 0 | 0 | 0 | investor_requests | 0 | C | generic loader |
| `join_athar_analytics` | 26 | 26 | 0 | 0 | 0 | 0 | node_events | 26 | C |  |
| `join_athar_cards` | 4 | 4 | 0 | 0 | 0 | 0 | landing_cards | 4 | C |  |
| `join_athar_pages` | 1 | 1 | 0 | 0 | 0 | 0 | nodes (landing_page) | 1 | C/D |  |
| `join_athar_share_presets` | 0 | 0 | 0 | 0 | 0 | 0 | landing_share_presets | 0 | C | empty (generic loader) |
| `library_forms` | 1 | 1 | 0 | 0 | 0 | 0 | form_templates | 1 | C |  |
| `library_resources` | 26 | 26 | 0 | 0 | 0 | 0 | resources | 26 | C | 5 bucket files (path in bucket resources, pending 2b), 21 external links |
| `master_experts` | 42 | 42 | 0 | 0 | 0 | 0 | network_experts (expert) | 42 | C | 2 Arabic names promoted from per-event copies |
| `mentor_day_config` | 0 | 0 | 0 | 0 | 0 | 0 | - | - | X | empty and dead (blocker flag if ever non-empty) |
| `mentor_slots` | 10 | 9 | 0 | 1 | 0 | 0 | booking_slots (mentor) | 9 | C/Q | 1 zero-length slot quarantined |
| `mentoring_distribution_config` | 2 | 2 | 0 | 0 | 0 | 0 | distributions (+ distribution_days, rules) | 2 | C/D | 3 mentor rules loaded, 4 dangling keys flagged |
| `mentoring_distribution_day_config` | 3 | 3 | 0 | 0 | 0 | 0 | distribution_days | 9 | C | 9 days in total (4 + 2 more created from num_days / stored sessions) |
| `mentoring_sessions` | 1148 | 716 | 0 | 432 | 0 | 0 | distribution_sessions | 716 | C/Q | 432 sessions without event id quarantined |
| `mentors` | 4 | 4 | 0 | 0 | 0 | 0 | booking_providers (mentor) | 4 | C |  |
| `notifications` | 0 | 0 | 0 | 0 | 0 | 0 | notifications | 0 | C | generic loader |
| `opportunities` | 0 | 0 | 0 | 0 | 0 | 0 | opportunities | 0 | C | generic loader |
| `opportunity_applications` | 0 | 0 | 0 | 0 | 0 | 0 | opportunity_applications | 0 | C | generic loader |
| `profiles` | 12 | 12 | 0 | 0 | 0 | 0 | profiles | 12 | C |  |
| `program_participations` | 0 | 0 | 0 | 0 | 0 | 0 | participants | 0 | C | generic loader |
| `programs` | 3 | 3 | 0 | 0 | 0 | 0 | programs | 4 | C | +1 invented Legacy program for the 3 projects without a program |
| `project_managers` | 0 | 0 | 0 | 0 | 0 | 0 | project_members | 0 | C | empty: no membership can be derived (open item) |
| `roles` | 4 | 4 | 0 | 0 | 0 | 0 | roles | 5 | C | + integration role |
| `smtp_settings` | 1 | 0 | 0 | 0 | 1 | 0 | - | - | X | SECRET: never copied; stays in the closed legacy archive |
| `user_roles` | 12 | 12 | 0 | 0 | 0 | 0 | user_roles | 12 | C | owner decision 08 s9: 11 accounts converted super_admin -> project_manager (fixups), abdullah.shaban stays super_admin |
| **Total** | **2366** | **1900** | **20** | **443** | **3** | **0** | | | | |

## 3. New schema: row count of every table (and what the design expected)

| Table | Rows | Origin |
|---|--:|---|
| `public.agenda_days` | 37 | loaded from legacy |
| `public.agenda_slots` | 248 | loaded from legacy |
| `public.alumni_invitations` | 0 | loaded from legacy |
| `public.booking_invitations` | 0 | loaded from legacy |
| `public.booking_providers` | 6 | loaded from legacy |
| `public.booking_settings` | 6 | derived (model rows built from legacy data) |
| `public.booking_slots` | 55 | loaded from legacy |
| `public.bookings` | 30 | loaded from legacy |
| `public.certificate_template_fields` | 0 | loaded from legacy |
| `public.certificate_templates` | 0 | loaded from legacy |
| `public.certificates` | 0 | loaded from legacy |
| `public.companies` | 141 | loaded from legacy |
| `public.company_founders` | 0 | loaded from legacy |
| `public.company_snapshots` | 0 | loaded from legacy |
| `public.distribution_day_mentors` | 139 | derived (model rows built from legacy data) |
| `public.distribution_days` | 9 | derived (model rows built from legacy data) |
| `public.distribution_mentor_rules` | 3 | derived (model rows built from legacy data) |
| `public.distribution_sessions` | 716 | loaded from legacy |
| `public.distributions` | 2 | derived (model rows built from legacy data) |
| `public.edges` | 53 | derived (model rows built from legacy data) |
| `public.field_semantics` | 6 | seed (stage 1) / lookup |
| `public.form_covers` | 5 | loaded from legacy |
| `public.form_questions` | 204 | loaded from legacy |
| `public.form_responses` | 384 | loaded from legacy |
| `public.form_sections` | 6 | derived (model rows built from legacy data) |
| `public.form_templates` | 1 | loaded from legacy |
| `public.forms` | 12 | derived (model rows built from legacy data) |
| `public.founders` | 0 | loaded from legacy |
| `public.investor_requests` | 0 | loaded from legacy |
| `public.landing_cards` | 4 | loaded from legacy |
| `public.landing_frames` | 0 | loaded from legacy |
| `public.landing_share_presets` | 0 | loaded from legacy |
| `public.library_selections` | 0 | loaded from legacy |
| `public.list_items` | 612 | loaded from legacy |
| `public.lists` | 20 | derived (model rows built from legacy data) |
| `public.network_experts` | 44 | loaded from legacy |
| `public.node_events` | 26 | loaded from legacy |
| `public.node_revisions` | 82 | derived (model rows built from legacy data) |
| `public.node_types` | 10 | seed (stage 1) / lookup |
| `public.nodes` | 82 | derived (model rows built from legacy data) |
| `public.notifications` | 0 | loaded from legacy |
| `public.opportunities` | 0 | loaded from legacy |
| `public.opportunity_applications` | 0 | loaded from legacy |
| `public.participants` | 0 | loaded from legacy |
| `public.profiles` | 12 | loaded from legacy |
| `public.program_members` | 0 | loaded from legacy |
| `public.programs` | 4 | loaded from legacy |
| `public.project_members` | 0 | loaded from legacy |
| `public.projects` | 16 | loaded from legacy |
| `public.public_link_slugs` | 33 | derived (model rows built from legacy data) |
| `public.public_links` | 33 | derived (model rows built from legacy data) |
| `public.resources` | 26 | loaded from legacy |
| `public.roles` | 5 | seed (stage 1) / lookup |
| `public.selection_reviews` | 201 | loaded from legacy |
| `public.user_roles` | 12 | loaded from legacy |
| `app_private.email_log` | 0 | worker table: nothing to migrate (jobs only for future bookings without a calendar id: none) |
| `app_private.email_outbox` | 0 | worker table: nothing to migrate (jobs only for future bookings without a calendar id: none) |
| `app_private.google_connections` | 0 | worker table: nothing to migrate (jobs only for future bookings without a calendar id: none) |
| `app_private.integration_jobs` | 0 | worker table: nothing to migrate (jobs only for future bookings without a calendar id: none) |

## 4. Per-event business totals (old = new for every metric)

Metrics: agenda_slots; companies (list items; merged same-list pairs collapse); days; distribution_sessions; experts (list items); form_covers (+ default cover); forms; library; mentor_bookings; mentor_slots (loaded subset); mentors (providers); questions; selection_items; submissions; team_bookings; team_members; team_slots.

| Event | agenda_slots | companies (list items; merged same-list pairs collapse) | days | distribution_sessions | experts (list items) | form_covers (+ default cover) | forms | library | mentor_bookings | mentor_slots (loaded subset) | mentors (providers) | questions | selection_items | submissions | team_bookings | team_members | team_slots |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Athar MSMEs incubation program_R1 (c1522ab6) | 35 | 71 | 6 | 0 | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Athar Green Tech Accelerator (850a186e) | 19 | 20 | 3 | 240 | 12 | 0 | 0 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Athar MSMEs incubation program_Startup (bc32fb64) | 12 | 16 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Technation Hackathon  (9c5a305c) | 11 | 0 | 3 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Athar MSMEs incubation program_R3 (05163f32) | 26 | 25 | 5 | 0 | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 |
| EBRD | Executive Management Workshop (2c84e330) | 24 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| ClimAccelerator  (bdf987a0) | 22 | 22 | 3 | 476 | 17 | 0 | 0 | 7 | 0 | 0 | 1 | 0 | 153 | 153 | 22 | 1 | 26 |
| Technation Hackathon (Asyut) (2ef83e04) | 16 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Athar Green Tech | IR Bootcamp (3750a84e) | 33 | 0 | 2 | 0 | 1 | 1 | 2 | 17 | 0 | 0 | 0 | 9 | 2 | 2 | 0 | 0 | 0 |
| Athar Green Tech Hackathon - 2nd Cycle (99cb10ba) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 147 | 147 | 0 | 0 | 0 |
| Founder Camp (c82e422f) | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 5 | 65 | 65 | 6 | 1 | 20 |
| test (f5223948) | 1 | 0 | 1 | 0 | 0 | 3 | 1 | 0 | 2 | 9 | 1 | 37 | 1 | 1 | 0 | 0 | 0 |
| Upper Egypt AI Hackathon (6e283730) | 18 | 0 | 3 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ClimAccelerator | Climate Impact Works (b06f4d8c) | 31 | 5 | 3 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| founder (7b415db5) | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Technation Hackathon  R2 (ae07c865) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 16 | 16 | 0 | 0 | 0 |
| **Total** | 248 | 159 | 37 | 716 | 65 | 5 | 7 | 26 | 2 | 9 | 4 | 56 | 384 | 384 | 28 | 2 | 46 |

Mismatching cells: **0** of 272. (Companies: the 2 same-event merged pairs To7fa and Otaku collapse into one list item each, shown already netted in the old column.)

## 5. Checksums and lossless checks (old side = new side)

| Check | Old / expected | New / actual | Status |
|---|---|---|---|
| D07.2 design: lossless cells 13428 | `13428` | `13428` | ok |
| D07.3 native questions that ask for a national id (kept as configuration, owner to review) | `0` | `1` | warn |
| D10.3 design: 30 of 30 bookings keep a Meet link | `30` | `28` | warn |
| V04.5 project names checksum | `27623e9474f805037811336ec0871d64` | `27623e9474f805037811336ec0871d64` | ok |
| V05.2 no per-event Arabic copy lost | `0` | `0` | ok |
| V05.3 companies checksum (rows outside the merge plan) | `d7d14df544dc2fba938c2fb467c14377` | `d7d14df544dc2fba938c2fb467c14377` | ok |
| V07.3 responses per form node (old vs new) | `546ee4b4-6241-4055-8821-594ade595e8a=2,l` | `546ee4b4-6241-4055-8821-594ade595e8a=2,l` | ok |
| V07.4 lossless non-PII cells (legacy-import rows) | `13428` | `13428` | ok |
| V07.5 PII: no legacy national-id value appears in any new answer | `0` | `0` | ok |
| V07.5 PII: no national-id question label and no key in generated forms / answers | `0` | `0` | ok |
| V08.3 selection checksum md5(id||status) | `d8f33cfafc17557fab834bc4f932729e` | `d8f33cfafc17557fab834bc4f932729e` | ok |
| V09.1 agenda checksum (old side with the fixup applied) | `00fff27598ac3f3a685c61e4d8d12558` | `00fff27598ac3f3a685c61e4d8d12558` | ok |
| V09.1 slots per event | `05163f32=26,2c84e330=24,2ef83e04=16,3750` | `05163f32=26,2c84e330=24,2ef83e04=16,3750` | ok |
| V10.4 bookings per event | `bdf987a0=22,c82e422f=6,f5223948=2` | `bdf987a0=22,c82e422f=6,f5223948=2` | ok |
| V10.5 every booking that had a Meet link (own or slot) keeps it | `28` | `28` | ok |
| V10.5 Google calendar ids kept | `28` | `28` | ok |
| V10.5 own Meet links unchanged | `0` | `0` | ok |
| V10.8 booking checksum md5(id||slot||email||meet_link) | `3a2c92092b7390e43a4fa7b08aedbbb7` | `3a2c92092b7390e43a4fa7b08aedbbb7` | ok |
| V11.1 sessions per event | `850a186e=240,bdf987a0=476` | `850a186e=240,bdf987a0=476` | ok |
| V11.2 sessions checksum md5(id||slot||mentor||company) | `8b7fae5931e41387875934d147a7d55d` | `8b7fae5931e41387875934d147a7d55d` | ok |
| V11.3 reconstructed day timing reproduces every stored session time (start and end) | `0` | `0` | ok |
| V14.2 columns with secret-like names (alumni_invitations.token = sha256 hash, google_connections.vault_secret_id = vault reference) | `2` | `2` | ok |
| V14.2 no secret value (Google key material, SMTP password) in public / app_private text columns | `0` | `0` | ok |
| V80.2 per-event business totals: no mismatch | `0` | `0` | ok |

## 6. Quarantined, archived and not-carried data (nothing is deleted: all stays in schema `legacy`)

| What | Rows | Where it stays | Why |
|---|--:|---|---|
| mentoring_sessions without event id | 432 | `legacy.v_quarantine_mentoring_sessions` | cannot be attached to a project (04-6); superseded generation of event Green Tech Accelerator, see flag |
| ather_team_members of a deleted event | 1 | `legacy.v_quarantine_ather_team_members` | event no longer exists |
| ather_team_slots (deleted event) | 8 | `legacy.v_quarantine_ather_team_slots` | event no longer exists |
| ather_team_bookings (deleted event) | 1 | `legacy.v_quarantine_ather_team_bookings` | event no longer exists |
| mentor_slots zero length | 1 | `legacy.v_quarantine_mentor_slots` | violates start < end |
| mentor rules pointing at deleted experts | 4 | `legacy.mentoring_distribution_config.mentor_availability` | expert no longer exists |
| company duplicates merged (dropped rows) | 20 | `legacy.companies` (+ `migration.company_merges`) | owner decision 08 s10 |
| national_id column values (non-empty) | 65 | `legacy.company_submissions.national_id` | ARCHIVED, never carried (owner 05-b) |
| national-id answer cells (5 headers) | 665 | `legacy.company_submissions.additional_data` | ARCHIVED, never carried (owner 05-b) |
| google_settings rows (service-account key) | 2 | `legacy.google_settings` | secret, never copied (service account deleted by the owner) |
| smtp_settings rows (password) | 1 | `legacy.smtp_settings` | secret, never copied |
| per-event copies of expert fields (experts) | 65 | `legacy.experts` | equal to the master; only the list-item reference is carried (G1) |
| unbooked mentor slots with a pre-generated Meet link | 0 | `legacy.mentor_slots` | links are created at booking time (07-6) |

## 7. The 20 company merges (owner decision 08 s8 / s10)

| # | Kind | Canonical company kept | Dropped duplicate (archived in legacy) | Items moved | Items collapsed |
|--:|---|---|---|--:|--:|
| 1 | exact | AgriEagle | AgriEagle | 1 | 0 |
| 2 | exact | Boutique nona | Boutique nona | 1 | 0 |
| 3 | exact | Cow Care Cam | Cow care cam | 1 | 0 |
| 4 | exact | Eco Fin | Eco Fin | 1 | 0 |
| 5 | exact | GeoCycle | GeoCycle | 1 | 0 |
| 6 | exact | Glowmetra | Glowmetra | 1 | 0 |
| 7 | exact | Green Pyramids  | Green Pyramids  | 1 | 0 |
| 8 | exact | HerHealth | HerHealth | 1 | 0 |
| 9 | exact | Natural and healthy | Natural and Healthy | 1 | 0 |
| 10 | exact | P-Vita  | P-Vita  | 1 | 0 |
| 11 | exact | REDS Technologies | REDS Technologies | 1 | 0 |
| 12 | exact | ScalaVerse | ScalaVerse | 1 | 0 |
| 13 | exact | Service agent | Service agent | 1 | 0 |
| 14 | exact | Smart Agro-Automation Team (SAAT) | Smart Agro-Automation Team (SAAT) | 1 | 0 |
| 15 | exact | Sokkary.net | Sokkary.net | 1 | 0 |
| 16 | exact | Ultra Biotech (UB) | Ultra Biotech (UB) | 1 | 0 |
| 17 | probable | Cocorra (كوكورا) | كوكورا cocorra | 1 | 0 |
| 18 | probable | Moni Cake (موني كيك) | موني كيك (Moni Cake) | 1 | 0 |
| 19 | probable | Otaku (أوتاكو) | أوتاكو-Otaku | 0 | 1 |
| 20 | probable | To7fa (تحفة) | تحفة To7fa | 0 | 1 |

## 8. Recorded fixups (old value kept)

| Entity | Reference | Column | New value | Reason |
|---|---|---|---|---|
| agenda_slots | 778edbe8 | end_time | 16:30 | owner decision 08 s13: end 04:30 -> 16:30 (old value: 04:30; start 13:30; event "Upper Egypt AI Hackathon", day 2026-09-10, order 6) |
| user_roles | (account 1) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 2) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 3) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 4) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 5) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 7) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 8) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 9) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 10) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 11) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |
| user_roles | (account 12) | role_key | project_manager | owner decision 08 section 9: all accounts become project_manager except abdullah.shaban@athareg.com (old value: super_admin) |

## 9. Flags and open items (migration.flags)

| Code | Severity | Open | Resolved | Example message |
|---|---|--:|--:|---|
| `asset_bucket_pending_2b` | review | 1 | 0 | 46 event-assets objects are recorded as pending for stage 2b (copy/resize to the new buckets; paths are already written in the *_path columns) |
| `asset_external_pending_2b` | review | 1 | 0 | 61 distinct external image URLs (Google Drive etc.) are recorded as pending for stage 2b (download into Storage; failures to be listed for the owner) |
| `booking_calendar_owner_pending` | review | 1 | 0 | 28 bookings carry a Google calendar event id created by the startups@ poller; set calendar_owner_connection_id after the system google_connection exis |
| `company_duplicate` | review | 0 | 20 | exact duplicate of "AgriEagle" (canonical 4d53e07c-7983-48db-8655-0422e9c3672e): canonical = the row referenced by more bookings -- MERGED (owner deci |
| `form_collects_national_id` | review | 1 | 0 | native form question "National ID" is kept as form configuration; the owner archived the VALUES only (05-b). The form will collect national ids again  |
| `mentor_rule_dangling` | review | 4 | 0 | mentor_availability key points at an expert that no longer exists; rule not loaded (kept in legacy) |
| `pii_redacted_in_answer` | review | 1 | 0 | a 14-digit national-id value was pasted inside a free-text answer; replaced by a marker in the new schema (cell count unchanged, original kept only in |
| `pm_without_membership` | review | 11 | 0 | project_manager account with no program/project membership: legacy.project_managers is empty and events carry no created_by, so nothing can be derived |
| `quarantine_ather_team_booking` | review | 1 | 0 | booking of a deleted event: not loaded, kept in legacy |
| `quarantine_ather_team_member` | review | 1 | 0 | member of a deleted event (bdb9e11d-1ad5-4994-8bec-1a3d028341ac): not loaded, kept in legacy (view legacy.v_quarantine_ather_team_members) |
| `quarantine_ather_team_slot` | review | 8 | 0 | slot of a deleted event / orphan member / zero length: not loaded, kept in legacy |
| `quarantine_mentor_slot` | review | 1 | 0 | zero-length or orphan mentor slot: not loaded, kept in legacy (meet_link kept there) |
| `quarantine_mentoring_sessions` | review | 1 | 0 | 432 sessions without an event id are not loaded (04-6). Evidence: created 2026-07-25..2026-07-25; derivable event: Athar Green Tech Accelerator; colli |
| `secret_in_legacy_archive` | review | 2 | 0 | the Google service-account key text (service account deleted by the owner 08 s12) still sits in the closed legacy archive; it is NOT copied. Null it / |
| `booking_pending_loaded_confirmed` | info | 2 | 0 | legacy status pending (test event, past start) loaded as confirmed (the legacy row never had a Meet link) |
| `booking_without_meet_link` | info | 2 | 0 | legacy booking never had a Meet link (neither the booking nor its slot; test event). Loaded without link (05 F12 expected the slot to carry one) |
| `distribution_day_without_date` | info | 6 | 0 | no calendar date stored for this day (legacy day config had none); v_distribution_sessions.starts_at is null until the PM sets day_date or links an ag |
| `duplicate_applicant_names` | info | 3 | 0 | 1 applicant names appear more than once in this event (kept as separate responses) |
| `form_show_in_card_config` | info | 3 | 0 | 4 questions had show_in_card=true: stored as node config.show_in_card (list card config for the PM to review) |
| `interview_booking_company_unmatched` | info | 11 | 0 | company name matches no company of the event: kept as free text booker_company_name |
| `legacy_import_meta_keys_as_questions` | info | 2 | 0 | answer keys rejected_reason/holding_reason/approved_reason/tech_status are kept as answers (lossless cell count) AND copied to the selection review/ov |
| `legacy_portal_settings_not_carried` | info | 1 | 0 | legacy company/expert portal switches/messages/deadline and admin_email are not carried (portals replaced by public forms); values stay in legacy.even |
| `national_id_column_not_ids` | info | 1 | 0 | 53 of the 65 non-empty national_id column values are free text, not 14-digit ids (Founder Camp); the whole column is archived in legacy only (owner 05 |
| `selection_items_without_edge` | info | 1 | 0 | the 2 responses of the native company form (target_module=company) have selection items but no form->selection edge (05 4.4 creates edges only for sel |
| `test_data` | info | 2 | 0 | test-looking event (founder); migrated like the rest (OD-3) |

## 10. Storage bookkeeping for stage 2b (nothing moved in stage 2a)

| Source | Status | Distinct objects / URLs | Bytes |
|---|---|--:|--:|
| bucket | pending | 46 | 30855051 |
| external | pending | 61 | - |
| static | skipped_static | 1 | - |

References recorded (which column gets which path): **112** in `migration.asset_refs`; target paths are already written in the `*_path` columns, the files do not exist there yet (stage 2b copies / downloads them). `storage.objects` count unchanged: **112**.

## 11. All check results of the latest run of every phase

| Phase | Check | Expected | Actual | Status |
|---|---|---|---|---|
| m10_load_reference_programs | D04.1 design: programs 4 / projects 16 / covers 8 | `4/16/8` | `4/16/8` | ok |
| m10_load_reference_programs | V03.1 roles | `5` | `5` | ok |
| m10_load_reference_programs | V04.1 programs = legacy + Legacy | `4` | `4` | ok |
| m10_load_reference_programs | V04.2 projects = events | `16` | `16` | ok |
| m10_load_reference_programs | V04.3 every project has a program | `0` | `0` | ok |
| m10_load_reference_programs | V04.4 projects in Legacy program | `3` | `3` | ok |
| m10_load_reference_programs | V04.5 project names checksum | `27623e9474f805037811336ec0871d64` | `27623e9474f805037811336ec0871d64` | ok |
| m10_load_reference_programs | V04.6 projects with cover path | `8` | `8` | ok |
| m11_load_roles_profiles_membership | D03.1 design: user_roles 12 / profiles 12 / members 0 | `12/12/0` | `12/12/0` | ok |
| m11_load_roles_profiles_membership | D03.2 open items: PMs without membership | `11` | `11` | ok |
| m11_load_roles_profiles_membership | V01.4 auth password fingerprint unchanged | `a45920886e5f1ab950a33379e962707d` | `a45920886e5f1ab950a33379e962707d` | ok |
| m11_load_roles_profiles_membership | V01.4 auth.users untouched (count) | `12` | `12` | ok |
| m11_load_roles_profiles_membership | V03.2 every auth user has profile and role | `0` | `0` | ok |
| m11_load_roles_profiles_membership | V03.2 profiles = legacy | `12` | `12` | ok |
| m11_load_roles_profiles_membership | V03.2 user_roles = legacy | `12` | `12` | ok |
| m11_load_roles_profiles_membership | V03.4 owner account is super_admin | `1` | `1` | ok |
| m11_load_roles_profiles_membership | V03.4 project_manager accounts | `11` | `11` | ok |
| m11_load_roles_profiles_membership | V03.4 super_admin accounts | `1` | `1` | ok |
| m11_load_roles_profiles_membership | V03.5 no account holds two roles | `0` | `0` | ok |
| m11_load_roles_profiles_membership | V03.5 no founder role created | `0` | `0` | ok |
| m11_load_roles_profiles_membership | V04.7 project_members = legacy project_managers (loadable) | `0` | `0` | ok |
| m12_load_entities | D05.1 design: network_experts 44 / companies 161 (before merges) | `44/161` | `44/161` | ok |
| m12_load_entities | V05.1 network_experts expert = master_experts | `42` | `42` | ok |
| m12_load_entities | V05.1 network_experts team = members of existing events | `2` | `2` | ok |
| m12_load_entities | V05.2 no per-event Arabic copy lost | `0` | `0` | ok |
| m12_load_entities | V05.3 companies = legacy - merged | `161` | `161` | ok |
| m12_load_entities | V05.3 companies checksum (rows outside the merge plan) | `d7d14df544dc2fba938c2fb467c14377` | `d7d14df544dc2fba938c2fb467c14377` | ok |
| m12_load_entities | V05.4 company link objects preserved (rows outside merged) | `80` | `80` | ok |
| m12_load_entities | V05.6 duplicate flags (open + resolved) | `20` | `20` | ok |
| m12_load_entities | V05.6 merge plan: 16 exact + 4 probable | `16/4` | `16/4` | ok |
| m13_load_graph | D06.1 design: nodes 82 / edges 53 / links 33 / slugs 33 | `82/53/33/33` | `82/53/33/33` | ok |
| m13_load_graph | D06.2 design: edges tab34/sel9/dist4/book6 | `34/9/4/6` | `34/9/4/6` | ok |
| m13_load_graph | D06.3 design: per type | `agenda=14,booking=6,distribution=2,form_builder=12` | `agenda=14,booking=6,distribution=2,form_builder=12` | ok |
| m13_load_graph | V06.1 nodes = plan | `82` | `82` | ok |
| m13_load_graph | V06.1 nodes by type | `agenda=14,booking=6,distribution=2,form_builder=12` | `agenda=14,booking=6,distribution=2,form_builder=12` | ok |
| m13_load_graph | V06.2 every node has a revision row | `0` | `0` | ok |
| m13_load_graph | V06.3 edges: no project mismatch | `0` | `0` | ok |
| m13_load_graph | V06.4 no cycle in any family | `0` | `0` | ok |
| m13_load_graph | V06.5 legacy_ref distinct | `0` | `0` | ok |
| m13_load_graph | V06.5 public_links = plan | `33` | `33` | ok |
| m13_load_graph | V06.6 name-derived slugs on agenda links | `16` | `16` | ok |
| m13_load_graph | V06.6 slugs = links, one current each | `33` | `33` | ok |
| m14_load_forms | D07.1 design: forms 12 / sections 6 / questions 204 / responses 384 / covers 5 / templates 1 | `12/6/204/384/5/1` | `12/6/204/384/5/1` | ok |
| m14_load_forms | D07.2 design: lossless cells 13428 | `13428` | `13428` | ok |
| m14_load_forms | D07.3 native questions that ask for a national id (kept as configuration, owner to review) | `0` | `1` | warn |
| m14_load_forms | V07.1 forms = native + Legacy import | `12` | `12` | ok |
| m14_load_forms | V07.1 questions = native + generated | `204` | `204` | ok |
| m14_load_forms | V07.1 sections = integrations form_sections | `6` | `6` | ok |
| m14_load_forms | V07.2 responses = submissions + form_responses + expert_submissions | `384` | `384` | ok |
| m14_load_forms | V07.3 responses per form node (old vs new) | `546ee4b4-6241-4055-8821-594ade595e8a=2,legacy:99cb` | `546ee4b4-6241-4055-8821-594ade595e8a=2,legacy:99cb` | ok |
| m14_load_forms | V07.4 lossless non-PII cells (legacy-import rows) | `13428` | `13428` | ok |
| m14_load_forms | V07.5 PII: no legacy national-id value appears in any new answer | `0` | `0` | ok |
| m14_load_forms | V07.5 PII: no national-id question label and no key in generated forms / answers | `0` | `0` | ok |
| m14_load_forms | V07.6 every answer key exists as a question of its node | `0` | `0` | ok |
| m14_load_forms | V07.7 answers within 64 KB cap | `true` | `true` | ok |
| m14_load_forms | V07.8 questions keep their section reference | `37` | `37` | ok |
| m14_load_forms | V07.9 covers = legacy + defaults | `5` | `5` | ok |
| m14_load_forms | V07.9 templates = library_forms | `1` | `1` | ok |
| m15_load_lists_selection | D08.1 design: list_items 614 / reviews 201 / participants 0 | `614/201/0` | `614/201/0` | ok |
| m15_load_lists_selection | V08.1 company items = companies - collapsed merges | `161` | `161` | ok |
| m15_load_lists_selection | V08.1 expert items = experts + hidden provider-only | `67` | `67` | ok |
| m15_load_lists_selection | V08.1 hidden provider-only items | `2` | `2` | ok |
| m15_load_lists_selection | V08.1 selection items = submissions | `384` | `384` | ok |
| m15_load_lists_selection | V08.1 team items | `2` | `2` | ok |
| m15_load_lists_selection | V08.2 no duplicate source per list | `0` | `0` | ok |
| m15_load_lists_selection | V08.3 selection checksum md5(id//status) | `d8f33cfafc17557fab834bc4f932729e` | `d8f33cfafc17557fab834bc4f932729e` | ok |
| m15_load_lists_selection | V08.3 selection status histogram (mapped) | `accepted=48,holding=11,interview=8,rejected=143,sc` | `accepted=48,holding=11,interview=8,rejected=143,sc` | ok |
| m15_load_lists_selection | V08.4 founder text / role / card config in overlay (items outside merges) | `37/37/121` | `37/37/121` | ok |
| m15_load_lists_selection | V08.5 selection_reviews | `201` | `201` | ok |
| m15_load_lists_selection | V08.6 every non-empty *_reason preserved (current + previous) | `158` | `158` | ok |
| m15_load_lists_selection | V08.7 tech_status in overlay | `35` | `35` | ok |
| m15_load_lists_selection | V08.8 legacy_status displayed | `1` | `1` | ok |
| m16_load_agenda_library_landing | D09.1 design: days 37 / slots 248 / resources 26 / cards 4 / events 26 | `37/248/26/4/26` | `37/248/26/4/26` | ok |
| m16_load_agenda_library_landing | V09.1 agenda checksum (old side with the fixup applied) | `00fff27598ac3f3a685c61e4d8d12558` | `00fff27598ac3f3a685c61e4d8d12558` | ok |
| m16_load_agenda_library_landing | V09.1 agenda_days | `37` | `37` | ok |
| m16_load_agenda_library_landing | V09.1 agenda_slots | `248` | `248` | ok |
| m16_load_agenda_library_landing | V09.1 slots per event | `05163f32=26,2c84e330=24,2ef83e04=16,3750a84e=33,6e` | `05163f32=26,2c84e330=24,2ef83e04=16,3750a84e=33,6e` | ok |
| m16_load_agenda_library_landing | V09.1 the fixed slot now ends 16:30 and the old value is logged | `16:30/04:30` | `16:30/04:30` | ok |
| m16_load_agenda_library_landing | V09.2 bullet items | `28` | `28` | ok |
| m16_load_agenda_library_landing | V09.3 resources bucket files vs external | `5/21` | `5/21` | ok |
| m16_load_agenda_library_landing | V09.3 resources by event | `3750a84e=17,850a186e=2,bdf987a0=7` | `3750a84e=17,850a186e=2,bdf987a0=7` | ok |
| m16_load_agenda_library_landing | V09.4 landing_cards | `4` | `4` | ok |
| m16_load_agenda_library_landing | V09.4 node_events = analytics + form shares | `26` | `26` | ok |
| m17_load_booking | D10.1 design: providers 6 / slots 55 / bookings 30 / quarantined slots 9 / bookings 1 | `6/55/30/9/1` | `6/55/30/9/1` | ok |
| m17_load_booking | D10.2 design: 17 of 28 interview bookings matched to a company | `17` | `17` | ok |
| m17_load_booking | D10.3 design: 30 of 30 bookings keep a Meet link | `30` | `28` | warn |
| m17_load_booking | V10.1 providers = mentors + team (existing events) | `6` | `6` | ok |
| m17_load_booking | V10.10 interview bookings linked to a company | `17` | `17` | ok |
| m17_load_booking | V10.2 slot accounting: legacy = loaded + quarantined | `64` | `64` | ok |
| m17_load_booking | V10.3 booking accounting: legacy = loaded + quarantined | `31` | `31` | ok |
| m17_load_booking | V10.4 bookings per event | `bdf987a0=22,c82e422f=6,f5223948=2` | `bdf987a0=22,c82e422f=6,f5223948=2` | ok |
| m17_load_booking | V10.5 every booking that had a Meet link (own or slot) keeps it | `28` | `28` | ok |
| m17_load_booking | V10.5 Google calendar ids kept | `28` | `28` | ok |
| m17_load_booking | V10.5 own Meet links unchanged | `0` | `0` | ok |
| m17_load_booking | V10.6 no slot with two confirmed bookings | `0` | `0` | ok |
| m17_load_booking | V10.8 booking checksum md5(id//slot//email//meet_link) | `3a2c92092b7390e43a4fa7b08aedbbb7` | `3a2c92092b7390e43a4fa7b08aedbbb7` | ok |
| m17_load_booking | V10.9 derived start/end equal the old booking start/end | `0` | `0` | ok |
| m18_load_distribution | D11.1 design: distributions 2 / days 9 / day mentors 139 / rules 3 / sessions 716 | `2/9/139/3/716` | `2/9/139/3/716` | ok |
| m18_load_distribution | V11.1 distributions | `2` | `2` | ok |
| m18_load_distribution | V11.1 sessions per event | `850a186e=240,bdf987a0=476` | `850a186e=240,bdf987a0=476` | ok |
| m18_load_distribution | V11.1 sessions without a company | `138` | `138` | ok |
| m18_load_distribution | V11.1 sessions: legacy = loaded + quarantined | `1148` | `1148` | ok |
| m18_load_distribution | V11.2 sessions checksum md5(id//slot//mentor//company) | `8b7fae5931e41387875934d147a7d55d` | `8b7fae5931e41387875934d147a7d55d` | ok |
| m18_load_distribution | V11.3 reconstructed day timing reproduces every stored session time (start and end) | `0` | `0` | ok |
| m18_load_distribution | V11.3 view v_distribution_sessions agrees (rows that have a day date) | `0` | `0` | ok |
| m18_load_distribution | V11.4 mentor / company items exist in the same project | `0` | `0` | ok |
| m18_load_distribution | V11.6 quarantined sessions = 432 | `432` | `432` | ok |
| m19_load_node_configs_emails | D12.1 design: 64 template cells -> 4 overrides | `4` | `4` | ok |
| m19_load_node_configs_emails | V12.1 nodes with an empty config | `54` | `54` | ok |
| m19_load_node_configs_emails | V12.2 default template sets kept (distinct non-null variants) | `3` | `3` | ok |
| m19_load_node_configs_emails | V12.2 overrides on the right events (interview/rejection/acceptance bdf9, acceptance c82e) | `bdf987a0:acceptance,bdf987a0:interview,bdf987a0:re` | `bdf987a0:acceptance,bdf987a0:interview,bdf987a0:re` | ok |
| m19_load_node_configs_emails | V12.2 recipient lists preserved | `4` | `4` | ok |
| m19_load_node_configs_emails | V12.2 template overrides present (node, key) | `4` | `4` | ok |
| m19_load_node_configs_emails | V12.3 every config is a JSON object within the size cap | `0` | `0` | ok |
| m20_load_alumni_generic | V20.1 generic tables: legacy = loaded (founders/company_founders/snapshots/invitations/notifications/opportunities/applications/investor_requests) | `0/0/0/0/0/0/0/0` | `0/0/0/0/0/0/0/0` | ok |
| m20_load_alumni_generic | V20.2 participants = loadable program_participations | `0` | `0` | ok |
| m20_load_alumni_generic | V20.3 no blocker flag open | `0` | `0` | ok |
| m21_merge_companies | V21.1 exact / probable | `16/4` | `16/4` | ok |
| m21_merge_companies | V21.1 merges executed | `20` | `20` | ok |
| m21_merge_companies | V21.2 companies = legacy - merged | `141` | `141` | ok |
| m21_merge_companies | V21.2 no reference to a dropped company remains | `0` | `0` | ok |
| m21_merge_companies | V21.3 company list items: programs covered per company (merged pairs) | `ok` | `ok` | ok |
| m21_merge_companies | V21.3 dropped companies remain in the legacy archive | `20` | `20` | ok |
| m21_merge_companies | V21.3 every canonical company is still in at least one program/project | `0` | `0` | ok |
| m21_merge_companies | V21.4 company list items = 614 company+selection+expert+team minus collapsed | `159` | `159` | ok |
| m21_merge_companies | V21.5 same-program pairs collapsed (To7fa, Otaku) | `2` | `2` | ok |
| m21_merge_companies | V21.6 description-differing pairs keep the more recent row | `true` | `true` | ok |
| m21_merge_companies | V21.7 probable pairs: bilingual name and Arabic name_ar | `4` | `4` | ok |
| m21_merge_companies | V21.8 open duplicate flags | `0` | `0` | ok |
| m21_merge_companies | V21.9 interview bookings still linked to a company | `17` | `17` | ok |
| m22_asset_map_and_security_checks | V13.0 bucket references: distinct objects registered exist as storage.objects (event-assets) | `0` | `0` | ok |
| m22_asset_map_and_security_checks | V13.0 every non-NULL path in the new schema is registered in asset_map | `0` | `0` | ok |
| m22_asset_map_and_security_checks | V13.0 no asset_map record without a status | `0` | `0` | ok |
| m22_asset_map_and_security_checks | V13.0 no file moved in stage 2a (status never copied/failed) | `0` | `0` | ok |
| m22_asset_map_and_security_checks | V13.0 storage.objects untouched (count = baseline) | `112` | `112` | ok |
| m22_asset_map_and_security_checks | V14.2 columns with secret-like names (alumni_invitations.token = sha256 hash, google_connections.vault_secret_id = vault reference) | `2` | `2` | ok |
| m22_asset_map_and_security_checks | V14.2 no secret value (Google key material, SMTP password) in public / app_private text columns | `0` | `0` | ok |
| m22_asset_map_and_security_checks | V14.3 google_connections / email_outbox hold no loaded rows | `0` | `0` | ok |
| m80_final_verification_reconciliation | D80.1 design 6.2 headline counts (companies 161-20=141, list_items 614-2=612) | `roles5 user_roles12 profiles12 programs4 projects1` | `roles5 user_roles12 profiles12 programs4 projects1` | ok |
| m80_final_verification_reconciliation | V80.1 every legacy table in the catalog is reconciled | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.1 legacy row total = baseline | `2366` | `2366` | ok |
| m80_final_verification_reconciliation | V80.1 nothing unaccounted: old = represented + merged + quarantined + not carried | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.1 table reconciliation covers all 48 legacy tables | `48` | `48` | ok |
| m80_final_verification_reconciliation | V80.2 per-event business totals: no mismatch | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.3 referential scan of the NEW schema (public + app_private FKs): orphans | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.3 referential scan of the OLD schema (legacy FKs): orphans | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.4 no node without extension row where one is required | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.5 every project has the view host node | `0` | `0` | ok |
| m80_final_verification_reconciliation | V80.6 no open blocker flag | `0` | `0` | ok |
| m90_finalize_stage2a | V90.1 every node has rev = 2 | `0` | `0` | ok |
| m90_finalize_stage2a | V90.2 legacy schema still intact (48 tables) | `48` | `48` | ok |
| m90_finalize_stage2a | V90.3 cutover not done | `false` | `false` | ok |
| m90_finalize_stage2a | V90.4 open blocker flags | `0` | `0` | ok |
| m90_finalize_stage2a | V90.5 recon rows with status mismatch in the latest run of every phase | `0` | `0` | ok |

## 12. Verification scripts (latest run of each)

| Script phase | Result | Checks ok | Not ok / warn |
|---|---|--:|--:|
| stage1-verify-v01 | PASS | 7 | 0 |
| stage1-verify-v02 | PASS | 30 | 3 |
| stage1-verify-v03 | PASS | 131 | 0 |
| stage2a-verify-v10 | PASS | 30 | 3 |
| stage2a-verify-v11 | PASS | 180 | 0 |

Reading notes: `warn` rows are informational (D03 owner review items, design-vs-data differences listed in `db/MIGRATION-LOG.md`); a `mismatch` would have aborted the phase transaction.
