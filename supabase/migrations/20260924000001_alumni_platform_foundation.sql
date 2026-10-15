-- ============================================================
-- Alumni & Impact Platform — Phase 1: Foundation Migration
-- Date: 2026-09-24
-- ============================================================
-- Design Notes:
--   - companies table already exists; we extend it with alumni fields.
--   - programs table already exists; we extend it with type/year/status.
--   - company_snapshots is append-only (no UPDATE RLS policy intentionally).
--   - All new tables follow the same RLS pattern used in the project.
-- ============================================================

-- ─── 1. Extend existing `companies` table ─────────────────────────────────────
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS is_alumni         BOOLEAN     DEFAULT false,
    ADD COLUMN IF NOT EXISTS founding_year     SMALLINT,
    ADD COLUMN IF NOT EXISTS province          TEXT,
    ADD COLUMN IF NOT EXISTS description_ar    TEXT,
    ADD COLUMN IF NOT EXISTS website_url       TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_is_alumni ON public.companies(is_alumni);

-- ─── 2. Extend existing `programs` table ──────────────────────────────────────
ALTER TABLE public.programs
    ADD COLUMN IF NOT EXISTS name_ar           TEXT,
    ADD COLUMN IF NOT EXISTS program_type      TEXT        DEFAULT 'accelerator',
    ADD COLUMN IF NOT EXISTS year              SMALLINT,
    ADD COLUMN IF NOT EXISTS status            TEXT        DEFAULT 'active';

-- program_type values: 'accelerator' | 'bootcamp' | 'fellowship' | 'workshop' | 'other'
-- status values: 'active' | 'completed' | 'archived'

-- ─── 3. New table: founders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.founders (
    founder_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar         TEXT NOT NULL,
    name_en         TEXT,
    email           TEXT,
    phone           TEXT,
    linkedin_url    TEXT,
    photo_url       TEXT,
    bio_ar          TEXT,
    bio_en          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_founders_email ON public.founders(email);

-- ─── 4. New table: company_founders (Many-to-Many) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.company_founders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    founder_id      UUID NOT NULL REFERENCES public.founders(founder_id)  ON DELETE CASCADE,
    role            TEXT DEFAULT 'founder',     -- 'founder' | 'co-founder' | 'ceo' | 'cto'
    is_primary      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_id, founder_id)
);

CREATE INDEX IF NOT EXISTS idx_company_founders_company ON public.company_founders(company_id);
CREATE INDEX IF NOT EXISTS idx_company_founders_founder ON public.company_founders(founder_id);

-- ─── 5. New table: program_participations ────────────────────────────────────
-- Links a company to a specific program+cohort (event).
-- Cohort = an event that belongs to a program (via events.program_id).
CREATE TABLE IF NOT EXISTS public.program_participations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    program_id      UUID NOT NULL REFERENCES public.programs(program_id)  ON DELETE CASCADE,
    event_id        UUID REFERENCES public.events(event_id) ON DELETE SET NULL,
    start_date      DATE,
    end_date        DATE,
    graduation_status TEXT DEFAULT 'active',   -- 'active' | 'graduated' | 'dropped'
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_id, program_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_program_participations_company  ON public.program_participations(company_id);
CREATE INDEX IF NOT EXISTS idx_program_participations_program  ON public.program_participations(program_id);
CREATE INDEX IF NOT EXISTS idx_program_participations_event    ON public.program_participations(event_id);

