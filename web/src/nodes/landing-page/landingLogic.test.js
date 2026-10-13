import { describe, expect, it } from 'vitest'
import {
  absoluteUrl, analyticsByCard, analyticsSeries, cleanPresets, descriptorUrl, emptyCard, emptyFrame, fromCardRow, fromFrameRow, isBlankLanding, isSafeUrl, isUuid,
  modelFromPayload, moveItem, normalizeLandingConfig, resolveCardLinks, resolveNav, starterTemplate, toChildren, validateLanding, withResolvedLinks, withSource,
} from './landingLogic.js'

const BASE = 'https://athar.test'
const ORIGIN = 'https://athar.test'
const C1 = '11111111-1111-4111-8111-111111111111'

describe('config normaliser (tolerant of the migrated shape)', () => {
  it('reads the migrated join_athar config: legacy title becomes the hero title, hero.coverPath stays, personalize is OFF, unknown keys survive', () => {
    const c = normalizeLandingConfig({ hero: { coverPath: 'p/landing/x.webp' }, title: 'Join Athar', layoutColumns: 2, somethingElse: { a: 1 } })
    expect(c.hero.title).toEqual({ en: 'Join Athar', ar: '' })
    expect(c.hero.coverPath).toBe('p/landing/x.webp')
    expect(c.cardsSection.layoutColumns).toBe(2)
    expect(c.personalize.enabled).toBe(false)
    expect(c.somethingElse).toEqual({ a: 1 })
    expect(c.title).toBe('Join Athar')
    expect(c.share.channels).toEqual(['whatsapp', 'facebook', 'linkedin', 'instagram', 'telegram', 'copy'])
    expect(c.analytics.enabled).toBe(true)
    expect(c.nav.enabled).toBe(true)
  })
  it('an empty config is blank; a config with a hero text, a card or a frame is not', () => {
    expect(isBlankLanding({}, [], [])).toBe(true)
    expect(isBlankLanding(null)).toBe(true)
    expect(isBlankLanding({ hero: { title: { en: 'x' } } }, [], [])).toBe(false)
    expect(isBlankLanding({}, [emptyCard()], [])).toBe(false)
    expect(isBlankLanding({ personalize: { enabled: true } }, [], [])).toBe(false)
  })
  it('keeps only known share channels, de-duplicated, and falls back to the defaults when none is left', () => {
    expect(normalizeLandingConfig({ share: { channels: ['x', 'x', 'myspace', 'copy'] } }).share.channels).toEqual(['x', 'copy'])
    expect(normalizeLandingConfig({ share: { channels: ['myspace'] } }).share.channels).toHaveLength(6)
  })
  it('clamps the column count to 1..3 (0 = automatic)', () => {
    expect(normalizeLandingConfig({ cardsSection: { layoutColumns: 7 } }).cardsSection.layoutColumns).toBe(3)
    expect(normalizeLandingConfig({ cardsSection: { layoutColumns: 'x' } }).cardsSection.layoutColumns).toBe(0)
  })
})

