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
import { ImageField } from '../../ui/ImageField.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { useFormDefinition, useFormLink, useFormMutations } from '../../data/forms.js'
import { publicImageUrl, publicThumbUrl, uploadImage } from '../../data/storage.js'
import { VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { dateInTz, resolveTimeZone, timeInTz, toInstant } from '../../lib/time/tz.js'
import { SOCIAL_PLATFORMS, normalizeFormConfig } from './formLogic.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const toLocal = (iso, tz) => (iso ? `${dateInTz(iso, tz)}T${timeInTz(iso, tz)}` : '')
const fromLocal = (s, tz) => { if (!s) return null; const [d, tm] = s.split('T'); return toInstant(d, tm || '00:00', tz)?.toISOString() ?? null }

/**
 * Settings mode (design 01 section 3.2 `access` + visibility): name, who can open it, open/closed + schedule in the
 * PROJECT timezone, limits, PM notification, link preview + share channels + custom sources, Google Sheet append
 * (queued job only), the public link. ONE explicit Save: node columns + config + the `forms` row in one save_node call.
 */
export default function FormSettings() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeFormConfig(raw), [raw])
  const def = useFormDefinition(node.id)
  const link = useFormLink(node.id)
  const { ensureLink } = useFormMutations(node.id, projectId)
  const tz = resolveTimeZone(graph?.project?.timezone)
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private' })
  const [formBase, setFormBase] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)

  const loaded = useMemo(() => (def.data ? { is_active: def.data.form.is_active, opens_at: def.data.form.opens_at, closes_at: def.data.form.closes_at, max_responses: def.data.form.max_responses, one_response_per_email: def.data.form.one_response_per_email, export_sheet_id: def.data.form.export_sheet_id ?? '', export_sheet_tab: def.data.form.export_sheet_tab ?? '' } : null), [def.data])
  const formDirty = form && formBase && !same(form, formBase)
  if (loaded && (!formBase || (!same(loaded, formBase) && !formDirty))) {
    setFormBase(loaded)
    setForm(loaded)
  }
  const f = form ?? loaded
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private')
  const dirty = configDirty || fieldsDirty || Boolean(formDirty)
  const patch = (p) => setConfig({ ...config, ...p })
  const patchForm = (p) => setForm((cur) => ({ ...(cur ?? loaded), ...p }))

  async function onSave() {
    setError(null)
    if (f.opens_at && f.closes_at && new Date(f.closes_at) <= new Date(f.opens_at)) { setError(t('form.settings.scheduleInvalid')); return }
    const children = { form: { is_active: f.is_active, opens_at: f.opens_at, closes_at: f.closes_at, max_responses: f.max_responses === '' || f.max_responses === null ? null : Number(f.max_responses), one_response_per_email: f.one_response_per_email, export_sheet_id: f.export_sheet_id?.trim() || null, export_sheet_tab: f.export_sheet_tab?.trim() || null } }
    const r = await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility }, { children })
    if (r.ok) {
      setFormBase(f)
      setForm(f)
      toast.success(t('form.settings.saved'))
    }
  }
  const url = link.data?.slug ? buildPublicUrl('form', canonicalRef({ slug: link.data.slug, id: node.id })) : null
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast.success(t('form.settings.copied')) } catch { toast.info(url) }
  }

  if (def.isPending || !f) return <NodeFrame showSave={false}><Loading /></NodeFrame>
  if (def.error) return <NodeFrame showSave={false}><ErrorState error={def.error} onRetry={def.refetch} /></NodeFrame>

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6" data-testid="form-settings">
        <BilingualField label={t('form.settings.name')} value={fields.name} onChange={(name) => setFields((x) => ({ ...x, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('form.settings.visibility')}</legend>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((x) => ({ ...x, visibility: v }))} className="h-4 w-4" />
              {t(`form.settings.visibility.${v}`)}
            </label>
          ))}
        </fieldset>

        <section className="space-y-3" data-testid="settings-access">
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(f.is_active)} onChange={(e) => patchForm({ is_active: e.target.checked })} data-testid="is-active" />
            <span>{t('form.settings.open')}<span className="block text-xs text-muted-foreground">{t('form.settings.openHint')}</span></span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('form.settings.opensAt')} type="datetime-local" dir="ltr" value={toLocal(f.opens_at, tz)} onChange={(e) => patchForm({ opens_at: fromLocal(e.target.value, tz) })} />
            <Field label={t('form.settings.closesAt')} type="datetime-local" dir="ltr" value={toLocal(f.closes_at, tz)} onChange={(e) => patchForm({ closes_at: fromLocal(e.target.value, tz) })} error={error} />
          </div>
          <p className="text-xs text-muted-foreground">{t('form.settings.scheduleHint', { tz })}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('form.settings.maxResponses')} type="number" min="1" dir="ltr" value={f.max_responses ?? ''} onChange={(e) => patchForm({ max_responses: e.target.value === '' ? null : Number(e.target.value) })} hint={t('form.settings.maxResponsesHint')} />
            <label className="flex min-h-11 items-start gap-2 self-end text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(f.one_response_per_email)} onChange={(e) => patchForm({ one_response_per_email: e.target.checked })} />
              <span>{t('form.settings.oneResponsePerEmail')}<span className="block text-xs text-muted-foreground">{t('form.settings.oneResponsePerEmailHint')}</span></span>
            </label>
          </div>
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={config.notify_pm} onChange={(e) => patch({ notify_pm: e.target.checked })} data-testid="notify-pm" />
            <span>{t('form.settings.notifyPm')}<span className="block text-xs text-muted-foreground">{t('form.settings.notifyPmHint')}</span></span>
          </label>
        </section>

        <section className="space-y-2" data-testid="settings-link">
          <h3 className="text-sm font-semibold">{t('form.settings.link')}</h3>
          <p className="text-xs text-muted-foreground">{t('form.settings.linkHint')}</p>
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{url}</code>
              <Button size="sm" variant="outline" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" />{t('form.settings.copyLink')}</Button>
              <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('form.settings.openLink')}</a>
            </div>
          ) : (
            <Button size="sm" variant="outline" loading={ensureLink.isPending || link.isPending} onClick={() => ensureLink.mutateAsync().catch((e) => toast.error(t(e?.messageKey ?? 'errors.unknown')))} data-testid="create-link">{t('form.settings.createLink')}</Button>
          )}
        </section>

        <section className="space-y-3" data-testid="settings-share">
          <h3 className="text-sm font-semibold">{t('form.settings.share')}</h3>
          <p className="text-xs text-muted-foreground">{t('form.settings.shareHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('form.settings.shareTitle')} value={config.share.title} onChange={(e) => patch({ share: { ...config.share, title: e.target.value } })} />
            <Field label={t('form.settings.shareDescription')} value={config.share.description} onChange={(e) => patch({ share: { ...config.share, description: e.target.value } })} />
          </div>
          <ImageField label={t('form.settings.shareImage')} src={config.share.image_path ? publicImageUrl(config.share.image_path) : null} thumb={config.share.image_path ? publicThumbUrl(config.share.image_path) : null} aspect="1.91 / 1" className="max-w-sm"
            labels={{ choose: t('image.choose'), replace: t('image.replace'), remove: t('image.remove'), hint: t('image.hint') }} errorText={(p) => t(`errors.image.${p}`)}
            onFile={async (file) => { const path = await uploadImage(file, { ownerId: projectId, kind: 'og' }); patch({ share: { ...config.share, image_path: path } }) }}
            onClear={() => patch({ share: { ...config.share, image_path: null } })} />
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('form.settings.channels')}</legend>
            <p className="text-xs text-muted-foreground">{t('form.settings.channelsHint')}</p>
            <div className="flex flex-wrap gap-2">
              {SOCIAL_PLATFORMS.map((p) => (
                <label key={p} className="flex min-h-9 items-center gap-1 rounded-md border px-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={config.social[p]} onChange={(e) => patch({ social: { ...config.social, [p]: e.target.checked } })} />{t(`form.social.${p}`)}</label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('form.settings.customChannels')}</p>
            {config.social.custom.map((c, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <Field label={t('form.settings.customKey')} dir="ltr" value={c.key} onChange={(e) => patch({ social: { ...config.social, custom: config.social.custom.map((x, j) => (j === i ? { ...x, key: e.target.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') } : x)) } })} />
                <Field label={t('form.settings.customLabel')} value={c.label} onChange={(e) => patch({ social: { ...config.social, custom: config.social.custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })} />
                <label className="flex min-h-11 items-center gap-1 self-end text-sm"><input type="checkbox" className="h-4 w-4" checked={c.active} onChange={(e) => patch({ social: { ...config.social, custom: config.social.custom.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)) } })} />{t('canvas.enabled')}</label>
                <Button variant="ghost" size="icon" className="self-end text-destructive" aria-label={`${t('form.settings.removeChannel')}: ${c.key}`} onClick={() => patch({ social: { ...config.social, custom: config.social.custom.filter((_, j) => j !== i) } })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => patch({ social: { ...config.social, custom: [...config.social.custom, { key: '', label: '', active: true }] } })}>{t('form.settings.addChannel')}</Button>
          </div>
        </section>

        <section className="space-y-2" data-testid="settings-sheet">
          <h3 className="text-sm font-semibold">{t('form.settings.sheet')}</h3>
          <p className="text-xs text-muted-foreground">{t('form.settings.sheetHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('form.settings.sheetId')} dir="ltr" value={f.export_sheet_id ?? ''} onChange={(e) => patchForm({ export_sheet_id: e.target.value })} />
            <Field label={t('form.settings.sheetTab')} dir="ltr" value={f.export_sheet_tab ?? ''} onChange={(e) => patchForm({ export_sheet_tab: e.target.value })} />
          </div>
        </section>
      </div>
    </NodeFrame>
  )
}
