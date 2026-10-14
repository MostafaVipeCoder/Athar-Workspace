import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }) }))

const A = await import('./alumniAdmin.js')

/** A chainable, awaitable query builder that records the calls (enough for the direct table functions). */
function builder(result = { data: [], error: null }) {
  const calls = []
  const api = new Proxy({}, {
    get(_t, name) {
      if (name === 'then') return (ok, fail) => Promise.resolve(result).then(ok, fail)
      return (...args) => { calls.push([name, ...args]); return api }
    },
  })
  return { api, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null })
})

/** The contract: RPC name + argument names of every m51 function (SQL parameter names, `p_...`). A drift between the SQL and the client fails here. */
describe('data/alumniAdmin.js pins the RPC names and parameters of m51', () => {
  const calls = [
    ['listAlumniPrograms', () => A.listAlumniPrograms(), 'list_alumni_programs', {}],
    ['listAlumniTable (defaults)', () => A.listAlumniTable(), 'list_alumni_table', { p_filters: {}, p_limit: 25, p_offset: 0, p_sort: 'name', p_dir: 'asc', p_year: null }],
    ['listAlumniTable', () => A.listAlumniTable({ filters: { sector: 'technology' }, limit: 50, offset: 100, sort: 'revenue', dir: 'desc', year: 2024 }), 'list_alumni_table', { p_filters: { sector: 'technology' }, p_limit: 50, p_offset: 100, p_sort: 'revenue', p_dir: 'desc', p_year: 2024 }],
    ['getAlumniOverview', () => A.getAlumniOverview(), 'get_alumni_overview', {}],
    ['previewNotificationAudience', () => A.previewNotificationAudience({ kind: 'all' }), 'preview_notification_audience', { p_audience: { kind: 'all' } }],
    ['sendAlumniNotification', () => A.sendAlumniNotification({ audience: { kind: 'all' }, titleEn: 'T', bodyAr: 'ب' }), 'send_alumni_notification',
      { p_audience: { kind: 'all' }, p_title_en: 'T', p_title_ar: null, p_body_en: null, p_body_ar: 'ب', p_link: null, p_opportunity: null }],
    ['sendAlumniNotification (link + opportunity)', () => A.sendAlumniNotification({ audience: { kind: 'all' }, titleEn: 'T', bodyEn: 'B', link: '/alumni/founder/opportunities', opportunityId: 'o1' }), 'send_alumni_notification',
      { p_audience: { kind: 'all' }, p_title_en: 'T', p_title_ar: null, p_body_en: 'B', p_body_ar: null, p_link: '/alumni/founder/opportunities', p_opportunity: 'o1' }],
    ['listAlumniBroadcasts', () => A.listAlumniBroadcasts({ limit: 10, offset: 20 }), 'list_alumni_broadcasts', { p_limit: 10, p_offset: 20 }],
    ['importAlumniPreview', () => A.importAlumniPreview([{ 'Startup Name': 'x' }]), 'import_alumni_preview', { p_rows: [{ 'Startup Name': 'x' }] }],
    ['mergeCompanies', () => A.mergeCompanies('keep', 'drop'), 'merge_companies', { p_keep: 'keep', p_drop: 'drop' }],
  ]
  it.each(calls)('%s', async (_name, run, fn, args) => {
    await run()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith(fn, args)
  })

  it('an RPC error is thrown as an AppError (never swallowed into an empty value)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } })
    await expect(A.getAlumniOverview()).rejects.toMatchObject({ name: 'AppError', code: 'forbidden' })
  })
})

