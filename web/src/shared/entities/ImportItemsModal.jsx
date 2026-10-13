import { useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { parseWorkbook } from '../../lib/export/xlsx.js'
import { rowsToManualFields } from './export.js'

/**
 * Excel import of MANUAL items (as-is: experts/companies could be bulk-added from a sheet). One sheet, header row,
 * columns matched by name (see IMPORT_ALIASES). Preview, then `onImport(fieldsList)` creates the items one by one.
 */
export function ImportItemsModal({ onClose, onImport }) {
  const { t } = useLanguage()
  const inputRef = useRef(null)
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const sheets = await parseWorkbook(file)
      const first = Object.values(sheets)[0] ?? []
      setRows(rowsToManualFields(first))
      setFileName(file.name)
    } catch {
      setError(t('entity.import.parseError'))
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    try {
      await onImport(rows, (n) => setDone(n))
      onClose()
    } catch {
      setError(t('entity.import.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('entity.import.title')}
      description={t('entity.import.hint')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={run} disabled={!rows?.length} loading={busy && rows !== null} data-testid="import-run">
            {t('entity.import.run', { count: rows?.length ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={pick} aria-label={t('entity.import.choose')} />
        <Button variant="outline" onClick={() => inputRef.current?.click()} loading={busy && rows === null}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {t('entity.import.choose')}
        </Button>
        {fileName && <p className="text-sm text-muted-foreground">{fileName}: {t('entity.import.found', { count: rows?.length ?? 0 })}</p>}
        {rows?.length > 0 && (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm" data-testid="import-preview">
            {rows.slice(0, 20).map((r, i) => (
              <li key={i} className="px-2 py-1">
                <span className="font-medium">{r.title_en || r.title_ar}</span>
                {(r.subtitle_en || r.organization_en || r.email) && <span className="text-muted-foreground"> · {[r.subtitle_en, r.organization_en, r.email].filter(Boolean).join(' · ')}</span>}
              </li>
            ))}
            {rows.length > 20 && <li className="px-2 py-1 text-muted-foreground">+{rows.length - 20}</li>}
          </ul>
        )}
        {busy && rows !== null && done > 0 && <p className="text-sm" role="status">{t('entity.import.progress', { done, total: rows.length })}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Modal>
  )
}
export default ImportItemsModal
