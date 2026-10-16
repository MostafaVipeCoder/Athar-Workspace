import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc }) }))

const { materializeItems, setItemWithdrawn, setItemsWithdrawn, useListMutations } = await import('./lists.js')

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null })
})

describe('bulk withdraw / reinstate (review: 2N sequential round trips, half done on a failure)', () => {
  it('materializeItems: ONE ensure_items call for all the virtual items, the order of the input kept, materialised ids untouched', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ['new-1', 'new-2'], error: null })
    const items = [
      { itemId: 'row-a', source: { kind: 'company', id: 'c1' } },
      { itemId: null, source: { kind: 'network_expert', id: 'e1' } },
      { itemId: 'row-b', source: { kind: 'company', id: 'c2' } },
      { itemId: null, source: { kind: 'form_response', id: 'r1' } },
    ]
    const ids = await materializeItems('L1', items)
    expect(ids).toEqual(['row-a', 'new-1', 'row-b', 'new-2'])
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('ensure_items', { p_list: 'L1', p_sources: [{ kind: 'network_expert', id: 'e1' }, { kind: 'form_response', id: 'r1' }] })
  })

  it('materializeItems makes NO call when every item already has its row', async () => {
    expect(await materializeItems('L1', [{ itemId: 'a' }, { itemId: 'b' }])).toEqual(['a', 'b'])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('setItemsWithdrawn: ONE set_items_withdrawn call (atomic on the server) with the reason; the single-item call is unchanged', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { count: 3, results: [] }, error: null })
    const res = await setItemsWithdrawn(['a', 'b', 'c'], true, 'left')
    expect(res.count).toBe(3)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('set_items_withdrawn', { p_items: ['a', 'b', 'c'], p_withdrawn: true, p_reason: 'left' })
    await setItemsWithdrawn(['a'], false)
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_items_withdrawn', { p_items: ['a'], p_withdrawn: false, p_reason: null })
    await setItemWithdrawn('a', true, null)
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_item_withdrawn', { p_item: 'a', p_withdrawn: true, p_reason: null })
  })

  it('a server refusal surfaces as an AppError (nothing was changed: the RPC is atomic)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden', details: null, hint: null } })
    await expect(setItemsWithdrawn(['a'], true)).rejects.toMatchObject({ name: 'AppError' })
  })
})

describe('the experts registry follows the lists (an item is a participation)', () => {
  const setup = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client: qc }, children)
    return { spy, ...renderHook(() => useListMutations('N1'), { wrapper }) }
  }
  const invalidated = (spy) => spy.mock.calls.map((c) => JSON.stringify(c[0].queryKey))

  it('adding / removing an item refreshes the registry figures (the profile and the list of experts), not only the node', async () => {
    const { result, spy } = setup()
    await result.current.addNetworkPick.mutateAsync({ expertId: 'e1' })
    expect(invalidated(spy)).toContain(JSON.stringify(['experts']))
    spy.mockClear()
    await result.current.remove.mutateAsync({ item: { itemId: 'i1' } })
    expect(invalidated(spy)).toContain(JSON.stringify(['experts']))
  })

  it('a withdrawal (project-wide) refreshes the registry too', async () => {
    const { result, spy } = setup()
    await result.current.withdraw.mutateAsync({ item: { itemId: 'i1' } })
    expect(invalidated(spy)).toContain(JSON.stringify(['experts']))
  })
})
