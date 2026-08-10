-- Fix: Ensure unique constraint exists on mentoring_distribution_config.event_id
-- PostgREST requires this for upsert with on_conflict=event_id to work (otherwise returns 400)

DO $$
BEGIN
    -- Add unique constraint if it does not already exist
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'mentoring_distribution_config'::regclass
          AND contype = 'u'
          AND conname = 'mentoring_distribution_config_event_id_key'
    ) THEN
        ALTER TABLE mentoring_distribution_config
        ADD CONSTRAINT mentoring_distribution_config_event_id_key UNIQUE (event_id);
    END IF;
END$$;

-- Also ensure the two columns from the previous migration exist (idempotent safety)
ALTER TABLE mentoring_distribution_config
    ADD COLUMN IF NOT EXISTS unique_pairing BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS mentor_availability JSONB DEFAULT '{}'::jsonb;
