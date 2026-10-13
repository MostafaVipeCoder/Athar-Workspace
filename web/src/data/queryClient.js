import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query'
import { AppError, isRetryable } from './errors.js'
import { log } from '../lib/log.js'

/** Hook point for the toast layer (set by ToastProvider) so unexpected failures surface once, globally. */
let globalErrorListener = null
export function setGlobalErrorListener(fn) {
  globalErrorListener = fn
}

function report(error) {
  const e = error instanceof AppError ? error : new AppError('unknown', { cause: error })
  log.error('[query]', e.code, e.cause?.message ?? e.message)
  // forbidden / not_found are normal outcomes handled by pages, not unexpected failures
  if (e.code === 'forbidden' || e.code === 'not_found' || e.code === 'unauthenticated') return
  globalErrorListener?.(e)
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => query.meta?.silent || report(error) }),
    mutationCache: new MutationCache({ onError: (error, _v, _c, mutation) => mutation.meta?.silent || report(error) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // retry only what can plausibly succeed later; never forbidden/not_found
        retry: (failureCount, error) => failureCount < 1 && isRetryable(error),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  })
}

export const queryClient = createQueryClient()
