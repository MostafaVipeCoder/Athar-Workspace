// hello-world: LOCAL SMOKE TEST of the edge runtime (db/scripts/dev-functions.sh status). NEVER deploy it: it lives in db/scripts/dev-functions/,
// outside supabase-new/functions, and db/scripts/sync-functions.sh copies it only into the local stack's own workdir.
//
// GET /functions/v1/hello-world            -> { ok, deno, time, env: { NAME: boolean } }       (names and booleans only, never a value)
// GET /functions/v1/hello-world?db=1       -> + { db: { vault, ... } }  a service-role RPC round trip (public.google_storage_capabilities)
//                                              proves: the injected service key works, the function reaches the database through the gateway
// Deployed with the default JWT check: a request without a valid Supabase JWT never reaches this code (the gateway answers 401).
import { createClient } from 'npm:@supabase/supabase-js@2'

// names the runtime injects + the ones db/scripts/dev-functions.sh writes into local-db/functions.env: reported as present / absent only
const NAMES = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APP_URL', 'OAUTH_STATE_SECRET', 'TOKEN_ENC_KEY', 'TOKEN_STORAGE',
  'ALLOW_FAKE_GOOGLE', 'GOOGLE_AUTH_BASE', 'GOOGLE_TOKEN_URL', 'GOOGLE_REVOKE_URL', 'GOOGLE_API_BASE',
]

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const env: Record<string, boolean> = {}
  for (const n of NAMES) env[n] = Boolean(Deno.env.get(n))
  const body: Record<string, unknown> = { ok: true, deno: Deno.version.deno, time: new Date().toISOString(), env }

  if (url.searchParams.get('db') === '1') {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !key) {
      body.db = { ok: false, reason: 'missing_env' }
    } else {
      const client = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data, error } = await client.rpc('google_storage_capabilities')
      body.db = error ? { ok: false, code: error.code ?? null } : { ok: true, capabilities: data }
    }
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
})
