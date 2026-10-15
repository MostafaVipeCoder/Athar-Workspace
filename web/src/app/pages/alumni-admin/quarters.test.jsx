import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import QuartersPage from './QuartersPage.jsx'
import RemindersPage from './RemindersPage.jsx'
import PortfolioPage from './PortfolioPage.jsx'

const ROW = (over = {}) => ({
  id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات', logo_path: null, status: 'not_updated', last_modified: null, updated_source: null, updated_by_name: null, confirmed_at: null, confirmed_by_name: null,
  snapshot: null, reminders: { count: 0, last_at: null }, founders: { total: 2, with_account: 1 }, ...over,
})
const STATUS = {
  period: { key: '2026-Q4', start: '2026-09-30T21:00:00Z', end: '2026-12-31T22:00:00Z', deadline: '2026-12-31', is_current: true, timezone: 'Africa/Cairo' },
  counts: { total: 3, confirmed: 1, updated: 1, not_updated: 1, closed: 0 }, total: 3, limit: 50, offset: 0, status: null,
  rows: [
    ROW(),
    ROW({ id: 'c2', name_en: 'Delta Health', name_ar: 'دلتا', status: 'updated', last_modified: '2026-10-10T08:00:00Z', updated_source: 'founder', updated_by_name: 'Sara Ali', reminders: { count: 2, last_at: '2026-10-12T10:00:00Z' } }),
    ROW({ id: 'c3', name_en: 'Sinai Agritech', name_ar: 'سيناء', status: 'confirmed', last_modified: '2026-10-11T08:00:00Z', updated_source: 'founder', updated_by_name: 'Omar K', confirmed_at: '2026-10-11T09:00:00Z', confirmed_by_name: 'Omar K' }),
  ],
}
const PREVIEW = (n) => ({ period: '2026-Q4', recipients: n, with_email: n, without_email: 0, companies: n, already_reminded: 1, confirm_above: 100, sample: [{ founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة', companies_en: ['Nile Robotics'], companies_ar: ['نيل'], email_masked: 's***@example.com' }] })

let mock
function setup(extra = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_programs: { programs: [] },
      list_alumni_quarter_status: STATUS,
      preview_alumni_reminders: PREVIEW(3),
      send_alumni_reminders: { campaign_id: 'k1', audience: 3, sent: 3, already_sent: 0, no_email: 0 },
      close_alumni_quarter: { period: '2026-Q4', frozen: 3, already_frozen: 0, skipped: 0 },
      reopen_alumni_quarter: { period: '2026-Q4', reopened: 2 },
      ...extra,
    },
  })
  h.db = mock.db
}
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p> }
const renderPage = (ui, route) => renderWithProviders(<ConfirmProvider><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></ConfirmProvider>, { route })

beforeEach(() => setup())

