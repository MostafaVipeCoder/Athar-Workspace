import { describe, expect, it } from 'vitest'
import { allDecided, findConflicts, keysToKeep, otherSideChanges } from './alumniConflicts.js'

const base = { sector: 'technology', stage: 'mvp', description_en: '', governorate: 25, links: [{ kind: 'facebook', url: 'https://f.example.com' }] }

describe('findConflicts: only a field BOTH sides changed to different values is a conflict', () => {
  it('no conflict when the other side touched other fields only', () => {
    const mine = { ...base, sector: 'healthcare' }
    const fresh = { ...base, stage: 'revenue' }
    expect(findConflicts({ base, mine, fresh, keys: ['sector'] })).toEqual([])
    expect(otherSideChanges({ base, fresh, keys: ['stage', 'sector'] })).toEqual(['stage'])
  })

  it('a real conflict carries the three values (what it was, what I typed, what the other side saved)', () => {
    const mine = { ...base, sector: 'healthcare' }
    const fresh = { ...base, sector: 'retail' }
    expect(findConflicts({ base, mine, fresh, keys: ['sector'] })).toEqual([{ key: 'sector', base: 'technology', mine: 'healthcare', theirs: 'retail' }])
  })

  it('both sides made the SAME change: nothing to decide', () => {
    const mine = { ...base, sector: 'retail' }
    const fresh = { ...base, sector: 'retail' }
    expect(findConflicts({ base, mine, fresh, keys: ['sector'] })).toEqual([])
  })

  it('"" and null are the same empty value; link lists are compared by value, key order does not matter', () => {
    const fresh = { ...base, description_en: null, links: [{ url: 'https://f.example.com', kind: 'facebook' }] }
    expect(findConflicts({ base, mine: { ...base, description_en: '' }, fresh, keys: ['description_en', 'links'] })).toEqual([])
    const mine = { ...base, links: [{ kind: 'x', url: 'https://x.example.com' }] }
    expect(findConflicts({ base, mine, fresh: { ...base, links: [{ kind: 'x', url: 'https://other.example.com' }] }, keys: ['links'] })).toHaveLength(1)
  })

  it('a key the person did not edit is never reported', () => {
    expect(findConflicts({ base, mine: base, fresh: { ...base, sector: 'retail' }, keys: [] })).toEqual([])
  })
})

describe('keysToKeep / allDecided: nothing is overwritten unseen', () => {
  const conflicts = [{ key: 'sector' }, { key: 'stage' }]
  it('a field that is not in conflict is always kept; a conflicting one only on "mine"', () => {
    expect(keysToKeep({ keys: ['sector', 'stage', 'governorate'], conflicts, choices: { sector: 'mine', stage: 'theirs' } })).toEqual(['sector', 'governorate'])
  })
  it('no choice = theirs (the safe default)', () => {
    expect(keysToKeep({ keys: ['sector', 'governorate'], conflicts, choices: {} })).toEqual(['governorate'])
  })
  it('the dialog confirms only when every conflict has a choice', () => {
    expect(allDecided(conflicts, { sector: 'mine' })).toBe(false)
    expect(allDecided(conflicts, { sector: 'mine', stage: 'theirs' })).toBe(true)
    expect(allDecided([], {})).toBe(true)
  })
})
