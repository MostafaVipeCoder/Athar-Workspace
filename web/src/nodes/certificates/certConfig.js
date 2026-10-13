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

/** Status of one Issue-panel row from the server payload: 'issued' | 'revoked' | 'pending'. */
export function rowState(row) {
  const c = row?.certificate
  if (!c) return 'pending'
  return c.revoked_at ? 'revoked' : 'issued'
}

/** Rows a PM may issue to by hand: attended and without an ACTIVE certificate (a revoked one is re-issued on purpose). */
export const issuable = (row) => row.status === 'attended' && rowState(row) !== 'issued'
/** Rows "Issue to all attended" would create certificates for (revoked ones are skipped on purpose, 07-9). */
export const issuableInBulk = (row) => row.status === 'attended' && rowState(row) === 'pending'

/** Summary counts of the Issue panel. */
export function summarize(rows) {
  const out = { attended: 0, issued: 0, revoked: 0, pending: 0, flagged: 0 }
  for (const r of rows ?? []) {
    if (r.status === 'attended') out.attended += 1
    const s = rowState(r)
    if (s === 'issued') out.issued += 1
    if (s === 'revoked') out.revoked += 1
    if (r.status === 'attended' && s === 'pending') out.pending += 1
    if (s === 'issued' && r.status !== 'attended') out.flagged += 1
  }
  return out
}

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
