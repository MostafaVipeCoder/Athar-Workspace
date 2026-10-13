# 13 — Refactor Vision & Decisions (Project Management side)

Status: **design discussion — nothing is being implemented yet.** Implementation starts only after all design documents are finished. No change is to be made to the Supabase project (remote) without asking the owner first. Recorded 2026-10-10 from the owner. Items marked *(proposal)* are the analyst's suggestions, not decisions.

## 1. Scope
- Refactor **only the project-management part** of the platform. The Alumni platform (founder accounts side) and **Athar Network** (registry of all trainers/mentors, which programs each joined and how many times, plus mentor/expert profiles) stay as they are conceptually; only the integration points described below change.
- Tech stack: **stay on React + JavaScript on Supabase** (no TypeScript migration). Canvas library choice (e.g. React Flow vs custom) — not yet decided.

## 2. Product concept
Athar is a project-management platform for incubators/accelerators.

```
Program  ─┬─ Project ─── Canvas (empty at creation)
          │                 ├─ Sidebar: tool library ("modules"/"nodes")
          │                 ├─ Add any node, any number of times
          │                 └─ Connect nodes visually (edges)
```
- A project manager creates a **Program**, and inside it **Projects**.
- Opening a project shows a blank **canvas** (like n8n nodes / Make modules) with a **sidebar** of all tools. The PM imports only the tools needed; the same tool can be added several times (e.g. 1 selection process in one project, 3 in another; 2 agendas; several forms for outreach or data collection). Some projects have two selection stages.
- **Tools (current features that become nodes):** Dynamic Agenda · Form Builder · Lists (experts/mentors, companies, any custom list) · Selection Process · Mentor Booking (online sessions) · Mentoring Distribution (offline sessions in the training hall) · Resource Library · Landing Page (new, "Join Athar" style). Email sending lives **inside** the nodes (selection: acceptance/rejection/interview invitations; booking: online session invitations/notifications).

## 3. Connections between nodes (decisions)
| Topic | Decision |
|---|---|
| Edge semantics | Edges **display** data of the source node inside the target node; they do **not copy** data into other tables (avoid duplicated rows) — "unless duplication has a benefit the owner doesn't know of". |
| Freshness | Connected data updates **immediately** after the source is **saved** (not live per keystroke, not trigger-based like n8n). |
| Examples given | Form (companies data) → List (companies appear) → Agenda (companies shown in a separate tab next to the agenda). Form (mentors/experts) → List ("Experts"/custom name) → Agenda (own tab). Company→mentor Distribution → Agenda (extra tab so each founder can see on their phone which mentor they are with and who is next). Landing Page → Agenda (appears as another tab). Any number of lists, freely connected. |
| Output | Everything connected shows in the **Agenda view page** as tabs. |

*(proposal — needs owner input)*: pure "display-only" edges are enough for read-only views, but a List node whose rows come from a form usually also needs its own editable attributes (status, notes, assigned mentor). One way to keep the no-duplication rule is **reference + overlay**: the list stores a pointer to the source row plus only the extra fields that are specific to the list. To be decided in the data-flow design doc.

