import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { ErrorState } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'

const TONE = { pending: 'bg-accent text-accent-foreground', accepted: 'bg-success/10 text-success-text', revoked: 'bg-muted text-muted-foreground', expired: 'bg-muted text-muted-foreground' }

/** Invitations with status; a pending one can be revoked. The clear token is never shown here (hashed in the DB). */
export default function InvitationsList({ query, programName, onRevoke }) {
  const { t, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
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

  return (
    <section className="space-y-2" data-testid="invitations">
      <h2 className="font-semibold">{t('staff.invitations')}</h2>
      <ul className="divide-y rounded-card border bg-card">
        {rows.map((inv) => {
          const status = inv.status === 'pending' && new Date(inv.expires_at) < new Date() ? 'expired' : inv.status
          return (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium" dir="ltr">{inv.email}</p>
                <p className="text-xs text-muted-foreground">
                  {inv.roles.map((r) => t(`role.${r}`)).join(', ')}
                  {inv.program_ids.length ? ` · ${inv.program_ids.map(programName).join(', ')}` : ''}
                  {` · ${t('staff.expires', { date: formatDate(inv.expires_at) })}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[status]}`}>{t(`staff.status.${status}`)}</span>
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
