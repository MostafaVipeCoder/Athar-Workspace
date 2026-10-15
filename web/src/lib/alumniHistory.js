/**
 * Pure logic of the edit history (owner decision 20.4, m60): how a log entry or a replayed state is read and shown. No React, no network.
 *
 * The log is field-level (`alumni_change_log`): one entry = one field of one record, `old_value` -> `new_value`, with who (`actor`), the kind of editor (`source`), when and how many saves
 * were coalesced (`edits`). `list_alumni_history` returns the entries; `alumni_state_as_of` returns a FLAT state map whose keys this module parses:
 *   company.<field> | internal.<field> | year.<YYYY>.<field> | team.<founderId>.<member|role|is_primary> | founder.<founderId>.<field>
 *
 * What is never in the history (the server guarantees it, this module only displays what it gets): a national ID (only "an ID exists": `national_id` true / false), a storage path
 * (`logo_path` / `photo_path` are "a file is set"), a full phone / e-mail / birth date (masked, flagged `redacted`).
 */
import { lookupLabel } from './alumni.js'

const LOOKUP_FIELDS = Object.freeze({
  startup_type: 'startup_type', sector: 'sector', subsector: 'subsector', stage: 'stage', legal_status: 'legal_status', closing_reason: 'closing_reason', after_closing: 'after_closing',
  operating_status: 'operating_status', directory_visibility: 'directory_visibility', education_status: 'education_status', self_gender: 'gender',
})
const BOOL_FIELDS = new Set(['is_alumni', 'directory_hidden', 'has_account', 'is_primary'])
const DATE_FIELDS = new Set(['established_on', 'closed_on'])
const TIMESTAMP_FIELDS = new Set(['deleted_at', 'reviewed_at'])
const MONEY_FIELDS = new Set(['revenue_total', 'funding_raised_total'])
const COUNT_FIELDS = new Set(['employees_total', 'employees_female', 'freelancers'])
const FILE_FIELDS = new Set(['logo_path', 'photo_path'])

/** How a field's value is shown: `{ kind: 'lookup', lookup }`, 'governorate', 'bool', 'date', 'timestamp', 'money', 'count', 'file', 'links', 'member', 'idflag' or 'text'. */
export function fieldKind(field) {
  if (field in LOOKUP_FIELDS) return { kind: 'lookup', lookup: LOOKUP_FIELDS[field] }
  if (field === 'governorate') return { kind: 'governorate' }
  if (BOOL_FIELDS.has(field)) return { kind: 'bool' }
  if (DATE_FIELDS.has(field)) return { kind: 'date' }
  if (TIMESTAMP_FIELDS.has(field)) return { kind: 'timestamp' }
  if (MONEY_FIELDS.has(field)) return { kind: 'money' }
  if (COUNT_FIELDS.has(field)) return { kind: 'count' }
  if (FILE_FIELDS.has(field)) return { kind: 'file' }
  if (field === 'links') return { kind: 'links' }
  if (field === 'member') return { kind: 'member' }
  if (field === 'national_id') return { kind: 'idflag' }
  return { kind: 'text' }
}

/** Nothing there: null, an empty string, an empty list. (`false` and `0` are values.) */
export const isEmptyValue = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)

/**
 * The text of a value for a field, in the viewer's language. `ctx` = `{ lookups, lang, t, formatDate(v, opts), formatNumber(n, opts) }`. Empty -> ''. Never throws on an unexpected shape.
 */
