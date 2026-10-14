import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import OpportunitiesPage from './OpportunitiesPage.jsx'

const opp = (over) => ({ opportunity_id: 'o1', type: 'grant', title_ar: 'منحة البذور', title_en: 'Seed grant', description_ar: null, description_en: 'Money for seeds', provider_ar: null, provider_en: 'Athar', deadline: '2099-12-31', eligibility: null, link: 'https://example.com/apply', is_active: false, archived_at: null, order_index: 0, target: {}, created_at: '2026-10-01T00:00:00Z', apps: [{ count: 2 }], ...over })
const OPPS = [
  opp(),
  opp({ opportunity_id: 'o2', title_en: 'Live event', title_ar: 'فعالية', type: 'event', is_active: true, target: { sectors: ['technology'], stages: ['mvp'] }, apps: [{ count: 0 }] }),
  opp({ opportunity_id: 'o3', title_en: 'Old call', title_ar: 'قديمة', is_active: false, archived_at: '2026-01-01T00:00:00Z', deadline: '2020-01-01', apps: [{ count: 5 }] }),
]
const APPLICATIONS = [
  { id: 'a1', opportunity_id: 'o1', company_id: 'c1', founder_id: 'f1', status: 'applied', notes: 'We are ready', applied_at: '2026-10-05T10:00:00Z', company: { id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل', logo_path: null }, founder: { id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة', email: 'sara@example.com' } },
]

let mock
function setup(extra = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_programs: { programs: [{ id: 'g1', name_en: 'Accelerator', name_ar: 'مسرعة', projects: [] }] },
      list_alumni_directory: { audience: 'manager', total: 1, limit: 8, offset: 0, rows: [{ id: 'c9', name_en: 'Delta Health', name_ar: 'دلتا', logo_path: null, sector: 'healthcare', governorate: 1, is_alumni: true }] },
      ...extra,
    },
    tables: { opportunities: OPPS, opportunity_applications: APPLICATIONS },
  })
  h.db = mock.db
}
const renderPage = () => renderWithProviders(<ConfirmProvider><OpportunitiesPage /></ConfirmProvider>, { route: '/alumni/admin/opportunities?lang=en' })
const card = (title) => screen.getByRole('heading', { name: title }).closest('li')

beforeEach(() => setup())

