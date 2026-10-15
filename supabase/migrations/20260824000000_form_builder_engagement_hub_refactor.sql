-- 20260824000000_form_builder_engagement_hub_refactor.sql
-- Form Builder Refactor to Engagement Hub Architecture

-- 1. Create form_covers table for independent cover entity management
CREATE TABLE IF NOT EXISTS public.form_covers (
    cover_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(event_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Extend event_forms table with new Engagement Hub settings
ALTER TABLE public.event_forms 
    ADD COLUMN IF NOT EXISTS cover_id UUID REFERENCES public.form_covers(cover_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
    ADD COLUMN IF NOT EXISTS thank_you_message TEXT,
    ADD COLUMN IF NOT EXISTS thank_you_image_url TEXT,
    ADD COLUMN IF NOT EXISTS show_thank_you_image BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS share_title TEXT,
    ADD COLUMN IF NOT EXISTS share_description TEXT,
    ADD COLUMN IF NOT EXISTS share_image_url TEXT,
    ADD COLUMN IF NOT EXISTS social_channels_config JSONB DEFAULT '{"facebook": true, "whatsapp": true, "linkedin": true, "instagram": true, "telegram": true, "custom": []}'::jsonb,
    ADD COLUMN IF NOT EXISTS integrations JSONB DEFAULT '{"selection_process": false, "companies_list": false, "attendees_list": false}'::jsonb,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS form_name_ar TEXT;

-- 3. Create independent form_responses table
CREATE TABLE IF NOT EXISTS public.form_responses (
    response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.event_forms(form_id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
    source TEXT DEFAULT 'direct',
    tracking_data JSONB DEFAULT '{}'::jsonb,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'submitted',
    submitted_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create form_share_events table for tracking share button clicks
CREATE TABLE IF NOT EXISTS public.form_share_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.event_forms(form_id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    clicked_at TIMESTAMPTZ DEFAULT now(),
    user_agent TEXT
);

-- Enable RLS and setup public/authenticated access policies
ALTER TABLE public.form_covers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_share_events ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    -- form_covers policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_covers' AND policyname = 'Public read form_covers') THEN
        CREATE POLICY "Public read form_covers" ON public.form_covers FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_covers' AND policyname = 'Public all form_covers') THEN
        CREATE POLICY "Public all form_covers" ON public.form_covers FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- form_responses policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'Public insert form_responses') THEN
        CREATE POLICY "Public insert form_responses" ON public.form_responses FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'Public select form_responses') THEN
        CREATE POLICY "Public select form_responses" ON public.form_responses FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'Public all form_responses') THEN
        CREATE POLICY "Public all form_responses" ON public.form_responses FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- form_share_events policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_share_events' AND policyname = 'Public insert form_share_events') THEN
        CREATE POLICY "Public insert form_share_events" ON public.form_share_events FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_share_events' AND policyname = 'Public select form_share_events') THEN
        CREATE POLICY "Public select form_share_events" ON public.form_share_events FOR SELECT USING (true);
    END IF;
END $$;
