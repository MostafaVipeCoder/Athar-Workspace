import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { _setLoader } from '../../../lib/export/xlsx.js'
import { exportFilename, exportOwnerSheet, ownerColumns, ownerSheetRows } from './exportXlsx.js'

// the server's `export_alumni_rows` header texts and order (design 09 section 4.2, the owner's Excel): the typos are the owner's own
const HEADERS = ['Startup Name', 'Program Scope', 'Program Name', 'Support provided', 'Startup type', 'Hint', 'Sector', 'Sub sector', 'Description', 'Stage', 'Governerate', 'Date of company established', 'App', 'Website',
  'Social media', 'Traction/Validation', 'CEO Name', 'Phone', 'Email', 'ID', 'CEO Age', 'Age Category', 'Student/Graduate', 'CEO Gender', 'Open/Closed', 'Reason for closing', 'After closing', 'Legal Status',
  'Founding team size', 'Female founders', 'Nu. of founders below 35', 'Nu. of employees', 'Nu. of female employees', 'Number of freelancers', 'Funding raised', 'Revenue (2024) (Total)', 'Challenges', 'Needs']
const result = () => ({
  columns: HEADERS.map((header, i) => ({ key: `k${i}`, header, type: 'text' })),
  rows: [
    HEADERS.map((_, i) => (i === 0 ? 'Nile Robotics' : i === 19 ? '29501010101234' : i === 20 ? 31 : i === 35 ? 250000 : i === 17 ? '+201012345678' : i === 8 ? '=SUM(A1)' : null)),
    HEADERS.map((_, i) => (i === 0 ? 'Delta Health' : null)),
  ],
  meta: { count: 2, year: 2024 },
})

afterEach(() => _setLoader(() => import('xlsx')))

describe('the owner\'s Excel export (written as the server returns it)', () => {
  it('the header row is the server\'s header texts, unchanged, in the server\'s order (38 columns, one row per company)', () => {
    const aoa = ownerSheetRows(result())
    expect(aoa[0]).toEqual(HEADERS)
    expect(aoa[0]).toHaveLength(38)
    expect(aoa).toHaveLength(3)
    expect(ownerColumns(result().columns).map((c) => c.header)).toEqual(HEADERS)
  })

  it('writes a real .xlsx whose first row is exactly the owner\'s headers; cells keep their types (ID and phone stay text, numbers stay numbers, formulas are defused)', async () => {
    let captured = null
    const lib = XLSX.default ?? XLSX
    _setLoader(async () => ({ utils: lib.utils, writeFile: (wb, name) => { captured = { wb, name } } }))
    const written = await exportOwnerSheet(result(), exportFilename('alumni', new Date(2026, 9, 14)))
    expect(written).toBe(2)
    expect(captured.name).toBe('alumni-2026-10-14.xlsx')
    const buffer = lib.write(captured.wb, { type: 'buffer', bookType: 'xlsx' })
    const book = lib.read(buffer, { type: 'buffer' })
    const sheet = book.Sheets[book.SheetNames[0]]
    const aoa = lib.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
    expect(aoa[0]).toEqual(HEADERS)
    expect(aoa[1][0]).toBe('Nile Robotics')
    expect(aoa[1][19]).toBe('29501010101234') // a 14-digit number is TEXT: a number would lose digits
    expect(aoa[1][17]).toBe('+201012345678')
    expect(aoa[1][20]).toBe(31)
    expect(aoa[1][35]).toBe(250000)
    expect(aoa[1][8]).toBe("'=SUM(A1)")
    expect(aoa[2][0]).toBe('Delta Health')
  })

  it('an unknown value is a genuinely BLANK cell, not an empty text cell (ISBLANK, the Blanks filter and numeric columns behave)', async () => {
    let captured = null
    const lib = XLSX.default ?? XLSX
    _setLoader(async () => ({ utils: lib.utils, writeFile: (wb) => { captured = wb } }))
    await exportOwnerSheet(result(), 'blank.xlsx')
    const sheet = captured.Sheets[captured.SheetNames[0]]
    const cellAt = (col, row) => sheet[lib.utils.encode_cell({ c: col, r: row })]
    expect(cellAt(1, 1)).toBeUndefined() // "Program Scope" of Nile Robotics is null: no cell at all
    expect(cellAt(20, 1)).toMatchObject({ t: 'n', v: 31 }) // a real number stays a number
    expect(cellAt(20, 2)).toBeUndefined() // CEO Age of Delta Health is unknown: blank, not ''
    expect(Object.values(sheet).filter((c) => c && c.t === 's' && c.v === '')).toHaveLength(0)
  })

  it('names the file with the date', () => {
    expect(exportFilename('alumni', new Date(2026, 0, 5))).toBe('alumni-2026-01-05.xlsx')
  })
})
