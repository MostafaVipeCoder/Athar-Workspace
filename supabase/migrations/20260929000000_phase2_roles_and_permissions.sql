-- ============================================================
-- Phase 2: Roles System & Permissions Migration
-- Date: 2026-09-29
-- ============================================================

-- ─── 1. Role Enum Definition ──────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE app_role AS ENUM (
        'super_admin',
        'project_manager',
        'alumni_manager',
        'founder'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE project_role AS ENUM (
        'owner',
        'collaborator'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ─── 2. Restructure user_roles Table ──────────────────────────────────────────
-- Columns required: id (uuid, PK), user_id (uuid, FK), role (app_role), created_at, updated_at
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role app_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT user_roles_user_id_role_unique UNIQUE (user_id, role)
);

-- Schema alignment for existing user_roles table:
DO $$ BEGIN
    -- Add id column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN id UUID DEFAULT gen_random_uuid();
        ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
        ALTER TABLE public.user_roles ADD PRIMARY KEY (id);
    END IF;

    -- Add role enum column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'role'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN role app_role;
    END IF;

    -- If role_key exists, make it nullable so inserting role alone does not fail
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'role_key'
    ) THEN
        ALTER TABLE public.user_roles ALTER COLUMN role_key DROP NOT NULL;
    END IF;

    -- Add created_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'created_at'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
    END IF;

    -- Add updated_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
    END IF;
END $$;

-- Migrate existing rows to fill role from role_key and vice-versa
UPDATE public.user_roles 
SET role = CASE 
    WHEN role_key = 'alumni_admin' THEN 'alumni_manager'::app_role
    WHEN role_key = 'project_manager' THEN 'project_manager'::app_role
    WHEN role_key = 'founder' THEN 'founder'::app_role
    ELSE 'super_admin'::app_role
END
WHERE role IS NULL;

UPDATE public.user_roles
SET role_key = role::text
WHERE role_key IS NULL AND role IS NOT NULL;

-- Enforce NOT NULL on role now that all rows are populated
ALTER TABLE public.user_roles ALTER COLUMN role SET NOT NULL;

-- Ensure UNIQUE constraint on (user_id, role)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_roles_user_id_role_unique'
    ) THEN
        ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_unique UNIQUE (user_id, role);
    END IF;
END $$;

-- Synchronization trigger between role and role_key
CREATE OR REPLACE FUNCTION public.sync_user_roles_role_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.role_key IS DISTINCT FROM OLD.role_key THEN
            NEW.role := NEW.role_key::app_role;
        ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
            NEW.role_key := NEW.role::text;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.role IS NOT NULL AND NEW.role_key IS NULL THEN
            NEW.role_key := NEW.role::text;
        ELSIF NEW.role_key IS NOT NULL AND NEW.role IS NULL THEN
            NEW.role := NEW.role_key::app_role;
        ELSIF NEW.role IS NOT NULL THEN
            NEW.role_key := NEW.role::text;
        END IF;
    END IF;

    NEW.updated_at := timezone('utc'::text, now());

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_roles ON public.user_roles;
CREATE TRIGGER trg_sync_user_roles
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_roles_role_columns();

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- ─── 3. Point 2.2: Assign all existing profiles as super_admin ────────────────
INSERT INTO public.user_roles (user_id, role, role_key)
SELECT p.id, 'super_admin'::app_role, 'super_admin'
FROM public.profiles p
ON CONFLICT (user_id, role) DO NOTHING;

-- ─── 4. Point 2.3: Restructure project_managers Table ─────────────────────────
CREATE TABLE IF NOT EXISTS public.project_managers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.events(event_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_in_project TEXT NOT NULL DEFAULT 'collaborator' CHECK (role_in_project IN ('owner', 'collaborator')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    added_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT project_managers_event_user_unique UNIQUE (event_id, user_id)
);

-- Schema alignment for project_managers columns:
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'project_managers' AND column_name = 'project_id'
    ) THEN
        ALTER TABLE public.project_managers ADD COLUMN project_id UUID REFERENCES public.events(event_id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'project_managers' AND column_name = 'added_at'
    ) THEN
        ALTER TABLE public.project_managers ADD COLUMN added_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'project_managers' AND column_name = 'added_by'
    ) THEN
        ALTER TABLE public.project_managers ADD COLUMN added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Backfill project_managers alias columns
UPDATE public.project_managers SET project_id = event_id WHERE project_id IS NULL;
UPDATE public.project_managers SET added_at = assigned_at WHERE added_at IS NULL;
UPDATE public.project_managers SET added_by = assigned_by WHERE added_by IS NULL;

