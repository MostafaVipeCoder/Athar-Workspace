import { describe, expect, it } from 'vitest'
import {
  activeFilterCount, BLOCKING_SCORE, DEFAULT_LIST_STATE, displayName, emptyExpertForm, entityViewToPayload, exportColumns, exportFileName, formFromProfile, formToPayload, groupByProgram,
  chunkRows, hasDuplicateSignal, importCounts, isExpertPhotoPath, isFormDirty, languageName, mergeImportResults, normalizeEngagement, normalizeLinks, safeHref, IMPORT_CHUNK, LIST_PARAM_KEYS, listStateToParams, mergeChoicePayload, mergeRows, normalizeCandidate, normalizePair,
  normalizeProfile, normalizeRegistryRow, normalizeUrl, otherName, parseListState, rawFields, roleKeys, roleLine, sheetToImportRows, toListArgs, validateExpertForm, westernDigits,
} from './experts.js'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

describe('list state <-> URL', () => {
  it('an empty query string is the default state', () => {
    expect(parseListState(new URLSearchParams(''))).toEqual(DEFAULT_LIST_STATE)
    expect(listStateToParams(DEFAULT_LIST_STATE).toString()).toBe('')
  })

  it('round-trips every field and keeps the URL clean (only what differs from the default)', () => {
    const state = { ...DEFAULT_LIST_STATE, q: 'schneider', kind: 'team', state: 'archived', photo: 'no', email: 'yes', tags: [U1, U2], language: 'fr', program: U1, part: 'yes', sort: 'sessions', dir: 'asc', page: 3, size: 48 }
    const params = listStateToParams(state)
    expect(params.get('speaks')).toBe('fr') // NOT `lang`: that is the app's own interface-language switch
    expect(params.has('lang')).toBe(false)
    expect(parseListState(params)).toEqual(state)
    expect(listStateToParams({ ...DEFAULT_LIST_STATE, sort: 'sessions', dir: 'desc' }).toString()).toBe('sort=sessions') // the sort's own default direction (desc) is not written
    expect(listStateToParams({ ...DEFAULT_LIST_STATE, sort: 'sessions', dir: 'asc' }).toString()).toBe('sort=sessions&dir=asc')
  })

  it('a hand-edited or stale link falls back to defaults instead of breaking the page', () => {
    const s = parseListState(new URLSearchParams(`kind=robot&state=zzz&photo=maybe&sort=password&dir=sideways&page=-4&size=7&tags=${U1},not-a-uuid,'; drop&speaks=English&program=x&part=3`))
    expect(s).toMatchObject({ kind: '', state: 'active', photo: '', sort: 'name', dir: 'asc', page: 1, size: 24, tags: [U1], language: '', program: '', part: '' })
    expect(parseListState(new URLSearchParams('page=99999999')).page).toBe(10000)
  })

  it('the app\'s own query keys are not list-state keys (they are preserved by the page)', () => {
    expect(LIST_PARAM_KEYS).not.toContain('lang')
    expect(LIST_PARAM_KEYS).toContain('speaks')
  })

  it('counts the FILTERS (not the search, sort or page)', () => {
    expect(activeFilterCount(DEFAULT_LIST_STATE)).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_LIST_STATE, q: 'x', sort: 'last', page: 4 })).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_LIST_STATE, kind: 'team', state: 'archived', photo: 'no', tags: [U1], language: 'ar' })).toBe(5)
  })

  it('toListArgs: the RPC filter object, the paging offset, the language, the export variant', () => {
    expect(toListArgs(DEFAULT_LIST_STATE, 'ar')).toEqual({ p_filter: {}, p_sort: 'name', p_dir: 'asc', p_limit: 24, p_offset: 0, p_lang: 'ar', p_full: false })
    const a = toListArgs({ ...DEFAULT_LIST_STATE, q: ' alaa ', kind: 'expert', state: 'all', photo: 'yes', email: 'no', tags: [U1], language: 'de', program: U2, part: 'no', page: 3, size: 48 }, 'en')
    expect(a.p_filter).toEqual({ q: 'alaa', kind: 'expert', state: 'all', has_photo: true, has_email: false, tag_ids: [U1], language: 'de', program_ids: [U2], participated: 'no' })
    expect(a.p_offset).toBe(96)
    expect(a.p_limit).toBe(48)
    expect(toListArgs({ ...DEFAULT_LIST_STATE, page: 9 }, 'en', { full: true })).toMatchObject({ p_limit: 5000, p_offset: 0, p_full: true })
    expect(toListArgs(DEFAULT_LIST_STATE, 'fr').p_lang).toBe('en')
  })
})

