import { Link } from 'react-router-dom'
import { Library } from 'lucide-react'
import { useFounderLibraries } from '../../../data/library.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import '../../../nodes/library/i18n.js'

/**
 * Founder exposure of the Resource Library node (docs/13 section 11, design 01 section 3.8): one "Resource Library" button
 * per library the PM exposed (show_to_participants + platform/public visibility), labelled with the node's name. It opens the
 * library's own page (`/view/<ref>/library-tab`) or, for a library that is a tab of the project page, that tab of the page.
 * Nothing is rendered while nothing is exposed. The step-8 founder Program page embeds this component (the `library` block).
 */
export default function FounderLibraryButtons({ projectId, items, className }) {
  const { t, pick, lang } = useLanguage()
  // `items` = the rows the Program page already holds (get_founder_program_page): no second request
  const q = useFounderLibraries(projectId, { enabled: Boolean(projectId) && !items })
  const list = (items ?? q.data ?? []).filter((l) => l.ref)
  if (!list.length) return null
  return (
    <div className={className} data-testid="founder-library-buttons">
      {list.map((l) => (
        <Link
          key={l.node_id}
          to={l.via === 'host' ? `/agenda/${encodeURIComponent(l.ref)}/library?lang=${lang}` : `/view/${encodeURIComponent(l.ref)}/library-tab?lang=${lang}`}
          className={buttonClass({ variant: 'primary', size: 'md' })}
          aria-label={t('library.founder.open', { name: pick(l, 'name') })}
        >
          <Library className="h-4 w-4" aria-hidden="true" />
          {pick(l, 'name') || t('library.founder.button')}
        </Link>
      ))}
    </div>
  )
}
