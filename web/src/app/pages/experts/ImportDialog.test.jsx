import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'

const mocks = vi.hoisted(() => ({ parse: vi.fn(), preview: vi.fn(), run: vi.fn(), onClose: vi.fn() }))
vi.mock('../../../lib/export/xlsx.js', () => ({ parseWorkbook: (...a) => mocks.parse(...a), exportRows: vi.fn() }))
vi.mock('../../../data/people.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, importExperts: (...a) => mocks.preview(...a), useExpertActions: () => ({ import: { mutateAsync: mocks.run } }) }
})

import ImportDialog from './ImportDialog.jsx'

const PREVIEW = {
  dry_run: true, counts: { new: 2, duplicate: 2, invalid: 1, created: 0 },
  rows: [
    { index: 1, status: 'new', name: 'Alaa Afifi' },
    { index: 2, status: 'duplicate', name: 'Osama Nageeb', matches: [{ id: 'e9', name_en: 'Osama Nageeb', score: 1, reasons: ['same_name'] }] },
    { index: 3, status: 'invalid', name: null, error: 'email:invalid' },
    { index: 4, status: 'new', name: 'سارة' },
    { index: 5, status: 'duplicate', name: 'سارة', in_file: true },
  ],
}
const file = () => new File(['x'], 'experts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.parse.mockResolvedValue({ Sheet1: [
    { Name: 'Alaa Afifi', Company: 'Bekia', 'E-mail': 'a@x.io', Languages: 'Arabic, Klingon' },
    { Name: 'Osama Nageeb' }, { Name: 'Bad Mail', 'E-mail': 'bad' }, { 'Name (AR)': 'سارة' }, { 'Name (AR)': 'سارة' }, { Company: 'no name' },
  ] })
  mocks.preview.mockResolvedValue(PREVIEW)
  mocks.run.mockResolvedValue({ counts: { created: 2, duplicate: 2, invalid: 1 } })
})

async function pickFile(user) {
  renderWithProviders(<ImportDialog onClose={mocks.onClose} />, { route: '/network/experts?lang=en' })
  const dialog = await screen.findByRole('dialog', { name: 'Import experts from Excel' })
  await user.upload(within(dialog).getByTestId('import-file'), file())
  return dialog
}

describe('Excel import dialog', () => {
  it('parses the first sheet, previews EVERY row from the server (new / duplicate / invalid, with the reason) and writes nothing yet', async () => {
    const user = userEvent.setup()
    const dialog = await pickFile(user)
    const preview = await within(dialog).findByTestId('import-preview')
    expect(mocks.parse).toHaveBeenCalledTimes(1)
    expect(mocks.preview).toHaveBeenCalledTimes(1)
    const [rows, opts] = mocks.preview.mock.calls[0]
    expect(rows).toHaveLength(5) // the row without a name is not sent
    expect(rows[0]).toMatchObject({ name_en: 'Alaa Afifi', company_en: 'Bekia', email: 'a@x.io', languages: ['ar'] })
    expect(opts).toMatchObject({ dryRun: true })
    expect(within(preview).getByText(/5 rows with a name\./)).toBeInTheDocument()
    expect(within(preview).getByText(/Rows without a name were ignored: 1\./)).toBeInTheDocument()
    expect(within(preview).getByText(/Unknown languages were dropped: 1\./)).toBeInTheDocument()
    expect(within(preview).getByText('New: 2')).toBeInTheDocument()
    expect(within(preview).getByText('Possible duplicates: 2')).toBeInTheDocument()
    expect(within(preview).getByText('Invalid: 1')).toBeInTheDocument()
    expect(within(preview).getByText('looks like Osama Nageeb')).toBeInTheDocument()
    expect(within(preview).getByText('same as an earlier row')).toBeInTheDocument()
    expect(within(preview).getByText('refused: Enter a valid e-mail address.')).toBeInTheDocument()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('imports the NEW rows by default (duplicates skipped); ticking the box imports the duplicates too', async () => {
    const user = userEvent.setup()
    const dialog = await pickFile(user)
    await within(dialog).findByTestId('import-preview')
    const run = within(dialog).getByTestId('import-run')
    expect(run).toHaveTextContent('Import 2 experts')
    await user.click(within(dialog).getByTestId('import-dup-create'))
    expect(run).toHaveTextContent('Import 4 experts')
    await user.click(run)
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ duplicates: 'create' })
    expect(mocks.run.mock.calls[0][0].rows).toHaveLength(5)
    expect(await screen.findByText('Import finished: added 2, skipped 3.')).toBeInTheDocument()
    expect(mocks.onClose).toHaveBeenCalled()
  })

  it('a file with no usable row says so (and offers nothing to import); an unreadable file is an explained error', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValueOnce({ Sheet1: [{ Company: 'no name' }] })
    const dialog = await pickFile(user)
    expect(await within(dialog).findByTestId('import-empty')).toHaveTextContent('no row with a name was found')
    expect(within(dialog).getByTestId('import-run')).toBeDisabled()
    expect(mocks.preview).not.toHaveBeenCalled()
    mocks.parse.mockRejectedValueOnce(new Error('corrupt'))
    await user.upload(within(dialog).getByTestId('import-file'), file())
    expect(await within(dialog).findByText(/The file could not be read/)).toBeInTheDocument()
  })

  it('a refusal of the server on the real import is shown in the dialog and nothing is claimed as done', async () => {
    const user = userEvent.setup()
    mocks.run.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', messageKey: 'errors.forbidden' }))
    const dialog = await pickFile(user)
    await within(dialog).findByTestId('import-preview')
    await user.click(within(dialog).getByTestId('import-run'))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(mocks.onClose).not.toHaveBeenCalled()
  })
})

