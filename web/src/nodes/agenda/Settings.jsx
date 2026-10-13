import { useMemo, useState } from 'react'
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
import { useAgendaLink, useAgendaMutations, useProjectPageLink } from '../../data/agenda.js'
import { PROFILE_COLORS, VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import TabsEditor from './TabsEditor.jsx'
import { normalizeAgendaConfig, sortTabs, tabPatches } from './agendaLogic.js'

function LinkRow({ url, pending, onCreate, onCopy, testId, lang, t }) {
  if (!url) return <Button size="sm" variant="outline" loading={pending} onClick={onCreate} data-testid={testId}>{t('agenda.settings.createLink')}</Button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{url}</code>
      <Button size="sm" variant="outline" onClick={() => onCopy(url)}><Copy className="h-4 w-4" aria-hidden="true" />{t('agenda.settings.copyLink')}</Button>
      <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('agenda.settings.openLink')}</a>
    </div>
  )
}

/**
 * Settings mode (design 01 section 3.1 / 02 section 4.2): name (tab title + founder button label), visibility,
 * show-to-participants, display (day names, accent), the TAB BAR of this agenda's page (per-edge label override, order,
 * enabled, audience: edges into the `tabs` port; the Agenda owns this configuration, not the contributors) and, when the
 * agenda is itself a tab of the implicit project page, that page's tab bar too; public links (own page + project page).
 * ONE explicit Save: node columns + config in one save_node call, then the changed tab edges through update_edge.
 */
