import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, CheckCircle2, ExternalLink, Handshake } from 'lucide-react'
import { useMyAlumniProfile } from '../../../data/alumni.js'
import { useApplyMutation, useMyApplications, useOpportunities } from '../../../data/alumniFounder.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { ExpandableText } from '../../../ui/ExpandableText.jsx'
import { Field } from '../../../ui/Field.jsx'
import { Img } from '../../../ui/Img.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { daysLeft, filterOpportunities, opportunityState, opportunityType, OPPORTUNITY_TYPES, safeHttpUrl, statusTone } from '../../../lib/alumniFounder.js'
import { cn } from '../../../lib/cn.js'
import { ChipSelect } from '../../../shared/alumni/pickers.jsx'
import { useAlumniErrorText } from '../../../shared/alumni/useAlumniErrorText.js'
import './alumni.i18n.js'
import './alumni.opportunities.i18n.js'
import '../../../shared/alumni/i18n.js'

/** Apply / express interest with one of the founder's companies (the server sets the status, the date and the founder; a note is optional). */
function ApplyModal({ opportunity, companies, onClose }) {
  const { t, pick } = useLanguage()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const apply = useApplyMutation()
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    try {
      await apply.mutateAsync({ opportunityId: opportunity.opportunity_id, companyId, notes })
      toast.success(t('alumni.founder.opp.applied'))
      onClose()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('alumni.founder.opp.applyTitle')}
      description={pick(opportunity, 'title')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>{t('common.cancel')}</Button>
          <Button type="submit" form="apply-form" loading={apply.isPending} disabled={!companyId}>{t('alumni.founder.opp.send')}</Button>
        </>
      }
    >
      <form id="apply-form" onSubmit={submit} className="space-y-field-gap" noValidate>
        {companies.length > 1 ? (
          <Field as="select" label={t('alumni.founder.opp.company')} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{pick(c, 'name')}</option>)}
          </Field>
        ) : (
          <p className="text-sm">{t('alumni.founder.opp.applyingAs', { company: pick(companies[0] ?? {}, 'name') })}</p>
        )}
        <Field as="textarea" rows={4} maxLength={1000} label={t('alumni.founder.opp.notes')} hint={t('alumni.founder.opp.notesHint')} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{error}</p>}
      </form>
    </Modal>
  )
}

function OpportunityCard({ o, applications, companies, highlighted, onApply }) {
  const { t, tn, pick, formatDate } = useLanguage()
  const ref = useRef(null)
  const state = opportunityState(o)
  const left = daysLeft(o.deadline)
  const mine = applications.find((a) => a.opportunity_id === o.opportunity_id)
  const link = safeHttpUrl(o.link)
  const image = safeHttpUrl(o.image_url)
  const type = opportunityType(o.type)
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView?.({ block: 'center' }) }, [highlighted])
  const statusLabel = (s) => { const k = `alumni.founder.opp.status.${s}`; const v = t(k); return v === k ? s : v }

  return (
    <li ref={ref} className={cn('overflow-hidden rounded-card border bg-card', highlighted && 'ring-2 ring-primary')} data-testid="opportunity" data-state={state}>
      {image && <Img src={image} alt="" aspect="16 / 7" />}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="blue">{t(`alumni.founder.opp.type.${type}`)}</Badge>
          {o.deadline && state === 'expired' && <Badge tone="red">{t('alumni.founder.opp.closed')}</Badge>}
          {o.deadline && state === 'closing' && <Badge tone="amber"><CalendarClock className="h-3 w-3" aria-hidden="true" />{left === 0 ? t('alumni.founder.opp.closesToday') : tn('alumni.founder.opp.daysLeft', left)}</Badge>}
          {o.deadline && state === 'open' && <Badge tone="outline">{t('alumni.founder.opp.deadline', { date: formatDate(`${o.deadline}T12:00:00`, { dateStyle: 'medium' }) })}</Badge>}
          {mine && <Badge tone={statusTone(mine.status)} data-testid="application-status"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />{statusLabel(mine.status)}</Badge>}
        </div>
        <h2 dir="auto" className="break-words text-card-title">{pick(o, 'title')}</h2>
        <ExpandableText text={pick(o, 'description')} labels={{ more: t('alumni.founder.notifications.more'), less: t('alumni.founder.notifications.less') }} />
        {o.eligibility && <p className="text-sm"><span className="font-semibold">{t('alumni.founder.opp.eligibility')}</span> {o.eligibility}</p>}
        {mine && <p className="text-xs text-muted-foreground">{t('alumni.founder.opp.appliedOn', { date: formatDate(mine.applied_at, { dateStyle: 'medium' }), company: pick(companies.find((c) => c.id === mine.company_id) ?? {}, 'name') })}</p>}
        <div className="flex flex-wrap gap-2">
          {!mine && state !== 'expired' && (
            companies.length > 0 ? (
              <Button onClick={() => onApply(o)} data-testid="apply-button"><Handshake className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.opp.apply')}</Button>
            ) : (
              <Link to="/alumni/founder/company/new" className={buttonClass({ variant: 'outline' })}>{t('alumni.founder.opp.needCompany')}</Link>
            )
          )}
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline' })}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.opp.moreInfo')}</a>}
        </div>
      </div>
    </li>
  )
}

