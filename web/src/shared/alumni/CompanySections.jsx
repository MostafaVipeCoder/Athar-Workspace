import { Building2, Compass, EyeOff, Globe2, Layers, MapPin, Power, Plus, Trash2 } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field, SELECT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { uploadCompanyLogo } from '../../data/alumniFounder.js'
import { LINK_KINDS } from '../../lib/alumni.js'
import { cairoToday } from '../../lib/nationalId.js'
import { ProfileSection } from './blocks.jsx'
import { ChipSelect, GovernoratePicker, LookupSelect, SectorPicker } from './pickers.jsx'
import { useLookupOptions } from './useLookupOptions.js'
import { cn } from '../../lib/cn.js'
import './i18n.js'
import './i18n.company.js'

/**
 * The company form of design 09 F5 / M3 as independent sections. Every section takes `{ values, set, setMany, errors, disabled }`:
 * `values` = lib/alumniForms `companyToForm`, `errors` = `{ field: 'translated message' }` (instant checks and the server's refusal), `set(key, value)`.
 * Derived values (programs, team counts) are NOT here: they are read-only blocks next to the form. Labels of the vocabularies come from the database.
 */

/** Name (ar / en), logo, description, established date. `userId` = the account the logo is filed under (public-assets/alumni/<userId>/logo/...). */
export function CompanyBasicsSection({ id = 'basics', values, set, setMany, errors = {}, disabled, userId, track }) {
  const { t } = useLanguage()
  return (
    <ProfileSection id={id} icon={Building2} title={t('alumni.common.basicsTitle')} description={t('alumni.common.basicsDesc')}>
      <div className="max-w-xs">
        <ImageField
          label={t('alumni.common.logo')}
          aspect="1 / 1"
          profile="avatar"
          disabled={disabled || !userId}
          src={values.logo_path ? publicImageUrl(values.logo_path) : undefined}
          thumb={values.logo_path ? publicThumbUrl(values.logo_path) : undefined}
          onFile={async (file) => {
            const path = await uploadCompanyLogo(file, userId) // WebP only (data/storage.js); a refused image is shown by the field itself
            track?.(path)
            set('logo_path', path)
          }}
          onClear={() => set('logo_path', '')}
          labels={{ hint: t('alumni.common.logoHint') }}
        />
        {errors.logo_path && <p className="mt-1 text-xs text-destructive-text">{errors.logo_path}</p>}
      </div>
      <BilingualField
        label={t('alumni.common.companyName')}
        required
        value={{ en: values.name_en, ar: values.name_ar }}
        onChange={(v) => setMany({ name_en: v.en, name_ar: v.ar })}
        error={errors.name_ar ?? errors.name_en}
      />
      <BilingualField
        label={t('alumni.common.description')}
        as="textarea"
        rows={4}
        value={{ en: values.description_en, ar: values.description_ar }}
        onChange={(v) => setMany({ description_en: v.en, description_ar: v.ar })}
        error={errors.description_en ?? errors.description_ar}
      />
      <Field
        type="date"
        dir="ltr"
        label={t('alumni.common.establishedOn')}
        max={cairoToday()}
        value={values.established_on}
        disabled={disabled}
        error={errors.established_on}
        onChange={(e) => set('established_on', e.target.value)}
      />
    </ProfileSection>
  )
}

/** Startup type, sector + sub sector, stage, legal status. */
export function CompanyClassificationSection({ id = 'classification', values, set, setMany, errors = {}, disabled }) {
  const { t } = useLanguage()
  const types = useLookupOptions('startup_type', values.startup_type || null)
  const legal = useLookupOptions('legal_status', values.legal_status || null)
  return (
    <ProfileSection id={id} icon={Layers} title={t('alumni.common.classificationTitle')} description={t('alumni.common.classificationDesc')}>
      <ChipSelect label={t('alumni.common.startupType')} options={types.options} value={values.startup_type} allowClear disabled={disabled || types.isPending} onChange={(v) => set('startup_type', v)} error={errors.startup_type} />
      <SectorPicker sector={values.sector} subsector={values.subsector} errors={errors} disabled={disabled} onChange={(v) => setMany({ sector: v.sector, subsector: v.subsector })} />
      <LookupSelect kind="stage" label={t('alumni.common.stage')} value={values.stage} disabled={disabled} error={errors.stage} onChange={(v) => set('stage', v)} />
      <ChipSelect label={t('alumni.common.legalStatus')} options={legal.options} value={values.legal_status} allowClear disabled={disabled || legal.isPending} onChange={(v) => set('legal_status', v)} error={errors.legal_status} />
    </ProfileSection>
  )
}

/** The company's operating location (a governorate of the list; never "born abroad") + the free-text address. */
export function CompanyLocationSection({ id = 'location', values, set, setMany, errors = {}, disabled }) {
  const { t } = useLanguage()
  return (
    <ProfileSection id={id} icon={MapPin} title={t('alumni.common.locationTitle')} description={t('alumni.common.locationDesc')}>
      <GovernoratePicker label={t('alumni.common.governorate')} value={values.governorate} disabled={disabled} error={errors.governorate} onChange={(v) => set('governorate', v)} />
      <BilingualField
        label={t('alumni.common.address')}
        value={{ en: values.location_en, ar: values.location_ar }}
        onChange={(v) => setMany({ location_en: v.en, location_ar: v.ar })}
        error={errors.location_en ?? errors.location_ar}
      />
    </ProfileSection>
  )
}

