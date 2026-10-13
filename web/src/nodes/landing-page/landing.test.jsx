import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import LandingPage from './LandingPage.jsx'
import LandingTab from './LandingTab.jsx'
import PublicLandingPage from '../../app/pages/PublicLandingPage.jsx'
import FounderLandingButtons from '../../app/pages/founder/FounderLandingButtons.jsx'
import manifest from './manifest.js'
import { resolveLink } from './data.js'
import { modelFromPayload } from './landingLogic.js'

const P = '9166121d-5a85-41dd-adda-23dc3276333b'
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const FR1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const FR2 = 'bbbbbbbb-0000-4000-8000-000000000002'

const mocks = vi.hoisted(() => ({
  getDef: vi.fn(), getLink: vi.fn(), ensureLink: vi.fn(), getPublic: vi.fn(), track: vi.fn(), analytics: vi.fn(),
  uploadImage: vi.fn(), removeImage: vi.fn(), removeFiles: vi.fn(), uploadFrame: vi.fn(),
  founder: vi.fn(), decode: vi.fn(), loadFrame: vi.fn(), inspect: vi.fn(), compose: vi.fn(), toBlob: vi.fn(),
}))

vi.mock('../../data/landing.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    LANDING_LINK_KIND: 'view', LANDING_VIEW_KEY: 'landing', LANDING_EVENTS: [],
    getLandingLink: mocks.getLink, trackLandingEvent: mocks.track, uploadFramePng: mocks.uploadFrame, removeFiles: mocks.removeFiles,
    framePublicUrl: (p) => (p ? `http://files/${p}` : ''),
    useLandingDefinition: (id) => useQuery({ queryKey: ['node', id, 'landing'], queryFn: () => mocks.getDef(id) }),
    useFounderLandings: (p) => useQuery({ queryKey: ['founderLandings', p], queryFn: () => mocks.founder(p), enabled: Boolean(p) }),
    useLandingLink: (id) => useQuery({ queryKey: ['node', id, 'landingLink'], queryFn: () => mocks.getLink(id) }),
    useLandingAnalytics: (id, days) => useQuery({ queryKey: ['node', id, 'landingAnalytics', days], queryFn: () => mocks.analytics(id, days) }),
    usePublicLanding: (ref) => useQuery({ queryKey: ['public', 'landing', ref], queryFn: () => mocks.getPublic(ref), enabled: Boolean(ref) }),
    useLandingMutations: (id) => {
      const qc = useQueryClient()
      return { ensureLink: useMutation({ mutationFn: () => mocks.ensureLink(), onSuccess: () => qc.invalidateQueries({ queryKey: ['node', id, 'landingLink'] }) }) }
    },
  }
})
vi.mock('../../data/storage.js', () => ({
  publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''),
  uploadImage: mocks.uploadImage, removeImage: mocks.removeImage,
}))
vi.mock('../form-builder/data.js', () => ({
  resolveLink: async () => ({ items: [{ kind: 'form', url: 'https://athar.test/forms/frm123', label: { en: 'Apply form', ar: 'نموذج التقديم' }, nodeId: 'F' }] }),
}))
vi.mock('./photoCompose.js', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, decodePhoto: mocks.decode, loadFrameImage: mocks.loadFrame, inspectFrameFile: mocks.inspect, composeToCanvas: mocks.compose, canvasToPngBlob: mocks.toBlob }
})

const cardRow = (id, over = {}) => ({ id, sort_order: 0, cover_path: null, chip_label_en: 'Upcoming', chip_label_ar: 'القادم', title_en: 'Do you know a founder?', title_ar: 'هل تعرف مؤسسًا؟', body_en: 'Short body', body_ar: null, see_more_lines: null, cta_label_en: 'Share the program', cta_label_ar: 'شارك البرنامج', cta_url: null, cta_node_id: null, cta_dot: true, share_enabled: true, share_url: null, share_node_id: null, presets: {}, ...over })
const LONG = 'A long paragraph about the program. '.repeat(8)
const publicPayload = (over = {}) => ({
  node_id: 'L',
  config: { hero: { title: { en: 'Help someone', ar: 'ساعد شخصًا' }, body: { en: 'Hero body', ar: 'نص الواجهة' } }, cardsSection: { title: { en: 'Two ways', ar: 'طريقتان' }, body: { en: 'Intro', ar: 'مقدمة' } }, personalize: { enabled: true, title: { en: 'Personalize', ar: 'خصّص' }, body: { en: 'Upload', ar: 'ارفع' } }, share: { channels: ['whatsapp', 'facebook', 'instagram', 'telegram', 'copy'] } },
  cards: [
    cardRow(A, { cta_link: { kind: 'form', slug: 'frm123' }, body_en: LONG, presets: { whatsapp: 'Join {link} and {link}', telegram: 'Telegram {link}', facebook: 'FB text {link}', instagram: 'IG {link}', copy: 'Copy {link}' } }),
    cardRow(B, { sort_order: 1, title_en: 'Wait list', title_ar: 'قائمة الانتظار', cta_url: 'https://opp.co/apply', share_enabled: false }),
  ],
  frames: [{ id: FR1, name: 'Frame 1', image_path: `${P}/landing/f1.png`, window_x: 90, window_y: 90, window_w: 900, window_h: 930, window_shape: 'rect' }],
  ...over,
})

const ORIGIN = window.location.origin
let clipboard