/** /alumni/founder/opportunities (design 09 F8): the active opportunities with filters, details and an application with one of the founder's companies; the status of every application. */
export default function FounderOpportunitiesPage() {
  const { t } = useLanguage()
  const [params] = useSearchParams()
  const q = useOpportunities()
  const apps = useMyApplications()
  const me = useMyAlumniProfile()
  const [text, setText] = useState('')
  const [type, setType] = useState('all')
  const [state, setState] = useState('open')
  const [applying, setApplying] = useState(null)
  const companies = useMemo(() => me.data?.companies ?? [], [me.data])
  const applications = useMemo(() => apps.data ?? [], [apps.data])
  const appliedIds = useMemo(() => new Set(applications.map((a) => a.opportunity_id)), [applications])
  const openId = params.get('open')

  const all = useMemo(() => q.data ?? [], [q.data])
  const types = useMemo(() => [...new Set(all.map((o) => opportunityType(o.type)))], [all])
  const typeOptions = [{ value: 'all', label: t('alumni.founder.opp.typeAll') }, ...[...OPPORTUNITY_TYPES, 'other'].filter((x) => types.includes(x)).map((x) => ({ value: x, label: t(`alumni.founder.opp.type.${x}`) }))]
  const rows = useMemo(() => filterOpportunities(all, { type, q: text, state: openId ? 'all' : state, applied: appliedIds }), [all, type, text, state, appliedIds, openId])

  return (
    <div className="space-y-4" data-testid="founder-opportunities">
      <div>
        <h1 className="text-section-title">{t('alumni.founder.opp.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('alumni.founder.opp.subtitle')}</p>
      </div>
      <SearchBar value={text} onChange={setText} label={t('alumni.founder.opp.search')} />
      {all.length > 0 && (
        <div className="space-y-3">
          {typeOptions.length > 2 && <ChipSelect label={t('alumni.founder.opp.typeLabel')} options={typeOptions} value={type} onChange={setType} />}
          <ChipSelect
            label={t('alumni.founder.opp.showLabel')}
            options={[{ value: 'open', label: t('alumni.founder.opp.stateOpen') }, { value: 'applied', label: t('alumni.founder.opp.stateApplied') }, { value: 'all', label: t('alumni.founder.opp.stateAll') }]}
            value={state}
            onChange={setState}
          />
        </div>
      )}
      {q.isPending ? (
        <SkeletonList count={2} className="space-y-3" itemClassName="h-40 w-full" />
      ) : q.error ? (
        <ErrorState error={q.error} title={t('alumni.founder.opp.loadFailed')} onRetry={q.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Handshake} title={all.length === 0 ? t('alumni.founder.opp.empty') : t('alumni.founder.opp.noMatch')} body={all.length === 0 ? t('alumni.founder.opp.emptyBody') : t('alumni.founder.opp.noMatchBody')} />
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => <OpportunityCard key={o.opportunity_id} o={o} applications={applications} companies={companies} highlighted={o.opportunity_id === openId} onApply={setApplying} />)}
        </ul>
      )}
      {applying && <ApplyModal opportunity={applying} companies={companies} onClose={() => setApplying(null)} />}
    </div>
  )
}
