-- Migration: Add Programs table and link events to programs
-- Date: 2026-07-21

-- 1. Create programs table
CREATE TABLE IF NOT EXISTS programs (
    program_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add program_id column to events (nullable for backward compatibility)
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(program_id) ON DELETE SET NULL;

-- 3. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_events_program_id ON events(program_id);

-- 4. RLS Policies for programs table
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to read programs"
    ON programs FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to insert programs"
    ON programs FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to update programs"
    ON programs FOR UPDATE
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to delete programs"
    ON programs FOR DELETE
    USING (auth.role() = 'authenticated');

-- 5. Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_programs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS programs_updated_at ON programs;
CREATE TRIGGER programs_updated_at
    BEFORE UPDATE ON programs
    FOR EACH ROW
    EXECUTE FUNCTION update_programs_updated_at();
