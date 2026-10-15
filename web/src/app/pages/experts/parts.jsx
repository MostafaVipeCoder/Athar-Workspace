import { Link } from 'react-router-dom'
import { Archive, CalendarCheck, ChevronLeft, ChevronRight, FolderKanban, Layers, Trash2, Users } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Avatar } from '../../../ui/Avatar.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Img } from '../../../ui/Img.jsx'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { publicImageUrl, publicThumbUrl } from '../../../data/storage.js'
import { cn } from '../../../lib/cn.js'
import { displayName, tagName } from '../../../lib/experts.js'
import './experts.i18n.js'
import { fmtDay } from './hooks.js'

const SIZES = { sm: 'h-10 w-10', md: 'h-14 w-14', lg: 'h-28 w-28 sm:h-32 sm:w-32' }

/**
 * The photo of a person: the WebP THUMBNAIL (lazy, reserved square: no layout shift) or, when the record has no photo, the initials on a colour derived from the id.
 * `size`: sm 40 px (list rows) | md 56 px (cards) | lg 112 - 128 px (profile). The large one loads the full image with the thumbnail as its blurred preview.
 */
export function ExpertPhoto({ expert, size = 'sm', className }) {
  const { lang } = useLanguage()
  const name = displayName(expert, lang)
  const cls = cn(SIZES[size], 'shrink-0 rounded-full', className)
  if (expert?.photoPath) {
    return (
      <Img
        variant={size === 'lg' ? 'full' : 'thumb'}
        src={publicImageUrl(expert.photoPath)}
        thumb={publicThumbUrl(expert.photoPath)}
        aspect="1 / 1"
        alt=""
        eager={size === 'lg'} // the profile photo is above the fold; list thumbnails stay lazy
        className={cn(cls, 'ring-2 ring-background')}
      />
    )
  }
  return <Avatar name={name} id={expert?.id} size={size === 'sm' ? 'md' : 'lg'} className={cn(size === 'lg' && 'h-28 w-28 text-3xl sm:h-32 sm:w-32', cls)} />
}

/** "Athar team" marker (the kind `team`); experts carry no badge (they are the default). */
export function KindBadge({ kind }) {
  const { t } = useLanguage()
  return kind === 'team' ? <Badge tone="blue">{t('experts.kind.team')}</Badge> : null
}

export function DeletedBadge() {
  const { t } = useLanguage()
  return (
    <Badge tone="red">
      <Trash2 className="h-3 w-3" aria-hidden="true" />
      {t('experts.state.deleted')}
    </Badge>
  )
}

export function ArchivedBadge() {
  const { t } = useLanguage()
  return (
    <Badge tone="amber">
      <Archive className="h-3 w-3" aria-hidden="true" />
      {t('experts.state.archived')}
    </Badge>
  )
}

/** Expertise tags as small outline pills; `max` keeps a card compact ("+3"), the full list is a click away on the profile. */
export function TagChips({ tags, max = 3, className }) {
  const { lang, formatNumber } = useLanguage()
  const shown = (tags ?? []).slice(0, max)
  const rest = (tags ?? []).length - shown.length
  if (!shown.length) return null
  return (
    <ul className={cn('flex flex-wrap gap-1', className)}>
      {shown.map((tg) => (
        <li key={tg.id}>
          <Badge tone="outline" className="max-w-[12rem] truncate">{tagName(tg, lang)}</Badge>
        </li>
      ))}
      {rest > 0 && <li><Badge tone="neutral">+{formatNumber(rest)}</Badge></li>}
    </ul>
  )
}

/**
 * The participation figures of a registry row or of a profile's totals: programs, projects, sessions, and the last day. `row` = { programs, projects, sessions, lastOn, took }.
 * Plural-aware in Arabic (one / two / few / many); the numbers are Western digits.
 */
