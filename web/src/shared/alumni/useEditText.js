import { useMemo } from 'react'
import { useAlumniLookups } from '../../data/alumni.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { formatFieldText } from '../../lib/alumniHistory.js'
import './i18n.edit.js'

/**
 * The words of the edit history in the viewer's language (`alumni.edit.*`): field / area / role / source labels, who edited ("the Athar team" for a founder, a name for a manager),
 * and the TEXT of a stored value (vocabulary keys become their labels, a number the money format, a masked value stays masked).
 */
export function useEditText() {
  const { t, lang, pick, formatDate, formatNumber } = useLanguage()
  const lookups = useAlumniLookups().data
  return useMemo(() => {
    const ctx = { lookups, lang, t, formatDate, formatNumber }
    const labelOr = (key, fallback) => {
      const text = t(key)
      return text === key ? fallback : text
    }
    return {
      ctx,
      lang,
      fieldLabel: (field) => labelOr(`alumni.edit.field.${field}`, String(field ?? '').replace(/_/g, ' ')),
      entityLabel: (entity) => labelOr(`alumni.edit.entity.${entity}`, String(entity ?? '')),
      sectionLabel: (section) => labelOr(`alumni.edit.section.${section}`, String(section ?? '')),
      roleLabel: (role) => labelOr(`alumni.edit.role.${role}`, String(role ?? '')),
      sourceLabel: (source) => labelOr(`alumni.edit.source.${source}`, String(source ?? '')),
      /** "the Athar team" / "a founder of the company" / with a name (managers only): "Mona Adel (Athar team)". */
      who: ({ source, name } = {}, audience = 'founder') => {
        if (audience === 'manager' && name && (source === 'manager' || source === 'founder')) return t(source === 'manager' ? 'alumni.edit.stamp.who.managerNamed' : 'alumni.edit.stamp.who.founderNamed', { name })
        return labelOr(`alumni.edit.stamp.who.${source}`, t('alumni.edit.stamp.who.system'))
      },
      /** The text of a value of `field` ('' when empty). */
      valueText: (field, value) => formatFieldText(field, value, ctx),
      date: (v) => (v ? formatDate(v, { dateStyle: 'medium' }) : ''),
      dateTime: (v) => (v ? formatDate(v, { dateStyle: 'medium', timeStyle: 'short' }) : ''),
      pickName: (o) => (o ? pick(o, 'name') : ''),
    }
  }, [lookups, lang, t, pick, formatDate, formatNumber])
}
