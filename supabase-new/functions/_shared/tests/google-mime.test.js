import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MimeError, base64Lines, cleanHeaderText, encodeDisplayName, encodeUnstructured, encodeWords, foldHeader, htmlToText, makeMimeMessage, normalizeAddress, rfc5322Date, textToHtml } from '../google-mime.js'
// the reader is written independently (db/scripts/fake-google/mime-parse.mjs): what we build is decoded by different code
import { parseMime, decodeBase64Url } from '../../../../db/scripts/fake-google/mime-parse.mjs'

const FROM = { email: 'Pm.One@Athareg.com', name: 'منى أحمد - Athar' }
const base = { from: FROM, to: [{ email: 'founder@example.com', name: 'علي محمود' }], subject: 'دعوة لمقابلة الاختيار', html: '<p>مرحباً <b>علي</b></p><p>سنقابلك <a href="https://athareg.com/book/x?t=1">هنا</a></p>', messageId: 'outbox-1234@athareg.com', date: new Date('2026-10-15T10:00:00Z') }
const decode = (r) => parseMime(decodeBase64Url(r.raw).toString('utf8'))

describe('a full Arabic message', () => {
  test('decodes back exactly: subject, display names, both parts, ids, no RFC problems', () => {
    const r = makeMimeMessage(base)
    const m = decode(r)
    assert.deepEqual(m.problems, [])
    assert.equal(m.headers.subject, 'دعوة لمقابلة الاختيار')
    assert.deepEqual(m.addresses.from, [{ name: 'منى أحمد - Athar', email: 'pm.one@athareg.com' }])
    assert.deepEqual(m.addresses.to, [{ name: 'علي محمود', email: 'founder@example.com' }])
    assert.equal(m.headers.messageId, '<outbox-1234@athareg.com>')
    assert.equal(r.messageId, '<outbox-1234@athareg.com>')
    assert.equal(m.headers.date, 'Thu, 15 Oct 2026 10:00:00 +0000')
    assert.equal(m.headers.mimeVersion, '1.0')
    assert.equal(m.contentType, 'multipart/alternative')
    assert.deepEqual(m.parts.map((p) => p.contentType), ['text/plain', 'text/html'])
    assert.equal(m.html, base.html.replaceAll('\n', '\r\n'))
    assert.match(m.text, /^مرحباً علي\r\n\r\nسنقابلك هنا \(https:\/\/athareg\.com\/book\/x\?t=1\)$/)
    assert.equal(r.size, Buffer.byteLength(r.mime))
  })

  test('raw is base64url (no + / =) and the mime uses CRLF only', () => {
    const r = makeMimeMessage(base)
    assert.match(r.raw, /^[A-Za-z0-9_-]+$/)
    assert.ok(!/[^\r]\n/.test(r.mime))
    assert.ok(!/\r[^\n]/.test(r.mime))
    for (const line of r.mime.split('\r\n')) assert.ok(line.length <= 998)
    const headerBlock = r.mime.split('\r\n\r\n')[0]
    for (const line of headerBlock.split('\r\n')) assert.ok(line.length <= 80, `header line too long: ${line.length}`)
    assert.ok(!/[^\x00-\x7f]/.test(headerBlock))
  })

  test('Reply-To, Cc, extra X- header, text-only and html-only bodies', () => {
    const r = makeMimeMessage({ ...base, cc: ['admin@athareg.com', { email: 'second@athareg.com', name: 'Second, Person' }], replyTo: { email: 'pm.one@athareg.com', name: 'PM' }, headers: { 'X-Athar-Outbox': 'outbox-1234' }, html: null, text: 'نص فقط\nسطر ثاني' })
    const m = decode(r)
    assert.deepEqual(m.problems, [])
    assert.deepEqual(m.addresses.cc.map((a) => a.email), ['admin@athareg.com', 'second@athareg.com'])
    assert.equal(m.addresses.cc[1].name, 'Second, Person')
    assert.deepEqual(m.addresses.replyTo, [{ name: 'PM', email: 'pm.one@athareg.com' }])
    assert.equal(m.headers.xAtharOutbox, 'outbox-1234')
    assert.equal(m.text, 'نص فقط\r\nسطر ثاني')
    assert.match(m.html, /^<div dir="auto"[^>]*>نص فقط<br>\r\nسطر ثاني<\/div>$/)
  })

  test('a generated Message-ID uses the sender domain; a Date can be a string', () => {
    const r = makeMimeMessage({ ...base, messageId: null, date: '2026-01-02T03:04:05Z' })
    assert.match(r.messageId, /^<[0-9a-f]{32}@athareg\.com>$/)
    assert.equal(decode(r).headers.date, 'Fri, 02 Jan 2026 03:04:05 +0000')
  })
})

