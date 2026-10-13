import { db } from './client.js'
import { AppError, fromSupabase } from './errors.js'
import { IMAGE } from '../lib/constants.js'
import { buildImagePath, prepareImage, thumbPath, validateImageFile } from '../lib/image.js'

/**
 * Storage helper (design 06 section 5.2 `storage.js`, 04 section 6.9): ONE folder convention
 * `<owner id>/<kind>/<uuid>.webp` in `public-assets` with a derived `_t` thumbnail. The DB stores only the full path.
 * `ownerId` is a project or program id (the bucket policy checks the caller manages it) or 'global' (super_admin).
 */
export function publicImageUrl(path) {
  if (!path) return ''
  return db().storage.from(IMAGE.bucket).getPublicUrl(path).data.publicUrl
}

export function publicThumbUrl(path) {
  return path ? publicImageUrl(thumbPath(path)) : ''
}

/** Resize in the browser, upload full + thumb, return the stored full path. Throws AppError('validation') on bad input. */
export async function uploadImage(file, { ownerId, kind }) {
  const problem = validateImageFile(file)
  if (problem) throw new AppError('validation', { messageKey: `errors.${problem}`, retryable: false })
  if (!ownerId || !kind) throw new AppError('validation', { retryable: false })
  const { full, thumb } = await prepareImage(file)
  const path = buildImagePath(ownerId, kind)
  const bucket = db().storage.from(IMAGE.bucket)
  const opts = { contentType: 'image/webp', cacheControl: '31536000', upsert: false }
  const a = await bucket.upload(path, full.blob, opts)
  if (a.error) throw fromSupabase(a.error)
  const b = await bucket.upload(thumbPath(path), thumb.blob, opts)
  if (b.error) {
    await bucket.remove([path]).catch(() => {})
    throw fromSupabase(b.error)
  }
  return path
}

/** Remove full + thumb (best effort; a missing thumb is not an error). */
export async function removeImage(path) {
  if (!path) return
  const { error } = await db().storage.from(IMAGE.bucket).remove([path, thumbPath(path)])
  if (error) throw fromSupabase(error)
}
