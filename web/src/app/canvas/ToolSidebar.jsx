import { useMemo, useState } from 'react'
import { ChevronDown, GripVertical, Plus } from 'lucide-react'
import { registry } from '../../nodes/registry.js'
import { NodeIcon } from '../../ui/iconMap.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { sidebarGroups, TOOL_MIME } from './canvasModel.js'

/**
 * Tool library built from the registry (grouped by category, searchable, bilingual; presets expanded). Two ways to add
 * (design 06 3.1): drag an item onto the canvas (HTML5 drag, desktop) or tap "+" (adds at the viewport centre; the only
 * path on touch). On phones the list collapses under a toggle so the canvas keeps the screen.
 * In RTL the page's flex order puts this sidebar on the right automatically (first child, logical direction).
 */
export default function ToolSidebar({ onAdd }) {
  const { t, pickLiteral } = useLanguage()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => sidebarGroups(registry, term), [term])

  function onDragStart(e, item) {
    e.dataTransfer.setData(TOOL_MIME, item.key)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside aria-label={t('project.library')} className="flex flex-col gap-3 border-b bg-background p-3 md:w-72 md:shrink-0 md:border-b-0 md:border-e" data-testid="tool-sidebar">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('project.library')}</h2>
          <p className="text-xs text-muted-foreground">{t('project.libraryHint')}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="tool-sidebar-list"
          className="tap-target inline-flex items-center justify-center rounded-md border md:hidden"
          aria-label={t('project.library')}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <div id="tool-sidebar-list" className={cn('flex-col gap-3', open ? 'flex' : 'hidden', 'md:flex')}>
        <SearchBar value={term} onChange={setTerm} label={t('project.searchTools')} />
        {groups.length === 0 ? (
          <EmptyState title={t('project.noTools')} />
        ) : (
          groups.map((g) => (
            <section key={g.category} aria-label={t(`node.category.${g.category}`)}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`node.category.${g.category}`)}</h3>
              <ul className="space-y-1">
                {g.items.map((item) => (
                  <li
                    key={item.key}
                    draggable={Boolean(onAdd)}
                    onDragStart={(e) => onDragStart(e, item)}
                    data-testid={`tool-${item.key}`}
                    title={t('canvas.dragHint')}
                    className="flex cursor-grab items-center gap-2 rounded-input border border-border bg-card p-2 transition-colors duration-300 hover:border-foreground/40 active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    <NodeIcon name={item.manifest.icon} className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm">{pickLiteral(item.name)}</span>
                    <button
                      type="button"
                      disabled={!onAdd}
                      onClick={() => onAdd?.(item)}
                      aria-label={t('canvas.add', { name: pickLiteral(item.name) })}
                      className="tap-target -my-2 inline-flex items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-surface enabled:hover:text-primary disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
