-- ====================================================
-- Mentoring Distribution Feature Tables
-- ====================================================

-- Table 1: إعدادات التوزيع لكل حدث
CREATE TABLE IF NOT EXISTS mentoring_distribution_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    start_time TIME NOT NULL DEFAULT '09:00:00',      -- وقت بداية اليوم الأول
    num_days INTEGER NOT NULL DEFAULT 1,               -- عدد أيام الحدث (1-3)
    total_round_minutes INTEGER NOT NULL DEFAULT 300,  -- مدة الراوند الكلية بالدقائق (مثال: 300 = 5 ساعات)
    slot_duration_minutes INTEGER NOT NULL DEFAULT 15, -- مدة السلوط الواحد بالدقائق
    break_slots JSONB DEFAULT '[]'::jsonb,             -- فواصل الراحة: [{after_slot: 4, duration_minutes: 15}]
    is_published BOOLEAN NOT NULL DEFAULT false,       -- هل تم نشر الروابط
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id)
);

-- Table 2: جلسات التوزيع المُولَّدة
CREATE TABLE IF NOT EXISTS mentoring_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    day_index INTEGER NOT NULL DEFAULT 0,             -- رقم اليوم (0-based: 0,1,2)
    slot_index INTEGER NOT NULL DEFAULT 0,            -- رقم السلوط (0-based داخل اليوم)
    mentor_id UUID,                                   -- FK إلى جدول mentors (قد يكون null للفواصل)
    mentor_name TEXT,                                 -- اسم المينتور (مخزّن مباشرة للسرعة)
    company_id UUID,                                  -- FK اختياري
    company_name TEXT,                                -- اسم الشركة (مخزّن مباشرة)
    is_break BOOLEAN NOT NULL DEFAULT false,          -- هل هذا سلوط راحة
    has_conflict BOOLEAN NOT NULL DEFAULT false,      -- هل يوجد تعارض لم يُحل
    conflict_reason TEXT,                             -- وصف التعارض إن وُجد
    slot_start_time TIME,                             -- وقت بداية السلوط المحسوب
    slot_end_time TIME,                               -- وقت نهاية السلوط المحسوب
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes للأداء
CREATE INDEX IF NOT EXISTS idx_mentoring_sessions_event ON mentoring_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_mentoring_sessions_day_slot ON mentoring_sessions(event_id, day_index, slot_index);
CREATE INDEX IF NOT EXISTS idx_mentoring_config_event ON mentoring_distribution_config(event_id);

-- RLS Policies
ALTER TABLE mentoring_distribution_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentoring_sessions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (same pattern as other tables)
CREATE POLICY "Allow all for mentoring_config" ON mentoring_distribution_config
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for mentoring_sessions" ON mentoring_sessions
    FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_mentoring_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mentoring_config_updated_at
    BEFORE UPDATE ON mentoring_distribution_config
    FOR EACH ROW EXECUTE FUNCTION update_mentoring_updated_at();

CREATE TRIGGER mentoring_sessions_updated_at
    BEFORE UPDATE ON mentoring_sessions
    FOR EACH ROW EXECUTE FUNCTION update_mentoring_updated_at();
