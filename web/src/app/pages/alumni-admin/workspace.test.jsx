import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb, tablePage, tableRow } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import WorkspacePage from './WorkspacePage.jsx'

const FIG = (status, over = {}) => ({ status, period: '2026-Q4', updated_at: null, confirmed_at: null, ...over })
const ROWS = [
  tableRow({ figures: FIG('updated', { updated_at: '2026-10-01T00:00:00Z' }) }),
  tableRow({ id: 'c2', name_en: 'Delta Health', name_ar: 'دلتا', completeness: { percent: 40, missing: ['annual_update'] }, figures: FIG('confirmed', { updated_at: '2026-10-02T00:00:00Z' }) }),
  tableRow({ id: 'c3', name_en: 'Sinai Agritech', name_ar: 'سيناء', figures: FIG('not_updated') }),
]
// the DRAFTS of the quarter (company_figures): c3 has none yet
const DRAFTS = [
  { company_id: 'c1', period_key: '2026-Q4', revenue_total: 910000, funding_raised_total: 400000, employees_total: 11, employees_female: 5, freelancers: 3, traction: 'T', challenges: null, needs: null, updated_source: 'founder', updated_at: '2026-10-01T00:00:00Z', confirmed_period: null, confirmed_at: null },
  { company_id: 'c2', period_key: '2026-Q4', revenue_total: 120000, funding_raised_total: null, employees_total: 4, employees_female: 3, freelancers: null, traction: null, challenges: null, needs: null, updated_source: 'manager', updated_at: '2026-10-02T00:00:00Z', confirmed_period: '2026-Q4', confirmed_at: '2026-10-03T00:00:00Z' },
]
let mock
function setup(extra = {}, tables = { company_figures: DRAFTS }) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_programs: { programs: [] },
      list_alumni_table: (a) => tablePage(ROWS, { limit: a.p_limit, offset: a.p_offset }),
      save_company_figures: () => ({ saved: true, changed: true, draft: {} }),
      ...extra,
    },
    tables,
  })
  h.db = mock.db
}
const renderPage = (route = '/alumni/admin/workspace?lang=en') => renderWithProviders(<ConfirmProvider><WorkspacePage /></ConfirmProvider>, { route })
const cell = (company, field) => screen.getByRole('textbox', { name: `${field}: ${company}` })

beforeEach(() => setup())

