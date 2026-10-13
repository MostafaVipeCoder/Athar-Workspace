import { describe, expect, it } from 'vitest'
import { defaultListConfig, humanizeKey, normalizeListConfig, statusOf, validateListConfig } from './listConfig.js'
import { CARD_FIELDS } from '../../lib/entities.js'

describe('listConfig', () => {
  it('tolerates the migrated empty config and bad values', () => {
    expect(normalizeListConfig({})).toEqual(defaultListConfig())
    const c = normalizeListConfig({ card: { showFields: ['title', 'nope'], accent: 'red', expandable: false }, statuses: [{ key: 'ok', tone: 'pink' }, { nokey: 1 }], overlayFields: [{ key: 'x', type: 'weird' }], extra: 1 })
    expect(c.card).toEqual({ showFields: ['title'], accent: null, expandable: false, hideTitleOnSingle: true })
    expect(c.statuses).toEqual([{ key: 'ok', label: { en: '', ar: '' }, tone: 'neutral' }])
    expect(c.overlayFields).toEqual([{ key: 'x', label: { en: '', ar: '' }, type: 'text', options: [] }])
    expect(c.extra).toBe(1)
    expect(normalizeListConfig(null).card.showFields).toEqual(CARD_FIELDS)
  })

  it('validates keys and card fields', () => {
    expect(validateListConfig(defaultListConfig())).toEqual({})
    expect(validateListConfig({ ...defaultListConfig(), statuses: [{ key: 'Bad Key' }] })).toEqual({ statuses: 'list.settings.keyInvalid' })
    expect(validateListConfig({ ...defaultListConfig(), statuses: [{ key: 'a' }, { key: 'a' }] })).toEqual({ statuses: 'list.settings.keyDuplicate' })
    expect(validateListConfig({ ...defaultListConfig(), overlayFields: [{ key: 'notes' }] })).toEqual({ overlayFields: 'list.settings.keyInvalid' })
    expect(validateListConfig({ ...defaultListConfig(), card: { showFields: [] } })).toEqual({ card: 'list.settings.showFieldsEmpty' })
  })

  it('statusOf falls back to a neutral badge for unknown values', () => {
    const cfg = normalizeListConfig({ statuses: [{ key: 'ok', label: { en: 'OK', ar: '' }, tone: 'green' }] })
    expect(statusOf(cfg, 'ok').tone).toBe('green')
    expect(statusOf(cfg, 'legacy')).toEqual({ key: 'legacy', label: { en: 'legacy', ar: 'legacy' }, tone: 'neutral' })
    expect(statusOf(cfg, null)).toBeNull()
    expect(humanizeKey('on_hold')).toBe('On hold')
  })
})
