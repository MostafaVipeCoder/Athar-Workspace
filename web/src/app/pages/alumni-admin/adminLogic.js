/**
 * Pure logic of the manager pages (invitations, notification audiences, opportunities, the snapshot grid, the Excel import, the chart helpers). No React, no network:
 * everything here is unit-tested in adminLogic.test.js. The national ID rules are NOT here (the database derives and validates them).
 */

// ================================================================== invitations (single / bulk paste / CSV)
const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/

/** Split one CSV-ish line on commas, semicolons and tabs, honouring "double quotes". */
export function splitLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1 } else quoted = !quoted
    } else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

/**
 * The bulk box: one invitation per line, `email` or `email, company` (the company as its name or its id; the order of the two does not matter). A header line
 * ("email, company") is skipped. Returns `{ rows: [{ line, email, company, error }], valid, invalid }`; `error` is a token (`no_email`, `bad_email`, `duplicate`).
 */
export function parseInviteLines(text) {
  const rows = []
  const seen = new Set()
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return
    const tokens = splitLine(raw)
    if (tokens.length === 0) return
    if (i === 0 && tokens.some((t) => /^e-?mail$/i.test(t)) && !tokens.some((t) => t.includes('@'))) return
    const at = tokens.findIndex((t) => t.includes('@'))
    if (at < 0) { rows.push({ line: i + 1, email: '', company: tokens.join(' '), error: 'no_email' }); return }
    const email = tokens[at].toLowerCase()
    const company = tokens.filter((_, k) => k !== at).join(' ').trim()
    let error = EMAIL_RE.test(email) ? null : 'bad_email'
    const key = `${email}|${company.toLowerCase()}`
    if (!error && seen.has(key)) error = 'duplicate'
    seen.add(key)
    rows.push({ line: i + 1, email, company, error })
  })
  const invalid = rows.filter((r) => r.error).length
  return { rows, valid: rows.length - invalid, invalid }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const looksLikeId = (v) => UUID_RE.test(String(v ?? '').trim())

/** A company typed as a name resolves to a directory row only when exactly ONE row has that name (either language, case-insensitive). */
export function matchCompanyByName(rows, text) {
  const q = String(text ?? '').trim().toLowerCase()
  if (!q) return { status: 'none' }
  const hits = (rows ?? []).filter((r) => String(r.name_en ?? '').trim().toLowerCase() === q || String(r.name_ar ?? '').trim().toLowerCase() === q)
  if (hits.length === 1) return { status: 'one', company: hits[0] }
  return { status: hits.length === 0 ? 'none' : 'many' }
}

/** Tab-separated `email<TAB>company<TAB>link` for the "copy all" button (a mail merge can paste it). */
export const invitationsAsTsv = (items) => items.map((i) => [i.email, i.companyName ?? '', i.link ?? ''].join('\t')).join('\n')

export const STATUS_TABS = Object.freeze(['all', 'pending', 'accepted', 'expired', 'revoked'])
export const statusTone = (s) => ({ pending: 'amber', accepted: 'green', expired: 'neutral', revoked: 'red' })[s] ?? 'neutral'

// ================================================================== notifications: the audience
/** `a` = `{ kind, programId, projectId, companies: [{ id }], founders: [{ id }] }` -> the RPC audience (a project wins over its program). */
export function audienceToRpc(a) {
  switch (a?.kind) {
    case 'all': return { kind: 'all' }
    case 'program': return a.projectId ? { kind: 'program', project_id: a.projectId } : { kind: 'program', program_id: a.programId }
    case 'company': return { kind: 'company', company_ids: (a.companies ?? []).map((c) => c.id) }
    case 'founder': return { kind: 'founder', founder_ids: (a.founders ?? []).map((f) => f.id) }
    default: return null
  }
}
export function audienceReady(a) {
  switch (a?.kind) {
    case 'all': return true
    case 'program': return Boolean(a.projectId || a.programId)
    case 'company': return (a.companies ?? []).length > 0
    case 'founder': return (a.founders ?? []).length > 0
    default: return false
  }
}
export const audienceKey = (a) => JSON.stringify(audienceToRpc(a))

