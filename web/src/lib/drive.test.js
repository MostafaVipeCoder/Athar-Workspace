import { describe, it, expect } from 'vitest'
import { isDriveUrl, extractDriveId, driveImageUrls, driveDirectUrl, driveViewUrl } from './drive.js'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456'

describe('drive', () => {
  it('one predicate for every Drive shape', () => {
    expect(isDriveUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(true)
    expect(isDriveUrl(`https://drive.google.com/open?id=${ID}`)).toBe(true)
    expect(isDriveUrl(`https://lh3.googleusercontent.com/d/${ID}`)).toBe(true)
    expect(isDriveUrl(ID)).toBe(true)
    expect(isDriveUrl('https://example.com/a.png')).toBe(false)
    expect(isDriveUrl('')).toBe(false)
  })
  it('extracts the id from every shape', () => {
    expect(extractDriveId(`https://drive.google.com/file/d/${ID}/view`)).toBe(ID)
    expect(extractDriveId(`https://drive.google.com/uc?export=view&id=${ID}`)).toBe(ID)
    expect(extractDriveId(`https://drive.usercontent.google.com/download?id=${ID}&export=view`)).toBe(ID)
    expect(extractDriveId(ID)).toBe(ID)
    expect(extractDriveId('https://example.com/a.png')).toBeNull()
  })
  it('returns ordered candidates; non-Drive URLs pass through', () => {
    const full = driveImageUrls(`https://drive.google.com/file/d/${ID}/view`)
    expect(full).toHaveLength(4)
    expect(full[0]).toContain('sz=w1600')
    const thumb = driveImageUrls(ID, { size: 'thumb' })
    expect(thumb[0]).toBe(`https://lh3.googleusercontent.com/d/${ID}=s400`)
    expect(driveImageUrls('https://example.com/a.png')).toEqual(['https://example.com/a.png'])
    expect(driveImageUrls(null)).toEqual([])
    expect(driveDirectUrl(ID)).toContain(ID)
    expect(driveViewUrl(ID)).toBe(`https://drive.google.com/file/d/${ID}/view`)
    expect(driveViewUrl('https://x.y/z')).toBe('https://x.y/z')
  })
})
