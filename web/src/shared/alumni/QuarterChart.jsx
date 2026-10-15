import { useEffect, useId, useRef, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'
import { compactNumber, lastChange, niceTicks, periodLabel, periodShort } from '../../lib/alumniQuarters.js'
import { useQuarterFormat } from './useQuarterFormat.js'
import './i18n.quarters.js'

const MIN_W = 240
const MAX_W = 720
const FONT = 12

/** The rendered width of an element, followed live. The chart is drawn AT this width (1 SVG unit = 1 pixel), so its text never shrinks with the card. Without ResizeObserver (tests) it stays at `fallback`. */
function useWidth(fallback) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const read = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW(x) }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/**
 * ONE metric over the quarters (single series: the title names it, so no legend box). Frozen snapshots ONLY: a quarter nobody reported is a GAP, never a zero. Thin marks in the brand
 * blue, a recessive grid, the last value labelled on its mark, a tooltip per quarter (pointer hover OR the arrow keys on the focused plot), a marker on a quarter a manager CORRECTED after
 * it closed (the original value is in the tooltip and in the table). The plot is always left-to-right (time and numbers do not mirror); everything around it follows the page direction.
 * It is drawn at the width of its card (text stays 12px at any width); on a narrow card the axis keeps fewer ticks and labels.
 * `points` = lib/alumniQuarters.quarterSeries / portfolioSeries. `kind`: 'bar' (a flow: revenue) | 'line' (a stock / cumulative value or a rate).
 */
