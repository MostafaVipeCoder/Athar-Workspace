import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import en from './dict.en.js'
import ar from './dict.ar.js'
import {
  STORAGE_KEY, dirOf, formatDate as fmtDate, formatNumber as fmtNumber, getMessagesVersion, isLang, pick as pickField,
  pickLiteral, registerFlat, resolveLang, subscribeMessages, translate, translatePlural,
} from './core.js'

registerFlat({ ar, en })

const LanguageContext = createContext(null)

function readStored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function writeStored(lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* private mode: choice just won't persist */
  }
}

const warned = new Set()
function warnMissing(key, lang) {
  if (!import.meta.env?.DEV) return
  const id = `${lang}:${key}`
  if (warned.has(id)) return
  warned.add(id)
  console.warn(`[i18n] missing "${key}" for "${lang}"`)
}

/** Sets <html lang dir> once, globally (not per wrapper). Must sit inside the Router (reads ?lang and the path). */
export function LanguageProvider({ children }) {
  const location = useLocation()
  const [explicit, setExplicit] = useState(() => (isLang(readStored()) ? readStored() : null))
  const msgVersion = useSyncExternalStore(subscribeMessages, getMessagesVersion)

  const { lang } = resolveLang({ search: location.search, stored: explicit, pathname: location.pathname })
  const dir = dirOf(lang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])

  const setLang = useCallback((next) => {
    if (!isLang(next)) return
    writeStored(next)
    setExplicit(next)
  }, [])

  const value = useMemo(() => ({
    lang,
    dir,
    messagesVersion: msgVersion,
    setLang,
    t: (key, vars) => translate(lang, key, vars, warnMissing),
    tn: (key, count, vars) => translatePlural(lang, key, count, vars, warnMissing),
    pick: (obj, base) => pickField(obj, base, lang),
    pickLiteral: (literal) => pickLiteral(literal, lang),
    formatDate: (v, opts) => fmtDate(lang, v, opts),
    formatNumber: (v, opts) => fmtNumber(lang, v, opts),
  }), [lang, dir, setLang, msgVersion])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>')
  return ctx
}

/** Shorthand hook; `useT()` returns { t, tn, lang, dir, ... }. A namespace prefixes keys: useT('auth').t('title'). */
// eslint-disable-next-line react-refresh/only-export-components
export function useT(namespace) {
  const l = useLanguage()
  if (!namespace) return l
  return { ...l, t: (key, vars) => l.t(`${namespace}.${key}`, vars), tn: (key, c, vars) => l.tn(`${namespace}.${key}`, c, vars) }
}
