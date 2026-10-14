/**
 * The columns of the manager directory table (design 09 section 4: the owner's 38 Excel columns, in the owner's order, plus a few extras that only make sense on screen).
 *
 * `header` is the owner's Excel header text (the revenue header carries the year: `columnHeader`). The label shown in the UI comes from the i18n dictionary
 * (`alumni.admin.dir.col.<key>`); the owner's text stays visible in the column chooser so a manager can map the table to his sheet.
 * Nothing here recomputes a rule of the national ID: every person value comes from the server (`list_alumni_table`: derived from the ID by the database).
 */
import { lookupLabel } from '../../../lib/alumni.js'

/** `visible` = shown by default. `sort` = the server sort key (list_alumni_table), absent = not sortable. `kind` drives the cell renderer. */
export const COLUMNS = Object.freeze([
  { key: 'startup_name', header: 'Startup Name', owner: true, group: 'startup', sort: 'name', visible: true, kind: 'name' },
  { key: 'program_scope', header: 'Program Scope', owner: true, group: 'program', kind: 'text', derived: true },
  { key: 'program_name', header: 'Program Name', owner: true, group: 'program', visible: true, kind: 'text', derived: true },
  { key: 'support_provided', header: 'Support provided', owner: true, group: 'program', kind: 'text', derived: true },
  { key: 'startup_type', header: 'Startup type', owner: true, group: 'classification', kind: 'text' },
  { key: 'hint', header: 'Hint', owner: true, group: 'startup', kind: 'long', managerOnly: true },
  { key: 'sector', header: 'Sector', owner: true, group: 'classification', sort: 'sector', visible: true, kind: 'text' },
  { key: 'sub_sector', header: 'Sub sector', owner: true, group: 'classification', kind: 'text' },
  { key: 'description', header: 'Description', owner: true, group: 'startup', kind: 'long' },
  { key: 'stage', header: 'Stage', owner: true, group: 'classification', sort: 'stage', visible: true, kind: 'text' },
  { key: 'governerate', header: 'Governerate', owner: true, group: 'location', visible: true, kind: 'governorate', derived: true },
  { key: 'established', header: 'Date of company established', owner: true, group: 'startup', sort: 'established', kind: 'date' },
  { key: 'app', header: 'App', owner: true, group: 'online', kind: 'link' },
  { key: 'website', header: 'Website', owner: true, group: 'online', kind: 'link' },
  { key: 'social_media', header: 'Social media', owner: true, group: 'online', kind: 'long' },
  { key: 'traction', header: 'Traction/Validation', owner: true, group: 'metrics', kind: 'long' },
  { key: 'ceo_name', header: 'CEO Name', owner: true, group: 'people', visible: true, kind: 'text' },
  { key: 'phone', header: 'Phone', owner: true, group: 'people', kind: 'ltr' },
  { key: 'email', header: 'Email', owner: true, group: 'people', kind: 'ltr' },
  { key: 'national_id', header: 'ID', owner: true, group: 'people', kind: 'national_id', managerOnly: true, sensitive: true },
  { key: 'ceo_age', header: 'CEO Age', owner: true, group: 'people', sort: 'age', visible: true, kind: 'number', derived: true },
  { key: 'age_category', header: 'Age Category', owner: true, group: 'people', kind: 'text', derived: true },
  { key: 'student_graduate', header: 'Student/Graduate', owner: true, group: 'people', kind: 'text' },
  { key: 'ceo_gender', header: 'CEO Gender', owner: true, group: 'people', visible: true, kind: 'text', derived: true },
  { key: 'open_closed', header: 'Open/Closed', owner: true, group: 'status', visible: true, kind: 'status' },
  { key: 'reason_for_closing', header: 'Reason for closing', owner: true, group: 'status', kind: 'long' },
  { key: 'after_closing', header: 'After closing', owner: true, group: 'status', kind: 'text' },
  { key: 'legal_status', header: 'Legal Status', owner: true, group: 'classification', kind: 'text' },
  { key: 'founding_team_size', header: 'Founding team size', owner: true, group: 'team', kind: 'number', derived: true },
  { key: 'female_founders', header: 'Female founders', owner: true, group: 'team', kind: 'number', derived: true },
  { key: 'founders_below_35', header: 'Nu. of founders below 35', owner: true, group: 'team', kind: 'number', derived: true },
  { key: 'employees', header: 'Nu. of employees', owner: true, group: 'metrics', sort: 'employees', visible: true, kind: 'number' },
  { key: 'female_employees', header: 'Nu. of female employees', owner: true, group: 'metrics', kind: 'number' },
  { key: 'freelancers', header: 'Number of freelancers', owner: true, group: 'metrics', kind: 'number' },
  { key: 'funding_raised', header: 'Funding raised', owner: true, group: 'metrics', sort: 'funding', kind: 'money' },
  { key: 'revenue', header: 'Revenue (<year>) (Total)', owner: true, group: 'metrics', sort: 'revenue', visible: true, kind: 'money' },
  { key: 'challenges', header: 'Challenges', owner: true, group: 'metrics', kind: 'long' },
  { key: 'needs', header: 'Needs', owner: true, group: 'metrics', kind: 'long' },
  // not in the owner's sheet: what a manager needs on screen
  { key: 'company_location', header: 'Company location', group: 'location', kind: 'text', extra: true },
  { key: 'completeness', header: 'Profile completeness', group: 'status', sort: 'completeness', kind: 'completeness', extra: true, visible: true },
  { key: 'alumni', header: 'Alumni', group: 'status', kind: 'flag', extra: true },
  { key: 'visibility', header: 'Directory visibility', group: 'status', kind: 'text', extra: true },
  { key: 'reviewed', header: 'Review', group: 'status', kind: 'review', extra: true },
  { key: 'updated', header: 'Last updated', group: 'status', sort: 'updated', kind: 'date', extra: true },
])

