import { Link } from 'react-router-dom'
import { CircleCheck, Info, TriangleAlert } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'
import { useGoogleStatus } from '../../data/google.js'
import { ltr, senderState } from '../../lib/google.js'

const STYLE = {
  mine: { box: 'bg-success/10 text-foreground', icon: CircleCheck, iconClass: 'text-success-text' },
  fallback: { box: 'bg-surface text-foreground', icon: Info, iconClass: 'text-primary' },
  fallbackReconnect: { box: 'bg-accent/40 text-foreground', icon: TriangleAlert, iconClass: 'text-accent-foreground' },
  none: { box: 'bg-accent/40 text-foreground', icon: TriangleAlert, iconClass: 'text-accent-foreground' },
  noneReconnect: { box: 'bg-destructive/10 text-foreground', icon: TriangleAlert, iconClass: 'text-destructive-text' },
}

/**
 * The REAL connection state of the acting user inside a node's Settings / E-mails tab (it replaces the old "not connected" placeholder):
 * which Google account will send the e-mails (scope "email") or hold the calendar events (scope "calendar"), with a link to Profile > Google
 * account when the user can do something about it. Read-only; the status comes from get_google_connection_status (metadata only).
 */
export function SenderNotice({ scope = 'email', className }) {
  const { t } = useLanguage()
  const status = useGoogleStatus()
  if (status.isPending) return <p role="status" className={cn('text-xs text-muted-foreground', className)} data-testid="sender-notice-loading">{t('google.notice.loading')}</p>
  if (status.isError) return <p role="status" className={cn('text-xs text-muted-foreground', className)} data-testid="sender-notice-error">{t('google.notice.error')}</p>
  const s = senderState(status.data)
  const style = STYLE[s.kind] ?? STYLE.none
  const Icon = style.icon
  const action = s.kind === 'mine' ? null : s.kind === 'fallbackReconnect' || s.kind === 'noneReconnect' ? 'reconnect' : 'connect'
  return (
    <div role="status" className={cn('flex items-start gap-2 rounded-md p-3 text-sm', style.box, className)} data-testid="sender-notice" data-kind={s.kind}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} aria-hidden="true" />
      <div className="space-y-1">
        <p>{t(`google.notice.${s.kind}.${scope === 'calendar' ? 'calendar' : 'email'}`, { email: ltr(s.email) })}</p>
        <Link to="/profile" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t(action ? `google.notice.action.${action}` : 'google.notice.action.manage')}
        </Link>
      </div>
    </div>
  )
}

export default SenderNotice
