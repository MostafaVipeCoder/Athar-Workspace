# Design 08 — Decisions Log (technical decisions made under the owner's delegation)

Recorded 2026-10-11. The owner delegated the answers to the open design questions ("answer them in the best technical way") with two goals: **(G1) no data duplication anywhere** and **(G2) a fast, light platform**. Each decision below chooses the option that best serves G1/G2 and security. They are marked **[Decided-by-delegation]**: the owner can overturn any of them. Items that depend on facts or actions only the owner can provide are in §4 ("Needs the owner").

## 1. Performance and lightness principles (apply to every design doc)
| # | Principle | Serves |
|---|---|---|
| P1 | Single source of truth per fact; connected data is read by reference (query descriptors), never copied; overlay rows only hold list-specific extras. | G1 |
| P2 | No persistent sockets for visitors/founders: refresh on focus/tab switch plus a light visibility-gated check; Realtime only for PMs editing (one revision channel per open project). | G2 |
| P3 | Each node type is a **lazy-loaded chunk**; the canvas library loads only on the canvas route; public/founder pages ship none of the editor code. | G2 |
| P4 | Queries select only needed columns, paginate lists, and use server-side filters; one batched fetch per view (no N+1); explicit indexes on every FK and filter column. | G2 |
| P5 | RLS written for speed: helper functions `STABLE`, `(select auth.uid())` initplan form, membership lookups indexed, no per-row subqueries on large tables. | G2 |
| P6 | Images: resize/compress on upload, serve a thumbnail and a full version, lazy-load below the fold; the current bucket (≈70 MB for 112 files) shows the need. | G2 |
| P7 | Stale-while-revalidate client cache keyed by node `revision`; invalidate by revision bump, not by clearing everything (replaces the current monkey-patched cache clear). | G1/G2 |
| P8 | Heavy work (emails, calendar, certificate issuing, sheet append) server-side and queued; the browser only requests and displays status. | G2/security |

## 2. UX principles to apply in the frontend design (06) — from the owner's product description
- Zero-to-first-value: a new project opens an **empty canvas with the tool sidebar**; adding the first node and connecting it must be possible in a few clicks, with inline hints rather than manuals.
- Progressive disclosure: node cards show a **summary**; configuration opens in a side inspector; advanced options folded.
- Visible system state: every node shows saved / unsaved / has-errors; connected views show "updated just now" after a save.
- Mobile-first for founders and for the agenda/"who do I meet next" view; desktop-first for PM canvas; full Arabic RTL and English LTR with one component set.
- Forgiving: undo for destructive canvas actions, confirmations only for irreversible ones (replace native `alert/confirm/prompt` used today), empty/loading/error states designed for every list.
- Accessibility baseline (WCAG AA contrast, keyboard operability, focus rings, tap targets) checked per component.
(A UX-design plugin/skill was offered to the owner in chat for use during the frontend phase; if enabled it will be used to review the screens.)

