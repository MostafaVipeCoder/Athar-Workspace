/**
 * Resource Library logic (design 01 section 3.8, 04 section 3.11): pure, unit-tested, no React and no Supabase.
 * ONE row shape for the PM tables and the public payload (`resources` columns): `fromRow` turns it into the draft/view
 * model, `toChildren` turns the draft back into the `save_node` children (`app_private.save_children_library`).
 */

import { FILE_ACCEPT, FILE_TYPES, MAX_FILE_BYTES, MAX_IMAGE_SOURCE_BYTES, isImageMime, mimeOf, thumbOf, uuid, validateFile } from '../../lib/resourceFiles.js'
export { FILE_ACCEPT, FILE_TYPES, MAX_FILE_BYTES, MAX_IMAGE_SOURCE_BYTES, isImageMime, mimeOf, thumbOf, uuid, validateFile }

export const RESOURCE_TYPES = ['readable', 'audible', 'visual', 'link']
export const RESOURCE_VISIBILITY = ['public', 'participants', 'hidden']
export const LAYOUTS = ['grid', 'list']
export const GROUP_BY = ['auto', 'category', 'type', 'none']

const trimmed = (s) => String(s ?? '').trim()

export const typeFromMime = (mime) => {
  const m = String(mime ?? '')
  if (m.startsWith('audio/')) return 'audible'
  if (m.startsWith('video/') || m.startsWith('image/')) return 'visual'
  return 'readable'
}

