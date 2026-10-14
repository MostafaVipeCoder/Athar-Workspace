import { describe, expect, it } from 'vitest'
import { cairoToday, nationalIdProblem, nationalIdProgress, normalizeNationalId } from './nationalId.js'

// the codes of list_alumni_lookups().governorates (28 incl. 88 = born abroad)
const CODES = [1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 34, 35, 88]
const TODAY = '2026-10-14'
const opts = { today: TODAY, governorateCodes: CODES }
const reason = (id, o = opts) => nationalIdProblem(id, o)

describe('normalizeNationalId (the same clean-up as app_private.id_normalize)', () => {
  it('Arabic-Indic and Persian digits become ASCII; spaces, dashes, dots and bidi marks are removed', () => {
    expect(normalizeNationalId('٢٩٥٠١٠١٠١٠١٢٣٤')).toBe('29501010101234')
    expect(normalizeNationalId('۲۹۵۰۱۰۱۰۱۰۱۲۳۴')).toBe('29501010101234')
    expect(normalizeNationalId(' 2 9501-01.01 0123 4 ')).toBe('29501010101234')
    expect(normalizeNationalId('‏29501010101234‎')).toBe('29501010101234')
  })
  it('blank is null, anything else is kept (and then fails as "digits")', () => {
    expect(normalizeNationalId('  ')).toBeNull()
    expect(normalizeNationalId(null)).toBeNull()
    expect(normalizeNationalId('2950101010123A')).toBe('2950101010123A')
  })
})

describe('nationalIdProblem: parity with v49 U03 - U13 and the vectors of design 09 appendix A', () => {
  it('valid numbers: both centuries, leap days, born abroad, every listed governorate', () => {
    for (const id of ['29501010101234', '30303152804527', '28802298811171', '30002292999980']) expect(reason(id), id).toBeNull()
    for (const code of CODES) expect(reason(`2950101${String(code).padStart(2, '0')}01234`), String(code)).toBeNull()
  })
  it('the reasons: empty / digits / length / century / date / future / governorate', () => {
    expect(reason('')).toBe('empty')
    expect(reason(null)).toBe('empty')
    expect(reason('2950101010123A')).toBe('digits')
    expect(reason('2950101010123')).toBe('length')
    expect(reason('295010101012345')).toBe('length')
    expect(reason('19501010101234')).toBe('century')
    expect(reason('49501010101234')).toBe('century')
    expect(reason('09501010101234')).toBe('century')
    expect(reason('20002290101230')).toBe('date') // 29 Feb 1900: 1900 is not a leap year
    expect(reason('29513010101234')).toBe('date') // month 13
    expect(reason('29504310101234')).toBe('date') // 31 April
    expect(reason('29501000101234')).toBe('date') // day 00
    expect(reason('29500010101234')).toBe('date') // month 00
    expect(reason('39912310101234')).toBe('future')
    expect(reason('29501010501234')).toBe('governorate') // 05
    for (const c of ['05', '20', '30', '36', '87', '99']) expect(reason(`2950101${c}01234`), c).toBe('governorate')
  })
  it('the rules run in the order of the database (a bad date wins over a bad governorate, the future over the governorate)', () => {
    expect(reason('29513019901234')).toBe('date')
    expect(reason('39912319901234')).toBe('future')
  })
  it('leap years: 2000-02-29 is real, 1900-02-29 and 2001-02-29 are not', () => {
    expect(reason('30002292999980')).toBeNull()
    expect(reason('30102290101230')).toBe('date')
  })
  it('"today" is a parameter: the birth date of today is allowed, tomorrow is not', () => {
    expect(reason('32610140101234', { today: '2026-10-14', governorateCodes: CODES })).toBeNull()
    expect(reason('32610150101234', { today: '2026-10-14', governorateCodes: CODES })).toBe('future')
  })
  it('without the governorate list the governorate is left to the server', () => {
    expect(reason('29501010501234', { today: TODAY })).toBeNull()
  })
  it('accepts Arabic-Indic digits and separators like the database does', () => {
    expect(reason('٢٩٥٠١٠١٠١٠١٢٣٤')).toBeNull()
    expect(reason('2950-1010-1012-34')).toBeNull()
  })
})

describe('cairoToday', () => {
  it('is the date in Cairo, not in UTC', () => {
    expect(cairoToday(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15') // 02:30 the next day in Cairo (UTC+3 in October)
    expect(cairoToday(new Date('2026-01-14T21:30:00Z'))).toBe('2026-01-14') // 23:30 in Cairo (UTC+2 in winter)
  })
})

describe('nationalIdProgress (feedback while typing)', () => {
  it('blank and unfinished numbers are neutral', () => {
    expect(nationalIdProgress('')).toMatchObject({ problem: null, complete: false, blank: true })
    expect(nationalIdProgress('2950', opts)).toMatchObject({ problem: null, complete: false, blank: false })
    expect(nationalIdProgress('2950101', opts)).toMatchObject({ problem: null, complete: false })
  })
  it('the first digit is judged at once', () => {
    expect(nationalIdProgress('1', opts).problem).toBe('century')
    expect(nationalIdProgress('4950', opts).problem).toBe('century')
    expect(nationalIdProgress('2', opts).problem).toBeNull()
  })
  it('the date is judged when its six digits are there; the governorate when its two digits are there', () => {
    expect(nationalIdProgress('2951301', opts).problem).toBe('date')
    expect(nationalIdProgress('2950431', opts).problem).toBe('date')
    expect(nationalIdProgress('3991231', opts).problem).toBe('future')
    expect(nationalIdProgress('295010105', opts).problem).toBe('governorate')
    expect(nationalIdProgress('295010101', opts).problem).toBeNull()
  })
  it('14 digits: the full rule set; more than 14: length', () => {
    expect(nationalIdProgress('29501010101234', opts)).toMatchObject({ problem: null, complete: true })
    expect(nationalIdProgress('29501010501234', opts)).toMatchObject({ problem: 'governorate', complete: false })
    expect(nationalIdProgress('295010101012345', opts)).toMatchObject({ problem: 'length', complete: false })
  })
})
