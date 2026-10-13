import { lazy, Suspense, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useInputPort } from '../_kit/useInputPort.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { cn } from '../../lib/cn.js'
import { buildPublicUrl } from '../../lib/links.js'
import { keys } from '../../data/queryKeys.js'
import { materializeCandidates, useDistributionLinks, useDistributionMutations, useDistributionPayload, useDistributionRules, useTimerState, getDistributionPayload, getDistributionRules } from '../../data/distribution.js'
import {
  candidatesFromItems, draftFromModel, draftToChildren, normalizePayload, randomSeed, sameDraft, toMatchingInput, toReplaceRows, validateDraft,
} from './distributionLogic.js'
import { generateDistribution } from './matching.js'
import SetupTab from './SetupTab.jsx'
import TimetableTab from './TimetableTab.jsx'

const TimerControls = lazy(() => import('./TimerControls.jsx'))
const LiveBoard = lazy(() => import('./LiveBoard.jsx'))

const TABS = ['setup', 'timetable', 'live']

/**
 * Edit mode of a Mentoring Distribution node (design 01 section 3.7): Setup (round, days, mentors by day, availability, unique pairing:
 * a draft with ONE explicit Save = save_node + children), Timetable (generate / regenerate with the one algorithm, manual swap/move with
 * Undo, lock days, publish, Excel, print: row-level, validated by RPCs) and Live (the PM's timer remote + a preview of the live board).
 * Mentors and companies arrive BY REFERENCE through the `mentors` / `companies` ports (lists); virtual items are materialised
 * (`ensure_items`) only when something must point at them. The optional `schedule` port (Agenda) supplies the days' dates; without it the
 * node uses its own day config (decision 02-12).
 */
