import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Star, UserMinus } from 'lucide-react'
import { alumniKeys, getAlumniFounder, removeCompanyTeamMember, saveAlumniFounder, saveCompanyTeamMember, setCompanyCeo } from '../../../data/alumni.js'
import { parseAlumniError } from '../../../lib/alumni.js'
import { allDecided, findConflicts, keysToKeep } from '../../../lib/alumniConflicts.js'
import { buildFounderPatch, founderToForm } from '../../../lib/alumniForms.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Field } from '../../../ui/Field.jsx'
import { ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { ConflictList } from '../../../shared/alumni/ConflictDialog.jsx'
import NationalIdField from '../../../shared/alumni/NationalIdField.jsx'
import { ChipSelect } from '../../../shared/alumni/pickers.jsx'
import StampLine from '../../../shared/alumni/StampLine.jsx'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { FactRow } from './ui.jsx'
import RevealId from './RevealId.jsx'
import { useAdminErrorText, useAdminFormat, useLabels } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'
import './company.edit.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

const str = (v) => (v === null || v === undefined ? '' : String(v))
/** The manager's founder form = the founder's own form (`founderToForm`) + the e-mail (a manager-only key). */
const toForm = (founder, role) => ({ ...founderToForm(founder), email: str(founder?.email), role: str(role) })
const EXTRA_KEYS = ['email']

/** The patch of `save_alumni_founder` / of a new team record: the founder keys + the e-mail, changed keys only (`national_id` only when a number was typed; the ID wins over typed values). */
function patchOf(base, values) {
  const patch = buildFounderPatch(base, values)
  for (const k of EXTRA_KEYS) if (str(base[k]).trim() !== str(values[k]).trim()) patch[k] = str(values[k]).trim() || null
  return patch
}

/** The form of ONE founder inside the dialog (also a record without an account). `founder` = the manager payload block (masked ID) or null for a new record. */
function FounderForm({ companyId, member, founder, onClose, onSaved, onReload }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const labels = useLabels()
  const toast = useToast()
  const e = useEditText()
  const errorText = useAdminErrorText()
  const isNew = !member
  const [loaded, setLoaded] = useState(founder)
  const base = useMemo(() => toForm(loaded, member?.role), [loaded, member?.role])
  const [values, setValues] = useState(base)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [nidError, setNidError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [choices, setChoices] = useState({})
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))
  const patch = patchOf(base, values)
  const roleChanged = str(values.role).trim() !== str(base.role).trim()
  const identity = loaded?.identity ?? { has_national_id: false }

  async function onStale() {
    const keys = Object.keys(patch)
    let fresh
    try {
      fresh = await onReload()
    } catch {
      toast.error(t('alumni.edit.conflict.reloadFailed'))
      return
    }
    const freshForm = toForm(fresh, member?.role)
    const who = e.who({ source: fresh.updated_source }, 'manager')
    const conflicts = findConflicts({ base, mine: values, fresh: freshForm, keys })
    if (conflicts.length === 0) {
      setLoaded(fresh)
      setValues({ ...freshForm, ...Object.fromEntries(keys.map((k) => [k, values[k]])), role: values.role })
      setNotice(t('alumni.edit.conflict.merged', { who }))
    } else {
      setConflict({ conflicts, fresh, freshForm, keys, who })
      setChoices({})
    }
  }

  function applyChoices() {
    const keep = keysToKeep({ keys: conflict.keys, conflicts: conflict.conflicts, choices })
    setLoaded(conflict.fresh)
    setValues({ ...conflict.freshForm, ...Object.fromEntries(keep.map((k) => [k, values[k]])), role: values.role })
    setNotice(t('alumni.edit.conflict.mergedWithChoices'))
    setConflict(null)
  }

  async function save() {
    if (isNew && !patch.name_en && !patch.name_ar) { toast.error(t('alumni.admin.common.err.field', { field: d('fNameEn'), reason: t('alumni.admin.common.reason.required') })); return }
    if (!isNew && Object.keys(patch).length === 0 && !roleChanged) { toast.info(d('fNoChange')); onClose(); return }
    setBusy(true)
    setNidError(null)
    setNotice(null)
    try {
      let replaced = []
      if (isNew) {
        // a manager's new record carries everything (the e-mail and the national ID are manager-only keys of the same RPC)
        const role = str(values.role).trim()
        await saveCompanyTeamMember(companyId, null, role ? { ...patch, role } : patch)
      } else {
        const r = Object.keys(patch).length ? await saveAlumniFounder(member.founder_id, patch, loaded.updated_at, reason.trim() || null) : null
        replaced = r?.replaced ?? []
        if (roleChanged) await saveCompanyTeamMember(companyId, member.founder_id, { role: str(values.role).trim() || null })
      }
      toast.success(d('fSaved'))
      if (replaced.length > 0) toast.info(d('fReplaced'))
      await onSaved()
      onClose()
    } catch (err) {
      const token = parseAlumniError(err).token
      if (token === 'alumni_stale') await onStale()
      else {
        const text = errorText(err, { national_id: d('fId'), email: d('fEmail'), phone: d('fPhone'), name_en: d('fNameEn'), name_ar: d('fNameAr') })
        if (/national_id/i.test(String(err?.cause?.hint ?? err?.cause?.message ?? ''))) setNidError(text)
        else toast.error(text)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} dismissible={!busy} title={isNew ? d('recordTitle') : d('founderTitle', { name: pick(loaded ?? member, 'name') })} closeLabel={t('common.close')} className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{d('fCancel')}</Button>
          {conflict
            ? <Button onClick={applyChoices} disabled={!allDecided(conflict.conflicts, choices)} data-testid="conflict-apply">{t('alumni.edit.conflict.apply')}</Button>
            : <Button onClick={save} loading={busy} data-testid="founder-save">{d('fSave')}</Button>}
        </>
      }>
      <div className="space-y-4" data-testid="founder-form">
        {!isNew && loaded?.updated_source && <StampLine audience="manager" stamp={{ at: loaded.updated_at, source: loaded.updated_source }} />}
        {conflict ? (
          <div className="space-y-3" role="alert" data-testid="founder-conflict">
            <p className="font-bold">{t('alumni.edit.conflict.title')}</p>
            <p className="text-sm">{t('alumni.edit.conflict.body', { who: conflict.who })}</p>
            <ConflictList conflicts={conflict.conflicts} who={conflict.who} fieldLabel={e.fieldLabel}
              valueText={(k, v) => (k === 'national_id' ? e.valueText('national_id', Boolean(v)) : e.valueText(k, v))} choices={choices} onChoose={(k, v) => setChoices((s) => ({ ...s, [k]: v }))} />
          </div>
        ) : (
          <>
            {notice && <p role="status" className="rounded-input bg-accent/20 p-3 text-sm" data-testid="founder-notice">{notice}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={d('fNameEn')} dir="ltr" value={values.name_en} onChange={(ev) => set('name_en', ev.target.value)} maxLength={200} />
              <Field label={d('fNameAr')} dir="rtl" value={values.name_ar} onChange={(ev) => set('name_ar', ev.target.value)} maxLength={200} />
              <Field type="email" label={d('fEmail')} hint={d('fEmailHint')} dir="ltr" value={values.email} onChange={(ev) => set('email', ev.target.value)} />
              <Field type="tel" label={d('fPhone')} dir="ltr" value={values.phone} onChange={(ev) => set('phone', ev.target.value)} />
              <Field label={d('fRole')} value={values.role} onChange={(ev) => set('role', ev.target.value)} maxLength={60} />
              <Field type="url" dir="ltr" inputMode="url" label={d('fLinkedin')} placeholder="https://www.linkedin.com/in/..." value={values.linkedin_url} onChange={(ev) => set('linkedin_url', ev.target.value)} />
            </div>
            <ChipSelect label={d('fEdu')} options={labels.options('education_status')} value={values.education_status} onChange={(v) => set('education_status', v)} allowClear />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field as="textarea" rows={3} label={d('fBioEn')} dir="ltr" value={values.bio_en} onChange={(ev) => set('bio_en', ev.target.value)} />
              <Field as="textarea" rows={3} label={d('fBioAr')} dir="rtl" value={values.bio_ar} onChange={(ev) => set('bio_ar', ev.target.value)} />
            </div>
            <div className="space-y-2 rounded-card border p-4">
              <p className="text-sm text-muted-foreground">{d('fIdHint')}</p>
              <NationalIdField identity={identity} value={values.national_id} onChange={(v) => set('national_id', v)} selfBirthDate={values.self_birth_date} selfGender={values.self_gender} onSelfChange={(k, v) => set(k, v)} serverError={nidError} disabled={busy} />
            </div>
            {!isNew && <Field label={d('reasonLabel')} hint={d('reasonHint')} placeholder={d('reasonPlaceholder')} value={reason} maxLength={300} onChange={(ev) => setReason(ev.target.value)} />}
            {!isNew && <p className="text-xs text-muted-foreground">{d('fPhotoNote')}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Opens the founder's form once his block is loaded (the version token and the bio / LinkedIn come from `get_alumni_founder`, the number stays masked). */
function FounderDialog({ companyId, member, onClose, onSaved }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const q = useQuery({ queryKey: alumniKeys.adminFounder(member?.founder_id), queryFn: () => getAlumniFounder(member.founder_id), enabled: Boolean(member), staleTime: 0, gcTime: 0 })
  if (!member) return <FounderForm companyId={companyId} member={null} founder={null} onClose={onClose} onSaved={onSaved} onReload={async () => null} />
  if (q.isPending || q.isError) {
    return (
      <Modal open onClose={onClose} title={d('founderTitle', { name: '' })} closeLabel={t('common.close')} className="sm:max-w-2xl">
        {q.isPending ? <div role="status" aria-busy="true"><span className="sr-only">{d('fLoading')}</span><SkeletonList count={4} itemClassName="h-11 w-full" /></div> : <ErrorState error={q.error} title={d('fLoadFailed')} onRetry={() => q.refetch()} />}
      </Modal>
    )
  }
  return <FounderForm key={q.data.id} companyId={companyId} member={member} founder={q.data} onClose={onClose} onSaved={onSaved} onReload={() => getAlumniFounder(member.founder_id)} />
}

/**
 * The team of a company as a manager works with it (design 09 M3): every member with the values DERIVED from his national ID (age, gender, governorate) or flagged self-declared,
 * the national ID masked with an audited reveal, who edited him last, and the actions: edit (details, bio, LinkedIn, national ID), make CEO, remove, add a record without an
 * account. Counts are derived, never typed. `autoOpen` (a deep link from the needs-attention queue): 'ceo' opens "add a founder", 'ceo_id' / 'contact' / 'ceo_education' open the CEO's form.
 */
export default function CompanyAdminTeam({ companyId, team, counts, ceoFounderId, onChanged, founderStamps = [], autoOpen = null }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const fmt = useAdminFormat()
  const labels = useLabels()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  // a deep link from the queue opens the form that fixes the item (the page mounts with the team loaded, so this is decided once, at the first render)
  const [dialog, setDialog] = useState(() => {
    if (autoOpen === 'ceo' && team.length === 0) return { member: null }
    if (['ceo_id', 'contact', 'ceo_education'].includes(autoOpen)) {
      const ceo = team.find((m) => m.founder_id === ceoFounderId)
      if (ceo) return { member: ceo }
    }
    return null
  }) // { member|null } | null
  const [busyId, setBusyId] = useState(null)
  const stampOf = (id) => founderStamps.find((s) => s.founder_id === id)

  async function run(id, fn, ok) {
    setBusyId(id)
    try {
      await fn()
      toast.success(ok)
      await onChanged()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusyId(null)
    }
  }
  async function remove(m) {
    const name = pick(m, 'name')
    const ok = await confirm({ title: d('removeTitle', { name }), message: d('removeBody'), confirmLabel: d('removeFounder'), destructive: true })
    if (ok) await run(m.founder_id, () => removeCompanyTeamMember(companyId, m.founder_id), d('removed'))
  }

  return (
    <div className="space-y-3" data-testid="admin-team">
      <p className="text-sm text-muted-foreground">{d('counts', { size: counts?.team_size ?? '—', female: counts?.female_founders ?? '—', under: counts?.founders_under_35 ?? '—' })}</p>
      {team.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-team">{autoOpen === 'ceo' ? d('focusNoCeo') : d('noTeam')}</p> : (
        <ul className="space-y-3">
          {team.map((m) => (
            <li key={m.founder_id} className="space-y-3 rounded-card border bg-card p-4" data-testid="admin-team-member">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-base font-bold">{pick(m, 'name') || '—'}
                    {m.founder_id === ceoFounderId && <Badge tone="blue">{d('ceoBadge')}</Badge>}
                    <Badge tone={m.has_account ? 'green' : 'outline'}>{m.has_account ? d('hasAccount') : d('noAccount')}</Badge>
                  </p>
                  {m.role && <p className="text-xs text-muted-foreground">{m.role}</p>}
                  <StampLine audience="manager" stamp={stampOf(m.founder_id)?.source ? { at: stampOf(m.founder_id).updated_at, source: stampOf(m.founder_id).source } : null} className="pt-0.5" />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="outline" size="sm" onClick={() => setDialog({ member: m })} disabled={busyId === m.founder_id}><Pencil className="h-4 w-4" aria-hidden="true" />{d('editFounder')}</Button>
                  {m.founder_id !== ceoFounderId && <Button variant="ghost" size="sm" onClick={() => run(m.founder_id, () => setCompanyCeo(companyId, m.founder_id), d('ceoSet'))} disabled={busyId === m.founder_id}><Star className="h-4 w-4" aria-hidden="true" />{d('setCeo')}</Button>}
                  <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => remove(m)} disabled={busyId === m.founder_id}><UserMinus className="h-4 w-4" aria-hidden="true" />{d('removeFounder')}</Button>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                <FactRow label={d('fAge')} hint={m.age !== null && m.age !== undefined ? (m.source === 'self' ? d('selfDeclared') : d('fromId')) : undefined}>{m.age !== null && m.age !== undefined ? fmt.num(m.age) : ''}</FactRow>
                <FactRow label={d('fGender')} hint={m.gender ? (m.source === 'self' ? d('selfDeclared') : d('fromId')) : undefined}>{labels.label('gender', m.gender)}</FactRow>
                <FactRow label={d('fGov')} hint={m.governorate !== null && m.governorate !== undefined ? d('fromId') : undefined}>{m.governorate !== null && m.governorate !== undefined ? labels.label('governorate', m.governorate) : ''}</FactRow>
                <FactRow label={d('fEdu')}>{labels.label('education_status', m.education_status)}</FactRow>
                <FactRow label={d('fEmail')}><span dir="ltr">{m.email}</span></FactRow>
                <FactRow label={d('fPhone')}><span dir="ltr">{m.phone}</span></FactRow>
              </dl>
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-muted-foreground">{d('fId')}</span><RevealId masked={m.id_masked} founderId={m.founder_id} hasId={Boolean(m.id_masked)} /></div>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" onClick={() => setDialog({ member: null })}><Plus className="h-4 w-4" aria-hidden="true" />{d('addRecord')}</Button>
      {dialog && <FounderDialog key={dialog.member?.founder_id ?? 'new'} companyId={companyId} member={dialog.member} onClose={() => setDialog(null)} onSaved={onChanged} />}
    </div>
  )
}

