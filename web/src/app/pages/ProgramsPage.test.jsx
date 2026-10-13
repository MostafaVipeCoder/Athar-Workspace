import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { AuthContext } from '../AuthContext.js'

const mocks = vi.hoisted(() => ({ listPrograms: vi.fn(), listProjects: vi.fn(), createProgram: vi.fn() }))
vi.mock('../../data/programs.js', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query')
  return {
    listPrograms: mocks.listPrograms, listProjects: mocks.listProjects, createProgram: mocks.createProgram, updateProgram: vi.fn(),
    usePrograms: () => useQuery({ queryKey: ['programs'], queryFn: mocks.listPrograms }),
    useProjects: (id) => useQuery({ queryKey: ['projects', id ?? 'all'], queryFn: () => mocks.listProjects(id) }),
    useCreateProgram: () => useMutation({ mutationFn: mocks.createProgram }),
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

import ProgramsPage from './ProgramsPage.jsx'

const pm = { user: { id: 'u1' }, profile: null, roles: ['project_manager'], areas: ['staff'], status: 'authed', hasRole: () => false, can: (p) => p === 'program:create', signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listPrograms.mockResolvedValue([
    { id: 'g1', name_en: 'Spring 2026', name_ar: 'ربيع', year: 2026, cover_path: 'g1/cover/a.webp', is_completed: false, archived_at: null, created_at: '2026-01-01' },
    { id: 'g2', name_en: 'Old', name_ar: null, year: 2024, cover_path: null, is_completed: true, archived_at: '2026-01-02', created_at: '2024-01-01' },
  ])
  mocks.listProjects.mockResolvedValue([{ id: 'j1', program_id: 'g1', name_en: 'Cohort A', completed_at: null }])
  mocks.createProgram.mockResolvedValue({ id: 'g3' })
})

describe('ProgramsPage (step 5)', () => {
  it('renders programs with thumbnails, hides archived until toggled, links to settings', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuthContext.Provider value={pm}><ProgramsPage /></AuthContext.Provider>, { route: '/programs?lang=en' })
    const list = await screen.findByTestId('programs-list')
    expect(within(list).getAllByRole('listitem').filter((li) => li.querySelector('h2'))).toHaveLength(1)
    expect(list.querySelector('img')?.getAttribute('src')).toBe('http://img/t/g1/cover/a.webp')
    expect(within(list).getByRole('link', { name: 'Program Settings' })).toHaveAttribute('href', '/programs/g1/settings')
    await user.click(screen.getByLabelText(/Show archived/))
    expect(await within(list).findByText('Old')).toBeInTheDocument()
    expect(within(list).getByText('Archived')).toBeInTheDocument()
  })

  it('creates a program through the RPC after client validation', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuthContext.Provider value={pm}><ProgramsPage /></AuthContext.Provider>, { route: '/programs?lang=en' })
    await screen.findByTestId('programs-list')
    await user.click(screen.getByTestId('create-program'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create program' }))
    expect(await within(dialog).findByText('Enter the name in at least one language.')).toBeInTheDocument()
    expect(mocks.createProgram).not.toHaveBeenCalled()
    await user.type(within(dialog).getAllByLabelText('English')[0], 'Summer 2026')
    await user.type(within(dialog).getByLabelText('Year'), '2026')
    await user.click(within(dialog).getByRole('button', { name: 'Create program' }))
    await waitFor(() => expect(mocks.createProgram).toHaveBeenCalledWith(expect.objectContaining({ name_en: 'Summer 2026', name_ar: null, year: 2026, visibility: 'private' }), expect.anything()))
  })
})