-- Synchronization trigger for project_managers
CREATE OR REPLACE FUNCTION public.sync_project_managers_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
            NEW.event_id := NEW.project_id;
        ELSIF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
            NEW.project_id := NEW.event_id;
        END IF;

        IF NEW.added_at IS DISTINCT FROM OLD.added_at THEN
            NEW.assigned_at := NEW.added_at;
        ELSIF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
            NEW.added_at := NEW.assigned_at;
        END IF;

        IF NEW.added_by IS DISTINCT FROM OLD.added_by THEN
            NEW.assigned_by := NEW.added_by;
        ELSIF NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN
            NEW.added_by := NEW.assigned_by;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.event_id IS NULL AND NEW.project_id IS NOT NULL THEN
            NEW.event_id := NEW.project_id;
        ELSIF NEW.project_id IS NULL AND NEW.event_id IS NOT NULL THEN
            NEW.project_id := NEW.event_id;
        END IF;

        IF NEW.assigned_at IS NULL AND NEW.added_at IS NOT NULL THEN
            NEW.assigned_at := NEW.added_at;
        ELSIF NEW.added_at IS NULL AND NEW.assigned_at IS NOT NULL THEN
            NEW.added_at := NEW.assigned_at;
        END IF;

        IF NEW.assigned_by IS NULL AND NEW.added_by IS NOT NULL THEN
            NEW.assigned_by := NEW.added_by;
        ELSIF NEW.added_by IS NULL AND NEW.assigned_by IS NOT NULL THEN
            NEW.added_by := NEW.assigned_by;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_project_managers ON public.project_managers;
CREATE TRIGGER trg_sync_project_managers
BEFORE INSERT OR UPDATE ON public.project_managers
FOR EACH ROW EXECUTE FUNCTION public.sync_project_managers_columns();

CREATE INDEX IF NOT EXISTS idx_project_managers_event ON public.project_managers(event_id);
CREATE INDEX IF NOT EXISTS idx_project_managers_project ON public.project_managers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_managers_user ON public.project_managers(user_id);

-- ─── 5. Anti-Recursion Security Helpers ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = check_user_id
          AND (role = 'super_admin'::app_role OR role::text = 'super_admin' OR role_key = 'super_admin')
    );
$$;

CREATE OR REPLACE FUNCTION public.has_role(role_name TEXT, check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = check_user_id
          AND (role::text = role_name OR role_key = role_name)
    );
$$;

-- ─── 6. Point 2.4: RLS Policies for user_roles & project_managers ──────────────
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_managers ENABLE ROW LEVEL SECURITY;

-- user_roles policies: user reads own role, super_admin reads all
DROP POLICY IF EXISTS "user_roles_read_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;

CREATE POLICY "user_roles_select_policy"
    ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() OR public.is_super_admin()
    );

CREATE POLICY "user_roles_admin_manage"
    ON public.user_roles
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.is_project_owner(check_event_id UUID, check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_managers
        WHERE event_id = check_event_id
          AND user_id = check_user_id
          AND role_in_project = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_project_manager(check_event_id UUID, check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_managers
        WHERE event_id = check_event_id
          AND user_id = check_user_id
    );
$$;

-- ─── 6. Point 2.4: RLS Policies for user_roles & project_managers ──────────────
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_managers ENABLE ROW LEVEL SECURITY;

-- user_roles policies: user reads own role, super_admin reads all
DROP POLICY IF EXISTS "user_roles_read_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;

CREATE POLICY "user_roles_select_policy"
    ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() OR public.is_super_admin()
    );

CREATE POLICY "user_roles_admin_manage"
    ON public.user_roles
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- project_managers policies: PM sees projects where they are a member, super_admin sees all
DROP POLICY IF EXISTS "pm_read_own" ON public.project_managers;
DROP POLICY IF EXISTS "pm_insert_admin" ON public.project_managers;
DROP POLICY IF EXISTS "pm_manage_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_select_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_insert_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_update_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_delete_policy" ON public.project_managers;

CREATE POLICY "pm_select_policy"
    ON public.project_managers
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() OR public.is_super_admin()
    );

CREATE POLICY "pm_insert_policy"
    ON public.project_managers
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_super_admin() OR public.is_project_owner(event_id)
    );

CREATE POLICY "pm_update_policy"
    ON public.project_managers
    FOR UPDATE
    TO authenticated
    USING (
        public.is_super_admin() OR public.is_project_owner(event_id)
    )
    WITH CHECK (
        public.is_super_admin() OR public.is_project_owner(event_id)
    );

CREATE POLICY "pm_delete_policy"
    ON public.project_managers
    FOR DELETE
    TO authenticated
    USING (
        public.is_super_admin() OR public.is_project_owner(event_id)
    );