export function QuarterChart({ title, unit, kind = 'line', points, className }) {
  const { t, lang } = useLanguage()
  const fmt = useQuarterFormat()
  const id = useId()
  const [hover, setHover] = useState(null)
  const [wrapRef, measured] = useWidth(560)
  const W = Math.min(MAX_W, Math.max(MIN_W, measured))
  const narrow = W < 400
  const H = narrow ? 190 : 220
  const M = { top: 20, right: 14, bottom: 30, left: narrow ? 40 : 46 }
  const withValue = points.filter((p) => p.value !== null)
  const { max, step, ticks } = niceTicks(Math.max(0, ...withValue.map((p) => p.value)), { count: narrow ? 3 : 4, integer: unit !== 'percent' })
  const tickLabel = (v) => (unit === 'percent' ? `${step < 1 ? Math.round(v * 10) / 10 : Math.round(v)}%` : compactNumber(v))
  const n = points.length
  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom
  const band = n > 0 ? innerW / n : innerW
  const cx = (i) => M.left + band * i + band / 2
  const cy = (v) => M.top + innerH - (v / max) * innerH
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 52))))   // a quarter label is about 48px wide; counted from the LAST quarter so it is always shown
  const change = lastChange(points)
  const last = withValue[withValue.length - 1]
  const summary = withValue.length === 0
    ? `${title}: ${t('alumni.q.chart.noData')}`
    : `${title}: ${withValue.map((p) => `${periodLabel(p.key, lang)} ${fmt(unit, p.value)}`).join(', ')}`

  // line segments: broken at every gap
  const segments = []
  if (kind === 'line') {
    let cur = []
    points.forEach((p, i) => {
      if (p.value === null) { if (cur.length) segments.push(cur); cur = [] } else cur.push([cx(i), cy(p.value)])
    })
    if (cur.length) segments.push(cur)
  }
  const hovered = hover !== null ? points[hover] : null
  function onKeyDown(e) {
    const at = hover ?? n - 1
    const next = e.key === 'ArrowLeft' ? Math.max(0, at - 1) : e.key === 'ArrowRight' ? Math.min(n - 1, at + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (next === null) { if (e.key === 'Escape') setHover(null); return }
    e.preventDefault()
    setHover(next)
  }

  return (
    <figure className={cn('space-y-2 rounded-card border bg-card p-4', className)} data-testid="quarter-chart">
      <figcaption className="space-y-0.5">
        <p className="text-sm font-semibold">{title}</p>
        {last ? (
          <p className="text-lg font-bold">{fmt(unit, last.value)} <span className="text-xs font-medium text-muted-foreground">({periodLabel(last.key, lang)})</span></p>
        ) : <p className="text-sm text-muted-foreground">{t('alumni.q.chart.noData')}</p>}
        {change && (
          <p className="text-xs text-muted-foreground" data-testid="chart-change">
            {change.pct === null
              ? t('alumni.q.chart.deltaOnly', { delta: `${change.delta >= 0 ? '+' : ''}${fmt(unit, change.delta)}`, period: periodLabel(change.prevKey, lang) })
              : t('alumni.q.chart.deltaPct', { pct: `${change.pct >= 0 ? '+' : ''}${change.pct}%`, period: periodLabel(change.prevKey, lang) })}
          </p>
        )}
      </figcaption>
      <div ref={wrapRef} className="relative" dir="ltr">
        {n > 0 && (
          <>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} aria-describedby={`${id}-k`} tabIndex={0} data-testid="chart-plot"
              className="block max-w-full rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onPointerLeave={() => setHover(null)} onKeyDown={onKeyDown} onFocus={() => setHover((h) => h ?? n - 1)} onBlur={() => setHover(null)}>
              <title id={`${id}-t`}>{summary}</title>
              {ticks.map((v, k) => {
                const y = cy(v)
                return (
                  <g key={k} aria-hidden="true">
                    <line x1={M.left} x2={W - M.right} y1={y} y2={y} className={k === 0 ? 'stroke-border' : 'stroke-border/50'} strokeWidth="1" />
                    <text x={M.left - 6} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={FONT}>{tickLabel(v)}</text>
                  </g>
                )
              })}
              {kind === 'bar' && points.map((p, i) => (p.value === null ? null : (
                <rect key={p.key} x={cx(i) - Math.min(band * 0.55, 34) / 2} y={cy(p.value)} width={Math.min(band * 0.55, 34)} height={Math.max(2, M.top + innerH - cy(p.value))} rx="3" className={hover === i ? 'fill-athar-ink' : 'fill-primary'} aria-hidden="true" />
              )))}
              {kind === 'line' && segments.map((seg, k) => (seg.length > 1 ? <polyline key={k} points={seg.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" /> : null))}
              {kind === 'line' && points.map((p, i) => (p.value === null ? null : <circle key={p.key} cx={cx(i)} cy={cy(p.value)} r={hover === i ? 6 : 4} className="fill-primary stroke-card" strokeWidth="2" aria-hidden="true" />))}
              {points.map((p, i) => (p.corrected && p.value !== null ? (
                <path key={`c-${p.key}`} d={`M ${cx(i)} ${cy(p.value) - 17} l 6 10 h -12 z`} className="fill-accent stroke-athar-ink" strokeWidth="1" aria-hidden="true" />
              ) : null))}
              {last && (
                <text x={Math.min(W - M.right - 2, Math.max(M.left + 8, cx(points.findIndex((p) => p.key === last.key))))} y={cy(last.value) - (last.corrected ? 22 : 9)} textAnchor="middle" className="fill-foreground" fontSize={FONT} fontWeight="700" aria-hidden="true">{unit === 'percent' ? `${last.value}%` : compactNumber(last.value)}</text>
              )}
              {points.map((p, i) => ((n - 1 - i) % every === 0 ? (
                <text key={`x-${p.key}`} x={cx(i)} y={H - 10} textAnchor="middle" className="fill-muted-foreground" fontSize={FONT} aria-hidden="true">{periodShort(p.key, lang)}</text>
              ) : null))}
              {points.map((p, i) => <rect key={`h-${p.key}`} x={M.left + band * i} y={M.top} width={band} height={innerH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} aria-hidden="true" />)}
            </svg>
            <span id={`${id}-k`} className="sr-only">{t('alumni.q.chart.keys')}</span>
            {hovered && (
              <div className="pointer-events-none absolute top-1 z-10 max-w-52 -translate-x-1/2 rounded-input border bg-card px-2.5 py-1.5 text-xs shadow-card" style={{ left: `${Math.min(W - 70, Math.max(70, cx(hover)))}px` }} role="status" data-testid="chart-tooltip">
                <p className="font-semibold">{periodLabel(hovered.key, lang)}</p>
                <p className="tabular-nums">{hovered.value === null ? t(hovered.exists === false ? 'alumni.q.chart.noSnapshot' : 'alumni.q.chart.notReported') : fmt(unit, hovered.value)}</p>
                {hovered.corrected && <p className="text-muted-foreground">{hovered.previous !== null && hovered.previous !== undefined ? t('alumni.q.chart.was', { value: fmt(unit, hovered.previous) }) : t('alumni.q.chart.correctedShort')}</p>}
              </div>
            )}
          </>
        )}
      </div>
      {points.some((p) => p.corrected) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="chart-corrected-note">
          <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden="true"><path d="M6 1 L11 10 H1 Z" className="fill-accent stroke-athar-ink" strokeWidth="1" /></svg>
          {t('alumni.q.chart.correctedNote')}
        </p>
      )}
    </figure>
  )
}

/** The same numbers as a table: a quarter per row, "not reported" for a gap, the original value of a corrected quarter. */
export function QuarterTable({ title, unit, points }) {
  const { t, lang } = useLanguage()
  const fmt = useQuarterFormat()
  return (
    <div className="overflow-x-auto rounded-card border bg-card" data-testid="quarter-table">
      <table className="w-full min-w-[16rem] border-collapse text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b bg-surface text-start">
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t('alumni.q.table.quarter')}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{title}</th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.key} className="border-b last:border-b-0">
              <th scope="row" className="px-3 py-2 text-start font-medium">{periodLabel(p.key, lang)}</th>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {p.value === null ? <span className="text-muted-foreground">{t(p.exists === false ? 'alumni.q.chart.noSnapshot' : 'alumni.q.chart.notReported')}</span> : fmt(unit, p.value)}
                {p.corrected && <span className="ms-2 text-xs text-muted-foreground">{p.previous !== null && p.previous !== undefined ? t('alumni.q.chart.was', { value: fmt(unit, p.previous) }) : t('alumni.q.chart.correctedShort')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A chart with its table alternative one click away (a real toggle with aria-pressed, not a hidden duplicate). */
export default function ChartCard({ title, unit, kind, points, className }) {
  const { t } = useLanguage()
  const [view, setView] = useState('chart')
  return (
    <div className={cn('space-y-2', className)} data-testid="chart-card">
      <div role="group" aria-label={t('alumni.q.chart.view')} className="flex justify-end gap-1">
        {['chart', 'table'].map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('min-h-11 min-w-11 rounded-full border px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', view === v ? 'border-foreground bg-foreground text-background' : 'border-input bg-background hover:border-foreground')}>
            {t(`alumni.q.chart.${v}`)}
          </button>
        ))}
      </div>
      {view === 'chart' ? <QuarterChart title={title} unit={unit} kind={kind} points={points} /> : <QuarterTable title={title} unit={unit} points={points} />}
    </div>
  )
}
