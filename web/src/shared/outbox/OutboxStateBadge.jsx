import { Ban, CircleCheck, CirclePause, CircleX, Clock, LoaderCircle, TriangleAlert } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { cn } from '../../lib/cn.js'
import { STATE_TONE, stateKey, stateOf } from '../../lib/outbox.js'

const ICON = { queued: Clock, blocked: CirclePause, sending: LoaderCircle, sent: CircleCheck, failed: CircleX, needs_review: TriangleAlert, cancelled: Ban }

/**
 * The delivery state of one e-mail (m62): queued | blocked (waiting, with a reason elsewhere) | sending | sent | failed | needs_review | cancelled.
 * Colour is never the only signal: every state has its own icon and its own word (WCAG 1.4.1). Pass the whole row (`row.state` is the server's word)
 * or a bare `state`.
 */
export function OutboxStateBadge({ row, state, prefix = null, suffix = null, className, withIcon = true, ...rest }) {
  const { t } = useLanguage()
  const s = state ?? stateOf(row)
  const Icon = ICON[s] ?? Clock
  // "Confirmation · Queued ×2": an optional prefix (what e-mail) and suffix (how many) around the state word, in ONE text node
  const label = [prefix ? `${prefix} ·` : null, t(stateKey(s)), suffix].filter(Boolean).join(' ')
  return (
    <Badge tone={STATE_TONE[s] ?? 'neutral'} className={className} data-state={s} {...rest}>
      {withIcon && <Icon className={cn('h-3.5 w-3.5 shrink-0', s === 'sending' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />}
      {label}
    </Badge>
  )
}

export default OutboxStateBadge
