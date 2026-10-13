import { describe, it, expect } from 'vitest'
import { isEmail, normalizeEmail, extractEmail, maskEmail, displayName, firstName, cleanPhoneInput, validatePhone, validateEgypt, formatPhone } from './contact.js'
import { buildImagePath, thumbPath, fitWithin, validateImageFile } from './image.js'

describe('e-mail', () => {
  it('validates, normalises, extracts, masks', () => {
    expect(isEmail('A.b@Example.com')).toBe(true)
    expect(isEmail('nope@')).toBe(false)
    expect(normalizeEmail('  A.b@Example.com ')).toBe('a.b@example.com')
    expect(extractEmail('contact: Mona <Mona@X.org>, thanks')).toBe('mona@x.org')
    expect(extractEmail('nothing')).toBeNull()
    expect(maskEmail('mona@x.org')).toBe('m***@x.org')
  })
})

describe('names (07-5 first logical unit)', () => {
  it('keeps compound Arabic/English first names together', () => {
    expect(firstName('Abdel Rahman Ali')).toBe('Abdel Rahman')
    expect(firstName('عبد الله محمد')).toBe('عبد الله')
    expect(firstName('أبو بكر سالم')).toBe('أبو بكر')
    expect(firstName('Mohamed Salah')).toBe('Mohamed')
    expect(firstName('Dr. Mona Fathy')).toBe('Mona')
    expect(firstName('  Mona ')).toBe('Mona')
    expect(firstName('')).toBe('')
    expect(displayName('  Mona   Fathy ')).toBe('Mona Fathy')
  })
})

describe('phones', () => {
  it('cleans input incl. Arabic-Indic digits', () => {
    expect(cleanPhoneInput(' (010) 123-4567 8 ')).toBe('01012345678')
    expect(cleanPhoneInput('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678')
  })
  it('Egypt mobile and landline -> E.164', () => {
    expect(validateEgypt('01012345678')).toMatchObject({ valid: true, sanitized: '+201012345678', type: 'mobile' })
    expect(validateEgypt('+20 10 1234 5678').sanitized).toBe('+201012345678')
    expect(validateEgypt('002010 1234 5678').sanitized).toBe('+201012345678')
    expect(validateEgunk('0223456789')).toMatchObject({ valid: true, type: 'landline', sanitized: '+20223456789' })
    expect(validateEgypt('0191234567')).toMatchObject({ valid: false, errorKey: 'phone.egMobile' })
    expect(validateEgypt('abc')).toMatchObject({ valid: false, errorKey: 'phone.digitsOnly' })
  })
  it('allowed countries drive the rule; empty is valid; general fallback', () => {
    expect(validatePhone('')).toEqual({ valid: true, errorKey: null, sanitized: '' })
    expect(validatePhone('0512345678', ['SA'])).toMatchObject({ valid: true, sanitized: '+966512345678', country: 'SA' })
    expect(validatePhone('0501234567', ['AE']).sanitized).toBe('+971501234567')
    expect(validatePhone('0501234567', ['EG'])).toMatchObject({ valid: true, type: 'landline' }) // Mansoura area code 50
    expect(validatePhone('0591234567', ['EG'])).toMatchObject({ valid: false })
    expect(validatePhone('01012345678')).toMatchObject({ valid: true, country: 'EG' })
    expect(validatePhone('+962791234567', ['JO'])).toMatchObject({ valid: true, sanitized: '+962791234567' })
    expect(validatePhone('12', ['JO'])).toMatchObject({ valid: false, errorKey: 'phone.general' })
    expect(formatPhone('+201012345678')).toBe('+20 10 1234 5678')
    expect(formatPhone('junk')).toBe('junk')
  })
})

describe('image paths', () => {
  it('follows the stage 2b convention', () => {
    expect(buildImagePath('owner', 'cover', 'abc')).toBe('owner/cover/abc.webp')
    expect(thumbPath('owner/cover/abc.webp')).toBe('owner/cover/abc_t.webp')
    expect(thumbPath('')).toBe('')
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 })
    expect(fitWithin(300, 200, 1600)).toEqual({ width: 300, height: 200 })
    expect(validateImageFile({ type: 'image/svg+xml', size: 10 })).toBe('image.type')
    expect(validateImageFile({ type: 'image/png', size: 6 * 1024 * 1024 })).toBe('image.size')
    expect(validateImageFile({ type: 'image/png', size: 10 })).toBeNull()
  })
})

function validateEgunk(v) {
  return validateEgypt(v)
}
