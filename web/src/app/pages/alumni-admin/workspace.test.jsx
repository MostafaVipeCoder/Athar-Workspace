import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb, tablePage, tableRow } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import WorkspacePage from './WorkspacePage.jsx'

const ROWS = [tableRow(), tableRow({ id: 'c2', name_en: 'Delta Health', name_ar: 'دلتا', completeness: { percent: 40, missing: ['annual_update'] } }), tableRow({ id: 'c3', name_en: 'Sinai Agritech', name_ar: 'سيناء' })]
const SNAPS = [
  { company_id: 'c1', snapshot_type: 'annual', period_year: 2024, revenue_total: 910000, funding_raised_total: 400000, employees_total: 11, employees_female: 5, freelancers: 3, traction: 'T', challenges: null, needs: null, source: 'founder', updated_at: '2026-10-01T00:00:00Z' },
  { company_id: 'c2', snapshot_type: 'annual', period_year: 2024, revenue_total: 120000, funding_raised_total: null, employees_total: 4, employees_female: 3, freelancers: null, traction: null, challenges: null, needs: null, source: 'manager', updated_at: '2026-10-01T00:00:00Z' },
]
let mock
function setup(extra = {}, tables = { company_snapshots: SNAPS }) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      get_alumni_overview: { latest_year: 2024, companies: {}, invitations: {}, completeness: { missing_by: [] } },
      list_alumni_programs: { programs: [] },
      list_alumni_table: (a) => tablePage(ROWS, { year: a.p_year, limit: a.p_limit, offset: a.p_offset }),
      upsert_company_snapshot: (a) => ({ saved: true, snapshot: { year: a.p_year }, snapshots: [] }),
      get_alumni_company: { company: { id: 'c1' }, team: [], counts: {}, programs: [], snapshots: [{ id: 's1', year: 2024, revenue_total: 910000, funding_raised_total: 400000, employees_total: 11, employees_female: 5, freelancers: 3, source: 'founder', updated_at: '2026-10-01T00:00:00Z' }, { id: 's0', year: 2023, revenue_total: 480000, source: 'manager', updated_at: '2026-01-01T00:00:00Z' }] },
      delete_company_snapshot: { deleted: true, snapshots: [] },
      ...extra,
    },
    tables,
  })
  h.db = mock.db
}
const renderPage = (route = '/alumni/admin/workspace?lang=en') => renderWithProviders(<ConfirmProvider><WorkspacePage /></ConfirmProvider>, { route })
const cell = (company, field) => screen.getByRole('textbox', { name: `${field}: ${company}` })

beforeEach(() => setup())

