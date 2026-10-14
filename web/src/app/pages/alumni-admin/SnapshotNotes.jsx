import { useState } from 'react'
import { useAlumniMutations } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useAdminErrorText } from './hooks.js'
import './i18n.common.js'
import './workspace.i18n.js'

const KEYS = ['traction', 'challenges', 'needs']

/** The three text fields of a yearly row (traction / challenges / needs): saved as a patch of what changed, with the year being logged. */
export default function SnapshotNotes({ company, year, onClose }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.ws.${k}`, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { saveSnapshot } = useAlumniMutations()
  const base = Object.fromEntries(KEYS.map((k) => [k, company.snapshot?.[k] ?? '']))
  const [values, setValues] = useState(base)
  const changed = KEYS.filter((k) => values[k] !== base[k])

  async function save() {
    try {
      await saveSnapshot.mutateAsync({ companyId: company.id, year, data: Object.fromEntries(changed.map((k) => [k, values[k].trim() === '' ? null : values[k].trim()])) })
      toast.success(d('notesSaved'))
      onClose()
    } catch (e) {
      toast.error(`${d('notesFailed')} ${errorText(e, { traction: d('traction'), challenges: d('challenges'), needs: d('needs') })}`)
    }
  }

  return (
    <Modal open onClose={onClose} title={d('notesTitle', { year, company: company.name })} closeLabel={t('common.close')}
      footer={<><Button variant="outline" onClick={onClose}>{d('cancel')}</Button><Button onClick={save} disabled={changed.length === 0} loading={saveSnapshot.isPending}>{d('save')}</Button></>}>
      <div className="space-y-3">
        {KEYS.map((k) => <Field key={k} as="textarea" rows={3} maxLength={4000} label={d(k)} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />)}
      </div>
    </Modal>
  )
}
