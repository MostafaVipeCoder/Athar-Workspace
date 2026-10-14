import { useId } from 'react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { SELECT_CLASS, LABEL_CLASS } from '../../../ui/Field.jsx'
import { subsectorOptions } from '../../../lib/alumni.js'
import { activeFilterCount } from './adminState.js'
import './i18n.common.js'
import './directory.i18n.js'

function FilterSelect({ label, hint, value, onChange, children }) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      <select id={id} className={SELECT_CLASS} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const BOOLS = ['true', 'false']

/**
 * The filter panel of the directory (and of the pages that share the filter). `filters` are the RPC filters (adminState.toRpcFilters); `onChange(patch)` merges a patch
 * (an empty string clears a key). Two governorate filters, labelled apart on purpose: the COMPANY location (typed on the company) and the governorate FROM THE CEO'S
 * NATIONAL ID. Nothing here takes or shows a national ID.
 */
export default function DirectoryFilters({ filters, onChange, programs = [], labels, onClear, only = null }) {
  const { t, tn, lang, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const show = (k) => (only ? only.includes(k) : true)
  const opts = (kind, extra) => labels.options(kind, extra).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
  const program = programs.find((p) => p.id === filters.program_id)
  const projects = (program ? program.projects : programs.flatMap((p) => p.projects.map((j) => ({ ...j, program: p })))).map((j) => ({ ...j, label: program ? pick(j, 'name') : `${pick(j.program, 'name')} — ${pick(j, 'name')}` }))
  const subs = subsectorOptions(labels.lookups, filters.sector, lang)
  const bool = (k, labelYes, labelNo) => (
    <FilterSelect label={d(`f.${k}`)} value={filters[k] === undefined ? '' : String(filters[k])} onChange={(v) => onChange({ [k]: v })}>
      <option value="">{d('any')}</option>
      {BOOLS.map((b) => <option key={b} value={b}>{b === 'true' ? labelYes : labelNo}</option>)}
    </FilterSelect>
  )
  const count = activeFilterCount(filters)

  return (
    <section aria-label={d('filters')} className="space-y-3 rounded-card border bg-card p-4" data-testid="directory-filters">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {show('program_id') && (
          <FilterSelect label={d('f.program_id')} value={filters.program_id} onChange={(v) => onChange({ program_id: v, project_id: '' })}>
            <option value="">{d('any')}</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{pick(p, 'name')}</option>)}
          </FilterSelect>
        )}
        {show('project_id') && (
          <FilterSelect label={d('f.project_id')} value={filters.project_id} onChange={(v) => onChange({ project_id: v })}>
            <option value="">{d('any')}</option>
            {projects.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </FilterSelect>
        )}
        {show('sector') && (
          <FilterSelect label={d('f.sector')} value={filters.sector} onChange={(v) => onChange({ sector: v, subsector: '' })}>
            <option value="">{d('any')}</option>
            {opts('sector')}
          </FilterSelect>
        )}
        {show('subsector') && (
          <FilterSelect label={d('f.subsector')} value={filters.subsector} onChange={(v) => onChange({ subsector: v })}>
            <option value="">{d('any')}</option>
            {subs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FilterSelect>
        )}
        {show('stage') && (
          <FilterSelect label={d('f.stage')} value={filters.stage} onChange={(v) => onChange({ stage: v })}>
            <option value="">{d('any')}</option>
            {opts('stage')}
          </FilterSelect>
        )}
        {show('startup_type') && (
          <FilterSelect label={d('f.startup_type')} value={filters.startup_type} onChange={(v) => onChange({ startup_type: v })}>
            <option value="">{d('any')}</option>
            {opts('startup_type')}
          </FilterSelect>
        )}
        {show('legal_status') && (
          <FilterSelect label={d('f.legal_status')} value={filters.legal_status} onChange={(v) => onChange({ legal_status: v })}>
            <option value="">{d('any')}</option>
            {opts('legal_status')}
          </FilterSelect>
        )}
        {show('governorate') && (
          <FilterSelect label={d('f.governorate')} hint={d('f.governorate.hint')} value={filters.governorate} onChange={(v) => onChange({ governorate: v })}>
            <option value="">{d('any')}</option>
            {opts('governorate')}
          </FilterSelect>
        )}
        {show('ceo_governorate') && (
          <FilterSelect label={d('f.ceo_governorate')} hint={d('f.ceo_governorate.hint')} value={filters.ceo_governorate} onChange={(v) => onChange({ ceo_governorate: v })}>
            <option value="">{d('any')}</option>
            {opts('governorate', { includeAbroad: true })}
          </FilterSelect>
        )}
        {show('ceo_gender') && (
          <FilterSelect label={d('f.ceo_gender')} value={filters.ceo_gender} onChange={(v) => onChange({ ceo_gender: v })}>
            <option value="">{d('any')}</option>
            {opts('gender')}
          </FilterSelect>
        )}
        {show('age_category') && (
          <FilterSelect label={d('f.age_category')} value={filters.age_category} onChange={(v) => onChange({ age_category: v })}>
            <option value="">{d('any')}</option>
            {opts('age_category')}
          </FilterSelect>
        )}
        {show('education_status') && (
          <FilterSelect label={d('f.education_status')} value={filters.education_status} onChange={(v) => onChange({ education_status: v })}>
            <option value="">{d('any')}</option>
            {opts('education_status')}
          </FilterSelect>
        )}
        {show('operating_status') && (
          <FilterSelect label={d('f.operating_status')} value={filters.operating_status} onChange={(v) => onChange({ operating_status: v })}>
            <option value="">{d('any')}</option>
            {opts('operating_status')}
          </FilterSelect>
        )}
        {show('has_female_founder') && bool('has_female_founder', d('yes'), d('no'))}
        {show('reviewed') && bool('reviewed', d('reviewed.true'), d('reviewed.false'))}
        {show('directory_visibility') && (
          <FilterSelect label={d('f.directory_visibility')} value={filters.directory_visibility} onChange={(v) => onChange({ directory_visibility: v })}>
            <option value="">{d('any')}</option>
            {opts('directory_visibility')}
          </FilterSelect>
        )}
        {show('directory_hidden') && bool('directory_hidden', d('yes'), d('no'))}
        {show('incomplete') && bool('incomplete', d('incomplete.true'), d('incomplete.false'))}
      </div>
      {onClear && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">{count > 0 ? tn('alumni.admin.dir.filtersActive', count) : ''}</p>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={count === 0}>{d('clearFilters')}</Button>
        </div>
      )}
    </section>
  )
}
