import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pngBytes, toFile } from './testFixtures.js'

// the DEFAULT backend is replaced by a counting fake: this file tests the (file, profile) cache that ImageField + data/storage share
const calls = { decode: 0 }
vi.mock('./canvas.js', () => ({
  browserBackend: {
    supportsWebp: async () => true,
    decode: async () => {
      calls.decode += 1
      return { width: 800, height: 600, source: {}, dispose() {} }
    },
    scale: async (_d, width, height) => ({ width, height, source: {}, dispose() {} }),
    encode: async () => new Blob([new Uint8Array(1000)], { type: 'image/webp' }),
  },
}))

const { convertToWebp } = await import('./convert.js')

beforeEach(() => {
  calls.decode = 0
})

describe('one conversion per (file, profile)', () => {
  it('a second call for the same File and profile returns the first result without decoding again', async () => {
    const file = toFile(pngBytes({ pad: 5000 }), 'a.png', 'image/png')
    const a = await convertToWebp(file, { profile: 'cover' })
    const stages = []
    const b = await convertToWebp(file, { profile: 'cover', onProgress: (p) => stages.push(p.stage) })
    expect(b).toBe(a)
    expect(calls.decode).toBe(1)
    expect(stages).toEqual(['done'])
  })

  it('another profile (or another File) is converted separately', async () => {
    const file = toFile(pngBytes({ pad: 5000 }), 'a.png', 'image/png')
    await convertToWebp(file, { profile: 'cover' })
    await convertToWebp(file, { profile: 'avatar' })
    await convertToWebp(toFile(pngBytes({ pad: 5000 }), 'b.png', 'image/png'), { profile: 'cover' })
    expect(calls.decode).toBe(3)
  })

  it('a failed conversion is not cached: the next attempt runs again', async () => {
    const bad = toFile(pngBytes({ truncated: true }), 'cut.png', 'image/png')
    await expect(convertToWebp(bad, { profile: 'cover' })).rejects.toMatchObject({ code: 'corrupt' })
    await expect(convertToWebp(bad, { profile: 'cover' })).rejects.toMatchObject({ code: 'corrupt' })
  })
})
