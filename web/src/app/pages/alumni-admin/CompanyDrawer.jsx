import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useAlumniCompany, useAlumniStamps } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import FiguresPanel from '../../../shared/alumni/FiguresPanel.jsx'
import StampLine from '../../../shared/alumni/StampLine.jsx'
import { Query, FactRow, Segmented } from './ui.jsx'
import ManagerFields from './ManagerFields.jsx'
import CompanyAdminTeam from './CompanyAdminTeam.jsx'
import CompanyProfileForm from './CompanyProfileForm.jsx'
import RevealId from './RevealId.jsx'
import { useCompanyActions } from './useCompanyActions.js'
import { reviewState } from './columns.js'
import { useAdminFormat, useLabels } from './hooks.js'
import './i18n.common.js'
import './directory.i18n.js'
import './company.i18n.js'
import './company.edit.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'
import '../../../shared/alumni/i18n.edit.js'
import '../../../shared/alumni/i18n.quarters.js'

const TABS = ['overview', 'edit', 'team', 'figures']

/**
 * The company drawer of the directory (M2 / M3): what a manager needs without leaving the list, now with EVERY field editable (owner decision 20.3): an overview with the manager-owned
 * fields (alumni mark, private hint, directory veto, review stamp), the full profile form, the team (every founder, national ID, bio) and the quarterly figures (draft, closed quarters, corrections).
 * Program participation, the founders' derived values and the counts are read-only: they are derived by the database (the CEO's age / gender / governorate come from the national ID).
 * IDs are masked with an audited reveal. Closing the drawer with unsaved edits asks first.
 */
export default function CompanyDrawer({ row, onClose }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const co = (k, v) => t(`alumni.admin.co.${k}`, v)
  const confirm = useConfirm()
  const q = useAlumniCompany(row?.id)
  const [tab, setTab] = useState('overview')
  const [dirty, setDirty] = useState(false)
  const name = row ? pick(row, 'name') : ''

  async function close() {
    if (dirty && !(await confirm({ title: t('alumni.common.leaveTitle'), message: t('alumni.common.leaveBody'), confirmLabel: t('alumni.common.leave'), cancelLabel: t('alumni.common.stay'), destructive: true }))) return
    setDirty(false)
    onClose()
  }

  return (
    <Modal open={Boolean(row)} onClose={close} side className="sm:max-w-3xl" title={name || d('drawerTitle')} description={d('drawerTitle')} closeLabel={d('drawerClose')} footer={
      row ? <Link to={`/alumni/admin/company/${row.id}`} className={buttonClass({ variant: 'primary', size: 'md' })}><ExternalLink className="h-4 w-4" aria-hidden="true" />{d('openFullPage')}</Link> : null
    }>
      {row && (
        <div className="space-y-4">
          <Segmented label={d('drawerTitle')} value={tab} onChange={setTab} options={TABS.map((x) => ({ value: x, label: co(`drawerTab${x[0].toUpperCase()}${x.slice(1)}`) }))} />
          <Query query={q} skeleton="h-64 w-full">
            {(data) => (
              tab === 'overview' ? <DrawerBody data={data} />
                : tab === 'edit' ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{co('drawerEditHint')}</p><CompanyProfileForm key={data.company.id} payload={data} embedded onDirtyChange={setDirty} /></div>
                : tab === 'team' ? <DrawerTeam data={data} />
                : <DrawerFigures data={data} />
            )}
          </Query>
        </div>
      )}
    </Modal>
  )
}

function DrawerTeam({ data }) {
  const actions = useCompanyActions()
  const stamps = useAlumniStamps(data.company.id)
  return <CompanyAdminTeam companyId={data.company.id} team={data.team} counts={data.counts} ceoFounderId={data.ceo_founder_id} onChanged={actions.refresh} founderStamps={stamps.data?.founders ?? []} />
}

function DrawerFigures({ data }) {
  return <FiguresPanel companyId={data.company.id} audience="manager" companyName={data.company.name_en || data.company.name_ar} />
}

