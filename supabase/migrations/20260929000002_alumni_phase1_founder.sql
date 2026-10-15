-- ============================================================
-- Alumni Platform Phase 1: Founder Schema & Permissions
-- Date: 2026-09-29
-- ============================================================

-- ─── 1. Notifications Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    founder_id UUID REFERENCES public.founders(founder_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);

-- ─── 2. Ensure company_snapshots exists and has all required columns ──────────
CREATE TABLE IF NOT EXISTS public.company_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL DEFAULT 'founder_update',
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    source TEXT NOT NULL DEFAULT 'founder',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'company_snapshots' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.company_snapshots ADD COLUMN id UUID DEFAULT gen_random_uuid();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'company_snapshots' AND column_name = 'snapshot_id'
    ) THEN
        ALTER TABLE public.company_snapshots ADD COLUMN snapshot_id UUID DEFAULT gen_random_uuid();
    END IF;
END $$;

-- ─── 3. Ensure company_founders column compatibility ──────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'company_founders' AND column_name = 'role_in_company'
    ) THEN
        ALTER TABLE public.company_founders ADD COLUMN role_in_company TEXT DEFAULT 'founder';
        UPDATE public.company_founders SET role_in_company = COALESCE(role, 'founder') WHERE role_in_company IS NULL;
    END IF;
END $$;

-- ─── 4. RLS for Notifications & Snapshots ─────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_read_own" ON public.notifications;
CREATE POLICY "notifications_read_own"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (
        recipient_id = auth.uid() 
        OR recipient_id IS NULL
        OR public.is_super_admin()
        OR public.has_role('alumni_manager')
    );

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (
        recipient_id = auth.uid() 
        OR public.is_super_admin()
        OR public.has_role('alumni_manager')
    );

DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
CREATE POLICY "notifications_insert_admin"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_super_admin()
        OR public.has_role('alumni_manager')
        OR recipient_id = auth.uid()
    );

DROP POLICY IF EXISTS "snapshots_select_policy" ON public.company_snapshots;
CREATE POLICY "snapshots_select_policy"
    ON public.company_snapshots FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_role('alumni_manager')
        OR EXISTS (
            SELECT 1 FROM public.company_founders cf
            JOIN public.founders f ON f.founder_id = cf.founder_id
            WHERE cf.company_id = company_snapshots.company_id
              AND f.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "snapshots_insert_policy" ON public.company_snapshots;
CREATE POLICY "snapshots_insert_policy"
    ON public.company_snapshots FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_super_admin()
        OR public.has_role('alumni_manager')
        OR EXISTS (
            SELECT 1 FROM public.company_founders cf
            JOIN public.founders f ON f.founder_id = cf.founder_id
            WHERE cf.company_id = company_snapshots.company_id
              AND f.auth_user_id = auth.uid()
        )
    );
