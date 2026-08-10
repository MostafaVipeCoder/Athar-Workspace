-- Migration: Add acceptance email settings to events table
-- Date: 2026-07-21

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS acceptance_admin_emails TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS acceptance_cc_emails TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS acceptance_email_template_subject TEXT,
    ADD COLUMN IF NOT EXISTS acceptance_email_template_body TEXT;
