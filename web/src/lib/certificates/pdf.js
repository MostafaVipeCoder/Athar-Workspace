/**
 * A MINIMAL pure-JS PDF writer for ONE full-page image (design 07 section 4.4: "client canvas -> PNG wrapped in PDF"). The certificate is
 * drawn by the browser canvas (the only place Arabic is shaped correctly), so the PDF only has to carry that picture: no text, no
 * fonts, no dependency. Lossless: the RGB pixels are deflated with the browser's CompressionStream (FlateDecode); where it does not
 * exist the canvas is embedded as a high-quality JPEG (DCTDecode) instead.
 *
 * Objects: 1 Catalog, 2 Pages, 3 Page, 4 content stream (draws the image over the whole page), 5 image XObject, 6 Info.
 */

const encoder = new TextEncoder()
const A4 = { w: 841.89, h: 595.28 }
const LETTER = { w: 792, h: 612 }

/** Page size in points: A4 / Letter when the image has that proportion (landscape or portrait), else the long side fits an A4 long side. */
export function pageSizeFor(width, height) {
  const landscape = width >= height
  const ratio = Math.max(width, height) / Math.min(width, height)
  const pick = (std) => (landscape ? { w: std.w, h: std.h } : { w: std.h, h: std.w })
  if (Math.abs(ratio - A4.w / A4.h) / (A4.w / A4.h) <= 0.03) return pick(A4)
  if (Math.abs(ratio - LETTER.w / LETTER.h) / (LETTER.w / LETTER.h) <= 0.03) return pick(LETTER)
  const long = A4.w
  return landscape ? { w: long, h: (long * height) / width } : { w: (long * width) / height, h: long }
}

const fmt = (n) => (Math.round(n * 100) / 100).toString()

/** pdf-safe ASCII for the Info title (non-ASCII is dropped: the Info dictionary is not essential). */
const ascii = (s) => String(s ?? '').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, ' ').trim()

/**
 * @param {{ width: number, height: number, kind: 'flate'|'jpeg', bytes: Uint8Array, title?: string }} image
 * @returns {Uint8Array} the PDF file
 */
export function buildPdf({ width, height, kind, bytes, title = '' }) {
  const page = pageSizeFor(width, height)
  const parts = []
  const offsets = []
  let length = 0
  const push = (chunk) => {
    const data = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    parts.push(data)
    length += data.length
  }
  const object = (n, dict, stream = null) => {
    offsets[n] = length
    push(`${n} 0 obj\n${dict}\n`)
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n') }
    push('endobj\n')
  }

  push('%PDF-1.4\n%âãÏÓ\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.w)} ${fmt(page.h)}] /Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>`)
  const content = encoder.encode(`q\n${fmt(page.w)} 0 0 ${fmt(page.h)} 0 0 cm\n/Im0 Do\nQ\n`)
  object(4, `<< /Length ${content.length} >>`, content)
  const filter = kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode'
  object(5, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${bytes.length} >>`, bytes)
  object(6, `<< /Title (${ascii(title) || 'Certificate'}) /Producer (Athar) >>`)

  const xrefAt = length
  let xref = `xref\n0 7\n0000000000 65535 f \n`
  for (let n = 1; n <= 6; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** RGBA (canvas ImageData) -> packed RGB, composited on white (the canvas is already opaque; this just drops the alpha channel). */
export function rgbaToRgb(rgba) {
  const pixels = rgba.length / 4
  const rgb = new Uint8Array(pixels * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3]
    if (a === 255) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2] } else {
      const k = a / 255
      rgb[j] = Math.round(rgba[i] * k + 255 * (1 - k))
      rgb[j + 1] = Math.round(rgba[i + 1] * k + 255 * (1 - k))
      rgb[j + 2] = Math.round(rgba[i + 2] * k + 255 * (1 - k))
    }
  }
  return rgb
}

/** zlib (deflate) through the platform CompressionStream; null when the platform has none. */
export async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null
  const readable = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
  return new Uint8Array(await new Response(readable.pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
}

/**
 * canvas -> PDF Blob. Lossless when CompressionStream exists, otherwise JPEG (quality 0.95). `title` goes into the Info dictionary.
 */
export async function canvasToPdfBlob(canvas, { title = '' } = {}) {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')
  const raw = rgbaToRgb(ctx.getImageData(0, 0, width, height).data)
  const packed = await deflate(raw)
  if (packed) return new Blob([buildPdf({ width, height, kind: 'flate', bytes: packed, title })], { type: 'application/pdf' })
  const jpeg = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('certificate: the PDF export failed'))), 'image/jpeg', 0.95))
  return new Blob([buildPdf({ width, height, kind: 'jpeg', bytes: new Uint8Array(await jpeg.arrayBuffer()), title })], { type: 'application/pdf' })
}