export const TITLE_MAX = 200
export const BODY_MAX = 4000
/** `{ title, body }` error tokens for the compose form ('required' | 'too_long'); a message needs a title and a body in at least ONE language. */
export function validateMessage({ titleEn = '', titleAr = '', bodyEn = '', bodyAr = '' }) {
  const errors = {}
  if (!titleEn.trim() && !titleAr.trim()) errors.title = 'required'
  else if (titleEn.length > TITLE_MAX || titleAr.length > TITLE_MAX) errors.title = 'too_long'
  if (!bodyEn.trim() && !bodyAr.trim()) errors.body = 'required'
  else if (bodyEn.length > BODY_MAX || bodyAr.length > BODY_MAX) errors.body = 'too_long'
  return errors
}
/** Which language is missing (the message is still valid: each reader gets the other language) */
export function missingLanguage({ titleEn = '', titleAr = '', bodyEn = '', bodyAr = '' }) {
  const en = titleEn.trim() && bodyEn.trim()
  const ar = titleAr.trim() && bodyAr.trim()
  if (en && ar) return null
  if (!en && !ar) return null
  return en ? 'ar' : 'en'
}
export const readRate = (reads, recipients) => (recipients > 0 ? Math.round((100 * reads) / recipients) : 0)

// ================================================================== opportunities
export const OPP_TYPES = Object.freeze(['grant', 'investment', 'event', 'competition', 'partnership', 'other'])
export const APP_STATUSES = Object.freeze(['applied', 'reviewing', 'shortlisted', 'accepted', 'rejected'])
export const OPP_TABS = Object.freeze(['all', 'published', 'draft', 'archived'])
export const appStatusTone = (s) => ({ applied: 'neutral', reviewing: 'blue', shortlisted: 'amber', accepted: 'green', rejected: 'red' })[s] ?? 'neutral'

export const oppStatus = (o) => (o?.archived_at ? 'archived' : o?.is_active ? 'published' : 'draft')
export const oppStatusTone = (s) => ({ published: 'green', draft: 'neutral', archived: 'outline' })[s] ?? 'neutral'
export const publishPatch = () => ({ is_active: true, archived_at: null })
export const unpublishPatch = () => ({ is_active: false })
export const archivePatch = (now = new Date()) => ({ is_active: false, archived_at: now.toISOString() })
export const restorePatch = () => ({ archived_at: null })

/** 'none' | 'passed' | 'soon' (within a week) | 'open'; `today` is a Date (the page passes the Cairo date when it has it). */
export function deadlineState(deadline, today = new Date()) {
  if (!deadline) return 'none'
  const d = new Date(`${String(deadline).slice(0, 10)}T00:00:00`)
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((d.getTime() - t0.getTime()) / 86400000)
  if (days < 0) return 'passed'
  return days <= 7 ? 'soon' : 'open'
}

