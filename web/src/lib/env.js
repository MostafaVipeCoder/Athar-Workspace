/**
 * Environment contract (design 06 section 11). Pure so it can be unit-tested.
 * Nothing falls back to a live project: a missing variable is a visible ConfigError.
 */
export const REQUIRED_VARS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

export function readEnv(raw = import.meta.env) {
  const missing = REQUIRED_VARS.filter((k) => !String(raw?.[k] ?? '').trim())
  const url = String(raw?.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  return {
    ok: missing.length === 0,
    missing,
    supabaseUrl: url,
    supabaseAnonKey: String(raw?.VITE_SUPABASE_ANON_KEY ?? '').trim(),
    appEnv: String(raw?.VITE_APP_ENV ?? 'production').trim() || 'production',
    basePath: String(raw?.BASE_URL ?? raw?.VITE_BASE_PATH ?? '/'),
    publicUrl: String(raw?.VITE_APP_PUBLIC_URL ?? '').trim(),
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/** Derived from the URL host (not only the variable) so the banner cannot lie. */
export function classifyTarget(supabaseUrl) {
  try {
    const { hostname } = new URL(supabaseUrl)
    if (LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return 'local'
    return 'remote'
  } catch {
    return 'unknown'
  }
}

/** Router basename: import.meta.env.BASE_URL without the trailing slash ('/' becomes undefined). */
export function routerBasename(base) {
  const b = String(base ?? '/').replace(/\/+$/, '')
  return b === '' ? undefined : b
}

export const env = readEnv()
