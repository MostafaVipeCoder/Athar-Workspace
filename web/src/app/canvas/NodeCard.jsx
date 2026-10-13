import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { NodeIcon } from '../../ui/iconMap.jsx'
import { cn } from '../../lib/cn.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { familyColor } from './canvasModel.js'

const HANDLE = { width: 14, height: 14, border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,.15)' }

/**
 * Registry-driven node card (design 06 3.3): icon, name, status chips, one <Handle> per port. Port convention is graph
 * semantics, not text direction: inputs on the LEFT, outputs on the RIGHT in both languages (the canvas is dir=ltr);
 * only the card's text follows the UI direction. Memoised: React Flow re-renders every node on viewport changes.
 */
function NodeCardInner({ data, selected }) {
  const { t, pick, pickLiteral, dir } = useLanguage()
  const { node, manifest, rev, status = 'saved', incomplete = [], flash = false } = data
  const name = pick(node, 'name') || pickLiteral(manifest?.name) || node.type
  const inputs = manifest?.ports.in ?? []
  const outputs = manifest?.ports.out ?? []
  const rows = Math.max(inputs.length, outputs.length, 1)

  return (
    <div
      dir={dir}
      data-testid={`canvas-node-${node.id}`}
      className={cn(
        'w-60 rounded-input border-2 bg-card text-card-foreground transition-[box-shadow,border-color] duration-fast',
        selected ? 'border-foreground shadow-dropdown' : 'border-border',
        node.is_system && 'border-dashed bg-surface',
        flash && 'ring-2 ring-accent',
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <NodeIcon name={manifest?.icon} className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        {node.is_system && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t('canvas.systemNode')} />}
        {status === 'saving' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-label={t('canvas.statusUnsaved')} />}
        {status === 'error' && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label={t('canvas.statusError')} />}
        {status === 'saved' && incomplete.length > 0 && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive-text" aria-label={t('canvas.incomplete')} />
        )}
      </div>
      <div className="px-1 py-1 text-xs text-muted-foreground">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="truncate">{manifest ? pickLiteral(manifest.name) : node.type}</span>
          {rev != null && <span className="shrink-0 tabular-nums">{t('project.rev', { rev })}</span>}
        </div>
        {/* port rows: the handle sits on the card edge of its row (left for inputs, right for outputs, LTR frame) */}
        <div dir="ltr" className="grid grid-cols-2 gap-x-2">
          <ul className="space-y-1">
            {inputs.map((p) => (
              <li key={p.key} className="relative flex min-h-6 items-center ps-3 pe-1" title={p.families.join(', ')}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={p.key}
                  style={{ ...HANDLE, background: familyColor(p.families[0]), left: -9 }}
                  aria-label={`${pickLiteral(p.label)} (${t('canvas.inputs')})`}
                />
                <span dir={dir} className={cn('truncate', p.required && !data.connectedIn?.has(p.key) && 'text-destructive-text')}>{pickLiteral(p.label)}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-end">
            {outputs.map((p) => (
              <li key={p.key} className="relative flex min-h-6 items-center justify-end ps-1 pe-3" title={p.families.join(', ')}>
                <span dir={dir} className="truncate">{pickLiteral(p.label)}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={p.key}
                  style={{ ...HANDLE, background: familyColor(p.families[0]), right: -9 }}
                  aria-label={`${pickLiteral(p.label)} (${t('canvas.outputs')})`}
                />
              </li>
            ))}
          </ul>
        </div>
        {rows === 0 && <div className="h-2" />}
      </div>
    </div>
  )
}

export const NodeCard = memo(NodeCardInner)
export default NodeCard
