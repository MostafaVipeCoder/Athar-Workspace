import { describe, expect, it } from 'vitest'
import { screen, act } from '@testing-library/react'
import en from './dict.en.js'
import ar from './dict.ar.js'
import { defaultLangForPath, formatNumber, joinList, pick, registerMessages, resolveLang, translate, translatePlural } from './core.js'
import { useLanguage } from './LanguageProvider.jsx'
import { renderWithProviders } from '../test/render.jsx'
import LanguageSwitch from '../shared/LanguageSwitch.jsx'

describe('dictionaries', () => {
  it('ar and en have identical keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
  })
  it('placeholders match between languages', () => {
    const vars = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [])
    for (const k of Object.keys(en)) if (typeof en[k] === 'string') expect(vars(ar[k]), k).toEqual(vars(en[k]))
  })
})

describe('translate', () => {
  it('interpolates and falls back to en then key', () => {
    registerMessages('t', { en: { only: 'English only {n}' }, ar: {} })
    expect(translate('ar', 't.only', { n: 2 })).toBe('English only 2')
    expect(translate('ar', 'nope.nope')).toBe('nope.nope')
  })
  it('arabic plural categories', () => {
    expect(translatePlural('ar', 'programs.projects', 1)).toBe('مشروع واحد')
    expect(translatePlural('ar', 'programs.projects', 2)).toBe('مشروعان')
    expect(translatePlural('ar', 'programs.projects', 5)).toBe('5 مشاريع')
    expect(translatePlural('ar', 'programs.projects', 11)).toBe('11 مشروعاً')
    expect(translatePlural('en', 'programs.projects', 1)).toBe('1 project')
  })
  it('western digits in arabic', () => expect(formatNumber('ar', 1234)).toMatch(/1.?234/))
  it('joinList: the Arabic comma only in Arabic, the Latin comma in English, empty values skipped', () => {
    expect(joinList('en', ['Sara', 'Omar', null, 'Hana'])).toBe('Sara, Omar, Hana')
    expect(joinList('ar', ['سارة', 'عمر'])).toBe('سارة، عمر')
    expect(joinList('en', [])).toBe('')
  })
  it('pick falls back to the other language', () => {
    expect(pick({ name_en: 'A', name_ar: 'ب' }, 'name', 'ar')).toBe('ب')
    expect(pick({ name_en: 'A', name_ar: '' }, 'name', 'ar')).toBe('A')
    expect(pick({ name_ar: 'ب' }, 'name', 'en')).toBe('ب')
  })
})

describe('resolveLang', () => {
  it('url beats stored beats default', () => {
    expect(resolveLang({ search: '?lang=en', stored: 'ar', pathname: '/login' }).lang).toBe('en')
    expect(resolveLang({ search: '', stored: 'en', pathname: '/login' }).lang).toBe('en')
    expect(resolveLang({ search: '', stored: null, pathname: '/login' }).lang).toBe('ar')
    expect(resolveLang({ search: '', stored: null, pathname: '/programs' }).lang).toBe('en')
    expect(defaultLangForPath('/agenda/x')).toBe('ar')
  })
})

describe('LanguageProvider', () => {
  function Probe() {
    const { lang, dir, t } = useLanguage()
    return (
      <p data-testid="p">
        {lang}|{dir}|{t('common.save')}
      </p>
    )
  }
  it('sets html lang/dir, switches and persists', async () => {
    renderWithProviders(
      <>
        <Probe />
        <LanguageSwitch />
      </>,
      { route: '/login' },
    )
    expect(screen.getByTestId('p').textContent).toBe('ar|rtl|حفظ')
    expect(document.documentElement.dir).toBe('rtl')
    await act(async () => screen.getByRole('button').click())
    expect(screen.getByTestId('p').textContent).toBe('en|ltr|Save')
    expect(document.documentElement.dir).toBe('ltr')
    expect(window.localStorage.getItem('athar.lang')).toBe('en')
  })
})