/** Website, app, LinkedIn and the social links (canonical `{ kind, url, label? }` entries, at most 12). */
export function CompanyOnlineSection({ id = 'online', values, set, errors = {}, disabled }) {
  const { t } = useLanguage()
  const links = values.links ?? []
  const setLink = (i, patch) => set('links', links.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <ProfileSection id={id} icon={Globe2} title={t('alumni.common.onlineTitle')} description={t('alumni.common.onlineDesc')}>
      <div className="grid gap-field-gap sm:grid-cols-2">
        <Field type="url" dir="ltr" inputMode="url" label={t('alumni.common.website')} placeholder="https://" value={values.website_url} disabled={disabled} error={errors.website_url} onChange={(e) => set('website_url', e.target.value)} />
        <Field type="url" dir="ltr" inputMode="url" label={t('alumni.common.app')} placeholder="https://" value={values.app_url} disabled={disabled} error={errors.app_url} onChange={(e) => set('app_url', e.target.value)} />
      </div>
      <Field type="url" dir="ltr" inputMode="url" label={t('alumni.common.linkedin')} placeholder="https://www.linkedin.com/company/..." value={values.linkedin_url} disabled={disabled} error={errors.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} />
      <div className="space-y-2">
        <span className={LABEL_CLASS}>{t('alumni.common.social')}</span>
        <ul className="space-y-2">
          {links.map((l, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr_auto] items-start gap-2" data-testid="social-link">
              <select aria-label={t('alumni.common.linkKind')} value={l.kind} disabled={disabled} onChange={(e) => setLink(i, { kind: e.target.value })} className={cn(SELECT_CLASS, 'w-32 sm:w-40')}>
                {LINK_KINDS.map((k) => <option key={k} value={k}>{t(`alumni.common.link.${k}`)}</option>)}
              </select>
              <div className="min-w-0">
                <input type="url" dir="ltr" inputMode="url" aria-label={t('alumni.common.linkUrl')} placeholder="https://" value={l.url} disabled={disabled} aria-invalid={errors[`links.${i}`] ? true : undefined} onChange={(e) => setLink(i, { url: e.target.value })} className={cn(INPUT_CLASS, errors[`links.${i}`] && 'border-destructive')} />
                {errors[`links.${i}`] && <p className="mt-1 text-xs text-destructive-text">{errors[`links.${i}`]}</p>}
              </div>
              <Button variant="ghost" size="icon" disabled={disabled} aria-label={t('alumni.common.removeLink')} onClick={() => set('links', links.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        {links.length < 12 && (
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => set('links', [...links, { kind: 'facebook', url: '' }])}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('alumni.common.addLink')}
          </Button>
        )}
        {errors.links && <p className="text-xs text-destructive-text">{errors.links}</p>}
      </div>
    </ProfileSection>
  )
}

/** Open / closed; when closed: the date, the reason, what the founders did after, a note. Re-opening clears the four closing fields (the server refuses them on an open company). */
export function CompanyStatusSection({ id = 'status', values, set, setMany, errors = {}, disabled }) {
  const { t } = useLanguage()
  const status = useLookupOptions('operating_status', null)
  const closed = values.operating_status === 'closed'
  return (
    <ProfileSection id={id} icon={Power} title={t('alumni.common.statusTitle')} description={t('alumni.common.statusDesc')}>
      <ChipSelect
        label={t('alumni.common.operatingStatus')}
        options={status.options}
        value={values.operating_status}
        disabled={disabled || status.isPending}
        onChange={(v) => (v === 'open' ? setMany({ operating_status: 'open', closed_on: '', closing_reason: '', after_closing: '', closing_note: '' }) : set('operating_status', v))}
      />
      {closed && (
        <div className="space-y-field-gap rounded-card border border-dashed border-input p-4" data-testid="closing-fields">
          <Field type="date" dir="ltr" label={t('alumni.common.closedOn')} max={cairoToday()} value={values.closed_on} disabled={disabled} error={errors.closed_on} onChange={(e) => set('closed_on', e.target.value)} />
          <div className="grid gap-field-gap sm:grid-cols-2">
            <LookupSelect kind="closing_reason" label={t('alumni.common.closingReason')} value={values.closing_reason} disabled={disabled} error={errors.closing_reason} onChange={(v) => set('closing_reason', v)} />
            <LookupSelect kind="after_closing" label={t('alumni.common.afterClosing')} value={values.after_closing} disabled={disabled} error={errors.after_closing} onChange={(v) => set('after_closing', v)} />
          </div>
          <Field as="textarea" label={t('alumni.common.closingNote')} rows={3} value={values.closing_note} disabled={disabled} error={errors.closing_note} onChange={(e) => set('closing_note', e.target.value)} />
        </div>
      )}
    </ProfileSection>
  )
}

/** Who may find the company in the alumni directory. `blocked` = a manager hid it (founders only see that fact, never the note). */
export function DirectoryVisibilitySection({ id = 'directory', values, set, errors = {}, disabled, blocked = false, isAlumni = false }) {
  const { t } = useLanguage()
  const vis = useLookupOptions('directory_visibility', null)
  return (
    <ProfileSection id={id} icon={Compass} title={t('alumni.common.directoryTitle')} description={t('alumni.common.directoryDesc')}>
      <ChipSelect label={t('alumni.common.visibility')} options={vis.options} value={values.directory_visibility} disabled={disabled || vis.isPending} onChange={(v) => set('directory_visibility', v)} error={errors.directory_visibility} />
      <p className="text-sm text-muted-foreground" data-testid="visibility-explain">{t(`alumni.common.visibility.${values.directory_visibility || 'private'}`)}</p>
      {!isAlumni && <p className="text-xs text-muted-foreground">{t('alumni.common.notAlumniYet')}</p>}
      {blocked && (
        <p role="status" className="flex items-start gap-2 rounded-input bg-accent/20 p-3 text-sm" data-testid="directory-blocked">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('alumni.common.directoryBlocked')}
        </p>
      )}
    </ProfileSection>
  )
}
