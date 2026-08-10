-- Migration: Add unique_pairing and mentor_availability to mentoring_distribution_config

ALTER TABLE mentoring_distribution_config
ADD COLUMN IF NOT EXISTS unique_pairing BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS mentor_availability JSONB DEFAULT '{}'::jsonb;
