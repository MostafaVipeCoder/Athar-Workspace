import { describe, expect, it } from 'vitest'
import {
  analyticsSheets, archivePatch, audienceKey, audienceReady, audienceToRpc, barRows, chunkRows, deadlineState, defaultSnapshotYear, emptyOppForm, filterPreviewRows, invitationsAsTsv,
  lookupKeyFromLabel, matchCompanyByName, mergePreviews, missingLanguage, oppFormToPatch, oppStatus, oppToForm, parseInviteLines, parseNumberInput, publishPatch, readRate, restorePatch,
  sharePct, snapshotPatch, snapshotToForm, splitLine, toImportRows, unpublishPatch, validateMessage, validateOpp, validateSnapshotForm, yearOptions, yearSeries,
} from './adminLogic.js'

describe('invitations: the bulk box', () => {
  it('splits a line on commas / semicolons / tabs and honours quotes', () => {
    expect(splitLine('a@b.co, Nile Robotics')).toEqual(['a@b.co', 'Nile Robotics'])
    expect(splitLine('"My, Co";x@y.io\tz')).toEqual(['My, Co', 'x@y.io', 'z'])
    expect(splitLine('"say ""hi""",a@b.co')).toEqual(['say "hi"', 'a@b.co'])
  })

  it('reads "e-mail, company" lines in either order, skips a header, flags bad / repeated lines', () => {
    const r = parseInviteLines('email, company\nsara@example.com, Nile Robotics\nHana Co; hana@example.com\n\nnot-an-email@\njust a name\nsara@example.com, Nile Robotics\nomar@example.com')
    expect(r.rows.map((x) => [x.email, x.company, x.error])).toEqual([
      ['sara@example.com', 'Nile Robotics', null],
      ['hana@example.com', 'Hana Co', null],
      ['not-an-email@', '', 'bad_email'],
      ['', 'just a name', 'no_email'],
      ['sara@example.com', 'Nile Robotics', 'duplicate'],
      ['omar@example.com', '', null],
    ])
    expect(r.valid).toBe(3)
    expect(r.invalid).toBe(3)
  })

  it('lowercases e-mails and keeps the 1-based line number of the box', () => {
    const r = parseInviteLines('\nSara@Example.COM')
    expect(r.rows[0]).toMatchObject({ line: 2, email: 'sara@example.com' })
  })

  it('a company typed as a name resolves only when EXACTLY ONE row has that name (either language)', () => {
    const rows = [{ id: '1', name_en: 'Nile Robotics', name_ar: 'نيل' }, { id: '2', name_en: 'Delta', name_ar: 'دلتا' }, { id: '3', name_en: 'delta', name_ar: null }]
    expect(matchCompanyByName(rows, ' nile robotics ')).toEqual({ status: 'one', company: rows[0] })
    expect(matchCompanyByName(rows, 'نيل').company.id).toBe('1')
    expect(matchCompanyByName(rows, 'Delta').status).toBe('many')
    expect(matchCompanyByName(rows, 'nope').status).toBe('none')
    expect(matchCompanyByName(rows, '').status).toBe('none')
  })

  it('"copy all" is e-mail, company, link per line', () => {
    expect(invitationsAsTsv([{ email: 'a@b.co', companyName: 'X', link: 'https://l/1' }, { email: 'c@d.co', link: 'https://l/2' }])).toBe('a@b.co\tX\thttps://l/1\nc@d.co\t\thttps://l/2')
  })
})

