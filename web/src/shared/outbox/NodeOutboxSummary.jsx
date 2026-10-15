import { Link } from 'react-router-dom'
import { Mail, Send } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { cn } from '../../lib/cn.js'
import { staffPath } from '../../lib/links.js'
import { attentionCount, nodeCounts, totalCount } from '../../lib/outbox.js'
import { useOutboxCounts, useOutboxMutations } from '../../data/outbox.js'
import { sendNowMessage } from './sendNowMessage.js'

/**
 * Delivery state of the e-mails ONE node sent (Selection E-mails tab, Booking Bookings tab), from the light counts RPC of the project:
 * "12 sent, 2 on the way, 1 need attention", a link into the Outbox filtered to this node and - while something waits - "Send waiting
 * e-mails now" (the same action as the Outbox page: due now + the worker is kicked). Refreshes by itself only while mail is on its way.
 */
export function NodeOutboxSummary({ projectId, nodeId, className }) {
  const { t } = useLanguage()
  const toast = useToast()
  const counts = useOutboxCounts(projectId)
  const m = useOutboxMutations(projectId)
  if (counts.isPending || counts.isError) return null // a secondary line: never an error box on the node itself
  const c = nodeCounts(counts.data, nodeId)
  if (totalCount(c) === 0) return <p className={cn('text-xs text-muted-foreground', className)} data-testid="node-outbox-none">{t('outbox.node.none')}</p>
  const attention = attentionCount(c)
  const onTheWay = (c.queued ?? 0) + (c.sending ?? 0)
  const waiting = (c.queued ?? 0) + (c.blocked ?? 0)

  async function sendNow() {
    try {
      const r = await m.sendNow.mutateAsync({ project: projectId })
      toast.success(t(sendNowMessage(r), { released: r?.released ?? 0 }))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <div role="status" className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-surface/60 px-3 py-2 text-sm', attention > 0 && 'border-accent bg-accent/30', className)} data-testid="node-outbox" data-attention={attention}>
      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{t('outbox.node.title')}</span>
      <span data-testid="node-outbox-line">{t('outbox.node.line', { sent: c.sent ?? 0, onTheWay, attention })}</span>
      <span className="ms-auto flex flex-wrap items-center gap-2">
        {waiting > 0 && (
          <Button size="sm" variant="outline" onClick={sendNow} loading={m.sendNow.isPending} data-testid="node-outbox-send-now">
            <Send className="h-4 w-4" aria-hidden="true" />{t('outbox.node.sendNow')}
          </Button>
        )}
        <Link to={`${staffPath.projectOutbox(projectId)}?node=${nodeId}${attention > 0 ? '&state=attention' : ''}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9" data-testid="node-outbox-open">
          {t(attention > 0 ? 'outbox.node.openFiltered' : 'outbox.node.open')}
        </Link>
      </span>
    </div>
  )
}

export default NodeOutboxSummary
