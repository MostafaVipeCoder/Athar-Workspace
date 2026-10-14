import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { barRatios, lastChange, snapshotSeries, TREND_METRICS } from '../../lib/alumniProgress.js'
import { cn } from '../../lib/cn.js'
import { useMetricFormat } from './useMetricFormat.js'
import './i18n.company.js'

/**
 * A small bar chart of ONE yearly metric (single series: the title names it, so no legend). Thin bars with a 4 px rounded top, anchored to the baseline, in the brand
 * blue; the latest value is labelled on its bar and every bar has a hover title ("2024: EGP 260,000"). Years without a figure are not drawn (no invented zeros).
 * The accessible description is a sentence; the full numbers are in the table (MetricsTable).
 */
export function TrendChart({ title, unit, series, max = 6, className }) {
  const { t } = useLanguage()
  const fmt = useMetricFormat()
  const shown = series.slice(-max)
  const { bars } = barRatios(shown)
  const change = lastChange(series)
  if (shown.length === 0) return null
  const last = shown[shown.length - 1]
  const summary = `${title}: ${shown.map((p) => `${p.year} ${fmt(unit, p.value)}`).join(', ')}`
  return (
    <figure className={cn('space-y-2 rounded-card border bg-card p-4', className)} data-testid="trend-chart">
      <figcaption className="space-y-0.5">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-lg font-bold">{fmt(unit, last.value)} <span className="text-xs font-medium text-muted-foreground">({last.year})</span></p>
        {change && (
          <p className="text-xs text-muted-foreground" data-testid="trend-change">
            {change.pct === null
              ? t('alumni.common.trendDelta', { delta: `${change.delta >= 0 ? '+' : ''}${fmt(unit, change.delta)}`, year: change.prevYear })
              : t('alumni.common.trendPct', { pct: `${change.pct >= 0 ? '+' : ''}${change.pct}%`, year: change.prevYear })}
          </p>
        )}
      </figcaption>
      <div role="img" aria-label={summary} className="flex h-24 items-end gap-2 border-b border-border">
        {bars.map((b) => (
          <div key={b.year} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.year}: ${fmt(unit, b.value)}`}>
            <div className="mx-auto w-full max-w-8 rounded-t bg-primary" style={{ height: `${Math.max(b.ratio * 100, b.value > 0 ? 3 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2" aria-hidden="true">
        {bars.map((b) => <span key={b.year} className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground">{b.year}</span>)}
      </div>
    </figure>
  )
}

/** The trend charts of a company's yearly rows: revenue, funding raised, employees (only the metrics that have at least one figure). */
export default function TrendBars({ snapshots, className }) {
  const { t } = useLanguage()
  const charts = TREND_METRICS.map((m) => ({ ...m, series: snapshotSeries(snapshots, m.key) })).filter((m) => m.series.length > 0)
  if (charts.length === 0) return null
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)} data-testid="trend-bars">
      {charts.map((m) => <TrendChart key={m.key} title={t(`alumni.common.metric.${m.key}`)} unit={m.unit} series={m.series} />)}
    </div>
  )
}