## 3. Decisions
### 3.1 Node catalogue (design 01)
| # | Question | Decision | Why |
|---|---|---|---|
| 01-1 | Booking node shape | **One `booking` node, two presets (Mentor Booking / Interview Booking).** | ~90% duplication today (docs/05); one code path (G1/G2). |
| 01-2 | Program vs Agenda cover | **Project cover = Agenda cover; Program cover is an optional fallback and the Programs-list thumbnail.** | One image reused, no duplicate uploads (G1). |
| 01-3 | View page without an Agenda node | **Every project has an implicit view-page host; the Agenda node is one tab.** | Tabs from edges need a host without forcing an empty agenda. |
| 01-4 | Two selection stages | **Two Selection nodes chained by an edge.** | Independent templates/emails; reuses one node type. |
| 01-5 | `offlineDays` cross-check | **Ignore in v1.** | Typed number as the owner defined it. |
| 01-6 | Who enters `attended` | **PM marks per participant, with bulk "mark all accepted as attended" then unmark absentees.** | Attendance is not collected elsewhere. |
| 01-7 | Distribution rules | **Per-day gap only; total round = slots + gaps; Generate never overwrites locked days; unique-pairing scope per node; warn (later) when a mentor is in both Booking and Distribution.** | Removes the contradictions found in docs/05. |
| 01-8 | Google Sheets append | **Keep as optional export, server-side only (no browser key).** | Security; G2. |
| 01-9 | Agenda import | **Keep Excel import only.** | The Sheet-import UI paths are dead today. |
| 01-10 | Cross-project Companies page | **Yes, minimal read-only registry (like Athar Network for experts), as a view over `companies`.** | Reuse, no copy. |
| 01-11 | Completion scope & certificates | **Completion is per project; Program Settings lists projects with a "complete all" shortcut; certificates are issued on an explicit "Issue certificates" action after completion, only for `attended`.** | Participants belong to projects; explicit issuing avoids accidental issuance. |
| 01-12 | New emails in v1 | **Only booking confirmation/cancellation and the three selection emails (acceptance, rejection, interview); others off by default.** | Smaller surface; send volume. |
| 01-13 | Landing `{link}` target | **Per-card `share.targetLink`, defaulting to the card's CTA URL.** | Matches the owner's description. |
| 01-14 | Landing frames | **A list of frames; picker shown only when more than one.** | Flexible without extra UI. |
| 01-15 | Interview booking security | **Tokenised booking link sent in the invitation (per company), not an open per-member link.** | Prevents unrelated or double bookings. |
| 01-16 | Legacy statuses | **Map `displayed → accepted`, keep a migration flag; nothing is lost.** | Owner: no data loss. |

### 3.2 Data flow (design 02)
| # | Question | Decision | Why |
|---|---|---|---|
| 02-1 | List membership | **Virtual membership + lazy overlay rows (`ensure_item` when the PM first edits or something points at the item).** | No triggers, no copies (G1). |
| 02-2 | Editing source fields in a list | **Read-only with a link to the source; optional per-list display-only override for chosen fields; explicit "detach to manual".** | Keeps one truth (G1). |
| 02-3 | Source deleted | **Soft-delete sources; item shows "source removed" (cached label); PM can exclude or "keep as manual".** | No silent data loss. |
| 02-4 | Duplicates across sources | **None in v1** (per-list `dedupe_by` later if needed). | Complexity vs real need. |
| 02-5 | Refresh | **Per-node `revision` counter bumped in the save transaction; PMs: Realtime on the revision table only; founders/phones: refetch on focus/tab switch plus a visibility-gated check (no persistent socket).** | P2. |
| 02-6 | Server drafts | **None in v1 (client-side draft only).** | Lighter; saves are explicit. |
| 02-7 | Participants | **Derived from selection + lazy rows (created when the PM sets a status or assigns manually); unique per company per project; `withdrawn` hidden from the founder's Programs list but visible to the PM; an `attended` participant is kept and flagged if selection is reverted.** | G1; certificates need a durable row. |
| 02-8 | Applicant ↔ company/founder | **Link by email/ID/PM pick; no automatic "promote to company" copy.** | G1. |
| 02-9 | "My meetings" on public link | **Requires login for founders; optional per-company private link/QR for sharing.** | Prevents seeing others' schedules. |
| 02-10 | Alumni snapshot keys | **Deferred to the Alumni design (mechanism independent).** | Not part of this refactor scope. |
| 02-11 | Cross-event company dedup | **Keep per-event references at migration; canonical company registry as a later cleanup.** | Safe migration. |
| 02-12 | Distribution/Booking without Agenda | **`schedule` port optional; fall back to the node's own day config.** | Keeps standalone use. |
| 02-13 | Cycles | **Forbidden (DAG), checked per port family, not on the union graph.** | Needed because Agenda→Distribution (`schedule`) and Distribution→Agenda (`view`) both exist. |
| 02-14 | Public vs platform per tab | **Per-edge `audience`.** | Matches "optional per item". |

