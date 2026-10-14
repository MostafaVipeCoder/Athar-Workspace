/**
 * Pure helpers of the founder notifications and opportunities pages (design 09 F7 / F8).
 */
import { isUuid } from './links.js'
import { cairoToday } from './nationalId.js'

/** Only http(s) addresses are ever rendered as links (an opportunity / notification link is data typed by a manager). */
export const safeHttpUrl = (url) => (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null)

/**
 * Where a notification leads. A manager's notification may carry, in `metadata`: `link` / `url` (an in-app path starting with a single "/", or an http(s)
 * address), `opportunity_id`, `project_id`. Returns `{ kind: 'internal', to }`, `{ kind: 'external', href }` or null (a plain message).
 */
export function notificationTarget(notification) {
  const m = notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {}
  const raw = [m.link, m.url].find((v) => typeof v === 'string' && v.trim())
  if (raw) {
    const s = raw.trim()
    if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) return { kind: 'internal', to: s }
    const href = safeHttpUrl(s)
    if (href) return { kind: 'external', href }
  }
  if (isUuid(m.opportunity_id)) return { kind: 'internal', to: `/alumni/founder/opportunities?open=${m.opportunity_id}` }
  if (isUuid(m.project_id)) return { kind: 'internal', to: `/alumni/founder/programs/${m.project_id}` }
  return null
}

/**
 * The text of a notification in the language the founder is reading now. A broadcast keeps BOTH languages in its metadata (title_en / title_ar / body_en / body_ar) next to the one text
 * the server chose at send time (the recipient's profile language): the page shows the viewing language, then the stored text. Always plain text.
 */
export function notificationText(notification, lang) {
  const m = notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {}
  const pick = (key, stored) => (typeof m[`${key}_${lang}`] === 'string' && m[`${key}_${lang}`].trim() ? m[`${key}_${lang}`].trim() : stored ?? '')
  return { title: pick('title', notification?.title), body: pick('body', notification?.body) }
}

/** Opportunity kinds the page filters by (the table has no check constraint: an unknown type is shown as "Other"). */
export const OPPORTUNITY_TYPES = Object.freeze(['grant', 'investment', 'competition', 'event', 'partnership'])
export const opportunityType = (type) => (OPPORTUNITY_TYPES.includes(type) ? type : 'other')

/** Whole days from `today` ('YYYY-MM-DD') to the deadline (negative = passed); null without a deadline. */
export function daysLeft(deadline, today = cairoToday()) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}/.test(String(deadline))) return null
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  const d = String(deadline).slice(0, 10)
  const b = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

/** 'expired' (deadline passed: the server refuses an application), 'closing' (within a week), 'open' (a deadline later or none). */
export function opportunityState(opportunity, today = cairoToday()) {
  const left = daysLeft(opportunity?.deadline, today)
  if (left === null) return 'open'
  if (left < 0) return 'expired'
  return left <= 7 ? 'closing' : 'open'
}

/**
 * Filter + order the opportunities: by type, by free text (title / description in both languages), by the founder's own applications (`applied` = Set of opportunity ids),
 * and `state` ('open' = not expired, 'applied', 'all'). Order: open ones by nearest deadline (no deadline last), then expired ones.
 */
export function filterOpportunities(list, { type = 'all', q = '', state = 'open', applied = new Set(), today = cairoToday() } = {}) {
  const needle = String(q ?? '').trim().toLowerCase()
  const rows = (Array.isArray(list) ? list : []).filter((o) => {
    if (type !== 'all' && opportunityType(o.type) !== type) return false
    if (state === 'applied' && !applied.has(o.opportunity_id)) return false
    if (state === 'open' && opportunityState(o, today) === 'expired') return false
    if (needle) {
      const hay = [o.title_en, o.title_ar, o.description_en, o.description_ar, o.eligibility].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
  const rank = (o) => (opportunityState(o, today) === 'expired' ? 1 : 0)
  return rows.sort((a, b) => rank(a) - rank(b) || (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31') || (a.order_index ?? 0) - (b.order_index ?? 0))
}

/** Tone of an application status; unknown statuses (a manager may type any) are neutral. */
export const statusTone = (status) => ({ applied: 'blue', under_review: 'amber', shortlisted: 'amber', accepted: 'green', rejected: 'red', withdrawn: 'neutral' }[status] ?? 'neutral')

// the unread badge text lives in lib/badge.js (no imports: the shell must not pull this module); re-exported for the callers that already import it from here
export { badgeCount } from './badge.js'
