/**
 * Excel files of the manager pages. SheetJS is loaded lazily by lib/export/xlsx.js (its own chunk, only when a file is actually written).
 *
 * The owner's export: the server's `export_alumni_rows` result is written AS IT IS: the header row is `columns[].header` unchanged and in the server's order (the owner's
 * workflow keys on those texts, typos included: "Governerate", "Nu. of ..."), one row per company, no column added, none reordered, none renamed.
 */
import { exportRows, exportWorkbook } from '../../../lib/export/xlsx.js'

/** `columns` -> the column definitions of lib/export/xlsx (`key` reads the cell of that position). */
export function ownerColumns(columns) {
  return columns.map((c, i) => ({ key: (row) => row[i], header: c.header }))
}

/** The 2-D array of the owner's sheet (header row + data rows): what is written, exported for tests. */
export function ownerSheetRows(result) {
  return [result.columns.map((c) => c.header), ...result.rows]
}

/** Writes `<filename>.xlsx` with ONE sheet in the owner's column order. Returns the number of data rows. */
export function exportOwnerSheet(result, filename) {
  // blanks: an unknown value is a genuinely EMPTY cell (not an empty text cell), so the owner's formulas, filters and numeric columns behave
  return exportRows(result.rows, ownerColumns(result.columns), filename, { sheetName: 'Alumni', blanks: true })
}

export const exportFilename = (prefix, date = new Date()) => `${prefix}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.xlsx`

export { exportRows, exportWorkbook }
