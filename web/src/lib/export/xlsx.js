/**
 * Lazy SheetJS wrapper (design 06 section 6.3 `export/xlsx.js`). The `xlsx` package (~400 kB) is loaded only when an
 * export/import actually happens (dynamic import -> its own chunk), never in the initial bundle.
 * Replaces `lib/excel.js` exports plus the ad-hoc `XLSX.writeFile` calls in the alumni pages.
 */

let loader = () => import('xlsx')

/** Test hook: swap the dynamic import. */
export function _setLoader(fn) {
  loader = fn
}

export async function loadXlsx() {
  const mod = await loader()
  return mod.default ?? mod
}

/** Cells starting with = + - @ are prefixed so a spreadsheet never executes them (docs/09 S-5 formula injection). */
export function safeCell(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // '=' and '@' always; '+'/'-' only when followed by something that is not a number ("-5", "-" stay as typed)
  return /^[=@\t\r]/.test(s) || /^[+-](?=[^\d\s.])/.test(s) ? `'${s}` : s
}

/**
 * Normalise rows to a 2-D array given columns [{ key, header, format? }]. `key` may be a function (row) => value.
 * Exported separately so it is unit-testable without SheetJS. `blanks: true` writes a missing value (null / undefined / an empty string) as `null`, which SheetJS leaves as a genuinely
 * BLANK cell (an empty-string cell is a text cell: ISBLANK, the "Blanks" filter and numeric columns treat it differently).
 */
export function toSheetRows(rows, columns, { blanks = false } = {}) {
  const cols = columns?.length ? columns : Object.keys(rows[0] ?? {}).map((k) => ({ key: k, header: k }))
  const header = cols.map((c) => c.header ?? String(c.key))
  const body = (rows ?? []).map((r) =>
    cols.map((c) => {
      const raw = typeof c.key === 'function' ? c.key(r) : r?.[c.key]
      const cell = safeCell(c.format ? c.format(raw, r) : raw)
      return blanks && cell === '' ? null : cell
    }),
  )
  return [header, ...body]
}

/** Build and download `<filename>.xlsx` with one sheet. Returns the number of data rows written. */
export async function exportRows(rows, columns, filename = 'export', { sheetName = 'Sheet1', blanks = false } = {}) {
  const XLSX = await loadXlsx()
  const aoa = toSheetRows(rows, columns, { blanks })
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
  return aoa.length - 1
}

/** Several sheets in one download: `sheets` = { [sheetName]: rows[] } (objects keyed by header). Returns the total rows written. */
export async function exportWorkbook(sheets, filename = 'export') {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  let total = 0
  for (const [name, rows] of Object.entries(sheets ?? {})) {
    const aoa = toSheetRows(rows ?? [], rows?.length ? Object.keys(rows[0]).map((k) => ({ key: k, header: k })) : [])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), String(name).slice(0, 31))
    total += Math.max(0, aoa.length - 1)
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
  return total
}

/** Parse a workbook File/ArrayBuffer into { [sheetName]: rows[] } (objects keyed by header). Used by Agenda import (01-9). */
export async function parseWorkbook(fileOrBuffer, { cellDates = true } = {}) {
  const XLSX = await loadXlsx()
  const buffer = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates })
  const out = {}
  for (const name of wb.SheetNames) out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
  return out
}
