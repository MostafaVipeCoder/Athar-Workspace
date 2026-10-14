import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { exportAlumniRows } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { toRpcFilters } from './adminState.js'
import { yearOptions } from './adminLogic.js'
import { exportFilename, exportOwnerSheet } from './exportXlsx.js'
import { useAdminErrorText } from './hooks.js'
import './i18n.common.js'
import './directory.i18n.js'

/**
 * The owner's Excel export (M2): one row per company in the owner's 38 columns and header order (the server returns them, the browser writes them unchanged), for the
 * companies the current filters match. The file carries the CEO's national ID: the dialog says so, and the server logs every export (who / when / how many rows, never the numbers).
 */
export default function ExportDialog({ open, onClose, filters, count, latestYear, defaultYear = null }) {
  const { t, tn, lang } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const [year, setYear] = useState(defaultYear ? String(defaultYear) : '')
  const [labelLang, setLabelLang] = useState(lang)
  const [busy, setBusy] = useState(false)
  const years = yearOptions(latestYear)

  async function run() {
    setBusy(true)
    try {
      const result = await exportAlumniRows({ filters: toRpcFilters(filters), year: year ? Number(year) : null, lang: labelLang })
      const written = await exportOwnerSheet(result, exportFilename('alumni'))
      const src = result.meta?.ceo_source
      toast.success(`${tn('alumni.admin.dir.exported', written)}${src ? ` ${d('exportSources', { id: src.id, self: src.self, none: src.none })}` : ''}`, { duration: 9000 })
      onClose()
    } catch (e) {
      toast.error(`${d('exportFailed')} ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      dismissible={!busy}
      title={d('exportTitle')}
      description={tn('alumni.admin.dir.exportBody', count)}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={run} loading={busy} data-autofocus disabled={count === 0}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{busy ? d('exporting') : tn('alumni.admin.dir.exportRun', count)}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field as="select" label={d('exportYear')} hint={d('exportYearHint')} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">{d('yearLatest')}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Field>
        <Field as="select" label={d('exportLanguage')} value={labelLang} onChange={(e) => setLabelLang(e.target.value)}>
          <option value="ar">{t('alumni.admin.common.arabic')}</option>
          <option value="en">{t('alumni.admin.common.english')}</option>
        </Field>
      </div>
    </Modal>
  )
}
