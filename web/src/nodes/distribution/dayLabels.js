import { formatCalendarDate } from '../../lib/time/format.js'

/** "Day 2" or the day's own (agenda) name: the label of a day everywhere (pills, headers, Excel sheets). `t` is the translator. */
export function dayLabel(day, lang, t) {
  const name = day.name[lang] || day.name.en || day.name.ar
  if (name) return name
  return t('distribution.day', { n: day.index + 1 })
}
/** The date of a day formatted in `lang` ('' for a day without a date). */
export const dayDate = (day, lang, style = 'medium') => (day.date ? formatCalendarDate(day.date, { lang, style }) : '')
