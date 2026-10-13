import { to12h } from '../../lib/time/slots.js'

/**
 * "3:39 AM - 3:49 AM" that survives a right-to-left page: every time is its own bidi isolate (an Arabic AM/PM marker between two numbers
 * otherwise reorders the whole range), the range follows the page direction (start first, as an Arabic reader expects). Values are minutes of day.
 */
export function TimeRange({ start, end, lang, className }) {
  return (
    <span className={className}>
      <bdi>{to12h(start, lang)}</bdi> - <bdi>{to12h(end, lang)}</bdi>
    </span>
  )
}
