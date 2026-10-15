import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null, exported: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))
vi.mock('../../../lib/export/xlsx.js', () => ({ exportRows: vi.fn(async (rows, cols, name) => { h.exported = { rows, cols, name } }) }))

import ClosedFollowupPage from './ClosedFollowupPage.jsx'
import QuartersPage from './QuartersPage.jsx'
import RemindersPage from './RemindersPage.jsx'
import AreaTabs from './AreaTabs.jsx'

const ROW = (over = {}) => ({
  id: 'c1', name_en: 'Nile Pay Old', name_ar: 'نايل باي القديمة', logo_path: null, closed_on: '2026-03-01', closing_reason: 'funding', founder: { name_en: 'Sara Ali', name_ar: 'سارة علي', with_account: 1 },
  answer: null, reminders: { count: 0, last_at: null }, ...over,
})
const VENTURE = { answer_type: 'new_startup', venture_name: 'Nile Pay 2', field: 'technology', venture_stage: 'mvp', venture_url: 'https://nilepay2.example', venture_description: 'Payments for farms', wants_programs: true, employer: null, job_title: null, other_text: null, answered_at: '2026-10-10T08:00:00Z', answered_source: 'founder' }
const JOB = { answer_type: 'employed', venture_name: null, field: 'healthcare', venture_stage: null, venture_url: null, venture_description: null, wants_programs: false, employer: 'ACME Health', job_title: 'Data analyst', other_text: null, answered_at: '2026-10-11T08:00:00Z', answered_source: 'manager' }
const LIST = {
  current_period: '2026-Q4', counts: { total: 3, answered: 2, not_answered: 1, new_startup: 1, employed: 1, other: 0, interested: 1 }, total: 3, limit: 50, offset: 0,
  rows: [
    ROW({ answer: VENTURE, reminders: { count: 2, last_at: '2026-10-12T10:00:00Z' } }),
    ROW({ id: 'c2', name_en: 'Delta Care', name_ar: 'دلتا كير', answer: JOB }),
    ROW({ id: 'c3', name_en: 'Giza Foods', name_ar: 'جيزة', closed_on: null, founder: { name_en: 'Omar K', name_ar: 'عمر', with_account: 0 } }),
  ],
}
const PREVIEW_ONE = { recipients: 0, with_email: 0, without_email: 0, companies: 0, already_reminded: 0, sample: [] }
const PREVIEW_BOTH = {
  period: '2026-Q4', recipients: 2, with_email: 2, without_email: 0, companies: 2, already_reminded: 1, confirm_above: 100, total: 5,
  sample: [{ founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة', companies_en: ['Active Co'], companies_ar: ['نشطة'], email_masked: 's***@example.org' }],
  closed: { recipients: 3, with_email: 2, without_email: 1, companies: 3, already_reminded: 0, sample: [{ founder_id: 'f9', name_en: 'Omar K', name_ar: 'عمر', companies_en: ['Giza Foods'], companies_ar: ['جيزة'], email_masked: 'o***@example.org' }] },
}

let mock
function setup(extra = {}) {
  h.exported = null
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_programs: { programs: [] },
      list_alumni_closed_followups: LIST,
      preview_alumni_reminders: { ...PREVIEW_ONE, period: '2026-Q4', confirm_above: 100, total: 3, closed: { ...PREVIEW_ONE, recipients: 3, with_email: 3, already_reminded: 0 } },
      send_alumni_reminders: { campaign_id: 'k1', audience: 3, sent: 3, already_sent: 0, no_email: 0 },
      get_alumni_quarter_settings: SETTINGS,
      ...extra,
    },
  })
  h.db = mock.db
}
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p> }
const renderPage = (ui, route) => renderWithProviders(<ConfirmProvider><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></ConfirmProvider>, { route })

