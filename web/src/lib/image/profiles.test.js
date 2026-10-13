import { describe, expect, it } from 'vitest'
import { KIND_PROFILE, PROFILES, acceptFor, profileForKind, qualityLadder, resolveProfile } from './profiles.js'

describe('profiles', () => {
  it('has the named profiles of the owner decision with the agreed sizes', () => {
    expect(PROFILES.cover.maxPx).toBe(1920)
    expect(PROFILES.content.maxPx).toBe(1600)
    expect(PROFILES.avatar.maxPx).toBe(512)
    expect(PROFILES.logo.maxPx).toBe(512)
    expect(PROFILES.template.maxPx).toBe(4000)
    expect(PROFILES.frame.maxPx).toBe(1350) // the 1080 x 1350 export grid
    expect(Object.values(PROFILES).every((p) => Object.isFrozen(p))).toBe(true)
  })

  it('thumbnails are 320 px where a profile makes one; frames, templates and attachments have none', () => {
    for (const k of ['cover', 'landing', 'content', 'avatar', 'logo']) expect(PROFILES[k].thumbPx).toBe(320)
    for (const k of ['frame', 'template', 'attachment']) expect(PROFILES[k].thumbPx).toBe(0)
  })

  it('maps the storage folder kinds to profiles; unknown kinds are content', () => {
    expect(profileForKind('cover')).toBe('cover')
    expect(profileForKind('form-cover')).toBe('cover')
    expect(profileForKind('og')).toBe('cover')
    expect(profileForKind('landing')).toBe('landing')
    expect(profileForKind('logo')).toBe('logo')
    expect(profileForKind('photo')).toBe('avatar')
    expect(profileForKind('library')).toBe('content')
    expect(profileForKind('whatever')).toBe('content')
    for (const profile of Object.values(KIND_PROFILE)) expect(PROFILES[profile]).toBeTruthy()
  })

  it('only the logo profile accepts a vector file', () => {
    expect(acceptFor('logo')).toContain('image/svg+xml')
    for (const k of ['cover', 'content', 'avatar', 'frame', 'template', 'landing']) expect(acceptFor(k)).not.toContain('svg')
    expect(acceptFor('cover')).toBe('image/png,image/jpeg,image/webp,image/gif')
  })

  it('quality ladder: descending, bounded by minQuality, lossless first for frames', () => {
    const ladder = qualityLadder('cover')
    expect(ladder[0]).toBe(0.8)
    expect(ladder[ladder.length - 1]).toBe(PROFILES.cover.minQuality)
    expect([...ladder].sort((a, b) => b - a)).toEqual(ladder)
    expect(qualityLadder('frame')[0]).toBe(1)
    expect(qualityLadder('frame').length).toBeGreaterThan(2)
    expect(qualityLadder('template')[0]).toBe(0.92)
  })

  it('resolveProfile: names, objects, unknown names', () => {
    expect(resolveProfile('avatar')).toMatchObject({ name: 'avatar', maxPx: 512 })
    expect(resolveProfile('nope')).toMatchObject({ name: 'content', maxPx: 1600 })
    expect(resolveProfile({ maxPx: 100 })).toMatchObject({ name: 'custom', maxPx: 100, thumbPx: 320 })
  })
})
