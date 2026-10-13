import { describe, expect, it } from 'vitest'
import {
  categoryName, defaultLibraryConfig, downloadName, emptyCategory, emptyResource, filePathsOf, filterResources, formatBytes, fromCategoryRow, fromRow, groupResources, hostOf,
  indexRows, isHttpUrl, mimeOf, moveItem, normalizeLibraryConfig, toChildren, typeCounts, typeFromMime, typeFromUrl, validateFile, validateLibrary,
} from './libraryLogic.js'

const row = (over = {}) => ({ id: 'r1', category_id: null, title_en: 'Guide', title_ar: 'دليل', description_en: null, description_ar: null, type: 'readable', visibility: 'public', url: 'https://example.com/a', file_path: null, mime: null, bytes: null, cover_path: null, sort_order: 1, ...over })
const file = (name, type, size = 1000) => ({ name, type, size })

describe('files', () => {
  it('derives the mime from the extension when the browser gives none (docx) and validates type and size', () => {
    expect(mimeOf(file('plan.DOCX', ''))).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(mimeOf(file('a.pdf', 'application/pdf'))).toBe('application/pdf')
    expect(validateFile(file('a.pdf', 'application/pdf'))).toBeNull()
    expect(validateFile(file('virus.exe', 'application/x-msdownload'))).toBe('fileType')
    expect(validateFile(file('big.pdf', 'application/pdf', 50 * 1024 * 1024 + 1))).toBe('fileSize')
    expect(validateFile(file('ok.pdf', 'application/pdf', 50 * 1024 * 1024))).toBeNull()
    expect(validateFile(file('photo.jpg', 'image/jpeg', 9 * 1024 * 1024))).toBeNull() // images are resized: 10 MB source ceiling
    expect(validateFile(file('photo.jpg', 'image/jpeg', 11 * 1024 * 1024))).toBe('fileSize')
    expect(validateFile(file('empty.pdf', 'application/pdf', 0))).toBe('fileEmpty')
    expect(validateFile(null)).toBe('fileRequired')
  })
  it('suggests a type from a mime or a pasted link', () => {
    expect(typeFromMime('audio/mpeg')).toBe('audible')
    expect(typeFromMime('video/mp4')).toBe('visual')
    expect(typeFromMime('application/pdf')).toBe('readable')
    expect(typeFromUrl('https://www.youtube.com/watch?v=1')).toBe('visual')
    expect(typeFromUrl('https://docs.google.com/document/d/1')).toBe('readable')
    expect(typeFromUrl('https://open.spotify.com/episode/1')).toBe('audible')
    expect(typeFromUrl('https://businesskhana.com/')).toBe('link')
    expect(typeFromUrl('')).toBe('link')
  })
  it('accepts only http(s) links', () => {
    expect(isHttpUrl('https://example.com/x')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('example.com')).toBe(false)
    expect(isHttpUrl('https://')).toBe(false)
    expect(hostOf('https://www.example.com/a/b')).toBe('example.com')
  })
  it('names a download after the title with the stored extension and strips unsafe characters', () => {
    expect(downloadName({ title: { en: 'Roadmap: 2026/27', ar: '' }, mime: 'application/pdf', filePath: 'p/n/x.pdf' }, 'en')).toBe('Roadmap 2026 27.pdf')
    expect(downloadName({ title: { en: '', ar: 'خطة العمل' }, mime: 'application/pdf' }, 'ar')).toBe('خطة العمل.pdf')
    expect(downloadName({ title: { en: 'Deck.pdf', ar: '' }, mime: 'application/pdf' }, 'en')).toBe('Deck.pdf')
    expect(downloadName({ title: { en: '', ar: '' }, mime: null, filePath: 'p/n/x.mp3' }, 'en')).toBe('resource.mp3')
  })
  it('formats sizes in both languages', () => {
    expect(formatBytes(426331, 'en')).toBe('416 KB')
    expect(formatBytes(6380757, 'en')).toBe('6.1 MB')
    expect(formatBytes(900, 'en')).toBe('900 B')
    expect(formatBytes(2048, 'ar')).toBe('2 ك.ب')
    expect(formatBytes(null)).toBe('')
  })
  it('lists the paths a resource holds in the private bucket (an image also has its thumbnail)', () => {
    expect(filePathsOf({ filePath: 'p/n/a.pdf', mime: 'application/pdf' })).toEqual(['p/n/a.pdf'])
    expect(filePathsOf({ filePath: 'p/n/a.webp', mime: 'image/webp' })).toEqual(['p/n/a.webp', 'p/n/a_t.webp'])
    expect(filePathsOf({ filePath: null })).toEqual([])
  })
})

