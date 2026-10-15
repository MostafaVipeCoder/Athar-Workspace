import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nipunwrewluxaikyfbzg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PsvF2yugR6vWfUsYCLdQPw_YsD7l5jt';

// Singleton pattern: reuse the same client across HMR reloads in dev,
// preventing "Multiple GoTrueClient instances" and NavigatorLockAcquireTimeoutError.
const g = globalThis;

/** @type {import('@supabase/supabase-js').SupabaseClient<import('../types/database.types').Database>} */
export const supabase = g.__supabaseClient ?? (g.__supabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage,
            // Disables navigator.locks to prevent NavigatorLockAcquireTimeoutError
            // when tabs are suspended or multiple GoTrue clients exist.
            lock: async (_name, _acquireTimeout, fn) => fn(),
        },
    }
));

// Refresh session when the user returns to the tab after it was suspended.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            supabase.auth.getSession();
        }
    });
}
