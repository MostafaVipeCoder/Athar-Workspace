import { describe, expect, it } from 'vitest'
import { classifyTarget, readEnv, routerBasename } from './env.js'

describe('env', () => {
  it('reports missing variables', () => {
    const e = readEnv({})
    expect(e.ok).toBe(false)
    expect(e.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
  })
  it('ok when both set; trims trailing slash', () => {
    const e = readEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321/', VITE_SUPABASE_ANON_KEY: 'k' })
    expect(e.ok).toBe(true)
    expect(e.supabaseUrl).toBe('http://127.0.0.1:54321')
  })
  it('classifies target by host', () => {
    expect(classifyTarget('http://127.0.0.1:54321')).toBe('local')
    expect(classifyTarget('http://localhost:54321')).toBe('local')
    expect(classifyTarget('https://abc.supabase.co')).toBe('remote')
    expect(classifyTarget('nonsense')).toBe('unknown')
  })
  it('router basename', () => {
    expect(routerBasename('/')).toBeUndefined()
    expect(routerBasename('/EventsOperations/')).toBe('/EventsOperations')
  })
})
