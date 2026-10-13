import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The WebAssembly WebP encoder fallback (Safari / iOS cannot encode WebP from a canvas). The real codec is a 300 KB .wasm; here it is a
 * stub with the same API (`init`, default `encode`), so the tests prove the wiring: options, lazy single init, the asset URLs handed to
 * `locateFile`, the Blob that comes back, and the failure path (null, retry allowed).
 */
const mocks = vi.hoisted(() => ({ init: vi.fn(async () => {}), encode: vi.fn() }))
vi.mock('@jsquash/webp/encode.js', () => ({ init: mocks.init, default: mocks.encode }))
vi.mock('@jsquash/webp/codec/enc/webp_enc.wasm?url', () => ({ default: '/assets/webp_enc-abc.wasm' }))
vi.mock('@jsquash/webp/codec/enc/webp_enc_simd.wasm?url', () => ({ default: '/assets/webp_enc_simd-abc.wasm' }))

async function load() {
  vi.resetModules()
  return import('./wasmWebp.js')
}
const pixels = (w = 4, h = 3) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })

beforeEach(() => {
  mocks.init.mockReset().mockResolvedValue(undefined)
  mocks.encode.mockReset().mockResolvedValue(new Uint8Array([82, 73, 70, 70]).buffer)
})

describe('wasmOptions', () => {
  it('maps the pipeline quality (0..1) to libwebp: lossy percent, and 1 = lossless', async () => {
    const { wasmOptions } = await load()
    expect(wasmOptions(0.8)).toMatchObject({ quality: 80 })
    expect(wasmOptions(0.55)).toMatchObject({ quality: 55 })
    expect(wasmOptions(1)).toMatchObject({ lossless: 1 })
    expect(wasmOptions(0.999).lossless).toBeUndefined()
    expect(wasmOptions(0.999).quality).toBe(99)
    expect(wasmOptions(0).quality).toBe(1)
    expect(wasmOptions(undefined).quality).toBe(80)
  })
})

describe('encodeWithWasm', () => {
  it('returns an image/webp Blob and initialises the codec ONCE with our own hashed .wasm assets', async () => {
    const { encodeWithWasm } = await load()
    const a = await encodeWithWasm(pixels(), { quality: 0.8 })
    const b = await encodeWithWasm(pixels(), { quality: 0.6 })
    expect(a).toBeInstanceOf(Blob)
    expect(a.type).toBe('image/webp')
    expect(a.size).toBe(4)
    expect(b.type).toBe('image/webp')
    expect(mocks.init).toHaveBeenCalledTimes(1)
    const { locateFile } = mocks.init.mock.calls[0][0]
    expect(locateFile('webp_enc.wasm')).toBe('/assets/webp_enc-abc.wasm')
    expect(locateFile('webp_enc_simd.wasm')).toBe('/assets/webp_enc_simd-abc.wasm')
    expect(mocks.encode).toHaveBeenNthCalledWith(1, expect.objectContaining({ width: 4, height: 3 }), expect.objectContaining({ quality: 80 }))
    expect(mocks.encode).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ quality: 60 }))
  })

  it('quality 1 asks for LOSSLESS (the landing frames: exact alpha)', async () => {
    const { encodeWithWasm } = await load()
    await encodeWithWasm(pixels(), { quality: 1 })
    expect(mocks.encode).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lossless: 1 }))
  })

  it('answers null when the codec cannot load, and tries again on the next upload', async () => {
    mocks.init.mockRejectedValueOnce(new Error('network: wasm blocked'))
    const { encodeWithWasm } = await load()
    expect(await encodeWithWasm(pixels())).toBeNull()
    expect((await encodeWithWasm(pixels()))?.type).toBe('image/webp') // retried, now fine
    expect(mocks.init).toHaveBeenCalledTimes(2)
  })

  it('answers null when the encoder returns nothing or throws (the original is never uploaded instead)', async () => {
    const { encodeWithWasm } = await load()
    mocks.encode.mockResolvedValueOnce(new ArrayBuffer(0))
    expect(await encodeWithWasm(pixels())).toBeNull()
    mocks.encode.mockRejectedValueOnce(new Error('Encoding error.'))
    expect(await encodeWithWasm(pixels())).toBeNull()
  })
})
