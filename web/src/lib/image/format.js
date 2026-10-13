/**
 * A file size for people: "900 B", "1.5 KB", "180 KB", "6.1 MB" (one decimal below 10 of a unit); `lang = 'ar'` uses the Arabic units. Empty for no / zero / negative
 * (a size that is not known). THE one formatter (the Library and the upload feedback each had their own).
 */
export function formatBytes(n, lang = 'en') {
  const bytes = Number(n)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب'] : ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  const num = v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10
  return `${num} ${units[i]}`
}

/** Left-to-right isolate: keeps "2.1 MB" readable inside an Arabic sentence. */
export const ltr = (s) => `\u2066${s}\u2069`

/**
 * The message key + variables that describe a conversion report (`result.report`), for `t(key, vars)`:
 *   image.optimised  "Optimised: 2.1 MB -> 180 KB (-91%)"
 *   image.converted  "Converted to WebP: 120 KB -> 140 KB" (no saving: the stored format is still WebP)
 *   image.kept       "Already WebP, kept as is: 90 KB"
 *   image.vector     "SVG kept as is: 12 KB"
 */
export function describeReport(report) {
  const from = ltr(formatBytes(report.sourceBytes))
  const to = ltr(formatBytes(report.bytes))
  if (report.kind === 'vector') return { key: 'image.vector', vars: { to } }
  if (report.kind === 'kept') return { key: 'image.kept', vars: { to } }
  // never print "-100%" for a file that still has bytes (99.6% rounds up): the stored result is not empty
  const percent = report.sourceBytes > 0 ? Math.min(report.bytes > 0 ? 99 : 100, Math.round((1 - report.bytes / report.sourceBytes) * 100)) : 0
  if (percent > 0) return { key: 'image.optimised', vars: { from, to, percent: ltr(`-${percent}%`) } }
  return { key: 'image.converted', vars: { from, to } }
}
