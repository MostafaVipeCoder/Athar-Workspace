import { entityFieldLabelKey } from './i18n.js'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { Field } from '../../ui/Field.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'

/**
 * Bilingual form for an EntityView (expert / company / generic): title, subtitle, organization (not for companies),
 * bio, image, LinkedIn, website and (experts/manual) e-mail. Controlled: `value` + `onChange(next)`. `onUpload(file)`
 * must resolve to the stored path (the page decides the owner folder). Labels follow the kind (job title vs industry).
 */
export function EntityForm({ value, onChange, kind = 'generic', onUpload, errors = {}, showEmail = true, disabled = false }) {
  const { t } = useLanguage()
  const v = value
  const set = (partial) => onChange({ ...v, ...partial })
  const label = (field) => t(entityFieldLabelKey(field, kind))
  const linkOf = (k) => v.links?.find((l) => l.kind === k)?.url ?? ''
  const setLink = (k, url) => {
    const rest = (v.links ?? []).filter((l) => l.kind !== k)
    set({ links: url.trim() ? [...rest, { kind: k, url: url.trim() }] : rest })
  }

  return (
    <div className="space-y-4" data-testid="entity-form">
      <BilingualField label={label('title')} required value={v.title} onChange={(title) => set({ title })} error={errors.title ? t(errors.title) : undefined} />
      <BilingualField label={label('subtitle')} value={v.subtitle} onChange={(subtitle) => set({ subtitle })} />
      {kind !== 'company' && <BilingualField label={label('organization')} value={v.organization} onChange={(organization) => set({ organization })} />}
      <BilingualField label={label('bio')} as="textarea" rows={4} value={v.bio} onChange={(bio) => set({ bio })} inputClassName="min-h-24 py-2" />
      {onUpload && (
        <ImageField
          label={label('image')}
          src={v.imagePath ? publicImageUrl(v.imagePath) : null}
          thumb={v.imagePath ? publicThumbUrl(v.imagePath) : null}
          aspect={kind === 'company' ? '16 / 9' : '4 / 3'}
          disabled={disabled}
          onFile={async (file) => {
            const path = await onUpload(file)
            set({ imagePath: path })
            return path
          }}
          onClear={() => set({ imagePath: null })}
          labels={{ choose: t('image.choose'), replace: t('image.replace'), remove: t('image.remove'), hint: t('image.hint') }}
          errorText={(problem) => t(`errors.image.${problem}`)}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('entity.field.linkedin')} type="url" dir="ltr" value={linkOf('linkedin')} onChange={(e) => setLink('linkedin', e.target.value)} error={errors.links ? t(errors.links) : undefined} placeholder="https://linkedin.com/in/..." />
        <Field label={t('entity.field.website')} type="url" dir="ltr" value={linkOf('website')} onChange={(e) => setLink('website', e.target.value)} placeholder="https://" />
      </div>
      {showEmail && kind !== 'company' && (
        <Field label={t('entity.field.email')} type="email" dir="ltr" value={v.email ?? ''} onChange={(e) => set({ email: e.target.value })} error={errors.email ? t(errors.email) : undefined} />
      )}
    </div>
  )
}
export default EntityForm
