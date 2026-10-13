import { parseHHMM, formatHHMM } from '../../lib/time/slots.js'

/**
 * Pure helpers of the Dynamic Agenda node (design 01 section 3.1, 02 section 4, 04 section 3.11). No React, no data access.
 *
 * Config (`nodes.config`), tolerant of the migrated shape (m19: `header` = the legacy `header_settings` minus the
 * expert-list keys, `showDayNames`, `headerHeight`, `backgroundPath`, `footerPath`, `legacySheetUrl`):
 * {
 *   showDayNames: boolean,
 *   header: { visible, type: 'image'|'color', color, height: 'sm'|'md'|'lg', title: {en, ar}, titleColor, dim: 0..0.8, brandName },
 *   theme: { accent: '#rrggbb' | null },
 *   footerPath, backgroundPath, legacySheetUrl   // kept as stored (never written by the editor, never public except footerPath)
 * }
 * The agenda COVER is the project cover (08 decision 01-2): it lives on `projects.cover_path`, not here.
 *
 * Client models (the editor draft): Day = { id, date: 'YYYY-MM-DD'|'', name: {en, ar}, slots: Slot[] },
 * Slot = { id, start: 'HH:MM', end: 'HH:MM', title: {en, ar}, presenter: {en, ar}, showPresenter, bullets: [{en, ar}], presenterItemId }.
 * Ids that are not uuids are client-only (new rows): they are dropped on save so the DB generates the id.
 */
