/**
 * Storage path conventions for images (pure, unit-tested): `<owner>/<kind>/<uuid>.webp` with a derived thumbnail
 * `<uuid>_t.webp` (no second DB column: the thumbnail path is always computed from the full path). A vector image (`.svg`) is its own
 * thumbnail. Legacy non-WebP rasters (`.png`, `.jpg`) have no thumbnail either: displays fall back to the file itself.
 */
import { newId } from '../id.js'
import { THUMB_SUFFIX } from './profiles.js'

export { newId }

/** `<owner>/<kind>/<uuid>.<ext>` (owner = project or program id, or 'global'). */
export function buildImagePath(ownerId, kind, id = newId(), ext = 'webp') {
  return `${ownerId}/${kind}/${id}.${ext}`
}

export const isThumbPath = (path) => String(path ?? '').toLowerCase().endsWith(`${THUMB_SUFFIX}.webp`)
export const isWebpPath = (path) => /\.webp$/i.test(String(path ?? ''))
export const isSvgPath = (path) => /\.svg$/i.test(String(path ?? ''))

/** Thumbnail path by convention: `<uuid>.webp` -> `<uuid>_t.webp`. A thumbnail, an SVG or a legacy raster is returned unchanged. */
export function thumbPath(path) {
  const p = String(path ?? '')
  if (!p) return ''
  if (!isWebpPath(p) || isThumbPath(p)) return p
  return p.replace(/\.webp$/i, `${THUMB_SUFFIX}.webp`)
}

/** Every storage object that belongs to an image path (the file itself and its thumbnail), without duplicates. */
export function variantsOf(path) {
  const p = String(path ?? '')
  if (!p) return []
  return [...new Set([p, thumbPath(p)])]
}