// the node's lazy chunks are transformed on first import: warm them up once so a loaded machine never trips the 5 s findBy timeout
beforeAll(async () => {
  await Promise.all([import('./Edit.jsx'), import('./Settings.jsx'), import('./View.jsx'), import('./PersonalizeSection.jsx'), import('./ShareDialog.jsx'), import('./CropModal.jsx')])
}, 120000)

/** user-event installs its own navigator.clipboard in setup(): the mock goes in AFTER it. */
function setupUser() {
  const user = userEvent.setup()
  clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random().toString(16).slice(2, 8)}`)
  URL.revokeObjectURL = vi.fn()
  mocks.decode.mockResolvedValue({ bitmap: { name: 'photo' }, width: 2000, height: 1000 })
  mocks.loadFrame.mockResolvedValue({ name: 'frame-bitmap' })
  mocks.compose.mockImplementation((canvas) => canvas)
  mocks.toBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  mocks.getLink.mockResolvedValue(null)
  mocks.ensureLink.mockResolvedValue({ linkId: 'lk', slug: 'ph4yyxwggk', enabled: true })
  mocks.uploadImage.mockResolvedValue(`${P}/landing/new.webp`)
  mocks.removeImage.mockResolvedValue(undefined)
  mocks.removeFiles.mockResolvedValue(undefined)
  mocks.uploadFrame.mockResolvedValue(`${P}/landing/frame-new.png`)
  mocks.inspect.mockResolvedValue({ problems: [], width: 1080, height: 1350, window: { x: 90, y: 90, w: 900, h: 930 } })
  mocks.analytics.mockResolvedValue({ days: 30, all_time: 11, totals: { tab_view: 7, cta_click: 3, card_share: 2, share_copy: 1 }, by_card: [{ card_id: A, event_type: 'cta_click', n: 3 }], by_platform: [{ platform: 'whatsapp', event_type: 'card_share', n: 2 }], by_day: [{ day: '2026-10-13', event_type: 'tab_view', n: 7 }] })
})

describe('manifest and port resolver', () => {
  it('contributes the landing-tab view, has a link resolver, three modes, tables owned', () => {
    expect(manifest.key).toBe('landing_page')
    expect(manifest.contributesViews[0].key).toBe('landing-tab')
    expect(manifest.ports.in.map((p) => p.key)).toEqual(['links'])
    expect(manifest.ports.out.map((p) => p.key)).toEqual(['landing-tab', 'link'])
    expect(manifest.ports.out.find((p) => p.key === 'link').resolve).toBeTypeOf('function')
    expect(manifest.ownsTables).toEqual(['landing_cards', 'landing_share_presets', 'landing_frames'])
    expect(manifest.visibility.showToParticipants).toBe(true)
    expect(manifest.defaultConfig()).toEqual({})
  })
  it('the link resolver returns the node\'s own /view/<slug>/landing URL once the link exists, nothing before', async () => {
    mocks.getLink.mockResolvedValueOnce(null)
    expect(await resolveLink({ node: { id: 'L', name_en: 'Landing' } })).toEqual({ items: [] })
    mocks.getLink.mockResolvedValueOnce({ slug: 'ph4yyxwggk' })
    const r = await resolveLink({ node: { id: 'L', name_en: 'Landing', name_ar: 'هبوط' } })
    expect(r.items[0]).toMatchObject({ kind: 'landing', nodeId: 'L', label: { en: 'Landing', ar: 'هبوط' } })
    expect(r.items[0].url).toMatch(/\/view\/ph4yyxwggk\/landing$/)
  })
})

describe('LandingPage (the public renderer)', () => {
  const model = () => modelFromPayload(publicPayload())

  it('renders the hero, the sticky navigation (defaults), the intro and one article per card; a card without a share flag has no share button', () => {
    renderWithProviders(<LandingPage model={model()} lang="en" track={mocks.track} pageUrl={`${ORIGIN}/view/x/landing`} />, { route: '/view/x/landing?lang=en' })
    expect(screen.getByRole('heading', { level: 1, name: 'Help someone' })).toBeInTheDocument()
    expect(screen.getByText('Hero body')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Page navigation' })).toBeInTheDocument()
    expect(screen.getByTestId('nav-cards')).toHaveTextContent('Opportunities')
    expect(screen.getByTestId('nav-personalize')).toHaveTextContent('Your Picture')
    expect(screen.getByRole('heading', { level: 2, name: 'Two ways' })).toBeInTheDocument()
    const cards = screen.getAllByTestId('landing-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByTestId('card-share')).toBeInTheDocument()
    expect(within(cards[1]).queryByTestId('card-share')).toBeNull()
    expect(within(cards[0]).getByText('Upcoming')).toBeInTheDocument()
  })

  it('resolves the button links: a bound form page through its descriptor, a typed address as is', () => {
    renderWithProviders(<LandingPage model={model()} lang="en" track={mocks.track} />, { route: '/x?lang=en' })
    const [a, b] = screen.getAllByTestId('card-cta')
    expect(a).toHaveAttribute('href', `${ORIGIN}/forms/frm123`)
    expect(b).toHaveAttribute('href', 'https://opp.co/apply')
    expect(b).toHaveAttribute('target', '_blank')
    expect(b).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('"See more" toggles a long text (aria-expanded + label), short texts have no toggle', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LandingPage model={model()} lang="en" />, { route: '/x?lang=en' })
    const [first, second] = screen.getAllByTestId('landing-card')
    const toggle = within(first).getByTestId('card-see-more')
    expect(toggle).toHaveTextContent('See more')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveTextContent('See less')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(second).queryByTestId('card-see-more')).toBeNull()
  })

  it('Arabic: RTL root, Arabic content with fallback, Arabic fixed words', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LandingPage model={model()} lang="ar" />, { route: '/x?lang=ar' })
    expect(screen.getByTestId('landing-page')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('heading', { level: 1, name: 'ساعد شخصًا' })).toBeInTheDocument()
    expect(screen.getByTestId('nav-cards')).toHaveTextContent('الفرص')
    expect(within(screen.getAllByTestId('landing-card')[0]).getByTestId('card-see-more')).toHaveTextContent('عرض المزيد')
    expect(screen.getByText('قائمة الانتظار')).toBeInTheDocument()
    await user.click(within(screen.getAllByTestId('landing-card')[0]).getByTestId('card-share'))
    expect(await screen.findByRole('dialog', { name: 'مشاركة' })).toBeInTheDocument()
  })

  it('CTA clicks are counted per card; preview mode records nothing and does not navigate', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<LandingPage model={model()} lang="en" track={mocks.track} />, { route: '/x?lang=en' })
    const a = screen.getAllByTestId('card-cta')[0]
    a.addEventListener('click', (e) => e.preventDefault())
    await user.click(a)
    expect(mocks.track).toHaveBeenCalledWith('cta_click', { cardId: A })
    unmount()
    mocks.track.mockClear()
    renderWithProviders(<LandingPage model={model()} lang="en" track={mocks.track} mode="preview" />, { route: '/x?lang=en' })
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    screen.getAllByTestId('card-cta')[0].dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('a same-tab button waits (at most ~400 ms) for the analytics request before leaving; a ctrl-click and a new-tab link keep their default', async () => {
    mocks.track.mockResolvedValue(true)
    renderWithProviders(<LandingPage model={model()} lang="en" track={mocks.track} />, { route: '/x?lang=en' })
    const seen = []
    const spy = (e) => { seen.push(e.defaultPrevented); e.preventDefault() } // runs after React's handler; also stops jsdom from navigating
    document.addEventListener('click', spy)
    const [same, newTab] = screen.getAllByTestId('card-cta')
    same.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    same.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }))
    newTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    document.removeEventListener('click', spy)
    expect(seen).toEqual([true, false, false])
    expect(mocks.track).toHaveBeenCalledTimes(3)
  })

  it('a page without hero text / cover and without cards renders nothing but the sections that exist', () => {
    renderWithProviders(<LandingPage model={modelFromPayload({ config: { personalize: { enabled: true, title: { en: 'Only photo' } } }, cards: [], frames: [] })} lang="en" />, { route: '/x?lang=en' })
    expect(screen.queryByTestId('landing-hero')).toBeNull()
    expect(screen.queryByTestId('landing-cards')).toBeNull()
    expect(screen.getByTestId('personalize-section')).toBeInTheDocument()
  })

  it('tab mode has no navigation bar (the host\'s tab bar is the navigation)', () => {
    renderWithProviders(<LandingPage model={model()} lang="en" mode="tab" />, { route: '/x?lang=en' })
    expect(screen.queryByRole('navigation', { name: 'Page navigation' })).toBeNull()
  })
})

describe('share dialog (07 section 5)', () => {
  async function open() {
    const user = setupUser()
    renderWithProviders(<LandingPage model={modelFromPayload(publicPayload())} lang="en" track={mocks.track} />, { route: '/x?lang=en' })
    await user.click(within(screen.getAllByTestId('landing-card')[0]).getByTestId('card-share'))
    const dialog = await screen.findByTestId('share-dialog')
    return { user, dialog }
  }

  it('lists the configured channels in order with the exact URLs (source-tagged form link, {link} replaced everywhere)', async () => {
    const { dialog } = await open()
    const link = `${ORIGIN}/forms/frm123`
    expect([...dialog.querySelectorAll('li a, li button')].map((x) => x.dataset.testid)).toEqual(['share-whatsapp', 'share-facebook', 'share-instagram', 'share-telegram', 'share-copy'])
    expect(within(dialog).getByTestId('share-whatsapp')).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(`Join ${link}?source=whatsapp and ${link}?source=whatsapp`)}`)
    expect(within(dialog).getByTestId('share-telegram')).toHaveAttribute('href', `https://t.me/share/url?url=${encodeURIComponent(`${link}?source=telegram`)}&text=${encodeURIComponent('Telegram')}`)
    expect(within(dialog).getByTestId('share-facebook')).toHaveAttribute('href', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${link}?source=facebook`)}`)
    expect(within(dialog).getByTestId('share-whatsapp')).toHaveAttribute('target', '_blank')
    expect(within(dialog).getByRole('textbox', { name: 'Link' })).toHaveValue(link)
  })

  it('WhatsApp counts a share; Facebook copies the text FIRST (it cannot prefill) and says to paste; Instagram only copies', async () => {
    const { user, dialog } = await open()
    const link = `${ORIGIN}/forms/frm123`
    const wa = within(dialog).getByTestId('share-whatsapp')
    wa.addEventListener('click', (e) => e.preventDefault())
    await user.click(wa)
    expect(mocks.track).toHaveBeenCalledWith('card_share', { cardId: A, platform: 'whatsapp' })
    const fb = within(dialog).getByTestId('share-facebook')
    fb.addEventListener('click', (e) => e.preventDefault())
    await user.click(fb)
    expect(clipboard.writeText).toHaveBeenCalledWith(`FB text ${link}?source=facebook`)
    expect(await within(dialog).findByText('Text copied. Paste it into your Facebook post.')).toBeInTheDocument()
    expect(mocks.track).toHaveBeenCalledWith('card_share', { cardId: A, platform: 'facebook' })
    await user.click(within(dialog).getByTestId('share-instagram'))
    expect(clipboard.writeText).toHaveBeenLastCalledWith(`IG ${link}?source=instagram`)
    expect(await within(dialog).findByText(/Open Instagram and paste it/)).toBeInTheDocument()
    expect(mocks.track).toHaveBeenCalledWith('card_share', { cardId: A, platform: 'instagram' })
  })

  it('Copy text / Copy link record share_copy; a refused clipboard shows the text to copy by hand', async () => {
    const { user, dialog } = await open()
    await user.click(within(dialog).getByTestId('share-copy'))
    expect(mocks.track).toHaveBeenCalledWith('share_copy', { cardId: A, platform: 'copy' })
    await user.click(within(dialog).getByTestId('share-copy-link'))
    expect(clipboard.writeText).toHaveBeenLastCalledWith(`${ORIGIN}/forms/frm123`)
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    document.execCommand = vi.fn(() => false)
    await user.click(within(dialog).getByTestId('share-copy'))
    expect(await within(dialog).findByTestId('share-manual')).toHaveValue(`Copy ${ORIGIN}/forms/frm123?source=copy`)
    expect(within(dialog).getByTestId('share-notice')).toHaveTextContent('Could not copy')
  })

  it('the OS share sheet is offered first where the browser has it', async () => {
    navigator.share = vi.fn().mockResolvedValue(undefined)
    const { user, dialog } = await open()
    await user.click(within(dialog).getByTestId('share-native'))
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ url: `${ORIGIN}/forms/frm123`, title: 'Do you know a founder?' }))
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('card_share', { cardId: A, platform: 'native' }))
    delete navigator.share
  })
})

