import { useMemo, useState } from 'react'
import { Copy, ExternalLink, Trash2 } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useListMeta, useListMutations, useViewLink, LIST_VIEW_KEY } from '../../data/lists.js'
import { CARD_FIELDS } from '../../lib/entities.js'
import { PROFILE_COLORS, VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { entityFieldLabelKey } from '../../shared/entities/i18n.js'
import { OVERLAY_FIELD_TYPES, STATUS_TONES, humanizeKey, normalizeListConfig, validateListConfig } from './listConfig.js'

/**
 * Settings mode (design 01 section 3.3 / 06 4.3): name (tab title), visibility, show-to-participants, card fields,
 * accent, statuses vocabulary, custom overlay fields, public page link. ONE explicit Save (save_node with the rev
 * token): node columns travel in the same call as the config (useNodeConfig extraPatch).
 */
export default function ListSettings() {
  const { node } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeListConfig(raw), [raw])
  const meta = useListMeta(node.id)
  const link = useViewLink(node.id)
  const { ensureViewLink } = useListMutations(node.id)
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const [errors, setErrors] = useState({})
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty

  const patch = (next) => setConfig({ ...config, ...next })
  const patchCard = (next) => patch({ card: { ...config.card, ...next } })
  const toggleField = (f, on) => patchCard({ showFields: CARD_FIELDS.filter((x) => (x === f ? on : config.card.showFields.includes(x))) })

  async function onSave() {
    const errs = validateListConfig(config)
    setErrors(errs)
    if (Object.keys(errs).length) return
    const r = await save({ name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants })
    if (r.ok) toast.success(t('list.settings.saved'))
  }

  const url = link.data?.slug ? buildPublicUrl('view', canonicalRef({ slug: link.data.slug, id: node.id }), { viewKey: LIST_VIEW_KEY }) : null
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('list.settings.copied'))
    } catch {
      toast.info(url)
    }
  }

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6">
        <section className="space-y-3">
          <BilingualField label={t('list.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t('list.settings.kind')}:</span>
            <Badge tone="blue">{t(`list.kind.${meta.data?.subkind ?? 'generic'}`)}</Badge>
            <span className="text-xs text-muted-foreground">{t('list.settings.kindHint')}</span>
          </div>
        </section>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('list.settings.visibility')}</legend>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} className="h-4 w-4" />
              {t(`list.settings.visibility.${v}`)}
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} className="mt-1 h-4 w-4" />
            <span>{t('list.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('list.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="space-y-2" data-testid="settings-card">
          <h3 className="text-sm font-semibold">{t('list.settings.card')}</h3>
          <p className="text-xs text-muted-foreground">{t('list.settings.cardHint')}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {CARD_FIELDS.map((f) => (
              <label key={f} className="flex min-h-9 items-center gap-2">
                <input type="checkbox" checked={config.card.showFields.includes(f)} onChange={(e) => toggleField(f, e.target.checked)} className="h-4 w-4" />
                {t(entityFieldLabelKey(f, meta.data?.subkind ?? 'generic'))}
              </label>
            ))}
          </div>
          {errors.card && <p className="text-xs text-destructive">{t(errors.card)}</p>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('list.settings.accent')}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="radio" name="accent" checked={!config.card.accent} onChange={() => patchCard({ accent: null })} className="h-4 w-4" />
                {t('list.settings.accentNone')}
              </label>
              {PROFILE_COLORS.map((hex) => (
                <label key={hex} className="relative cursor-pointer">
                  <input type="radio" name="accent" value={hex} checked={config.card.accent === hex} onChange={() => patchCard({ accent: hex })} className="peer sr-only" aria-label={hex} />
                  <span aria-hidden="true" style={{ backgroundColor: hex }} className={`block h-8 w-8 rounded-full border-2 ${config.card.accent === hex ? 'border-foreground scale-110' : 'border-transparent'} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`} />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={config.card.expandable} onChange={(e) => patchCard({ expandable: e.target.checked })} className="h-4 w-4" />{t('list.settings.expandable')}</label>
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={config.card.hideTitleOnSingle} onChange={(e) => patchCard({ hideTitleOnSingle: e.target.checked })} className="h-4 w-4" />{t('list.settings.hideTitleOnSingle')}</label>
        </section>

        <section className="space-y-2" data-testid="settings-statuses">
          <h3 className="text-sm font-semibold">{t('list.settings.statuses')}</h3>
          <p className="text-xs text-muted-foreground">{t('list.settings.statusesHint')}</p>
          {config.statuses.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
              <Field label={t('list.settings.key')} value={s.key} dir="ltr" onChange={(e) => patch({ statuses: config.statuses.map((x, j) => (j === i ? { ...x, key: e.target.value.trim().toLowerCase(), label: x.label.en || x.label.ar ? x.label : { en: humanizeKey(e.target.value), ar: '' } } : x)) })} />
              <Field label="English" value={s.label.en} dir="ltr" onChange={(e) => patch({ statuses: config.statuses.map((x, j) => (j === i ? { ...x, label: { ...x.label, en: e.target.value } } : x)) })} />
              <Field label="العربية" value={s.label.ar} dir="rtl" onChange={(e) => patch({ statuses: config.statuses.map((x, j) => (j === i ? { ...x, label: { ...x.label, ar: e.target.value } } : x)) })} />
              <div className="space-y-1.5">
                <label htmlFor={`tone-${i}`} className="block text-sm font-medium">{t('list.settings.tone')}</label>
                <select id={`tone-${i}`} value={s.tone} onChange={(e) => patch({ statuses: config.statuses.map((x, j) => (j === i ? { ...x, tone: e.target.value } : x)) })} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm">
                  {STATUS_TONES.map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                </select>
              </div>
              <Button variant="ghost" size="icon" className="self-end text-destructive" aria-label={`${t('list.settings.removeStatus')}: ${s.key}`} onClick={() => patch({ statuses: config.statuses.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          ))}
          {errors.statuses && <p className="text-xs text-destructive">{t(errors.statuses)}</p>}
          <Button variant="outline" size="sm" onClick={() => patch({ statuses: [...config.statuses, { key: '', label: { en: '', ar: '' }, tone: 'neutral' }] })}>{t('list.settings.addStatus')}</Button>
        </section>

        <section className="space-y-2" data-testid="settings-overlay-fields">
          <h3 className="text-sm font-semibold">{t('list.settings.overlayFields')}</h3>
          <p className="text-xs text-muted-foreground">{t('list.settings.overlayFieldsHint')}</p>
          {config.overlayFields.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
              <Field label={t('list.settings.key')} value={f.key} dir="ltr" onChange={(e) => patch({ overlayFields: config.overlayFields.map((x, j) => (j === i ? { ...x, key: e.target.value.trim().toLowerCase() } : x)) })} />
              <Field label="English" value={f.label.en} dir="ltr" onChange={(e) => patch({ overlayFields: config.overlayFields.map((x, j) => (j === i ? { ...x, label: { ...x.label, en: e.target.value } } : x)) })} />
              <Field label="العربية" value={f.label.ar} dir="rtl" onChange={(e) => patch({ overlayFields: config.overlayFields.map((x, j) => (j === i ? { ...x, label: { ...x.label, ar: e.target.value } } : x)) })} />
              <div className="space-y-1.5">
                <label htmlFor={`type-${i}`} className="block text-sm font-medium">{t('list.settings.type')}</label>
                <select id={`type-${i}`} value={f.type} onChange={(e) => patch({ overlayFields: config.overlayFields.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm">
                  {OVERLAY_FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                </select>
              </div>
              <Button variant="ghost" size="icon" className="self-end text-destructive" aria-label={`${t('list.settings.removeStatus')}: ${f.key}`} onClick={() => patch({ overlayFields: config.overlayFields.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              {f.type === 'select' && (
                <Field className="sm:col-span-5" label={t('list.settings.options')} value={f.options.join(', ')} onChange={(e) => patch({ overlayFields: config.overlayFields.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)) })} />
              )}
            </div>
          ))}
          {errors.overlayFields && <p className="text-xs text-destructive">{t(errors.overlayFields)}</p>}
          <Button variant="outline" size="sm" onClick={() => patch({ overlayFields: [...config.overlayFields, { key: '', label: { en: '', ar: '' }, type: 'text', options: [] }] })}>{t('list.settings.addField')}</Button>
        </section>

        <section className="space-y-2" data-testid="settings-link">
          <h3 className="text-sm font-semibold">{t('list.settings.link')}</h3>
          <p className="text-xs text-muted-foreground">{t('list.settings.linkHint')}</p>
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{url}</code>
              <Button size="sm" variant="outline" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" />{t('list.settings.copyLink')}</Button>
              <a href={`${url}${url.includes('?') ? '&' : '?'}lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('list.settings.openLink')}
              </a>
            </div>
          ) : (
            <Button size="sm" variant="outline" loading={ensureViewLink.isPending || link.isPending} onClick={() => ensureViewLink.mutateAsync().catch((e) => toast.error(t(e?.messageKey ?? 'errors.unknown')))} data-testid="create-link">
              {t('list.settings.createLink')}
            </Button>
          )}
        </section>
      </div>
    </NodeFrame>
  )
}
