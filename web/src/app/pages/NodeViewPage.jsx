import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import ComingSoon from './ComingSoon.jsx'
import PublicListPage from './PublicListPage.jsx'
import { Loading } from '../../ui/States.jsx'

const PublicLibraryPage = lazy(() => import('./PublicLibraryPage.jsx'))

/**
 * /view/:nodeRef/:viewKey - generic full-screen node view (design 06 section 2.4). Dispatches on the view key; keys
 * must avoid the legacy `experts|startups|library|join-athar` (PROGRESS deviation 7). Built so far: `list-tab`, `library-tab`.
 */
export default function NodeViewPage() {
  const { viewKey } = useParams()
  if (viewKey === 'list-tab') return <PublicListPage />
  if (viewKey === 'library-tab') return <Suspense fallback={<Loading />}><PublicLibraryPage /></Suspense>
  return <ComingSoon step={7} what={`node view "${viewKey}"`} />
}
