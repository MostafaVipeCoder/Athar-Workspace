import { describe, expect, it } from 'vitest'
import { areaForPath, canOpenPath, decideAccess, safeNext } from './access.js'
import { areasForRoles, roleHome, hasPermission } from './permissions.js'

const loc = { pathname: '/projects/1', search: '?a=1', hash: '#x' }

describe('decideAccess (06 section 8.3 decision table)', () => {
  it('loading -> loading', () => expect(decideAccess({ status: 'loading', area: 'staff' }).action).toBe('loading'))
  it('roles failed -> error (never grants from stale data)', () => expect(decideAccess({ status: 'error', area: 'staff' }).action).toBe('error'))
  it('anonymous -> login with full next', () => {
    const d = decideAccess({ status: 'anon', area: 'staff', location: loc })
    expect(d.action).toBe('login')
    expect(d.to).toBe(`/login?next=${encodeURIComponent('/projects/1?a=1#x')}`)
  })
  it('signed in without roles -> /no-access', () => {
    expect(decideAccess({ status: 'authed', roles: [], area: 'staff' })).toEqual({ action: 'no-access', to: '/no-access' })
  })
  it('lacking area but with another -> redirect to that home with notice', () => {
    const d = decideAccess({ status: 'authed', roles: ['founder'], area: 'staff' })
    expect(d).toEqual({ action: 'redirect', to: '/alumni/founder/dashboard', notify: true })
  })
  it('lacking permission and no other area -> no-access', () => {
    expect(decideAccess({ status: 'authed', roles: ['integration'], area: 'staff' }).action).toBe('no-access')
  })
  it('allowed', () => {
    expect(decideAccess({ status: 'authed', roles: ['project_manager'], area: 'staff' }).action).toBe('allow')
    expect(decideAccess({ status: 'authed', roles: ['founder'] }).action).toBe('allow')
  })
  it('permission check: PM cannot manage form library, super_admin can', () => {
    expect(decideAccess({ status: 'authed', roles: ['project_manager'], permission: 'form-library:manage' }).action).toBe('redirect')
    expect(decideAccess({ status: 'authed', roles: ['super_admin'], permission: 'form-library:manage' }).action).toBe('allow')
  })
})

describe('permissions and paths', () => {
  it('super_admin implies all areas', () => expect(areasForRoles(['super_admin'])).toEqual(['staff', 'network', 'founder']))
  it('multi-role', () => expect(areasForRoles(['founder', 'project_manager'])).toEqual(['staff', 'founder']))
  it('roleHome', () => {
    expect(roleHome([])).toBe('/no-access')
    expect(roleHome(['founder'])).toBe('/alumni/founder/dashboard')
    expect(roleHome(['alumni_manager'])).toBe('/alumni/admin/dashboard')
    // several areas and nothing remembered: straight to the first area (no chooser page)
    expect(roleHome(['founder', 'project_manager'])).toBe('/programs')
    expect(roleHome(['founder', 'project_manager'], 'staff')).toBe('/programs')
    expect(roleHome(['founder'], 'staff')).toBe('/alumni/founder/dashboard')
  })
  it('hasPermission', () => expect(hasPermission(['project_manager'], 'team:manage')).toBe(false))
  it('areaForPath / canOpenPath', () => {
    expect(areaForPath('/projects/x/nodes/y')).toBe('staff')
    expect(areaForPath('/alumni/founder/programs')).toBe('founder')
    expect(areaForPath('/profile')).toBeNull()
    expect(canOpenPath(['founder'], '/projects/1?x=1')).toBe(false)
    expect(canOpenPath(['project_manager'], '/projects/1')).toBe(true)
  })
  it('safeNext blocks open redirects', () => {
    expect(safeNext('/programs')).toBe('/programs')
    expect(safeNext('//evil.com')).toBeNull()
    expect(safeNext('https://evil.com')).toBeNull()
    expect(safeNext(null)).toBeNull()
  })
})
