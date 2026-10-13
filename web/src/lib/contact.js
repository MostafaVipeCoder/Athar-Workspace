/**
 * Contact helpers (design 06 section 6.3 `people/contact.js` + `phone.js`): e-mail extraction, display/first name
 * (07-5 greeting rule), and phone validation to E.164 following the rules of the old `phoneValidation.js`
 * (docs/04 A-9: sanitise by declared field type, never by key-name substring). Error texts are translation KEYS.
 */

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

export function isEmail(value) {
  const s = String(value ?? '').trim()
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)
}

/** Lower-cased, trimmed e-mail or '' (addresses compare case-insensitively; the DB uses citext). */
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** First e-mail address found inside free text, or null. */
export function extractEmail(text) {
  const m = EMAIL_RE.exec(String(text ?? ''))
  return m ? m[0].trim().toLowerCase() : null
}

/** Mask for display to anonymous callers: a***@domain (03 section 4.4 validate RPC uses the same shape). */
export function maskEmail(value) {
  const s = normalizeEmail(value)
  const at = s.indexOf('@')
  if (at < 1) return s
  return `${s[0]}***${s.slice(at)}`
}

/** Collapse whitespace; '' when empty. */
export function displayName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

// Arabic/English particles that belong to the NEXT unit (07-5: first_name = first logical unit)
const PREFIXES = new Set(['عبد', 'أبو', 'ابو', 'أم', 'ام', 'al', 'el', 'abdel', 'abdul', 'abd', 'abu', 'bin', 'ibn', 'bint', 'de', 'van', 'von', 'da', 'di', 'la', 'le', 'mc', 'mac', 'o', 'd', 'eng', 'dr', 'mr', 'mrs', 'ms', 'م', 'د', 'أ'])

/**
 * First logical unit of a full name: "Abdel Rahman Ali" -> "Abdel Rahman", "عبد الله محمد" -> "عبد الله",
 * "Dr. Mona Fathy" -> "Mona", "Mohamed" -> "Mohamed".
 */
export function firstName(fullName) {
  const parts = displayName(fullName).split(' ').filter(Boolean)
  if (parts.length === 0) return ''
  const norm = (p) => p.replace(/[.,]/g, '').toLowerCase()
  let i = 0
  // leading titles are skipped (Dr., Eng., م., د.)
  while (i < parts.length - 1 && ['dr', 'eng', 'mr', 'mrs', 'ms', 'م', 'د', 'أ'].includes(norm(parts[i]))) i += 1
  const first = parts[i]
  const next = parts[i + 1]
  if (next && (PREFIXES.has(norm(first)) || /^(عبد|أبو|ابو)/.test(first) && first.length <= 4)) return `${first} ${next}`
  return first
}

// ------------------------------------------------------------------ phones (E.164)
export const SUPPORTED_COUNTRIES = [
  { code: 'EG', dialCode: '+20', name: { en: 'Egypt', ar: 'مصر' } },
  { code: 'SA', dialCode: '+966', name: { en: 'Saudi Arabia', ar: 'السعودية' } },
  { code: 'AE', dialCode: '+971', name: { en: 'UAE', ar: 'الإمارات' } },
  { code: 'KW', dialCode: '+965', name: { en: 'Kuwait', ar: 'الكويت' } },
  { code: 'QA', dialCode: '+974', name: { en: 'Qatar', ar: 'قطر' } },
  { code: 'BH', dialCode: '+973', name: { en: 'Bahrain', ar: 'البحرين' } },
  { code: 'OM', dialCode: '+968', name: { en: 'Oman', ar: 'عمان' } },
  { code: 'JO', dialCode: '+962', name: { en: 'Jordan', ar: 'الأردن' } },
]

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

/** Strips spaces, dashes, dots, parentheses and converts Arabic-Indic digits to Western ones. */
export function cleanPhoneInput(input = '') {
  return String(input ?? '')
    .trim()
    .replace(/[٠-٩۰-۹]/g, (ch) => String(ARABIC_DIGITS.indexOf(ch) >= 0 ? ARABIC_DIGITS.indexOf(ch) : PERSIAN_DIGITS.indexOf(ch)))
    .replace(/[\s\-().]/g, '')
}