const SETTINGS = {
  first_period: '2026-Q4', auto_freeze: true, auto_reminders: true, reminder_offsets: [14, 3], send_hour: 10, app_base_url: 'https://athar.example', timezone: 'Africa/Cairo', current_period: '2026-Q4', due: [],
  placeholders: ['founder_name', 'company_name', 'quarter', 'deadline', 'link'], closed_placeholders: ['founder_name', 'company_name', 'quarter', 'link'], scheduler: { enabled: false },
  templates: [
    { lang: 'ar', variant: 'figures', notif_title: 'حدّث {company_name}', notif_body: 'مرحباً {founder_name}', email_subject: 'تحديث {company_name}', email_body: 'نص {link}', finalised: true, is_default: false, updated_at: '2026-10-15T00:00:00Z' },
    { lang: 'en', variant: 'figures', notif_title: 'Update {company_name}', notif_body: 'Hello {founder_name}', email_subject: 'Update {company_name}', email_body: 'Text {link}', finalised: true, is_default: false, updated_at: '2026-10-15T00:00:00Z' },
  ],
  closed_templates: [
    { lang: 'ar', variant: 'closed', notif_title: 'ما أخبارك بعد {company_name}؟', notif_body: 'مرحباً {founder_name}', email_subject: 'ماذا تفعل الآن؟', email_body: 'ادخل {link}', finalised: false, is_default: true, updated_at: '2026-10-15T00:00:00Z' },
    { lang: 'en', variant: 'closed', notif_title: 'How are you after {company_name}?', notif_body: 'Hello {founder_name}', email_subject: 'What are you doing now?', email_body: 'Open {link}', finalised: false, is_default: true, updated_at: '2026-10-15T00:00:00Z' },
  ],
}

beforeEach(() => setup())

