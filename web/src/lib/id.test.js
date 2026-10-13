import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './id.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.unstubAllGlobals())

describe('newId', () => {
  it('is a UUID v4 and never repeats', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(UUID)
  })
  it('without randomUUID it builds a valid v4 from getRandomValues', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b) => b.fill(255) })
    expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })
  it('without any crypto it still returns a valid UUID v4 (Math.random)', () => {
    vi.stubGlobal('crypto', undefined)
    expect(newId()).toMatch(UUID)
  })
})
