import { env, classifyTarget } from '../lib/env.js'
import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { cn } from '../lib/cn.js'

/** Shown only outside production builds. The kind (local vs live) comes from the URL host, so it cannot lie. */
export default function EnvBanner() {
  const { t } = useLanguage()
  if (env.appEnv === 'production' && classifyTarget(env.supabaseUrl) !== 'local') return null
  const kind = classifyTarget(env.supabaseUrl)
  const local = kind === 'local'
  return (
    <div
      role="status"
      title={local ? t('env.localHint') : t('env.liveHint')}
      data-testid="env-banner"
      className={cn(
        'sticky top-0 z-40 px-3 py-1 text-center text-xs font-semibold tracking-wide',
        local ? 'bg-success text-success-foreground' : 'bg-destructive-text text-white',
      )}
    >
      {local ? t('env.local') : t('env.live')}
    </div>
  )
}
