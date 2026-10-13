import { useMemo } from 'react'
import { ExternalLink, Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useLibraryDefinition, useLibraryLink } from '../../data/library.js'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import LibraryTab from './LibraryTab.jsx'
import { normalizeLibraryConfig } from './libraryLogic.js'

/** View mode (PM preview, design 06 4.3): the library exactly as the tab renders it, through the SAME component (hidden shown with a badge). */
export default function LibraryView() {
  const { node } = useNodeContext()
  const { t, lang, pick } = useLanguage()
  const def = useLibraryDefinition(node.id)
  const link = useLibraryLink(node.id)
  const config = useMemo(() => normalizeLibraryConfig(node.config), [node.config])
  const url = link.data?.slug ? buildPublicUrl('view', canonicalRef({ slug: link.data.slug, id: node.id }), { viewKey: 'library-tab' }) : null
  const actions = url ? (
    <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
      <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('library.view.openPage')}
    </a>
  ) : <span className="text-xs text-muted-foreground">{t('library.view.noLink')}</span>

  return (
    <NodeFrame actions={actions}>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('library.view.preview')}
      </p>
      {def.error ? (
        <ErrorState error={def.error} onRetry={def.refetch} />
      ) : def.isPending ? (
        <Loading />
      ) : (
        <LibraryTab resources={def.data.resources} categories={def.data.categories} config={config} title={pick(node, 'name')} audience="pm" />
      )}
    </NodeFrame>
  )
}