export function ParticipationFigures({ row, showLast = true, compact = false }) {
  const { t, tn, formatDate } = useLanguage()
  if (!row?.took && !row?.programs && !row?.sessions) {
    return <span className="text-sm text-muted-foreground">{t('experts.participation.none')}</span>
  }
  const item = (Icon, text) => (
    <li className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{text}</span>
    </li>
  )
  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <ul className={cn('flex flex-wrap gap-x-3 gap-y-0.5', compact && 'text-xs')}>
        {item(Layers, tn('experts.count.programs', row.programs))}
        {item(FolderKanban, tn('experts.count.projects', row.projects))}
        {item(CalendarCheck, tn('experts.count.sessions', row.sessions))}
      </ul>
      {showLast && row.lastOn && <p className="text-xs text-muted-foreground">{t('experts.participation.last', { date: fmtDay(formatDate, row.lastOn) })}</p>}
    </div>
  )
}

/** The reasons the server gives for "this looks like another record" as small chips. */
export function ReasonChips({ reasons }) {
  const { t } = useLanguage()
  return (
    <ul className="flex flex-wrap gap-1">
      {(reasons ?? []).map((r) => (
        <li key={r}><Badge tone={r === 'same_linkedin' || r === 'same_email' || r === 'same_name' ? 'red' : 'amber'}>{t(`experts.dup.reason.${r}`)}</Badge></li>
      ))}
    </ul>
  )
}

/** A compact record line for the duplicate lists and the merge dialog: photo, name (+ the other language), role line. */
export function ExpertLine({ expert, to, state, className, onClick, trailing }) {
  const { lang } = useLanguage()
  const name = displayName(expert, lang) || '-'
  const other = lang === 'ar' ? expert.name?.en : expert.name?.ar
  const role = [expert.title ? (lang === 'ar' ? expert.title.ar || expert.title.en : expert.title.en || expert.title.ar) : '', expert.company ? (lang === 'ar' ? expert.company.ar || expert.company.en : expert.company.en || expert.company.ar) : ''].filter(Boolean).join(' · ')
  const body = (
    <>
      <ExpertPhoto expert={expert} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold ltr:text-left rtl:text-right" dir="auto">{name}</span>
        {other && other !== name && <span className="block truncate text-xs text-muted-foreground ltr:text-left rtl:text-right" dir="auto">{other}</span>}
        {role && <span className="block truncate text-xs text-muted-foreground ltr:text-left rtl:text-right" dir="auto">{role}</span>}
      </span>
      {trailing}
    </>
  )
  const cls = cn('flex min-w-0 items-center gap-3', className)
  if (to) return <Link to={to} state={state} className={cn(cls, 'min-h-11 rounded-md hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, 'w-full rounded-md p-1 text-start hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</button>
  return <div className={cls}>{body}</div>
}

/** Server-side paging of the registry: "1 - 24 of 44", previous / next, the page size. Never loads more than one page. */
export function RegistryPager({ total, page, size, onPage, onSize, sizes }) {
  const { t, formatNumber } = useLanguage()
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <nav aria-label={t('experts.pager.label')} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p aria-live="polite" className="text-muted-foreground">{t('experts.pager.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-muted-foreground">
          <span>{t('experts.pager.perPage')}</span>
          <select className={cn(SELECT_CLASS, 'min-h-11 w-auto py-1')} value={size} onChange={(e) => onSize(Number(e.target.value))}>
            {sizes.map((s) => <option key={s} value={s}>{formatNumber(s)}</option>)}
          </select>
        </label>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('experts.pager.prev')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <span className="tabular-nums" aria-hidden="true">{formatNumber(page)} / {formatNumber(pages)}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('experts.pager.next')}>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

/** A small stat tile of the registry header (clickable: it applies the filter it counts). */
export function StatTile({ label, value, icon: Icon = Users, onClick, active }) {
  const body = (
    <>
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-display text-2xl font-bold tabular-nums leading-none">{value}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  )
  const cls = cn('flex min-h-14 min-w-0 items-center gap-3 rounded-card border bg-card px-4 py-3 text-start', active && 'border-foreground')
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className={cn(cls, 'transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  )
}
