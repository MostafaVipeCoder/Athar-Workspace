import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { cn } from '../../lib/cn.js'
import { completenessTone } from '../../lib/alumni.js'
import { scrollToSection } from './scrollToSection.js'
import './i18n.js'

/**
 * A READ-ONLY value with the origin badge (design 09 14.2): `origin` = 'id' ("From your national ID"), 'self' ("Self-declared") or 'derived' ("Calculated"). Never an input:
 * derived values are not typed (decision 19.1).
 */
export function DerivedValue({ label, value, origin = 'derived', hint, className }) {
  const { t } = useLanguage()
  const badge = origin === 'id' ? { tone: 'blue', text: t('alumni.common.fromId') } : origin === 'self' ? { tone: 'amber', text: t('alumni.common.selfDeclared') } : { tone: 'neutral', text: t('alumni.common.calculated') }
  const empty = value === null || value === undefined || value === ''
  return (
    <div className={cn('min-w-0 space-y-1', className)} data-testid="derived-value">
      <dt className="text-sm font-medium text-athar-ink">{label}</dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn('text-base font-semibold', empty && 'text-muted-foreground')}>{empty ? t('alumni.common.notSet') : value}</span>
        {!empty && <Badge tone={badge.tone}>{badge.text}</Badge>}
      </dd>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** One section of a profile form: a card with a heading and an anchor (`id`) the completeness meter and the section chips jump to. `stamp` = a node shown under the heading (the "last edited by" line). */
export function ProfileSection({ id, title, description, icon: Icon, children, className, done, stamp }) {
  const headingId = `${id}-title`
  const { t } = useLanguage()
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-40 space-y-4 rounded-card border bg-card p-4 transition-shadow sm:p-5 data-[highlight=true]:ring-2 data-[highlight=true]:ring-primary', className)} data-testid={`section-${id}`}>
      <div className="space-y-0.5">
        <h2 id={headingId} className="flex items-center gap-2 text-card-title">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
          <span className="min-w-0">{title}</span>
          {done === true && <Badge tone="green" className="ms-auto shrink-0">{t('alumni.common.complete')}</Badge>}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {stamp}
      </div>
      {children}
    </section>
  )
}

const TONE = { success: 'bg-success', warning: 'bg-accent', danger: 'bg-destructive-text', neutral: 'bg-muted-foreground' }

/**
 * Completeness meter (the percent and the missing keys come from the server: `completeness: { percent, missing[] }`). `labelFor(key)` names a missing item,
 * `sectionFor(key)` is the id of the section that fixes it; a missing item is then a button that jumps there.
 */
export function CompletenessMeter({ title, percent, missing = [], labelFor, sectionFor, onJump = scrollToSection, className }) {
  const { t } = useLanguage()
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  const tone = completenessTone(p)
  return (
    <div className={cn('space-y-2', className)} data-testid="completeness-meter">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title ?? t('alumni.common.completeness')}</span>
        <span className="text-sm font-bold" aria-hidden="true">{p}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p}
        aria-label={title ?? t('alumni.common.completeness')}
        className="h-2.5 overflow-hidden rounded-full bg-surface"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', TONE[tone])} style={{ width: `${p}%` }} />
      </div>
      {p >= 100 ? (
        <p className="text-xs text-muted-foreground">{t('alumni.common.completenessDone')}</p>
      ) : missing.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('alumni.common.completenessMissing')}</span>
          {missing.map((k) => {
            const section = sectionFor?.(k)
            const text = labelFor ? labelFor(k) : k
            return section ? (
              <button
                key={k}
                type="button"
                onClick={() => onJump(section)}
                className="inline-flex min-h-11 items-center rounded-full border border-input bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {text}
              </button>
            ) : (
              <Badge key={k} tone="outline">{text}</Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}
