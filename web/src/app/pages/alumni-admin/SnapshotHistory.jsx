import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useAlumniCompany, useAlumniMutations } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useAdminErrorText, useAdminFormat } from './hooks.js'
import './i18n.common.js'
import './workspace.i18n.js'

/** Every yearly row of a company with its source (founder / manager / import) and last change; a manager can delete a year (a confirmed, irreversible action). */
export default function SnapshotHistory({ company, onClose }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.ws.${k}`, v)
  const fmt = useAdminFormat()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { deleteSnapshot } = useAlumniMutations()
  const q = useAlumniCompany(company.id)

  async function remove(s) {
    const ok = await confirm({ title: d('deleteTitle', { year: s.year }), message: d('deleteBody', { company: company.name, year: s.year }), confirmLabel: d('deleteYear', { year: s.year }), destructive: true })
    if (!ok) return
    try {
      await deleteSnapshot.mutateAsync({ companyId: company.id, year: s.year })
      toast.success(d('deleted'))
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  return (
    <Modal open onClose={onClose} title={d('historyTitle', { company: company.name })} closeLabel={t('common.close')} className="sm:max-w-4xl"
      footer={<><Link to={`/alumni/admin/company/${company.id}`} className={buttonClass({ variant: 'outline' })}>{d('openCompany')}</Link><Button onClick={onClose}>{d('close')}</Button></>}>
      {q.isPending ? <Skeleton className="h-32 w-full" /> : q.isError ? <ErrorState error={q.error} title={d('historyFailed')} onRetry={() => q.refetch()} /> : q.data.snapshots.length === 0 ? <p className="text-sm text-muted-foreground">{d('historyEmpty')}</p> : (
        <div className="overflow-x-auto rounded-card border" role="region" aria-label={d('historyTitle', { company: company.name })}>
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface text-xs font-bold text-athar-ink">
              <tr>
                <th scope="col" className="px-3 py-2 text-start">{t('alumni.admin.common.year')}</th>
                {['revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers'].map((f) => <th key={f} scope="col" className="px-3 py-2 text-start">{d(`col.${f}`)}</th>)}
                <th scope="col" className="px-3 py-2 text-start">{d('source')}</th>
                <th scope="col" className="px-3 py-2 text-start">{d('updated')}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{d('deleteYear', { year: '' })}</span></th>
              </tr>
            </thead>
            <tbody>
              {q.data.snapshots.map((s) => (
                <tr key={s.id} className="border-t tabular-nums">
                  <th scope="row" className="px-3 py-1.5 text-start font-semibold">{s.year}</th>
                  <td className="px-3 py-1.5">{fmt.money(s.revenue_total)}</td>
                  <td className="px-3 py-1.5">{fmt.money(s.funding_raised_total)}</td>
                  <td className="px-3 py-1.5">{fmt.num(s.employees_total)}</td>
                  <td className="px-3 py-1.5">{fmt.num(s.employees_female)}</td>
                  <td className="px-3 py-1.5">{fmt.num(s.freelancers)}</td>
                  <td className="px-3 py-1.5"><Badge tone="outline">{d(`source.${s.source}`)}</Badge></td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmt.dateTime(s.updated_at)}</td>
                  <td className="px-3 py-1.5"><Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => remove(s)} aria-label={d('deleteYear', { year: s.year })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
