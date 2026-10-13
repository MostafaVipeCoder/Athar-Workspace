import { useMemo } from 'react'
import { Field } from '../../../ui/Field.jsx'
import { listTimeZones, describeTimeZone, DEFAULT_TIMEZONE } from '../../../lib/time/tz.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'

const FAVOURITES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Amman', 'Europe/London', 'UTC']

/** One explicit IANA zone per project (08 decision 07-10 / 05-a). Favourites first, then every zone the runtime knows. */
export default function TimezoneSelect({ value, onChange, label, hint, error }) {
  const { lang } = useLanguage()
  const zones = useMemo(() => {
    const all = listTimeZones()
    const set = new Set(FAVOURITES.filter((z) => all.includes(z)))
    return [...set, ...all.filter((z) => !set.has(z))]
  }, [])
  return (
    <Field as="select" label={label} hint={hint} error={error} value={value || DEFAULT_TIMEZONE} onChange={(e) => onChange(e.target.value)} dir="ltr">
      {zones.map((z) => (
        <option key={z} value={z}>
          {describeTimeZone(z, lang)}
        </option>
      ))}
    </Field>
  )
}
