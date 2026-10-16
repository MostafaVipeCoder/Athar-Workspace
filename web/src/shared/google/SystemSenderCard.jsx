import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, Unplug, Users } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { ErrorState, SkeletonList } from '../../ui/States.jsx'
import { startGoogleConnect, useGoogleConnectionsAdmin, useGoogleMutations } from '../../data/google.js'
import { redirectTo, stateTone, systemState } from '../../lib/google.js'

const rowState = (c) => (c.status === 'active' ? 'connected' : c.status === 'needs_reconnect' ? 'needs_reconnect' : 'revoked')

/**
 * super_admin only (the server re-checks): the system sender (startups@athareg.com) that sends when a project manager has not connected
 * Google, linked ONCE through the same OAuth flow, plus an overview of everybody's connection (metadata only: no token exists in the browser).
 */
export default function SystemSenderCard({ status }) {
  const { t, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const location = useLocation()
  const { disconnect } = useGoogleMutations()
  const [opening, setOpening] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const overview = useGoogleConnectionsAdmin({ enabled: showAll })
  const state = systemState(status)
  const when = (v) => (v ? formatDate(v, { dateStyle: 'medium', timeStyle: 'short' }) : t('google.overview.never'))

  async function connect() {
    setOpening(true)
    try {
      const { url } = await startGoogleConnect({ system: true, returnTo: location.pathname })
      redirectTo(url)
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'google.err.server_error'))
      setOpening(false)
    }
  }

  async function onDisconnect() {
    const ok = await confirm({ title: t('google.system.confirmTitle'), message: t('google.system.confirmBody'), confirmLabel: t('google.confirm.action'), destructive: true })
    if (!ok) return
    try {
      const r = await disconnect.mutateAsync({ system: true })
      toast[r?.revoked_at_google === false ? 'warning' : 'success'](t(r?.revoked_at_google === false ? 'google.toast.disconnectedLocal' : 'google.toast.disconnected'))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'google.err.server_error'))
    }
  }

  return (
    <section aria-labelledby="google-system-title" className="space-y-3 rounded-card border border-dashed border-input p-4" data-testid="google-system">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="google-system-title" className="font-semibold">{t('google.system.titleFull')}</h3>
        <Badge tone={stateTone(state)} data-testid="google-system-status">{t(`google.status.${state}`)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t('google.system.body')}</p>
      <div role="status" className="rounded-md bg-surface p-3 text-sm">
        {state === 'not_connected' && <p>{t('google.system.none')}</p>}
        {state !== 'not_connected' && (
          <>
            <p className="font-medium">{t('google.system.connectedAs', { email: '' })}<bdi dir="ltr" className="font-semibold">{status.system.email}</bdi></p>
            <p className="text-xs text-muted-foreground">{t('google.mine.since', { date: when(status.system.connected_at) })} · {status.system.last_used_at ? t('google.mine.lastUsed', { date: when(status.system.last_used_at) }) : t('google.mine.neverUsed')}</p>
          </>
        )}
        {state === 'needs_reconnect' && <p className="mt-1 text-xs">{t('google.system.needsReconnect')}</p>}
      </div>
      <p className="text-xs text-muted-foreground">{t('google.system.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant={state === 'connected' ? 'outline' : 'primary'} loading={opening} onClick={connect} data-testid="google-system-connect">
          {opening ? t('google.action.connecting') : t(state === 'not_connected' ? 'google.system.connect' : 'google.system.reconnect')}
        </Button>
        {state !== 'not_connected' && (
          <Button variant="ghost" onClick={onDisconnect} loading={disconnect.isPending} data-testid="google-system-disconnect">
            <Unplug className="h-4 w-4" aria-hidden="true" />
            {t('google.system.disconnect')}
          </Button>
        )}
      </div>

      <div className="border-t pt-3">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          aria-controls="google-overview"
          className="flex min-h-11 w-full items-center gap-2 rounded-md text-start text-sm font-medium hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="google-overview-toggle"
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          <span className="flex-1">{t('google.overview.title')}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <div id="google-overview" hidden={!showAll} className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">{t('google.overview.hint')}</p>
          {showAll && overview.isPending && <SkeletonList count={3} itemClassName="h-9 w-full" />}
          {showAll && overview.isError && <ErrorState error={overview.error} onRetry={() => overview.refetch()} />}
          {showAll && overview.data && overview.data.length === 0 && <p className="text-sm text-muted-foreground">{t('google.overview.empty')}</p>}
          {showAll && overview.data && overview.data.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm" data-testid="google-overview-table">
                <caption className="sr-only">{t('google.overview.title')}</caption>
                <thead>
                  <tr className="border-b text-start text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">{t('google.overview.person')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">{t('google.overview.account')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">{t('google.overview.status')}</th>
                    <th scope="col" className="py-2 text-start font-medium">{t('google.overview.lastUsed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.map((c) => {
                    const s = rowState(c)
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-2 pe-3">{c.is_system ? t('google.overview.system') : c.owner_name || <bdi dir="ltr">{c.owner_email ?? '-'}</bdi>}</td>
                        <td className="py-2 pe-3"><bdi dir="ltr">{c.email}</bdi></td>
                        <td className="py-2 pe-3"><Badge tone={s === 'revoked' ? 'outline' : stateTone(s)}>{s === 'revoked' ? t('google.overview.revoked') : t(`google.status.${s}`)}</Badge></td>
                        <td className="py-2 text-muted-foreground">{when(c.last_used_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
