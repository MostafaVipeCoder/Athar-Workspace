import { describe, expect, it } from 'vitest'
import { canReissue, canRevokeAll, hasCertificates, issuable, issuableInBulk, issueBlocker, rowState, summarize, templateDraft, toChildren, validateDraft } from './certConfig.js'

/**
 * Per-founder issuance logic of the Issue panel (m42, owner decision 08 section 17.2). A row is a PARTICIPANT; its certificates belong to its
 * FOUNDER ACCOUNTS. These helpers decide what the PM may do per row and per founder from the server payload; the server re-checks everything.
 */
const person = (name, state, certificate = null, over = {}) => ({ name, state, linked: state !== 'not_linked', certificate, ...over })
const cert = (id, over = {}) => ({ id, code: `CODE-${id}`, issued_at: '2026-10-13T08:00:00Z', revoked_at: null, revoked_reason: null, ...over })
const grant = (over = {}) => ({ id: 'g', granted_at: '2026-10-13T08:00:00Z', revoked_at: null, revoked_reason: null, ...over })
const row = (over = {}) => ({ participant_id: 'p', status: 'attended', grant: null, founders: [], counts: { people: 0, linked: 0, unlinked: 0, issued: 0, claimable: 0, revoked: 0 }, ...over })

describe('row state (participant level)', () => {
  it('pending = not authorised yet; authorised = a grant with nobody holding a certificate; issued = at least one founder holds one; revoked = the grant was revoked', () => {
    expect(rowState(row())).toBe('pending')
    expect(rowState(row({ grant: grant() }))).toBe('authorised')
    expect(rowState(row({ grant: grant(), counts: { issued: 2 } }))).toBe('issued')
    expect(rowState(row({ grant: grant({ revoked_at: '2026-10-14T00:00:00Z' }) }))).toBe('revoked')
    expect(rowState(row({ counts: { issued: 1 } }))).toBe('issued') // an old certificate without a grant record still counts as issued
    expect(rowState(null)).toBe('pending')
  })
})

describe('who can be issued to', () => {
  it('"Issue to selected": a participant that is not authorised, whose authorisation was revoked, or that has a linked founder waiting - only when attended', () => {
    expect(issuable(row())).toBe(true)
    expect(issuable(row({ grant: grant({ revoked_at: 'x' }) }))).toBe(true)
    expect(issuable(row({ grant: grant(), counts: { claimable: 1, issued: 1 } }))).toBe(true)
    expect(issuable(row({ grant: grant(), counts: { issued: 2, claimable: 0 } }))).toBe(false) // everybody linked already has theirs
    expect(issuable(row({ status: 'accepted' }))).toBe(false)
    expect(issuable(row({ status: 'withdrawn' }))).toBe(false)
  })

  it('"Issue to all attended" leaves a participant revoked as a whole alone (it is re-authorised on purpose), but serves a waiting founder', () => {
    expect(issuableInBulk(row())).toBe(true)
    expect(issuableInBulk(row({ grant: grant(), counts: { claimable: 1 } }))).toBe(true)
    expect(issuableInBulk(row({ grant: grant({ revoked_at: 'x' }), counts: { claimable: 1 } }))).toBe(false)
    expect(issuableInBulk(row({ grant: grant({ revoked_at: 'x' }) }))).toBe(false)
    expect(issuableInBulk(row({ grant: grant(), counts: { issued: 2 } }))).toBe(false)
    expect(issuableInBulk(row({ status: 'accepted' }))).toBe(false)
  })
})

describe('per founder actions', () => {
  const revoked = person('Mona', 'revoked', cert('c7', { revoked_at: 'x' }))

  it('Issue AGAIN is offered for ONE revoked founder while the participant is still authorised, never for a detached certificate or a revoked participant', () => {
    expect(canReissue(row({ grant: grant() }), revoked)).toBe(true)
    expect(canReissue(row({ grant: grant({ revoked_at: 'x' }) }), revoked)).toBe(false)
    expect(canReissue(row(), revoked)).toBe(false)
    expect(canReissue(row({ grant: grant() }), { ...revoked, detached: true })).toBe(false)
    expect(canReissue(row({ grant: grant() }), person('Sara', 'issued', cert('c2')))).toBe(false)
    expect(canReissue(row({ grant: grant() }), person('Hadi', 'claimable'))).toBe(false)
    expect(canReissue(row({ grant: grant() }), null)).toBe(false)
  })

  it('Issue AGAIN creates a NEW certificate, so it needs an ATTENDED participant (m44, 08 section 18.2: an existing certificate never depends on the status, a new one always does)', () => {
    expect(canReissue(row({ status: 'withdrawn', grant: grant() }), revoked)).toBe(false)
    expect(canReissue(row({ status: 'accepted', grant: grant() }), revoked)).toBe(false)
    expect(canReissue(row({ status: 'attended', grant: grant() }), revoked)).toBe(true)
    // ...while an issued certificate of a withdrawn participant stays revocable (the PM's explicit manual revoke)
    expect(canRevokeAll(row({ status: 'withdrawn', grant: grant(), counts: { issued: 1 } }))).toBe(true)
  })

  it('"Revoke all" exists while the participant is authorised or anyone still holds an active certificate', () => {
    expect(canRevokeAll(row({ grant: grant() }))).toBe(true)
    expect(canRevokeAll(row({ counts: { issued: 1 } }))).toBe(true)
    expect(canRevokeAll(row({ grant: grant({ revoked_at: 'x' }), counts: { issued: 0, revoked: 2 } }))).toBe(false)
    expect(canRevokeAll(row())).toBe(false)
  })
})

