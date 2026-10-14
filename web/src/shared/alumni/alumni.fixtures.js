/** Sample payloads of the contract (alumni.contract.md) shared by the Alumni component and page tests. Synthetic data only. */
export const LOOKUPS = {
  governorates: [
    { code: 1, key: 'cairo', name_en: 'Cairo', name_ar: 'القاهرة', is_abroad: false },
    { code: 25, key: 'assiut', name_en: 'Assiut', name_ar: 'أسيوط', is_abroad: false },
    { code: 28, key: 'aswan', name_en: 'Aswan', name_ar: 'أسوان', is_abroad: false },
    { code: 88, key: 'abroad', name_en: 'Born abroad', name_ar: 'مولود بالخارج', is_abroad: true },
  ],
  sectors: [
    { key: 'technology', label_en: 'Technology', label_ar: 'التكنولوجيا', sort: 40, active: true, system: false, subsectors: [
      { key: 'robotics', label_en: 'Robotics', label_ar: 'الروبوتات', sort: 40, active: true, system: false },
      { key: 'drones', label_en: 'Drones', label_ar: 'الطائرات المسيرة', sort: 50, active: true, system: false },
    ] },
    { key: 'education', label_en: 'Education', label_ar: 'التعليم', sort: 90, active: true, system: false, subsectors: [
      { key: 'edtech', label_en: 'EdTech', label_ar: 'تكنولوجيا التعليم', sort: 10, active: true, system: false },
    ] },
  ],
  stages: [
    { key: 'idea_stage', label_en: 'Idea stage', label_ar: 'مرحلة الفكرة', sort: 10, active: true, system: false },
    { key: 'mvp', label_en: 'MVP', label_ar: 'منتج أولي', sort: 40, active: true, system: false },
  ],
  startup_types: [{ key: 'startup', label_en: 'Startup', label_ar: 'شركة ناشئة', sort: 10, active: true, system: false }, { key: 'msme', label_en: 'MSME', label_ar: 'مشروع صغير', sort: 20, active: true, system: false }],
  legal_statuses: [{ key: 'llc', label_en: 'Limited liability company', label_ar: 'شركة ذات مسؤولية محدودة', sort: 30, active: true, system: false }],
  closing_reasons: [{ key: 'funding', label_en: 'Funding', label_ar: 'التمويل', sort: 10, active: true, system: false }],
  after_closing: [{ key: 'employed', label_en: 'Employed', label_ar: 'وظيفة', sort: 20, active: true, system: false }],
  support_kinds: [{ key: 'mentoring', label_en: 'Mentoring', label_ar: 'الإرشاد', sort: 10, active: true, system: true }, { key: 'training', label_en: 'Training and workshops', label_ar: 'التدريب', sort: 20, active: true, system: true }],
  age_categories: [],
  genders: [{ key: 'male', label_en: 'Male', label_ar: 'ذكر', sort: 10, active: true, system: true }, { key: 'female', label_en: 'Female', label_ar: 'أنثى', sort: 20, active: true, system: true }],
  education_statuses: [{ key: 'student', label_en: 'Student', label_ar: 'طالب', sort: 10, active: true, system: true }, { key: 'graduate', label_en: 'Graduate', label_ar: 'خريج', sort: 20, active: true, system: true }],
  operating_statuses: [{ key: 'open', label_en: 'Open', label_ar: 'تعمل', sort: 10, active: true, system: true }, { key: 'closed', label_en: 'Closed', label_ar: 'مغلقة', sort: 20, active: true, system: true }],
  directory_visibilities: [
    { key: 'private', label_en: 'Private', label_ar: 'خاص', sort: 10, active: true, system: true },
    { key: 'alumni', label_en: 'Alumni network', label_ar: 'شبكة الخريجين', sort: 20, active: true, system: true },
    { key: 'public', label_en: 'Public directory', label_ar: 'دليل عام', sort: 30, active: true, system: true },
  ],
  version: '2026-10-14T00:00:00Z',
}

/** The identity block of `get_my_alumni_profile` for a founder with no ID, with an ID, and as a manager sees it (masked only). */
export const IDENTITY_NONE = { source: null, has_national_id: false, national_id: null, id_masked: null, self_birth_date: null, self_gender: null, derived: { birth_date: null, age: null, age_category: null, gender: null, governorate: null } }
export const IDENTITY_ID = { source: 'id', has_national_id: true, national_id: '29501010101234', id_masked: '**********1234', self_birth_date: null, self_gender: null, derived: { birth_date: '1995-01-01', age: 31, age_category: 'age_25_34', gender: 'male', governorate: 1 } }
export const IDENTITY_MASKED = { ...IDENTITY_ID, national_id: undefined }

