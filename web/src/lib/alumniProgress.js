/**
 * Pure logic of the founder Progress page (design 09 F6, F9). The graphs of the figures are quarterly now: lib/alumniQuarters.js. Real data only: every number comes from the Alumni profile payloads,
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