describe('Personalize the Moment (browser-only photo + frame)', () => {
  const frames = (n) => Array.from({ length: n }, (_, i) => ({ id: [FR1, FR2][i], name: `Frame ${i + 1}`, image_path: `${P}/landing/f${i + 1}.png`, window_x: 90, window_y: 90, window_w: 900, window_h: 930, window_shape: 'rect' }))
  const mount = (n = 1, extra = {}) => renderWithProviders(<LandingPage model={modelFromPayload(publicPayload({ frames: frames(n), cards: [], ...extra }))} lang="en" track={mocks.track} slug="my-page" />, { route: '/x?lang=en' })
  const pick = async (file = new File(['x'], 'me.jpg', { type: 'image/jpeg' })) => {
    fireEvent.change(await screen.findByTestId('photo-input'), { target: { files: [file] } })
  }

  it('shows the empty frame with the frame overlay, the choose button and the privacy note; no picker for ONE frame', async () => {
    mount(1)
    expect(await screen.findByTestId('choose-photo')).toHaveTextContent('Choose Photo')
    expect(screen.getByTestId('photo-frame-overlay')).toHaveAttribute('src', `http://files/${P}/landing/f1.png`)
    expect(screen.getByText('Your photo stays on your device: it is never uploaded.')).toBeInTheDocument()
    expect(screen.queryByTestId('frame-picker')).toBeNull()
  })

  it('choosing a photo composites photo + frame on the device, shows Download / Edit / Upload different, and counts the upload', async () => {
    mount(1)
    await pick()
    expect(await screen.findByTestId('photo-result')).toBeInTheDocument()
    expect(mocks.decode).toHaveBeenCalledTimes(1)
    expect(mocks.loadFrame).toHaveBeenCalledWith(`http://files/${P}/landing/f1.png`)
    expect(mocks.compose).toHaveBeenCalledTimes(1)
    expect(mocks.compose.mock.calls[0][1]).toMatchObject({ photoW: 2000, photoH: 1000, frame: { name: 'frame-bitmap' }, transform: { scale: 1, nx: 0, ny: 0 } })
    expect(mocks.track).toHaveBeenCalledWith('image_upload')
    expect(screen.queryByTestId('choose-photo')).toBeNull()
    const dl = screen.getByTestId('download-photo')
    expect(dl).toHaveAttribute('download', 'my-page-athar.png')
    expect(dl.getAttribute('href')).toMatch(/^blob:/)
    expect(screen.getByTestId('edit-photo')).toBeInTheDocument()
    expect(screen.getByTestId('change-photo')).toHaveTextContent('Upload Different Photo')
    fireEvent.click(dl, { defaultPrevented: true })
    expect(mocks.track).toHaveBeenCalledWith('image_download')
  })

  it('the crop dialog: zoom slider, reset, apply recomposes with the new transform; cancel changes nothing', async () => {
    const user = userEvent.setup()
    mount(1)
    await pick()
    await screen.findByTestId('photo-result')
    await user.click(screen.getByTestId('edit-photo'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit & Crop Photo' })
    expect(within(dialog).getByTestId('crop-frame')).toHaveAttribute('src', `http://files/${P}/landing/f1.png`)
    const slider = within(dialog).getByTestId('crop-zoom')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '3.5')
    fireEvent.change(slider, { target: { value: '2' } })
    expect(slider).toHaveValue('2')
    await user.click(within(dialog).getByTestId('crop-reset'))
    expect(slider).toHaveValue('1')
    fireEvent.change(slider, { target: { value: '2.5' } })
    fireEvent.keyDown(within(dialog).getByTestId('crop-viewport'), { key: 'ArrowRight' })
    await user.click(within(dialog).getByTestId('crop-apply'))
    await waitFor(() => expect(mocks.compose).toHaveBeenCalledTimes(2))
    expect(mocks.compose.mock.calls[1][1].transform.scale).toBeCloseTo(2.5)
    expect(screen.queryByRole('dialog', { name: 'Edit & Crop Photo' })).toBeNull()
    await user.click(screen.getByTestId('edit-photo'))
    await user.click(await screen.findByTestId('crop-cancel'))
    expect(mocks.compose).toHaveBeenCalledTimes(2)
  })

  it('wheel and keyboard zoom work in the crop viewport (never past 3.5x)', async () => {
    const user = userEvent.setup()
    mount(1)
    await pick()
    await screen.findByTestId('photo-result')
    await user.click(screen.getByTestId('edit-photo'))
    const vp = await screen.findByTestId('crop-viewport')
    const slider = screen.getByTestId('crop-zoom')
    fireEvent.wheel(vp, { deltaY: -400 })
    expect(Number(slider.value)).toBeGreaterThan(1.5)
    fireEvent.keyDown(vp, { key: '+' })
    const after = Number(slider.value)
    fireEvent.wheel(vp, { deltaY: -100000 })
    expect(Number(slider.value)).toBe(3.5)
    expect(after).toBeLessThan(3.5)
    fireEvent.keyDown(vp, { key: '0' })
    expect(Number(slider.value)).toBe(1)
  })

  it('more than one frame shows a picker; choosing another frame recomposes with that frame', async () => {
    const user = userEvent.setup()
    mount(2)
    expect(await screen.findByTestId('frame-picker')).toBeInTheDocument()
    await pick()
    await screen.findByTestId('photo-result')
    mocks.loadFrame.mockClear()
    await user.click(screen.getByRole('radio', { name: 'Frame 2' }))
    await waitFor(() => expect(mocks.compose).toHaveBeenCalledTimes(2))
    expect(mocks.loadFrame).toHaveBeenCalledWith(`http://files/${P}/landing/f2.png`)
  })

  it('a file that is not an image, or cannot be decoded, shows a clear message and keeps the page usable', async () => {
    mount(1)
    await pick(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
    expect(await screen.findByTestId('photo-error')).toHaveTextContent('Please choose an image file.')
    mocks.decode.mockRejectedValueOnce(new Error('bad'))
    await pick()
    await waitFor(() => expect(screen.getByTestId('photo-error')).toHaveTextContent('could not be read'))
    expect(screen.getByTestId('choose-photo')).toBeInTheDocument()
    expect(mocks.track).not.toHaveBeenCalledWith('image_upload')
  })

  it('preview mode (the editor) records nothing', async () => {
    renderWithProviders(<LandingPage model={modelFromPayload(publicPayload({ cards: [] }))} lang="en" track={mocks.track} mode="preview" />, { route: '/x?lang=en' })
    await pick()
    await screen.findByTestId('photo-result')
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('the Arabic labels and the PM\'s own button labels are used when set', async () => {
    renderWithProviders(<LandingPage model={modelFromPayload(publicPayload({ cards: [], config: { personalize: { enabled: true, title: { en: 'P' }, labels: { choose: { en: 'Pick your selfie', ar: 'اختر سيلفي' } } } } }))} lang="ar" />, { route: '/x?lang=ar' })
    expect(await screen.findByTestId('choose-photo')).toHaveTextContent('اختر سيلفي')
    expect(within(screen.getByTestId('personalize-section')).getByText('صورتك')).toBeInTheDocument()
  })
})

describe('public pages and analytics', () => {
  const ref = 'ph4yyxwggk'
  const renderPublic = (payload, route = `/view/${ref}/landing?lang=en`) => {
    mocks.getPublic.mockResolvedValue(payload)
    return renderWithProviders(<Routes><Route path="view/:nodeRef/landing" element={<PublicLandingPage />} /></Routes>, { route })
  }

  it('/view/:ref/landing renders the page, sets the title from SEO / hero and counts ONE tab_view (ref only, no node id)', async () => {
    renderPublic({ type: 'landing_page', node_id: 'L', viewer: 'public', title_en: 'Landing', project: { name_en: 'Proj' }, data: publicPayload({ config: { ...publicPayload().config, seo: { title: { en: 'SEO title' } } } }) })
    expect(await screen.findByTestId('public-landing-page')).toBeInTheDocument()
    expect(await screen.findAllByTestId('landing-card')).toHaveLength(2)
    await waitFor(() => expect(document.title).toBe('SEO title - Athar'))
    await waitFor(() => expect(mocks.track).toHaveBeenCalledTimes(1))
    expect(mocks.track).toHaveBeenCalledWith(ref, 'tab_view', { cardId: null, platform: null, nodeId: null })
  })

  it('nothing is counted for a project manager previewing', async () => {
    renderPublic({ node_id: 'L', viewer: 'pm', data: publicPayload() })
    await screen.findByTestId('public-landing-page')
    expect(mocks.track).not.toHaveBeenCalled()
  })
  it('nothing is counted with ?notrack', async () => {
    renderPublic({ node_id: 'L', viewer: 'public', data: publicPayload() }, `/view/${ref}/landing?lang=en&notrack=1`)
    await screen.findByTestId('public-landing-page')
    expect(mocks.track).not.toHaveBeenCalled()
  })
  it('analytics off in the config: nothing is counted', async () => {
    renderPublic({ node_id: 'L', viewer: 'public', data: publicPayload({ config: { ...publicPayload().config, analytics: { enabled: false } } }) })
    await screen.findByTestId('public-landing-page')
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('an unknown / private page shows the not-available state, never a crash', async () => {
    renderPublic(null)
    expect(await screen.findByText('This page is not available')).toBeInTheDocument()
  })

  it('as an Agenda tab: the host\'s ref + the landing node id are sent with every event (the DB checks the edge)', async () => {
    renderWithProviders(<Routes><Route path="agenda/:ref/:tab" element={<LandingTab data={publicPayload()} audience="public" />} /></Routes>, { route: '/agenda/agenda123/landing?lang=en' })
    expect(screen.getByTestId('landing-page')).toHaveAttribute('data-mode', 'tab')
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('agenda123', 'tab_view', { cardId: null, platform: null, nodeId: 'L' }))
    const a = screen.getAllByTestId('card-cta')[1]
    a.addEventListener('click', (e) => e.preventDefault())
    await userEvent.setup().click(a)
    expect(mocks.track).toHaveBeenCalledWith('agenda123', 'cta_click', { cardId: B, platform: null, nodeId: 'L' })
  })
})

// ------------------------------------------------------------------ builder
const node = (over = {}) => ({ id: 'L', project_id: P, type: 'landing_page', type_version: 1, name_en: 'Landing', name_ar: 'هبوط', visibility: 'public', show_to_participants: false, config: {}, rev: 1, ...over })
const graph = {
  project: { id: P, timezone: 'Africa/Cairo' },
  nodes: [{ id: 'L', type: 'landing_page', name_en: 'Landing' }, { id: 'F', type: 'form_builder', name_en: 'Apply form', name_ar: 'نموذج التقديم' }],
  edges: [{ id: 'e1', from_node_id: 'F', from_port: 'link', to_node_id: 'L', to_port: 'links', is_enabled: true, audience: 'public' }],
}
function mount(mode, over = {}) {
  const n = node(over)
  const adapter = createMemoryAdapter({ nodes: [n], edges: graph.edges })
  renderWithProviders(<NodeHost mode={mode} node={n} graph={graph} projectId={P} adapter={adapter} />, { route: `/projects/${P}/nodes/L?lang=en` })
  return adapter
}
const defRows = () => ({
  cards: [
    cardRow(A, { cover_path: `${P}/landing/old.webp`, presets: { whatsapp: 'Hi {link}' }, cta_url: 'https://old.example/apply' }),
    cardRow(B, { sort_order: 1, title_en: 'Wait list', title_ar: null, cta_url: '#' }),
  ],
  frames: [{ id: FR1, name: 'Frame 1', image_path: `${P}/landing/f1.png`, window_x: 90, window_y: 90, window_w: 900, window_h: 930, window_shape: 'rect' }],
})
const savedConfig = { hero: { title: { en: 'Hello', ar: '' } }, personalize: { enabled: true, title: { en: 'Photo', ar: '' } }, secretKey: 'kept' }

describe('Edit (the builder)', () => {
  it('a fresh node offers the starter template explicitly; applying it adds the two cards and ONE save writes config + children with stable uuids', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue({ cards: [], frames: [] })
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    await user.click(await screen.findByTestId('use-starter'))
    expect(await screen.findAllByTestId('card-row')).toHaveLength(2)
    expect(screen.queryByTestId('use-starter')).toBeNull()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(spy).toHaveBeenCalledTimes(1)
    const [, , patch, opts] = spy.mock.calls[0]
    expect(patch.config.hero.title.en).toBe('Help Someone Find Their Next Opportunity.')
    expect(patch.config.personalize.enabled).toBe(true)
    expect(opts.children.cards).toHaveLength(2)
    expect(opts.children.cards.every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true)
    expect(opts.children.cards.map((c) => c.sort_order)).toEqual([0, 1])
    expect(opts.children.cards[0]).toMatchObject({ title_en: 'Do you know a founder needs support?', cta_label_ar: 'شارك البرنامج القادم', share_enabled: true, cta_dot: true })
    expect(opts.children.frames).toEqual([])
    expect(await screen.findByText('Landing page saved.')).toBeInTheDocument()
  })

  it('an existing page: edits keep the card ids, new cards get a uuid, a removed card is gone (Undo brings it back), the config keeps unknown keys', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue(defRows())
    const adapter = mount('edit', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    const rows = await screen.findAllByTestId('card-row')
    expect(rows).toHaveLength(2)
    await user.click(within(rows[0]).getByTestId('card-toggle'))
    const editor = await screen.findByTestId('card-editor')
    const title = within(editor).getAllByLabelText('English')[1] // [chip, title, body, button label]
    await user.clear(title)
    await user.type(title, 'Renamed card')
    await user.click(within(rows[1]).getByTestId('remove-card'))
    expect(await screen.findByText('Card removed from the draft.')).toBeInTheDocument()
    expect(screen.getAllByTestId('card-row')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getAllByTestId('card-row')).toHaveLength(2)
    await user.click(within(screen.getAllByTestId('card-row')[1]).getByTestId('remove-card'))
    expect(screen.getAllByTestId('card-row')).toHaveLength(1)
    await user.click(screen.getByTestId('add-card'))
    expect(screen.getAllByTestId('card-row')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const [, , patch, opts] = spy.mock.calls[0]
    expect(patch.config.secretKey).toBe('kept')
    expect(opts.children.cards).toHaveLength(2)
    expect(opts.children.cards[0]).toMatchObject({ id: A, sort_order: 0, title_en: 'Renamed card', cover_path: `${P}/landing/old.webp`, presets: { whatsapp: 'Hi {link}' } })
    expect(opts.children.cards.map((c) => c.id)).not.toContain(B)
    expect(opts.children.cards[1].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(opts.children.frames[0]).toMatchObject({ id: FR1, image_path: `${P}/landing/f1.png`, window_w: 900, aspect: '4:5' })
  })

  it('the button can be bound to a page of the project (the `link` port): the node id is saved and the typed url is dropped', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue(defRows())
    const adapter = mount('edit', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    await user.click(within((await screen.findAllByTestId('card-row'))[0]).getByTestId('card-toggle'))
    await user.click(await screen.findByTestId(`${A}-cta-node`))
    const select = await screen.findByTestId(`${A}-cta-select`)
    expect(within(select).getByRole('option', { name: 'Form - Apply form' })).toBeInTheDocument()
    await user.selectOptions(select, 'F')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][3].children.cards[0]).toMatchObject({ id: A, cta_node_id: 'F', cta_url: null })
  })

  it('validation: a javascript: link blocks the save with a message on the field', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue(defRows())
    const adapter = mount('edit', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    await user.click(within((await screen.findAllByTestId('card-row'))[0]).getByTestId('card-toggle'))
    const url = await screen.findByTestId(`${A}-cta-input`)
    await user.clear(url)
    await user.type(url, 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Fix the highlighted fields first.')).toBeInTheDocument()
    expect(screen.getByText(/Use a web address/)).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('Share texts: the PM writes a text per platform with {link}; the editor shows the final text and exact URL; the preset is saved on the card', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue(defRows())
    const adapter = mount('edit', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findAllByTestId('card-row')
    await user.click(screen.getByTestId('tab-share'))
    const cards = await screen.findAllByTestId('share-card')
    const wa = within(within(cards[0]).getByTestId('preset-whatsapp')).getByRole('textbox')
    fireEvent.change(wa, { target: { value: 'Join {link} & share {link}' } })
    const target = 'https://old.example/apply'
    expect(within(cards[0]).getByTestId('final-whatsapp')).toHaveTextContent(`Join ${target} & share ${target}`)
    expect(within(cards[0]).getByTestId('href-whatsapp')).toHaveTextContent(`https://wa.me/?text=${encodeURIComponent(`Join ${target} & share ${target}`)}`)
    expect(within(cards[0]).getByTestId('final-instagram')).toHaveTextContent('Do you know a founder? ' + target)
    expect(within(cards[0]).getAllByText(/cannot receive a ready text|paste it into your post/i).length).toBeGreaterThan(0)
    await user.click(within(cards[0]).getByTestId('preset-telegram').querySelector('button'))
    expect(within(within(cards[0]).getByTestId('preset-telegram')).getByRole('textbox').value).toContain('{link}')
    await user.click(screen.getByTestId('channel-instagram'))
    expect(within(cards[0]).queryByTestId('preset-instagram')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const [, , patch, opts] = spy.mock.calls[0]
    expect(opts.children.cards[0].presets.whatsapp).toBe('Join {link} & share {link}')
    expect(patch.config.share.channels).not.toContain('instagram')
  })

  it('Photo section: frames are validated in the browser (bad ones listed), good ones are uploaded and saved with their window; removing offers Undo', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue({ cards: [], frames: [] })
    const adapter = mount('edit', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    await user.click(await screen.findByTestId('tab-photo'))
    mocks.inspect.mockResolvedValueOnce({ problems: ['aspect', 'noWindow'], width: 1080, height: 1080, window: null })
    fireEvent.change(await screen.findByTestId('frame-input'), { target: { files: [new File(['x'], 'bad.png', { type: 'image/png' })] } })
    const problems = await screen.findByTestId('frame-problems')
    expect(problems).toHaveTextContent('It must be 4:5')
    expect(problems).toHaveTextContent('no transparent window')
    expect(mocks.uploadFrame).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('frame-input'), { target: { files: [new File(['x'], 'athar-frame.png', { type: 'image/png' })] } })
    expect(await screen.findAllByTestId('frame-row')).toHaveLength(1)
    expect(mocks.uploadFrame).toHaveBeenCalledWith(expect.any(File), { projectId: P })
    expect(screen.getByText(/Photo window: 900 × 930 px/)).toBeInTheDocument()
    await user.click(screen.getByTestId('remove-frame'))
    expect(screen.queryAllByTestId('frame-row')).toHaveLength(0)
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(screen.getAllByTestId('frame-row')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][3].children.frames[0]).toMatchObject({ name: 'athar-frame', image_path: `${P}/landing/frame-new.png`, window_x: 90, window_w: 900, window_h: 930, aspect: '4:5' })
  })

  it('after Save the files the page no longer references are removed (a replaced cover, a removed frame) and nothing else', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue(defRows())
    const adapter = mount('edit', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    const rows = await screen.findAllByTestId('card-row')
    await user.click(within(rows[0]).getByTestId('card-toggle'))
    await user.click(within(await screen.findByTestId('card-editor')).getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByTestId('tab-photo'))
    await user.click(await screen.findByTestId('remove-frame'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.removeFiles).toHaveBeenCalledWith([`${P}/landing/f1.png`]))
    expect(mocks.removeImage).toHaveBeenCalledWith(`${P}/landing/old.webp`)
    expect(mocks.removeImage).toHaveBeenCalledTimes(1)
  })

  it('the live preview shows the UNSAVED draft in the public renderer, in the chosen language, without recording anything', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue({ cards: [], frames: [] })
    mount('edit')
    await user.click(await screen.findByTestId('use-starter'))
    const preview = await screen.findByTestId('landing-preview')
    expect(await within(preview).findByRole('heading', { level: 1, name: 'Help Someone Find Their Next Opportunity.' })).toBeInTheDocument()
    await user.click(within(preview).getByRole('button', { name: 'AR' }))
    expect(await within(preview).findByRole('heading', { level: 1, name: 'ساعد شخصًا ما على إيجاد فرصته القادمة.' })).toBeInTheDocument()
    expect(within(preview).getByTestId('landing-page')).toHaveAttribute('data-mode', 'preview')
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('Analytics tab: tiles, per-card counts by stable id, shares by platform', async () => {
    const user = userEvent.setup()
    mocks.getDef.mockResolvedValue(defRows())
    mount('edit', { config: savedConfig })
    await screen.findAllByTestId('card-row')
    await user.click(screen.getByTestId('tab-analytics'))
    expect(await screen.findByTestId('tile-tab_view')).toHaveTextContent('7')
    expect(screen.getByTestId('tile-cta_click')).toHaveTextContent('3')
    expect(screen.getByTestId('tile-shares')).toHaveTextContent('3')
    const rows = screen.getAllByTestId('analytics-card-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Do you know a founder?')
    expect(rows[0].textContent).toMatch(/3/)
    expect(screen.getByText('WhatsApp: 2')).toBeInTheDocument()
  })
})

describe('Settings and View', () => {
  it('Settings: ONE save with name + visibility + SEO + analytics switch; creating the link shows /view/<slug>/landing', async () => {
    const user = userEvent.setup()
    mocks.ensureLink.mockImplementation(async () => {
      mocks.getLink.mockResolvedValue({ linkId: 'lk', slug: 'ph4yyxwggk', enabled: true })
      return { slug: 'ph4yyxwggk' }
    })
    const adapter = mount('settings', { config: savedConfig })
    const spy = vi.spyOn(adapter, 'saveNode')
    await user.click(await screen.findByTestId('create-link'))
    expect(await screen.findByTestId('public-url')).toHaveTextContent(/\/view\/ph4yyxwggk\/landing$/)
    await user.type(screen.getAllByLabelText('English')[0], ' page')
    fireEvent.change(screen.getAllByLabelText('English')[1], { target: { value: 'SEO headline' } })
    await user.click(screen.getByTestId('analytics-enabled'))
    await user.click(screen.getByTestId('show-to-participants'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const [, , patch, opts] = spy.mock.calls[0]
    expect(patch).toMatchObject({ name_en: 'Landing page', visibility: 'public', show_to_participants: true })
    expect(patch.config.seo.title.en).toBe('SEO headline')
    expect(patch.config.analytics.enabled).toBe(false)
    expect(patch.config.secretKey).toBe('kept')
    expect(opts.children).toBeNull()
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('View: the saved page through the same renderer, preview mode, with an open-page action once the link exists', async () => {
    mocks.getLink.mockResolvedValue({ slug: 'ph4yyxwggk', enabled: true })
    mocks.getDef.mockResolvedValue(defRows())
    mount('view', { config: { ...savedConfig, hero: { title: { en: 'Saved hero', ar: '' } } } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Saved hero' })).toBeInTheDocument()
    expect(screen.getByTestId('landing-page')).toHaveAttribute('data-mode', 'preview')
    expect(await screen.findByRole('link', { name: /Open public page/ })).toHaveAttribute('href', expect.stringMatching(/\/view\/ph4yyxwggk\/landing\?lang=en$/))
    expect(mocks.track).not.toHaveBeenCalled()
  })
})

describe('founder exposure', () => {
  it('FounderLandingButtons: one button per exposed landing (label = the node name, opens /view/<ref>/landing), nothing when none', async () => {
    mocks.founder.mockResolvedValueOnce([{ node_id: 'L', name_en: 'Share the opportunity page', name_ar: 'صفحة الفرصة', ref: 'ph4yyxwggk' }, { node_id: 'X', name_en: 'No link yet', ref: null }])
    const { unmount } = renderWithProviders(<FounderLandingButtons projectId={P} />, { route: '/alumni/founder/programs/x?lang=en' })
    const link = await screen.findByRole('link', { name: 'Open "Share the opportunity page"' })
    expect(link).toHaveAttribute('href', '/view/ph4yyxwggk/landing?lang=en')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    unmount()
    mocks.founder.mockResolvedValueOnce([])
    renderWithProviders(<FounderLandingButtons projectId={P} />, { route: '/alumni/founder/programs/x?lang=en' })
    await waitFor(() => expect(mocks.founder).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('founder-landing-buttons')).toBeNull()
  })
})
