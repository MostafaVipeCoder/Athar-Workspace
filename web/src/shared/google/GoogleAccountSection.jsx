import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, CircleCheck, Mail, ShieldCheck, TriangleAlert, Unplug } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { ErrorState, SkeletonList } from '../../ui/States.jsx'
import { startGoogleConnect, useGoogleMutations, useGoogleStatus } from '../../data/google.js'
import { GOOGLE_ERROR_CODES, ltr, mineState, parseGoogleReturn, redirectTo, stateTone, stripGoogleParams } from '../../lib/google.js'
import SystemSenderCard from './SystemSenderCard.jsx'

/**
 * Profile > "Google account" (decision 20.6): the real state of the acting user's connection (connected as <email> / not connected / needs
 * reconnecting), Connect / Reconnect / Disconnect (with a confirm), what the platform will do from the account, and, for a super_admin,
 * the system sender (startups@athareg.com). The browser only ever handles metadata: the token never reaches it.
 * Google sends the browser back here with ?google=connected | ?google=error&reason=<code>: the message is shown once and the URL is cleaned.
 */
export default function GoogleAccountSection() {
  const { t, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const location = useLocation()
  const navigate = useNavigate()
  const status = useGoogleStatus()
  const { disconnect, refresh } = useGoogleMutations()
  const [opening, setOpening] = useState(false)
  const handled = useRef(false)

  // the return from Google: one message, then a clean URL (a reload must not repeat it)
  useEffect(() => {
    if (handled.current) return
    const ret = parseGoogleReturn(location.search)
    if (!ret.result) return
    handled.current = true
    if (ret.result === 'connected') toast.success(t(ret.system ? 'google.toast.connectedSystem' : 'google.toast.connected'))
    else toast.error(t(`google.reason.${ret.reason}`))
    refresh()
    navigate({ pathname: location.pathname, search: stripGoogleParams(location.search) }, { replace: true })
  }, [location.pathname, location.search, navigate, refresh, t, toast])

  async function connect() {
    setOpening(true)
    try {
      const { url } = await startGoogleConnect({ system: false, returnTo: location.pathname })
      redirectTo(url) // leaves the app: Google's consent screen, then back here
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'google.err.server_error'))
      setOpening(false)
    }
  }

  async function onDisconnect() {
    const email = status.data?.mine?.email ?? ''
    const ok = await confirm({ title: t('google.confirm.title'), message: t('google.confirm.body', { email: ltr(email) }), confirmLabel: t('google.confirm.action'), destructive: true })
    if (!ok) return
    try {
      const r = await disconnect.mutateAsync({ system: false })
      toast[r?.revoked_at_google === false ? 'warning' : 'success'](t(r?.revoked_at_google === false ? 'google.toast.disconnectedLocal' : 'google.toast.disconnected'))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'google.err.server_error'))
    }
  }

  const data = status.data
  const mine = mineState(data)
  const systemEmail = data?.system?.status === 'active' ? data.system.email : null
  const when = (v) => formatDate(v, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <section aria-labelledby="google-account-title" className="space-y-4 rounded-card border bg-card p-4" data-testid="google-account">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="google-account-title" className="flex items-center gap-2 font-semibold">
          <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('google.section.title')}
        </h2>
        {data && <Badge tone={stateTone(mine)} data-testid="google-status">{t(`google.status.${mine}`)}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{t('google.section.intro')}</p>

      {status.isPending && <SkeletonList count={2} itemClassName="h-10 w-full" />}
      {status.isError && <ErrorState error={status.error} onRetry={() => status.refetch()} />}

      {data && (
        <div role="status" className="space-y-2 rounded-md bg-surface p-3 text-sm" data-testid="google-mine">
          {mine === 'connected' && (
            <>
              <p className="flex items-start gap-2 font-medium">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-text" aria-hidden="true" />
                <span>{t('google.mine.connectedAs', { email: '' })}<bdi dir="ltr" className="font-semibold">{data.mine.email}</bdi></span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t('google.mine.since', { date: when(data.mine.connected_at) })} · {data.mine.last_used_at ? t('google.mine.lastUsed', { date: when(data.mine.last_used_at) }) : t('google.mine.neverUsed')}
              </p>
            </>
          )}
          {mine === 'needs_reconnect' && (
            <>
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden="true" />
                <span>{t('google.mine.needsReconnect')}</span>
              </p>
              {data.mine.last_error && <p className="text-xs text-muted-foreground">{t('google.mine.errorCode', { reason: t(`google.code.${GOOGLE_ERROR_CODES.includes(data.mine.last_error) ? data.mine.last_error : 'needs_reconnect'}`) })}</p>}
              <p className="text-xs text-muted-foreground">{systemEmail ? t('google.mine.needsReconnectFallback', { system: systemEmail }) : t('google.mine.notConnectedNoSystem')}</p>
            </>
          )}
          {mine === 'not_connected' && (
            <>
              <p className="font-medium">{t('google.mine.notConnected')}</p>
              <p className="text-xs text-muted-foreground">{systemEmail ? t('google.mine.notConnectedFallback', { system: systemEmail }) : t('google.mine.notConnectedNoSystem')}</p>
            </>
          )}
        </div>
      )}

      {data && (
        <div className="flex flex-wrap gap-2">
          <Button variant={mine === 'connected' ? 'outline' : 'primary'} loading={opening} onClick={connect} data-testid="google-connect">
            {opening ? t('google.action.connecting') : t(mine === 'not_connected' ? 'google.action.connect' : 'google.action.reconnect')}
          </Button>
          {mine !== 'not_connected' && (
            <Button variant="ghost" onClick={onDisconnect} loading={disconnect.isPending} data-testid="google-disconnect">
              <Unplug className="h-4 w-4" aria-hidden="true" />
              {t('google.action.disconnect')}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1.5 text-sm">
        <h3 className="font-medium">{t('google.section.willSend')}</h3>
        <ul className="space-y-1.5 text-muted-foreground">
          <li className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{t('google.section.send.mail')}</span></li>
          <li className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{t('google.section.send.calendar')}</span></li>
          <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{t('google.section.send.never')}</span></li>
        </ul>
        <p className="text-xs text-muted-foreground">{t('google.section.revokeHint')}</p>
      </div>

      {data?.is_super_admin && <SystemSenderCard status={data} />}
    </section>
  )
}