describe('Excel import dialog: chunks, size cap, formats, plurals', () => {
  const big = (n) => Array.from({ length: n }, (_, i) => ({ Name: `Person ${i + 1}` }))
  const chunkPreview = async (rows, opts) => ({
    dry_run: true, counts: { new: rows.length, duplicate: 0, invalid: 0, created: 0 },
    rows: rows.map((r, i) => ({ index: i + 1, status: 'new', name: r.name_en })),
    seen: { names: [...(opts?.seen?.names ?? []), ...rows.map((r) => r.name_en)], links: [], mails: [] },
  })

  it('120 rows go to the server in chunks of 50 (every call stays far below the API timeout); each PREVIEW chunk carries the keys of the rows before it; indexes continue across chunks', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValue({ Sheet1: big(120) })
    mocks.preview.mockImplementation(chunkPreview)
    const dialog = await pickFile(user)
    const preview = await within(dialog).findByTestId('import-preview')
    expect(mocks.preview.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20])
    expect(mocks.preview.mock.calls[0][1].seen).toBeNull()
    expect(mocks.preview.mock.calls[1][1].seen.names).toHaveLength(50)
    expect(mocks.preview.mock.calls[2][1].seen.names).toHaveLength(100)
    expect(within(preview).getByText('New: 120')).toBeInTheDocument()
    const rows = within(preview).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(120)
    expect(rows[0].cells[0]).toHaveTextContent('1')
    expect(rows[119].cells[0]).toHaveTextContent('120') // the index continues across the chunks
  })

  it('the real import is chunked too, shows its progress and the total; a failing chunk stops with the number of rows already saved', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValue({ Sheet1: big(120) })
    mocks.preview.mockImplementation(chunkPreview)
    mocks.run.mockImplementation(async ({ rows }) => ({ counts: { created: rows.length, duplicate: 0, invalid: 0 } }))
    const dialog = await pickFile(user)
    await within(dialog).findByTestId('import-preview')
    await user.click(within(dialog).getByTestId('import-run'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(3))
    expect(mocks.run.mock.calls.map((c) => c[0].rows.length)).toEqual([50, 50, 20])
    expect(await screen.findByText('Import finished: added 120, skipped 0.')).toBeInTheDocument()
    expect(mocks.onClose).toHaveBeenCalled()
  })

  it('a chunk that fails after others were saved says how many rows ARE saved (so nobody imports them twice)', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValue({ Sheet1: big(120) })
    mocks.preview.mockImplementation(chunkPreview)
    mocks.run.mockResolvedValueOnce({ counts: { created: 50, duplicate: 0, invalid: 0 } })
    mocks.run.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', messageKey: 'errors.forbidden' }))
    const dialog = await pickFile(user)
    await within(dialog).findByTestId('import-preview')
    await user.click(within(dialog).getByTestId('import-run'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The import stopped after 50 rows were added (they are saved).')
    expect(mocks.onClose).not.toHaveBeenCalled()
  })

  it('a file over 5 MB is refused BEFORE it is parsed (the parser is a third-party library); only .xlsx and .csv are accepted', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ImportDialog onClose={mocks.onClose} />, { route: '/network/experts?lang=en' })
    const dialog = await screen.findByRole('dialog', { name: 'Import experts from Excel' })
    const input = within(dialog).getByTestId('import-file')
    expect(input).toHaveAttribute('accept', '.xlsx,.csv')
    const tooBig = new File(['x'], 'huge.xlsx')
    Object.defineProperty(tooBig, 'size', { value: 6 * 1024 * 1024 })
    await user.upload(input, tooBig)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file is larger than 5 MB.')
    expect(mocks.parse).not.toHaveBeenCalled()
  })

  it('the button is plural-aware: "Import 1 expert" / "Import 3 experts", and in Arabic the noun is there', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValue({ Sheet1: big(1) })
    mocks.preview.mockImplementation(chunkPreview)
    const dialog = await pickFile(user)
    await within(dialog).findByTestId('import-preview')
    expect(within(dialog).getByTestId('import-run')).toHaveTextContent('Import 1 expert')
    expect(within(dialog).getByTestId('import-run')).not.toHaveTextContent('Import 1 experts')
  })
})
