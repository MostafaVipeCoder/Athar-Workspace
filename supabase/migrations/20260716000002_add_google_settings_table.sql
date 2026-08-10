-- Create google_settings table to store Google API credentials
CREATE TABLE IF NOT EXISTS google_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT,
    service_account_key TEXT,
    calendar_id TEXT DEFAULT 'primary',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for event_id
CREATE INDEX IF NOT EXISTS idx_google_settings_event_id ON google_settings(event_id);

-- Enable RLS
ALTER TABLE google_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (adjust according to your auth setup)
CREATE POLICY "Allow public read access to google_settings"
    ON google_settings FOR SELECT
    USING (true);

CREATE POLICY "Allow public insert access to google_settings"
    ON google_settings FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow public update access to google_settings"
    ON google_settings FOR UPDATE
    USING (true);
