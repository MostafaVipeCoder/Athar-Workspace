import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { _setLoader } from '../../../lib/export/xlsx.js'
import { LOOKUPS, makeDb, tablePage, tableRow } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import DirectoryPage from './DirectoryPage.jsx'

const FULL_ID = '29501010101234'
const EXPORT_HEADERS = ['Startup Name', 'Program Scope', 'Program Name', 'Support provided', 'Startup type', 'Hint', 'Sector', 'Sub sector', 'Description', 'Stage', 'Governerate', 'Date of company established', 'App', 'Website',
  'Social media', 'Traction/Validation', 'CEO Name', 'Phone', 'Email', 'ID', 'CEO Age', 'Age Category', 'Student/Graduate', 'CEO Gender', 'Open/Closed', 'Reason for closing', 'After closing', 'Legal Status',
  'Founding team size', 'Female founders', 'Nu. of founders below 35', 'Nu. of employees', 'Nu. of female employees', 'Number of freelancers', 'Funding raised', 'Revenue (2024) (Total)', 'Challenges', 'Needs']

let mock
const rows = [tableRow(), tableRow({ id: 'c2', name_en: 'Delta Health', name_ar: 'دلتا', sector: 'healthcare', subsector: null, stage: 'idea_stage', operating_status: 'closed', ceo: { ...tableRow().ceo, founder_id: 'f2', name_en: 'Omar Zaki', gender: 'male', id_masked: '**********4527', governorate: 1 }, is_alumni: false, metrics: { revenue_total: 120000 } })]

function setup(extra = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_programs: { programs: [{ id: 'g1', name_en: 'Accelerator', name_ar: 'مسرعة', projects: [{ id: 'j1', name_en: 'Cohort 1', name_ar: 'الدفعة الأولى', completed: false, companies: 2 }] }] },
      list_alumni_table: (a) => tablePage(rows, { limit: a.p_limit, offset: a.p_offset, sort: a.p_sort, dir: a.p_dir }),
      get_alumni_founder: (a) => ({ id: a.p_founder, identity: { id_masked: '**********1234', has_national_id: true, ...(a.p_reveal ? { national_id: FULL_ID } : {}) } }),
      set_companies_alumni: (a) => ({ changed: a.p_ids.length, requested: a.p_ids.length }),
      export_alumni_rows: { columns: EXPORT_HEADERS.map((header, i) => ({ key: `k${i}`, header, type: 'text' })), rows: [EXPORT_HEADERS.map((_, i) => (i === 0 ? 'Nile Robotics' : i === 19 ? FULL_ID : null))], meta: { year: 2024, lang: 'en', count: 2, ceo_source: { id: 1, self: 0, none: 1 } } },
      get_alumni_company: { company: { id: 'c1', name_en: 'Nile Robotics', is_alumni: true, operating_status: 'open', directory_visibility: 'alumni', updated_at: '2026-10-10T10:00:00Z', internal: { hint: 'strong team', directory_hidden: false, reviewed_at: null } }, team: [], counts: { team_size: 0, female_founders: 0, founders_under_35: 0 }, ceo_founder_id: null, programs: [], snapshots: [] },
      ...extra,
    },
  })
  h.db = mock.db
}

function renderPage(route = '/alumni/admin/directory?lang=en') {
  return renderWithProviders(<ConfirmProvider><DirectoryPage /></ConfirmProvider>, { route })
}
const lastTableArgs = () => mock.rpcCalls('list_alumni_table').at(-1).args

beforeEach(() => {
  window.localStorage.clear()
  setup()
})
afterEach(() => _setLoader(() => import('xlsx')))

