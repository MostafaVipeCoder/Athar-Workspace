import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet } from 'lucide-react'
import { useAdminMutations, useApplications } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Field, SELECT_CLASS } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { APP_STATUSES, appStatusTone } from './adminLogic.js'
import { exportFilename, exportRows } from './exportXlsx.js'
import CompanyPicker from './CompanyPicker.jsx'
import { useAdminErrorText, useAdminFormat } from './hooks.js'
import './i18n.common.js'
import './opportunities.i18n.js'

/** The applications of one opportunity (M6): who applied, the status workflow (applied -> under review -> shortlisted -> accepted / rejected), apply on behalf, Excel export. */
export default function OpportunityApplications({ opportunity, onClose }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.opp.${k}`, v)
  const fmt = useAdminFormat()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { setApplicationStatus, applyOnBehalf } = useAdminMutations()
  const q = useApplications(opportunity.opportunity_id)
  const [company, setCompany] = useState(null)
  const [note, setNote] = useState('')
  const open = opportunity.is_active && !opportunity.archived_at
  const title = pick(opportunity, 'title')

  async function change(app, status) {
    try {
      await setApplicationStatus.mutateAsync({ id: app.id, status })
      toast.success(d('statusSaved'))
    } catch (e) {
      toast.error(`${d('actionFailed')} ${errorText(e)}`)
    }
  }
  async function add() {
    if (!company) return
    try {
      await applyOnBehalf.mutateAsync({ opportunityId: opportunity.opportunity_id, companyId: company.id, notes: note })
      toast.success(d('onBehalfDone'))
      setCompany(null)
      setNote('')
    } catch (e) {
      toast.error(`${d('actionFailed')} ${errorText(e)}`)
    }
  }
  async function exportApps() {
    const rows = (q.data ?? []).map((a) => ({
      company: pick(a.company ?? {}, 'name'), founder: a.founder ? pick(a.founder, 'name') : '', email: a.founder?.email ?? '', status: d(`astatus.${a.status}`), applied: fmt.date(a.applied_at), note: a.notes ?? '',
    }))
    await exportRows(rows, [
      { key: 'company', header: d('colCompany') }, { key: 'founder', header: d('colFounder') }, { key: 'email', header: d('colEmail') }, { key: 'status', header: d('colStatus') }, { key: 'applied', header: d('colApplied') }, { key: 'note', header: d('colNote') },
    ], exportFilename(d('exportAppsFile')), { sheetName: d('exportAppsFile') })
  }

  return (
    <Modal open onClose={onClose} side title={d('appsTitle', { title })} closeLabel={t('common.close')}
      footer={<><Button variant="outline" onClick={exportApps} disabled={!q.data?.length}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{d('exportApps')}</Button><Button onClick={onClose}>{d('closeApps')}</Button></>}>
      <div className="space-y-5">
        <section aria-labelledby="onbehalf" className="space-y-3 rounded-card border bg-surface/50 p-4">
          <h3 id="onbehalf" className="text-base font-bold">{d('onBehalf')}</h3>
          <p className="text-sm text-muted-foreground">{open ? d('onBehalfBody') : d('onBehalfClosed')}</p>
          {open && (
            <>
              {company
                ? <p className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm font-semibold">{pick(company, 'name')}<Button variant="ghost" size="sm" onClick={() => setCompany(null)}>{d('change')}</Button></p>
                : <CompanyPicker onSelect={setCompany} />}
              <Field label={d('onBehalfNote')} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" onClick={add} disabled={!company} loading={applyOnBehalf.isPending}>{d('onBehalfSubmit')}</Button>
            </>
          )}
        </section>
        {q.isPending ? <Skeleton className="h-32 w-full" /> : q.isError ? <ErrorState error={q.error} title={d('appsFailed')} onRetry={() => q.refetch()} /> : q.data.length === 0 ? <EmptyState title={d('appsEmpty')} /> : (
          <ul className="space-y-3" data-testid="applications">
            {q.data.map((a) => {
              const name = pick(a.company ?? {}, 'name')
              return (
                <li key={a.id} className="space-y-2 rounded-card border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/alumni/admin/company/${a.company_id}`} className="font-semibold text-primary hover:underline">{name}</Link>
                      <p className="text-xs text-muted-foreground">{a.founder ? `${d('founderLine', { name: pick(a.founder, 'name') })} · ` : ''}{d('appliedOn', { date: fmt.date(a.applied_at) })}</p>
                    </div>
                    <Badge tone={appStatusTone(a.status)}>{d(`astatus.${a.status}`)}</Badge>
                  </div>
                  {a.notes && <p className="whitespace-pre-wrap break-words rounded-md bg-surface px-3 py-2 text-sm"><span className="block text-xs font-semibold text-muted-foreground">{d('noteLabel')}</span>{a.notes}</p>}
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{d('statusLabel', { name })}</span>
                    <select className={`${SELECT_CLASS} min-h-11 w-auto py-1`} value={a.status} onChange={(e) => change(a, e.target.value)} disabled={setApplicationStatus.isPending}>
                      {APP_STATUSES.map((s) => <option key={s} value={s}>{d(`astatus.${s}`)}</option>)}
                    </select>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