describe('the closed companies follow-up page', () => {
  it('lists the closed companies with the latest answer: type, venture / employer, field, interest in programs, answered date and who entered it', async () => {
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    const rows = await screen.findAllByTestId('closed-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Nile Pay Old')
    expect(rows[0]).toHaveTextContent('Working on a new venture')
    expect(rows[0]).toHaveTextContent('Nile Pay 2')
    expect(rows[0]).toHaveTextContent('Technology')
    expect(rows[0]).toHaveTextContent('MVP')
    expect(rows[0]).toHaveTextContent('Interested')
    expect(rows[0]).toHaveTextContent('2 sent')
    expect(within(rows[0]).getByRole('link', { name: /nilepay2.example/ })).toHaveAttribute('href', 'https://nilepay2.example')
    expect(within(rows[0]).getByRole('link', { name: /nilepay2.example/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(rows[1]).toHaveTextContent('Employed')
    expect(rows[1]).toHaveTextContent('ACME Health')
    expect(rows[1]).toHaveTextContent('Data analyst')
    expect(rows[1]).toHaveTextContent('Healthcare')
    expect(rows[1]).toHaveTextContent('by the team')
    expect(rows[2]).toHaveAttribute('data-answered', 'no')
    expect(rows[2]).toHaveTextContent('Not answered yet')
    expect(rows[2]).toHaveTextContent('No account yet')
    expect(mock.rpcCalls('list_alumni_closed_followups')[0].args).toEqual({ p_filters: { scope: 'alumni' }, p_status: null, p_type: null, p_interested: null, p_limit: 50, p_offset: 0, p_sort: 'name', p_dir: 'asc' })
    expect(screen.getByTestId('area-tabs')).toBeInTheDocument()
  })

  it('a web address that is not http(s) is never turned into a link', async () => {
    setup({ list_alumni_closed_followups: { ...LIST, rows: [ROW({ answer: { ...VENTURE, venture_url: 'javascript:alert(1)' } })] } })
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    const row = await screen.findByTestId('closed-row')
    expect(within(row).queryByRole('link', { name: /alert/ })).toBeNull()
    expect(row.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('the counts are filters sent to the server and kept in the URL: "Not answered yet", a type, interested in programs', async () => {
    const user = userEvent.setup()
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    await screen.findAllByTestId('closed-row')
    expect(within(screen.getByTestId('closed-counts')).getAllByRole('button')).toHaveLength(7)
    await user.click(screen.getByTestId('count-not_answered'))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_status: 'not_answered', p_type: null, p_interested: null, p_offset: 0 }))
    expect(screen.getByTestId('where')).toHaveTextContent('status=not_answered')
    await user.click(screen.getByTestId('count-employed'))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_status: null, p_type: 'employed' }))
    await user.click(screen.getByTestId('count-interested'))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_status: null, p_type: null, p_interested: true }))
    expect(screen.getByTestId('where')).toHaveTextContent('interested=true')
    // a second tap on the active tile clears it
    await user.click(screen.getByTestId('count-interested'))
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('interested'))
    expect(screen.getByTestId('count-interested')).toHaveAttribute('aria-pressed', 'false')
  })

  it('the select filters (answer, what they do now, interested) reach the server too', async () => {
    const user = userEvent.setup()
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en&type=new_startup&interested=false&status=answered')
    await screen.findAllByTestId('closed-row')
    expect(mock.rpcCalls('list_alumni_closed_followups')[0].args).toMatchObject({ p_status: 'answered', p_type: 'new_startup', p_interested: false })
    await user.selectOptions(screen.getByLabelText('Answer'), 'not_answered')
    await waitFor(() => expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_status: 'not_answered', p_type: 'new_startup' }))
  })

  it('sorting by the answered date flips the direction (own URL keys)', async () => {
    const user = userEvent.setup()
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    await screen.findAllByTestId('closed-row')
    await user.click(screen.getByRole('button', { name: 'Answered on' }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_sort: 'answered', p_dir: 'asc' }))
    await user.click(screen.getByRole('button', { name: /Answered on/ }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_sort: 'answered', p_dir: 'desc' }))
    expect(screen.getByTestId('where')).toHaveTextContent('csort=answered')
  })

  it('exports every filtered row to Excel with the answer columns', async () => {
    const user = userEvent.setup()
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    await screen.findAllByTestId('closed-row')
    await user.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() => expect(h.exported).not.toBeNull())
    expect(h.exported.name).toBe('closed-companies-followup.xlsx')
    expect(h.exported.rows).toHaveLength(3)
    expect(h.exported.cols.map((c) => c.header)).toEqual(['Company', 'Closed on', 'Founder', 'Answer', 'New venture', 'Field / industry', 'Stage', 'Link', 'Description', 'Interested in programs', 'Employer', 'Role', 'Other', 'Answered on', 'Entered by', 'Reminders sent'])
    const line = (r) => h.exported.cols.map((c) => c.key(r))
    expect(line(LIST.rows[0])).toEqual(['Nile Pay Old', '2026-03-01', 'Sara Ali', 'Working on a new venture', 'Nile Pay 2', 'Technology', 'MVP', 'https://nilepay2.example', 'Payments for farms', 'Yes', null, null, null, '2026-10-10T08:00:00Z', 'by the founder', 2])
    expect(line(LIST.rows[1])).toEqual(['Delta Care', '2026-03-01', 'Sara Ali', 'Employed', null, 'Healthcare', '', '', null, '', 'ACME Health', 'Data analyst', null, '2026-10-11T08:00:00Z', 'by the team', 0])
    expect(line(LIST.rows[2])[3]).toBe('Not answered yet')
    expect(mock.rpcCalls('list_alumni_closed_followups').at(-1).args).toMatchObject({ p_limit: 500, p_offset: 0 })
  })

  it('"Remind these founders" opens the send dialog for the CLOSED audience only', async () => {
    const user = userEvent.setup()
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    await screen.findAllByTestId('closed-row')
    await user.click(screen.getByTestId('remind-closed'))
    const dialog = await screen.findByTestId('send-reminders')
    expect(await within(dialog).findByTestId('pv-closed-recipients')).toHaveTextContent('3')
    expect(within(dialog).queryByTestId('pv-figures')).toBeNull()
    expect(mock.rpcCalls('preview_alumni_reminders')[0].args).toMatchObject({ p_period: '2026-Q4', p_audience: 'closed', p_filters: { scope: 'alumni' } })
    await user.click(screen.getByTestId('send-reminders-go'))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_reminders')[0].args).toMatchObject({ p_audience: 'closed', p_expected_count: null })
  })

  it('an empty list and a failed list have their own states', async () => {
    setup({ list_alumni_closed_followups: { ...LIST, rows: [], total: 0, counts: { ...LIST.counts, total: 0 } } })
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=en')
    expect(await screen.findByText('No closed company matches')).toBeInTheDocument()
  })

  it('renders in Arabic (RTL wording) with the answer labels in Arabic', async () => {
    renderPage(<ClosedFollowupPage />, '/alumni/admin/closed?lang=ar')
    expect(await screen.findByRole('heading', { name: 'متابعة الشركات المُغلقة', level: 1 })).toBeInTheDocument()
    const rows = await screen.findAllByTestId('closed-row')
    expect(rows[0]).toHaveTextContent('أعمل على مشروع جديد')
    expect(rows[2]).toHaveTextContent('لم يجب بعد')
  })
})

describe('the tabs of the registry', () => {
  it('has the closed follow-up next to the quarter status', () => {
    renderPage(<AreaTabs />, '/alumni/admin/closed?lang=en')
    const tabs = screen.getByTestId('area-tabs')
    expect(within(tabs).getByRole('link', { name: 'Closed follow-up' })).toHaveAttribute('href', '/alumni/admin/closed')
  })
})

