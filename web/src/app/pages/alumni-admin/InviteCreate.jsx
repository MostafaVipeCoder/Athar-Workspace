import { useRef, useState } from 'react'
import { FileUp, Link2, UserPlus } from 'lucide-react'
import { listAlumniDirectory, useAlumniMutations } from '../../../data/alumni.js'
import { appBaseUrl } from '../../../lib/links.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Segmented, SectionCard } from './ui.jsx'
import CompanyPicker from './CompanyPicker.jsx'
import { looksLikeId, matchCompanyByName, parseInviteLines } from './adminLogic.js'
import { useAdminErrorText } from './hooks.js'
import './i18n.common.js'
import './invitations.i18n.js'

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function ChosenCompany({ company, onClear }) {
  const { t, pick } = useLanguage()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-surface/50 px-3 py-2">
      <p className="text-sm font-semibold">{t('alumni.admin.inv.chosenCompany', { name: pick(company, 'name') })}</p>
      <Button variant="ghost" size="sm" onClick={onClear}>{t('alumni.admin.inv.change')}</Button>
    </div>
  )
}

/**
 * Create invitations (M4): one (e-mail + company) or several at once (one `e-mail, company` per line, pasted or loaded from a CSV). The link of every created invitation is
 * handed to `onCreated` and shown ONCE (the database keeps only a hash): the e-mail itself is not sent by the platform (no delivery worker yet), so copying the link is the way.
 */
