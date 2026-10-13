import { useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { parseWorkbook } from '../../lib/export/xlsx.js'
import { parseAgendaSheets } from './agendaLogic.js'

/**
 * Excel import of days + sessions (08 decision 01-9: Excel only, the Google Sheet path is gone). The workbook is parsed in
 * the browser (lazy SheetJS), previewed, then merged into the EDITOR DRAFT through `onImport(days, mode)`; the PM still
 * presses Save (no write here: the as-is importer wrote straight to the DB and bypassed the staged model).
 */
export default function ImportAgendaModal({ onClose, onImport, hasDays }) {
  const { t } = useLanguage()
  const inputRef = useRef(null)
  const [result, setResult] = useState(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState(hasDays ? 'append' : 'replace')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const sheets = await parseWorkbook(file)
      setResult(parseAgendaSheets(sheets))
      setFileName(file.name)
    } catch {
      setError(t('agenda.import.parseError'))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }
  const warning = (w) => {
    const [key, arg] = w.split(':')
    return key === 'agenda.import.badDate' ? t(key, { name: arg }) : key === 'agenda.import.skipped' ? t(key, { count: arg }) : t(key)
  }
  const slots = result?.days.reduce((n, d) => n + d.slots.length, 0) ?? 0

  return (
    <Modal
      open
      onClose={onClose}
      title={t('agenda.import.title')}
      description={t('agenda.import.hint')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={() => { onImport(result.days, mode); onClose() }} disabled={!result?.days.length} data-testid="import-run">{t('agenda.import.run')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={pick} aria-label={t('agenda.import.choose')} data-testid="import-file" />
        <Button variant="outline" onClick={() => inputRef.current?.click()} loading={busy}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {t('agenda.import.choose')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('agenda.import.timeHint')}</p>
        {fileName && result && (
          <p className="text-sm" data-testid="import-summary">{fileName}: {t('agenda.import.found', { days: result.days.length, slots })}</p>
        )}
        {result?.days.length > 0 && (
          <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
            {result.days.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="truncate" dir="auto">{d.name.en || d.name.ar || d.date}</span>
                <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{d.date} · {d.slots.length}</span>
              </li>
            ))}
          </ul>
        )}
        {result?.warnings.map((w) => <p key={w} role="status" className="text-xs text-destructive-text">{warning(w)}</p>)}
        {hasDays && result?.days.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">{t('agenda.import.mode')}</legend>
            {['append', 'replace'].map((m) => (
              <label key={m} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="radio" name="import-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                {t(`agenda.import.mode.${m}`)}
              </label>
            ))}
          </fieldset>
        )}
        {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
      </div>
    </Modal>
  )
}
