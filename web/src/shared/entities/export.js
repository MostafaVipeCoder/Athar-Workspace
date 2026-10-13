import { biPick } from '../../lib/entities.js'

/**
 * Excel columns for list items (lib/export/xlsx `exportRows` descriptor). `t` = translate, `config` = normalised list
 * config (custom overlay fields become columns). Pure: no SheetJS here.
 */
export function listItemColumns(t, config = {}) {
  const cols = [
    { key: (r) => r.entity.title.en, header: `${t('entity.field.title')} (EN)` },
    { key: (r) => r.entity.title.ar, header: `${t('entity.field.title')} (AR)` },
    { key: (r) => r.entity.subtitle.en, header: `${t('entity.field.subtitle')} (EN)` },
    { key: (r) => r.entity.subtitle.ar, header: `${t('entity.field.subtitle')} (AR)` },
    { key: (r) => r.entity.organization.en, header: `${t('entity.field.organization')} (EN)` },
    { key: (r) => r.entity.organization.ar, header: `${t('entity.field.organization')} (AR)` },
    { key: (r) => r.entity.email ?? r.contact?.email ?? '', header: t('entity.field.email') },
    { key: (r) => r.contact?.phone ?? '', header: t('entity.field.phone') },
    { key: (r) => r.entity.links.map((l) => l.url).join(' '), header: t('entity.field.links') },
    { key: (r) => r.status ?? '', header: t('entity.manager.col.status') },
    { key: (r) => r.overlay?.notes ?? '', header: t('entity.manager.col.notes') },
  ]
  for (const f of config.overlayFields ?? []) {
    cols.push({ key: (r) => r.overlay?.[f.key] ?? '', header: biPick(f.label, 'en') || f.key })
  }
  cols.push(
    { key: (r) => t(`entity.source.${r.source.kind}`), header: t('entity.manager.col.source') },
    { key: (r) => (r.withdrawn ? t('entity.export.withdrawn') : r.excluded ? t('entity.source.hidden') : ''), header: t('entity.export.presence') },
  )
  return cols
}

/** Column aliases accepted by the Excel import (header text, lower-cased) -> manual_fields key. */
export const IMPORT_ALIASES = {
  title_en: ['name', 'name_en', 'name (en)', 'title_en', 'company name', 'full name', 'expert', 'الاسم بالإنجليزية'],
  title_ar: ['name_ar', 'name (ar)', 'title_ar', 'الاسم', 'اسم', 'الاسم بالعربية'],
  subtitle_en: ['title', 'job title', 'subtitle', 'subtitle_en', 'industry', 'industry_en', 'position'],
  subtitle_ar: ['subtitle_ar', 'title_ar (job)', 'industry_ar', 'المسمى الوظيفي', 'المجال', 'المسمى'],
  // "company" is the organisation of an expert; when a sheet has no name column at all it becomes the title (company lists)
  organization_en: ['organization', 'organisation', 'company', 'company_en', 'affiliation', 'organization_en'],
  organization_ar: ['organization_ar', 'company_ar', 'الجهة', 'الشركة'],
  bio_en: ['bio', 'bio_en', 'description', 'description_en', 'about'],
  bio_ar: ['bio_ar', 'description_ar', 'نبذة', 'الوصف'],
  email: ['email', 'e-mail', 'mail', 'البريد', 'البريد الإلكتروني'],
  linkedin_url: ['linkedin', 'linkedin_url', 'linkedin url', 'لينكدإن'],
  website_url: ['website', 'website_url', 'url', 'site', 'الموقع'],
}

/** Rows of a parsed sheet (objects keyed by header) -> manual_fields objects; rows without any name are skipped. */
export function rowsToManualFields(rows) {
  const out = []
  for (const row of rows ?? []) {
    const byHeader = new Map(Object.entries(row).map(([h, v]) => [String(h).trim().toLowerCase(), v]))
    const fields = {}
    for (const [key, aliases] of Object.entries(IMPORT_ALIASES)) {
      for (const a of aliases) {
        const v = byHeader.get(a)
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          fields[key] = String(v).trim()
          break
        }
      }
    }
    if (!fields.title_en && !fields.title_ar && (fields.organization_en || fields.organization_ar)) {
      fields.title_en = fields.organization_en
      fields.title_ar = fields.organization_ar
      delete fields.organization_en
      delete fields.organization_ar
      for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k]
    }
    if (fields.title_en || fields.title_ar) out.push(fields)
  }
  return out
}
