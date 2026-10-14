/**
 * INSTANT validation of the Egyptian national ID typed in the founder form (owner decision 08 section 19.3).
 *
 * This file only gives the person feedback while typing, without a network call. It mirrors `app_private.id_invalid_reason(p, today)` of m49 (same reasons, same
 * order) and is pinned to it by `nationalId.test.js` (the synthetic vectors of design 09 appendix A and the unit tests U07 - U13 of v49). It derives NOTHING:
 * the birth date, age, age category, gender and governorate shown to the person come from the server (`previewNationalId`, the SAME SQL as the database), and
 * the database stays the authority: it re-validates on save (`national_id_invalid`). No checksum exists (the check digit's algorithm is not public).
 *
 * Reasons (translated as `alumni.err.nid.<reason>`): empty, digits, length, century, date, future, governorate.
 */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'
// spaces, dashes, dots, zero-width and bidi marks (the database removes exactly these before it looks at the number)
const isNoise = (ch) => {
  const c = ch.codePointAt(0)
  return ch.trim() === '' || ch === '-' || ch === '.' || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff
}

export const NATIONAL_ID_LENGTH = 14

/** The cleaned number (Arabic-Indic / Persian digits -> ASCII, noise removed); null when blank. Anything else stays (and fails as `digits`). */
export function normalizeNationalId(raw) {
  let out = ''
  for (const ch of String(raw ?? '')) {
    const a = ARABIC_INDIC.indexOf(ch)
    const p = PERSIAN.indexOf(ch)
    if (isNoise(ch)) continue
    out += a >= 0 ? String(a) : p >= 0 ? String(p) : ch
  }
  return out === '' ? null : out
}

/** `YYYY-MM-DD` of today in Cairo (the date the database uses for the "not in the future" rule). */
export function cairoToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const daysIn = (y, m) => (m === 2 ? 28 + Number((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) : [4, 6, 9, 11].includes(m) ? 30 : 31)

/**
 * `null` when the number is valid, else the reason. `today` = 'YYYY-MM-DD' (default: Cairo today); `governorateCodes` = the codes of the lookups payload
 * (`lookups.governorates`, 88 included; when omitted the governorate is not checked here and the server decides).
 */
export function nationalIdProblem(raw, { today = cairoToday(), governorateCodes = null } = {}) {
  const n = normalizeNationalId(raw)
  if (n === null) return 'empty'
  if (!/^[0-9]+$/.test(n)) return 'digits'
  if (n.length !== NATIONAL_ID_LENGTH) return 'length'
  if (n[0] !== '2' && n[0] !== '3') return 'century'
  const y = (n[0] === '2' ? 1900 : 2000) + Number(n.slice(1, 3))
  const m = Number(n.slice(3, 5))
  const d = Number(n.slice(5, 7))
  if (m < 1 || m > 12) return 'date'
  if (d < 1 || d > daysIn(y, m)) return 'date'
  const born = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (today && born > today) return 'future'
  if (governorateCodes && !new Set([...governorateCodes].map(Number)).has(Number(n.slice(7, 9)))) return 'governorate'
  return null
}

/**
 * Feedback WHILE typing. `digits` = the input already formatted (lib/alumni `digitsOnly`, up to 15 so a too-long number is noticed).
 * Returns `{ problem, complete }`: `problem` is the first rule the typed prefix already breaks (century at digit 1, the date at digit 7, the governorate at
 * digit 9, the length when there are more than 14 digits); a number that is merely unfinished has `problem: null, complete: false`. At 14 digits the full
 * rule set decides. `blank` is true for an empty field (no message).
 */
export function nationalIdProgress(digits, opts = {}) {
  const n = String(digits ?? '')
  if (n === '') return { problem: null, complete: false, blank: true }
  if (n.length > NATIONAL_ID_LENGTH) return { problem: 'length', complete: false, blank: false }
  if (n.length === NATIONAL_ID_LENGTH) {
    const problem = nationalIdProblem(n, opts)
    return { problem, complete: problem === null, blank: false }
  }
  // a prefix: run the rules whose digits are already there by padding with a neutral tail, then keep only the reasons that do not depend on the missing digits
  if (n[0] !== '2' && n[0] !== '3') return { problem: 'century', complete: false, blank: false }
  if (n.length >= 7) {
    const padded = n.padEnd(NATIONAL_ID_LENGTH, '0')
    const p = nationalIdProblem(padded, { ...opts, governorateCodes: null })
    if (p === 'date' || p === 'future') return { problem: p, complete: false, blank: false }
  }
  if (n.length >= 9 && opts.governorateCodes && !new Set([...opts.governorateCodes].map(Number)).has(Number(n.slice(7, 9)))) return { problem: 'governorate', complete: false, blank: false }
  return { problem: null, complete: false, blank: false }
}
