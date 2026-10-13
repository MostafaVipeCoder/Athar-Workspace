import { useState } from 'react'
import { Users } from 'lucide-react'
import { getFounderBlock, useFounderBlock } from '../../../../data/founder.js'
import { useLanguage } from '../../../../i18n/LanguageProvider.jsx'
import ListTab, { PUBLIC_PAGE_SIZE } from '../../../../nodes/list/ListTab.jsx'
import { EmptyState } from '../../../../ui/States.jsx'
import { QueryBlock } from './BlockFrame.jsx'
import '../i18n.js'

/**
 * Mentors / companies of the program: the exposed list node rendered with the SAME ListTab (EntityGrid, whitelisted payload, the
 * list's own card settings) in compact cards. The first page comes from `get_founder_block`; "Show more" asks for the next cursor.
 * `type` is `mentors` or `companies` (the DB checks the list kind against it).
 */
export default function PeopleBlock({ block, projectId }) {
  const { t } = useLanguage()
  const type = block.type
  const nodeId = block.node_id
  const q = useFounderBlock(projectId, type, nodeId)
  // pages after the first one (the first page is the query): rows, the cursor of the last page asked for, whether it was full
  const [more, setMore] = useState({ items: [], cursor: null, full: null, loading: false })

  const first = q.data?.data ?? null
  const items = [...(first?.items ?? []), ...more.items]
  const lastWasFull = more.full ?? (first?.items?.length ?? 0) >= PUBLIC_PAGE_SIZE
  const cursor = more.cursor ?? first?.next ?? null

  async function loadMore() {
    setMore((m) => ({ ...m, loading: true }))
    try {
      const page = await getFounderBlock(projectId, type, nodeId, cursor)
      const rows = page?.data?.items ?? []
      setMore((m) => ({ items: [...m.items, ...rows], cursor: page?.data?.next ?? null, full: rows.length >= PUBLIC_PAGE_SIZE, loading: false }))
    } catch {
      setMore((m) => ({ ...m, loading: false }))
    }
  }

  return (
    <QueryBlock query={q} skeletonLines={3}>
      {!q.data ? (
        <EmptyState icon={Users} title={t('founder.block.unavailable')} />
      ) : items.length === 0 ? (
        <EmptyState icon={Users} title={t('founder.people.empty')} />
      ) : (
        <ListTab data={{ items, config: first?.config }} audience="participant" hideTitle dense onLoadMore={loadMore} hasMore={Boolean(cursor) && lastWasFull} loadingMore={more.loading} />
      )}
    </QueryBlock>
  )
}