## 4. Visibility / access
- Public or platform-only is **optional per item**: each program/project link, form, landing page can be set to public link or accessible only inside the platform.
- **Founders** (= founders of startups participating in Athar programs, not Athar's own founders) have accounts on the Alumni platform and see the **founder** experience only, determined by account type.
- A founder sees a program in their "Programs" page if either (a) manually assigned to the project by the PM, or (b) they filled the program's outreach form and were **accepted through the selection process**.
- Program page for the founder: program description + an **"Program Agenda"** button that appears only when the PM turned it on for the project (shown to founders/participants); it opens the agenda view of **that project only**.
- Role assignment for `founder` (both must happen): automatically when signing up through an **invitation link** (invited founder is linked to their existing company), and automatically for **anyone who signs up on the Alumni page** (not linked to a company; creates their own). See [11](11-owner-clarifications.md) C8–C10. After the program ends, the founder can download the **attendance certificate**.
- Users can have **several roles**; roles decide what each user sees on the platform.

## 5. Emails
- Preferred: the project manager **sends emails from their own Gmail** through the platform by linking their account. If impossible, fall back to **startups@athareg.com** as sender.
- Current mechanisms (edge functions with SMTP, Apps Script poller on startups@athareg.com) are described in [08](08-backend-edge-functions-and-google-apps-script.md) and [12](12-apps-script-poller-behavior.md).

## 6. AI-built nodes (deferred)
- Super admin and project managers can create new nodes by describing them; the platform uses the Claude API to build them and add them to the tool library for all PMs. Each node can later be edited independently through chat with the model.
- Owner's answer to the key design question: nodes are **(أ) new types with their own logic and screens from scratch** (not only compositions of existing blocks).
- Cost: paid through the **API key configured in the platform**; nobody (PM/admin) pays individually.
- **Decision: postpone this step entirely.** Nothing about it is designed or built now. *(Recorded constraint:* the node architecture should not make this impossible later — e.g. a node registry with a manifest — but no AI-generated code execution is designed yet; its security model is an open topic for when the step is un-deferred.)*

## 7. Data and environment decisions
- **Existing data (events, companies, experts, etc.) must be migrated** to the new structure; nothing may be lost.
- Work first on a **local database on the owner's machine**, before touching the current Supabase project. No action on the remote project without asking.
- Implication to settle in the DB doc: the repo's migrations cannot rebuild the database (17 base tables missing, see [07](07-database-schema-rls-and-migrations.md)), so a local copy needs the live schema and data exported first (read-only on remote, to be approved explicitly).
- Fix the open RLS as part of this update ([11](11-owner-clarifications.md) C1); the Apps Script poller depends on it ([12](12-apps-script-poller-behavior.md) §6).

## 8. Landing Page node — reference design (`landing-page.html`, repo root, untracked)
A static, self-contained HTML file (≈1,700 lines, Inter font, brand blue `#1A27C9` / yellow `#FFE91E`) that defines the **view** appearance of the Landing/Join-Athar page. The existing "Join Athar" module (`JoinAtharDashboard.jsx` / `JoinAtharView.jsx`, doc [04](04-frontend-forms-selection-join.md) §5.16–5.17) is to become the **edit-mode** of this node.

Structure of the view:
1. **Sticky nav bar** with two anchor links (Opportunities, Your Picture).
2. **Hero:** headline "Help Someone Find Their Next Opportunity." + intro paragraph.
3. **Cards section** (title "Two ways to pass the opportunity on."): two cards, each with illustration (inline SVG), label, **share button**, heading, expandable text ("See More/See Less") and a primary CTA button with a notification dot: **Upcoming Program** ("Share the upcoming program") and **Wait List** ("Share the waiting list"). In the HTML the share and CTA buttons have no handler yet.
4. **"Personalize the Moment" section:** photo frame; choose a photo → auto-crop to **4:5 (1080×1350 PNG)** on canvas; actions Download / Edit / Upload different photo; crop modal with drag-to-pan, zoom slider (1–3.5), wheel and touch support. Pure client-side; the downloaded image has **no Athar overlay/frame** yet.
5. Responsive CSS, accessible attributes (aria labels, focus rings).

Observations to carry into the node-design doc (descriptive):
- The HTML has two fixed cards and fixed texts; the existing Join Athar module has a **dynamic** card list, cover image, platform share presets and analytics (`join_athar_*` tables), and a canvas/overlay concept (`canvas_background_url`, `canvas_overlay_position`) with no UI. How the editable fields of the new node map onto this static design is not yet defined.
- Static design is English-only LTR; the platform otherwise supports Arabic/English.

## 9. Open questions raised by this discussion
1. Gmail-per-PM sending: are all project managers on **@athareg.com Google Workspace**? (Affects whether the Gmail send permission needs Google's app verification or can be kept internal.) Otherwise fall back to startups@athareg.com.
2. Form → List: pure display, or reference + overlay (see §3 proposal)? What must a list item be able to store itself?
3. Landing page edit mode: which parts must be editable (hero text, number and content of cards, card images/illustrations, CTA targets, nav links, the "Personalize" section and its overlay design)? What do the two share/CTA buttons do (copy link? open share presets? link to a form?)
4. Where does the overlay (frame/branding) for the personalized photo come from, and should the result be tracked in analytics as today?
5. Local database: approve exporting the live schema and data (read-only) to build the local copy? (Requires the remote DB access details; nothing will be run without the owner's go-ahead.)
6. Do participants/founders also get access to non-agenda nodes (e.g. a booking node or a resource library) via the program page, or only the agenda?
7. Certificates: issued from which node/event (program end date? project?) and what template?

---

# Update 2026-10-11 — answers to §9 and new decisions

## 10. Answers to the open questions
| # | Question | Owner's answer |
|---|---|---|
| 1 | PMs on @athareg.com Google Workspace? | **Yes**, all on the same Google Workspace. (Makes per-PM Gmail sending feasible as an internal app; startups@athareg.com stays only as fallback. Technical design in the email doc.) |
| 2 | Form → List semantics | Not answered yet (still see §3 proposal). |
| 3 | Landing-page edit mode | **All editable:** Hero texts, number of cards and their content, and each card's cover image; the photo-section appearance too. |
| 3a | Share button | Lets a visitor share **the card's opportunity or form** with **pre-written content** ready per channel (WhatsApp, Facebook, LinkedIn, Instagram, Telegram, plus **Copy** to paste anywhere). The share text contains the opportunity/form link. (Matches the existing `join_athar_share_presets` per platform.) |
| 3b | CTA button | Takes the visitor to a **pre-configured link set in edit mode** (a form link, a Facebook page, anything, depending on the case). |
| 4 | Overlay source for the personalized photo | Owner delegated the choice ("choose what's suitable"). *(proposal)* The overlay/frame is a **setting of the Landing node**: the PM uploads a transparent PNG frame (optionally several to pick from) stored in the platform's storage; the visitor's cropped photo is composited with it on the client canvas at export. |
| 5 (DB) | Local database | Owner only wants to **import the data currently in Supabase into a local database** (PostgreSQL or similar, stored on the owner's machine) and use it until the refactor is finished; decide what to do afterwards. |
| 5 (Founders) | What founders see in a program | See §11. |
| 6 | Certificates | See §12. |

## 11. Founder-facing Program page (decided)
For a program the founder participates in, the program page shows — **only what the PM has added/enabled** (nothing appears automatically; e.g. no agenda built yet → no agenda; no attendance list → no list):
- Program **description** and a **cover** (the same cover as the project's agenda).
- The program **Agenda** (that project only).
- The **mentors** who will be present and the **companies** attending with them.
- For offline events: **location** (with map location), **number of offline attendance days**, whether **transportation is provided or everyone comes on their own**. These are entered by the PM in a new area called **Project Details** in the PM interfaces.
- The **Resource Library**.
- Rule across all of it: a block is visible to founders only when the PM has added it (and turned it on, where a toggle exists).

## 12. Certificates (decided)
- A dedicated **Certificates node**: the PM uploads the **certificate template**; the template contains **variables** (e.g. participant name).
- Appears on the founder's program page **after the program ends**. "Ended" is when the PM **closes the program / marks it "completed"** in the **program settings**.
- New **Program Settings page** (holds the program description, the completed status, etc.). Programs are listed on the **Programs page**.

## 13. Local database (analyst note and options)
Facts found in this environment (no remote action taken): **Docker 29.8.1** and the **Supabase CLI** are installed on this machine; `psql`/`pg_dump` are not installed. Live data volume is small (tens to a few hundred rows per table — see [07a](07a-database-table-reference.md); `events` ≈16 rows, `experts` ≈65, `master_experts` ≈42).

*(proposal)* Run the **local Supabase stack** (Docker) instead of bare PostgreSQL: the app uses supabase-js with Auth, Storage and Realtime, so the same code runs unchanged against `localhost`. Data to bring over: public-schema tables and data, plus (if wanted) auth users and the Storage bucket `event-assets` files. Ways to read the remote data, each needing the owner's explicit go-ahead before anything runs: (a) `supabase db dump` using the DB password supplied by the owner; (b) read-only SELECT through the Supabase connection already available in this session, generating the local load script. Nothing has been exported yet.

## 14. Still open
1. Form → List: pure display or reference + overlay (§3)?
2. Local DB: approve which method (§13 a/b), and whether auth users (with password hashes) and Storage files should come along or only public-schema data?
3. Share/CTA content per card: what are the "pre-written texts" per platform and where does the PM write them (one text per platform per card, with `{link}` placeholder as in today's presets)?
4. Project Details: exact field list (location + map link, offline days count, transportation, anything else such as venue notes/dates)?
5. Which founders count as "participants" for a program (manually assigned + accepted via selection) — is a status needed (accepted / attended / withdrawn) for the certificate?

---

# Update 2026-10-11 (2) — answers to §14

| # | Question | Owner's answer |
|---|---|---|
| 1 | Local DB export method | **(b)**: read-only SELECTs through the Supabase connection in the session, generating the local load scripts. Also bring **auth users (with password hashes)** and the **bucket files**. |
| 2 | Form → List | **Reference to the source row + extra list-specific fields** (status, notes, assigned mentor, …). |
| 3 | Share texts | **Yes**: the PM writes a text per platform per card, with a `{link}` placeholder (as in today's presets). |
| 4 | Project Details fields | Location, map link, number of offline attendance days, transportation — these are the required fields (nothing else). |
| 5 | Participant status | **Yes**: a participant status is needed (accepted / attended / withdrawn). Certificate eligibility (attended only vs all accepted) was not answered. |

## Remote inventory (read-only counts taken 2026-10-11, project nipunwrewluxaikyfbzg)
auth.users 12 · auth.identities 12 · Storage bucket `event-assets` (public): 112 objects, ≈70 MB. Nothing downloaded or exported yet.

## Still open
- Certificate eligibility: attended only, or every accepted participant?
- Approval of the file download and the local export location (see chat) before running the export.

## Update 2026-10-11 (3)
- **Certificate eligibility: attended participants only** (participant status = *attended*). Accepted-but-not-attended and withdrawn participants do not get a certificate.
- Local export approved and started: method (b), including auth users with password hashes and bucket files, saved under the git-ignored `local-db/` (added to `.gitignore`). Docker Desktop must be running for the later import step.

## Update 2026-10-11 (4) — local database ready
Local Supabase (Docker) is running from `local-db/stack/` and loaded from the read-only export. Verified: 48 public tables, 2,366 rows (matches live), 12 auth users/identities (with password hashes), 132 policies, 14 functions, 14 triggers, bucket `event-assets` with 112 object rows and 94 files uploaded (the 18 files missing on live stay metadata-only). The app is **not** pointed at it yet (`src/lib/supabase.js` hard-codes the live project). Nothing was written to the live project at any point. Note: the local stack binds to all network interfaces with default dev keys and holds real data — keep it on a trusted network or stop it when not in use.
