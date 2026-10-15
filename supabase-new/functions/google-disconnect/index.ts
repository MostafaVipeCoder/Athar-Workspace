// google-disconnect (design 07 section 1.4): an AUTHENTICATED user disconnects THEIR connection (`system: true` = the startups@
// sender, super_admin only). Best-effort revoke at Google, then the database deletes the stored secret and marks the row revoked.
// POST { system?: boolean } -> { ok, disconnected, revoked_at_google }. Deploy WITH JWT verification (the default).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createEdgeRuntime } from '../_shared/google-edge.js'

const runtime = createEdgeRuntime({ env: Deno.env, createClient })
Deno.serve((req: Request) => runtime.disconnect(req))
