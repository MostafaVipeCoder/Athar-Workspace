import { describe, it, expect, vi } from 'vitest'
import { safeCell, toSheetRows, exportRows, parseWorkbook, _setLoader } from './xlsx.js'

describe('xlsx wrapper', () => {
  it('prefixes formula-looking cells (S-5) and serialises objects', () => {
    expect(safeCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(safeCell('+1')).toBe('+1')
    expect(safeCell('+cmd')).toBe("'+cmd")
    expect(safeCell('-x')).toBe("'-x")
    expect(safeCell('@cmd')).toBe("'@cmd")
    expect(safeCell('hello')).toBe('hello')
    expect(safeCell('-')).toBe('-')
    expect(safeCell('-5')).toBe('-5')
    expect(safeCell(null)).toBe('')
    expect(safeCell(3)).toBe(3)
    expect(safeCell({ a: 1 })).toBe('{"a":1}')
  })

  it('maps rows through columns (keys, functions, formatters)', () => {
    const rows = [{ name: 'A', email: 'a@x.io', n: 2 }, { name: '=B', email: null, n: 0 }]
    const aoa = toSheetRows(rows, [
      { key: 'name', header: 'Name' },
      { key: (r) => r.email ?? '-', header: 'Email' },
      { key: 'n', header: 'Count', format: (v) => v * 10 },
    ])
    expect(aoa).toEqual([['Name', 'Email', 'Count'], ['A', 'a@x.io', 20], ["'=B", '-', 0]])
    expect(toSheetRows(rows)).toEqual([['name', 'email', 'n'], ['A', 'a@x.io', 2], ["'=B", '', 0]])
    expect(toSheetRows([], [])).toEqual([[]])
  })

  it('blanks: true turns a missing value into a BLANK cell (null), never an empty text cell; real values and zeros stay', () => {
    const rows = [{ a: null, b: undefined, c: '', d: 0, e: 'x' }]
    const cols = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: k, header: k }))
    expect(toSheetRows(rows, cols)[1]).toEqual(['', '', '', 0, 'x']) // the default is unchanged for every other export
    expect(toSheetRows(rows, cols, { blanks: true })[1]).toEqual([null, null, null, 0, 'x'])
  })

  it('loads SheetJS lazily and writes a file', async () => {
    const writeFile = vi.fn()
    const fake = {
      utils: { aoa_to_sheet: vi.fn(() => 'ws'), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn(), sheet_to_json: vi.fn(() => [{ a: 1 }]) },
      writeFile,
      read: vi.fn(() => ({ SheetNames: ['S'], Sheets: { S: {} } })),
    }
    const loader = vi.fn(async () => fake)
    _setLoader(loader)
    expect(loader).not.toHaveBeenCalled()
    const n = await exportRows([{ a: 1 }], [{ key: 'a', header: 'A' }], 'out')
    expect(n).toBe(1)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'out.xlsx')
    const parsed = await parseWorkbook(new ArrayBuffer(2))
    expect(parsed).toEqual({ S: [{ a: 1 }] })
  })
})
