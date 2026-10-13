import { useEffect, useState } from 'react'
import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from './Button.jsx'
import { useLanguage } from '../i18n/LanguageProvider.jsx'

/** Spinner with a localised label and a "slow network" hint after 8 s (design 06 section 13.1). */
export function Loading({ label, fullScreen = false, className }) {
  const { t } = useLanguage()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(id)
  }, [])
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3 p-8 text-muted-foreground', fullScreen && 'min-h-dvh', className)}
    >
      <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
      {slow && <span className="text-xs">{t('common.slowNetwork')}</span>}
    </div>
  )
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-input bg-surface', className)} />
}

export function EmptyState({ title, body, icon: Icon = Inbox, action, className }) {
  const { t } = useLanguage()
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-card border border-dashed border-input bg-surface/60 p-8 text-center', className)}>
      <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-display text-lg font-bold">{title ?? t('common.empty')}</p>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  )
}

/** `error` may be an AppError: its messageKey is translated; `onRetry` is shown only when it helps. */
export function ErrorState({ error, title, body, onRetry, className }) {
  const { t } = useLanguage()
  const message = body ?? (error?.messageKey ? t(error.messageKey) : t('errors.unknown'))
  const canRetry = onRetry && (error?.retryable ?? true)
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 rounded-card border border-destructive/40 bg-destructive/5 p-8 text-center', className)}>
      <AlertCircle className="h-8 w-8 text-destructive-text" aria-hidden="true" />
      {title && <p className="font-display text-lg font-bold">{title}</p>}
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {canRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