describe('the figures grid (the draft of the current quarter)', () => {
  it('an EMPTY table shows the empty state, not skeletons for ever (the drafts are only read when there are rows)', async () => {
    setup({ list_alumni_table: (a) => tablePage([], { limit: a.p_limit, offset: a.p_offset }) })
    renderPage()
    expect(await screen.findByText('No company matches.')).toBeInTheDocument()
    expect(screen.queryByTestId('ws-grid')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0)
    expect(mock.tableCalls('company_figures')).toHaveLength(0)
  })

  it('a FAILED table query shows the error state with a retry that works', async () => {
    const user = userEvent.setup()
    let fail = true
    setup({ list_alumni_table: (a) => (fail ? Object.assign(new Error('boom'), { code: '500', status: 500 }) : tablePage(ROWS, { limit: a.p_limit, offset: a.p_offset })) })
    renderPage()
    expect(await screen.findByText('The companies could not be loaded.')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Nile Robotics')).toBeInTheDocument()
  })

  it('a failed drafts query (rows exist) is its own error state with a retry', async () => {
    setup({}, { company_figures: () => Object.assign(new Error('boom'), { status: 500 }) })
    renderPage()
    expect(await screen.findByText('The figures could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByTestId('ws-grid')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('shows the quarter being logged, one row per company with the stored DRAFT in the cells and the status of the figures (confirmed / updated / not updated)', async () => {
    renderPage()
    expect(await screen.findByText('Nile Robotics')).toBeInTheDocument()
    expect(screen.getByTestId('ws-quarter')).toHaveTextContent('Quarter: Q4 2026')
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('910000')
    expect(cell('Nile Robotics', 'Employees')).toHaveValue('11')
    expect(cell('Delta Health', 'Funding raised')).toHaveValue('')
    const rows = screen.getAllByTestId('ws-row')
    expect(within(rows[0]).getByTestId('figures-status')).toHaveAttribute('data-status', 'updated')
    expect(within(rows[1]).getByTestId('figures-status')).toHaveAttribute('data-status', 'confirmed')
    expect(within(rows[2]).getByTestId('figures-status')).toHaveAttribute('data-status', 'not_updated')
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.')
  })

  it('saves ONLY the cells that changed, one draft per company, as a patch (cleared = null) with the version of the draft the grid loaded; nothing else is sent', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.clear(cell('Nile Robotics', 'Employees'))
    await user.type(cell('Nile Robotics', 'Employees'), '12')
    await user.clear(cell('Nile Robotics', 'Freelancers'))
    await user.type(cell('Sinai Agritech', 'Revenue'), '1,500,000')
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('2 rows changed')
    await user.click(screen.getByTestId('ws-save'))
    await waitFor(() => expect(mock.rpcCalls('save_company_figures')).toHaveLength(2))
    const calls = mock.rpcCalls('save_company_figures').map((c) => c.args)
    expect(calls).toContainEqual({ p_company: 'c1', p_data: { employees_total: 12, freelancers: null }, p_expected: '2026-10-01T00:00:00Z' })
    expect(calls).toContainEqual({ p_company: 'c3', p_data: { revenue_total: 1500000 }, p_expected: '-infinity' }) // no draft yet: a draft that appeared meanwhile is a conflict
    expect(calls.map((c) => c.p_company)).not.toContain('c2')
    await waitFor(() => expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.'))
  })

  it('a draft somebody saved first: their latest values are loaded, my edit stays, the figure we BOTH changed is marked with their value, and Save again carries the fresh version', async () => {
    const user = userEvent.setup()
    let fresh = false
    const stale = Object.assign(new Error('alumni_stale: reload'), { code: 'P0001', hint: 'alumni_stale' })
    const FRESH = [{ ...DRAFTS[0], employees_total: 20, freelancers: 7, updated_source: 'manager', updated_at: '2026-10-14T00:00:00Z' }, DRAFTS[1]]
    setup({ save_company_figures: (a) => (a.p_expected === '2026-10-01T00:00:00Z' ? stale : { saved: true, changed: true, draft: {} }) }, { company_figures: () => (fresh ? FRESH : DRAFTS) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.clear(cell('Nile Robotics', 'Employees'))
    await user.type(cell('Nile Robotics', 'Employees'), '12')
    await user.clear(cell('Nile Robotics', 'Revenue'))
    await user.type(cell('Nile Robotics', 'Revenue'), '2000000')
    fresh = true
    await user.click(screen.getByTestId('ws-save'))
    const row = (await screen.findAllByTestId('ws-row'))[0]
    expect(await within(row).findByRole('alert')).toHaveTextContent('Changed by the Athar team on')
    expect(within(row).getByTestId('ws-conflict-cell')).toHaveTextContent('Now: 20')
    expect(within(row).getAllByTestId('ws-conflict-cell')).toHaveLength(1)
    expect(cell('Nile Robotics', 'Employees')).toHaveValue('12')
    expect(cell('Nile Robotics', 'Freelancers')).toHaveValue('7')
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('2000000')
    await user.click(screen.getByTestId('ws-save'))
    await waitFor(() => expect(mock.rpcCalls('save_company_figures')).toHaveLength(2))
    expect(mock.rpcCalls('save_company_figures')[1].args).toEqual({ p_company: 'c1', p_data: { employees_total: 12, revenue_total: 2000000 }, p_expected: '2026-10-14T00:00:00Z' })
  })

  it('a stale draft whose figures equal what the other side saved has nothing left to save', async () => {
    const user = userEvent.setup()
    let fresh = false
    const stale = Object.assign(new Error('alumni_stale: reload'), { code: 'P0001', hint: 'alumni_stale' })
    const FRESH = [{ ...DRAFTS[0], employees_total: 12, updated_source: 'founder', updated_at: '2026-10-14T00:00:00Z' }, DRAFTS[1]]
    setup({ save_company_figures: stale }, { company_figures: () => (fresh ? FRESH : DRAFTS) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.clear(cell('Nile Robotics', 'Employees'))
    await user.type(cell('Nile Robotics', 'Employees'), '12')
    fresh = true
    await user.click(screen.getByTestId('ws-save'))
    const row = (await screen.findAllByTestId('ws-row'))[0]
    expect(await within(row).findByRole('alert')).toHaveTextContent('your edits were the same')
    await waitFor(() => expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.'))
  })

  it('under each draft: who last modified it and when (a single "last modified", no history)', async () => {
    renderPage()
    await screen.findByText('Nile Robotics')
    const stamps = await screen.findAllByTestId('ws-stamp')
    expect(stamps[0]).toHaveTextContent('Founder on')
    expect(stamps[1]).toHaveTextContent('Athar team on')
  })

  it('blocks the save while a cell is invalid (female more than the total, not a number) and sends nothing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.clear(cell('Nile Robotics', 'Female employees'))
    await user.type(cell('Nile Robotics', 'Female employees'), '99')
    expect(await screen.findByText('More than the total employees')).toBeInTheDocument()
    expect(cell('Nile Robotics', 'Female employees')).toHaveAttribute('aria-invalid', 'true')
    await user.type(cell('Delta Health', 'Revenue'), 'abc')
    expect(screen.getByText('Not a number')).toBeInTheDocument()
    await user.click(screen.getByTestId('ws-save'))
    expect(await screen.findByText('Fix the marked cells first.')).toBeInTheDocument()
    expect(mock.rpcCalls('save_company_figures')).toHaveLength(0)
  })

  it('a row the server refuses stays marked with the reason while the others are saved', async () => {
    const user = userEvent.setup()
    setup({ save_company_figures: (a) => (a.p_company === 'c2' ? Object.assign(new Error('alumni_invalid: employees_female:exceeds_total'), { code: '22023', hint: 'alumni_invalid', details: 'employees_female:exceeds_total' }) : { saved: true, changed: true, draft: {} }) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(cell('Nile Robotics', 'Revenue'), '0')
    await user.clear(cell('Delta Health', 'Employees'))
    await user.type(cell('Delta Health', 'Employees'), '5')
    await user.click(screen.getByTestId('ws-save'))
    expect((await screen.findAllByRole('alert')).some((a) => /Not saved/.test(a.textContent))).toBe(true)
    await waitFor(() => expect(screen.getAllByTestId('ws-row').filter((r) => r.hasAttribute('data-dirty'))).toHaveLength(1))
  })

  it('discard drops the edits', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(cell('Nile Robotics', 'Revenue'), '5')
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('9100005')
    await user.click(screen.getByRole('button', { name: 'Discard the changes' }))
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('910000')
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.')
  })

  it('edits survive paging (they live here until saved or discarded)', async () => {
    const user = userEvent.setup()
    setup({ list_alumni_table: (a) => tablePage(ROWS.slice(0, 2), { total: 60, limit: a.p_limit, offset: a.p_offset }) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(cell('Nile Robotics', 'Revenue'), '1')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_table').at(-1).args.p_offset).toBe(25))
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('1 row changed')
  })

  it('the closed quarters of a company are one link away (its page), not a dialog of yearly rows to delete', async () => {
    renderPage()
    await screen.findByText('Nile Robotics')
    expect(screen.getByRole('link', { name: 'Quarterly figures: Nile Robotics' })).toHaveAttribute('href', '/alumni/admin/company/c1#metrics')
    expect(screen.queryByRole('button', { name: /Delete 20/ })).not.toBeInTheDocument()
  })

  it('the texts open in a dialog and are saved as a patch of what changed, with the version of the draft', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('button', { name: 'Notes: Nile Robotics' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Traction / validation')).toHaveValue('T')
    await user.type(within(dialog).getByLabelText('Needs'), 'A licence')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('save_company_figures')).toHaveLength(1))
    expect(mock.rpcCalls('save_company_figures')[0].args).toEqual({ p_company: 'c1', p_data: { needs: 'A licence' }, p_expected: '2026-10-01T00:00:00Z' })
  })

  it('the "incomplete" filter and the scope go to the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('checkbox', { name: /Only companies with an incomplete profile/ }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_table').at(-1).args.p_filters).toMatchObject({ incomplete: true, scope: 'alumni' }))
    await user.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_table').at(-1).args.p_filters).toMatchObject({ scope: 'all' }))
  })
})
