/**
 * Resource file rules shared by the data layer (uploads) and the Library node (pickers, validation): the accepted types and
 * size ceilings of the private `resources` bucket (db/migrations m07 + m36). The server re-checks everything
 * (`save_children_library`, bucket limits); this is the same rule on the client for instant feedback. Pure.
 */
import { newId } from './id.js'
import { thumbPath } from './image/paths.js'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
/** An image is re-encoded to WebP in the browser, so the source may be larger than the stored result. */
export const MAX_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024

/** Accepted uploads: mime -> stored extension (= the bucket's allowed_mime_types). */
export const FILE_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}
export const FILE_ACCEPT = [...Object.keys(FILE_TYPES), '.pdf', '.docx', '.xlsx', '.pptx', '.mp3', '.m4a', '.wav', '.ogg', '.mp4', '.png', '.jpg', '.jpeg', '.webp'].join(',')
const EXT_TO_MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export const isImageMime = (mime) => /^image\//.test(String(mime ?? ''))
export { newId as uuid }

/** The mime of a picked file: the browser value when it is one we know, else derived from the extension (docx often has none). */
export function mimeOf(file) {
  const t = String(file?.type ?? '').toLowerCase()
  if (FILE_TYPES[t]) return t
  const ext = /\.([a-z0-9]+)$/i.exec(String(file?.name ?? ''))?.[1]?.toLowerCase()
  return (ext && EXT_TO_MIME[ext]) || t
}

/** Client mirror of the server rules: null when fine, else an error key suffix (`library.err.<x>`). */
export function validateFile(file) {
  if (!file) return 'fileRequired'
  const mime = mimeOf(file)
  if (!FILE_TYPES[mime]) return 'fileType'
  if (!file.size) return 'fileEmpty'
  if (isImageMime(mime) ? file.size > MAX_IMAGE_SOURCE_BYTES : file.size > MAX_FILE_BYTES) return 'fileSize'
  return null
}

/** The derived thumbnail path of a stored image: `<uuid>.webp` -> `<uuid>_t.webp` (the ONE convention, lib/image/paths). */
export const thumbOf = (path) => thumbPath(path)