/** What `preview_national_id` answers for IDENTITY_ID's number. */
export const PREVIEW_OK = { valid: true, birth_date: '1995-01-01', age: 31, age_category: 'age_25_34', gender: 'male', governorate: { code: 1, name_en: 'Cairo', name_ar: 'القاهرة', is_abroad: false } }

export const FOUNDER = {
  id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي', email: 'sara@example.com', phone: '+201012345678', linkedin_url: null, photo_path: null, bio_en: null, bio_ar: null, education_status: 'graduate',
  has_account: true, updated_at: '2026-10-14T08:00:00Z', identity: IDENTITY_NONE, completeness: { percent: 75, missing: ['identity'] },
}
export const COMPANY_ROW = {
  id: 'c1', name_en: 'Nile Labs', name_ar: 'مختبرات النيل', logo_path: null, stage: 'mvp', sector: 'technology', operating_status: 'open', role: 'founder', is_primary: true, directory_visibility: 'private', is_alumni: false,
  completeness: { percent: 80, missing: ['description', 'annual_update'] }, latest_snapshot_year: 2024, updated_at: '2026-10-14T08:00:00Z',
}
export const MY_PROFILE = { founder: FOUNDER, companies: [COMPANY_ROW] }

export const COMPANY = {
  id: 'c1', name_en: 'Nile Labs', name_ar: 'مختبرات النيل', description_en: 'Water technology', description_ar: null, logo_path: null, startup_type: 'startup', sector: 'technology', subsector: 'robotics', stage: 'mvp', legal_status: 'llc',
  governorate: 25, location_en: 'Assiut Valley', location_ar: null, established_on: '2021-03-01', founding_year: 2021, website_url: 'https://nile.example.com', app_url: null, linkedin_url: null,
  links: [{ kind: 'facebook', url: 'https://facebook.com/nile', label: 'Facebook' }], operating_status: 'open', closed_on: null, closing_reason: null, after_closing: null, closing_note: null,
  directory_visibility: 'private', directory_blocked: false, is_alumni: false, legacy: { industry_en: null, industry_ar: null, governorate_en: null, governorate_ar: null },
  completeness: { percent: 90, missing: ['annual_update'] }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-14T08:00:00Z',
}
export const TEAM = [
  { founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي', role: 'CEO', is_primary: true, has_account: true, is_me: true, gender: 'female', age: 31, age_category: 'age_25_34', birth_date: '1995-01-01', source: 'id' },
  { founder_id: 'f2', name_en: 'Omar Zaki', name_ar: 'عمر زكي', role: 'CTO', is_primary: false, has_account: true, is_me: false },
  { founder_id: 'f3', name_en: 'Hana Mostafa', name_ar: 'هناء مصطفى', role: 'Designer', is_primary: false, has_account: false, is_me: false, gender: 'female', age: 24, age_category: 'age_18_24', birth_date: '2002-05-05', source: 'self' },
]
export const SNAPSHOTS = [
  { id: 's2', year: 2024, revenue_total: 260000, funding_raised_total: 100000, employees_total: 12, employees_female: 4, freelancers: 3, traction: '3 pilots', challenges: null, needs: 'Funding', source: 'founder', updated_at: '2026-10-01T00:00:00Z' },
  { id: 's1', year: 2023, revenue_total: 120000, funding_raised_total: 40000, employees_total: 7, employees_female: 2, freelancers: null, traction: null, challenges: null, needs: null, source: 'manager', updated_at: '2026-01-01T00:00:00Z' },
]
export const COMPANY_PAYLOAD = {
  company: COMPANY, team: TEAM, counts: { team_size: 3, female_founders: 2, founders_under_35: 2 }, ceo_founder_id: 'f1',
  programs: [{ program_id: 'g1', program_name_en: 'Finland', program_name_ar: 'فنلندا', program_type: 'accelerator', project_id: 'p1', project_name_en: 'Cohort 1', project_name_ar: 'الدفعة 1', completed: false, start_date: '2026-03-01', end_date: '2026-03-03', support: ['mentoring', 'training'] }],
  snapshots: SNAPSHOTS,
}
