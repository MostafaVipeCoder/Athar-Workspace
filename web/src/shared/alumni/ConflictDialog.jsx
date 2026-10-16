import { useState } from 'react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { allDecided } from '../../lib/alumniConflicts.js'
import { cn } from '../../lib/cn.js'
import './i18n.edit.js'

/**
 * The fields both people changed to different values, one card each: what it was, what you typed, what the other side saved, and a radio choice. Used inside the dialog below and
 * inline by the yearly-figure form (a dialog on top of a dialog would trap the focus twice). `choices` = `{ [key]: 'mine' | 'theirs' }`, `onChoose(key, 'mine' | 'theirs')`.
 */
export function ConflictList({ conflicts, who, fieldLabel, valueText, choices, onChoose }) {
  const { t } = useLanguage()
  const show = (key, v) => valueText(key, v) || t('alumni.edit.empty')
  return (
    <ul className="space-y-4" data-testid="conflict-list">
      {conflicts.map((c) => (
        <li key={c.key} className="space-y-3 rounded-card border bg-card p-4" data-testid="conflict-field">
          <fieldset className="space-y-3">
            <legend className="text-base font-bold">{fieldLabel(c.key)}</legend>
            <p className="text-xs text-muted-foreground">{t('alumni.edit.conflict.was')}: <span dir="auto">{show(c.key, c.base)}</span></p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { id: 'mine', title: t('alumni.edit.conflict.yours'), value: c.mine, action: t('alumni.edit.conflict.mine') },
                { id: 'theirs', title: t('alumni.edit.conflict.theirsLabel', { who }), value: c.theirs, action: t('alumni.edit.conflict.theirs') },
              ].map((o) => (
                <label key={o.id} className={cn('flex min-h-11 cursor-pointer flex-col gap-1 rounded-input border p-3 text-sm focus-within:ring-2 focus-within:ring-ring', choices[c.key] === o.id ? 'border-primary bg-primary/5' : 'border-input')}>
                  <span className="flex items-center gap-2 font-semibold">
                    <input type="radio" name={`conflict-${c.key}`} value={o.id} checked={choices[c.key] === o.id} onChange={() => onChoose(c.key, o.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                    {o.action}
                  </span>
                  <span className="text-xs text-muted-foreground">{o.title}</span>
                  <span dir="auto" className="break-words whitespace-pre-line" data-testid={`conflict-${o.id}-value`}>{show(c.key, o.value)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </li>
      ))}
    </ul>
  )
}

/**
 * Two people edit the same record (a manager and a founder) and never overwrite each other unseen: for every field BOTH changed to different values this dialog asks which to keep.
 * Nothing is chosen for you; "Apply" waits until every field has a choice. `conflicts` = lib/alumniConflicts.findConflicts; `fieldLabel(key)` and `valueText(key, value)` come
 * from `useEditText` (a national ID is never shown). `onResolve(choices)` gets `{ [key]: 'mine' | 'theirs' }`.
 */
export default function ConflictDialog({ conflicts, who, fieldLabel, valueText, onResolve, onCancel }) {
  const { t } = useLanguage()
  const [choices, setChoices] = useState({})
  const ready = allDecided(conflicts, choices)
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('alumni.edit.conflict.title')}
      description={t('alumni.edit.conflict.body', { who })}
      closeLabel={t('common.close')}
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>{t('alumni.edit.conflict.cancel')}</Button>
          <Button onClick={() => onResolve(choices)} disabled={!ready} data-testid="conflict-apply">{t('alumni.edit.conflict.apply')}</Button>
        </>
      }
    >
      <ConflictList conflicts={conflicts} who={who} fieldLabel={fieldLabel} valueText={valueText} choices={choices} onChoose={(k, v) => setChoices((s) => ({ ...s, [k]: v }))} />
    </Modal>
  )
}
