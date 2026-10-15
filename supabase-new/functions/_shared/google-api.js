// Thin Gmail + Calendar REST wrappers (design 07 sections 1.6 and 2.2) on top of google-core's httpRequest: strict timeouts,
// one error type (GoogleError), base URL from the CONFIG (env only). No retries here: the callers (the e-mail worker and the
// calendar sync, later migrations) own backoff, because they own the job state. Every function takes the access token as a
// plain argument and never logs it.

import { GoogleError, classifyApiError, httpRequest } from './google-core.js'
import { extractMeetLink, conferenceStatus } from './google-calendar.js'

const auth = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/json' })
const jsonHeaders = (token) => ({ ...auth(token), 'content-type': 'application/json; charset=utf-8' })

function qs(query = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined && v !== '' && v !== 0) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

function need(token) {
  if (typeof token !== 'string' || !token) throw new GoogleError('unauthorized', { status: 401 })
}

// ------------------------------------------------------------------------------------------------ Gmail
/**
 * users.messages.send. `raw` = the base64url message from makeMimeMessage. -> { id, threadId }.
 * A timeout or a connection reset AFTER the request left means Gmail may have accepted it: the thrown GoogleError has
 * outcomeUnknown = true and the caller must NOT resend automatically (the e-mail worker parks the row as needs_review).
 */
export async function sendGmailMessage(cfg, accessToken, raw, { fetch: fetchImpl = fetch } = {}) {
  need(accessToken)
  if (typeof raw !== 'string' || !raw || raw.length > 40_000_000) throw new GoogleError('bad_request', { reason: 'raw' })
  const res = await httpRequest(fetchImpl, `${cfg.apiBase}/gmail/v1/users/me/messages/send`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ raw }),
    timeoutMs: cfg.apiTimeoutMs,
  })
  if (res.status >= 200 && res.status < 300 && typeof res.json?.id === 'string') return { id: res.json.id, threadId: res.json.threadId ?? null }
  if (res.status >= 200 && res.status < 300) throw new GoogleError('bad_response', { status: res.status, outcomeUnknown: true })
  throw classifyApiError(res)
}

// ------------------------------------------------------------------------------------------------ Calendar
const eventsUrl = (cfg, id = null) => `${cfg.apiBase}/calendar/v3/calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ''}`

/** events.get -> event | null (404 / 410: it does not exist (any more)). */
export async function calendarGetEvent(cfg, accessToken, id, { fetch: fetchImpl = fetch } = {}) {
  need(accessToken)
  const res = await httpRequest(fetchImpl, eventsUrl(cfg, id), { method: 'GET', headers: auth(accessToken), timeoutMs: cfg.apiTimeoutMs })
  if (res.status === 404 || res.status === 410) return null
  if (res.status >= 200 && res.status < 300 && res.json) return res.json
  throw classifyApiError(res)
}

/**
 * events.insert, idempotent: a 409 (the id exists: a retry, a second worker, a timeout after Google accepted) is answered by
 * events.get and the existing event is ADOPTED instead of creating a second one.
 * -> { status: 'created' | 'adopted', event, cancelled: boolean }  (`cancelled` = the adopted event had been deleted earlier)
 */
export async function calendarInsertOrAdopt(cfg, accessToken, { event, query = {} }, { fetch: fetchImpl = fetch } = {}) {
  need(accessToken)
  const res = await httpRequest(fetchImpl, `${eventsUrl(cfg)}${qs(query)}`, { method: 'POST', headers: jsonHeaders(accessToken), body: JSON.stringify(event), timeoutMs: cfg.apiTimeoutMs })
  if (res.status >= 200 && res.status < 300 && res.json?.id) return { status: 'created', event: res.json, cancelled: false }
  if (res.status === 409) {
    const existing = await calendarGetEvent(cfg, accessToken, event.id, { fetch: fetchImpl })
    if (existing) return { status: 'adopted', event: existing, cancelled: existing.status === 'cancelled' }
    throw new GoogleError('conflict', { status: 409, reason: 'duplicate_not_found' })
  }
  throw classifyApiError(res)
}

/** events.patch -> the updated event. A missing event is a `not_found` / `gone` GoogleError (the caller decides what that means). */
export async function calendarPatchEvent(cfg, accessToken, id, { event, query = {} }, { fetch: fetchImpl = fetch } = {}) {
  need(accessToken)
  const res = await httpRequest(fetchImpl, `${eventsUrl(cfg, id)}${qs(query)}`, { method: 'PATCH', headers: jsonHeaders(accessToken), body: JSON.stringify(event), timeoutMs: cfg.apiTimeoutMs })
  if (res.status >= 200 && res.status < 300 && res.json) return res.json
  throw classifyApiError(res)
}

/** events.delete; an event that is already gone (404 / 410) counts as success. -> { deleted: boolean, alreadyGone: boolean } */
export async function calendarDeleteEvent(cfg, accessToken, id, { sendUpdates = 'all', fetch: fetchImpl = fetch } = {}) {
  need(accessToken)
  const res = await httpRequest(fetchImpl, `${eventsUrl(cfg, id)}${qs({ sendUpdates })}`, { method: 'DELETE', headers: auth(accessToken), timeoutMs: cfg.apiTimeoutMs })
  if (res.status === 204 || res.status === 200) return { deleted: true, alreadyGone: false }
  if (res.status === 404 || res.status === 410) return { deleted: false, alreadyGone: true }
  throw classifyApiError(res)
}

/**
 * Meet links are created asynchronously: poll events.get until createRequest.status is success / failure, at most `attempts`
 * times. -> { status: 'success' | 'failure' | 'pending' | 'none', link, event } ('pending' = give up for now, retry the job later).
 */
export async function waitForConference(cfg, accessToken, id, { attempts = 5, delayMs = 800, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), fetch: fetchImpl = fetch } = {}) {
  let last = null
  for (let i = 0; i < attempts; i++) {
    last = await calendarGetEvent(cfg, accessToken, id, { fetch: fetchImpl })
    if (!last) return { status: 'none', link: null, event: null }
    const st = conferenceStatus(last)
    if (st === 'success' || st === 'failure' || st === 'none') return { status: st, link: extractMeetLink(last), event: last }
    if (i < attempts - 1) await sleep(delayMs)
  }
  return { status: 'pending', link: null, event: last }
}
