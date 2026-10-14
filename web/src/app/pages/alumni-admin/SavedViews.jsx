import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { deleteView, readViews, saveView } from './adminState.js'
import './i18n.common.js'
import './directory.i18n.js'

/**
 * Saved views of the directory (filters + sort + columns): per-viewer conveniences kept in this browser (localStorage, guarded), so they never need a table of their own
 * and never reach the server. `current` = `{ filters, sort, dir, columns }`; `onApply(view)` puts a saved view back.
 */
export default function SavedViews({ open, onClose, current, onApply, onNotify }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const [name, setName] = useState('')
  const [views, setViews] = useState(() => readViews())

  function save(e) {
    e.preventDefault()
    if (!name.trim()) return
    setViews(saveView({ name, ...current }))
    setName('')
    onNotify?.(d('viewSaved'))
  }
  function remove(v) {
    setViews(deleteView(v.id))
    onNotify?.(d('viewDeleted'))
  }

  return (
    <Modal open={open} onClose={onClose} title={d('views')} closeLabel={t('common.close')} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
      <form onSubmit={save} className="flex items-end gap-2">
        <Field className="flex-1" label={d('viewName')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>{d('viewSave')}</Button>
      </form>
      {views.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{d('viewsNone')}</p> : (
        <ul className="mt-4 divide-y rounded-card border">
          {views.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <button type="button" onClick={() => onApply(v)} aria-label={d('viewApply', { name: v.name })} className="min-h-11 min-w-0 flex-1 truncate text-start text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{v.name}</button>
              <button type="button" onClick={() => remove(v)} aria-label={d('viewDelete', { name: v.name })} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-destructive-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
