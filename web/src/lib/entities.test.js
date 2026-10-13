import { describe, expect, it } from 'vitest'
import {
  CARD_FIELDS, biPick, cardShowOf, entityMatches, linksOf, normalizeCompany, normalizeDisplay, normalizeExpert, normalizeListItem,
  toCompanyRow, toExpertRow, toManualFields, validateEntityView, visibleCardFields,
} from './entities.js'

describe('lib/entities', () => {
  it('normalises an expert row into the one EntityView shape', () => {
    const v = normalizeExpert({ id: 'e1', kind: 'team', name_en: 'Ada', name_ar: 'آدا', title_en: 'CTO', company_en: 'Acme', bio_en: 'x', photo_path: 'p/photo/a.webp', linkedin_url: 'linkedin.com/in/ada', email: 'a@x.io' })
    expect(v.kind).toBe('expert')
    expect(v.networkKind).toBe('team')
    expect(v.title).toEqual({ en: 'Ada', ar: 'آدا' })
    expect(v.subtitle.en).toBe('CTO')
    expect(v.organization.en).toBe('Acme')
    expect(v.imagePath).toBe('p/photo/a.webp')
    expect(v.links).toEqual([{ kind: 'linkedin', url: 'https://linkedin.com/in/ada' }])
    expect(normalizeExpert(null)).toBeNull()
  })

  it('normalises a company row (industry = subtitle, extra kept) and de-duplicates links', () => {
    const v = normalizeCompany({ id: 'c1', name_en: 'Co', industry_en: 'Fintech', description_ar: 'وصف', logo_path: null, website_url: 'https://co.io', links: ['https://co.io', { kind: 'other', url: 'https://x.io/co' }], stage: 'seed' })
    expect(v.kind).toBe('company')
    expect(v.subtitle.en).toBe('Fintech')
    expect(v.bio.ar).toBe('وصف')
    expect(v.links.map((l) => l.url)).toEqual(['https://co.io', 'https://x.io/co'])
    expect(v.extra.stage).toBe('seed')
  })

  it('linksOf classifies linkedin urls given as plain strings', () => {
    expect(linksOf({ links: ['https://www.linkedin.com/company/x'] })).toEqual([{ kind: 'linkedin', url: 'https://www.linkedin.com/company/x' }])
    expect(linksOf({})).toEqual([])
  })

  it('round-trips EntityView -> row columns', () => {
    const v = normalizeExpert({ id: 'e', name_en: ' Ada ', title_ar: 'مديرة', email: 'a@x.io', linkedin_url: 'https://l.in/a' })
    expect(toExpertRow(v)).toMatchObject({ name_en: 'Ada', name_ar: null, title_ar: 'مديرة', linkedin_url: 'https://l.in/a', email: 'a@x.io' })
    const c = normalizeCompany({ id: 'c', name_en: 'Co', website_url: 'https://co.io', links: [{ kind: 'other', url: 'https://t.me/co' }] })
    expect(toCompanyRow(c)).toMatchObject({ name_en: 'Co', website_url: 'https://co.io', links: [{ kind: 'other', url: 'https://t.me/co' }] })
    expect(toManualFields(normalizeDisplay({ title_en: 'M', bio_ar: 'ب' }))).toEqual({ title_en: 'M', bio_ar: 'ب' })
  })

  it('normalizeListItem: virtual items get a stable client key and itemId null; tombstones are flagged', () => {
    const virtual = normalizeListItem({ item_id: null, source: { kind: 'form_response', id: 'r1', state: 'ok' }, display: { title_en: 'Resp Co' }, overlay: {}, status: null, sort_order: null, excluded: false, cursor: { s: 1, k: 'r1' } }, 'company')
    expect(virtual.id).toBe('virtual:form_response:r1')
    expect(virtual.itemId).toBeNull()
    expect(virtual.virtual).toBe(true)
    expect(virtual.entity.kind).toBe('company')
    expect(virtual.entity.title.en).toBe('Resp Co')
    const gone = normalizeListItem({ item_id: 'i1', source: { kind: 'company', id: null, state: 'missing' }, display: { title_en: 'Old' }, overlay: { notes: 'n' } }, 'company')
    expect(gone.missing).toBe(true)
    expect(gone.id).toBe('i1')
    expect(gone.overlay.notes).toBe('n')
  })

  it('card visibility: legacy per-item keys map onto CARD_FIELDS and the list default fills the rest', () => {
    expect(cardShowOf({ show: { show_photo: false, show_description: true, show_role: true, nonsense: 1 } })).toEqual({ image: false, bio: true })
    expect(cardShowOf(null)).toEqual({})
    expect(visibleCardFields(['title', 'subtitle'], { bio: true, title: false })).toEqual(['subtitle', 'bio'])
    expect(visibleCardFields([], {})).toEqual(CARD_FIELDS)
  })

  it('validation and search', () => {
    expect(validateEntityView({ title: { en: '', ar: '' }, links: [], email: null })).toEqual({ title: 'entity.field.titleRequired' })
    expect(validateEntityView({ title: { en: 'A', ar: '' }, links: [{ kind: 'website', url: 'notaurl' }], email: 'bad' })).toEqual({ links: 'entity.field.urlInvalid', email: 'entity.field.emailInvalid' })
    const v = normalizeExpert({ id: 'e', name_en: 'Ada Lovelace', name_ar: 'آدا', company_en: 'Acme' })
    expect(entityMatches(v, 'love')).toBe(true)
    expect(entityMatches(v, 'آدا')).toBe(true)
    expect(entityMatches(v, 'acme')).toBe(true)
    expect(entityMatches(v, 'zzz')).toBe(false)
    expect(biPick({ en: '', ar: 'ع' }, 'en')).toBe('ع')
  })
})
