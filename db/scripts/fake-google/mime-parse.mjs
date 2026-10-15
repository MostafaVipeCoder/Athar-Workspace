// A small, STRICT MIME reader for the fake Gmail endpoint and for the tests (Node built-ins only).
// It is written independently of supabase-new/functions/_shared/google-mime.js on purpose: the tests decode what the
// library produced with different code, so a shared bug cannot cancel itself out.
//
// parseMime(text) -> {
//   headers:   { from, to, cc, replyTo, subject, messageId, date, mimeVersion, contentType, ... }   (lower-cased names, decoded, unfolded)
//   rawHeaders:[[name, rawValue], ...]
//   addresses: { from: [{name,email}], to: [...], cc: [...], replyTo: [...] }
//   parts:     [{ contentType, charset, encoding, text }]
//   text, html: the decoded text/plain and text/html bodies
//   problems:  [strings]  RFC violations a real MTA could choke on (bare LF, header line > 998, non-ASCII byte in a header, missing Date / Message-ID / MIME-Version, ...)
// }

const td = new TextDecoder('utf-8', { fatal: false })

export function decodeBase64Url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function decodeCharset(buf, charset) {
  try {
    return new TextDecoder((charset || 'utf-8').toLowerCase(), { fatal: false }).decode(buf)
  } catch {
    return td.decode(buf)
  }
}

/** RFC 2047: =?charset?B|Q?text?= ; whitespace between two adjacent encoded words is dropped. */
export function decodeEncodedWords(value) {
  const s = String(value)
  const re = /=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?]*)\?=/g
  let out = ''
  let last = 0
  let prevEncoded = false
  let m
  while ((m = re.exec(s))) {
    const gap = s.slice(last, m.index)
    out += prevEncoded && /^[ \t\r\n]*$/.test(gap) ? '' : gap
    const [, charset, enc, body] = m
    let bytes
    if (enc.toUpperCase() === 'B') bytes = Buffer.from(body, 'base64')
    else bytes = Buffer.from(body.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
    out += decodeCharset(bytes, charset)
    last = m.index + m[0].length
    prevEncoded = true
  }
  return out + s.slice(last)
}

function splitHeaderBlock(text) {
  const crlf = text.indexOf('\r\n\r\n')
  const lf = text.indexOf('\n\n')
  let idx = crlf
  let sepLen = 4
  if (idx < 0 || (lf >= 0 && lf < idx)) { idx = lf; sepLen = 2 }
  if (idx < 0) return { head: text, body: '' }
  return { head: text.slice(0, idx), body: text.slice(idx + sepLen) }
}

function parseHeaderBlock(head, problems) {
  if (/(^|[^\r])\n/.test(head)) problems.push('bare LF in the header block')
  const lines = head.split(/\r\n|\n/)
  const raw = []
  for (const line of lines) {
    if (line.length > 998) problems.push('header line longer than 998')
    if (/[^\x00-\x7f]/.test(line)) problems.push('non-ASCII character in a header (needs RFC 2047)')
    if (/^[ \t]/.test(line)) {
      if (!raw.length) { problems.push('folded line without a header'); continue }
      raw[raw.length - 1][1] += `\r\n${line}`
    } else {
      const i = line.indexOf(':')
      if (i <= 0) { problems.push(`malformed header line: ${line.slice(0, 40)}`); continue }
      raw.push([line.slice(0, i).trim(), line.slice(i + 1).replace(/^[ \t]/, '')])
    }
  }
  return raw
}

const unfold = (v) => v.replace(/\r\n[ \t]+/g, ' ')

