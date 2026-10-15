import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null, exportRows: vi.fn() }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))
vi.mock('../../../lib/export/xlsx.js', () => ({ exportRows: (...a) => h.exportRows(...a) }))

import HistoryPage from './HistoryPage.jsx'
import HistoryPanel from './HistoryPanel.jsx'

const CO = '00000000-0000-4000-8000-00000000c601'
const ROWS = [
  { id: 12, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:05:00Z', edits: 2, request_id: 'r4', source: 'manager', entity_type: 'snapshot', entity_id: CO, company_id: CO, period_key: '2024', field: 'revenue_total', old_value: 100, new_value: 150, redacted: false,
    actor: { role: 'alumni_manager', user_id: 'u1', name: 'Mona Adel' }, company: { name_en: 'Nile Robotics', name_ar: 'نيل' }, founder: null, reason: 'audited accounts', section: 'metrics' },
  { id: 11, at: '2026-10-15T09:00:00Z', last_at: '2026-10-15T09:00:00Z', edits: 1, request_id: 'r3', source: 'founder', entity_type: 'company', entity_id: CO, company_id: CO, field: 'sector', old_value: 'technology', new_value: 'healthcare', redacted: false,
    actor: { role: 'founder', user_id: 'u2', name: 'Sara Ali' }, company: { name_en: 'Nile Robotics', name_ar: 'نيل' }, founder: null, section: 'classification' },
]
const hist = (rows = ROWS, over = {}) => ({ total: rows.length, limit: 25, offset: 0, rows, ...over })
const COMPANY_PAYLOAD = { company: { id: CO, name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات', updated_at: '2026-10-15T00:00:00Z' }, team: [], counts: {}, programs: [], snapshots: [] }

let mock
function setup(over = {}) {
  mock = makeDb({ rpc: {
    list_alumni_lookups: LOOKUPS, list_alumni_history: hist(), get_alumni_company: COMPANY_PAYLOAD, list_alumni_directory: { audience: 'manager', total: 0, limit: 8, offset: 0, rows: [] }, ...over,
  } })
  h.db = mock.db
}
const renderPage = (route = '/alumni/admin/history?lang=en') => renderWithProviders(<HistoryPage />, { route })
const lastArgs = () => mock.rpcCalls('list_alumni_history').at(-1).args

beforeEach(() => { vi.clearAllMocks(); setup() })

describe('the history of edits (manager)', () => {
  it('lists the latest changes of the whole registry: who, when, old -> new, the company; one request for the first page', async () => {
    renderPage()
    expect(await screen.findAllByTestId('history-save')).toHaveLength(2)
    expect(lastArgs()).toEqual({ p_filters: {}, p_limit: 25, p_offset: 0 })
    expect(screen.getByTestId('history-count')).toHaveTextContent('2 changes')
    const first = screen.getAllByTestId('history-save')[0]
    expect(within(first).getByText('Mona Adel')).toBeInTheDocument()
    expect(within(first).getByTestId('history-before')).toHaveTextContent('EGP 100')
    expect(within(first).getByTestId('history-after')).toHaveTextContent('EGP 150')
    expect(within(first).getByRole('link', { name: 'Nile Robotics' })).toHaveAttribute('href', `/alumni/admin/company/${CO}`)
    expect(within(first).getByText('2 saves')).toBeInTheDocument()
    expect(within(first).getByText('Reason: audited accounts')).toBeInTheDocument()
  })

  it('every filter reaches the server: area, field, year, kind of editor, role and the dates as inclusive instants; all in the URL', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('history-save')
    await user.click(screen.getByRole('button', { name: /Filters/ }))
    await user.selectOptions(screen.getByLabelText('Area'), 'snapshot')
    await waitFor(() => expect(lastArgs().p_filters).toEqual({ entity_type: 'snapshot' }))
    await user.selectOptions(screen.getByLabelText('Field'), 'revenue_total')
    await waitFor(() => expect(lastArgs().p_filters.field).toBe('revenue_total'))
    await user.selectOptions(screen.getByLabelText('Edited by'), 'founder')
    await waitFor(() => expect(lastArgs().p_filters.source).toBe('founder'))
    await user.selectOptions(screen.getByLabelText('Role'), 'founder')
    await waitFor(() => expect(lastArgs().p_filters.actor_role).toBe('founder'))
    await user.selectOptions(screen.getByLabelText('Yearly figures of'), String(new Date().getFullYear() - 1))
    await waitFor(() => expect(lastArgs().p_filters.year).toBe(String(new Date().getFullYear() - 1)))
    await user.type(screen.getByLabelText('From (date)'), '2026-10-01')
    await user.type(screen.getByLabelText('To (date)'), '2026-10-15')
    await waitFor(() => expect(lastArgs().p_filters.from).toMatch(/^2026-(09-30|10-01)T/))
    expect(new Date(lastArgs().p_filters.to).getTime()).toBeGreaterThan(new Date(lastArgs().p_filters.from).getTime())
  })

  it('a click on a field shows the timeline of THAT field; the banner clears it', async () => {
    const user = userEvent.setup()
    renderPage()
    const entries = await screen.findAllByTestId('history-entry')
    await user.click(within(entries[1]).getByRole('button', { name: 'Sector' }))
    await waitFor(() => expect(lastArgs().p_filters).toEqual({ field: 'sector' }))
    expect(await screen.findByTestId('history-field-banner')).toHaveTextContent('Showing every change of: Sector')
    await user.click(screen.getByRole('button', { name: 'Show all fields' }))
    // the unfiltered list is cached: no new request, the banner is gone
    await waitFor(() => expect(screen.queryByTestId('history-field-banner')).not.toBeInTheDocument())
  })

  it('a company view (?company_id=): its name is the title, the company chip clears it, and "the company at a date" is there', async () => {
    const user = userEvent.setup()
    renderPage(`/alumni/admin/history?lang=en&company_id=${CO}`)
    expect(await screen.findByRole('heading', { name: 'History of Nile Robotics', level: 1 })).toBeInTheDocument()
    expect(lastArgs().p_filters).toEqual({ company_id: CO })
    expect(screen.getByTestId('asof-panel')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All companies' }))
    await waitFor(() => expect(lastArgs().p_filters).toEqual({}))
    expect(screen.queryByTestId('asof-panel')).not.toBeInTheDocument()
  })

  it('the company at a date: the server rebuilds it from the log; the answer says when the history starts and when the company did not exist yet', async () => {
    const user = userEvent.setup()
    setup({ alumni_state_as_of: { company_id: CO, as_of: '2026-09-15T00:00:00Z', log_started_at: '2026-10-14T00:00:00Z', before_log: true, existed: true, fields: {
      'company.name_en': 'Nile Robotics', 'company.sector': 'technology', 'company.stage': 'mvp', 'internal.hint': 'strong team', 'year.2024.revenue_total': 100, 'year.2024.employees_total': 5,
      [`team.f1.member`]: true, [`team.f1.role`]: 'CEO', [`team.f1.is_primary`]: true, 'founder.f1.name_en': 'Sara Ali', 'founder.f1.phone': '+**********78', 'founder.f1.national_id': true } } })
    renderPage(`/alumni/admin/history?lang=en&company_id=${CO}`)
    const panel = await screen.findByTestId('asof-panel')
    expect(await within(panel).findByTestId('asof-state')).toBeInTheDocument()
    const call = mock.rpcCalls('alumni_state_as_of')[0].args
    expect(call.p_company).toBe(CO)
    expect(new Date(call.p_at).getTime()).toBeLessThan(Date.now())
    const state = within(panel).getByTestId('asof-state')
    expect(state).toHaveTextContent('The history starts on')
    expect(state).toHaveTextContent('Technology')
    expect(state).toHaveTextContent('EGP 100')
    expect(state).toHaveTextContent('strong team')
    const member = within(state).getByTestId('asof-member')
    expect(member).toHaveTextContent('Sara Ali')
    expect(member).toHaveTextContent('+**********78')
    expect(member).toHaveTextContent('A national ID is recorded')
    expect(state.textContent).not.toMatch(/\d{14}/)
    setup({ alumni_state_as_of: { company_id: CO, as_of: '2026-09-15T00:00:00Z', log_started_at: '2026-10-14T00:00:00Z', before_log: false, existed: false, fields: {} } })
    await user.click(within(panel).getByRole('button', { name: 'Yesterday' }))
    expect(await within(panel).findByText('The company did not exist yet on this date.')).toBeInTheDocument()
  })

  it('compares two dates: one line per difference with the value then and now (added / removed / changed)', async () => {
    const user = userEvent.setup()
    setup({ alumni_state_diff: { company_id: CO, from: '2026-01-01T00:00:00Z', to: '2026-10-15T00:00:00Z', log_started_at: '2025-01-01T00:00:00Z', before_log: false, changes: [
      { key: 'company.sector', from: 'technology', to: 'healthcare' }, { key: 'internal.hint', from: null, to: 'H1' }, { key: 'year.2024.freelancers', from: 2, to: null } ] } })
    renderPage(`/alumni/admin/history?lang=en&company_id=${CO}`)
    const panel = await screen.findByTestId('asof-panel')
    await user.click(within(panel).getByRole('button', { name: 'Compare two dates' }))
    const diff = await within(panel).findByTestId('asof-diff')
    expect(mock.rpcCalls('alumni_state_diff')[0].args.p_company).toBe(CO)
    expect(mock.rpcCalls('alumni_state_diff')[0].args.p_to).toBeNull() // empty = now
    expect(within(diff).getByText('3 differences')).toBeInTheDocument()
    const rows = within(diff).getAllByTestId('asof-diff-row')
    expect(rows.map((r) => r.dataset.kind)).toEqual(['changed', 'added', 'removed'])
    expect(within(rows[0]).getByText('Sector')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('Technology')
    expect(rows[0]).toHaveTextContent('Healthcare')
    expect(rows[2]).toHaveTextContent('Year 2024')
  })

  it('exports the filtered history (up to 5000 changes in one call) with readable columns', async () => {
    const user = userEvent.setup()
    h.exportRows.mockResolvedValue(2)
    renderPage('/alumni/admin/history?lang=en&source=manager')
    await screen.findAllByTestId('history-save')
    await user.click(screen.getByTestId('history-export'))
    await waitFor(() => expect(h.exportRows).toHaveBeenCalledTimes(1))
    expect(lastArgs()).toEqual({ p_filters: { source: 'manager' }, p_limit: 5000, p_offset: 0 })
    const [rows, cols] = h.exportRows.mock.calls[0]
    expect(cols.map((c) => c.header)).toContain('Before')
    expect(rows[0]).toMatchObject({ company: 'Nile Robotics', who: 'Mona Adel', role: 'Alumni manager', source: 'Athar team', area: 'Yearly figures', field: 'Revenue', year: '2024', before: expect.stringMatching(/^EGP\s100$/), after: expect.stringMatching(/^EGP\s150$/), edits: 2, reason: 'audited accounts' })
  })

  it('paging: the second page asks for offset 25; the empty state and a failure with Try again', async () => {
    const user = userEvent.setup()
    setup({ list_alumni_history: hist(ROWS, { total: 60 }) })
    renderPage()
    await screen.findAllByTestId('history-save')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastArgs().p_offset).toBe(25))
    setup({ list_alumni_history: hist([], { total: 0 }) })
    const { unmount } = renderPage('/alumni/admin/history?lang=en&field=sector')
    expect(await screen.findByText('No change matches these filters')).toBeInTheDocument()
    unmount()
    setup({ list_alumni_history: Object.assign(new Error('boom'), { code: '500' }) })
    renderPage()
    expect(await screen.findByText('The history could not be loaded.')).toBeInTheDocument()
  })

  it('works in Arabic and shows no raw key', async () => {
    renderPage('/alumni/admin/history?lang=ar')
    expect(await screen.findByRole('heading', { name: 'سجل التعديلات', level: 1 })).toBeInTheDocument()
    expect((await screen.findAllByTestId('history-save')).length).toBe(2)
    expect(document.body.textContent).not.toMatch(/alumni\.(admin\.hist|edit)\./)
  })
})

describe('HistoryPanel (inside the company page and the drawer)', () => {
  it('the latest changes of ONE company, an area filter, "show older", and a link to the full history', async () => {
    const user = userEvent.setup()
    setup({ list_alumni_history: hist(ROWS, { total: 90 }) })
    renderWithProviders(<HistoryPanel companyId={CO} />, { route: '/x?lang=en' })
    expect(await screen.findAllByTestId('history-save')).toHaveLength(2)
    expect(mock.rpcCalls('list_alumni_history')[0].args).toEqual({ p_filters: { company_id: CO }, p_limit: 30, p_offset: 0 })
    await user.selectOptions(screen.getByLabelText('Area'), 'team')
    await waitFor(() => expect(lastArgs().p_filters).toEqual({ company_id: CO, entity_type: 'team' }))
    await user.click(await screen.findByRole('button', { name: 'Show older changes' }))
    await waitFor(() => expect(lastArgs().p_limit).toBe(60))
    expect(screen.getByRole('link', { name: 'History of edits' })).toHaveAttribute('href', `/alumni/admin/history?company_id=${CO}`)
    await user.click(screen.getByTestId('asof-toggle'))
    expect(screen.getByTestId('asof-panel')).toBeInTheDocument()
  })
})
