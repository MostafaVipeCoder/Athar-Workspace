/**
 * Certificate codes (m38): 12 Crockford base32 characters shown as XXXX-XXXX-XXXX (alphabet 0-9 A-Z without I, L, O, U).
 * The verifier accepts what people type or what a camera reads: any case, spaces or dashes anywhere, and the Crockford look-alikes
 * (O -> 0, I / L -> 1). The server applies the SAME normalisation (app_private.cert_normalize_code), so a code that passes here is
 * looked up as typed; one that does not is rejected without a request.
 */
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/

/** 'ab12 cd34-ef56' -> 'AB12-CD34-EF56'; null when it is not a well-formed code. */
export function normalizeCertCode(input) {
  const v = String(input ?? '').toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (!CODE_RE.test(v)) return null
  return `${v.slice(0, 4)}-${v.slice(4, 8)}-${v.slice(8, 12)}`
}

/** What the visitor sees while typing: uppercase, dashes after every 4 characters, at most 12 characters. */
export function formatCertCodeInput(input) {
  const v = String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12)
  return v.replace(/(.{4})(?=.)/g, '$1-')
}
