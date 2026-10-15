import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { ImageField } from '../../../ui/ImageField.jsx'
import { publicImageUrl, publicThumbUrl } from '../../../data/storage.js'
import { discardExpertPhoto, uploadExpertPhoto, useExpertActions } from '../../../data/people.js'
import './experts.i18n.js'
import { errorText } from './hooks.js'

/**
 * "Add / change / remove the photo" straight from the profile (the 3 migrated experts without a photo get theirs here): the file goes through the central WebP pipeline
 * (avatar profile: 512 px + a 320 px thumbnail) into the registry folder, then the record is PATCHED with the new path and the replaced files are removed. A picked photo is
 * saved immediately (no second "save" step): the dialog closes when the record has it.
 */
export default function PhotoDialog({ expert, onClose }) {
  const { t } = useLanguage()
  const toast = useToast()
  const actions = useExpertActions()

  async function onFile(file) {
    const path = await uploadExpertPhoto(file)
    try {
      const res = await actions.update.mutateAsync({ id: expert.id, patch: { photo_path: path }, expectedAt: null })
      await discardExpertPhoto(res.oldPhotoPath)
      toast.success(t('experts.toast.photoSaved'))
      onClose()
    } catch (e) {
      await discardExpertPhoto(path) // the record never got it: do not leave an orphan
      throw e
    }
    return path
  }
  async function onClear() {
    try {
      const res = await actions.update.mutateAsync({ id: expert.id, patch: { photo_path: null }, expectedAt: null })
      await discardExpertPhoto(res.oldPhotoPath)
      toast.success(t('experts.toast.photoRemoved'))
      onClose()
    } catch (e) {
      toast.error(errorText(t, e))
    }
  }

  return (
    <Modal open onClose={onClose} title={expert.photoPath ? t('experts.photo.change') : t('experts.photo.add')} description={t('experts.photo.hint')} closeLabel={t('common.close')}>
      <ImageField
        label={t('experts.field.photo')}
        profile="avatar"
        aspect="1 / 1"
        src={expert.photoPath ? publicImageUrl(expert.photoPath) : null}
        thumb={expert.photoPath ? publicThumbUrl(expert.photoPath) : null}
        onFile={onFile}
        onClear={expert.photoPath ? onClear : undefined}
        labels={{ choose: t('experts.photo.add'), replace: t('experts.photo.change'), remove: t('experts.photo.remove'), hint: t('experts.photo.hint') }}
        className="mx-auto max-w-[16rem]"
      />
    </Modal>
  )
}
