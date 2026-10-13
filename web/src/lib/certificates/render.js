import { VARIABLES, anchorX, fieldBox, fontString, layoutText, sortFields } from './layout.js'
import { drawQr, qrMatrix } from './qr.js'

/**
 * THE certificate renderer (decision 06-5: client canvas, because PDF libraries cannot shape Arabic and the browser can).
 * One function serves the PM editor preview, the PM view, the founder download and the public verifier page, so what a PM
 * previews is exactly what is downloaded and verified.
 *
 *   renderCertificate({ canvas, image, fields, values, verifyUrl, scale, maxSide, fontLoader })
 *
 * - `image`: the decoded template (ImageBitmap / HTMLImageElement); its natural size is the certificate's native resolution.
 * - `fields`: client fields (lib/certificates/layout.js); `values`: { variable: printed text } (certValues / SAMPLES).
 * - `verifyUrl`: what the QR encodes (generated locally). A QR field without a URL is skipped.
 * - `scale`: 1 = native size; the preview passes a fraction. `maxSide` caps the long side (memory / canvas limits).
 * - Fonts are loaded BEFORE anything is drawn (document.fonts.load per used font with the exact text, then document.fonts.ready),
 *   otherwise the first draw would use a fallback font. `fontLoader` is injectable for tests.
 * Arabic shaping and bidi are the browser's: we set `ctx.direction` and draw whole lines with fillText, never glyph by glyph.
 * Returns { canvas, width, height, boxes, overflow } (`boxes` are the field boxes in canvas pixels, `overflow` the variables whose
 * text does not fit its box).
 */
export const MAX_SIDE = 4200

const sizeOf = (image) => ({ width: image.naturalWidth ?? image.width, height: image.naturalHeight ?? image.height })

/** Make sure every font used by the fields (with the exact characters to print) is loaded. */
export async function ensureFonts(fields, values, { fontLoader = defaultFontLoader } = {}) {
  const jobs = []
  const seen = new Set()
  for (const f of fields) {
    if (f.var === 'verification_qr') continue
    const text = String(values?.[f.var] ?? '') || 'Ag'
    const key = `${f.font}|${f.weight}|${text}`
    if (seen.has(key)) continue
    seen.add(key)
    jobs.push(fontLoader(fontString(f, 32), text))
  }
  await Promise.all(jobs)
  await fontLoader(null, null)
}

function defaultFontLoader(font, text) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null
  if (!fonts) return Promise.resolve()
  if (font === null) return fonts.ready.then(() => undefined)
  return fonts.load(font, text).catch(() => [])
}

export async function renderCertificate({ canvas, image, fields, values, verifyUrl = null, scale = 1, maxSide = MAX_SIDE, fontLoader, qr = null }) {
  const native = sizeOf(image)
  if (!native.width || !native.height) throw new Error('certificate: the template image has no size')
  const factor = Math.min(scale, maxSide / Math.max(native.width, native.height))
  const W = Math.max(1, Math.round(native.width * factor))
  const H = Math.max(1, Math.round(native.height * factor))
  const list = sortFields(fields ?? [])
  await ensureFonts(list, values, { fontLoader })

  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  // an opaque page even for a template with transparency (the PDF export has no alpha)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(image, 0, 0, W, H)

  const boxes = {}
  const overflow = {}
  for (const field of list) {
    const type = VARIABLES.find((v) => v.key === field.var)?.type
    if (type === 'qr') {
      const box = fieldBox(field, W, H)
      boxes[field.var] = { left: box.left, top: box.top, width: box.width, height: box.height }
      if (verifyUrl) {
        const matrix = qr ?? qrMatrix(verifyUrl)
        drawQr(ctx, matrix, box.left, box.top, box.width)
      }
      continue
    }
    const text = String(values?.[field.var] ?? '')
    const measure = (s, px) => {
      ctx.font = fontString(field, px)
      return ctx.measureText(s).width
    }
    const laid = layoutText(measure, text, field, W, H)
    boxes[field.var] = { left: laid.box.left, top: laid.box.top, width: laid.box.width, height: Math.max(laid.box.height, laid.lines.length * laid.lineHeight) }
    overflow[field.var] = laid.overflow
    if (!laid.lines.length) continue
    ctx.font = fontString(field, laid.fontPx)
    ctx.fillStyle = field.color
    ctx.direction = laid.direction
    ctx.textAlign = field.align
    ctx.textBaseline = 'middle'
    const x = anchorX(field, laid.box)
    const top = laid.box.cy - (laid.lines.length * laid.lineHeight) / 2
    laid.lines.forEach((line, i) => ctx.fillText(line.text, x, top + laid.lineHeight * (i + 0.5)))
  }
  return { canvas, width: W, height: H, boxes, overflow }
}

/** canvas -> Blob (PNG by default). `toBlob`, not `toDataURL`: no base64 copy of a 4000 px image. */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') { reject(new Error('certificate: this browser cannot export the canvas')); return }
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('certificate: the export failed'))), type, quality)
  })
}

/** Names a downloaded file after the printed name and the code: `Certificate - Sara Ali - AB12-CD34-EF56.png`. */
export function certificateFileName(name, code, ext = 'png') {
  const safe = Array.from(String(name ?? ''), (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch)).join('')
  const base = safe.replace(/\s+/g, ' ').trim().slice(0, 60)
  return `Certificate${base ? ` - ${base}` : ''}${code ? ` - ${code}` : ''}.${ext}`
}

