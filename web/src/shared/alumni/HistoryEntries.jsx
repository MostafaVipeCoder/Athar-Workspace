import { ArrowRight, CircleHelp, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { describeEntry, groupByDay, groupSaves } from '../../lib/alumniHistory.js'
import { cn } from '../../lib/cn.js'
import { useEditText } from './useEditText.js'
import './i18n.edit.js'

const SENTENCE = new Set(['created', 'removed', 'member_added', 'member_removed', 'id_set', 'id_changed', 'id_cleared'])

/** One entry of the log as a line: "<field> <old> -> <new>" (or a sentence for a creation, a membership, a national-ID event). */
function EntryLine({ row, audience, showCompany, showPerson, onField }) {
  const { t, tn } = useLanguage()
  const e = useEditText()
  const did = describeEntry(row)
  const before = e.valueText(row.field, row.old_value)
  const after = e.valueText(row.field, row.new_value)
  const year = row.entity_type === 'snapshot' && row.period_key ? row.period_key : null
  const label = year ? t('alumni.edit.figures.yearOf', { field: e.fieldLabel(row.field), year }) : e.fieldLabel(row.field)
  const person = showPerson && row.founder ? e.pickName(row.founder) : ''
  const company = showCompany && row.company ? e.pickName(row.company) : ''
  const isLong = (before || after).length > 80 || (after || before).length > 80
  const Name = onField ? 'button' : 'span'
  return (
    <li className="space-y-1 py-1.5" data-testid="history-entry" data-field={row.field} data-did={did}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {company && <Link to={`/alumni/admin/company/${row.company_id}`} className="font-semibold text-primary hover:underline">{company}</Link>}
        {person && <Badge tone="outline">{person}</Badge>}
        <Badge tone="neutral">{e.entityLabel(row.entity_type)}</Badge>
        <Name
          {...(onField ? { type: 'button', onClick: () => onField(row.field, row), title: t('alumni.edit.fieldTimeline') } : {})}
          className={cn('font-semibold', onField && 'rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        >
          {label}
        </Name>
        {SENTENCE.has(did) && <span className="text-muted-foreground">{t(`alumni.edit.did.${did}`)}</span>}
        {did === 'nochange' && <span className="text-muted-foreground">{t('alumni.edit.did.nochange')}</span>}
        {row.edits > 1 && <Badge tone="outline" title={t('alumni.edit.savesCoalescedHint')}>{tn('alumni.edit.savesCoalesced', row.edits)}</Badge>}
        {row.redacted && !SENTENCE.has(did) && (
          <span className="inline-flex items-center text-muted-foreground" title={t('alumni.edit.partial')}>
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t('alumni.edit.partial')}</span>
          </span>
        )}
      </div>
      {!SENTENCE.has(did) && did !== 'nochange' && (
        <div className={cn('flex gap-2 text-sm', isLong ? 'flex-col' : 'flex-wrap items-center')}>
          <span className={cn('min-w-0 break-words text-muted-foreground', before && 'line-through decoration-muted-foreground/60')} dir="auto" data-testid="history-before">
            <span className="sr-only">{t('alumni.edit.from')}: </span>{before || t('alumni.edit.empty')}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
          <span className="min-w-0 whitespace-pre-line break-words font-medium" dir="auto" data-testid="history-after">
            <span className="sr-only">{t('alumni.edit.to')}: </span>{after || t('alumni.edit.empty')}
          </span>
        </div>
      )}
      {audience === 'manager' && row.reason && <p className="text-xs italic text-muted-foreground">{t('alumni.edit.reasonLine', { reason: row.reason })}</p>}
    </li>
  )
}

/**
 * The change log as a readable timeline: the days, under each day the SAVES (entries of one request by one editor), under each save its field changes. `rows` come from
 * `list_alumni_history` in list order. `audience` 'manager' shows names, the company and the person of an entry; 'founder' only the kind of editor (the server sends nothing more).
 * `onField(field, row)` makes the field label a button (the per-field timeline of the history page).
 */
export default function HistoryEntries({ rows, audience = 'manager', showCompany = false, showPerson = true, onField }) {
  const { t, tn } = useLanguage()
  const e = useEditText()
  const days = groupByDay(groupSaves(rows))
  return (
    <div className="space-y-6" data-testid="history-entries">
      {days.map((d) => (
        <section key={d.day} aria-label={d.day} className="space-y-3">
          <h3 className="text-sm font-bold text-athar-ink">{e.date(`${d.day}T12:00:00Z`)}</h3>
          <ul className="space-y-3">
            {d.groups.map((g) => {
              const named = audience === 'manager' && g.actor?.name
              const whoText = named ? g.actor.name : e.who({ source: g.source }, audience)
              const kindText = audience === 'manager' ? e.roleLabel(g.actor?.role) : e.sourceLabel(g.source)
              return (
                <li key={g.key} className="rounded-card border bg-card p-3 sm:p-4" data-testid="history-save">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                    <Pencil className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="font-semibold">{whoText}</span>
                    {kindText !== whoText && <Badge tone={g.source === 'manager' ? 'blue' : g.source === 'founder' ? 'green' : 'neutral'}>{kindText}</Badge>}
                    <time className="text-xs text-muted-foreground" dateTime={g.at}>{e.dateTime(g.at)}</time>
                    {g.rows.length > 1 && <span className="text-xs text-muted-foreground">{tn('alumni.edit.changesInSave', g.rows.length)}</span>}
                  </div>
                  <ul className="divide-y">
                    {g.rows.map((r) => <EntryLine key={r.id} row={r} audience={audience} showCompany={showCompany} showPerson={showPerson} onField={onField} />)}
                  </ul>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {days.length === 0 && <p className="text-sm text-muted-foreground">{t('alumni.edit.figures.empty')}</p>}
    </div>
  )
}
