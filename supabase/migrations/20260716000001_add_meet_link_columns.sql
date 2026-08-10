-- Add meet_link column to mentor_slots table
ALTER TABLE mentor_slots ADD COLUMN IF NOT EXISTS meet_link TEXT;

-- Add meet_link column to ather_team_slots table
ALTER TABLE ather_team_slots ADD COLUMN IF NOT EXISTS meet_link TEXT;

-- Add meet_link column to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS meet_link TEXT;

-- Add meet_link column to ather_team_bookings table
ALTER TABLE ather_team_bookings ADD COLUMN IF NOT EXISTS meet_link TEXT;
