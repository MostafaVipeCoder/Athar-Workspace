import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { cn } from '../../lib/cn.js'
import { VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl } from '../../lib/links.js'
import { useDistributionLinks, useDistributionMutations, useDistributionPayload } from '../../data/distribution.js'
import { normalizeDistConfig } from './distributionLogic.js'

/**
 * Settings mode (design 01 section 3.7): name ar/en, visibility private / platform / public, show-to-participants (the founder phone view),
 * timer alert + sounds (node config), the publish flag (a node is invisible to visitors until published; the DB enforces it) and the two
 * public links, Matrix and Live. ONE explicit Save = node columns + config in one save_node. Publishing and link creation are immediate
 * (they never touch the configuration: as-is BUG-1 reset config columns on publish).
 */
export default function DistributionSettings() {
  const { node } = useNodeContext()
  const { t } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeDistConfig(raw), [raw])
  // what the user typed (normalizeDistConfig clamps: validation and the input must see the raw value)
  const timer = { ...config.timer, ...(raw?.timer ?? {}) }
  const payload = useDistributionPayload(node.id)
  const links = useDistributionLinks(node.id)
  const mutations = useDistributionMutations(node.id)
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const [errors, setErrors] = useState({})
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty
  const published = Boolean(payload.data?.published)

  async function onSave() {
    const alert = Number(timer.alertSeconds)
    if (!(alert >= 1 && alert <= 30)) {
      setErrors({ alert: 'distribution.settings.alertInvalid' })
      return
    }
    setErrors({})
    await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants })
  }
  async function togglePublish() {
    try {
      await mutations.setPublished.mutateAsync(!published)
      toast.success(t(published ? 'distribution.timetable.unpublished' : 'distribution.timetable.published'))
    } catch (e) { toast.error(t(e?.messageKey ?? 'errors.unknown')) }
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); toast.success(t('distribution.settings.copied')) } catch { toast.info(url) }
  }

  if (payload.isPending) return <NodeFrame showSave={false}><Loading /></NodeFrame>
  if (payload.error) return <NodeFrame showSave={false}><ErrorState error={payload.error} onRetry={payload.refetch} /></NodeFrame>

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6" data-testid="distribution-settings">
        <BilingualField label={t('distribution.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('distribution.settings.visibility')}</legend>
          <p className="text-xs text-muted-foreground">{t('distribution.settings.visibilityHint')}</p>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} className="h-4 w-4" />
              {t(`distribution.settings.visibility.${v}`)}
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} className="mt-1 h-4 w-4" data-testid="show-to-participants" />
            <span>{t('distribution.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('distribution.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="space-y-2" data-testid="settings-publish">
          <h3 className="text-sm font-semibold">{t('distribution.settings.publish')}</h3>
          <p className="text-xs text-muted-foreground">{t('distribution.settings.publishHint')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={published ? 'green' : 'neutral'} data-testid="publish-status">{t(published ? 'distribution.published' : 'distribution.draft')}</Badge>
            <Button variant={published ? 'outline' : 'primary'} size="sm" onClick={togglePublish} loading={mutations.setPublished.isPending} data-testid="settings-publish-toggle">{published ? t('distribution.timetable.unpublish') : t('distribution.timetable.publish')}</Button>
          </div>
        </section>

        <section className="space-y-3" data-testid="settings-timer">
          <h3 className="text-sm font-semibold">{t('distribution.settings.timer')}</h3>
          <p className="text-xs text-muted-foreground">{t('distribution.settings.timerHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('distribution.settings.alert')} type="number" min="1" max="30" dir="ltr" value={timer.alertSeconds} onChange={(e) => setConfig({ ...config, timer: { ...timer, alertSeconds: e.target.value === '' ? '' : Number(e.target.value) } })} error={errors.alert && t(errors.alert)} data-testid="settings-alert" />
            <label className="flex min-h-11 items-center gap-2 self-end text-sm">
              <input type="checkbox" className="h-4 w-4" checked={timer.sounds} onChange={(e) => setConfig({ ...config, timer: { ...timer, sounds: e.target.checked } })} data-testid="settings-sounds" />
              {t('distribution.settings.sounds')}
            </label>
          </div>
        </section>

        <section className="space-y-3" data-testid="settings-links">
          <h3 className="text-sm font-semibold">{t('distribution.settings.links')}</h3>
          <p className="text-xs text-muted-foreground">{t('distribution.settings.linksHint')}</p>
          {['matrix', 'live'].map((key) => {
            const link = links.data?.[key]
            const url = link?.slug ? buildPublicUrl('view', link.slug, { viewKey: key }) : null
            return (
              <div key={key} className="space-y-1.5" data-testid={`link-${key}`}>
                <p className="text-sm font-medium">{t(`distribution.settings.link.${key}`)}</p>
                {url ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{url}</code>
                    <Button size="sm" variant="outline" onClick={() => copy(url)}><Copy className="h-4 w-4" aria-hidden="true" />{t('distribution.settings.copy')}</Button>
                    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(buttonClass({ variant: 'outline', size: 'sm' }))}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('distribution.settings.open')}</a>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => mutations.ensureLink.mutate(key)} loading={mutations.ensureLink.isPending && mutations.ensureLink.variables === key} data-testid={`create-link-${key}`}>{t('distribution.settings.createLink')}</Button>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </NodeFrame>
  )
}
