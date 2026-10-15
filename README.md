# Athar Workspace

A project-management platform for incubators and accelerators, built for **Athar** (athareg.com).

A project manager creates a **Program**, and inside it **Projects**. Each project opens a blank **canvas** with a sidebar of tools (nodes). The manager imports only the tools the project needs, as many times as needed, and connects them visually so data flows from one tool to another without being copied.

| Node | What it does |
|---|---|
| Dynamic Agenda | Days, sessions, a public agenda page with tabs contributed by other nodes |
| Form Builder | Questions, sections, public forms, responses, analytics, templates |
| Lists | Experts, companies or any custom list; items are references to the source plus list-specific fields |
| Selection Process | Reviewer board, scores, acceptance/rejection/interview e-mails, multi-stage chains |
| Booking | Online mentor sessions and tokenised interview booking, Google Calendar / Meet sync |
| Mentoring Distribution | Offline sessions in the training hall: matching, matrix and live timer views |
| Resource Library | Files and links for participants, with signed URLs for private files |
| Landing Page | Public page with share presets and a personalised-photo frame |
| Certificates | Template with variables, issued per founder account, public verifier with QR |

Founders (founders of startups taking part in the programs) have their own accounts and see only what the project manager has enabled for them. The Alumni module keeps the startups' profiles, yearly figures, opportunities and notifications.

## Repository layout

| Path | Content |
|---|---|
| `web/` | The new frontend (React 19 + JavaScript, Vite, Tailwind, TanStack Query, React Flow). See `web/README.md` and `web/PROGRESS.md` |
| `db/` | SQL migrations (`db/migrations`), verification scripts (`db/verify`), tooling (`db/scripts`), reports. See `db/README.md` |
| `supabase-new/functions/` | Edge function sources (Google OAuth, e-mail worker, calendar sync, image conversion). Not deployed anywhere yet |
| `docs/` | As-is documentation of the previous system (`docs/01`-`13`) and the design documents of the new one (`docs/design`) |
| `src/`, `supabase/`, `google-apps-script/` | The **legacy** application, still the production system until the cut-over |

## Status

Everything in `web/` and `db/` runs against a **local** Supabase stack (Docker) that holds a copy of the production data. Nothing from the new platform has been applied to the live project yet. `web/PROGRESS.md` has the full status table (what is done, what is partial, what remains) and `docs/design/08-decisions-log.md` records every product decision.

## Running the new frontend locally

Requirements: Node 22+, Docker Desktop and the Supabase CLI.

```bash
cd web
npm install
cp .env.example .env.local   # fill in the local Supabase URL and publishable key
npm run dev:local
```

The local database dump is **not** part of this repository (it contains personal data). The migrations in `db/migrations` and the verification scripts describe the target schema; see `db/README.md` for the order they are applied in.

## Security notes

* No secrets belong in this repository. `.env*` files (except `.env.example`) and the local database export are git-ignored.
* The history was rewritten once to remove a leaked Google service-account key; that key had already been revoked and its service account deleted.
* Row Level Security on the live database is being replaced by the policies in `db/migrations` as part of the migration; until the cut-over the legacy application keeps using the live project.
