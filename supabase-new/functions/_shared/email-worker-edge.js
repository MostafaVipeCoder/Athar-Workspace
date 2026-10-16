// Wiring of the email-worker for the Edge Runtime, still free of Deno-only APIs: the entry point passes `Deno.env`, supabase-js' `createClient` and
// `createEdgeRuntime` (google-edge.js). The handler is dependency-injected so tests/email-worker-edge.test.js drives it with fakes.
//
//   POST /functions/v1/email-worker      headers: x-worker-secret: <EMAIL_WORKER_SECRET>   (or Authorization: Bearer <service role key>)
//   body (all optional, numbers only, they can only LOWER the configured limits): { maxMessages, maxRunSeconds, perMinute, dailyCap, batch }
//   -> 200 { ...summary }   401 unauthorized   405 method_not_allowed   503 not_configured { missing: [env NAMES] }
//
// The gateway JWT check is OFF for this function (verify_jwt = false, like image-convert and the Google callback): the caller is the database (pg_net) or
// a script, neither holds a user session. The function therefore checks its own secret FIRST and refuses everything else (fail closed). No recipient, subject
// or body is accepted from the request: every message is built from the row the database claimed.

import { ConfigError } from './google-core.js'
import { sendGmailMessage } from './google-api.js'
import { WORKER_DEFAULTS, authorizeWorkerRequest, createEmailDb, runEmailWorker } from './email-worker.js'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

const intOr = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}
const lower = (requested, ceiling) => (requested === undefined || requested === null ? ceiling : Math.min(ceiling, intOr(requested, ceiling)))

/** The run options: the environment sets the ceilings, a request body can only lower them. */
export function resolveOptions(body, env) {
  const get = (n) => (typeof env.get === 'function' ? env.get(n) : env[n])
  const ceilings = {
    perMinute: Math.min(60, intOr(get('EMAIL_PER_MINUTE'), WORKER_DEFAULTS.perMinute)),
    dailyCap: Math.min(1900, intOr(get('EMAIL_DAILY_CAP'), WORKER_DEFAULTS.dailyCap)),
    maxRunMs: Math.min(140, intOr(get('EMAIL_MAX_RUN_SECONDS'), WORKER_DEFAULTS.maxRunMs / 1000)) * 1000,
    maxMessages: WORKER_DEFAULTS.maxMessages,
    batchLimit: WORKER_DEFAULTS.batchLimit,
  }
  const b = body && typeof body === 'object' ? body : {}
  return {
    perMinute: lower(b.perMinute, ceilings.perMinute),
    dailyCap: lower(b.dailyCap, ceilings.dailyCap),
    maxRunMs: lower(b.maxRunSeconds === undefined ? undefined : intOr(b.maxRunSeconds, 5) * 1000, ceilings.maxRunMs),
    maxMessages: lower(b.maxMessages, ceilings.maxMessages),
    batchLimit: lower(b.batch, ceilings.batchLimit),
  }
}

export function createEmailWorkerHandler({ env, createClient, createEdgeRuntime, fetch: fetchImpl = fetch, now = () => Date.now(), sleep, log } = {}) {
  const get = (n) => (typeof env.get === 'function' ? env.get(n) : env[n])
  return async function handle(req) {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const auth = await authorizeWorkerRequest(req.headers, { workerSecret: get('EMAIL_WORKER_SECRET'), serviceKey: get('SUPABASE_SERVICE_ROLE_KEY') })
    if (auth === 'not_configured') return json(503, { error: 'not_configured', missing: ['EMAIL_WORKER_SECRET'] })
    if (auth !== 'ok') return json(401, { error: 'unauthorized' })

    let body = {}
    try {
      const text = await req.text()
      if (text.length > 2000) return json(400, { error: 'bad_request' })
      body = text ? JSON.parse(text) : {}
    } catch {
      return json(400, { error: 'bad_request' })
    }

    let runtime
    let client
    try {
      const url = get('SUPABASE_URL')
      const key = get('SUPABASE_SERVICE_ROLE_KEY')
      if (!url || !key) throw new ConfigError('missing_env', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
      client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      runtime = createEdgeRuntime({ env, createClient, fetch: fetchImpl, now, log })
      runtime.getConfig() // the Google configuration must be complete before anything is claimed
    } catch (e) {
      if (e instanceof ConfigError) return json(503, { error: 'not_configured', missing: e.missing ?? [] })
      return json(500, { error: 'server_error' })
    }

    const cfg = runtime.getConfig()
    const db = createEmailDb(client, { markConnection: runtime.db.markConnection, touchConnection: runtime.db.touchConnection })
    const workerId = `ew-${crypto.randomUUID()}`
    const summary = await runEmailWorker(
      { db, tokens: runtime.accessTokens(), send: (token, raw) => sendGmailMessage(cfg, token, raw, { fetch: fetchImpl }), now, sleep, log, workerId },
      resolveOptions(body, env),
    )
    return json(200, summary)
  }
}
