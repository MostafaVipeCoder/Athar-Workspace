import { db } from './client.js'
import { AppError, fromSupabase } from './errors.js'
import { IMAGE } from '../lib/constants.js'
// ONLY the tiny pieces are imported statically (error class, path convention, profile table): this module is imported by 40+ chunks that merely SHOW an
// image (publicImageUrl / publicThumbUrl). The converter (decode, canvas, WebP ladder: ~10 KB) is a dynamic import inside storeImage, so only an uploader loads it.
import { ImageError } from '../lib/image/errors.js'
import { buildImagePath, newId, ogPathOf, thumbPath, variantsOf } from '../lib/image/paths.js'
import { OG_BUCKET, profileForKind } from '../lib/image/profiles.js'

/**
 * Storage helper (design 06 section 5.2 `storage.js`, 04 section 6.9, owner decision 08 section 17.3 UNIVERSAL WEBP).
 *
 * THE ONLY module that writes files to Storage (`.upload(` anywhere else is a lint error and fails `storage.guard.test.js`):
 *  - `storeImage` / `uploadImage`: every raster image goes through `lib/image` (`convertToWebp`: profile, EXIF, alpha, quality ladder,
 *    thumbnail) and is stored as WebP (+ a `_t.webp` thumbnail when the profile asks for one); the original PNG/JPEG is never uploaded.
 *    The server refuses non-WebP images in the image buckets as well (m41), so a client that skips this module cannot store one.
 *  - `uploadObject`: everything that is NOT an image (PDF, Office files, audio, video). An `image/*` content type is refused here.
 *  - the JPEG LINK-PREVIEW derivative (owner decision 08 section 18.6): an image uploaded with a sharing purpose (profile.og: covers, landing images, the
 *    share image) also stores a 1200 x 630 JPEG in the public bucket `og-images` at the path derived from the source path (`ogPathOf`: same path, `.jpg`;
 *    no DB column), so LinkedIn / WhatsApp crawlers that do not render WebP still get a picture. WebP stays the stored / displayed format. The derivative
 *    never fails the upload (`ogPath: null` + `ogError`); removing an image removes its derivative.
 *
 * Folder convention for covers/photos/logos: `<owner id>/<kind>/<uuid>.webp` in `public-assets` with a derived `_t` thumbnail. The DB
 * stores only the full path. `ownerId` is a project or program id (the bucket policy checks the caller manages it) or 'global'.
 */
export const CACHE_IMMUTABLE = '31536000'

export function publicImageUrl(path) {
  if (!path) return ''
  return db().storage.from(IMAGE.bucket).getPublicUrl(path).data.publicUrl
}

/** The thumbnail of a stored image (`<uuid>_t.webp`); an SVG or a legacy raster is its own thumbnail. */
export function publicThumbUrl(path) {
  return path ? publicImageUrl(thumbPath(path)) : ''
}

/**
 * The public URL of the JPEG link-preview derivative of a stored image, or '' when the image has none by convention (a thumbnail, an SVG, a legacy
 * raster). Whether the file exists is not checked here (public-assets paths from before the derivative existed are filled by db/scripts/backfill-og-images.mjs).
 * The (future) share / OG function builds the same URL from the source path: `<storage>/object/public/og-images/<ogPathOf(path)>`.
 */
export function publicOgUrl(path) {
  const og = ogPathOf(path)
  return og ? db().storage.from(OG_BUCKET).getPublicUrl(og).data.publicUrl : ''
}

/** ImageError (a refused image) -> AppError('validation') with the translated `errors.image.<code>` key; everything else as supabase errors. */
function asAppError(err) {
  if (err instanceof AppError) return err
  if (err instanceof ImageError) return new AppError('validation', { messageKey: err.messageKey, cause: err, retryable: false })
  return fromSupabase(err)
}

/**
 * Convert an image to WebP and store it. `path(ext)` builds the object path from the stored extension (`webp`, or `svg` for a vector).
 * Returns { path, thumbPath|null, ogPath|null, ogError|null, mime, bytes, width, height, report }. A failed thumbnail upload removes the full file again;
 * a failed link-preview upload does NOT (the cover is saved, the derivative can be rebuilt by the backfill).
 * Throws AppError('validation', { messageKey: 'errors.image.*' }) for a refused image.
 */
