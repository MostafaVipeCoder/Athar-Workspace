import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import './styles/index.css'
import { env } from './lib/env.js'
import { applyBootShim } from './app/legacy/legacyRedirects.js'
import { queryClient } from './data/queryClient.js'

const root = createRoot(document.getElementById('root'))

async function boot() {
  if (!env.ok) {
    // missing configuration: visible screen, never a silent fallback to a live project
    const { default: ConfigError } = await import('./app/ConfigError.jsx')
    root.render(<ConfigError missing={env.missing} />)
    return
  }
  applyBootShim(window, import.meta.env.BASE_URL) // old #/... and ?agenda= links become path URLs before the router reads them
  const { createAppRouter } = await import('./app/routes.jsx')
  const router = createAppRouter()
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

boot()
