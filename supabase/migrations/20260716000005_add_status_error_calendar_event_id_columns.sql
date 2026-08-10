-- Add status and error_message columns to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

-- Add status and error_message columns to ather_team_bookings table
ALTER TABLE ather_team_bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE ather_team_bookings ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE ather_team_bookings ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;
