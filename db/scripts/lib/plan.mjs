// plan.mjs - the pure decisions of the image scripts (no I/O, unit-tested by plan.test.mjs: `node --test db/scripts/lib/plan.test.mjs`).
//   - which objects are rasters that are not WebP,
//   - where the WebP sibling of an original goes (same folder, same base name, `.webp`; a collision gets the old extension in the name),
//   - the conversion policy by bucket / folder (the server mirror of web/src/lib/image/profiles.js),
//   - the og-images path (the server mirror of web/src/lib/image/paths.js `ogPathOf`), the manifest CSV.

export const RASTER_NAME = /\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$/i
export const RASTER_MIME = /^image\/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)/i
export const isRaster = (name, mime = '') => RASTER_NAME.test(name) || RASTER_MIME.test(mime ?? '')

/** Buckets that hold JPEG ON PURPOSE (m45: the link-preview derivatives of og-images): never converted, never deleted by the converter. */
export const JPEG_BUCKETS = ['og-images']
/** An object the converter must turn into WebP: a raster in any bucket except the ones that hold JPEG by design. */
export const isConvertible = (bucket, name, mime = '') => !JPEG_BUCKETS.includes(bucket) && isRaster(name, mime)

/** Buckets that carry a 320 px `_t.webp` thumbnail next to the full image (the displays derive it by convention). */
export const THUMB_BUCKETS = ['public-assets', 'founder-assets', 'resources']
/** Buckets whose originals are checked for a mislabelled `.webp` name (bytes are not WebP). */
export const IMAGE_BUCKETS = ['public-assets', 'founder-assets', 'resources', 'form-uploads']

const KB = 1024
/** `<owner>/<kind>/<file>` folder kind -> [longest side, target KB]; everything else (the frozen archives included) = 1600 px / 400 KB. */
const KIND = {
  cover: [1920, 500], landing: [1920, 600], 'form-cover': [1920, 500], 'project-cover': [1920, 500], og: [1920, 500],
  logo: [512, 90], 'company-logo': [512, 90], photo: [512, 90], avatar: [512, 90], 'expert-photo': [512, 90], 'answer-logo': [512, 90],
}
export function policyOf(bucket, name) {
  if (bucket === 'certificate-templates') return { maxPx: 100000, target: 4 * 1024 * KB, thumb: 0 }
  const kind = name.split('/')[1]
  const [maxPx, targetKb] = KIND[kind] ?? (bucket === 'form-uploads' ? [2000, 600] : [1600, 400])
  return { maxPx, target: targetKb * KB, thumb: THUMB_BUCKETS.includes(bucket) ? 320 : 0 }
}

const splitPath = (name) => {
  const i = name.lastIndexOf('/')
  const dir = i >= 0 ? name.slice(0, i) : ''
  const file = i >= 0 ? name.slice(i + 1) : name
  const dot = file.lastIndexOf('.')
  return { dir, base: dot > 0 ? file.slice(0, dot) : file, ext: dot > 0 ? file.slice(dot + 1).toLowerCase() : '' }
}
const join = (dir, file) => (dir ? `${dir}/${file}` : file)

/**
 * The WebP sibling of a raster original: `<dir>/<base>.webp` (`a/b.png` -> `a/b.webp`, the thumbnail `a/b_t.webp`).
 * `taken` = a Set of every object name that already exists in the bucket plus the targets claimed earlier in the same run; a collision
 * (`a/b.jpg` and `a/b.png` both want `a/b.webp`, or a stored `a/b.webp` is somebody else's) puts the old extension in the name
 * (`a/b-png.webp`), then a counter. The chosen names are added to `taken`. Returns { webp, thumb|null }.
 */
export function planTarget(name, taken, { thumb = false } = {}) {
  const { dir, base, ext } = splitPath(name)
  const free = (b) => !taken.has(join(dir, `${b}.webp`)) && (!thumb || !taken.has(join(dir, `${b}_t.webp`)))
  let b = base
  if (!free(b)) {
    b = `${base}-${ext || 'img'}`
    for (let n = 2; !free(b); n += 1) b = `${base}-${ext || 'img'}-${n}`
  }
  const webp = join(dir, `${b}.webp`)
  const t = thumb ? join(dir, `${b}_t.webp`) : null
  taken.add(webp)
  if (t) taken.add(t)
  return { webp, thumb: t }
}

// ------------------------------------------------------------------ og-images (the share / OG function computes the same path with no DB column)
export const OG_BUCKET = 'og-images'
export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_QUALITY = 82
export const OG_TARGET_BYTES = 300 * KB // WhatsApp ignores a larger preview image
/** `<owner>/<kind>/<uuid>.webp` (a full image, not a thumbnail) -> `<owner>/<kind>/<uuid>.jpg`; '' for anything else. */
export function ogPathOf(path) {
  const p = String(path ?? '')
  if (!/\.webp$/i.test(p) || /_t\.webp$/i.test(p)) return ''
  return p.replace(/\.webp$/i, '.jpg')
}

// ------------------------------------------------------------------ the manifest of deleted originals (local-db/backups/deleted-originals-manifest.csv)
export const MANIFEST_HEADER = 'deleted_at_utc,bucket,path,bytes,sha256,status,replaced_by,replaced_by_bytes,note'
const cell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** One CSV line. `row` = { at, bucket, path, bytes, sha256, status, replacedBy, replacedByBytes, note }. */
export const manifestLine = (row) => [row.at, row.bucket, row.path, row.bytes, row.sha256, row.status, row.replacedBy, row.replacedByBytes, row.note].map(cell).join(',')
