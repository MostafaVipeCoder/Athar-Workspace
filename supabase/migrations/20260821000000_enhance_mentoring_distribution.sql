-- Migration: Enhance Mentoring Distribution with Day Finalization, Timer State, and Manual Overrides
-- Date: 2026-08-21

ALTER TABLE public.mentoring_distribution_config 
ADD COLUMN IF NOT EXISTS finalized_days INTEGER[] DEFAULT '{}'::INTEGER[],
ADD COLUMN IF NOT EXISTS timer_state JSONB DEFAULT NULL;

ALTER TABLE public.mentoring_sessions 
ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT false;
