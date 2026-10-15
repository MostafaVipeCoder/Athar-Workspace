import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { useAlumniHistory } from '../../data/alumni.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { ErrorState, SkeletonList } from '../../ui/States.jsx'
import HistoryEntries from './HistoryEntries.jsx'
import './i18n.edit.js'

const STEP = 50

/**
 * The history of the YEARLY FIGURES of one company (owner decision 20.4: every edit of these numbers is kept): who changed which figure and when, newest first. A founder sees it for his
 * own company without names (only "the Athar team" / "a founder of the company"); a manager sees names. Loaded only when opened (nothing is fetched for a page nobody asks it on).
 */
export default function FiguresHistory({ companyId, audience = 'founder', className }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(STEP)
  const params = useMemo(() => ({ filters: { company_id: companyId, entity_type: 'snapshot' }, limit, offset: 0 }), [companyId, limit])
  const q = useAlumniHistory(params, { enabled: open && Boolean(companyId) })
  const rows = q.data?.rows ?? []
  return (
    <div className={className} data-testid="figures-history">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <History className="h-4 w-4" aria-hidden="true" />
        {open ? t('alumni.edit.figures.hide') : t('alumni.edit.figures.open')}
      </Button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">{t('alumni.edit.figures.intro')}</p>
          {q.isPending ? <SkeletonList count={3} itemClassName="h-14 w-full" />
            : q.isError ? <ErrorState error={q.error} title={t('alumni.edit.figures.loadFailed')} onRetry={() => q.refetch()} />
            : (
              <>
                <HistoryEntries rows={rows} audience={audience} showPerson={false} />
                {(q.data?.total ?? 0) > rows.length && <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + STEP)}>{t('alumni.edit.figures.more')}</Button>}
              </>
            )}
        </div>
      )}
    </div>
  )
}
