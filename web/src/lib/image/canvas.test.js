import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser backend against fake `createImageBitmap` / `OffscreenCanvas` (jsdom has neither): the calls that make the pipeline
 * correct in a real browser - EXIF orientation, halving steps, WebP-encode probing, releasing pixel buffers.
 */
const wasm = vi.hoisted(() => ({ encode: vi.fn() }))
vi.mock('./wasmWebp.js', () => ({ encodeWithWasm: wasm.encode }))

let canvases
let blobType

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.draws = []
    canvases.push(this)
  }

  getContext() {
    this.hasContext = true
    return {
      imageSmoothingQuality: '',
      drawImage: (src, x, y, w, h) => this.draws.push({ src, w, h }),
      fillRect: () => {},
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    }
  }

  async convertToBlob({ type, quality }) {
    // real Chromium: encoding a canvas that never got a rendering context throws (the support probe once failed on exactly this)
    if (!this.hasContext) throw new DOMException('"OffscreenCanvas" has no rendering context.', 'InvalidStateError')
    this.encoded = { type, quality }
    return new Blob([new Uint8Array(10)], { type: blobType ?? type })
  }
}

async function load() {
  vi.resetModules()
  return (await import('./canvas.js')).browserBackend
}

beforeEach(() => {
  canvases = []
  blobType = null
  wasm.encode.mockReset().mockResolvedValue(new Blob([new Uint8Array(7)], { type: 'image/webp' }))
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.__forceNoNativeWebp
})

describe('decode', () => {
  it('asks createImageBitmap for the EXIF orientation and releases the bitmap on dispose', async () => {
    const bitmap = { width: 2000, height: 3000, close: vi.fn() }
    const spy = vi.fn(async () => bitmap)
    vi.stubGlobal('createImageBitmap', spy)
    const backend = await load()
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    const d = await backend.decode(file)
    expect(spy).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(d).toMatchObject({ width: 2000, height: 3000, source: bitmap })
    d.dispose()
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('falls back to the plain call when the engine does not understand the option', async () => {
    const bitmap = { width: 10, height: 10, close: vi.fn() }
    const spy = vi.fn(async (_f, opts) => {
      if (opts) throw new TypeError("The provided value 'from-image' is not a valid enum value")
      return bitmap
    })
    vi.stubGlobal('createImageBitmap', spy)
    const backend = await load()
    const d = await backend.decode(new File(['x'], 'a.jpg'))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(d.width).toBe(10)
  })

  it('a decode failure is the caller\'s to report (it becomes ImageError corrupt / heic in convert.js)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('The source image could not be decoded', 'InvalidStateError') }))
    const backend = await load()
    await expect(backend.decode(new File(['x'], 'a.png'))).rejects.toThrow('could not be decoded')
  })
})

describe('scale', () => {
  it('goes through halving steps for a big reduction and releases the intermediate canvases', async () => {
    const backend = await load()
    const decoded = { width: 4000, height: 3000, source: { bitmap: true } }
    const out = await backend.scale(decoded, 320, 240)
    // 4000 -> 2000 -> 1000 -> 500, then the final 320 x 240 draw
    expect(canvases.map((c) => [c.draws[0]?.w, c.draws[0]?.h])).toEqual([[2000, 1500], [1000, 750], [500, 375], [320, 240]])
    expect(canvases.slice(0, 3).every((c) => c.width === 0 && c.height === 0)).toBe(true) // buffers dropped
    expect(out).toMatchObject({ width: 320, height: 240 })
    expect(out.source.width).toBe(320)
    out.dispose()
    expect(out.source.width).toBe(0)
  })

  it('draws once when the reduction is under 2x', async () => {
    const backend = await load()
    await backend.scale({ width: 1000, height: 800, source: {} }, 800, 640)
    expect(canvases).toHaveLength(1)
    expect(canvases[0].draws[0]).toMatchObject({ w: 800, h: 640 })
  })
})

describe('WebP encoding', () => {
  it('encodes image/webp with the requested quality', async () => {
    const backend = await load()
    const surface = await backend.scale({ width: 100, height: 100, source: {} }, 100, 100)
    const blob = await backend.encode(surface, { quality: 0.7 })
    expect(blob.type).toBe('image/webp')
    expect(surface.source.encoded).toEqual({ type: 'image/webp', quality: 0.7 })
  })

  it('a browser that answers PNG (Safari / iOS) is detected and the WASM encoder takes over: the pixels are read back and encoded to WebP', async () => {
    blobType = 'image/png'
    const backend = await load()
    expect(await backend.supportsWebp()).toBe(true) // the fallback exists wherever WebAssembly does
    const surface = await backend.scale({ width: 10, height: 6, source: {} }, 10, 6)
    const blob = await backend.encode(surface, { quality: 0.7 })
    expect(blob.type).toBe('image/webp')
    expect(wasm.encode).toHaveBeenCalledTimes(1)
    const [imageData, opts] = wasm.encode.mock.calls[0]
    expect(imageData).toMatchObject({ width: 10, height: 6 })
    expect(imageData.data).toHaveLength(10 * 6 * 4)
    expect(opts).toEqual({ quality: 0.7 })
    expect(surface.source.encoded).toBeUndefined() // the canvas encoder was not asked again
  })

  it('a native-WebP browser never touches the fallback', async () => {
    const backend = await load()
    const surface = await backend.scale({ width: 10, height: 10, source: {} }, 10, 10)
    await backend.encode(surface, { quality: 0.8 })
    expect(wasm.encode).not.toHaveBeenCalled()
  })

  it('when the fallback cannot load or run, encode answers null (convert.js then reports webpUnsupported: the original is NEVER uploaded)', async () => {
    blobType = 'image/png'
    wasm.encode.mockResolvedValue(null)
    const backend = await load()
    const surface = await backend.scale({ width: 10, height: 10, source: {} }, 10, 10)
    expect(await backend.encode(surface, { quality: 0.8 })).toBeNull()
    wasm.encode.mockRejectedValue(new Error('boom'))
    expect(await backend.encode(surface, { quality: 0.8 })).toBeNull()
  })

  it('without WebAssembly and without native WebP nothing can be produced', async () => {
    blobType = 'image/png'
    vi.stubGlobal('WebAssembly', undefined)
    const backend = await load()
    expect(await backend.supportsWebp()).toBe(false)
    const surface = await backend.scale({ width: 10, height: 10, source: {} }, 10, 10)
    expect(await backend.encode(surface, { quality: 0.8 })).toBeNull()
  })

  it('development switch: window.__forceNoNativeWebp makes a native browser use the fallback (how the WASM path is exercised in Chrome)', async () => {
    globalThis.__forceNoNativeWebp = true
    const backend = await load()
    const surface = await backend.scale({ width: 8, height: 8, source: {} }, 8, 8)
    const blob = await backend.encode(surface, { quality: 0.8 })
    expect(blob.type).toBe('image/webp')
    expect(wasm.encode).toHaveBeenCalledTimes(1)
    expect(surface.source.encoded).toBeUndefined()
  })

  it('supportsWebp is true when the canvas really answers WebP, and is probed once', async () => {
    const backend = await load()
    expect(await backend.supportsWebp()).toBe(true)
    const before = canvases.length
    expect(await backend.supportsWebp()).toBe(true)
    expect(canvases).toHaveLength(before)
  })
})
