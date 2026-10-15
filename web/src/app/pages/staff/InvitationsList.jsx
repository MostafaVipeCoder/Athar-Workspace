import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { ErrorState } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import '../../../shared/outbox/i18n.js'
import { OutboxStateBadge } from '../../../shared/outbox/OutboxStateBadge.jsx'
import { useOutboxMutations, useStaffInvitationDelivery } from '../../../data/outbox.js'
import { explanationKey, stateOf } from '../../../lib/outbox.js'

const TONE = { pending: 'bg-accent text-accent-foreground', accepted: 'bg-success/10 text-success-text', revoked: 'bg-muted text-muted-foreground', expired: 'bg-muted text-muted-foreground' }

/** Invitations with status; a pending one can be revoked. The clear token is never shown here (hashed in the DB). */
export default function InvitationsList({ query, programName, onRevoke }) {
  const { t, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  // m62: the REAL delivery state of each invitation e-mail (queued / sent / waiting / failed ...), refreshed while one is on its way; hidden when it cannot be read
  const delivery = useStaffInvitationDelivery()
  const outbox = useOutboxMutations()
  const deliveryOf = (inv) => (delivery.data ?? []).find((d) => d.invitation_id === inv.id) ?? null
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />
  const rows = query.data ?? []
  if (rows.length === 0) return null

  async function revoke(inv) {
    if (!(await confirm({ title: t('staff.revokeTitle'), message: t('staff.revokeBody', { email: inv.email }), destructive: true, confirmLabel: t('staff.revoke') }))) return
    try {
      await onRevoke(inv.id)
      toast.success(t('staff.revoked'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  async function retryMail(d) {
    try {
      // a failed e-mail is retried; one whose outcome is unknown is sent again ON PURPOSE (confirmed: the first copy may have arrived)
      if (d.status === 'needs_review') {
        if (!(await confirm({ title: t('outbox.confirm.resend.title', { count: 1 }), message: t('outbox.confirm.resend.body'), destructive: true, confirmLabel: t('outbox.confirm.resend.action') }))) return
        await outbox.resend.mutateAsync({ ids: [d.outbox_id] })
      } else {
        await outbox.retry.mutateAsync({ ids: [d.outbox_id] })
      }
      toast.success(t('outbox.toast.done', { updated: 1 }))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <section className="space-y-2" data-testid="invitations">
      <h2 className="font-semibold">{t('staff.invitations')}</h2>
      <ul className="divide-y rounded-card border bg-card">
        {rows.map((inv) => {
          const status = inv.status === 'pending' && new Date(inv.expires_at) < new Date() ? 'expired' : inv.status
          const d = status === 'pending' ? deliveryOf(inv) : null
          const dState = d ? stateOf(d) : null
          const why = d && ['blocked', 'failed', 'needs_review'].includes(dState) ? explanationKey(d) : null
          return (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium" dir="ltr">{inv.email}</p>
                <p className="text-xs text-muted-foreground">
                  {inv.roles.map((r) => t(`role.${r}`)).join(', ')}
                  {inv.program_ids.length ? ` · ${inv.program_ids.map(programName).join(', ')}` : ''}
                  {` · ${t('staff.expires', { date: formatDate(inv.expires_at) })}`}
                </p>
                {d && (
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" data-testid="invitation-delivery">
                    <span>{t('outbox.staff.delivery')}:</span>
                    <OutboxStateBadge state={dState} data-testid="invitation-delivery-state" />
                    {dState === 'sent' && d.sender_email && <span dir="ltr">{t('outbox.staff.delivery.sentFrom', { email: d.sender_email })}</span>}
                    {why && <span className="basis-full" data-testid="invitation-delivery-why">{dState === 'needs_review' ? t('outbox.staff.delivery.review') : `${t(why)} ${dState === 'failed' ? t('outbox.staff.delivery.manual') : ''}`}</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[status]}`}>{t(`staff.status.${status}`)}</span>
                {d && ['failed', 'needs_review'].includes(dState) && (
                  <Button variant="outline" size="sm" onClick={() => retryMail(d)} data-testid="invitation-retry-mail">{t('outbox.staff.delivery.retry')}</Button>
                )}
                {status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(inv)}>{t('staff.revoke')}</Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
