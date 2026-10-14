import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { _setLoader } from '../../../lib/export/xlsx.js'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import ImportPage from './ImportPage.jsx'

const FULL_ID = '29501010101234'
const SHEET_ROWS = [
  { 'Startup Name': 'Nile Robotics', ID: FULL_ID, 'Date of company stabilished': new Date('2021-03-01T00:00:00Z'), Stage: 'Seed round', 'CEO Age': 20 },
  { 'Startup Name': 'Brand New', Sector: 'Technology', 'Sub sector': 'Quantum Gadgets' },
  { 'Startup Name': 'Dup Co' },
]
const PREVIEW = {
  count: 3, summary: { create: 1, update: 1, error: 1, warnings: 1 },
  headers: { unknown: ['Foo'], missing: ['Needs', 'Hint'], ignored_derived: ['CEO Age'] },
  proposed_lookups: [{ kind: 'stage', value: 'Seed round', parent: null, header: 'Stage', count: 1 }, { kind: 'subsector', value: 'Quantum Gadgets', parent: 'technology', header: 'Sub sector', count: 1 }],
  rows: [
    { row: 1, name: 'Nile Robotics', plan: 'update', company_id: 'c1', company_name_en: 'Nile Robotics', company_name_ar: null, ceo: { age: 31, gender: 'male', governorate: 1, id_masked: '**********1234', age_category: 'age_25_34', source: 'id' },
      issues: [{ field: 'CEO Age', code: 'derived_mismatch', level: 'warning', value: '20' }, { field: 'Stage', code: 'unknown_value', level: 'error', value: 'Seed round' }, { field: 'ID', code: 'invalid_id', level: 'error', value: 'length' }], errors: 2, warnings: 1 },
    { row: 2, name: 'Brand New', plan: 'create', company_id: null, ceo: null, issues: [{ field: 'Website', code: 'url_scheme_added', level: 'info', value: 'brand.example.com' }], errors: 0, warnings: 0 },
    { row: 3, name: 'Dup Co', plan: 'error', company_id: null, ceo: null, issues: [{ field: 'Startup Name', code: 'ambiguous_match', level: 'error', value: '2' }], errors: 1, warnings: 0 },
  ],
}

let mock
beforeEach(() => {
  mock = makeDb({ rpc: { list_alumni_lookups: LOOKUPS, import_alumni_preview: PREVIEW, save_alumni_lookup: (a) => ({ kind: a.p_kind, key: a.p_key, label_en: a.p_patch.label_en, label_ar: a.p_patch.label_ar, sort: 500, active: true, system: false }) } })
  h.db = mock.db
  _setLoader(async () => ({
    read: () => ({ SheetNames: ['Alumni'], Sheets: { Alumni: {} } }),
    utils: { sheet_to_json: () => SHEET_ROWS },
  }))
})
afterEach(() => _setLoader(() => import('xlsx')))

const renderPage = () => renderWithProviders(<ImportPage />, { route: '/alumni/admin/directory/import?lang=en' })
async function checkFile(user, { render = true } = {}) {
  if (render) renderPage()
  const input = screen.getByTestId('import-file')
  await user.upload(input, new File([new Uint8Array([1, 2, 3])], 'alumni.xlsx', { type: 'application/vnd.ms-excel' }))
  await user.click(await screen.findByTestId('import-run'))
  return screen.findByTestId('import-result')
}