export default function DistributionEdit() {
  const { node, projectId, graph } = useNodeContext()
  const { t, pick } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const payloadQuery = useDistributionPayload(node.id)
  const rulesQuery = useDistributionRules(node.id)
  const mentorsIn = useInputPort('mentors')
  const companiesIn = useInputPort('companies')
  const scheduleIn = useInputPort('schedule')
  const { save, saving } = useNodeConfig()
  const onChanged = () => invalidateNodeOutputs(qc, graph, node.id, projectId)
  const mutations = useDistributionMutations(node.id, { onChanged })
  const [tab, setTab] = useState('setup')
  const [errors, setErrors] = useState({})
  const [generating, setGenerating] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [seed, setSeed] = useState(() => randomSeed())
  const [fixedSeed, setFixedSeed] = useState(false)

  const model = useMemo(() => normalizePayload(payloadQuery.data), [payloadQuery.data])
  const rulesRows = rulesQuery.data
  const baseDraft = useMemo(() => (model && rulesRows ? draftFromModel(model, rulesRows) : null), [model, rulesRows])
  const [base, setBase] = useState(null)
  const [draft, setDraft] = useState(null)
  // adopt a newer saved state (another session, our own save) unless the user has unsaved edits
  if (baseDraft && (!base || (!sameDraft(base, baseDraft) && sameDraft(draft, base)))) {
    setBase(baseDraft)
    setDraft(baseDraft)
  }
  const dirty = Boolean(draft && base && !sameDraft(draft, base))

  const mentorCands = useMemo(() => candidatesFromItems(mentorsIn.items), [mentorsIn.items])
  const companyCands = useMemo(() => candidatesFromItems(companiesIn.items), [companiesIn.items])
  const rulesForChecks = useMemo(() => {
    const out = {}
    for (const r of rulesRows ?? []) {
      const m = (v) => { const x = /^(\d{1,2}):(\d{2})/.exec(v ?? ''); return x ? Number(x[1]) * 60 + Number(x[2]) : null }
      out[r.mentor_item_id] = { days: Array.isArray(r.days) ? r.days.map(Number) : null, maxSlots: r.max_slots ?? null, from: m(r.available_from), to: m(r.available_to) }
    }
    return out
  }, [rulesRows])
  // decision 01-7 (warning only): Booking nodes fed by the SAME mentors list - a mentor may be in both, the PM should keep the online slots clear of the hall days
  const sharedBookings = useMemo(() => {
    const edges = (graph?.edges ?? []).filter((x) => x.is_enabled !== false)
    const mine = new Set(edges.filter((x) => x.to_node_id === node.id && x.to_port === 'mentors').map((x) => x.from_node_id))
    return (graph?.nodes ?? []).filter((n) => n.type === 'booking' && edges.some((x) => x.to_node_id === n.id && x.to_port === 'mentors' && mine.has(x.from_node_id))).map((n) => pick(n, 'name'))
  }, [graph, node.id, pick])
  const realCompanyIds = useMemo(() => (companyCands.length ? companyCands.filter((c) => !c.virtual).map((c) => c.key) : null), [companyCands])

  async function refreshAll() {
    await qc.invalidateQueries({ queryKey: keys.node(node.id) })
  }

  /** ONE save_node: node columns untouched, children = settings + days + mentors + rules; virtual mentors are materialised first. */
  async function saveSetup() {
    const errs = validateDraft(draft)
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error(t('distribution.setup.fixErrors'))
      return false
    }
    try {
      const virtual = mentorCands.filter((c) => c.virtual && (draft.days.some((d) => d.mentorIds.includes(c.key)) || draft.rules[c.key]))
      const idMap = virtual.length ? await materializeCandidates(virtual) : {}
      const idOf = (k) => idMap[k] ?? k
      const resolved = {
        ...draft,
        days: draft.days.map((d) => ({ ...d, mentorIds: [...new Set(d.mentorIds.map(idOf))] })),
        rules: Object.fromEntries(Object.entries(draft.rules).map(([k, v]) => [idOf(k), v])),
      }
      const result = await save(null, { children: draftToChildren(resolved) })
      if (!result.ok) {
        if (result.error?.token === 'distribution_day_locked') toast.error(t('distribution.err.dayLocked'))
        else if (result.error?.messageKey) toast.error(t(result.error.messageKey))
        return false
      }
      setBase(resolved)
      setDraft(resolved)
      await refreshAll()
      return true
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return false
    }
  }

  /** Generate (scope 'all') / Regenerate unlocked (scope 'unlocked'): saves the draft first, runs the pure algorithm, persists atomically. */
  async function generate(scope, targetDayIds = null) {
    if (generating) return
    setGenerating(scope)
    try {
      if (dirty && !(await saveSetup())) return
      const [payload, rules] = await Promise.all([qc.fetchQuery({ queryKey: keys.distPayload(node.id), queryFn: () => getDistributionPayload(node.id), staleTime: 0 }), qc.fetchQuery({ queryKey: keys.distRules(node.id), queryFn: () => getDistributionRules(node.id), staleTime: 0 })])
      const fresh = normalizePayload(payload)
      const targets = fresh.days.filter((d) => !d.locked && (!targetDayIds || targetDayIds.includes(d.id)))
      if (targets.length === 0) { toast.error(t('distribution.timetable.noTargets')); return }
      if (!targets.some((d) => d.slots > 0 && d.mentorIds.length > 0)) { toast.error(t('distribution.timetable.noRounds')); return }
      if (companyCands.length === 0) { toast.error(t('distribution.timetable.noCompanies')); return }
      const existing = fresh.sessions.filter((s) => targets.some((d) => d.id === s.dayId) && (scope === 'all' || !s.manual)).length
      if (existing > 0) {
        const ok = await confirm({ title: t('distribution.timetable.replaceTitle'), message: t(scope === 'all' ? 'distribution.timetable.replaceAll' : 'distribution.timetable.replaceUnlocked', { n: existing }), destructive: true, confirmLabel: t('distribution.timetable.replaceConfirm') })
        if (!ok) return
      }
      const ids = await materializeCandidates(companyCands)
      const useSeed = fixedSeed && Number.isFinite(Number(seed)) && seed !== '' ? Number(seed) : randomSeed()
      const result = generateDistribution(toMatchingInput(fresh, rules, Object.values(ids), { scope, targetDayIds: targets.map((d) => d.id), seed: useSeed }))
      await mutations.replaceSessions.mutateAsync({ scope, days: result.dayIds, rows: toReplaceRows(result.sessions), seed: useSeed })
      setLastResult(result)
      if (!fixedSeed) setSeed(useSeed)
      toast.success(t('distribution.timetable.generated', { filled: result.stats.filled, cells: result.stats.cells }))
      if (result.stats.unmatched > 0) toast.warning(t('distribution.timetable.generatedEmpty', { n: result.stats.unmatched }))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setGenerating(null)
    }
  }

  const tabs = (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('distribution.edit.tabs')}>
      {TABS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('tap-target rounded-md px-3 text-sm', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')} data-testid={`tab-${k}`}>
          {t(`distribution.edit.tab.${k}`)}
        </button>
      ))}
    </div>
  )

  const loading = payloadQuery.isPending || rulesQuery.isPending || !draft
  const error = payloadQuery.error ?? rulesQuery.error
  const subtitle = model ? t('distribution.edit.subtitle', { days: model.days.length, sessions: model.sessions.length, status: t(model.published ? 'distribution.published' : 'distribution.draft') }) : null

  return (
    <NodeFrame actions={tabs} subtitle={subtitle} dirty={dirty} saving={saving} onSave={saveSetup}>
      {error ? <ErrorState error={error} onRetry={() => { payloadQuery.refetch(); rulesQuery.refetch() }} /> : loading ? <Loading /> : (
        <>
          {dirty && tab !== 'setup' && <p className="mb-3 rounded-md bg-accent/30 px-3 py-2 text-sm" data-testid="dirty-note">{t('distribution.edit.dirtyNote')}</p>}
          <div className={cn(tab !== 'setup' && 'hidden')}>
            <SetupTab draft={draft} setDraft={setDraft} errors={errors} model={model} mentorCands={mentorCands} companyCands={companyCands} mentorsStatus={mentorsIn.status} companiesStatus={companiesIn.status} schedule={scheduleIn} sharedBookings={sharedBookings} />
          </div>
          <div className={cn(tab !== 'timetable' && 'hidden')}>
            <TimetableTab model={model} rules={rulesForChecks} companyIds={realCompanyIds} onGenerate={generate} generating={generating} lastResult={lastResult} mutations={mutations} seedState={{ seed, setSeed, fixed: fixedSeed, setFixed: setFixedSeed }} hasCompanies={companyCands.length > 0} />
          </div>
          <div className={cn(tab !== 'live' && 'hidden')}>
            {tab === 'live' && <LiveTab nodeId={node.id} model={model} />}
          </div>
        </>
      )}
    </NodeFrame>
  )
}

