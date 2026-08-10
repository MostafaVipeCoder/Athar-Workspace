-- Make email column in ather_team_members nullable
ALTER TABLE ather_team_members ALTER COLUMN email DROP NOT NULL;
