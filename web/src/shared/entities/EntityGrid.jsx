import { Users } from 'lucide-react'
import './i18n.js'
import { EntityCard } from './EntityCard.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'

/**
 * Responsive card grid (1 column on phones, 2 from sm, 3 from lg). One card is centred and fully expanded (as-is
 * ExpertViewer rule). `cards` = [{ key, entity, show, badges?, actions? }]. Presentational; the caller owns data.
 */
export function EntityGrid({ cards, accent, expandable = true, emptyTitle, emptyBody, className, dense = false }) {
  if (!cards?.length) return <EmptyState icon={Users} title={emptyTitle} body={emptyBody} />
  const single = cards.length === 1
  return (
    <ul className={cn('grid gap-4', single ? (dense ? 'grid-cols-1' : 'mx-auto max-w-md grid-cols-1') : dense ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', className)} data-testid="entity-grid">
      {cards.map((c) => (
        <li key={c.key} className="min-w-0">
          <EntityCard entity={c.entity} show={c.show} badges={c.badges} actions={c.actions} accent={accent} expandable={expandable} forceExpanded={single && !dense} dense={dense} muted={c.muted} />
        </li>
      ))}
    </ul>
  )
}
export default EntityGrid
