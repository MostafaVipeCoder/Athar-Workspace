import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { usePublicForm, submitPublicForm, trackFormEvent, uploadFormFile } from '../../data/forms.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useAuth } from '../AuthContext.js'
import { buildPublicUrl, canonicalRef, parseRef } from '../../lib/links.js'
import { parseServerFieldError, prefillFromSearch, trackingFromSearch } from '../../nodes/form-builder/formLogic.js'
import '../../nodes/form-builder/i18n.js'

const FormRenderer = lazy(() => import('../../nodes/form-builder/FormRenderer.jsx'))

/**
 * /forms/:ref - the public respondent form (design 06 section 2.4). The DB decides the audience through the public
 * link (anon: public forms; participants: platform; PMs: everything); submission goes through the anon RPC
 * `submit_public_form` which validates server-side (m31). Source tracking (?source=, utm_*) travels with the answers.
 */
export default function PublicFormPage() {
  const { ref: refParam } = useParams()
  const location = useLocation()
  const { t, lang, pick } = useLanguage()
  const auth = useAuth()
  const ref = parseRef(refParam)
  const query = usePublicForm(ref.kind === 'invalid' ? null : ref.value)
  const form = query.data
  const tracked = useRef(null)

  useEffect(() => {
    if (form) document.title = `${pick(form, 'name') || 'Athar'} - Athar`
  }, [form, pick])
  useEffect(() => {
    if (form && tracked.current !== form.node_id) {
      tracked.current = form.node_id
      trackFormEvent(ref.value, 'form_view')
    }
  }, [form, ref.value])

  const tracking = useMemo(() => trackingFromSearch(location.search, { referrer: typeof document !== 'undefined' ? document.referrer : '', lang }), [location.search, lang])
  const initialAnswers = useMemo(() => (form ? prefillFromSearch(form.questions ?? [], location.search) : {}), [form, location.search])
  const publicUrl = form ? buildPublicUrl('form', canonicalRef({ slug: form.slug, id: form.node_id })) : null

  async function onSubmit(answers, { website }) {
    try {
      const r = await submitPublicForm(ref.value, answers, tracking, website || null)
      return { ok: Boolean(r?.accepted ?? r?.id ?? true) }
    } catch (e) {
      if (e?.token === 'form_invalid') {
        const fe = parseServerFieldError(e.detail)
        // a known field: the renderer highlights it (no duplicate banner); otherwise the generic message
        return { ok: false, fieldErrors: fe ? { [fe.key]: fe.messageKey } : null, message: fe ? null : t('form.err.invalid') }
      }
      return { ok: false, message: t(e?.messageKey ?? 'form.public.failed') }
    }
  }

  if (ref.kind === 'invalid') return <EmptyState icon={Lock} title={t('form.public.notFound')} body={t('form.public.notFoundBody')} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!form) {
    return (
      <EmptyState
        icon={Lock}
        title={t('form.public.notFound')}
        body={t('form.public.notFoundBody')}
        action={auth?.status !== 'authed'
          ? <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className="tap-target inline-flex items-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">{t('form.public.signIn')}</Link>
          : <Link to="/" className="text-sm underline">{t('common.goHome')}</Link>}
      />
    )
  }

  return (
    <div data-testid="public-form-page" data-audience={form.audience}>
      <Suspense fallback={<Loading />}>
        <FormRenderer
          form={form}
          onSubmit={onSubmit}
          onUpload={form.allow_uploads ? (file) => uploadFormFile(form.project_id, form.node_id, file) : null}
          initialAnswers={initialAnswers}
          publicUrl={publicUrl}
          onShare={(platform) => trackFormEvent(ref.value, 'form_share', platform)}
        />
      </Suspense>
    </div>
  )
}
