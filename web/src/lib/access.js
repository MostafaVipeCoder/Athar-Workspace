import { areasForRoles, hasPermission, AREA_HOME } from './permissions.js'

/**
 * The single guard decision table (design 06 section 8.3). Pure; RequireAccess only renders its result.
 *
 * | State                                   | Result                                       |
 * | auth loading                            | { action: 'loading' }                        |
 * | auth failed to load roles               | { action: 'error' }                          |
 * | anonymous                               | { action: 'login', to: /login?next=... }     |
 * | signed in, no roles                     | { action: 'no-access', to: '/no-access' }    |
 * | lacks area/permission, has other area   | { action: 'redirect', to: <that area home>, notify: true } |
 * | lacks area/permission, no other area    | { action: 'no-access', to: '/no-access' }    |
 * | ok                                      | { action: 'allow' }                          |
 */
export function decideAccess({ status, roles = [], area, permission, location }) {
  if (status === 'loading') return { action: 'loading' }
  if (status === 'error') return { action: 'error' }
  if (status !== 'authed') {
    const next = `${location?.pathname ?? '/'}${location?.search ?? ''}${location?.hash ?? ''}`
    const qs = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''
    return { action: 'login', to: `/login${qs}` }
  }
  if (roles.length === 0) return { action: 'no-access', to: '/no-access' }

  const needed = permission ?? (area ? `area:${area}` : null)
  if (!needed || hasPermission(roles, needed)) return { action: 'allow' }

  const others = areasForRoles(roles)
  if (others.length > 0) return { action: 'redirect', to: AREA_HOME[others[0]], notify: true }
  return { action: 'no-access', to: '/no-access' }
}

const PATH_AREAS = [
  ['/alumni/founder', 'founder'],
  ['/alumni/admin', 'network'],
  ['/programs', 'staff'],
  ['/projects', 'staff'],
  ['/network', 'staff'],
  ['/library', 'staff'],
  ['/form-library', 'staff'],
  ['/team', 'staff'],
  ['/admin', 'staff'],
]

/** Which area a path belongs to (null = no area requirement, e.g. /profile, public pages). */
export function areaForPath(pathname = '/') {
  const hit = PATH_AREAS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))
  return hit ? hit[1] : null
}

/** After login: may this user open `path` (used to honour ?next only when it will not bounce)? */
export function canOpenPath(roles, path) {
  const area = areaForPath(String(path).split(/[?#]/)[0])
  return !area || hasPermission(roles, `area:${area}`)
}

/** Only same-origin relative paths are honoured as ?next (prevents open redirects). */
export function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}
