import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { removeImage } from './storage.js'

/**
 * Form Builder data (design 04 section 3.7, 03 sections 6.2/9): the PM reads `forms`/`form_sections`/`form_questions`/
 * `form_responses` under RLS and writes the definition ONLY through save_node (children = sections/questions/form row,
 * atomic, revision-bumping); the public respondent reads `get_public_form` and submits through the anon RPC
 * `submit_public_form` (m31) which validates server-side. Covers and library templates are plain PM tables.
 */
export const FORM_LINK_KIND = 'form'
export const RESPONSES_PAGE = 1000
export const UPLOAD_BUCKET = 'form-uploads'
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const UPLOAD_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'xlsx', 'txt']
const UPLOAD_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain' }

// ------------------------------------------------------------------ PM: definition (raw rows; the node normalises with formLogic)
export async function getFormDefinition(nodeId) {
  const [form, sections, questions] = await Promise.all([
    db().from('forms').select('node_id, project_id, template_id, cover_id, is_active, opens_at, closes_at, max_responses, one_response_per_email, export_sheet_id, export_sheet_tab, cover:form_covers(image_path)').eq('node_id', nodeId).maybeSingle(),
    db().from('form_sections').select('id, title_en, title_ar, description_en, description_ar, order_index').eq('node_id', nodeId).order('order_index'),
    db().from('form_questions').select('id, section_id, key, type, semantic, label_en, label_ar, description_en, description_ar, placeholder_en, placeholder_ar, is_required, options, validation, order_index').eq('node_id', nodeId).order('order_index'),
  ])
  const f = unwrap(form)
  return {
    form: f
      ? { ...f, cover_path: f.cover?.image_path ?? null, cover: undefined }
      : { node_id: nodeId, is_active: true, opens_at: null, closes_at: null, max_responses: null, one_response_per_email: false, cover_id: null, cover_path: null, template_id: null, export_sheet_id: null, export_sheet_tab: null },
    sections: unwrap(sections) ?? [],
    questions: unwrap(questions) ?? [],
  }
}

export async function getFormCoverPath(coverId) {
  if (!coverId) return null
  const row = unwrap(await db().from('form_covers').select('image_path').eq('id', coverId).maybeSingle())
  return row?.image_path ?? null
}

// ------------------------------------------------------------------ PM: responses
export async function listResponses(nodeId, { limit = RESPONSES_PAGE, offset = 0 } = {}) {
  return unwrap(
    await db().from('form_responses').select('id, answers, source, tracking, status, submitted_at, submitted_by').eq('node_id', nodeId).is('deleted_at', null).order('submitted_at', { ascending: false }).range(offset, offset + limit - 1),
  ) ?? []
}
export async function setResponseStatus(id, status) {
  unwrap(await db().from('form_responses').update({ status }).eq('id', id))
}
/** Soft delete (02-3): the row keeps its answers; undo through restore_form_response. */
export async function deleteResponse(id) {
  unwrap(await db().from('form_responses').update({ deleted_at: new Date().toISOString() }).eq('id', id))
}
export async function restoreResponse(id) {
  unwrap(await db().rpc('restore_form_response', { p_id: id }))
}
/** Share/view clicks of this form (node_events, PM read). */
export async function listFormEvents(nodeId) {
  return unwrap(await db().from('node_events').select('event_type, platform, created_at').eq('node_id', nodeId).in('event_type', ['form_view', 'form_share']).order('created_at', { ascending: false }).limit(5000)) ?? []
}

// ------------------------------------------------------------------ PM: covers (project + global library)
export async function listCovers(projectId) {
  return unwrap(await db().from('form_covers').select('id, project_id, name, image_path, created_at').or(`project_id.eq.${projectId},project_id.is.null`).order('created_at', { ascending: false })) ?? []
}
export async function createCover({ projectId, name, imagePath, userId = null }) {
  return unwrap(await db().from('form_covers').insert({ project_id: projectId, name: name || null, image_path: imagePath, created_by: userId }).select('id, project_id, name, image_path, created_at').single())
}
export async function deleteCover(cover) {
  unwrap(await db().from('form_covers').delete().eq('id', cover.id))
  await removeImage(cover.image_path).catch(() => {})
}

// ------------------------------------------------------------------ PM: library templates
export async function listTemplates(projectId) {
  return unwrap(await db().from('form_templates').select('id, project_id, name_en, name_ar, description_en, description_ar, definition, schema_version, cover_id, created_at').or(`project_id.eq.${projectId},project_id.is.null`).order('created_at', { ascending: false })) ?? []
}
export async function createTemplate({ projectId, name, description, definition, coverId = null, userId = null }) {
  return unwrap(
    await db().from('form_templates').insert({ project_id: projectId, name_en: name?.en?.trim() || null, name_ar: name?.ar?.trim() || null, description_en: description?.en?.trim() || null, description_ar: description?.ar?.trim() || null, definition, schema_version: definition?.schema_version ?? 2, cover_id: coverId, created_by: userId }).select('id').single(),
  )
}
export async function deleteTemplate(id) {
  unwrap(await db().from('form_templates').delete().eq('id', id))
}

// ------------------------------------------------------------------ public link (kind 'form')
export async function getFormLink(nodeId) {
  const link = unwrap(await db().from('public_links').select('id, is_enabled').eq('node_id', nodeId).eq('kind', FORM_LINK_KIND).is('view_key', null).maybeSingle())
  if (!link) return null
  const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', link.id).eq('is_current', true).maybeSingle())
  return { linkId: link.id, slug: slug?.slug ?? null, enabled: link.is_enabled }
}
export async function ensureFormLink(nodeId) {
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: FORM_LINK_KIND, p_view_key: null, p_project: null }))
  return getFormLink(nodeId)
}

