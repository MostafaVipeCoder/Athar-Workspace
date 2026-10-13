import { describe, expect, it } from 'vitest'
import {
  agendaSheets, defaultDayIndex, duplicateDay, duplicateSlot, emptyDay, emptySlot, excelDate, excelTime, findTab, fromDayRow, liveState,
  mergeImportedDays, normalizeAgendaConfig, parseAgendaSheets, shiftSlots, sortSlots, tabPatches, tabsWithSlugs, toChildren, validateAgenda,
} from './agendaLogic.js'

const UUID = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

describe('agenda config', () => {
  it('normalises the migrated shape (legacy header keys, headerHeight, showDayNames) and keeps unknown keys', () => {
    const c = normalizeAgendaConfig({ header: { type: 'image', visible: true, fontSize: '3', fontFamily: 'font-manrope', titleText: 'Welcome', titleTextAr: 'أهلاً', overlayDim: 40, brand: 'Athar' }, headerHeight: '20rem', showDayNames: false, legacySheetUrl: 'https://x', footerPath: 'p/f.webp' })
    expect(c.showDayNames).toBe(false)
    expect(c.header).toMatchObject({ visible: true, type: 'image', height: 'lg', title: { en: 'Welcome', ar: 'أهلاً' }, dim: 0.4, brandName: 'Athar', color: '#1a27c9', titleColor: '#ffffff', fontFamily: 'font-manrope' })
    expect(c.legacySheetUrl).toBe('https://x')
    expect(c.footerPath).toBe('p/f.webp')
    expect(c.theme.accent).toBeNull()
  })
  it('defaults an empty config and validates colours/heights', () => {
    const c = normalizeAgendaConfig({ header: { color: 'red', height: '12rem', dim: 2 }, theme: { accent: '#0B75D9' } })
    expect(c.header.color).toBe('#1a27c9')
    expect(c.header.height).toBe('sm')
    expect(c.header.dim).toBe(0.02)
    expect(c.theme.accent).toBe('#0b75d9')
    expect(normalizeAgendaConfig(null).showDayNames).toBe(true)
  })
})

describe('rows <-> children', () => {
  it('reads DB rows (HH:MM:SS, bullets) and writes children with client ids dropped and uuids kept', () => {
    const day = fromDayRow({ id: UUID, sort_order: 1, day_date: '2026-11-03', name_en: 'Day 1', name_ar: null }, [{ id: UUID2, start_time: '09:00:00', end_time: '09:45:00', title_en: 'Opening', bullets: [{ en: 'a', ar: '' }, 'plain'], show_presenter: false, presenter_en: 'Ada' }])
    expect(day.slots[0]).toMatchObject({ id: UUID2, start: '09:00', end: '09:45', showPresenter: false, bullets: [{ en: 'a', ar: '' }, { en: 'plain', ar: '' }] })
    const extra = emptySlot({ start: '10:00', end: '11:00', title: { en: ' Next ', ar: '' }, bullets: [{ en: ' x ', ar: '' }, { en: '', ar: '' }] })
    const children = toChildren([{ ...day, slots: [...day.slots, extra] }, emptyDay({ name: { en: 'Day 2', ar: '' } })])
    expect(children.days[0]).toMatchObject({ id: UUID, sort_order: 1, day_date: '2026-11-03', name_en: 'Day 1', name_ar: null })
    expect(children.days[0].slots[0]).toMatchObject({ id: UUID2, sort_order: 1, start_time: '09:00', end_time: '09:45', show_presenter: false, presenter_en: 'Ada' })
    expect(children.days[0].slots[1]).not.toHaveProperty('id')
    expect(children.days[0].slots[1]).toMatchObject({ sort_order: 2, title_en: 'Next', bullets: [{ en: 'x', ar: '' }] })
    expect(children.days[1]).not.toHaveProperty('id')
    expect(children.days[1].day_date).toBeNull()
  })
  it('validates times in minutes (end > start), dates and titles', () => {
    const ok = emptyDay({ date: '2026-11-03', slots: [emptySlot({ start: '09:00', end: '09:30', title: { en: 'A', ar: '' } })] })
    expect(validateAgenda([ok])).toEqual({})
    const bad = emptyDay({ date: '2026-11-03', slots: [emptySlot({ start: '9:00', end: '09:00', title: { en: 'A', ar: '' } }), emptySlot({ start: '09:00', end: '08:30', title: { en: 'B', ar: '' } }), emptySlot({ start: '', end: '10:00', title: { en: 'C', ar: '' } }), emptySlot({ start: '10:00', end: '11:00' })] })
    const errs = validateAgenda([ok, bad, emptyDay({ date: 'nope' }), emptyDay()])
    expect(errs[bad.id]).toBe('agenda.err.dateDuplicate')
    expect(errs[bad.slots[0].id]).toBe('agenda.err.endAfterStart')
    expect(errs[bad.slots[1].id]).toBe('agenda.err.endAfterStart')
    expect(errs[bad.slots[2].id]).toBe('agenda.err.time')
    expect(errs[bad.slots[3].id]).toBe('agenda.err.title')
    expect(Object.values(errs)).toContain('agenda.err.date')
    expect(Object.values(errs)).toContain('agenda.err.dayEmpty')
  })
})

