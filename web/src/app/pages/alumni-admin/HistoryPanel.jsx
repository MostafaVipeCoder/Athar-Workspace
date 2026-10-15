import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useAlumniHistory } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { HISTORY_ENTITIES } from '../../../lib/alumniHistoryState.js'
import { cn } from '../../../lib/cn.js'
import HistoryEntries from '../../../shared/alumni/HistoryEntries.jsx'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import AsOfPanel from './AsOfPanel.jsx'
import './i18n.common.js'
import './history.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

const STEP = 30

/**
 * The timeline of ONE company inside the company page and the directory drawer (owner decision 20.4): its latest changes with who / when / old / new, a filter by area, "show older",
 * a link to the full history page with this company chosen, and the company at a date. Loaded only when the section is shown.
 */
export default function HistoryPanel({ companyId, className }) {
  const { t, tn } = useLanguage()
  const h = (k, v) => t(`alumni.admin.hist.${k}`, v)
  const e = useEditText()
  const [area, setArea] = useState('')
  const [limit, setLimit] = useState(STEP)
  const [asOf, setAsOf] = useState(false)
  const params = useMemo(() => ({ filters: { company_id: companyId, ...(area ? { entity_type: area } : {}) }, limit, offset: 0 }), [companyId, area, limit])
  const q = useAlumniHistory(params, { enabled: Boolean(companyId) })
  const rows = q.data?.rows ?? []
  return (
    <div className={cn('space-y-4', className)} data-testid="history-panel">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={`hp-area-${companyId}`} className="block text-sm font-medium text-athar-ink">{h('area')}</label>
          <select id={`hp-area-${companyId}`} className={cn(SELECT_CLASS, 'min-h-11 w-auto')} value={area} onChange={(ev) => { setArea(ev.target.value); setLimit(STEP) }}>
            <option value="">{h('anyArea')}</option>
            {HISTORY_ENTITIES.map((a) => <option key={a} value={a}>{e.entityLabel(a)}</option>)}
          </select>
        </div>
        <Button variant={asOf ? 'secondary' : 'outline'} size="sm" aria-expanded={asOf} onClick={() => setAsOf((v) => !v)} data-testid="asof-toggle">{h('asOfTitle')}</Button>
        <Link to={`/alumni/admin/history?company_id=${encodeURIComponent(companyId)}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}><ExternalLink className="h-4 w-4" aria-hidden="true" />{h('title')}</Link>
      </div>
      {asOf && <div className="rounded-card border bg-surface/40 p-4"><AsOfPanel companyId={companyId} /></div>}
      {q.isPending ? <SkeletonList count={3} itemClassName="h-16 w-full" />
        : q.isError ? <ErrorState error={q.error} title={h('loadFailed')} onRetry={() => q.refetch()} />
        : rows.length === 0 ? <p className="text-sm text-muted-foreground">{h('empty')}. {h('emptyBody')}</p>
        : (
          <>
            <p className="text-sm font-semibold" aria-live="polite">{tn('alumni.admin.hist.count', q.data.total)}</p>
            <HistoryEntries rows={rows} audience="manager" showCompany={false} />
            {q.data.total > rows.length && <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + STEP)}>{t('alumni.edit.figures.more')}</Button>}
          </>
        )}
    </div>
  )
}
