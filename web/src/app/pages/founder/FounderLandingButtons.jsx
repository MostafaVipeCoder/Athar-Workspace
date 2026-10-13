import { Link } from 'react-router-dom'
import { Share2 } from 'lucide-react'
import { useFounderLandings } from '../../../data/landing.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import '../../../nodes/landing-page/i18n.js'

/**
 * Founder exposure of the Landing Page node (docs/13 section 11, design 01 section 3.9 `showToParticipants`): one button per landing page the PM
 * exposed (show_to_participants + platform/public visibility + an own public link), labelled with the node's name, opening the page
 * (`/view/<ref>/landing`). Nothing is rendered while nothing is exposed. The step-8 founder Program page embeds this component.
 */
export default function FounderLandingButtons({ projectId, items, className }) {
  const { t, pick, lang } = useLanguage()
  // `items` = the rows the Program page already holds (get_founder_program_page): no second request
  const q = useFounderLandings(projectId, { enabled: Boolean(projectId) && !items })
  const list = (items ?? q.data ?? []).filter((l) => l.ref)
  if (!list.length) return null
  return (
    <div className={className} data-testid="founder-landing-buttons">
      {list.map((l) => (
        <Link key={l.node_id} to={`/view/${encodeURIComponent(l.ref)}/landing?lang=${lang}`} className={buttonClass({ variant: 'primary', size: 'md' })} aria-label={t('landing.founder.open', { name: pick(l, 'name') })}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {pick(l, 'name') || t('landing.founder.button')}
        </Link>
      ))}
    </div>
  )
}
