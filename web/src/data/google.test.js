import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc, functions: { invoke: mocks.invoke } }) }))

const G = await import('./google.js')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: {}, error: null })
})

const httpError = (status, body) => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status }) })

describe('RPC names (pinned to m61)', () => {
  it('status and the super_admin overview call the client RPCs with no arguments', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { mine: null, system: null, effective: { source: null } }, error: null })
    expect(await G.getGoogleStatus()).toMatchObject({ mine: null })
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_google_connection_status')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await G.listGoogleConnectionsAdmin()).toEqual([])
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_google_connections_admin')
  })
  it('a database error becomes an AppError (a founder is forbidden)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden', hint: 'forbidden' } })
    await expect(G.getGoogleStatus()).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('google-oauth-start / google-disconnect', () => {
  it('startGoogleConnect posts system + returnTo and returns the Google URL', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }, error: null })
    expect(await G.startGoogleConnect({ system: false, returnTo: '/projects/p/nodes/n/settings' })).toEqual({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' })
    expect(mocks.invoke).toHaveBeenCalledWith('google-oauth-start', { body: { system: false, returnTo: '/projects/p/nodes/n/settings' } })
  })
  it('system is sent only when true; the default return path is the profile', async () => {
    mocks.invoke.mockResolvedValue({ data: { url: 'http://127.0.0.1:54399/o/oauth2/v2/auth' }, error: null })
    await G.startGoogleConnect({ system: true })
    expect(mocks.invoke).toHaveBeenLastCalledWith('google-oauth-start', { body: { system: true, returnTo: '/profile' } })
    await G.startGoogleConnect()
    expect(mocks.invoke).toHaveBeenLastCalledWith('google-oauth-start', { body: { system: false, returnTo: '/profile' } })
  })
  it('refuses an answer that is not an http(s) URL (never navigates to javascript:)', async () => {
    for (const url of ['javascript:alert(1)', '', null, undefined, 42]) {
      mocks.invoke.mockResolvedValueOnce({ data: { url }, error: null })
      await expect(G.startGoogleConnect()).rejects.toMatchObject({ messageKey: 'google.err.server_error' })
    }
  })
  it('maps the server error codes to translatable AppErrors', async () => {
    for (const [status, code, appCode] of [[403, 'forbidden', 'forbidden'], [401, 'unauthenticated', 'unauthenticated'], [429, 'too_many_attempts', 'unknown'], [503, 'not_configured', 'unknown'], [500, 'server_error', 'unknown']]) {
      mocks.invoke.mockResolvedValueOnce({ data: null, error: httpError(status, { error: code }) })
      const e = await G.startGoogleConnect().catch((x) => x)
      expect(e.messageKey, code).toBe(`google.err.${code}`)
      expect(e.code, code).toBe(appCode)
      expect(e.token).toBe(code)
    }
  })
  it('an unknown server code is a generic server error; a network failure is retryable', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: httpError(500, { error: 'weird <b>code</b>' }) })
    expect((await G.startGoogleConnect().catch((x) => x)).messageKey).toBe('google.err.server_error')
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } })
    const e = await G.startGoogleConnect().catch((x) => x)
    expect([e.code, e.retryable, e.messageKey]).toEqual(['network', true, 'google.err.network'])
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { name: 'Weird', message: 'boom' } })
    expect((await G.startGoogleConnect().catch((x) => x)).messageKey).toBe('google.err.server_error')
  })
  it('disconnect posts system and returns the server answer', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, disconnected: true, revoked_at_google: true }, error: null })
    expect(await G.disconnectGoogle({ system: true })).toEqual({ ok: true, disconnected: true, revoked_at_google: true })
    expect(mocks.invoke).toHaveBeenCalledWith('google-disconnect', { body: { system: true } })
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, disconnected: false }, error: null })
    await G.disconnectGoogle()
    expect(mocks.invoke).toHaveBeenLastCalledWith('google-disconnect', { body: { system: false } })
  })
})

describe('the client never handles a secret', () => {
  it('the module names no token, ciphertext or vault column', async () => {
    const src = import.meta.glob('./google.js', { query: '?raw', import: 'default', eager: true })
    const text = Object.values(src)[0].toLowerCase()
    for (const word of ['refresh_token', 'access_token', 'vault_secret_id', 'ciphertext', 'client_secret']) expect(text.includes(word), word).toBe(false)
  })
})