export const HEADER_HEIGHTS = ['sm', 'md', 'lg']
export const HEADER_TYPES = ['image', 'color']
export const DEFAULT_HEADER = Object.freeze({ visible: true, type: 'image', color: '#1a27c9', height: 'md', title: { en: '', ar: '' }, titleColor: '#ffffff', dim: 0.3, brandName: '' })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_RE = /^#[0-9a-f]{6}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const text = (v) => (v === null || v === undefined ? '' : String(v))
const bi = (v) => (v && typeof v === 'object' ? { en: text(v.en), ar: text(v.ar) } : { en: text(v), ar: '' })
export const isUuid = (v) => UUID_RE.test(String(v ?? ''))
export const newId = () => `new-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
const hex = (v, fallback) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : fallback)

export const defaultAgendaConfig = () => ({ showDayNames: true, header: { ...DEFAULT_HEADER, title: { en: '', ar: '' } }, theme: { accent: null } })

/** Legacy `headerHeight` ('12rem', '16rem', '24rem'...) -> the three named sizes. */
function heightOf(h, legacy) {
  if (HEADER_HEIGHTS.includes(h)) return h
  const m = /^(\d+(?:\.\d+)?)\s*(rem|px)?$/.exec(String(legacy ?? h ?? '').trim())
  if (!m) return 'md'
  const rem = m[2] === 'px' ? Number(m[1]) / 16 : Number(m[1])
  return rem <= 12 ? 'sm' : rem <= 18 ? 'md' : 'lg'
}
function dimOf(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_HEADER.dim
  const d = n > 1 ? n / 100 : n
  return Math.min(0.8, Math.max(0, Math.round(d * 100) / 100))
}

/** Tolerant read of a stored config; unknown keys are kept for forward compatibility. */
export function normalizeAgendaConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const h = c.header && typeof c.header === 'object' ? c.header : {}
  const legacyTitle = h.title ?? h.overlayTitle?.text ?? (h.titleText || h.titleTextAr ? { en: h.titleText, ar: h.titleTextAr } : '')
  const theme = c.theme && typeof c.theme === 'object' ? c.theme : {}
  return {
    ...c,
    showDayNames: c.showDayNames !== false,
    header: {
      ...h,
      visible: h.visible !== false,
      type: HEADER_TYPES.includes(h.type) ? h.type : 'image',
      color: hex(h.color ?? h.bgColor, DEFAULT_HEADER.color),
      height: heightOf(h.height, c.headerHeight),
      title: bi(legacyTitle),
      titleColor: hex(h.titleColor ?? h.overlayTitle?.color, DEFAULT_HEADER.titleColor),
      dim: dimOf(h.dim ?? h.overlayDim ?? h.dimming ?? DEFAULT_HEADER.dim),
      brandName: text(h.brandName ?? h.brand),
    },
    theme: { accent: hex(theme.accent, null) }, // stored values outside PROFILE_COLORS still render (same rule as lists)
    footerPath: typeof c.footerPath === 'string' && c.footerPath ? c.footerPath : null,
  }
}

// ------------------------------------------------------------------ rows <-> client models
const bulletsOf = (raw) => (Array.isArray(raw) ? raw.map((b) => (b && typeof b === 'object' ? { en: text(b.en), ar: text(b.ar) } : { en: text(b), ar: '' })).filter((b) => b.en || b.ar) : [])
/** 'HH:MM:SS' (DB `time`) or 'HH:MM' -> 'HH:MM'; malformed -> '' (never a silent 00:00). */
export const toHHMM = (v) => {
  const m = parseHHMM(v)
  return m === null ? '' : formatHHMM(m)
}

export function fromSlotRow(r) {
  return {
    id: r.id ?? newId(),
    start: toHHMM(r.start_time),
    end: toHHMM(r.end_time),
    title: { en: text(r.title_en), ar: text(r.title_ar) },
    presenter: { en: text(r.presenter_en), ar: text(r.presenter_ar) },
    showPresenter: r.show_presenter !== false,
    bullets: bulletsOf(r.bullets),
    presenterItemId: r.presenter_item_id ?? null,
  }
}
export function fromDayRow(r, slots = []) {
  return { id: r.id ?? newId(), date: DATE_RE.test(text(r.day_date)) ? r.day_date : '', name: { en: text(r.name_en), ar: text(r.name_ar) }, slots: slots.map(fromSlotRow) }
}
export const emptySlot = (over = {}) => ({ id: newId(), start: '', end: '', title: { en: '', ar: '' }, presenter: { en: '', ar: '' }, showPresenter: true, bullets: [], presenterItemId: null, ...over })
export const emptyDay = (over = {}) => ({ id: newId(), date: '', name: { en: '', ar: '' }, slots: [], ...over })

const nn = (s) => (text(s).trim() ? text(s).trim() : null)

/** The `children` payload of save_node (app_private.save_children_agenda): client-only ids are dropped. */
export function toChildren(days) {
  return {
    days: (days ?? []).map((d, i) => ({
      ...(isUuid(d.id) ? { id: d.id } : {}),
      sort_order: i + 1,
      day_date: d.date || null,
      name_en: nn(d.name?.en),
      name_ar: nn(d.name?.ar),
      slots: (d.slots ?? []).map((s, j) => ({
        ...(isUuid(s.id) ? { id: s.id } : {}),
        sort_order: j + 1,
        start_time: s.start,
        end_time: s.end,
        title_en: nn(s.title?.en),
        title_ar: nn(s.title?.ar),
        presenter_en: nn(s.presenter?.en),
        presenter_ar: nn(s.presenter?.ar),
        presenter_item_id: s.presenterItemId ?? null,
        show_presenter: s.showPresenter !== false,
        bullets: (s.bullets ?? []).map((b) => ({ en: text(b.en).trim(), ar: text(b.ar).trim() })).filter((b) => b.en || b.ar),
      })),
    })),
  }
}

// ------------------------------------------------------------------ validation (fixes docs/03 section 7 #6: minutes, never string compare)
/** Returns { [dayId]: messageKey, [slotId]: messageKey } (empty = valid). Keys are `agenda.err.*`. */
export function validateAgenda(days) {
  const errors = {}
  const dates = new Set()
  for (const d of days ?? []) {
    if (d.date && !DATE_RE.test(d.date)) errors[d.id] = 'agenda.err.date'
    else if (d.date && dates.has(d.date)) errors[d.id] = 'agenda.err.dateDuplicate'
    if (d.date) dates.add(d.date)
    if (!text(d.name?.en).trim() && !text(d.name?.ar).trim() && !d.date) errors[d.id] = 'agenda.err.dayEmpty'
    for (const s of d.slots ?? []) {
      const a = parseHHMM(s.start)
      const b = parseHHMM(s.end)
      if (a === null || b === null) errors[s.id] = 'agenda.err.time'
      else if (b <= a) errors[s.id] = 'agenda.err.endAfterStart'
      else if (!text(s.title?.en).trim() && !text(s.title?.ar).trim()) errors[s.id] = 'agenda.err.title'
    }
  }
  return errors
}

// ------------------------------------------------------------------ editing operations
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  return next
}
/** Slots of a day sorted by start time (stable for equal starts); used by "sort by time" and after a shift. */
export const sortSlots = (slots) => [...slots].map((s, i) => [s, i]).sort(([a, i], [b, j]) => ((parseHHMM(a.start) ?? 9999) - (parseHHMM(b.start) ?? 9999)) || i - j).map(([s]) => s)

export const copySlot = (s, suffix = '') => ({ ...s, id: newId(), presenterItemId: s.presenterItemId ?? null, title: { en: s.title.en ? `${s.title.en}${suffix ? ` ${suffix}` : ''}` : '', ar: s.title.ar ? `${s.title.ar}${suffix ? ` ${suffix}` : ''}` : '' }, presenter: { ...s.presenter }, bullets: s.bullets.map((b) => ({ ...b })) })
/** Duplicate a slot right after itself (fresh id, no title suffix: a duplicated session usually keeps its name). */
export function duplicateSlot(slots, id) {
  const i = slots.findIndex((s) => s.id === id)
  if (i < 0) return slots
  const next = [...slots]
  next.splice(i + 1, 0, copySlot(slots[i]))
  return next
}
/** Duplicate a day right after itself: fresh ids for the day and all its slots, no date (two days cannot share one). */
export function duplicateDay(days, id, suffix = { en: '(copy)', ar: '(نسخة)' }) {
  const i = days.findIndex((d) => d.id === id)
  if (i < 0) return days
  const src = days[i]
  const copy = { ...src, id: newId(), date: '', name: { en: src.name.en ? `${src.name.en} ${suffix.en}` : '', ar: src.name.ar ? `${src.name.ar} ${suffix.ar}` : '' }, slots: src.slots.map((s) => copySlot(s)) }
  const next = [...days]
  next.splice(i + 1, 0, copy)
  return next
}
/** As-is "shift +/-1h": move every valid slot of the day by `minutes`, clamped inside the day (never wraps past midnight). */
export function shiftSlots(slots, minutes) {
  const valid = slots.filter((s) => parseHHMM(s.start) !== null && parseHHMM(s.end) !== null)
  if (!valid.length) return slots
  const min = Math.min(...valid.map((s) => parseHHMM(s.start)))
  const max = Math.max(...valid.map((s) => parseHHMM(s.end)))
  const delta = Math.max(-min, Math.min(1439 - max, minutes))
  if (delta === 0) return slots
  return slots.map((s) => (parseHHMM(s.start) === null || parseHHMM(s.end) === null ? s : { ...s, start: formatHHMM(parseHHMM(s.start) + delta), end: formatHHMM(parseHHMM(s.end) + delta) }))
}

// ------------------------------------------------------------------ Excel import (08 decision 01-9: Excel only; staged into the draft, saved explicitly)
const norm = (s) => text(s).toLowerCase().replace(/[\s_()/:-]+/g, '')
const DAY_SHEETS = ['days', 'الأيام', 'ايام']
const SLOT_SHEETS = ['agendaslots', 'slots', 'agenda', 'الجدول', 'الأجندة']
const COLS = {
  dayName: ['dayname', 'day', 'name', 'اليوم', 'اسماليوم'],
  dayNameAr: ['daynamear', 'daynamearabic', 'namear', 'اليومبالعربية', 'الاسمبالعربية'],
  date: ['dateyyyymmdd', 'date', 'daydate', 'التاريخ'],
  title: ['slottitle', 'title', 'session', 'العنوان', 'الجلسة'],
  titleAr: ['slottitlear', 'titlear', 'titlearabic', 'العنوانبالعربية'],
  start: ['starttimehhmm', 'starttime', 'start', 'from', 'البداية', 'من'],
  end: ['endtimehhmm', 'endtime', 'end', 'to', 'النهاية', 'إلى', 'الى'],
  presenter: ['presentername', 'presenter', 'speaker', 'المتحدث', 'المقدم'],
  presenterAr: ['presenternamear', 'presenterar', 'speakerar', 'المتحدثبالعربية'],
  showPresenter: ['showpresentertruefalse', 'showpresenter', 'إظهارالمتحدث'],
  bullets: ['bullets', 'bulletpoints', 'points', 'details', 'النقاط', 'التفاصيل'],
  bulletsAr: ['bulletsar', 'bulletpointsar', 'pointsar', 'النقاطبالعربية'],
}
function cell(row, key) {
  const wanted = COLS[key]
  for (const [k, v] of Object.entries(row ?? {})) if (wanted.includes(norm(k)) && v !== null && v !== undefined && text(v).trim() !== '') return v
  return ''
}
function findSheet(sheets, names) {
  const keys = Object.keys(sheets ?? {})
  return keys.find((k) => names.includes(norm(k))) ?? null
}
const pad2 = (n) => String(n).padStart(2, '0')
/** Excel date cell -> 'YYYY-MM-DD': Date objects (cellDates), serial numbers, ISO strings, d/m/yyyy. Anything else -> ''. */
export function excelDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return Number.isNaN(d.getTime()) ? '' : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  }
  const s = text(v).trim()
  if (DATE_RE.test(s)) return s
  if (/^\d+(\.\d+)?$/.test(s)) return excelDate(Number(s))
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (dmy) return `${dmy[3]}-${pad2(dmy[2])}-${pad2(dmy[1])}`
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s)
  if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`
  return ''
}
/** Excel time cell -> 'HH:MM': 'HH:MM[:SS]', '9:00 AM/PM', '9 ص/م', fractions of a day, Date objects. Malformed -> ''. */
export function excelTime(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${pad2(v.getHours())}:${pad2(v.getMinutes())}`
  if (typeof v === 'number' && Number.isFinite(v)) {
    const frac = v - Math.floor(v)
    return formatHHMM(Math.round(frac * 1440))
  }
  const s = text(v).trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م)$/i.exec(s)
  if (ampm) {
    let h = Number(ampm[1]) % 12
    if (/pm|م/i.test(ampm[3])) h += 12
    const mi = Number(ampm[2] ?? 0)
    return h > 23 || mi > 59 ? '' : `${pad2(h)}:${pad2(mi)}`
  }
  return toHHMM(s)
}
const truthy = (v) => (v === '' || v === null || v === undefined ? true : !/^(false|0|no|لا)$/i.test(text(v).trim()))
const splitLines = (v) => text(v).split(/\r?\n|;|\|/).map((x) => x.trim()).filter(Boolean)

/**
 * `sheets` = lib/export/xlsx.parseWorkbook output ({ [sheet]: rows[] }). Sheets "Days" (Day Name, Date) and "Agenda Slots"
 * (Day Name, Slot Title, Start Time, End Time, Presenter Name, Show Presenter + optional Arabic/bullets columns), as the
 * as-is template; a slot whose day is not in "Days" creates that day (without date). Returns { days: Day[], warnings[] }.
 */
export function parseAgendaSheets(sheets) {
  const warnings = []
  const daysSheet = findSheet(sheets, DAY_SHEETS)
  const slotsSheet = findSheet(sheets, SLOT_SHEETS)
  if (!daysSheet && !slotsSheet) return { days: [], warnings: ['agenda.import.noSheets'] }
  const days = []
  const byName = new Map()
  const dayFor = (name, create = true) => {
    const key = norm(name)
    if (byName.has(key)) return byName.get(key)
    if (!create) return null
    const d = emptyDay({ name: { en: text(name).trim(), ar: '' } })
    byName.set(key, d)
    days.push(d)
    return d
  }
  for (const row of sheets[daysSheet] ?? []) {
    const name = text(cell(row, 'dayName')).trim()
    const date = excelDate(cell(row, 'date'))
    if (!name && !date) continue
    const d = dayFor(name || date)
    d.name = { en: name, ar: text(cell(row, 'dayNameAr')).trim() }
    if (cell(row, 'date') && !date) warnings.push(`agenda.import.badDate:${name}`)
    d.date = date
  }
  let skipped = 0
  for (const row of sheets[slotsSheet] ?? []) {
    const dayName = text(cell(row, 'dayName')).trim()
    const title = text(cell(row, 'title')).trim()
    const titleAr = text(cell(row, 'titleAr')).trim()
    if (!dayName || (!title && !titleAr)) {
      if (dayName || title || titleAr) skipped += 1
      continue
    }
    const d = dayFor(dayName)
    d.slots.push(emptySlot({
      start: excelTime(cell(row, 'start')),
      end: excelTime(cell(row, 'end')),
      title: { en: title, ar: titleAr },
      presenter: { en: text(cell(row, 'presenter')).trim(), ar: text(cell(row, 'presenterAr')).trim() },
      showPresenter: truthy(cell(row, 'showPresenter')),
      bullets: (() => {
        const en = splitLines(cell(row, 'bullets'))
        const ar = splitLines(cell(row, 'bulletsAr'))
        return Array.from({ length: Math.max(en.length, ar.length) }, (_, i) => ({ en: en[i] ?? '', ar: ar[i] ?? '' }))
      })(),
    }))
  }
  if (skipped) warnings.push(`agenda.import.skipped:${skipped}`)
  return { days, warnings }
}

/** Merge imported days into the draft: 'replace' discards the draft, 'append' adds days (same-name days receive the slots). */
export function mergeImportedDays(current, imported, mode = 'append') {
  if (mode === 'replace') return imported
  const out = current.map((d) => ({ ...d, slots: [...d.slots] }))
  for (const d of imported) {
    const hit = out.find((x) => (d.date && x.date === d.date) || (norm(x.name.en) && norm(x.name.en) === norm(d.name.en)))
    if (hit) {
      hit.slots.push(...d.slots)
      if (!hit.date && d.date) hit.date = d.date
      if (!hit.name.ar && d.name.ar) hit.name.ar = d.name.ar
    } else out.push(d)
  }
  return out
}

/** Excel export: the two sheets of the template, bilingual columns included. */
export function agendaSheets(days) {
  const dayRows = (days ?? []).map((d) => ({ 'Day Name': d.name.en, 'Day Name AR': d.name.ar, 'Date (YYYY-MM-DD)': d.date }))
  const slotRows = (days ?? []).flatMap((d) => d.slots.map((s) => ({
    'Day Name': d.name.en || d.date, 'Slot Title': s.title.en, 'Slot Title AR': s.title.ar, 'Start Time (HH:mm)': s.start, 'End Time (HH:mm)': s.end,
    'Presenter Name': s.presenter.en, 'Presenter Name AR': s.presenter.ar, 'Show Presenter (TRUE/FALSE)': s.showPresenter ? 'TRUE' : 'FALSE',
    Bullets: s.bullets.map((b) => b.en).filter(Boolean).join('\n'), 'Bullets AR': s.bullets.map((b) => b.ar).filter(Boolean).join('\n'),
  })))
  return { Days: dayRows, 'Agenda Slots': slotRows }
}
export const TEMPLATE_SHEETS = () => agendaSheets([{ id: 't', date: '2026-01-01', name: { en: 'Day 1', ar: 'اليوم الأول' }, slots: [emptySlot({ start: '09:00', end: '10:00', title: { en: 'Sample session', ar: 'جلسة تجريبية' }, presenter: { en: 'Presenter name', ar: '' }, bullets: [{ en: 'First point', ar: 'النقطة الأولى' }] })] }])

// ------------------------------------------------------------------ public view model (payload of get_public_tab / the PM preview)
/** Days of the public payload (`data.days`, DB rows) -> the client Day model used by AgendaTab. */
export const publicDays = (rows) => (rows ?? []).map((r) => fromDayRow(r, r.slots ?? []))

/** Index of the day to open first: today in the project zone when it is one of the days, else the next upcoming day, else the first. */
export function defaultDayIndex(days, todayStr) {
  if (!days?.length) return 0
  const today = days.findIndex((d) => d.date === todayStr)
  if (today >= 0) return today
  const next = days.findIndex((d) => d.date && d.date > todayStr)
  return next >= 0 ? next : 0
}
/** Live state of a day: { isToday, nowIndex (slot containing now, or null), nextIndex (first slot after now, or null) }. */
export function liveState(day, todayStr, minutesOfDay) {
  const isToday = Boolean(day?.date) && day.date === todayStr
  if (!isToday || minutesOfDay === null || minutesOfDay === undefined) return { isToday, nowIndex: null, nextIndex: null }
  const slots = day.slots ?? []
  const nowIndex = slots.findIndex((s) => parseHHMM(s.start) !== null && parseHHMM(s.end) !== null && minutesOfDay >= parseHHMM(s.start) && minutesOfDay < parseHHMM(s.end))
  const nextIndex = slots.findIndex((s) => parseHHMM(s.start) !== null && parseHHMM(s.start) > minutesOfDay)
  return { isToday, nowIndex: nowIndex === -1 ? null : nowIndex, nextIndex: nextIndex === -1 ? null : nextIndex }
}

// ------------------------------------------------------------------ host tabs (get_agenda_view -> URL slugs)
const slugify = (s) => text(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const FIXED_SLUG = { agenda: 'agenda', 'library-tab': 'library', 'landing-tab': 'landing', 'sessions-tab': 'distribution', 'my-meetings-tab': 'my-meetings', 'booking-tab': 'booking', 'results-tab': 'results' }
/**
 * Adds a stable URL `slug` to each tab of get_agenda_view (deep link per tab): the agenda tab is `agenda`; a list tab
 * takes its English title ("Experts" -> `experts`, which also matches the legacy /view/:id/experts redirects); other
 * views use a fixed word; collisions get `-2`, `-3`. Tabs keep the DB order.
 */
export function tabsWithSlugs(tabs) {
  const used = new Set()
  return (tabs ?? []).map((t, i) => {
    let base = t.edge_id === null && t.view_key === 'agenda' ? 'agenda' : FIXED_SLUG[t.view_key] ?? (t.type === 'list' ? slugify(t.title_en) : '') ?? ''
    if (!base) base = slugify(t.title_en) || `${slugify(t.view_key) || 'tab'}-${i + 1}`
    let slug = base
    for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`
    used.add(slug)
    return { ...t, slug }
  })
}
/** The tab a `:tab` route param points at: slug, else edge/node id, else the first tab. */
export function findTab(tabs, param) {
  if (!tabs?.length) return null
  if (!param) return tabs[0]
  const p = String(param).toLowerCase()
  return tabs.find((t) => t.slug === p) ?? tabs.find((t) => t.edge_id === param || t.node_id === param) ?? tabs.find((t) => t.view_key === p) ?? null
}

