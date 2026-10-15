import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIST_STATE } from '../lib/experts.js'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove, upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } }) }))

const people = await import('./people.js')

const ok = (data) => ({ data, error: null })
const fail = (code, message, extra = {}) => ({ data: null, error: { code, message, details: null, hint: null, ...extra } })

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue(ok(null))
  mocks.remove.mockReset().mockResolvedValue({ error: null })
})

describe('registry reads', () => {
  it('listRegistry sends the RPC arguments of the list state and maps the rows to view models', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ total: 44, counts: { active: 44 }, limit: 24, offset: 24, rows: [{ id: 'e1', kind: 'expert', name_en: 'A\tB', programs_count: 2, sessions_count: 5 }] }))
    const res = await people.listRegistry({ ...DEFAULT_LIST_STATE, q: 'a', page: 2, sort: 'sessions', dir: 'desc' }, 'ar')
    expect(mocks.rpc).toHaveBeenCalledWith('list_network_experts', { p_filter: { q: 'a' }, p_sort: 'sessions', p_dir: 'desc', p_limit: 24, p_offset: 24, p_lang: 'ar', p_full: false })
    expect(res.total).toBe(44)
    expect(res.rows[0]).toMatchObject({ id: 'e1', name: { en: 'A B', ar: '' }, programs: 2, sessions: 5 })
  })

  it('the Excel export asks for every row with the wide columns (one call, p_full)', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ total: 1, rows: [{ id: 'e1', email: 'a@x.io', notes: 'n' }] }))
    const rows = await people.listRegistryForExport({ ...DEFAULT_LIST_STATE, kind: 'team' }, 'en')
    expect(mocks.rpc).toHaveBeenCalledWith('list_network_experts', expect.objectContaining({ p_limit: 5000, p_offset: 0, p_full: true, p_filter: { kind: 'team' } }))
    expect(rows[0]).toMatchObject({ email: 'a@x.io', notes: 'n' })
  })

  it('getExpertProfile / findSimilarExperts / listExpertTags / listDuplicatePairs use their RPCs and normalise', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ expert: { id: 'e1', kind: 'expert', name_en: 'A', updated_at: 'T' }, totals: {}, tags: [] }))
    expect((await people.getExpertProfile('e1')).updatedAt).toBe('T')
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_network_expert', { p_id: 'e1' })

    mocks.rpc.mockResolvedValueOnce(ok([{ id: 'e2', score: 0.95, reasons: ['same_name'], blocking: true, expert: { id: 'e2', name_en: 'B' } }]))
    const c = await people.findSimilarExperts({ nameEn: 'B', exclude: 'e1' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('find_similar_network_experts', { p_name_en: 'B', p_name_ar: null, p_email: null, p_linkedin: null, p_exclude: 'e1', p_kind: 'expert', p_limit: 6 })
    expect(c[0]).toMatchObject({ id: 'e2', blocking: true })

    mocks.rpc.mockResolvedValueOnce(ok([{ id: 't1', name_en: 'Marketing', name_ar: 'التسويق', archived: false, uses: 3 }]))
    expect((await people.listExpertTags())[0]).toMatchObject({ id: 't1', uses: 3 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_expert_tags', { p_include_archived: false })

    mocks.rpc.mockResolvedValueOnce(ok({ pairs: [{ score: 1, reasons: ['same_linkedin'], a: { id: 'a' }, b: { id: 'b' } }], dismissed: 2 }))
    const pairs = await people.listDuplicatePairs()
    expect(pairs).toMatchObject({ dismissed: 2, pairs: [{ score: 1, a: { id: 'a' }, b: { id: 'b' } }] })
  })

  it('a server refusal surfaces as an AppError with the token mapped to a translation key (expert_not_found -> not_found)', async () => {
    mocks.rpc.mockResolvedValueOnce(fail('P0002', 'expert_not_found: no such expert', { hint: 'expert_not_found' }))
    await expect(people.getExpertProfile('zz')).rejects.toMatchObject({ name: 'AppError', code: 'not_found', messageKey: 'experts.err.notFound', token: 'expert_not_found' })
  })
})

