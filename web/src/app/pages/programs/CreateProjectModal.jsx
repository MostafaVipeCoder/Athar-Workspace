import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { BilingualField } from '../../../ui/BilingualField.jsx'
import { toColumns } from '../../../lib/bilingual.js'
import { useToast } from '../../../ui/Toast.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useCreateProject } from '../../../data/programs.js'
import { staffPath } from '../../../lib/links.js'
import { DEFAULT_TIMEZONE } from '../../../lib/constants.js'
import TimezoneSelect from './TimezoneSelect.jsx'

/** Create a project inside a program (RPC create_project). Name ar/en + timezone; Project Details come after. */
export default function CreateProjectModal({ open, onClose, programId }) {
  const { t } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()
  const create = useCreateProject()
  const [name, setName] = useState({ en: '', ar: '' })
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!name.en.trim() && !name.ar.trim()) {
      setError(t('programs.form.nameRequired'))
      return
    }
    setError(null)
    try {
      const row = await create.mutateAsync({ program_id: programId, ...toColumns(name, 'name'), timezone })
      toast.success(t('projects.created'))
      onClose()
      navigate(staffPath.projectDetails(row.id))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('projects.create')} description={t('projects.createHint')} closeLabel={t('common.close')} className="sm:max-w-lg">
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="project-form">
        <BilingualField label={t('projects.form.name')} required value={name} onChange={setName} error={error} />
        <TimezoneSelect label={t('projects.form.timezone')} hint={t('projects.form.timezoneHint')} value={timezone} onChange={setTimezone} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>{t('common.cancel')}</Button>
          <Button type="submit" loading={create.isPending}>{t('projects.createSubmit')}</Button>
        </div>
      </form>
    </Modal>
  )
}
