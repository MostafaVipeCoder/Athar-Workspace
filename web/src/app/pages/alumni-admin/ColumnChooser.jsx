import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { COLUMNS, COLUMN_KEYS, DEFAULT_COLUMNS, columnHeader } from './columns.js'
import './i18n.common.js'
import './directory.i18n.js'

const GROUP_ORDER = ['startup', 'program', 'classification', 'location', 'online', 'people', 'status', 'team', 'metrics']

/**
 * Which columns the table shows (the owner's 38 Excel columns, then the extras). The national-ID column is OFF by default. The choice is kept by the page (this browser only);
 * at least one column stays (the table cannot be empty).
 */
export default function ColumnChooser({ open, onClose, columns, onChange, year }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const chosen = new Set(columns)
  const toggle = (key) => {
    const next = new Set(chosen)
    if (next.has(key)) {
      if (next.size === 1) return
      next.delete(key)
    } else next.add(key)
    onChange(COLUMN_KEYS.filter((k) => next.has(k)))
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={d('chooserTitle')}
      description={d('chooserBody')}
      closeLabel={t('common.close')}
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onChange([...DEFAULT_COLUMNS])}>{d('chooserDefaults')}</Button>
          <Button variant="ghost" onClick={() => onChange([...COLUMN_KEYS])}>{d('chooserAll')}</Button>
          <Button onClick={onClose} data-autofocus>{t('common.close')}</Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {GROUP_ORDER.map((g) => {
          const cols = COLUMNS.filter((c) => c.group === g)
          if (cols.length === 0) return null
          return (
            <fieldset key={g} className="min-w-0 space-y-1">
              <legend className="mb-1 text-sm font-bold">{d(`group.${g}`)}</legend>
              {cols.map((c) => (
                <label key={c.key} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-surface">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={chosen.has(c.key)} onChange={() => toggle(c.key)} />
                  <span className="min-w-0 text-sm">
                    <span className="block font-semibold">{d(`col.${c.key}`, { year })}</span>
                    {c.owner && <span className="block text-xs text-muted-foreground" dir="ltr">{d('chooserOwner', { header: columnHeader(c, year) })}</span>}
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {c.sensitive && <Badge tone="amber">{d('chooserSensitive')}</Badge>}
                      {c.derived && <Badge tone="outline">{d('chooserDerived')}</Badge>}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )
        })}
      </div>
      {chosen.size === 1 && <p className="mt-3 text-xs text-muted-foreground">{d('chooserNeeds')}</p>}
    </Modal>
  )
}
