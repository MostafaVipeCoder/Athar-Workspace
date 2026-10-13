import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { Img } from '../../ui/Img.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { useFormCovers, useFormMutations } from '../../data/forms.js'
import { publicImageUrl, publicThumbUrl, uploadImage } from '../../data/storage.js'
import { IMAGE } from '../../lib/constants.js'
import { validateImageFile } from '../../lib/image.js'

/**
 * Cover library (as-is CoverLibraryModal without its crash, docs/04 A-24): covers of the project + the global ones,
 * upload (project library), choose, delete (confirm). `onSelect(cover)` is always provided by the caller.
 */
export function CoverPicker({ projectId, nodeId, userId, currentId, onSelect, onClose }) {
  const { t } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const covers = useFormCovers(projectId)
  const m = useFormMutations(nodeId, projectId)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = validateImageFile(file)
    if (problem) { toast.error(t(`errors.${problem}`)); return }
    setBusy(true)
    try {
      const imagePath = await uploadImage(file, { ownerId: projectId, kind: 'form-cover' })
      const cover = await m.createCover.mutateAsync({ name: file.name.replace(/\.[^.]+$/, ''), imagePath, userId })
      toast.success(t('form.cover.uploaded'))
      onSelect(cover)
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }
  async function remove(cover) {
    if (!(await confirm({ title: t('form.cover.deleteTitle'), message: t('form.cover.deleteBody'), destructive: true }))) return
    try {
      await m.deleteCover.mutateAsync(cover)
      toast.success(t('form.cover.deleted'))
      if (cover.id === currentId) onSelect(null)
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <Modal open onClose={onClose} title={t('form.cover.title')} description={t('form.cover.hint')} closeLabel={t('common.close')} className="sm:max-w-3xl"
      footer={<>
        <input ref={inputRef} type="file" accept={IMAGE.accept.join(',')} className="sr-only" onChange={pick} aria-label={t('form.cover.upload')} />
        <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        <Button loading={busy} onClick={() => inputRef.current?.click()} data-testid="cover-upload"><ImagePlus className="h-4 w-4" aria-hidden="true" />{t('form.cover.upload')}</Button>
      </>}
    >
      {covers.isPending ? <Loading /> : covers.error ? <ErrorState error={covers.error} onRetry={covers.refetch} /> : !covers.data?.length ? (
        <EmptyState title={t('form.cover.empty')} body={t('form.cover.emptyBody')} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="cover-grid">
          {covers.data.map((c) => (
            <li key={c.id} className={`overflow-hidden rounded-card border ${c.id === currentId ? 'ring-2 ring-primary' : ''}`}>
              <button type="button" className="block w-full text-start" onClick={() => onSelect(c)} aria-label={`${t('form.cover.use')}: ${c.name ?? ''}`}>
                <Img src={publicImageUrl(c.image_path)} thumb={publicThumbUrl(c.image_path)} variant="thumb" alt="" aspect="16 / 9" />
              </button>
              <div className="flex items-center gap-1 p-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{c.name || '-'}</span>
                {!c.project_id && <Badge tone="outline">{t('form.cover.global')}</Badge>}
                {(c.project_id === projectId) && (
                  <Button variant="ghost" size="icon" className="h-8 min-h-8 w-8 min-w-8 text-destructive" aria-label={`${t('form.cover.delete')}: ${c.name ?? ''}`} onClick={() => remove(c)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
