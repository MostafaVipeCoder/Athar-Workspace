/**
 * Pure helpers of the Google connection UI (m61, design 07). No I/O: the data layer is data/google.js.
 */

/** The ONLY reasons the callback puts in the return URL (supabase-new/functions/_shared/google-oauth-handlers.js REASONS). Anything else is shown as a server error. */
export const GOOGLE_REASONS = [
  'access_denied', 'invalid_state', 'state_expired', 'state_replayed', 'exchange_failed', 'id_token_invalid', 'email_unverified', 'wrong_domain',
  'email_mismatch', 'wrong_system_account', 'missing_scopes', 'no_refresh_token', 'email_in_use', 'forbidden', 'server_error', 'not_configured',
]

/** `?google=connected` / `?google=error&reason=<code>[&target=system]` -> { result, reason, system } (null result when the URL is not a Google return). Never trusts the reason text. */
export function parseGoogleReturn(search) {
  const q = new URLSearchParams(String(search ?? ''))
  const result = q.get('google')
  if (result !== 'connected' && result !== 'error') return { result: null, reason: null, system: false }
  const raw = q.get('reason')
  const reason = result === 'error' ? (GOOGLE_REASONS.includes(raw) ? raw : 'server_error') : null
  return { result, reason, system: q.get('target') === 'system' }
}

/** The query keys that belong to the Google return, so they can be removed from the URL after the message is shown. */
export function stripGoogleParams(search) {
  const q = new URLSearchParams(String(search ?? ''))
  for (const k of ['google', 'reason', 'target']) q.delete(k)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Last error CODES the server stores (never a message). Unknown codes fall back to the generic text. */
export const GOOGLE_ERROR_CODES = ['invalid_grant', 'needs_reconnect', 'no_secret']

/**
 * What would send for this user, in four words, from get_google_connection_status():
 *   mine            the user's own account sends
 *   fallback        the user is not connected: the system sender (startups@) sends
 *   fallbackReconnect  the user's connection stopped working: the system sender sends until they reconnect
 *   none            nobody can send (e-mails wait in the outbox, calendar jobs stay queued)
 *   noneReconnect   the user's connection stopped working and there is no system sender either
 *   unknown         the status is not loaded
 */
export function senderState(status) {
  if (!status || typeof status !== 'object') return { kind: 'unknown', email: null }
  const eff = status.effective ?? {}
  const mine = status.mine ?? null
  const needsReconnect = mine?.status === 'needs_reconnect' || eff.reason === 'user_needs_reconnect' || eff.reason === 'user_needs_reconnect_no_system'
  if (eff.source === 'user') return { kind: 'mine', email: eff.email ?? mine?.email ?? null }
  if (eff.source === 'system') return { kind: needsReconnect ? 'fallbackReconnect' : 'fallback', email: eff.email ?? status.system?.email ?? null, mineEmail: mine?.email ?? null }
  return { kind: needsReconnect ? 'noneReconnect' : 'none', email: null, mineEmail: mine?.email ?? null }
}

/** Connection of the user himself as the profile shows it: connected | needs_reconnect | not_connected. */
export function mineState(status) {
  const m = status?.mine
  if (!m) return 'not_connected'
  return m.status === 'active' && m.scopes_ok !== false ? 'connected' : 'needs_reconnect'
}

/** The system sender as the super_admin card shows it. */
export function systemState(status) {
  const s = status?.system
  if (!s) return 'not_connected'
  return s.status === 'active' ? 'connected' : 'needs_reconnect'
}

export const stateTone = (state) => (state === 'connected' ? 'green' : state === 'needs_reconnect' ? 'amber' : 'neutral')

/** An e-mail address inside running text: isolated as left-to-right so it keeps its shape inside an Arabic sentence (bidi isolate, no visible character). */
export const ltr = (v) => (v ? `\u2066${v}\u2069` : '')

/** Navigation to Google's consent screen (a full page load: leaving the app). Isolated so tests can replace it. */
export function redirectTo(url) {
  window.location.assign(url)
}