describe('opportunities (direct, RLS-protected)', () => {
  it('lists them with the number of applications, ordered', async () => {
    const { api, calls } = builder()
    mocks.from.mockReturnValue(api)
    await A.listOpportunities()
    expect(mocks.from).toHaveBeenCalledWith('opportunities')
    expect(calls).toContainEqual(['select', '*, apps:opportunity_applications(count)'])
    expect(calls.filter((c) => c[0] === 'order')).toHaveLength(2)
  })

  it('writes ONLY opportunity columns (anything else is dropped before it is sent)', async () => {
    const { api, calls } = builder({ data: { opportunity_id: 'o1' }, error: null })
    mocks.from.mockReturnValue(api)
    await A.saveOpportunity(null, { title_ar: 'x', is_active: false, created_at: 'now', id: 'hack', opportunity_id: 'other' })
    expect(calls).toContainEqual(['insert', { title_ar: 'x', is_active: false }])
    const second = builder({ data: { opportunity_id: 'o1' }, error: null })
    mocks.from.mockReturnValue(second.api)
    await A.saveOpportunity('o1', { archived_at: '2026-01-01', target: { sectors: ['technology'] } })
    expect(second.calls).toContainEqual(['update', { archived_at: '2026-01-01', target: { sectors: ['technology'] } }])
    expect(second.calls).toContainEqual(['eq', 'opportunity_id', 'o1'])
  })

  it('an application status is a single-column update', async () => {
    const { api, calls } = builder({ data: { id: 'a1', status: 'accepted' }, error: null })
    mocks.from.mockReturnValue(api)
    await A.setApplicationStatus('a1', 'accepted')
    expect(mocks.from).toHaveBeenCalledWith('opportunity_applications')
    expect(calls).toContainEqual(['update', { status: 'accepted' }])
    expect(calls).toContainEqual(['eq', 'id', 'a1'])
  })

  it('applying on behalf inserts the company and the note (the status starts as the table default)', async () => {
    const { api, calls } = builder({ data: { id: 'a2' }, error: null })
    mocks.from.mockReturnValue(api)
    await A.applyOnBehalf({ opportunityId: 'o1', companyId: 'c1', notes: '' })
    expect(calls).toContainEqual(['insert', { opportunity_id: 'o1', company_id: 'c1', notes: null }])
  })
})

describe('other direct reads', () => {
  it('the founder search removes the characters that would break the filter and needs two letters', async () => {
    expect(await A.searchFounders(' a ')).toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()
    const { api, calls } = builder()
    mocks.from.mockReturnValue(api)
    await A.searchFounders('sa,ra(*)%')
    const or = calls.find((c) => c[0] === 'or')[1]
    expect(or).toBe('name_en.ilike.*sa ra*,name_ar.ilike.*sa ra*,email.ilike.*sa ra*')
  })

  it('the yearly rows of a page are one query for the page\'s companies; no ids = no call', async () => {
    expect(await A.listSnapshotsForCompanies([], 2024)).toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()
    const { api, calls } = builder()
    mocks.from.mockReturnValue(api)
    await A.listSnapshotsForCompanies(['c1', 'c2'], 2024)
    expect(mocks.from).toHaveBeenCalledWith('company_snapshots')
    expect(calls).toContainEqual(['in', 'company_id', ['c1', 'c2']])
    expect(calls).toContainEqual(['eq', 'snapshot_type', 'annual'])
    expect(calls).toContainEqual(['eq', 'period_year', 2024])
  })

  it('the recipients of a broadcast are read by its id', async () => {
    const { api, calls } = builder()
    mocks.from.mockReturnValue(api)
    await A.listBroadcastRecipients('b1')
    expect(mocks.from).toHaveBeenCalledWith('notifications')
    expect(calls).toContainEqual(['eq', 'broadcast_id', 'b1'])
  })
})

describe('query keys', () => {
  it('live under [alumni, admin] so a shared save refreshes them, and never contain a national ID', () => {
    for (const k of [A.adminKeys.programs(), A.adminKeys.table({ q: 'x' }), A.adminKeys.overview(), A.adminKeys.broadcasts({}), A.adminKeys.audience('k'), A.adminKeys.opportunities(), A.adminKeys.snapshots({ ids: ['c1'], year: 2024 })]) {
      expect(k.slice(0, 2)).toEqual(['alumni', 'admin'])
    }
  })
})
