import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render.jsx'
import NavBar from './NavBar.jsx'

const ITEMS = [
  { to: '/a', label: 'Alpha' },
  { to: '/b', label: 'Beta' },
  { to: '/c', label: 'Gamma', more: true },
  { to: '/d', label: 'Delta', more: true },
]
const mount = (props = {}, route = '/a') => renderWithProviders(<NavBar items={ITEMS} label="Main" moreLabel="More" {...props} />, { route })

describe('NavBar: the "More" menu of a long nav', () => {
  it('a nav without more items is the plain scrolling row it always was', () => {
    mount({ items: ITEMS.filter((i) => !i.more) })
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.className).toContain('overflow-x-auto')
    expect(within(nav).queryByRole('button')).toBeNull()
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/a', '/b'])
  })

  it('the more items sit in a menu at the end: the links stay in the DOM in order (hidden while closed), the row no longer scrolls, the button opens and closes it', async () => {
    const user = userEvent.setup()
    mount()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.className).not.toContain('overflow-x-auto') // a clipping scroll box would cut the dropdown
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/a', '/b', '/c', '/d'])
    const button = within(nav).getByRole('button', { name: 'More' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav).queryByRole('link', { name: 'Gamma' })).toBeNull() // hidden: not exposed
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Gamma' })).toBeVisible()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape and a click outside close the menu', async () => {
    const user = userEvent.setup()
    mount()
    const button = screen.getByRole('button', { name: 'More' })
    await user.click(button)
    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    await user.click(document.body)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('when the current page is one of them, the button NAMES it and carries the active underline (the active item is never hidden)', () => {
    mount({}, '/d')
    const button = screen.getByRole('button', { name: 'More: Delta' })
    expect(button).toHaveTextContent('Delta')
    expect(button.className).toContain('active')
    const other = screen.queryByRole('button', { name: 'More: Gamma' })
    expect(other).toBeNull()
  })

  it('choosing an item navigates and the menu is closed again', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('link', { name: 'Gamma' }))
    expect(screen.getByRole('button', { name: 'More: Gamma' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('the mobile panel (vertical) lists EVERY item flat: no menu', () => {
    mount({ vertical: true })
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/a', '/b', '/c', '/d'])
    expect(within(nav).queryByRole('button')).toBeNull()
  })
})