function parseAddressList(rawValue) {
  const v = decodeEncodedWords(unfold(rawValue))
  const out = []
  let cur = ''
  let inQ = false
  let inA = false
  for (let i = 0; i < v.length; i++) {
    const c = v[i]
    if (c === '\\' && inQ) { cur += v[++i] ?? ''; continue }
    if (c === '"') { inQ = !inQ; cur += c; continue }
    if (!inQ && c === '<') inA = true
    if (!inQ && c === '>') inA = false
    if (c === ',' && !inQ && !inA) { out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*?)<([^<>]+)>\s*$/.exec(p)
      if (m) return { name: m[1].trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1'), email: m[2].trim() }
      return { name: '', email: p.replace(/^"(.*)"$/s, '$1') }
    })
}

function decodeBody(body, encoding, charset) {
  const enc = (encoding || '7bit').toLowerCase()
  let buf
  if (enc === 'base64') buf = Buffer.from(body.replace(/[\r\n\s]/g, ''), 'base64')
  else if (enc === 'quoted-printable') buf = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
  else buf = Buffer.from(body, 'latin1')
  return decodeCharset(buf, charset)
}

function parseParams(value) {
  const parts = unfold(value).split(';')
  const type = parts.shift().trim().toLowerCase()
  const params = {}
  for (const p of parts) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s;]*))\s*$/.exec(p)
    if (m) params[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]
  }
  return { type, params }
}

function parseEntity(text, problems, depth = 0) {
  const { head, body } = splitHeaderBlock(text)
  const rawHeaders = parseHeaderBlock(head, problems)
  const h = {}
  for (const [name, value] of rawHeaders) h[name.toLowerCase()] = h[name.toLowerCase()] === undefined ? value : `${h[name.toLowerCase()]}, ${value}`
  const ct = parseParams(h['content-type'] ?? 'text/plain; charset=us-ascii')
  const parts = []
  if (ct.type.startsWith('multipart/') && depth < 4) {
    const boundary = ct.params.boundary
    if (!boundary) problems.push('multipart without a boundary')
    else {
      const delim = `--${boundary}`
      const chunks = body.split(delim)
      if (!/\r\n--/.test(`\r\n${body}`) ) problems.push('no boundary delimiter found')
      chunks.shift() // preamble
      for (const chunk of chunks) {
        if (chunk.startsWith('--')) break // closing delimiter
        const part = chunk.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
        const e = parseEntity(part, problems, depth + 1)
        parts.push(...e.parts)
      }
      if (!body.includes(`${delim}--`)) problems.push('missing closing boundary')
    }
  } else {
    parts.push({ contentType: ct.type, charset: ct.params.charset ?? null, encoding: (h['content-transfer-encoding'] ?? '7bit').toLowerCase(), text: decodeBody(body, h['content-transfer-encoding'], ct.params.charset) })
  }
  return { rawHeaders, h, ct, parts }
}

export function parseMime(text) {
  const problems = []
  const e = parseEntity(String(text), problems)
  const get = (n) => (e.h[n] === undefined ? null : decodeEncodedWords(unfold(e.h[n])))
  const addresses = { from: [], to: [], cc: [], replyTo: [] }
  if (e.h.from) addresses.from = parseAddressList(e.h.from)
  if (e.h.to) addresses.to = parseAddressList(e.h.to)
  if (e.h.cc) addresses.cc = parseAddressList(e.h.cc)
  if (e.h['reply-to']) addresses.replyTo = parseAddressList(e.h['reply-to'])
  for (const need of ['from', 'to', 'subject', 'date', 'message-id', 'mime-version']) if (e.h[need] === undefined) problems.push(`missing ${need} header`)
  if (e.h['mime-version'] !== undefined && e.h['mime-version'].trim() !== '1.0') problems.push('MIME-Version is not 1.0')
  const headers = {}
  for (const name of Object.keys(e.h)) headers[name.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = get(name)
  return {
    headers,
    rawHeaders: e.rawHeaders,
    addresses,
    parts: e.parts,
    text: e.parts.find((p) => p.contentType === 'text/plain')?.text ?? null,
    html: e.parts.find((p) => p.contentType === 'text/html')?.text ?? null,
    contentType: e.ct.type,
    problems,
  }
}