describe('view models', () => {
  const row = {
    id: U1, kind: 'expert', name_en: 'Alaa\tAfifi  ', name_ar: ' علاء عفيفي ', title_en: 'CEO', company_en: 'Bekia', photo_path: 'global/expert-photo/x.webp', linkedin_url: 'https://linkedin.com/in/a', has_email: true,
    tags: [{ id: U2, name_en: 'Marketing', name_ar: 'التسويق' }], programs_count: 2, projects_count: 3, lists_count: 3, booking_sessions: 1, distribution_sessions: 4, sessions_count: 5, first_session_on: '2026-08-07', last_session_on: '2026-09-27',
  }
  it('normalizeRegistryRow collapses the stray whitespace of the migrated names and flattens the numbers', () => {
    const r = normalizeRegistryRow(row)
    expect(r.name).toEqual({ en: 'Alaa Afifi', ar: 'علاء عفيفي' })
    expect(r).toMatchObject({ programs: 2, projects: 3, lists: 3, sessions: 5, bookingSessions: 1, distributionSessions: 4, hasEmail: true, archived: false, firstOn: '2026-08-07', lastOn: '2026-09-27' })
    expect(r.tags[0].name).toEqual({ en: 'Marketing', ar: 'التسويق' })
    expect(normalizeRegistryRow(null)).toBeNull()
    expect(normalizeRegistryRow({ id: U1 })).toMatchObject({ programs: 0, tags: [], languages: [], archived: false, kind: 'expert' })
  })

  it('names follow the interface language with a fallback to the other one; the other-language name is shown small', () => {
    const r = normalizeRegistryRow(row)
    expect(displayName(r, 'en')).toBe('Alaa Afifi')
    expect(displayName(r, 'ar')).toBe('علاء عفيفي')
    expect(otherName(r, 'en')).toBe('علاء عفيفي')
    expect(otherName(r, 'ar')).toBe('Alaa Afifi')
    const onlyEn = normalizeRegistryRow({ id: U1, name_en: 'Only English' })
    expect(displayName(onlyEn, 'ar')).toBe('Only English')
    expect(otherName(onlyEn, 'ar')).toBe('') // the English name IS the displayed one (the fallback): it is not repeated under itself
  })

  it('roleLine joins job title and company in the UI language', () => {
    const r = normalizeRegistryRow({ ...row, title_ar: 'رئيس تنفيذي', company_ar: 'بكية' })
    expect(roleLine(r, 'en')).toBe('CEO · Bekia')
    expect(roleLine(r, 'ar')).toBe('رئيس تنفيذي · بكية')
    expect(roleLine(normalizeRegistryRow({ id: U1, name_en: 'x' }), 'en')).toBe('')
  })

  it('normalizeProfile: totals, history, hidden count, the stale-edit token, merge info', () => {
    const p = normalizeProfile({
      expert: { id: U1, kind: 'team', name_en: 'A', name_ar: null, email: 'a@x.io', phone: '+20 100', languages: ['ar'], links: [{ kind: 'other', url: 'https://x.io' }], updated_at: '2026-10-15T10:00:00.123456+00:00', notes: 'private' },
      tags: [{ id: U2, name_en: 'T', name_ar: 'ت', archived: false }],
      totals: { programs: 2, projects: 3, lists: 3, booking_sessions: 1, distribution_sessions: 4, sessions: 5, first_session_on: '2026-08-07', last_session_on: '2026-09-27', withdrawn: 1 },
      participation: [{ item_id: 'i1', node: { id: 'n1', type: 'list', name_en: 'Experts' }, project: { id: 'j1', name_en: 'P1' }, program: { id: 'g1', name_en: 'G1', year: 2026 }, withdrawn: false, roles: { mentor: true }, booking_sessions: 0, distribution_sessions: 2, first_session_on: '2026-08-07', last_session_on: '2026-08-07', added_at: '2026-08-01T00:00:00Z' }],
      hidden: { engagements: 2, projects: 2, programs: 1 },
      merged_into: { id: U2, name_en: 'Canonical' },
      absorbed: [{ merge_id: 'm1', drop_id: 'd1', drop_name: 'Dup', merged_at: '2026-10-15T00:00:00Z' }],
      can: { edit: true, archive: true, merge: false, delete: false, restore: false },
    })
    expect(p.updatedAt).toBe('2026-10-15T10:00:00.123456+00:00') // handed back untouched: the server compares microseconds
    expect(p.totals).toMatchObject({ programs: 2, projects: 3, sessions: 5, bookingSessions: 1, distributionSessions: 4, withdrawn: 1 })
    expect(p.hidden).toEqual({ engagements: 2, projects: 2, programs: 1 })
    expect(p.mergedInto).toEqual({ id: U2, name: { en: 'Canonical', ar: '' } })
    expect(p.absorbed).toEqual([{ id: 'm1', dropId: 'd1', name: 'Dup', at: '2026-10-15T00:00:00Z' }])
    expect(p.can).toEqual({ edit: true, archive: true, merge: false, delete: false, restore: false })
    expect(p.history[0]).toMatchObject({ itemId: 'i1', roles: { mentor: true, provider: false, presenter: false }, distributionSessions: 2 })
    expect(normalizeProfile(null)).toBeNull()
  })

  it('roleKeys and groupByProgram', () => {
    expect(roleKeys({ mentor: true, provider: true })).toEqual(['mentor', 'provider'])
    expect(roleKeys({ presenter: true })).toEqual(['presenter'])
    expect(roleKeys({})).toEqual(['listed'])
    const h = (g, i) => ({ itemId: i, program: { id: g, name: { en: g, ar: '' } } })
    const groups = groupByProgram([h('A', 1), h('B', 2), h('A', 3)])
    expect(groups.map((g) => [g.program.id, g.engagements.length])).toEqual([['A', 2], ['B', 1]])
  })

  it('languageName: a known code in the UI language, an unknown one as its upper-case code', () => {
    expect(languageName('ar', 'en')).toBe('Arabic')
    expect(languageName('fr', 'ar')).toBe('الفرنسية')
    expect(languageName('xx', 'en')).toBe('XX')
  })
})