export const isHttpUrl = (v) => {
  const s = trimmed(v)
  if (!/^https?:\/\//i.test(s) || s.length > 2000) return false
  try { return Boolean(new URL(s).hostname) } catch { return false }
}

/** A sensible default type for a pasted link (editable): video hosts -> visual, audio -> audible, documents -> readable. */
export function typeFromUrl(url) {
  const s = trimmed(url).toLowerCase()
  if (!s) return 'link'
  if (/(youtube\.com|youtu\.be|vimeo\.com|loom\.com|\.mp4($|\?))/.test(s)) return 'visual'
  if (/(soundcloud\.com|spotify\.com|podcasts\.apple\.com|\.mp3($|\?)|\.m4a($|\?))/.test(s)) return 'audible'
  if (/(docs\.google\.com|drive\.google\.com\/file|\.pdf($|\?)|\.docx?($|\?)|\.pptx?($|\?)|\.xlsx?($|\?)|slideshare\.net|scribd\.com)/.test(s)) return 'readable'
  return 'link'
}

export function hostOf(url) {
  try { return new URL(trimmed(url)).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Download file name: the title (as typed) + the stored extension. */
export function downloadName(resource, lang = 'en') {
  const base = (lang === 'ar' ? resource.title?.ar || resource.title?.en : resource.title?.en || resource.title?.ar) || 'resource'
  const ext = FILE_TYPES[resource.mime] ?? /\.([a-z0-9]+)$/i.exec(resource.filePath ?? '')?.[1] ?? ''
  const printable = [...base].filter((ch) => ch.charCodeAt(0) >= 32).join('')
  const safe = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'resource'
  return ext && !safe.toLowerCase().endsWith(`.${ext}`) ? `${safe}.${ext}` : safe
}

export function formatBytes(n, lang = 'en') {
  const bytes = Number(n)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب'] : ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  const num = v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10
  return `${num} ${units[i]}`
}

// ------------------------------------------------------------------ config
export const defaultLibraryConfig = () => ({ layout: 'grid', groupBy: 'auto', searchEnabled: true })

/** Tolerant of the migrated `{}`; unknown keys are kept untouched so a save never drops them. */
export function normalizeLibraryConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    ...c,
    layout: LAYOUTS.includes(c.layout) ? c.layout : 'grid',
    groupBy: GROUP_BY.includes(c.groupBy) ? c.groupBy : 'auto',
    searchEnabled: typeof c.searchEnabled === 'boolean' ? c.searchEnabled : true,
  }
}

// ------------------------------------------------------------------ rows <-> model
/** A `resources` row (PM table read or public payload row) -> the model used by the editor and the viewer. */
export function fromRow(row) {
  const filePath = row?.file_path ?? null
  return {
    id: row.id,
    categoryId: row.category_id ?? null,
    title: { en: row.title_en ?? '', ar: row.title_ar ?? '' },
    description: { en: row.description_en ?? '', ar: row.description_ar ?? '' },
    type: RESOURCE_TYPES.includes(row.type) ? row.type : 'link',
    visibility: RESOURCE_VISIBILITY.includes(row.visibility) ? row.visibility : 'public',
    url: row.url ?? '',
    filePath,
    hasFile: Boolean(filePath ?? row.has_file),
    mime: row.mime ?? null,
    bytes: row.bytes ?? null,
    coverPath: row.cover_path ?? null,
    sortOrder: row.sort_order ?? 0,
  }
}
export const fromCategoryRow = (row) => ({ id: row.id, name: { en: row.name_en ?? '', ar: row.name_ar ?? '' } })

export function emptyResource(over = {}) {
  return { id: uuid(), categoryId: null, title: { en: '', ar: '' }, description: { en: '', ar: '' }, type: 'link', visibility: 'public', url: '', filePath: null, hasFile: false, mime: null, bytes: null, coverPath: null, sortOrder: 0, ...over }
}
export const emptyCategory = (name = { en: '', ar: '' }) => ({ id: uuid(), name })

/** The `save_node` children (order = array position; blank bilingual halves become null on the server). */
export function toChildren(categories, resources) {
  return {
    categories: categories.map((c, i) => ({ id: c.id, name_en: trimmed(c.name.en) || null, name_ar: trimmed(c.name.ar) || null, sort_order: i + 1 })),
    resources: resources.map((r, i) => ({
      id: r.id,
      category_id: r.categoryId && categories.some((c) => c.id === r.categoryId) ? r.categoryId : null,
      title_en: trimmed(r.title.en) || null,
      title_ar: trimmed(r.title.ar) || null,
      description_en: trimmed(r.description.en) || null,
      description_ar: trimmed(r.description.ar) || null,
      type: r.type,
      visibility: r.visibility,
      url: r.filePath ? null : trimmed(r.url) || null,
      file_path: r.filePath || null,
      mime: r.filePath ? r.mime : null,
      bytes: r.filePath ? r.bytes : null,
      cover_path: r.coverPath || null,
      sort_order: i + 1,
    })),
  }
}

/** Per-row validation -> { [id]: { title?, url?, source? } } (translation key suffixes under `library.err.*`); categories use `cat:<id>`. */
export function validateLibrary(categories, resources) {
  const errors = {}
  for (const c of categories) if (!trimmed(c.name.en) && !trimmed(c.name.ar)) errors[`cat:${c.id}`] = { name: 'name' }
  for (const r of resources) {
    const e = {}
    if (!trimmed(r.title.en) && !trimmed(r.title.ar)) e.title = 'title'
    if (!r.filePath) {
      if (!trimmed(r.url)) e.source = 'source'
      else if (!isHttpUrl(r.url)) e.url = 'url'
    }
    if (Object.keys(e).length) errors[r.id] = e
  }
  return errors
}

/** Stable reorder helper (clamped). */
export function moveItem(list, from, to) {
  if (from < 0 || from >= list.length) return list
  const target = Math.max(0, Math.min(list.length - 1, to))
  if (target === from) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(target, 0, x)
  return next
}

/** Paths a resource holds in the private bucket (the file and, for an image, its derived thumbnail). */
export function filePathsOf(r) {
  if (!r?.filePath) return []
  return isImageMime(r.mime) ? [r.filePath, thumbOf(r.filePath)] : [r.filePath]
}

// ------------------------------------------------------------------ viewer helpers
export const resourceTitle = (r, lang) => (lang === 'ar' ? r.title.ar || r.title.en : r.title.en || r.title.ar) || ''
export const resourceDescription = (r, lang) => (lang === 'ar' ? r.description.ar || r.description.en : r.description.en || r.description.ar) || ''
export const categoryName = (c, lang) => (lang === 'ar' ? c.name.ar || c.name.en : c.name.en || c.name.ar) || ''

/** Search (title + description in BOTH languages, null-safe: docs/03 section 7.5) and type filter. */
export function filterResources(resources, { query = '', type = 'all', categoryId = 'all' } = {}) {
  const q = trimmed(query).toLowerCase()
  return resources.filter((r) => {
    if (type !== 'all' && r.type !== type) return false
    if (categoryId !== 'all' && (categoryId === 'none' ? r.categoryId : r.categoryId !== categoryId)) return false
    if (!q) return true
    return [r.title.en, r.title.ar, r.description.en, r.description.ar, hostOf(r.url)].some((s) => String(s ?? '').toLowerCase().includes(q))
  })
}

/** Counts per type over a list (the filter chips). */
export function typeCounts(resources) {
  const counts = { all: resources.length }
  for (const t of RESOURCE_TYPES) counts[t] = resources.filter((r) => r.type === t).length
  return counts
}

/**
 * Grouping of the (already filtered) resources: `auto` = by category when the node has categories (uncategorised last under
 * "Other"), else by type (the as-is viewer); `category`/`type`/`none` force one. Empty groups are dropped; the order inside
 * a group is the PM order.
 */
export function groupResources(resources, categories, groupBy = 'auto') {
  const mode = groupBy === 'auto' ? (categories.length ? 'category' : 'type') : groupBy
  if (mode === 'none') return [{ key: 'all', kind: 'all', items: resources }]
  if (mode === 'type') {
    return RESOURCE_TYPES.map((t) => ({ key: `type:${t}`, kind: 'type', type: t, items: resources.filter((r) => r.type === t) })).filter((g) => g.items.length)
  }
  const groups = categories.map((c) => ({ key: `cat:${c.id}`, kind: 'category', category: c, items: resources.filter((r) => r.categoryId === c.id) }))
  groups.push({ key: 'cat:none', kind: 'other', items: resources.filter((r) => !r.categoryId || !categories.some((c) => c.id === r.categoryId)) })
  return groups.filter((g) => g.items.length)
}

/** Rows of the Excel index (header = the column titles, one row per resource in PM order). */
export function indexRows(resources, categories, labels, lang = 'en') {
  const cats = new Map(categories.map((c) => [c.id, categoryName(c, lang)]))
  return resources.map((r, i) => ({
    [labels.order]: i + 1,
    [labels.titleEn]: r.title.en,
    [labels.titleAr]: r.title.ar,
    [labels.descriptionEn]: r.description.en,
    [labels.descriptionAr]: r.description.ar,
    [labels.type]: labels.types[r.type] ?? r.type,
    [labels.category]: cats.get(r.categoryId) ?? '',
    [labels.visibility]: labels.visibilities[r.visibility] ?? r.visibility,
    [labels.source]: r.filePath ? labels.file : labels.link,
    [labels.url]: r.filePath ? '' : r.url,
    [labels.size]: r.bytes ?? '',
  }))
}
