-- ============================================================
-- Alumni Platform Phase 2: Alumni Manager Schema & Indexes
-- Date: 2026-09-30
-- ============================================================

-- ─── 1. Alumni Invitations Enhancements ─────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'alumni_invitations' AND column_name = 'founder_id'
    ) THEN
        ALTER TABLE public.alumni_invitations 
            ADD COLUMN founder_id UUID REFERENCES public.founders(founder_id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alumni_invitations_founder ON public.alumni_invitations(founder_id);
CREATE INDEX IF NOT EXISTS idx_alumni_invitations_status ON public.alumni_invitations(status);
CREATE INDEX IF NOT EXISTS idx_alumni_invitations_created ON public.alumni_invitations(created_at DESC);

-- ─── 2. Notifications Enhancements for Manager Broadcasts ───────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'audience_type'
    ) THEN
        ALTER TABLE public.notifications 
            ADD COLUMN audience_type TEXT DEFAULT 'founder';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'audience_target_id'
    ) THEN
        ALTER TABLE public.notifications 
            ADD COLUMN audience_target_id UUID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id'
    ) THEN
        ALTER TABLE public.notifications 
            ADD COLUMN broadcast_id UUID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'metadata'
    ) THEN
        ALTER TABLE public.notifications 
            ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_broadcast_id ON public.notifications(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- ─── 3. Analytics Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_company_snapshots_company_date 
    ON public.company_snapshots(company_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_program_participations_comp 
    ON public.program_participations(company_id);

CREATE INDEX IF NOT EXISTS idx_program_participations_prog 
    ON public.program_participations(program_id);

-- ─── 4. Ensure RLS for Alumni Invitations & Management ─────────────────────
ALTER TABLE public.alumni_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_manager_all" ON public.alumni_invitations;
CREATE POLICY "invitations_manager_all"
    ON public.alumni_invitations FOR ALL
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_role('alumni_manager')
    )
    WITH CHECK (
        public.is_super_admin()
        OR public.has_role('alumni_manager')
    );

-- Allow public verification of invitation token (for signup screen)
DROP POLICY IF EXISTS "invitations_public_read_token" ON public.alumni_invitations;
CREATE POLICY "invitations_public_read_token"
    ON public.alumni_invitations FOR SELECT
    TO public
    USING (true);
