import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The WebAssembly mozjpeg encoder of the link-preview derivative (progressive JPEG; a canvas can only write baseline). The real codec is a 250 KB
 * .wasm; here it is a stub with the same API (`init`, default `encode`), so the tests prove the wiring: options, lazy single init, the asset URL
 * handed to `locateFile`, the Blob that comes back and the failure path (null, retry allowed: the backend then falls back to the canvas encoder).
 */
const mocks = vi.hoisted(() => ({ init: vi.fn(async () => {}), encode: vi.fn() }))
vi.mock('@jsquash/jpeg/encode.js', () => ({ init: mocks.init, default: mocks.encode }))
vi.mock('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url', () => ({ default: '/assets/mozjpeg_enc-abc.wasm' }))

async function load() {
  vi.resetModules()
  return import('./wasmJpeg.js')
}
const pixels = (w = 4, h = 3) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })

beforeEach(() => {
  mocks.init.mockReset().mockResolvedValue(undefined)
  mocks.encode.mockReset().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)
})

describe('jpegOptions', () => {
  it('maps the pipeline quality (0..1) to mozjpeg 1..100 and always asks for a PROGRESSIVE, optimised file', async () => {
    const { jpegOptions } = await load()
    expect(jpegOptions(0.82)).toEqual({ quality: 82, progressive: true, baseline: false, optimize_coding: true })
    expect(jpegOptions(0.52).quality).toBe(52)
    expect(jpegOptions(2).quality).toBe(100)
    expect(jpegOptions(0).quality).toBe(1)
    expect(jpegOptions(undefined).quality).toBe(82)
  })
})

describe('encodeJpegWithWasm', () => {
  it('returns an image/jpeg Blob and initialises the codec ONCE with our own hashed .wasm asset', async () => {
    const { encodeJpegWithWasm } = await load()
    const a = await encodeJpegWithWasm(pixels(), { quality: 0.82 })
    const b = await encodeJpegWithWasm(pixels(), { quality: 0.6 })
    expect(a).toBeInstanceOf(Blob)
    expect(a.type).toBe('image/jpeg')
    expect(a.size).toBe(4)
    expect(b.type).toBe('image/jpeg')
    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.init.mock.calls[0][0].locateFile('mozjpeg_enc.wasm')).toBe('/assets/mozjpeg_enc-abc.wasm')
    expect(mocks.encode).toHaveBeenNthCalledWith(1, expect.objectContaining({ width: 4, height: 3 }), expect.objectContaining({ quality: 82, progressive: true }))
    expect(mocks.encode).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ quality: 60, progressive: true }))
  })

  it('answers null when the codec cannot load, and tries again next time', async () => {
    mocks.init.mockRejectedValueOnce(new Error('network: wasm blocked'))
    const { encodeJpegWithWasm } = await load()
    expect(await encodeJpegWithWasm(pixels())).toBeNull()
    expect((await encodeJpegWithWasm(pixels()))?.type).toBe('image/jpeg')
    expect(mocks.init).toHaveBeenCalledTimes(2)
  })

  it('answers null when the encoder returns nothing or throws (the canvas encoder takes over)', async () => {
    const { encodeJpegWithWasm } = await load()
    mocks.encode.mockResolvedValueOnce(new ArrayBuffer(0))
    expect(await encodeJpegWithWasm(pixels())).toBeNull()
    mocks.encode.mockRejectedValueOnce(new Error('Encoding error.'))
    expect(await encodeJpegWithWasm(pixels())).toBeNull()
  })
})
