
-- Add start_time, end_time, mentor_name, mentor_email to bookings table
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS start_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS end_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS mentor_name TEXT,
ADD COLUMN IF NOT EXISTS mentor_email TEXT;

-- Add start_time, end_time, mentor_name, mentor_email to ather_team_bookings table
ALTER TABLE ather_team_bookings 
ADD COLUMN IF NOT EXISTS start_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS end_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS mentor_name TEXT,
ADD COLUMN IF NOT EXISTS mentor_email TEXT;
