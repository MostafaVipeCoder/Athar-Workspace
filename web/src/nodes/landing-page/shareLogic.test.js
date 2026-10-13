import { describe, expect, it } from 'vitest'
import { buildChannel, buildChannels, defaultShareText, fillLink, hasLinkToken, nativeSharePayload, presetFor, shareText, stripLink } from './shareLogic.js'
import { emptyCard } from './landingLogic.js'

const LINK = 'https://athareg.com/forms/abc123'
const card = (over = {}) => emptyCard({ id: 'c1', title: { en: 'Do you know a founder?', ar: 'هل تعرف مؤسسًا؟' }, chip: { en: 'Upcoming', ar: 'القادم' }, ...over })

describe('{link} replacement', () => {
  it('replaces every occurrence (the as-is page replaced only the first)', () => {
    expect(fillLink('A {link} B {link} C {link}', LINK)).toBe(`A ${LINK} B ${LINK} C ${LINK}`)
  })
  it('accepts {{link}} and spaces inside the braces, any case', () => {
    expect(fillLink('{{link}} | { LINK } | {{ Link }}', 'X')).toBe('X | X | X')
  })
  it('never interprets $ patterns of the link (function replacer)', () => {
    expect(fillLink('go {link}', 'https://x.test/?a=$&b=$1')).toBe('go https://x.test/?a=$&b=$1')
  })
  it('detects and strips the token', () => {
    expect(hasLinkToken('see {link}')).toBe(true)
    expect(hasLinkToken('see link')).toBe(false)
    expect(stripLink('Join here:  {link}   now')).toBe('Join here: now')
    expect(stripLink('{link}')).toBe('')
  })
})

describe('texts', () => {
  it('default text = card title + link, in the visitor language', () => {
    expect(defaultShareText(card(), 'en')).toBe('Do you know a founder?\n{link}')
    expect(defaultShareText(card(), 'ar')).toBe('هل تعرف مؤسسًا؟\n{link}')
    expect(defaultShareText(emptyCard({ chip: { en: 'Chip', ar: '' } }), 'ar')).toBe('Chip\n{link}')
    expect(defaultShareText(emptyCard(), 'en')).toBe('{link}')
  })
  it('an empty or blank preset falls back to the default', () => {
    expect(presetFor(card({ presets: { whatsapp: '   ' } }), 'whatsapp', 'en')).toBe('Do you know a founder?\n{link}')
    expect(presetFor(card({ presets: { whatsapp: 'Hi {link}' } }), 'whatsapp', 'en')).toBe('Hi {link}')
  })
  it('a preset without {link} still carries the link on its own line', () => {
    expect(shareText(card({ presets: { whatsapp: 'Join us' } }), 'whatsapp', { lang: 'en', link: LINK })).toBe(`Join us\n${LINK}`)
    expect(shareText(card({ presets: { whatsapp: 'A {link} B {link}' } }), 'whatsapp', { lang: 'en', link: LINK })).toBe(`A ${LINK} B ${LINK}`)
  })
})

describe('channels (exact URLs)', () => {
  const c = card({ presets: { whatsapp: 'Join: {link} & {link}', telegram: 'Hello Telegram {link}', facebook: 'FB text {link}', linkedin: 'LI text {link}', x: 'Tweet {link}', instagram: 'IG {link}', copy: 'Copy {link}' } })
  const ctx = { card: c, lang: 'en', link: LINK }

  it('WhatsApp: wa.me with the whole text URL-encoded, link twice', () => {
    const ch = buildChannel('whatsapp', ctx)
    expect(ch).toMatchObject({ platform: 'whatsapp', kind: 'url', copyFirst: false })
    expect(ch.href).toBe(`https://wa.me/?text=${encodeURIComponent(`Join: ${LINK} & ${LINK}`)}`)
    expect(ch.href).toContain('%26') // the "&" of the text cannot break the query string
  })
  it('Telegram: url = the link, text = the message WITHOUT the link (the as-is code passed the message as url)', () => {
    const ch = buildChannel('telegram', ctx)
    expect(ch.href).toBe(`https://t.me/share/url?url=${encodeURIComponent(LINK)}&text=${encodeURIComponent('Hello Telegram')}`)
  })
  it('Telegram without any text omits the text parameter', () => {
    const ch = buildChannel('telegram', { ...ctx, card: card({ presets: { telegram: '{link}' } }) })
    expect(ch.href).toBe(`https://t.me/share/url?url=${encodeURIComponent(LINK)}`)
  })
  it('Facebook and LinkedIn: link-only intent + copy the text first (07-13)', () => {
    const fb = buildChannel('facebook', ctx)
    expect(fb.href).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(LINK)}`)
    expect(fb).toMatchObject({ copyFirst: true, hint: 'paste', text: `FB text ${LINK}` })
    const li = buildChannel('linkedin', ctx)
    expect(li.href).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(LINK)}`)
    expect(li).toMatchObject({ copyFirst: true, hint: 'paste', text: `LI text ${LINK}` })
  })
  it('X: tweet intent with the text', () => {
    expect(buildChannel('x', ctx).href).toBe(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Tweet ${LINK}`)}`)
  })
  it('Instagram and Copy only copy', () => {
    expect(buildChannel('instagram', ctx)).toMatchObject({ kind: 'copy', text: `IG ${LINK}`, hint: 'instagram' })
    expect(buildChannel('copy', ctx)).toMatchObject({ kind: 'copy', text: `Copy ${LINK}`, platform: 'copy' })
    expect(buildChannel('instagram', ctx).href).toBeUndefined()
  })
  it('Arabic text and an Arabic query survive URL encoding', () => {
    const ch = buildChannel('whatsapp', { card: card({ presets: { whatsapp: 'شارك {link}' } }), lang: 'ar', link: `${LINK}?lang=ar` })
    expect(ch.href).toBe(`https://wa.me/?text=${encodeURIComponent(`شارك ${LINK}?lang=ar`)}`)
    expect(decodeURIComponent(ch.href.split('text=')[1])).toBe(`شارك ${LINK}?lang=ar`)
  })
  it('a sourceable (form) target gets ?source=<platform> in every text and url', () => {
    const wa = buildChannel('whatsapp', { ...ctx, sourceable: true })
    expect(decodeURIComponent(wa.href.split('text=')[1])).toBe(`Join: ${LINK}?source=whatsapp & ${LINK}?source=whatsapp`)
    const fb = buildChannel('facebook', { ...ctx, sourceable: true })
    expect(fb.href).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${LINK}?source=facebook`)}`)
    const q = buildChannel('whatsapp', { ...ctx, link: `${LINK}?x=1`, sourceable: true })
    expect(decodeURIComponent(q.href)).toContain(`${LINK}?x=1&source=whatsapp`)
  })
  it('buildChannels keeps the configured order', () => {
    expect(buildChannels(['copy', 'whatsapp'], ctx).map((x) => x.platform)).toEqual(['copy', 'whatsapp'])
  })
  it('the native Web Share payload carries the link in url, not twice in the text', () => {
    expect(nativeSharePayload(c, { lang: 'en', link: LINK })).toEqual({ title: 'Do you know a founder?', text: 'Copy', url: LINK })
  })
})
