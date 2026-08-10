-- Add unique constraint on event_id for google_settings table
ALTER TABLE google_settings DROP CONSTRAINT IF EXISTS google_settings_event_id_key;
ALTER TABLE google_settings ADD CONSTRAINT google_settings_event_id_key UNIQUE (event_id);
