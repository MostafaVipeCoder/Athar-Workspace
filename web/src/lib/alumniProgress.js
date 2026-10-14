/**
 * Pure logic of the founder Progress page and the yearly trend views (design 09 F6, F9). Real data only: every number comes from the Alumni profile payloads,
 * the Programs list and the certificates the founder holds. Nothing is invented: a milestone is done when the server's own completeness / lists say so.
 */

export const MILESTONE_KEYS = Object.freeze(['account', 'profile', 'company', 'companyProfile', 'annualUpdate', 'program', 'certificate'])

const companiesOf = (profile) => (Array.isArray(profile?.companies) ? profile.companies : [])
const missingOf = (c) => (Array.isArray(c?.completeness?.missing) ? c.completeness.missing : [])

/**
 * The milestones of the founder journey with their state and the place that completes them.
 * `profile` = get_my_alumni_profile(); `programs` = list_my_programs() rows; `certificates` = list_my_certificates() rows.
 * -> [{ key, done, to }] in journey order; `to` is a founder route (an anchor of the page that fixes it).
 */
export function buildMilestones({ profile, programs, certificates }) {
  const companies = companiesOf(profile)
  const firstCompany = companies[0]?.id
  const companyTo = firstCompany ? `/alumni/founder/company/${firstCompany}` : '/alumni/founder/company/new'
  const activePrograms = (Array.isArray(programs) ? programs : []).filter((p) => p?.status !== 'withdrawn')
  const myPercent = Number(profile?.founder?.completeness?.percent)
  return [
    { key: 'account', done: true, to: null },
    { key: 'profile', done: Number.isFinite(myPercent) && myPercent >= 100, to: '/alumni/founder/profile' },
    { key: 'company', done: companies.length > 0, to: '/alumni/founder/company/new' },
    { key: 'companyProfile', done: companies.length > 0 && companies.every((c) => missingOf(c).filter((k) => k !== 'annual_update').length === 0), to: `${companyTo}#basics` },
    { key: 'annualUpdate', done: companies.length > 0 && companies.every((c) => !missingOf(c).includes('annual_update')), to: `${companyTo}#metrics` },
    { key: 'program', done: activePrograms.length > 0, to: '/alumni/founder/programs' },
    { key: 'certificate', done: (Array.isArray(certificates) ? certificates : []).length > 0, to: '/alumni/founder/programs' },
  ]
}

/** Whole-number percent of done milestones. */
export function milestonePercent(milestones) {
  const list = Array.isArray(milestones) ? milestones : []
  if (list.length === 0) return 0
  return Math.round((100 * list.filter((m) => m.done).length) / list.length)
}

/** The first milestone that is not done (the "next step" call to action), or null. */
export const nextMilestone = (milestones) => (Array.isArray(milestones) ? milestones.find((m) => !m.done) ?? null : null)

/**
 * Overall profile completeness: the founder's own meter and each company's meter averaged with equal weight to the number of items they check (founder 4, company 10).
 * Server numbers are percents of those totals, so the combination re-weights them. No companies -> the founder's percent alone.
 */
export function overallCompleteness(profile) {
  const mine = Number(profile?.founder?.completeness?.percent)
  const companies = companiesOf(profile).map((c) => Number(c?.completeness?.percent)).filter(Number.isFinite)
  if (!Number.isFinite(mine) && companies.length === 0) return null
  if (companies.length === 0) return Math.round(mine)
  const total = (Number.isFinite(mine) ? 4 : 0) + 10 * companies.length
  const sum = (Number.isFinite(mine) ? mine * 4 : 0) + companies.reduce((s, p) => s + p * 10, 0)
  return Math.round(sum / total)
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** `[{ year, value }]` of one metric (a key of the yearly row), oldest first, years without a figure dropped. */
export function snapshotSeries(snapshots, key) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .map((s) => ({ year: Number(s?.year), value: num(s?.[key]) }))
    .filter((p) => Number.isFinite(p.year) && p.value !== null)
    .sort((a, b) => a.year - b.year)
}

/** The change of the latest figure against the one before it: `{ year, value, prevYear, prevValue, delta, pct }` (pct null when the previous value is 0), or null with fewer than two points. */
export function lastChange(series) {
  if (!Array.isArray(series) || series.length < 2) return null
  const a = series[series.length - 2]
  const b = series[series.length - 1]
  const delta = b.value - a.value
  return { year: b.year, value: b.value, prevYear: a.year, prevValue: a.value, delta, pct: a.value === 0 ? null : Math.round((100 * delta) / Math.abs(a.value)) }
}

/**
 * Bars of a mini chart: each point gets a height ratio in [0, 1] of the largest value (a zero stays a visible 0-height bar, never a negative one).
 * `max` = the largest value, so the page can print it. Pure geometry; the colours and the markup belong to the component.
 */
export function barRatios(series) {
  const list = Array.isArray(series) ? series : []
  const max = list.reduce((m, p) => Math.max(m, p.value), 0)
  return { max, bars: list.map((p) => ({ ...p, ratio: max > 0 ? Math.max(0, p.value) / max : 0 })) }
}

/** The metrics shown as trends, in display order (key of the yearly row, unit for the formatter). */
export const TREND_METRICS = Object.freeze([
  { key: 'revenue_total', unit: 'money' },
  { key: 'funding_raised_total', unit: 'money' },
  { key: 'employees_total', unit: 'count' },
])

/** Years that carry at least one figure, newest first (what "latest update" means). */
export function reportedYears(snapshots) {
  const keys = ['revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers', 'traction', 'challenges', 'needs']
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter((s) => keys.some((k) => s?.[k] !== null && s?.[k] !== undefined && s?.[k] !== ''))
    .map((s) => Number(s.year))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
}
