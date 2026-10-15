// calendar-sync (design 07 section 2.2; migration m63): the ONE server-side path to Google Calendar / Meet for Booking nodes.
//
//   POST /functions/v1/calendar-sync          (the SERVICE ROLE key only: called by pg_cron / pg_net every minute, or by an operator)
//   -> { ok: true, mode, claimed, done, skipped, retried, parked, dead, deferred, lease_lost, shadowed, errors }   (counts only, no names, no addresses)
//
// What it does depends on public.calendar_sync_config.mode (set by a super_admin in the Booking settings, default `shadow`):
//   off     nothing is claimed
//   shadow  every pending calendar job is PLANNED (the same code path as live) and the plan is written to calendar_sync_log; NO Google endpoint is called
//           (not even the token endpoint), no job is locked or completed: the Apps Script poller can keep working next to it
//   live    jobs are claimed (SKIP LOCKED + a lease, one job per booking at a time), the event is inserted (id = the booking id in hex: a repeat adopts the
//           existing event), patched or deleted AS the booking's calendar owner (the PM's own Google account, else the startups@ system sender), the Meet
//           link and the owner are written back, failures are classified (retry with backoff / dead / parked until a Google account is connected)
// The logic is in ../_shared/calendar-sync.js (pure, tested with `node --test`); the database side is db/migrations/m63_calendar_sync.sql.
// Deploy WITH JWT verification (the default) and keep the caller check below: the gateway accepts any valid JWT, including the public anon key.
// Env: the Google variables of db/scripts/fake-google/functions.env.example (only needed in live mode); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createEdgeRuntime } from '../_shared/google-edge.js'
import { ConfigError, safeLog } from '../_shared/google-core.js'
import { createCalendarDb, createCalendarWorker, isServiceCall } from '../_shared/calendar-sync.js'

const runtime = createEdgeRuntime({ env: Deno.env, createClient })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!isServiceCall(req, Deno.env)) return json(401, { error: 'unauthenticated' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json(500, { error: 'not_configured', missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] })
  let body: { limit?: number; budgetMs?: number } = {}
  try { body = await req.json() } catch { /* an empty body is fine */ }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const worker = createCalendarWorker({
    db: createCalendarDb({ rpc: (...a: unknown[]) => (client.rpc as (...x: unknown[]) => unknown)(...a) as never }),
    getConfig: () => runtime.getConfig(),
    getTokens: () => runtime.accessTokens(),
    touchConnection: (id: string) => runtime.db.touchConnection(id),
    markConnection: (id: string, status: string, code: string) => runtime.db.markConnection(id, status, code),
  })
  try {
    const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit as number, 1), 50) : undefined
    const budgetMs = Number.isInteger(body.budgetMs) ? Math.min(Math.max(body.budgetMs as number, 1000), 120_000) : undefined
    const summary = await worker.runOnce({ ...(limit ? { limit } : {}), ...(budgetMs ? { budgetMs } : {}) })
    return json(200, { ok: true, ...summary })
  } catch (e) {
    if (e instanceof ConfigError) return json(500, { error: 'not_configured', missing: e.missing }) // variable NAMES only
    safeLog('calendar_sync_failed', { reason: (e as { token?: string; code?: string })?.token ?? (e as { code?: string })?.code ?? 'internal_error' })
    return json(500, { error: 'server_error' })
  }
})