export const COLUMN_KEYS = Object.freeze(COLUMNS.map((c) => c.key))
export const OWNER_COLUMNS = Object.freeze(COLUMNS.filter((c) => c.owner))
export const DEFAULT_COLUMNS = Object.freeze(COLUMNS.filter((c) => c.visible).map((c) => c.key))
const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]))
export const columnOf = (key) => BY_KEY.get(key)

/** The header text of a column for a given export year (the owner's revenue header carries the year). */
export function columnHeader(col, year) {
  return col.key === 'revenue' && year ? `Revenue (${year}) (Total)` : col.header
}

/** Keep only known keys, in the owner's order; an empty / invalid list falls back to the defaults. */
export function normalizeColumns(keys) {
  const set = new Set(Array.isArray(keys) ? keys : [])
  const list = COLUMN_KEYS.filter((k) => set.has(k))
  return list.length ? list : [...DEFAULT_COLUMNS]
}

const text = (v) => (v === null || v === undefined ? '' : String(v))
const nameOf = (o, lang) => {
  const en = text(o?.name_en).trim()
  const ar = text(o?.name_ar).trim()
  return (lang === 'ar' ? ar || en : en || ar) || ''
}
const joinNames = (list, lang) => [...new Set((list ?? []).map((x) => nameOf(x, lang)).filter(Boolean))].join('; ')

/** The governorate the owner's Excel column "Governerate" carries: the CEO's governorate FROM THE ID, else the company's typed one, else the legacy text. `source` says which. */
export function governorateOf(row, lookups, lang) {
  const ceoCode = row?.ceo?.governorate
  if (ceoCode !== null && ceoCode !== undefined) return { text: lookupLabel(lookups, 'governorate', ceoCode, lang), source: 'id', code: ceoCode }
  const own = row?.governorate
  if (own !== null && own !== undefined) return { text: lookupLabel(lookups, 'governorate', own, lang), source: 'company', code: own }
  const legacy = lang === 'ar' ? row?.legacy?.governorate_ar || row?.legacy?.governorate_en : row?.legacy?.governorate_en || row?.legacy?.governorate_ar
  return { text: text(legacy), source: legacy ? 'legacy' : null, code: null }
}

/**
 * The plain text of one cell (the table renders richer cells for some kinds, this is the text behind them: tests, tooltips, copy).
 * `env` = `{ lookups, lang, num(v), money(v), date(v) }` (the formatters come from the page).
 */