// ------------------------------------------------------------------ tab bar configuration (edges into a `tabs` port)
export const TAB_AUDIENCES = ['public', 'platform', 'participants', 'pms']
/** Edge row + pending edits -> the values shown/saved. */
export const effectiveTab = (edge, edits) => ({ label_en: edge.label_en ?? '', label_ar: edge.label_ar ?? '', is_enabled: edge.is_enabled !== false, audience: edge.audience ?? 'platform', order_index: edge.order_index ?? 0, ...(edits?.[edge.id] ?? {}) })
/** Edges into a `tabs` port sorted the way the host page orders them (02 section 4.2: order_index, then creation). */
export const sortTabs = (edges, edits) => [...edges].sort((a, b) => (effectiveTab(a, edits).order_index - effectiveTab(b, edits).order_index) || String(a.created_at ?? a.id).localeCompare(String(b.created_at ?? b.id)))
/** The update_edge patches that differ from the stored rows (nothing is written for untouched edges). */
export function tabPatches(edges, edits) {
  return Object.entries(edits ?? {}).flatMap(([edgeId, patch]) => {
    const edge = edges.find((e) => e.id === edgeId)
    if (!edge) return []
    const base = effectiveTab(edge, {})
    const diff = Object.fromEntries(Object.entries(patch).filter(([k, v]) => base[k] !== v))
    return Object.keys(diff).length ? [{ edgeId, patch: diff }] : []
  })
}

export const AGENDA_LINK_KIND = 'agenda'
export const PROJECT_LINK_KIND = 'project'
