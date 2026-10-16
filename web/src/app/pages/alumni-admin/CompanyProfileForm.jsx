import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Save, Undo2 } from 'lucide-react'
import { alumniKeys, getAlumniCompany, saveAlumniCompany } from '../../../data/alumni.js'
import { removeObjects } from '../../../data/storage.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { parseAlumniError } from '../../../lib/alumni.js'
import { buildCompanyPatch, companyToForm, fieldErrorOf, validateCompanyForm } from '../../../lib/alumniForms.js'
import { useAuth } from '../../AuthContext.js'
import { scrollToSection } from '../../../shared/alumni/scrollToSection.js'
import { CompanyBasicsSection, CompanyClassificationSection, CompanyLocationSection, CompanyOnlineSection, CompanyStatusSection, DirectoryVisibilitySection } from '../../../shared/alumni/CompanySections.jsx'
import SaveBar from '../../../shared/alumni/SaveBar.jsx'
import UnsavedGuard from '../../../shared/alumni/UnsavedGuard.jsx'
import { useDraftForm } from '../../../shared/alumni/useDraftForm.js'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import { useStaleResolver } from '../../../shared/alumni/useStaleResolver.jsx'
import { useAdminErrorText } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'
import './company.edit.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'
import '../../../shared/alumni/i18n.edit.js'

const sectionOfField = (field) => (['name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on'].includes(field) ? 'basics'
  : ['startup_type', 'sector', 'subsector', 'stage', 'legal_status'].includes(field) ? 'classification'
  : ['governorate', 'location_en', 'location_ar'].includes(field) ? 'location'
  : ['website_url', 'app_url', 'linkedin_url', 'links'].includes(field) || field.startsWith('links.') ? 'online'
  : ['operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note'].includes(field) ? 'status' : 'directory')

/**
 * The editable profile of ONE company for a manager (every owner column that belongs to the company, with the same validation as the founder's form): the six sections, the optional
 * reason of the change, an explicit Save that sends only what changed WITH the version the form loaded. When a founder saved the company meanwhile (`alumni_stale`) the page loads his
 * version, keeps the manager's edits on top and asks only about the fields both changed to different values. Each section shows who edited it last.
 * `embedded` (the directory drawer) uses an inline Save row instead of the fixed bar; `create` makes a new company and opens its page.
 */
export default function CompanyProfileForm({ payload, create = false, embedded = false, onDirtyChange = null }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { refresh, fetchFresh } = useAlumniRefresh()
  const company = payload.company
  // one "last modified" for the whole company row (shown in the page header): there are no per-section stamps any more (owner decision 21)
  const stampOf = () => null
  const form = useDraftForm(() => companyToForm(company), {
    version: company.updated_at ?? 'new',
    isDirty: (values, base) => Object.keys(buildCompanyPatch(base, values)).length > 0,
    onDiscard: (paths) => removeObjects('public-assets', paths.flatMap((p) => [p, p.replace(/\.webp$/, '_t.webp')])),
  })
  const { values, base, set: setField, setMany: setManyFields } = form
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const resolver = useStaleResolver({ form, toForm: (p) => companyToForm(p.company), versionOf: (p) => p.company.updated_at, whoOf: (p) => p.company.updated_source, audience: 'manager' })

  const patch = buildCompanyPatch(base, values)
  const changeCount = Object.keys(patch).length
  const dirty = changeCount > 0
  const clientErrors = validateCompanyForm(values)
  const shown = Object.fromEntries(Object.entries(clientErrors).filter(([k]) => submitted || k !== 'name_ar').map(([k, key]) => [k, t(key)]))
  const errors = { ...shown, ...serverErrors }
  const set = useCallback((key, value) => { setField(key, value); setServerErrors((e) => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e)) }, [setField])
  const setMany = useCallback((p) => { setManyFields(p); setServerErrors((e) => (Object.keys(p).some((k) => e[k]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))) : e)) }, [setManyFields])

  // the drawer asks before closing with unsaved edits
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  function undo() { form.reset(); resolver.clearNotice(); setServerErrors({}); setSubmitted(false); setStale(false) }

  async function save() {
    setSubmitted(true)
    setServerErrors({})
    const found = Object.keys(clientErrors)
    if (found.length) { scrollToSection(sectionOfField(found[0])); return }
    setBusy(true)
    try {
      const saved = await saveAlumniCompany(create ? null : company.id, patch, create ? null : form.version)
      await refresh()
      if (create) {
        toast.success(d('created'))
        navigate(`/alumni/admin/company/${saved.company.id}`, { replace: true })
        return
      }
      form.rebase(companyToForm(saved.company), saved.company.updated_at)
      setStale(false)
      resolver.clearNotice()
      toast.success(d('saved'))
    } catch (err) {
      const parsed = parseAlumniError(err)
      if (parsed.token === 'alumni_stale') setStale(true)
      else {
        const fe = fieldErrorOf(parsed)
        if (fe) { setServerErrors({ [fe.field]: t(fe.key) }); scrollToSection(sectionOfField(fe.field)) }
        toast.error(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }
  async function reloadKeepingMine() {
    const r = await resolver.resolve({ fetchFresh: () => fetchFresh(alumniKeys.adminCompany(company.id), () => getAlumniCompany(company.id)), keys: Object.keys(patch) })
    if (r !== 'failed') setStale(false)
  }

  return (
    <div className="space-y-5" data-testid="company-profile-form">
      <UnsavedGuard when={dirty && !busy} />
      {stale && (
        <div role="alert" className="space-y-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="stale-banner">
          <p className="font-bold">{d('stale')}</p>
          <p>{d('staleBody')}</p>
          <Button variant="outline" size="sm" onClick={reloadKeepingMine}><RefreshCw className="h-4 w-4" aria-hidden="true" />{d('staleReload')}</Button>
        </div>
      )}
      {resolver.dialog}
      {resolver.notice}

      <CompanyBasicsSection values={values} set={set} setMany={setMany} errors={errors} userId={user?.id} track={form.track} disabled={busy} stamp={stampOf('basics')} />
      <CompanyClassificationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} stamp={stampOf('classification')} />
      <CompanyLocationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} stamp={stampOf('location')} />
      <CompanyOnlineSection values={values} set={set} errors={errors} disabled={busy} stamp={stampOf('online')} />
      <CompanyStatusSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} stamp={stampOf('status')} />
      <DirectoryVisibilitySection values={values} set={set} errors={errors} disabled={busy} blocked={Boolean(company.internal?.directory_hidden)} isAlumni={Boolean(company.is_alumni)} stamp={stampOf('directory')} />

      {embedded ? (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t bg-background px-1 py-3" data-testid="embedded-save">
          <p className="min-w-0 flex-1 text-sm font-medium" role="status">{dirty ? t('alumni.admin.co.unsaved', { count: changeCount }) : t('alumni.admin.co.noChanges')}</p>
          <Button variant="ghost" size="sm" onClick={undo} disabled={!dirty || busy}><Undo2 className="h-4 w-4" aria-hidden="true" />{t('alumni.common.undo')}</Button>
          <Button size="sm" onClick={save} loading={busy} disabled={!dirty}><Save className="h-4 w-4" aria-hidden="true" />{create ? d('createLabel') : t('common.save')}</Button>
        </div>
      ) : (
        <SaveBar visible={dirty || busy} count={changeCount} busy={busy} onSave={save} onUndo={undo} saveLabel={create ? d('createLabel') : undefined} className="bottom-0" />
      )}
    </div>
  )
}
