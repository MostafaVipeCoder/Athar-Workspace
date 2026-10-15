// google-oauth-callback (design 07 section 1.4): Google redirects the browser here (a public GET, so deploy it with
// --no-verify-jwt / `verify_jwt = false`; the signed single-use `state` is the protection). It exchanges the code (PKCE), checks
// the ID token (verified e-mail, hosted domain athareg.com), stores the refresh token (Vault or AES-256-GCM), upserts
// google_connections and redirects to the app: ?google=connected | ?google=error&reason=<one of a fixed list>.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createEdgeRuntime } from '../_shared/google-edge.js'

const runtime = createEdgeRuntime({ env: Deno.env, createClient })
Deno.serve((req: Request) => runtime.callback(req))
