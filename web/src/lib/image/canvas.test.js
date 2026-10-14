import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser backend against fake `createImageBitmap` / `OffscreenCanvas` (jsdom has neither): the calls that make the pipeline
 * correct in a real browser - EXIF orientation, halving steps, WebP-encode probing, releasing pixel buffers.
 */
const wasm = vi.hoisted(() => ({ encode: vi.fn() }))
const wasmJpeg = vi.hoisted(() => ({ encode: vi.fn() }))
vi.mock('./wasmWebp.js', () => ({ encodeWithWasm: wasm.encode }))
vi.mock('./wasmJpeg.js', () => ({ encodeJpegWithWasm: wasmJpeg.encode }))

let canvases
let blobType

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.draws = []
    this.fills = []
    canvases.push(this)
  }

  getContext() {
    this.hasContext = true
    return {
      imageSmoothingQuality: '',
      drawImage: (src, ...rest) => this.draws.push(rest.length === 8 ? { src, sx: rest[0], sy: rest[1], sw: rest[2], sh: rest[3], dx: rest[4], dy: rest[5], w: rest[6], h: rest[7] } : { src, w: rest[2], h: rest[3] }),
      fillRect: (x, y, w, h) => this.fills.push({ x, y, w, h }),
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
  wasmJpeg.encode.mockReset().mockResolvedValue(new Blob([new Uint8Array(9)], { type: 'image/jpeg' }))
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.__forceNoNativeWebp
  delete globalThis.__forceNativeJpeg
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

describe('coverGeometry: scale to COVER the target, then crop the centre (object-fit: cover)', () => {
  it('a wide source is scaled by height and cropped left / right; a tall one is scaled by width and cropped top / bottom; the exact ratio crops nothing', async () => {
    vi.resetModules()
    const { coverGeometry } = await import('./canvas.js')
    expect(coverGeometry(4000, 3000, 1200, 630)).toEqual({ cw: 1200, ch: 900, sx: 0, sy: 135 }) // 4:3 -> crop the top / bottom
    expect(coverGeometry(3000, 1000, 1200, 630)).toEqual({ cw: 1890, ch: 630, sx: 345, sy: 0 }) // panorama -> crop left / right
    expect(coverGeometry(2400, 1260, 1200, 630)).toEqual({ cw: 1200, ch: 630, sx: 0, sy: 0 })
    expect(coverGeometry(600, 400, 1200, 630)).toMatchObject({ cw: 1200, ch: 800 }) // a small source is scaled UP to cover (the preview is always 1200 x 630)
  })
})

describe('coverCrop', () => {
  it('draws the centre of the scaled image into a white-filled 1200 x 630 canvas and releases the intermediate', async () => {
    const backend = await load()
    const out = await backend.coverCrop({ width: 4000, height: 3000, source: { bitmap: true } }, 1200, 630)
    const last = canvases.at(-1)
    expect(out).toMatchObject({ width: 1200, height: 630 })
    expect(last.width).toBe(1200)
    expect(last.fills[0]).toMatchObject({ x: 0, y: 0, w: 1200, h: 630 }) // white first: a JPEG has no alpha
    expect(last.draws.at(-1)).toMatchObject({ sx: 0, sy: 135, sw: 1200, sh: 630, dx: 0, dy: 0, w: 1200, h: 630 })
    // the 1200 x 900 intermediate (after halving steps) was dropped
    expect(canvases.filter((c) => c !== last).every((c) => c.width === 0 && c.height === 0)).toBe(true)
    out.dispose()
    expect(out.source.width).toBe(0)
  })
})

describe('JPEG encoding for the link-preview derivative', () => {
  it('progressive mozjpeg (WASM) first; the pixels are read back and the result says progressive', async () => {
    const backend = await load()
    const surface = await backend.scale({ width: 10, height: 6, source: {} }, 10, 6)
    const r = await backend.encodeJpeg(surface, { quality: 0.82 })
    expect(r.blob.type).toBe('image/jpeg')
    expect(r.progressive).toBe(true)
    expect(wasmJpeg.encode).toHaveBeenCalledTimes(1)
    expect(wasmJpeg.encode.mock.calls[0][0]).toMatchObject({ width: 10, height: 6 })
    expect(wasmJpeg.encode.mock.calls[0][1]).toEqual({ quality: 0.82 })
    expect(surface.source.encoded).toBeUndefined()
  })

  it('when the WASM encoder cannot load or run, the canvas encoder answers (baseline JPEG, every browser has it)', async () => {
    wasmJpeg.encode.mockResolvedValue(null)
    const backend = await load()
    const surface = await backend.scale({ width: 10, height: 6, source: {} }, 10, 6)
    const r = await backend.encodeJpeg(surface, { quality: 0.7 })
    expect(r.progressive).toBe(false)
    expect(r.blob.type).toBe('image/jpeg')
    expect(surface.source.encoded).toEqual({ type: 'image/jpeg', quality: 0.7 })
    wasmJpeg.encode.mockRejectedValue(new Error('boom'))
    expect((await backend.encodeJpeg(surface, { quality: 0.7 })).progressive).toBe(false)
  })

  it('without WebAssembly the canvas encoder is used directly; the development switch __forceNativeJpeg does the same in Chrome', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const noWasm = await load()
    const a = await noWasm.encodeJpeg(await noWasm.scale({ width: 8, height: 8, source: {} }, 8, 8), {})
    expect(a.progressive).toBe(false)
    expect(wasmJpeg.encode).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    globalThis.__forceNativeJpeg = true
    const backend = await load()
    const b = await backend.encodeJpeg(await backend.scale({ width: 8, height: 8, source: {} }, 8, 8), {})
    expect(b.progressive).toBe(false)
    expect(wasmJpeg.encode).not.toHaveBeenCalled()
  })

  it('a canvas that cannot make JPEG at all answers null (the caller skips the derivative)', async () => {
    wasmJpeg.encode.mockResolvedValue(null)
    blobType = 'image/png'
    const backend = await load()
    const surface = await backend.scale({ width: 8, height: 8, source: {} }, 8, 8)
    expect(await backend.encodeJpeg(surface, { quality: 0.8 })).toBeNull()
  })

  it('the encoder counters say which path did the work (the iPhone diagnostics page shows them)', async () => {
    vi.resetModules()
    const mod = await import('./canvas.js')
    mod.resetEncoderStats()
    const surface = await mod.browserBackend.scale({ width: 8, height: 8, source: {} }, 8, 8)
    await mod.browserBackend.encode(surface, { quality: 0.8 })
    await mod.browserBackend.encodeJpeg(surface, { quality: 0.8 })
    expect(mod.encoderStats).toEqual({ webpNative: 1, webpWasm: 0, jpegNative: 0, jpegWasm: 1 })
    mod.resetEncoderStats()
    expect(mod.encoderStats).toEqual({ webpNative: 0, webpWasm: 0, jpegNative: 0, jpegWasm: 0 })
  })
})

describe('probeCanvasEncode (diagnostics)', () => {
  it('reports what the canvas answers for a type: ok when it is the type asked for, not ok when the browser silently answers PNG (Safari for WebP)', async () => {
    vi.resetModules()
    const { probeCanvasEncode } = await import('./canvas.js')
    expect(await probeCanvasEncode('image/webp', 'offscreen')).toMatchObject({ ok: true, type: 'image/webp', bytes: 10 })
    blobType = 'image/png'
    expect(await probeCanvasEncode('image/webp', 'offscreen')).toMatchObject({ ok: false, type: 'image/png' })
  })
  it('says why when there is no OffscreenCanvas, and can probe the DOM canvas path', async () => {
    vi.resetModules()
    const { probeCanvasEncode } = await import('./canvas.js')
    vi.stubGlobal('OffscreenCanvas', undefined)
    expect(await probeCanvasEncode('image/jpeg', 'offscreen')).toMatchObject({ ok: false, error: expect.stringContaining('OffscreenCanvas') })
    const dom = document.createElement('canvas')
    dom.getContext = () => ({ fillRect: () => {}, set fillStyle(_v) {} })
    dom.toBlob = (cb, type) => cb(new Blob([new Uint8Array(4)], { type }))
    const original = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? dom : original(tag)))
    expect(await probeCanvasEncode('image/jpeg', 'dom')).toMatchObject({ ok: true, type: 'image/jpeg', bytes: 4 })
  })
})
