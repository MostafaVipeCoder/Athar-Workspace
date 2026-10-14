import { useState } from 'react'
import { Pencil, Plus, Star, UserMinus } from 'lucide-react'
import { removeCompanyTeamMember, saveAlumniFounder, saveCompanyTeamMember, setCompanyCeo } from '../../../data/alumni.js'
import { diffPatch, digitsOnly } from '../../../lib/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import NationalIdField from '../../../shared/alumni/NationalIdField.jsx'
import { ChipSelect } from '../../../shared/alumni/pickers.jsx'
import { FactRow } from './ui.jsx'
import RevealId from './RevealId.jsx'
import { useAdminErrorText, useAdminFormat, useLabels } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'

const FOUNDER_KEYS = ['name_en', 'name_ar', 'email', 'phone', 'education_status', 'self_birth_date', 'self_gender']

/** What the manager can change about ONE founder (also a record without an account): the details, the national ID (the ID wins over typed values), the self-declared fallback. */
function FounderDialog({ companyId, member, onClose, onSaved }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const labels = useLabels()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const isNew = !member
  const base = { name_en: member?.name_en ?? '', name_ar: member?.name_ar ?? '', email: member?.email ?? '', phone: member?.phone ?? '', education_status: member?.education_status ?? '', self_birth_date: member?.source === 'self' ? (member.birth_date ?? '') : '', self_gender: member?.source === 'self' ? (member.gender ?? '') : '' }
  const [form, setForm] = useState(base)
  const [role, setRole] = useState(member?.role ?? '')
  const [nid, setNid] = useState('')
  const [busy, setBusy] = useState(false)
  const [nidError, setNidError] = useState(null)
  const identity = member ? { has_national_id: Boolean(member.id_masked), id_masked: member.id_masked, source: member.source, derived: { birth_date: member.birth_date, age: member.age, age_category: member.age_category, gender: member.gender, governorate: member.governorate } } : { has_national_id: false }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    const patch = diffPatch(base, form, FOUNDER_KEYS)
    const digits = digitsOnly(nid, 14)
    if (digits.length === 14) patch.national_id = digits
    if (isNew && !patch.name_en && !patch.name_ar) { toast.error(t('alumni.admin.common.err.field', { field: d('fNameEn'), reason: t('alumni.admin.common.reason.required') })); return }
    if (!isNew && Object.keys(patch).length === 0 && role === (member.role ?? '')) { toast.info(d('fNoChange')); onClose(); return }
    setBusy(true)
    setNidError(null)
    try {
      let replaced = []
      if (isNew) {
        // a manager's new record carries everything (the e-mail and the national ID are manager-only keys of the same RPC)
        await saveCompanyTeamMember(companyId, null, role ? { ...patch, role } : patch)
      } else {
        const r = Object.keys(patch).length ? await saveAlumniFounder(member.founder_id, patch) : null
        replaced = r?.replaced ?? []
        if (role !== (member.role ?? '')) await saveCompanyTeamMember(companyId, member.founder_id, { role })
      }
      toast.success(d('fSaved'))
      if (replaced.length > 0) toast.info(d('fReplaced'))
      await onSaved()
      onClose()
    } catch (e) {
      const text = errorText(e, { national_id: d('fId'), email: d('fEmail'), phone: d('fPhone'), name_en: d('fNameEn'), name_ar: d('fNameAr') })
      if (/national_id/i.test(String(e?.cause?.hint ?? e?.cause?.message ?? ''))) setNidError(text)
      else toast.error(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} dismissible={!busy} title={isNew ? d('recordTitle') : d('founderTitle', { name: pick(member, 'name') })} closeLabel={t('common.close')} className="sm:max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>{d('fCancel')}</Button><Button onClick={save} loading={busy} data-testid="founder-save">{d('fSave')}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={d('fNameEn')} dir="ltr" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} maxLength={200} />
          <Field label={d('fNameAr')} dir="rtl" value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} maxLength={200} />
          <Field type="email" label={d('fEmail')} hint={d('fEmailHint')} dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <Field type="tel" label={d('fPhone')} dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <Field label={d('fRole')} value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} />
        </div>
        <ChipSelect label={d('fEdu')} options={labels.options('education_status')} value={form.education_status} onChange={(v) => set('education_status', v)} allowClear />
        <div className="space-y-2 rounded-card border p-4">
          <p className="text-sm text-muted-foreground">{d('fIdHint')}</p>
          <NationalIdField identity={identity} value={nid} onChange={setNid} selfBirthDate={form.self_birth_date} selfGender={form.self_gender} onSelfChange={(k, v) => set(k, v)} serverError={nidError} disabled={busy} />
        </div>
      </div>
    </Modal>
  )
}

/**
 * The team of a company as a manager works with it (design 09 M3): every member with the values DERIVED from his national ID (age, gender, governorate) or flagged self-declared,
 * the national ID masked with an audited reveal, and the actions: edit (details + ID), make CEO, remove, add a record without an account. Counts are derived, never typed.
 */
export default function CompanyAdminTeam({ companyId, team, counts, ceoFounderId, onChanged }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const fmt = useAdminFormat()
  const labels = useLabels()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const [dialog, setDialog] = useState(null) // { member|null }
  const [busyId, setBusyId] = useState(null)

  async function run(id, fn, ok) {
    setBusyId(id)
    try {
      await fn()
      toast.success(ok)
      await onChanged()
    } catch (e) {
      toast.error(errorText(e))
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
      {team.length === 0 ? <p className="text-sm text-muted-foreground">{d('noTeam')}</p> : (
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
