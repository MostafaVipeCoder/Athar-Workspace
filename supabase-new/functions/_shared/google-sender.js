// Sender resolution (decision 07-3): the ACTING PM's active connection, else the SYSTEM connection (startups@athareg.com),
// else nobody. This is the JS twin of the SQL function `resolve_sender_connection(user_id)` (m61); both implement the same
// four cases and v61 / tests/google-sender.test.js check them with the same table of examples.
//
// A connection row here is the metadata the database returns (never a token): { id, kind: 'user' | 'system', owner_user_id,
// status: 'active' | 'needs_reconnect' | 'revoked', email, scopes }.

import { hasRequiredScopes } from './google-core.js'

const isActive = (c) => Boolean(c) && c.status === 'active'

/**
 * -> { connection, source: 'user' | 'system' | null, fallback: boolean, reason }
 * reason (why the acting user's own connection was not used): null | 'user_not_connected' | 'user_needs_reconnect' |
 *                                                          'user_needs_reconnect_no_system' | 'no_connection'
 */
export function resolveSender({ userId = null, connections = [] } = {}) {
  const list = Array.isArray(connections) ? connections.filter(Boolean) : []
  const owns = (c) => c.kind === 'user' && userId !== null && userId !== undefined && c.owner_user_id === userId
  const own = list.find((c) => owns(c) && isActive(c)) ?? list.find(owns) ?? null
  if (isActive(own)) return { connection: own, source: 'user', fallback: false, reason: null }
  const system = list.find((c) => c.kind === 'system' && isActive(c)) ?? null
  const ownReason = !own || own.status === 'revoked' ? 'user_not_connected' : 'user_needs_reconnect'
  if (system) return { connection: system, source: 'system', fallback: true, reason: ownReason }
  return { connection: null, source: null, fallback: false, reason: ownReason === 'user_needs_reconnect' ? 'user_needs_reconnect_no_system' : 'no_connection' }
}

/** Display name of the From header: "<PM name> - Athar" for a PM's own connection, "Athar Startups" for the system sender (07 section 1.4). */
export function senderDisplayName({ source, pmName = '' }) {
  const n = String(pmName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (source === 'system' || !n) return source === 'system' ? 'Athar Startups' : 'Athar'
  return `${n} - Athar`
}

/** The From mailbox for a resolved sender: ALWAYS the connected account's own address (Gmail rewrites any other From). */
export function senderFrom(resolved, { pmName = '' } = {}) {
  if (!resolved?.connection) return null
  return { email: String(resolved.connection.email).toLowerCase(), name: senderDisplayName({ source: resolved.source, pmName }) }
}

/** A usable connection can send mail AND create events only if both scopes were granted (Google's granular consent allows less). */
export function connectionHasScopes(connection) {
  return hasRequiredScopes(connection?.scopes ?? [])
}
