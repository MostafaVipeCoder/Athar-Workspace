-- Create ather_team_members table
CREATE TABLE IF NOT EXISTS ather_team_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    photo_url TEXT,
    bio TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add a unique index that only applies when email is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_ather_team_members_event_id_email 
    ON ather_team_members (event_id, email) 
    WHERE email IS NOT NULL;

-- Create ather_team_slots table
CREATE TABLE IF NOT EXISTS ather_team_slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ather_team_member_id UUID NOT NULL REFERENCES ather_team_members(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create ather_team_bookings table
CREATE TABLE IF NOT EXISTS ather_team_bookings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slot_id UUID NOT NULL REFERENCES ather_team_slots(id) ON DELETE CASCADE,
    ather_team_member_id UUID NOT NULL REFERENCES ather_team_members(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    submission_id TEXT, -- Optional: link to company submission in selection process
    booker_email TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ather_team_slots_member_id ON ather_team_slots(ather_team_member_id);
CREATE INDEX IF NOT EXISTS idx_ather_team_slots_start_time ON ather_team_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_ather_team_bookings_slot_id ON ather_team_bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_ather_team_bookings_member_id ON ather_team_bookings(ather_team_member_id);

-- Enable Row Level Security (RLS) for security
ALTER TABLE ather_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ather_team_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ather_team_bookings ENABLE ROW LEVEL SECURITY;

-- Create policies (adjust as needed for your auth setup)
CREATE POLICY "Allow public read access to ather team members" 
    ON ather_team_members FOR SELECT 
    USING (true);

CREATE POLICY "Allow public read access to available ather team slots" 
    ON ather_team_slots FOR SELECT 
    USING (true);

CREATE POLICY "Allow public to create ather team bookings" 
    ON ather_team_bookings FOR INSERT 
    WITH CHECK (true);