describe('registry writes', () => {
  it('createExpert: sends the payload; a BLOCKING duplicate creates nothing and throws a conflict that carries the candidates', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ created: true, id: 'new', updated_at: 'T' }))
    expect(await people.createExpert({ name_en: 'A' })).toEqual({ id: 'new', updatedAt: 'T' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_network_expert', { p: { name_en: 'A' }, p_force: false })

    mocks.rpc.mockResolvedValueOnce(ok({ created: false, duplicates: [{ id: 'e9', score: 1, reasons: ['same_linkedin'], expert: { id: 'e9', name_en: 'Same' } }] }))
    const err = await people.createExpert({ name_en: 'A' }).catch((e) => e)
    expect(err).toMatchObject({ name: 'AppError', code: 'conflict', messageKey: 'experts.err.duplicate', token: 'expert_duplicate' })
    expect(err.duplicates[0]).toMatchObject({ id: 'e9', blocking: true })

    mocks.rpc.mockResolvedValueOnce(ok({ created: true, id: 'forced', updated_at: 'T2' }))
    await people.createExpert({ name_en: 'A' }, { force: true })
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_network_expert', { p: { name_en: 'A' }, p_force: true })
  })

  it('updateExpert sends a PATCH with the stale-edit token and hands back the old photo path for cleanup', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ updated: true, id: 'e1', updated_at: 'T2', old_photo_path: 'global/expert-photo/old.webp' }))
    expect(await people.updateExpert('e1', { title_en: 'X' }, 'T1')).toEqual({ id: 'e1', updatedAt: 'T2', oldPhotoPath: 'global/expert-photo/old.webp' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('update_network_expert', { p_id: 'e1', p: { title_en: 'X' }, p_expected: 'T1' })
  })

  it('a stale edit is a CONFLICT the form can recognise (expert_stale), an in-use delete too (expert_in_use)', async () => {
    mocks.rpc.mockResolvedValueOnce(fail('P0001', 'expert_stale: the profile changed', { hint: 'expert_stale' }))
    await expect(people.updateExpert('e1', {}, 'T0')).rejects.toMatchObject({ code: 'conflict', token: 'expert_stale', messageKey: 'experts.err.stale' })
    mocks.rpc.mockResolvedValueOnce(fail('P0001', 'expert_in_use: 2 list item(s) use this expert', { hint: 'expert_in_use', details: '2' }))
    await expect(people.deleteExpert('e1')).rejects.toMatchObject({ code: 'conflict', token: 'expert_in_use', messageKey: 'experts.err.inUse' })
  })

  it('a server field refusal keeps its detail (the form puts it under the field)', async () => {
    mocks.rpc.mockResolvedValueOnce(fail('22023', 'expert_invalid: email:invalid', { hint: 'expert_invalid', details: 'email:invalid' }))
    const err = await people.createExpert({ name_en: 'A', email: 'x' }).catch((e) => e)
    expect(err).toMatchObject({ token: 'expert_invalid', detail: 'email:invalid', code: 'validation' })
  })

  it('archive / delete / restore / tags / dismiss / import / merge call their RPCs with named arguments', async () => {
    await people.setExpertArchived('e1', true)
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_network_expert_archived', { p_id: 'e1', p_archived: true })
    await people.deleteExpert('e1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('delete_network_expert', { p_id: 'e1' })
    await people.restoreExpert('e1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('restore_network_expert', { p_id: 'e1' })
    await people.setExpertTags('e1', ['t1', { name_en: 'X' }])
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_network_expert_tags', { p_expert: 'e1', p_tags: ['t1', { name_en: 'X' }] })
    await people.dismissDuplicate('a', 'b')
    expect(mocks.rpc).toHaveBeenLastCalledWith('dismiss_expert_duplicate', { p_a: 'a', p_b: 'b' })
    await people.importExperts([{ name_en: 'A' }])
    expect(mocks.rpc).toHaveBeenLastCalledWith('import_network_experts', { p_rows: [{ name_en: 'A' }], p_dry_run: true, p_duplicates: 'skip', p_seen: null })
    await people.importExperts([{ name_en: 'A' }], { dryRun: false, duplicates: 'create' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('import_network_experts', { p_rows: [{ name_en: 'A' }], p_dry_run: false, p_duplicates: 'create', p_seen: null })
    // a later CHUNK of a preview carries the keys of the rows before it
    await people.importExperts([{ name_en: 'B' }], { seen: { names: ['a'], links: [], mails: [] } })
    expect(mocks.rpc).toHaveBeenLastCalledWith('import_network_experts', { p_rows: [{ name_en: 'B' }], p_dry_run: true, p_duplicates: 'skip', p_seen: { names: ['a'], links: [], mails: [] } })
  })

  it('merge: the PREVIEW is a dry run (writes nothing), the merge itself is not; the field choices travel along', async () => {
    await people.previewMerge('k', 'd', { name_en: 'drop' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('merge_network_experts', { p_keep: 'k', p_drop: 'd', p_dry_run: true, p_fields: { name_en: 'drop' } })
    await people.mergeExperts('k', 'd', {})
    expect(mocks.rpc).toHaveBeenLastCalledWith('merge_network_experts', { p_keep: 'k', p_drop: 'd', p_dry_run: false, p_fields: {} })
  })

  it('discardExpertPhoto removes the full image and its thumbnail and NEVER throws (a failed clean-up must not undo a saved profile)', async () => {
    const A = 'global/expert-photo/6f1b2c3d-0000-4000-8000-000000000001.webp'
    const B = 'global/expert-photo/6f1b2c3d-0000-4000-8000-000000000002.webp'
    await people.discardExpertPhoto(A)
    expect(mocks.remove).toHaveBeenCalledWith([A, A.replace('.webp', '_t.webp')])
    mocks.remove.mockResolvedValueOnce({ error: { message: 'boom' } })
    await expect(people.discardExpertPhoto(B)).resolves.toBeUndefined()
    await people.discardExpertPhoto(null)
    expect(mocks.remove).toHaveBeenCalledTimes(3) // full+thumb, the JPEG link-preview derivative (best effort), then the failing one
  })

  it('discardExpertPhoto NEVER removes an object outside the registry photo folder (a record could be made to name any file of the bucket)', async () => {
    for (const path of ['global/hero/home-hero.webp', 'global/rvxcanary/rvx-canary.webp', 'global/expert-photo/evil.webp', 'a/b/c.webp', '../global/x.webp', 'global/expert-photo/6f1b2c3d-0000-4000-8000-000000000001.png']) {
      await people.discardExpertPhoto(path)
    }
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})

describe('the Lists node\'s view of the registry (EntityView): the shared module keeps working', () => {
  it('listNetworkExperts searches through the registry RPC (kind, term, limit) and returns EntityViews', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ total: 1, rows: [{ id: 'e1', kind: 'expert', name_en: 'Ada', title_en: 'CTO', company_en: 'Acme', photo_path: 'p.webp', linkedin_url: 'https://l/in/a' }] }))
    const rows = await people.listNetworkExperts({ term: ' ada ', kind: 'team', limit: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('list_network_experts', { p_filter: { kind: 'team', q: 'ada' }, p_sort: 'name', p_dir: 'asc', p_limit: 10, p_offset: 0, p_lang: 'en', p_full: false })
    expect(rows[0]).toMatchObject({ id: 'e1', kind: 'expert', title: { en: 'Ada' }, subtitle: { en: 'CTO' }, organization: { en: 'Acme' }, imagePath: 'p.webp', links: [{ kind: 'linkedin', url: 'https://l/in/a' }] })
  })

  it('createNetworkExpert creates the SAME canonical record from an EntityView and returns it as an EntityView', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ created: true, id: 'new', updated_at: 'T' }))
    const view = { title: { en: ' Sara ', ar: '' }, subtitle: { en: 'CTO', ar: '' }, organization: { en: 'Acme', ar: '' }, bio: { en: '', ar: '' }, imagePath: 'global/expert-photo/s.webp', links: [{ kind: 'linkedin', url: 'linkedin.com/in/s' }], email: 'S@Acme.io' }
    const entity = await people.createNetworkExpert(view, { kind: 'expert', force: true })
    expect(mocks.rpc).toHaveBeenCalledWith('create_network_expert', { p: expect.objectContaining({ kind: 'expert', name_en: 'Sara', title_en: 'CTO', company_en: 'Acme', photo_path: 'global/expert-photo/s.webp', linkedin_url: 'https://linkedin.com/in/s', email: 's@acme.io' }), p_force: true })
    expect(entity).toMatchObject({ id: 'new', kind: 'expert', title: { en: 'Sara' }, imagePath: 'global/expert-photo/s.webp' })
  })

  it('createNetworkExpert without force surfaces the duplicate refusal (the picker asks the user first)', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ created: false, duplicates: [{ id: 'e9', score: 1, reasons: ['same_name'], expert: { id: 'e9', name_en: 'Sara' } }] }))
    await expect(people.createNetworkExpert({ title: { en: 'Sara', ar: '' }, subtitle: {}, organization: {}, bio: {}, links: [] })).rejects.toMatchObject({ token: 'expert_duplicate' })
  })
})
