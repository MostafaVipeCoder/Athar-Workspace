import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Building2, Fingerprint, PartyPopper, Plus, RefreshCw, UserRound } from 'lucide-react'
import { useAuth } from '../../AuthContext.js'
import { alumniKeys, getMyAlumniProfile, saveCompanyTeamMember, saveMyFounderProfileStrict, useAlumniLookups, useMyAlumniProfile } from '../../../data/alumni.js'
import { removeObjects, publicThumbUrl } from '../../../data/storage.js'
import { FOUNDER_BUCKET, uploadFounderPhoto, useFounderPhotoUrl } from '../../../data/alumniFounder.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { BilingualField } from '../../../ui/BilingualField.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { Field } from '../../../ui/Field.jsx'
import { ImageField } from '../../../ui/ImageField.jsx'
import { Img } from '../../../ui/Img.jsx'
import { PhoneField } from '../../../ui/PhoneField.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { lookupLabel, parseAlumniError } from '../../../lib/alumni.js'
import { buildFounderPatch, FOUNDER_MISSING_SECTION, founderToForm, fieldErrorOf, PHONE_COUNTRIES, validateFounderForm } from '../../../lib/alumniForms.js'
import { overallCompleteness } from '../../../lib/alumniProgress.js'
import { ChipSelect } from '../../../shared/alumni/pickers.jsx'
import { CompletenessMeter, ProfileSection } from '../../../shared/alumni/blocks.jsx'
import { scrollToSection } from '../../../shared/alumni/scrollToSection.js'
import NationalIdField from '../../../shared/alumni/NationalIdField.jsx'
import SaveBar from '../../../shared/alumni/SaveBar.jsx'
import UnsavedGuard from '../../../shared/alumni/UnsavedGuard.jsx'
import { useDraftForm } from '../../../shared/alumni/useDraftForm.js'
import { useAlumniErrorText } from '../../../shared/alumni/useAlumniErrorText.js'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import { useLookupOptions } from '../../../shared/alumni/useLookupOptions.js'
import StampLine from '../../../shared/alumni/StampLine.jsx'
import { useStaleResolver } from '../../../shared/alumni/useStaleResolver.jsx'
import SectionNav from './SectionNav.jsx'
import './alumni.i18n.js'
import './alumni.profile.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.id.js'
import '../../../shared/alumni/i18n.edit.js'

const roleKey = (companyId) => `role:${companyId}`
const formOf = (profile) => ({ ...founderToForm(profile.founder), ...Object.fromEntries((profile.companies ?? []).map((c) => [roleKey(c.id), c.role ?? ''])) })
const versionOf = (profile) => `${profile.founder.updated_at}|${(profile.companies ?? []).map((c) => `${c.id}:${c.role ?? ''}`).join(',')}`
const founderPatchOf = (base, values) => buildFounderPatch(base, values)
const roleChangesOf = (companies, base, values) => (companies ?? []).filter((c) => (values[roleKey(c.id)] ?? '').trim() !== (base[roleKey(c.id)] ?? '').trim())

function ProfileSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" data-testid="profile-skeleton">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** The founder's own account information (design 09 F4): photo, names, phone, education, the national ID with its derived values, bio and links, and the founder's companies. */
function ProfileForm({ profile }) {
  const { t, lang, pick } = useLanguage()
  const { user } = useAuth()
  const location = useLocation()
  const toast = useToast()
  const lookups = useAlumniLookups()
  const { refresh, fetchFresh } = useAlumniRefresh()
  const errorText = useAlumniErrorText()
  const education = useLookupOptions('education_status', profile.founder.education_status)
  const governorateCodes = useMemo(() => (lookups.data?.governorates ?? []).map((g) => Number(g.code)), [lookups.data])

  const { founder, companies } = profile
  const form = useDraftForm(() => formOf(profile), {
    version: versionOf(profile),
    isDirty: (values, base) => Object.keys(founderPatchOf(base, values)).length > 0 || roleChangesOf(companies, base, values).length > 0,
    onDiscard: (paths) => removeObjects(FOUNDER_BUCKET, paths.flatMap((p) => [p, p.replace(/\.webp$/, '_t.webp')])),
  })
  const { values, base } = form
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [conflict, setConflict] = useState(false)
  const [stale, setStale] = useState(false)
  const [replaced, setReplaced] = useState([])
  const [busy, setBusy] = useState(false)
  // somebody else (the Athar team) saved this profile while I was editing: load their version, keep my edits, ask only where we both changed the same field
  const resolver = useStaleResolver({ form, toForm: formOf, versionOf, whoOf: (p) => p.founder.updated_source, audience: 'founder' })

  const patch = founderPatchOf(base, values)
  const roleChanges = roleChangesOf(companies, base, values)
  const changeCount = Object.keys(patch).length + roleChanges.length
  const dirty = changeCount > 0

  const clientErrors = validateFounderForm(values, { governorateCodes: governorateCodes.length ? governorateCodes : null })
  const shownClient = Object.fromEntries(Object.entries(clientErrors).filter(([k]) => k !== 'national_id' && (submitted || k !== 'name_ar')).map(([k, key]) => [k, t(key)]))
  const errors = { ...shownClient, ...serverErrors }

  const { set: setField } = form
  const set = useCallback((key, value) => {
    setField(key, value)
    setServerErrors((e) => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e))
    if (key === 'national_id') { setConflict(false); setReplaced([]) }
  }, [setField])

  const photoUrl = useFounderPhotoUrl(values.photo_path || null)
  const overall = overallCompleteness(profile)

  function undo() {
    form.reset()
    resolver.clearNotice()
    setServerErrors({})
    setConflict(false)
    setStale(false)
    setReplaced([])
    setSubmitted(false)
  }

  async function loadLatest() {
    const r = await resolver.resolve({ fetchFresh: () => fetchFresh(alumniKeys.me(), getMyAlumniProfile), keys: [...Object.keys(patch), ...roleChanges.map((c) => roleKey(c.id))] })
    if (r !== 'failed') setStale(false)
  }

  async function save() {
    setSubmitted(true)
    setServerErrors({})
    const found = Object.keys(clientErrors)
    if (found.length) {
      const first = found[0]
      scrollToSection(first === 'national_id' || first === 'self_birth_date' ? 'national-id' : first.startsWith('bio') || first === 'linkedin_url' ? 'about' : 'identity')
      return
    }
    setBusy(true)
    try {
      let notice = []
      if (Object.keys(patch).length) {
        // the version of the profile the form loaded (the first part of the form version): a profile the Athar team changed meanwhile is refused (alumni_stale), never overwritten
        const saved = await saveMyFounderProfileStrict(patch, String(form.version).split('|')[0]) // a national_id_conflict THROWS here (token national_id_conflict)
        notice = saved.replaced ?? []
      }
      for (const c of roleChanges) {
        await saveCompanyTeamMember(c.id, founder.id, { role: (values[roleKey(c.id)] ?? '').trim() || null })
      }
      await refresh()
      const fresh = await fetchFresh(alumniKeys.me(), getMyAlumniProfile)
      form.rebase(formOf(fresh), versionOf(fresh))
      setReplaced(notice)
      resolver.clearNotice()
      toast.success(t('alumni.founder.saved'))
    } catch (err) {
      const parsed = parseAlumniError(err)
      if (err?.token === 'national_id_conflict') {
        setConflict(true)
        scrollToSection('national-id')
      } else if (parsed.token === 'alumni_stale') {
        setStale(true)
      } else {
        const fe = fieldErrorOf(parsed)
        if (fe) {
          setServerErrors({ [fe.field]: t(fe.key) })
          scrollToSection(fe.field === 'national_id' || fe.field.startsWith('self_') ? 'national-id' : fe.field.startsWith('bio') || fe.field === 'linkedin_url' ? 'about' : 'identity')
        }
        toast.error(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const sections = [
    { id: 'identity', label: t('alumni.founder.nav.identity') },
    { id: 'national-id', label: t('alumni.founder.nav.nationalId') },
    { id: 'about', label: t('alumni.founder.nav.about') },
    { id: 'companies', label: t('alumni.founder.nav.companies') },
  ]
  const welcome = location.state?.welcome || location.state?.invited

  return (
    <div className="space-y-5 pb-28" data-testid="founder-profile">
      <UnsavedGuard when={dirty && !busy} />
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border bg-surface">
          <Img src={photoUrl.data ?? undefined} alt="" aspect="1 / 1" eager />
        </div>
        <div className="min-w-0">
          <h1 className="text-section-title break-words">{t('alumni.founder.profile.title')}</h1>
          <p className="truncate text-sm text-muted-foreground" dir="ltr">{founder.email}</p>
        </div>
      </div>

      {welcome && (
        <div role="status" className="flex items-start gap-3 rounded-card border border-accent bg-accent/20 p-4" data-testid="welcome-banner">
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-bold">{location.state?.invited ? t('alumni.founder.profile.welcomeInvitedTitle') : t('alumni.founder.profile.welcomeTitle')}</p>
            <p>{location.state?.invited ? t('alumni.founder.profile.welcomeInvitedBody') : t('alumni.founder.profile.welcomeBody')}</p>
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-card border bg-card p-4">
        <CompletenessMeter
          title={t('alumni.founder.profile.myCompleteness')}
          percent={founder.completeness?.percent}
          missing={founder.completeness?.missing ?? []}
          labelFor={(k) => t(`alumni.common.missing.${k}`)}
          sectionFor={(k) => FOUNDER_MISSING_SECTION[k]}
        />
        {overall !== null && companies.length > 0 && <p className="text-xs text-muted-foreground">{t('alumni.founder.profile.overall', { percent: overall })}</p>}
      </div>

      <SectionNav sections={sections} label={t('alumni.founder.nav.label')} />

      {stale && (
        <div role="alert" className="space-y-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="stale-banner">
          <p className="font-bold">{t('alumni.edit.conflict.banner')}</p>
          <p>{t('alumni.edit.conflict.bannerBody')}</p>
          <Button variant="outline" size="sm" onClick={loadLatest}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('alumni.edit.conflict.load')}</Button>
        </div>
      )}
      {resolver.dialog}
      {resolver.notice}

      <ProfileSection id="identity" icon={UserRound} title={t('alumni.founder.profile.identityTitle')} description={t('alumni.founder.profile.identityDesc')} stamp={<StampLine stamp={founder.updated_source ? { at: founder.updated_at, source: founder.updated_source } : null} />}>
        <div className="max-w-[12rem]">
          <ImageField
            label={t('alumni.founder.photo')}
            aspect="1 / 1"
            profile="avatar"
            src={photoUrl.data ?? undefined}
            disabled={!user?.id}
            onFile={async (file) => {
              const path = await uploadFounderPhoto(file, user.id)
              form.track(path)
              set('photo_path', path)
            }}
            onClear={() => set('photo_path', '')}
            labels={{ hint: t('alumni.founder.photoHint') }}
          />
        </div>
        <BilingualField
          label={t('alumni.founder.name')}
          required
          value={{ en: values.name_en, ar: values.name_ar }}
          onChange={(v) => { set('name_en', v.en); set('name_ar', v.ar) }}
          error={errors.name_ar ?? errors.name_en}
        />
        <Field label={t('auth.email')} type="email" dir="ltr" value={founder.email ?? ''} readOnly aria-readonly="true" hint={t('alumni.founder.emailHint')} />
        <PhoneField label={t('alumni.common.phone')} countries={PHONE_COUNTRIES} lang={lang} value={values.phone} onChange={(v) => set('phone', v)} error={errors.phone} hint={t('alumni.founder.phoneHint')} />
        <ChipSelect label={t('alumni.common.educationStatus')} options={education.options} value={values.education_status} allowClear disabled={education.isPending} onChange={(v) => set('education_status', v)} error={errors.education_status} />
      </ProfileSection>

      <ProfileSection id="national-id" icon={Fingerprint} title={t('alumni.founder.profile.idTitle')} description={t('alumni.founder.profile.idDesc')}>
        <NationalIdField
          identity={founder.identity}
          value={values.national_id}
          onChange={(v) => set('national_id', v)}
          selfBirthDate={values.self_birth_date}
          selfGender={values.self_gender}
          onSelfChange={(k, v) => set(k, v)}
          conflict={conflict}
          serverError={errors.national_id}
          replaced={replaced}
          disabled={busy}
        />
        {errors.self_birth_date && <p role="alert" className="text-xs text-destructive-text">{errors.self_birth_date}</p>}
      </ProfileSection>

      <ProfileSection id="about" icon={UserRound} title={t('alumni.founder.profile.aboutTitle')} description={t('alumni.founder.profile.aboutDesc')}>
        <BilingualField
          label={t('alumni.founder.bio')}
          as="textarea"
          rows={4}
          value={{ en: values.bio_en, ar: values.bio_ar }}
          onChange={(v) => { set('bio_en', v.en); set('bio_ar', v.ar) }}
          error={errors.bio_en ?? errors.bio_ar}
        />
        <Field type="url" dir="ltr" inputMode="url" label={t('alumni.founder.linkedin')} placeholder="https://www.linkedin.com/in/..." value={values.linkedin_url} error={errors.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} />
      </ProfileSection>

      <ProfileSection id="companies" icon={Building2} title={t('alumni.founder.profile.companiesTitle')} description={t('alumni.founder.profile.companiesDesc')}>
        {companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('alumni.founder.profile.noCompanyTitle')}
            body={t('alumni.founder.profile.noCompanyBody')}
            action={<Link to="/alumni/founder/company/new" className={buttonClass({ size: 'md', className: 'mt-2' })} data-testid="create-company-cta"><Plus className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.profile.createCompany')}</Link>}
          />
        ) : (
          <ul className="space-y-3">
            {companies.map((c) => {
              const cname = pick(c, 'name')
              return (
                <li key={c.id} className="space-y-3 rounded-card border p-3" data-testid="profile-company">
                  <div className="flex items-start gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-input border bg-surface">
                      <Img src={c.logo_path ? publicThumbUrl(c.logo_path) : undefined} alt="" aspect="1 / 1" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="break-words font-bold">{cname}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {c.is_primary && <Badge tone="amber">{t('alumni.founder.profile.ceo')}</Badge>}
                        {c.sector && <Badge tone="outline">{lookupLabel(lookups.data, 'sector', c.sector, lang)}</Badge>}
                        {c.stage && <Badge tone="outline">{lookupLabel(lookups.data, 'stage', c.stage, lang)}</Badge>}
                        {c.operating_status === 'closed' && <Badge tone="red">{lookupLabel(lookups.data, 'operating_status', 'closed', lang)}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{t('alumni.founder.profile.companyCompleteness', { percent: c.completeness?.percent ?? 0 })}</p>
                    </div>
                  </div>
                  <Field label={t('alumni.founder.profile.roleIn', { company: cname })} value={values[roleKey(c.id)] ?? ''} maxLength={60} onChange={(e) => set(roleKey(c.id), e.target.value)} hint={t('alumni.founder.profile.roleHint')} />
                  <Link to={`/alumni/founder/company/${c.id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('alumni.founder.profile.openCompany')}</Link>
                </li>
              )
            })}
          </ul>
        )}
        {companies.length > 0 && (
          <Link to="/alumni/founder/company/new" className={buttonClass({ variant: 'ghost', size: 'sm' })}><Plus className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.profile.addAnother')}</Link>
        )}
      </ProfileSection>

      <SaveBar visible={dirty || busy} count={changeCount} busy={busy} onSave={save} onUndo={undo} />
    </div>
  )
}

/** /alumni/founder/profile */
export default function FounderProfilePage() {
  const { t } = useLanguage()
  const q = useMyAlumniProfile()
  if (q.isPending) return <ProfileSkeleton />
  if (q.error) return <ErrorState error={q.error} title={t('alumni.founder.profile.loadFailed')} onRetry={q.refetch} />
  return <ProfileForm profile={q.data} />
}
