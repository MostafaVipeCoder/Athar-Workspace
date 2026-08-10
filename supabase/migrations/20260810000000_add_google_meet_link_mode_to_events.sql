-- Add meeting_link_mode and shared_google_meet_link columns to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS meeting_link_mode TEXT DEFAULT 'unique';
ALTER TABLE events ADD COLUMN IF NOT EXISTS shared_google_meet_link TEXT DEFAULT '';