describe('config', () => {
  it('is tolerant of the migrated empty config and keeps unknown keys', () => {
    expect(normalizeLibraryConfig({})).toEqual(defaultLibraryConfig())
    expect(normalizeLibraryConfig(null)).toEqual({ layout: 'grid', groupBy: 'auto', searchEnabled: true })
    expect(normalizeLibraryConfig({ layout: 'list', groupBy: 'weird', searchEnabled: false, legacy: 1 })).toEqual({ layout: 'list', groupBy: 'auto', searchEnabled: false, legacy: 1 })
  })
})

describe('rows <-> model', () => {
  it('turns a PM row and a public payload row into the same model', () => {
    const pm = fromRow(row({ visibility: 'hidden', category_id: 'c1', description_en: 'd', cover_path: 'P/library/x.webp' }))
    expect(pm).toMatchObject({ id: 'r1', categoryId: 'c1', visibility: 'hidden', title: { en: 'Guide', ar: 'دليل' }, description: { en: 'd', ar: '' }, coverPath: 'P/library/x.webp', hasFile: false })
    const pub = fromRow({ id: 'r2', title_en: 'F', type: 'readable', has_file: true, file_path: 'P/N/a.pdf', mime: 'application/pdf', bytes: 10 })
    expect(pub).toMatchObject({ visibility: 'public', filePath: 'P/N/a.pdf', hasFile: true, url: '' })
    expect(fromRow({ id: 'r3', title_en: 'x', type: 'bogus', visibility: 'bogus', url: 'https://x.y' })).toMatchObject({ type: 'link', visibility: 'public' })
    expect(fromCategoryRow({ id: 'c1', name_en: 'A', name_ar: null })).toEqual({ id: 'c1', name: { en: 'A', ar: '' } })
  })
  it('toChildren keeps order, drops a dangling category and the url of a file resource, blanks become null', () => {
    const cats = [{ id: 'c1', name: { en: ' Guides ', ar: '' } }]
    const a = { ...fromRow(row({ id: 'a', category_id: 'c1' })), url: 'https://example.com/a' }
    const b = { ...fromRow(row({ id: 'b', category_id: 'gone', file_path: 'P/N/b.pdf', mime: 'application/pdf', bytes: 5, url: null })), url: 'https://ignored' }
    const out = toChildren(cats, [a, b])
    expect(out.categories).toEqual([{ id: 'c1', name_en: 'Guides', name_ar: null, sort_order: 1 }])
    expect(out.resources[0]).toMatchObject({ id: 'a', category_id: 'c1', url: 'https://example.com/a', file_path: null, mime: null, bytes: null, sort_order: 1, description_en: null })
    expect(out.resources[1]).toMatchObject({ id: 'b', category_id: null, url: null, file_path: 'P/N/b.pdf', mime: 'application/pdf', bytes: 5, sort_order: 2 })
  })
  it('validates titles, links and sources per row, and category names', () => {
    const cats = [emptyCategory(), { id: 'c2', name: { en: 'x', ar: '' } }]
    const ok = emptyResource({ title: { en: 'T', ar: '' }, url: 'https://e.com' })
    const noTitle = emptyResource({ url: 'https://e.com' })
    const badUrl = emptyResource({ title: { en: 'T', ar: '' }, url: 'javascript:alert(1)' })
    const noSource = emptyResource({ title: { en: '', ar: 'ع' } })
    const file = emptyResource({ title: { en: 'F', ar: '' }, filePath: 'P/N/f.pdf', mime: 'application/pdf', bytes: 1 })
    const errs = validateLibrary(cats, [ok, noTitle, badUrl, noSource, file])
    expect(errs[`cat:${cats[0].id}`]).toEqual({ name: 'name' })
    expect(errs[`cat:c2`]).toBeUndefined()
    expect(errs[ok.id]).toBeUndefined()
    expect(errs[noTitle.id]).toEqual({ title: 'title' })
    expect(errs[badUrl.id]).toEqual({ url: 'url' })
    expect(errs[noSource.id]).toEqual({ source: 'source' })
    expect(errs[file.id]).toBeUndefined()
  })
  it('moves an item inside bounds', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 2, 5)).toEqual([1, 2, 3])
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(moveItem([1, 2, 3], 9, 0)).toEqual([1, 2, 3])
  })
})

