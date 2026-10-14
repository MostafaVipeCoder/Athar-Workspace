import { vi } from 'vitest'

/**
 * Test helper of the manager pages: a fake of the supabase client (`db()` of data/client.js) so a page runs through the REAL data layer and the REAL react-query.
 *   rpc:    { [function name]: value | (args) => value | Error }  (an Error becomes a PostgREST-style error)
 *   tables: { [table]: rows | (state) => rows | Error }           (select; `eq` / `in` filters are applied to plain rows; an Error becomes a PostgREST-style error)
 *   onWrite:{ [table]: (state) => data }                          (insert / update / delete result; default = the body echoed with an id)
 * `calls` records every rpc and every table call (op, body, filters) for assertions.
 */
export function makeDb({ rpc = {}, tables = {}, onWrite = {} } = {}) {
  const calls = []
  const resolve = (state) => {
    if (state.op !== 'select') {
      const custom = onWrite[state.table]?.(state)
      if (custom instanceof Error) return { data: null, error: { message: custom.message, code: custom.code, hint: custom.hint, details: custom.details } }
      const data = custom !== undefined ? custom : state.op === 'delete' ? null : { opportunity_id: 'new-id', id: 'new-id', ...(state.body ?? {}) }
      return { data, error: null }
    }
    const src = tables[state.table]
    let rows = typeof src === 'function' ? src(state) : src ?? []
    if (rows instanceof Error) return { data: null, error: { message: rows.message, code: rows.code, hint: rows.hint, details: rows.details, status: rows.status } }
    for (const [kind, col, val] of state.filters) {
      if (kind === 'eq') rows = rows.filter((r) => r[col] === val)
      if (kind === 'in') rows = rows.filter((r) => val.includes(r[col]))
    }
    return { data: state.single ? rows[0] ?? null : rows, error: null }
  }
  const builder = (table) => {
    const state = { table, op: 'select', body: undefined, filters: [], single: false, columns: undefined }
    const api = {
      select: (cols) => { state.columns = cols; return api },
      insert: (body) => { state.op = 'insert'; state.body = body; return api },
      update: (body) => { state.op = 'update'; state.body = body; return api },
      delete: () => { state.op = 'delete'; return api },
      eq: (c, v) => { state.filters.push(['eq', c, v]); return api },
      in: (c, v) => { state.filters.push(['in', c, v]); return api },
      is: () => api,
      or: () => api,
      order: () => api,
      limit: () => api,
      single: () => { state.single = true; return api },
      then: (ok, fail) => { calls.push({ ...state }); return Promise.resolve(resolve(state)).then(ok, fail) },
    }
    return api
  }
  const db = {
    rpc: vi.fn(async (name, args) => {
      calls.push({ rpc: name, args })
      if (!(name in rpc)) return { data: null, error: { message: `no mock for rpc ${name}` } }
      const h = rpc[name]
      const out = typeof h === 'function' ? h(args) : h
      if (out instanceof Error) return { data: null, error: { message: out.message, code: out.code, hint: out.hint, details: out.details } }
      return { data: out, error: null }
    }),
    from: (t) => builder(t),
  }
  return { db, calls, rpcCalls: (name) => calls.filter((c) => c.rpc === name), tableCalls: (table, op) => calls.filter((c) => c.table === table && (!op || c.op === op)) }
}

