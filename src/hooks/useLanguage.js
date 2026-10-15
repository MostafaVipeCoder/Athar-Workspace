import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'alumni_lang';

// Alumni Manager flow is English-only; lang is fixed to 'en'.
// Keeping the hook shape consistent so pages can use lang/isRtl
// without breaking if bilingual support is re-introduced later.
export function useLanguage() {
  const [lang, setLangState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'en'
  );

  const isRtl = lang === 'ar';
  const isLtr = lang === 'en';

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    // Sync dir attribute on first mount
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, []);

  return { lang, isRtl, isLtr, setLang };
}
