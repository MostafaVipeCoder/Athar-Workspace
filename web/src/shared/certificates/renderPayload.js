import { signedTemplateUrl } from '../../data/certificates.js'
import { buildPublicUrl } from '../../lib/links.js'
import { certValues, fieldFromRow } from '../../lib/certificates/layout.js'
import { canvasToBlob, certificateFileName, renderCertificate } from '../../lib/certificates/render.js'
import { canvasToPdfBlob } from '../../lib/certificates/pdf.js'
import { loadTemplateImage } from '../../lib/certificates/templateFile.js'

/**
 * Render an ISSUED certificate from the server's render payload (`get_certificate_render_payload` for the PM and the owner,
 * `get_public_certificate_verification().render` for the public verifier): { code, snapshot, template { file_path, language,
 * width_px, height_px }, fields[] }. The template image is fetched through a short-lived signed URL (the m38 storage policy decides
 * who may sign it) and decoded once per path per session; fonts, drawing and the local QR are lib/certificates/render.js.
 */
const images = new Map()

/** The decoded template image of a payload (cached per storage path; a failed load is forgotten so a retry can succeed). */
export function loadPayloadImage(payload, { sign = signedTemplateUrl, load = loadTemplateImage } = {}) {
  const path = payload.template.file_path
  if (!images.has(path)) {
    if (images.size >= 6) images.delete(images.keys().next().value)
    const job = sign(path).then((url) => load(url))
    images.set(path, job)
    job.catch(() => images.delete(path))
  }
  return images.get(path)
}
/** Test hook. */
export const _clearImageCache = () => images.clear()

/** The URL the QR encodes: the public verifier page of THIS app (never a third party). */
export const verifyUrlOf = (code) => buildPublicUrl('verify', code)

/** Draw the payload into `canvas` (preview: pass `scale`; download: the native size, capped by renderCertificate's maxSide). */
export async function renderPayloadToCanvas(payload, canvas, { scale = 1, maxSide, deps } = {}) {
  const { image } = await loadPayloadImage(payload, deps)
  const lang = payload.template.language === 'ar' ? 'ar' : 'en'
  return renderCertificate({
    canvas, image, scale, maxSide,
    fields: (payload.fields ?? []).map(fieldFromRow),
    values: certValues(payload.snapshot, payload.code, lang),
    verifyUrl: verifyUrlOf(payload.code),
  })
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Render at full resolution and download as `png` or `pdf` (file name = the printed PERSON name + the code: each founder's file carries his own name). */
export async function downloadCertificate(payload, kind = 'png') {
  const canvas = document.createElement('canvas')
  await renderPayloadToCanvas(payload, canvas)
  const name = payload.snapshot?.person_name ?? payload.snapshot?.participant_name
  if (kind === 'pdf') saveBlob(await canvasToPdfBlob(canvas, { title: `Certificate ${name ?? ''}` }), certificateFileName(name, payload.code, 'pdf'))
  else saveBlob(await canvasToBlob(canvas, 'image/png'), certificateFileName(name, payload.code, 'png'))
  canvas.width = 0
  canvas.height = 0
}
