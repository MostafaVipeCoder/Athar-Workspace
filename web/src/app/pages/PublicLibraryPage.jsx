import { lazy, Suspense, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { usePublicLibrary } from '../../data/library.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { parseRef } from '../../lib/links.js'
import { setPageMeta } from '../../lib/meta.js'
import '../../nodes/library/i18n.js'

const LibraryTab = lazy(() => import('../../nodes/library/LibraryTab.jsx'))

/**
 * /view/:nodeRef/library-tab - a library on its own public page (public link kind 'view', view_key 'library-tab'). The DB
 * decides the audience (anon: public libraries, only `public` resources; participants: platform libraries and
 * `participants` resources; PMs: everything) and whitelists the payload; files open through short-lived signed URLs.
 */
export default function PublicLibraryPage() {
  const { nodeRef } = useParams()
  const { t, pick } = useLanguage()
  const ref = parseRef(nodeRef)
  const query = usePublicLibrary(ref.kind === 'invalid' ? null : ref.value)
  const payload = query.data

  useEffect(() => {
    if (payload) setPageMeta({ title: pick(payload, 'title') || t('library.view.default') })
  }, [payload, pick, t])

  if (ref.kind === 'invalid') return <EmptyState icon={Lock} title={t('library.view.notFound')} body={t('library.view.notFoundBody')} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!payload) return <EmptyState icon={Lock} title={t('library.view.notFound')} body={t('library.view.notFoundBody')} />

  return (
    <div className="py-4" data-testid="public-library-page" data-audience={payload.viewer}>
      <Suspense fallback={<Loading />}>
        <LibraryTab data={payload.data} title={pick(payload, 'title') || t('library.view.default')} audience={payload.viewer} />
      </Suspense>
    </div>
  )
}
