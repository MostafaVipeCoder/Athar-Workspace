// google-oauth-start (design 07 section 1.4): an AUTHENTICATED staff user asks for the Google consent URL.
// POST { system?: boolean, returnTo?: "/profile" } -> { url }. The URL carries a signed, single-use state (HMAC over user id +
// nonce + PKCE challenge + expiry); `system: true` (the startups@ sender) is for super_admin only and is re-checked in the database.
// Deploy WITH JWT verification (the default). Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, APP_URL,
// OAUTH_STATE_SECRET, TOKEN_ENC_KEY (when Vault is not used); see docs/design/10-google-integration-setup.md.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createEdgeRuntime } from '../_shared/google-edge.js'

const runtime = createEdgeRuntime({ env: Deno.env, createClient })
Deno.serve((req: Request) => runtime.start(req))
