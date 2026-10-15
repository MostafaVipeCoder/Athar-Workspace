-- Migration: Athar Alumni Platform Phase 1 (Auth, Invitations, Unified Companies)

-- 1. Create alumni_invitations table
CREATE TABLE IF NOT EXISTS alumni_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    founder_email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    accepted_at TIMESTAMPTZ,
    sent_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_alumni_invitations_token ON alumni_invitations(token);
CREATE INDEX IF NOT EXISTS idx_alumni_invitations_company ON alumni_invitations(company_id);

-- 2. Add auth_user_id to founders if not exists
ALTER TABLE founders ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_founders_auth_user_id ON founders(auth_user_id);

-- 3. Enable RLS on alumni_invitations
ALTER TABLE alumni_invitations ENABLE ROW LEVEL SECURITY;

-- Allow public to read invitation by token for validation (during signup)
CREATE POLICY "Allow public read invitation by token"
    ON alumni_invitations FOR SELECT
    USING (true);

-- Allow authenticated admins to insert/update invitations
CREATE POLICY "Allow auth users to manage invitations"
    ON alumni_invitations FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
