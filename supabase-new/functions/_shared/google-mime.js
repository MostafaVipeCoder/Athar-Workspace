// RFC 5322 / 2045 / 2047 message builder for the Gmail API (`users.messages.send` takes the whole message base64url-encoded
// in `raw`). PURE: no I/O, no Deno or Node API. Design 07 section 1.4 / 1.6.
//
// Guarantees (all unit-tested, see tests/google-mime.test.js):
//  * UTF-8 subjects and display names (Arabic included) are RFC 2047 encoded-words, split only at character boundaries.
//  * Header injection is impossible: addresses and Message-ID are validated against a strict grammar and REJECTED when they
//    hold CR / LF / NUL; subjects, display names and extra header values are neutralised (control characters become a space).
//    Every header line we emit is built from already-clean parts, and the only CRLFs in a header are our own folds.
//  * multipart/alternative (text/plain + text/html), both base64 (76 columns), CRLF line endings, a boundary that cannot occur
//    in base64 content, MIME-Version, Date, Message-ID (caller-supplied for idempotent search in the Sent folder, else generated).

import { bytesToB64u, isEmailAddress, randomBytes, bytesToHex, utf8 } from './google-core.js'

export class MimeError extends Error {
  constructor(code, field = null) {
    super(code)
    this.name = 'MimeError'
    this.code = code
    this.field = field
  }
}

export const MIME_LIMITS = Object.freeze({ maxRecipients: 20, maxSubjectChars: 300, maxNameChars: 120, maxMessageBytes: 1_048_576 })

const CTRL_RE = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/g // C0 controls, DEL, NEL, LS, PS (all can end a line in some parser)
const HAS_LINE_BREAK = /[\r\n\u0000\u0085\u2028\u2029]/

/** Neutralise free text that goes into a header: every control character (CR and LF included) becomes a space, runs collapse. */
export function cleanHeaderText(value, max = 998) {
  return String(value ?? '').replace(CTRL_RE, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max)
}

const b64 = (bytes) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Standard base64 wrapped at 76 columns with CRLF (RFC 2045 section 6.8). */
export function base64Lines(bytes) {
  const s = b64(bytes)
  const out = []
  for (let i = 0; i < s.length; i += 76) out.push(s.slice(i, i + 76))
  return out.join('\r\n')
}

const isPlainAscii = (s) => /^[\x20-\x7e]*$/.test(s)

/** RFC 2047 "B" encoded-words of at most `maxBytes` UTF-8 bytes each, cut on character boundaries (never inside a multi-byte letter). */
export function encodeWords(text, maxBytes = 42) {
  const words = []
  let chunk = []
  let size = 0
  const flush = () => {
    if (chunk.length) words.push(`=?UTF-8?B?${b64(Uint8Array.from(chunk))}?=`)
    chunk = []
    size = 0
  }
  for (const ch of text) {
    const bytes = utf8(ch)
    if (size + bytes.length > maxBytes) flush()
    for (const b of bytes) chunk.push(b)
    size += bytes.length
  }
  flush()
  return words
}

/** Fold a header value at spaces so lines stay <= 78 columns (RFC 5322 2.2.3). A single over-long token is left whole (998 is the hard limit). */
export function foldHeader(name, value) {
  const first = `${name}: `
  const tokens = String(value).split(' ')
  const lines = []
  let line = first
  let lineHasToken = false
  for (const tok of tokens) {
    const sep = lineHasToken ? ' ' : ''
    if (lineHasToken && line.length + sep.length + tok.length > 78) {
      lines.push(line)
      line = ` ${tok}`
    } else {
      line += sep + tok
    }
    lineHasToken = true
  }
  lines.push(line)
  return lines.join('\r\n')
}

/** Subject (or any unstructured text) -> header value text: plain ASCII stays, anything else (or an `=?` look-alike) becomes encoded-words joined by a fold. */
export function encodeUnstructured(text) {
  const s = cleanHeaderText(text, MIME_LIMITS.maxSubjectChars)
  if (isPlainAscii(s) && !s.includes('=?')) return s
  return encodeWords(s).join(' ')
}

