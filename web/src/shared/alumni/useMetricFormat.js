import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** `(unit, value) => string`: money in EGP (whole pounds, code in English / name in Arabic), counts as plain numbers (Western digits, owner decision OD-12). */
export function useMetricFormat() {
  const { formatNumber, lang } = useLanguage()
  return (unit, v) => (unit === 'money'
    ? formatNumber(v, { style: 'currency', currency: 'EGP', maximumFractionDigits: 0, currencyDisplay: lang === 'ar' ? 'name' : 'code' })
    : formatNumber(v))
}