export function cellText(row, key, env) {
  const { lookups, lang } = env
  const L = (kind, k) => (k === null || k === undefined || k === '' ? '' : lookupLabel(lookups, kind, k, lang))
  const num = (v) => (v === null || v === undefined ? '' : env.num ? env.num(v) : String(v))
  const money = (v) => (v === null || v === undefined ? '' : env.money ? env.money(v) : String(v))
  const date = (v) => (v ? (env.date ? env.date(v) : String(v)) : '')
  const m = row?.metrics ?? {}
  const ceo = row?.ceo ?? null
  switch (key) {
    case 'startup_name': return nameOf(row, lang)
    case 'program_scope': return joinNames(row?.programs, lang)
    case 'program_name': return joinNames(row?.projects, lang)
    case 'support_provided': return (row?.support ?? []).map((k) => L('support_kind', k)).join('; ')
    case 'startup_type': return L('startup_type', row?.startup_type)
    case 'hint': return text(row?.hint)
    case 'sector': return L('sector', row?.sector) || (lang === 'ar' ? text(row?.legacy?.industry_ar || row?.legacy?.industry_en) : text(row?.legacy?.industry_en || row?.legacy?.industry_ar))
    case 'sub_sector': return L('subsector', row?.subsector)
    case 'description': return lang === 'ar' ? text(row?.description_ar || row?.description_en) : text(row?.description_en || row?.description_ar)
    case 'stage': return L('stage', row?.stage)
    case 'governerate': return governorateOf(row, lookups, lang).text
    case 'company_location': return L('governorate', row?.governorate) || text(lang === 'ar' ? row?.legacy?.governorate_ar || row?.legacy?.governorate_en : row?.legacy?.governorate_en || row?.legacy?.governorate_ar)
    case 'established': return row?.established_on ? date(row.established_on) : row?.founding_year ? String(row.founding_year) : ''
    case 'app': return text(row?.app_url)
    case 'website': return text(row?.website_url)
    case 'social_media': return (row?.social ?? []).map((s) => `${s.kind}: ${s.url}`).join('; ')
    case 'traction': return text(row?.traction)
    case 'ceo_name': return ceo ? nameOf(ceo, lang) : ''
    case 'phone': return text(ceo?.phone)
    case 'email': return text(ceo?.email)
    case 'national_id': return text(ceo?.id_masked)
    case 'ceo_age': return num(ceo?.age)
    case 'age_category': return L('age_category', ceo?.age_category)
    case 'student_graduate': return L('education_status', ceo?.education_status)
    case 'ceo_gender': return L('gender', ceo?.gender)
    case 'open_closed': return L('operating_status', row?.operating_status)
    case 'reason_for_closing': return [L('closing_reason', row?.closing_reason), text(row?.closing_note)].filter(Boolean).join(' - ')
    case 'after_closing': return L('after_closing', row?.after_closing)
    case 'legal_status': return L('legal_status', row?.legal_status)
    case 'founding_team_size': return num(row?.team?.size)
    case 'female_founders': return num(row?.team?.female_founders)
    case 'founders_below_35': return num(row?.team?.under_35)
    case 'employees': return num(m.employees_total)
    case 'female_employees': return num(m.employees_female)
    case 'freelancers': return num(m.freelancers)
    case 'funding_raised': return money(m.funding_raised_total)
    case 'revenue': return money(m.revenue_total)
    case 'challenges': return text(m.challenges)
    case 'needs': return text(m.needs)
    case 'completeness': return row?.completeness ? `${row.completeness.percent}%` : ''
    case 'alumni': return row?.is_alumni ? 'yes' : 'no'
    case 'visibility': return L('directory_visibility', row?.directory_visibility)
    case 'reviewed': return reviewState(row)
    case 'updated': return date(row?.updated_at)
    default: return ''
  }
}

/** 'never' | 'current' | 'changed': a manager's review stamp older than the last change of the company means it changed since (design 09 section 8). */
export function reviewState(row) {
  if (!row?.reviewed_at) return 'never'
  return new Date(row.reviewed_at).getTime() >= new Date(row.updated_at).getTime() ? 'current' : 'changed'
}
