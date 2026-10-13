import { fieldFromRow, fieldToRow, normalizeField, sortFields, validateFields } from '../../lib/certificates/layout.js'

/**
 * Certificates node model (design 01 section 3.10, decisions 01-11 / 07-8 / 07-9, m38).
 * - `nodes.config` = { language: 'ar' | 'en', verifier: { enabled, showCertificate } } (+ unknown keys kept): ONE template per language
 *   (07-8), the node issues with the template of `language`; the public verifier can be switched off, and its page may or may not show the
 *   rendered certificate (only the printed values travel, m38).
 * - the template itself (image + positioned fields) is rows (`certificate_templates` + `certificate_template_fields`) saved as
 *   `children.template`; a draft is { filePath, widthPx, heightPx, fields[] } in the client's camelCase field model.
 */
export const LANGUAGES = ['ar', 'en']

export const defaultCertConfig = () => ({ language: 'ar', verifier: { enabled: true, showCertificate: true } })

export function normalizeCertConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const v = c.verifier && typeof c.verifier === 'object' ? c.verifier : {}
  return {
    ...c,
    language: LANGUAGES.includes(c.language) ? c.language : 'ar',
    verifier: { ...v, enabled: v.enabled !== false, showCertificate: v.showCertificate !== false },
  }
}

/** The newest template version of `language` from the definition rows, as a draft; null when there is none. */
export function templateDraft(rows, language) {
  const row = (rows ?? []).filter((r) => r.language === language).sort((a, b) => b.version - a.version)[0]
  if (!row) return null
  return {
    filePath: row.file_path,
    widthPx: row.width_px,
    heightPx: row.height_px,
    version: row.version,
    fields: sortFields((row.fields ?? []).map(fieldFromRow)),
  }
}

/** The part of a draft that is persisted (version is read-only). Used for dirty checks. */
export const persisted = (d) => (d ? { filePath: d.filePath, widthPx: d.widthPx, heightPx: d.heightPx, fields: sortFields(d.fields.map(normalizeField)) } : null)
export const sameDraft = (a, b) => JSON.stringify(persisted(a)) === JSON.stringify(persisted(b))

/** `children` of save_node. A node without a template sends nothing. */
export function toChildren(draft, language) {
  if (!draft?.filePath) return null
  return { template: { language, file_path: draft.filePath, file_kind: 'image', width_px: draft.widthPx, height_px: draft.heightPx, fields: sortFields(draft.fields).map(fieldToRow) } }
}

/** Problems that block the save (a missing image) and the ones the PM should fix before issuing (the name field). */
export function validateDraft(draft) {
  const errors = []
  const warnings = []
  if (!draft?.filePath) errors.push({ code: 'noImage' })
  for (const issue of validateFields(draft?.fields ?? [])) (issue.code === 'noName' ? warnings : errors).push(issue)
  return { errors, warnings }
}

/**
 * The Issue panel (m42, owner decision 08 section 17.2): a row is a PARTICIPANT (the company that attended); the certificates belong to the
 * FOUNDER ACCOUNTS linked to it. The server payload of a row: { participant_id, status, name, company_name, grant { id, granted_at, revoked_at,
 * revoked_reason } | null, founders[{ name, linked, state, detached?, certificate { id, code, issued_at, revoked_at, revoked_reason, name } | null }],
 * counts { people, linked, unlinked, issued, claimable, revoked } }.
 *
 * Row state: 'issued' (authorised, at least one founder holds a certificate) | 'authorised' (authorised, nobody holds one yet) | 'revoked' (the
 * authorisation was revoked) | 'pending' (not authorised yet). Person state (decided by the server): issued | revoked | claimable | pending |
 * not_linked | no_name.
 */
export function rowState(row) {
  const g = row?.grant
  const issued = row?.counts?.issued ?? 0
  if (g && !g.revoked_at) return issued > 0 ? 'issued' : 'authorised'
  if (g && g.revoked_at) return 'revoked'
  return issued > 0 ? 'issued' : 'pending'
}

const claimable = (row) => row?.counts?.claimable ?? 0

/**
 * Rows a PM may issue to by hand ("Issue to selected"): attended and not fully served: never authorised, authorisation revoked (re-authorised on
 * purpose: new certificates, new codes), or authorised with a linked founder who has no certificate yet (created now instead of on his next visit).
 */
export const issuable = (row) => row.status === 'attended' && (rowState(row) === 'pending' || rowState(row) === 'revoked' || claimable(row) > 0)
/** Rows "Issue to all attended" works on: never authorised, or authorised with a founder waiting (a revoked authorisation is skipped on purpose, 07-9). */
export const issuableInBulk = (row) => row.status === 'attended' && (rowState(row) === 'pending' || (Boolean(row.grant) && !row.grant.revoked_at && claimable(row) > 0))
/** One founder whose certificate was revoked may be issued AGAIN while the participant is still authorised. */
export const canReissue = (row, person) => person?.state === 'revoked' && Boolean(person.certificate) && !person.detached && Boolean(row.grant) && !row.grant.revoked_at
/** "Revoke all" is offered while the participant is authorised or anyone still holds an active certificate. */
export const canRevokeAll = (row) => (Boolean(row.grant) && !row.grant.revoked_at) || (row.counts?.issued ?? 0) > 0

/** Summary counts of the Issue panel (participants and PEOPLE). */
export function summarize(rows) {
  const out = { attended: 0, authorised: 0, issued: 0, claimable: 0, unlinked: 0, revoked: 0, pending: 0, flagged: 0 }
  for (const r of rows ?? []) {
    if (r.status === 'attended') out.attended += 1
    const s = rowState(r)
    if (s === 'issued' || s === 'authorised') out.authorised += 1
    if (r.status === 'attended' && s === 'pending') out.pending += 1
    out.issued += r.counts?.issued ?? 0
    out.claimable += r.counts?.claimable ?? 0
    out.unlinked += r.counts?.unlinked ?? 0
    out.revoked += r.counts?.revoked ?? 0
    if ((r.counts?.issued ?? 0) > 0 && r.status !== 'attended') out.flagged += 1
  }
  return out
}

/** True when any certificate exists for the node (a changed template then creates a new VERSION). */
export const hasCertificates = (rows) => (rows ?? []).some((r) => Boolean(r.grant) || (r.counts?.issued ?? 0) + (r.counts?.revoked ?? 0) > 0)

/** Badge tone of a person state / row state. */
export const PERSON_TONES = { issued: 'green', revoked: 'red', claimable: 'blue', pending: 'neutral', not_linked: 'amber', no_name: 'amber' }
export const ROW_TONES = { pending: 'neutral', authorised: 'blue', issued: 'green', revoked: 'red' }

/**
 * Why issuing is not possible right now (the panel shows it next to the disabled button): 'notCompleted' | 'noTemplate' |
 * 'incomplete' | null. Completion is per PROJECT (decision 01-11); the server re-checks both.
 */
export function issueBlocker(admin) {
  if (!admin) return null
  if (!admin.project?.completed_at) return 'notCompleted'
  if (!admin.template) return 'noTemplate'
  if (!admin.template.has_name_field) return 'incomplete'
  return null
}