export async function storeImage(file, { bucket = IMAGE.bucket, path, profile, cacheControl = CACHE_IMMUTABLE, onProgress } = {}) {
  if (typeof path !== 'function') throw new AppError('validation', { retryable: false })
  let result
  try {
    const { convertToWebp } = await import('../lib/image/convert.js')
    result = await convertToWebp(file, { profile, onProgress })
  } catch (err) {
    throw asAppError(err)
  }
  const full = path(result.full.ext)
  const store = db().storage.from(bucket)
  const opts = (mime) => ({ contentType: mime, cacheControl, upsert: false })
  const a = await store.upload(full, result.full.blob, opts(result.full.mime))
  if (a.error) throw fromSupabase(a.error)
  let thumb = null
  if (result.thumb) {
    thumb = thumbPath(full)
    const b = await store.upload(thumb, result.thumb.blob, opts(result.thumb.mime))
    if (b.error) {
      await store.remove([full]).catch(() => {})
      throw fromSupabase(b.error)
    }
  }
  // the JPEG link-preview of a shared image: only for public-assets images, at the deterministic path derived from the full path
  let ogPath = null
  let ogError = null
  if (result.og && bucket === IMAGE.bucket) {
    const target = ogPathOf(full)
    if (target) {
      const c = await db().storage.from(OG_BUCKET).upload(target, result.og.blob, opts(result.og.mime))
      if (c.error) ogError = fromSupabase(c.error)
      else ogPath = target
    }
  }
  return { path: full, thumbPath: thumb, ogPath, ogError, mime: result.full.mime, bytes: result.full.bytes, width: result.full.width, height: result.full.height, report: result.report }
}

/** Resize/convert in the browser, upload full + thumb, return the stored full path. Throws AppError('validation') on bad input. */
export async function uploadImage(file, { ownerId, kind, profile, onProgress } = {}) {
  if (!ownerId || !kind) throw new AppError('validation', { retryable: false })
  const id = newId()
  const stored = await storeImage(file, { path: (ext) => buildImagePath(ownerId, kind, id, ext), profile: profile ?? profileForKind(kind), onProgress })
  return stored.path
}

/** What the BYTES of a file say it is, when that is an image (anything the pipeline would have converted, or refused). */
const IMAGE_KINDS = new Set(['png', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'bmp', 'tiff'])

/**
 * Store a NON-image file (PDF, Office, audio, video). Images must go through `storeImage` (WebP): an `image/*` type is refused, and so is a file whose
 * BYTES are an image although its declared type is not (review: an image labelled application/octet-stream passed the client check and only the
 * m41 database policies stopped it). The check reads the first bytes (lazy chunk: only an uploader of documents loads it).
 */
export async function uploadObject(bucket, path, body, { contentType, cacheControl = '3600' } = {}) {
  if (/^image\//i.test(String(contentType ?? body?.type ?? ''))) throw new AppError('validation', { messageKey: 'errors.image.type', retryable: false })
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const { readHead, sniffImage } = await import('../lib/image/sniff.js')
    if (IMAGE_KINDS.has(sniffImage(await readHead(body)).type)) throw new AppError('validation', { messageKey: 'errors.image.type', retryable: false })
  }
  const { error } = await db().storage.from(bucket).upload(path, body, { contentType, cacheControl, upsert: false })
  if (error) throw fromSupabase(error)
  return path
}

/** Best-effort removal of objects of ANY bucket (discarded drafts, replaced files): de-duplicated, never throws. The one helper behind every "remove files" of a data module. */
export async function removeObjects(bucket, paths) {
  const list = [...new Set((paths ?? []).filter(Boolean))]
  if (!list.length) return
  await db().storage.from(bucket).remove(list).catch(() => {})
}

/** Remove full + thumb (best effort; a missing thumb is not an error) and the JPEG link-preview derivative of a public-assets image (also best effort: most images have none). */
export async function removeImage(path, { bucket = IMAGE.bucket } = {}) {
  if (!path) return
  const { error } = await db().storage.from(bucket).remove(variantsOf(path))
  if (error) throw fromSupabase(error)
  const og = bucket === IMAGE.bucket ? ogPathOf(path) : ''
  if (og) await db().storage.from(OG_BUCKET).remove([og]).catch(() => {})
}
