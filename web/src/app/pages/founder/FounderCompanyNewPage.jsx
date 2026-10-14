import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { saveMyCompanyProfile } from '../../../data/alumni.js'
import { removeObjects } from '../../../data/storage.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { parseAlumniError } from '../../../lib/alumni.js'
import { buildCompanyPatch, companyToForm, fieldErrorOf, validateCompanyForm } from '../../../lib/alumniForms.js'
import { useAuth } from '../../AuthContext.js'
import { scrollToSection } from '../../../shared/alumni/scrollToSection.js'
import { CompanyBasicsSection, CompanyClassificationSection, CompanyLocationSection } from '../../../shared/alumni/CompanySections.jsx'
import SaveBar from '../../../shared/alumni/SaveBar.jsx'
import UnsavedGuard from '../../../shared/alumni/UnsavedGuard.jsx'
import { useDraftForm } from '../../../shared/alumni/useDraftForm.js'
import { useAlumniErrorText } from '../../../shared/alumni/useAlumniErrorText.js'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import './alumni.i18n.js'
import './alumni.company.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'

const sectionOfField = (f) => (['startup_type', 'sector', 'subsector', 'stage', 'legal_status'].includes(f) ? 'classification' : ['governorate', 'location_en', 'location_ar'].includes(f) ? 'location' : 'basics')

/**
 * /alumni/founder/company/new: "create your company" for a founder who has none (decided: a self-registered founder creates his own; an invited founder is linked to the
 * existing company instead). The essentials only; everything else is filled in on the company page right after. The creator becomes the company's primary founder (the CEO).
 * A name that is already registered is refused without saying who owns it: the founder is told to ask the Athar team for an invitation.
 */
export default function FounderCompanyNewPage() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const { refresh } = useAlumniRefresh()
  const form = useDraftForm(() => companyToForm({}), {
    isDirty: (values, base) => Object.keys(buildCompanyPatch(base, values)).length > 0,
    onDiscard: (paths) => removeObjects('public-assets', paths.flatMap((p) => [p, p.replace(/\.webp$/, '_t.webp')])),
  })
  const { values, base, set: setField, setMany: setManyFields } = form
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const patch = buildCompanyPatch(base, values)
  const changeCount = Object.keys(patch).length
  const clientErrors = validateCompanyForm(values)
  const errors = { ...Object.fromEntries(Object.entries(clientErrors).filter(([k]) => submitted || k !== 'name_ar').map(([k, key]) => [k, t(key)])), ...serverErrors }
  const set = useCallback((k, v) => { setField(k, v); setServerErrors({}) }, [setField])
  const setMany = useCallback((v) => { setManyFields(v); setServerErrors({}) }, [setManyFields])

  async function create() {
    setSubmitted(true)
    setServerErrors({})
    const found = Object.keys(clientErrors)
    if (found.length) { scrollToSection(sectionOfField(found[0])); return }
    setBusy(true)
    try {
      const saved = await saveMyCompanyProfile(null, patch, null)
      setDone(true) // the form is clean now: the unsaved-changes guard must not stop the redirect
      await refresh()
      toast.success(t('alumni.founder.company.created'))
      navigate(`/alumni/founder/company/${saved.company.id}`, { replace: true, state: { created: true } })
    } catch (err) {
      const parsed = parseAlumniError(err)
      if (parsed.token === 'alumni_company_exists') setServerErrors({ name_ar: t('alumni.err.companyExists') })
      else {
        const fe = fieldErrorOf(parsed)
        if (fe) setServerErrors({ [fe.field]: t(fe.key) })
      }
      toast.error(errorText(err))
      scrollToSection('basics')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 pb-28" data-testid="founder-company-new">
      <UnsavedGuard when={changeCount > 0 && !busy && !done} />
      <Link to="/alumni/founder/profile" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('alumni.founder.company.back')}</Link>
      <div>
        <h1 className="text-section-title">{t('alumni.founder.company.newTitle')}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t('alumni.founder.company.newBody')}</p>
      </div>
      <p className="rounded-card border border-dashed border-input p-3 text-sm text-muted-foreground">{t('alumni.founder.company.newInvitedNote')}</p>
      <CompanyBasicsSection values={values} set={set} setMany={setMany} errors={errors} userId={user?.id} track={form.track} disabled={busy} />
      <CompanyClassificationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <CompanyLocationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <SaveBar visible busy={busy} count={changeCount} onSave={create} onUndo={form.reset} undoDisabled={changeCount === 0} saveLabel={t('alumni.founder.company.createAction')} />
    </div>
  )
}