describe('notifications: the audience and the message', () => {
  it('builds the RPC audience (a project wins over its program)', () => {
    expect(audienceToRpc({ kind: 'all' })).toEqual({ kind: 'all' })
    expect(audienceToRpc({ kind: 'program', programId: 'p', projectId: '' })).toEqual({ kind: 'program', program_id: 'p' })
    expect(audienceToRpc({ kind: 'program', programId: 'p', projectId: 'j' })).toEqual({ kind: 'program', project_id: 'j' })
    expect(audienceToRpc({ kind: 'company', companies: [{ id: 'c1' }, { id: 'c2' }] })).toEqual({ kind: 'company', company_ids: ['c1', 'c2'] })
    expect(audienceToRpc({ kind: 'founder', founders: [{ id: 'f1' }] })).toEqual({ kind: 'founder', founder_ids: ['f1'] })
    expect(audienceToRpc({ kind: 'staff' })).toBeNull()
  })
  it('knows when an audience is ready and keys the query by it', () => {
    expect(audienceReady({ kind: 'all' })).toBe(true)
    expect(audienceReady({ kind: 'program', programId: '' })).toBe(false)
    expect(audienceReady({ kind: 'company', companies: [] })).toBe(false)
    expect(audienceReady({ kind: 'founder', founders: [{ id: 'f' }] })).toBe(true)
    expect(audienceKey({ kind: 'program', programId: 'p' })).toBe('{"kind":"program","program_id":"p"}')
  })
  it('a message needs a title and a body in at least ONE language', () => {
    expect(validateMessage({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' })).toEqual({ title: 'required', body: 'required' })
    expect(validateMessage({ titleEn: 'T', titleAr: '', bodyEn: '', bodyAr: 'ن' })).toEqual({})
    expect(validateMessage({ titleEn: 'x'.repeat(201), bodyEn: 'b' })).toEqual({ title: 'too_long' })
    expect(validateMessage({ titleEn: 'T', bodyAr: 'y'.repeat(4001) })).toEqual({ body: 'too_long' })
  })
  it('says which language is missing (a one-language message is still valid)', () => {
    expect(missingLanguage({ titleEn: 'T', bodyEn: 'B', titleAr: '', bodyAr: '' })).toBe('ar')
    expect(missingLanguage({ titleEn: '', bodyEn: '', titleAr: 'ع', bodyAr: 'ن' })).toBe('en')
    expect(missingLanguage({ titleEn: 'T', bodyEn: 'B', titleAr: 'ع', bodyAr: 'ن' })).toBeNull()
    expect(missingLanguage({ titleEn: '', bodyEn: '', titleAr: '', bodyAr: '' })).toBeNull()
  })
  it('a read rate is a whole percent (0 without recipients)', () => {
    expect(readRate(1, 3)).toBe(33)
    expect(readRate(0, 0)).toBe(0)
  })
})

describe('opportunities', () => {
  it('status: archived beats published beats draft', () => {
    expect(oppStatus({ is_active: true, archived_at: null })).toBe('published')
    expect(oppStatus({ is_active: false, archived_at: null })).toBe('draft')
    expect(oppStatus({ is_active: false, archived_at: '2026-01-01' })).toBe('archived')
  })
  it('the lifecycle patches keep is_active and archived_at consistent (the table refuses an active archived row)', () => {
    expect(publishPatch()).toEqual({ is_active: true, archived_at: null })
    expect(unpublishPatch()).toEqual({ is_active: false })
    expect(restorePatch()).toEqual({ archived_at: null })
    expect(archivePatch(new Date('2026-10-14T10:00:00Z'))).toEqual({ is_active: false, archived_at: '2026-10-14T10:00:00.000Z' })
  })
  it('deadline state: none / passed / soon (within a week) / open', () => {
    const today = new Date(2026, 9, 14)
    expect(deadlineState(null, today)).toBe('none')
    expect(deadlineState('2026-10-13', today)).toBe('passed')
    expect(deadlineState('2026-10-14', today)).toBe('soon')
    expect(deadlineState('2026-10-21', today)).toBe('soon')
    expect(deadlineState('2026-10-22', today)).toBe('open')
  })
  it('validates the form like the table does (Arabic title, lengths, http(s) link, date)', () => {
    expect(validateOpp(emptyOppForm())).toEqual({ title_ar: 'required' })
    expect(validateOpp({ ...emptyOppForm(), title_ar: 'x', link: 'javascript:alert(1)', deadline: '14/10/2026' })).toEqual({ link: 'bad_url', deadline: 'bad_date' })
    expect(validateOpp({ ...emptyOppForm(), title_ar: 'x', link: 'https://example.com/a', description_en: 'd'.repeat(4001) })).toEqual({ description_en: 'too_long' })
  })
  it('turns the form into columns: empty = null, empty target lists are left out, the title is trimmed', () => {
    const f = { ...emptyOppForm(), title_ar: '  منحة  ', provider_en: '', deadline: '2026-12-01', link: 'https://x.io', target: { program_ids: ['p1'], sectors: [], stages: ['mvp'], governorates: [] }, order_index: '3' }
    expect(oppFormToPatch(f)).toEqual({
      type: 'grant', title_ar: 'منحة', title_en: null, description_ar: null, description_en: null, provider_ar: null, provider_en: null, deadline: '2026-12-01', eligibility: null, link: 'https://x.io', order_index: 3,
      target: { program_ids: ['p1'], stages: ['mvp'] },
    })
  })
  it('a stored opportunity round-trips through the form', () => {
    const o = { type: 'event', title_ar: 'ع', title_en: 'E', deadline: '2026-11-02T00:00:00', link: null, order_index: 2, target: { sectors: ['technology'] } }
    const f = oppToForm(o)
    expect(f).toMatchObject({ type: 'event', title_ar: 'ع', deadline: '2026-11-02', link: '', order_index: 2 })
    expect(f.target).toEqual({ program_ids: [], sectors: ['technology'], stages: [], governorates: [] })
  })
})

describe('the yearly grid', () => {
  it('reads numbers the way a person types them (Arabic digits, separators, empty = cleared)', () => {
    expect(parseNumberInput('1,250,000')).toBe(1250000)
    expect(parseNumberInput('١٢٣٫٥')).toBe(123.5)
    expect(parseNumberInput(' 7 ')).toBe(7)
    expect(parseNumberInput('')).toBeNull()
    expect(parseNumberInput('12abc')).toBeNaN()
  })
  it('validates a row: numbers, no negatives, whole counts, female <= total', () => {
    expect(validateSnapshotForm({ revenue_total: '10', employees_total: '5', employees_female: '2' })).toEqual({})
    expect(validateSnapshotForm({ revenue_total: 'abc' })).toEqual({ revenue_total: 'not_a_number' })
    expect(validateSnapshotForm({ funding_raised_total: '-1' })).toEqual({ funding_raised_total: 'negative' })
    expect(validateSnapshotForm({ freelancers: '2.5' })).toEqual({ freelancers: 'not_integer' })
    expect(validateSnapshotForm({ employees_total: '3', employees_female: '4' })).toEqual({ employees_female: 'exceeds_total' })
  })
  it('the patch holds ONLY the cells whose number changed (a cleared cell is null)', () => {
    const base = snapshotToForm({ revenue_total: 100, employees_total: 5, employees_female: 2, freelancers: null })
    expect(base).toEqual({ revenue_total: '100', funding_raised_total: '', employees_total: '5', employees_female: '2', freelancers: '' })
    expect(snapshotPatch(base, { ...base, revenue_total: '100.0', employees_total: '6', employees_female: '', freelancers: '3' })).toEqual({ employees_total: 6, employees_female: null, freelancers: 3 })
    expect(snapshotPatch(base, base)).toEqual({})
    expect(snapshotPatch(base, { ...base, revenue_total: 'abc' })).toEqual({})
  })
  it('defaults to the latest year with data, else last year; offers the recent years', () => {
    const now = new Date(2026, 9, 14)
    expect(defaultSnapshotYear(2024, now)).toBe(2024)
    expect(defaultSnapshotYear(null, now)).toBe(2025)
    expect(yearOptions(2024, now, 3)).toEqual([2026, 2025, 2024])
    expect(yearOptions(2030, now, 2)).toEqual([2030, 2029])
  })
})

describe('the Excel import', () => {
  it('turns cells into what the preview expects: dates as ISO text (a timezone cannot move the day), numbers kept, empty headers dropped', () => {
    const rows = toImportRows([{ 'Startup Name': ' Alpha ', 'Date of company established': new Date('2021-03-01T00:00:00.000Z'), 'Nu. of employees': 12, Website: null, __EMPTY: 'x', '  ': 'y' }])
    expect(rows).toEqual([{ 'Startup Name': 'Alpha', 'Date of company established': '2021-03-01', 'Nu. of employees': 12, Website: '' }])
    expect(toImportRows([{ d: new Date('2021-03-01T22:30:00.000Z') }])[0].d).toBe('2021-03-02')
  })
  it('chunks 500 at a time', () => {
    expect(chunkRows(Array.from({ length: 1201 }, (_, i) => i)).map((c) => c.length)).toEqual([500, 500, 201])
  })
  it('merges chunk previews: rows continue, counts add up, a header is missing only when it is missing everywhere, proposals merge', () => {
    const a = { count: 2, summary: { create: 1, update: 0, error: 1, warnings: 1 }, headers: { unknown: ['X'], missing: ['Hint', 'Needs'], ignored_derived: ['CEO Age'] }, proposed_lookups: [{ kind: 'stage', value: 'Seed', parent: null, count: 1 }], rows: [{ row: 1 }, { row: 2 }] }
    const b = { count: 1, summary: { create: 0, update: 1, error: 0, warnings: 0 }, headers: { unknown: ['X', 'Y'], missing: ['Hint'], ignored_derived: [] }, proposed_lookups: [{ kind: 'stage', value: 'seed', parent: null, count: 2 }], rows: [{ row: 1 }] }
    const m = mergePreviews([a, b], [500, 500])
    expect(m.rows.map((r) => r.row)).toEqual([1, 2, 501])
    expect(m.summary).toEqual({ create: 1, update: 1, error: 1, warnings: 1 })
    expect(m.headers).toEqual({ unknown: ['X', 'Y'], missing: ['Hint'], ignored_derived: ['CEO Age'] })
    expect(m.proposed_lookups).toEqual([{ kind: 'stage', value: 'Seed', parent: null, count: 3 }])
  })
  it('an ASCII, unique key for a new vocabulary value', () => {
    expect(lookupKeyFromLabel('Pre-Seed Round', [])).toBe('pre_seed_round')
    expect(lookupKeyFromLabel('Pre-Seed Round', ['pre_seed_round'])).toBe('pre_seed_round_2')
    expect(lookupKeyFromLabel('قيمة جديدة', [])).toBe('value_2')
    expect(/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(lookupKeyFromLabel('Ünïcode  &  Stuff!!', []))).toBe(true)
  })
  it('filters the preview rows', () => {
    const rows = [{ errors: 1, warnings: 0 }, { errors: 0, warnings: 2 }, { errors: 0, warnings: 0 }, { errors: 2, warnings: 1 }]
    expect(filterPreviewRows(rows, 'all')).toHaveLength(4)
    expect(filterPreviewRows(rows, 'errors')).toHaveLength(2)
    expect(filterPreviewRows(rows, 'warnings')).toHaveLength(1)
    expect(filterPreviewRows(rows, 'ok')).toHaveLength(1)
  })
})

describe('charts and analytics', () => {
  it('bars: largest first, a null key is "not specified", the tail is one "other" bar, shares are of the TOTAL', () => {
    const rows = barRows([{ key: 'a', count: 5 }, { key: 'b', count: 3 }, { key: null, count: 1 }, { key: 'c', count: 1 }, { key: 'zero', count: 0 }], { limit: 3, nullLabel: 'N/A', otherLabel: 'Other', labelOf: (k) => k.toUpperCase() })
    expect(rows.map((r) => [r.label, r.count])).toEqual([['A', 5], ['B', 3], ['Other', 2]])
    expect(Math.round(rows[0].pct)).toBe(50)
    expect(barRows([{ key: null, count: 2 }], { nullLabel: 'N/A' })[0].label).toBe('N/A')
    expect(barRows([], {})).toEqual([])
  })
  it('a share is a percent with one decimal (null without a total, never a made-up number)', () => {
    expect(sharePct(1, 3)).toBe(33.3)
    expect(sharePct(0, 0)).toBeNull()
  })
  it('yearly series are chronological numbers', () => {
    expect(yearSeries([{ year: 2024, revenue: '5' }, { year: 2023, revenue: null }], 'revenue')).toEqual([{ year: 2023, value: 0, missing: true }, { year: 2024, value: 5, missing: false }])
  })
  it('the analytics Excel sheets: a summary, one sheet per breakdown, the yearly table; empty groups are left out', () => {
    const data = { totals: { companies: 3, open: 2, closed: 1, survival_rate: 66.7, with_program: 3, reporting_year: 2, founders: 4, female_founders: 1, founders_under_35: 3, employees: 20, female_employees: 8, freelancers: 2, funding_raised: 100, revenue: 50 },
      by_sector: [{ key: 'technology', count: 2 }], by_stage: [], by_startup_type: [], by_legal_status: [], by_governorate: [{ key: '25', count: 1 }], by_ceo_governorate: [], by_ceo_gender: [], by_ceo_age_category: [], by_program: [],
      by_year: [{ year: 2024, companies_reporting: 2, revenue: 50, funding_raised: 100, employees: 20, female_employees: 8, freelancers: 2 }] }
    const sheets = analyticsSheets(data, { labels: (field, i) => `${field}:${i.key}`, t: (k) => k })
    expect(Object.keys(sheets)).toEqual(['summary', 'sector', 'companyLocation', 'byYear'])
    expect(sheets.summary[0]).toEqual({ metric: 'companies', value: 3 })
    expect(sheets.sector).toEqual([{ label: 'by_sector:technology', count: 2 }])
    expect(sheets.byYear[0]).toMatchObject({ year: 2024, revenue: 50 })
  })
})
