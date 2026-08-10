-- ====================================================
-- Mentor Booking: Day-by-Day Schedule Configuration
-- يسمح بتحديد إعدادات مختلفة لكل يوم من أيام الجلسات التوجيهية
-- ====================================================

CREATE TABLE IF NOT EXISTS mentor_day_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    day_number INTEGER NOT NULL,
    day_date DATE,
    session_start_time TIME NOT NULL DEFAULT '09:00:00',
    session_end_time TIME NOT NULL DEFAULT '17:00:00',
    slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
    break_between_slots_minutes INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, day_number)
);

CREATE INDEX IF NOT EXISTS idx_mentor_day_config_event ON mentor_day_config(event_id);
CREATE INDEX IF NOT EXISTS idx_mentor_day_config_event_day ON mentor_day_config(event_id, day_number);

ALTER TABLE mentor_day_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for mentor_day_config" ON mentor_day_config
    FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_mentor_day_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mentor_day_config_updated_at
    BEFORE UPDATE ON mentor_day_config
    FOR EACH ROW EXECUTE FUNCTION update_mentor_day_config_updated_at();