export const EMPTY_TARGET = Object.freeze({ program_ids: [], sectors: [], stages: [], governorates: [] })
export function emptyOppForm() {
  return { type: 'grant', title_en: '', title_ar: '', description_en: '', description_ar: '', provider_en: '', provider_ar: '', deadline: '', eligibility: '', link: '', order_index: 0, target: { ...EMPTY_TARGET } }
}
export function oppToForm(o) {
  return {
    type: o?.type ?? 'grant', title_en: o?.title_en ?? '', title_ar: o?.title_ar ?? '', description_en: o?.description_en ?? '', description_ar: o?.description_ar ?? '',
    provider_en: o?.provider_en ?? '', provider_ar: o?.provider_ar ?? '', deadline: o?.deadline ? String(o.deadline).slice(0, 10) : '', eligibility: o?.eligibility ?? '', link: o?.link ?? '',
    order_index: Number(o?.order_index) || 0, target: { ...EMPTY_TARGET, ...(o?.target ?? {}) },
  }
}
const HTTP_RE = /^https?:\/\/[^\s]+$/i
export function validateOpp(f) {
  const e = {}
  if (!String(f.title_ar ?? '').trim()) e.title_ar = 'required'
  else if (f.title_ar.length > 200) e.title_ar = 'too_long'
  if (String(f.title_en ?? '').length > 200) e.title_en = 'too_long'
  if (String(f.description_ar ?? '').length > 4000) e.description_ar = 'too_long'
  if (String(f.description_en ?? '').length > 4000) e.description_en = 'too_long'
  if (String(f.eligibility ?? '').length > 2000) e.eligibility = 'too_long'
  if (f.link && (!HTTP_RE.test(f.link.trim()) || f.link.length > 500)) e.link = 'bad_url'
  if (f.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(f.deadline)) e.deadline = 'bad_date'
  return e
}
/** The columns to write: empty strings become null, the target keeps only its non-empty lists. */
export function oppFormToPatch(f) {
  const nn = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())
  const target = {}
  for (const k of Object.keys(EMPTY_TARGET)) if ((f.target?.[k] ?? []).length) target[k] = f.target[k]
  return {
    type: f.type, title_ar: String(f.title_ar).trim(), title_en: nn(f.title_en), description_ar: nn(f.description_ar), description_en: nn(f.description_en), provider_ar: nn(f.provider_ar),
    provider_en: nn(f.provider_en), deadline: nn(f.deadline), eligibility: nn(f.eligibility), link: nn(f.link), order_index: Number(f.order_index) || 0, target,
  }
}

// ================================================================== the yearly grid of the M&E workspace
export const SNAP_FIELDS = Object.freeze(['revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers'])
export const SNAP_COUNTS = Object.freeze(['employees_total', 'employees_female', 'freelancers'])

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'
/** What a person typed in a number cell: Arabic / Persian digits and group separators are understood. '' -> null (cleared), anything else that is not a number -> NaN. */
export function parseNumberInput(value) {
  let s = ''
  for (const ch of String(value ?? '')) {
    const a = ARABIC_INDIC.indexOf(ch)
    const p = PERSIAN.indexOf(ch)
    s += a >= 0 ? String(a) : p >= 0 ? String(p) : ch === '٫' ? '.' : ch
  }
  s = s.replace(/[\s,٬]/g, '')
  if (s === '') return null
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN
}

const show = (v) => (v === null || v === undefined ? '' : String(v))
/** A stored yearly row -> the strings of the grid cells. */
export const snapshotToForm = (row) => Object.fromEntries(SNAP_FIELDS.map((k) => [k, show(row?.[k])]))

/** `{ field: 'not_a_number' | 'negative' | 'not_integer' | 'exceeds_total' }` for the typed cells. */
export function validateSnapshotForm(form) {
  const errors = {}
  const num = {}
  for (const k of SNAP_FIELDS) {
    const n = parseNumberInput(form?.[k])
    num[k] = n
    if (Number.isNaN(n)) errors[k] = 'not_a_number'
    else if (n !== null && n < 0) errors[k] = 'negative'
    else if (n !== null && SNAP_COUNTS.includes(k) && !Number.isInteger(n)) errors[k] = 'not_integer'
  }
  if (!errors.employees_female && !errors.employees_total && num.employees_female !== null && num.employees_total !== null && num.employees_female > num.employees_total) errors.employees_female = 'exceeds_total'
  return errors
}

