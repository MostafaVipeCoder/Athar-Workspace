-- Add impersonate_email column to google_settings table
ALTER TABLE google_settings ADD COLUMN IF NOT EXISTS impersonate_email TEXT;