describe('editing operations', () => {
  const slots = [emptySlot({ start: '10:00', end: '11:00', title: { en: 'B', ar: '' } }), emptySlot({ start: '09:00', end: '09:30', title: { en: 'A', ar: '' } }), emptySlot({ start: '', end: '', title: { en: 'C', ar: '' } })]
  it('sorts by time (invalid times last), shifts within the day and duplicates with fresh ids', () => {
    expect(sortSlots(slots).map((s) => s.title.en)).toEqual(['A', 'B', 'C'])
    const shifted = shiftSlots(slots, -60)
    expect(shifted[1]).toMatchObject({ start: '08:00', end: '08:30' })
    expect(shifted[2].start).toBe('')
    expect(shiftSlots(slots, -600)[1].start).toBe('00:00') // clamped at midnight
    expect(shiftSlots(slots, 60 * 20)[0].end).toBe('23:59')
    const dup = duplicateSlot(slots, slots[0].id)
    expect(dup).toHaveLength(4)
    expect(dup[1].id).not.toBe(slots[0].id)
    expect(dup[1].title.en).toBe('B')
    const days = [emptyDay({ date: '2026-11-03', name: { en: 'Day 1', ar: 'اليوم 1' }, slots })]
    const dd = duplicateDay(days, days[0].id)
    expect(dd[1].date).toBe('')
    expect(dd[1].name).toEqual({ en: 'Day 1 (copy)', ar: 'اليوم 1 (نسخة)' })
    expect(dd[1].slots.map((s) => s.id)).not.toContain(slots[0].id)
  })
  it('tabPatches diffs edits against the stored edges', () => {
    const edges = [{ id: 'e1', label_en: 'Experts', is_enabled: true, audience: 'public', order_index: 1 }, { id: 'e2', label_en: null, is_enabled: true, audience: 'platform', order_index: 2 }]
    expect(tabPatches(edges, { e1: { label_en: 'Experts', order_index: 1 }, e2: { label_ar: 'الخبراء', is_enabled: false, order_index: 2 }, zz: { is_enabled: false } })).toEqual([{ edgeId: 'e2', patch: { label_ar: 'الخبراء', is_enabled: false } }])
  })
})

