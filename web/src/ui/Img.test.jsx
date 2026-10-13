import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Img } from './Img.jsx'

/** Review: the blurred thumbnail PREVIEW was a plain <img>: every card fired its request at load, far below the fold included. */
const imgs = (container) => [...container.querySelectorAll('img')]

describe('Img loading', () => {
  it('a card image and its blurred thumbnail preview are BOTH lazy', () => {
    const { container } = render(<Img src="http://x/full.webp" thumb="http://x/full_t.webp" alt="logo" />)
    const [preview, full] = imgs(container)
    expect(preview).toHaveAttribute('src', 'http://x/full_t.webp')
    expect(preview).toHaveAttribute('aria-hidden', 'true')
    expect(preview).toHaveAttribute('loading', 'lazy')
    expect(full).toHaveAttribute('src', 'http://x/full.webp')
    expect(full).toHaveAttribute('loading', 'lazy')
  })

  it('variant="thumb" loads only the thumbnail, lazily', () => {
    const { container } = render(<Img src="http://x/full.webp" thumb="http://x/full_t.webp" variant="thumb" alt="" />)
    const list = imgs(container)
    expect(list).toHaveLength(1)
    expect(list[0]).toHaveAttribute('src', 'http://x/full_t.webp')
    expect(list[0]).toHaveAttribute('loading', 'lazy')
  })

  it('priority (THE above-the-fold cover) is eager with high fetch priority, and so is its preview', () => {
    const { container } = render(<Img src="http://x/cover.webp" thumb="http://x/cover_t.webp" alt="" priority />)
    const [preview, full] = imgs(container)
    expect(preview).toHaveAttribute('loading', 'eager')
    expect(full).toHaveAttribute('loading', 'eager')
    expect(full).toHaveAttribute('fetchpriority', 'high')
  })

  it('every image decodes asynchronously and reserves its aspect box', () => {
    const { container } = render(<Img src="http://x/a.webp" thumb="http://x/a_t.webp" alt="" aspect="4 / 3" />)
    expect(imgs(container).every((i) => i.getAttribute('decoding') === 'async')).toBe(true)
    expect(container.firstChild.style.aspectRatio).toBe('4 / 3')
  })
})
