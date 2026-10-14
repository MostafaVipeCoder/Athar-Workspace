/**
 * Browser backend of the image pipeline: decode, resample and WebP-encode with `createImageBitmap` + `OffscreenCanvas` when the
 * browser has them (no DOM canvas, no full-size copy of the file in the page), `<img>` + `<canvas>` otherwise. Everything that touches
 * a browser API lives here, so `convert.js` is plain logic and can be unit-tested with a fake backend.
 *
 * Backend contract (what convert.js uses):
 *   supportsWebp()                    -> Promise<boolean>   WebP can be produced: the canvas encodes it, or (Safari / iOS: the canvas silently
 *                                                              answers PNG) the WebAssembly encoder of ./wasmWebp.js can take over
 *   decode(file)                      -> Promise<Decoded>   { width, height, source, dispose() }; EXIF orientation applied
 *   scale(decoded, width, height)     -> Promise<Surface>   { width, height, source, dispose() }; step-wise for big reductions
 *   encode(surface, { quality })      -> Promise<Blob|null> image/webp (native canvas, else the WASM fallback), or null when neither could
 *   OPTIONAL (shared images only: the JPEG link-preview derivative of owner decision 08 section 18.6; a backend without them makes none):
 *   coverCrop(decoded, width, height) -> Promise<Surface>   the image scaled to COVER width x height, centre-cropped, white behind transparency
 *   encodeJpeg(surface, { quality })  -> Promise<{ blob, progressive }|null>   image/jpeg: progressive mozjpeg (WASM) first, else the canvas encoder
 */
import { OG_MIME, WEBP_MIME } from './profiles.js'

/** How many encodes each path did since the last reset (the iPhone / Safari diagnostics page reads it: "native" or "wasm"). */
export const encoderStats = { webpNative: 0, webpWasm: 0, jpegNative: 0, jpegWasm: 0 }
export function resetEncoderStats() {
  for (const k of Object.keys(encoderStats)) encoderStats[k] = 0
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function releaseCanvas(c) {
  try {
    // a canvas keeps its pixel buffer until it is garbage-collected (iOS counts it against a small budget): drop it now
    c.width = 0
    c.height = 0
  } catch {
    /* nothing to release */
  }
}

let webpProbe = null
/** Forget the cached "can this canvas encode WebP" answer (the dev diagnostics page flips `__forceNoNativeWebp` and asks again). */
export function resetWebpProbe() {
  webpProbe = null
}
/** Can THIS browser's canvas encode WebP? (Chrome / Edge / Firefox yes; Safari and every iOS browser answer PNG.) */
async function nativeWebp() {
  if (!webpProbe) {
    webpProbe = (async () => {
      // development only: `window.__forceNoNativeWebp = true` (before the first upload) makes Chrome behave like Safari, to exercise the WASM fallback
      if (import.meta.env?.DEV && globalThis.__forceNoNativeWebp) return false
      try {
        const c = makeCanvas(2, 2)
        // an OffscreenCanvas with no rendering context refuses to encode (InvalidStateError): get one and paint a pixel first
        const ctx = c.getContext('2d')
        if (ctx) ctx.fillRect(0, 0, 2, 2)
        const blob = await encodeCanvas(c, 0.8)
        releaseCanvas(c)
        return Boolean(blob && blob.type === WEBP_MIME)
      } catch {
        return false
      }
    })()
  }
  return webpProbe
}

function encodeCanvasAs(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}
const encodeCanvas = (canvas, quality) => encodeCanvasAs(canvas, WEBP_MIME, quality)

/** The fallback is assumed wherever WebAssembly exists (every browser that can decode our images); it is downloaded only when an encode needs it. */
async function supportsWebp() {
  if (await nativeWebp()) return true
  return typeof WebAssembly === 'object'
}

/** Pixels of a canvas surface for the WASM encoder (a 1920 x 1440 cover is about 11 MB of RGBA, released with the surface). */
function readPixels(surface) {
  const ctx = surface.source.getContext('2d')
  return ctx.getImageData(0, 0, surface.width, surface.height)
}

async function encode(surface, { quality = 0.8 } = {}) {
  if (await nativeWebp()) {
    const blob = await encodeCanvas(surface.source, quality)
    if (blob && blob.type === WEBP_MIME) {
      encoderStats.webpNative += 1
      return blob
    }
    return null
  }
  if (typeof WebAssembly !== 'object') return null
  try {
    const { encodeWithWasm } = await import('./wasmWebp.js')
    const blob = await encodeWithWasm(readPixels(surface), { quality })
    if (blob) encoderStats.webpWasm += 1
    return blob
  } catch {
    return null
  }
}

/** JPEG for the link-preview derivative: progressive mozjpeg (WASM) first, else the canvas's own encoder (baseline, every browser has it). */
async function encodeJpeg(surface, { quality = 0.82 } = {}) {
  if (typeof WebAssembly === 'object' && !(import.meta.env?.DEV && globalThis.__forceNativeJpeg)) {
    try {
      const { encodeJpegWithWasm } = await import('./wasmJpeg.js')
      const blob = await encodeJpegWithWasm(readPixels(surface), { quality })
      if (blob) {
        encoderStats.jpegWasm += 1
        return { blob, progressive: true }
      }
    } catch {
      /* fall through to the canvas encoder */
    }
  }
  try {
    const blob = await encodeCanvasAs(surface.source, OG_MIME, quality)
    if (blob && blob.type === OG_MIME) {
      encoderStats.jpegNative += 1
      return { blob, progressive: false }
    }
  } catch {
    /* no JPEG at all: the caller skips the derivative */
  }
  return null
}

function loadWithImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight, source: img, dispose() {} })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image decode failed'))
    }
    img.src = url
  })
}

