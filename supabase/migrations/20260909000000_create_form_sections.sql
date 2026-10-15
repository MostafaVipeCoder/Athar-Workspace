-- 20260909000000_create_form_sections.sql
-- Fix for 404 on form_sections table

-- 1. Create form_sections table
CREATE TABLE IF NOT EXISTS public.form_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.event_forms(form_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add section_id to form_field_configs (NULL represents root-level questions)
ALTER TABLE public.form_field_configs 
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.form_sections(id) ON DELETE SET NULL;

-- 3. Create indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_form_sections_form_id ON public.form_sections(form_id);
CREATE INDEX IF NOT EXISTS idx_form_sections_order ON public.form_sections(order_index ASC);
CREATE INDEX IF NOT EXISTS idx_form_field_configs_section_id ON public.form_field_configs(section_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.form_sections ENABLE ROW LEVEL SECURITY;

-- 5. Policies: Allow access for public/authenticated users
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_sections' AND policyname = 'Public select form_sections') THEN
        CREATE POLICY "Public select form_sections" ON public.form_sections FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_sections' AND policyname = 'Public all form_sections') THEN
        CREATE POLICY "Public all form_sections" ON public.form_sections FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
