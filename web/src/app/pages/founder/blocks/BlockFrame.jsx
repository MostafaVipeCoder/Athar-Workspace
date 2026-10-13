import { Suspense } from 'react'
import { AlertCircle } from 'lucide-react'
import { ErrorBoundary } from '../../../../ui/ErrorBoundary.jsx'
import { Button } from '../../../../ui/Button.jsx'
import { Skeleton } from '../../../../ui/States.jsx'
import { useLanguage } from '../../../../i18n/LanguageProvider.jsx'
import '../i18n.js'

/** Loading placeholder of a block (reserved height: the page does not jump when a block resolves). */
export function BlockSkeleton({ lines = 2 }) {
  return (
    <div className="space-y-2" role="status" aria-busy="true" data-testid="block-skeleton">
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={i === 0 ? 'h-16 w-full' : 'h-10 w-2/3'} />)}
    </div>
  )
}

/** A block that failed to load: its own message + retry, the rest of the page keeps working (per-block error isolation). */
export function BlockError({ onRetry }) {
  const { t } = useLanguage()
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="block-error">
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive-text" aria-hidden="true" />
      <p className="min-w-0 flex-1">{t('founder.block.error')}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>{t('founder.block.retry')}</Button>}
    </div>
  )
}

/** Renders the state of a block query: skeleton, error with retry, or the children once data exists. */
export function QueryBlock({ query, children, skeletonLines }) {
  if (query.isPending) return <BlockSkeleton lines={skeletonLines} />
  if (query.error) return <BlockError onRetry={query.refetch} />
  return children
}

/**
 * One section of the Program page: anchor + heading + an error boundary (a render crash stays inside the section) + Suspense
 * (the lazy block chunk shows the skeleton).
 */
export default function BlockFrame({ id, type, title, subtitle, icon: Icon, children }) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-40 space-y-3" data-testid={`block-${type}`}>
      <div className="space-y-0.5">
        <h2 id={headingId} className="flex items-center gap-2 text-section-title">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <ErrorBoundary name={`founder-block-${type}`} fallback={({ reset }) => <BlockError onRetry={reset} />}>
        <Suspense fallback={<BlockSkeleton />}>{children}</Suspense>
      </ErrorBoundary>
    </section>
  )
}