/** `imageOrientation: 'from-image'` makes a phone photo upright; older engines reject the option, so fall back to their default. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    let bitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch (err) {
      if (err instanceof TypeError) bitmap = await createImageBitmap(file) // option not understood
      else throw err
    }
    return { width: bitmap.width, height: bitmap.height, source: bitmap, dispose: () => bitmap.close?.() }
  }
  return loadWithImageElement(file)
}

/** Resample to width x height. A reduction of more than 2x goes through halving steps (single-step downscaling aliases). */
async function scale(decoded, width, height) {
  let src = decoded.source
  let cw = decoded.width
  let ch = decoded.height
  let owned = null
  while (cw / 2 >= width && ch / 2 >= height && cw > 1 && ch > 1) {
    const nw = Math.max(width, Math.floor(cw / 2))
    const nh = Math.max(height, Math.floor(ch / 2))
    const step = makeCanvas(nw, nh)
    const ctx = step.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, nw, nh)
    if (owned) releaseCanvas(owned)
    owned = step
    src = step
    cw = nw
    ch = nh
  }
  const out = makeCanvas(width, height)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, width, height)
  if (owned) releaseCanvas(owned)
  return { width, height, source: out, dispose: () => releaseCanvas(out) }
}

/** The size a source is scaled to so that it COVERS width x height (both sides >= the target), and where the centre crop starts. Pure. */
export function coverGeometry(sourceWidth, sourceHeight, width, height) {
  const k = Math.max(width / sourceWidth, height / sourceHeight)
  const cw = Math.max(width, Math.round(sourceWidth * k))
  const ch = Math.max(height, Math.round(sourceHeight * k))
  return { cw, ch, sx: Math.round((cw - width) / 2), sy: Math.round((ch - height) / 2) }
}

/**
 * Scale to cover width x height and crop the centre (what `object-fit: cover` shows). The reduction goes through `scale` (halving steps, no aliasing);
 * white is painted first because a JPEG has no alpha (a transparent PNG cover must not turn black).
 */
async function coverCrop(decoded, width, height) {
  const { cw, ch, sx, sy } = coverGeometry(decoded.width, decoded.height, width, height)
  const scaled = await scale(decoded, cw, ch)
  const out = makeCanvas(width, height)
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(scaled.source, sx, sy, width, height, 0, 0, width, height)
  scaled.dispose()
  return { width, height, source: out, dispose: () => releaseCanvas(out) }
}

/**
 * What THIS browser's canvas does with an encode request, for the diagnostics page (fresh probes, nothing cached): { ok, type, bytes, ms, error }.
 * `via` = 'offscreen' | 'dom'; `type` = the MIME type asked for. A browser that cannot encode the type answers PNG (Safari / iOS for WebP), which shows as ok: false.
 */
export async function probeCanvasEncode(type, via = 'offscreen') {
  const t0 = performance.now()
  try {
    let canvas
    if (via === 'offscreen') {
      if (typeof OffscreenCanvas !== 'function') return { ok: false, type: null, bytes: 0, ms: 0, error: 'OffscreenCanvas is not available' }
      canvas = new OffscreenCanvas(16, 16)
    } else {
      canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
    }
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1a27c9'
    ctx.fillRect(0, 0, 16, 16)
    const blob = await encodeCanvasAs(canvas, type, 0.8)
    releaseCanvas(canvas)
    return { ok: Boolean(blob && blob.type === type), type: blob?.type ?? null, bytes: blob?.size ?? 0, ms: Math.round((performance.now() - t0) * 10) / 10, error: blob ? null : 'the canvas returned nothing' }
  } catch (err) {
    return { ok: false, type: null, bytes: 0, ms: Math.round((performance.now() - t0) * 10) / 10, error: String(err?.name ? `${err.name}: ${err.message}` : err) }
  }
}

export const browserBackend = { supportsWebp, decode, scale, encode, coverCrop, encodeJpeg }