export default function AgendaSettings() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeAgendaConfig(raw), [raw])
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const [edits, setEdits] = useState({})
  const [busy, setBusy] = useState(false)

  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])
  const host = useMemo(() => (graph?.nodes ?? []).find((n) => n.type === 'view_host') ?? null, [graph])
  const edges = useMemo(() => graph?.edges ?? [], [graph])
  const ownTabs = useMemo(() => edges.filter((e) => e.to_node_id === node.id && e.to_port === 'tabs'), [edges, node.id])
  const onHost = useMemo(() => Boolean(host) && edges.some((e) => e.from_node_id === node.id && e.from_port === 'agenda' && e.to_node_id === host.id && e.to_port === 'tabs'), [edges, host, node.id])
  const hostTabs = useMemo(() => (host ? edges.filter((e) => e.to_node_id === host.id && e.to_port === 'tabs') : []), [edges, host])
  const link = useAgendaLink(node.id)
  const projectLink = useProjectPageLink(projectId, host?.id ?? null, { enabled: onHost })
  const m = useAgendaMutations(node.id, projectId, { onChanged: () => invalidateNodeOutputs(qc, graph, node.id, projectId) })

  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const patches = useMemo(() => tabPatches([...ownTabs, ...hostTabs], edits), [edits, ownTabs, hostTabs])
  const dirty = configDirty || fieldsDirty || patches.length > 0

  const onEdit = (edgeId, patch) => setEdits((cur) => ({ ...cur, [edgeId]: { ...(cur[edgeId] ?? {}), ...patch } }))
  const onReorder = (ids) => setEdits((cur) => { const next = { ...cur }; ids.forEach((id, i) => { next[id] = { ...(next[id] ?? {}), order_index: i } }); return next })
  const patch = (p) => setConfig({ ...config, ...p })

  async function onSave() {
    setBusy(true)
    try {
      const r = await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants })
      if (!r.ok) return
      if (patches.length) {
        try {
          await m.updateTabs.mutateAsync({ patches })
          setEdits({})
        } catch {
          toast.error(t('agenda.settings.tabsFailed'))
          return
        }
      }
      toast.success(t('agenda.settings.saved'))
    } finally {
      setBusy(false)
    }
  }

  const url = link.data?.slug ? buildPublicUrl('agenda', canonicalRef({ slug: link.data.slug, id: node.id })) : null
  const projectUrl = projectLink.data?.slug ? buildPublicUrl('agenda', projectLink.data.slug) : null
  async function copy(u) {
    try { await navigator.clipboard.writeText(u); toast.success(t('agenda.settings.copied')) } catch { toast.info(u) }
  }

  return (
    <NodeFrame dirty={dirty} saving={saving || busy} onSave={onSave}>
      <div className="space-y-6" data-testid="agenda-settings">
        <BilingualField label={t('agenda.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('agenda.settings.visibility')}</legend>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} />
              {t(`agenda.settings.visibility.${v}`)}
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} data-testid="show-to-participants" />
            <span>{t('agenda.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('agenda.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="space-y-2" data-testid="settings-display">
          <h3 className="text-sm font-semibold">{t('agenda.settings.display')}</h3>
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={config.showDayNames} onChange={(e) => patch({ showDayNames: e.target.checked })} />{t('agenda.settings.showDayNames')}</label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('agenda.settings.accent')}</legend>
            <p className="text-xs text-muted-foreground">{t('agenda.settings.accentHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="radio" name="accent" checked={!config.theme.accent} onChange={() => patch({ theme: { ...config.theme, accent: null } })} />
                {t('agenda.settings.accentNone')}
              </label>
              {PROFILE_COLORS.map((hex) => (
                <label key={hex} className="relative cursor-pointer">
                  <input type="radio" name="accent" value={hex} checked={config.theme.accent === hex} onChange={() => patch({ theme: { ...config.theme, accent: hex } })} className="peer sr-only" aria-label={hex} />
                  <span aria-hidden="true" style={{ backgroundColor: hex }} className={`block h-8 w-8 rounded-full border-2 ${config.theme.accent === hex ? 'scale-110 border-foreground' : 'border-transparent'} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`} />
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="space-y-2" data-testid="settings-tabs">
          <h3 className="text-sm font-semibold">{t('agenda.settings.tabs')}</h3>
          <p className="text-xs text-muted-foreground">{t('agenda.settings.tabsHint')}</p>
          <TabsEditor edges={ownTabs} nodesById={nodesById} edits={edits} onEdit={onEdit} onReorder={onReorder} />
        </section>

        {onHost && (
          <section className="space-y-2" data-testid="settings-host-tabs">
            <h3 className="text-sm font-semibold">{t('agenda.settings.hostTabs')}</h3>
            <p className="text-xs text-muted-foreground">{t('agenda.settings.hostTabsHint')}</p>
            <TabsEditor edges={sortTabs(hostTabs, {})} nodesById={nodesById} edits={edits} onEdit={onEdit} onReorder={onReorder} lockedFirstId={node.id} />
          </section>
        )}

        <section className="space-y-2" data-testid="settings-link">
          <h3 className="text-sm font-semibold">{t('agenda.settings.link')}</h3>
          <p className="text-xs text-muted-foreground">{t('agenda.settings.linkHint')}</p>
          <LinkRow url={url} pending={m.ensureLink.isPending || link.isPending} onCreate={() => m.ensureLink.mutateAsync().catch((e) => toast.error(t(e?.messageKey ?? 'errors.unknown')))} onCopy={copy} testId="create-link" lang={lang} t={t} />
        </section>

        {onHost && (
          <section className="space-y-2" data-testid="settings-project-link">
            <h3 className="text-sm font-semibold">{t('agenda.settings.projectLink')}</h3>
            <p className="text-xs text-muted-foreground">{t('agenda.settings.projectLinkHint')}</p>
            <LinkRow url={projectUrl} pending={m.ensureProjectLink.isPending || projectLink.isPending} onCreate={() => m.ensureProjectLink.mutateAsync({ hostId: host?.id ?? null }).catch((e) => toast.error(t(e?.messageKey ?? 'errors.unknown')))} onCopy={copy} testId="create-project-link" lang={lang} t={t} />
          </section>
        )}
      </div>
    </NodeFrame>
  )
}
