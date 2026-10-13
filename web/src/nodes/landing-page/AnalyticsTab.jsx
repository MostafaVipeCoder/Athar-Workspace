import { useMemo, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useLandingAnalytics } from '../../data/landing.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { SELECT_CLASS } from '../../ui/Field.jsx'
import { analyticsByCard, analyticsSeries, pickBi } from './landingLogic.js'

const SERIES_DAYS = 14

/**
 * Analytics tab (design 04 section 3.12): counts of the anonymous events the public page records (page views, button clicks, shares by
 * platform, photos uploaded / downloaded) from `get_landing_analytics` (aggregates only, no raw rows, no visitor data exists). Cards are
 * matched by their STABLE id, so a card's history survives every save (the as-is page lost it at each save).
 */
export default function AnalyticsTab({ nodeId, cards, analyticsOn }) {
  const { t, lang, formatNumber } = useLanguage()
  const [days, setDays] = useState(30)
  const q = useLandingAnalytics(nodeId, days)
  const d = q.data
  const perCard = useMemo(() => analyticsByCard(d?.by_card, cards), [d, cards])
  const series = useMemo(() => analyticsSeries(d?.by_day, 'tab_view', SERIES_DAYS), [d])
  const max = Math.max(1, ...series.map((s) => s.n))
  const sum = (...types) => types.reduce((n, k) => n + Number(d?.totals?.[k] ?? 0), 0)
  const platforms = useMemo(() => {
    const m = new Map()
    for (const r of d?.by_platform ?? []) if (r.event_type === 'card_share' || r.event_type === 'share_copy') m.set(r.platform, (m.get(r.platform) ?? 0) + Number(r.n))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [d])
  const f = (n) => formatNumber(n)

  const tiles = [
    ['tab_view', sum('tab_view')], ['cta_click', sum('cta_click')], ['shares', sum('card_share', 'share_copy')],
    ['image_upload', sum('image_upload')], ['image_download', sum('image_download')],
  ]

  return (
    <div className="space-y-5" data-testid="analytics-tab">
      {!analyticsOn && <p className="rounded-md bg-surface p-3 text-sm text-muted-foreground" data-testid="analytics-off">{t('landing.analytics.off')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('landing.analytics.hint')}</p>
        <div className="flex items-center gap-2">
          <label htmlFor="analytics-days" className="text-sm font-medium">{t('landing.analytics.period')}</label>
          <select id="analytics-days" className={`${SELECT_CLASS} !min-h-9 w-auto`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((n) => <option key={n} value={n}>{t('landing.analytics.days', { n })}</option>)}
          </select>
        </div>
      </div>
      {q.isPending ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <EmptyState title={t('landing.analytics.none')} /> : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="analytics-tiles">
            {tiles.map(([k, n]) => (
              <li key={k} className="rounded-card border p-3" data-testid={`tile-${k}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`landing.analytics.tile.${k}`)}</p>
                <p className="mt-1 font-display text-stat leading-none">{f(n)}</p>
              </li>
            ))}
          </ul>

          <section className="rounded-card border p-4">
            <h3 className="font-display text-lg font-bold">{t('landing.analytics.views14')}</h3>
            <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label={t('landing.analytics.views14')} dir="ltr">
              {series.map((s) => (
                <div key={s.day} className="flex h-full flex-1 flex-col justify-end" title={`${s.day}: ${s.n}`}>
                  <div className="w-full rounded-t-xs bg-primary" style={{ height: `${s.n ? Math.max(4, (s.n / max) * 100) : 2}%`, opacity: s.n ? 1 : 0.2 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted-foreground" dir="ltr"><span>{series[0]?.day.slice(5)}</span><span>{series[series.length - 1]?.day.slice(5)}</span></div>
          </section>

          <section className="rounded-card border">
            <h3 className="p-4 pb-2 font-display text-lg font-bold">{t('landing.analytics.byCard')}</h3>
            {cards.length === 0 ? <p className="p-4 pt-0 text-sm text-muted-foreground">{t('landing.analytics.noCards')}</p> : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-athar-grey-100 text-start">
                    <tr>
                      <th scope="col" className="p-3 text-start font-semibold">{t('landing.analytics.card')}</th>
                      {['cta_click', 'card_share', 'share_copy'].map((k) => <th key={k} scope="col" className="p-3 text-end font-semibold">{t(`landing.analytics.col.${k}`)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {perCard.map((row, i) => (
                      <tr key={row.cardId} className="border-t" data-testid="analytics-card-row">
                        <th scope="row" className="max-w-[260px] truncate p-3 text-start font-medium" dir="auto">{pickBi(cards[i].title, lang) || pickBi(cards[i].chip, lang) || t('landing.cards.untitled')}</th>
                        {['cta_click', 'card_share', 'share_copy'].map((k) => <td key={k} className="p-3 text-end tabular-nums">{f(row.counts[k] ?? 0)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {platforms.length > 0 && (
            <section className="rounded-card border p-4">
              <h3 className="font-display text-lg font-bold">{t('landing.analytics.byPlatform')}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {platforms.map(([p, n]) => <li key={p} className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{t(`landing.channel.${p}`)}: {f(n)}</li>)}
              </ul>
            </section>
          )}
          <p className="text-xs text-muted-foreground">{t('landing.analytics.allTime', { n: f(Number(d.all_time ?? 0)) })}</p>
        </>
      )}
    </div>
  )
}
