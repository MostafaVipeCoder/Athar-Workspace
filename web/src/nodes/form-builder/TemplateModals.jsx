import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { useFormMutations, useFormTemplates } from '../../data/forms.js'
import { draftFromTemplate, templateFromDraft } from './formLogic.js'

/** "Import from library": pick a template; the draft is replaced (confirm when the form already has questions). */
export function ImportTemplateModal({ projectId, nodeId, currentCount, onImport, onClose, canDeleteGlobal = false }) {
  const { t, pick } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const templates = useFormTemplates(projectId)
  const m = useFormMutations(nodeId, projectId)

  async function choose(tpl) {
    if (currentCount > 0 && !(await confirm({ title: t('form.template.replaceTitle'), message: t('form.template.replaceBody', { count: currentCount }), destructive: true }))) return
    onImport(draftFromTemplate(tpl.definition), tpl)
    toast.success(t('form.template.imported'))
    onClose()
  }
  async function remove(tpl) {
    if (!(await confirm({ title: t('form.template.deleteTitle'), message: t('form.template.deleteBody'), destructive: true }))) return
    try {
      await m.deleteTemplate.mutateAsync(tpl.id)
      toast.success(t('form.template.deleted'))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }
  const count = (tpl) => (Array.isArray(tpl.definition?.questions) ? tpl.definition.questions.length : 0)

  return (
    <Modal open onClose={onClose} title={t('form.template.importTitle')} description={t('form.template.importHint')} closeLabel={t('common.close')} className="sm:max-w-2xl" footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
      {templates.isPending ? <Loading /> : templates.error ? <ErrorState error={templates.error} onRetry={templates.refetch} /> : !templates.data?.length ? (
        <EmptyState title={t('form.template.empty')} body={t('form.template.emptyBody')} />
      ) : (
        <ul className="divide-y" data-testid="template-list">
          {templates.data.map((tpl) => (
            <li key={tpl.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{pick(tpl, 'name') || '-'}</p>
                <p className="truncate text-xs text-muted-foreground">{pick(tpl, 'description')}</p>
              </div>
              <Badge tone={tpl.project_id ? 'blue' : 'outline'}>{tpl.project_id ? t('form.template.project') : t('form.template.global')}</Badge>
              <span className="text-xs text-muted-foreground">{t('form.template.questions', { count: count(tpl) })}</span>
              <Button size="sm" onClick={() => choose(tpl)} data-testid={`import-${tpl.id}`}>{t('form.template.import')}</Button>
              {(tpl.project_id === projectId || (!tpl.project_id && canDeleteGlobal)) && (
                <Button variant="ghost" size="icon" className="text-destructive" aria-label={`${t('form.template.deleteTitle')} ${pick(tpl, 'name')}`} onClick={() => remove(tpl)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** "Save as template": name/description/scope; stores the CURRENT draft (not the saved state) as a definition. */
export function SaveTemplateModal({ projectId, nodeId, draft, coverId, userId, canGlobal, onClose }) {
  const { t } = useLanguage()
  const toast = useToast()
  const m = useFormMutations(nodeId, projectId)
  const [name, setName] = useState(draft.name ?? { en: '', ar: '' })
  const [description, setDescription] = useState({ en: '', ar: '' })
  const [scope, setScope] = useState('project')
  const [error, setError] = useState(null)

  async function save() {
    if (!name.en.trim() && !name.ar.trim()) { setError(t('form.template.nameRequired')); return }
    try {
      await m.createTemplate.mutateAsync({ projectId: scope === 'global' ? null : projectId, name, description, definition: templateFromDraft(draft), coverId: coverId ?? null, userId })
      toast.success(t('form.template.saved'))
      onClose()
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <Modal open onClose={onClose} title={t('form.template.saveTitle')} description={t('form.template.saveHint')} closeLabel={t('common.close')}
      footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={save} loading={m.createTemplate.isPending} data-testid="template-save">{t('form.template.save')}</Button></>}>
      <div className="space-y-3">
        <BilingualField label={t('form.template.name')} value={name} onChange={setName} required error={error} />
        <BilingualField label={t('form.template.description')} value={description} onChange={setDescription} as="textarea" rows={2} />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t('form.template.scope')}</legend>
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name="scope" className="h-4 w-4" checked={scope === 'project'} onChange={() => setScope('project')} />{t('form.template.scopeProject')}</label>
          {canGlobal && <label className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name="scope" className="h-4 w-4" checked={scope === 'global'} onChange={() => setScope('global')} />{t('form.template.scopeGlobal')}</label>}
        </fieldset>
      </div>
    </Modal>
  )
}
