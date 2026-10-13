import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n/LanguageProvider.jsx'
import { ToastProvider } from '../ui/Toast.jsx'

export function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

export function renderWithProviders(ui, { route = '/programs', client = makeClient() } = {}) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <LanguageProvider>
            <ToastProvider>{ui}</ToastProvider>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
