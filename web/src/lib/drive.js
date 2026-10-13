/**
 * Google Drive link normalisation (design 06 section 6.3 `drive.js`). ONE predicate and ONE candidate builder replace
 * `extractGoogleDriveId`, `getGoogleDriveFallbackUrls`, `getGoogleDriveFullSizeUrls`, `getGoogleDriveDirectLink` and the
 * duplicated predicate in LazyImage (docs/01 section 9.1, P19). Stage 2b moved stored images into Storage, so this is
 * only for links typed by PMs/founders (library resources, free text).
 */

const ID_PATTERNS = [
  /\/file\/d\/([-\w]{25,})/,
  /\/d\/([-\w]{25,})/,
  /[?&]id=([-\w]{25,})/,
  /\/open\?id=([-\w]{25,})/,
  /^([-\w]{25,50})$/,
]

const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com', 'googleusercontent.com', 'drive.usercontent.google.com']

/** True for any Google Drive / Docs / usercontent URL, or a bare 25-50 char file id. */
export function isDriveUrl(value) {
  const s = String(value ?? '').trim()
  if (!s) return false
  if (/^[-\w]{25,50}$/.test(s)) return true
  return DRIVE_HOSTS.some((h) => s.includes(h))
}

/** The Drive file id inside any supported URL shape, or null. */
export function extractDriveId(value) {
  const s = String(value ?? '').trim()
  if (!s || !isDriveUrl(s)) return null
  for (const re of ID_PATTERNS) {
    const m = re.exec(s)
    if (m) return m[1]
  }
  return null
}

/**
 * Ordered candidate URLs for an <img>. `size`: 'thumb' (lists/cards) or 'full'. Non-Drive URLs come back as-is.
 * The order mirrors what worked best in the field (CDN first, consent-free thumbnail API, then the classic export).
 */
export function driveImageUrls(value, { size = 'full' } = {}) {
  const s = String(value ?? '').trim()
  if (!s) return []
  const id = extractDriveId(s)
  if (!id) return [s]
  if (size === 'thumb') {
    return [
      `https://lh3.googleusercontent.com/d/${id}=s400`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
      `https://drive.usercontent.com/download?id=${id}`,
    ]
  }
  return [
    `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
    `https://lh3.googleusercontent.com/d/${id}=w1600`,
    `https://lh3.googleusercontent.com/d/${id}`,
    `https://drive.google.com/uc?export=view&id=${id}`,
  ]
}

/** One best direct URL (first candidate). */
export function driveDirectUrl(value, opts) {
  return driveImageUrls(value, opts)[0] ?? ''
}

/** Canonical "open in Drive" link for a file id or URL (for resource links, not images). */
export function driveViewUrl(value) {
  const id = extractDriveId(value)
  return id ? `https://drive.google.com/file/d/${id}/view` : String(value ?? '')
}
