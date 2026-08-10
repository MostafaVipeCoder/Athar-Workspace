
-- Add INSERT policy for bookings table (allow anonymous users too for public booking)
CREATE POLICY "Allow everyone to insert bookings"
    ON bookings FOR INSERT
    WITH CHECK (true);

-- Add INSERT policy for ather_team_bookings table (allow anonymous users too for public booking)
CREATE POLICY "Allow everyone to insert ather_team_bookings"
    ON ather_team_bookings FOR INSERT
    WITH CHECK (true);
