import { AlertTriangle } from 'lucide-react'
import { REQUIRED_VARS } from '../lib/env.js'
import { translate } from '../i18n/core.js'
import '../i18n/LanguageProvider.jsx' // registers the base dictionaries

/**
 * Rendered by main.jsx when required env variables are missing (no silent fallback to a live project).
 * Rendered OUTSIDE the router/providers, so it reads the language from storage by itself and shows both languages.
 */
export default function ConfigError({ missing = REQUIRED_VARS }) {
  const blocks = ['ar', 'en']
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-2 p-4">
      <div className="panel w-full max-w-lg space-y-5 p-6 shadow-dropdown sm:p-panel-pad" role="alert">
        <div className="flex items-center gap-3 text-destructive-text">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          <h1 className="font-display text-xl font-extrabold">
            {translate('en', 'config.title')} / {translate('ar', 'config.title')}
          </h1>
        </div>
        <ul className="list-inside list-disc rounded-input bg-surface p-3 font-mono text-sm" dir="ltr">
          {missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        {blocks.map((lang) => (
          <div key={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="text-sm text-muted-foreground">
            <p>{translate(lang, 'config.body')}</p>
            <p className="mt-1">{translate(lang, 'config.hint')}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