describe('RFC 2047 encoding', () => {
  test('encoded words never split a multi-byte character (Arabic, emoji) and each is a valid UTF-8 word <= 75 chars', () => {
    const subject = `${'مرحبا بكم في برنامج أثر للتسريع '.repeat(6)}🚀🚀🚀 end`
    const words = encodeWords(subject)
    assert.ok(words.length > 3)
    for (const w of words) {
      assert.ok(w.length <= 75, w.length)
      const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(w)
      assert.ok(m, w)
      const bytes = Buffer.from(m[1], 'base64')
      assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'a word split a character')
    }
    assert.equal(decode(makeMimeMessage({ ...base, subject })).headers.subject, subject.replace(/\s{2,}/g, ' ').trim())
  })

  test('ASCII subjects stay plain (and fold when long); an "=?" look-alike is encoded', () => {
    assert.equal(encodeUnstructured('Interview invitation'), 'Interview invitation')
    assert.match(encodeUnstructured('a =?utf-8?b?QQ==?= b'), /^=\?UTF-8\?B\?/)
    const long = 'word '.repeat(60).trim()
    const folded = foldHeader('Subject', long)
    for (const line of folded.split('\r\n')) assert.ok(line.length <= 78)
    assert.equal(parseMime(`From: a@b.co\r\nTo: c@d.co\r\nSubject: ${folded.slice(9)}\r\nDate: x\r\nMessage-ID: <a@b.co>\r\nMIME-Version: 1.0\r\n\r\nx`).headers.subject, long)
  })

  test('display names: atom, quoted when it has specials, encoded when non-ASCII', () => {
    assert.equal(encodeDisplayName('Mona Ahmed'), 'Mona Ahmed')
    assert.equal(encodeDisplayName('Ahmed, Mona (PM)'), '"Ahmed, Mona (PM)"')
    assert.equal(encodeDisplayName('Say "hi" \\ there'), '"Say \\"hi\\" \\\\ there"')
    assert.match(encodeDisplayName('منى'), /^=\?UTF-8\?B\?/)
    assert.equal(encodeDisplayName(''), '')
  })
})

describe('header injection', () => {
  const attacks = ['a@b.co\r\nBcc: evil@x.com', 'a@b.co\nBcc: evil@x.com', 'a@b.co\rBcc: evil@x.com', 'a@b.co\u0000', 'a@b.co Bcc: x@y.co', 'a@b.co%0d%0aBcc: x@y.co', '"a"@b.co', 'a b@c.co', 'a@b.co,evil@x.com', 'a@b.co>', '<a@b.co>', 'a@b.co;x', 'a@b..co']
  for (const field of ['to', 'cc']) {
    test(`${field}: every address attack is rejected before anything is built`, () => {
      for (const bad of attacks) {
        assert.throws(() => makeMimeMessage({ ...base, [field]: [bad] }), (e) => e instanceof MimeError && ['header_injection', 'invalid_address'].includes(e.code), `${field}: ${JSON.stringify(bad)}`)
      }
    })
  }
  test('from and reply-to: the same', () => {
    for (const bad of attacks) {
      assert.throws(() => makeMimeMessage({ ...base, from: { email: bad } }), MimeError, JSON.stringify(bad))
      assert.throws(() => makeMimeMessage({ ...base, replyTo: { email: bad } }), MimeError, JSON.stringify(bad))
    }
    assert.throws(() => makeMimeMessage({ ...base, to: [{ email: 'a@b.co\r\nBcc: evil@x.com' }] }), (e) => e.code === 'header_injection' && e.field === 'to')
  })
  test('subject and display names with CR / LF are neutralised: no extra header line can appear', () => {
    const evilSubject = 'Hello\r\nBcc: evil@x.com\r\nX-Evil: 1'
    const evilName = 'Mona\r\nBcc: evil@x.com'
    const r = makeMimeMessage({ ...base, subject: evilSubject, from: { email: 'pm@athareg.com', name: evilName }, to: [{ email: 'a@b.co', name: evilName }], replyTo: { email: 'r@athareg.com', name: evilName }, cc: [{ email: 'c@b.co', name: evilName }] })
    const m = decode(r)
    const headerNames = m.rawHeaders.map(([n]) => n.toLowerCase())
    assert.ok(!headerNames.includes('bcc'))
    assert.ok(!headerNames.includes('x-evil'))
    assert.equal(m.headers.subject, 'Hello Bcc: evil@x.com X-Evil: 1')
    assert.equal(m.addresses.from[0].name, 'Mona Bcc: evil@x.com')
    assert.deepEqual(m.problems, [])
    // the bytes: the only CRLFs in the header block start a known header or a fold
    const head = r.mime.split('\r\n\r\n')[0]
    for (const line of head.split('\r\n')) assert.match(line, /^([A-Za-z-]+: |[ \t])/)
  })
  test('Message-ID and extra headers refuse injection and anything off the allow-list', () => {
    for (const bad of ['x@y.co\r\nBcc: z@y.co', 'x y@athareg.com', '<x@y.co>>', 'no-at-sign', '']) {
      if (bad === '') continue
      assert.throws(() => makeMimeMessage({ ...base, messageId: bad }), MimeError, JSON.stringify(bad))
    }
    assert.throws(() => makeMimeMessage({ ...base, headers: { Bcc: 'x@y.co' } }), (e) => e.code === 'invalid_header')
    assert.throws(() => makeMimeMessage({ ...base, headers: { 'Content-Type': 'text/html' } }), (e) => e.code === 'invalid_header')
    assert.throws(() => makeMimeMessage({ ...base, headers: { 'X-One\r\nBcc': 'x' } }), (e) => e.code === 'invalid_header')
    assert.throws(() => makeMimeMessage({ ...base, headers: { 'X-Ok': 'v\r\nBcc: x@y.co' } }), (e) => e.code === 'header_injection')
    assert.throws(() => makeMimeMessage({ ...base, headers: { 'X-Ok': 'نص' } }), (e) => e.code === 'invalid_header')
  })
  test('the body can hold anything (CRLF, boundary look-alikes, a header block) without touching the structure', () => {
    const body = '--=_athar_x\r\nBcc: evil@x.com\r\n\r\nContent-Type: text/html'
    const m = decode(makeMimeMessage({ ...base, html: null, text: body }))
    assert.deepEqual(m.problems, [])
    assert.equal(m.parts.length, 2)
    assert.equal(m.text, body)
    assert.ok(!m.rawHeaders.some(([n]) => n.toLowerCase() === 'bcc'))
  })
  test('cleanHeaderText turns every kind of control character into a space', () => {
    assert.equal(cleanHeaderText('a\r\nb\tc\u0000d e\u0085f'), 'a b c d e f')
    assert.equal(cleanHeaderText('x'.repeat(50), 10).length, 10)
  })
})