/** PM remote + preview of the live board. The remote is PM-only by construction (this is the staff editor) and by the RPC. */
function LiveTab({ nodeId, model }) {
  const { t } = useLanguage()
  const qc = useQueryClient()
  const links = useDistributionLinks(nodeId)
  const timerQuery = useTimerState(nodeId)
  const timer = timerQuery.data
  const received = timerQuery.dataUpdatedAt
  const liveUrl = links.data?.live?.slug ? buildPublicUrl('view', links.data.live.slug, { viewKey: 'live' }) : null
  if (model.sessions.length === 0) return <EmptyState title={t('distribution.live.needSessions')} body={t('distribution.live.needSessionsBody')} />
  return (
    <div className="space-y-4" data-testid="dist-live-tab">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('distribution.live.tabHint')}</p>
        {liveUrl ? <a href={liveUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonClass({ variant: 'outline', size: 'sm' }), 'ms-auto')}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('distribution.live.openLive')}</a> : <span className="ms-auto text-xs text-muted-foreground">{t('distribution.live.noLink')}</span>}
      </div>
      <Suspense fallback={<Loading />}>
        {timer ? (
          <>
            <TimerControls nodeId={nodeId} model={model} state={timer} onState={(s) => qc.setQueryData(keys.distTimer(nodeId), s)} />
            <LiveBoard model={model} timer={timer} offsetMs={timer.server_now ? Date.parse(timer.server_now) - received : 0} title={null} />
          </>
        ) : <Loading />}
      </Suspense>
    </div>
  )
}