describe('viewer helpers', () => {
  const cats = [{ id: 'c1', name: { en: 'Guides', ar: 'أدلة' } }, { id: 'c2', name: { en: 'Videos', ar: '' } }]
  const rs = [
    fromRow(row({ id: 'a', title_en: 'Alpha deck', title_ar: null, type: 'readable', category_id: 'c1' })),
    fromRow(row({ id: 'b', title_en: 'Beta', title_ar: 'بيتا', description_en: 'about pricing', type: 'visual', category_id: 'c2', url: 'https://youtu.be/x' })),
    fromRow(row({ id: 'c', title_en: 'Gamma', title_ar: null, type: 'link', category_id: null })),
  ]
  it('searches both languages and the description without crashing on null Arabic titles (docs/03 7.5), filters by type', () => {
    expect(filterResources(rs, { query: 'alpha' }).map((r) => r.id)).toEqual(['a'])
    expect(filterResources(rs, { query: 'بيتا' }).map((r) => r.id)).toEqual(['b'])
    expect(filterResources(rs, { query: 'pricing' }).map((r) => r.id)).toEqual(['b'])
    expect(filterResources(rs, { query: 'youtu.be' }).map((r) => r.id)).toEqual(['b'])
    expect(filterResources(rs, { type: 'link' }).map((r) => r.id)).toEqual(['c'])
    expect(filterResources(rs, { categoryId: 'none' }).map((r) => r.id)).toEqual(['c'])
    expect(filterResources(rs, { categoryId: 'c1' }).map((r) => r.id)).toEqual(['a'])
    expect(typeCounts(rs)).toEqual({ all: 3, readable: 1, audible: 0, visual: 1, link: 1 })
  })
  it('groups by category when there are categories (others last), by type otherwise, none on request', () => {
    expect(groupResources(rs, cats, 'auto').map((g) => g.key)).toEqual(['cat:c1', 'cat:c2', 'cat:none'])
    expect(groupResources(rs, [], 'auto').map((g) => g.key)).toEqual(['type:readable', 'type:visual', 'type:link'])
    expect(groupResources(rs, cats, 'type').map((g) => g.key)).toEqual(['type:readable', 'type:visual', 'type:link'])
    expect(groupResources(rs, cats, 'none')).toEqual([{ key: 'all', kind: 'all', items: rs }])
    expect(groupResources([rs[0]], cats, 'category').map((g) => g.key)).toEqual(['cat:c1'])
    expect(categoryName(cats[1], 'ar')).toBe('Videos')
  })
  it('builds the Excel index rows in PM order with translated labels', () => {
    const labels = { order: '#', titleEn: 'Title (EN)', titleAr: 'Title (AR)', descriptionEn: 'D en', descriptionAr: 'D ar', type: 'Type', category: 'Section', visibility: 'Visibility', source: 'Source', url: 'Link', size: 'Size', file: 'File', link: 'Link', types: { readable: 'Document', visual: 'Video', link: 'Link' }, visibilities: { public: 'Public' } }
    const out = indexRows([rs[0], fromRow(row({ id: 'f', file_path: 'P/N/f.pdf', mime: 'application/pdf', bytes: 1234, url: null, category_id: 'c2' }))], cats, labels, 'en')
    expect(out[0]).toMatchObject({ '#': 1, 'Title (EN)': 'Alpha deck', Type: 'Document', Section: 'Guides', Visibility: 'Public', Source: 'Link', Link: 'https://example.com/a' })
    expect(out[1]).toMatchObject({ '#': 2, Source: 'File', Link: '', Size: 1234, Section: 'Videos' })
  })
})