/** Only the cells whose number changed (a cleared cell is `null`): the patch of `upsert_company_snapshot`. Empty = nothing to save. */
export function snapshotPatch(base, form) {
  const patch = {}
  for (const k of SNAP_FIELDS) {
    const before = parseNumberInput(base?.[k])
    const after = parseNumberInput(form?.[k])
    if (Number.isNaN(after)) continue
    if ((before ?? null) !== (after ?? null)) patch[k] = after
  }
  return patch
}

/** The default year of the grid: the latest year with data, else last year (the annual update is about the year that just ended). */
export const defaultSnapshotYear = (latestYear, now = new Date()) => latestYear || now.getFullYear() - 1
export const yearOptions = (latestYear, now = new Date(), span = 6) => {
  const top = Math.max(now.getFullYear(), latestYear || 0)
  return Array.from({ length: span }, (_, i) => top - i)
}

// ================================================================== the Excel import (preview only)
const pad = (n) => String(n).padStart(2, '0')
/** Cells of a parsed sheet -> what the preview RPC expects: dates as ISO text (a SheetJS Date is shifted by 12 h so a timezone offset cannot move the day), numbers kept. */
export function toImportRows(sheetRows) {
  return (sheetRows ?? []).map((row) => {
    const out = {}
    for (const [k, v] of Object.entries(row ?? {})) {
      const key = String(k).trim()
      if (!key || key.startsWith('__EMPTY')) continue
      if (v instanceof Date && !Number.isNaN(v.getTime())) {
        const d = new Date(v.getTime() + 12 * 3600 * 1000)
        out[key] = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
      } else if (v === null || v === undefined) out[key] = ''
      else out[key] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v).trim()
    }
    return out
  })
}
export const chunkRows = (rows, size = 500) => {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/**
 * One preview from several chunks of the file (the RPC takes at most 500 rows): row numbers continue across chunks (`sizes` = the rows posted in each chunk, blank rows
 * included), summaries add up, a header is "missing" only when it is missing everywhere, proposals of the same value are merged.
 */
export function mergePreviews(parts, sizes = parts.map(() => 500)) {
  const merged = { count: 0, summary: { create: 0, update: 0, error: 0, warnings: 0 }, headers: { unknown: [], missing: [], ignored_derived: [] }, proposed_lookups: [], rows: [] }
  const proposals = new Map()
  let offset = 0
  parts.forEach((p, i) => {
    merged.count += p.count ?? 0
    for (const k of Object.keys(merged.summary)) merged.summary[k] += p.summary?.[k] ?? 0
    merged.rows.push(...(p.rows ?? []).map((r) => ({ ...r, row: r.row + offset })))
    for (const h of ['unknown', 'ignored_derived']) merged.headers[h] = [...new Set([...merged.headers[h], ...(p.headers?.[h] ?? [])])]
    merged.headers.missing = i === 0 ? [...(p.headers?.missing ?? [])] : merged.headers.missing.filter((m) => (p.headers?.missing ?? []).includes(m))
    for (const l of p.proposed_lookups ?? []) {
      const key = `${l.kind}|${String(l.value).toLowerCase()}|${l.parent ?? ''}`
      const prev = proposals.get(key)
      proposals.set(key, prev ? { ...prev, count: prev.count + l.count } : { ...l })
    }
    offset += sizes[i] ?? 0
  })
  merged.proposed_lookups = [...proposals.values()]
  return merged
}

/** An ASCII key for a new vocabulary value (`^[a-z0-9][a-z0-9_.-]{0,62}$`); a label with no Latin letters gets `value_<n>`. Never collides with `taken`. */
export function lookupKeyFromLabel(label, taken = []) {
  const base = String(label ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'value'
  const used = new Set(taken)
  if (!used.has(base) && base !== 'value') return base
  let n = 2
  while (used.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

export const issueLevelRank = (l) => (l === 'error' ? 0 : l === 'warning' ? 1 : 2)
export function filterPreviewRows(rows, mode) {
  if (mode === 'errors') return rows.filter((r) => r.errors > 0)
  if (mode === 'warnings') return rows.filter((r) => r.errors === 0 && r.warnings > 0)
  if (mode === 'ok') return rows.filter((r) => r.errors === 0 && r.warnings === 0)
  return rows
}

// ================================================================== charts / analytics
/** `[{ key, count }]` -> bars `[{ key, label, count, pct }]`, largest first; a null key is "not specified"; the tail beyond `limit` is one "other" bar. `pct` is of the TOTAL. */
export function barRows(items, { labelOf, limit = 8, otherLabel = 'Other', nullLabel = 'Not specified' } = {}) {
  const list = (items ?? []).filter((i) => Number(i.count) > 0)
  const total = list.reduce((s, i) => s + Number(i.count), 0)
  const rows = list.map((i) => ({ key: i.key ?? '', label: i.key === null || i.key === undefined || i.key === '' ? nullLabel : labelOf ? labelOf(i.key, i) : String(i.key), count: Number(i.count), pct: total ? (100 * Number(i.count)) / total : 0 }))
  rows.sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
  if (rows.length <= limit) return rows
  const head = rows.slice(0, limit - 1)
  const rest = rows.slice(limit - 1)
  const restCount = rest.reduce((s, r) => s + r.count, 0)
  return [...head, { key: '__other', label: otherLabel, count: restCount, pct: total ? (100 * restCount) / total : 0 }]
}
export const sharePct = (part, total) => (Number(total) > 0 ? Math.round((1000 * Number(part)) / Number(total)) / 10 : null)
/** One value per year for a chart; a year nobody reported the figure for is `missing` (drawn as a dash, never as a real zero). */
export const yearSeries = (byYear, field) => (byYear ?? []).map((y) => ({ year: y.year, value: Number(y[field]) || 0, missing: y[field] === null || y[field] === undefined })).sort((a, b) => a.year - b.year)

/** The sheets of the analytics Excel export: `{ [sheet name]: rows[] }` with readable column names; labels come from the page (translated). */
export function analyticsSheets(data, { labels, t }) {
  const tt = data?.totals ?? {}
  const sheets = {}
  sheets[t('summary')] = [
    [t('companies'), tt.companies], [t('open'), tt.open], [t('closed'), tt.closed], [t('survival'), tt.survival_rate], [t('withProgram'), tt.with_program], [t('reporting'), tt.reporting_year],
    [t('founders'), tt.founders], [t('femaleFounders'), tt.female_founders], [t('foundersUnder35'), tt.founders_under_35], [t('employees'), tt.employees], [t('femaleEmployees'), tt.female_employees],
    [t('freelancers'), tt.freelancers], [t('funding'), tt.funding_raised], [t('revenue'), tt.revenue],
  ].map(([metric, value]) => ({ [t('metric')]: metric, [t('value')]: value ?? '' }))
  const groups = [['by_sector', 'sector'], ['by_stage', 'stage'], ['by_startup_type', 'startupType'], ['by_legal_status', 'legalStatus'], ['by_governorate', 'companyLocation'],
    ['by_ceo_governorate', 'ceoGovernorate'], ['by_ceo_gender', 'gender'], ['by_ceo_age_category', 'ageCategory'], ['by_program', 'program']]
  for (const [field, name] of groups) {
    sheets[t(name)] = (data?.[field] ?? []).map((i) => ({ [t('label')]: labels(field, i), [t('count')]: i.count }))
  }
  sheets[t('byYear')] = (data?.by_year ?? []).map((y) => ({
    [t('year')]: y.year, [t('reporting')]: y.companies_reporting, [t('revenue')]: y.revenue ?? '', [t('funding')]: y.funding_raised ?? '', [t('employees')]: y.employees ?? '',
    [t('femaleEmployees')]: y.female_employees ?? '', [t('freelancers')]: y.freelancers ?? '',
  }))
  return Object.fromEntries(Object.entries(sheets).filter(([, rows]) => rows.length > 0))
}
