import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { TEMPLATE_RULES, templateMime, validateTemplateFile } from '../lib/certificates/templateFile.js'
import { uuid } from '../lib/resourceFiles.js'

/**
 * Certificates data (design 01 section 3.10, 04 sections 3.13 + 5.7, 07 section 4; RPCs of m38):
 * - the PM reads the TEMPLATE definition under RLS (`certificate_templates` + `certificate_template_fields`) and writes it ONLY through
 *   save_node children (`{ template: {...} }` -> `app_private.save_children_certificates`: validated, versioned once a certificate
 *   references it);
 * - the template image lives in the PRIVATE `certificate-templates` bucket at `<project id>/<node id>/<uuid>.<ext>`, stored AS UPLOADED
 *   (PNG / JPEG, no re-encoding: print quality); readers get SHORT-LIVED signed URLs (PMs by their policy, the owner of an issued
 *   certificate and the public verifier through `public.cert_template_readable`, m38);
 * - issuing / revoking are server RPCs (`issue_certificates`, `revoke_certificate`); the certificate is RENDERED on demand in the client
 *   (lib/certificates, decision 06-5) and never stored.
 */
export const TEMPLATE_BUCKET = 'certificate-templates'
export const SIGNED_TTL = 3600

// ------------------------------------------------------------------ PM reads
/** Every template version of the node with its fields, newest first (the editor picks the node language's latest). */
export async function getCertificateDefinition(nodeId) {
  const rows = unwrap(await db().from('certificate_templates')
    .select('id, version, language, file_path, file_kind, width_px, height_px, created_at, certificate_template_fields(var, x, y, w, align, font, size, color, weight, direction, max_lines, shrink_to_fit)')
    .eq('node_id', nodeId).order('version', { ascending: false })) ?? []
  return rows.map(({ certificate_template_fields: fields, ...t }) => ({ ...t, fields: fields ?? [] }))
}

/** The Issue panel payload: project completion, template state, one row per attended participant (+ anyone holding a certificate). */
export async function getCertificatesAdmin(nodeId) {
  return unwrap(await db().rpc('get_certificates_admin', { p_node: nodeId }))
}

// ------------------------------------------------------------------ files (private bucket)
/** Validate (the same rules as the bucket) and upload ONE template image as is. Returns { path, mime, bytes }. */
export async function uploadTemplateFile(file, { projectId, nodeId }) {
  const problem = validateTemplateFile(file)
  if (problem) throw new AppError('validation', { messageKey: `certificates.err.file.${problem}`, retryable: false })
  if (!projectId || !nodeId) throw new AppError('validation', { retryable: false })
  const mime = templateMime(file)
  const path = `${projectId}/${nodeId}/${uuid()}.${TEMPLATE_RULES.extensions[mime]}`
  const { error } = await db().storage.from(TEMPLATE_BUCKET).upload(path, file, { contentType: mime, cacheControl: '3600', upsert: false })
  if (error) throw fromSupabase(error)
  return { path, mime, bytes: file.size }
}

/** Best-effort removal (discarded drafts, replaced images); never throws. */
export async function removeTemplateFiles(paths) {
  const list = [...new Set((paths ?? []).filter(Boolean))]
  if (!list.length) return
  await db().storage.from(TEMPLATE_BUCKET).remove(list).catch(() => {})
}

/** A signed URL of a template image: PM (own policy), owner of an issued certificate, or the public verifier (m38 policy). */
export async function signedTemplateUrl(path, expiresIn = SIGNED_TTL) {
  const { data, error } = await db().storage.from(TEMPLATE_BUCKET).createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw fromSupabase(error ?? new Error('forbidden'))
  return data.signedUrl
}

// ------------------------------------------------------------------ issuing / revoking (PM)
/** `participantIds = null` -> every attended participant (revoked ones are skipped); an array -> exactly those (re-issues revoked ones). */
export async function issueCertificates(nodeId, participantIds = null) {
  return unwrap(await db().rpc('issue_certificates', { p_node: nodeId, p_participants: participantIds }))
}
export async function revokeCertificate(certificateId, reason = '') {
  unwrap(await db().rpc('revoke_certificate', { p_cert: certificateId, p_reason: reason || null }))
}
/** The renderer payload of ONE certificate: PM, or the owner when it may be downloaded now. */
export async function getRenderPayload(certificateId) {
  return unwrap(await db().rpc('get_certificate_render_payload', { p_cert: certificateId }))
}

// ------------------------------------------------------------------ founder + public
export async function listMyCertificates(projectId = null) {
  return unwrap(await db().rpc('list_my_certificates', { p_project: projectId })) ?? []
}
/** Public verifier: { status: 'valid'|'revoked'|'not_found', participant_name, program_name, project_name, completed_on, issued_on, render? }. */
export async function getPublicVerification(code) {
  return unwrap(await db().rpc('get_public_certificate_verification', { p_code: code }))
}

// ------------------------------------------------------------------ hooks
export const useCertificateDefinition = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.certificateDef(nodeId), queryFn: () => getCertificateDefinition(nodeId), enabled: Boolean(nodeId), ...options })

export const useCertificatesAdmin = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.certificatesAdmin(nodeId), queryFn: () => getCertificatesAdmin(nodeId), enabled: Boolean(nodeId), refetchOnWindowFocus: true, ...options })

export const useMyCertificates = (projectId, options = {}) =>
  useQuery({ queryKey: keys.myCertificates(projectId), queryFn: () => listMyCertificates(projectId), enabled: Boolean(projectId), ...options })

/** The public verifier answer for a typed / scanned code (the server rate-limits; a stale answer is fine for a minute). */
export const usePublicVerification = (code, options = {}) =>
  useQuery({ queryKey: keys.publicCertificate(code), queryFn: () => getPublicVerification(code), enabled: Boolean(code), staleTime: 60_000, retry: false, ...options })

export function useCertificateMutations(nodeId) {
  const qc = useQueryClient()
  const after = () => qc.invalidateQueries({ queryKey: keys.certificatesAdmin(nodeId) })
  return {
    issue: useMutation({ mutationFn: (participantIds) => issueCertificates(nodeId, participantIds), onSuccess: after, meta: { silent: true } }),
    revoke: useMutation({ mutationFn: ({ certificateId, reason }) => revokeCertificate(certificateId, reason), onSuccess: after, meta: { silent: true } }),
  }
}
