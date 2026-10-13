import { useMemo } from 'react'
import { ExternalLink, Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useAgendaDefinition, useAgendaLink } from '../../data/agenda.js'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { resolveTimeZone } from '../../lib/time/tz.js'
import AgendaTab from './AgendaTab.jsx'
import { fromDayRow, normalizeAgendaConfig } from './agendaLogic.js'

/** View mode (PM preview, design 06 4.3): the agenda tab through the SAME component the public page renders. */
export default function AgendaView() {
  const { node, graph } = useNodeContext()
  const { t, lang, pick } = useLanguage()
  const def = useAgendaDefinition(node.id)
  const link = useAgendaLink(node.id)
  const config = useMemo(() => normalizeAgendaConfig(node.config), [node.config])
  const days = useMemo(() => (def.data ? def.data.days.map((d) => fromDayRow(d, d.slots)) : []), [def.data])
  const tz = resolveTimeZone(graph?.project?.timezone)
  const url = link.data?.slug ? buildPublicUrl('agenda', canonicalRef({ slug: link.data.slug, id: node.id })) : null
  const actions = url ? (
    <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
      <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('agenda.view.openPage')}
    </a>
  ) : <span className="text-xs text-muted-foreground">{t('agenda.view.noLink')}</span>

  return (
    <NodeFrame actions={actions}>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('agenda.view.preview')}
      </p>
      {def.error ? (
        <ErrorState error={def.error} onRetry={def.refetch} />
      ) : def.isPending ? (
        <Loading />
      ) : (
        <AgendaTab days={days} config={config} timezone={tz} title={pick(node, 'name')} audience="pm" />
      )}
    </NodeFrame>
  )
}
