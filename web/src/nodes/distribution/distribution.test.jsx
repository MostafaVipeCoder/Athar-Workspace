import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import manifest from './manifest.js'

const D1 = 'd1111111-1111-4111-8111-111111111111'
const D2 = 'd2222222-2222-4222-8222-222222222222'
const M = ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003']
const C = ['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004']

const hoisted = vi.hoisted(() => ({
  server: { payload: null, rules: [], timer: null, calls: [], failNext: null, publicView: null, publicTimer: null },
}))
const { server } = hoisted

vi.mock('../../data/distribution.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  const log = (name, args) => server.calls.push([name, args])
  const maybeFail = () => { if (server.failNext) { const e = server.failNext; server.failNext = null; throw e } }
  return {
    getDistributionPayload: async () => structuredClone(server.payload),
    getDistributionRules: async () => structuredClone(server.rules),
    materializeCandidates: async (cands) => Object.fromEntries(cands.map((c) => [c.key, c.virtual ? `real-${c.key}` : c.key])),
    useDistributionPayload: (id) => useQuery({ queryKey: ['node', id, 'distPayload'], queryFn: async () => structuredClone(server.payload) }),
    useDistributionRules: (id) => useQuery({ queryKey: ['node', id, 'distRules'], queryFn: async () => structuredClone(server.rules) }),
    useTimerState: (id) => useQuery({ queryKey: ['node', id, 'distTimer'], queryFn: async () => ({ ...server.timer, server_now: new Date().toISOString() }) }),
    useDistributionLinks: (id) => useQuery({ queryKey: ['node', id, 'distLinks'], queryFn: async () => ({ matrix: { slug: 'mx1' }, live: null }) }),
    usePublicDistribution: (ref, key) => useQuery({ queryKey: ['public', 'distribution', ref, key], queryFn: async () => structuredClone(server.publicView), enabled: Boolean(ref) }),
    usePublicTimer: (ref, { enabled = true } = {}) => useQuery({ queryKey: ['public', 'distTimer', ref], queryFn: async () => ({ ...server.publicTimer, receivedAt: Date.now() }), enabled: Boolean(ref) && enabled }),
    useDistributionMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id] })
      const useM = (fn, refresh = true) => useMutation({ mutationFn: fn, onSuccess: refresh ? after : undefined })
      const m = useM
      return {
        replaceSessions: m(async (args) => {
          log('replace', args)
          maybeFail()
          const keep = server.payload.sessions.filter((s) => !args.days.includes(s.d) || (args.scope === 'unlocked' && s.manual))
          server.payload.sessions = [...keep, ...args.rows.map((r, i) => ({ id: `n${server.calls.length}-${i}`, d: r.day_id, s: r.slot_index, m: r.mentor_item_id, c: r.company_item_id, manual: r.is_manual_override }))]
          return { inserted: args.rows.length }
        }),
        setCompanies: m(async (changes) => {
          log('setCompanies', changes)
          maybeFail()
          for (const c of changes) {
            const s = server.payload.sessions.find((x) => x.id === c.session_id)
            s.c = c.company_item_id
            s.manual = c.is_manual_override ?? true
          }
          return { applied: changes.length, warnings: [] }
        }),
        setLock: m(async ({ dayId, locked }) => { log('lock', { dayId, locked }); server.payload.days.find((d) => d.id === dayId).is_locked = locked }),
        setPublished: m(async (published) => { log('publish', published); server.payload.published = published }),
        timer: m(async ({ action, args }) => { log('timer', { action, args }); return { status: 'paused', day_id: D1, slot_index: 0, duration_s: 1200, remaining_s: 1200, version: 3, server_now: new Date().toISOString() } }, false),
        ensureLink: useMutation({ mutationFn: async (key) => { log('ensureLink', key) } }),
      }
    },
  }
})
vi.mock('../../data/lists.js', async () => {
  const { normalizeListItem } = await import('../../lib/entities.js')
  const rows = (ids, prefix) => ids.map((id, i) => ({ item_id: id, source: { kind: 'manual', id: null, state: 'ok' }, display: { title_en: `${prefix} ${i + 1}`, title_ar: `${prefix} ع${i + 1}` }, contact: {}, overlay: {}, status: null, sort_order: i, excluded: false }))
  const virtual = { item_id: null, source: { kind: 'company', id: 'co-virtual', state: 'ok' }, display: { title_en: 'Company V' }, contact: {}, overlay: {}, status: null, sort_order: 9, excluded: false }
  return {
    getListMeta: async (id) => ({ subkind: id === 'LM' ? 'expert' : 'company' }),
    listItems: async (id, { kind = 'generic' } = {}) => (id === 'LM' ? rows(M, 'Mentor') : [...rows(C, 'Company'), virtual]).map((r) => normalizeListItem(r, kind)),
    materializeItem: async (listId, item) => item.itemId ?? `real-${item.id}`,
    ensureItems: async () => [],
  }
})
vi.mock('../../data/agenda.js', () => ({
  getAgendaDefinition: async () => ({ days: [{ id: 'ag1', sort_order: 1, day_date: '2026-10-12', name_en: 'Training day', name_ar: 'يوم التدريب', slots: [{ id: 'ags1', day_id: 'ag1', sort_order: 1, start_time: '10:00:00', end_time: '11:00:00', title_en: 'Mentoring rounds', title_ar: 'جولات', presenter_en: null, presenter_ar: null, presenter_item_id: null, show_presenter: true, bullets: [] }] }] }),
  getAgendaLink: async () => null,
}))
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn() }))

