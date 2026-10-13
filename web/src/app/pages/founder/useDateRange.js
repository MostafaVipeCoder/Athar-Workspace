import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { formatCalendarDate } from '../../../lib/time/format.js'

/** "10 Mar 2030 - 12 Mar 2030" / one date when start = end / nothing without dates (they come only from agendas the PM exposed). */
export function useDateRange() {
  const { lang } = useLanguage()
  return (start, end) => {
    if (!start) return ''
    const a = formatCalendarDate(start, { lang, style: 'medium' })
    if (!end || end === start) return a
    return `${a} - ${formatCalendarDate(end, { lang, style: 'medium' })}`
  }
}