function stripCountry(cleaned, cc, minLenWithCc) {
  if (cleaned.startsWith(`00${cc}`)) return cleaned.slice(2 + cc.length)
  if (cleaned.startsWith(`+${cc}`)) return cleaned.slice(1 + cc.length)
  if (cleaned.startsWith(cc) && cleaned.length >= minLenWithCc) return cleaned.slice(cc.length)
  return cleaned
}

const invalid = (raw, key) => ({ valid: false, errorKey: key, sanitized: String(raw ?? '') })
const valid = (sanitized, type, country) => ({ valid: true, errorKey: null, sanitized, type, country })

/** Egypt: mobile 010/011/012/015 + 8 digits; landlines by area code (same rules as the old validator). */
export function validateEgypt(raw) {
  let c = stripCountry(cleanPhoneInput(raw), '20', 11)
  if (c.startsWith('0')) c = c.slice(1)
  if (!/^\d+$/.test(c)) return invalid(raw, 'phone.digitsOnly')
  if (/^(10|11|12|15)\d{8}$/.test(c)) return valid(`+20${c}`, 'mobile', 'EG')
  if (/^(2|3|13|40|45|46|47|48|50|55|57|62|64|65|66|68|69|82|84|86|88|92|93|95|96|97)\d{7,8}$/.test(c)) return valid(`+20${c}`, 'landline', 'EG')
  return invalid(raw, c.startsWith('1') ? 'phone.egMobile' : 'phone.egInvalid')
}

function gulfMobile(raw, cc, country, key) {
  let c = stripCountry(cleanPhoneInput(raw), cc, 11)
  if (c.startsWith('0')) c = c.slice(1)
  if (/^5\d{8}$/.test(c)) return valid(`+${cc}${c}`, 'mobile', country)
  return invalid(raw, key)
}
export const validateSaudi = (raw) => gulfMobile(raw, '966', 'SA', 'phone.saInvalid')
export const validateUAE = (raw) => gulfMobile(raw, '971', 'AE', 'phone.aeInvalid')

/** Generic E.164: 7-15 digits with a country code. */
export function validateGeneral(raw) {
  let c = cleanPhoneInput(raw)
  if (c.startsWith('00')) c = `+${c.slice(2)}`
  else if (!c.startsWith('+')) c = `+${c}`
  const digits = c.replace(/\D/g, '')
  if (digits.length >= 7 && digits.length <= 15) return valid(`+${digits}`, 'unknown', null)
  return invalid(raw, 'phone.general')
}

const BY_COUNTRY = { EG: validateEgypt, SA: validateSaudi, AE: validateUAE }

/**
 * Validate against the countries the FORM FIELD allows (default EG/SA/AE); empty input is valid (required-ness is the
 * field's concern). Returns { valid, errorKey, sanitized, type?, country? }.
 */
export function validatePhone(raw, allowedCountries = []) {
  if (!raw || !String(raw).trim()) return { valid: true, errorKey: null, sanitized: '' }
  const countries = Array.isArray(allowedCountries) && allowedCountries.length ? allowedCountries : ['EG', 'SA', 'AE']
  let firstError = null
  for (const code of countries) {
    const fn = BY_COUNTRY[code]
    const res = fn ? fn(raw) : validateGeneral(raw)
    if (res.valid) return res
    firstError ??= res
  }
  if (countries.some((c) => !BY_COUNTRY[c])) {
    const g = validateGeneral(raw)
    if (g.valid) return g
  }
  return firstError ?? invalid(raw, 'phone.general')
}

/** Display an E.164 number grouped for reading, e.g. +20 10 1234 5678. */
export function formatPhone(e164) {
  const s = String(e164 ?? '').trim()
  if (!/^\+\d{7,15}$/.test(s)) return s
  const c = SUPPORTED_COUNTRIES.find((x) => s.startsWith(x.dialCode))
  if (!c) return s
  const rest = s.slice(c.dialCode.length)
  return `${c.dialCode} ${rest.replace(/(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3')}`
}
