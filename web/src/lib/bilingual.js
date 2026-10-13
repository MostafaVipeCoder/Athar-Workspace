/** Split DB `xxx_en`/`xxx_ar` columns into the {en, ar} form shape and back (BilingualField). */
export const fromColumns = (row, base) => ({ en: row?.[`${base}_en`] ?? '', ar: row?.[`${base}_ar`] ?? '' })
export const toColumns = (value, base) => ({ [`${base}_en`]: value?.en?.trim() || null, [`${base}_ar`]: value?.ar?.trim() || null })
