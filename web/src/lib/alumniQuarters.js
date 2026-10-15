/**
 * Pure logic of the QUARTERLY figures (owner decision 21, m66-m68): quarter keys ("2026-Q4"), labels, series for the graphs (frozen snapshots ONLY), the status of a
 * company's figures, the rows of the Excel exports. No React, no network. The calendar is the server's: calendar quarters in Africa/Cairo (the server decides when a
 * quarter closes; the client only reads `period_end` / `deadline` from the payloads).
 */

export const PERIOD_RE = /^(\d{4})-Q([1-4])$/

export const isPeriod = (k) => typeof k === 'string' && PERIOD_RE.test(k)

/** "2026-Q4" -> { year: 2026, quarter: 4 } | null */
export function parsePeriod(key) {
  const m = PERIOD_RE.exec(String(key ?? ''))
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null
}

export const periodIndex = (key) => { const p = parsePeriod(key); return p ? p.year * 4 + p.quarter - 1 : null }
export const periodFromIndex = (i) => (Number.isInteger(i) && i >= 0 ? `${Math.floor(i / 4)}-Q${(i % 4) + 1}` : null)
export const nextPeriod = (key) => { const i = periodIndex(key); return i === null ? null : periodFromIndex(i + 1) }
export const prevPeriod = (key) => { const i = periodIndex(key); return i === null ? null : periodFromIndex(i - 1) }
export const comparePeriods = (a, b) => (periodIndex(a) ?? -1) - (periodIndex(b) ?? -1)

/** Every quarter from `from` to `to` inclusive (a continuous axis). */
export function periodRange(from, to) {
  const a = periodIndex(from)
  const b = periodIndex(to)
  if (a === null || b === null || b < a || b - a > 80) return []
  return Array.from({ length: b - a + 1 }, (_, i) => periodFromIndex(a + i))
}

const AR_Q = ['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع']
/** "Q4 2026" / "الربع الرابع 2026" (Western digits, owner decision OD-12). */
export function periodLabel(key, lang = 'en') {
  const p = parsePeriod(key)
  if (!p) return String(key ?? '')
  return lang === 'ar' ? `${AR_Q[p.quarter - 1]} ${p.year}` : `Q${p.quarter} ${p.year}`
}
/** Short axis label: "Q4 '26" / "ر4 26". */
export function periodShort(key, lang = 'en') {
  const p = parsePeriod(key)
  if (!p) return String(key ?? '')
  const yy = String(p.year).slice(-2)
  return lang === 'ar' ? `ر${p.quarter} ${yy}` : `Q${p.quarter} '${yy}`
}

// ------------------------------------------------------------------ status of the figures of one quarter
export const FIGURE_STATUSES = Object.freeze(['confirmed', 'updated', 'not_updated', 'closed'])
const TONES = { confirmed: 'green', updated: 'amber', not_updated: 'red', closed: 'blue' }
export const statusTone = (s) => TONES[s] ?? 'outline'
/** The founder still owes this quarter's figures: the banner shows. */
export const needsUpdate = (status) => status === 'updated' || status === 'not_updated'