describe('the manager directory', () => {
  it('lists the companies of the first page with the default columns; the national ID column is NOT among them and no full number is on the page', async () => {
    renderPage()
    expect(await screen.findByText('Nile Robotics')).toBeInTheDocument()
    expect(screen.getByText('Delta Health')).toBeInTheDocument()
    const table = screen.getByTestId('directory-table')
    expect(within(table).getByRole('columnheader', { name: /Startup/ })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: /National ID/ })).not.toBeInTheDocument()
    // derived values arrive derived: the CEO's age / gender, the governorate FROM THE ID with its tag
    expect(within(table).getAllByText('31').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('Aswan').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('ID').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/\d{14}/)
    expect(lastTableArgs()).toMatchObject({ p_filters: { scope: 'alumni' }, p_limit: 25, p_offset: 0, p_sort: 'name', p_dir: 'asc' })
  })

  it('the column chooser can add the national ID: it is shown MASKED; the full number appears only after an explicit audited reveal and hides again', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /National ID/ }))
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1))
    const table = screen.getByTestId('directory-table')
    expect(within(table).getByRole('columnheader', { name: /National ID/ })).toBeInTheDocument()
    expect(within(table).getAllByText('**********1234').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain(FULL_ID)
    expect(mock.rpcCalls('get_alumni_founder')).toHaveLength(0)

    await user.click(within(table).getAllByRole('button', { name: 'Show the full national ID' })[0])
    await waitFor(() => expect(document.body.textContent).toContain(FULL_ID))
    expect(mock.rpcCalls('get_alumni_founder')[0].args).toEqual({ p_founder: 'f1', p_reveal: true })
    await user.click(within(table).getByRole('button', { name: 'Hide the national ID' }))
    expect(document.body.textContent).not.toContain(FULL_ID)
    // the choice is remembered in this browser
    expect(JSON.parse(window.localStorage.getItem('athar.alumniAdmin.columns.v1'))).toContain('national_id')
  })

  it('sorting is server-side: a header asks for the sort, a second click flips the direction', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('button', { name: /Sort by Revenue \(2024\)/ }))
    await waitFor(() => expect(lastTableArgs()).toMatchObject({ p_sort: 'revenue', p_dir: 'asc', p_offset: 0 }))
    await user.click(screen.getByRole('button', { name: /Sort by Revenue \(2024\)/ }))
    await waitFor(() => expect(lastTableArgs()).toMatchObject({ p_sort: 'revenue', p_dir: 'desc' }))
    expect(screen.getByRole('columnheader', { name: /Revenue/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('filters go to the server: the governorate FROM THE ID and the company location are two different filters', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('button', { name: /Filters/ }))
    const panel = screen.getByTestId('directory-filters')
    await user.selectOptions(within(panel).getByLabelText('Governorate (from national ID)'), '28')
    await waitFor(() => expect(lastTableArgs().p_filters).toMatchObject({ ceo_governorate: 28 }))
    expect(lastTableArgs().p_filters.governorate).toBeUndefined()
    await user.selectOptions(within(panel).getByLabelText('Company location'), '25')
    await waitFor(() => expect(lastTableArgs().p_filters).toMatchObject({ ceo_governorate: 28, governorate: 25 }))
    await user.selectOptions(within(panel).getByLabelText('CEO gender'), 'female')
    await user.selectOptions(within(panel).getByLabelText('Student / graduate'), 'student')
    await user.selectOptions(within(panel).getByLabelText('CEO age category'), 'age_25_34')
    await waitFor(() => expect(lastTableArgs().p_filters).toMatchObject({ ceo_gender: 'female', education_status: 'student', age_category: 'age_25_34' }))
    await user.click(within(panel).getByRole('button', { name: 'Clear filters' }))
    // back to the default view (its first page is already cached: the proof is the panel, not a new request)
    await waitFor(() => expect(within(panel).getByLabelText('CEO gender')).toHaveValue(''))
    expect(within(panel).getByLabelText('Company location')).toHaveValue('')
    expect(screen.getByRole('button', { name: /^Filters$/ })).toBeInTheDocument()
  })

  it('searching by name and switching the scope are server-side too', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.type(screen.getByRole('searchbox', { name: 'Search by company name' }), 'nile')
    await waitFor(() => expect(lastTableArgs().p_filters).toMatchObject({ q: 'nile' }), { timeout: 3000 })
    await user.click(screen.getByRole('button', { name: 'Candidates' }))
    await waitFor(() => expect(lastTableArgs().p_filters).toMatchObject({ scope: 'candidates', q: 'nile' }))
  })

  it('marks the selected companies as alumni after a confirmation (and only the selected ones)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByRole('checkbox', { name: 'Select Delta Health' }))
    const bar = await screen.findByTestId('bulk-bar')
    expect(within(bar).getByText('1 selected')).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Mark as alumni' }))
    const confirmDialog = await screen.findByRole('dialog')
    expect(within(confirmDialog).getByText(/Mark 1 company as alumni/)).toBeInTheDocument()
    await user.click(within(confirmDialog).getByRole('button', { name: 'Mark as alumni' }))
    await waitFor(() => expect(mock.rpcCalls('set_companies_alumni')).toHaveLength(1))
    expect(mock.rpcCalls('set_companies_alumni')[0].args).toEqual({ p_ids: ['c2'], p_value: true })
  })

  it('exports the owner\'s Excel for the current filter: the server\'s headers are written unchanged and in order', async () => {
    const user = userEvent.setup()
    let captured = null
    const lib = XLSX.default ?? XLSX
    _setLoader(async () => ({ utils: lib.utils, writeFile: (wb, name) => { captured = { wb, name } } }))
    renderPage('/alumni/admin/directory?lang=en&sector=technology')
    await screen.findByText('Nile Robotics')
    await user.click(screen.getByTestId('export-open'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/national ID/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Export 2 companies/ }))
    await waitFor(() => expect(captured).not.toBeNull())
    expect(mock.rpcCalls('export_alumni_rows')[0].args).toMatchObject({ p_filters: { scope: 'alumni', sector: 'technology' }, p_lang: 'en', p_year: null })
    const aoa = lib.utils.sheet_to_json(captured.wb.Sheets[captured.wb.SheetNames[0]], { header: 1, raw: true, defval: null })
    expect(aoa[0]).toEqual(EXPORT_HEADERS)
    expect(captured.name).toMatch(/^alumni-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('opens the company drawer with the manager-owned fields', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nile Robotics')
    await user.click(within(screen.getByTestId('directory-table')).getAllByRole('button', { name: 'Nile Robotics' })[0])
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByLabelText(/Hint \(a private note/)).toHaveValue('strong team')
    expect(within(dialog).getByRole('link', { name: /Open the full page/ })).toHaveAttribute('href', '/alumni/admin/company/c1')
  })

  it('shows the empty-registry guidance (alumni scope, no filter) and an error state with Try again', async () => {
    setup({ list_alumni_table: tablePage([], { total: 0 }) })
    const { unmount } = renderPage()
    expect(await screen.findByText('No company is marked as alumni yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show the candidates' })).toBeInTheDocument()
    unmount()
    setup({ list_alumni_table: new Error('boom') })
    renderPage()
    expect(await screen.findByText('The directory could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('reads the Arabic UI: Arabic names, Arabic labels', async () => {
    renderPage('/alumni/admin/directory?lang=ar')
    expect(await screen.findByText('نيل للروبوتات')).toBeInTheDocument()
    expect(screen.getByText('التكنولوجيا')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'دليل الخريجين' })).toBeInTheDocument()
  })
})