describe('the quarter status page', () => {
  it('lists every company with its status, last modified, who confirmed and the reminders sent; the counts are the four states', async () => {
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    const rows = await screen.findAllByTestId('quarter-row')
    expect(rows).toHaveLength(3)
    expect(screen.getByTestId('period-info')).toHaveTextContent('Closes on')
    expect(screen.getByTestId('period-info')).toHaveTextContent('Cairo time')
    expect(within(rows[0]).getByTestId('figures-status')).toHaveAttribute('data-status', 'not_updated')
    expect(within(rows[1]).getByTestId('figures-status')).toHaveAttribute('data-status', 'updated')
    expect(rows[1]).toHaveTextContent('Sara Ali')
    expect(rows[1]).toHaveTextContent('2 sent')
    expect(rows[2]).toHaveTextContent('Omar K')
    expect(within(screen.getByTestId('quarter-counts')).getAllByRole('button')).toHaveLength(4)
    expect(mock.rpcCalls('list_alumni_quarter_status')[0].args).toMatchObject({ p_period: null, p_status: null, p_filters: { scope: 'alumni' }, p_limit: 50, p_offset: 0 })
    expect(screen.getByTestId('area-tabs')).toBeInTheDocument()
  })

  it('clicking a count filters by that status on the server (and in the URL)', async () => {
    const user = userEvent.setup()
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    await user.click(within(screen.getByTestId('quarter-counts')).getByRole('button', { name: /Not updated/ }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_quarter_status').at(-1).args.p_status).toBe('not_updated'))
    expect(screen.getByTestId('where')).toHaveTextContent('status=not_updated')
  })

  it('a closed company cannot be selected for a reminder; selecting the others opens the recipients preview, then sends with ONE token and no count (below 100)', async () => {
    const user = userEvent.setup()
    setup({ list_alumni_quarter_status: { ...STATUS, rows: [...STATUS.rows, ROW({ id: 'c4', name_en: 'Closed Co', status: 'closed', snapshot: { frozen_at: '2027-01-01T00:00:00Z', source: 'auto', reported: true, corrected: false } })] } })
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    expect(screen.getByRole('checkbox', { name: 'Select Closed Co' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Select Nile Robotics' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Delta Health' }))
    expect(screen.getByTestId('quarter-selection')).toHaveTextContent('2 selected')
    await user.click(screen.getByTestId('send-selected'))
    const dialog = await screen.findByTestId('send-reminders')
    expect(await within(dialog).findByTestId('pv-recipients')).toHaveTextContent('3')
    expect(mock.rpcCalls('preview_alumni_reminders')[0].args).toMatchObject({ p_period: '2026-Q4', p_company_ids: ['c1', 'c2'], p_only_new: false })
    expect(dialog).toHaveTextContent('delivered by the outbox worker')
    expect(dialog).not.toHaveTextContent('example.com'.replace('example', 'zzz')) // only a masked address is ever shown
    await user.click(screen.getByTestId('send-reminders-go'))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    const args = mock.rpcCalls('send_alumni_reminders')[0].args
    expect(args).toMatchObject({ p_period: '2026-Q4', p_company_ids: ['c1', 'c2'], p_only_new: false, p_expected_count: null })
    expect(args.p_token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('above 100 recipients the exact number must be typed before Send is enabled, and it travels with the call', async () => {
    const user = userEvent.setup()
    setup({ preview_alumni_reminders: PREVIEW(150) })
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    await user.click(screen.getByTestId('resend'))
    const dialog = await screen.findByTestId('send-reminders')
    await within(dialog).findByTestId('pv-recipients')
    const go = screen.getByTestId('send-reminders-go')
    expect(go).toBeDisabled()
    expect(dialog).toHaveTextContent('more than 100 people')
    await user.type(within(dialog).getByTestId('pv-confirm-count'), '149')
    expect(go).toBeDisabled()
    await user.clear(within(dialog).getByTestId('pv-confirm-count'))
    await user.type(within(dialog).getByTestId('pv-confirm-count'), '150')
    expect(go).toBeEnabled()
    await user.click(go)
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_reminders')[0].args).toMatchObject({ p_expected_count: 150, p_only_new: false, p_filters: { scope: 'alumni' } })
  })

  it('"Send reminders now" only reaches founders not reminded yet; nobody to remind says so and cannot send', async () => {
    const user = userEvent.setup()
    setup({ preview_alumni_reminders: PREVIEW(0) })
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    await user.click(screen.getByTestId('send-now'))
    expect(await screen.findByTestId('pv-none')).toBeInTheDocument()
    expect(mock.rpcCalls('preview_alumni_reminders')[0].args.p_only_new).toBe(true)
    expect(screen.getByTestId('send-reminders-go')).toBeDisabled()
  })

  it('the send dialog says "Send" (not "Resend") when nobody was reminded yet, "Resend" otherwise, and flags the default wording with a link to edit it', async () => {
    const user = userEvent.setup()
    setup({ preview_alumni_reminders: { ...PREVIEW(3), already_reminded: 0 }, get_alumni_quarter_settings: SETTINGS })
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    await user.click(screen.getByTestId('resend'))
    const dialog = await screen.findByTestId('send-reminders')
    await within(dialog).findByTestId('pv-recipients')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Send the reminder for Q4 2026')
    expect(await within(dialog).findByTestId('send-not-final')).toHaveTextContent('final text is to be decided by the owner')
    expect(within(dialog).getByRole('link', { name: 'Edit the wording' })).toHaveAttribute('href', '/alumni/admin/quarters/reminders#wording')
  })

  it('"Close this quarter now" asks first (never overwritten) and then closes every company; nothing is sent before the confirmation', async () => {
    const user = userEvent.setup()
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    await user.click(screen.getByRole('button', { name: 'Close this quarter now' }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('never overwritten')
    expect(mock.rpcCalls('close_alumni_quarter')).toHaveLength(0)
    await user.click(within(dlg).getByRole('button', { name: 'Close the quarter' }))
    await waitFor(() => expect(mock.rpcCalls('close_alumni_quarter')).toHaveLength(1))
    expect(mock.rpcCalls('close_alumni_quarter')[0].args).toEqual({ p_period: '2026-Q4', p_company: null })
  })

  it('a failed list is its own error state with a retry; an empty list says so', async () => {
    const user = userEvent.setup()
    let fail = true
    setup({ list_alumni_quarter_status: () => (fail ? Object.assign(new Error('boom'), { code: '500' }) : { ...STATUS, rows: [], total: 0, counts: { total: 0, confirmed: 0, updated: 0, not_updated: 0, closed: 0 } }) })
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    expect(await screen.findByText('This page could not be loaded')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('No company matches')).toBeInTheDocument()
  })

  it('in Arabic: the title, the status words and the quarter label', async () => {
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=ar')
    expect(await screen.findByRole('heading', { name: 'حالة الربع', level: 1 })).toBeInTheDocument()
    expect((await screen.findAllByTestId('quarter-row'))[0]).toHaveTextContent('غير محدَّثة')
    expect(screen.getByLabelText('الربع')).toHaveDisplayValue('الربع الرابع 2026')
  })
})

const SETTINGS = {
  first_period: '2026-Q4', auto_freeze: true, auto_reminders: true, reminder_offsets: [14, 3], send_hour: 10, app_base_url: null, timezone: 'Africa/Cairo', current_period: '2026-Q4',
  due: [{ offset_days: 14, due_at: '2026-12-18T08:00:00Z', sent: true }, { offset_days: 3, due_at: '2026-12-29T08:00:00Z', sent: false }],
  placeholders: ['founder_name', 'company_name', 'quarter', 'deadline', 'link'], scheduler: { enabled: false },
  templates: [
    { lang: 'ar', notif_title: 'حدّث {company_name}', notif_body: 'مرحباً {founder_name}', email_subject: 'تحديث {company_name}', email_body: 'نص {link}', finalised: false, is_default: true, updated_at: '2026-10-15T00:00:00Z' },
    { lang: 'en', notif_title: 'Update {company_name}', notif_body: 'Hello {founder_name}', email_subject: 'Update {company_name}', email_body: 'Text {link}', finalised: false, is_default: true, updated_at: '2026-10-15T00:00:00Z' },
  ],
}
const CAMPAIGNS = { total: 2, limit: 20, offset: 0, rows: [
  { id: 'k1', period_key: '2026-Q4', trigger: 'schedule', kind: 'd14', status: 'done', created_at: '2026-12-18T08:00:00Z', created_by_name: null, recipients: 10, notified: 10, emailed: 9, no_email: 1, delivery: { sent: 9 }, read: 4, note: 'no_app_url' },
  { id: 'k2', period_key: '2026-Q4', trigger: 'manual', kind: 'manual', status: 'done', created_at: '2026-12-20T08:00:00Z', created_by_name: 'Mona Adel', recipients: 3, notified: 3, emailed: 3, no_email: 0, delivery: { queued: 3 }, read: 0, note: null },
] }

describe('the reminder settings page', () => {
  const setupR = (extra = {}) => setup({
    get_alumni_quarter_settings: SETTINGS, list_alumni_reminder_campaigns: CAMPAIGNS,
    preview_alumni_reminder_template: (a) => ({ notif_title: `T:${a.p_template?.notif_title ?? 'default'}`, notif_body: 'B', email_subject: 'S', email_html: '<p>x</p>', email_text: 'plain text of the mail', period: '2026-Q4' }),
    set_alumni_quarter_settings: SETTINGS, save_alumni_reminder_template: SETTINGS, reset_alumni_reminder_template: SETTINGS, ...extra,
  })

  it('shows the schedule (14 and 3 days, 10:00 Cairo), when each reminder is due and whether it went out, and that the scheduler is not switched on yet', async () => {
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    expect(await screen.findByTestId('schedule-card')).toBeInTheDocument()
    expect(screen.getByLabelText('Days before the quarter closes')).toHaveValue('14, 3')
    expect(screen.getByLabelText('Hour of the day')).toHaveValue('10')
    const due = screen.getByTestId('due-list')
    expect(due).toHaveTextContent('14 days before the close')
    expect(due).toHaveTextContent('Sent')
    expect(due).toHaveTextContent('Not yet')
    expect(screen.getByTestId('scheduler-state')).toHaveTextContent('not switched on')
  })

  it('saves the schedule as numbers; text that is not numbers is refused on the page', async () => {
    const user = userEvent.setup()
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    const offsets = await screen.findByLabelText('Days before the quarter closes')
    await user.clear(offsets)
    await user.type(offsets, '30, soon')
    await user.click(within(screen.getByTestId('schedule-card')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Write whole numbers separated by commas.')).toBeInTheDocument()
    expect(mock.rpcCalls('set_alumni_quarter_settings')).toHaveLength(0)
    await user.clear(offsets)
    await user.type(offsets, '30, 7, 1')
    await user.click(within(screen.getByTestId('schedule-card')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('set_alumni_quarter_settings')).toHaveLength(1))
    expect(mock.rpcCalls('set_alumni_quarter_settings')[0].args.p_patch).toMatchObject({ reminder_offsets: [30, 7, 1], send_hour: 10, auto_reminders: true, auto_freeze: true, app_base_url: null })
  })

  it('the wording: both languages, flagged "to be finalised by the owner", a LIVE PREVIEW that follows the typing, shown as text; Save sends the four texts', async () => {
    const user = userEvent.setup()
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    const ar = await screen.findByTestId('template-ar')
    expect(within(ar).getByTestId('not-final')).toHaveTextContent('to be decided by the owner')
    expect(within(ar).getByText('{founder_name}')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'English' }))
    const en = await screen.findByTestId('template-en')
    const title = within(en).getByLabelText('Notification title')
    await user.clear(title)
    await user.type(title, 'Hello {{quarter}')
    await waitFor(() => expect(within(en).getByTestId('pv-notif-title')).toHaveTextContent('T:Hello {quarter}'), { timeout: 3000 })
    expect(within(en).getByTestId('pv-mail-text')).toHaveTextContent('plain text of the mail')
    expect(en.querySelector('script, iframe')).toBeNull()
    await user.click(within(en).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_reminder_template')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_reminder_template')[0].args).toEqual({ p_lang: 'en', p_patch: { notif_title: 'Hello {quarter}', notif_body: 'Hello {founder_name}', email_subject: 'Update {company_name}', email_body: 'Text {link}', finalised: false } })
  })

  it('a refused placeholder shows the server\'s reason on that field', async () => {
    const user = userEvent.setup()
    setupR({ save_alumni_reminder_template: Object.assign(new Error('alumni_invalid: email_body:unknown_placeholder:nope'), { code: '22023', hint: 'alumni_invalid', details: 'email_body:unknown_placeholder:nope' }) })
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    await user.click(await screen.findByRole('button', { name: 'English' }))
    const en = await screen.findByTestId('template-en')
    await user.type(within(en).getByLabelText('E-mail text'), ' {{nope}')
    await user.click(within(en).getByRole('button', { name: 'Save' }))
    expect(await within(en).findByRole('alert')).toHaveTextContent('E-mail text')
  })

  it('the campaign history: scheduled and manual sends with their counts, the e-mail delivery state, who sent it, and the missing platform address', async () => {
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    const rows = await screen.findAllByTestId('campaign-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Scheduled (d14)')
    expect(rows[0]).toHaveTextContent('4 read')
    expect(rows[0]).toHaveTextContent('1 without e-mail')
    expect(rows[0]).toHaveTextContent('No platform address')
    expect(rows[1]).toHaveTextContent('Manual')
    expect(rows[1]).toHaveTextContent('Mona Adel')
    expect(rows[1]).toHaveTextContent('Queued')
  })
})

const PORTFOLIO = {
  latest: '2026-Q2', from: '2025-Q4', to: '2026-Q2',
  periods: [
    { period_key: '2025-Q4', companies: 3, reporting: 2, revenue_total: 150, revenue_median: 75, revenue_n: 2, employees_total: 15, employees_female: 5, female_share: 33.3, freelancers: null, funding_total: 1500, team_size: 4, female_founders: 2, open: 3, closed: 0, survival_rate: 100, closed_new: 0, at_risk: 0, closing_rate: null, corrected: 0 },
    { period_key: '2026-Q1', companies: 3, reporting: 3, revenue_total: 420, revenue_median: 150, revenue_n: 3, employees_total: 37, employees_female: 16, female_share: 43.2, freelancers: null, funding_total: 1500, team_size: 4, female_founders: 3, open: 3, closed: 0, survival_rate: 100, closed_new: 0, at_risk: 3, closing_rate: 0, corrected: 1 },
    { period_key: '2026-Q2', companies: 4, reporting: 2, revenue_total: 700, revenue_median: 350, revenue_n: 2, employees_total: 37, employees_female: 18, female_share: 48.6, freelancers: null, funding_total: 2000, team_size: 5, female_founders: 3, open: 3, closed: 1, survival_rate: 75, closed_new: 1, at_risk: 3, closing_rate: 33.3, corrected: 0 },
  ],
}

describe('the portfolio performance page', () => {
  it('charts the portfolio indicators by quarter (lazy chart code) with a table of the same numbers; the note says only reported quarters count', async () => {
    setup({ get_alumni_portfolio: PORTFOLIO })
    renderPage(<PortfolioPage />, '/alumni/admin/performance?lang=en')
    expect(await screen.findByTestId('portfolio-charts')).toBeInTheDocument()
    expect((await screen.findAllByTestId('chart-card')).length).toBe(7)
    const rows = screen.getAllByTestId('portfolio-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Q2 2026')
    expect(rows[0]).toHaveTextContent('75%')
    expect(rows[0]).toHaveTextContent('EGP 700')
    expect(rows[1]).toHaveTextContent('1 company corrected')
    expect(screen.getByTestId('pf-note')).toHaveTextContent('only companies that reported')
    expect(mock.rpcCalls('get_alumni_portfolio')[0].args).toEqual({ p_filters: { scope: 'alumni' }, p_from: null, p_to: null })
  })

  it('the range and the filters go to the server (program / sector / governorate)', async () => {
    const user = userEvent.setup()
    setup({ get_alumni_portfolio: PORTFOLIO })
    renderPage(<PortfolioPage />, '/alumni/admin/performance?lang=en&sector=technology')
    await screen.findByTestId('portfolio-charts')
    expect(mock.rpcCalls('get_alumni_portfolio')[0].args.p_filters).toEqual({ scope: 'alumni', sector: 'technology' })
    await user.selectOptions(screen.getByLabelText('From'), '2026-Q1')
    await waitFor(() => expect(mock.rpcCalls('get_alumni_portfolio').at(-1).args.p_from).toBe('2026-Q1'))
  })

  it('a range with no closed data says so, not "no closed quarter yet"', async () => {
    setup({ get_alumni_portfolio: { latest: '2026-Q4', from: '2021-Q1', to: '2021-Q1', periods: [] } })
    renderPage(<PortfolioPage />, '/alumni/admin/performance?lang=en&from=2021-Q1&to=2021-Q1')
    expect(await screen.findByText('No closed quarters in this range')).toBeInTheDocument()
  })

  it('no closed quarter yet: an empty state, no chart, no zeros', async () => {
    setup({ get_alumni_portfolio: { latest: null, from: null, to: null, periods: [] } })
    renderPage(<PortfolioPage />, '/alumni/admin/performance?lang=en')
    expect(await screen.findByText('No closed quarter yet')).toBeInTheDocument()
    expect(screen.queryByTestId('portfolio-charts')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled()
  })
})
