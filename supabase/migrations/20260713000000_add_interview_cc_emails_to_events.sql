
ALTER TABLE events ADD COLUMN IF NOT EXISTS interview_cc_emails TEXT[] DEFAULT '{}'::TEXT[];