describe('limits and required fields', () => {
  test('requires recipients, subject and a body; limits recipients and size', () => {
    assert.throws(() => makeMimeMessage({ ...base, to: [] }), (e) => e.code === 'missing_field')
    assert.throws(() => makeMimeMessage({ ...base, subject: undefined }), (e) => e.code === 'missing_field')
    assert.throws(() => makeMimeMessage({ ...base, html: null, text: null }), (e) => e.code === 'missing_field')
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@example.com`)
    assert.throws(() => makeMimeMessage({ ...base, to: many }), (e) => e.code === 'too_many_recipients')
    assert.throws(() => makeMimeMessage({ ...base, html: 'x'.repeat(2_000_000) }), (e) => e.code === 'too_large')
    assert.doesNotThrow(() => makeMimeMessage({ ...base, subject: '' }))
  })
  test('normalizeAddress lower-cases, trims and cleans the name', () => {
    assert.deepEqual(normalizeAddress({ email: ' A@B.Co ', name: ' x\ny ' }, 'to'), { email: 'a@b.co', name: 'x y' })
    assert.deepEqual(normalizeAddress('a@b.co', 'to'), { email: 'a@b.co', name: '' })
    assert.throws(() => normalizeAddress(null, 'to'), MimeError)
  })
  test('rfc5322Date is the UTC form', () => {
    assert.equal(rfc5322Date(new Date('2026-12-31T23:59:59Z')), 'Thu, 31 Dec 2026 23:59:59 +0000')
    assert.throws(() => rfc5322Date('nope'), MimeError)
  })
})

describe('bodies', () => {
  test('base64Lines wraps at 76 columns', () => {
    const out = base64Lines(new Uint8Array(200).fill(65))
    for (const l of out.split('\r\n')) assert.ok(l.length <= 76)
  })
  test('htmlToText keeps links, lists and entities readable and drops scripts', () => {
    const t = htmlToText('<style>p{}</style><p>Hi &amp; welcome&nbsp;&#1605;</p><ul><li>One</li><li>Two</li></ul><a href="https://x.co/a">https://x.co/a</a><br>done<script>alert(1)</script>')
    assert.equal(t, 'Hi & welcome م\n\n\n- One\n- Two\n\nhttps://x.co/a\ndone'.replace(/\n\n\n/, '\n\n'))
  })
  test('textToHtml escapes', () => {
    assert.equal(textToHtml('<b>&"x"</b>\nnext'), '<div dir="auto" style="white-space:normal">&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;<br>\nnext</div>')
  })
})