describe('cards and frames <-> rows', () => {
  const row = { id: C1, cover_path: 'p/landing/c.webp', chip_label_en: 'Chip', title_en: 'T', title_ar: 'ع', body_en: 'B', see_more_lines: 2, cta_label_en: 'Go', cta_url: '#', cta_node_id: null, cta_dot: true, share_enabled: true, share_url: null, share_node_id: 'N', presets: { whatsapp: 'W {link}', bogus: 'x' } }
  it('maps a landing_cards row (or a public card) to the draft model and drops unknown presets', () => {
    const c = fromCardRow(row)
    expect(c).toMatchObject({ id: C1, cover: 'p/landing/c.webp', chip: { en: 'Chip', ar: '' }, title: { en: 'T', ar: 'ع' }, seeMoreLines: 2, ctaUrl: '#', ctaDot: true, shareEnabled: true, shareNodeId: 'N' })
    expect(c.presets).toEqual({ whatsapp: 'W {link}' })
  })
  it('toChildren sends stable uuids, order, nulls for empties and drops the url when a node is bound', () => {
    const a = emptyCard({ title: { en: 'A', ar: '' }, ctaUrl: 'https://x.co', ctaNodeId: 'N1', shareUrl: 'https://s.co', shareNodeId: null, presets: { whatsapp: 'Hi {link}', facebook: '   ', zzz: 'no' } })
    const b = emptyCard({ id: 'not-a-uuid', cover: ' ' })
    const out = toChildren([a, b], [emptyFrame({ name: 'F', path: 'p/landing/f.png', windowX: 90, windowY: 90, windowW: 900, windowH: 930 })])
    expect(out.cards[0]).toMatchObject({ id: a.id, sort_order: 0, title_en: 'A', title_ar: null, cta_url: null, cta_node_id: 'N1', share_url: 'https://s.co', share_node_id: null, presets: { whatsapp: 'Hi {link}' } })
    expect(isUuid(out.cards[0].id)).toBe(true)
    expect(out.cards[1]).toMatchObject({ id: undefined, sort_order: 1, cover_path: null })
    expect(out.frames[0]).toMatchObject({ name: 'F', image_path: 'p/landing/f.png', aspect: '4:5', window_w: 900, window_shape: 'rect', sort_order: 0 })
  })
  it('a duplicated card gets a NEW id (a card keeps its identity only for itself)', () => {
    expect(emptyCard().id).not.toBe(emptyCard().id)
    expect(isUuid(emptyCard().id)).toBe(true)
  })
  it('fromFrameRow normalises the window and the shape', () => {
    expect(fromFrameRow({ id: 'f', name: 'N', image_path: 'p/x.png', window_x: 1, window_y: 2, window_w: 3, window_h: 4, window_shape: 'circle' })).toMatchObject({ path: 'p/x.png', windowW: 3, shape: 'circle' })
    expect(fromFrameRow({ id: 'f', image_path: 'p/x.png', window_shape: 'weird' }).shape).toBe('rect')
  })
  it('cleanPresets keeps only known platforms with text', () => {
    expect(cleanPresets({ whatsapp: ' a ', telegram: '', x: 'b', nope: 'c' })).toEqual({ whatsapp: ' a ', x: 'b' })
  })
  it('modelFromPayload turns a public payload into the page model (node id included)', () => {
    const m = modelFromPayload({ node_id: 'ND', config: { hero: { title: { en: 'H' } } }, cards: [row], frames: [{ id: 'f', image_path: 'p/f.png' }] })
    expect(m.nodeId).toBe('ND')
    expect(m.config.hero.title.en).toBe('H')
    expect(m.cards).toHaveLength(1)
    expect(m.frames[0].path).toBe('p/f.png')
    expect(modelFromPayload(null)).toMatchObject({ cards: [], frames: [] })
  })
  it('moveItem reorders and ignores impossible moves', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3])
  })
})

describe('validation mirrors the DB', () => {
  it('accepts web addresses, mailto, tel, /path, #anchor and refuses javascript:/data:/bare words', () => {
    for (const ok of ['https://a.co/x?y=1', 'http://a.co', 'mailto:a@b.co', 'tel:+201001234567', '/forms/abc', '#', '#top', '']) expect(isSafeUrl(ok)).toBe(true)
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'www.a.co', 'https://a b.co', 'ftp://a.co']) expect(isSafeUrl(bad)).toBe(false)
  })
  it('validateLanding flags bad links by card id and key, too many cards, nav links', () => {
    const a = emptyCard({ ctaUrl: 'javascript:x', shareUrl: 'data:y' })
    const config = { nav: { links: [{ id: 'n1', label: {}, target: 'ftp://x' }, { id: 'n2', label: {}, target: 'section:cards' }] } }
    const e = validateLanding({ config, cards: [a], frames: [] })
    expect(e[`${a.id}.ctaUrl`]).toBe('url')
    expect(e[`${a.id}.shareUrl`]).toBe('url')
    expect(e['nav.n1']).toBe('url')
    expect(e['nav.n2']).toBeUndefined()
    expect(validateLanding({ config: {}, cards: Array.from({ length: 25 }, () => emptyCard()), frames: [] }).cards).toBe('tooMany')
    expect(validateLanding({ config: {}, cards: [emptyCard()], frames: [] })).toEqual({})
  })
})