/** Whole days from `now` to the end of `deadline` (a 'YYYY-MM-DD' day, the last day of the quarter, inclusive). null when unknown. */
export function daysLeft(deadline, now = new Date()) {
  if (!deadline) return null
  const d = new Date(`${String(deadline).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - today) / 86400000) + 1
}

// ------------------------------------------------------------------ the metrics of the graphs
/** kind: flow (the quarter's own value), stock (value at the quarter's end), cumulative (total so far). */
export const METRICS = Object.freeze([
  { key: 'revenue_total', unit: 'money', kind: 'flow', chart: 'bar' },
  { key: 'employees_total', unit: 'count', kind: 'stock', chart: 'line' },
  { key: 'funding_raised_total', unit: 'money', kind: 'cumulative', chart: 'line' },
])

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * The points of ONE metric over the quarters of a company, oldest first, on a CONTINUOUS axis (a quarter without a reported value has `value: null` = a gap, never a zero).
 * `snapshots` = the payload's frozen quarters (any order). Only REPORTED snapshots carry a value: a carried-forward number is not a data point.
 * -> [{ key, value, reported, corrected, previous (the original frozen value when corrected, else null), status }]
 */
export function quarterSeries(snapshots, metric) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter((s) => isPeriod(s?.period_key))
  if (list.length === 0) return []
  const byKey = new Map(list.map((s) => [s.period_key, s]))
  const keys = list.map((s) => s.period_key).sort(comparePeriods)
  return periodRange(keys[0], keys[keys.length - 1]).map((key) => {
    const s = byKey.get(key)
    const reported = Boolean(s?.reported)
    const value = reported ? num(s?.[metric]) : null
    const prev = s?.previous_values && Object.prototype.hasOwnProperty.call(s.previous_values, metric) ? num(s.previous_values[metric]) : null
    return { key, value, reported, corrected: Boolean(s?.corrected), previous: prev, status: s?.status ?? null, exists: Boolean(s) }
  })
}

/** Change of the latest point against the previous point that has a value: { key, value, prevKey, prevValue, delta, pct } or null. */
export function lastChange(points) {
  const withValue = (Array.isArray(points) ? points : []).filter((p) => p.value !== null)
  if (withValue.length < 2) return null
  const a = withValue[withValue.length - 2]
  const b = withValue[withValue.length - 1]
  const delta = b.value - a.value
  return { key: b.key, value: b.value, prevKey: a.key, prevValue: a.value, delta, pct: a.value === 0 ? null : roundPct((100 * delta) / Math.abs(a.value)) }
}

/** A change in percent: whole numbers from 10, one decimal below 10 and between 99.5 and 100; never "100%" for a change that is not exactly 100% (a 99.6% drop is -99.6%, not -100%). */
export function roundPct(raw) {
  const a = Math.abs(raw)
  const p = a < 10 || (a > 99.5 && a < 100) ? Math.round(raw * 10) / 10 : Math.round(raw)
  return Math.abs(p) === 100 && Math.abs(raw) !== 100 ? Math.sign(raw) * 99.9 : p
}

/** A nice upper bound for an axis (1, 2, 2.5, 5 x 10^n). */
export function niceMax(max) {
  if (!Number.isFinite(max) || max <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(max))
  const f = max / exp
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return step * exp
}

/**
 * The ticks of an axis from 0: a 1 / 2 / 5 x 10^n step (whole numbers for counts and money: `integer`), at most about `count` of them, so a label is never repeated or fractional (6.3, 12.5).
 * -> { max, step, ticks }
 */
export function niceTicks(rawMax, { count = 4, integer = false } = {}) {
  const top = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 1
  const rough = top / Math.max(1, count)
  const exp = 10 ** Math.floor(Math.log10(rough))
  const f = rough / exp
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp
  if (integer && step < 1) step = 1
  const n = Math.max(1, Math.ceil(top / step - 1e-9))
  const ticks = Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6)
  return { max: ticks[n], step, ticks }
}

/** Compact number for an axis: 1.2K, 3.4M. */
export function compactNumber(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  const a = Math.abs(v)
  const fmt = (x, s) => `${Number.isInteger(x) ? x : Math.round(x * 10) / 10}${s}`
  if (a >= 1e9) return fmt(v / 1e9, 'B')
  if (a >= 1e6) return fmt(v / 1e6, 'M')
  if (a >= 1e3) return fmt(v / 1e3, 'K')
  return String(Math.round(v * 10) / 10)
}

// ------------------------------------------------------------------ portfolio (get_alumni_portfolio)
export const PORTFOLIO_METRICS = Object.freeze([
  { key: 'revenue_total', unit: 'money', chart: 'bar' },
  { key: 'revenue_median', unit: 'money', chart: 'bar' },
  { key: 'employees_total', unit: 'count', chart: 'line' },
  { key: 'female_share', unit: 'percent', chart: 'line' },
  { key: 'survival_rate', unit: 'percent', chart: 'line' },
  { key: 'closing_rate', unit: 'percent', chart: 'line' },
  { key: 'funding_total', unit: 'money', chart: 'line' },
])

/** The points of one portfolio metric: [{ key, value, reported (companies reporting), corrected }] on the server's continuous axis. */
export function portfolioSeries(periods, metric) {
  return (Array.isArray(periods) ? periods : []).map((p) => ({ key: p.period_key, value: num(p[metric]), reported: (p.reporting ?? 0) > 0 || metric === 'survival_rate' || metric === 'closing_rate', corrected: (p.corrected ?? 0) > 0, previous: null }))
}

/** The 2-D array of the portfolio Excel sheet (header + one row per quarter). `labels` = the translated column titles keyed by metric. */
export function portfolioSheetRows(periods, labels) {
  const cols = ['period_key', 'companies', 'reporting', 'revenue_total', 'revenue_median', 'employees_total', 'employees_female', 'female_share', 'freelancers', 'funding_total', 'team_size', 'female_founders', 'open', 'closed', 'survival_rate', 'closed_new', 'closing_rate', 'corrected']
  return [cols.map((c) => labels[c] ?? c), ...(Array.isArray(periods) ? periods : []).map((p) => cols.map((c) => (p[c] === undefined ? null : p[c])))]
}

/** The 2-D array of ONE company's closed quarters (oldest first). */
export function companySheetRows(snapshots, labels) {
  const cols = ['period_key', 'reported', 'revenue_total', 'employees_total', 'employees_female', 'freelancers', 'funding_raised_total', 'team_size', 'female_founders', 'operating_status', 'corrected', 'frozen_at']
  const list = [...(Array.isArray(snapshots) ? snapshots : [])].sort((a, b) => comparePeriods(a.period_key, b.period_key))
  return [cols.map((c) => labels[c] ?? c), ...list.map((s) => cols.map((c) => (s[c] === undefined ? null : s[c])))]
}
