-- ============================================================
-- Fix Infinite Recursion in project_managers RLS
-- ============================================================

-- 1. Helper function to check if user is a manager or owner of a project (SECURITY DEFINER = NO RLS recursion)
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

-- 2. Clean up problematic policies on project_managers
DROP POLICY IF EXISTS "pm_manage_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_select_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_insert_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_update_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_delete_policy" ON public.project_managers;
DROP POLICY IF EXISTS "pm_read_own" ON public.project_managers;
DROP POLICY IF EXISTS "pm_insert_admin" ON public.project_managers;

-- 3. Simple, non-recursive SELECT policy for project_managers
-- A user can see their own memberships, and super_admin can see all
CREATE POLICY "pm_select_policy"
    ON public.project_managers
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() OR public.is_super_admin()
    );

-- 4. INSERT/UPDATE/DELETE policies using SECURITY DEFINER functions (ZERO recursion)
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