describe('the Excel import CHECK', () => {
  it('says it only checks, then sends the sheet rows (dates as ISO text) to the dry-run RPC and shows the plan', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText(/only CHECKS: nothing is created or changed/)).toBeInTheDocument()
    const result = await checkFile(user, { render: false })
    await waitFor(() => expect(mock.rpcCalls('import_alumni_preview')).toHaveLength(1))
    const sent = mock.rpcCalls('import_alumni_preview')[0].args.p_rows
    expect(sent).toHaveLength(3)
    expect(sent[0]['Date of company stabilished']).toBe('2021-03-01')
    expect(within(result).getByText('Rows checked').closest('.rounded-card')).toHaveTextContent('3')
    expect(within(result).getByText('New companies').closest('.rounded-card')).toHaveTextContent('1')
    expect(within(result).getByText('Rows with errors').closest('.rounded-card')).toHaveTextContent('1')
  })

  it('reports the findings of every row in words, with the level; the national ID is only ever masked (never echoed back)', async () => {
    const user = userEvent.setup()
    await checkFile(user)
    const rows = screen.getByTestId('import-rows')
    expect(within(rows).getByText('Matches Nile Robotics')).toBeInTheDocument()
    expect(within(rows).getByText(/CEO Age: "20" differs from the national ID \(the ID wins\)/)).toBeInTheDocument()
    expect(within(rows).getByText('ID: not valid (must have 14 digits)')).toBeInTheDocument()
    expect(within(rows).getByText(/"https:\/\/" will be added to "brand.example.com"/)).toBeInTheDocument()
    expect(within(rows).getByText(/Matches 2 different companies/)).toBeInTheDocument()
    expect(within(rows).getByText('**********1234')).toBeInTheDocument()
    expect(within(rows).getByText(/From the national ID: 31 years, Male, Cairo/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(FULL_ID)
    // the rows can be narrowed
    await user.click(screen.getByRole('button', { name: /With errors/ }))
    expect(within(rows).queryByText('Brand New')).not.toBeInTheDocument()
    expect(within(rows).getByText('Dup Co')).toBeInTheDocument()
  })

  it('the header report names the missing, unknown and calculated columns', async () => {
    const user = userEvent.setup()
    await checkFile(user)
    const section = screen.getByRole('heading', { name: 'Columns' }).closest('section')
    expect(within(section).getByText('Needs')).toBeInTheDocument()
    expect(within(section).getByText('Foo')).toBeInTheDocument()
    expect(within(section).getByText('CEO Age')).toBeInTheDocument()
  })

  it('a value that matches no list is PROPOSED: the manager adds it to the vocabulary with labels in both languages; a sub sector goes under its sector', async () => {
    const user = userEvent.setup()
    await checkFile(user)
    const vocab = screen.getByTestId('import-vocab')
    const stageRow = within(vocab).getByText('Seed round').closest('tr')
    await user.click(within(stageRow).getByRole('button', { name: 'Add to the list' }))
    await user.clear(within(stageRow).getByLabelText('Arabic label'))
    await user.type(within(stageRow).getByLabelText('Arabic label'), 'مرحلة البذرة')
    await user.click(within(stageRow).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_lookup')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_lookup')[0].args).toEqual({ p_kind: 'stage', p_key: 'seed_round', p_patch: { label_en: 'Seed round', label_ar: 'مرحلة البذرة' } })
    expect(await within(stageRow).findByText('added')).toBeInTheDocument()
    const subRow = within(vocab).getByText('Quantum Gadgets').closest('tr')
    await user.click(within(subRow).getByRole('button', { name: 'Add to the list' }))
    await user.click(within(subRow).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_lookup')).toHaveLength(2))
    expect(mock.rpcCalls('save_alumni_lookup')[1].args).toMatchObject({ p_kind: 'subsector', p_key: 'quantum_gadgets', p_patch: { parent_key: 'technology' } })
  })

  it('the load step is a documented hook: disabled, with the reason', async () => {
    const user = userEvent.setup()
    await checkFile(user)
    expect(screen.getByRole('button', { name: 'Load the data (not available yet)' })).toBeDisabled()
    expect(screen.getByText(/waits for the owner's decision/)).toBeInTheDocument()
  })

  it('a file that cannot be read says so and keeps the page usable', async () => {
    const user = userEvent.setup()
    _setLoader(async () => ({ read: () => { throw new Error('bad file') }, utils: {} }))
    renderPage()
    await user.upload(screen.getByTestId('import-file'), new File(['x'], 'broken.xlsx'))
    expect(await screen.findByText('The file could not be read. Is it an Excel or CSV file?')).toBeInTheDocument()
    expect(screen.queryByTestId('import-run')).not.toBeInTheDocument()
  })
})
