-- ============================================================
-- Mentoring Distribution: Day-by-Day Schedule Configuration
-- Flexible per-day overrides: start time, end time, slot duration, break
-- ============================================================

CREATE TABLE IF NOT EXISTS mentoring_distribution_day_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL,
    day_index INTEGER NOT NULL,
    day_date DATE,
    session_start_time TIME NOT NULL DEFAULT '09:00:00',
    session_end_time TIME,
    total_round_minutes INTEGER,
    slot_duration_minutes INTEGER,
    break_between_slots_minutes INTEGER NOT NULL DEFAULT 0,
    mentor_ids UUID[] DEFAULT '{}'::UUID[],
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_md_day_config_event ON mentoring_distribution_day_config(event_id);
CREATE INDEX IF NOT EXISTS idx_md_day_config_event_day ON mentoring_distribution_day_config(event_id, day_index);

ALTER TABLE mentoring_distribution_day_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for mentoring_distribution_day_config" ON mentoring_distribution_day_config
    FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_md_day_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER md_day_config_updated_at
    BEFORE UPDATE ON mentoring_distribution_day_config
    FOR EACH ROW EXECUTE FUNCTION update_md_day_config_updated_at();
