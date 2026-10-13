import { describe, expect, it } from 'vitest'
import { matchPath } from 'react-router-dom'
import { legacyRules, rewriteLegacyLocation } from './legacyRedirects.js'

function resolve(path, search = '') {
  for (const r of legacyRules) {
    const m = matchPath({ path: r.pattern, end: true }, path)
    if (m && r.to) return r.to(m.params, search)
  }
  return null
}

describe('boot shim', () => {
  it('hash links become path links and keep the query', () => {
    expect(rewriteLegacyLocation({ pathname: '/', search: '', hash: '#/agenda/abc?lang=ar&tabs=1' })).toBe('/agenda/abc?lang=ar&tabs=1')
  })
  it('?agenda= share links', () => {
    expect(rewriteLegacyLocation({ pathname: '/', search: '?agenda=abc&lang=ar', hash: '' })).toBe('/agenda/abc?lang=ar')
  })
  it('nothing to do', () => expect(rewriteLegacyLocation({ pathname: '/programs', search: '', hash: '' })).toBeNull())
})

describe('legacy table', () => {
  it('maps old shapes', () => {
    expect(resolve('/view/E1/startups')).toBe('/agenda/E1/companies')
    expect(resolve('/events/E1')).toBe('/projects/E1')
    expect(resolve('/events/E1/form/F1')).toBe('/forms/F1')
    expect(resolve('/forms/E1/F1')).toBe('/forms/F1')
    expect(resolve('/verify-certificate/ABC')).toBe('/verify/ABC')
    expect(resolve('/alumni/login')).toBe('/login')
    expect(resolve('/alumni/signup', '?token=t1')).toBe('/invite/t1')
    expect(resolve('/alumni/signup')).toBe('/signup')
    expect(resolve('/experts')).toBe('/network/experts')
  })
  it('old mentoring links (/view/<event id>/mentoring/matrix|live) go to the distribution views (the event id is the project id)', () => {
    expect(resolve('/view/E1/mentoring/matrix')).toBe('/view/E1/matrix')
    expect(resolve('/view/E1/mentoring/live')).toBe('/view/E1/live')
  })
  it('module rules exist for event pages', () => {
    expect(legacyRules.some((r) => r.moduleParam === 'module' && r.pattern === '/events/:id/:module')).toBe(true)
  })
})
