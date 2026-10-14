import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { LanguageProvider } from '../i18n/LanguageProvider.jsx'
import RouteTitle from './RouteTitle.jsx'
import { setPageMeta } from '../lib/meta.js'

function Late({ text }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const id = setTimeout(() => setOn(true), 30); return () => clearTimeout(id) }, [])
  return on ? <h1>{text}</h1> : <p>loading</p>
}
function Own() {
  useEffect(() => { setPageMeta({ title: 'The Form Name' }) }, [])
  return <h1>Something else</h1>
}
const app = (start = '/a') => render(
  <MemoryRouter initialEntries={[start]}>
    <LanguageProvider>
      <RouteTitle />
      <nav><Link to="/a">a</Link><Link to="/b">b</Link><Link to="/own">own</Link></nav>
      <Routes>
        <Route path="/a" element={<h1>Opportunities</h1>} />
        <Route path="/b" element={<Late text="Notifications" />} />
        <Route path="/own" element={<Own />} />
      </Routes>
    </LanguageProvider>
  </MemoryRouter>,
)

afterEach(() => { document.title = 'Athar' })

describe('RouteTitle (WCAG 2.4.2: every page has its own title)', () => {
  it('names the page after its heading, and follows the navigation (also when the heading arrives later)', async () => {
    const user = userEvent.setup()
    app('/a')
    await waitFor(() => expect(document.title).toBe('Opportunities - Athar'))
    await user.click(screen.getByRole('link', { name: 'b' }))
    await waitFor(() => expect(document.title).toBe('Notifications - Athar'))
    await user.click(screen.getByRole('link', { name: 'a' }))
    await waitFor(() => expect(document.title).toBe('Opportunities - Athar'))
  })

  it('leaves a page alone that sets its own title (the public pages do)', async () => {
    const user = userEvent.setup()
    app('/a')
    await waitFor(() => expect(document.title).toBe('Opportunities - Athar'))
    await user.click(screen.getByRole('link', { name: 'own' }))
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(document.title).toBe('The Form Name - Athar')
  })
})
