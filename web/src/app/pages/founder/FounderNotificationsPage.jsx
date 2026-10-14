import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, ExternalLink, MailOpen, Mail } from 'lucide-react'
import { useMyNotifications, useNotificationMutations } from '../../../data/founderNotifications.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { notificationTarget, notificationText } from '../../../lib/alumniFounder.js'
import { cn } from '../../../lib/cn.js'
import { ChipSelect } from '../../../shared/alumni/pickers.jsx'
import './alumni.i18n.js'
import './alumni.notifications.i18n.js'
import '../../../shared/alumni/i18n.js'

const PAGE = 30
const LONG = 220

/** One notification: unread ones are marked (a start-edge bar + a dot with a text alternative), the body expands, the linked item opens with one tap (and marks it read). */
function NotificationItem({ n, onToggle, busy }) {
  const { t, lang, formatDate } = useLanguage()
  const [open, setOpen] = useState(false)
  const target = notificationTarget(n)
  const text = notificationText(n, lang) // the viewing language when the broadcast carries both
  const long = String(text.body).length > LONG
  const markReadThenGo = () => { if (!n.is_read) onToggle(n, true) }
  return (
    <li className={cn('space-y-2 rounded-card border bg-card p-4', !n.is_read && 'border-s-4 border-s-primary')} data-testid="notification" data-unread={!n.is_read || undefined}>
      <div className="flex items-start justify-between gap-2">
        <h2 dir="auto" className="min-w-0 break-words text-base font-bold">
          {!n.is_read && <span className="me-2 inline-block h-2.5 w-2.5 rounded-full bg-primary align-middle" role="img" aria-label={t('alumni.founder.notifications.unread')} />}
          {text.title}
        </h2>
        <time dateTime={n.created_at} className="shrink-0 text-xs text-muted-foreground">{formatDate(n.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</time>
      </div>
      <p dir="auto" className={cn('whitespace-pre-line break-words text-sm', long && !open && 'line-clamp-3')}>{text.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {long && <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t('alumni.founder.notifications.less') : t('alumni.founder.notifications.more')}</Button>}
        {target?.kind === 'internal' && <Link to={target.to} onClick={markReadThenGo} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('alumni.founder.notifications.open')}</Link>}
        {target?.kind === 'external' && (
          <a href={target.href} target="_blank" rel="noopener noreferrer" onClick={markReadThenGo} className={buttonClass({ variant: 'outline', size: 'sm' })}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.notifications.open')}
          </a>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(n, !n.is_read)} className="ms-auto">
          {n.is_read ? <Mail className="h-4 w-4" aria-hidden="true" /> : <MailOpen className="h-4 w-4" aria-hidden="true" />}
          {n.is_read ? t('alumni.founder.notifications.markUnread') : t('alumni.founder.notifications.markRead')}
        </Button>
      </div>
    </li>
  )
}

/** /alumni/founder/notifications: the founder's inbox (design 09 F7). Newest first, All / Unread, mark one or all as read, open the linked item, an empty state, no socket (refetch on focus). */
export default function FounderNotificationsPage() {
  const { t, tn } = useLanguage()
  const toast = useToast()
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const q = useMyNotifications({ unreadOnly: filter === 'unread', limit })
  const { setRead, markAll } = useNotificationMutations()
  const rows = q.data?.rows ?? []
  const unreadShown = rows.filter((r) => !r.is_read).length

  async function toggle(n, read) {
    try {
      await setRead.mutateAsync({ id: n.id, read })
    } catch {
      toast.error(t('alumni.founder.notifications.failed'))
    }
  }
  async function readAll() {
    try {
      await markAll.mutateAsync()
      toast.success(t('alumni.founder.notifications.allRead'))
    } catch {
      toast.error(t('alumni.founder.notifications.failed'))
    }
  }

  return (
    <div className="space-y-4" data-testid="founder-notifications">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-section-title">{t('alumni.founder.notifications.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('alumni.founder.notifications.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" loading={markAll.isPending} disabled={unreadShown === 0 && filter === 'all'} onClick={readAll}>
          <CheckCheck className="h-4 w-4" aria-hidden="true" />
          {t('alumni.founder.notifications.markAll')}
        </Button>
      </div>
      <ChipSelect
        label={t('alumni.founder.notifications.show')}
        options={[{ value: 'all', label: t('alumni.founder.notifications.filterAll') }, { value: 'unread', label: t('alumni.founder.notifications.filterUnread') }]}
        value={filter}
        onChange={(v) => { setFilter(v); setLimit(PAGE) }}
      />
      {q.isPending ? (
        <SkeletonList count={2} className="space-y-3" itemClassName="h-24 w-full" />
      ) : q.error ? (
        <ErrorState error={q.error} title={t('alumni.founder.notifications.loadFailed')} onRetry={q.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Bell} title={filter === 'unread' ? t('alumni.founder.notifications.emptyUnread') : t('alumni.founder.notifications.empty')} body={filter === 'unread' ? undefined : t('alumni.founder.notifications.emptyBody')} />
      ) : (
        <>
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            {unreadShown > 0 && <Badge tone="blue">{tn('alumni.founder.notifications.unreadCount', unreadShown)}</Badge>}
          </p>
          <ul className="space-y-3">
            {rows.map((n) => <NotificationItem key={n.id} n={n} onToggle={toggle} busy={setRead.isPending} />)}
          </ul>
          {q.data?.hasMore && <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>{t('alumni.founder.notifications.showMore')}</Button>}
        </>
      )}
    </div>
  )
}