describe('the M&E workspace grid', () => {
  it('an EMPTY table shows the empty state, not skeletons for ever (the yearly rows are only waited for when there are rows)', async () => {
    setup({ list_alumni_table: (a) => tablePage([], { year: a.p_year, limit: a.p_limit, offset: a.p_offset }) })
    renderPage()
    expect(await screen.findByText('No company matches.')).toBeInTheDocument()
    expect(screen.queryByTestId('ws-grid')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0)
    expect(mock.tableCalls('company_snapshots')).toHaveLength(0) // nothing to read for no company
  })

  it('a FAILED table query shows the error state with a retry that works (it used to stay skeletal)', async () => {
    const user = userEvent.setup()
    let fail = true
    setup({ list_alumni_table: (a) => (fail ? Object.assign(new Error('boom'), { code: '500', status: 500 }) : tablePage(ROWS, { year: a.p_year, limit: a.p_limit, offset: a.p_offset })) })
    renderPage()
    expect(await screen.findByText('The companies could not be loaded.')).toBeInTheDocument()
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0)
    fail = false
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Nile Robotics')).toBeInTheDocument()
  })

  it('a failed yearly-figures query (rows exist) is its own error state with a retry', async () => {
    setup()
    mock = makeDb({ rpc: { ...{}, list_alumni_lookups: LOOKUPS, get_alumni_overview: { latest_year: 2024, companies: {}, invitations: {}, completeness: { missing_by: [] } }, list_alumni_programs: { programs: [] },
      list_alumni_table: (a) => tablePage(ROWS, { year: a.p_year, limit: a.p_limit, offset: a.p_offset }) }, tables: { company_snapshots: () => Object.assign(new Error('boom'), { status: 500 }) } })
    h.db = mock.db
    renderPage()
    expect(await screen.findByText('The yearly figures could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByTestId('ws-grid')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('logs the LATEST year with data by default: one row per company, the stored figures in the cells, a "reported / missing" chip', async () => {
    renderPage()
    expect(await screen.findByText('Nile Robotics')).toBeInTheDocument()
    expect(screen.getByLabelText('Year being logged')).toHaveValue('2024')
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('910000')
    expect(cell('Nile Robotics', 'Employees')).toHaveValue('11')
    expect(cell('Delta Health', 'Funding raised')).toHaveValue('')
    const rows = screen.getAllByTestId('ws-row')
    expect(within(rows[0]).getByText('Reported')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Missing')).toBeInTheDocument() // no yearly row for Sinai in 2024
    expect(mock.tableCalls('company_snapshots')[0].filters).toContainEqual(['eq', 'period_year', 2024])
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.')
  })

  it('saves ONLY the cells that changed, one yearly row per company, as a patch (cleared = null); nothing else is sent', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.clear(cell('Nile Robotics', 'Employees'))
    await user.type(cell('Nile Robotics', 'Employees'), '12')
    await user.clear(cell('Nile Robotics', 'Freelancers'))
    await user.type(cell('Sinai Agritech', 'Revenue'), '1,500,000')
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('2 rows changed')
    expect(screen.getAllByTestId('ws-row').filter((r) => r.hasAttribute('data-dirty'))).toHaveLength(2)
    await user.click(screen.getByTestId('ws-save'))
    await waitFor(() => expect(mock.rpcCalls('upsert_company_snapshot')).toHaveLength(2))
    const calls = mock.rpcCalls('upsert_company_snapshot').map((c) => c.args)
    // each row carries the version of the yearly row the grid loaded (a row with no figures yet: '-infinity'): a row somebody saved meanwhile is a conflict
    expect(calls).toContainEqual({ p_company: 'c1', p_year: 2024, p_data: { employees_total: 12, freelancers: null }, p_expected: '2026-10-01T00:00:00Z' })
    expect(calls).toContainEqual({ p_company: 'c3', p_year: 2024, p_data: { revenue_total: 1500000 }, p_expected: '-infinity' })
    expect(calls.map((c) => c.p_company)).not.toContain('c2') // an untouched row is not saved
    await waitFor(() => expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.'))
  })

  it('a row somebody saved first: their latest values are loaded, my edit stays, the figure we BOTH changed is marked with their value, and Save again carries the fresh version', async () => {
    const user = userEvent.setup()
    let fresh = false
    const stale = Object.assign(new Error('alumni_stale: reload'), { code: 'P0001', hint: 'alumni_stale' })
    const FRESH = [{ ...SNAPS[0], employees_total: 20, freelancers: 7, source: 'manager', updated_at: '2026-10-14T00:00:00Z' }, SNAPS[1]]
    setup({ upsert_company_snapshot: (a) => (a.p_expected === '2026-10-01T00:00:00Z' ? stale : { saved: true, snapshot: {}, snapshots: [] }) }, { company_snapshots: () => (fresh ? FRESH : SNAPS) })
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
    expect(within(row).getByTestId('ws-conflict-cell')).toHaveTextContent('Now: 20') // employees: both of us changed it
    expect(within(row).getAllByTestId('ws-conflict-cell')).toHaveLength(1)
    expect(cell('Nile Robotics', 'Employees')).toHaveValue('12') // mine is still typed
    expect(cell('Nile Robotics', 'Freelancers')).toHaveValue('7') // theirs, which I did not touch
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('2000000')
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('1 row changed')
    await user.click(screen.getByTestId('ws-save'))
    await waitFor(() => expect(mock.rpcCalls('upsert_company_snapshot')).toHaveLength(2))
    expect(mock.rpcCalls('upsert_company_snapshot')[1].args).toEqual({ p_company: 'c1', p_year: 2024, p_data: { employees_total: 12, revenue_total: 2000000 }, p_expected: '2026-10-14T00:00:00Z' })
  })

  it('a stale row whose figures equal what the other side saved has nothing left to save', async () => {
    const user = userEvent.setup()
    let fresh = false
    const stale = Object.assign(new Error('alumni_stale: reload'), { code: 'P0001', hint: 'alumni_stale' })
    const FRESH = [{ ...SNAPS[0], employees_total: 12, source: 'founder', updated_at: '2026-10-14T00:00:00Z' }, SNAPS[1]]
    setup({ upsert_company_snapshot: stale }, { company_snapshots: () => (fresh ? FRESH : SNAPS) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.clear(cell('Nile Robotics', 'Employees'))
    await user.type(cell('Nile Robotics', 'Employees'), '12')
    fresh = true
    await user.click(screen.getByTestId('ws-save'))
    const row = (await screen.findAllByTestId('ws-row'))[0]
    expect(await within(row).findByRole('alert')).toHaveTextContent('your edits were the same')
    await waitFor(() => expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.'))
    expect(within(row).queryByTestId('ws-conflict-cell')).not.toBeInTheDocument()
  })

  it('under each reported year: who edited the row last and when', async () => {
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
    expect(mock.rpcCalls('upsert_company_snapshot')).toHaveLength(0)
  })

  it('a row the server refuses stays marked with the reason while the others are saved', async () => {
    const user = userEvent.setup()
    setup({ upsert_company_snapshot: (a) => (a.p_company === 'c2' ? Object.assign(new Error('alumni_invalid: employees_female:exceeds_total'), { code: '22023', hint: 'alumni_invalid', details: 'employees_female:exceeds_total' }) : { saved: true, snapshot: {}, snapshots: [] }) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(cell('Nile Robotics', 'Revenue'), '0')
    await user.clear(cell('Delta Health', 'Employees'))
    await user.type(cell('Delta Health', 'Employees'), '5')
    await user.click(screen.getByTestId('ws-save'))
    expect((await screen.findAllByRole('alert')).some((a) => /Not saved/.test(a.textContent))).toBe(true)
    await waitFor(() => expect(screen.getAllByTestId('ws-row').filter((r) => r.hasAttribute('data-dirty'))).toHaveLength(1))
  })

  it('discard drops the edits; switching the year with unsaved edits asks first', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(cell('Nile Robotics', 'Revenue'), '5')
    await user.selectOptions(screen.getByLabelText('Year being logged'), '2025')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Discard the unsaved changes?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('9100005')
    await user.click(screen.getByRole('button', { name: 'Discard the changes' }))
    expect(cell('Nile Robotics', 'Revenue')).toHaveValue('910000')
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('No change yet.')
  })

  it('edits survive paging within the same year (they live here until saved or discarded)', async () => {
    const user = userEvent.setup()
    setup({ list_alumni_table: (a) => tablePage(ROWS.slice(0, 2), { total: 60, year: a.p_year, limit: a.p_limit, offset: a.p_offset }) })
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(cell('Nile Robotics', 'Revenue'), '1')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_table').at(-1).args.p_offset).toBe(25))
    expect(screen.getByTestId('ws-savebar')).toHaveTextContent('1 row changed')
  })

  it('the history of a company lists every yearly row with its source; deleting a year asks first and names the year', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('button', { name: 'History: Nile Robotics' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('2023')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Founder').length).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2023' }))
    const confirmDialog = (await screen.findAllByRole('dialog')).at(-1)
    expect(within(confirmDialog).getByText(/Delete the figures of 2023\?/)).toBeInTheDocument()
    await user.click(within(confirmDialog).getByRole('button', { name: 'Delete 2023' }))
    await waitFor(() => expect(mock.rpcCalls('delete_company_snapshot')).toHaveLength(1))
    expect(mock.rpcCalls('delete_company_snapshot')[0].args).toEqual({ p_company: 'c1', p_year: 2023 })
  })

  it('the yearly texts open in a dialog and are saved as a patch of what changed', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('button', { name: 'Notes: Nile Robotics' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Traction / validation')).toHaveValue('T')
    await user.type(within(dialog).getByLabelText('Needs'), 'A licence')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('upsert_company_snapshot')).toHaveLength(1))
    expect(mock.rpcCalls('upsert_company_snapshot')[0].args).toEqual({ p_company: 'c1', p_year: 2024, p_data: { needs: 'A licence' } })
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
