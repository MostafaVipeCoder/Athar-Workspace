import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../../ui/Modal.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useCreateProgram, updateProgram } from '../../../data/programs.js'
import { uploadImage } from '../../../data/storage.js'
import { staffPath } from '../../../lib/links.js'
import ProgramForm from './ProgramForm.jsx'

/**
 * Create program. The cover can only be uploaded AFTER the row exists (the bucket policy keys on the program id),
 * so the chosen file is kept locally and uploaded right after `create_program`, then `cover_path` is set.
 */
export default function CreateProgramModal({ open, onClose }) {
  const { t } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()
  const create = useCreateProgram()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(patch) {
    setBusy(true)
    try {
      const row = await create.mutateAsync(patch)
      if (file) {
        try {
          const path = await uploadImage(file, { ownerId: row.id, kind: 'cover' })
          await updateProgram(row.id, { cover_path: path })
        } catch (err) {
          toast.warning(t('programs.coverFailed'))
          void err
        }
      }
      toast.success(t('programs.created'))
      onClose()
      navigate(staffPath.program(row.id))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={t('programs.create')} closeLabel={t('common.close')} className="sm:max-w-2xl" dismissible={!busy}>
      <ProgramForm
        onSubmit={submit}
        busy={busy}
        onCancel={onClose}
        submitLabel={t('programs.createSubmit')}
        cover={{
          src: null, // ImageField shows its own preview of the kept file
          onFile: async (f) => setFile(f),
          onClear: () => setFile(null),
        }}
      />
    </Modal>
  )
}
