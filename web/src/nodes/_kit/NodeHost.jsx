import { Suspense, useMemo } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary.jsx'
import { ErrorState, Skeleton } from '../../ui/States.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { MODES } from '../manifest.contract.js'
import { registry as defaultRegistry } from '../registry.js'
import { dbNodeAdapter } from '../../data/canvas.js'
import { NodeContext } from './NodeContext.js'
import UnsupportedNode from './UnsupportedNode.jsx'
import { useSavedStateRefresh } from './useSavedStateRefresh.js'

function NodeSkeleton() {
  return (
    <div className="space-y-3 p-3" aria-hidden="true">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/**
 * The only place that knows about lazy loading, error isolation and the loading skeleton (design 06 section 4.3).
 *  - unknown type, or a node newer than the client (type_version > manifest.version): UnsupportedNode, never a crash;
 *  - the component for (type, mode) is React.lazy, memoised in the registry;
 *  - a failing node is caught by its own ErrorBoundary (reset when node id or mode change), the page around it lives;
 *  - while mounted it keeps the project's revision poll running so saved-state refresh works for every mounted node.
 *
 * Props: mode 'edit'|'view'|'settings', node {id,type,type_version,name_en,name_ar,config,rev}, graph {nodes,edges},
 * projectId, adapter (default: DB), registry (default: app registry).
 */
export default function NodeHost({ mode, node, graph = null, projectId = node?.project_id ?? null, adapter = dbNodeAdapter, registry = defaultRegistry }) {
  const { t, lang } = useLanguage()
  const manifest = registry.get(node?.type)

  useSavedStateRefresh({ projectId, adapter, enabled: Boolean(manifest) })

  const config = useMemo(() => {
    if (!manifest) return node?.config ?? {}
    const from = node.type_version ?? 1
    return manifest.migrateConfig && from < manifest.version ? manifest.migrateConfig(node.config ?? {}, from) : (node.config ?? {})
  }, [manifest, node])

  const effectiveNode = useMemo(() => ({ ...node, config }), [node, config])
  const ctx = useMemo(
    () => ({ node: effectiveNode, manifest, mode, projectId, graph, adapter, registry, lang }),
    [effectiveNode, manifest, mode, projectId, graph, adapter, registry, lang],
  )

  if (!node || !manifest || (node.type_version ?? 1) > manifest.version || !MODES.includes(mode)) {
    return <UnsupportedNode node={node} />
  }

  const Component = registry.getComponent(node.type, mode)
  return (
    <NodeContext.Provider value={ctx}>
      <ErrorBoundary
        name={`node:${node.type}:${mode}`}
        resetKeys={[node.id, mode]}
        fallback={({ error, reset }) => (
          <div data-testid="node-error">
            <ErrorState title={t('errors.nodeTitle')} body={`${t('errors.nodeBody')} (${error?.message ?? ''})`} />
            <div className="mt-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={reset}>
                {t('common.retry')}
              </Button>
            </div>
          </div>
        )}
      >
        <Suspense fallback={<NodeSkeleton />}>
          {/* eslint-disable-next-line react-hooks/static-components -- lazy component memoised per (type, mode) in the registry: stable identity */}
          <Component />
        </Suspense>
      </ErrorBoundary>
    </NodeContext.Provider>
  )
}