### 3.3 Roles and RLS (design 03)
| # | Question | Decision | Why |
|---|---|---|---|
| 03-1 | Meaning of "platform only" | **Participants of that project + staff.** | With open founder signup, "any logged-in user" would be effectively public. |
| 03-2 | PM visibility | **PMs see only programs/projects they belong to; super_admin sees all.** | Projects hold founder PII. |
| 03-3 | M&E team role | **Keep as `alumni_manager` for now; `roles`-table design allows `me_team` later.** | Simplicity. |
| 03-5 | Signup abuse control | **CAPTCHA + mandatory email confirmation first; edge-function signup if abuse appears.** | Cheapest effective control. |
| 03-6 | Founder withdrawal | **Founder may request, PM confirms; `withdrawn` sees the card with status only.** | |
| 03-8 | Linking existing `founders` rows to new accounts | **Only via invitation or manual admin link.** | Consistent with decided C10. |
| 03-9 | Legacy public links | **Keep working (`token = event_id`), rotate per item on request.** | No broken links. |
| 03-10 | Poller | **Integration-user bridge until the new Gmail/Calendar sync ships, then retire.** | Matches design 07. |
| 03-12 | alumni_manager and participants | **Read-only access to project participants (needed by analytics).** | |
| 03-13 | Co-founders | **All founders linked to the company are participants unless the PM assigns a single user.** | |

