import { History } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'
import { useEditText } from './useEditText.js'
import './i18n.edit.js'

/**
 * "Last edited by <the Athar team | a founder | a name> on <date>" for ONE section or row (owner decision 20.4: every row shows its last-modified date and who changed it).
 * `stamp` = `{ at, source, name? }` (from `get_alumni_stamps`, or a row's `updated_at` / `updated_source`); `audience` 'manager' shows names, 'founder' only the kind of editor.
 * Nothing is rendered without a stamp unless `showNone` (a section the log has no entry for yet: data that predates the history).
 */
export default function StampLine({ stamp, audience = 'founder', showNone = false, className, testId }) {
  const { t } = useLanguage()
  const e = useEditText()
  if (!stamp?.at) {
    return showNone ? <p className={cn('text-xs text-muted-foreground', className)} data-testid={testId}>{t('alumni.edit.stamp.none')}</p> : null
  }
  return (
    <p className={cn('flex flex-wrap items-center gap-1 text-xs text-muted-foreground', className)} data-testid={testId ?? 'stamp-line'} data-source={stamp.source}>
      <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t('alumni.edit.stamp.line', { who: e.who(stamp, audience), date: e.dateTime(stamp.at) })}</span>
    </p>
  )
}
