import { useState } from 'react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { CARD_FIELDS, biPick, emptyEntity, toManualFields, validateEntityView, visibleCardFields } from '../../lib/entities.js'
import { EntityForm } from './EntityForm.jsx'
import { entityFieldLabelKey } from './i18n.js'

/**
 * Add / edit dialog of ONE list item (design 02 sections 3.4-3.5):
 * - manual item (or `item == null` = new manual item): the entity fields are editable (EntityForm);
 * - sourced item (form response, Athar Network, company): the source fields are READ-ONLY (shown as a summary with a
 *   hint to edit at the source); only the overlay is editable.
 * Overlay section (every item): status (list vocabulary), notes, custom overlay fields, per-item "show on card".
 * onSave({ fields, overlayPatch, status }) does the writes; the caller decides which RPCs run.
 */
export function ItemEditor({ item, kind = 'generic', config, onClose, onSave, onUpload, saving = false }) {
  const { t, lang } = useLanguage()
  const isNew = !item
  const manual = isNew || item.source.kind === 'manual'
  const statuses = config?.statuses ?? []
  const overlayFields = config?.overlayFields ?? []
  const [entity, setEntity] = useState(() => (item ? { ...item.entity, kind } : emptyEntity(kind)))
  const [status, setStatus] = useState(item?.status ?? '')
  const [notes, setNotes] = useState(item?.overlay?.notes ?? '')
  const [custom, setCustom] = useState(() => Object.fromEntries(overlayFields.map((f) => [f.key, item?.overlay?.[f.key] ?? ''])))
  const [cardMode, setCardMode] = useState(() => (item && Object.keys(item.card ?? {}).length ? 'custom' : 'default'))
  const [show, setShow] = useState(() => new Set(visibleCardFields(config?.card?.showFields, item?.card ?? {})))
  const [errors, setErrors] = useState({})
  const listDefaults = config?.card?.showFields?.length ? config.card.showFields : CARD_FIELDS

  function submit() {
    if (manual) {
      const errs = validateEntityView(entity)
      setErrors(errs)
      if (Object.keys(errs).length) return
    }
    const overlayPatch = { notes: notes.trim() || null }
    for (const f of overlayFields) {
      const v = custom[f.key]
      overlayPatch[f.key] = v === '' || v === null || v === undefined ? null : f.type === 'number' ? Number(v) : f.type === 'boolean' ? Boolean(v) : v
    }
    overlayPatch.card = cardMode === 'custom' ? { show: Object.fromEntries(CARD_FIELDS.map((f) => [f, show.has(f)])) } : null
    onSave({
      fields: manual ? toManualFields(entity) : null,
      overlayPatch,
      status: status || null,
      statusChanged: (status || null) !== (item?.status ?? null),
    })
  }

  const title = isNew ? t(`entity.editor.new.${kind}`) : `${t('common.edit')}: ${biPick(item.entity.title, lang) || '-'}`
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      closeLabel={t('common.close')}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={submit} loading={saving} data-testid="item-editor-save">{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-5">
        {manual ? (
          <EntityForm value={entity} onChange={setEntity} kind={kind} onUpload={onUpload} errors={errors} />
        ) : (
          <section className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="source-summary">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge tone="outline">{t(`entity.source.${item.source.kind}`)}</Badge>
              {item.missing && <Badge tone="red">{t('entity.source.missing')}</Badge>}
            </div>
            <p className="font-medium">{biPick(item.entity.title, lang) || '-'}</p>
            <p className="text-muted-foreground">{[biPick(item.entity.subtitle, lang), biPick(item.entity.organization, lang)].filter(Boolean).join(' · ')}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t('entity.editor.sourceReadOnly')}</p>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('entity.editor.overlay')}</h3>
          {statuses.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="item-status" className="block text-sm font-medium">{t('entity.manager.col.status')}</label>
              <select id="item-status" value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">{t('entity.manager.filter.noStatus')}</option>
                {statuses.map((s) => <option key={s.key} value={s.key}>{biPick(s.label, lang) || s.key}</option>)}
                {status && !statuses.some((s) => s.key === status) && <option value={status}>{status}</option>}
              </select>
            </div>
          )}
          <Field as="textarea" rows={3} label={t('entity.manager.col.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} inputClassName="min-h-20 py-2" hint={t('entity.editor.notesHint')} />
          {overlayFields.map((f) => {
            const label = biPick(f.label, lang) || f.key
            if (f.type === 'boolean') {
              return (
                <label key={f.key} className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(custom[f.key])} onChange={(e) => setCustom((c) => ({ ...c, [f.key]: e.target.checked }))} className="h-4 w-4" />
                  {label}
                </label>
              )
            }
            if (f.type === 'select') {
              return (
                <div key={f.key} className="space-y-1.5">
                  <label htmlFor={`ov-${f.key}`} className="block text-sm font-medium">{label}</label>
                  <select id={`ov-${f.key}`} value={custom[f.key] ?? ''} onChange={(e) => setCustom((c) => ({ ...c, [f.key]: e.target.value }))} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">-</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              )
            }
            const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'link' ? 'url' : 'text'
            return <Field key={f.key} label={label} type={type} dir={type === 'url' ? 'ltr' : undefined} value={custom[f.key] ?? ''} onChange={(e) => setCustom((c) => ({ ...c, [f.key]: e.target.value }))} />
          })}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('entity.editor.card')}</h3>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex min-h-9 items-center gap-2"><input type="radio" name="card-mode" checked={cardMode === 'default'} onChange={() => { setCardMode('default'); setShow(new Set(listDefaults)) }} className="h-4 w-4" />{t('entity.editor.cardDefault')}</label>
            <label className="flex min-h-9 items-center gap-2"><input type="radio" name="card-mode" checked={cardMode === 'custom'} onChange={() => setCardMode('custom')} className="h-4 w-4" />{t('entity.editor.cardCustom')}</label>
          </div>
          {cardMode === 'custom' && (
            <div className="flex flex-wrap gap-3 text-sm" data-testid="card-toggles">
              {CARD_FIELDS.map((f) => (
                <label key={f} className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={show.has(f)} onChange={(e) => setShow((s) => { const n = new Set(s); if (e.target.checked) n.add(f); else n.delete(f); return n })} className="h-4 w-4" />
                  {t(entityFieldLabelKey(f, kind))}
                </label>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
export default ItemEditor
