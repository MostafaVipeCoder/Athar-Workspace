import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { CalendarX, Lock } from 'lucide-react'
import { cancelBooking, createBooking, usePublicBooking } from '../../data/booking.js'
import { Button } from '../../ui/Button.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useAuth } from '../AuthContext.js'
import { appBaseUrl, parseRef } from '../../lib/links.js'
import { setPageMeta } from '../../lib/meta.js'
import '../../nodes/booking/i18n.js'

const BookingPageView = lazy(() => import('../../nodes/booking/BookingPageView.jsx'))

/**
 * /book/:nodeRef/:hostRef? - the public booking page (design 06 section 2.4). The DB decides the audience through the
 * booking link (anon: public nodes; participants: platform; PMs: everything). Interview mode needs `?invite=<token>`
 * (the Selection stage's e-mail, decision 01-15). `?cancel=<booking>&token=<t>` is the self-service cancel link of the
 * confirmation e-mail. Legacy `/book/legacy/<provider id>` (old `#/book/:mentorId`): the provider id is both the link's
 * legacy ref and the host.
 */
export default function PublicBookingPage() {
  const { nodeRef, hostRef } = useParams()
  const location = useLocation()
  const { t, lang, pick } = useLanguage()
  const auth = useAuth()
  const search = useMemo(() => new URLSearchParams(location.search), [location.search])
  const invite = search.get('invite') || null
  const cancelId = search.get('cancel') || null
  const cancelToken = search.get('token') || null
  const legacy = nodeRef === 'legacy' && hostRef
  const ref = parseRef(legacy ? hostRef : nodeRef)
  const host = legacy ? hostRef : hostRef ? parseRef(hostRef).value : null
  const query = usePublicBooking(ref.kind === 'invalid' ? null : ref.value, { host: host && parseRef(host).kind === 'uuid' ? host : null, invite })
  const payload = query.data

  useEffect(() => {
    if (payload) setPageMeta({ title: pick(payload, 'name') || t('booking.public.title'), description: t('booking.public.intro') })
  }, [payload, pick, t])

  const prefill = auth?.status === 'authed' ? { name: auth.profile?.full_name ?? '', email: auth.user?.email ?? '' } : null

  async function onBook(slotId, booker, inviteToken) {
    try {
      const result = await createBooking(ref.value, slotId, booker, inviteToken)
      const cancelUrl = result?.cancel_token ? `${appBaseUrl()}/book/${encodeURIComponent(payload?.slug || ref.value)}?cancel=${result.booking_id}&token=${encodeURIComponent(result.cancel_token)}` : null
      query.refetch() // the booked slot leaves the list (the success card keeps its own copy)
      return { ok: true, result: { ...result, cancelUrl } }
    } catch (e) {
      const messageKey = e?.messageKey ?? 'errors.unknown'
      if (messageKey === 'booking.err.slotUnavailable' || messageKey === 'booking.err.slotTooSoon') query.refetch() // somebody else was faster: drop the stale slot
      return { ok: false, messageKey }
    }
  }

  if (ref.kind === 'invalid') return <EmptyState icon={Lock} title={t('booking.public.notFound')} body={t('booking.public.notFoundBody')} />
  if (cancelId && cancelToken) return <CancelFlow bookingId={cancelId} token={cancelToken} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!payload) {
    return (
      <EmptyState
        icon={Lock}
        title={t('booking.public.notFound')}
        body={t('booking.public.notFoundBody')}
        action={auth?.status !== 'authed'
          ? <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className="tap-target inline-flex items-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">{t('booking.public.signIn')}</Link>
          : <Link to="/" className="text-sm underline">{t('common.goHome')}</Link>}
      />
    )
  }

  return (
    <div data-testid="public-booking-page" data-audience={payload.audience} data-status={payload.status} lang={lang}>
      <Suspense fallback={<Loading />}>
        <BookingPageView payload={payload} host={host} prefill={prefill} onBook={onBook} invite={invite} />
      </Suspense>
    </div>
  )
}

/** `?cancel=<id>&token=<t>`: one confirmation, then the anon RPC. The DB checks the token. */
function CancelFlow({ bookingId, token }) {
  const { t } = useLanguage()
  const [state, setState] = useState('ask') // ask | busy | done | failed
  async function doCancel() {
    setState('busy')
    try {
      await cancelBooking(bookingId, token)
      setState('done')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="mx-auto max-w-narrow px-4 py-8" data-testid="cancel-flow" data-state={state}>
      {state === 'done' ? <EmptyState icon={CalendarX} title={t('booking.public.cancelDone')} />
        : state === 'failed' ? <EmptyState icon={Lock} title={t('booking.public.cancelFailed')} />
        : (
          <div className="panel space-y-4 p-5">
            <h1 className="text-card-title font-bold">{t('booking.public.cancelTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('booking.public.cancelBody')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={doCancel} loading={state === 'busy'} data-testid="cancel-confirm">{t('booking.public.cancelConfirm')}</Button>
              <Link to="/" className="tap-target inline-flex items-center rounded-md border border-input bg-background px-3 text-sm font-medium">{t('common.back')}</Link>
            </div>
          </div>
        )}
    </div>
  )
}
