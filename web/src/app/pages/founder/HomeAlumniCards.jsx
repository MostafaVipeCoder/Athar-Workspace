import { Link } from 'react-router-dom'
import { Bell, Building2, Handshake, TrendingUp, UserRound } from 'lucide-react'
import { useMyAlumniProfile } from '../../../data/alumni.js'
import { useUnreadNotifications } from '../../../data/founderNotifications.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Skeleton } from '../../../ui/States.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { overallCompleteness } from '../../../lib/alumniProgress.js'
import { badgeCount } from '../../../lib/badge.js'
import { CompletenessMeter } from '../../../shared/alumni/blocks.jsx'
import './alumni.i18n.js'
import './alumni.home.i18n.js'
import '../../../shared/alumni/i18n.js'

const tile = 'flex min-h-16 items-center gap-3 rounded-card border bg-card p-3 text-start transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The Alumni part of the founder Home (design 09 F9): how complete the profile is with the one next thing to do, the "yearly figures are due" reminder, the unread count and the
 * shortcuts to Progress / Opportunities. The shortcuts never depend on a query. The summary block shows a skeleton while it loads and, when it FAILS, one quiet line with a retry
 * (it used to vanish without a word); a failed unread count just hides its badge (the programs below are the page).
 */
export default function HomeAlumniCards() {
  const { t, pick } = useLanguage()
  const profile = useMyAlumniProfile({ meta: { silent: true }, retry: false })
  const unread = useUnreadNotifications()
  const data = profile.data
  const overall = data ? overallCompleteness(data) : null
  const companies = data?.companies ?? []
  const dueFor = companies.filter((c) => c.completeness?.missing?.includes('annual_update'))
  const count = badgeCount(unread.data)

  // the one next step: the profile, then a company, then the company's missing items, then the yearly figures
  let next = null
  if (data) {
    if ((data.founder?.completeness?.percent ?? 100) < 100) next = { to: '/alumni/founder/profile', text: t('alumni.founder.home.nextProfile') }
    else if (companies.length === 0) next = { to: '/alumni/founder/company/new', text: t('alumni.founder.home.nextCompany') }
    else {
      const open = companies.find((c) => c.completeness?.missing?.filter((k) => k !== 'annual_update').length > 0)
      if (open) next = { to: `/alumni/founder/company/${open.id}`, text: t('alumni.founder.home.nextCompanyFill', { company: pick(open, 'name') }) }
      else if (dueFor.length > 0) next = { to: `/alumni/founder/company/${dueFor[0].id}#metrics`, text: t('alumni.founder.home.nextFigures', { company: pick(dueFor[0], 'name') }) }
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="home-alumni" data-testid="home-alumni">
      <h2 id="home-alumni" className="text-card-title">{t('alumni.founder.home.title')}</h2>
      {profile.isPending && <Skeleton className="h-24 w-full" />}
      {profile.isError && (
        <p className="flex flex-wrap items-center gap-2 rounded-card border bg-surface p-3 text-sm text-muted-foreground" role="status" data-testid="home-alumni-failed">
          <span className="min-w-0 flex-1">{t('alumni.founder.home.loadFailed')}</span>
          <Button variant="outline" size="sm" onClick={() => profile.refetch()}>{t('common.retry')}</Button>
        </p>
      )}
      {data && overall !== null && (
        <div className="space-y-3 rounded-card border bg-card p-4">
          <CompletenessMeter title={t('alumni.founder.home.completeness')} percent={overall} missing={[]} />
          {next && <Link to={next.to} className={buttonClass({ variant: 'primary', size: 'sm', className: 'w-full sm:w-auto' })} data-testid="home-next-step"><UserRound className="h-4 w-4" aria-hidden="true" />{next.text}</Link>}
        </div>
      )}
      {dueFor.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-card border border-accent bg-accent/20 p-3 text-sm" data-testid="annual-due">
          <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('alumni.founder.home.figuresDue')}</span>
          <Link to={`/alumni/founder/company/${dueFor[0].id}#metrics`} className="font-semibold text-primary underline-offset-4 hover:underline">{t('alumni.founder.home.addFigures')}</Link>
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {companies.slice(0, 2).map((c) => (
          <li key={c.id}><Link to={`/alumni/founder/company/${c.id}`} className={tile}><Building2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 break-words font-semibold">{pick(c, 'name')}</span><Badge tone="outline">{c.completeness?.percent ?? 0}%</Badge></Link></li>
        ))}
        <li>
          <Link to="/alumni/founder/notifications" className={tile}>
            <Bell className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 font-semibold">{t('nav.notifications')}</span>
            {count && <Badge tone="red" data-testid="home-unread">{t('nav.unreadCount', { count: unread.data })}</Badge>}
          </Link>
        </li>
        <li><Link to="/alumni/founder/opportunities" className={tile}><Handshake className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 font-semibold">{t('nav.opportunities')}</span></Link></li>
        <li><Link to="/alumni/founder/progress" className={tile}><TrendingUp className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 font-semibold">{t('alumni.founder.home.progress')}</span></Link></li>
        {companies.length === 0 && data && (
          <li><Link to="/alumni/founder/company/new" className={tile}><Building2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 font-semibold">{t('alumni.founder.profile.createCompany')}</span></Link></li>
        )}
      </ul>
    </section>
  )
}
