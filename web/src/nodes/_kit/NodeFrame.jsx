import { Button } from '../../ui/Button.jsx'
import { NodeIcon } from '../../ui/iconMap.jsx'
import { useNodeContext } from './NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'

/**
 * Standard header + save bar for Edit pages: status chip (saved / unsaved), explicit Save button.
 * `showSave=false` for editors whose writes are row-level saves (list items) instead of a config draft; `actions` is a
 * slot in the header (buttons), `subtitle` replaces the default "type - mode - rev" line.
 */
export default function NodeFrame({ children, dirty = false, saving = false, onSave, className, showSave = true, actions = null, subtitle = null, bodyClassName }) {
  const { node, manifest, mode } = useNodeContext()
  const { t, pick, pickLiteral } = useLanguage()
  return (
    <section className={cn('rounded-card border bg-card', className)} data-testid="node-frame">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-4 sm:px-panel-pad">
        <NodeIcon name={manifest.icon} className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{pick(node, 'name') || pickLiteral(manifest.name)}</h2>
          <p className="text-xs text-muted-foreground">
            {subtitle ?? <>{pickLiteral(manifest.name)} - {t(`node.${mode}`)} - {t('project.rev', { rev: node.rev ?? 0 })}</>}
          </p>
        </div>
        {actions}
        {(mode === 'edit' || mode === 'settings') && showSave && (
          <>
            <span className={cn('rounded-full px-2 py-0.5 text-xs', dirty ? 'bg-accent font-semibold text-accent-foreground' : 'bg-surface text-muted-foreground')} role="status">
              {dirty ? t('node.dirty') : t('node.clean')}
            </span>
            <Button size="sm" onClick={onSave} disabled={!dirty} loading={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        )}
      </header>
      <div className={cn('p-4 sm:p-panel-pad', bodyClassName)}>{children}</div>
    </section>
  )
}
