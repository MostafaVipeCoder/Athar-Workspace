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
  it('a private network address is the developer machine seen from a phone (scripts/lan-dev.ps1), never the live project', () => {
    for (const host of ['192.168.1.7', '10.0.0.5', '172.16.4.9', '172.31.255.1', '169.254.10.10']) expect(classifyTarget(`http://${host}:54321`), host).toBe('local')
    for (const host of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '192.169.1.1', '11.0.0.1']) expect(classifyTarget(`http://${host}:54321`), host).toBe('remote')
    expect(classifyTarget('https://192.168.1.7.evil.example')).toBe('remote')
  })
  it('router basename', () => {
    expect(routerBasename('/')).toBeUndefined()
    expect(routerBasename('/EventsOperations/')).toBe('/EventsOperations')
  })
})