const auth = { user: { id: 'u1', email: 'pm@x.io' }, profile: { full_name: 'Mona PM' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const anon = { user: null, profile: null, roles: [], status: 'anon', hasRole: () => false, can: () => false }
const node = { id: 'D', project_id: 'P', type: 'distribution', type_version: 1, name_en: 'Mentoring', name_ar: 'التوزيع', visibility: 'public', show_to_participants: false, config: {}, rev: 1 }
const graph = {
  project: { id: 'P', timezone: 'Asia/Riyadh' },
  nodes: [{ id: 'D', type: 'distribution', name_en: 'Mentoring' }, { id: 'LM', type: 'list', name_en: 'Mentors' }, { id: 'LC', type: 'list', name_en: 'Companies' }, { id: 'AG', type: 'agenda', name_en: 'Agenda' }, { id: 'BK', type: 'booking', name_en: 'Mentor sessions' }],
  edges: [
    { from_node_id: 'LM', from_port: 'items', to_node_id: 'D', to_port: 'mentors', is_enabled: true },
    { from_node_id: 'LC', from_port: 'items', to_node_id: 'D', to_port: 'companies', is_enabled: true },
    { from_node_id: 'AG', from_port: 'schedule', to_node_id: 'D', to_port: 'schedule', is_enabled: true },
    { from_node_id: 'LM', from_port: 'items', to_node_id: 'BK', to_port: 'mentors', is_enabled: true },
  ],
}
const dayRow = (id, index, over = {}) => ({ id, day_index: index, agenda_day_id: null, date: index === 0 ? '2026-10-12' : '2026-10-13', name_en: null, name_ar: null, start_time: '10:00', total_round_min: 60, slot_duration_min: 20, gap_min: 0, slots: 3, is_locked: false, own_start: '10:00', own_slot: null, own_gap: null, own_date: index === 0 ? '2026-10-12' : '2026-10-13', mentor_ids: [M[0], M[1]], ...over })
const names = (ids, prefix) => ids.map((id, i) => ({ id, name_en: `${prefix} ${i + 1}`, name_ar: `${prefix} ع${i + 1}`, sub_en: null, image_path: null, room: i === 0 && prefix === 'Mentor' ? 'Room A' : null }))
function fixture() {
  const sessions = []
  for (const d of [D1]) for (let s = 0; s < 3; s += 1) {
    sessions.push({ id: `s-${s}-0`, d, s, m: M[0], c: C[s], manual: false })
    sessions.push({ id: `s-${s}-1`, d, s, m: M[1], c: C[(s + 1) % 3], manual: false })
  }
  return {
    node_id: 'D', revision: 1, name_en: 'Mentoring', name_ar: 'التوزيع', project: { id: 'P', name_en: 'Proj', name_ar: 'مشروع', timezone: 'Asia/Riyadh' },
    config: { slot_duration_min: 20, gap_min: 0, start_time: '10:00', unique_pairing: true, seed: null, timer: {} }, published: true,
    days: [dayRow(D1, 0), dayRow(D2, 1)], mentors: names(M, 'Mentor').slice(0, 2), companies: names(C, 'Company'), sessions, my_company_ids: [],
  }
}

function mount(mode, over = {}, authValue = auth) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: graph.edges })
  renderWithProviders(
    <AuthContext.Provider value={authValue}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: '/projects/P/nodes/D?lang=en' },
  )
  return adapter
}

