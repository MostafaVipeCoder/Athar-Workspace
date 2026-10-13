import { Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useBookingLink, usePublicBooking } from '../../data/booking.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import BookingPageView from './BookingPageView.jsx'

/** View mode (PM preview): the public booking page through the SAME component and the SAME RPC (audience = pm), bookings disabled. */
export default function BookingView() {
  const { node } = useNodeContext()
  const { t } = useLanguage()
  const link = useBookingLink(node.id)
  const ref = link.data?.slug ?? null
  const page = usePublicBooking(ref)

  return (
    <NodeFrame>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('booking.view.preview')}
      </p>
      {link.isPending ? <Loading /> : link.error ? <ErrorState error={link.error} onRetry={link.refetch} /> : !ref ? <EmptyState title={t('booking.view.noLink')} /> : page.isPending ? <Loading /> : page.error ? <ErrorState error={page.error} onRetry={page.refetch} /> : !page.data ? <EmptyState title={t('booking.view.noLink')} /> : (
        <>
          {page.data.mode === 'interview' && <p className="mb-3 text-xs text-muted-foreground" data-testid="interview-preview-note">{t('booking.view.interviewPreview')}</p>}
          <BookingPageView payload={page.data} preview onBook={async () => ({ ok: false, messageKey: 'errors.forbidden' })} />
        </>
      )}
    </NodeFrame>
  )
}
