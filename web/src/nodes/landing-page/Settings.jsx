import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { useLandingLink, useLandingMutations } from '../../data/landing.js'
import { publicImageUrl, publicThumbUrl, removeImage, uploadImage } from '../../data/storage.js'
import { VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl } from '../../lib/links.js'
import { normalizeLandingConfig } from './landingLogic.js'

/**
 * Settings mode (design 01 section 3.9): name (tab title + founder button label), visibility (public by design) + show-to-participants,
 * the link-preview data (SEO title / description / share image, bilingual; kept in the config until an OG renderer exists), the analytics
 * switch and the public link (`/view/<slug>/landing`, created on demand). ONE explicit Save = node columns + config in one save_node call
 * (the cards / frames are not touched: they belong to the Edit screen).
 */
export default function LandingSettings() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = normalizeLandingConfig(raw)
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const link = useLandingLink(node.id)
  const m = useLandingMutations(node.id)
  const uploaded = useRef(new Set())
  const savedImage = useRef(normalizeLandingConfig(node.config).seo.imagePath)

  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty
  const patch = (key, p) => setConfig({ ...config, [key]: { ...config[key], ...p } })

  async function onSave() {
    const r = await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants })
    if (!r.ok) return
    // a replaced / removed share image (and uploads that were never kept) are deleted once the save went through
    const keep = config.seo.imagePath
    const drop = [...new Set([savedImage.current, ...uploaded.current])].filter((p) => p && p !== keep)
    await Promise.all(drop.map((p) => removeImage(p).catch(() => {})))
    savedImage.current = keep
    uploaded.current.clear()
    await invalidateNodeOutputs(qc, graph, node.id, projectId)
    toast.success(t('landing.settings.saved'))
  }

  const url = link.data?.slug ? buildPublicUrl('view', link.data.slug, { viewKey: 'landing' }) : null
  async function copy(u) {
    try { await navigator.clipboard.writeText(u); toast.success(t('landing.settings.copied')) } catch { toast.info(u) }
  }

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6" data-testid="landing-settings">
        <BilingualField label={t('landing.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('landing.settings.visibility')}</legend>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} />
              {t(`landing.settings.visibility.${v}`)}
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} data-testid="show-to-participants" />
            <span>{t('landing.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('landing.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="space-y-3" data-testid="settings-seo">
          <div>
            <h3 className="text-sm font-semibold">{t('landing.settings.seo')}</h3>
            <p className="text-xs text-muted-foreground">{t('landing.settings.seoHint')}</p>
          </div>
          <BilingualField label={t('landing.settings.seoTitle')} value={config.seo.title} onChange={(title) => patch('seo', { title })} />
          <BilingualField label={t('landing.settings.seoDescription')} value={config.seo.description} onChange={(description) => patch('seo', { description })} as="textarea" rows={2} />
          <ImageField
            label={t('landing.settings.seoImage')}
            profile="landing"
            src={config.seo.imagePath ? publicImageUrl(config.seo.imagePath) : ''}
            thumb={config.seo.imagePath ? publicThumbUrl(config.seo.imagePath) : ''}
            aspect="1200 / 630"
            onFile={async (file) => {
              const path = await uploadImage(file, { ownerId: projectId, kind: 'landing' })
              uploaded.current.add(path)
              patch('seo', { imagePath: path })
            }}
            onClear={() => patch('seo', { imagePath: '' })}
            labels={{ choose: t('landing.settings.seoImageChoose'), replace: t('landing.card.coverReplace'), remove: t('landing.card.coverRemove'), hint: t('landing.settings.seoImageHint') }}
            errorText={(code) => t(code === 'upload' ? 'landing.edit.err.upload' : `errors.${code}`)}
          />
        </section>

        <section className="space-y-2" data-testid="settings-analytics">
          <h3 className="text-sm font-semibold">{t('landing.settings.analytics')}</h3>
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={config.analytics.enabled} onChange={(e) => patch('analytics', { enabled: e.target.checked })} data-testid="analytics-enabled" />
            <span>{t('landing.settings.analyticsEnabled')}<span className="block text-xs text-muted-foreground">{t('landing.settings.analyticsHint')}</span></span>
          </label>
        </section>

        <section className="space-y-2" data-testid="settings-link">
          <h3 className="text-sm font-semibold">{t('landing.settings.link')}</h3>
          <p className="text-xs text-muted-foreground">{t('landing.settings.linkHint')}</p>
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs" data-testid="public-url">{url}</code>
              <Button size="sm" variant="outline" onClick={() => copy(url)}><Copy className="h-4 w-4" aria-hidden="true" />{t('landing.settings.copyLink')}</Button>
              <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('landing.settings.openLink')}</a>
            </div>
          ) : (
            <Button size="sm" variant="outline" loading={m.ensureLink.isPending || link.isPending} onClick={() => m.ensureLink.mutateAsync().catch((e) => toast.error(t(e?.messageKey ?? 'errors.unknown')))} data-testid="create-link">{t('landing.settings.createLink')}</Button>
          )}
        </section>
      </div>
    </NodeFrame>
  )
}
