import { MAX_SOURCE_BYTES } from '../image/profiles.js'
import { readHead, sniffImage } from '../image/sniff.js'

/**
 * Template image rules (design 07 section 4.3, owner decisions 08 section 17.2 + 17.3): the PM picks a PNG, JPEG or WebP (no PDF templates);
 * the browser pipeline (lib/image, profile 'template': max 4000 px, high quality, alpha kept, NO thumbnail) converts it to WebP and stores THAT
 * in the private bucket (the bucket and a restrictive policy refuse anything else, m42). The checks below are about the DECODED pixels (size,
 * aspect, resolution), never about the file type, and run on the SOURCE before anything is uploaded; the stored width / height come from the
 * converted image (the fields are fractions, so a smaller stored image changes nothing for the layout).
 * A PDF is not supported: converting a PDF page to an image needs pdf.js (~1 MB + a worker); the PM exports the design as an image instead
 * (A4 at 150-300 dpi = 1754 x 1240 .. 3508 x 2480 px).
 */
export const TEMPLATE_RULES = {
  /** The SOURCE file: the pipeline's own ceiling (the stored WebP is a fraction of it). */
  maxBytes: MAX_SOURCE_BYTES,
  types: ['image/png', 'image/jpeg', 'image/webp'],
  minShortSide: 600,
  minLongSide: 1000,
  recommendedLongSide: 1754,
  maxSide: 8000,
  maxAspect: 2.5,
}
export const TEMPLATE_ACCEPT = 'image/png,image/jpeg,image/webp'

export const PAPER = { a4: 297 / 210, letter: 11 / 8.5 }

/** The MIME type of a file, by declared type then extension. */
export function templateMime(file) {
  if (TEMPLATE_RULES.types.includes(file?.type)) return file.type
  const ext = /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return null
}

/** null when acceptable, else a problem code: 'empty' | 'type' | 'size'. */
export function validateTemplateFile(file) {
  if (!file || !file.size) return 'empty'
  if (!templateMime(file)) return 'type'
  if (file.size > TEMPLATE_RULES.maxBytes) return 'size'
  return null
}

/**
 * Size checks on the decoded image. Errors block the upload, warnings are shown but allowed.
 * errors:   tooSmall | tooLarge | badAspect
 * warnings: lowResolution (long side under A4 at 150 dpi) | notPaper (neither A4 nor Letter)
 * Returns { errors, warnings, orientation, ratio, paper } (paper: 'a4' | 'letter' | null).
 */
export function checkTemplateSize(width, height) {
  const errors = []
  const warnings = []
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const ratio = long / Math.max(1, short)
  if (short < TEMPLATE_RULES.minShortSide || long < TEMPLATE_RULES.minLongSide) errors.push('tooSmall')
  if (long > TEMPLATE_RULES.maxSide) errors.push('tooLarge')
  if (ratio > TEMPLATE_RULES.maxAspect) errors.push('badAspect')
  const near = (std) => Math.abs(ratio - std) / std <= 0.03
  const paper = near(PAPER.a4) ? 'a4' : near(PAPER.letter) ? 'letter' : null
  if (!errors.includes('tooSmall') && long < TEMPLATE_RULES.recommendedLongSide) warnings.push('lowResolution')
  if (!errors.length && !paper) warnings.push('notPaper')
  return { errors, warnings, orientation: width >= height ? 'landscape' : 'portrait', ratio: Math.round(ratio * 1000) / 1000, paper }
}

/**
 * The pixel size from the file HEADER (lib/image/sniff: PNG IHDR, JPEG SOF, WebP VP8*), no decode: reading two numbers must not cost a bitmap of up to
 * 8000 x 5600 px (about 180 MB) that the conversion would decode again. Null when the header does not say (the caller then decodes once and closes it).
 */
export async function peekTemplateSize(file) {
  try {
    const info = sniffImage(await readHead(file))
    return info.width > 0 && info.height > 0 ? { width: info.width, height: info.height } : null
  } catch {
    return null
  }
}

/** Decode a File/Blob into a bitmap (EXIF orientation honoured by the browser) + its size. Caller owns the bitmap. */
export async function decodeTemplateFile(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { image: bitmap, width: bitmap.width, height: bitmap.height }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('certificate: the image could not be read'))
      el.src = url
    })
    return { image: img, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Load an image from a (signed) URL WITHOUT tainting a canvas: fetch -> bitmap, `<img crossOrigin>` as the fallback. */
export async function loadTemplateImage(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`certificate: template download failed (${res.status})`)
    const blob = await res.blob()
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      return { image: bitmap, width: bitmap.width, height: bitmap.height }
    }
    return await decodeTemplateFile(blob)
  } catch (e) {
    if (typeof Image === 'undefined') throw e
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(e)
      el.src = url
    })
    return { image: img, width: img.naturalWidth, height: img.naturalHeight }
  }
}