describe('navigation', () => {
  it('empty links = the two defaults of landing-page.html, only for sections that exist', () => {
    expect(resolveNav({}, { hasCards: true, hasPersonalize: true }).map((l) => l.section)).toEqual(['cards', 'personalize'])
    expect(resolveNav({}, { hasCards: true, hasPersonalize: false }).map((l) => l.section)).toEqual(['cards'])
    expect(resolveNav({ nav: { enabled: false } }, { hasCards: true })).toEqual([])
  })
  it('custom links: section targets are filtered by presence, external ones must be safe', () => {
    const config = { nav: { links: [{ id: 'a', label: { en: 'Top' }, target: 'section:hero' }, { id: 'b', label: { en: 'Site' }, target: 'https://athareg.com' }, { id: 'c', label: { en: 'Bad' }, target: 'javascript:x' }] } }
    expect(resolveNav(config, { hasHero: true }).map((l) => l.id)).toEqual(['a', 'b'])
    expect(resolveNav(config, { hasHero: false }).map((l) => l.id)).toEqual(['b'])
  })
})

describe('links: a typed address or a page of the project (the `link` port)', () => {
  it('descriptors build public URLs per kind (form / booking / agenda / view+key); a ready url wins', () => {
    expect(descriptorUrl({ kind: 'form', slug: 'abc' }, { base: BASE })).toBe(`${BASE}/forms/abc`)
    expect(descriptorUrl({ kind: 'booking', slug: 'bk' }, { base: BASE })).toBe(`${BASE}/book/bk`)
    expect(descriptorUrl({ kind: 'agenda', slug: 'ag' }, { base: BASE })).toBe(`${BASE}/agenda/ag`)
    expect(descriptorUrl({ kind: 'view', slug: 'v', view_key: 'landing' }, { base: BASE })).toBe(`${BASE}/view/v/landing`)
    expect(descriptorUrl({ kind: 'view', slug: 'v' }, { base: BASE })).toBe('')
    expect(descriptorUrl({ kind: 'mystery', slug: 'v' }, { base: BASE })).toBe('')
    expect(descriptorUrl({ kind: 'form', url: 'https://ready.test/f' }, { base: BASE })).toBe('https://ready.test/f')
    expect(descriptorUrl(null)).toBe('')
  })
  it('absoluteUrl: http(s)/mailto/tel as is, /path on the origin, # = nothing, unsafe = nothing', () => {
    expect(absoluteUrl('https://a.co', { origin: ORIGIN })).toBe('https://a.co')
    expect(absoluteUrl('/forms/x', { origin: `${ORIGIN}/` })).toBe(`${ORIGIN}/forms/x`)
    expect(absoluteUrl('#', { origin: ORIGIN })).toBe('')
    expect(absoluteUrl('javascript:x', { origin: ORIGIN })).toBe('')
    expect(absoluteUrl('mailto:a@b.co')).toBe('mailto:a@b.co')
  })
  it('withSource appends ?source= or &source= (and nothing without a source)', () => {
    expect(withSource('https://a.co/f', 'whatsapp')).toBe('https://a.co/f?source=whatsapp')
    expect(withSource('https://a.co/f?x=1', 'whatsapp')).toBe('https://a.co/f?x=1&source=whatsapp')
    expect(withSource('https://a.co/f', '')).toBe('https://a.co/f')
  })
  it('the share target defaults to the button target (01-13), then to the page itself', () => {
    const page = 'https://athar.test/view/p/landing'
    const bound = emptyCard({ ctaLink: { kind: 'form', slug: 'abc' } })
    expect(resolveCardLinks(bound, { base: BASE, origin: ORIGIN, pageUrl: page })).toMatchObject({ ctaUrl: `${BASE}/forms/abc`, shareUrl: `${BASE}/forms/abc`, sourceable: true, ctaForm: true })
    const typed = emptyCard({ ctaUrl: 'https://opp.co/apply' })
    expect(resolveCardLinks(typed, { base: BASE, origin: ORIGIN, pageUrl: page })).toMatchObject({ ctaUrl: 'https://opp.co/apply', shareUrl: 'https://opp.co/apply', sourceable: false })
    const own = emptyCard({ ctaUrl: 'https://opp.co/apply', shareUrl: 'https://share.co/x' })
    expect(resolveCardLinks(own, { base: BASE, origin: ORIGIN, pageUrl: page }).shareUrl).toBe('https://share.co/x')
    const ownNode = emptyCard({ ctaUrl: 'https://opp.co/apply', shareLink: { kind: 'form', slug: 'f2' } })
    expect(resolveCardLinks(ownNode, { base: BASE, origin: ORIGIN, pageUrl: page })).toMatchObject({ shareUrl: `${BASE}/forms/f2`, sourceable: true })
    const none = emptyCard({ ctaUrl: '#' })
    expect(resolveCardLinks(none, { base: BASE, origin: ORIGIN, pageUrl: page })).toMatchObject({ ctaUrl: '', ctaHref: '#', shareUrl: page, sourceable: false })
  })
  it('withResolvedLinks attaches the connected links\' ready URLs for the editor previews', () => {
    const map = new Map([['N1', { kind: 'form', url: 'https://x.test/forms/q' }]])
    const c = withResolvedLinks(emptyCard({ ctaNodeId: 'N1', shareNodeId: 'N2' }), map)
    expect(c.ctaLink).toEqual({ kind: 'form', url: 'https://x.test/forms/q' })
    expect(c.shareLink).toBeNull()
    expect(resolveCardLinks(c, { base: BASE, origin: ORIGIN }).ctaUrl).toBe('https://x.test/forms/q')
  })
})

