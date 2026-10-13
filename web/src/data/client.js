import { createClient } from '@supabase/supabase-js'
import { env } from '../lib/env.js'
import { AppError } from './errors.js'

/** The single supabase-js instance. Null when configuration is missing (the app then shows ConfigError). */
export const supabase = env.ok
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export function db() {
  if (!supabase) throw new AppError('config', { messageKey: 'errors.config', retryable: false })
  return supabase
}

/** Edge function base URL derived from the configured project URL (works for local and live). */
export function functionUrl(name) {
  return `${env.supabaseUrl}/functions/v1/${name}`
}
