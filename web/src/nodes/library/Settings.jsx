import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { useLibraryLink, useLibraryMutations } from '../../data/library.js'
import { VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { GROUP_BY, LAYOUTS, normalizeLibraryConfig } from './libraryLogic.js'

/**
 * Settings mode (design 01 section 3.8): name (tab title + founder block title), visibility, show-to-participants, the display
 * (layout grid/list, grouping, search) and the public link of the library's own page. ONE explicit Save: node columns +
 * config in the same save_node call (the resources are saved by Edit).
 */
export default function LibrarySettings() {
  const { node } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeLibraryConfig(raw), [raw])
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const link = useLibraryLink(node.id)
  const m = useLibraryMutations(node.id)
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty
  const patch = (p) => setConfig({ ...config, ...p })

  async function onSave() {
    await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants })
  }
  const url = link.data?.slug ? buildPublicUrl('view', canonicalRef({ slug: link.data.slug, id: node.id }), { viewKey: 'library-tab' }) : null
  async function copy(u) {
    try { await navigator.clipboard.writeText(u); toast.success(t('library.settings.copied')) } catch { toast.info(u) }
  }

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6" data-testid="library-settings">
        <BilingualField label={t('library.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('library.settings.visibility')}</legend>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-start gap-2 text-sm">
              <input type="radio" className="mt-1" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} />
              <span>{t(`library.settings.visibility.${v}`)}<span className="block text-xs text-muted-foreground">{t(`library.settings.visibility.${v}.hint`)}</span></span>
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} data-testid="show-to-participants" />
            <span>{t('library.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('library.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="space-y-3" data-testid="settings-display">
          <h3 className="text-sm font-semibold">{t('library.settings.display')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('library.settings.layout')} as="select" value={config.layout} onChange={(e) => patch({ layout: e.target.value })} data-testid="layout">
              {LAYOUTS.map((x) => <option key={x} value={x}>{t(`library.layout.${x}`)}</option>)}
            </Field>
            <Field label={t('library.settings.groupBy')} as="select" value={config.groupBy} onChange={(e) => patch({ groupBy: e.target.value })} hint={t('library.settings.groupByHint')} data-testid="group-by">
              {GROUP_BY.map((x) => <option key={x} value={x}>{t(`library.groupBy.${x}`)}</option>)}
            </Field>
          </div>
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={config.searchEnabled} onChange={(e) => patch({ searchEnabled: e.target.checked })} data-testid="search-enabled" />{t('library.settings.search')}</label>
        </section>

        <section className="space-y-2" data-testid="settings-link">
          <h3 className="text-sm font-semibold">{t('library.settings.link')}</h3>
          <p className="text-xs text-muted-foreground">{t('library.settings.linkHint')}</p>
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{url}</code>
              <Button size="sm" variant="outline" onClick={() => copy(url)}><Copy className="h-4 w-4" aria-hidden="true" />{t('library.settings.copyLink')}</Button>
              <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('library.settings.openLink')}</a>
            </div>
          ) : (
            <Button size="sm" variant="outline" loading={m.ensureLink.isPending || link.isPending} onClick={() => m.ensureLink.mutateAsync().catch((e) => toast.error(t(e?.messageKey ?? 'errors.unknown')))} data-testid="create-link">{t('library.settings.createLink')}</Button>
          )}
        </section>
      </div>
    </NodeFrame>
  )
}
