import { useMemo } from 'react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useListItems } from '../../data/lists.js'
import { ErrorState, Loading } from '../../ui/States.jsx'
import ResultsTab from './ResultsTab.jsx'
import { normalizeSelectionConfig } from './selectionConfig.js'

/** View mode = the PM preview of the results tab (accepted applicants) through the SAME component a host renders. */
export default function SelectionView() {
  const { node } = useNodeContext()
  const { t, pick } = useLanguage()
  const config = useMemo(() => normalizeSelectionConfig(node.config), [node.config])
  const items = useListItems(node.id, { filter: { status: config.passing }, kind: 'company' })
  return (
    <NodeFrame>
      <p className="mb-4 text-sm text-muted-foreground">{t('selection.view.preview')}</p>
      {items.isPending ? <Loading /> : items.error ? <ErrorState error={items.error} onRetry={items.refetch} /> : (
        <ResultsTab items={items.data ?? []} config={config} title={pick(node, 'name')} audience="pm" />
      )}
    </NodeFrame>
  )
}
