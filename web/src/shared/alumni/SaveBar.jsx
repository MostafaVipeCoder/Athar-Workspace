import { Save, Undo2 } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { cn } from '../../lib/cn.js'
import './i18n.js'

/**
 * The explicit Save of a long form: a bar above the bottom tabs that appears while there are unsaved changes ("N changes"), with Undo (back to the saved values) and Save.
 * `count` = the number of changed fields; `saveLabel` overrides "Save" (e.g. "Create company"). Nothing is saved by typing: a half-typed profile never reaches the registry.
 */
export default function SaveBar({ visible, count = 0, busy = false, onSave, onUndo, saveLabel, className, undoDisabled = false }) {
  const { t, tn } = useLanguage()
  if (!visible) return null
  return (
    <div
      role="region"
      aria-label={t('alumni.common.saveBar')}
      data-testid="save-bar"
      className={cn('fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-background/95 backdrop-blur animate-in fade-in slide-in-from-bottom-2', className)}
    >
      <div className="mx-auto flex max-w-container-narrow items-center gap-2 px-4 py-2">
        <p className="min-w-0 flex-1 text-sm font-medium" role="status">{count > 0 ? tn('alumni.common.unsaved', count) : t('alumni.common.readyToSave')}</p>
        {onUndo && (
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={busy || undoDisabled}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {t('alumni.common.undo')}
          </Button>
        )}
        <Button size="sm" onClick={onSave} loading={busy}>
          <Save className="h-4 w-4" aria-hidden="true" />
          {saveLabel ?? t('common.save')}
        </Button>
      </div>
    </div>
  )
}
