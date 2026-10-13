import { useMemo } from 'react'
import './i18n.js'
import { EntityGrid } from '../../shared/entities/EntityGrid.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { isActiveItem, normalizeListItem, visibleCardFields } from '../../lib/entities.js'
import { normalizeSelectionConfig } from './selectionConfig.js'

/**
 * The Selection node's contributed tab view (manifest.contributesViews 'results-tab', the optional `view` port of
 * 01 section 3.4): the accepted applicants as a company card grid. Same host contract as the Lists tab
 * (web/PROGRESS.md "Tab view contract"): `data = get_public_tab(ref, edge).data` (the DB already filters the passing
 * statuses and whitelists the rows) or, for the PM preview, `items` (ListItemView[]) + `config`.
 */
export const PUBLIC_PAGE_SIZE = 100

export default function ResultsTab({ data = null, items = null, config = null, title, audience = 'public', onLoadMore, hasMore = false, loadingMore = false, hideTitle = false }) {
  const { t } = useLanguage()
  const cfg = useMemo(() => normalizeSelectionConfig(config ?? { card: data?.config?.card }), [config, data])
  const rows = useMemo(() => {
    const list = items ?? (data?.items ?? []).map((r) => normalizeListItem(r, 'company'))
    return list.filter((i) => isActiveItem(i) && (audience === 'pm' || !i.missing))
  }, [items, data, audience])
  const cards = rows.map((i) => ({ key: i.id, entity: i.entity, show: visibleCardFields(cfg.card.showFields, i.card), muted: i.missing }))
  return (
    <section className="space-y-4" data-testid="results-tab">
      {title && !hideTitle && <h2 className="text-section-title">{title}</h2>}
      <EntityGrid cards={cards} accent={cfg.card.accent ?? undefined} emptyTitle={t('selection.view.empty')} />
      {onLoadMore && hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onLoadMore} loading={loadingMore}>{t('list.view.loadMore')}</Button>
        </div>
      )}
    </section>
  )
}
