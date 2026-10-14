import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard.js'

const setClipboard = (value) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
afterEach(() => { setClipboard(undefined); delete document.execCommand })

describe('copyText (the ONE clipboard helper: Landing share, alumni pages, diagnostics)', () => {
  it('uses the async Clipboard API when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    expect(await copyText('https://x.example/invite/abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://x.example/invite/abc')
  })

  it('falls back to a hidden textarea + execCommand on an insecure origin (no Clipboard API) and cleans up', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn().mockReturnValue(true)
    expect(await copyText('link')).toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back when the Clipboard API REFUSES (permission denied), and reports false when nothing worked; it never throws', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    document.execCommand = vi.fn().mockReturnValue(false)
    expect(await copyText('x')).toBe(false)
    document.execCommand = () => { throw new Error('boom') }
    expect(await copyText('x')).toBe(false)
  })
})
