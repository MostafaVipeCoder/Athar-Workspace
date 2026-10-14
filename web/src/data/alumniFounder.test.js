import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A query builder that records its calls and resolves to `result` when awaited (the supabase-js builders are thenables). */
function chain(result) {
  const c = {}
  for (const m of ['select', 'order', 'limit', 'eq', 'update', 'insert', 'single']) c[m] = vi.fn(() => c)
  c.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return c
}

const mocks = vi.hoisted(() => ({ from: vi.fn(), createSignedUrl: vi.fn(), signUp: vi.fn(), storeImage: vi.fn(), uploadImage: vi.fn(), listMyCertificates: vi.fn() }))
vi.mock('./client.js', () => ({
  db: () => ({ from: mocks.from, storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) }, auth: { signUp: mocks.signUp } }),
}))
vi.mock('./storage.js', () => ({ storeImage: mocks.storeImage, uploadImage: mocks.uploadImage }))
vi.mock('./certificates.js', () => ({ listMyCertificates: mocks.listMyCertificates }))

const N = await import('./founderNotifications.js')
const F = await import('./alumniFounder.js')
const { signUpFounder } = await import('./auth.js')
const { AppError } = await import('./errors.js')

beforeEach(() => vi.clearAllMocks())

describe('founderNotifications.js (the founder\'s own rows: RLS decides, m50 limits the update to is_read)', () => {
  it('lists newest first with one extra row to know there is more', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, title: 't', body: 'b', is_read: false, created_at: '2026-10-14' }))
    const c = chain({ data: rows, error: null })
    mocks.from.mockReturnValue(c)
    const r = await N.listMyNotifications({ limit: 3 })
    expect(mocks.from).toHaveBeenCalledWith('notifications')
    expect(c.limit).toHaveBeenCalledWith(4)
    expect(c.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(r.rows).toHaveLength(3)
    expect(r.hasMore).toBe(true)
    expect(c.eq).not.toHaveBeenCalled()
  })

  it('"unread" filters on the server', async () => {
    const c = chain({ data: [], error: null })
    mocks.from.mockReturnValue(c)
    await N.listMyNotifications({ unreadOnly: true })
    expect(c.eq).toHaveBeenCalledWith('is_read', false)
  })

  it('the unread badge is a head count (no rows travel)', async () => {
    const c = chain({ count: 7, error: null })
    mocks.from.mockReturnValue(c)
    await expect(N.countMyUnreadNotifications()).resolves.toBe(7)
    expect(c.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(c.eq).toHaveBeenCalledWith('is_read', false)
    mocks.from.mockReturnValue(chain({ count: null, error: null }))
    await expect(N.countMyUnreadNotifications()).resolves.toBe(0)
  })

  it('mark read touches only is_read; mark all covers only the unread rows', async () => {
    const c = chain({ data: null, error: null })
    mocks.from.mockReturnValue(c)
    await N.setNotificationRead('n1', true)
    expect(c.update).toHaveBeenCalledWith({ is_read: true })
    expect(c.eq).toHaveBeenCalledWith('id', 'n1')
    await N.setNotificationRead('n1', false)
    expect(c.update).toHaveBeenLastCalledWith({ is_read: false })
    await N.markAllNotificationsRead()
    expect(c.update).toHaveBeenLastCalledWith({ is_read: true })
    expect(c.eq).toHaveBeenLastCalledWith('is_read', false)
  })

  it('a database error becomes an AppError', async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { code: '42501', message: 'denied' } }))
    await expect(N.listMyNotifications()).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('opportunities and applications', () => {
  it('lists the active opportunities in the manager\'s order', async () => {
    const c = chain({ data: [{ opportunity_id: 'o1' }], error: null })
    mocks.from.mockReturnValue(c)
    await expect(F.listOpportunities()).resolves.toEqual([{ opportunity_id: 'o1' }])
    expect(mocks.from).toHaveBeenCalledWith('opportunities')
    expect(c.eq).toHaveBeenCalledWith('is_active', true)
    expect(c.order).toHaveBeenCalledWith('order_index', { ascending: true })
  })

  it('applying sends only the opportunity, the company and the note: the status is the server\'s (m50)', async () => {
    const c = chain({ data: { id: 'a1', status: 'applied' }, error: null })
    mocks.from.mockReturnValue(c)
    await expect(F.applyToOpportunity({ opportunityId: 'o1', companyId: 'c1', notes: '  We fit  ' })).resolves.toMatchObject({ status: 'applied' })
    expect(mocks.from).toHaveBeenCalledWith('opportunity_applications')
    expect(c.insert).toHaveBeenCalledWith({ opportunity_id: 'o1', company_id: 'c1', notes: 'We fit' })
    await F.applyToOpportunity({ opportunityId: 'o1', companyId: 'c1' })
    expect(c.insert).toHaveBeenLastCalledWith({ opportunity_id: 'o1', company_id: 'c1', notes: null })
  })

  it('a second application of the same company is a conflict with its own message', async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { code: '23505', message: 'duplicate key' } }))
    await expect(F.applyToOpportunity({ opportunityId: 'o1', companyId: 'c1' })).rejects.toMatchObject({ code: 'conflict', messageKey: 'alumni.opp.alreadyApplied' })
  })

  it('a closed opportunity keeps the m50 token', async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { code: '22023', message: 'opportunity_closed: this opportunity is not open', hint: 'opportunity_closed' } }))
    await expect(F.applyToOpportunity({ opportunityId: 'o1', companyId: 'c1' })).rejects.toMatchObject({ messageKey: 'alumni.err.opportunityClosed', token: 'opportunity_closed' })
  })
})