describe('starter template and analytics view models', () => {
  it('the starter is the two-card page of landing-page.html in English and Arabic', () => {
    const s = starterTemplate()
    expect(s.cards).toHaveLength(2)
    expect(s.cards.every((c) => c.title.en && c.title.ar && c.ctaLabel.en && c.ctaLabel.ar && isUuid(c.id))).toBe(true)
    expect(s.config.hero.title.en).toBe('Help Someone Find Their Next Opportunity.')
    expect(s.config.personalize.enabled).toBe(true)
    expect(isBlankLanding(s.config, s.cards, [])).toBe(false)
  })
  it('analyticsByCard matches by stable card id; analyticsSeries fills missing days with 0', () => {
    const cards = [{ id: 'a' }, { id: 'b' }]
    const rows = [{ card_id: 'a', event_type: 'cta_click', n: 3 }, { card_id: 'a', event_type: 'card_share', n: '2' }, { card_id: 'zzz', event_type: 'cta_click', n: 9 }]
    expect(analyticsByCard(rows, cards)).toEqual([{ cardId: 'a', counts: { cta_click: 3, card_share: 2 } }, { cardId: 'b', counts: {} }])
    const series = analyticsSeries([{ day: '2026-10-13', event_type: 'tab_view', n: 5 }, { day: '2026-10-11', event_type: 'tab_view', n: 2 }, { day: '2026-10-13', event_type: 'cta_click', n: 9 }], 'tab_view', 4, new Date('2026-10-13T10:00:00Z'))
    expect(series.map((s) => s.n)).toEqual([0, 2, 0, 5])
    expect(series[3].day).toBe('2026-10-13')
  })
})
