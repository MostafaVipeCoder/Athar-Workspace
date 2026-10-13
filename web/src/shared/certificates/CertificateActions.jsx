import { lazy, Suspense, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileText } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { getRenderPayload } from '../../data/certificates.js'
import { keys } from '../../data/queryKeys.js'
import '../../nodes/certificates/i18n.js'

const CertificateView = lazy(() => import('./CertificateView.jsx'))

/**
 * Preview / download PNG / download PDF of ONE issued certificate (founder "My certificate", the PM's Issue panel). The render
 * payload is fetched on demand (`get_certificate_render_payload` re-checks who may have it); the heavy renderer (canvas, QR, PDF
 * writer) is a lazy chunk that loads on the first click, so listing certificates costs nothing.
 */
export default function CertificateActions({ certificateId, name, compact = false }) {
  const { t } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const payloadQuery = useQuery({ queryKey: keys.certificatePayload(certificateId), queryFn: () => getRenderPayload(certificateId), enabled: open, staleTime: 60_000 })

  async function download(kind) {
    setBusy(kind)
    try {
      const payload = await qc.fetchQuery({ queryKey: keys.certificatePayload(certificateId), queryFn: () => getRenderPayload(certificateId), staleTime: 60_000 })
      const { downloadCertificate } = await import('./renderPayload.js')
      await downloadCertificate(payload, kind)
    } catch (e) {
      toast.error(t(e?.messageKey && e.messageKey !== 'errors.unknown' ? e.messageKey : 'certificates.view.downloadFailed'))
    } finally {
      setBusy(null)
    }
  }

  const size = compact ? 'sm' : 'md'
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="certificate-actions">
      <Button size={size} variant="outline" onClick={() => setOpen(true)} aria-label={t('certificates.actions.previewFor', { name })} data-testid="cert-preview">
        <Eye className="h-4 w-4" aria-hidden="true" />{t('certificates.actions.preview')}
      </Button>
      <Button size={size} variant={compact ? 'outline' : 'primary'} loading={busy === 'png'} disabled={busy !== null} onClick={() => download('png')} aria-label={t('certificates.actions.pngFor', { name })} data-testid="cert-download-png">
        <Download className="h-4 w-4" aria-hidden="true" />PNG
      </Button>
      <Button size={size} variant="outline" loading={busy === 'pdf'} disabled={busy !== null} onClick={() => download('pdf')} aria-label={t('certificates.actions.pdfFor', { name })} data-testid="cert-download-pdf">
        <FileText className="h-4 w-4" aria-hidden="true" />PDF
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={name || t('certificates.view.title')} closeLabel={t('common.close')} className="sm:max-w-3xl">
        {payloadQuery.error ? (
          <ErrorState error={payloadQuery.error} onRetry={payloadQuery.refetch} />
        ) : payloadQuery.isPending ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            <CertificateView payload={payloadQuery.data} />
          </Suspense>
        )}
      </Modal>
    </div>
  )
}