const ATOM_SPECIALS = /[()<>[\]:;@\\,."]/

/** Display name -> header-safe text: atom as-is, quoted-string when ASCII with specials, encoded-words when non-ASCII. */
export function encodeDisplayName(name) {
  const s = cleanHeaderText(name, MIME_LIMITS.maxNameChars)
  if (!s) return ''
  if (!isPlainAscii(s) || s.includes('=?')) return encodeWords(s).join(' ')
  if (ATOM_SPECIALS.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return s
}

/** Strict mailbox: rejects CR / LF / NUL / spaces / angle brackets / quotes outright (they are how header injection is built). */
export function normalizeAddress(value, field) {
  const raw = typeof value === 'string' ? { email: value } : value
  const original = raw?.email
  if (typeof original !== 'string') throw new MimeError('invalid_address', field)
  if (HAS_LINE_BREAK.test(original)) throw new MimeError('header_injection', field) // checked BEFORE trimming: a CR / LF is never silently dropped
  const email = original.replace(/^[ \t]+|[ \t]+$/g, '')
  if (/[\s<>",;()[\]\\]/.test(email) || !isEmailAddress(email)) throw new MimeError('invalid_address', field)
  return { email: email.toLowerCase(), name: raw.name ? cleanHeaderText(raw.name, MIME_LIMITS.maxNameChars) : '' }
}

function mailbox(a) {
  const n = encodeDisplayName(a.name)
  return n ? `${n} <${a.email}>` : a.email
}

function addressHeader(name, list) {
  return foldHeader(name, list.map(mailbox).join(', '))
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** RFC 5322 date-time in UTC: "Thu, 15 Oct 2026 10:00:00 +0000". */
export function rfc5322Date(d) {
  const t = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(t.getTime())) throw new MimeError('invalid_date', 'date')
  const p = (n) => String(n).padStart(2, '0')
  return `${DAYS[t.getUTCDay()]}, ${p(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())} +0000`
}

const MSGID_RE = /^<[A-Za-z0-9._~+=-]{1,128}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?>$/
export function normalizeMessageId(value) {
  const s = String(value ?? '').trim()
  const wrapped = s.startsWith('<') ? s : `<${s}>`
  if (HAS_LINE_BREAK.test(s) || !MSGID_RE.test(wrapped)) throw new MimeError(HAS_LINE_BREAK.test(s) ? 'header_injection' : 'invalid_message_id', 'messageId')
  return wrapped
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** A readable plain-text alternative from an HTML body (used when the caller gives no text part). */
export function htmlToText(html) {
  let s = String(html ?? '')
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) => {
    const label = text.replace(/<[^>]*>/g, '').trim()
    return label && label !== href ? `${label} (${href})` : href
  })
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|tr|ul|ol|table)>/gi, '\n\n').replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
  s = s.replace(/<[^>]*>/g, '')
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return cp > 0 && cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ''
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** A minimal HTML alternative for a plain-text body (escaped, line breaks kept, direction auto for Arabic). */
export function textToHtml(text) {
  return `<div dir="auto" style="white-space:normal">${escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>\n')}</div>`
}

const toCrlf = (s) => String(s).replace(/\r\n|\r|\n/g, '\r\n')

const EXTRA_HEADER_OK = /^(X-[A-Za-z0-9-]{1,40}|In-Reply-To|References|Auto-Submitted)$/i

/**
 * Build the message.
 *   from      { email, name? }                       the CONNECTED account (Gmail rewrites any other From)
 *   to        [{ email, name? } | 'a@b.c', ...]      >= 1
 *   cc        [...]                                  optional
 *   replyTo   { email, name? } | null
 *   subject   string (any script)
 *   html, text  at least one; the missing one is derived
 *   messageId '<id@domain>' | 'id@domain' | null     e.g. `<outbox-id@athareg.com>` so a human can find it in the Sent folder
 *   date      Date | ISO string (default now)
 *   headers   { 'X-Athar-Outbox': '...' }            allow-listed extra headers only
 * -> { raw (base64url for the Gmail API), mime (the CRLF text), messageId, size }
 */
export function makeMimeMessage({ from, to, cc = [], replyTo = null, subject, html = null, text = null, messageId = null, date = new Date(), headers = {}, maxBytes = MIME_LIMITS.maxMessageBytes, rand = randomBytes }) {
  const f = normalizeAddress(from, 'from')
  const toList = (Array.isArray(to) ? to : [to]).filter((x) => x !== undefined && x !== null).map((x) => normalizeAddress(x, 'to'))
  const ccList = (Array.isArray(cc) ? cc : [cc]).filter((x) => x !== undefined && x !== null && x !== '').map((x) => normalizeAddress(x, 'cc'))
  if (toList.length === 0) throw new MimeError('missing_field', 'to')
  if (toList.length + ccList.length > MIME_LIMITS.maxRecipients) throw new MimeError('too_many_recipients', 'to')
  const reply = replyTo ? normalizeAddress(replyTo, 'replyTo') : null
  if (subject === undefined || subject === null) throw new MimeError('missing_field', 'subject')
  let htmlBody = html === null || html === undefined || html === '' ? null : String(html)
  let textBody = text === null || text === undefined || text === '' ? null : String(text)
  if (htmlBody === null && textBody === null) throw new MimeError('missing_field', 'body')
  if (textBody === null) textBody = htmlToText(htmlBody)
  if (htmlBody === null) htmlBody = textToHtml(textBody)
  const mid = messageId ? normalizeMessageId(messageId) : `<${bytesToHex(rand(16))}@${f.email.split('@')[1]}>`
  const boundary = `=_athar_${bytesToHex(rand(12))}`

  const head = []
  head.push(foldHeader('From', mailbox(f)))
  head.push(addressHeader('To', toList))
  if (ccList.length) head.push(addressHeader('Cc', ccList))
  if (reply) head.push(foldHeader('Reply-To', mailbox(reply)))
  head.push(foldHeader('Subject', encodeUnstructured(subject)))
  head.push(`Date: ${rfc5322Date(date)}`)
  head.push(`Message-ID: ${mid}`)
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (!EXTRA_HEADER_OK.test(k)) throw new MimeError('invalid_header', k)
    if (HAS_LINE_BREAK.test(String(v))) throw new MimeError('header_injection', k)
    const val = cleanHeaderText(v, 200)
    if (!isPlainAscii(val)) throw new MimeError('invalid_header', k)
    head.push(foldHeader(k, val))
  }
  head.push('MIME-Version: 1.0')
  head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(utf8(toCrlf(body)))}\r\n`
  const mime = `${head.join('\r\n')}\r\n\r\n${part('text/plain', textBody)}${part('text/html', htmlBody)}--${boundary}--\r\n`
  const bytes = utf8(mime)
  if (bytes.length > maxBytes) throw new MimeError('too_large', 'body')
  return { raw: bytesToB64u(bytes), mime, messageId: mid, size: bytes.length }
}
