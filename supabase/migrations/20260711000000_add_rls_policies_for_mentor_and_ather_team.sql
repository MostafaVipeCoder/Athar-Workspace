-- Add RLS policies for mentors table
CREATE POLICY "Allow authenticated users to insert mentors" 
    ON mentors FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update mentors" 
    ON mentors FOR UPDATE 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete mentors" 
    ON mentors FOR DELETE 
    USING (auth.role() = 'authenticated');

-- Add RLS policies for mentor_slots table
CREATE POLICY "Allow authenticated users to insert mentor_slots" 
    ON mentor_slots FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update mentor_slots" 
    ON mentor_slots FOR UPDATE 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete mentor_slots" 
    ON mentor_slots FOR DELETE 
    USING (auth.role() = 'authenticated');

-- Add RLS policies for bookings table
CREATE POLICY "Allow authenticated users to read bookings" 
    ON bookings FOR SELECT 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update bookings" 
    ON bookings FOR UPDATE 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete bookings" 
    ON bookings FOR DELETE 
    USING (auth.role() = 'authenticated');

-- Add RLS policies for ather_team_members table
CREATE POLICY "Allow authenticated users to insert ather_team_members" 
    ON ather_team_members FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update ather_team_members" 
    ON ather_team_members FOR UPDATE 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete ather_team_members" 
    ON ather_team_members FOR DELETE 
    USING (auth.role() = 'authenticated');

-- Add RLS policies for ather_team_slots table
CREATE POLICY "Allow authenticated users to insert ather_team_slots" 
    ON ather_team_slots FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update ather_team_slots" 
    ON ather_team_slots FOR UPDATE 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete ather_team_slots" 
    ON ather_team_slots FOR DELETE 
    USING (auth.role() = 'authenticated');

-- Add RLS policies for ather_team_bookings table
CREATE POLICY "Allow authenticated users to read ather_team_bookings" 
    ON ather_team_bookings FOR SELECT 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update ather_team_bookings" 
    ON ather_team_bookings FOR UPDATE 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete ather_team_bookings" 
    ON ather_team_bookings FOR DELETE 
    USING (auth.role() = 'authenticated');
