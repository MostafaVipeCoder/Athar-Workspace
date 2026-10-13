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
 */
import { WEBP_MIME } from './profiles.js'

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

function encodeCanvas(canvas, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: WEBP_MIME, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, WEBP_MIME, quality))
}

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
    return blob && blob.type === WEBP_MIME ? blob : null
  }
  if (typeof WebAssembly !== 'object') return null
  try {
    const { encodeWithWasm } = await import('./wasmWebp.js')
    return await encodeWithWasm(readPixels(surface), { quality })
  } catch {
    return null
  }
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

export const browserBackend = { supportsWebp, decode, scale, encode }