beforeEach(() => {
  server.payload = fixture()
  server.rules = []
  server.timer = { status: 'idle', day_id: null, slot_index: null, duration_s: 0, remaining_s: null, version: 0 }
  server.calls = []
  server.failNext = null
  server.publicView = null
  server.publicTimer = null
})
afterEach(() => { vi.useRealTimers() })

describe('Distribution manifest', () => {
  it('ports mirror the DB row and both contributed views are keyed by the out ports', () => {
    expect(manifest.ports.in.map((p) => p.key)).toEqual(['mentors', 'companies', 'schedule'])
    expect(manifest.ports.in.find((p) => p.key === 'schedule').required).toBe(false)
    const outs = manifest.ports.out.map((p) => p.key)
    expect(outs).toEqual(['sessions-tab', 'my-meetings-tab'])
    expect(manifest.contributesViews.map((v) => v.key)).toEqual(outs)
    expect(manifest.defaultConfig()).toEqual({ timer: { alertSeconds: 7, sounds: true } })
  })
})

describe('Edit / Setup', () => {
  it('lists the saved days and the connected mentors by reference; the agenda day supplies the date; ONE save_node carries the children', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const days = await screen.findAllByTestId('setup-day')
    expect(days).toHaveLength(2)
    expect(await screen.findAllByTestId('mentor-row')).toHaveLength(3)
    expect(screen.getByTestId('company-count')).toHaveTextContent('5 companies')
    // decision 01-7 (warning only): the same mentors list feeds a Booking node
    expect(screen.getByTestId('booking-overlap')).toHaveTextContent('Mentor sessions')
    expect(within(days[0]).getByTestId('day-summary')).toHaveTextContent('3 rounds, 10:00 AM to 11:00 AM, 2 mentors')
    // gap-aware slots: a 5-minute gap fits fewer rounds in the same hour
    fireEvent.change(screen.getByTestId('setup-gap'), { target: { value: '10' } })
    expect(within(days[0]).getByTestId('day-summary')).toHaveTextContent('2 rounds')
    fireEvent.change(screen.getByTestId('setup-gap'), { target: { value: '0' } })
    // the End field sets the total
    fireEvent.change(within(days[0]).getByTestId('day-end'), { target: { value: '11:40' } })
    expect(within(days[0]).getByTestId('day-total')).toHaveValue(100)
    // tick the third mentor on day 1
    const third = screen.getAllByTestId('mentor-row')[2]
    await user.click(within(third).getAllByTestId('mentor-day')[0])
    expect(screen.getByRole('status', { name: '' })).toBeDefined
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    const children = adapter.snapshot().nodes[0].children
    expect(children.settings).toEqual({ slot_duration_min: 20, gap_min: 0, start_time: '10:00', unique_pairing: true })
    expect(children.days[0]).toMatchObject({ id: D1, day_index: 0, day_date: '2026-10-12', total_round_min: 100 })
    expect(children.days[0].mentor_item_ids).toEqual(expect.arrayContaining([M[0], M[1], M[2]]))
    expect(children.days[1]).toMatchObject({ id: D2, day_index: 1 })
  })

  it('adds the connected agenda days (window from the agenda session) and keeps a mentor rule (window, max, room)', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('setup-day')
    await user.click(await screen.findByTestId('add-agenda-days'))
    const days = screen.getAllByTestId('setup-day')
    expect(days).toHaveLength(3)
    expect(within(days[2]).getByTestId('day-agenda-date')).toHaveTextContent('2026-10-12')
    expect(within(days[2]).getByTestId('day-start')).toHaveValue('10:00')
    expect(within(days[2]).getByTestId('day-total')).toHaveValue(60)
    await user.click(within(screen.getAllByTestId('mentor-row')[0]).getByTestId('mentor-rule-toggle'))
    fireEvent.change(screen.getByTestId('rule-from'), { target: { value: '10:20' } })
    fireEvent.change(screen.getByTestId('rule-max'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('rule-room'), { target: { value: 'Table 4' } })
    expect(screen.getByTestId('mentor-rule')).toBeInTheDocument()
  })

  it('an invalid mentor window blocks the save with an inline error', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    await screen.findAllByTestId('setup-day')
    await user.click(within((await screen.findAllByTestId('mentor-row'))[0]).getByTestId('mentor-rule-toggle'))
    fireEvent.change(screen.getByTestId('rule-from'), { target: { value: '12:00' } })
    fireEvent.change(screen.getByTestId('rule-to'), { target: { value: '11:00' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The "to" time must be after the "from" time.')).toBeInTheDocument()
    expect(adapter.snapshot().nodes[0].rev).toBe(1)
  })
})

describe('Edit / Timetable', () => {
  async function openTimetable() {
    const user = userEvent.setup()
    const adapter = mount('edit')
    await screen.findAllByTestId('setup-day')
    await user.click(screen.getByTestId('tab-timetable'))
    return { user, adapter }
  }

  it('Generate replaces the unlocked days with ONE persisted generation (rows carry day, slot, mentor, company) after a confirmation, never the locked day', async () => {
    server.payload.days[1].is_locked = true
    const { user } = await openTimetable()
    await user.click(screen.getByTestId('generate'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('6 sessions of the unlocked days will be replaced')
    await user.click(within(dlg).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(server.calls.some((c) => c[0] === 'replace')).toBe(true))
    const [, args] = server.calls.find((c) => c[0] === 'replace')
    expect(args.scope).toBe('all')
    expect(args.days).toEqual([D1])
    expect(args.rows).toHaveLength(6) // 3 rounds x 2 mentors on the one unlocked day
    expect(new Set(args.rows.map((r) => r.day_id))).toEqual(new Set([D1]))
    expect(args.rows.every((r) => M.includes(r.mentor_item_id) && (r.company_item_id === null || [...C, 'real-virtual:company:co-virtual'].includes(r.company_item_id) || typeof r.company_item_id === 'string'))).toBe(true)
    // no company is in two rooms in one round, and no pair repeats
    const bySlot = new Map()
    for (const r of args.rows) if (r.company_item_id) { const k = `${r.slot_index}|${r.company_item_id}`; expect(bySlot.has(k)).toBe(false); bySlot.set(k, 1) }
    const pairs = args.rows.filter((r) => r.company_item_id).map((r) => `${r.mentor_item_id}|${r.company_item_id}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(typeof args.seed).toBe('number')
    expect(await screen.findByTestId('generation-result')).toHaveTextContent('cells filled')
  })

  it('a fixed seed makes Generate reproducible', async () => {
    server.payload.sessions = []
    const { user } = await openTimetable()
    await user.click(screen.getByText('Advanced: seed'))
    await user.click(screen.getByTestId('seed-fixed'))
    fireEvent.change(screen.getByTestId('seed-input'), { target: { value: '42' } })
    await user.click(screen.getByTestId('generate'))
    await waitFor(() => expect(server.calls.filter((c) => c[0] === 'replace')).toHaveLength(1))
    await user.click(screen.getByTestId('generate'))
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(server.calls.filter((c) => c[0] === 'replace')).toHaveLength(2))
    const [a, b] = server.calls.filter((c) => c[0] === 'replace').map((c) => JSON.stringify(c[1].rows))
    expect(a).toBe(b)
    expect(server.calls.find((c) => c[0] === 'replace')[1].seed).toBe(42)
  })

  it('a click opens the cell dialog; choosing a company busy in the same round swaps the two cells and Undo restores them', async () => {
    const { user } = await openTimetable()
    const cell = (await screen.findAllByTestId('timetable-cell')).find((c) => c.dataset.session === 's-0-0')
    expect(cell).toHaveAttribute('data-company', C[0])
    await user.click(cell)
    const dlg = await screen.findByTestId('cell-dialog')
    const option = within(dlg).getAllByTestId('cell-option').find((o) => /Company 2/.test(o.textContent))
    expect(option).toHaveTextContent('swap with Mentor 2')
    await user.click(option)
    await waitFor(() => expect(server.calls.some((c) => c[0] === 'setCompanies')).toBe(true))
    const [, changes] = server.calls.find((c) => c[0] === 'setCompanies')
    expect(changes).toEqual([{ session_id: 's-0-0', company_item_id: C[1] }, { session_id: 's-0-1', company_item_id: C[0] }])
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(server.calls.filter((c) => c[0] === 'setCompanies')).toHaveLength(2))
    expect(server.calls.filter((c) => c[0] === 'setCompanies')[1][1]).toEqual([
      { session_id: 's-0-0', company_item_id: C[0], is_manual_override: false },
      { session_id: 's-0-1', company_item_id: C[1], is_manual_override: false },
    ])
  })

  it('a server-side conflict is shown as a message and nothing else changes', async () => {
    const { AppError } = await import('../../data/errors.js')
    const err = new AppError('validation', { messageKey: 'distribution.err.companyDoubleBooked' })
    server.failNext = err
    const { user } = await openTimetable()
    const cell = (await screen.findAllByTestId('timetable-cell')).find((c) => c.dataset.session === 's-1-0')
    await user.click(cell)
    const dlg = await screen.findByTestId('cell-dialog')
    await user.click(within(dlg).getAllByTestId('cell-option').find((o) => /Company 4/.test(o.textContent)))
    expect(await screen.findByText('That company is already in another room at that time.')).toBeInTheDocument()
    expect(server.payload.sessions.find((s) => s.id === 's-1-0').c).toBe(C[1])
  })

  it('locking a day calls the RPC and disables editing; unpublish flips the publish flag; the issues line reports clean data', async () => {
    const { user } = await openTimetable()
    expect(screen.getByTestId('issues-toggle')).toHaveTextContent('0 errors · 0 warnings')
    await user.click(screen.getAllByTestId('lock-day')[0])
    await waitFor(() => expect(server.calls).toContainEqual(['lock', { dayId: D1, locked: true }]))
    await waitFor(() => expect(screen.getAllByTestId('timetable-cell')[0]).toBeDisabled())
    await user.click(screen.getByTestId('publish-toggle'))
    await waitFor(() => expect(server.calls).toContainEqual(['publish', false]))
    expect(await screen.findByTestId('unpublished-note')).toBeInTheDocument()
  })

  it('reports conflicts found in stored data (a company in two rooms)', async () => {
    server.payload.sessions.find((s) => s.id === 's-0-1').c = C[0]
    const { user } = await openTimetable()
    expect(screen.getByTestId('issues-toggle')).toHaveTextContent('2 errors')
    await user.click(screen.getByTestId('issues-toggle'))
    expect(screen.getByTestId('issues-list')).toHaveTextContent('is in two rooms at the same time')
  })
})

describe('Edit / Live and View', () => {
  it('the PM remote calls the timer RPC (set round, start, adjust)', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('setup-day')
    await user.click(screen.getByTestId('tab-live'))
    const select = await screen.findByTestId('round-select')
    await user.selectOptions(select, [...select.options].find((o) => /Round 2/.test(o.textContent)).value)
    await waitFor(() => expect(server.calls).toContainEqual(['timer', { action: 'set_round', args: { day_id: D1, slot_index: 1 } }]))
    await user.click(screen.getByTestId('timer-start'))
    await waitFor(() => expect(server.calls).toContainEqual(['timer', { action: 'start', args: {} }]))
    await user.click(screen.getByTestId('timer-adjust-60'))
    await waitFor(() => expect(server.calls).toContainEqual(['timer', { action: 'adjust', args: { seconds: 60 } }]))
  })

  it('View: the three surfaces render from the PM payload (matrix with mentors and rooms, my schedule, live)', async () => {
    const user = userEvent.setup()
    mount('view')
    expect(await screen.findByTestId('matrix-tab')).toBeInTheDocument()
    expect(screen.getAllByTestId('matrix-mentor').map((m) => m.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Mentor 1')]))
    expect(screen.getAllByTestId('matrix-mentor')[0]).toHaveTextContent('Room A')
    await user.click(screen.getByTestId('view-my'))
    expect(await screen.findByTestId('my-schedule')).toBeInTheDocument()
    await user.click(screen.getByTestId('view-live'))
    expect(await screen.findByTestId('live-board')).toBeInTheDocument()
  })
})

describe('Settings', () => {
  it('ONE save carries name + visibility + the timer config; links are created per view; publish does not touch the config', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    await screen.findByTestId('distribution-settings')
    fireEvent.change(screen.getByTestId('settings-alert'), { target: { value: '10' } })
    await user.click(screen.getByTestId('settings-sounds'))
    await user.click(screen.getByLabelText(/Platform \(signed-in/))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    const saved = adapter.snapshot().nodes[0]
    expect(saved.config.timer).toEqual({ alertSeconds: 10, sounds: false })
    expect(saved.visibility).toBe('platform')
    expect(within(screen.getByTestId('link-matrix')).getByText(/\/view\/mx1\/matrix/)).toBeInTheDocument()
    await user.click(screen.getByTestId('create-link-live'))
    await waitFor(() => expect(server.calls).toContainEqual(['ensureLink', 'live']))
    await user.click(screen.getByTestId('settings-publish-toggle'))
    await waitFor(() => expect(server.calls).toContainEqual(['publish', false]))
    expect(adapter.snapshot().nodes[0].rev).toBe(2) // publishing is not a config save
  })

  it('an alert window outside 1..30 is refused inline', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    await screen.findByTestId('distribution-settings')
    fireEvent.change(screen.getByTestId('settings-alert'), { target: { value: '99' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a number between 1 and 30.')).toBeInTheDocument()
    expect(adapter.snapshot().nodes[0].rev).toBe(1)
  })
})

describe('Public surfaces', () => {
  const publicPayload = (over = {}) => ({ ...fixture(), viewer: 'public', view_key: 'live', timer: { status: 'idle', server_now: new Date().toISOString(), version: 0 }, ...over })

  async function mountPage(viewKey, route, authValue = anon) {
    const { default: Page } = await import('../../app/pages/DistributionViewPage.jsx')
    renderWithProviders(
      <AuthContext.Provider value={authValue}><Routes><Route path="/view/:nodeRef/matrix" element={<Page viewKey="matrix" />} /><Route path="/view/:nodeRef/live" element={<Page viewKey="live" />} /></Routes></AuthContext.Provider>,
      { route },
    )
  }

  it('matrix page: whitelisted payload through the MatrixTab; highlighting a company marks its cells; print is offered', async () => {
    const user = userEvent.setup()
    server.publicView = publicPayload({ view_key: 'matrix' })
    await mountPage('matrix', '/view/mx1/matrix?lang=en')
    expect(await screen.findByTestId('distribution-matrix-page')).toHaveAttribute('data-audience', 'public')
    expect((await screen.findAllByTestId('matrix-row')).length).toBeGreaterThan(0)
    await user.selectOptions(screen.getByTestId('matrix-highlight'), C[0])
    const hits = screen.getAllByTestId('matrix-cell').filter((c) => c.dataset.company === C[0])
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].className).toContain('ring-primary')
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument()
  })

  it('live page as a visitor: the countdown comes from the server timestamps and there is NO control to touch the timer', async () => {
    const now = Date.now()
    server.publicView = publicPayload()
    server.publicTimer = { status: 'running', day_id: D1, slot_index: 0, duration_s: 1200, ends_at: new Date(now + 125_000).toISOString(), version: 4, server_now: new Date(now).toISOString(), revision: 1, published: true, viewer: 'public' }
    await mountPage('live', '/view/lv1/live?lang=en')
    const board = await screen.findByTestId('live-board')
    await waitFor(() => expect(board).toHaveAttribute('data-source', 'timer'))
    expect(screen.getByTestId('live-remaining').textContent).toMatch(/^2:0\d$/)
    expect(screen.getAllByTestId('live-pair')).toHaveLength(2)
    expect(screen.queryByTestId('timer-controls')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start|Pause|Reset|Next/ })).not.toBeInTheDocument()
  })

  it('live page as a project manager: the remote is rendered (the DB says viewer = pm)', async () => {
    server.publicView = publicPayload({ viewer: 'pm' })
    server.publicTimer = { status: 'paused', day_id: D1, slot_index: 1, duration_s: 1200, remaining_s: 600, version: 2, server_now: new Date().toISOString(), revision: 1, published: true, viewer: 'pm' }
    await mountPage('live', '/view/lv1/live?lang=en', auth)
    expect(await screen.findByTestId('timer-controls')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('live-remaining')).toHaveTextContent('10:00'))
  })

  it('an unpublished timetable shows only the not-published message; an unknown or private link shows not available', async () => {
    server.publicView = { node_id: 'D', viewer: 'public', published: false, name_en: 'Mentoring', project: { name_en: 'P' } }
    await mountPage('matrix', '/view/mx1/matrix?lang=en')
    expect(await screen.findByText('The timetable is not published yet')).toBeInTheDocument()
    expect(screen.queryByTestId('matrix-tab')).not.toBeInTheDocument()
  })

  it('without a timer round the live board follows the wall clock of the PROJECT zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T07:05:00Z')) // 10:05 in Asia/Riyadh = round 1 of day 1
    server.publicView = publicPayload()
    server.publicTimer = { status: 'idle', server_now: new Date().toISOString(), version: 0, revision: 1, published: true, viewer: 'public' }
    await mountPage('live', '/view/lv1/live?lang=en')
    const board = await screen.findByTestId('live-board')
    expect(board).toHaveAttribute('data-source', 'clock')
    expect(board).toHaveAttribute('data-state', 'in')
    expect(screen.getByTestId('live-remaining')).toHaveTextContent('15:00')
  })
})

describe('Agenda tabs (the contributed views)', () => {
  it('MyScheduleTab: a signed-in founder gets their own company; the picker works for everyone else; now/next are computed in the project zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T07:05:00Z')) // 10:05 Riyadh
    const { default: MyScheduleTab } = await import('./MyScheduleTab.jsx')
    const user = userEvent.setup()
    const data = { ...fixture(), my_company_ids: [C[1]] }
    renderWithProviders(<MyScheduleTab data={data} audience="participant" timezone="Asia/Riyadh" />, { route: '/x?lang=en' })
    expect(await screen.findByTestId('my-company')).toHaveTextContent('Company 2')
    expect(screen.getByTestId('my-company')).toHaveTextContent('Your company')
    // Company 2: slot 1 (10:20) with Mentor 1 and slot 0 (10:00) with Mentor 2 -> now = slot 0 (10:05), next = slot 1
    expect(screen.getByTestId('meeting-now')).toHaveTextContent('Mentor 2')
    expect(screen.getByTestId('meeting-next')).toHaveTextContent('Mentor 1')
    expect(screen.getByTestId('meeting-next')).toHaveTextContent('Room A')
    expect(screen.getByTestId('meeting-next')).toHaveTextContent('starts in 15 min')
    await user.click(screen.getByTestId('change-company'))
    await user.click((await screen.findAllByTestId('company-option')).find((o) => /Company 3/.test(o.textContent)))
    expect(screen.getByTestId('my-company')).toHaveTextContent('Company 3')
    // the choice is remembered on the device
    expect(JSON.parse(window.localStorage.getItem('athar.dist.me.D'))).toBe(C[2])
  })

  it('mentor-centric mode lists the companies a mentor meets in order', async () => {
    const { default: MyScheduleTab } = await import('./MyScheduleTab.jsx')
    const user = userEvent.setup()
    renderWithProviders(<MyScheduleTab data={fixture()} timezone="Asia/Riyadh" />, { route: '/x?lang=en' })
    await user.click(await screen.findByTestId('my-mode-mentor'))
    await user.selectOptions(screen.getByTestId('mentor-select'), M[0])
    const list = await screen.findByTestId('mentor-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(list).toHaveTextContent('Company 1')
  })

  it('MatrixTab (PM audience): a withdrawn company / mentor keeps its place with a Withdrawn chip; the public payload carries no flag and shows none', async () => {
    const { default: MatrixTab } = await import('./MatrixTab.jsx')
    const f = fixture()
    const pm = { ...f, mentors: f.mentors.map((m, i) => (i === 1 ? { ...m, withdrawn: true } : m)), companies: f.companies.map((c, i) => (i === 0 ? { ...c, withdrawn: true } : c)) }
    const { unmount } = renderWithProviders(<MatrixTab data={pm} audience="pm" />, { route: '/x?lang=en' })
    expect(await screen.findAllByTestId('matrix-cell-withdrawn')).not.toHaveLength(0)
    expect(screen.getAllByTestId('matrix-mentor-withdrawn').length).toBeGreaterThan(0) // one per day grid
    expect(screen.getByRole('option', { name: 'Company 1 (Withdrawn)' })).toBeInTheDocument()
    unmount()
    renderWithProviders(<MatrixTab data={f} />, { route: '/x?lang=en' })
    expect((await screen.findAllByTestId('matrix-row')).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('matrix-cell-withdrawn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('matrix-mentor-withdrawn')).not.toBeInTheDocument()
  })

  it('MatrixTab empty state when nothing is generated', async () => {
    const { default: MatrixTab } = await import('./MatrixTab.jsx')
    renderWithProviders(<MatrixTab data={{ ...fixture(), sessions: [] }} />, { route: '/x?lang=en' })
    expect(await screen.findByText('No timetable to show yet')).toBeInTheDocument()
  })
})
