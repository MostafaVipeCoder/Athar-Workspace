-- 20260907000000_create_library_forms.sql
-- Central Form Library (مكتبة الفورمز المركزية) Architecture
-- Project-independent repository for reusable, live form assets with scope, cloning, and aggregated response tracking.

-- 1. Create library_forms table
CREATE TABLE IF NOT EXISTS public.library_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_name TEXT NOT NULL,
    form_name_ar TEXT,
    description TEXT,
    target_module TEXT DEFAULT 'selection_process',
    scope TEXT DEFAULT 'global' CHECK (scope IN ('global', 'specific')),
    event_id UUID REFERENCES public.events(event_id) ON DELETE SET NULL,
    fields JSONB DEFAULT '[]'::jsonb,
    cover_id UUID REFERENCES public.form_covers(cover_id) ON DELETE SET NULL,
    cover_image_url TEXT,
    thank_you_message TEXT,
    thank_you_image_url TEXT,
    show_thank_you_image BOOLEAN DEFAULT true,
    share_title TEXT,
    share_description TEXT,
    share_image_url TEXT,
    social_channels_config JSONB DEFAULT '{"facebook": true, "whatsapp": true, "linkedin": true, "instagram": true, "telegram": true, "custom": []}'::jsonb,
    integrations JSONB DEFAULT '{"selection_process": false, "companies_list": false, "mentors_list": false}'::jsonb,
    import_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add library_form_id to event_forms to track origin & live linking
ALTER TABLE public.event_forms 
    ADD COLUMN IF NOT EXISTS library_form_id UUID REFERENCES public.library_forms(id) ON DELETE SET NULL;

-- 3. Add library_form_id to form_responses to enable platform-wide response aggregation in the Library
ALTER TABLE public.form_responses 
    ADD COLUMN IF NOT EXISTS library_form_id UUID REFERENCES public.library_forms(id) ON DELETE SET NULL;

-- 4. Create indexes for high-performance querying
CREATE INDEX IF NOT EXISTS idx_library_forms_scope ON public.library_forms(scope);
CREATE INDEX IF NOT EXISTS idx_library_forms_event_id ON public.library_forms(event_id);
CREATE INDEX IF NOT EXISTS idx_event_forms_library_form_id ON public.event_forms(library_form_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_library_form_id ON public.form_responses(library_form_id);

-- 5. Enable Row Level Security and configure access policies
ALTER TABLE public.library_forms ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_forms' AND policyname = 'Public select library_forms') THEN
        CREATE POLICY "Public select library_forms" ON public.library_forms FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_forms' AND policyname = 'Public insert library_forms') THEN
        CREATE POLICY "Public insert library_forms" ON public.library_forms FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_forms' AND policyname = 'Public update library_forms') THEN
        CREATE POLICY "Public update library_forms" ON public.library_forms FOR UPDATE USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_forms' AND policyname = 'Public delete library_forms') THEN
        CREATE POLICY "Public delete library_forms" ON public.library_forms FOR DELETE USING (true);
    END IF;
END $$;
