import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { newId } from '../lib/id.js'

/**
 * Certificates data (design 01 section 3.10, 04 sections 3.13 + 5.7, 07 section 4; RPCs of m38 + m42, owner decision 08 section 17.2):
 * - the PM reads the TEMPLATE definition under RLS (`certificate_templates` + `certificate_template_fields`) and writes it ONLY through
 *   save_node children (`{ template: {...} }` -> `app_private.save_children_certificates`: validated, versioned once a certificate
 *   references it);
 * - the template image lives in the PRIVATE `certificate-templates` bucket at `<project id>/<node id>/<uuid>.webp`: EVERY image goes through
 *   the universal WebP pipeline (`storeImage`, profile 'template': max 4000 px, quality 0.92, alpha kept, no thumbnail; owner decision 17.3) and
 *   the bucket accepts nothing else (m42); readers get SHORT-LIVED signed URLs (PMs by their policy, the OWNER of an issued certificate and the
 *   public verifier through `public.cert_template_readable`);
 * - a certificate belongs to ONE FOUNDER ACCOUNT (person name + company name, m42): the PM's `issue_certificates` AUTHORISES the attended
 *   participants (company level) and creates the certificate of every account already linked; a founder who links later gets hers when the
 *   Program page block opens (`list_my_certificates` claims on demand, `claim_my_certificate` is the explicit form); revocation is per
 *   certificate (`revoke_certificate`) or per participant (`revoke_participant_certificates`); `reissue_certificate` issues one person again;
 * - the certificate is RENDERED on demand in the client (lib/certificates, decision 06-5) and never stored.
 */
export const TEMPLATE_BUCKET = 'certificate-templates'
const SIGNED_TTL = 3600

// ------------------------------------------------------------------ PM reads
/** Every template version of the node with its fields, newest first (the editor picks the node language's latest). */
export async function getCertificateDefinition(nodeId) {
  const rows = unwrap(await db().from('certificate_templates')
    .select('id, version, language, file_path, file_kind, width_px, height_px, created_at, certificate_template_fields(var, x, y, w, align, font, size, color, weight, direction, max_lines, shrink_to_fit)')
    .eq('node_id', nodeId).order('version', { ascending: false })) ?? []
  return rows.map(({ certificate_template_fields: fields, ...t }) => ({ ...t, fields: fields ?? [] }))
}

/** The Issue panel payload: project completion, template state, one row per attended participant (+ anyone holding a certificate). */
async function getCertificatesAdmin(nodeId) {
  return unwrap(await db().rpc('get_certificates_admin', { p_node: nodeId }))
}

// ------------------------------------------------------------------ files (private bucket)
/**
 * Validate the file type / size, convert it to WebP (lib/image, profile 'template') and store it under the node folder. Returns the STORED image:
 * { path, mime, bytes, width, height, report } (width / height of the converted image are what the template row keeps).
 * Throws AppError('validation', { messageKey }) for a refused file (`certificates.err.file.*` or `errors.image.*`).
 */
export async function uploadTemplateFile(file, { projectId, nodeId, onProgress } = {}) {
  // lazy: the anonymous verifier page imports this module and must not carry the upload side (storage, image paths, the header sniffer)
  const [{ validateTemplateFile }, { storeImage }] = await Promise.all([import('../lib/certificates/templateFile.js'), import('./storage.js')])
  const problem = validateTemplateFile(file)
  if (problem) throw new AppError('validation', { messageKey: `certificates.err.file.${problem}`, retryable: false })
  if (!projectId || !nodeId) throw new AppError('validation', { retryable: false })
  const stored = await storeImage(file, { bucket: TEMPLATE_BUCKET, path: (ext) => `${projectId}/${nodeId}/${newId()}.${ext}`, profile: 'template', onProgress })
  return { path: stored.path, mime: stored.mime, bytes: stored.bytes, width: stored.width, height: stored.height, report: stored.report }
}

/** Best-effort removal (discarded drafts, replaced images); never throws. */
export async function removeTemplateFiles(paths) {
  const { removeObjects } = await import('./storage.js')
  return removeObjects(TEMPLATE_BUCKET, paths)
}

/** A signed URL of a template image: PM (own policy), owner of an issued certificate, or the public verifier (m38 policy). */
export async function signedTemplateUrl(path, expiresIn = SIGNED_TTL) {
  const { data, error } = await db().storage.from(TEMPLATE_BUCKET).createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw fromSupabase(error ?? new Error('forbidden'))
  return data.signedUrl
}

// ------------------------------------------------------------------ issuing / revoking (PM)
/**
 * "Issue certificates": authorises the participants and creates the certificate of every founder account already linked to them.
 * `participantIds = null` -> every attended participant (a participant whose authorisation was revoked is skipped); an array -> exactly those
 * (re-authorises a participant whose authorisation was revoked: NEW certificates with NEW codes).
 * Result: { issued (certificates created), authorised (participants), existing, skipped, results[{ participant_id, status, created, linked, unlinked, ... }] }.
 */
export async function issueCertificates(nodeId, participantIds = null) {
  return unwrap(await db().rpc('issue_certificates', { p_node: nodeId, p_participants: participantIds }))
}
/** Revoke ONE person's certificate (the others of the company stay valid). */
export async function revokeCertificate(certificateId, reason = '') {
  unwrap(await db().rpc('revoke_certificate', { p_cert: certificateId, p_reason: reason || null }))
}
/** Revoke the authorisation of a participant AND every active certificate of its founders. Returns { revoked, grant_revoked }. */
export async function revokeParticipantCertificates(nodeId, participantId, reason = '') {
  return unwrap(await db().rpc('revoke_participant_certificates', { p_node: nodeId, p_participant: participantId, p_reason: reason || null }))
}
/** Issue AGAIN to one person whose certificate was revoked (a new certificate with a new code; the authorisation must be active). */
export async function reissueCertificate(certificateId) {
  return unwrap(await db().rpc('reissue_certificate', { p_cert: certificateId }))
}
/** The renderer payload of ONE certificate: PM, or the owner when it may be downloaded now. */
export async function getRenderPayload(certificateId) {
  return unwrap(await db().rpc('get_certificate_render_payload', { p_cert: certificateId }))
}

// ------------------------------------------------------------------ founder + public
/**
 * The caller's OWN certificates (one per founder account; a certificate of the company's other founders is never listed). Opening this CLAIMS
 * the caller's own certificate on demand on every authorised node (a founder who linked after the PM issued gets hers here), then lists.
 * Rows: { certificate_id, node_id, project_id, code, issued_at, person_name, company_name, program_name, project_name, completed_on, language }.
 */
export async function listMyCertificates(projectId = null) {
  return unwrap(await db().rpc('list_my_certificates', { p_project: projectId })) ?? []
}
/** The explicit claim of the caller's own certificate of ONE node: { status: 'issued' | 'existing' | 'revoked' | 'no_name', certificate_id, code }. `forbidden` when not linked. */
export async function claimMyCertificate(nodeId) {
  return unwrap(await db().rpc('claim_my_certificate', { p_node: nodeId }))
}
/** Public verifier: { status: 'valid'|'revoked'|'not_found', person_name, company_name, program_name, project_name, completed_on, issued_on, render? }. */
async function getPublicVerification(code) {
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
    revokeParticipant: useMutation({ mutationFn: ({ participantId, reason }) => revokeParticipantCertificates(nodeId, participantId, reason), onSuccess: after, meta: { silent: true } }),
    reissue: useMutation({ mutationFn: (certificateId) => reissueCertificate(certificateId), onSuccess: after, meta: { silent: true } }),
  }
}
