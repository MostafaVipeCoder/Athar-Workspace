import { describe, expect, it } from 'vitest'
import { getMessages, translatePlural } from '../../../i18n/core.js'
import './quarters.i18n.js'
import '../../../shared/alumni/i18n.quarters.js'

/** Every count of the quarter pages agrees with its noun (review of 2026-10-15: "قبل الإغلاق بـ 3 يوماً", "1 notifications, 1 e-mails queued"). */
const P = 'alumni.admin.qs.'
const KEYS = ['ofTotal', 'closeAllDone', 'closeAllAlready', 'reopenAllDone', 'foundersCell', 'pv.noEmail', 'pv.more', 'sentNotifs', 'sentMails', 'sch.dueRow', 'pf.corrected']
const tn = (lang, key, n, v) => translatePlural(lang, P + key, n, v)

describe('count agreement in the quarter pages', () => {
  it('every counted message is a plural object in both languages; Arabic has the six CLDR categories', () => {
    for (const key of KEYS) {
      const en = getMessages('en')[P + key]
      const ar = getMessages('ar')[P + key]
      expect(typeof en, key).toBe('object')
      expect(en.one && en.other, key).toBeTruthy()
      if (typeof ar === 'string') continue          // a neutral Arabic sentence needs no plural (foundersCell)
      for (const cat of ['zero', 'one', 'two', 'few', 'many', 'other']) expect(typeof ar[cat], `${key}.${cat}`).toBe('string')
    }
  })

  it('English: 1 is singular, 2 and more plural', () => {
    expect(tn('en', 'sentNotifs', 1)).toBe('1 notification')
    expect(tn('en', 'sentMails', 1)).toBe('1 e-mail queued')
    expect(tn('en', 'sentMails', 2)).toBe('2 e-mails queued')
    expect(tn('en', 'sch.dueRow', 1, { when: 'X' })).toBe('1 day before the close: X')
    expect(tn('en', 'sch.dueRow', 3, { when: 'X' })).toBe('3 days before the close: X')
    expect(tn('en', 'reopenAllDone', 1)).toBe('Reopened for 1 company')
    expect(tn('en', 'pv.noEmail', 1)).toContain('1 founder has no usable e-mail')
    expect(tn('en', 'foundersCell', 1, { acc: 1 })).toBe('1 of 1 has an account')
    expect(tn('en', 'foundersCell', 3, { acc: 2 })).toBe('2 of 3 have an account')
    expect(tn('en', 'closeAllAlready', 1)).toBe('1 was already closed')
  })

  it('Arabic days: 1 يوم واحد, 2 يومين, 3-10 أيام, 11+ يوماً', () => {
    const row = (n) => tn('ar', 'sch.dueRow', n, { when: 'X' })
    expect(row(1)).toBe('قبل الإغلاق بيوم واحد: X')
    expect(row(2)).toBe('قبل الإغلاق بيومين: X')
    expect(row(3)).toBe('قبل الإغلاق بـ 3 أيام: X')
    expect(row(10)).toBe('قبل الإغلاق بـ 10 أيام: X')
    expect(row(11)).toBe('قبل الإغلاق بـ 11 يوماً: X')
    expect(row(14)).toBe('قبل الإغلاق بـ 14 يوماً: X')
  })

  it('Arabic companies / founders / notifications agree at 1, 2, 3, 10 and 11', () => {
    expect(tn('ar', 'reopenAllDone', 1)).toBe('أُعيد فتح شركة واحدة')
    expect(tn('ar', 'reopenAllDone', 2)).toBe('أُعيد فتح شركتين')
    expect(tn('ar', 'reopenAllDone', 3)).toBe('أُعيد فتح 3 شركات')
    expect(tn('ar', 'reopenAllDone', 10)).toBe('أُعيد فتح 10 شركات')
    expect(tn('ar', 'reopenAllDone', 11)).toBe('أُعيد فتح 11 شركة')
    expect(tn('ar', 'pv.noEmail', 1)).toContain('مؤسس واحد')
    expect(tn('ar', 'pv.noEmail', 2)).toContain('مؤسسان')
    expect(tn('ar', 'pv.noEmail', 5)).toContain('5 مؤسسين')
    expect(tn('ar', 'pv.noEmail', 12)).toContain('12 مؤسساً')
    expect(tn('ar', 'pv.more', 1)).toBe('... وشخص آخر')
    expect(tn('ar', 'pv.more', 4)).toBe('... و4 أشخاص آخرين')
    expect(tn('ar', 'pv.more', 25)).toBe('... و25 شخصاً آخر')
    expect(tn('ar', 'sentNotifs', 1)).toBe('إشعار واحد')
    expect(tn('ar', 'sentNotifs', 2)).toBe('إشعاران')
    expect(tn('ar', 'sentNotifs', 7)).toBe('7 إشعارات')
    expect(tn('ar', 'sentMails', 1)).toBe('رسالة بريد واحدة في الطابور')
    expect(tn('ar', 'pf.corrected', 2)).toBe('شركتان مصحَّحتان')
    expect(tn('ar', 'pf.corrected', 11)).toBe('11 شركة مصحَّحة')
    expect(tn('ar', 'closeAllAlready', 1)).toBe('وشركة واحدة كانت مُغلقة')
  })

  it('the founders cell never prints "1 من 1 لديهم" any more', () => {
    expect(tn('ar', 'foundersCell', 1, { acc: 1 })).toBe('أصحاب الحسابات: 1 من 1')
  })

  it('no Arabic sentence of these pages joins "لـ" to a quarter label that starts with the article', () => {
    const bad = Object.entries(getMessages('ar')).filter(([k, v]) => k.startsWith('alumni.') && /لـ \{(quarter|period)\}|بـ \{period\}/.test(JSON.stringify(v))).map(([k]) => k)
    expect(bad).toEqual([])
  })
})