export function formatFieldText(field, value, ctx) {
  if (isEmptyValue(value)) return ''
  const { kind, lookup } = fieldKind(field)
  const { lookups, lang = 'en', t } = ctx
  try {
    switch (kind) {
      case 'lookup': return lookupLabel(lookups, lookup, value, lang)
      case 'governorate': return lookupLabel(lookups, 'governorate', value, lang)
      case 'bool': return value ? t('alumni.edit.yes') : t('alumni.edit.no')
      case 'date': return ctx.formatDate(value, { dateStyle: 'medium' })
      case 'timestamp': return ctx.formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
      case 'money': return ctx.formatNumber(Number(value), { style: 'currency', currency: 'EGP', maximumFractionDigits: 0, currencyDisplay: lang === 'ar' ? 'name' : 'code' })
      case 'count': return ctx.formatNumber(Number(value))
      case 'file': return t('alumni.edit.fileSet')
      case 'links': return (Array.isArray(value) ? value : []).map((l) => `${l?.label || l?.kind || ''}: ${l?.url ?? ''}`.trim()).join('; ')
      case 'member': return typeof value === 'object' && value ? t('alumni.edit.memberAs', { role: value.role ?? '' }) : t('alumni.edit.yes')
      case 'idflag': return value ? t('alumni.edit.idExists') : t('alumni.edit.idNone')
      default: return typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
  } catch {
    return String(value)
  }
}

/**
 * What an entry DID, for its icon / sentence: 'created', 'removed', 'member_added', 'member_removed', 'id_set', 'id_changed', 'id_cleared', 'set' (empty -> value),
 * 'cleared' (value -> empty), 'changed', 'nochange' (a coalesced edit and its revert: the net change is nothing).
 */
export function describeEntry(row) {
  const f = row?.field
  if (f === 'created') return 'created'
  if (f === 'removed') return 'removed'
  if (f === 'member') return isEmptyValue(row.old_value) ? 'member_added' : 'member_removed'
  if (f === 'national_id') return row.old_value === true && row.new_value === true ? 'id_changed' : row.new_value === true ? 'id_set' : 'id_cleared'
  const a = isEmptyValue(row?.old_value)
  const b = isEmptyValue(row?.new_value)
  if (a && !b) return 'set'
  if (!a && b) return 'cleared'
  if (JSON.stringify(row?.old_value ?? null) === JSON.stringify(row?.new_value ?? null)) return 'nochange'
  return 'changed'
}

const dayFormatter = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })

/** `YYYY-MM-DD` of a timestamp in a time zone (the day a group of entries is listed under; Cairo by default). */
export function dayKey(ts, tz = 'Africa/Cairo') {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : dayFormatter(tz).format(d)
}

/**
 * Consecutive entries of ONE save (same request, same editor) form a group, so "a manager changed 4 fields" reads as one line. `rows` are in list order (newest first or oldest first);
 * the group keeps that order. Returns `[{ key, at, actor, source, request_id, rows[] }]`.
 */
export function groupSaves(rows) {
  const groups = []
  for (const r of rows ?? []) {
    const last = groups[groups.length - 1]
    const same = last && r.request_id && last.request_id === r.request_id && (last.actor?.user_id ?? last.actor?.role) === (r.actor?.user_id ?? r.actor?.role) && last.source === r.source
    if (same) last.rows.push(r)
    else groups.push({ key: `${r.request_id ?? 'n'}-${r.id}`, at: r.last_at ?? r.at, actor: r.actor, source: r.source, request_id: r.request_id ?? null, rows: [r] })
  }
  return groups
}

/** The groups under their day: `[{ day, groups[] }]` in the order the days first appear. */
export function groupByDay(groups, tz = 'Africa/Cairo') {
  const days = []
  for (const g of groups) {
    const day = dayKey(g.at, tz)
    const last = days[days.length - 1]
    if (last && last.day === day) last.groups.push(g)
    else days.push({ day, groups: [g] })
  }
  return days
}

/**
 * A flat state key -> `{ scope, field, year?, founderId? }`, or null for a key this module does not know.
 *   company.sector -> { scope:'company', field:'sector' } | internal.hint | year.2024.revenue_total -> { scope:'year', year:2024, field } | team.<id>.role | founder.<id>.phone
 */
export function parseStateKey(key) {
  const p = String(key ?? '').split('.')
  if (p[0] === 'company' && p.length === 2) return { scope: 'company', field: p[1] }
  if (p[0] === 'internal' && p.length === 2) return { scope: 'internal', field: p[1] }
  if (p[0] === 'year' && p.length === 3 && /^\d{4}$/.test(p[1])) return { scope: 'year', year: Number(p[1]), field: p[2] }
  if (p[0] === 'team' && p.length === 3) return { scope: 'team', founderId: p[1], field: p[2] }
  if (p[0] === 'founder' && p.length === 3) return { scope: 'founder', founderId: p[1], field: p[2] }
  return null
}

