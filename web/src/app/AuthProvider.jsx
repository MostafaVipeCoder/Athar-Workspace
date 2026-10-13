import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthContext } from './AuthContext.js'
import { fetchProfile, fetchRoles, getSession, onAuthChange, signInWithPassword, signOut as dataSignOut } from '../data/auth.js'
import { keys } from '../data/queryKeys.js'
import { areasForRoles, hasPermission } from '../lib/permissions.js'
import { log } from '../lib/log.js'

/**
 * Query-based auth (design 06 section 8.1): one session subscription; roles and profile are TanStack queries keyed by
 * user id. There is NO localStorage/sessionStorage role cache, so a revoked role cannot linger; if roles fail to load
 * the status is 'error' (retry) and access is never granted from stale data. TOKEN_REFRESHED does not refetch roles.
 */
export default function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(undefined) // undefined = not yet known
  const lastUserId = useRef(null)

  useEffect(() => {
    let active = true
    getSession()
      .then((s) => active && setSession(s ?? null))
      .catch((e) => {
        log.warn('[auth] getSession failed', e?.message)
        if (active) setSession(null)
      })
    // TOKEN_REFRESHED only swaps the session object; roles are keyed by user id so they are NOT refetched
    const unsubscribe = onAuthChange((_event, s) => setSession(s ?? null))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  // never leak one user's cached data to the next: wipe the cache whenever the signed-in identity changes
  useEffect(() => {
    if (session === undefined) return
    if (lastUserId.current !== userId) {
      if (lastUserId.current !== null || userId === null) queryClient.clear()
      lastUserId.current = userId
    }
  }, [userId, session, queryClient])

  const rolesQuery = useQuery({
    queryKey: keys.roles(userId),
    queryFn: () => fetchRoles(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: 1,
  })
  const profileQuery = useQuery({
    queryKey: keys.profile(userId),
    queryFn: () => fetchProfile(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  })

  let status = 'loading'
  if (session === null) status = 'anon'
  else if (session) status = rolesQuery.isError ? 'error' : rolesQuery.isSuccess ? 'authed' : 'loading'

  const roles = useMemo(() => (status === 'authed' ? rolesQuery.data : []), [status, rolesQuery.data])
  const { refetch: refetchRoles } = rolesQuery

  const signIn = useCallback((email, password) => signInWithPassword(email, password), [])
  const signOut = useCallback(async () => {
    await dataSignOut()
    queryClient.clear()
  }, [queryClient])
  const reloadRoles = useCallback(() => refetchRoles(), [refetchRoles])

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      profile: profileQuery.data ?? null,
      roles,
      areas: areasForRoles(roles),
      status,
      hasRole: (r) => roles.includes(r),
      can: (permission) => hasPermission(roles, permission),
      signIn,
      signOut,
      reloadRoles,
    }),
    [session, profileQuery.data, roles, status, signIn, signOut, reloadRoles],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
