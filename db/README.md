# db/ - Stage 1 (LOCAL) database migration

Target: the local Docker Postgres only (container `supabase_db_stack`, database `postgres`). `run.sh` refuses any container
whose name does not start with `supabase_db_`. No remote project is ever touched. No business data is loaded here (stage 2).

## Layout and order
| File | Purpose |
|---|---|
| `migrations/m00_preflight.sql` | schemas (`legacy`, `migration`, `app_private`), extensions, `migration.*` bookkeeping tables, baseline capture |
| `m01_freeze_and_isolate_legacy.sql` | moves the 48 old tables, 2 enums, 14 functions to schema `legacy`; drops old auth trigger; closes `legacy` to API roles |
| `m02` / `m03` / `m04` / `m05` | target schema: identity+structure+graph / entities+forms+lists / modules (booking, certificates, ...) + `google_connections` / `app_private` worker tables |
| `m06a` .. `m06d` | helper + trigger functions (revision bump, tombstone, `handle_new_user`, `merge_companies`) and the RPCs of design 04 section 5 |
| `m07_rls_grants_storage_policies.sql` | RLS policies, grants (anon revoked), storage buckets and policies, realtime publication (`node_revisions` only) |
| `verify/v01..v03` | legacy isolation / structure + security census / RLS role-switch tests (test rows live in transactions that are rolled back) |
| `MIGRATION-LOG.md` | what was executed, results, deviations, open items |

All migrations are idempotent (`if not exists`, `create or replace`, explicit-list moves), so re-running on the same DB is safe.

## Run
```
bash db/run.sh                 # m00..m07 then v01..v03 on the local postgres DB (log in local-db/logs/)
bash db/run.sh migrations      # only migrations      | bash db/run.sh verify   # only verifications
bash db/run.sh file db/migrations/m03_schema_entities_forms_lists.sql
DB_NAME=stage1_test bash db/run.sh     # against another DB inside the container
```
## Re-run from a clean state (proof)
```
bash db/test-from-scratch.sh   # restores the baseline dump into scratch DB stage1_test, runs everything, drops it
```
## Baseline / restore
`local-db/backups/baseline-pre-migration.dump` (pg_dump custom format, 2215366 bytes, sha256
`0474c41573a9236eb83d894e9442b96d7a738293e7620c7ae014b61e37ff17f5`) is the pre-migration copy. To return to it, restore into a
fresh database (do not restore over the live auth/storage schemas):
```
docker cp local-db/backups/baseline-pre-migration.dump supabase_db_stack:/tmp/baseline.dump
docker exec supabase_db_stack psql -U postgres -c "create database restore_test"
docker exec supabase_db_stack pg_restore -U postgres -d restore_test --no-owner /tmp/baseline.dump
```
(32 harmless `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` errors are expected because `postgres` is not that role.)

---
# Stage 2a - business data load (LOCAL)  (files m10..m90, v10..v13)

Loads the business data from schema `legacy` (48 old tables, never modified or deleted) into the new `public` schema. Local Docker Postgres only
(`run2a.sh` refuses any container that is not `supabase_db_*`). No Storage object is moved/downloaded (stage 2b), no secret is copied, no remote project is touched.
Checkpoint taken before the load: `local-db/backups/pre-stage2a.dump` (git-ignored; sha256 `a212fb8e9376c53868ddcebd56f15ab1f285624597d06718627f473ff6f67a12`, 2949793 bytes).