const COMPANY_ORDER = [
  'name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on', 'startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'governorate', 'location_en', 'location_ar',
  'website_url', 'app_url', 'linkedin_url', 'links', 'operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note', 'directory_visibility', 'is_alumni',
]
const orderOf = (list, f) => {
  const i = list.indexOf(f)
  return i < 0 ? list.length : i
}

/**
 * A replayed state (`fields`) -> a structure for display: `{ company: [{field,value}], internal: [...], years: [{ year, rows: [...] }] (newest first), team: [{ founderId, member, role, is_primary, rows: [...] }] }`.
 * Empty values are not in the map (the server drops them), so every row has a value.
 */
export function groupState(fields) {
  const company = []
  const internal = []
  const years = new Map()
  const team = new Map()
  const person = (id) => {
    if (!team.has(id)) team.set(id, { founderId: id, member: false, role: null, is_primary: false, rows: [] })
    return team.get(id)
  }
  for (const [key, value] of Object.entries(fields ?? {})) {
    const k = parseStateKey(key)
    if (!k) continue
    if (k.scope === 'company') company.push({ field: k.field, value })
    else if (k.scope === 'internal') internal.push({ field: k.field, value })
    else if (k.scope === 'year') {
      if (!years.has(k.year)) years.set(k.year, [])
      years.get(k.year).push({ field: k.field, value })
    } else if (k.scope === 'team') {
      const p = person(k.founderId)
      if (k.field === 'member') p.member = Boolean(value)
      else if (k.field === 'role') p.role = value
      else if (k.field === 'is_primary') p.is_primary = Boolean(value)
    } else if (k.scope === 'founder') person(k.founderId).rows.push({ field: k.field, value })
  }
  company.sort((a, b) => orderOf(COMPANY_ORDER, a.field) - orderOf(COMPANY_ORDER, b.field))
  return {
    company,
    internal,
    years: [...years.entries()].sort((a, b) => b[0] - a[0]).map(([year, rows]) => ({ year, rows })),
    team: [...team.values()].filter((p) => p.member).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
  }
}

/** The `changes` of `alumni_state_diff` -> display rows `{ key, scope, field, year?, founderId?, from, to, kind: 'added' | 'removed' | 'changed' }` (unknown keys are dropped). */
export function diffRows(changes) {
  const out = []
  for (const c of changes ?? []) {
    const k = parseStateKey(c.key)
    if (!k) continue
    const kind = isEmptyValue(c.from) ? 'added' : isEmptyValue(c.to) ? 'removed' : 'changed'
    out.push({ key: c.key, ...k, from: c.from ?? null, to: c.to ?? null, kind })
  }
  return out
}

/** `datetime-local` input value ('2026-10-15T09:30') -> an ISO instant (the browser's time zone), or null for an empty / unparsable value. */
export function localInputToIso(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** An ISO instant -> the `datetime-local` value in the browser's time zone. */
export function isoToLocalInput(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A date-only input ('2026-10-15') -> the START of that day (inclusive lower bound) or the END of it (inclusive upper bound) as an ISO instant. */
export function dayBound(value, edge = 'start') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null
  const d = new Date(`${value}T${edge === 'end' ? '23:59:59.999' : '00:00:00.000'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** The rows of the history export (one line per entry), in the order given. `ctx` as for `formatFieldText` plus `fieldLabel(field)` and `entityLabel(entity_type)`, `roleLabel(role)`, `sourceLabel(source)`. */
export function historyExportRows(rows, ctx) {
  return (rows ?? []).map((r) => ({
    when: r.last_at ?? r.at,
    first: r.at,
    company: ctx.pickName ? ctx.pickName(r.company) : (r.company?.name_en ?? r.company?.name_ar ?? ''),
    person: ctx.pickName ? ctx.pickName(r.founder) : (r.founder?.name_en ?? r.founder?.name_ar ?? ''),
    who: r.actor?.name ?? '',
    role: ctx.roleLabel(r.actor?.role),
    source: ctx.sourceLabel(r.source),
    area: ctx.entityLabel(r.entity_type),
    field: ctx.fieldLabel(r.field),
    year: r.period_key ?? '',
    before: formatFieldText(r.field, r.old_value, ctx),
    after: formatFieldText(r.field, r.new_value, ctx),
    edits: r.edits ?? 1,
    partial: r.redacted ? '*' : '',
    reason: r.reason ?? '',
  }))
}
