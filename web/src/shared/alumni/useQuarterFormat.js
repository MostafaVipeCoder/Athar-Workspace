import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** `(unit, value) => string` for the quarterly views: money in EGP (whole pounds), counts as plain numbers, percents with one decimal at most (Western digits, OD-12). */
export function useQuarterFormat() {
  const { formatNumber, lang } = useLanguage()
  return (unit, v) => {
    if (v === null || v === undefined || v === '') return ''
    if (unit === 'money') return formatNumber(Number(v), { style: 'currency', currency: 'EGP', maximumFractionDigits: 0, currencyDisplay: lang === 'ar' ? 'name' : 'code' })
    if (unit === 'percent') return `${formatNumber(Number(v), { maximumFractionDigits: 1 })}%`
    return formatNumber(Number(v))
  }
}
