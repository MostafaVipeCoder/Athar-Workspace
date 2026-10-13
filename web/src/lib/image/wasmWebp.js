/**
 * WebP ENCODER FALLBACK (review finding: Safari and every iOS browser cannot encode WebP from a canvas: `canvas.toBlob('image/webp')` answers
 * PNG, so without this module no iPhone / Safari user could upload ANY image once the server (m41) refuses PNG).
 *
 * libwebp compiled to WebAssembly (`@jsquash/webp`, Apache-2.0, the Squoosh codec). It is a DYNAMIC import chain started only by
 * `canvas.js` when the browser's own canvas cannot encode WebP: Chrome / Edge / Firefox never download a byte of it (the two .wasm files are
 * emitted as static assets by Vite and fetched on demand: about 280 KB, or 345 KB with SIMD, once per session and then cached).
 *
 * `encodeWithWasm(imageData, { quality })` -> Blob (image/webp) | null. `quality` is the pipeline's 0..1 scale; 1 means lossless (frames).
 * Alpha is kept (the lossy encoder carries a full-quality alpha plane). A codec that cannot load or run answers null, which the pipeline turns
 * into the clear "this browser cannot convert images to WebP" message: the original raster is NEVER uploaded instead.
 */
import { WEBP_MIME } from './profiles.js'

let loading = null

function loadEncoder() {
  if (!loading) {
    loading = (async () => {
      const [{ init, default: encode }, plain, simd] = await Promise.all([
        import('@jsquash/webp/encode.js'),
        import('@jsquash/webp/codec/enc/webp_enc.wasm?url'),
        import('@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'),
      ])
      // the package picks the SIMD or the plain glue by feature detection; both ask for their .wasm through locateFile: serve our own hashed assets
      await init({ locateFile: (name) => (String(name).includes('simd') ? simd.default : plain.default) })
      return encode
    })().catch((err) => {
      loading = null // a failed download may be retried on the next upload
      throw err
    })
  }
  return loading
}

/** The options of one encode: quality 1 = lossless, else lossy at quality * 100 (method 4 = the libwebp default speed / size balance). */
export function wasmOptions(quality) {
  const q = Number(quality)
  return q >= 1 ? { lossless: 1, exact: 0, method: 4 } : { quality: Math.max(1, Math.min(99, Math.round((Number.isFinite(q) ? q : 0.8) * 100))), method: 4 }
}

export async function encodeWithWasm(imageData, { quality = 0.8 } = {}) {
  try {
    const encode = await loadEncoder()
    const buffer = await encode(imageData, wasmOptions(quality))
    return buffer?.byteLength ? new Blob([buffer], { type: WEBP_MIME }) : null
  } catch {
    return null
  }
}