describe('the opportunities hub', () => {
  it('lists every opportunity with its status, type, deadline and applications; the tabs filter and count', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Seed grant' })).toBeInTheDocument()
    expect(within(card('Seed grant')).getByText('Draft')).toBeInTheDocument()
    expect(within(card('Live event')).getByText('Published')).toBeInTheDocument()
    expect(within(card('Old call')).getByText('Archived')).toBeInTheDocument()
    expect(within(card('Old call')).getByText('closed')).toBeInTheDocument() // the deadline passed
    expect(within(card('Seed grant')).getByRole('button', { name: /Applications · 2 applications/ })).toBeInTheDocument()
    // who it is for: a targeted opportunity says so, an untargeted one says "every founder"
    expect(within(card('Live event')).getByText('Targeted')).toBeInTheDocument()
    expect(within(card('Live event')).getByText(/Technology/)).toBeInTheDocument()
    expect(within(card('Seed grant')).getByText('Open to every founder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Drafts\s*1/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Published/ }))
    expect(screen.queryByRole('heading', { name: 'Seed grant' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Live event' })).toBeInTheDocument()
  })

  it('creates a DRAFT (never published by creating): bilingual fields, the link, and the target filter go to the table', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Seed grant' })
    await user.click(screen.getByTestId('opp-new'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByTestId('opp-save'))
    expect(await within(dialog).findByText('The Arabic title is required.')).toBeInTheDocument()
    expect(mock.tableCalls('opportunities', 'insert')).toHaveLength(0)
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'investment')
    await user.type(within(dialog).getAllByLabelText('العربية', { selector: 'input' })[0], 'استثمار')
    await user.type(within(dialog).getByLabelText('Link (apply or read more)'), 'javascript:alert(1)')
    await user.click(within(dialog).getByTestId('opp-save'))
    expect(await within(dialog).findByText('The link must start with http:// or https://.')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Link (apply or read more)'))
    await user.type(within(dialog).getByLabelText('Link (apply or read more)'), 'https://example.com/call')
    await user.click(within(dialog).getByRole('button', { name: 'Technology' }))
    await user.click(within(dialog).getByRole('button', { name: 'MVP' }))
    await user.click(within(dialog).getByTestId('opp-save'))
    await waitFor(() => expect(mock.tableCalls('opportunities', 'insert')).toHaveLength(1))
    expect(mock.tableCalls('opportunities', 'insert')[0].body).toMatchObject({
      type: 'investment', title_ar: 'استثمار', title_en: null, link: 'https://example.com/call', is_active: false, target: { sectors: ['technology'], stages: ['mvp'] },
    })
    // only opportunity columns are ever sent
    expect(Object.keys(mock.tableCalls('opportunities', 'insert')[0].body).every((k) => ['type', 'title_ar', 'title_en', 'description_ar', 'description_en', 'provider_ar', 'provider_en', 'deadline', 'eligibility', 'link', 'is_active', 'archived_at', 'target', 'order_index'].includes(k))).toBe(true)
  })

  it('publish / unpublish / archive / restore are one tap and keep is_active and archived_at consistent', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Seed grant' })
    await user.click(within(card('Seed grant')).getByTestId('opp-publish'))
    await waitFor(() => expect(mock.tableCalls('opportunities', 'update')).toHaveLength(1))
    expect(mock.tableCalls('opportunities', 'update')[0]).toMatchObject({ body: { is_active: true, archived_at: null }, filters: [['eq', 'opportunity_id', 'o1']] })
    await user.click(within(card('Live event')).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(mock.tableCalls('opportunities', 'update')).toHaveLength(2))
    expect(mock.tableCalls('opportunities', 'update')[1].body).toMatchObject({ is_active: false })
    expect(mock.tableCalls('opportunities', 'update')[1].body.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await user.click(within(card('Old call')).getByRole('button', { name: 'Restore as draft' }))
    await waitFor(() => expect(mock.tableCalls('opportunities', 'update')).toHaveLength(3))
    expect(mock.tableCalls('opportunities', 'update')[2].body).toEqual({ archived_at: null })
  })

  it('a published opportunity offers "Notify the founders" (the composer opens with it attached)', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Live event' })
    expect(within(card('Live event')).getByRole('link', { name: 'Notify the founders' })).toHaveAttribute('href', '/alumni/admin/notifications?opportunity=o2')
    expect(within(card('Seed grant')).queryByRole('link', { name: 'Notify the founders' })).not.toBeInTheDocument()
  })

  it('deleting asks first and says how many applications go with it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Seed grant' })
    await user.click(within(card('Seed grant')).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/together with its 2 applications/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mock.tableCalls('opportunities', 'delete')).toHaveLength(1))
    expect(mock.tableCalls('opportunities', 'delete')[0].filters).toEqual([['eq', 'opportunity_id', 'o1']])
  })

  it('applications: the list with the founder and the note, the status workflow, and applying on behalf of a company', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Seed grant' })
    await user.click(within(card('Seed grant')).getByTestId('opp-apps'))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByRole('link', { name: 'Nile Robotics' })).toHaveAttribute('href', '/alumni/admin/company/c1')
    expect(within(drawer).getByText('We are ready')).toBeInTheDocument()
    expect(within(drawer).getByText(/by Sara Ali/)).toBeInTheDocument()
    await user.selectOptions(within(drawer).getByLabelText('Status of Nile Robotics'), 'shortlisted')
    await waitFor(() => expect(mock.tableCalls('opportunity_applications', 'update')).toHaveLength(1))
    expect(mock.tableCalls('opportunity_applications', 'update')[0]).toMatchObject({ body: { status: 'shortlisted' }, filters: [['eq', 'id', 'a1']] })
    // a draft takes no applications on behalf of anybody
    expect(within(drawer).getByText('Only a published opportunity takes applications.')).toBeInTheDocument()
  })

  it('applying on behalf works for a published opportunity', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Live event' })
    await user.click(within(card('Live event')).getByTestId('opp-apps'))
    const drawer = await screen.findByRole('dialog')
    await user.type(within(drawer).getByRole('combobox'), 'delta')
    await user.click(await screen.findByRole('option', { name: /Delta Health/ }))
    await user.type(within(drawer).getByLabelText('Note (optional)'), 'by phone')
    await user.click(within(drawer).getByRole('button', { name: 'Add the application' }))
    await waitFor(() => expect(mock.tableCalls('opportunity_applications', 'insert')).toHaveLength(1))
    expect(mock.tableCalls('opportunity_applications', 'insert')[0].body).toEqual({ opportunity_id: 'o2', company_id: 'c9', notes: 'by phone' })
  })

  it('shows the empty state with a way to create the first one, and an error state', async () => {
    setup()
    h.db = makeDb({ rpc: { list_alumni_lookups: LOOKUPS, list_alumni_programs: { programs: [] } }, tables: { opportunities: [] } }).db
    const { unmount } = renderPage()
    expect(await screen.findByText('No opportunity here yet.')).toBeInTheDocument()
    unmount()
    h.db = { rpc: vi.fn().mockResolvedValue({ data: LOOKUPS, error: null }), from: () => ({ select: () => ({ order: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }) }
    renderPage()
    expect(await screen.findByText('The opportunities could not be loaded.')).toBeInTheDocument()
  })
})
