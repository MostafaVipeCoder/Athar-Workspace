import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { prepareImage } from '../lib/image.js'
import { FILE_TYPES, isImageMime, mimeOf, thumbOf, uuid, validateFile } from '../lib/resourceFiles.js'

/**
 * Resource Library data (design 01 section 3.8, 03 sections 6.2 + 11, 04 section 3.11):
 * - the PM reads the definition under RLS (`resources` + `library_categories`) and writes it ONLY through save_node
 *   children (`app_private.save_children_library`, m36: one transaction with the config, validated per row);
 * - files live in the PRIVATE `resources` bucket under `<project id>/<node id>/<uuid>.<ext>` (an image is re-encoded to WebP
 *   with a `_t` thumbnail next to it); visitors never get a public URL: they get a SHORT-LIVED signed URL minted by the
 *   Storage API after the m36 policy `library_file_readable` agreed (node public / participant, resource visibility);
 * - covers are public images in `public-assets` (`data/storage.uploadImage`), the rest of the payload is `get_public_library`
 *   (own page) / `get_public_tab` (host tab) / `list_founder_libraries` (founder exposure).
 */
export const LIBRARY_BUCKET = 'resources'
export const LIBRARY_VIEW_KEY = 'library-tab'
/** Seconds a signed URL stays valid: long enough to open/download right away, too short to share. */
export const SIGNED_URL_TTL = 300

// ------------------------------------------------------------------ PM reads
export async function getLibraryDefinition(nodeId) {
  const [categories, resources] = await Promise.all([
    db().from('library_categories').select('id, name_en, name_ar, sort_order').eq('node_id', nodeId).order('sort_order').order('created_at'),
    db().from('resources').select('id, category_id, title_en, title_ar, description_en, description_ar, type, visibility, url, file_path, mime, bytes, cover_path, sort_order, created_at')
      .eq('node_id', nodeId).is('deleted_at', null).order('sort_order', { nullsFirst: false }).order('created_at').order('id'),
  ])
  return { categories: unwrap(categories) ?? [], resources: unwrap(resources) ?? [] }
}

async function slugOf(linkId) {
  const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', linkId).eq('is_current', true).maybeSingle())
  return slug?.slug ?? null
}
/** The library's own public page link (kind 'view', view_key 'library-tab'). */
export async function getLibraryLink(nodeId) {
  const link = unwrap(await db().from('public_links').select('id, is_enabled').eq('node_id', nodeId).eq('kind', 'view').eq('view_key', LIBRARY_VIEW_KEY).maybeSingle())
  if (!link) return null
  return { linkId: link.id, slug: await slugOf(link.id), enabled: link.is_enabled }
}
export async function ensureLibraryLink(nodeId) {
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: 'view', p_view_key: LIBRARY_VIEW_KEY, p_project: null }))
  return getLibraryLink(nodeId)
}

// ------------------------------------------------------------------ files (private bucket)
const extOf = (file, mime) => FILE_TYPES[mime] ?? /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase() ?? 'bin'

/**
 * Validate (type/size, the same rules as the server) and upload one file. Images are resized in the browser to WebP (full +
 * `_t` thumbnail, lib/image). Returns the stored facts the draft keeps: { path, mime, bytes }. Throws AppError('validation').
 */
