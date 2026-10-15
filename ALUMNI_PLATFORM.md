# Athar Alumni & Impact Platform — Technical Documentation

> **Version:** 1.0 · **Last Updated:** 2026-09-25  
> **Stack:** React 19 + Vite · Supabase (PostgreSQL + RLS) · TailwindCSS · Bun

---

## 1. Platform Overview

Athar Alumni & Impact Platform extends the existing Athar event-management system with a dedicated **alumni tracking layer** built on the same database and component library. It requires **zero parallel infrastructure** — all alumni data lives in the same Supabase project.

### Core Principles
- **Snapshot-based history** — company data is never overwritten; every update creates an append-only record.
- **Reuse > Rebuild** — ~75 % of the implementation reuses existing components, APIs, and DB tables.
- **Bilingual by default** — all UI keys exist in both Arabic and English via 	ranslations.Alumni.

---

## 2. Database Schema (New Tables)

| Table | Purpose |
|-------|---------|
| ounders | Independent founder profiles (linked to companies via junction) |
| company_founders | Many-to-many: Companies ↔ Founders with ole, is_primary |
| program_participations | Company enrollment in programs with graduation_status |
| company_snapshots | **Append-only** impact data. snapshot_type ∈ {program_start, graduation, six_month, annual_update, manual_import} |
| certificates | Issued certificates with erification_code (UUID) and optional pdf_url |
| opportunities | Grants, investments, competitions published to alumni |
| opportunity_applications | Company applications to opportunities (upsert on company_id + opportunity_id) |
| investor_requests | Investor interest requests referencing a specific company |

### Modified Tables
| Table | Added Columns |
|-------|--------------|
| companies | is_alumni BOOL, ounding_year INT, province TEXT, website_url TEXT |
| programs | program_type TEXT, year INT, status TEXT, 
ame_ar TEXT |

---

## 3. Frontend Modules (src/components/alumni/)

| Component | Route | Who Uses It |
|-----------|-------|-------------|
| AlumniDirectory.jsx | /alumni | Public / Athar staff |
| CompanyProfilePage.jsx | /alumni/:id | Public / investors |
| FounderDashboard.jsx | /alumni/founder | Founders |
| CertificateGenerator.jsx | Modal (inside FounderDashboard) | Founders |
| CertificateVerifier.jsx | /verify-certificate/:code | Anyone (public) |
| OpportunitiesHub.jsx | /alumni/opportunities | Founders / Athar staff |
| MEWorkspace.jsx | /alumni/me | M&E team |
| ImpactDashboard.jsx | /alumni/impact | Partners / investors / Athar leadership |

---

## 4. API Layer (src/lib/api.js)

All alumni API functions are appended to the existing pi.js service layer starting at **line 3186**.

### Key Functions

| Function | Description |
|----------|-------------|
| getFounders() | All founders (cached) |
| getFounderById(id) | Single founder with company relations |
| createFounder / updateFounder / deleteFounder | CRUD |
| linkFounderToCompany(founderId, companyId, role) | Junction table insert |
| getCompanySnapshots(companyId) | All snapshots ordered by date |
| createSnapshot({ companyId, snapshotType, ... }) | Append-only insert |
| createSnapshotFromFormResponse(companyId, responseId) | **Auto-converts Annual Update form answers → Snapshot** |
| getCertificates(founderId) | Founder's certificates with program & event joins |
| issueCertificate({ founderId, programId, ... }) | DB insert, auto-generates UUID verification code |
| updateCertificatePdfUrl(certId, url) | Updates PDF/PNG URL after generation |
| erifyCertificate(code) | Public lookup by verification_code |
| getOpportunities(filters) | Active opportunities (cached) |
| pplyToOpportunity({ opportunityId, companyId }) | Upsert application |
| getAlumniCompanies(filters) | Alumni companies with optional sector/stage/province/program filters |
| getImpactStats() | Aggregate KPIs: survival rate, revenue, jobs, funding |
| getAlumniCompanyProfile(companyId) | Company + founders + participations + snapshots in one call |

---

## 5. Certificate Generation Engine

**File:** src/components/alumni/CertificateGenerator.jsx

### How It Works
1. A hidden <div> (CertificateCanvas) renders the certificate template off-screen using inline styles.
2. html-to-image (	oPng) captures it at 2× resolution (already in package.json as html-to-image).
3. The resulting PNG Blob is uploaded to Supabase Storage at event-assets/certificates/{certificate_id}.png.
4. The public URL is written back to certificates.pdf_url via updateCertificatePdfUrl().
5. Founders can **Download** the PNG or **Share to LinkedIn** (LinkedIn shareArticle API).
6. A QR code pointing to the public /verify-certificate/:code page is embedded via pi.qrserver.com (no extra library).

---

## 6. Snapshot Auto-Creation (Annual Update Trigger)

**Location:** src/lib/api.js → submitToForm() integration block 5

When 	argetModule === 'alumni_annual_update' and ormData.company_id is present:

`
submitToForm()
  └── async IIFE (non-blocking)
        └── if targetModule === 'alumni_annual_update'
              └── createSnapshotFromFormResponse(companyId, primaryResponse.response_id)
                    └── reads form_responses.answers → inserts company_snapshots
`

This means M&E staff do **not** need to manually create snapshots after each annual update. The system converts form answers to a snapshot automatically.

---

## 7. Roles & Permissions

> The current platform uses a **client-side role check** via Supabase Auth user_metadata.role.  
> RLS policies should be added to each new table as a Phase 2 security hardening step.

| Role | Access |
|------|--------|
| dmin | All modules — read + write |
| me_team | MEWorkspace, ImpactDashboard, Snapshots — read + write |
| ounder | FounderDashboard, own company profile, opportunities — read (own data only) |
| public | AlumniDirectory, CompanyProfilePage (published), CertificateVerifier |

---

## 8. Reminders System

**Current status:** Reminder delivery uses the existing 
otifyGoogleAppsScript() Edge Function (called via supabase.functions.invoke('process-booking')). 

**For Annual Update reminders:**
- M&E staff trigger reminders manually from MEWorkspace.jsx for companies that haven't submitted an update.
- Automated scheduling (cron-based) is a **Phase 3** item; implementation requires a Supabase Edge Function with pg_cron or a Supabase scheduled function.

---

## 9. Seed Data

Location: supabase/seed_alumni.sql

Contains:
- **3 programs** (Accelerator 2023, Bootcamp 2024, Fellowship 2023)
- **5 companies** (NovaTech, GreenSaudi, MedSync, EduPath, FinFlowSA)
- **10 founders** (2 per company)
- **Program participations** linking all companies to programs
- **9 company snapshots** with realistic revenue/jobs/funding data
- **3 opportunities** (grant, investment, competition)
- **5 certificates** (one per primary founder of graduated companies)

Run: un run supabase db reset or paste directly in the Supabase SQL Editor.

---

## 10. Known Gaps (Phase 2+)

| Item | Status | Priority |
|------|--------|----------|
| Automated reminder cron job | ❌ Not started | Medium |
| RLS policies for alumni tables | ❌ Not started | High |
| Alumni registration flow (founder self-signup) | ❌ Not started | Medium |
| Excel/Google Sheets bulk import for historical companies | ❌ Not started | Low |
| Investor Portal (InvestorPortal.jsx) | ❌ Not started | Phase 3 |
| Regression test suite (Playwright) | ❌ Not started | Medium |
