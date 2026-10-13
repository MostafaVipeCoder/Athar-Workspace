import { useMemo, useState } from 'react'
import { createMemoryAdapter } from '../../nodes/_kit/memoryAdapter.js'
import NodeHost from '../../nodes/_kit/NodeHost.jsx'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

const PROJECT = 'dev-project'
const A = 'note-a'
const B = 'note-b'

/**
 * DEV ONLY (/dev/nodes). Proves lazy loading, the three modes, error isolation, input-port reading and
 * saved-state refresh with the throwaway Note node and an in-memory adapter. Writes nothing to the database.
 * Graph: A --text--> B. Edit A and Save: B (view mode) updates; "external save" simulates another session (30 s poll / focus).
 */
export default function DevNodesPage() {
  const { pickLiteral } = useLanguage()
  const [mode, setMode] = useState('edit')
  const adapter = useMemo(
    () =>
      createMemoryAdapter({
        latencyMs: 40,
        nodes: [
          { id: A, project_id: PROJECT, type: 'note', type_version: 1, name_en: 'Note A', name_ar: 'ملاحظة أ', config: { text: 'hello from A' } },
          { id: B, project_id: PROJECT, type: 'note', type_version: 1, name_en: 'Note B', name_ar: 'ملاحظة ب', config: { text: 'I read A' } },
        ],
        edges: [{ from_node_id: A, from_port: 'text', to_node_id: B, to_port: 'text-in', is_enabled: true }],
      }),
    [],
  )
  const graph = useMemo(
    () => ({
      nodes: [{ id: A, type: 'note' }, { id: B, type: 'note' }, { id: 'ghost', type: 'future_type' }],
      edges: [{ from_node_id: A, from_port: 'text', to_node_id: B, to_port: 'text-in', is_enabled: true }],
    }),
    [],
  )
  const nodeA = useQuery({ queryKey: ['node', A, 'row'], queryFn: () => adapter.getNode(A) })
  const nodeB = useQuery({ queryKey: ['node', B, 'row'], queryFn: () => adapter.getNode(B) })
  const [ext, setExt] = useState(1)

  return (
    <div className="space-y-4" data-testid="dev-nodes">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-bold">Dev: Note node playground</h1>
        {['edit', 'view', 'settings'].map((m) => (
          <Button key={m} size="sm" variant={m === mode ? 'primary' : 'outline'} onClick={() => setMode(m)}>
            {m}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            adapter.externalSave(A, { text: `changed by another session #${ext}` })
            setExt((n) => n + 1)
          }}
        >
          External save of A
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{pickLiteral({ en: 'Edit A, press Save, then look at B (view mode): it refreshes.', ar: 'عدّل أ ثم احفظ وشاهد ب (وضع العرض): يتحدّث تلقائياً.' })}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>{nodeA.data && <NodeHost mode={mode} node={nodeA.data} graph={graph} projectId={PROJECT} adapter={adapter} />}</div>
        <div>{nodeB.data && <NodeHost mode="view" node={nodeB.data} graph={graph} projectId={PROJECT} adapter={adapter} />}</div>
        <div className="md:col-span-2">
          <p className="mb-1 text-xs text-muted-foreground">Unknown node type (host must not crash):</p>
          <NodeHost mode="view" node={{ id: 'ghost', type: 'future_type', type_version: 1, name_en: 'Ghost node' }} graph={graph} projectId={PROJECT} adapter={adapter} />
        </div>
      </div>
    </div>
  )
}
