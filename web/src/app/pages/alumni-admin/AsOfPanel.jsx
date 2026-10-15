import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock } from 'lucide-react'
import { getAlumniStateAsOf, getAlumniStateDiff } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { diffRows, groupState, isEmptyValue, isoToLocalInput, localInputToIso } from '../../../lib/alumniHistory.js'
import { cn } from '../../../lib/cn.js'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { Segmented } from './ui.jsx'
import './i18n.common.js'
import './history.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

const ago = (days) => isoToLocalInput(new Date(Date.now() - days * 86_400_000).toISOString())

function Rows({ rows }) {
  const e = useEditText()
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.field} className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{e.fieldLabel(r.field)}</dt>
          <dd className="break-words text-sm" dir="auto">{e.valueText(r.field, r.value) || '-'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The company as it was: the fields that had a value, grouped. `data` = `alumni_state_as_of`. */
function StateView({ data }) {
  const { t, lang } = useLanguage()
  const e = useEditText()
  const h = (k, v) => t(`alumni.admin.hist.${k}`, v)
  const g = useMemo(() => groupState(data.fields), [data.fields])
  const nameOf = (p) => p.rows.find((r) => r.field === `name_${lang}`)?.value ?? p.rows.find((r) => r.field === 'name_en')?.value ?? p.rows.find((r) => r.field === 'name_ar')?.value ?? ''
  return (
    <div className="space-y-5" data-testid="asof-state">
      {data.before_log && <p role="status" className="rounded-input bg-accent/20 p-3 text-sm">{h('beforeLog', { date: e.dateTime(data.log_started_at) })}</p>}
      {!data.existed ? <p role="status" className="rounded-input bg-surface p-3 text-sm">{h('notExisted')}</p>
        : g.company.length + g.internal.length + g.years.length + g.team.length === 0 ? <p className="text-sm text-muted-foreground">{h('noValue')}</p>
        : (
          <>
            {g.company.length > 0 && <section className="space-y-2"><h4 className="text-sm font-bold">{h('stateCompany')}</h4><Rows rows={g.company} /></section>}
            {g.internal.length > 0 && <section className="space-y-2"><h4 className="text-sm font-bold">{h('stateNotes')}</h4><Rows rows={g.internal} /></section>}
            {g.team.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-bold">{h('stateTeam')}</h4>
                <ul className="space-y-3">
                  {g.team.map((p) => (
                    <li key={p.founderId} className="space-y-2 rounded-card border p-3" data-testid="asof-member">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{nameOf(p) || '-'}{p.role && <span className="text-xs font-normal text-muted-foreground">{p.role}</span>}{p.is_primary && <Badge tone="blue">{h('ceoBadge')}</Badge>}</p>
                      <Rows rows={p.rows.filter((r) => !['name_en', 'name_ar'].includes(r.field) && !isEmptyValue(r.value) && r.value !== false)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {g.years.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-bold">{h('stateYears')}</h4>
                {g.years.map((y) => <div key={y.year} className="space-y-1 rounded-card border p-3"><p className="text-sm font-semibold">{h('yearLabel', { year: y.year })}</p><Rows rows={y.rows} /></div>)}
              </section>
            )}
          </>
        )}
    </div>
  )
}

/** What differs between two dates: one line per field with the value then and the value now. `data` = `alumni_state_diff`. */
function DiffView({ data }) {
  const { t, tn } = useLanguage()
  const e = useEditText()
  const h = (k, v) => t(`alumni.admin.hist.${k}`, v)
  const rows = useMemo(() => diffRows(data.changes), [data.changes])
  return (
    <div className="space-y-3" data-testid="asof-diff">
      {data.before_log && <p role="status" className="rounded-input bg-accent/20 p-3 text-sm">{h('beforeLog', { date: e.dateTime(data.log_started_at) })}</p>}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{h('noChanges')}</p> : (
        <>
          <p className="text-sm font-semibold" aria-live="polite">{tn('alumni.admin.hist.changes', rows.length)}</p>
          <ul className="divide-y rounded-card border bg-card">
            {rows.map((r) => (
              <li key={r.key} className="space-y-1 p-3" data-testid="asof-diff-row" data-kind={r.kind}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={r.kind === 'added' ? 'green' : r.kind === 'removed' ? 'red' : 'amber'}>{h(r.kind)}</Badge>
                  <span className="font-semibold">{e.fieldLabel(r.field)}</span>
                  {r.year && <span className="text-xs text-muted-foreground">{h('yearLabel', { year: r.year })}</span>}
                  {r.scope === 'founder' || r.scope === 'team' ? <Badge tone="outline">{e.entityLabel(r.scope)}</Badge> : null}
                </div>
                <div className={cn('flex flex-wrap items-center gap-2 text-sm')}>
                  <span className="min-w-0 break-words text-muted-foreground line-through decoration-muted-foreground/60" dir="auto"><span className="sr-only">{t('alumni.edit.from')}: </span>{e.valueText(r.field, r.from) || t('alumni.edit.empty')}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                  <span className="min-w-0 break-words font-medium" dir="auto"><span className="sr-only">{t('alumni.edit.to')}: </span>{e.valueText(r.field, r.to) || t('alumni.edit.empty')}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * "The company at a date" (owner decision 20.4): choose a moment to see the company as it was, or two moments to see what changed between them. The state is rebuilt on the server from
 * the history of edits (no periodic copies exist): the answer says when the history starts, and a date before the company existed says so.
 */
export default function AsOfPanel({ companyId }) {
  const { t } = useLanguage()
  const h = (k, v) => t(`alumni.admin.hist.${k}`, v)
  const [mode, setMode] = useState('state')
  const [a, setA] = useState(() => ago(30))
  const [b, setB] = useState('')
  const isoA = localInputToIso(a)
  const isoB = localInputToIso(b)
  const stateQ = useQuery({ queryKey: ['alumni', 'asOf', companyId, isoA], queryFn: () => getAlumniStateAsOf(companyId, isoA), enabled: mode === 'state' && Boolean(companyId && isoA), staleTime: 30_000 })
  const diffQ = useQuery({ queryKey: ['alumni', 'diff', companyId, isoA, isoB], queryFn: () => getAlumniStateDiff(companyId, isoA, isoB), enabled: mode === 'compare' && Boolean(companyId && isoA), staleTime: 30_000 })
  const q = mode === 'state' ? stateQ : diffQ
  const presets = [['presetYear', () => isoToLocalInput(new Date(new Date().getFullYear(), 0, 1).toISOString())], ['presetMonth', () => ago(30)], ['presetWeek', () => ago(7)], ['presetYesterday', () => ago(1)]]
  return (
    <div className="space-y-4" data-testid="asof-panel">
      <p className="text-sm text-muted-foreground">{h('asOfIntro')}</p>
      <Segmented label={h('asOfTitle')} value={mode} onChange={setMode} options={[{ value: 'state', label: h('modeState') }, { value: 'compare', label: h('modeCompare') }]} />
      <div className="flex flex-wrap items-end gap-3">
        <Field type="datetime-local" label={mode === 'state' ? h('dateTime') : h('dateA')} value={a} onChange={(ev) => setA(ev.target.value)} max={isoToLocalInput(new Date().toISOString())} className="w-auto" />
        {mode === 'compare' && <Field type="datetime-local" label={h('dateB')} value={b} onChange={(ev) => setB(ev.target.value)} max={isoToLocalInput(new Date().toISOString())} className="w-auto" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={h('presets')}>
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {presets.map(([key, make]) => <Button key={key} variant="outline" size="sm" onClick={() => setA(make())}>{h(key)}</Button>)}
        {mode === 'compare' && <Button variant="outline" size="sm" onClick={() => setB('')}>{h('presetNow')}</Button>}
      </div>
      {!isoA ? null : q.isPending ? <SkeletonList count={3} itemClassName="h-10 w-full" />
        : q.isError ? <ErrorState error={q.error} title={h('stateFailed')} onRetry={() => q.refetch()} />
        : mode === 'state' ? <StateView data={q.data} /> : <DiffView data={q.data} />}
    </div>
  )
}
