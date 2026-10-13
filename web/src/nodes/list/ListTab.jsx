import { useMemo } from 'react'
import './i18n.js'
import { EntityGrid } from '../../shared/entities/EntityGrid.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { isActiveItem, normalizeListItem, visibleCardFields } from '../../lib/entities.js'
import { normalizeListConfig } from './listConfig.js'

/**
 * The List node's contributed tab view (manifest.contributesViews 'list-tab'): the public/platform card grid.
 *
 * CONTRACT for hosts (Agenda tabs, the founder page, /view/:ref/list-tab):
 *   <ListTab data={payload.data} title="..." audience="public|participant|pm" onLoadMore={fn?} loadingMore={bool?} />
 * where `payload` is what `get_public_tab(ref, edgeId)` / `get_public_list(ref)` return: `data = { items, next, config }`
 * (`config = { kind, card }`, items whitelisted by the DB). The component never fetches: the host owns the query and
 * pagination (`next` cursor -> `onLoadMore`; pass `hasMore` = the last page was full, PUBLIC_PAGE_SIZE rows, because
 * the DB always returns a cursor). For the PM preview (View mode) pass `items` (ListItemView[]) + `config` + `kind`
 * instead of `data`.
 * Rules: hidden items never arrive (resolver); `missing` items are shown to PMs only; one item = centred, expanded card
 * and (optionally) no title; bio collapses with "See more" unless the list disables it.
 */
/** Page size of the DB payload (app_private.list_public_payload): a full page means there may be more. */
export const PUBLIC_PAGE_SIZE = 100

export default function ListTab({ data = null, items = null, config = null, kind = null, title, audience = 'public', onLoadMore, hasMore = false, loadingMore = false, hideTitle = false, dense = false }) {
  const { t } = useLanguage()
  // PM preview passes the node config; public hosts pass the DB payload whose `config.card` is the node's card config
  const cfg = useMemo(() => normalizeListConfig(config ?? { card: data?.config?.card }), [config, data])
  const listKind = kind ?? data?.config?.kind ?? 'generic'
  const rows = useMemo(() => {
    const list = items ?? (data?.items ?? []).map((r) => normalizeListItem(r, listKind))
    return list.filter((i) => isActiveItem(i) && (audience === 'pm' || !i.missing))
  }, [items, data, listKind, audience])

  const cards = rows.map((i) => ({
    key: i.id,
    entity: i.entity,
    show: visibleCardFields(cfg.card.showFields, i.card),
    muted: i.missing,
  }))
  const showTitle = title && !hideTitle && !(cfg.card.hideTitleOnSingle && cards.length === 1)

  return (
    <section className="space-y-4" data-testid="list-tab" data-kind={listKind}>
      {showTitle && <h2 className="text-section-title">{title}</h2>}
      <EntityGrid cards={cards} accent={cfg.card.accent ?? undefined} expandable={cfg.card.expandable} dense={dense} emptyTitle={t('list.view.empty')} />
      {onLoadMore && hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onLoadMore} loading={loadingMore}>{t('list.view.loadMore')}</Button>
        </div>
      )}
    </section>
  )
}