describe('images go through data/storage.js only (WebP)', () => {
  it('the founder photo is stored in founder-assets under the account\'s own folder with the avatar profile', async () => {
    mocks.storeImage.mockImplementation(async (file, opts) => ({ path: opts.path('webp') }))
    const path = await F.uploadFounderPhoto({}, 'user-1')
    expect(path).toMatch(/^founders\/user-1\/photo\/[0-9a-f-]{36}\.webp$/)
    expect(mocks.storeImage).toHaveBeenCalledWith({}, expect.objectContaining({ bucket: 'founder-assets', profile: 'avatar' }))
  })

  it('the company logo is filed under alumni/<account>/logo with the avatar profile (no SVG)', async () => {
    mocks.uploadImage.mockResolvedValue('alumni/user-1/logo/x.webp')
    await expect(F.uploadCompanyLogo({}, 'user-1')).resolves.toBe('alumni/user-1/logo/x.webp')
    expect(mocks.uploadImage).toHaveBeenCalledWith({}, expect.objectContaining({ ownerId: 'alumni/user-1', kind: 'logo', profile: 'avatar' }))
  })

  it('the photo is shown through a signed URL of its thumbnail, with a fallback to the file itself', async () => {
    mocks.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://signed/thumb' }, error: null })
    await expect(F.signedFounderPhotoUrl('founders/u/photo/a.webp')).resolves.toBe('https://signed/thumb')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('founders/u/photo/a_t.webp', 3600)
    mocks.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } }).mockResolvedValueOnce({ data: { signedUrl: 'https://signed/full' }, error: null })
    await expect(F.signedFounderPhotoUrl('founders/u/photo/b.webp')).resolves.toBe('https://signed/full')
    await expect(F.signedFounderPhotoUrl('')).resolves.toBeNull()
  })
})

describe('signUpFounder (open sign-up and invitation sign-up)', () => {
  it('sends the name and, for an invitation, the token in the user metadata: never a role', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { access_token: 'x' }, user: { id: 'u1', identities: [{}] } }, error: null })
    const r = await signUpFounder({ email: ' a@b.co ', password: 'pw-long-enough', fullName: ' Nour ', invitationToken: 'tok' })
    expect(r.session).toBeTruthy()
    const arg = mocks.signUp.mock.calls[0][0]
    expect(arg.email).toBe('a@b.co')
    expect(arg.options.data).toEqual({ full_name: 'Nour', invitation_token: 'tok' })
    expect(JSON.stringify(arg)).not.toMatch(/role/i)
    await signUpFounder({ email: 'a@b.co', password: 'pw-long-enough', fullName: 'Nour' })
    expect(mocks.signUp.mock.calls[1][0].options.data).toEqual({ full_name: 'Nour' })
  })

  it('with e-mail confirmation ON there is no session', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1', identities: [{}] } }, error: null })
    await expect(signUpFounder({ email: 'a@b.co', password: 'pw-long-enough', fullName: 'N' })).resolves.toMatchObject({ session: null })
  })

  it('the CAPTCHA token is passed through when there is one', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null, user: { identities: [{}] } }, error: null })
    await signUpFounder({ email: 'a@b.co', password: 'pw-long-enough', fullName: 'N', captchaToken: 'cap' })
    expect(mocks.signUp.mock.calls[0][0].options.captchaToken).toBe('cap')
  })

  it('an existing address is "taken", with an error or with the obfuscated user GoTrue returns when confirmation is on', async () => {
    mocks.signUp.mockResolvedValueOnce({ data: null, error: { name: 'AuthApiError', code: 'user_already_exists', message: 'User already registered', status: 422 } })
    await expect(signUpFounder({ email: 'a@b.co', password: 'pw-long-enough', fullName: 'N' })).rejects.toMatchObject({ code: 'conflict', messageKey: 'alumni.auth.emailTaken' })
    mocks.signUp.mockResolvedValueOnce({ data: { session: null, user: { id: 'u', identities: [] } }, error: null })
    await expect(signUpFounder({ email: 'a@b.co', password: 'pw-long-enough', fullName: 'N' })).rejects.toMatchObject({ messageKey: 'alumni.auth.emailTaken' })
  })

  it('a weak password, a bad address, closed sign-up and a failed CAPTCHA have their own messages', async () => {
    const cases = [
      [{ code: 'weak_password', message: 'Password should be at least 6 characters', status: 422 }, 'alumni.auth.weakPassword'],
      [{ code: 'email_address_invalid', message: 'Email address is invalid', status: 400 }, 'alumni.auth.emailInvalid'],
      [{ code: 'signup_disabled', message: 'Signups not allowed', status: 422 }, 'alumni.auth.signupDisabled'],
      [{ code: 'captcha_failed', message: 'captcha verification process failed', status: 400 }, 'alumni.auth.captchaFailed'],
    ]
    for (const [error, key] of cases) {
      mocks.signUp.mockResolvedValueOnce({ data: null, error: { name: 'AuthApiError', ...error } })
      const err = await signUpFounder({ email: 'a@b.co', password: 'p', fullName: 'N' }).catch((e) => e)
      expect(err).toBeInstanceOf(AppError)
      expect(err.messageKey).toBe(key)
    }
  })

  it('a rate limit uses the generic message', async () => {
    mocks.signUp.mockResolvedValueOnce({ data: null, error: { name: 'AuthApiError', code: 'over_email_send_rate_limit', message: 'rate limit', status: 429 } })
    await expect(signUpFounder({ email: 'a@b.co', password: 'pw-long-enough', fullName: 'N' })).rejects.toMatchObject({ messageKey: 'errors.rateLimited' })
  })
})
