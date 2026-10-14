import { useAlumniLookups } from '../../data/alumni.js'
import { lookupOptions } from '../../lib/alumni.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** `[{ value, label }]` of one vocabulary for a ChipSelect (the lookups are ONE cached query shared by every field). `options` is empty while loading. */
export function useLookupOptions(kind, current = null, opts = {}) {
  const { lang } = useLanguage()
  const q = useAlumniLookups()
  return { options: lookupOptions(q.data, kind, lang, { current, ...opts }), isPending: q.isPending, lookups: q.data }
}
