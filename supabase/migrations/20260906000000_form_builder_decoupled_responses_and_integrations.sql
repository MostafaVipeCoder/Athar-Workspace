-- 20260906000000_form_builder_decoupled_responses_and_integrations.sql
-- Form Builder Refactor: Decoupled Single Source of Truth & Multi-Channel Integrations

-- 1. Ensure form_responses table exists and is fully decoupled
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

-- Ensure indexes for fast querying in Responses Tab
CREATE INDEX IF NOT EXISTS idx_form_responses_form_id ON public.form_responses(form_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_event_id ON public.form_responses(event_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_submitted_at ON public.form_responses(submitted_at DESC);

-- Enable RLS and setup public insert/read policies
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'Public insert form_responses') THEN
        CREATE POLICY "Public insert form_responses" ON public.form_responses FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'Public select form_responses') THEN
        CREATE POLICY "Public select form_responses" ON public.form_responses FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'Public all form_responses') THEN
        CREATE POLICY "Public all form_responses" ON public.form_responses FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