// ------------------------------------------------------------------ respondent (anon or signed in; the DB decides the audience)
export async function getPublicForm(ref) {
  return unwrap(await db().rpc('get_public_form', { p_ref: ref }))
}
/** Returns { id, accepted }. Throws AppError with messageKey form.err.* (tokens of m31) or field errors (detail). */
export async function submitPublicForm(ref, answers, tracking = {}, website = null) {
  return unwrap(await db().rpc('submit_public_form', { p_ref: ref, p_answers: answers, p_tracking: tracking, p_website: website }))
}
export async function trackFormEvent(ref, type, platform = null) {
  try {
    await db().rpc('track_node_event', { p_ref: ref, p_type: type, p_card: null, p_platform: platform })
  } catch {
    /* analytics must never break the form */
  }
}

/** Respondent file upload to the private `form-uploads` bucket under `<project>/<form>/<uuid>.<ext>` (m31 policy). */
export function validateUploadFile(file) {
  if (!file) return 'form.err.fileRequired'
  const ext = String(file.name ?? '').split('.').pop()?.toLowerCase()
  if (!UPLOAD_EXTENSIONS.includes(ext)) return 'form.err.fileType'
  if (file.size > UPLOAD_MAX_BYTES) return 'form.err.fileSize'
  return null
}
export async function uploadFormFile(projectId, nodeId, file) {
  const problem = validateUploadFile(file)
  if (problem) throw new AppError('validation', { messageKey: problem, retryable: false })
  const ext = String(file.name).split('.').pop().toLowerCase()
  const path = `${projectId}/${nodeId}/${crypto.randomUUID()}.${ext}`
  const { error } = await db().storage.from(UPLOAD_BUCKET).upload(path, file, { contentType: UPLOAD_MIME[ext] ?? file.type, cacheControl: '3600', upsert: false })
  if (error) throw fromSupabase(error)
  return path
}
/** PM read of an uploaded file (select policy: project managers). */
export async function signedFileUrl(path, expiresIn = 600) {
  const { data, error } = await db().storage.from(UPLOAD_BUCKET).createSignedUrl(path, expiresIn)
  if (error) throw fromSupabase(error)
  return data?.signedUrl ?? null
}

// ------------------------------------------------------------------ hooks
export const useFormDefinition = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.formDef(nodeId), queryFn: () => getFormDefinition(nodeId), enabled: Boolean(nodeId), ...options })
export const useFormResponses = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.formResponses(nodeId), queryFn: () => listResponses(nodeId), enabled: Boolean(nodeId), ...options })
export const useFormEvents = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.formEvents(nodeId), queryFn: () => listFormEvents(nodeId), enabled: Boolean(nodeId), staleTime: 60_000, ...options })
export const useFormCovers = (projectId, options = {}) =>
  useQuery({ queryKey: keys.formCovers(projectId), queryFn: () => listCovers(projectId), enabled: Boolean(projectId), ...options })
export const useFormTemplates = (projectId, options = {}) =>
  useQuery({ queryKey: keys.formTemplates(projectId), queryFn: () => listTemplates(projectId), enabled: Boolean(projectId), ...options })
export const useFormLink = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.formLink(nodeId), queryFn: () => getFormLink(nodeId), enabled: Boolean(nodeId), ...options })
export const usePublicForm = (ref, options = {}) =>
  useQuery({ queryKey: keys.publicForm(ref), queryFn: () => getPublicForm(ref), enabled: Boolean(ref), refetchOnWindowFocus: false, staleTime: 60_000, ...options })

/** Row-level mutations of one form node (responses, covers, templates, link). Each success invalidates the node's cache. */
export function useFormMutations(nodeId, projectId, { onChanged } = {}) {
  const qc = useQueryClient()
  const after = async () => {
    await qc.invalidateQueries({ queryKey: keys.node(nodeId) })
    await onChanged?.()
  }
  const useM = (mutationFn, opts = {}) => useMutation({ mutationFn, onSuccess: after, meta: { silent: true }, ...opts })
  const m = useM
  return {
    setStatus: m(({ id, status }) => setResponseStatus(id, status)),
    remove: m(({ id }) => deleteResponse(id)),
    restore: m(({ id }) => restoreResponse(id)),
    ensureLink: useMutation({ mutationFn: () => ensureFormLink(nodeId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.formLink(nodeId) }), meta: { silent: true } }),
    createCover: useMutation({ mutationFn: (args) => createCover({ projectId, ...args }), onSuccess: () => qc.invalidateQueries({ queryKey: keys.formCovers(projectId) }), meta: { silent: true } }),
    deleteCover: useMutation({ mutationFn: (cover) => deleteCover(cover), onSuccess: () => qc.invalidateQueries({ queryKey: keys.formCovers(projectId) }), meta: { silent: true } }),
    createTemplate: useMutation({ mutationFn: (args) => createTemplate({ projectId, ...args }), onSuccess: () => qc.invalidateQueries({ queryKey: keys.formTemplates(projectId) }), meta: { silent: true } }),
    deleteTemplate: useMutation({ mutationFn: (id) => deleteTemplate(id), onSuccess: () => qc.invalidateQueries({ queryKey: keys.formTemplates(projectId) }), meta: { silent: true } }),
  }
}
