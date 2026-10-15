-- Migration: Fix user_roles table - Drop role_key and remove redundant sync triggers
-- Fix user_roles schema redundancy and unique constraint handling

-- 1. Update functions referencing role_key
CREATE OR REPLACE FUNCTION public.get_user_roles(p_user_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT COALESCE(ARRAY_AGG(role::text), ARRAY[]::text[])
    FROM public.user_roles
    WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin(check_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = check_user_id
          AND role = 'super_admin'::app_role
    );
$function$;

CREATE OR REPLACE FUNCTION public.has_role(role_name text, check_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = check_user_id
          AND role::text = role_name
    );
$function$;

-- 2. Update events table RLS policies that referenced ur.role_key
DROP POLICY IF EXISTS "events_select_by_pm_or_admin" ON public.events;
CREATE POLICY "events_select_by_pm_or_admin"
    ON public.events
    FOR SELECT
    TO authenticated
    USING (
        (EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'::app_role
        ))
        OR
        (EXISTS (
            SELECT 1 FROM public.project_managers pm
            WHERE pm.event_id = events.event_id AND pm.user_id = auth.uid()
        ))
    );

DROP POLICY IF EXISTS "events_insert_by_pm_or_admin" ON public.events;
CREATE POLICY "events_insert_by_pm_or_admin"
    ON public.events
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['project_manager'::app_role, 'super_admin'::app_role])
        )
    );

DROP POLICY IF EXISTS "events_update_by_owner_or_admin" ON public.events;
CREATE POLICY "events_update_by_owner_or_admin"
    ON public.events
    FOR UPDATE
    TO authenticated
    USING (
        (EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'::app_role
        ))
        OR
        (EXISTS (
            SELECT 1 FROM public.project_managers pm
            WHERE pm.event_id = events.event_id AND pm.user_id = auth.uid() AND pm.role_in_project = 'owner'
        ))
    );

DROP POLICY IF EXISTS "events_delete_by_owner_or_admin" ON public.events;
CREATE POLICY "events_delete_by_owner_or_admin"
    ON public.events
    FOR DELETE
    TO authenticated
    USING (
        (EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'::app_role
        ))
        OR
        (EXISTS (
            SELECT 1 FROM public.project_managers pm
            WHERE pm.event_id = events.event_id AND pm.user_id = auth.uid() AND pm.role_in_project = 'owner'
        ))
    );

-- 3. Drop sync trigger and sync function on user_roles
DROP TRIGGER IF EXISTS trg_sync_user_roles ON public.user_roles;
DROP FUNCTION IF EXISTS public.sync_user_roles_role_columns();

-- 4. Drop role_key column from user_roles
ALTER TABLE public.user_roles DROP COLUMN IF EXISTS role_key CASCADE;
