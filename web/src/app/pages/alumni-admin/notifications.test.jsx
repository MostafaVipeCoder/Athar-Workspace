import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import NotificationsPage from './NotificationsPage.jsx'

const PROGRAMS = { programs: [{ id: 'g1', name_en: 'Accelerator', name_ar: 'مسرعة', projects: [{ id: 'j1', name_en: 'Cohort 1', name_ar: 'الدفعة الأولى', completed: false, companies: 2 }] }] }
const BROADCAST = { broadcast_id: 'b1', sent_at: '2026-10-12T10:00:00Z', audience_type: 'program', target_id: 'g1', target_name_en: 'Accelerator', target_name_ar: 'مسرعة', sent_by: 'Mona', title_en: 'Welcome', title_ar: 'مرحباً', body_en: 'Hello <b>all</b>', body_ar: 'أهلاً', recipients: 4, reads: 3 }

let mock
function setup(extra = {}, moreTables = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_programs: PROGRAMS,
      preview_notification_audience: (a) => ({ recipients: a.p_audience.kind === 'all' ? 6 : 2, without_account: a.p_audience.kind === 'all' ? 1 : 0, sample: [{ founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي' }] }),
      send_alumni_notification: (a) => ({ broadcast_id: 'new', recipients: a.p_audience.kind === 'all' ? 6 : 2, without_account: 0 }),
      list_alumni_broadcasts: { total: 1, limit: 10, offset: 0, rows: [BROADCAST] },
      list_alumni_directory: { audience: 'manager', total: 1, limit: 8, offset: 0, rows: [{ id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل', logo_path: null, sector: 'technology', governorate: 25, is_alumni: true }] },
      ...extra,
    },
    tables: { notifications: [{ id: 'n1', broadcast_id: 'b1', is_read: true, created_at: '2026-10-12T10:01:00Z', founder: { id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة' } }, { id: 'n2', broadcast_id: 'b1', is_read: false, created_at: '2026-10-12T10:01:00Z', founder: { id: 'f2', name_en: 'Omar Zaki', name_ar: 'عمر' } }], opportunities: [], ...moreTables },
  })
  h.db = mock.db
}
const renderPage = (route = '/alumni/admin/notifications?lang=en') => renderWithProviders(<ConfirmProvider><NotificationsPage /></ConfirmProvider>, { route })

beforeEach(() => setup())

describe('the notifications page', () => {
  it('counts the audience on the server before anything is sent: everybody, the ones without an account are skipped', async () => {
    renderPage()
    const preview = screen.getByTestId('audience-preview')
    expect(await within(preview).findByText('It reaches 6 founders.')).toBeInTheDocument()
    expect(within(preview).getByText(/1 team member has no account and will not receive it/)).toBeInTheDocument()
    expect(within(preview).getByText(/Sara Ali/)).toBeInTheDocument()
    expect(mock.rpcCalls('preview_notification_audience')[0].args).toEqual({ p_audience: { kind: 'all' } })
  })

  it('a program audience needs a program; choosing a project narrows it (the project wins)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'A program' }))
    expect(screen.getByText('Choose who receives it.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Program'), 'g1')
    await waitFor(() => expect(mock.rpcCalls('preview_notification_audience').at(-1).args).toEqual({ p_audience: { kind: 'program', program_id: 'g1' } }))
    await user.selectOptions(screen.getByLabelText('A single project of it (optional)'), 'j1')
    await waitFor(() => expect(mock.rpcCalls('preview_notification_audience').at(-1).args).toEqual({ p_audience: { kind: 'program', project_id: 'j1' } }))
  })

  it('companies are picked by name and listed as removable chips', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Companies' }))
    await user.type(screen.getByRole('combobox', { name: 'Companies' }), 'nile')
    await user.click(await screen.findByRole('option', { name: /Nile Robotics/ }))
    expect(within(screen.getByRole('list', { name: 'Chosen companies' })).getByText('Nile Robotics')).toBeInTheDocument()
    await waitFor(() => expect(mock.rpcCalls('preview_notification_audience').at(-1).args).toEqual({ p_audience: { kind: 'company', company_ids: ['c1'] } }))
    await user.click(screen.getByRole('button', { name: 'Remove Nile Robotics' }))
    expect(screen.queryByRole('list', { name: 'Chosen companies' })).not.toBeInTheDocument()
  })

  it('refuses to send without a title and a message (in at least one language) and sends nothing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('It reaches 6 founders.')
    await user.click(screen.getByTestId('send-notification'))
    expect(await screen.findByText('Write a title in at least one language.')).toBeInTheDocument()
    expect(screen.getByText('Write the message in at least one language.')).toBeInTheDocument()
    expect(mock.rpcCalls('send_alumni_notification')).toHaveLength(0)
  })

  it('sends after a confirmation that says how many founders it reaches; the message is PLAIN TEXT', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('It reaches 6 founders.')
    const compose = screen.getByTestId('compose')
    const [titleEn, titleAr] = within(compose).getAllByRole('textbox').slice(0, 2)
    await user.type(titleEn, 'Deadline')
    await user.type(titleAr, 'الموعد')
    const [bodyEn, bodyAr] = within(compose).getAllByRole('textbox').slice(2, 4)
    await user.type(bodyEn, 'Apply <b>now</b>')
    await user.type(bodyAr, 'قدّم الآن')
    expect(within(compose).getByRole('group', { name: 'How it appears' }).querySelector('b')).toBeNull() // the markup is shown as text, never rendered
    await user.click(screen.getByTestId('send-notification'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/reach 6 founders now and cannot be taken back/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send the notification' }))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_notification')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_notification')[0].args).toEqual({ p_audience: { kind: 'all' }, p_title_en: 'Deadline', p_title_ar: 'الموعد', p_body_en: 'Apply <b>now</b>', p_body_ar: 'قدّم الآن', p_link: null, p_opportunity: null })
  })

  it('the confirmation uses the singular for ONE founder and the Arabic dual for two', async () => {
    const user = userEvent.setup()
    setup({ preview_notification_audience: { recipients: 1, without_account: 0, sample: [] } })
    const { unmount } = renderPage()
    await screen.findByText('It reaches 1 founder.')
    const [titleEn] = within(screen.getByTestId('compose')).getAllByRole('textbox')
    await user.type(titleEn, 'Hello')
    const bodyEn = within(screen.getByTestId('compose')).getAllByRole('textbox')[2]
    await user.type(bodyEn, 'Body')
    await user.click(screen.getByTestId('send-notification'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('It will reach 1 founder now and cannot be taken back.')).toBeInTheDocument()
    unmount()
    setup({ preview_notification_audience: { recipients: 2, without_account: 0, sample: [] } })
    renderPage('/alumni/admin/notifications?lang=ar')
    await screen.findByText('يصل إلى مؤسسين.')
    const boxes = within(screen.getByTestId('compose')).getAllByRole('textbox')
    await user.type(boxes[1], 'مرحبا')
    await user.type(boxes[3], 'نص')
    await user.click(screen.getByTestId('send-notification'))
    expect(await screen.findByText('سيصل إلى مؤسسين الآن ولا يمكن سحبه.')).toBeInTheDocument()
  })

  it('warns when one language is empty (readers of the other language will see the text that exists)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('It reaches 6 founders.')
    const compose = screen.getByTestId('compose')
    const boxes = within(compose).getAllByRole('textbox')
    await user.type(boxes[0], 'Only English')
    await user.type(boxes[2], 'Body')
    expect(await within(compose).findByText('The Arabic text is empty: Arabic readers will see the English text.')).toBeInTheDocument()
  })

  it('coming from an opportunity ("Notify the founders") attaches it and starts with its title; the id travels to the server', async () => {
    const user = userEvent.setup()
    setup({ preview_notification_audience: { recipients: 3, without_account: 0, sample: [] } }, { opportunities: [{ opportunity_id: 'o1', title_en: 'Seed grant', title_ar: 'منحة', is_active: true, archived_at: null, apps: [{ count: 0 }] }] })
    renderPage('/alumni/admin/notifications?lang=en&opportunity=o1')
    expect(await screen.findByText(/About the opportunity: Seed grant/)).toBeInTheDocument()
    const compose = screen.getByTestId('compose')
    expect(within(compose).getAllByRole('textbox')[0]).toHaveValue('Seed grant')
    await user.type(within(compose).getAllByRole('textbox')[2], 'Apply by Friday')
    await screen.findByText('It reaches 3 founders.')
    await user.click(screen.getByTestId('send-notification'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send the notification' }))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_notification')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_notification')[0].args).toMatchObject({ p_opportunity: 'o1', p_title_en: 'Seed grant', p_body_en: 'Apply by Friday' })
  })

  it('the history shows who read what, and expands to the recipients with their read state', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByTestId('broadcast')
    expect(within(row).getByText('Welcome')).toBeInTheDocument()
    expect(within(row).getByText('3 of 4 read')).toBeInTheDocument()
    expect(within(row).getByText(/To: program Accelerator/)).toBeInTheDocument()
    expect(within(row).getByRole('progressbar', { name: '75% read' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Show the recipients' }))
    expect(await within(row).findByText('Sara Ali')).toBeInTheDocument()
    expect(within(row).getByText('read')).toBeInTheDocument()
    expect(within(row).getByText('not read yet')).toBeInTheDocument()
    expect(mock.tableCalls('notifications')[0].filters).toContainEqual(['eq', 'broadcast_id', 'b1'])
  })

  it('shows the Arabic UI', async () => {
    renderPage('/alumni/admin/notifications?lang=ar')
    expect(await screen.findByRole('heading', { name: 'الإشعارات' })).toBeInTheDocument()
    expect(await screen.findByText('يصل إلى 6 مؤسسين.')).toBeInTheDocument()
  })
})
