import { describe, expect, it } from 'vitest'
import { canReorder, filterItems, moveItem, sortItems, DEFAULT_MANAGER_STATE } from './manager.logic.js'
import { rowsToManualFields, listItemColumns } from './export.js'
import { normalizeListItem } from '../../lib/entities.js'

const row = (id, title, extra = {}) => normalizeListItem({ item_id: id, source: { kind: 'manual', id: null, state: 'ok' }, display: { title_en: title }, overlay: {}, ...extra }, 'expert')
const items = [
  row('a', 'Zed', { status: 'confirmed', sort_order: 1 }),
  normalizeListItem({ item_id: null, source: { kind: 'form_response', id: 'r', state: 'ok' }, display: { title_en: 'Amy' }, overlay: { notes: 'call her' }, status: null }, 'expert'),
  row('c', 'Mid', { status: 'pending', excluded: true }),
]

describe('manager.logic', () => {
  it('filters by term (title + notes), status, source and hidden flag', () => {
    expect(filterItems(items, DEFAULT_MANAGER_STATE).map((i) => i.id)).toEqual(['a', 'virtual:form_response:r'])
    expect(filterItems(items, { ...DEFAULT_MANAGER_STATE, showHidden: true })).toHaveLength(3)
    expect(filterItems(items, { ...DEFAULT_MANAGER_STATE, term: 'call' }).map((i) => i.id)).toEqual(['virtual:form_response:r'])
    expect(filterItems(items, { ...DEFAULT_MANAGER_STATE, status: 'confirmed' }).map((i) => i.id)).toEqual(['a'])
    expect(filterItems(items, { ...DEFAULT_MANAGER_STATE, status: '__none' }).map((i) => i.id)).toEqual(['virtual:form_response:r'])
    expect(filterItems(items, { ...DEFAULT_MANAGER_STATE, source: 'form_response' })).toHaveLength(1)
  })

  it('sorts by title with a locale collator, by configured status order, newest first; manual keeps order', () => {
    expect(sortItems(items, 'title', 'en').map((i) => i.entity.title.en)).toEqual(['Amy', 'Mid', 'Zed'])
    expect(sortItems(items, 'status', 'en', ['pending', 'confirmed']).map((i) => i.id)).toEqual(['c', 'a', 'virtual:form_response:r'])
    expect(sortItems(items, 'newest').map((i) => i.id)).toEqual(['c', 'virtual:form_response:r', 'a'])
    expect(sortItems(items, 'manual').map((i) => i.id)).toEqual(['a', 'virtual:form_response:r', 'c'])
  })

  it('reorder is only allowed on the full, unfiltered, manually-sorted list (docs/03 7.3 bug must not come back)', () => {
    expect(canReorder(DEFAULT_MANAGER_STATE)).toBe(true)
    expect(canReorder({ ...DEFAULT_MANAGER_STATE, term: 'x' })).toBe(false)
    expect(canReorder({ ...DEFAULT_MANAGER_STATE, sort: 'title' })).toBe(false)
    expect(canReorder({ ...DEFAULT_MANAGER_STATE, status: 'confirmed' })).toBe(false)
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    const same = [1, 2]
    expect(moveItem(same, 0, 5)).toBe(same)
  })

  it('Excel import maps header aliases and skips rows without a name', () => {
    const rows = [
      { Name: 'Ada', 'Job title': 'CTO', Company: 'Acme', Email: 'a@x.io', LinkedIn: 'https://l.in/a' },
      { Name: '', Email: 'nobody@x.io' },
      { 'الاسم': 'سارة', 'المسمى الوظيفي': 'مديرة' },
      { Company: 'Only Co', Industry: 'Agri' },
    ]
    expect(rowsToManualFields(rows)).toEqual([
      { title_en: 'Ada', subtitle_en: 'CTO', organization_en: 'Acme', email: 'a@x.io', linkedin_url: 'https://l.in/a' },
      { title_ar: 'سارة', subtitle_ar: 'مديرة' },
      { title_en: 'Only Co', subtitle_en: 'Agri' },
    ])
  })

  it('export columns include custom overlay fields and derive values from the item view', () => {
    const cols = listItemColumns((k) => k, { overlayFields: [{ key: 'table_no', label: { en: 'Table', ar: '' } }] })
    const headers = cols.map((c) => c.header)
    expect(headers).toContain('Table')
    const r = row('a', 'Zed', { status: 'confirmed', overlay: { notes: 'n', table_no: 7 } })
    const value = (h) => cols.find((c) => c.header === h).key(r)
    expect(value('entity.field.title (EN)')).toBe('Zed')
    expect(value('entity.manager.col.status')).toBe('confirmed')
    expect(value('Table')).toBe(7)
    expect(value('entity.manager.col.source')).toBe('entity.source.manual')
  })
})
