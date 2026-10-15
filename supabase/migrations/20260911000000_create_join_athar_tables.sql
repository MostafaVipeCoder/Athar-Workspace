-- 20260911000000_create_join_athar_tables.sql
-- Tables for "Join Athar" landing page, cards, presets, and analytics

-- 1. Table: join_athar_pages
CREATE TABLE IF NOT EXISTS public.join_athar_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL,
    cover_url TEXT,
    main_title TEXT NOT NULL DEFAULT 'Join Athar',
    layout_columns INTEGER NOT NULL DEFAULT 3,
    canvas_background_url TEXT,
    canvas_overlay_position JSONB DEFAULT '{"x": 100, "y": 100, "width": 200, "height": 200}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_id)
);

-- 2. Table: join_athar_cards
CREATE TABLE IF NOT EXISTS public.join_athar_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.join_athar_pages(id) ON DELETE CASCADE,
    image_url TEXT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT,
    button_text TEXT NOT NULL DEFAULT 'Join Now',
    button_url TEXT NOT NULL DEFAULT '#',
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Table: join_athar_share_presets
CREATE TABLE IF NOT EXISTS public.join_athar_share_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.join_athar_pages(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    preset_message TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(page_id, platform)
);

-- 4. Table: join_athar_analytics
CREATE TABLE IF NOT EXISTS public.join_athar_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.join_athar_pages(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'tab_view' | 'card_share' | 'image_upload' | 'image_download'
    card_id UUID REFERENCES public.join_athar_cards(id) ON DELETE SET NULL,
    platform TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_join_athar_pages_project_id ON public.join_athar_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_join_athar_cards_page_id ON public.join_athar_cards(page_id);
CREATE INDEX IF NOT EXISTS idx_join_athar_cards_order ON public.join_athar_cards(order_index ASC);
CREATE INDEX IF NOT EXISTS idx_join_athar_presets_page ON public.join_athar_share_presets(page_id);
CREATE INDEX IF NOT EXISTS idx_join_athar_analytics_page ON public.join_athar_analytics(page_id);
CREATE INDEX IF NOT EXISTS idx_join_athar_analytics_type ON public.join_athar_analytics(event_type);

-- Row Level Security (RLS)
ALTER TABLE public.join_athar_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_athar_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_athar_share_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_athar_analytics ENABLE ROW LEVEL SECURITY;

-- Allow public read & write (standard pattern used in the project)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'join_athar_pages' AND policyname = 'Public access join_athar_pages') THEN
        CREATE POLICY "Public access join_athar_pages" ON public.join_athar_pages FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'join_athar_cards' AND policyname = 'Public access join_athar_cards') THEN
        CREATE POLICY "Public access join_athar_cards" ON public.join_athar_cards FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'join_athar_share_presets' AND policyname = 'Public access join_athar_share_presets') THEN
        CREATE POLICY "Public access join_athar_share_presets" ON public.join_athar_share_presets FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'join_athar_analytics' AND policyname = 'Public access join_athar_analytics') THEN
        CREATE POLICY "Public access join_athar_analytics" ON public.join_athar_analytics FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
