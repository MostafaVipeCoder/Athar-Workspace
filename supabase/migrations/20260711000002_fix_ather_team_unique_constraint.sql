-- Drop the existing unique constraint on (event_id, email)
ALTER TABLE ather_team_members DROP CONSTRAINT IF EXISTS ather_team_members_event_id_email_key;

-- Add a new unique constraint that only applies when email is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_ather_team_members_event_id_email 
    ON ather_team_members (event_id, email) 
    WHERE email IS NOT NULL;
