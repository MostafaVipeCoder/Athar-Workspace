import { lazy, Suspense, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { usePublicList, getPublicList } from '../../data/lists.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { parseRef } from '../../lib/links.js'
import '../../nodes/list/i18n.js'

const ListTab = lazy(() => import('../../nodes/list/ListTab.jsx'))
const PUBLIC_PAGE_SIZE = 100 // = ListTab.PUBLIC_PAGE_SIZE (not imported eagerly so the tab stays a lazy chunk)

/**
 * /view/:nodeRef/list-tab - a list on its own public page (public link kind 'view', view_key 'list-tab'). The DB
 * decides the audience (anon: public lists only; participants: platform; PMs: everything) and whitelists the payload.
 * Pagination: the payload's `next` cursor -> getPublicList(ref, after) appends a page.
 */
export default function PublicListPage() {
  const { nodeRef } = useParams()
  const { t, pick } = useLanguage()
  const ref = parseRef(nodeRef)
  const query = usePublicList(ref.kind === 'invalid' ? null : ref.value)
  const [extra, setExtra] = useState({ for: null, items: [], next: null, lastCount: null, loading: false, error: null })

  const payload = query.data
  useEffect(() => {
    if (payload) document.title = `${pick(payload, 'title') || 'Athar'} - Athar`
  }, [payload, pick])

  const appended = extra.for === payload?.revision
  const data = payload?.data ? { ...payload.data, items: [...payload.data.items, ...(appended ? extra.items : [])], next: appended ? extra.next : payload.data.next } : null
  const lastCount = appended ? extra.lastCount : payload?.data?.items?.length ?? 0
  const hasMore = Boolean(data?.next) && lastCount >= PUBLIC_PAGE_SIZE

  async function loadMore() {
    setExtra((s) => ({ ...s, for: payload.revision, loading: true, error: null }))
    try {
      const page = await getPublicList(ref.value, data.next)
      const rows = page?.data?.items ?? []
      setExtra((s) => ({ for: payload.revision, items: [...(s.for === payload.revision ? s.items : []), ...rows], next: page?.data?.next ?? null, lastCount: rows.length, loading: false, error: null }))
    } catch (e) {
      setExtra((s) => ({ ...s, loading: false, error: e }))
    }
  }

  if (ref.kind === 'invalid') return <EmptyState icon={Lock} title={t('list.view.notFound')} body={t('list.view.notFoundBody')} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!payload) return <EmptyState icon={Lock} title={t('list.view.notFound')} body={t('list.view.notFoundBody')} />

  return (
    <div className="py-4" data-testid="public-list-page" data-audience={payload.viewer}>
      <Suspense fallback={<Loading />}>
        <ListTab data={data} title={pick(payload, 'title')} audience={payload.viewer} onLoadMore={loadMore} hasMore={hasMore} loadingMore={extra.loading} />
      </Suspense>
      {extra.error && <ErrorState error={extra.error} onRetry={loadMore} className="mt-3" />}
    </div>
  )
}
