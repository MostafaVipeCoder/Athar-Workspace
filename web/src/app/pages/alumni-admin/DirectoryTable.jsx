import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, PanelRightOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { cn } from '../../../lib/cn.js'
import { cellText, columnOf, governorateOf, reviewState } from './columns.js'
import { CompanyLogo } from './ui.jsx'
import RevealId from './RevealId.jsx'
import './i18n.common.js'
import './directory.i18n.js'

const isHttp = (u) => /^https?:\/\//i.test(String(u ?? ''))
const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, '')
  } catch {
    return String(u)
  }
}

function Dash() {
  return <span className="text-muted-foreground" aria-hidden="true">—</span>
}

/** One cell. The plain text comes from columns.cellText (tests, tooltips); the cell adds only what text cannot: a link, a badge, a bar, the audited reveal of the national ID. */
function Cell({ col, row, env }) {
  const { t } = env
  const text = cellText(row, col.key, env)
  switch (col.kind) {
    case 'long':
      return text ? <span className="line-clamp-2 block max-w-xs whitespace-normal break-words" title={text}>{text}</span> : <Dash />
    case 'link':
      return text && isHttp(text)
        ? <a href={text} target="_blank" rel="noopener noreferrer" dir="ltr" className="inline-flex max-w-[14rem] items-center gap-1 truncate text-primary hover:underline">{hostOf(text)}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a>
        : <Dash />
    case 'ltr':
      return text ? <span dir="ltr" className="tabular-nums">{text}</span> : <Dash />
    case 'number':
      return text ? <span className="block text-end tabular-nums">{text}</span> : <Dash />
    case 'money':
      return text ? <span className="block whitespace-nowrap text-end tabular-nums">{text}</span> : <Dash />
    case 'date':
      return text ? <span className="whitespace-nowrap">{text}</span> : <Dash />
    case 'governorate': {
      const g = governorateOf(row, env.lookups, env.lang)
      return g.text
        ? (
          <span className="inline-flex items-center gap-1.5" title={t(`alumni.admin.dir.srcTitle.${g.source}`)}>
            {g.text}
            <span className={cn('rounded-full px-1.5 text-[11px] font-semibold leading-5', g.source === 'id' ? 'bg-primary/10 text-primary' : 'bg-surface text-muted-foreground')}>{t(`alumni.admin.dir.src.${g.source}`)}</span>
          </span>
        )
        : <Dash />
    }
    case 'status':
      return text ? <Badge tone={row.operating_status === 'closed' ? 'red' : 'green'}>{text}</Badge> : <Dash />
    case 'flag':
      return <Badge tone={row.is_alumni ? 'blue' : 'outline'}>{row.is_alumni ? t('alumni.admin.dir.alumniYes') : t('alumni.admin.dir.alumniNo')}</Badge>
    case 'review': {
      const s = reviewState(row)
      return <Badge tone={s === 'current' ? 'green' : s === 'changed' ? 'amber' : 'outline'}>{t(`alumni.admin.common.review.${s}`)}</Badge>
    }
    case 'completeness': {
      const p = row.completeness?.percent ?? 0
      return (
        <span className="flex min-w-24 items-center gap-2" title={(row.completeness?.missing ?? []).join(', ')}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><span className={cn('block h-full rounded-full', p >= 90 ? 'bg-success' : p >= 60 ? 'bg-primary' : 'bg-destructive-text')} style={{ width: `${p}%` }} /></span>
          <span className="tabular-nums">{p}%</span>
        </span>
      )
    }
    case 'national_id':
      return <RevealId masked={row.ceo?.id_masked} founderId={row.ceo?.founder_id} hasId={row.ceo?.has_national_id} />
    default:
      if (col.key === 'ceo_gender' || col.key === 'ceo_age' || col.key === 'age_category') {
        return text ? <span title={row.ceo?.source === 'self' ? t('alumni.admin.dir.ceoSrc.self') : undefined}>{text}{row.ceo?.source === 'self' && <span className="ms-1 text-xs text-muted-foreground">({t('alumni.admin.dir.ceoSrc.self')})</span>}</span> : <Dash />
      }
      return text ? <span className="block max-w-[16rem] truncate" title={text}>{text}</span> : <Dash />
  }
}

/**
 * The manager table: sticky header and name column, sortable headers (server-side), a scrollable region the keyboard can reach. Rows are the `list_alumni_table` rows;
 * every derived person value arrives already derived (from the national ID) and the national-ID column is masked with an audited reveal.
 */
export default function DirectoryTable({ rows, columns, year, sort, dir, onSort, selected, onToggle, onToggleAll, onOpen, env, busy }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const cols = columns.map(columnOf).filter(Boolean)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someSelected = rows.some((r) => selected.has(r.id))
  const label = (c) => d(`col.${c.key}`, { year })

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable so the keyboard can scroll it (WCAG 2.1.1)
    <div role="region" aria-label={d('title')} tabIndex={0} className={cn('relative max-h-[72vh] overflow-auto rounded-card border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', busy && 'opacity-70 transition-opacity')} data-testid="directory-table">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {cols.map((c, i) => {
              const sorted = c.sort && sort === c.sort
              const Icon = sorted ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sorted ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('sticky top-0 z-20 whitespace-nowrap border-b bg-surface px-3 py-2 text-start text-xs font-bold uppercase tracking-normal text-athar-ink', i === 0 && 'start-0 z-30 min-w-60')}
                  title={c.key === 'governerate' ? d('colHint.governerate') : undefined}
                >
                  <span className="flex items-center gap-2.5">
                    {i === 0 && (
                      <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={allSelected} ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }} onChange={onToggleAll} aria-label={d('selectAll')} />
                    )}
                    {c.sort ? (
                      <button type="button" onClick={() => onSort(c.sort)} className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded px-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${d('sortBy', { column: label(c) })}${sorted ? `, ${d(dir === 'asc' ? 'sortedAsc' : 'sortedDesc')}` : ''}`}>
                        {label(c)}
                        <Icon className={cn('h-3.5 w-3.5', !sorted && 'text-muted-foreground')} aria-hidden="true" />
                      </button>
                    ) : label(c)}
                  </span>
                </th>
              )
            })}
            <th scope="col" className="sticky top-0 z-20 w-px border-b bg-surface px-3 py-2"><span className="sr-only">{d('openDetails', { name: '' })}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSel = selected.has(r.id)
            const name = pick(r, 'name') || d('noName')
            return (
              <tr key={r.id} className={cn('group', isSel && 'bg-primary/5')} data-testid="directory-row" data-id={r.id}>
                {cols.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn('border-b px-3 py-2 align-middle', i === 0 && 'sticky start-0 z-10 min-w-60 bg-card group-hover:bg-surface', i === 0 && isSel && 'bg-primary/5')}
                  >
                    {i === 0 ? (
                      <span className="flex items-center gap-2.5">
                        <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={isSel} onChange={() => onToggle(r.id)} aria-label={d('selectRow', { name })} />
                        <CompanyLogo path={r.logo_path} size={32} />
                        <button type="button" onClick={() => onOpen(r)} aria-haspopup="dialog" className="min-w-0 truncate text-start font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={name}>
                          {name}
                        </button>
                      </span>
                    ) : <Cell col={c} row={r} env={env} />}
                  </td>
                ))}
                <td className="border-b px-2 py-1 align-middle">
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => onOpen(r)} aria-label={d('openDetails', { name })} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <PanelRightOpen className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                    </button>
                    <Link to={`/alumni/admin/company/${r.id}`} aria-label={d('openPage', { name })} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
