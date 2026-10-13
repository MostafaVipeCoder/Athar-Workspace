import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useListItems, useListMeta } from '../../data/lists.js'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { normalizeListConfig } from './listConfig.js'
import ListTab from './ListTab.jsx'

/** View mode (PM preview, design 06 4.3): the list exactly as the tab renders it, through the same component. */
export default function ListView() {
  const { node } = useNodeContext()
  const { t, pick } = useLanguage()
  const meta = useListMeta(node.id)
  const kind = meta.data?.subkind ?? 'generic'
  const items = useListItems(node.id, { kind }, { enabled: meta.isSuccess })
  const config = useMemo(() => normalizeListConfig(node.config), [node.config])

  return (
    <NodeFrame>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('list.view.preview')}
      </p>
      {meta.error || items.error ? (
        <ErrorState error={meta.error ?? items.error} onRetry={() => { meta.refetch(); items.refetch() }} />
      ) : meta.isPending || items.isPending ? (
        <Loading />
      ) : (
        <ListTab items={items.data} config={config} kind={kind} title={pick(node, 'name')} audience="pm" />
      )}
    </NodeFrame>
  )
}