export async function uploadResourceFile(file, { projectId, nodeId }) {
  const problem = validateFile(file)
  if (problem) throw new AppError('validation', { messageKey: `library.err.${problem}`, retryable: false })
  if (!projectId || !nodeId) throw new AppError('validation', { retryable: false })
  const bucket = db().storage.from(LIBRARY_BUCKET)
  const id = uuid()
  const mime = mimeOf(file)
  if (isImageMime(mime)) {
    const { full, thumb } = await prepareImage(file)
    const path = `${projectId}/${nodeId}/${id}.webp`
    const opts = { contentType: 'image/webp', cacheControl: '3600', upsert: false }
    const a = await bucket.upload(path, full.blob, opts)
    if (a.error) throw fromSupabase(a.error)
    const b = await bucket.upload(thumbOf(path), thumb.blob, opts)
    if (b.error) {
      await bucket.remove([path]).catch(() => {})
      throw fromSupabase(b.error)
    }
    return { path, mime: 'image/webp', bytes: full.blob.size }
  }
  const path = `${projectId}/${nodeId}/${id}.${extOf(file, mime)}`
  const r = await bucket.upload(path, file, { contentType: mime, cacheControl: '3600', upsert: false })
  if (r.error) throw fromSupabase(r.error)
  return { path, mime, bytes: file.size }
}

/** Best-effort removal of uploaded files (discarded drafts, replaced files); never throws. */
export async function removeResourceFiles(paths) {
  const list = [...new Set((paths ?? []).filter(Boolean))]
  if (!list.length) return
  await db().storage.from(LIBRARY_BUCKET).remove(list).catch(() => {})
}

/** ONE short-lived signed URL; `download` = the file name to save as (Content-Disposition), omitted to open in the browser. */
export async function signedResourceUrl(path, { download = null, expiresIn = SIGNED_URL_TTL } = {}) {
  const { data, error } = await db().storage.from(LIBRARY_BUCKET).createSignedUrl(path, expiresIn, download ? { download } : undefined)
  if (error || !data?.signedUrl) throw fromSupabase(error ?? new Error('forbidden'))
  return data.signedUrl
}
/** Many at once (thumbnails of image resources): a map path -> URL; paths that cannot be signed are simply absent. */
export async function signedResourceUrls(paths, expiresIn = SIGNED_URL_TTL * 2) {
  const list = [...new Set((paths ?? []).filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await db().storage.from(LIBRARY_BUCKET).createSignedUrls(list, expiresIn)
  if (error) throw fromSupabase(error)
  const out = {}
  for (const row of data ?? []) if (row?.signedUrl && row.path) out[row.path] = row.signedUrl
  return out
}

// ------------------------------------------------------------------ public / founder reads (the DB decides the audience)
export async function getPublicLibrary(ref) {
  return unwrap(await db().rpc('get_public_library', { p_ref: ref }))
}
export async function listFounderLibraries(projectId) {
  return unwrap(await db().rpc('list_founder_libraries', { p_project: projectId })) ?? []
}

// ------------------------------------------------------------------ hooks
export const useLibraryDefinition = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.libraryDef(nodeId), queryFn: () => getLibraryDefinition(nodeId), enabled: Boolean(nodeId), ...options })

export const useLibraryLink = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.libraryLink(nodeId), queryFn: () => getLibraryLink(nodeId), enabled: Boolean(nodeId), ...options })

export const usePublicLibrary = (ref, options = {}) =>
  useQuery({ queryKey: keys.publicLibrary(ref), queryFn: () => getPublicLibrary(ref), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

export const useFounderLibraries = (projectId, options = {}) =>
  useQuery({ queryKey: keys.founderLibraries(projectId), queryFn: () => listFounderLibraries(projectId), enabled: Boolean(projectId), ...options })

/** Signed thumbnail URLs of image resources, refreshed before they expire (never more than ONE storage call per set). */
export const useSignedUrls = (paths, options = {}) => {
  const list = [...new Set((paths ?? []).filter(Boolean))].sort()
  return useQuery({
    queryKey: keys.librarySigned(list),
    queryFn: () => signedResourceUrls(list),
    enabled: list.length > 0,
    staleTime: SIGNED_URL_TTL * 1000,
    refetchInterval: SIGNED_URL_TTL * 1000,
    ...options,
  })
}

export function useLibraryMutations(nodeId) {
  const qc = useQueryClient()
  return {
    ensureLink: useMutation({ mutationFn: () => ensureLibraryLink(nodeId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.libraryLink(nodeId) }), meta: { silent: true } }),
  }
}
