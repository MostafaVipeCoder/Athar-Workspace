/**
 * Image profiles (owner decision 08 section 17.3, UNIVERSAL WEBP): every raster image the platform stores is WebP. A profile says
 * how one KIND of image is prepared in the browser before it is uploaded: the longest side, the quality ladder, whether a 320 px
 * thumbnail (`_t.webp`) is made, and the few special cases (vector, lossless). Pure data, no DOM.
 *
 *   maxPx        longest side of the stored image (never upscaled)
 *   thumbPx      longest side of the `_t` thumbnail (0 = none; displays use it in lists and cards)
 *   quality      first lossy quality tried (0..1); 1 = lossless WebP
 *   minQuality   the ladder never goes below this
 *   targetBytes  soft ceiling: the ladder keeps stepping down until the result fits (or minQuality is reached)
 *   lossless     try lossless first (frames: sharp edges + exact alpha); the ladder falls back to lossy only above `targetBytes`
 *   vector       an SVG is accepted and stored untouched (logos); every other profile refuses SVG
 *   og           the image is SHARED (a link preview may show it): the pipeline also makes the 1200 x 630 JPEG derivative of
 *                section 18.6 (see the OG_* constants below)
 *
 * Transparency is ALWAYS preserved (WebP carries alpha), so a transparent logo or frame never gets a white box.
 */
export const WEBP_MIME = 'image/webp'
export const SVG_MIME = 'image/svg+xml'
/** Source files above this are refused before decoding (the stored result is far smaller). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
/** Decoded pixel budget: a 100 MP image would need ~400 MB of RGBA; refuse it with a clear message instead of crashing the tab. */
export const MAX_SOURCE_PIXELS = 100_000_000
export const THUMB_SUFFIX = '_t'

/**
 * The JPEG LINK-PREVIEW derivative (owner decision 08 section 18.6): LinkedIn and some WhatsApp versions do not render a WebP `og:image`, so an image
 * uploaded with a SHARING purpose (profile.og) also gets a 1200 x 630 JPEG (cover crop, progressive where the encoder can, quality ~82, <= 300 KB:
 * WhatsApp ignores a larger preview) in the public bucket `og-images` at the path derived from the source path (paths.js `ogPathOf`; no DB column).
 * WebP stays the stored / displayed format. Server mirror: db/scripts/lib/plan.mjs, m45.
 */
export const OG_MIME = 'image/jpeg'
export const OG_BUCKET = 'og-images'
export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_QUALITY = 0.82
export const OG_MIN_QUALITY = 0.52
export const OG_TARGET_BYTES = 300 * 1024

const KB = 1024
export const PROFILES = Object.freeze({
  /** Program / project / agenda / form covers and the share image (wide, shown large; shared, so it also gets the JPEG link-preview derivative). */
  cover: Object.freeze({ maxPx: 1920, thumbPx: 320, quality: 0.8, minQuality: 0.5, targetBytes: 500 * KB, og: true }),
  /** Landing hero + card covers + the SEO image: same size as a cover, a little more quality because they are the page (shared: JPEG derivative too). */
  landing: Object.freeze({ maxPx: 1920, thumbPx: 320, quality: 0.82, minQuality: 0.55, targetBytes: 600 * KB, og: true }),
  /** Library images and anything else shown inside content. */
  content: Object.freeze({ maxPx: 1600, thumbPx: 320, quality: 0.82, minQuality: 0.5, targetBytes: 400 * KB }),
  /** Photos of people (experts, founders, profile): small and square-ish. */
  avatar: Object.freeze({ maxPx: 512, thumbPx: 320, quality: 0.85, minQuality: 0.6, targetBytes: 90 * KB }),
  /** Company logos: alpha kept, SVG allowed and kept as is. */
  logo: Object.freeze({ maxPx: 512, thumbPx: 320, quality: 0.9, minQuality: 0.7, targetBytes: 90 * KB, vector: true }),
  /** Landing photo frames (4:5, exactly the 1080 x 1350 export grid): lossless first, alpha exact, no thumbnail (visitors load it whole). */
  frame: Object.freeze({ maxPx: 1350, thumbPx: 0, quality: 1, minQuality: 0.85, targetBytes: 600 * KB, lossless: true }),
  /** Certificate templates (A4 at 300 dpi is 3508 px): high quality, alpha kept, no thumbnail. Used by the Certificates node. */
  template: Object.freeze({ maxPx: 4000, thumbPx: 0, quality: 0.92, minQuality: 0.8, targetBytes: 4 * 1024 * KB }),
  /** Files a respondent attaches to a public form (private bucket, opened by staff through a signed URL): no thumbnail. */
  attachment: Object.freeze({ maxPx: 2000, thumbPx: 0, quality: 0.8, minQuality: 0.5, targetBytes: 600 * KB }),
})
export const PROFILE_NAMES = Object.freeze(Object.keys(PROFILES))

/** `<owner>/<kind>/...` folder name (data/storage `kind`) -> profile. Unknown kinds are treated as content. */
export const KIND_PROFILE = Object.freeze({
  cover: 'cover',
  'form-cover': 'cover',
  'project-cover': 'cover', // the folder name the stage-2b migration gave the project covers (a future project-cover upload keeps its link preview)
  og: 'cover',
  landing: 'landing',
  library: 'content',
  photo: 'avatar',
  'expert-photo': 'avatar', // the Athar Network experts registry (global/expert-photo/, m75)
  avatar: 'avatar',
  logo: 'logo',
})

export function profileForKind(kind) {
  return KIND_PROFILE[kind] ?? 'content'
}

/** A profile object from a name or an object (unknown names -> content). */
export function resolveProfile(profile) {
  if (profile && typeof profile === 'object') return { name: profile.name ?? 'custom', ...PROFILES.content, ...profile }
  const name = PROFILES[profile] ? profile : 'content'
  return { name, ...PROFILES[name] }
}

/** The `accept` attribute of a file picker for a profile (browser-decodable rasters; SVG only where it is kept). */
export function acceptFor(profile) {
  const p = resolveProfile(profile)
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif', ...(p.vector ? [SVG_MIME] : [])].join(',')
}

/** Quality ladder of a profile: `[1]` first for lossless profiles, then the lossy steps down to `minQuality`. */
export function qualityLadder(profile) {
  const p = resolveProfile(profile)
  const steps = []
  if (p.lossless) steps.push(1)
  const top = Math.min(p.quality, 0.99)
  for (let q = top; q >= p.minQuality - 1e-9; q -= 0.07) steps.push(Math.round(q * 100) / 100)
  if (steps[steps.length - 1] > p.minQuality) steps.push(p.minQuality)
  return [...new Set(steps)]
}

/** Quality ladder of the JPEG derivative: 0.82 stepping down by 0.08 to OG_MIN_QUALITY (the same steps as db/scripts/backfill-og-images.mjs). */
export function ogQualityLadder() {
  const steps = []
  for (let q = OG_QUALITY; q > OG_MIN_QUALITY - 1e-9; q -= 0.08) steps.push(Math.round(q * 100) / 100)
  if (steps[steps.length - 1] > OG_MIN_QUALITY) steps.push(OG_MIN_QUALITY)
  return steps
}
