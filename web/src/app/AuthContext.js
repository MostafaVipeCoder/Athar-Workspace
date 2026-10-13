import { createContext, useContext } from 'react'

/**
 * Value shape (design 06 section 8.1):
 * { user, profile, roles, status: 'loading'|'authed'|'anon'|'error', hasRole(r), can(permission), areas,
 *   signIn(email, password), signOut(), reloadRoles() }
 * Kept in its own module (no JSX) so tests can provide a value directly.
 */
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
