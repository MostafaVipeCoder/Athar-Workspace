import { describe, expect, it } from 'vitest'
import { badgeCount, daysLeft, filterOpportunities, notificationTarget, notificationText, opportunityState, opportunityType, safeHttpUrl, statusTone } from './alumniFounder.js'
import { holdsStaffRole, invitationCompanyName, validateSignupForm } from './alumniSignup.js'

const UUID = '9166121d-5a85-41dd-adda-23dc3276333b'

describe('notificationTarget: where a notification leads', () => {
  it('an in-app path (a single leading slash) is internal', () => {
    expect(notificationTarget({ metadata: { link: '/alumni/founder/company/abc#metrics' } })).toEqual({ kind: 'internal', to: '/alumni/founder/company/abc#metrics' })
    expect(notificationTarget({ metadata: { url: '/alumni/founder/opportunities' } })).toEqual({ kind: 'internal', to: '/alumni/founder/opportunities' })
  })
  it('an https address is external; javascript:, data: and protocol-relative links are never followed', () => {
    expect(notificationTarget({ metadata: { link: 'https://example.com/x' } })).toEqual({ kind: 'external', href: 'https://example.com/x' })
    expect(notificationTarget({ metadata: { link: 'javascript:alert(1)' } })).toBeNull()
    expect(notificationTarget({ metadata: { link: 'data:text/html,x' } })).toBeNull()
    expect(notificationTarget({ metadata: { link: '//evil.example/x' } })).toBeNull()
    expect(notificationTarget({ metadata: { link: '/\\evil.example' } })).toBeNull()
  })
  it('an opportunity or a project id builds the in-app link (ids are checked)', () => {
    expect(notificationTarget({ metadata: { opportunity_id: UUID } })).toEqual({ kind: 'internal', to: `/alumni/founder/opportunities?open=${UUID}` })
    expect(notificationTarget({ metadata: { project_id: UUID } })).toEqual({ kind: 'internal', to: `/alumni/founder/programs/${UUID}` })
    expect(notificationTarget({ metadata: { project_id: '../../x' } })).toBeNull()
  })
  it('a plain message has no target', () => {
    expect(notificationTarget({ metadata: {} })).toBeNull()
    expect(notificationTarget({})).toBeNull()
    expect(notificationTarget(null)).toBeNull()
    expect(notificationTarget({ metadata: 'text' })).toBeNull()
  })
  it('safeHttpUrl', () => {
    expect(safeHttpUrl(' https://a.co/x ')).toBe('https://a.co/x')
    expect(safeHttpUrl('ftp://a.co')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })
})

describe('opportunities', () => {
  const TODAY = '2026-10-14'
  const o = (over = {}) => ({ opportunity_id: 'o1', type: 'grant', title_en: 'Startup Grant', title_ar: 'منحة', description_en: 'cash for pilots', description_ar: null, deadline: null, eligibility: null, order_index: 0, ...over })

  it('days left and state: expired, closing within a week, open', () => {
    expect(daysLeft('2026-10-17', TODAY)).toBe(3)
    expect(daysLeft('2026-10-14', TODAY)).toBe(0)
    expect(daysLeft('2026-10-13', TODAY)).toBe(-1)
    expect(daysLeft(null, TODAY)).toBeNull()
    expect(opportunityState(o({ deadline: '2026-10-13' }), TODAY)).toBe('expired')
    expect(opportunityState(o({ deadline: '2026-10-14' }), TODAY)).toBe('closing') // closes today: still open
    expect(opportunityState(o({ deadline: '2026-10-21' }), TODAY)).toBe('closing')
    expect(opportunityState(o({ deadline: '2026-10-22' }), TODAY)).toBe('open')
    expect(opportunityState(o(), TODAY)).toBe('open')
  })

  it('unknown types are "other"', () => {
    expect(opportunityType('grant')).toBe('grant')
    expect(opportunityType('hackathon')).toBe('other')
  })

  const list = [
    o({ opportunity_id: 'a', title_en: 'Late grant', deadline: '2026-12-01' }),
    o({ opportunity_id: 'b', title_en: 'Soon investment', type: 'investment', deadline: '2026-10-16' }),
    o({ opportunity_id: 'c', title_en: 'No deadline competition', type: 'competition' }),
    o({ opportunity_id: 'd', title_en: 'Old event', type: 'event', deadline: '2026-09-01' }),
  ]
  it('default: open ones, nearest deadline first, no deadline last; expired ones are hidden', () => {
    expect(filterOpportunities(list, { today: TODAY }).map((x) => x.opportunity_id)).toEqual(['b', 'a', 'c'])
  })
  it('"all" keeps expired ones, after the open ones', () => {
    expect(filterOpportunities(list, { today: TODAY, state: 'all' }).map((x) => x.opportunity_id)).toEqual(['b', 'a', 'c', 'd'])
  })
  it('by type, by text (title / description, both languages) and by my applications', () => {
    expect(filterOpportunities(list, { today: TODAY, type: 'investment' }).map((x) => x.opportunity_id)).toEqual(['b'])
    expect(filterOpportunities(list, { today: TODAY, q: 'منحة' }).map((x) => x.opportunity_id).sort()).toEqual(['a', 'b', 'c'])
    expect(filterOpportunities(list, { today: TODAY, q: 'soon' }).map((x) => x.opportunity_id)).toEqual(['b'])
    expect(filterOpportunities(list, { today: TODAY, state: 'applied', applied: new Set(['c', 'd']) }).map((x) => x.opportunity_id)).toEqual(['c', 'd'])
  })
  it('application status tones; unknown statuses are neutral', () => {
    expect(statusTone('accepted')).toBe('green')
    expect(statusTone('rejected')).toBe('red')
    expect(statusTone('something else')).toBe('neutral')
  })
})

describe('notificationText (a broadcast keeps both languages in its metadata)', () => {
  const n = { title: 'عنوان', body: 'نص', metadata: { title_en: ' Review reminder ', title_ar: 'عنوان', body_en: 'Please review.', body_ar: 'نص' } }
  it('shows the language the founder is reading, whatever language the server stored', () => {
    expect(notificationText(n, 'en')).toEqual({ title: 'Review reminder', body: 'Please review.' })
    expect(notificationText(n, 'ar')).toEqual({ title: 'عنوان', body: 'نص' })
  })
  it('falls back to the stored text when the metadata has no text of that language (an older or single-language message)', () => {
    expect(notificationText({ title: 'Only', body: 'Stored', metadata: { title_ar: 'فقط' } }, 'en')).toEqual({ title: 'Only', body: 'Stored' })
    expect(notificationText({ title: 'T', body: 'B', metadata: null }, 'ar')).toEqual({ title: 'T', body: 'B' })
    expect(notificationText({ title: 'T', body: 'B', metadata: { title_en: 42, body_en: '   ' } }, 'en')).toEqual({ title: 'T', body: 'B' })
    expect(notificationText(null, 'en')).toEqual({ title: '', body: '' })
  })
})

describe('badgeCount', () => {
  it('empty for none, the number up to 99, then 99+', () => {
    expect(badgeCount(0)).toBe('')
    expect(badgeCount(undefined)).toBe('')
    expect(badgeCount(null)).toBe('')
    expect(badgeCount(3)).toBe('3')
    expect(badgeCount(99)).toBe('99')
    expect(badgeCount(100)).toBe('99+')
  })
})

describe('sign-up and invitation logic', () => {
  const good = { fullName: 'Nour Hassan', email: 'nour@example.com', password: 'longenough1', confirm: 'longenough1' }
  it('a complete form is valid', () => expect(validateSignupForm(good)).toEqual({}))
  it('every rule gives a translated key', () => {
    expect(validateSignupForm({ ...good, fullName: ' ' }).fullName).toBe('invite.nameRequired')
    expect(validateSignupForm({ ...good, email: '' }).email).toBe('auth.fieldRequired')
    expect(validateSignupForm({ ...good, email: 'not an email' }).email).toBe('alumni.auth.emailInvalid')
    expect(validateSignupForm({ ...good, password: 'short', confirm: 'short' }).password).toBe('invite.passwordShort')
    expect(validateSignupForm({ ...good, confirm: 'different' }).confirm).toBe('invite.passwordMismatch')
  })
  it('a staff session cannot accept a founder invitation (staff and founder are exclusive)', () => {
    expect(holdsStaffRole(['project_manager'])).toBe(true)
    expect(holdsStaffRole(['alumni_manager'])).toBe(true)
    expect(holdsStaffRole(['super_admin'])).toBe(true)
    expect(holdsStaffRole(['founder'])).toBe(false)
    expect(holdsStaffRole([])).toBe(false)
    expect(holdsStaffRole(undefined)).toBe(false)
  })
  it('the invitation names the company in the page language and falls back', () => {
    const inv = { company_name: 'Nile Labs', company_name_en: 'Nile Labs', company_name_ar: 'مختبرات النيل' }
    expect(invitationCompanyName(inv, 'ar')).toBe('مختبرات النيل')
    expect(invitationCompanyName(inv, 'en')).toBe('Nile Labs')
    expect(invitationCompanyName({ company_name: 'Only', company_name_en: null, company_name_ar: null }, 'ar')).toBe('Only')
    expect(invitationCompanyName({ company_name_en: 'En', company_name_ar: '' }, 'ar')).toBe('En')
  })
})