export default function InviteCreate({ onCreated }) {
  const { t, tn, lang, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.inv.${k}`, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { createInvitation } = useAlumniMutations()
  const [mode, setMode] = useState('single')
  const [company, setCompany] = useState(null)
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  // The invitation carries no language of its own yet (no e-mail worker: the manager copies the link), so there is no control for it; the UI language is sent along.
  const language = lang
  const [text, setText] = useState('')
  const [lines, setLines] = useState(null) // the checked lines of the bulk box
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState(null)
  const fileRef = useRef(null)
  const appUrl = appBaseUrl()

  async function createOne(e) {
    e.preventDefault()
    if (!company || !EMAIL_OK.test(email.trim())) return
    try {
      const r = await createInvitation.mutateAsync({ companyId: company.id, email: email.trim(), language, appUrl })
      onCreated([{ id: r.id, email: r.email, companyName: pick(company, 'name'), companyId: company.id, link: r.link }])
      toast.success(d('createdOne', { email: r.email }))
      setEmail('')
    } catch (err) {
      toast.error(errorText(err, { email: d('email') }))
    }
  }

  async function check() {
    setChecking(true)
    try {
      const parsed = parseInviteLines(text).rows
      const cache = new Map()
      const out = []
      for (const r of parsed) {
        let error = r.error
        let target = null
        if (!error) {
          if (!r.company) {
            if (company) target = company
            else error = 'no_company'
          } else if (looksLikeId(r.company)) {
            target = { id: r.company.trim().toLowerCase(), name_en: r.company.trim(), name_ar: r.company.trim() }
          } else {
            if (!cache.has(r.company)) cache.set(r.company, await listAlumniDirectory({ filters: { q: r.company, scope: 'all' }, limit: 12, sort: 'name' }).then((x) => x.rows).catch(() => []))
            const m = matchCompanyByName(cache.get(r.company), r.company)
            if (m.status === 'one') target = m.company
            else error = m.status === 'many' ? 'company_many' : 'company_none'
          }
        }
        out.push({ ...r, companyText: r.company, error, company: target })
      }
      setLines(out)
    } finally {
      setChecking(false)
    }
  }

  async function createBulk() {
    const todo = (lines ?? []).filter((l) => !l.error)
    const created = []
    const failed = []
    for (let i = 0; i < todo.length; i += 1) {
      setProgress({ done: i, total: todo.length })
      const l = todo[i]
      try {
        const r = await createInvitation.mutateAsync({ companyId: l.company.id, email: l.email, language, appUrl })
        created.push({ id: r.id, email: r.email, companyName: pick(l.company, 'name'), companyId: l.company.id, link: r.link })
      } catch (err) {
        failed.push({ ...l, failure: errorText(err, { email: d('email') }) })
      }
    }
    setProgress(null)
    onCreated(created, failed)
    if (created.length) toast.success(tn('alumni.admin.inv.createdMany', created.length))
    if (failed.length) toast.error(tn('alumni.admin.inv.failedMany', failed.length))
    // keep only the lines that failed so the manager can fix them
    setLines(failed.length ? failed.map((f) => ({ ...f, error: 'failed' })) : null)
    if (!failed.length) setText('')
  }

  function loadFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result ?? '')); setLines(null) }
    reader.readAsText(f)
    e.target.value = ''
  }

  const valid = (lines ?? []).filter((l) => !l.error).length
  const invalid = (lines ?? []).length - valid

  return (
    <SectionCard id="create" title={d('create')} testId="invite-create">
      <div className="space-y-4">
        <Segmented label={d('create')} value={mode} onChange={setMode} options={[{ value: 'single', label: d('single') }, { value: 'bulk', label: d('bulk') }]} />

        {mode === 'single' ? (
          <form onSubmit={createOne} className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {company ? <ChosenCompany company={company} onClear={() => setCompany(null)} /> : <CompanyPicker label={d('company')} onSelect={setCompany} />}
            </div>
            <div className="space-y-3">
              <Field type="email" dir="ltr" label={d('email')} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} autoComplete="off"
                error={emailTouched && email.trim() && !EMAIL_OK.test(email.trim()) ? d('line.bad_email') : undefined} />
              <Button type="submit" disabled={!company || !EMAIL_OK.test(email.trim())} loading={createInvitation.isPending}><UserPlus className="h-4 w-4" aria-hidden="true" />{d('createOne')}</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Field as="textarea" dir="ltr" rows={8} label={d('bulkLabel')} hint={d('bulkHelp')} placeholder={d('bulkPlaceholder')} value={text} onChange={(e) => { setText(e.target.value); setLines(null) }} />
                <div className="flex flex-wrap gap-2">
                  <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={loadFile} aria-label={d('loadFile')} tabIndex={-1} />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden="true" />{d('loadFile')}</Button>
                  {text && <Button variant="ghost" size="sm" onClick={() => { setText(''); setLines(null) }}>{d('clearLines')}</Button>}
                </div>
              </div>
              <div className="space-y-2">
                {company ? <ChosenCompany company={company} onClear={() => setCompany(null)} /> : <CompanyPicker label={d('defaultCompany')} onSelect={setCompany} />}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={check} loading={checking} disabled={!text.trim()}>{checking ? d('checking') : d('check')}</Button>
              {lines && (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {tn('alumni.admin.inv.lineCount', lines.length)} · <span className="font-semibold text-success-text">{tn('alumni.admin.inv.validCount', valid)}</span>{invalid > 0 && <> · <span className="font-semibold text-destructive-text">{tn('alumni.admin.inv.invalidCount', invalid)}</span></>}
                </p>
              )}
              {lines && valid > 0 && <Button onClick={createBulk} loading={Boolean(progress)} data-testid="bulk-create"><Link2 className="h-4 w-4" aria-hidden="true" />{progress ? d('creating', progress) : tn('alumni.admin.inv.createBulk', valid)}</Button>}
            </div>
            {lines && lines.length > 0 && (
              <div className="overflow-x-auto rounded-card border" role="region" aria-label={d('create')}>
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="bg-surface text-xs font-bold text-athar-ink">
                    <tr><th scope="col" className="px-3 py-2 text-start">{d('colLine')}</th><th scope="col" className="px-3 py-2 text-start">{d('colEmail')}</th><th scope="col" className="px-3 py-2 text-start">{d('colCompany')}</th><th scope="col" className="px-3 py-2 text-start">{d('colResult')}</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.line} className="border-t">
                        <td className="px-3 py-1.5 tabular-nums">{l.line}</td>
                        <td className="px-3 py-1.5" dir="ltr">{l.email || '—'}</td>
                        <td className="px-3 py-1.5">{l.company ? pick(l.company, 'name') : l.companyText || '—'}</td>
                        <td className="px-3 py-1.5">{l.error ? <Badge tone="red">{l.error === 'failed' ? l.failure : d(`line.${l.error}`)}</Badge> : <Badge tone="green">{d('line.ok')}</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
