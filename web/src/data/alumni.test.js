import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc }) }))

const { AppError } = await import('./errors.js')
const A = await import('./alumni.js')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null })
})

/** The contract: RPC name + argument names of every function (SQL parameter names, `p_...`). A drift between the SQL and the client fails here. */
describe('data/alumni.js pins the RPC names and parameters of m49', () => {
  const calls = [
    ['getAlumniLookups', () => A.getAlumniLookups(), 'list_alumni_lookups', {}],
    ['saveAlumniLookup', () => A.saveAlumniLookup('stage', 'pre_seed', { label_en: 'x' }), 'save_alumni_lookup', { p_kind: 'stage', p_key: 'pre_seed', p_patch: { label_en: 'x' } }],
    ['deleteAlumniLookup', () => A.deleteAlumniLookup('stage', 'k'), 'delete_alumni_lookup', { p_kind: 'stage', p_key: 'k' }],
    ['previewNationalId', () => A.previewNationalId('2950101'), 'preview_national_id', { p_id: '2950101' }],
    ['getMyAlumniProfile', () => A.getMyAlumniProfile(), 'get_my_alumni_profile', {}],
    ['saveMyFounderProfile', () => A.saveMyFounderProfile({ phone: '1' }), 'save_my_founder_profile', { p_patch: { phone: '1' } }],
    ['getMyCompanyProfile', () => A.getMyCompanyProfile('c1'), 'get_my_company_profile', { p_company: 'c1' }],
    ['saveMyCompanyProfile (create)', () => A.saveMyCompanyProfile(null, { name_en: 'Co' }), 'save_my_company_profile', { p_company: null, p_patch: { name_en: 'Co' }, p_expected: null }],
    ['saveMyCompanyProfile (update)', () => A.saveMyCompanyProfile('c1', { stage: 'mvp' }, '2026-10-14T00:00:00+00:00'), 'save_my_company_profile', { p_company: 'c1', p_patch: { stage: 'mvp' }, p_expected: '2026-10-14T00:00:00+00:00' }],
    ['saveCompanyTeamMember (add a record)', () => A.saveCompanyTeamMember('c1', undefined, { name_en: 'Hana' }), 'save_company_team_member', { p_company: 'c1', p_founder: null, p_patch: { name_en: 'Hana' } }],
    ['removeCompanyTeamMember', () => A.removeCompanyTeamMember('c1', 'f1'), 'remove_company_team_member', { p_company: 'c1', p_founder: 'f1' }],
    ['setCompanyCeo', () => A.setCompanyCeo('c1', 'f1'), 'set_company_ceo', { p_company: 'c1', p_founder: 'f1' }],
    ['validateInvitation', () => A.validateInvitation('tok'), 'validate_invitation', { p_token: 'tok' }],
    ['acceptInvitation', () => A.acceptInvitation('tok'), 'accept_invitation', { p_token: 'tok' }],
    ['createAlumniInvitation', () => A.createAlumniInvitation({ companyId: 'c1', email: 'a@b.co', language: 'ar', appUrl: 'https://app.example.com' }), 'create_alumni_invitation', { p_company: 'c1', p_email: 'a@b.co', p_language: 'ar', p_app_url: 'https://app.example.com' }],
    ['revokeAlumniInvitation', () => A.revokeAlumniInvitation('i1'), 'revoke_alumni_invitation', { p_id: 'i1' }],
    ['listAlumniInvitations', () => A.listAlumniInvitations({ status: 'pending', limit: 10, offset: 20 }), 'list_alumni_invitations', { p_status: 'pending', p_limit: 10, p_offset: 20 }],
    ['listAlumniDirectory', () => A.listAlumniDirectory({ filters: { q: 'nile' }, limit: 12, offset: 24, sort: 'updated' }), 'list_alumni_directory', { p_filters: { q: 'nile' }, p_limit: 12, p_offset: 24, p_sort: 'updated' }],
    ['listPublicAlumniDirectory', () => A.listPublicAlumniDirectory({ filters: { sector: 'technology' } }), 'list_public_alumni_directory', { p_filters: { sector: 'technology' }, p_limit: 24, p_offset: 0 }],
    ['getAlumniCompany', () => A.getAlumniCompany('c1'), 'get_alumni_company', { p_company: 'c1' }],
    ['getAlumniFounder (masked by default)', () => A.getAlumniFounder('f1'), 'get_alumni_founder', { p_founder: 'f1', p_reveal: false }],
    ['getAlumniFounder (reveal)', () => A.getAlumniFounder('f1', { reveal: true }), 'get_alumni_founder', { p_founder: 'f1', p_reveal: true }],
    ['saveAlumniCompany', () => A.saveAlumniCompany('c1', { internal: { hint: 'x' } }), 'save_alumni_company', { p_company: 'c1', p_patch: { internal: { hint: 'x' } }, p_expected: null }],
    ['saveAlumniFounder', () => A.saveAlumniFounder('f1', { email: 'a@b.co' }), 'save_alumni_founder', { p_founder: 'f1', p_patch: { email: 'a@b.co' } }],
    ['setCompaniesAlumni', () => A.setCompaniesAlumni(['c1', 'c2'], true), 'set_companies_alumni', { p_ids: ['c1', 'c2'], p_value: true }],
    ['exportAlumniRows', () => A.exportAlumniRows({ filters: { scope: 'all' }, year: 2023, lang: 'ar', asOf: '2026-10-14' }), 'export_alumni_rows', { p_filters: { scope: 'all' }, p_year: 2023, p_lang: 'ar', p_as_of: '2026-10-14' }],
    ['getAlumniAnalytics', () => A.getAlumniAnalytics({ filters: { q: 'x' }, year: 2024 }), 'get_alumni_analytics', { p_filters: { q: 'x' }, p_year: 2024 }],
    // m60 / m65: the version of what the form loaded (optimistic concurrency, NO per-edit history or reason any more), the stamps and the needs-attention queue
    ['saveAlumniCompany (with the version the form loaded)', () => A.saveAlumniCompany('c1', { stage: 'mvp' }, '2026-10-15T01:00:00+00:00'), 'save_alumni_company', { p_company: 'c1', p_patch: { stage: 'mvp' }, p_expected: '2026-10-15T01:00:00+00:00' }],
    ['saveAlumniFounder (with the version)', () => A.saveAlumniFounder('f1', { phone: '1' }, '2026-10-15T01:00:00+00:00'), 'save_alumni_founder', { p_founder: 'f1', p_patch: { phone: '1' }, p_expected: '2026-10-15T01:00:00+00:00' }],
    ['saveMyFounderProfile (with the version the form loaded)', () => A.saveMyFounderProfile({ phone: '1' }, '2026-10-15T01:00:00+00:00'), 'save_my_founder_profile', { p_patch: { phone: '1' }, p_expected: '2026-10-15T01:00:00+00:00' }],
    ['getAlumniStamps', () => A.getAlumniStamps('c1'), 'get_alumni_stamps', { p_company: 'c1' }],
    ['listAlumniAttention', () => A.listAlumniAttention({ filters: { scope: 'all', missing: 'sector' }, rules: ['sector', 'ceo'], limit: 5000, offset: 25, sort: 'name' }), 'list_alumni_attention', { p_filters: { scope: 'all', missing: 'sector' }, p_rules: ['sector', 'ceo'], p_limit: 5000, p_offset: 25, p_sort: 'name' }],
    ['listAlumniAttention (defaults: every rule, the worst first)', () => A.listAlumniAttention(), 'list_alumni_attention', { p_filters: {}, p_rules: null, p_limit: 25, p_offset: 0, p_sort: 'missing' }],
  ]
  it.each(calls)('%s', async (_name, run, fn, args) => {
    await run()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith(fn, args)
  })
})

