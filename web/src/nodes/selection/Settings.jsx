import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { CARD_FIELDS } from '../../lib/entities.js'
import { PROFILE_COLORS, VISIBILITY } from '../../lib/constants.js'
import { entityFieldLabelKey } from '../../shared/entities/i18n.js'
import { EMAIL_KEYS, STAGE_TONES, STAGE_TYPES, humanizeKey, normalizeSelectionConfig, toStoredConfig, validateSelectionConfig } from './selectionConfig.js'

const selectCls = 'min-h-11 rounded-md border border-input bg-background px-2 text-sm'

/**
 * Settings mode (design 01 section 3.4 config / 06 4.3): name ar/en, visibility (private by default, hint), show to
 * participants (off by default), the stage vocabulary (key, labels, type, colour, decision e-mail, reason required),
 * the "accepted -> participants" toggle (02 section 7.3 step 1), the interview Booking node override and the results
 * tab card. ONE explicit Save (save_node with the rev token): node columns + the normalised config in the same call.
 */
export default function SelectionSettings() {
  const { node, graph } = useNodeContext()
  const { t, pick } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeSelectionConfig(raw), [raw])
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const [errors, setErrors] = useState({})
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty

  const bookings = useMemo(() => (graph?.nodes ?? []).filter((n) => n.type === 'booking' && !n.deleted_at), [graph])
  const connectedBooking = useMemo(() => {
    const e = (graph?.edges ?? []).find((x) => x.from_node_id === node.id && x.is_enabled !== false && bookings.some((b) => b.id === x.to_node_id))
    return e ? bookings.find((b) => b.id === e.to_node_id) : null
  }, [graph, node.id, bookings])

  const patch = (next) => setConfig({ ...config, ...next })
  const patchStage = (i, next) => patch({ stages: config.stages.map((s, j) => (j === i ? { ...s, ...next } : s)) })
  const toggleField = (f, on) => patch({ card: { ...config.card, showFields: CARD_FIELDS.filter((x) => (x === f ? on : config.card.showFields.includes(x))) } })

  async function onSave() {
    const errs = validateSelectionConfig(config)
    setErrors(errs)
    if (Object.keys(errs).length) return
    const r = await save({ config: toStoredConfig(config), name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants })
    if (r.ok) toast.success(t('selection.settings.saved'))
  }

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6">
        <section className="space-y-3">
          <BilingualField label={t('selection.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />
        </section>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('selection.settings.visibility')}</legend>
          <p className="text-xs text-muted-foreground">{t('selection.settings.visibilityHint')}</p>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} className="h-4 w-4" />
              {t(`selection.settings.visibility.${v}`)}
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} className="mt-1 h-4 w-4" />
            <span>{t('selection.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('selection.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="space-y-2" data-testid="settings-stages">
          <h3 className="text-sm font-semibold">{t('selection.settings.stages')}</h3>
          <p className="text-xs text-muted-foreground">{t('selection.settings.stagesHint')}</p>
          {config.stages.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto_auto_auto]" data-testid="stage-row">
              <Field label={t('selection.settings.key')} value={s.key} dir="ltr" onChange={(e) => patchStage(i, { key: e.target.value.trim().toLowerCase(), label: s.label.en || s.label.ar ? s.label : { en: humanizeKey(e.target.value), ar: '' } })} />
              <Field label="English" value={s.label.en} dir="ltr" onChange={(e) => patchStage(i, { label: { ...s.label, en: e.target.value } })} />
              <Field label="العربية" value={s.label.ar} dir="rtl" onChange={(e) => patchStage(i, { label: { ...s.label, ar: e.target.value } })} />
              <div className="space-y-1.5">
                <label htmlFor={`type-${i}`} className="block text-sm font-medium">{t('selection.settings.type')}</label>
                <select id={`type-${i}`} value={s.type} onChange={(e) => patchStage(i, { type: e.target.value })} className={selectCls}>
                  {STAGE_TYPES.map((ty) => <option key={ty} value={ty}>{t(`selection.settings.type.${ty}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`tone-${i}`} className="block text-sm font-medium">{t('selection.settings.tone')}</label>
                <select id={`tone-${i}`} value={s.tone} onChange={(e) => patchStage(i, { tone: e.target.value })} className={selectCls}>
                  {STAGE_TONES.map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`email-${i}`} className="block text-sm font-medium">{t('selection.settings.email')}</label>
                <select id={`email-${i}`} value={s.email ?? ''} onChange={(e) => patchStage(i, { email: e.target.value || null })} className={selectCls}>
                  <option value="">{t('selection.settings.emailNone')}</option>
                  {EMAIL_KEYS.map((k) => <option key={k} value={k}>{t(`selection.email.${k}`)}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.requireReason} onChange={(e) => patchStage(i, { requireReason: e.target.checked })} className="h-4 w-4" />{t('selection.settings.requireReason')}</label>
                <Button variant="ghost" size="icon" className="text-destructive" aria-label={`${t('selection.settings.removeStage')}: ${s.key}`} onClick={() => patch({ stages: config.stages.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            </div>
          ))}
          {errors.stages && <p className="text-xs text-destructive-text">{t(errors.stages)}</p>}
          <Button variant="outline" size="sm" onClick={() => patch({ stages: [...config.stages, { key: '', label: { en: '', ar: '' }, type: 'stage', tone: 'neutral', email: null, requireReason: false }] })}>{t('selection.settings.addStage')}</Button>
        </section>

        <section className="space-y-2" data-testid="settings-participants">
          <h3 className="text-sm font-semibold">{t('selection.settings.participants')}</h3>
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" checked={config.participantRule.onAccept === 'create_participant'} onChange={(e) => patch({ participantRule: { onAccept: e.target.checked ? 'create_participant' : 'none' } })} className="mt-1 h-4 w-4" data-testid="enroll-toggle" />
            <span>{t('selection.settings.enroll')}<span className="block text-xs text-muted-foreground">{t('selection.settings.enrollHint')}</span></span>
          </label>
        </section>

        <section className="space-y-2" data-testid="settings-booking">
          <h3 className="text-sm font-semibold">{t('selection.settings.booking')}</h3>
          <p className="text-xs text-muted-foreground">{t('selection.settings.bookingHint')}</p>
          {bookings.length === 0 ? <p className="text-xs text-muted-foreground">{t('selection.settings.bookingNone')}</p> : (
            <select aria-label={t('selection.settings.booking')} value={config.interviewBooking.linkedBookingNodeId ?? ''} onChange={(e) => patch({ interviewBooking: { linkedBookingNodeId: e.target.value || null } })} className={selectCls}>
              <option value="">{t('selection.settings.bookingAuto')}{connectedBooking ? `: ${pick(connectedBooking, 'name')}` : ''}</option>
              {bookings.map((b) => <option key={b.id} value={b.id}>{pick(b, 'name') || b.id}</option>)}
            </select>
          )}
        </section>

        <section className="space-y-2" data-testid="settings-card">
          <h3 className="text-sm font-semibold">{t('selection.settings.card')}</h3>
          <p className="text-xs text-muted-foreground">{t('selection.settings.cardHint')}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {CARD_FIELDS.map((f) => (
              <label key={f} className="flex min-h-9 items-center gap-2">
                <input type="checkbox" checked={config.card.showFields.includes(f)} onChange={(e) => toggleField(f, e.target.checked)} className="h-4 w-4" />
                {t(entityFieldLabelKey(f, 'company'))}
              </label>
            ))}
          </div>
          {errors.card && <p className="text-xs text-destructive-text">{t(errors.card)}</p>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('selection.settings.accent')}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="radio" name="accent" checked={!config.card.accent} onChange={() => patch({ card: { ...config.card, accent: null } })} className="h-4 w-4" />
                {t('selection.settings.accentNone')}
              </label>
              {PROFILE_COLORS.map((hex) => (
                <label key={hex} className="relative cursor-pointer">
                  <input type="radio" name="accent" value={hex} checked={config.card.accent === hex} onChange={() => patch({ card: { ...config.card, accent: hex } })} className="peer sr-only" aria-label={hex} />
                  <span aria-hidden="true" style={{ backgroundColor: hex }} className={`block h-8 w-8 rounded-full border-2 ${config.card.accent === hex ? 'border-foreground scale-110' : 'border-transparent'} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`} />
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {config.sheetImport?.url && <p className="text-xs text-muted-foreground" dir="ltr">{t('selection.settings.legacySheet')} {config.sheetImport.url}</p>}
      </div>
    </NodeFrame>
  )
}
