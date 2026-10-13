/**
 * Browser-side image preparation (design 04 section 6.9 / 08 P6): resize + encode to WebP, full (max 1600 px) and
 * thumbnail (320 px). Pure DOM/canvas, no upload here (data/storage.js does that). Path conventions are pure functions
 * so they are unit-testable.
 */
import { IMAGE } from './constants.js'

/** `<owner>/<kind>/<uuid>.webp` (owner = project or program id, or 'global'). */
export function buildImagePath(ownerId, kind, id = crypto.randomUUID()) {
  return `${ownerId}/${kind}/${id}.${IMAGE.ext}`
}

/** Thumbnail path derived by convention (no second DB column): `<uuid>.webp` -> `<uuid>_t.webp`. */
export function thumbPath(path) {
  if (!path) return ''
  return String(path).replace(/(\.[a-z0-9]+)$/i, `${IMAGE.thumbSuffix}$1`)
}

export function validateImageFile(file) {
  if (!file) return 'image.required'
  if (!IMAGE.accept.includes(file.type)) return 'image.type'
  if (file.size > IMAGE.maxBytes) return 'image.size'
  return null
}

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image decode failed'))
    }
    img.src = url
  })
}

/** Fit (w,h) inside maxPx keeping the ratio; never upscales. */
export function fitWithin(width, height, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function encode(bitmap, maxPx, quality) {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxPx)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob) throw new Error('webp encode failed')
  return { blob, width, height }
}

/** Returns { full: {blob,width,height}, thumb: {blob,width,height} } ready for upload. */
export async function prepareImage(file, { fullMaxPx = IMAGE.fullMaxPx, thumbMaxPx = IMAGE.thumbMaxPx, quality = 0.82 } = {}) {
  const bitmap = await loadBitmap(file)
  try {
    const full = await encode(bitmap, fullMaxPx, quality)
    const thumb = await encode(bitmap, thumbMaxPx, 0.75)
    return { full, thumb }
  } finally {
    bitmap.close?.()
  }
}