describe('results and errors', () => {
  it('returns the RPC json as it is (the soft "national_id_conflict" outcome is a normal result, not an exception)', async () => {
    mocks.rpc.mockResolvedValue({ data: { saved: false, error: 'national_id_conflict' }, error: null })
    await expect(A.saveMyFounderProfile({ national_id: '29501010101234' })).resolves.toEqual({ saved: false, error: 'national_id_conflict' })
  })

  it('throws an AppError for a refused value and keeps the detail field:reason', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'alumni_invalid: stage:unknown', hint: 'alumni_invalid', details: 'stage:unknown' } })
    const err = await A.saveMyCompanyProfile('c1', { stage: 'warp' }).catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('validation')
    expect(err.detail).toBe('stage:unknown')
  })

  it('maps forbidden (42501) and a stale form (P0001 + the alumni_stale token; never 40001)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden' } })
    await expect(A.getAlumniCompany('c1')).rejects.toMatchObject({ code: 'forbidden' })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'alumni_stale: reload', hint: 'alumni_stale' } })
    await expect(A.saveMyCompanyProfile('c1', {}, 'x')).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('saveMyFounderProfileStrict (a conflict is an error state)', () => {
  it('throws an AppError carrying the token when the server answers saved:false, and returns the result otherwise', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { saved: false, error: 'national_id_conflict' }, error: null })
    const err = await A.saveMyFounderProfileStrict({ national_id: '29501010101234' }).catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err.token).toBe('national_id_conflict')
    mocks.rpc.mockResolvedValueOnce({ data: { saved: true, replaced: [] }, error: null })
    await expect(A.saveMyFounderProfileStrict({ phone: '1' })).resolves.toEqual({ saved: true, replaced: [] })
  })
})

describe('query keys never carry a national ID or a reveal flag', () => {
  it('has a stable root, no reveal in the founder key, and params only for filters', () => {
    expect(A.alumniKeys.root()).toEqual(['alumni'])
    expect(A.alumniKeys.adminFounder('f1')).toEqual(['alumni', 'admin', 'founder', 'f1'])
    expect(JSON.stringify(A.alumniKeys.me())).not.toMatch(/\d{14}/)
    expect(A.alumniKeys.directory({ filters: { q: 'x' } })).toEqual(['alumni', 'directory', { filters: { q: 'x' } }])
  })
})
