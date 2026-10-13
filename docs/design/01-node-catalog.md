# Design 01 — Node Catalogue v1 (DRAFT for owner review)

Status: **design only — nothing is implemented.** Labels used throughout: **[Decided]** = owner decision (`docs/11`, `docs/13`); **[As-is]** = found in code/DB (file:line refs point to the as-is docs 02–08 or the source they cite); **[Proposal]** = analyst recommendation (reason and alternatives given). Terms follow `00-conceptual-model.md` (cited as "00 §n"). Row counts quoted below were taken read-only from the local database copy (no personal data).

Contents: 1 Conventions · 2 Cross-node rules · 3 Node types (3.1–3.10) · 4 Project Details panel · 5 Program Settings page · 6 Booking: one node or two? · 7 Distribution vs Booking · 8 Matrix node × ports · 9 Routes/components replaced · 10 Consolidated "must not carry" list · 11 Open Decisions · 12 Notes on 00-conceptual-model

---

## 1. Conventions

### 1.1 Port notation (typed per 00 §5)

| Port type | Meaning (00 §5) | Notes added here |
|---|---|---|
| `rows:<entity>` | references to rows of one entity kind: `form-response`, `company`, `expert`, `participant`, `booking`, `resource` … | a port may declare `entity: '*'` (accepts any `rows:*`) |
| `rows:list-items` | items of a List node (reference + overlay) | the only list-shaped port |
| `view` | a renderable tab contributed to the Agenda view page | carries `{ key, title, component, visibility }` |
| `schedule` | time slots / days | carries day dates, slot windows, timezone |
| `participants` | participant records `{founder, company?, status, source}` | status ∈ accepted / attended / withdrawn **[Decided]** |
| `link` **[Proposal – gap in 00 §5]** | a public URL descriptor `{ url, label, kind }` of something a node publishes (a form, a booking page, the agenda) | needed so Landing Page CTA/share can point at "a form" without copying it; see §12 |

Direction: edges go from an **output port** to an **input port** of a compatible type. Cardinality is written `0..1`, `1`, `0..n`.

### 1.2 Common config block (every node) **[Proposal]**

```jsonc
{
  "node_id": "uuid", "type": "form_builder", "version": 1,
  "title": { "en": "Outreach form", "ar": "..." },      // PM-editable instance name
  "visibility": {
    "access": "private | platform | public",            // private = PM/admin only; platform = logged-in; public = anonymous link  [Decided: per item]
    "showToParticipants": false,                         // appears on the founder Program page (00 §6)
    "agendaTab": { "enabled": true, "order": 0 }         // only for nodes that contribute a view
  }
}
```
**[Decided]** Nothing appears to founders by default (00 §6, `docs/13` §11): `showToParticipants` defaults to `false` for every node.

### 1.3 Participant-facing blocks vs founder exposure
"Founder-facing exposure" below always means: what the founder (account type `founder`, 00 §6) can see on the Program page or reach by link, and under which toggle.

---

## 2. Cross-node rules

1. **Display, not copy** **[Decided]**: a node reads upstream data through input ports; it never writes upstream rows into its own tables. Exceptions that *are* owned data: list overlays (§3.3), selection stage/decisions (§3.4), bookings, sessions.
2. **Refresh after explicit Save of the source** **[Decided]** (not per keystroke, not trigger-based).
3. **Dangling references**: a missing source row shows as "source removed" (00 §5); data model in design 02/04.
4. **Per-instance everything**: every config below is per node instance; two nodes of the same type never share config, except through an edge.
5. **Public-vs-platform** is chosen per item (node view, form link, landing page) **[Decided]**.
6. **Emails** live inside nodes, sent preferably from the PM's own Gmail, fallback `startups@athareg.com` **[Decided]**; transport is designed in 07. Placeholder vocabulary is unified in §2.1.
7. **No AI-generated nodes** **[Decided]**; the manifest (00 §4) just must not prevent it.
8. **Migration**: every current table listed below must be mapped with nothing lost **[Decided]**; mapping details belong to design 05, this document only states which node absorbs which table.

### 2.1 Email placeholder vocabulary **[Proposal]**
Today's server substitutes only `company_name, founder_name, first_name` in subjects and `+project_manager_name, booking_link` in bodies, while the UI promises other sets (`docs/08` §7.1–7.2) and `first_name` equals the whole display name (`docs/08` §4.5). Proposed single set, same syntax `{{key}}`, same set for subject and body, HTML-escaped values, unknown token = save-time validation error:

| Key | Meaning | Available in |
|---|---|---|
| `{{founder_name}}`, `{{first_name}}` | full name / real first token of the name | all participant emails |
| `{{company_name}}` | company | all |
| `{{program_name}}`, `{{project_name}}` | from Program Settings / project | all |
| `{{project_manager_name}}` | the sending PM's real name (today the constant "Athar Team", `docs/08` §4.5) | all |
| `{{booking_link}}` | link to the booking page of the connected Booking node | interview invitation |
| `{{provider_name}}`, `{{start_time}}`, `{{end_time}}`, `{{timezone}}`, `{{meet_link}}`, `{{booker_email}}` | booking facts | booking emails |
| `{{certificate_link}}` | founder's certificate | certificate email (optional, see §3.10) |

---

## 3. Node types

Template per node: **Purpose · Exists today · Edit-mode config · Ports · Views · Multiple instances · Visibility · Emails · Founder exposure · Move/Stay/Drop · Must-not-carry bugs**.

---

### 3.1 Dynamic Agenda (`agenda`)

**Purpose [Decided/Proposal]**: the time-table of a project (days → slots) *and* the host of the **Agenda view page**: the public/founder page that renders the agenda plus every tab contributed by connected nodes (00 §2, `docs/13` §3).

**Exists today [As-is]**
- Components: `EventBuilder` (2132 lines, route `/event(s)/:id/agenda`, `docs/03` §4.3), `AgendaViewer` (`/agenda/:eventId`, §4.16), `EventVisualManager` (§4.5, unreachable), `PublicLayout` (tab bar).
- Lib/api: `getEventDays`, `getAgendaSlots`, `createDay/updateDay/deleteDay`, `deleteSlot`, `updateSlotsOrder`, `importAgendaData`, `getFullAgenda`, `getAgendaTabs` (`lib/api.js:263-296`), `uploadImage`; `lib/excel.js` (`parseAgendaExcel`, `fetchAndParseGoogleSheet`).
- Tables: `event_days` (37 rows), `agenda_slots` (248), and on `events`: `header_image_url`, `header_settings` (jsonb), `header_height`, `show_day_names`, `background_image_url`, `footer_image_url`, `gsheets_url`, `seo_*` (`docs/03` §4.3–4.5; `docs/07a`).
- Public tab set is **computed from data** (agenda always; experts/companies/library/join-athar if non-empty) and passed in the URL as `tabs=` (`docs/03` §2.3, §5.2).

**Edit-mode config [Proposal]**
```jsonc
{
  "days": [ { "day_id": "uuid", "date": "2026-11-03", "name": {"en":"Day 1","ar":"اليوم الأول"}, "order": 0,
              "slots": [ { "slot_id": "uuid", "start": "09:00", "end": "09:45",
                           "title": {"en":"","ar":""}, "presenter": {"en":"","ar":""},
                           "bullets": {"en":[],"ar":[]}, "show_presenter": true, "order": 0 } ] } ],
  "showDayNames": true,
  "header": {                                         // today's events.header_* + header_settings
    "cover": { "type": "image|color", "imageUrl": "", "color": "#1A27C9", "height": "16rem", "dim": 0.3 },
    "overlayTitle": {"text":{"en":"","ar":""}, "color":"#fff"}, "brandName": "", "font": "inter|...",
    "backgroundImageUrl": "", "footerImageUrl": ""
  },
  "importers": { "excelEnabled": true, "googleSheetUrl": "" },   // optional; only if the owner keeps them (Open Decision 9)
  "tabOrder": ["agenda","<tab-key>", "..."], "defaultLang": "ar",
  "seo": { "title":"", "description":"", "imageUrl":"" }
}
```
The **agenda cover** is the project's cover that the founder Program page reuses **[Decided]** (`docs/13` §11, 00 §6). Time zone is a project-level property (default Africa/Cairo, as in `process-booking`, `docs/05` §5.1) passed on `schedule` ports.

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `tabs` | `view` | 0..n | every connected node's tab; ordering and per-tab visibility configured in the Agenda node (not in the contributor) |
| out | `schedule` | `schedule` | 1 | days with dates and slot windows; consumed by Booking and Distribution (day dates) |
| out | `view` | `view` | 1 | the Agenda tab itself (day tabs + slots) |
| out | `link` | `link` | 1 | public URL of the agenda view page (consumed by Landing Page, emails) |

**Views contributed**: "Agenda" (the page itself). It is the **only** node that owns a view *page*; all others contribute *tabs* to it.

**Multiple instances [Decided: "2 agendas"]**: allowed (`docs/13` §2). Each Agenda node is its own view page with its own link; a contributor connected to two Agenda nodes appears as a tab in both. The founder Program page shows a **"Program Agenda" button per enabled Agenda node** (button label = node title). *Open Decision 3* covers whether a project may have an Agenda view page with zero Agenda nodes.

**Visibility**: `private | platform | public` + `showToParticipants`. Default `platform`, button hidden from founders until enabled **[Decided]** (`docs/13` §4).

**Emails**: none.

**Founder exposure**: "Program Agenda" button on the Program page, opening only this project's agenda view page **[Decided]**.

