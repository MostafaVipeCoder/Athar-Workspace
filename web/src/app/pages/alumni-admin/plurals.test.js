import { describe, expect, it } from 'vitest'
import { getMessages, translatePlural } from '../../../i18n/core.js'
import './directory.i18n.js'
import './invitations.i18n.js'
import './workspace.i18n.js'
import './dashboard.i18n.js'
import './opportunities.i18n.js'

/** Every message that puts a COUNT before a noun is a plural object (review of 2026-10-14: "1 companies", Arabic "3 شركة"). */
const KEYS = [
  'alumni.admin.dir.markConfirmTitle', 'alumni.admin.dir.unmarkConfirmTitle', 'alumni.admin.dir.exportBody', 'alumni.admin.dir.exportRun',
  'alumni.admin.inv.createBulk', 'alumni.admin.ws.saveAll', 'alumni.admin.dash.kpiProgramsHint', 'alumni.admin.dash.kpiCompletenessHint', 'alumni.admin.opp.deleteBody',
]
const tn = (lang, key, n) => translatePlural(lang, key, n)

describe('count agreement in the manager texts', () => {
  it('every key is a plural object in both languages, and Arabic has the six CLDR categories', () => {
    for (const key of KEYS) {
      expect(typeof getMessages('en')[key], key).toBe('object')
      expect(getMessages('en')[key].one, key).toBeTruthy()
      expect(getMessages('en')[key].other, key).toBeTruthy()
      for (const cat of ['zero', 'one', 'two', 'few', 'many', 'other']) expect(typeof getMessages('ar')[key][cat], `${key}.${cat}`).toBe('string')
    }
  })

  it('English: "1 company", "2 companies"', () => {
    expect(tn('en', 'alumni.admin.dir.exportRun', 1)).toBe('Export 1 company')
    expect(tn('en', 'alumni.admin.dir.exportRun', 3)).toBe('Export 3 companies')
    expect(tn('en', 'alumni.admin.dir.markConfirmTitle', 1)).toBe('Mark 1 company as alumni?')
    expect(tn('en', 'alumni.admin.inv.createBulk', 1)).toBe('Create 1 invitation')
    expect(tn('en', 'alumni.admin.ws.saveAll', 1)).toBe('Save 1 changed row')
    expect(tn('en', 'alumni.admin.opp.deleteBody', 1)).toContain('its 1 application.')
    expect(tn('en', 'alumni.admin.dash.kpiCompletenessHint', 1)).toBe('1 incomplete profile')
  })

  it('Arabic: one / two / few (3-10) / many (11+) agree with the noun, digits stay Western', () => {
    expect(tn('ar', 'alumni.admin.dir.exportRun', 1)).toBe('تصدير شركة واحدة')
    expect(tn('ar', 'alumni.admin.dir.exportRun', 2)).toBe('تصدير شركتين')
    expect(tn('ar', 'alumni.admin.dir.exportRun', 3)).toBe('تصدير 3 شركات')
    expect(tn('ar', 'alumni.admin.dir.exportRun', 11)).toBe('تصدير 11 شركة')
    expect(tn('ar', 'alumni.admin.ws.saveAll', 3)).toBe('حفظ 3 صفوف تغيّرت')
    expect(tn('ar', 'alumni.admin.ws.saveAll', 12)).toBe('حفظ 12 صفاً تغيّر')
    expect(tn('ar', 'alumni.admin.dir.exportBody', 3)).toContain('لعدد 3 شركات مطابقة')
    expect(tn('ar', 'alumni.admin.dir.exportBody', 12)).toContain('لعدد 12 شركة مطابقة')
    expect(tn('ar', 'alumni.admin.dir.markConfirmTitle', 2)).toBe('تصنيف شركتين كخريجتين؟')
  })

  it('no manager dictionary carries Arabic-Indic digits (the numbers formatted by Intl are Western, one screen must not mix the two)', () => {
    const re = new RegExp('[' + String.fromCharCode(0x660) + '-' + String.fromCharCode(0x669) + ']')
    const bad = Object.entries(getMessages('ar')).filter(([k, v]) => k.startsWith('alumni.admin.') && re.test(JSON.stringify(v))).map(([k]) => k)
    expect(bad).toEqual([])
  })
})
