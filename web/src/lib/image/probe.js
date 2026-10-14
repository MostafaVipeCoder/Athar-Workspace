/**
 * The browser probes of the diagnostics page (/dev/image-check, owner decision 08 section 18.5): what THIS browser can do with images, measured now,
 * nothing cached. Browser APIs live here and in canvas.js; the pure part (verdicts, the report text) is diagnostics.js.
 *
 *   runProbes({ forceNoNativeWebp })  -> { forcedNoNativeWebp, nativeWebp: { offscreen, dom }, nativeJpeg: { offscreen, dom }, wasmWebp, wasmJpeg, decision }
 *
 * `decision` is what the real pipeline (canvas.js) will do in this browser: WebP = 'native' (the canvas encodes it: Chrome, Edge, Firefox) | 'wasm'
 * (Safari / iPhone: the canvas answers PNG, the WebAssembly encoder takes over) | 'none'; JPEG = 'wasm' (progressive mozjpeg) | 'canvas' (baseline) | 'none'.
 */
import { browserBackend, probeCanvasEncode, resetWebpProbe } from './canvas.js'
import { isJpegBytes, isProgressiveJpeg, isWebpBytes } from './diagnostics.js'
import { bytesOf } from './sniff.js'

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const head = (blob, n = 64 * 1024) => bytesOf(blob.slice(0, n))

/** Encode a 32 x 32 gradient twice with a WASM encoder: the first run includes downloading + compiling the codec, the second is the warm cost. */
async function probeWasm(load, check) {
  try {
    const encode = await load()
    const pixels = new ImageData(32, 32)
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = (i / 4) % 32 * 8
      pixels.data[i + 1] = 64
      pixels.data[i + 2] = 200
      pixels.data[i + 3] = 255
    }
    const t0 = now()
    const first = await encode(pixels, { quality: 0.8 })
    const t1 = now()
    if (!first) return { ok: false, coldMs: Math.round(t1 - t0), warmMs: null, bytes: 0, error: 'the encoder returned nothing' }
    await encode(pixels, { quality: 0.8 })
    const t2 = now()
    return { ok: true, coldMs: Math.round(t1 - t0), warmMs: Math.round(t2 - t1), bytes: first.size, ...(await check(first)) }
  } catch (err) {
    return { ok: false, coldMs: null, warmMs: null, bytes: 0, error: String(err?.name ? `${err.name}: ${err.message}` : err) }
  }
}

export async function runProbes({ forceNoNativeWebp = false } = {}) {
  // development only (canvas.js honours it only in dev builds): switch the native WebP encoder off to exercise the WebAssembly path in Chrome
  if (import.meta.env?.DEV) {
    if (forceNoNativeWebp) globalThis.__forceNoNativeWebp = true
    else delete globalThis.__forceNoNativeWebp
  }
  resetWebpProbe()
  const [webpOff, webpDom, jpegOff, jpegDom] = await Promise.all([
    probeCanvasEncode('image/webp', 'offscreen'),
    probeCanvasEncode('image/webp', 'dom'),
    probeCanvasEncode('image/jpeg', 'offscreen'),
    probeCanvasEncode('image/jpeg', 'dom'),
  ])
  const wasmWebp = typeof WebAssembly === 'object'
    ? await probeWasm(async () => (await import('./wasmWebp.js')).encodeWithWasm, async (blob) => ({ magic: isWebpBytes(await head(blob)) }))
    : { ok: false, coldMs: null, warmMs: null, bytes: 0, error: 'WebAssembly is not available' }
  const wasmJpeg = typeof WebAssembly === 'object'
    ? await probeWasm(async () => (await import('./wasmJpeg.js')).encodeJpegWithWasm, async (blob) => {
      const bytes = await head(blob)
      return { jpegMagic: isJpegBytes(bytes), progressive: isProgressiveJpeg(bytes) === true }
    })
    : { ok: false, coldMs: null, warmMs: null, bytes: 0, error: 'WebAssembly is not available' }

  // what the pipeline's own backend decides (it probes the canvas it will really use: OffscreenCanvas when present, else the page canvas)
  const usesOffscreen = typeof OffscreenCanvas === 'function'
  const canvasWebp = forceNoNativeWebp ? false : (usesOffscreen ? webpOff.ok : webpDom.ok)
  const canvasJpeg = usesOffscreen ? jpegOff.ok : jpegDom.ok
  const supported = await browserBackend.supportsWebp()
  const decision = {
    webp: canvasWebp ? 'native' : supported && wasmWebp.ok ? 'wasm' : 'none',
    jpeg: wasmJpeg.ok && wasmJpeg.jpegMagic !== false ? 'wasm' : canvasJpeg ? 'canvas' : 'none',
  }
  return { forcedNoNativeWebp: Boolean(forceNoNativeWebp && import.meta.env?.DEV), nativeWebp: { offscreen: webpOff, dom: webpDom }, nativeJpeg: { offscreen: jpegOff, dom: jpegDom }, wasmWebp, wasmJpeg, decision }
}