| File | Phase (05) | What it does |
|---|---|---|
| `migrations/m10_load_reference_programs.sql` | 3/4 | loader helpers (`migration.check`, `flag`, `register_asset`...), roles, programs (+ Legacy program), projects |
| `m11_load_roles_profiles_membership.sql` | 3/4 | profiles, user_roles with the owner's account decision (11 -> `project_manager`, abdullah.shaban stays `super_admin`, recorded as fixups), memberships from `project_managers` |
| `m12_load_entities.sql` | 5 | network_experts (42 + 2 team), companies (161), merge plan + 20 duplicate flags |
| `m13_load_graph.sql` | 6 | 82 nodes, extension rows (lists/booking_settings), 53 edges, 33 public links + 33 slugs |
| `m14_load_forms.sql` | 7 | covers, template, 12 forms (7 native + 5 Legacy import), sections, 204 questions, 384 responses (answers re-keyed, national id stripped) |
| `m15_load_lists_selection.sql` | 8 | list_items (experts, team, companies, selection), selection_reviews |
| `m16_load_agenda_library_landing.sql` | 9 | agenda (with the 16:30 fixup), resources, landing cards, analytics events |
| `m17_load_booking.sql` | 10 | providers, slots, bookings (+ quarantine views, calendar-job rule) |
| `m18_load_distribution.sql` | 11 | distributions, days (timing reconstructed from sessions), day mentors, rules, 716 sessions (+ quarantine view) |
| `m19_load_node_configs_emails.sql` | 12 | node configs, e-mail template dedup (defaults table + 4 overrides), recipient lists |
| `m20_load_alumni_generic.sql` | 4.1 generic rule | loaders for the empty alumni/founder/participation tables; blocker flags for tables without destination |
| `m21_merge_companies.sql` | owner 08 s8/s10 | the 20 approved merges through `merge_companies(keep, drop)` |
| `m22_asset_map_and_security_checks.sql` | 13/14 (SQL side) | asset bookkeeping for stage 2b, secret-free metadata views, "no secret value in public" scan |
| `m80_final_verification_reconciliation.sql` | 15 | `migration.table_recon` (48 tables), `migration.event_totals`, FK orphan scans, design counts |
| `m90_finalize_stage2a.sql` | 15 | node revisions normalised to rev = 2, ANALYZE, state flags. Does NOT drop `legacy` and does NOT set `cutover_done` |
| `verify/v10_post_load_structure.sql` | | v02 with "target tables empty" replaced by "target tables hold exactly the loaded data" (v02 itself is untouched) |
| `verify/v11_post_load_rls.sql` | | v03 re-run on the loaded data (+49 checks: PM without membership sees nothing, project/program membership exposes exactly that scope, anon, founder blocks, old ids resolve) |
| `verify/v12_reconciliation_report.sql`, `reconcile.sh` | | generate `db/RECONCILIATION.md` (old vs new vs archived vs quarantined for every table) |
| `verify/v13_fingerprint.sql`, `test-stage2a-from-scratch.sh` | | catalog + counts + content checksums; the from-scratch/idempotency proof |

Every file is ONE transaction that ends with checks; a failing check raises and rolls the whole phase back. All inserts are `ON CONFLICT DO NOTHING` / guarded, so a re-run on a loaded DB changes nothing.

## Run
```
bash db/run2a.sh                 # m10..m90, then v10 and v11   (needs stage 1 = m00..m07 applied, see above)
bash db/run2a.sh load            # only the loaders            | bash db/run2a.sh verify   # v01 + v10 + v11
bash db/run2a.sh file db/migrations/m12_load_entities.sql
bash db/reconcile.sh             # regenerate db/RECONCILIATION.md
DB_NAME=stage2a_test bash db/run2a.sh      # against another database inside the container
```
(`db/run.sh` now only runs the stage-1 files `m0*` / `v0*`; v02/v03 stay valid for the clean-slate stage-1 state and are replaced by v10/v11 on loaded data.)

## Prove from-scratch + idempotency + rollback
```
bash db/test-stage2a-from-scratch.sh   # restores pre-stage2a.dump into scratch DB stage2a_test, runs m10..m90 + v10/v11, runs the loaders a 2nd time,
                                       # diffs a 1464-line fingerprint (real DB == scratch run 1 == scratch run 2), drops the scratch DB
```
Rollback = restore `local-db/backups/pre-stage2a.dump` into a fresh database (same procedure as the baseline above, file name changed). Inside a phase, rollback is automatic (one transaction).
There is deliberately no in-place "undo" script: stage 2a only ADDS rows to `public` / `app_private` / `migration`; `legacy`, `auth` and `storage` are only read.

