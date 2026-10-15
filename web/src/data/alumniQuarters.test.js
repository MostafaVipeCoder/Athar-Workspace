import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }) }))

const A = await import('./alumniQuarters.js')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null })
})

/** The contract: RPC name + argument names of every function of m66 - m68 (SQL parameter names, `p_...`). A drift between the SQL and the client fails here. */
describe('data/alumniQuarters.js pins the RPC names and parameters of m66 - m68', () => {
  const calls = [
    ['getCompanyFigures', () => A.getCompanyFigures('c1'), 'get_company_figures', { p_company: 'c1' }],
    ['saveCompanyFigures (no version)', () => A.saveCompanyFigures('c1', { revenue_total: 5 }), 'save_company_figures', { p_company: 'c1', p_data: { revenue_total: 5 } }],
    ['saveCompanyFigures (the version the form loaded)', () => A.saveCompanyFigures('c1', { revenue_total: 5 }, '2026-10-15T01:00:00+00:00'), 'save_company_figures', { p_company: 'c1', p_data: { revenue_total: 5 }, p_expected: '2026-10-15T01:00:00+00:00' }],
    ['saveCompanyFigures (no draft yet)', () => A.saveCompanyFigures('c1', { revenue_total: 5 }, A.NO_DRAFT), 'save_company_figures', { p_company: 'c1', p_data: { revenue_total: 5 }, p_expected: '-infinity' }],
    ['confirmCompanyFigures', () => A.confirmCompanyFigures('c1'), 'confirm_company_figures', { p_company: 'c1' }],
    ['closeAlumniQuarter (all)', () => A.closeAlumniQuarter('2026-Q4'), 'close_alumni_quarter', { p_period: '2026-Q4', p_company: null }],
    ['closeAlumniQuarter (one company)', () => A.closeAlumniQuarter('2026-Q4', 'c1'), 'close_alumni_quarter', { p_period: '2026-Q4', p_company: 'c1' }],
    ['reopenAlumniQuarter', () => A.reopenAlumniQuarter('2026-Q4', 'c1'), 'reopen_alumni_quarter', { p_period: '2026-Q4', p_company: 'c1' }],
    ['refreezeAlumniQuarter', () => A.refreezeAlumniQuarter('2026-Q4'), 'refreeze_alumni_quarter', { p_period: '2026-Q4', p_company: null }],
    ['correctAlumniSnapshot', () => A.correctAlumniSnapshot('c1', '2026-Q4', { revenue_total: 120000 }), 'correct_alumni_snapshot', { p_company: 'c1', p_period: '2026-Q4', p_data: { revenue_total: 120000 } }],
    ['getAlumniPortfolio (defaults)', () => A.getAlumniPortfolio(), 'get_alumni_portfolio', { p_filters: {}, p_from: null, p_to: null }],
    ['getAlumniPortfolio', () => A.getAlumniPortfolio({ filters: { sector: 'technology' }, from: '2025-Q4', to: '2026-Q2' }), 'get_alumni_portfolio', { p_filters: { sector: 'technology' }, p_from: '2025-Q4', p_to: '2026-Q2' }],
    ['listAlumniQuarterStatus (defaults)', () => A.listAlumniQuarterStatus(), 'list_alumni_quarter_status', { p_period: null, p_filters: {}, p_status: null, p_limit: 50, p_offset: 0, p_sort: 'name', p_dir: 'asc' }],
    ['listAlumniQuarterStatus', () => A.listAlumniQuarterStatus({ period: '2026-Q4', filters: { q: 'x' }, status: 'not_updated', limit: 500, offset: 500, sort: 'status', dir: 'desc' }), 'list_alumni_quarter_status', { p_period: '2026-Q4', p_filters: { q: 'x' }, p_status: 'not_updated', p_limit: 500, p_offset: 500, p_sort: 'status', p_dir: 'desc' }],
    ['getAlumniQuarterSettings', () => A.getAlumniQuarterSettings(), 'get_alumni_quarter_settings', {}],
    ['setAlumniQuarterSettings', () => A.setAlumniQuarterSettings({ reminder_offsets: [14, 3], send_hour: 10 }), 'set_alumni_quarter_settings', { p_patch: { reminder_offsets: [14, 3], send_hour: 10 } }],
    ['saveAlumniReminderTemplate', () => A.saveAlumniReminderTemplate('ar', { notif_title: 'x' }), 'save_alumni_reminder_template', { p_lang: 'ar', p_patch: { notif_title: 'x' } }],
    ['resetAlumniReminderTemplate', () => A.resetAlumniReminderTemplate('en'), 'reset_alumni_reminder_template', { p_lang: 'en' }],
    ['previewAlumniReminderTemplate', () => A.previewAlumniReminderTemplate('en', { email_body: 'x' }), 'preview_alumni_reminder_template', { p_lang: 'en', p_template: { email_body: 'x' } }],
    ['previewAlumniReminders (defaults)', () => A.previewAlumniReminders(), 'preview_alumni_reminders', { p_period: null, p_company_ids: null, p_filters: null, p_only_new: false }],
    ['previewAlumniReminders (selected)', () => A.previewAlumniReminders({ period: '2026-Q4', companyIds: ['c1'], onlyNew: true }), 'preview_alumni_reminders', { p_period: '2026-Q4', p_company_ids: ['c1'], p_filters: null, p_only_new: true }],
    ['sendAlumniReminders', () => A.sendAlumniReminders({ period: '2026-Q4', filters: { q: 'x' }, token: 'tok-12345678', expectedCount: 150, appUrl: 'https://athar.example/app' }), 'send_alumni_reminders',
      { p_period: '2026-Q4', p_company_ids: null, p_filters: { q: 'x' }, p_only_new: false, p_token: 'tok-12345678', p_expected_count: 150, p_app_url: 'https://athar.example/app' }],
    ['listAlumniReminderCampaigns', () => A.listAlumniReminderCampaigns({ period: '2026-Q4', limit: 5, offset: 5 }), 'list_alumni_reminder_campaigns', { p_period: '2026-Q4', p_limit: 5, p_offset: 5 }],
  ]
  it.each(calls)('%s', async (_name, run, rpc, args) => {
    await run()
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args)
  })
})

describe('the rest', () => {
  it('a send token is a fresh 32-character id each time (a double click is one send, a resend a new dialog)', () => {
    const a = A.newSendToken()
    const b = A.newSendToken()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
  it('the draft rows of a page are one query for the page\'s companies; no ids = no call', async () => {
    expect(await A.listDraftsForCompanies([])).toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()
    const api = { select: vi.fn(() => api), in: vi.fn(() => Promise.resolve({ data: [{ company_id: 'c1' }], error: null })) }
    mocks.from.mockReturnValue(api)
    expect(await A.listDraftsForCompanies(['c1', 'c2'])).toEqual([{ company_id: 'c1' }])
    expect(mocks.from).toHaveBeenCalledWith('company_figures')
    expect(api.in).toHaveBeenCalledWith('company_id', ['c1', 'c2'])
  })
  it('query keys live under [alumni, quarters] so a shared save refreshes them, and carry no personal data', () => {
    for (const k of [A.quarterKeys.figures('c1'), A.quarterKeys.portfolio({}), A.quarterKeys.status({}), A.quarterKeys.settings(), A.quarterKeys.campaigns({}), A.quarterKeys.recipients('k'), A.quarterKeys.drafts(['c1'])]) {
      expect(k.slice(0, 2)).toEqual(['alumni', 'quarters'])
    }
  })
})
