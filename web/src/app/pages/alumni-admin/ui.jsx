import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Building2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { ErrorState, Skeleton } from '../../../ui/States.jsx'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { Img } from '../../../ui/Img.jsx'
import { publicImageUrl, publicThumbUrl } from '../../../data/storage.js'
import { cn } from '../../../lib/cn.js'
import { pageCount, pageRange } from './adminState.js'
import './i18n.common.js'

/** The common frame of a manager page: a heading (the page's only h1), a line of context and the page-level actions. */
export function AdminPage({ title, subtitle, actions, children, className, testId }) {
  return (
    <div className={cn('space-y-6', className)} data-testid={testId}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-section-title">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

/** A card with its own heading (an h2: the page keeps one h1). `action` sits at the end of the heading row. */
export function SectionCard({ title, description, action, children, className, id, testId }) {
  return (
    <section id={id} className={cn('rounded-card border bg-card p-4 sm:p-5', className)} data-testid={testId} aria-labelledby={id ? `${id}-title` : undefined}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 id={id ? `${id}-title` : undefined} className="text-card-title">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

const KPI_TONES = { default: 'text-foreground', good: 'text-success-text', warn: 'text-foreground', bad: 'text-destructive-text' }

/** One figure: the label, the value, a hint line. A `to` makes the whole card a link (the figure is a door to the list behind it). */
export function KpiCard({ label, value, hint, icon: Icon, to, tone = 'default', children, testId }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
      </div>
      <p className={cn('mt-1 font-display font-bold tabular-nums', String(value).length > 9 ? 'text-xl' : 'text-3xl', KPI_TONES[tone] ?? KPI_TONES.default)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </>
  )
  const cls = 'block min-w-0 rounded-card border bg-card p-4'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')} data-testid={testId}>{body}</Link>
  ) : (
    <div className={cls} data-testid={testId}>{body}</div>
  )
}

/** A choice between a few views of the same list (status tabs, scope): buttons with `aria-pressed`, 44 px targets, wraps in RTL. */
export function Segmented({ label, value, onChange, options, className }) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex flex-wrap gap-1 rounded-3xl border border-input bg-background p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === o.value ? 'bg-foreground text-background' : 'text-foreground hover:bg-surface',
          )}
        >
          {o.label}
          {o.count !== undefined && o.count !== null && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', value === o.value ? 'bg-background/20' : 'bg-surface')}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Server-side paging: "11-20 of 141", previous / next, the page size. Never loads more than one page. */
export function Pagination({ total, page, size, onPage, onSize, sizes = [25, 50, 100], className }) {
  const { t, formatNumber } = useLanguage()
  const pages = pageCount(total, size)
  const { from, to } = pageRange(total, page, size)
  return (
    <nav aria-label={t('alumni.admin.common.page', { page, pages })} className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <p aria-live="polite" className="text-muted-foreground">{t('alumni.admin.common.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onSize && (
          <label className="flex items-center gap-2 text-muted-foreground">
            <span>{t('alumni.admin.common.perPage')}</span>
            <select className={cn(SELECT_CLASS, 'min-h-11 w-auto py-1')} value={size} onChange={(e) => onSize(Number(e.target.value))}>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('alumni.admin.common.prev')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <span className="tabular-nums" aria-hidden="true">{page} / {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('alumni.admin.common.next')}>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

/** A small labelled value with an origin hint ("from the national ID"): the derived values are never presented as typed ones. */
export function FactRow({ label, children, hint }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children || <span className="text-muted-foreground">—</span>}</dd>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A company logo as a small square (the WebP thumbnail); a neutral glyph when there is none. */
export function CompanyLogo({ path, size = 32, className }) {
  const style = { width: size, height: size }
  return path ? (
    <span className={cn('inline-block shrink-0', className)} style={style}>
      <Img variant="thumb" src={publicImageUrl(path)} thumb={publicThumbUrl(path)} aspect="1 / 1" alt="" className="h-full w-full rounded-md" />
    </span>
  ) : (
    <span className={cn('grid shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground', className)} style={style} aria-hidden="true">
      <Building2 className="h-4 w-4" />
    </span>
  )
}

/** Loading / error / data of ONE query inside a card: a skeleton while it loads, an error with Try again, then `children(data)`. A failing card never blanks the page. */
export function Query({ query, children, skeleton = 'h-24 w-full' }) {
  if (query.isPending) return <Skeleton className={skeleton} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} className="p-4" />
  return children(query.data)
}

/** A checkbox with its label and an optional hint (read with the control: aria-describedby). 44 px row, the box is 20 px. */
export function CheckRow({ checked, disabled, onChange, label, hint, className }) {
  const id = useId()
  return (
    <div className={cn('flex min-h-11 items-start gap-2.5 py-1', className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