/** The vocabulary payload of `list_alumni_lookups()` (small, bilingual). */
export const LOOKUPS = {
  governorates: [{ code: 1, key: 'cairo', name_en: 'Cairo', name_ar: 'القاهرة', is_abroad: false }, { code: 25, key: 'assiut', name_en: 'Assiut', name_ar: 'أسيوط', is_abroad: false }, { code: 28, key: 'aswan', name_en: 'Aswan', name_ar: 'أسوان', is_abroad: false }, { code: 88, key: 'abroad', name_en: 'Born abroad', name_ar: 'مولود بالخارج', is_abroad: true }],
  sectors: [
    { key: 'technology', label_en: 'Technology', label_ar: 'التكنولوجيا', sort: 40, active: true, system: false, subsectors: [{ key: 'robotics', label_en: 'Robotics', label_ar: 'الروبوتات', sort: 1, active: true, system: false }] },
    { key: 'healthcare', label_en: 'Healthcare', label_ar: 'الرعاية الصحية', sort: 30, active: true, system: false, subsectors: [] },
  ],
  stages: [{ key: 'mvp', label_en: 'MVP', label_ar: 'منتج أولي', sort: 40, active: true, system: false }, { key: 'idea_stage', label_en: 'Idea stage', label_ar: 'مرحلة الفكرة', sort: 10, active: true, system: false }],
  startup_types: [{ key: 'startup', label_en: 'Startup', label_ar: 'شركة ناشئة', sort: 1, active: true, system: false }],
  legal_statuses: [{ key: 'llc', label_en: 'LLC', label_ar: 'ذات مسؤولية محدودة', sort: 1, active: true, system: false }],
  closing_reasons: [{ key: 'funding', label_en: 'Funding', label_ar: 'التمويل', sort: 1, active: true, system: false }],
  after_closing: [{ key: 'employed', label_en: 'Employed', label_ar: 'عمل بوظيفة', sort: 1, active: true, system: false }],
  support_kinds: [{ key: 'training', label_en: 'Training', label_ar: 'تدريب', sort: 1, active: true, system: true }, { key: 'mentoring', label_en: 'Mentoring', label_ar: 'إرشاد', sort: 2, active: true, system: true }],
  age_categories: [{ key: 'age_25_34', label_en: '25-34', label_ar: '٢٥-٣٤', sort: 3, active: true, system: true }],
  genders: [{ key: 'male', label_en: 'Male', label_ar: 'ذكر', sort: 1, active: true, system: true }, { key: 'female', label_en: 'Female', label_ar: 'أنثى', sort: 2, active: true, system: true }],
  education_statuses: [{ key: 'graduate', label_en: 'Graduate', label_ar: 'خريج', sort: 1, active: true, system: true }, { key: 'student', label_en: 'Student', label_ar: 'طالب', sort: 2, active: true, system: true }],
  operating_statuses: [{ key: 'open', label_en: 'Open', label_ar: 'مفتوحة', sort: 1, active: true, system: true }, { key: 'closed', label_en: 'Closed', label_ar: 'مغلقة', sort: 2, active: true, system: true }],
  directory_visibilities: [{ key: 'private', label_en: 'Private', label_ar: 'خاص', sort: 1, active: true, system: true }, { key: 'alumni', label_en: 'Alumni', label_ar: 'الخريجون', sort: 2, active: true, system: true }, { key: 'public', label_en: 'Public', label_ar: 'عام', sort: 3, active: true, system: true }],
  version: '2026-10-14T00:00:00Z',
}

/** A `list_alumni_table` row (manager audience). The national ID is MASKED: the table never carries the number. */
export const tableRow = (over = {}) => ({
  id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات', logo_path: null, programs: [{ id: 'g1', name_en: 'Accelerator', name_ar: 'مسرعة' }], projects: [{ id: 'j1', name_en: 'Cohort 1', name_ar: 'الدفعة الأولى' }],
  support: ['training'], startup_type: 'startup', hint: 'strong team', sector: 'technology', subsector: 'robotics', description_en: 'Farm robots', description_ar: null, stage: 'mvp', governorate: 25,
  established_on: '2021-03-01', founding_year: 2021, app_url: null, website_url: 'https://nile.example.com', social: [], traction: '40 farms',
  ceo: { founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي', phone: '+201012345678', email: 'sara@example.com', id_masked: '**********1234', has_national_id: true, age: 31, age_category: 'age_25_34', gender: 'female', governorate: 28, source: 'id', education_status: 'graduate' },
  operating_status: 'open', closing_reason: null, closing_note: null, after_closing: null, legal_status: 'llc', team: { size: 2, female_founders: 1, under_35: 2 },
  metrics: { employees_total: 11, employees_female: 5, freelancers: 3, funding_raised_total: 400000, revenue_total: 910000, challenges: 'Hiring', needs: 'Series A' },
  is_alumni: true, directory_visibility: 'alumni', directory_hidden: false, reviewed_at: null, updated_at: '2026-10-10T10:00:00Z', completeness: { percent: 80, missing: ['annual_update'] }, legacy: {},
  ...over,
})

export const tablePage = (rows, over = {}) => ({ total: rows.length, limit: 25, offset: 0, year: 2024, sort: 'name', dir: 'asc', as_of: '2026-10-14', rows, ...over })