describe('the create / edit form', () => {
  const profile = normalizeProfile({
    expert: { id: U1, kind: 'expert', name_en: 'Alaa Afifi', name_ar: 'علاء', title_en: 'CEO', email: 'a@x.io', phone: '+20 100 000', linkedin_url: 'https://linkedin.com/in/a', languages: ['ar', 'en'], links: [], notes: 'n', photo_path: 'global/expert-photo/x.webp', updated_at: 'T' },
    tags: [{ id: U2, name_en: 'Marketing', name_ar: 'تسويق' }],
  })

  it('validation mirrors the server: a name in one language is enough; e-mail, phone, links, lengths, counts', () => {
    expect(validateExpertForm(emptyExpertForm())).toEqual({ name: 'experts.err.nameRequired' })
    const ok = { ...emptyExpertForm(), name: { en: ' ', ar: 'علاء' } }
    expect(validateExpertForm(ok)).toEqual({})
    const bad = { ...ok, email: 'nope', phone: 'call me', linkedin: 'javascript:alert(1)', website: 'not a link', links: [{ kind: 'other', url: 'ftp://x' }], languages: Array(9).fill('ar'), tags: Array(13).fill({ name_en: 'x' }), notes: 'x'.repeat(4001) }
    expect(validateExpertForm(bad)).toEqual({ email: 'experts.err.email', phone: 'experts.err.phone', linkedin: 'experts.err.url', website: 'experts.err.url', links: 'experts.err.url', languages: 'experts.err.tooMany', tags: 'experts.err.tooMany', notes: 'experts.err.tooLong' })
    expect(validateExpertForm({ ...ok, name: { en: 'x'.repeat(201), ar: '' } }).name).toBe('experts.err.tooLong')
  })

  it('a link typed without a scheme is accepted and completed; a phone typed with Arabic digits is accepted', () => {
    expect(normalizeUrl('linkedin.com/in/alaa')).toBe('https://linkedin.com/in/alaa')
    expect(normalizeUrl('https://x.io/a')).toBe('https://x.io/a')
    expect(normalizeUrl('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(normalizeUrl('  ')).toBe('')
    expect(westernDigits('٠١٠٠ ١٢٣ ٤٥٦٧')).toBe('0100 123 4567')
    expect(validateExpertForm({ ...emptyExpertForm(), name: { en: 'a', ar: '' }, phone: '+٢٠ ١٠٠ ٠٠٠ ٠٠٠١', linkedin: 'linkedin.com/in/a' })).toEqual({})
  })

  it('formToPayload cleans the form: nulls for empty, lower-case e-mail, western digits, scheme added, tag ids vs new names, deduped languages', () => {
    const form = {
      ...emptyExpertForm(), name: { en: ' Alaa ', ar: '' }, email: ' ALAA@Example.COM ', phone: '٠١٠٠ ٠٠٠', linkedin: 'linkedin.com/in/a', languages: ['ar', 'AR', 'en'],
      tags: [{ id: U1, name_en: 'Marketing', name_ar: '' }, { name_en: 'Fresh', name_ar: '' }, { name_en: '', name_ar: 'وسم' }], links: [{ kind: 'other', url: 'x.io/a' }, { kind: 'other', url: '' }],
    }
    const p = formToPayload(form)
    expect(p).toMatchObject({ name_en: 'Alaa', name_ar: null, title_en: null, email: 'alaa@example.com', phone: '0100 000', linkedin_url: 'https://linkedin.com/in/a', website_url: null, languages: ['ar', 'en'], kind: 'expert' })
    expect(p.tags).toEqual([U1, { name_en: 'Fresh', name_ar: null }, { name_en: null, name_ar: 'وسم' }])
    expect(p.links).toEqual([{ kind: 'other', url: 'https://x.io/a' }])
  })

  it('an EDIT sends a PATCH: only what changed (a field somebody else edited meanwhile is not overwritten by a stale copy)', () => {
    const form = formFromProfile(profile)
    expect(formToPayload(form, { original: profile })).toEqual({})
    expect(isFormDirty(form, profile)).toBe(false)
    const edited = { ...form, title: { en: 'Founder', ar: '' }, languages: ['en'] }
    expect(formToPayload(edited, { original: profile })).toEqual({ title_en: 'Founder', languages: ['en'] })
    expect(isFormDirty(edited, profile)).toBe(true)
    const cleared = { ...form, phone: '', photoPath: null }
    expect(formToPayload(cleared, { original: profile })).toEqual({ phone: null, photo_path: null })
  })

  it('a NEW form is dirty only once something is typed', () => {
    expect(isFormDirty(emptyExpertForm())).toBe(false)
    expect(isFormDirty({ ...emptyExpertForm(), name: { en: 'x', ar: '' } })).toBe(true)
  })

  it('formFromProfile keeps tag ids so a save sends ids, not names', () => {
    const f = formFromProfile(profile)
    expect(f.tags).toEqual([{ id: U2, name_en: 'Marketing', name_ar: 'تسويق' }])
    expect(f.name).toEqual({ en: 'Alaa Afifi', ar: 'علاء' })
    expect(formFromProfile(null)).toEqual(emptyExpertForm())
  })

  it('the Lists node\'s EntityView creates the SAME canonical fields in the registry', () => {
    const view = { title: { en: ' Sara ', ar: '' }, subtitle: { en: 'CTO', ar: '' }, organization: { en: 'Acme', ar: 'أكمي' }, bio: { en: '', ar: '' }, imagePath: 'global/expert-photo/y.webp', links: [{ kind: 'linkedin', url: 'linkedin.com/in/s' }, { kind: 'website', url: 'https://acme.io' }], email: ' S@Acme.IO ' }
    expect(entityViewToPayload(view)).toEqual({
      kind: 'expert', name_en: 'Sara', name_ar: null, title_en: 'CTO', title_ar: null, company_en: 'Acme', company_ar: 'أكمي', bio_en: null, bio_ar: null, photo_path: 'global/expert-photo/y.webp',
      linkedin_url: 'https://linkedin.com/in/s', website_url: 'https://acme.io', email: 's@acme.io',
    })
  })
})

describe('duplicates', () => {
  it('a duplicate search needs something to search with', () => {
    expect(hasDuplicateSignal(emptyExpertForm())).toBe(false)
    expect(hasDuplicateSignal({ ...emptyExpertForm(), name: { en: 'Al', ar: '' } })).toBe(false)
    expect(hasDuplicateSignal({ ...emptyExpertForm(), name: { en: 'Alaa', ar: '' } })).toBe(true)
    expect(hasDuplicateSignal({ ...emptyExpertForm(), email: 'a@x.io' })).toBe(true)
    expect(hasDuplicateSignal({ ...emptyExpertForm(), linkedin: 'linkedin.com/in/a' })).toBe(true)
  })

  it('normalizeCandidate / normalizePair', () => {
    const c = normalizeCandidate({ id: U1, score: 0.95, reasons: ['same_name', 'same_linkedin'], blocking: true, expert: { id: U1, kind: 'expert', name_en: 'A', photo_path: 'p', archived_at: '2026-01-01' } })
    expect(c).toMatchObject({ id: U1, score: 0.95, blocking: true, archived: true, photoPath: 'p' })
    expect(normalizeCandidate({ id: U1, score: 0.7, reasons: [], expert: {} }).blocking).toBe(false)
    expect(BLOCKING_SCORE).toBe(0.95)
    const pair = normalizePair({ score: '0.85', reasons: ['same_name_translit'], a: { id: U1, name_en: 'Osama' }, b: { id: U2, name_en: 'أسامة', archived_at: null } })
    expect(pair).toMatchObject({ score: 0.85, a: { id: U1 }, b: { id: U2, archived: false } })
  })
})

describe('merge rows', () => {
  const keep = { name: { en: 'Osama', ar: '' }, title: { en: 'Founder', ar: '' }, company: { en: '', ar: '' }, bio: { en: '', ar: '' }, photoPath: null, linkedin: 'https://l/in/a', website: '', email: '', phone: '' }
  const drop = { name: { en: 'Osama Nageeb', ar: 'أسامة' }, title: { en: 'Founder', ar: '' }, company: { en: 'Bosla', ar: '' }, bio: { en: '', ar: '' }, photoPath: 'p.webp', linkedin: 'https://l/in/a', website: '', email: 'o@x.io', phone: '' }
  it('lists only the fields where at least one side has a value; marks the ones that differ; the default survivor is the kept value, else the other', () => {
    const rows = mergeRows(rawFields(keep), rawFields(drop))
    const by = Object.fromEntries(rows.map((r) => [r.field, r]))
    expect(Object.keys(by)).toEqual(['name_en', 'name_ar', 'title_en', 'company_en', 'photo_path', 'linkedin_url', 'email'])
    expect(by.name_en).toMatchObject({ differs: true, chosen: 'keep' })
    expect(by.title_en).toMatchObject({ differs: false })
    expect(by.name_ar).toMatchObject({ keep: '', drop: 'أسامة', chosen: 'drop' }) // an empty kept value never wins over a filled one
    expect(by.company_en.chosen).toBe('drop')
  })

  it('a click on "drop" switches a differing field; a choice for a field where a side is empty is ignored', () => {
    const rows = mergeRows(rawFields(keep), rawFields(drop), { name_en: 'drop', name_ar: 'keep', email: 'keep' })
    const by = Object.fromEntries(rows.map((r) => [r.field, r]))
    expect(by.name_en.chosen).toBe('drop')
    expect(by.name_ar.chosen).toBe('drop')
    expect(mergeChoicePayload(rows, { name_en: 'drop', name_ar: 'keep', email: 'keep' })).toEqual({ name_en: 'drop' }) // only EXPLICIT choices, only where both sides have a different value
    expect(mergeChoicePayload(rows)).toEqual({}) // nothing clicked: the server's default decides
  })
})

describe('Excel export and import', () => {
  const t = (k) => k
  const r = normalizeRegistryRow({ id: U1, kind: 'team', name_en: 'A', name_ar: 'أ', email: 'a@x.io', phone: '1', linkedin_url: 'https://l', languages: ['ar', 'zz'], tags: [{ id: U2, name_en: 'T', name_ar: 'ت' }], programs_count: 1, projects_count: 2, booking_sessions: 3, distribution_sessions: 4, sessions_count: 7, last_session_on: '2026-09-27', archived_at: '2026-01-01', notes: 'n' })
  it('the export columns carry names, contact, languages, tags, the live participation numbers and the status', () => {
    const cols = exportColumns(t, 'en')
    const cell = (header) => cols.find((c) => c.header === header).key(r)
    expect(cell('experts.col.name (EN)')).toBe('A')
    expect(cell('experts.col.name (AR)')).toBe('أ')
    expect(cell('experts.col.kind')).toBe('experts.kind.team')
    expect(cell('experts.field.email')).toBe('a@x.io')
    expect(cell('experts.field.languages')).toBe('Arabic, ZZ')
    expect(cell('experts.field.tags')).toBe('T')
    expect([cell('experts.col.programs'), cell('experts.col.projects'), cell('experts.col.bookingSessions'), cell('experts.col.distributionSessions'), cell('experts.col.sessions'), cell('experts.col.last')]).toEqual([1, 2, 3, 4, 7, '2026-09-27'])
    expect(cell('experts.col.status')).toBe('experts.state.archived')
    expect(cell('experts.field.notes')).toBe('n')
    expect(exportFileName(new Date('2026-10-15T12:00:00Z'))).toBe('athar-network-experts-2026-10-15')
  })

  it('sheetToImportRows: English and Arabic headers, languages by code or name, tags split, urls / phone / e-mail normalised, nameless rows counted', () => {
    const { rows, skipped, unknownLanguages } = sheetToImportRows([
      { Name: ' Alaa ', 'Name (AR)': 'علاء', 'Job title': 'CEO', Company: 'Bekia', 'E-mail': 'ALAA@X.IO', Phone: '٠١٠٠', LinkedIn: 'linkedin.com/in/a', Languages: 'Arabic, English; fr, Klingon', Tags: 'Marketing, AI / Data' },
      { الاسم: 'سارة', 'المسمى الوظيفي': 'مديرة' },
      { 'Job title': 'no name here' },
      {},
    ])
    expect(skipped).toBe(1) // the third row has data but no name; the empty one is not counted
    expect(unknownLanguages).toBe(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name_en: 'Alaa', name_ar: 'علاء', title_en: 'CEO', company_en: 'Bekia', email: 'alaa@x.io', phone: '0100', linkedin_url: 'https://linkedin.com/in/a', languages: ['ar', 'en', 'fr'], tags: ['Marketing', 'AI / Data'] })
    expect(rows[1]).toMatchObject({ name_ar: 'سارة' })
  })

  it('importCounts reads the preview counts and tolerates nothing', () => {
    expect(importCounts({ counts: { new: 2, duplicate: 1, invalid: 3, created: 0 } })).toEqual({ new: 2, duplicate: 1, invalid: 3, created: 0 })
    expect(importCounts(null)).toEqual({ new: 0, duplicate: 0, invalid: 0, created: 0 })
  })
})

describe('review fixes: safe links, photo folder, malformed data, hidden items, import chunks', () => {
  it('safeHref: an http(s) address as it is, a bare host/path gets https://, everything else is NOT a link (javascript:, data:, relative, spaces, non-strings)', () => {
    expect(safeHref('https://www.linkedin.com/in/x')).toBe('https://www.linkedin.com/in/x')
    expect(safeHref('HTTP://a.example/p')).toBe('HTTP://a.example/p')
    expect(safeHref('linkedin.com/in/yomna-el-awamri-7414a127')).toBe('https://linkedin.com/in/yomna-el-awamri-7414a127')
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '/relative/path', 'a b.example', '', '  ', null, undefined, 5, {}, ['https://a.example']]) expect(safeHref(bad)).toBe('')
    expect(safeHref(`https://a.example/${'x'.repeat(600)}`)).toBe('')
  })

  it('isExpertPhotoPath: exactly global/expert-photo/<uuid>.webp (or its _t thumbnail)', () => {
    const id = '6f1b2c3d-0000-4000-8000-000000000001'
    expect(isExpertPhotoPath(`global/expert-photo/${id}.webp`)).toBe(true)
    expect(isExpertPhotoPath(`global/expert-photo/${id}_t.webp`)).toBe(true)
    for (const bad of ['global/hero/home-hero.webp', `global/other/${id}.webp`, `global/expert-photo/${id}.png`, `x/global/expert-photo/${id}.webp`, 'global/expert-photo/evil.webp', null, undefined, 5]) expect(isExpertPhotoPath(bad)).toBe(false)
  })

  it('a record whose links are malformed no longer crashes the profile: normalizeLinks keeps only what can be shown', () => {
    expect(normalizeLinks([{ kind: 'x' }, null, { url: 5 }, 'str', [], { url: 'javascript:alert(1)' }, { kind: 'other', url: 'https://ok.example/a' }, { url: 'bare.example/b' }]))
      .toEqual([{ kind: 'other', url: 'https://ok.example/a' }, { kind: 'other', url: 'bare.example/b' }])
    expect(normalizeLinks(null)).toEqual([])
    expect(normalizeLinks({})).toEqual([])
    const p = normalizeProfile({ expert: { id: U1, kind: 'expert', name_en: 'A', links: [{ kind: 'x' }, null, { url: 5 }] }, totals: {}, can: {} })
    expect(p.links).toEqual([])
    expect(formFromProfile(p).links).toEqual([]) // the edit form opens too
  })

  it('a hidden legacy item is flagged on its row; a row without `counted` (an older payload) counts unless it is withdrawn', () => {
    const base = { item_id: 'i', node: { id: 'n' }, project: { id: 'j' }, program: { id: 'g' }, roles: {} }
    expect(normalizeEngagement({ ...base, item_hidden: true, counted: true })).toMatchObject({ itemHidden: true, counted: true })
    expect(normalizeEngagement({ ...base, item_hidden: true, counted: false })).toMatchObject({ itemHidden: true, counted: false })
    expect(normalizeEngagement({ ...base, withdrawn: true })).toMatchObject({ itemHidden: false, counted: false })
    expect(normalizeEngagement(base)).toMatchObject({ itemHidden: false, counted: true })
    const p = normalizeProfile({ expert: { id: U1, kind: 'expert' }, totals: { hidden_not_counted: 2 }, can: {} })
    expect(p.totals.hiddenNotCounted).toBe(2)
  })

  it('chunkRows splits a file into calls of at most 50 rows; mergeImportResults makes ONE answer of them (indexes continue, counts add up)', () => {
    expect(IMPORT_CHUNK).toBe(50)
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkRows([], 2)).toEqual([])
    expect(chunkRows(Array.from({ length: 120 }, (_, i) => i)).map((c) => c.length)).toEqual([50, 50, 20])
    const a = { counts: { new: 1, duplicate: 1, invalid: 0, created: 0 }, rows: [{ index: 1, status: 'new' }, { index: 2, status: 'duplicate' }], seen: { names: ['a'] } }
    const b = { counts: { new: 0, duplicate: 1, invalid: 1, created: 0 }, rows: [{ index: 1, status: 'duplicate', in_file: true }, { index: 2, status: 'invalid' }], seen: { names: ['a', 'b'] } }
    const m = mergeImportResults([a, b], [0, 2])
    expect(m.counts).toEqual({ new: 1, duplicate: 2, invalid: 1, created: 0 })
    expect(m.rows.map((r) => r.index)).toEqual([1, 2, 3, 4])
    expect(m.rows[2]).toMatchObject({ status: 'duplicate', in_file: true })
    expect(m.seen).toEqual({ names: ['a', 'b'] })
  })
})
