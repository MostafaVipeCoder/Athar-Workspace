import { lazy } from 'react'
import { BookOpen, CalendarClock, CalendarDays, FileText, MapPin, Medal, Share2 } from 'lucide-react'
import { UsersIcon } from '../../../../ui/icons/brand/index.js'

/**
 * THE founder block registry (design 06 section 10.2): `type` (as the DB names it) -> { icon, Component }. The page renders the
 * blocks in SERVER order and ignores a type that is not here (forward compatible). Every block is a lazy chunk, so a founder who
 * has no mentors list never downloads the entity grid, and so on. Titles / nav labels live in the founder dictionary
 * (`founder.block.<type>`, `founder.nav.<type>`).
 */
export const BLOCKS = {
  description: { icon: FileText, Component: lazy(() => import('./DescriptionBlock.jsx')) },
  agenda: { icon: CalendarDays, Component: lazy(() => import('./AgendaBlock.jsx')) },
  mentors: { icon: UsersIcon, Component: lazy(() => import('./PeopleBlock.jsx')) },
  companies: { icon: UsersIcon, Component: lazy(() => import('./PeopleBlock.jsx')) },
  details: { icon: MapPin, Component: lazy(() => import('./LocationBlock.jsx')) },
  library: { icon: BookOpen, Component: lazy(() => import('./LibraryBlock.jsx')) },
  landing: { icon: Share2, Component: lazy(() => import('./LandingBlock.jsx')) },
  schedule: { icon: CalendarClock, Component: lazy(() => import('./MyScheduleBlock.jsx')) },
  certificate: { icon: Medal, Component: lazy(() => import('./CertificateBlock.jsx')) },
}

export const isKnownBlock = (type) => Object.prototype.hasOwnProperty.call(BLOCKS, type)
