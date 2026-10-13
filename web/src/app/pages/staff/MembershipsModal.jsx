import { useState } from 'react'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'

/** Checkbox list of programs (program-level membership grants all its projects, design 03 section 3.2). */
export function ProgramChecklist({ programs, value, onChange, name = 'programs' }) {
  const { t, pick } = useLanguage()
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  if (!programs?.length) return <p className="text-sm text-muted-foreground">{t('programs.empty')}</p>
  return (
    <div className="space-y-1">
      {programs.map((g) => (
        <label key={g.id} className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-surface">
          <input type="checkbox" name={name} value={g.id} checked={value.includes(g.id)} onChange={() => toggle(g.id)} />
          <span className="min-w-0 flex-1 truncate">{pick(g, 'name')}</span>
          {g.archived_at && <span className="text-xs text-muted-foreground">{t('programs.archived')}</span>}
        </label>
      ))}
    </div>
  )
}

export default function MembershipsModal({ person, programs, onClose, onSave }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [ids, setIds] = useState(() => person.programs.map((g) => g.program_id))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await onSave(ids)
      toast.success(t('staff.programsSaved'))
      onClose()
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('staff.editPrograms')}
      description={t('staff.programsHint', { name: person.full_name || person.email })}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={busy}>{t('common.save')}</Button>
        </>
      }
    >
      <ProgramChecklist programs={programs} value={ids} onChange={setIds} />
    </Modal>
  )
}