**Move / Stay / Drop**
- Stay: day/slot editing, EN/AR fields, drag-reorder, shift ±1h, duplicate day, header and background/footer visuals, print layout, day tabs only when more than one day, 30 s auto-refresh of the public view (or realtime later; design 06).
- Move: the computed tab set (`getAgendaTabs`) becomes the **edges**; the `tabs=` URL parameter and the `?agenda=` → `#/agenda/` rewrite (`App.jsx:99-116`) disappear in favour of one canonical link.
- Move: the three visual editors (`EventBuilder` Visual tab, "Agenda Cover" card, `EventVisualManager`) collapse into the single `header` block above.
- Drop (dead): `handleImportExcel/handleGoogleSheetSync` UI paths unless Open Decision 9 keeps them; `experts` fetch in `AgendaViewer`; the unread `event_header_settings_<id>` localStorage key; the unused `translations.AgendaViewer` keys.

**Must not carry** (`docs/03` §7): staged-save model bypassed by drag-reorder (§7.1 #7); "Event Branding Name" input that is never saved (#8); `headerSettings` write-only and overwriting the shared `header_settings` JSON (#9) — in the node, `header` is its own config object and other nodes never write into it (today `ExpertManager` writes `customExpertsLabel` into the same JSON); string comparison of `HH:MM:SS` vs `HH:MM` (#6); un-transactional multi-call save; slug-from-name links that break on rename (`docs/03` §5.2).

---

### 3.2 Form Builder (`form_builder`)

**Purpose**: define one public/platform form (questions, sections, branding, thank-you, share) and collect its responses. It is the **only** intake mechanism; the legacy company/expert registration portals disappear into it.

**Exists today [As-is]** (`docs/04`)
- Components: `FormEditor` + `forms/*` (`QuestionsBuilder`, `FormSettingsTab`, `FormIntegrationsTab`, `SourceTrackingToolbar`, `FormResponsesTab`, `FormAnalyticsTab`, `FormClicksAnalyticsTab`, `GlobalFormsAnalytics`, `CoverLibraryModal`, `ImportFromLibraryModal`, `SaveToLibraryModal`, `ChipsOptionInput`, `PhoneValidationConfig`), `FormLibraryManager` (second admin shell, Arabic), `GenericFormPortal` + `DynamicFormBuilder` (public renderer), legacy `CompanyPortal`/`ExpertPortal`, `lib/phoneValidation.js`, `lib/googleSheets.js`.
- Lib/api: `getEventForms…`, `getFormConfigById/saveFormConfigById`, `getFormSections/saveFormSections`, `submitToForm`, `getFormResponses`, `trackFormShareEvent`, library functions (`lib/api.js:1499-2025, 2482-3022`).
- Tables: `event_forms` (7 rows), `form_field_configs` (56), `form_responses` (**0 rows** locally), `form_covers` (3), `form_share_events`, `library_forms` (1); legacy `company_submissions` (384) / `expert_submissions` (0) (see 3.4).

**Edit-mode config [Proposal]**
```jsonc
{
  "name": {"en":"","ar":""}, "description": "", "isActive": true,
  "sections": [ { "id": "sec_...", "title": {"en":"","ar":""}, "description": {"en":"","ar":""}, "order": 0 } ],
  "questions": [ { "id": "q_...", "key": "company_name",            // stable key, not custom_<timestamp>
                   "type": "text|textarea|email|tel|number|url|select|multiselect|file|hidden",
                   "label": {"en":"","ar":""}, "description": {"en":"","ar":""}, "placeholder": {"en":"","ar":""},
                   "required": false, "sectionId": "sec_...", "order": 0,
                   "options": [ { "value":"", "label":{"en":"","ar":""}, "isOther": false } ],
                   "validation": { "minLength":null,"maxLength":null,"min":null,"max":null,"pattern":null,
                                   "customError":{"en":"","ar":""}, "allowedCountries":["EG","SA","AE"] },
                   "semantic": "company_name|founder_name|founder_email|phone|logo|null" } ],   // semantic role used by downstream lists/selection
  "cover": { "coverId": "uuid", "imageUrl": "" },
  "thankYou": { "message": {"en":"","ar":""}, "imageUrl": "", "showImage": false },
  "share": { "title":"", "description":"", "imageUrl":"", "channels": { "facebook":true,"whatsapp":true,"linkedin":true,"telegram":true,"instagram":true,
             "custom":[ {"key":"newsletter","label":"Email Newsletter","active":true} ] } },
  "access": { "opensAt": null, "closesAt": null, "maxResponses": null, "oneResponsePerEmail": false },
  "export": { "googleSheetUrl": "" }                                   // optional; see Open Decision 8
}
```
`semantic` is the proposed replacement for today's name-guessing heuristics (substring matching on sheet headers, `docs/04` §5.15, A-19) and for the three diverging company field vocabularies (`docs/03` §7.4). **Integrations toggles (`selection_process`, `companies_list`, `mentors_list`, `attendees_list`, `alumni_annual_update`) are removed**: an integration is now an **edge** to a Selection or List node **[Decided]** (display, no copy-on-submit).

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| out | `responses` | `rows:form-response` | 1 (fan-out to many targets) | schema of the form travels with the port (question keys + semantic roles) so List/Selection can map columns |
| out | `link` | `link` | 1 | public form URL incl. source-tracking variants |
| out | `view` | `view` | 0..1 | optional "Apply now" tab embedding the form on the Agenda view page (`visibility.agendaTab.enabled=false` by default) |
| in | — | — | — | none |

**Views contributed**: optional "Apply" tab. **Admin tabs** (not Agenda tabs): Questions, Settings, Responses, Analytics, Sources/Clicks, plus project-level analytics.

**Multiple instances [Decided]**: several forms per project (outreach, data collection, mentors, companies). Each is independent. The Central **Form Library** (`library_forms`) stays as a template store *outside* the canvas: "import template into this node" / "save this node as template"; import with history is **dropped as a data copy** (see below).

**Visibility**: `access: public | platform | private` for the form link **[Decided]**; "platform" requires login. `showToParticipants` is not relevant (forms are not shown on the Program page). `isActive` and `opensAt/closesAt` are enforced **server-side** (today client-side only, `docs/04` S-6).

**Emails**: none sent by the node itself (a confirmation-to-respondent email is *not* in today's code; optional new feature, Open Decision 12).

**Founder exposure**: none on the Program page. A founder may open the form link if `access` allows (e.g. an alumni annual update form requires `platform`).

**Move / Stay / Drop**
- Stay: question types, sections as wizard steps, "Other" option, phone validation per country, cover library, thank-you page, share buttons per platform, source tracking (`?source=`), responses table/search/filters/detail/delete, per-question analytics, CSV export, central library as templates.
- Move: legacy engine (`CompanyPortal`, `ExpertPortal`, `getFormConfig(eventId,'company'|'expert')`, `expert_submissions`, `StartupManager/ExpertManager` form-config editors and "Card Settings") → superseded by Form Builder + Lists; `form_field_configs.show_in_card` moves to the List node's card config (3.3).
- Move: sections to **one** store (today three: `integrations.form_sections`, relational `form_sections`, unread `event_forms.sections`, `docs/04` §6.3).
- Drop: `library_forms.import with_history` row copying (duplicates responses, `docs/04` A-26); `target_module` vocabulary (`selection_process/company/expert/companies_list/mentors_list/attendees_list/alumni_annual_update`, A-8c); `FormLibraryManager`'s separate question editor (A-1); unused `updateFormCover`, `deleteFormSection`.

**Must not carry** (`docs/04` §9): `submitToForm` returning success when the insert failed (A-17); public anonymous reads of the whole `event_forms` row incl. integrations and Sheet URL (S-3) and public read/write/delete on `form_responses` (S-2); service-account key read and used in the browser (S-1); fire-and-forget copies into other tables with different phone formats (A-18); DELETE-then-INSERT of questions with no transaction (A-28); `phone` type that renders nothing (A-11); thank-you tokens `{email}`/`{phone}` offered but not replaced and unescaped RegExp from labels (A-14); sanitisation by *field-name substring* (`tel` matches `hotel`, A-9); `/forms/:formId` URL with no event (A-17); four URL shapes for one form (`docs/04` §2); CSV with unescaped quotes (A-29); `share_description/share_image_url` stored but unused (A-37) — either consumed by an OG function or dropped; `integrations` JSON being overwritten from stale state (A-16).

---

### 3.3 Lists (`list`)

**Purpose [Decided]**: a named collection of people/organisations — "Experts", "Mentors", "Companies", or any custom name — whose items are a **reference to a source row plus list-specific extra fields** (status, notes, assigned mentor …) (`docs/13` §14 answer 2, 00 §5). A list can also hold manual items.

**Exists today [As-is]** (`docs/03`)
- Components: `ListsManager` (tab wrapper), `ExpertManager` (1317 lines, "Mentors Hub"), `StartupManager` (1243, "Company Grid"), `MasterExpertsList` (global network), `ExpertCard`/`CompanyCard`, `ExpertViewer`/`StartupViewer`, `CompaniesPage`.
- Lib/api: `getExperts/createExpert/updateExpert/deleteExpert/bulkUpdateExperts`, `getCompanies/createCompany/…/bulkUpdateCompanies`, `getMasterExperts/updateMasterExpert/deleteMasterExpert`, `getSubmissions/approveSubmission/rejectSubmission` (`lib/api.js:225-304, 523-723, 1279-1392`).
- Tables: `experts` (65 rows, event-scoped denormalised copies of `master_experts`, 42 rows, via `experts.master_id`), `companies` (161, event-scoped, **no master table**), `form_field_configs.show_in_card`, `events.header_settings.customExpertsLabel` (list title), `events.experts_color/startups_color`.
- Experts today are copies kept in sync by `updateMasterExpert` (overwrites every linked row, `docs/03` §4.10); that behaviour is the **Athar Network** (registry of trainers) which stays conceptually (00 §1, `docs/13` §1).

**Edit-mode config [Proposal]**
```jsonc
{
  "name": {"en":"Experts","ar":"الخبراء"},
  "entityKind": "expert | company | custom",          // decides default columns and the Athar Network import
  "columns": [ { "key":"name", "label":{"en":"","ar":""}, "source":"ref|overlay", "ref":"name", "showInCard":true, "inTable":true, "required":false } ],
  "overlayFields": [ { "key":"status", "type":"select", "options":["pending","confirmed"] },
                     { "key":"notes", "type":"textarea" },
                     { "key":"assigned_mentor", "type":"ref:expert" } ],
  "card": { "style": "grid", "accent": "#1A27C9", "showFields": ["photo","name","title"], "expandable": true },
  "sort": { "mode": "manual|name", "order": ["itemId"] },
  "manualAdd": true,
  "networkImport": { "enabled": true },                // import from Athar Network master list (experts)
  "titleOverride": {"en":"","ar":""}, "hideTitleOnSingle": true
}
```
**Item model**: `{ id, list_node_id, source_ref: {kind, table, row_id} | null, overlay: {…} }` (00 §5). Manual items have no `source_ref`. For `entityKind=expert` a manual add/import creates/links an **Athar Network** record (as today's `createExpert` → `master_experts`) and the item points at it.

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `items-in` | `rows:form-response` \| `rows:company` \| `rows:expert` \| `rows:participant` | 0..n | e.g. Form → List; Selection (`accepted`) → List; Athar Network is an implicit source (import dialog), not an edge |
| out | `items` | `rows:list-items` | 1 (fan-out) | consumed by Distribution (mentors, companies), Booking (providers), Agenda (via `view`) |
| out | `view` | `view` | 1 | the list as a tab (e.g. "Experts", "Companies") |

Column mapping from an incoming form response uses the form's `semantic` roles (3.2), so no name-guessing.

**Views contributed**: one tab per list node, title = list name; `showInCard` flags drive public cards. Admin sub-views: Items, Settings (columns, card). The "Review Desk" (approve/reject of pending submissions) is **dropped**: approval is the **Selection** node (3.4), and list membership is an edge.

**Multiple instances [Decided]**: any number of lists, freely connected (`docs/13` §3). Same source row may appear in several lists with different overlays.

**Visibility**: `private | platform | public` for the tab; `showToParticipants` controls the founder Program page blocks **"mentors present"** and **"companies attending"** **[Decided]** (`docs/13` §11). A list marked as company list shows the attending companies; as expert list the mentors.

**Emails**: none.

**Founder exposure**: only the card fields the PM enabled; a founder sees other companies' cards only if `showToParticipants` is on.

**Move / Stay / Drop**
- Stay: card grids, search, drag-reorder (persisted), EN/AR fields, import from Athar Network with duplicate guard, master-sync of expert edits (as an explicit "update network profile" action, not a hidden side effect), card field visibility (now one mechanism).
- Move: `experts`/`companies` per-event rows → reference + overlay; `MasterExpertsList` stays as the Athar Network page (outside the canvas); `CompaniesPage` (all companies across events, unreachable today) becomes a company registry/network page if the owner wants it (Open Decision 10).
- Drop: three overlapping card-visibility sources (`form_field_configs.show_in_card`, per-row `display_config`, hard-coded `show_name`, `docs/03` §7.3) → one `columns[].showInCard`; dead list-card variants; `Dashboard`-style "Mentors" naming mismatch with the `mentors` table (see §6, §7).

**Must not carry** (`docs/03`): per-expert `display_config` that is never persisted (§7.1 #4); three company field vocabularies (§7.4); `getCompanies` ordering by `name` while the UI saves `sort_order` (§7.3); company review desk querying `pending` while submissions are `screening` (§7.1 #3); drag-reorder inside a filtered subset using unfiltered indexes (§7.3); `isFieldRequired` for six hard-coded names (§7.5); non-null `title_ar.includes` crash pattern (`LibraryManager`, §7.5); duplicated `expert_id`/`id` primary-key naming (§7.3); approve spreading arbitrary `additional_data` keys into `companies` columns (§7.4); `duplicateEvent` carrying original PKs (§7.1 #5).

---

### 3.4 Selection Process (`selection`)

**Purpose**: review applicants through stages (screening → interview → approved → holding / rejected), send decision emails, and **produce participants** (00 §7). Multi-stage projects use **several Selection nodes** (e.g. "Selection 1", "Selection 2"), each feeding the next.

**Exists today [As-is]** (`docs/04` §5.15, §6.5–6.6)
- Component: `SelectionProcessManager` (1697 lines, route `/event(s)/:id/selection`), embeds `AtherTeamBookingAdmin` and `RichTextEditor`.
- Lib/api: `getSubmissions`, `updateSubmissionStatus`, `syncSubmissionsFromSheet`, `extractDynamicSheetFields`, `extractPrimaryEmail` (`lib/api.js:2028-2318`); edge functions `send-interview-invitations`, `send-rejection-emails`, `send-acceptance-emails` (`docs/08` §4.5).
- Tables: `company_submissions` (384 rows; `status`, `additional_data`, `email_send_count`, …), `email_audit_log` (0 rows), `events.interview_/rejection_/acceptance_{admin_emails,cc_emails,email_template_subject,email_template_body}`, `events.selection_process_gsheets_url`, `events.meeting_link_mode`, `events.shared_google_meet_link`.
- Stages are fixed: `screening, interview, approved (+displayed), holding, rejected`; "Display publicly" (`displayed`) is read by nothing (`docs/04` A-38).

**Edit-mode config [Proposal]**
```jsonc
{
  "stages": [ { "key":"screening","label":{"en":"Screening","ar":""},"type":"inbox" },
              { "key":"interview","label":{"en":"Interview","ar":""},"type":"stage",
                "requireNote": true, "email": "interview" },
              { "key":"accepted","label":{"en":"Accepted","ar":""},"type":"accept","email":"acceptance" },
              { "key":"holding","label":{"en":"Holding","ar":""},"type":"hold" },
              { "key":"rejected","label":{"en":"Rejected","ar":""},"type":"reject","email":"rejection" } ],
  "transitions": "free",                                   // or an explicit allowed-moves matrix
  "sheetImport": { "enabled": false, "url": "", "tabName": null, "matchOn": ["national_id","email","phone"] },
  "participantRule": { "onAccept": "create_participant", "status": "accepted" },   // [Decided: accepted via Selection => participant]
  "emailTemplates": { "interview": {...}, "acceptance": {...}, "rejection": {...} },   // see Emails
  "interviewBooking": { "linkedBookingNodeId": null }
}
```
The default stage set reproduces today's board; the PM may add/remove intermediate stages (needed for "two selection stages" in one project, `docs/13` §2 — modelled either as two nodes or as extra stages: *Open Decision 4*).

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `applications` | `rows:form-response` | 1..n | one or several Form nodes; plus optional `rows:participant` from an earlier Selection node (stage 2 takes stage-1 accepted) |
| out | `stage:<key>` | `rows:form-response` (+ decision overlay) | 1 per stage | e.g. `stage:interview` → Booking(interview) as eligible bookers; `stage:accepted` → List |
| out | `participants` | `participants` | 1 | emitted on acceptance with `source: "selection"`, `status: "accepted"` **[Decided]** (00 §7) |
| out | `view` | `view` | 0..1 | optional read-only "Accepted companies" tab (off by default; the List node is the normal way) |

Stage membership, notes, decision reasons and e-mail history are the node's **own overlay** (`selection_item`: `{ source_ref, stage, history[], notes, email_log[] }`), replacing the dual-purpose `additional_data` bag (`docs/04` §4.10).

**Views**: none required on the Agenda page; admin UI = board with stage tabs, detail modal (with question **labels**, not keys), settings. 

**Multiple instances [Decided]**: yes, any number; each has its own stages/templates/ownership of decisions. A response may sit in several Selection nodes (each has its own overlay).

**Visibility**: admin-only (`private`). Never public. Participant visibility is a consequence (participant record → founder sees the program, 00 §6).

**Emails (triggers and reconciliation with `docs/08`)**

| Email | Trigger today [As-is] | Proposed trigger | Recipients | Template placeholders |
|---|---|---|---|---|
| Interview invitation | manual per row / bulk "all in stage" button → `send-interview-invitations` | PM action on one/selected/all-unsent items in the `interview` stage | founder email (from `semantic: founder_email`); admin + CC lists | `founder_name, first_name, company_name, project_manager_name, program_name, booking_link` (link = **public booking page of the connected interview Booking node**, fixing the admin-route link, `docs/04` A-31/`docs/05` CON-13) |
| Acceptance | same, stages `approved`/`displayed` → `send-acceptance-emails` | PM action in `accepted` stage | founder | `founder_name, first_name, company_name, project_manager_name, program_name` |
| Rejection | same, stage `rejected` → `send-rejection-emails` | PM action in `rejected` stage | founder | same as acceptance |
| (Holding) | none | none in v1 (Open Decision 12) | — | — |

Reconciliation: the three functions are 90% identical (`docs/08` §8); one parameterised sender replaces them. Per-send log (`email_audit_log`) is surfaced in the UI (today never read). Bulk send must **skip already-sent** items unless the PM chooses "resend" (today it re-sends everyone every time, `docs/04` A-30). Admin addresses become BCC/CC as today, but the sender is the PM's Gmail (07).

**Founder exposure**: none directly; being accepted creates a participant so the founder sees the program (00 §6 case (b)); stage names and notes are never shown.

**Move / Stay / Drop**
- Stay: Kanban stages, reason modal, tech-status note on interview, hold-with-origin-stage and "move back", rich-text templates, bulk send in batches, per-item send status.
- Move: Google-Sheet inbound sync (browser downloads a public sheet) → optional **importer** inside the node, executed server-side (design 07); the "Ather Team Booking" tab embedded in Settings → the connected Booking node (§6).
- Drop: `displayed` status ("Display Publicly", dead, A-38); `company_submissions` as the working table (migrated into `selection_item`); heuristic name/e-mail extraction (three copies, A-8).

**Must not carry** (`docs/04` §9): selection fed by a copy-on-submit flag that is off by default (A-15); `additional_data` mixing sheet row, answers and reviewer notes, and sheet re-sync overwriting reviewer data (A-20); `reviewed_at` set to NULL on every non-approved/rejected status (A-32); `reviewed_by/rejection_reason` columns never written (reasons go into `additional_data`, `docs/04` §10 Q14); slug in `eventId` breaking submissions/edge functions (A-23); edge functions that do not verify the submissions belong to the event, accept any caller, CORS `*` (S-7); `email_send_count` read-modify-write races; subject placeholders not substituted (A-31); constant "Athar Team" as PM name; sequential N round-trip sheet sync (§6.6); raw `custom_*` keys in the detail modal (A-19).

---

### 3.5 Mentor Booking (preset of the `booking` node, mode `mentor`) — see §6

**Purpose**: startups self-book online sessions (Google Meet) with a mentor from a connected list.

**Exists today [As-is]** (`docs/05` §2)
- Components: `MentorBookingAdmin` (1378 lines; tabs mentors/slots/bookings/settings), `MentorDetails` (386), `MentorBookingPage` (public `#/book/:mentorId`, 292); lib `mentorBooking.js` (571, of which ~240 lines are an unused day-config engine); `notifyGoogleAppsScript` (`lib/api.js:7-26`) → edge function `process-booking`; `generate-google-meet`.
- Tables: `mentors` (4 rows; own copy of mentor name/email/bio/photo, `master_id` text, `advance_notice_minutes`), `mentor_slots` (10), `bookings` (2), `mentor_day_config` (unused), `booking_notifications`; `events.mentor_admin_emails/mentor_cc_emails/mentor_email_template_*`.

The full node definition (config, ports, emails) is in **§6.3**, because the two booking presets share one node type.

---

### 3.6 Ather Team Booking / Interviews (preset of the `booking` node, mode `interview`) — see §6

**Exists today [As-is]** (`docs/05` §3)
- Components: `AtherTeamBookingAdmin` (965, standalone route and embedded in Selection settings), `AtherTeamBookingPage` (public `#/ather-team-book/:memberId`, 289); lib `atherTeamBooking.js` (300).
- Tables: `ather_team_members` (3), `ather_team_slots` (54), `ather_team_bookings` (29); `events.interview_admin_emails/interview_cc_emails`.
- Entry point only via Selection settings; no EventDashboard card (`docs/05` §7).

---

### 3.7 Mentoring Distribution (`distribution`)

**Purpose**: generate and publish the fixed timetable of offline 1-1 sessions in the training hall (mentor × slot × day → company), with matrix and live TV views and a shared countdown timer. Relation to Booking: §7.

**Exists today [As-is]** (`docs/05` §4)
- Components: `MentoringDistributionAdmin` (2305), `MentoringMatrixView` (544, public), `MentoringLiveView` (774, public TV), hook `useMentoringTimer` (222), lib `mentoringDistribution.js` (1037).
- Tables: `mentoring_distribution_config` (2 rows), `mentoring_distribution_day_config` (3), `mentoring_sessions` (1148); reads `experts` (+`master_experts`), `companies`, `event_days` directly.
- Three generators (one unused, two with different capabilities); validation `validateDistribution`; manual move/swap; finalize days; publish; Realtime broadcast timer.

**Edit-mode config [Proposal]**
```jsonc
{
  "slot": { "durationMin": 20, "gapMin": 5 },
  "days": [ { "day_ref": "agenda-day-id | index", "date": "2026-11-03", "startTime": "10:00", "totalRoundMin": 300,
              "slotDurationMin": null, "gapMin": null, "mentorIds": [], "finalized": false } ],
  "uniquePairing": true,
  "mentorAvailability": { "<mentorItemId>": { "days": [0,1], "maxSlots": null, "from": null, "to": null } },
  "breaks": [ { "afterSlot": 3, "durationMin": 15 } ],   // one break model only (today two exist; Open Decision 7)
  "generator": { "seed": null, "mode": "all|unfinalized" },
  "timer": { "alertSeconds": 7, "controlRoles": ["pm"] },
  "published": false
}
```
Dates come from the connected `schedule` port when present (otherwise entered manually); time zone from the project.

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `mentors` | `rows:list-items` (entity expert) | 1 | a List node |
| in | `companies` | `rows:list-items` (entity company) | 1 | a List node (typically the accepted companies) |
| in | `schedule` | `schedule` | 0..1 | Agenda's days/times |
| out | `view-matrix` | `view` | 1 | "Distribution" tab: day matrix; also gives each founder "which mentor am I with and who is next" on their phone **[Decided]** (`docs/13` §3) |
| out | `view-live` | `view` | 0..1 | TV live screen as a tab or standalone link |
| out | `sessions` | `rows:booking`-like `rows:session` | 1 | optional, for founder "my sessions" |

**Views contributed**: "Distribution" (matrix) and "Live" (current slot + countdown). The public viewers become tabs/links of the Agenda view page.

**Multiple instances**: allowed (e.g. one per day-block or per track); each owns its sessions. No cross-instance pairing memory unless the PM picks a shared `uniquePairingScope` (Open Decision 7).

**Visibility**: `private | platform | public` per view; `published` gate is **enforced server-side** (today UI-only, `docs/05` CON-17). `showToParticipants` controls the founder phone view.

**Emails**: none today (`docs/05` §5.4 table: Distribution has none). Optional "your schedule" email is a new feature, not in v1 (Open Decision 12).

**Founder exposure**: a founder sees their own sessions (and the next one) and the matrix if `showToParticipants` is on.

**Move / Stay / Drop**
- Stay: per-day config, per-mentor availability, unique pairing, manual move/swap with validation, finalize/lock days, publish, matrix, live TV, shared timer with sound.
- Move: mentor and company sources from raw `experts`/`companies` tables → input ports; timer control surface → authenticated PM only (viewers are read-only).
- Drop: dead generator `generateDistribution` and `calculateSlotTime/getCurrentSlotIndex/getSecondsUntilSlotEnd`; unused `timer_state`; `genResultByDay`; second "global break" model if the owner chooses one (CON-5); `mentor_day_config`.

**Must not carry** (`docs/05` §9): `publishDistribution` upsert resetting other config columns (BUG-1); `validateSessionMove` called with wrong signature so never validates (BUG-2); sessions saved without ids so edits are not persisted (BUG-3); preset buttons shadowing variable (BUG-4); full "Generate" wiping finalized days (CON-7) and ignoring per-mentor windows that "Regenerate" honours (CON-6); `slots_per_day` ignoring gaps (CON-9); "End time override" having no effect (CON-8); remove-mentor deleting from the event-wide experts list (BUG-14); unsaved per-day edits ignored by Generate (BUG-13); `Math.random()-0.5` unseeded shuffle and greedy order bias; UTC "today" vs local slot clock (CON-10); unauthenticated timer broadcast and `FOR ALL USING (true)` on `mentoring_*` tables (SEC-5); matrix view not joining `master_experts` (CON-16); Arabic literals mixed into English live screen (INC-1); `event_id` UUID vs TEXT (CON-15).

---

### 3.8 Resource Library (`library`)

**Purpose**: curated resources (documents, audio, video, links) for participants of this project; optionally merged with a central pool.

**Exists today [As-is]** (`docs/03` §4.17–4.18)
- Components: `LibraryManager` (580, routes `/library` central and `/event(s)/:id/library`), `LibraryViewer` (242, public `/view/:id/library`).
- Lib/api: `getLibraryResources`, `getLibraryData`, `create/update/deleteLibraryResource`, `uploadImage` (`lib/api.js:871-915`).
- Table `library_resources` (26 rows; `resource_id, event_id, title_en, title_ar, resource_type readable|audible|visual|link, url, is_central, sort_order`); storage `event-assets/library/…`.

**Edit-mode config [Proposal]**
```jsonc
{
  "resources": [ { "id":"uuid", "title":{"en":"","ar":""}, "type":"readable|audible|visual|link",
                   "url":"", "file": {"path":"", "mime":"", "size":0}, "centralRef": null, "order": 0 } ],
  "includeCentralPool": { "enabled": true, "pick": "all | selected", "selectedIds": [] },
  "groupBy": "type", "searchEnabled": true
}
```
Central pool (`is_central=true`) stays a platform-wide library managed on its own admin page (like the Form Library); a node either **references** selected central resources (no copy) or adds its own.

**Ports**: out `view` (1) — the "Library" tab; out `rows:resource` (0..1) for a future Landing/Program-page block. No inputs.

**Views contributed**: "Resource Library" tab (grouped by type, search).

**Multiple instances**: allowed (e.g. one per track); each is its own tab/section.

**Visibility**: `private | platform | public` + `showToParticipants` → founder Program page shows the Resource Library block only when enabled **[Decided]** (`docs/13` §11).

**Emails**: none.

**Founder exposure**: the Resource Library section of the Program page (if enabled).

**Move / Stay / Drop**: Stay all CRUD, grouping, search, central pool; Move uploads to a path convention shared by all nodes (today ad-hoc folders, `docs/03` P18); Drop optimistic-delete oddities if unneeded.
**Must not carry** (`docs/03` §4.17, §7.5): `title_ar.includes` crash on NULL; Global Pool edit sending whole DB row incl. `resource_id/created_at` in the update; central-row delete affecting all events with only a confirm text.

---

### 3.9 Landing Page (`landing_page`)

**Purpose [Decided]**: a public "share the opportunity" page. Edit-mode evolves from today's Join Athar (`JoinAtharDashboard`); view-mode follows `landing-page.html` (repo root; `docs/13` §8). **All parts are PM-editable** **[Decided]** (`docs/13` §10 Q3): hero texts, number and content of cards, each card's cover image, and the photo-section appearance.

**Exists today [As-is]** (`docs/04` §5.16–5.17, §4.11)
- Components: `JoinAtharDashboard` (661; tabs builder/share/analytics), `JoinAtharView` (410; public `#/view/:id/join-athar`, share modal + image maker with 1080×1080 canvas); API `getJoinAtharPage`, `saveJoinAtharPage`, `trackJoinAtharEvent`, `getJoinAtharAnalytics` (`lib/api.js:3028-3191`).
- Tables: `join_athar_pages` (1 row; `project_id` TEXT UNIQUE, `main_title`, `cover_url`, `layout_columns`, `canvas_background_url`, `canvas_overlay_position` — latter two have no UI), `join_athar_cards` (4; `image_url,title,description,button_text,button_url,order_index`), `join_athar_share_presets` (0; `platform`, `preset_message`), `join_athar_analytics` (26; `tab_view|card_share|image_upload|image_download`, `card_id`, `platform`).

**Mapping `landing-page.html` → editable config.** The HTML is a single-language (EN, LTR) static page; each row names the section, what is hard-coded there today, and the config field that makes it editable:

| HTML section (line) | Hard-coded today | Config field(s) |
|---|---|---|
| Sticky nav (1187-1192): 2 anchor links "Opportunities", "Your Picture" | two fixed labels/anchors | `nav.enabled`, `nav.links[] = {label{en,ar}, target: "section:<id>" \| external url}` — default links generated from enabled sections |
| Hero (1197-1202): `h1` + paragraph | "Help Someone Find Their Next Opportunity." + intro | `hero.title{en,ar}`, `hero.body{en,ar}`, optional `hero.backgroundImage`, `hero.cta` (optional) |
| Cards section intro (1211-1214): `h2` + paragraph | "Two ways to pass the opportunity on." + text | `cardsSection.title{en,ar}`, `cardsSection.body{en,ar}` |
| Card article (1219-1273, 1276-1346): illustration (inline SVG), label chip, share button, `h3`, clamped text with See More/See Less, primary CTA with notification dot | 2 fixed cards: "Upcoming Program", "Wait List" with fixed SVGs | **`cards[]` (N ≥ 0)** each `{ id, coverImageUrl (uploaded; replaces SVG), chipLabel{en,ar}, title{en,ar}, body{en,ar}, seeMore: {enabled, clampLines}, cta: {label{en,ar}, url, notificationDot: bool}, share: {enabled, targetLink, presets{platform → text with {link}}} }` |
| Card share button (1244, 1312; no handler in HTML) | none | `cards[].share`: opens a sheet with one button per platform (WhatsApp, Facebook, LinkedIn, Instagram, Telegram) + **Copy**; text per platform comes from `presets`, `{link}` replaced by `share.targetLink` (the opportunity/form link, `link` port or typed URL) **[Decided]** `docs/13` §10 Q3a |
| Card CTA button (1266, 1335; no handler) | none | `cards[].cta.url`: pre-configured link (form, Facebook page, anything) **[Decided]** `docs/13` §10 Q3b |
| Personalize section (1350-1415): title, text, patterned panel, photo frame, Choose Photo / Download / Edit / Upload Different Photo | fixed texts; no frame/overlay | `personalize.enabled`, `personalize.title{en,ar}`, `personalize.body{en,ar}`, `personalize.panelPattern` (image or preset), `personalize.labels{choose,download,edit,change}`, `personalize.frames[]` (below), `personalize.output {width:1080,height:1350,format:"png"}` |
| Crop modal (1421-1455): drag-pan, zoom slider 1–3.5, wheel/touch; auto-crop 4:5 (1080×1350) | fixed | `personalize.crop {aspect:"4:5", zoomMin:1, zoomMax:3.5}` (kept as code constants unless the PM needs to change them; exposed only `aspect`) |
| Theme | brand blue `#1A27C9`, yellow `#FFE91E`, Inter | `theme {primary, accent, font}` (defaults from `landing-page.html`) |
| Language | English LTR only | `languages: ["en","ar"]`, per-field `{en,ar}`; RTL layout when `ar` (the platform otherwise supports both, `docs/13` §8) |

**Overlay/frame [Proposal — owner delegated the choice, `docs/13` §10 Q4]**: `personalize.frames[]` = one or more **PM-uploaded transparent PNG frames**, `{ id, name, imageUrl, aspect:"4:5", photoWindow: {x,y,w,h,shape:"rect|circle"} }`. The visitor picks one (if several), crops the photo to the `photoWindow`, and the browser composites photo + frame on a canvas at export (1080×1350 PNG, like the HTML's own pipeline); nothing is uploaded. Frames are stored in the project's storage folder. The HTML today exports a photo **without** any frame (`docs/13` §8). Alternatives considered: (a) a fixed platform-wide frame — rejected, PMs differ per program; (b) PM-built overlay editor — rejected as over-scope for v1.

**Edit-mode config (consolidated) [Proposal]**
```jsonc
{
  "languages": ["en","ar"], "defaultLang": "en",
  "theme": { "primary": "#1A27C9", "accent": "#FFE91E", "font": "Inter" },
  "nav": { "enabled": true, "links": [ { "label": {"en":"Opportunities","ar":""}, "target": "section:cards" },
                                       { "label": {"en":"Your Picture","ar":""},   "target": "section:personalize" } ] },
  "hero": { "title": {"en":"","ar":""}, "body": {"en":"","ar":""}, "backgroundImageUrl": "" },
  "cardsSection": { "title": {"en":"","ar":""}, "body": {"en":"","ar":""}, "layoutColumns": 2,
    "cards": [ { "id":"uuid", "order":0, "coverImageUrl":"", "chipLabel":{"en":"Upcoming Program","ar":""},
                 "title":{"en":"","ar":""}, "body":{"en":"","ar":""}, "seeMore":{"enabled":true,"clampLines":3},
                 "cta": { "label":{"en":"","ar":""}, "url":"", "notificationDot": true },
                 "share": { "enabled": true, "targetLink": "", "channels": ["whatsapp","facebook","linkedin","instagram","telegram","copy"],
                            "presets": { "whatsapp":"... {link}", "facebook":"... {link}", "linkedin":"...", "instagram":"...", "telegram":"..." } } } ] },
  "personalize": { "enabled": true, "title": {"en":"","ar":""}, "body": {"en":"","ar":""}, "panelPatternUrl": "",
                   "labels": { "choose":{"en":"Choose Photo","ar":""}, "download":{"en":"Download","ar":""}, "edit":{"en":"Edit","ar":""}, "change":{"en":"Upload Different Photo","ar":""} },
                   "frames": [ { "id":"uuid", "name":"Default", "imageUrl":"", "photoWindow":{"x":0,"y":0,"w":1080,"h":1350,"shape":"rect"} } ],
                   "output": { "width":1080, "height":1350, "format":"png" } },
  "analytics": { "enabled": true },
  "seo": { "title":"", "description":"", "imageUrl":"" }
}
```
`share.presets` are per card per platform, with `{link}` replaced **everywhere it appears** (today only the first occurrence, `docs/04` A-22) **[Decided]** (`docs/13` §14 answer 3; PM writes one text per platform per card).

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `target-links` | `link` | 0..n | optional: a card's `cta.url` or `share.targetLink` can be bound to a connected Form/Booking/Agenda `link` instead of a typed URL |
| out | `view` | `view` | 1 | the landing page as an Agenda tab (**[Decided]** Landing → Agenda, `docs/13` §3) |
| out | `link` | `link` | 1 | stand-alone public URL of the page |

**Views contributed**: "Landing" (page title configurable) on the Agenda view page; stand-alone page at its own public link. Admin tabs: Builder, Share presets (per card), Analytics.

**Multiple instances**: allowed (e.g. one landing page per audience or language). Today it is one per project (`project_id UNIQUE`).

**Visibility**: `private | platform | public` — public by design; `showToParticipants` adds a Landing section/link to the Program page if the PM wants founders to see it.

**Emails**: none.

**Founder exposure**: optional (as above); visitors are anonymous.

**Move / Stay / Drop**
- Stay: unlimited cards with image/title/text/button, ordering, per-platform presets with `{link}`, analytics (tab_view, card_share, image_upload, image_download) — now with **per-card analytics preserved** by stable card ids.
- Move: cover image → `hero.backgroundImage` (today `cover_url`/`main_title` header); per-card share modal → card `share` sheet; image maker from a card-based collage (today composes the card image + circle photo, `docs/04` §5.17) to the **frame-based** personalize flow of the HTML.
- Drop: `canvas_background_url`, `canvas_overlay_position` (no UI) replaced by `personalize.frames`; `layout_columns 2|3|4` becomes a card-section option; the `?agenda=…&tabs=join-athar` share indirection (A-22).

**Must not carry** (`docs/04` §9): save = delete-all-cards-and-reinsert (new UUIDs, analytics detaching via `ON DELETE SET NULL`, A-36); `canvas_*` reset to null on every save; two different public URLs for one page (A-22); `{link}` replaced only once; unauthenticated `FOR ALL USING (true)` on `join_athar_*` (S-2) — analytics inserts may stay anonymous, edits must not; `project_id TEXT` vs UUID (A-41); unused `byCard` analytics never shown (A-36); static page's missing handlers on share/CTA buttons; HTML limited to English/LTR; no frame in exported image.

---

### 3.10 Certificates (`certificates`)

**Purpose [Decided]**: the PM uploads a **certificate template containing variables** (e.g. participant name); the node issues certificates to participants whose status is **attended** only; founders see their certificate on the Program page **after the PM marks the program completed** in Program Settings (`docs/13` §12, §"Update (3)").

**Exists today [As-is]** (`docs/06` §9)
- `CertificateGenerator` (265 lines, **imported nowhere**), `CertificateVerifier` (public `/verify-certificate/:code`, declared twice), `FounderProgramsPage` (download link when `pdf_url` set), `CompanyProfilePage` certificates tab; API `getCertificates`, `verifyCertificate`, `issueCertificate` (no UI caller), `updateCertificatePdfUrl` (`lib/api.js:3409-3439`).
- Table `certificates` (0 rows; `certificate_id, founder_id, program_id, event_id, template_id text, issue_date, verification_code (12 hex), pdf_url (holds a PNG), issued_by`), storage `event-assets/certificates/<id>.png`; QR image via third-party `api.qrserver.com`; `program_participations` (0 rows).
- Nothing assigns participant status or issues certificates today.

**Edit-mode config [Proposal]**
```jsonc
{
  "template": { "backgroundImageUrl": "", "pageSize": "A4-landscape", "orientation": "landscape",
                "fields": [ { "var": "participant_name", "x": 540, "y": 400, "font": "Inter", "size": 48, "color": "#111", "align": "center", "lang": "en|ar" },
                            { "var": "company_name",     "x": 540, "y": 470, "size": 28 },
                            { "var": "program_name",     "x": 540, "y": 540, "size": 28 },
                            { "var": "issue_date",       "x": 540, "y": 600, "size": 20 },
                            { "var": "verification_qr",  "x": 900, "y": 700, "size": 120 } ] },
  "variables": ["participant_name","company_name","program_name","project_name","issue_date","verification_code"],
  "eligibility": { "status": "attended" },                      // [Decided] attended only
  "issueMode": "on_program_completed | manual",                 // see Open Decision 11
  "signature": { "imageUrl": "", "name": "", "title": "" },
  "output": "pdf",                                              // template uploaded as image/PDF; rendering client or server (design 07)
  "emailOnIssue": { "enabled": false, "subject": {}, "body": {} }
}
```

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `participants` | `participants` | 1 | from Selection and/or manual assignment; only `attended` are eligible |
| in | `program-status` | implicit | — | reads Program Settings `status = completed` (not an edge) |
| out | `view` | `view` | 0..1 | founder-facing "My certificate" block (Program page, not an Agenda tab by default) |
| out | `rows:certificate` | `rows:<certificate>` | 1 | records for the public verifier and the Alumni platform |

**Views**: founder-facing certificate download + public **verify page** (anonymous check by code; exposes only name/program/date/issuer, not whole `founders(*)` rows).

**Multiple instances**: allowed (e.g. different templates per track, or "attendance" and "completion"); each has its own eligibility filter (statuses are per participant; two nodes must not both issue to the same participant unless the PM wants two certificates — validated).

**Visibility**: founder view appears only after completion and only when `showToParticipants` is on **[Decided]**; verify page `public`.

**Emails**: optional "certificate ready" email (new, off by default); no email exists today.

**Founder exposure**: "Certificate" block on the Program page when the program is completed and the founder's participant status is `attended`.

**Move / Stay / Drop**: Stay verification code, public verifier, QR, PNG render concept, issue date, Alumni link (`certificates.founder_id/program_id`). Move generation from an unmounted component to this node; template becomes uploaded + variables. Drop `template_id text` free value.
**Must not carry** (`docs/06` §9, §12): generator reading `founders` that `getCertificates` does not select (name always "Graduate"); QR via third-party service (certificate URL sent to it); column named `pdf_url` holding a PNG; public `USING(true)` reads exposing `founders(*)`; certificate issuance with no UI/trigger (`issueCertificate` unreachable).

---

## 4. Project Details panel (project-level, not a node)

**[Decided]** (`docs/13` §11, §14 answer 4): a panel in the PM project interface; **required fields: location, map link, number of offline attendance days, transportation (provided or everyone comes on their own) — nothing else.**

**Exists today [As-is]**: nothing. None of these exist on `events` (column list in `docs/07a`); the only location-ish data is free text in forms/companies.

```jsonc
{
  "location": { "text": {"en":"","ar":""} },          // venue / address text
  "mapLink": "https://maps.app.goo.gl/...",            // validated URL
  "offlineDays": 3,                                     // integer >= 0; 0/empty = no offline part
  "transportation": "provided | self_arranged | null", // [Decided] provided OR everyone comes on their own
  "showToParticipants": true                            // block appears on the founder Program page only when PM enables
}
```
`transportation: null` renders nothing. `offlineDays` is a count only; the actual offline dates live in the Agenda/Distribution `schedule` (Open Decision 5 asks whether to cross-check them).
**Founder exposure**: the "Offline attendance" block of the Program page (location + map link + number of days + transportation) when enabled **[Decided]**.
**Storage**: project-level columns/JSON (design 04). It is not an input/output of any edge in v1; Landing/Agenda may *read* it as a `view` source later (proposal, not required).

---

## 5. Program Settings page (program-level)

**[Decided]**: new page holding the program description, the **completed** status etc.; programs are listed on the **Programs page**; completing the program unlocks certificates (`docs/13` §12, 00 §6).

**Exists today [As-is]**: `programs` table (3 rows; columns `program_id, name, name_ar, description, program_type, year, status`, `docs/07a`); `Dashboard.jsx` lists programs and edits **only `name`**, delete = unassign events (`docs/03` §4.1, §2.3); `events.program_id` links a project to a program; `programs.status` read as active/other (`!status` = active, `Dashboard.jsx:176,401`); no page uses `description`, `name_ar`, `program_type`, `year`, `status`.

**Config [Proposal]**
```jsonc
{
  "name": {"en":"","ar":""}, "description": {"en":"","ar":""},
  "cover": { "imageUrl": "" },                          // see Open Decision 2 re: "same cover as agenda"
  "type": "accelerator|incubator|bootcamp|…", "year": 2026,
  "status": "active | completed",                       // [Decided] PM marks completed
  "completedAt": null,                                  // set by the "Mark program completed" action (confirmation + audit)
  "publicLink": { "access": "public | platform | private" }   // [Decided] program link public or platform-only
}
```
**Behaviour**: "Mark as completed" unlocks Certificates nodes (3.10) and may freeze participant status editing (Open Decision 11). Reopening is allowed with an audit trail (proposal).
**Founder exposure**: description + cover on the Program page; Program page shows nothing else by default (00 §6).
**Must not carry**: Dashboard's "delete program only unassigns events" silently (confirm text) — kept but explicit; events/projects named "Event", "Project", "Brand" interchangeably (`docs/03` §2.2): UI term is **Project**.

---

## 6. Ather Team Booking vs Mentor Booking — one node or two?

### 6.1 Evidence (`docs/05`)
- Systems A and B are ~90% copy-paste: identical `ADVANCE_NOTICE_OPTIONS`, `isSlotWithinNoticeWindow`, available-slot query, booking creation with 3 retries, deletion, slot-series creation, Meet-link generation, slots table/edit row/bulk delete, public page (DUP-1…DUP-12, §9.1; ~2,300 lines each side). The differences are: provider source (`mentors` copied from `master_experts` vs manually typed `ather_team_members`), summary text ("Mentor Session" vs "Interview Meeting"), which `events.*` e-mail lists are used (`mentor_*` vs `interview_*`), UI wording, photo helper, and the link from the Selection board.
- Both already share the same pipeline: `process-booking` with `is_ather_team` flag, same Meet-mode setting, same `google_settings` (`docs/05` §5.1).
- Today's bugs are the same bugs twice: no transaction/unique on `slot_id` (BUG-8), silent notification failure (BUG-7), cascade deletes (BUG-9), UTC vs local editor display (CON-11).

### 6.2 Recommendation **[Proposal]**: ONE node type `booking` with a `mode`, shown in the sidebar as **two presets**
- `mode: "mentor"` — provider list = experts/mentors (from a List node); bookers are startups (anyone with the link, or restricted to a connected company list).
- `mode: "interview"` — provider list = Athar team (a List node of kind `custom`, e.g. "Athar Team"); bookers restricted to companies passed from a Selection stage (`stage:interview`); the Selection interview-invitation email carries this node's public booking link.

Reasons: (1) one implementation of slot generation, availability, conflict-safe booking and notification, removing the 90% duplication and the double bug surface; (2) the real differences are *data* (provider source, booker restriction, email recipients, texts), which fit config + ports; (3) provider identity unifies as `rows:list-items` — the separate `mentors` and `ather_team_members` tables (own copies of name/email/bio/photo) disappear, and provider-specific data (booking email, bio override, advance notice) becomes **overlay** on the list item, consistent with 00 §5; (4) the PM can also build "interview with outside experts" or "mentor office hours for the Athar team" without new code; (5) the manifest stays simple (one `EditComponent`).
Alternatives: **(a) two node types** — keeps names/entry points familiar and lets each evolve; rejected because it re-creates the duplication in a registry and every future feature (cancellation, waitlist, reminders) must be done twice; the presets give the same discoverability. **(b) a single node with no presets** — rejected; PMs think in "mentor sessions" vs "interviews".

### 6.3 Booking node definition (covers 3.5 and 3.6)

**Edit-mode config**
```jsonc
{
  "mode": "mentor | interview",
  "providers": { "from": "port:providers", "overlay": { "<itemId>": { "bookingEmail": "", "bioOverride": "", "photoOverride": "", "advanceNoticeMin": 1440 } } },
  "slotGeneration": { "durationMin": 30, "breakMin": 5, "perProviderDays": [ { "date":"2026-11-03", "from":"10:00", "to":"13:00" } ], "overlapCheck": true, "conflictPolicy": "skip|replace_if_conflict" },
  "booking": { "maxPerCompanyPerProvider": 1, "requireRegisteredCompany": true, "cancelBeforeMin": 720 },
  "meeting": { "provider": "google_meet", "linkMode": "unique | shared", "sharedLink": "" },
  "notifications": { "admins": [], "cc": [], "templates": { "confirmation": {}, "providerNotice": {}, "adminNotice": {}, "cancellation": {} } },
  "page": { "title": {"en":"","ar":""}, "intro": {"en":"","ar":""}, "showProviderEmail": false }
}
```
Today's settings it replaces: `events.mentor_*` / `interview_*` lists and templates, `meeting_link_mode`, `shared_google_meet_link`, `mentors.advance_notice_minutes`.

**Ports**
| Dir | Key | Type | Card. | Notes |
|---|---|---|---|---|
| in | `providers` | `rows:list-items` (expert) | 1 | mentors (mentor mode) or Athar team list (interview mode) |
| in | `bookers` | `rows:form-response` \| `rows:participant` \| `rows:list-items` (company) | 0..1 | interview mode: `stage:interview` of a Selection node; mentor mode: optional company list or participants |
| in | `schedule` | `schedule` | 0..1 | Agenda days used as default slot windows |
| out | `link` | `link` | 1 | public booking page (per-provider links derived) |
| out | `bookings` | `rows:booking` | 1 | used by the founder "my sessions" view and Selection (marks "interview booked") |
| out | `view` | `view` | 0..1 | optional "Book a session" tab for participants |

**Views contributed**: optional "Book a session" tab (for founders/participants) listing available providers/slots (platform access) or the public booking page. Admin: Providers, Slots, Bookings, Settings.

**Multiple instances**: allowed, one per use (e.g. "Mentor sessions – week 1", "Interviews"). A project with a Selection node and an interview Booking node is the standard flow.

**Visibility**: booking page `public | platform`; for `interview` mode `platform`/token link recommended (bookers are named companies); `showToParticipants` shows the tab/"my bookings" on the Program page. Public SELECT must not expose `meet_link` or provider email (SEC-1).

**Emails (reconciliation with `docs/08` §4.2, §4.4, §5.4, §7)**

| Email | Today [As-is] | Proposed |
|---|---|---|
| Booker confirmation | Google Calendar invitation from the service account with Meet link (`process-booking`); on-page text promises an email (A) | calendar invite **and** a templated confirmation from the PM's mailbox (`confirmation` template) |
| Provider/mentor notice | calendar invite | calendar invite + `providerNotice` template |
| Admin/CC | added as calendar attendees; the `mentor_email_template_*` saved by the UI is never used (CON-12); `send-booking-notifications` (hard-coded HTML + ICS) has no caller | `adminNotice` template; admin/CC lists per node; one send path, the unused function and template columns retired |
| Cancellation | none (cancel deletes the booking, not the calendar event, no notice) | `cancellation` template + calendar event cancelled |
| Interview invitation (sent by Selection) | link to the *admin* route | link = this node's public page (`{{booking_link}}`) |

Placeholders: §2.1 (`{{provider_name}}, {{start_time}}, {{end_time}}, {{timezone}}, {{meet_link}}, {{company_name}}, {{booker_email}}`) — replacing the five promised-but-unsupported tokens in the Mentor settings (`docs/08` §7.2).

**Founder exposure**: only through `showToParticipants` ("Book a session" / their own booking list). Interview bookers see only the booking page link from their email.

**Move / Stay / Drop**
- Stay: advance-notice rule, slot series generation (duration/break/count), bulk delete, edit slot, public per-provider page, Meet generation (unique or shared), copy link.
- Move: calendar creation to one server-side step; `generate-google-meet` button replaced by creating the event only with the booking (no orphan events, CON-2); mentor email on `localStorage` (SEC-7) → overlay field.
- Drop: unused day-config engine and `mentor_day_config` (DEAD-1 — or adopt its overlap/skip/replace logic as `slotGeneration.conflictPolicy`); `booking_notifications`, `notify-google-apps-script`, both `.gs` copies once 07 settles the poller question (`docs/12`); `events.admin_email` (no UI); `submission_id` (never set) — unless used by Selection link; `notifyGoogleAppsScript` naming.

**Must not carry** (`docs/05` §9): read-then-write double booking with no constraint, admin able to re-open a booked slot (BUG-8); booking confirmed on screen while calendar step failed, with retries only when the *invoke* throws (BUG-7); cascade-deleting bookings from slots/mentors silently (BUG-9); editing slot time not updating booking/calendar (INC-9); `new Date('YYYY-MM-DD')` UTC-midnight slot construction vs local (CON-1) and UTC edit vs local display (CON-11); calendar time zone mismatch Cairo/UTC (CON-3); public SELECT exposing `meet_link` and mentor email (SEC-1); `process-booking` callable by anyone with any booking id (SEC-6); `google_settings` readable by anyone (SEC-2); Ather members with NULL email while form says required; `1440` and `30/5/1` literals repeated; verbose `[Booking Trace]` logging of payloads (atherTeamBooking.js:184-233); admin-route booking link.

---

## 7. Do Mentoring Distribution and Mentor Booking relate?

**[As-is]** They share no code and no table, and even the mentor identity differs: Booking uses `mentors` (4 rows, copies of `master_experts`), Distribution uses `experts` (event list "Mentors", 65 rows) (`docs/05` §4.2, CON-14; `docs/03` P-naming). Their *timing math* is duplicated (`calculateDaySlotTimes` exists twice with different signatures, DUP-13/14, plus an unused mentor-booking day-config engine copied into Distribution, DEAD-1).

**Relation [Proposal]**: *siblings, not one node and not parent/child.*
- **Different semantics**: Booking = self-service, online, one provider at a time, startup picks the slot; Distribution = system-assigned fixed timetable, offline in a hall, every mentor × every slot, matching algorithm, live timer. Merging would make one config model for two lifecycles.
- **Shared inputs**: both take a **mentors list** (`rows:list-items`, entity expert) and an optional **companies list**; so the same "Experts" List node can feed both. Providers' availability is separate per node (overlay).
- **Shared code (not shared node)**: one slot-time library (parse/format/`calculateDaySlotTimes`/overlap detection) and one timer/clock utility replace the 3–4 duplicates (DUP-13…17).
- **No edge between them in v1.** A conflict guard is a possible later feature: if a mentor appears in both and an Agenda `schedule` overlaps, show a warning (Open Decision 7).
- Both appear as tabs on the Agenda view page (Booking optional "Book a session", Distribution "Distribution" + "Live").

---

## 8. Matrix: node type × ports

Legend: **in/out** = port key and type. `—` = none. `*` = optional.

| Node | Inputs | Outputs |
|---|---|---|
| Dynamic Agenda | `tabs` `view` 0..n | `schedule`, `view` (agenda), `link` |
| Form Builder | — | `responses` `rows:form-response`, `link`, `view`* |
| Lists | `items-in` `rows:*` 0..n | `items` `rows:list-items`, `view` |
| Selection Process | `applications` `rows:form-response` 1..n (or `participants` from a prior Selection) | `stage:<key>` `rows:form-response` (+decision), `participants`, `view`* |
| Booking (mentor / interview presets) | `providers` `rows:list-items`; `bookers` `rows:*`*; `schedule`* | `link`, `bookings` `rows:booking`, `view`* |
| Mentoring Distribution | `mentors` `rows:list-items`; `companies` `rows:list-items`; `schedule`* | `view-matrix`, `view-live`*, `sessions` `rows:session`* |
| Resource Library | — | `view`, `rows:resource`* |
| Landing Page | `target-links` `link` 0..n | `view`, `link` |
| Certificates | `participants` `participants` | `view`*, `rows:certificate` |
| Project Details (panel) | — | (read as project property, no ports in v1) |
| Program Settings (page) | — | (read as program property; `status=completed` unlocks Certificates) |

Valid edge pairs (type-compatible), as used in the 00 §2 diagram and §5:

| From → To | Port types | Meaning |
|---|---|---|
| Form → List | `rows:form-response` → `items-in` | list items reference responses |
| Form → Selection | `rows:form-response` → `applications` | applicants |
| Selection(`stage:accepted`) → List | `rows:form-response` → `items-in` | accepted companies list |
| Selection(`stage:interview`) → Booking(interview) | → `bookers` | who may book |
| Selection(`participants`) → Certificates | `participants` | eligibility (attended) |
| List → Agenda / Distribution / Booking | `view` / `rows:list-items` | tab or provider/company source |
| Agenda(`schedule`) → Booking / Distribution | `schedule` | days/times |
| Form/Booking/Agenda(`link`) → Landing | `link` | CTA / share target |
| Distribution/Landing/Library/Booking(`view`) → Agenda | `view` → `tabs` | tabs |

Edge validation (rule set belongs to design 02): type match, no cycles, cardinality, required inputs satisfied before publishing.

---

## 9. Current routes/components replaced

| Current route(s) / component(s) | Replaced by | Notes |
|---|---|---|
| `/` `Dashboard` (events grouped by program), `ProjectManagersManager` | Programs page + Program Settings (§5); Project list inside a program | project-manager assignment stays at project level |
| `/event(s)/:id` `EventDashboard` (8 module cards, link dropdowns, Sheets modal, duplicate event) | Project canvas + sidebar; "Share" menu per node; duplicate project = clone canvas | module cards become nodes |
| `/event(s)/:id/agenda` `EventBuilder`, `/event(s)/:id/visuals` `EventVisualManager` | Dynamic Agenda node (edit) | both visual editors merged |
| `/agenda/:eventId` `AgendaViewer`, `PublicLayout` tab bar, `?agenda=`/`tabs=` rewrite | Agenda view page (view of the Agenda node) + tabs from edges | one canonical link |
| `/event(s)/:id/forms` `FormEditor` + `forms/*`; `/events/:id/register/{company,expert}` `CompanyPortal`/`ExpertPortal`; `/forms/…`, `/events/:id/form/…` `GenericFormPortal` | Form Builder node (edit), one public form page | URL shapes consolidated |
| `/form-library`, `/forms-library` `FormLibraryManager` | Form template library (platform page) feeding Form Builder import | question editor unified |
| `/event(s)/:id/lists` `ListsManager`, `/event(s)/:id/experts` `ExpertManager`, `/event(s)/:id/startups` `StartupManager`, `ExpertCard`, `CompanyCard` | Lists node | review desk dropped (Selection) |
| `/view/:id/experts`, `/view/:id/startups` `ExpertViewer`/`StartupViewer` | List `view` tabs on Agenda page | |
| `/experts` `MasterExpertsList`, `/companies` `CompaniesPage` | Athar Network page (kept, outside canvas); company registry optional (Open Decision 10) | |
| `/event(s)/:id/analytics` `MarketingAnalytics`/`SubmissionAnalytics` | Form Builder "Sources/Analytics" tab (counts `form_responses`) | |
| `/event(s)/:id/selection` `SelectionProcessManager` | Selection Process node | |
| `/event/:id/mentor-booking`, `/event/:id/mentor-booking/:mentorId` `MentorBookingAdmin`/`MentorDetails`, `/book/:mentorId` `MentorBookingPage` | Booking node, mentor preset | |
| `/event/:id/ather-team-booking` `AtherTeamBookingAdmin`, `/ather-team-book/:memberId` `AtherTeamBookingPage`, embedded tab in Selection settings | Booking node, interview preset | |
| `/event/:id/mentoring-distribution` `MentoringDistributionAdmin`, `/view/:id/mentoring/matrix` `MentoringMatrixView`, `/view/:id/mentoring/live` `MentoringLiveView` | Mentoring Distribution node (+ views as tabs/links) | |
| `/library`, `/event(s)/:id/library` `LibraryManager`, `/view/:id/library` `LibraryViewer` | Resource Library node + central pool page | |
| `/event(s)/:id/join-athar` `JoinAtharDashboard`, `/view/:id/join-athar` `JoinAtharView` | Landing Page node | |
| `CertificateGenerator` (unmounted), `/verify-certificate/:code` `CertificateVerifier`, certificate links in `FounderProgramsPage` | Certificates node + public verifier | |
| `Dashboard.jsx.bak` | removed | dead |

Out of this document's scope (unchanged concepts): Alumni platform pages (`docs/06`), Athar Network registry beyond its integration points.

---

## 10. Consolidated "must not carry" items (cross-cutting)

1. Open RLS `USING (true)` on forms/responses/booking/distribution/join-athar/google_settings tables and anonymous write controls (`docs/04` S-2, `docs/05` SEC-2/SEC-5).
2. Service-account key readable and used in the browser (`docs/04` S-1, `docs/05` SEC-2/SEC-3).
3. Client-side-only gating (`is_active`, `published`) and "success" shown after a failed write.
4. Fire-and-forget copies into other tables from the browser (replaced by edges).
5. Multi-step saves without a transaction (agenda save, question save, join-athar save, generation).
6. Name/heuristic-based field detection and `custom_<timestamp>` keys.
7. Slug-from-name identifiers and singular/plural duplicate routes.
8. Event-id typed TEXT without FK; UUID/TEXT mixes (`docs/05` CON-15, `docs/04` A-41).
9. Same behaviour implemented 2–5 times (cards, portals, slot math, timers, email functions).
10. Mixed-language hard-coded strings in admin screens; each node must use the bilingual `{en,ar}` pattern.

---

## 11. Open Decisions for the Owner

1. **Booking: one node with two presets (recommended) or two node types?** Options: (A) one `booking` type + presets *Mentor Booking*/*Interview Booking*; (B) two types; (C) one type, no presets. **Recommendation A** (§6.2).
2. **Program cover vs Agenda cover.** `docs/13` §11 says the Program page cover is "the same cover as the project's agenda"; Program Settings also lists a cover. Options: (A) the Program page uses the project's Agenda cover; Program Settings has its own cover used only on the Programs list; (B) a single program cover; (C) project cover = agenda cover, program cover optional fallback. **Recommendation C.**
3. **Agenda view page without an Agenda node.** If a project has Landing/Distribution but no Dynamic Agenda, is there still a view page? Options: (A) view page exists only when an Agenda node exists; (B) every project has an implicit view page hosting tabs, the Agenda node is just one tab. **Recommendation B** (tabs from edges need a host; avoids forcing an empty agenda).
4. **Two selection stages: two Selection nodes or stages inside one node?** Options: (A) two nodes connected by an edge (accepted of stage 1 → applications of stage 2), (B) configurable stages in one node, (C) both supported. **Recommendation A** for clarity and independent templates/emails; the default stage set inside each node stays.
5. **Cross-check `offlineDays` against agenda/distribution days?** Options: warn only / ignore / auto-derive. **Recommendation: ignore in v1** (owner listed it as a typed number).
6. **Who enters the participant `attended` status and when?** (Needed for certificates.) Options: (A) PM marks per participant manually; (B) bulk "mark all accepted as attended" then unmark absentees; (C) derived from attendance data (not currently collected). **Recommendation A+B.** Where this lives (participants table UI) is design 03/06.
7. **Distribution rules**: (a) one break model (per-day gap vs global `break_slots`)? (b) include gaps in total round length? (c) does full "Generate" ever overwrite locked days? (d) unique-pairing scope per node or shared across Distribution nodes? **Recommendation:** per-day gap only; total = slots + gaps; Generate never touches locked days; scope per node. Plus whether a mentor appearing in both Booking and Distribution should raise a conflict warning (**recommendation: yes, warning only, later**).
8. **Google Sheets append for forms**: keep as an optional export (server-side, no browser key), or drop? **Recommendation:** keep optional, move server-side (design 07).
9. **Agenda import from Excel / Google Sheet**: keep (UI paths are dead today, `docs/03` §7.2) or drop? **Recommendation:** keep Excel import only.
10. **Companies registry**: keep a cross-project "Companies" page (`/companies`, broken/unreachable today) as a network registry like Athar Network for experts? **Recommendation:** yes, minimal, read-only in v1.
11. **Certificate issuance and completion scope.** (a) Issue automatically at completion for all `attended`, or manually per participant? (b) Does "completed" belong to the **Program** (as in Program Settings) while participants belong to a **Project** — if a program has several projects, do all projects complete together or per project? **Recommendation:** per project completion flag shown in Program Settings as a list, with a program-level "complete all" shortcut; certificates issued on explicit "Issue certificates" after completion.
12. **New emails beyond today's set**: respondent confirmation (form), holding email (selection), "your schedule" (distribution), certificate-ready, booking cancellation. Which are wanted in v1? **Recommendation:** only booking confirmation/cancellation and the three selection emails in v1; others off by default.
13. **Landing Page `{link}` target.** Is the share target (a) the card's own CTA link, (b) the Landing page's public link, or (c) separately typed per card? **Recommendation:** per-card `share.targetLink`, defaulting to the card CTA url (`docs/13` §10 Q3a says "the opportunity/form link").
14. **Landing personalize frames**: one frame or several selectable? **Recommendation:** support a list, UI shows a picker only when more than one (§3.9).
15. **Public interview booking security.** Interview booking is for named companies: open public link per team member (as today) or per-company tokens from the invitation email? **Recommendation:** tokenised link from the invitation, to prevent unrelated bookings and double-booking.
16. **Data retention for migrated legacy structures**: `expert_submissions`, `company_submissions` rows with `screening/interview/approved/displayed/holding` statuses map to Selection stages; `displayed` maps to `accepted`? **Recommendation:** map `displayed → accepted` and keep a migration flag so nothing is lost (design 05).

---

## 12. Notes on 00-conceptual-model

1. **Missing `link` port type** (00 §5 has `rows`, `view`, `schedule`, `participants`): Landing Page CTA/share and the Selection-invitation → booking link need to point at another node's public URL without copying it. Proposed `link` family added in §1.1; 00 §5 should list it.
2. **Port naming for forms and selection**: 00 §5 uses `rows:<entity>` with example entities but no entity for form responses coming out of Selection per stage; this catalogue introduces `stage:<key>` outputs (§3.4) and `rows:booking`, `rows:session`, `rows:resource`, `rows:certificate`.
3. **Agenda as the view-page host** is implicit in 00 §2/§5 ("tabs next to the agenda") but not stated; whether a view page exists without an Agenda node is open (Decision 3).
4. **Selection multiplicity**: 00 §3 says "can appear more than once (multi-stage)"; it does not say whether "multi-stage" means several nodes or stages inside a node (Decision 4).
5. **Program vs project completion**: 00 §6 says the PM marks the *program* completed in Program Settings, but participants link to a *project* (00 §7) and a program may contain several projects (Decision 11).
6. **Booking merge**: 00 §3 item 6 leaves open "separate node or mode"; answered here in §6 (recommend one node with a mode).
7. **Landing Page**: 00 §3 item 9 says edit-mode "evolves from today's Join Athar"; the actual HTML has a different structure (hero, two fixed cards, personalize section with frame) — mapped in §3.9; Join Athar's `canvas_*` columns are replaced by frames.
8. **Project Details** is shown to founders (00 §6) and edited by PMs but the 00 hierarchy (§2 diagram) does not place it; it is treated as a project property with a founder-visibility toggle (§4).
9. **"Lists — experts/mentors, companies"** (00 §3 item 3) hides the fact that today's "Mentors" list (`experts`) and the Booking `mentors` table are different concepts (`docs/03` §2.2, `docs/05` CON-14); the catalogue unifies both under List items (§6.2, §7).
10. **00 §4** manifest has `emails: [ { key, trigger, templateFields } ]`; the catalogue adds that email templates and recipients are node *config* (so the manifest needs `defaultTemplates` and the shared placeholder registry from §2.1).