### 3.4 Emails, integrations, certificates (design 07)
| # | Question | Decision | Why |
|---|---|---|---|
| 07-3 | Sender identity | **Acting PM, automatic fallback to `startups@athareg.com`.** | Matches owner's preference. |
| 07-5 | Greeting rule | **Keep the name parser; `first_name` = first logical unit, `founder_name` = full display name.** | Keeps Arabic/compound handling. |
| 07-6 | Meet links | **Created at booking time; shared mode for PMs who want one fixed link; no pre-generation per slot.** | Fewer Google calls, no orphan events (G2). |
| 07-7 | Sheets identity | **Dedicated Sheets-only service account (server-side).** | Least privilege. |
| 07-8 | Certificate language | **Per-template language (one template per language); the name is taken as stored.** | Simple, correct Arabic rendering. |
| 07-9 | Revocation | **Manual with a warning when status/program changes.** | Avoids surprise revocations. |
| 07-10 | Timezone | **One IANA timezone per project, default `Africa/Cairo`, editable. This adds one field to Project Details (the owner listed only four) — flagged in §4.** | Booking and agenda need an explicit zone. |
| 07-12 | Send limits | **Per-PM cap 1,500/day (below Google's 2,000) and a confirm dialog above 100 recipients.** | Protects the Workspace account. |
| 07-13 | Facebook/LinkedIn share | **Accept "copy text, then paste" for these two.** | Platform limitation. |

## 4. Needs the owner (facts or actions only the owner can provide)
1. **Rotate/revoke the leaked Google service-account key now** (Google Cloud action by the owner; purge the exposing file from git history afterwards). Recommended before anything else.
2. **Workspace/Cloud admin access:** can an admin create the Internal GCP project and OAuth client for per-PM Gmail/Calendar? Who administers `startups@athareg.com`? (Without admin: only the `startups@` route is available.)
3. **Review the 12 current accounts** (all `super_admin` today) and decide who is demoted to `project_manager`/`alumni_manager` before the new RLS goes live.
4. **`national_id`:** is it needed at all in company submissions? (Default: remove it, or encrypt it.)
5. **Apps Script:** retirement date; any Google Form/Sheet automation besides the poller living in that project; the Executions page output and any `failed` booking rows.
6. **Project Details timezone field:** approve adding it (see 07-10).
7. **Public base URL/share rewrite on athareg.com** (who controls it).
8. **Alumni snapshot key set** (`revenue_sar` vs `revenue`) when the Alumni side is designed.
9. **Realtime private channels** depend on the local/live Realtime version — to be checked before relying on them.

## 5. What is still being written
`06-frontend-architecture.md` (in progress), then `04-database-design.md` and `05-migration-plan.md`, which will apply the decisions above.

## 6. Frontend architecture decisions (design 06, added after it was written)
| # | Question | Decision | Why |
|---|---|---|---|
| 06-1 | Canvas library | **React Flow (`@xyflow/react`), lazy-loaded only on the canvas route.** | Handles pan/zoom/touch/handles/mini-map out of the box; cost paid only by PMs on that route (P3). |
| 06-2 | Router mode | **`BrowserRouter` (clean URLs) with an Apache SPA fallback and a hash-link shim for old shared links.** Requires `mod_rewrite`/`.htaccess` allowed on the host — owner to confirm (§4). | Needed for social previews and clean links. |
| 06-3 | Server-state library | **TanStack Query.** | Cache keyed by node `revision` (P7), dedup, stale-while-revalidate; replaces the monkey-patched cache. |
| 06-4 | i18n | **Small custom provider using `Intl`, not i18next.** | Lighter bundle (G2). |
| 06-5 | Certificate rendering | **Client-side canvas rendering on demand (per design 07), not server-side PDF.** Design 06 leaned to server PDF; 07 found common PDF libraries cannot shape Arabic. Keep 07 unless a server renderer with proper Arabic shaping is chosen later. | Correct Arabic output; no server load (G2). |
| 06-6 | Founder program page key | **Per project** (a Program page lists its projects the founder participates in). | Participants belong to projects. |
| 06-7 | Route scheme | **One URL per thing, scoped by `projectId`** (`/projects/:id`, `/projects/:id/nodes/:nodeId/{edit,settings}`, `/forms/:ref`, `/agenda/:ref/:tab?`). Old URLs redirect via a legacy table. | Removes `/event` vs `/events` duplication. |
| 06-8 | Guards | **One `RequireAccess` guard (area + permission map; area switcher for multi-role users)** replacing RoleGuard/AlumniRouteGuard/ProtectedRoute. | One rule set. |
| 06-9 | Getting the build to Apache | **Pending owner (§4):** SFTP/rsync from CI, cPanel git deploy, or manual upload. | Hosting access is the owner's. |

Added to "Needs the owner" (§4): hosting capabilities (`mod_rewrite`, `.htaccess` overrides, how files are uploaded) and the base path (`/` vs `/EventsOperations/`).

## 7. Database design decisions (design 04, added after it was written)
| # | Question | Decision | Why |
|---|---|---|---|
| 04-1 | Companies | **Canonical `companies` (not project-scoped), with `merge_companies` for the ≈16 probable duplicates, run only after the owner confirms each merge.** | G1. |
| 04-2 | Athar team interviewers | **`network_experts.kind = 'team'`.** | One expert registry. |
| 04-3 | Projects without a program (3) | **A "Legacy" program receives them.** | Nothing lost, hierarchy complete. |
| 04-4 | Public links | **Slugs only plus a `legacy_ref` column so old `event_id` URLs keep working** (public items are public by design; no secret token). | Simpler, lighter. |
| 04-5 | `national_id` | **Not carried into the new schema; the legacy values are kept in a restricted `legacy` archive (no client access) until the owner decides to delete them.** | No data loss and no exposure. |
| 04-6 | 432 `mentoring_sessions` rows with empty `event_id` | **Quarantine in the `legacy` archive; do not load into the new tables.** | They cannot be attached to a project. |
| 04-7 | PostgreSQL version | **Live is PostgreSQL 17.6 (from the export), so `UNIQUE NULLS NOT DISTINCT` and `security_invoker` views are available.** | Confirmed from `local-db/export/schema/01-extensions.sql`. |
| 04-8 | Old primary keys | **Preserved during migration** (old ids become the new ids where types allow). | Traceability, simple rollback, old links. |
Deviations recorded by 04 and accepted: slugs + `legacy_ref` instead of secret tokens (vs 03); `bioOverride`/`photoOverride` dropped (copies of source data); calendar sync state in `integration_jobs` (vs on `bookings` in 07); `participants` (vs `project_participants` in 02); `programs.status` dropped because completion is derived.

## 8. Owner decisions on the migration plan (2026-10-11, design 05)
| # | Topic | Owner's decision | How it applies |
|---|---|---|---|
| 05-a | Project timezone field | **Approved.** One IANA timezone per project (default `Africa/Cairo`), added to Project Details. | Closes §4 item 6; field `projects.timezone` as in design 04. |
| 05-b | `national_id` | **Archive it.** | Kept only in the restricted `legacy` archive (the 365 answer rows with their 5 headers and the submission column); not carried into the new schema; no one-time export/destroy now. |
| 05-c | 98 external images (Google Drive etc.) | **Move them into Storage.** | The migration downloads each external image, stores it in the target bucket (with variants per design 04) and rewrites the reference; any image that cannot be downloaded (private/deleted Drive file) is listed for the owner, not silently dropped. |
| 05-d | Duplicate companies | **Duplicates may be removed, but each must remain present in every program/project it is in today.** | `merge_companies` keeps one canonical company and repoints every program/project reference (list items, participations, founders, snapshots) to it, so the company still appears in all its programs; the duplicate rows go to the `legacy` archive. Applies to the 16 exact duplicates. The 4 probable duplicates still need the owner's confirmation by name. |

## 9. Account roles (owner, 2026-10-11) — resolves §4 item 3
All current accounts become **`project_manager`**, except the account **Abdullah Shaban** (abdullah.shaban@athareg.com), which stays **`super_admin`**. Today all 12 accounts hold `super_admin` (local copy of live). Applied in the migration's role phase (design 05) as: `super_admin` removed from the 11 accounts, `project_manager` assigned; `super_admin` kept for the one account. Not applied to any database yet.

## 10. Company merges (owner, 2026-10-11) — resolves design 05 OD-2
- **Approved:** merge the **16 exact duplicates** (see 05 §4.5) and the **4 probable duplicates**: To7fa / تحفة, Otaku / أوتاكو, Cocorra / كوكورا, Moni Cake / موني كيك. Total 20 merges.
- Rule (per §8, 05-d): one canonical company is kept; every program/project reference of the dropped duplicate is repointed to it, so each company remains present in every program it is in today; same-program pairs (To7fa, Otaku) collapse into one list item; the dropped rows go to the `legacy` archive. The description differs in two exact pairs (Boutique Nona, Natural and Healthy): the more recent row is kept as canonical and the other's text is preserved in the archive (owner did not object to this default).
- Display name of the 4 probable pairs: the owner did not specify a preferred form; default = the bilingual form "English (العربي)" of the first-listed copy (e.g. `Moni Cake (موني كيك)`, `To7fa (تحفة)`, `Otaku (أوتاكو)`, `Cocorra (كوكورا)`), with the Arabic name also stored in the `name_ar` column. Changeable by the PM later.
- Execution: during the future migration (after cut-over per 05), through `merge_companies(keep, drop)`; nothing has been merged in any database now.

## 11. Scope and environment answers (owner, 2026-10-11)
- **Hosting:** no hosting work now; everything is tried on the **local** stack first (closes the hosting items of §4: `mod_rewrite`, base path, deploy method — postponed until after local verification).
- **Cut-over date:** not needed now; postponed until the new system has been verified locally.
- **Admins:** the organization has a Google Workspace/Cloud admin, and the owner administers `startups@athareg.com` (closes §4 item 2).
- **Leaked service-account key:** the owner asked for it to be revoked. It must be done in Google Cloud Console by an account with access (not possible from this environment). Service account `meet-generator@athar-meet-generator.iam.gserviceaccount.com`, project `athar-meet-generator`, key id starting `db3444ca`. The same key is stored in two `google_settings` rows (one global, one for one event). Effects when revoked: Meet generation by the `process-booking` / `generate-google-meet` edge functions and the browser Sheets append stop working; the Apps Script poller (runs as `startups@athareg.com`) is not affected and keeps creating events for bookings without a Meet link.
- **Odd agenda slot (open):** event "Upper Egypt AI Hackathon", day 2026-09-10, slot "Mentoring and Teamwork" has `start 13:30`, `end 04:30`; the next slot starts at 16:30. Proposed correction: end = **16:30** (awaiting the owner's confirmation).

## 12. Leaked service-account key — resolved (owner, 2026-10-11)
The owner **deleted the service account** `meet-generator@athar-meet-generator.iam.gserviceaccount.com` (project `athar-meet-generator`) in Google Cloud Console, which removes all its keys including the exposed one (id prefix `db3444ca`). The service account had the **Owner** role on the project, so the exposure had been project-wide until now.
Consequences / follow-ups:
- Live edge functions `process-booking` and `generate-google-meet` and the browser Sheets append can no longer authenticate with Google; the Apps Script poller (running as `startups@athareg.com`) is unaffected and is the only Meet/Calendar path until the new `calendar-sync` (design 07) exists.
- The two `google_settings` rows still hold the dead key text; they are removed/nulled by the migration (design 05) — they are harmless now but must not be copied.
- The key text still exists in the git history (file `مشكلة روابط جوجل ميت لا تعمل.md`) and in the local export; harmless once the account is deleted, but the file should not be published; the history purge is optional.
- Not verified from here: whether a live booking still gets its Meet link via the poller (owner to test one booking); whether anything else in project `athar-meet-generator` (API keys, billing, other resources) needs review.

## 13. Agenda slot correction (owner, 2026-10-11) — resolves 05 OD-7
Approved: the slot "Mentoring and Teamwork" (event "Upper Egypt AI Hackathon", day 2026-09-10, order 6) changes its end time from `04:30` to **`16:30`**. Applied in the migration as a recorded fixup (`migration.fixups`, old value kept in the log) when agenda slots are loaded; the source row in `legacy` stays unchanged. The live database is not touched.

## 14. Memberships, staff management and staff invitations (owner, 2026-10-12)
- **Initial memberships:** all current `project_manager` accounts become members of **all 4 programs** (program-level membership grants their projects, per design 03). Applied as a migration fixup on the local DB; recorded in `migration.fixups`.
- **Staff management by super_admin (new feature, v1):** a super_admin can view staff, **change their roles**, **remove** them, and **invite a new staff member by e-mail**.
- **Staff invitation flow:** the invitee opens the e-mailed link → creates the account entering only **name + password** and choosing a **profile colour** (the e-mail comes from the invitation; roles/memberships come from the invitation, not from user input). This is distinct from the founder invitation (design 03 §4.4): a staff invitation must NOT grant `founder`; it grants the roles/memberships the super_admin chose.
- **React Flow attribution:** keep the default attribution during the test phase; revisit before production.
- Open-signup rule unchanged: self-signup on the Alumni page gives `founder` only; staff accounts are created only through staff invitations.

## 15. Staff vs founder exclusivity (owner, 2026-10-12)
A staff member (super_admin / project_manager / alumni_manager) must **never** hold the `founder` role. Consequences: staff invitations never grant founder (already enforced); granting a staff role to an account that has `founder`, or `founder` to a staff account, is rejected (DB constraint/RPC check); `remove_staff` leaves the account with no roles (it had no founder role to keep); migrated data: no account holds both today. Invitation expiry stays 14 days (default accepted).

## 16. Visual identity for the platform (owner, 2026-10-12)
- Source: the design system extracted from www.athareg.com (web/design-system/, 8 pages, 2026-10-12) — typography (Hepta Slab headings, Manrope body, Questrial secondary), radii (15px cards / 6–8px buttons / 7px inputs), shadows, motion (hover scale), Font Awesome 5 icons, logo, layout.
- **Palette decision:** the platform uses **Athar Blue `#1a27c9` as primary and Yellow `#ffe91e` as the accent/CTA colour** (as in `landing-page.html`), with **black as a secondary touch only** (headings/footers/overlays where it fits) — not the site's black-dominant scheme. Everything else (greys, surfaces, text, forms, error red) follows the site tokens.
- Arabic typeface: the site has no Arabic; Tajawal stays until the owner names an official Arabic font.
- Application order: after the Form Builder node completes, apply tokens to web/ foundations (index.css, tailwind config, fonts, logo) → ui kit → shells/nav → existing pages/nodes (Programs, Project/canvas, Staff, Lists); every later node is built on the new tokens.
