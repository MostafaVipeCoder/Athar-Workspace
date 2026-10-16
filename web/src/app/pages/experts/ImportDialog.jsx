import { useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { importExperts, useExpertActions } from '../../../data/people.js'
import { parseWorkbook } from '../../../lib/export/xlsx.js'
import { chunkRows, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importCounts, mergeImportResults, sheetToImportRows } from '../../../lib/experts.js'
import './experts.i18n.js'
import { errorText, serverFieldError } from './hooks.js'

/** The server's "field:reason" of a refused row -> the sentence the form would show under that field. */
const invalidText = (t, detail) => {
  const fe = serverFieldError({ token: 'expert_invalid', detail })
  return fe ? t(fe.key) : String(detail ?? '')
}
const TONE = { new: 'green', created: 'green', duplicate: 'amber', invalid: 'red' }

/**
 * Excel import of experts (light): choose a sheet (one header row; English or Arabic headers: name, title, company, e-mail, phone, LinkedIn, website, languages, tags, bio,
 * notes), see a PREVIEW first (each row is new, a likely duplicate of a registry record or of an earlier row of the file, or invalid and why), then import. Likely duplicates are
 * skipped unless the box is ticked. Nothing is written by the preview. The rows go to the server in chunks of 50 (every call stays far below the API timeout, however big the
 * registry is); a PREVIEW chunk is given the keys of the rows before it, so a repeat anywhere in the file is found. A file larger than 5 MB is refused before it is parsed.
 */
export default function ImportDialog({ onClose }) {
  const { t, tn, formatNumber } = useLanguage()
  const toast = useToast()
  const actions = useExpertActions()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null) // { rows, skipped, unknownLanguages, truncated }
  const [preview, setPreview] = useState(null)
  const [duplicates, setDuplicates] = useState('skip')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { kind: 'check' | 'run', done, total }
  const [error, setError] = useState(null)

  /** Preview every chunk in turn, carrying `seen` from one answer to the next. */
  async function previewRows(rows) {
    const chunks = chunkRows(rows)
    const results = []
    const offsets = []
    let seen = null
    let done = 0
    for (const chunk of chunks) {
      setProgress({ kind: 'check', done, total: rows.length })
      const res = await importExperts(chunk, { dryRun: true, duplicates: 'skip', seen })
      offsets.push(done)
      results.push(res)
      seen = res.seen ?? null
      done += chunk.length
    }
    setProgress(null)
    return mergeImportResults(results, offsets)
  }

  async function pick(e) {
    const chosen = e.target.files?.[0]
    e.target.value = ''
    if (!chosen) return
    setError(null)
    setPreview(null)
    setParsed(null)
    setFile(chosen.name)
    if (chosen.size > IMPORT_MAX_BYTES) {
      setError(t('experts.import.tooBig', { max: formatNumber(IMPORT_MAX_BYTES / (1024 * 1024)) }))
      return
    }
    setBusy(true)
    try {
      const sheets = await parseWorkbook(chosen, { codepage: 65001 })
      const first = Object.values(sheets)[0] ?? []
      const out = sheetToImportRows(first)
      const truncated = out.rows.length > IMPORT_MAX_ROWS
      const rows = out.rows.slice(0, IMPORT_MAX_ROWS)
      setParsed({ ...out, rows, truncated })
      if (rows.length) setPreview(await previewRows(rows))
    } catch (err) {
      setProgress(null)
      setError(err?.messageKey ? errorText(t, err) : t('experts.import.parseError'))
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    setError(null)
    const total = { new: 0, duplicate: 0, invalid: 0, created: 0 }
    try {
      let done = 0
      for (const chunk of chunkRows(parsed.rows)) {
        setProgress({ kind: 'run', done, total: parsed.rows.length })
        const res = await actions.import.mutateAsync({ rows: chunk, duplicates })
        const c = importCounts(res)
        for (const k of Object.keys(total)) total[k] += c[k]
        done += chunk.length
      }
      toast.success(t('experts.import.done', { created: formatNumber(total.created), skipped: formatNumber(total.duplicate + total.invalid) }))
      onClose()
    } catch (err) {
      // the chunks before the failing one are saved: say how many, so the user does not import them twice
      setError(total.created > 0 ? t('experts.import.partial', { created: formatNumber(total.created), reason: errorText(t, err) }) : errorText(t, err))
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const counts = importCounts(preview)
  const importable = duplicates === 'create' ? counts.new + counts.duplicate : counts.new
  return (
    <Modal
      open
      onClose={onClose}
      title={t('experts.import.title')}
      description={t('experts.import.hint')}
      closeLabel={t('common.close')}
      className="sm:max-w-3xl"
      dismissible={!busy}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={run} disabled={!preview || importable === 0} loading={busy && Boolean(preview)} data-testid="import-run">
            {tn('experts.import.run', importable)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input ref={inputRef} type="file" accept=".xlsx,.csv" className="sr-only" tabIndex={-1} onChange={pick} aria-label={t('experts.import.choose')} data-testid="import-file" />
        <Button variant="outline" onClick={() => inputRef.current?.click()} loading={busy && !preview && !parsed} disabled={busy && Boolean(progress)}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {file ? t('experts.import.change') : t('experts.import.choose')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('experts.import.columns')}</p>
        {progress && (
          <p role="status" className="text-sm text-muted-foreground tabular-nums" data-testid="import-progress">
            {t(progress.kind === 'check' ? 'experts.import.progress' : 'experts.import.progressRun', { done: formatNumber(progress.done), total: formatNumber(progress.total) })}
          </p>
        )}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive-text">{error}</p>}

        {parsed && parsed.rows.length === 0 && <p role="status" className="text-sm text-muted-foreground" data-testid="import-empty">{t('experts.import.noRows', { file })}</p>}
        {parsed && parsed.rows.length > 0 && (
          <div className="space-y-3" data-testid="import-preview">
            <p className="text-sm" role="status">
              <span className="font-semibold" dir="auto">{file}</span>: {t('experts.import.found', { count: formatNumber(parsed.rows.length) })}
              {parsed.skipped > 0 && ` ${t('experts.import.skippedNoName', { count: formatNumber(parsed.skipped) })}`}
              {parsed.unknownLanguages > 0 && ` ${t('experts.import.unknownLanguages', { count: formatNumber(parsed.unknownLanguages) })}`}
              {parsed.truncated && ` ${t('experts.import.truncated', { max: formatNumber(IMPORT_MAX_ROWS) })}`}
            </p>
            {preview && (
              <>
                <ul className="flex flex-wrap gap-2 text-sm">
                  <li><Badge tone="green">{t('experts.import.count.new', { count: formatNumber(counts.new) })}</Badge></li>
                  <li><Badge tone="amber">{t('experts.import.count.duplicate', { count: formatNumber(counts.duplicate) })}</Badge></li>
                  <li><Badge tone="red">{t('experts.import.count.invalid', { count: formatNumber(counts.invalid) })}</Badge></li>
                </ul>
                {counts.duplicate > 0 && (
                  <label className="flex min-h-11 items-start gap-2.5 text-sm">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={duplicates === 'create'} onChange={(e) => setDuplicates(e.target.checked ? 'create' : 'skip')} data-testid="import-dup-create" />
                    <span>{t('experts.import.duplicates.create')}</span>
                  </label>
                )}
                <div className="max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t('experts.import.preview')}</caption>
                    <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="w-10 px-2 py-1.5 text-start">#</th>
                        <th scope="col" className="px-2 py-1.5 text-start">{t('experts.col.name')}</th>
                        <th scope="col" className="px-2 py-1.5 text-start">{t('experts.col.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 200).map((r) => (
                        <tr key={r.index} className="border-t align-top">
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{formatNumber(r.index)}</td>
                          <td className="px-2 py-1.5" dir="auto">{r.name ?? parsed.rows[r.index - 1]?.name_en ?? parsed.rows[r.index - 1]?.name_ar ?? '-'}</td>
                          <td className="px-2 py-1.5">
                            <Badge tone={TONE[r.status] ?? 'neutral'}>{t(`experts.import.status.${r.status}`)}</Badge>
                            {r.status === 'duplicate' && (
                              <span className="ms-2 text-xs text-muted-foreground" dir="auto">
                                {r.in_file ? t('experts.import.dup.inFile') : t('experts.import.dup.of', { name: r.matches?.[0]?.name_en || r.matches?.[0]?.name_ar || '' })}
                              </span>
                            )}
                            {r.status === 'invalid' && <span className="ms-2 text-xs text-destructive-text">{t('experts.import.invalid', { detail: invalidText(t, r.error) })}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > 200 && <p className="text-xs text-muted-foreground">{t('experts.import.more', { count: formatNumber(preview.rows.length - 200) })}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
