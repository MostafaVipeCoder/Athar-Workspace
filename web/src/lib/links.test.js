import { describe, it, expect } from 'vitest'
import { parseRef, isUuid, isSlug, canonicalRef, appBaseUrl, publicPath, buildPublicUrl, buildInviteUrl, buildStaffInviteUrl, buildShareUrl, staffPath } from './links.js'

const UUID = '3f1c2a44-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

describe('refs', () => {
  it('classifies uuid / slug / invalid', () => {
    expect(isUuid(UUID)).toBe(true)
    expect(isUuid(UUID.toUpperCase())).toBe(true)
    expect(isSlug('ab3k9x_Z-1')).toBe(true)
    expect(isSlug('a')).toBe(false)
    expect(isSlug('has space')).toBe(false)
    expect(parseRef(UUID.toUpperCase())).toEqual({ kind: 'uuid', value: UUID })
    expect(parseRef('spring-2026')).toEqual({ kind: 'slug', value: 'spring-2026' })
    expect(parseRef('../x')).toMatchObject({ kind: 'invalid' })
  })
  it('canonical ref prefers the slug', () => {
    expect(canonicalRef({ slug: 'spring-2026', id: UUID })).toBe('spring-2026')
    expect(canonicalRef({ slug: null, id: UUID })).toBe(UUID)
  })
})

describe('urls', () => {
  it('base url honours the public url, else origin + base path', () => {
    expect(appBaseUrl({ publicUrl: 'https://athareg.com/', basePath: '/x/' })).toBe('https://athareg.com')
    expect(appBaseUrl({ publicUrl: '', basePath: '/', origin: 'http://127.0.0.1:5174' })).toBe('http://127.0.0.1:5174')
    expect(appBaseUrl({ publicUrl: '', basePath: '/EventsOperations/', origin: 'https://athareg.com' })).toBe('https://athareg.com/EventsOperations')
  })
  it('builds the one URL per thing (06 section 2.4)', () => {
    expect(publicPath('agenda', 'spring-2026', { tab: 'experts', lang: 'ar' })).toBe('/agenda/spring-2026/experts?lang=ar')
    expect(publicPath('form', UUID)).toBe(`/forms/${UUID}`)
    expect(publicPath('booking', 'node1', { host: 'h1' })).toBe('/book/node1/h1')
    expect(publicPath('view', 'n', { viewKey: 'live' })).toBe('/view/n/live')
    expect(publicPath('landing', 'join me')).toBe('/join/join%20me')
    expect(() => publicPath('nope', 'x')).toThrow()
    expect(buildPublicUrl('agenda', 's', { base: 'https://athareg.com', tab: 'companies' })).toBe('https://athareg.com/agenda/s/companies')
    expect(buildInviteUrl('t/k', { base: 'https://athareg.com' })).toBe('https://athareg.com/invite/t%2Fk')
    expect(buildStaffInviteUrl('abc', { base: 'http://127.0.0.1:5174' })).toBe('http://127.0.0.1:5174/invite/staff/abc')
  })
  it('share links: facebook/linkedin are copy-only (07-13)', () => {
    expect(buildShareUrl('whatsapp', 'https://a.b/c', 'Join')).toEqual({ href: `https://wa.me/?text=${encodeURIComponent('Join https://a.b/c')}`, copyOnly: false })
    expect(buildShareUrl('facebook', 'https://a.b/c').copyOnly).toBe(true)
    expect(buildShareUrl('linkedin', 'https://a.b/c').href).toContain('linkedin.com')
    expect(buildShareUrl('copy', 'https://a.b/c')).toEqual({ href: 'https://a.b/c', copyOnly: true })
  })
  it('staff paths', () => {
    expect(staffPath.node('p', 'n', 'edit')).toBe('/projects/p/nodes/n/edit')
    expect(staffPath.node('p', 'n', 'view')).toBe('/projects/p/nodes/n')
    expect(staffPath.programSettings('g')).toBe('/programs/g/settings')
    expect(staffPath.staff()).toBe('/admin/staff')
  })
})
