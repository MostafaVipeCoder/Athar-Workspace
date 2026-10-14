/**
 * PROGRESSIVE JPEG ENCODER for the link-preview derivative (owner decision 08 section 18.6). A browser canvas can only write BASELINE JPEG at an
 * unknown quality curve; the derivative of an uploaded cover is a progressive, optimised JPEG (smaller at the same quality, renders from a blurry
 * pass while it loads), which needs mozjpeg: `@jsquash/jpeg` (Apache-2.0, the Squoosh codec), a 250 KB WebAssembly module.
 *
 * Same rules as `wasmWebp.js`: a DYNAMIC import chain started only by `canvas.js` when a shared image (cover, landing, share image) is uploaded, never by a
 * page that merely shows images; the .wasm file is emitted by Vite as a hashed static asset and fetched on demand, once per session, then cached;
 * a codec that cannot load or run answers null and the backend falls back to the browser canvas's own JPEG encoder (baseline, always available), so a
 * blocked / offline / old browser still gets its derivative.
 *
 * `encodeJpegWithWasm(imageData, { quality })` -> Blob (image/jpeg, progressive) | null. `quality` is the pipeline's 0..1 scale.
 */
import { OG_MIME } from './profiles.js'

let loading = null

function loadEncoder() {
  if (!loading) {
    loading = (async () => {
      const [{ init, default: encode }, wasm] = await Promise.all([
        import('@jsquash/jpeg/encode.js'),
        import('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url'),
      ])
      // the package asks for its .wasm through locateFile: serve our own hashed asset
      await init({ locateFile: () => wasm.default })
      return encode
    })().catch((err) => {
      loading = null // a failed download may be retried on the next upload
      throw err
    })
  }
  return loading
}

/** The options of one encode: progressive + optimised Huffman tables (mozjpeg's defaults), quality 1..100 from the 0..1 pipeline scale. */
export function jpegOptions(quality) {
  const q = Number(quality)
  return { quality: Math.max(1, Math.min(100, Math.round((Number.isFinite(q) ? q : 0.82) * 100))), progressive: true, baseline: false, optimize_coding: true }
}

export async function encodeJpegWithWasm(imageData, { quality = 0.82 } = {}) {
  try {
    const encode = await loadEncoder()
    const buffer = await encode(imageData, jpegOptions(quality))
    return buffer?.byteLength ? new Blob([buffer], { type: OG_MIME }) : null
  } catch {
    return null
  }
}
