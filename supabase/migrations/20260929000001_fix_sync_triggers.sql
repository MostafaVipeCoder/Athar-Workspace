-- ============================================================
-- Fix: Trigger Synchronization logic for user_roles and project_managers
-- Problem: Triggers did not distinguish which column was updated during an UPDATE,
-- causing edits to role_key or project_id in Supabase Studio to be overwritten
-- by the unchanged column back to their previous value.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_user_roles_role_columns()
RETURNS TRIGGER AS $$
DECLARE
    normalized_key text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- If role_key changed, normalize and sync role
        IF NEW.role_key IS DISTINCT FROM OLD.role_key THEN
            normalized_key := CASE 
                WHEN NEW.role_key = 'alumni_admin' THEN 'alumni_manager'
                ELSE NEW.role_key
            END;
            NEW.role_key := normalized_key;
            NEW.role := normalized_key::app_role;
        -- If role changed, sync role_key
        ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
            NEW.role_key := NEW.role::text;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.role_key IS NOT NULL THEN
            normalized_key := CASE 
                WHEN NEW.role_key = 'alumni_admin' THEN 'alumni_manager'
                ELSE NEW.role_key
            END;
            NEW.role_key := normalized_key;
            IF NEW.role IS NULL THEN
                NEW.role := normalized_key::app_role;
            END IF;
        ELSIF NEW.role IS NOT NULL THEN
            NEW.role_key := NEW.role::text;
        END IF;
    END IF;

    NEW.updated_at := timezone('utc'::text, now());

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
