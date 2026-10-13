/**
 * Template image rules (design 07 section 4.3): PNG or JPEG up to 10 MB, checked in the browser before anything is uploaded and
 * again by the bucket (size + MIME) and by save_children_certificates (path + size range). PDF templates are NOT supported in this
 * build: converting a PDF page to an image needs pdf.js (~1 MB + a worker), which is not cheap; the PM exports the design as a PNG
 * (A4 at 150-300 dpi = 1754 x 1240 .. 3508 x 2480 px) instead. The editor says so.
 */
export const TEMPLATE_RULES = {
  maxBytes: 10 * 1024 * 1024,
  types: ['image/png', 'image/jpeg'],
  extensions: { 'image/png': 'png', 'image/jpeg': 'jpg' },
  minShortSide: 600,
  minLongSide: 1000,
  recommendedLongSide: 1754,
  maxSide: 8000,
  maxAspect: 2.5,
}
export const TEMPLATE_ACCEPT = 'image/png,image/jpeg'

export const PAPER = { a4: 297 / 210, letter: 11 / 8.5 }

/** The MIME type of a file, by declared type then extension. */
export function templateMime(file) {
  if (TEMPLATE_RULES.types.includes(file?.type)) return file.type
  const ext = /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
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
