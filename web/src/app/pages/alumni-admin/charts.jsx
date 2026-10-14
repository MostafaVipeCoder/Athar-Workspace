import { cn } from '../../../lib/cn.js'

/**
 * Charts without a chart library (the manager pages stay light): every figure is TEXT first (a list a screen reader reads as it is) and the bar is a decorative echo of
 * the number (`aria-hidden`). Colours are the brand blue / ink on the light track: both clear 3:1 against it (non-text contrast).
 */
const FILLS = { primary: 'bg-primary', ink: 'bg-athar-ink', success: 'bg-success', danger: 'bg-destructive-text' }

/** Horizontal bars: `rows` = `[{ key, label, count, pct }]` (lib adminLogic.barRows). `format` formats the count, `pctText` the share. */
export function BarList({ rows, format = (n) => String(n), pctText = (p) => `${Math.round(p)}%`, ariaLabel, tone = 'primary', className }) {
  return (
    <ul aria-label={ariaLabel} className={cn('space-y-2.5', className)}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className="shrink-0 tabular-nums font-semibold">
              {format(r.count)} <span className="font-normal text-muted-foreground">({pctText(r.pct)})</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className={cn('h-full rounded-full', FILLS[tone] ?? FILLS.primary)} style={{ width: `${Math.max(r.count > 0 ? 3 : 0, Math.min(100, r.pct))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** A series over years: `series` = `[{ year, value }]`, `format` for the value on top of each column. */
export function ColumnChart({ series, format = (n) => String(n), ariaLabel, missingLabel, tone = 'primary', height = 140, className }) {
  const max = Math.max(1, ...series.map((s) => s.value))
  return (
    <ol aria-label={ariaLabel} className={cn('flex items-end gap-2 overflow-x-auto pb-1', className)} style={{ minHeight: height + 44 }}>
      {series.map((s) => (
        <li key={s.year} className="flex min-w-14 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-xs font-semibold tabular-nums">{s.missing ? <span aria-label={missingLabel}>—</span> : format(s.value)}</span>
          <div className="flex w-full items-end justify-center" style={{ height }} aria-hidden="true">
            <div className={cn('w-full max-w-12 rounded-t-md', FILLS[tone] ?? FILLS.primary)} style={{ height: `${Math.max(s.value > 0 ? 4 : 0, (100 * s.value) / max)}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{s.year}</span>
        </li>
      ))}
    </ol>
  )
}

/** One bar split in segments that add up to a whole (open / closed, female / male): the legend carries the numbers as text. */
export function ShareBar({ segments, format = (n) => String(n), ariaLabel, className }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={ariaLabel}>
        {segments.map((s) => (total > 0 && s.value > 0 ? <div key={s.key} className={FILLS[s.tone] ?? FILLS.primary} style={{ width: `${(100 * s.value) / total}%` }} /> : null))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-full', FILLS[s.tone] ?? FILLS.primary)} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="font-semibold tabular-nums">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