function DrawerBody({ data }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const fmt = useAdminFormat()
  const labels = useLabels()
  const c = data.company
  const internal = c.internal ?? {}
  const review = reviewState({ reviewed_at: internal.reviewed_at, updated_at: c.updated_at })
  const latest = (data.snapshots ?? []).find((s) => s.reported)

  return (
    <div className="space-y-6" data-testid="company-drawer">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={c.is_alumni ? 'blue' : 'outline'}>{c.is_alumni ? d('alumniYes') : d('alumniNo')}</Badge>
        <Badge tone={c.operating_status === 'closed' ? 'red' : 'green'}>{t(c.operating_status === 'closed' ? 'alumni.admin.common.closed.status' : 'alumni.admin.common.open.status')}</Badge>
        <Badge tone={review === 'current' ? 'green' : review === 'changed' ? 'amber' : 'outline'}>{t(`alumni.admin.common.review.${review}`)}</Badge>
        <Badge tone="neutral">{d('drawer.visibilityShort')}: {labels.label('directory_visibility', c.directory_visibility)}</Badge>
      </div>
      <StampLine audience="manager" stamp={c.updated_source ? { at: c.updated_at, source: c.updated_source } : null} />

      <section aria-labelledby="dr-manager" className="space-y-3 rounded-card border bg-surface/50 p-4">
        <h3 id="dr-manager" className="text-base font-bold">{d('drawer.manager')}</h3>
        <ManagerFields company={c} />
      </section>

      <section aria-labelledby="dr-programs" className="space-y-2">
        <h3 id="dr-programs" className="text-base font-bold">{d('drawer.programs')}</h3>
        {data.programs.length === 0 ? <p className="text-sm text-muted-foreground">{d('drawer.noPrograms')}</p> : (
          <ul className="space-y-1.5">
            {data.programs.map((p) => (
              <li key={p.project_id} className="rounded-md border px-3 py-2 text-sm">
                <span className="font-semibold">{pick(p, 'program_name')}</span> <span className="text-muted-foreground">· {pick(p, 'project_name')}</span>
                <span className="mt-1 flex flex-wrap gap-1">{(p.support ?? []).map((s) => <Badge key={s} tone="outline">{labels.label('support_kind', s)}</Badge>)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dr-team" className="space-y-2">
        <h3 id="dr-team" className="text-base font-bold">{d('drawer.team')}</h3>
        {data.team.length === 0 ? <p className="text-sm text-muted-foreground">{d('drawer.noTeam')}</p> : (
          <ul className="space-y-2">
            {data.team.map((m) => (
              <li key={m.founder_id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">{pick(m, 'name') || '—'}</span>
                  {m.founder_id === data.ceo_founder_id && <Badge tone="blue">{d('drawer.ceoBadge')}</Badge>}
                  {!m.has_account && <Badge tone="outline">{d('drawer.noAccount')}</Badge>}
                  {m.role && <span className="text-xs text-muted-foreground">{m.role}</span>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <FactRow label={d('col.ceo_age')} hint={m.source === 'self' ? d('ceoSrc.self') : m.source === 'id' ? t('alumni.admin.common.derived.id') : undefined}>{m.age !== null && m.age !== undefined ? d('drawer.ageFrom', { age: fmt.num(m.age) }) : ''}</FactRow>
                  <FactRow label={d('col.ceo_gender')}>{labels.label('gender', m.gender)}</FactRow>
                  <FactRow label={d('col.governerate')}>{m.governorate !== null && m.governorate !== undefined ? labels.label('governorate', m.governorate) : ''}</FactRow>
                  <FactRow label={d('col.student_graduate')}>{labels.label('education_status', m.education_status)}</FactRow>
                  <FactRow label={d('col.email')}><span dir="ltr">{m.email}</span></FactRow>
                  <FactRow label={d('col.phone')}><span dir="ltr">{m.phone}</span></FactRow>
                </dl>
                <div className="flex items-center gap-2 text-sm"><span className="text-xs font-semibold text-muted-foreground">{d('col.national_id')}</span><RevealId masked={m.id_masked} founderId={m.founder_id} hasId={Boolean(m.id_masked)} /></div>
              </li>
            ))}
          </ul>
        )}
        <dl className="grid grid-cols-3 gap-3 pt-1">
          <FactRow label={d('col.founding_team_size')}>{fmt.num(data.counts.team_size)}</FactRow>
          <FactRow label={d('col.female_founders')}>{fmt.num(data.counts.female_founders)}</FactRow>
          <FactRow label={d('col.founders_below_35')}>{fmt.num(data.counts.founders_under_35)}</FactRow>
        </dl>
      </section>

      <section aria-labelledby="dr-metrics" className="space-y-2">
        <h3 id="dr-metrics" className="text-base font-bold">{latest ? d('drawer.metrics', { year: latest.period_key }) : d('drawer.metrics', { year: '' })}</h3>
        {!latest ? <p className="text-sm text-muted-foreground">{d('drawer.noMetrics')}</p> : (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <FactRow label={d('col.revenue', { year: latest.period_key })}>{fmt.money(latest.revenue_total)}</FactRow>
            <FactRow label={d('col.funding_raised')}>{fmt.money(latest.funding_raised_total)}</FactRow>
            <FactRow label={d('col.employees')}>{fmt.num(latest.employees_total)}</FactRow>
            <FactRow label={d('col.female_employees')}>{fmt.num(latest.employees_female)}</FactRow>
            <FactRow label={d('col.freelancers')}>{fmt.num(latest.freelancers)}</FactRow>
          </dl>
        )}
      </section>
    </div>
  )
}