describe('the send dialog shows the two audiences separately', () => {
  const STATUS = {
    period: { key: '2026-Q4', start: '2026-09-30T21:00:00Z', end: '2026-12-31T22:00:00Z', deadline: '2026-12-31', is_current: true, timezone: 'Africa/Cairo' },
    counts: { total: 1, confirmed: 0, updated: 0, not_updated: 1, closed: 0 }, total: 1, limit: 50, offset: 0, status: null,
    rows: [{ id: 'c1', name_en: 'Active Co', name_ar: 'نشطة', logo_path: null, status: 'not_updated', last_modified: null, updated_source: null, updated_by_name: null, confirmed_at: null, confirmed_by_name: null, snapshot: null, reminders: { count: 0, last_at: null }, founders: { total: 1, with_account: 1 } }],
  }
  const open = async (user, extra = {}) => {
    setup({ list_alumni_quarter_status: STATUS, preview_alumni_reminders: PREVIEW_BOTH, ...extra })
    renderPage(<QuartersPage />, '/alumni/admin/quarters?lang=en')
    await screen.findAllByTestId('quarter-row')
    await user.click(screen.getByTestId('resend'))
    return screen.findByTestId('send-reminders')
  }

  it('active companies and closed companies each have their own counts, sample and wording; the total is shown', async () => {
    const user = userEvent.setup()
    const dialog = await open(user)
    const fig = await within(dialog).findByTestId('pv-figures')
    const cls = within(dialog).getByTestId('pv-closed')
    expect(within(fig).getByTestId('pv-recipients')).toHaveTextContent('2')
    expect(within(fig).getByTestId('pv-already')).toHaveTextContent('1')
    expect(within(cls).getByTestId('pv-closed-recipients')).toHaveTextContent('3')
    expect(within(cls).getByTestId('pv-closed-withEmail')).toHaveTextContent('2')
    expect(fig).toHaveTextContent('Active Co')
    expect(cls).toHaveTextContent('Giza Foods')
    expect(within(dialog).getByTestId('pv-total')).toHaveTextContent('Total to send: 5')
    expect(mock.rpcCalls('preview_alumni_reminders')[0].args).not.toHaveProperty('p_audience')
  })

  it('both audiences are sent by default (no audience argument); the closed one can be left out, then only the figures reminder goes', async () => {
    const user = userEvent.setup()
    const dialog = await open(user)
    await within(dialog).findByTestId('pv-figures')
    await user.click(screen.getByTestId('send-reminders-go'))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_reminders')[0].args).not.toHaveProperty('p_audience')
  })

  it('leaving the closed audience out sends audience=figures with its own count; leaving both out disables Send', async () => {
    const user = userEvent.setup()
    const dialog = await open(user)
    await within(dialog).findByTestId('pv-figures')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send to Closed companies' }))
    expect(screen.getByTestId('send-reminders-go')).toBeEnabled()
    await user.click(screen.getByTestId('send-reminders-go'))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_reminders')[0].args).toMatchObject({ p_audience: 'figures' })
  })

  it('only the closed audience: audience=closed; both switched off: nothing to send', async () => {
    const user = userEvent.setup()
    const dialog = await open(user)
    await within(dialog).findByTestId('pv-figures')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send to Active companies' }))
    await user.click(screen.getByTestId('send-reminders-go'))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_reminders')[0].args).toMatchObject({ p_audience: 'closed' })
  })

  it('the confirmation above 100 counts BOTH audiences', async () => {
    const user = userEvent.setup()
    const dialog = await open(user, { preview_alumni_reminders: { ...PREVIEW_BOTH, recipients: 60, closed: { ...PREVIEW_BOTH.closed, recipients: 50 }, total: 110 } })
    await within(dialog).findByTestId('pv-figures')
    expect(screen.getByTestId('send-reminders-go')).toBeDisabled()
    await user.type(within(dialog).getByTestId('pv-confirm-count'), '110')
    expect(screen.getByTestId('send-reminders-go')).toBeEnabled()
    await user.click(screen.getByTestId('send-reminders-go'))
    await waitFor(() => expect(mock.rpcCalls('send_alumni_reminders')).toHaveLength(1))
    expect(mock.rpcCalls('send_alumni_reminders')[0].args).toMatchObject({ p_expected_count: 110 })
  })

  it('warns while the wording of the audience being sent is not final (the closed templates are flagged)', async () => {
    const user = userEvent.setup()
    const dialog = await open(user)
    expect(await within(dialog).findByTestId('send-not-final')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send to Closed companies' }))
    await waitFor(() => expect(within(dialog).queryByTestId('send-not-final')).toBeNull())
  })

  it('without closed companies in the answer (the old shape) it behaves as before: one audience, no extra heading', async () => {
    const user = userEvent.setup()
    const dialog = await open(user, { preview_alumni_reminders: { period: '2026-Q4', recipients: 3, with_email: 3, without_email: 0, companies: 3, already_reminded: 1, confirm_above: 100, sample: [] } })
    await within(dialog).findByTestId('pv-recipients')
    expect(within(dialog).queryByTestId('pv-closed')).toBeNull()
    expect(within(dialog).queryByTestId('pv-total')).toBeNull()
  })
})

describe('the reminder wording page has the closed wording next to the active-company one', () => {
  const setupR = (extra = {}) => setup({
    list_alumni_reminder_campaigns: { total: 1, limit: 20, offset: 0, rows: [{ id: 'k1', period_key: '2026-Q4', trigger: 'manual', kind: 'manual', status: 'done', created_at: '2026-12-20T08:00:00Z', created_by_name: 'Mona Adel', recipients: 8, closed_recipients: 5, notified: 8, emailed: 8, no_email: 0, delivery: { queued: 8 }, read: 0, note: null }] },
    preview_alumni_reminder_template: (a) => ({ notif_title: `T:${a.p_variant ?? 'figures'}:${a.p_template?.notif_title ?? 'default'}`, notif_body: 'B', email_subject: 'S', email_html: '<p>x</p>', email_text: 'plain text of the mail', period: '2026-Q4' }),
    save_alumni_reminder_template: SETTINGS, reset_alumni_reminder_template: SETTINGS, ...extra,
  })

  it('switches between the two wordings; the closed one has its own placeholders (no deadline), its own note and the "to be finalised" flag', async () => {
    const user = userEvent.setup()
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    const first = await screen.findByTestId('template-ar')
    expect(first).toHaveAttribute('data-variant', 'figures')
    expect(within(first).getByText('{deadline}')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Closed companies: what are you doing now?' }))
    const closed = await screen.findByTestId('template-ar')
    await waitFor(() => expect(closed).toHaveAttribute('data-variant', 'closed'))
    expect(within(closed).queryByText('{deadline}')).toBeNull()
    expect(within(closed).getByText('{link}')).toBeInTheDocument()
    expect(within(closed).getByTestId('variant-note')).toHaveTextContent('CLOSED companies')
    expect(within(closed).getByTestId('not-final')).toBeInTheDocument()
    await waitFor(() => expect(mock.rpcCalls('preview_alumni_reminder_template').at(-1).args).toMatchObject({ p_lang: 'ar', p_variant: 'closed' }))
  })

  it('saves the closed wording with its variant (the active wording never sends one)', async () => {
    const user = userEvent.setup()
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    await screen.findByTestId('template-ar')
    await user.click(screen.getByRole('button', { name: 'Closed companies: what are you doing now?' }))
    await user.click(screen.getByRole('button', { name: 'English' }))
    const en = await waitFor(() => { const el = screen.getByTestId('template-en'); expect(el).toHaveAttribute('data-variant', 'closed'); return el })
    const title = within(en).getByLabelText('Notification title')
    await user.clear(title)
    await user.type(title, 'Hello {{company_name}')
    await user.click(within(en).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_reminder_template')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_reminder_template')[0].args).toMatchObject({ p_lang: 'en', p_variant: 'closed', p_patch: { notif_title: 'Hello {company_name}', finalised: false } })
  })

  it('reset of the closed wording sends its variant', async () => {
    const user = userEvent.setup()
    setupR({ get_alumni_quarter_settings: { ...SETTINGS, closed_templates: SETTINGS.closed_templates.map((x) => ({ ...x, is_default: false })) } })
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    await screen.findByTestId('template-ar')
    await user.click(screen.getByRole('button', { name: 'Closed companies: what are you doing now?' }))
    const closed = await waitFor(() => { const el = screen.getByTestId('template-ar'); expect(el).toHaveAttribute('data-variant', 'closed'); return el })
    await user.click(within(closed).getByRole('button', { name: 'Restore default' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore default' }))
    await waitFor(() => expect(mock.rpcCalls('reset_alumni_reminder_template')).toHaveLength(1))
    expect(mock.rpcCalls('reset_alumni_reminder_template')[0].args).toEqual({ p_lang: 'ar', p_variant: 'closed' })
  })

  it('the campaign history shows how many of the recipients were closed companies', async () => {
    setupR()
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    const rows = await screen.findAllByTestId('campaign-row')
    expect(rows[0]).toHaveTextContent('closed companies: 5')
  })

  it('without the closed templates in the answer (an older server) there is no switch', async () => {
    setupR({ get_alumni_quarter_settings: { ...SETTINGS, closed_templates: undefined, closed_placeholders: undefined } })
    renderPage(<RemindersPage />, '/alumni/admin/quarters/reminders?lang=en')
    await screen.findByTestId('template-ar')
    expect(screen.queryByRole('button', { name: 'Closed companies: what are you doing now?' })).toBeNull()
  })
})