-- ─── 6. New table: company_snapshots (Append-Only History) ───────────────────
-- INTENTIONAL: No UPDATE RLS policy — snapshots are immutable records.
-- Every data update creates a NEW snapshot row instead of overwriting.
CREATE TABLE IF NOT EXISTS public.company_snapshots (
    snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    snapshot_type   TEXT NOT NULL,
    -- snapshot_type values:
    --   'program_start'    → at start of program
    --   'graduation'       → at program graduation
    --   'annual_update'    → yearly check-in (most common)
    --   '6_month_followup' → 6 months post-graduation
    --   'manual_import'    → imported from historical data
    snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    source          TEXT NOT NULL DEFAULT 'founder',
    -- source values: 'founder' | 'me_team' | 'imported' | 'system'
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- data JSONB structure (all optional, collected progressively):
    -- {
    --   "revenue_sar":          number,
    --   "employees_count":      number,
    --   "jobs_created":         number,
    --   "funding_raised_sar":   number,
    --   "is_active":            boolean,
    --   "stage":                string,
    --   "sector":               string,
    --   "website_url":          string,
    --   "description":          string,
    --   "key_achievements":     string[],
    --   "challenges":           string,
    --   "support_needed":       string,
    --   "form_response_id":     uuid  (link back to form_responses)
    -- }
    form_response_id UUID REFERENCES public.form_responses(response_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_snapshots_company  ON public.company_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_company_snapshots_type     ON public.company_snapshots(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_company_snapshots_date     ON public.company_snapshots(snapshot_date DESC);

-- ─── 7. New table: certificates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.certificates (
    certificate_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    founder_id          UUID NOT NULL REFERENCES public.founders(founder_id) ON DELETE CASCADE,
    program_id          UUID NOT NULL REFERENCES public.programs(program_id) ON DELETE CASCADE,
    event_id            UUID REFERENCES public.events(event_id) ON DELETE SET NULL,
    template_id         TEXT,                   -- key referencing a certificate template
    issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    verification_code   TEXT NOT NULL UNIQUE DEFAULT LEFT(gen_random_uuid()::text, 12),
    pdf_url             TEXT,
    issued_by           TEXT,                   -- name of the person/org issuing
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificates_founder   ON public.certificates(founder_id);
CREATE INDEX IF NOT EXISTS idx_certificates_program   ON public.certificates(program_id);
CREATE INDEX IF NOT EXISTS idx_certificates_code      ON public.certificates(verification_code);

-- ─── 8. New table: opportunities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opportunities (
    opportunity_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL DEFAULT 'grant',
    -- type values: 'grant' | 'investment' | 'event' | 'competition' | 'partnership' | 'other'
    title_ar        TEXT NOT NULL,
    title_en        TEXT,
    description_ar  TEXT,
    description_en  TEXT,
    deadline        DATE,
    eligibility     TEXT,                       -- who qualifies
    link            TEXT,
    image_url       TEXT,
    is_active       BOOLEAN DEFAULT true,
    order_index     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_type      ON public.opportunities(type);
CREATE INDEX IF NOT EXISTS idx_opportunities_active    ON public.opportunities(is_active);
CREATE INDEX IF NOT EXISTS idx_opportunities_deadline  ON public.opportunities(deadline);

-- ─── 9. New table: opportunity_applications ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opportunity_applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id  UUID NOT NULL REFERENCES public.opportunities(opportunity_id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES public.companies(company_id)          ON DELETE CASCADE,
    founder_id      UUID REFERENCES public.founders(founder_id)                    ON DELETE SET NULL,
    status          TEXT DEFAULT 'applied',     -- 'applied' | 'shortlisted' | 'accepted' | 'rejected'
    notes           TEXT,
    applied_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(opportunity_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_opp_applications_opp     ON public.opportunity_applications(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_applications_company ON public.opportunity_applications(company_id);

-- ─── 10. New table: investor_requests ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.investor_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_name  TEXT NOT NULL,
    requester_email TEXT NOT NULL,
    requester_org   TEXT,
    company_id      UUID REFERENCES public.companies(company_id) ON DELETE SET NULL,
    request_type    TEXT DEFAULT 'data_room',   -- 'data_room' | 'intro' | 'general'
    message         TEXT,
    status          TEXT DEFAULT 'pending',     -- 'pending' | 'approved' | 'rejected'
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_investor_requests_company ON public.investor_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_investor_requests_status  ON public.investor_requests(status);

-- ─── 11. Row Level Security ───────────────────────────────────────────────────
ALTER TABLE public.founders                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_founders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_participations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_requests         ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- founders: full access (team manages data)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'founders' AND policyname = 'Public access founders') THEN
        CREATE POLICY "Public access founders" ON public.founders FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- company_founders
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_founders' AND policyname = 'Public access company_founders') THEN
        CREATE POLICY "Public access company_founders" ON public.company_founders FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- program_participations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'program_participations' AND policyname = 'Public access program_participations') THEN
        CREATE POLICY "Public access program_participations" ON public.program_participations FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- company_snapshots: allow INSERT and SELECT but no UPDATE/DELETE (append-only)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_snapshots' AND policyname = 'Public insert snapshots') THEN
        CREATE POLICY "Public insert snapshots"  ON public.company_snapshots FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_snapshots' AND policyname = 'Public read snapshots') THEN
        CREATE POLICY "Public read snapshots"    ON public.company_snapshots FOR SELECT USING (true);
    END IF;

    -- certificates
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'certificates' AND policyname = 'Public access certificates') THEN
        CREATE POLICY "Public access certificates" ON public.certificates FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- opportunities: anyone can read, only authenticated can write
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'opportunities' AND policyname = 'Public read opportunities') THEN
        CREATE POLICY "Public read opportunities"  ON public.opportunities FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'opportunities' AND policyname = 'Auth write opportunities') THEN
        CREATE POLICY "Auth write opportunities"   ON public.opportunities FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
    END IF;

    -- opportunity_applications
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'opportunity_applications' AND policyname = 'Public access opportunity_applications') THEN
        CREATE POLICY "Public access opportunity_applications" ON public.opportunity_applications FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- investor_requests: public insert, auth read
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investor_requests' AND policyname = 'Public insert investor_requests') THEN
        CREATE POLICY "Public insert investor_requests" ON public.investor_requests FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investor_requests' AND policyname = 'Auth read investor_requests') THEN
        CREATE POLICY "Auth read investor_requests"    ON public.investor_requests FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investor_requests' AND policyname = 'Auth update investor_requests') THEN
        CREATE POLICY "Auth update investor_requests"  ON public.investor_requests FOR UPDATE USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- ─── 12. Auto-update `updated_at` triggers ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['founders', 'program_participations', 'opportunities'] LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I;
            CREATE TRIGGER trg_%I_updated_at
                BEFORE UPDATE ON public.%I
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        ', tbl, tbl, tbl, tbl);
    END LOOP;
END $$;
