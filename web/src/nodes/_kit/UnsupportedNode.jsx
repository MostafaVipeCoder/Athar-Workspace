import { PackageX } from 'lucide-react'
import { EmptyState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** Shown for a node whose type is unknown or newer than this client (design 06 section 4.5): never crashes. */
export default function UnsupportedNode({ node }) {
  const { t, pick } = useLanguage()
  return (
    <EmptyState
      icon={PackageX}
      title={`${t('node.unsupportedTitle')}: ${pick(node, 'name') || node?.id}`}
      body={t('node.unsupportedBody', { type: node?.type ?? '?' })}
    />
  )
}