describe('Excel import / export', () => {
  it('parses the as-is template with aliases, serial dates, am/pm and fraction times, Arabic columns and bullets', () => {
    const sheets = {
      Days: [{ 'Day Name': 'Day 1', 'Date (YYYY-MM-DD)': '2026-01-05', 'Day Name AR': 'اليوم الأول' }, { 'Day Name': 'Day 2', Date: 46028 }, { 'Day Name': 'Day 3', Date: new Date(Date.UTC(2026, 0, 7)) }, { 'Day Name': '', Date: '' }],
      'Agenda Slots': [
        { 'Day Name': 'Day 1', 'Slot Title': 'Opening', 'Start Time (HH:mm)': '9:00 AM', 'End Time (HH:mm)': '10:00', 'Presenter Name': 'Ada', 'Show Presenter (TRUE/FALSE)': 'FALSE', Bullets: 'one\ntwo', 'Bullets AR': 'واحد' },
        { 'Day Name': 'Day 1', 'Slot Title': 'Break', 'Start Time': 0.5, 'End Time': 'bad', 'Slot Title AR': 'استراحة' },
        { 'Day Name': 'Day 9', 'Slot Title': 'Orphan', 'Start Time': '11:00:00', 'End Time': '12:00' },
        { 'Day Name': '', 'Slot Title': 'no day' },
      ],
    }
    const { days, warnings } = parseAgendaSheets(sheets)
    expect(days.map((d) => d.name.en)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 9'])
    expect(days[0]).toMatchObject({ date: '2026-01-05', name: { en: 'Day 1', ar: 'اليوم الأول' } })
    expect(days[1].date).toBe('2026-01-06')
    expect(days[2].date).toBe('2026-01-07')
    expect(days[0].slots[0]).toMatchObject({ start: '09:00', end: '10:00', title: { en: 'Opening', ar: '' }, presenter: { en: 'Ada', ar: '' }, showPresenter: false, bullets: [{ en: 'one', ar: 'واحد' }, { en: 'two', ar: '' }] })
    expect(days[0].slots[1]).toMatchObject({ start: '12:00', end: '', title: { en: 'Break', ar: 'استراحة' } })
    expect(days[3].slots[0].start).toBe('11:00')
    expect(warnings).toEqual(['agenda.import.skipped:1'])
    expect(validateAgenda(days)[days[0].slots[1].id]).toBe('agenda.err.time')
    expect(parseAgendaSheets({ Other: [] }).warnings).toEqual(['agenda.import.noSheets'])
  })
  it('date and time cell helpers', () => {
    expect(excelDate('05/01/2026')).toBe('2026-01-05')
    expect(excelDate('2026/1/5')).toBe('2026-01-05')
    expect(excelDate('tomorrow')).toBe('')
    expect(excelTime('٩:٣٠ م')).toBe('21:30')
    expect(excelTime('12:15 pm')).toBe('12:15')
    expect(excelTime('12:15 am')).toBe('00:15')
    expect(excelTime('25:00')).toBe('')
  })
  it('merges imports by name/date or replaces, and exports both sheets', () => {
    const current = [emptyDay({ date: '2026-01-05', name: { en: 'Day 1', ar: '' }, slots: [emptySlot({ start: '08:00', end: '09:00', title: { en: 'Early', ar: '' } })] })]
    const imported = [emptyDay({ date: '', name: { en: 'day 1', ar: 'اليوم 1' }, slots: [emptySlot({ start: '09:00', end: '10:00', title: { en: 'Later', ar: '' } })] }), emptyDay({ date: '2026-01-06', name: { en: 'Day 2', ar: '' } })]
    const merged = mergeImportedDays(current, imported, 'append')
    expect(merged).toHaveLength(2)
    expect(merged[0].slots.map((s) => s.title.en)).toEqual(['Early', 'Later'])
    expect(merged[0].name.ar).toBe('اليوم 1')
    expect(mergeImportedDays(current, imported, 'replace')).toBe(imported)
    const sheets = agendaSheets(merged)
    expect(Object.keys(sheets)).toEqual(['Days', 'Agenda Slots'])
    expect(sheets['Agenda Slots'][0]).toMatchObject({ 'Day Name': 'Day 1', 'Slot Title': 'Early', 'Start Time (HH:mm)': '08:00', 'Show Presenter (TRUE/FALSE)': 'TRUE' })
  })
})

describe('public view helpers', () => {
  it('opens today in the project zone, else the next upcoming day, else the first', () => {
    const days = [{ date: '2026-10-10' }, { date: '2026-10-12' }, { date: '2026-10-14' }]
    expect(defaultDayIndex(days, '2026-10-12')).toBe(1)
    expect(defaultDayIndex(days, '2026-10-13')).toBe(2)
    expect(defaultDayIndex(days, '2026-12-01')).toBe(0)
    expect(defaultDayIndex([{ date: '' }], '2026-12-01')).toBe(0)
  })
  it('marks the current and next session of today only', () => {
    const day = { date: '2026-10-12', slots: [{ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }, { start: '12:00', end: '13:00' }] }
    expect(liveState(day, '2026-10-12', 10 * 60 + 30)).toEqual({ isToday: true, nowIndex: 1, nextIndex: 2 })
    expect(liveState(day, '2026-10-12', 11 * 60 + 30)).toEqual({ isToday: true, nowIndex: null, nextIndex: 2 })
    expect(liveState(day, '2026-10-13', 10 * 60)).toEqual({ isToday: false, nowIndex: null, nextIndex: null })
  })
  it('gives every host tab a stable slug and resolves the :tab param', () => {
    const tabs = tabsWithSlugs([
      { edge_id: null, node_id: 'A', type: 'agenda', view_key: 'agenda', title_en: 'Agenda', order: -1 },
      { edge_id: 'e1', node_id: 'L1', type: 'list', view_key: 'list-tab', title_en: 'Experts', title_ar: 'الخبراء', order: 1 },
      { edge_id: 'e2', node_id: 'L2', type: 'list', view_key: 'list-tab', title_en: 'Experts', order: 2 },
      { edge_id: 'e3', node_id: 'L3', type: 'list', view_key: 'list-tab', title_en: '', title_ar: 'الشركات', order: 3 },
      { edge_id: 'e4', node_id: 'B', type: 'library', view_key: 'library-tab', title_en: 'Library', order: 4 },
    ])
    expect(tabs.map((t) => t.slug)).toEqual(['agenda', 'experts', 'experts-2', 'list-tab-4', 'library'])
    expect(findTab(tabs, 'experts-2').edge_id).toBe('e2')
    expect(findTab(tabs, 'e3').edge_id).toBe('e3')
    expect(findTab(tabs, null).slug).toBe('agenda')
    expect(findTab(tabs, 'nope')).toBeNull()
  })
})
