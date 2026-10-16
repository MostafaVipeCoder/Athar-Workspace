import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, unwrap } from './errors.js'
import { keys } from './queryKeys.js'

/**
 * Google connection of the acting user (decision 20.6, design 07, migration m61). The browser only ever sees METADATA: who is connected,
 * the status, a short error code. The refresh token lives on the server (Supabase Vault or AES-256-GCM); nothing here can read it and the
 * RPCs below return no secret column. The two server steps are edge functions:
 *   google-oauth-start      POST { system?, returnTo? } -> { url }   (the browser then navigates to Google's consent screen)
 *   google-disconnect       POST { system? }            -> { ok, disconnected, revoked_at_google }
 * and Google sends the browser back to the app with ?google=connected | ?google=error&reason=<code> (see lib/google.js).
 */

/** Status of the acting user: { mine, system, effective: { source, email, fallback, reason }, is_super_admin }. Staff only. */
export async function getGoogleStatus() {
  return unwrap(await db().rpc('get_google_connection_status'))
}

/** super_admin: every connection (metadata only) with the owner's name and e-mail. */
export async function listGoogleConnectionsAdmin() {
  return unwrap(await db().rpc('list_google_connections_admin')) ?? []
}

const FUNCTION_ERRORS = new Set(['not_configured', 'forbidden', 'unauthenticated', 'too_many_attempts', 'server_error', 'bad_request', 'method_not_allowed'])

/** A failed edge function call -> AppError with a translated message key (the server answers { error: '<code>' }). */
async function toFunctionError(error) {
  let code = null
  try {
    const body = typeof error?.context?.json === 'function' ? await error.context.json() : null
    if (typeof body?.error === 'string') code = body.error
  } catch {
    /* no JSON body */
  }
  if (!code) {
    const name = String(error?.name ?? '')
    if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError' || error instanceof TypeError) return new AppError('network', { messageKey: 'google.err.network', cause: error, retryable: true })
    return new AppError('unknown', { messageKey: 'google.err.server_error', cause: error, retryable: true })
  }
  const known = FUNCTION_ERRORS.has(code) ? code : 'server_error'
  const appCode = known === 'forbidden' ? 'forbidden' : known === 'unauthenticated' ? 'unauthenticated' : 'unknown'
  const e = new AppError(appCode, { messageKey: `google.err.${known}`, cause: error, retryable: known === 'server_error' || known === 'too_many_attempts' })
  e.token = known
  return e
}

async function invoke(name, body) {
  const { data, error } = await db().functions.invoke(name, { body })
  if (error) throw await toFunctionError(error)
  return data
}

/** Ask the server for the Google consent URL. `returnTo` = an in-app path (no query) to come back to after Google. -> { url } */
export async function startGoogleConnect({ system = false, returnTo = '/profile' } = {}) {
  const out = await invoke('google-oauth-start', { system: Boolean(system), returnTo })
  if (typeof out?.url !== 'string' || !/^https?:\/\//.test(out.url)) throw new AppError('unknown', { messageKey: 'google.err.server_error' })
  return out
}

/** Disconnect: revoke at Google (best effort), the server deletes the stored secret. -> { ok, disconnected, revoked_at_google } */
export async function disconnectGoogle({ system = false } = {}) {
  return invoke('google-disconnect', { system: Boolean(system) })
}

// ------------------------------------------------------------------ hooks
/** Refetched when the tab regains focus (the user may have connected in another tab); no polling, no socket. */
export const useGoogleStatus = ({ enabled = true } = {}) =>
  useQuery({ queryKey: keys.googleStatus(), queryFn: getGoogleStatus, enabled, staleTime: 30_000, refetchOnWindowFocus: true })

export const useGoogleConnectionsAdmin = ({ enabled = true } = {}) =>
  useQuery({ queryKey: keys.googleAdmin(), queryFn: listGoogleConnectionsAdmin, enabled, staleTime: 30_000 })

export function useGoogleMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.googleStatus() })
    qc.invalidateQueries({ queryKey: keys.googleAdmin() })
  }
  return {
    disconnect: useMutation({ mutationFn: disconnectGoogle, onSuccess: refresh }),
    refresh,
  }
}