describe('summary counts (people, not only participants)', () => {
  it('counts attended participants, authorised ones, certificates (one per founder), founders waiting, founders without an account and revoked certificates', () => {
    const rows = [
      row({ participant_id: 'a', counts: { people: 2, linked: 1, unlinked: 1, issued: 0, claimable: 0, revoked: 0 } }),
      row({ participant_id: 'b', grant: grant(), counts: { people: 4, linked: 4, unlinked: 0, issued: 2, claimable: 1, revoked: 1 } }),
      row({ participant_id: 'c', grant: grant({ revoked_at: 'x' }), counts: { people: 1, linked: 1, unlinked: 0, issued: 0, claimable: 0, revoked: 1 } }),
      row({ participant_id: 'd', status: 'withdrawn', grant: grant(), counts: { people: 1, linked: 1, unlinked: 0, issued: 1, claimable: 0, revoked: 0 } }),
    ]
    expect(summarize(rows)).toEqual({ attended: 3, authorised: 2, issued: 3, claimable: 1, unlinked: 1, revoked: 2, pending: 1, flagged: 1 })
    expect(summarize(undefined)).toEqual({ attended: 0, authorised: 0, issued: 0, claimable: 0, unlinked: 0, revoked: 0, pending: 0, flagged: 0 })
  })

  it('a node "has certificates" as soon as a participant was authorised or anyone holds / held one (a template change then makes a new version)', () => {
    expect(hasCertificates([])).toBe(false)
    expect(hasCertificates([row()])).toBe(false)
    expect(hasCertificates([row({ grant: grant() })])).toBe(true)
    expect(hasCertificates([row({ counts: { issued: 0, revoked: 1 } })])).toBe(true)
  })
})

describe('issue blockers', () => {
  const admin = (over = {}) => ({ project: { completed_at: '2026-10-12T10:00:00Z' }, template: { has_name_field: true }, ...over })
  it('not completed / no template / no PERSON name field, in that order; null when ready', () => {
    expect(issueBlocker(null)).toBeNull()
    expect(issueBlocker(admin({ project: { completed_at: null } }))).toBe('notCompleted')
    expect(issueBlocker(admin({ template: null }))).toBe('noTemplate')
    expect(issueBlocker(admin({ template: { has_name_field: false } }))).toBe('incomplete')
    expect(issueBlocker(admin())).toBeNull()
  })
})

describe('template draft: the person and the company are saved as two fields', () => {
  const field = (v, extra = {}) => ({ var: v, x: 0.5, y: 0.5, w: 0.5, align: 'center', font: 'Tajawal', size: 0.04, color: '#1a1a2e', weight: 700, direction: 'auto', max_lines: 1, shrink_to_fit: true, ...extra })

  it('reads the m38 key as person_name and writes person_name + company_name back, in variable order', () => {
    const draft = templateDraft([{ language: 'en', version: 2, file_path: 'P/N/a.webp', width_px: 3508, height_px: 2480, fields: [field('verification_qr'), field('company_name'), field('participant_name')] }], 'en')
    expect(draft.fields.map((f) => f.var)).toEqual(['person_name', 'company_name', 'verification_qr'])
    const children = toChildren(draft, 'en')
    expect(children.template).toMatchObject({ language: 'en', file_path: 'P/N/a.webp', file_kind: 'image', width_px: 3508, height_px: 2480 })
    expect(children.template.fields.map((f) => f.var)).toEqual(['person_name', 'company_name', 'verification_qr'])
  })

  it('a draft without the person name only warns (the server refuses to issue with such a template), a draft without an image is an error', () => {
    const noName = { filePath: 'P/N/a.webp', widthPx: 3508, heightPx: 2480, fields: [field('company_name')] }
    expect(validateDraft(noName)).toEqual({ errors: [], warnings: [{ code: 'noName' }] })
    expect(validateDraft({ ...noName, fields: [field('person_name'), field('company_name')] })).toEqual({ errors: [], warnings: [] })
    expect(validateDraft({ filePath: null, fields: [] }).errors).toContainEqual({ code: 'noImage' })
  })
})
