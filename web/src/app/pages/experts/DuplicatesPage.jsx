import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Copy } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useDuplicatePairs, useExpertActions } from '../../../data/people.js'
import { displayName } from '../../../lib/experts.js'
import './experts.i18n.js'
import { ExpertLine, ReasonChips } from './parts.jsx'
import { errorText, useExpertsBase } from './hooks.js'

const MergeDialog = lazy(() => import('./MergeDialog.jsx'))

/**
 * The probable duplicate PAIRS of the whole registry (super_admin): the same LinkedIn profile or e-mail, the same name, a Latin and an Arabic spelling of one name, a very similar name.
 * "Compare and merge" opens the merge dialog on that pair; "Not the same person" hides the pair for good (it is remembered). Nothing here changes a record by itself.
 */
export default function DuplicatesPage() {
  const { t, tn, lang, formatNumber } = useLanguage()
  const toast = useToast()
  const base = useExpertsBase()
  const q = useDuplicatePairs()
  const actions = useExpertActions()
  const [merging, setMerging] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft

  async function dismiss(pair) {
    setBusyKey(`${pair.a.id}:${pair.b.id}`)
    try {
      await actions.dismiss.mutateAsync({ a: pair.a.id, b: pair.b.id })
      toast.success(t('experts.dup.dismissed'))
    } catch (e) {
      toast.error(errorText(t, e))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-5" data-testid="experts-duplicates">
      <Link to={base} className={buttonClass({ variant: 'ghost', size: 'sm', className: '-ms-3' })}>
        <BackIcon className="h-4 w-4" aria-hidden="true" />
        {t('experts.back')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-section-title">{t('experts.duplicates.title')}</h1>
        <p className="max-w-2xl text-base text-muted-foreground">{t('experts.duplicates.subtitle')}</p>
      </header>

      {q.isPending ? (
        <SkeletonList count={4} itemClassName="h-28 w-full" />
      ) : q.isError ? (
        <ErrorState error={q.error} title={t('experts.loadFailed')} onRetry={() => q.refetch()} />
      ) : q.data.pairs.length === 0 ? (
        <EmptyState icon={Check} title={t('experts.duplicates.empty.title')} body={t('experts.duplicates.empty.body')} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {tn('experts.duplicates.count', q.data.pairs.length)}
            {q.data.dismissed > 0 && ` · ${t('experts.duplicates.dismissed', { count: formatNumber(q.data.dismissed) })}`}
          </p>
          <ul className="space-y-3" data-testid="duplicate-pairs">
            {q.data.pairs.map((pair) => {
              const key = `${pair.a.id}:${pair.b.id}`
              return (
                <li key={key} className="space-y-3 rounded-card border bg-card p-4" data-testid="duplicate-pair">
                  <div className="grid gap-3 md:grid-cols-2">
                    <ExpertLine expert={pair.a} to={`${base}/${pair.a.id}`} />
                    <ExpertLine expert={pair.b} to={`${base}/${pair.b.id}`} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ReasonChips reasons={pair.reasons} />
                      <span className="text-xs text-muted-foreground tabular-nums">{t('experts.duplicates.score', { score: formatNumber(Math.round(pair.score * 100)) })}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setMerging(pair)} aria-label={`${t('experts.duplicates.merge')}: ${displayName(pair.a, lang)} / ${displayName(pair.b, lang)}`} data-testid="duplicate-merge">
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        {t('experts.duplicates.merge')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => dismiss(pair)} loading={busyKey === key} data-testid="duplicate-dismiss">{t('experts.duplicates.notSame')}</Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {merging && (
        <Suspense fallback={null}>
          <MergeDialog pair={merging} base={base} onClose={() => setMerging(null)} />
        </Suspense>
      )}
    </div>
  )
}
