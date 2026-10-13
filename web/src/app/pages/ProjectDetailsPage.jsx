import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useProjectContext } from '../guards/ProjectAccess.jsx'
import { useUpdateProject } from '../../data/programs.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { fromColumns, toColumns } from '../../lib/bilingual.js'
import { validateProjectDetails } from './forms.logic.js'
import { useToast } from '../../ui/Toast.jsx'
import { TRANSPORTATION, VISIBILITY } from '../../lib/constants.js'
import { staffPath } from '../../lib/links.js'
import TimezoneSelect from './programs/TimezoneSelect.jsx'

/**
 * Project Details panel (01 section 4, 08 sections 3/11): name, description, location ar/en, map link, offline days,
 * transportation, ONE explicit timezone, visibility and the founder-page toggles (nothing appears by default).
 */
export default function ProjectDetailsPage() {
  const { project, projectId } = useProjectContext()
  const { t, pick } = useLanguage()
  const toast = useToast()
  const update = useUpdateProject(projectId, project.program_id)
  const [v, setV] = useState(() => ({
    name: fromColumns(project, 'name'),
    description: fromColumns(project, 'description'),
    location: fromColumns(project, 'location'),
    map_url: project.map_url ?? '',
    offline_days: project.offline_days ?? '',
    transportation: project.transportation ?? '',
    timezone: project.timezone,
    visibility: project.visibility ?? 'private',
    show_description: Boolean(project.show_description),
    show_details: Boolean(project.show_details),
  }))
  const [errors, setErrors] = useState({})
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e) {
    e.preventDefault()
    const errs = validateProjectDetails(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await update.mutateAsync({
        ...toColumns(v.name, 'name'),
        ...toColumns(v.description, 'description'),
        ...toColumns(v.location, 'location'),
        map_url: v.map_url.trim() || null,
        offline_days: v.offline_days === '' ? null : Number(v.offline_days),
        transportation: v.transportation || null,
        timezone: v.timezone,
        visibility: v.visibility,
        show_description: v.show_description,
        show_details: v.show_details,
      })
      toast.success(t('projects.saved'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-testid="project-details">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link to={staffPath.program(project.program_id)} className="hover:underline">{t('programs.title')}</Link>
          {' / '}
          <Link to={staffPath.project(projectId)} className="hover:underline">{pick(project, 'name')}</Link>
        </p>
        <h1 className="text-section-title">{t('project.details')}</h1>
        <p className="text-sm text-muted-foreground">{t('projects.detailsHint')}</p>
      </div>

      <form onSubmit={submit} noValidate className="space-y-5">
        <section className="space-y-3 rounded-card border bg-card p-4">
          <h2 className="font-semibold">{t('projects.sectionGeneral')}</h2>
          <BilingualField label={t('projects.form.name')} required value={v.name} onChange={(x) => set('name', x)} error={errors.name && t(errors.name)} />
          <BilingualField label={t('projects.form.description')} as="textarea" value={v.description} onChange={(x) => set('description', x)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TimezoneSelect label={t('projects.form.timezone')} hint={t('projects.form.timezoneHint')} value={v.timezone} onChange={(x) => set('timezone', x)} />
            <Field as="select" label={t('programs.form.visibility')} value={v.visibility} onChange={(e) => set('visibility', e.target.value)} hint={t(`visibility.hint.${v.visibility}`)}>
              {VISIBILITY.map((x) => (
                <option key={x} value={x}>{t(`visibility.${x}`)}</option>
              ))}
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-card border bg-card p-4">
          <h2 className="font-semibold">{t('projects.sectionOffline')}</h2>
          <BilingualField label={t('projects.form.location')} value={v.location} onChange={(x) => set('location', x)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('projects.form.mapUrl')} type="url" inputMode="url" dir="ltr" placeholder="https://maps.app.goo.gl/..." value={v.map_url} onChange={(e) => set('map_url', e.target.value)} error={errors.map_url && t(errors.map_url)} />
            <Field label={t('projects.form.offlineDays')} type="number" inputMode="numeric" min="0" max="365" dir="ltr" value={v.offline_days} onChange={(e) => set('offline_days', e.target.value)} error={errors.offline_days && t(errors.offline_days)} hint={t('projects.form.offlineHint')} />
          </div>
          {v.map_url && !errors.map_url && (
            <a href={v.map_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t('projects.openMap')}
            </a>
          )}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('projects.form.transportation')}</legend>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="transportation" value="" checked={v.transportation === ''} onChange={() => set('transportation', '')} />
                {t('projects.transport.none')}
              </label>
              {TRANSPORTATION.map((x) => (
                <label key={x} className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="transportation" value={x} checked={v.transportation === x} onChange={() => set('transportation', x)} />
                  {t(`projects.transport.${x}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="space-y-2 rounded-card border bg-card p-4">
          <h2 className="font-semibold">{t('projects.sectionFounder')}</h2>
          <p className="text-xs text-muted-foreground">{t('projects.founderHint')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.show_description} onChange={(e) => set('show_description', e.target.checked)} />
            {t('projects.form.showDescription')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.show_details} onChange={(e) => set('show_details', e.target.checked)} />
            {t('projects.form.showDetails')}
          </label>
        </section>

        <div className="flex justify-end gap-2">
          <Link to={staffPath.project(projectId)} className="tap-target inline-flex items-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">{t('common.cancel')}</Link>
          <Button type="submit" loading={update.isPending}>{t('common.save')}</Button>
        </div>
      </form>
    </div>
  )
}