---
# Stage 2b - Storage (LOCAL)
Moves the 46 referenced `event-assets` objects into the new buckets (images -> WebP max 1600 px + `_t.webp` 320 px thumbnail; PDFs unchanged), downloads the 61 external image URLs, records results in `migration.asset_map` / `asset_result`, lists failures in `ASSET-REPORT.md`.
```
SHARP_DIR=<scratch dir with `npm i sharp`> bash db/scripts/run-stage2b.sh [--all]   # idempotent; needs local stack + Docker
bash db/scripts/verify-stage2b.sh                                                      # PASS/FAIL checks
```
Files: `migrations/s2b_a_asset_result.sql`, `s2b_b_apply_paths.sql`, `scripts/migrate-storage.mjs`, `run-stage2b.sh`, `verify-stage2b.sh`. Checkpoint: `local-db/backups/pre-stage2b.dump`.

- `m23_initial_program_memberships.sql` (post-2a fixup): all project_managers → members of all programs. Run after m90: `docker cp db/migrations/m23_initial_program_memberships.sql supabase_db_stack:/tmp/m23.sql && MSYS_NO_PATHCONV=1 docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/m23.sql`

---
# Stage 3 (frontend-driven) migrations: m24+ and v2x

| File | Purpose |
|---|---|
| `migrations/m24_staff_management_and_invitations.sql` | 08 §14: `profiles.profile_color`, `staff_invitations`, staff RPCs (`list_staff`, `set_staff_roles`, `set_program_memberships`, `remove_staff`, `create_staff_invitation`, `revoke_staff_invitation`, `validate_staff_invitation`, `accept_staff_invitation`), outbox relaxation for platform e-mails, `handle_new_user` staff path (never founder), program-folder storage writes |
| `verify/v24_staff_management.sql` | role-switch tests of the above (rolled back; exits non-zero on any FAIL) |
| `migrations/m25_staff_founder_exclusivity.sql` | 08 §15: a staff role and `founder` are mutually exclusive per account. Trigger `user_roles_biu_exclusive` (BEFORE INSERT/UPDATE on `user_roles`, SQLSTATE `23514`, message/hint token `staff_founder_exclusive`), helpers `app_private.holds_staff_role/holds_founder_role`, `set_staff_roles` re-checks first, `apply_staff_invitation` returns `reason = 'founder_account'` for founder accounts |
| `verify/v25_staff_founder_exclusivity.sql` | 22 checks (direct writes, RPCs, invitation paths, alumni `accept_invitation` by staff, `remove_staff`); rolled back |
| `migrations/m30_list.sql` | Lists node (01 §3.3 / 02 §3 / 04 §5.3): `update_manual_item`, `delete_list_item` (manual items and picks only; form-fed rows are hidden with `exclude_item`), `app_private.list_public_payload` (ONE whitelisted public payload: no contact/overlay/fields/status, plus `config {kind, card}`), `get_public_list(ref, after)` for the list's own page (`/view/:ref/list-tab`, link kind `view`), `get_public_tab` re-created with the list/selection branch using the same payload (additive `data.config`) |
| `verify/v30_list.sql` | 23 checks (catalog/grants, manual edit/delete rules, anon public list page incl. whitelist and visibility gate, list tab through the project host); rolled back |
| `migrations/m31_form.sql` | Form Builder node (01 §3.2 / 03 §6.2 + §9 / 04 §3.7): anon-callable `submit_public_form(ref, answers, tracking, website)` (link audience, open window, max_responses, honeypot, per-ip rate limit `app_private.form_rate_limits`, server-side validation/sanitisation by declared type in `app_private.form_check_answers` incl. phone -> E.164, one_response_per_email, PM notification rows in `email_outbox`, `sheets_append` job), `get_public_form` additive keys (description, social, allow_uploads, audience, slug, closed_reason), `save_children_form_builder` re-keys stored answers when a question key changes (semantic role assigned to a legacy question), `restore_form_response`, guarded public INSERT policy on `form-uploads` (`app_private.form_upload_allowed`), outbox scope CHECK extended for `form_new_response` |
| `migrations/m32_agenda.sql` | Dynamic Agenda node + view page (01 §3.1 / 02 §4 / 04 §3.11): `app_private.agenda_public_config` (whitelisted public config: showDayNames, header, theme.accent, footerPath; never `legacySheetUrl`), `get_public_tab` re-created with the agenda branch carrying `data.config` + `data.timezone` (additive), `list_founder_agendas(project)` (participants/PMs: the exposed agenda nodes with the public ref to open; founder "Program Agenda" buttons) |
| `verify/v32_agenda.sql` | 28 checks (catalog/grants, whitelist, anon host tabs incl. visibility gate and disabled edges, the agenda node's own page, founder exposure: PM / participant / other founder / anon, host-link fallback, private never listed); rolled back |
| `verify/v31_form.sql` | 48 checks (catalog/grants, phone normaliser, anon visibility gate, honeypot, every validation reason, sanitisation, tracking whitelist, outbox + sheets job, revision bump, rate limit, closed/full states, upload helper, list resolver before/after re-keying, soft delete + restore); rolled back |
| `migrations/m33_selection.sql` | Selection Process node + Participants page (01 §3.4 / 02 §7 / 04 §3.5, §5.4, §5.8 / 07 §1): `app_private.selection_port_statuses` + `resolve_list_rows` re-created so a chained stage reads the upstream stage's CONFIGURED accepted/rejected/holding/interview statuses (fixes `approved` vs the migrated `accepted`), `selection_scores` table (per reviewer) + `set_selection_score`, `get_selection_extras` (reviews, scores, outbox rows, participants, the interview Booking node in one call), `list_participants`/`enroll_accepted` re-created (virtual participants only from stages whose "accepted -> participants" toggle is on) + `ensure_participant`, `send_selection_emails` (templates ar/en with the unified placeholders, recipients derived server-side, tokenised booking links, outbox + email_log, idempotency, skip-sent/resend, confirm above 100, daily cap), outbox scope CHECK extended for the three selection keys without a sender |
| `verify/v33_selection.sql` | 62 checks (catalog/grants/RLS, helpers, the form -> stage 1 -> stage 2 chain incl. live membership and kept overlay, port filters, scores, participants gating + lazy rows + mark-all + revert flag, e-mails: defaults, booking link + token + lazy link, audit, skip-sent, resend round, Arabic template, confirm > 100); rolled back |
| `migrations/m34_booking.sql` | Booking node (01 §3.5/§3.6/§6.3 / 02 §3.8 / 04 §3.9, §5.6 / 07 §1.5, §2): `bookings.cancel_token_hash` + `bookings.lang`, outbox scope CHECK for the two booking e-mails without a sender, `save_children_booking` (settings saved with the node; shared Meet link must be set, C-3), `booking_default_template` / `booking_vars` (project-zone placeholders) / `booking_queue_email` (ONE idempotent outbox row + email_log per booking e-mail) / `booking_token_ok`, `render_email_template` re-created (link placeholders become anchors), `get_public_booking_page` / `create_booking` / `cancel_booking` re-created (anon-callable: invitation token, notice window, per-e-mail limit, slot lock + unique backstop, hashed cancel token returned once, `calendar_create` / `calendar_cancel` jobs + e-mails queued in the same transaction), PM RPCs `add_booking_slots` (bulk, overlaps skipped), `reschedule_booking`, `restore_booking`, `retry_calendar_job`, `get_booking_extras`, service-role `release_integration_job` |
| `verify/v34_booking.sql` | 61 checks (catalog/grants, renderer + default templates, migrated bookings untouched, slot generation incl. overlap/invalid, settings save + C-3 + connection validation, anon page + whitelist + host filter, every `create_booking` rejection, shared Meet link, hashed token, job + e-mail rows, cancel with wrong/missing/valid token, restore, reschedule + blocked slot, retry, extras, booked-slot delete refused, the interview flow with invitation token / already booked / invitee prefill, private-node gate); rolled back |
| `migrations/m35_distribution.sql` | Mentoring Distribution node (01 §3.7 / 03 §9.4 / 04 §3.10, §3.17 / decisions 01-7, 02-12): `distribution_mentor_rules.room`, the NEW `distribution_timers` table (the shared countdown as server timestamps; RLS read for PMs, NO client write grant: only `distribution_timer_control` writes), `save_children_distribution` (settings + days + day mentors + mentor rules in the ONE `save_node` transaction; locked days cannot change or be removed), PM RPCs `replace_distribution_sessions` (a generation: every row validated server-side, atomic, never touches locked days, `scope all|unlocked` keeps manual pins), `set_distribution_session_companies` (move/swap/clear, hard conflicts raise, repeated pairs return warnings, Undo = the inverse change), `set_distribution_day_lock`, `set_distribution_published` (touches only the publish columns), `distribution_timer_control` (set_round/start/resume/pause/adjust/reset/next/previous/clear), `get_distribution_payload` + `get_distribution_timer_state`; anon-callable read-only `get_distribution_view(ref, view_key)` (publish gate enforced in the DB, strict view key, legacy project-id links resolved) and `get_distribution_timer(ref)`; `get_public_tab` re-created (m32 body, distribution branch = the shared payload) and `get_agenda_view` re-created (m06d body, only the default title of a distribution node's second tab) |
| `verify/v35_distribution.sql` | 85 checks (catalog/grants/RLS of the timer table, slots-per-round formula, migrated data untouched + reachable through the payload builder, ONE save with settings/days/mentors/rules, day reorder, every generation validation (window, max, double booking, pair repeat, round, mentor/day, company), locked days (generation, config, removal), swap/move/clear + conflicts + warnings, publish gate + whitelisted public payload + legacy id, Agenda tab payload, private node, the timer: PM only, anon/founder refused, server-timestamp maths, next/previous walk) |
| `migrations/m36_library.sql` | Resource Library node (01 §3.8 / 03 §6.2, §11 / 04 §3.11): `resources.description_en/ar`, `visibility` (public|participants|hidden), `cover_path`, `category_id`; CHECKs (http(s) url only, file/cover path under the node's PROJECT folder, size <= 50 MB, text lengths); the NEW `library_categories` table (RLS forced, PM read, no client write grant, revision bump); `save_children_library` (the ONE writer, called by `save_node`: per-row validation with the `library_invalid` token, ids kept, removed resources SOFT deleted, a file must exist in the `resources` bucket under the project folder); `library_audience` / `library_res_ok` / `library_payload` (the one visibility rule + the one public payload); `get_public_tab` patched IN PLACE (the library branch calls `library_payload`); `get_public_library(ref)` (own page, link kind `view`, key `library-tab`); `list_founder_libraries(project)`; the storage SELECT policy `resources_select_visitor` on the PRIVATE `resources` bucket through `public.library_file_readable(name)` (signed URLs are minted by the Storage API after it agrees); the bucket also accepts docx/xlsx/pptx; REPAIR of m31's `form_uploads_insert_public` (it called a function whose EXECUTE was revoked, which blocked every authenticated storage insert: now a public wrapper `form_upload_allowed`) |
| `verify/v36_library.sql` | 73 checks (catalog/grants/RLS, the visibility matrix, one-revision-bump save, every refused write: javascript: url, another project's file, missing file, bad type/size/visibility, foreign category/resource ids, stale revision, direct inserts, anon / participant / non-participant / PM reads of the payload AND of the private files incl. thumbnails, soft delete + restore, founder exposure, PM / non-PM / anon storage uploads after the m31 policy repair) |
| `migrations/m37_landing.sql` | Landing Page node (01 §3.9 / 04 §3.11, §3.12 / 07 §5, §6 / decisions 01-13, 01-14, 07-13): URL whitelist + public-config whitelist + target-link helpers, `landing_public_payload`, anon `get_public_landing(ref)`, `get_public_tab` patched in place (landing branch only), anon `track_landing_event` (closed vocabulary, rate limited 120 / 10 min per node + hashed caller in the private `landing_event_limits`, no PII, also as an Agenda tab), PM `get_landing_analytics`, founder `list_founder_landings(project)`, `save_children_landing_page` re-created with validation (stable card ids kept) |
| `verify/v37_landing.sql` | 66 checks (catalog/grants/RLS, URL + config whitelists, one-save writes, card ids stable across saves with analytics kept, every refused write: `javascript:` url, another project's cover / frame, unknown platform, over-long text, 25 cards, a card id of another node, founder forbidden, anon payload for public / private / bound-to-private, agenda tab payload, analytics vocabulary / foreign card / switch / PM visit / agenda-tab edge / rate limit / bucket hash, PM aggregates, removed card keeps its history, founder exposure) |
| `migrations/m38_certificates.sql` | Certificates node (01 §3.10 / 04 §3.13, §5.7 / 07 §4 / decisions 01-11, 06-5, 07-8, 07-9): one ACTIVE certificate per participant per node (partial unique index, a revoked one can be re-issued as a NEW certificate), template path CHECK, `save_children_certificates` (validated, versioned template once referenced), `issue_certificates(node, participants[]|null)` with per-row results (attended + project completed + template of the node language), `revoke_certificate`, `get_certificates_admin`, `get_certificate_render_payload`, `list_my_certificates`, anon `get_public_certificate_verification` (rate limited, name + program + dates only), `verify_certificate` delegating to it, storage policies of the private `certificate-templates` bucket (owner / public verifier read through `cert_template_readable`, PM delete/update guarded by `cert_template_deletable`) |
| `verify/v38_certificates.sql` | 98 checks (catalog/grants, code normalisation, template save + versioning, every refused template write, issuing rules before / after completion, attended-only, idempotency, snapshot, revoke + re-issue, anon verifier valid / revoked / not found / switches / rate limit, founder own-only access, template file access matrix) |
| `migrations/m39_founder.sql` | Founder platform (design 06 §10 / 03 §5 / decisions 02-7, 02-8, 03-6): `app_private.my_participation` (the caller's participant row, best status), `app_private.link_my_participations` (a participant created from a form response is linked to the founder ACCOUNT whose VERIFIED e-mail is the response `founder_email`, once, never staff), `app_private.founder_project_dates`, `list_my_programs(include_withdrawn)` (one card per project: status, cover, names, dates, completion; withdrawn hidden, status-only), `get_founder_program_page(project)` (REPLACES the m06c stub: the header + the ORDERED list of ENABLED blocks description / agenda / mentors / companies / details / library / landing / schedule / certificate, built by calling the existing `list_founder_*` / `list_my_certificates` RPCs; withdrawn = header only; non-participant = forbidden) and `get_founder_block(project, type, node, after)` (the lazy, re-checked payloads of the agenda / people lists / My schedule) |
| `verify/v39_founder.sql` | 52 checks (catalog / grants / search_path, exactly the enabled blocks in order, every toggle removing its block, private / not-exposed nodes never leaking, empty project = no blocks, lazy payloads incl. wrong kind / other project / unpublished, non-participant / PM / withdrawn forbidden, withdrawn status-only card, company-based participation, certificate block only after completion + attended + issued + not revoked, list order, linking by verified e-mail incl. unverified / staff / other e-mail / second response) |
| `migrations/m40_withdrawn.sql` | **Withdrawn** replaces "Hide" (decision 17.1; the PM marks, nothing is automatic): `app_private.is_withdrawn(project, response, company, item flag)` = THE predicate (the participant row of the same identity is `withdrawn`, or the item flag), `list_items.withdrawn_at/_by/_reason`, the PM-only side table `participant_withdrawals` (reason + the status to reinstate to), revision bumps for every consumer, PM RPCs `set_item_withdrawn` / `withdraw_participant` (+ `set_participant_status` delegating), and 17 consumers patched IN PLACE on their current definitions: the list resolver (`include_withdrawn`, output `withdrawn` + `withdrawal`), public list payload, participants list / enrolment, detach, booking (invitation link, public page, provider slots, `create_booking`, `create_invitations`, extras), selection e-mails, distribution (PM flags, public / platform omit, RPC refusals), `my_meetings`, agenda presenters. The legacy `excluded` flag is left as it is. See `MIGRATION-LOG.md`. |
| `verify/v40_withdrawn.sql` | 107 checks (catalog / grants / RLS of the side table, the predicate, every consumer wired, a Form -> Stage 1 -> Stage 2 -> Company list -> Distribution / Agenda tab / Interview + Mentor booking chain: withdrawing one company from the Selection board, from a downstream list and from the Participants page removes it from every output, shows it to the PM with the reason, creates / removes the record row of a never-enrolled applicant, restores `attended`, expert item flag + feed, legacy hidden conversion, detach, e-mails, invitations, founder status-only page, certificates, revision bumps, role-switch denials for a founder and another PM). |
| `migrations/m41_webp.sql` | **Universal WebP, server side** (decision 17.3; the browser pipeline is `web/src/lib/image`): bucket `allowed_mime_types` = WebP + SVG on `public-assets` (SVG = logos only), WebP on `founder-assets`, `resources` / `form-uploads` lose png / jpeg / gif (their documents stay); two RESTRICTIVE policies on `storage.objects` (`webp_only_insert`, `webp_only_update`; anon + authenticated, plain operators only) refuse a raster object NAME or a recorded raster mimetype in those four buckets; `app_private.nonwebp_image_objects` (view: every raster object of any bucket), `app_private.storage_dangling_refs()` (proof query: every `*_path` column + every path-looking string of any jsonb column must resolve to a file, WebP covers to their `_t` thumbnail; empty = clean), `app_private.rewrite_storage_refs(old, new)` + a service-role-only `public.rewrite_storage_refs` wrapper (replaces a path in EVERY text / varchar / json / jsonb column of `public` in one transaction; the new object must exist). `certificate-templates` is NOT switched (its call site belongs to the Certificates builder; the statement to run is at the end of the file). Existing data is untouched (the converter does that, on request). Re-runnable. |
| `verify/v41_webp.sql` | 47 checks (rolled back): audit view, dangling-reference proof (missing file / missing thumb / jsonb path), the bucket lists, the policies (no function call, API roles cannot reach the audit objects), role-switched uploads (founder-assets, resources, anon form-uploads incl. a `.webp` NAME recorded as image/png, public-assets incl. every raster name, case-insensitive), UPDATE paths, `rewrite_storage_refs` (text + jsonb + embedded URL, service role only) and a control that WITHOUT the restrictive policy a PNG name would be accepted. The direct Storage-API check (HTTP 400 `invalid_mime_type` for PNG / JPEG / GIF, 200 for WebP) is in `web/README.md` (Universal WebP) and the log. |
| `migrations/m42_certificates_person.sql` | **Certificates per FOUNDER** (decision 17.2: person name + company name; WebP-only templates, 17.3): `certificate_grants` (the PM's per-participant authorisation, RLS forced, PM / alumni_manager read only); `certificates.user_id / grant_id / origin` + one ACTIVE row per (node, participant, ACCOUNT); `participant_name` template variable renamed `person_name` (old key kept as an alias); helpers `cert_person_name` (founders row, else profile), `cert_company_name`, `cert_is_member`, `cert_accounts`, `cert_people`, `cert_issue_person`, `cert_claim`, `cert_backfill_person`; `issue_certificates` (grant + a certificate per linked account), `claim_my_certificate`, `list_my_certificates` (claims on open), `reissue_certificate`, `revoke_participant_certificates`, `get_certificates_admin` (participants with their founders), the verifier answers person + company; `certificates_select_pm_alumni_own` and `cert_template_readable` tightened to the OWN account; the `certificate-templates` bucket is WebP only (`webp_only_cert_insert` / `webp_only_cert_update`). Re-runnable; run after m38. |
| `verify/v42_certificates_person.sql` | 120 checks (rolled back): grants / RLS / privileges, template save with the alias, two founders of one company = two certificates / codes / names, non-attended gets nothing, completion gate, not-linked / outsider / accepted-only = forbidden, claim on demand (RPC + list + Program page), revoke one vs the whole participant, Issue again, re-authorise, withdrawn, nameless account, verifier, the WebP-only bucket, the legacy backfill. `v38` and `v41` C03 were updated for m42. |
| `migrations/m43_review_fixes.sql` | **The database findings of the independent review of m40 / m41 / m42** (re-runnable; every function is patched IN PLACE on its current definition, m40 / m42 are untouched): three-valued-logic guards (`request_withdrawal`, the certificate render payload, `cert_is_member`, the re-issue guard, 12 `auth.role()` guards); a withdrawn EXPERT is withdrawn project-wide (`app_private.withdraw_item_core`, `set_item_withdrawn` re-created, BEFORE INSERT trigger `list_items_bi_inherit_withdrawn`, advisory lock per (project, expert)) and `set_items_withdrawn(uuid[], boolean, text)` = ONE atomic bulk RPC; `create_booking` trusts no client company id; `link_my_participations` links only by a genuinely verified e-mail (`app_private.auth_email_verified`: a confirmation SENT then CLICKED); column privileges (`participants` PM-internal columns not selectable, `certificates` UPDATE only on the revocation columns, template tables read-only) + `app_private.participant_notes` for the compat view; `cert_claim` participant lock; the public verifier needs an attended participant; `cert_verify_limit` trusted hop + global bucket + purge; storage extension allow-list policies `ext_allow_insert/update`; `merge_companies` withdrawn carry-over + grant guard; four audit-FK indexes |
| `verify/v43_review_fixes.sql` | 103 checks (rolled back): every review scenario (the adv1-adv4 scripts of the review) as a regression: A request_withdrawal, B certificate guards / re-issue, C verifier + claim lock, D withdrawn expert chain (booking page, `create_booking`, distribution payload, presenter, resolver, trigger on a later copy, reinstate from a copy, manual item, other project), E bulk RPC (atomic, limits, forbidden), F booking company id, G e-mail verification signatures, H participant columns, I tamper evidence, J storage allow-list, K rate limit, L merge_companies, C01-C11 catalog |
| `verify/v01..v03, v10, v11` | refreshed (not retired) in the m43 round: the stage-1 / 2a gates now accept the later builds (designed census present, extra tables / triggers / buckets allowed, the reviewed anon-executable list, restrictive storage policies not counted as grants, hermetic "migrated data" counts) and their fixtures follow m25 / m34 / m39 / m42 (see `MIGRATION-LOG.md` m43). All of v01 .. v43 pass on the local stack |
| `scripts/convert-images.mjs` + `scripts/run-convert-images.sh` | **Server-side WebP converter** (safety net for what did not come from the browser pipeline). `SHARP_DIR=<scratch dir OUTSIDE the repo with npm i sharp> bash db/scripts/run-convert-images.sh [--apply] [--buckets a,b] [--report out.json] [--verbose]`. Dry run by default (converts in memory, prints per-bucket objects / bytes before -> after / what data references); `--apply` converts ONLY objects current data references (writes `<dir>/<new uuid>.webp` + `_t.webp`, `rewrite_storage_refs`, then proves `storage_dangling_refs()` is empty); **never deletes or overwrites an original** (the owner decides later). Refuses a non-local API unless `--allow-remote`. |

Run on the local DB only:
```
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m24_staff_management_and_invitations.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v24_staff_management.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m25_staff_founder_exclusivity.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v25_staff_founder_exclusivity.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m30_list.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v30_list.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m31_form.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v31_form.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m32_agenda.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v32_agenda.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m33_selection.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v33_selection.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m34_booking.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v34_booking.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m35_distribution.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v35_distribution.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m36_library.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v36_library.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m37_landing.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v37_landing.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m38_certificates.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v38_certificates.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m39_founder.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v39_founder.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m40_withdrawn.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v40_withdrawn.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m41_webp.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v41_webp.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m42_certificates_person.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v42_certificates_person.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m43_review_fixes.sql
docker exec -i supabase_db_stack psql -U postgres -d postgres < db/verify/v43_review_fixes.sql
# the whole suite (stage-1 / 2a gates included; each prints "passed | failed" or writes migration.recon and exits non-zero on a failure):
for v in v01 v02 v03 v10 v11 v24 v25 v30 v31 v32 v33 v34 v35 v36 v37 v38 v39 v40 v41 v42 v43; do docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/verify/${v}_*.sql; done
# converter (dry run; add --apply to convert what data references; never deletes an original):
SHARP_DIR=<scratch dir with sharp> bash db/scripts/run-convert-images.sh --report <out.json>
```
Every m24+ file is idempotent and logged in `MIGRATION-LOG.md`.
