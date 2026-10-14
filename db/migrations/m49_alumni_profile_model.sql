-- m49_alumni_profile_model.sql  (design 09: the shared DATA MODEL of the Alumni pages, driven by the owner's Excel columns; owner decisions 08 sections 18.7, 18.8, 19)
-- Re-runnable (if not exists / create or replace / drop ... if exists / on conflict do nothing). Local DB only. Non-destructive: no migrated row is deleted
-- and no existing value is overwritten; the backfill only FILLS new typed columns from values that already exist. Run AFTER m44 (m45 is unrelated).
--
-- What it adds (see docs/design/09-alumni-pages-and-profile-model.md for the reasoning, the crosswalk of the 38 Excel columns and the RPC reference)
--   1. app_private.eg_governorates()            the ONE list of the 27 Egyptian governorates (+ code 88 = born abroad) with ar / en names
--      app_private.id_* (IMMUTABLE, pure)       national-ID rules and derivation: id_normalize, id_invalid_reason, id_valid, id_birth_date, id_age,
--                                               id_age_category, id_gender, id_governorate_code / _name, id_mask. NO consumer re-implements them.
--   2. public.alumni_lookups                    bilingual lookup values (sector / sub sector, stage, startup type, legal status, closing reason, after closing,
--                                               support kind, age category, gender, education status, operating status, directory visibility); no direct API access
--   3. companies (+13 typed columns), founders (+education_status), company_snapshots (typed yearly metrics keyed by year)
--   4. public.founder_identities               THE place of the national ID (+ the flagged self-declared fallback); NO API grant at all (RPC only)
--      public.company_internal                 manager-only notes (Hint, directory veto, review stamp); NO API grant
--      app_private.founder_identity_access_log / alumni_probe_limits   audit of ID reads + a rate limit on ID-conflict probing
--   5. derived helpers: founder attributes (age / gender / governorate FROM THE ID), participations (Program Scope / Program Name / Support provided are DERIVED),
--      team statistics, social links
--   6. BEFORE triggers on companies (manager-only columns, lookup / governorate / date validation, shared by the RPC path and by any direct write)
--   7. RPCs: lookups, preview_national_id, get_my_alumni_profile, save_my_founder_profile, get_my_company_profile, save_my_company_profile,
--      save_company_team_member, remove_company_team_member, set_company_ceo, upsert_company_snapshot, list_alumni_directory, get_alumni_company,
--      get_alumni_founder, save_alumni_company, save_alumni_founder, set_companies_alumni, delete_company_snapshot, export_alumni_rows,
--      get_alumni_analytics, list_public_alumni_directory, create / revoke / list_alumni_invitation(s), save_alumni_lookup, delete_alumni_lookup
--   8. storage: founders upload their company logo to public-assets/alumni/<uid>/logo/ (WebP only, enforced by m41 / m43)
--   9. merge_companies patched IN PLACE (snapshots / internal notes / profile gaps) and the non-destructive BACKFILL of governorate_code / sector_key
set search_path = public, extensions;

begin;

-- ================================================================= 1. governorates + national-ID derivation (pure, IMMUTABLE)
-- THE list of governorates: the codes of digits 8-9 of the national ID (decision 19.3) = the values of companies.governorate_code. 88 = born abroad (not a company location).
create or replace function app_private.eg_governorates()
returns table (code smallint, key text, name_en text, name_ar text, is_abroad boolean)
language sql immutable parallel safe set search_path = '' as $$
  select g.code::smallint, g.key, g.name_en, g.name_ar, g.is_abroad from (values
    (1,  'cairo',           'Cairo',           'القاهرة',        false),
    (2,  'alexandria',      'Alexandria',      'الإسكندرية',     false),
    (3,  'port_said',       'Port Said',       'بورسعيد',        false),
    (4,  'suez',            'Suez',            'السويس',         false),
    (11, 'damietta',        'Damietta',        'دمياط',          false),
    (12, 'dakahlia',        'Dakahlia',        'الدقهلية',       false),
    (13, 'sharqia',         'Sharqia',         'الشرقية',        false),
    (14, 'qalyubia',        'Qalyubia',        'القليوبية',      false),
    (15, 'kafr_el_sheikh',  'Kafr El Sheikh',  'كفر الشيخ',      false),
    (16, 'gharbia',         'Gharbia',         'الغربية',        false),
    (17, 'monufia',         'Monufia',         'المنوفية',       false),
    (18, 'beheira',         'Beheira',         'البحيرة',        false),
    (19, 'ismailia',        'Ismailia',        'الإسماعيلية',    false),
    (21, 'giza',            'Giza',            'الجيزة',         false),
    (22, 'beni_suef',       'Beni Suef',       'بني سويف',       false),
    (23, 'fayoum',          'Fayoum',          'الفيوم',         false),
    (24, 'minya',           'Minya',           'المنيا',         false),
    (25, 'assiut',          'Assiut',          'أسيوط',          false),
    (26, 'sohag',           'Sohag',           'سوهاج',          false),
    (27, 'qena',            'Qena',            'قنا',            false),
    (28, 'aswan',           'Aswan',           'أسوان',          false),
    (29, 'luxor',           'Luxor',           'الأقصر',         false),
    (31, 'red_sea',         'Red Sea',         'البحر الأحمر',   false),
    (32, 'new_valley',      'New Valley',      'الوادي الجديد',  false),
    (33, 'matrouh',         'Matrouh',         'مطروح',          false),
    (34, 'north_sinai',     'North Sinai',     'شمال سيناء',     false),
    (35, 'south_sinai',     'South Sinai',     'جنوب سيناء',     false),
    (88, 'abroad',          'Born abroad',     'مولود بالخارج',  true)
  ) g(code, key, name_en, name_ar, is_abroad)
$$;

create or replace function app_private.eg_governorate_name(p_code integer, p_lang text default 'en') returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when lower(coalesce(p_lang, 'en')) = 'ar' then g.name_ar else g.name_en end from app_private.eg_governorates() g where g.code = p_code
$$;

-- text normaliser shared by the free-text resolvers (governorate, sector): lower case, alef / ya / ta-marbuta unified, diacritics, spaces and punctuation removed
create or replace function app_private.alumni_norm_text(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(translate(lower(btrim(coalesce(p, ''))), 'أإآىة', 'ااايه'), '[ً-ْـ[:space:]_./,،&()-]+', '', 'g')
$$;

-- a typed governorate (legacy companies.governorate_en / _ar: 'أسيوط', 'Cairo', 'Alex', 'محافظة سوهاج', 'Assiut, Egypt') -> code; NULL when not recognised.
-- Used by the BACKFILL and by nothing at write time (writes carry the code).
create or replace function app_private.eg_governorate_from_text(p text, p_allow_abroad boolean default false) returns smallint
language sql immutable parallel safe set search_path = '' as $$
  with n as (
    select app_private.alumni_norm_text(regexp_replace(split_part(replace(coalesce(p, ''), '،', ','), ',', 1), '(محافظ[ةه]|governorate|province|gov\.?)', '', 'gi')) s
  )
  select m.code::smallint from (
    select g.code, app_private.alumni_norm_text(g.key) k, g.is_abroad from app_private.eg_governorates() g
    union all select g.code, app_private.alumni_norm_text(g.name_en), g.is_abroad from app_private.eg_governorates() g
    union all select g.code, app_private.alumni_norm_text(g.name_ar), g.is_abroad from app_private.eg_governorates() g
    union all select a.code, app_private.alumni_norm_text(a.alias), false from (values
      ('alex', 2), ('اسكندرية', 2), ('assuit', 25), ('asyut', 25), ('asiut', 25), ('sharkia', 13), ('sharqiya', 13), ('qaliubia', 14), ('kalyubia', 14), ('qalyoubia', 14),
      ('gharbiya', 16), ('dakahleya', 12), ('daqahlia', 12), ('monufiya', 17), ('menoufia', 17), ('menofia', 17), ('behera', 18), ('buhayra', 18), ('minia', 24),
      ('fayyum', 23), ('faiyum', 23), ('bani suef', 22), ('kafr elsheikh', 15), ('kafrelsheikh', 15), ('matruh', 33), ('portsaid', 3), ('ismailiya', 19)
    ) a(alias, code)
  ) m, n
  where n.s <> '' and m.k = n.s and (p_allow_abroad or not m.is_abroad)
  limit 1
$$;

-- ---- national ID (decision 19.3). The 14th digit (check digit) is NOT validated: its algorithm is not public, no invented checksum.
-- normalisation: Arabic-Indic / Persian digits -> ASCII, spaces / dashes / dots / zero-width and bidi marks removed; anything else is kept (so it fails validation)
create or replace function app_private.id_normalize(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                '[[:space:]\-.​-‏‪-‮⁦-⁩﻿]+', '', 'g'), '')
$$;

-- NULL when the number is valid; otherwise the reason: empty | digits | length | century | date | future | governorate.
-- p_today NULL = structure only (no "future" rule; used by the CHECK constraint, which must be immutable); the RPCs pass app_private.alumni_today() (the date in Cairo).
create or replace function app_private.id_invalid_reason(p text, p_today date default null) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare n text := app_private.id_normalize(p); y int; m int; d int; dim int;
begin
  if n is null then return 'empty'; end if;
  if n !~ '^[0-9]+$' then return 'digits'; end if;
  if length(n) <> 14 then return 'length'; end if;
  if substr(n, 1, 1) not in ('2', '3') then return 'century'; end if;
  y := (case substr(n, 1, 1) when '2' then 1900 else 2000 end) + substr(n, 2, 2)::int;
  m := substr(n, 4, 2)::int;
  d := substr(n, 6, 2)::int;
  if m < 1 or m > 12 then return 'date'; end if;
  dim := case m when 2 then 28 + ((y % 4 = 0 and y % 100 <> 0) or y % 400 = 0)::int when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end;
  if d < 1 or d > dim then return 'date'; end if;
  if p_today is not null and make_date(y, m, d) > p_today then return 'future'; end if;
  if not exists (select 1 from app_private.eg_governorates() g where g.code = substr(n, 8, 2)::int) then return 'governorate'; end if;
  return null;
end $$;

create or replace function app_private.id_valid(p text, p_today date default null) returns boolean
language sql immutable parallel safe set search_path = '' as $$ select app_private.id_invalid_reason(p, p_today) is null $$;

-- date of birth: digit 1 = century (2 -> 19xx, 3 -> 20xx), digits 2-7 = YYMMDD. NULL when the structure is invalid. NOT stored anywhere.
create or replace function app_private.id_birth_date(p text) returns date
language sql immutable parallel safe set search_path = '' as $$
  select case when app_private.id_invalid_reason(p) is null then
    make_date((case substr(app_private.id_normalize(p), 1, 1) when '2' then 1900 else 2000 end) + substr(app_private.id_normalize(p), 2, 2)::int,
              substr(app_private.id_normalize(p), 4, 2)::int, substr(app_private.id_normalize(p), 6, 2)::int) end
$$;

-- completed years at p_today (the day before the birthday is still the previous age); NULL for an invalid ID or a birth date after p_today
create or replace function app_private.id_age(p text, p_today date) returns integer
language sql immutable parallel safe set search_path = '' as $$
  select case when app_private.id_birth_date(p) is null or p_today is null or app_private.id_birth_date(p) > p_today then null
              else extract(year from age(p_today, app_private.id_birth_date(p)))::int end
$$;

-- THE age buckets (one definition; "below 35" = under_18 + age_18_24 + age_25_34). Labels: alumni_lookups kind 'age_category'.
create or replace function app_private.id_age_category(p_age integer) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p_age is null or p_age < 0 then null
              when p_age < 18 then 'under_18' when p_age < 25 then 'age_18_24' when p_age < 35 then 'age_25_34'
              when p_age < 45 then 'age_35_44' else 'age_45_plus' end
$$;

-- digit 13: odd = male, even = female
create or replace function app_private.id_gender(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when app_private.id_invalid_reason(p) is null then (case substr(app_private.id_normalize(p), 13, 1)::int % 2 when 1 then 'male' else 'female' end) end
$$;

create or replace function app_private.id_governorate_code(p text) returns smallint
language sql immutable parallel safe set search_path = '' as $$
  select case when app_private.id_invalid_reason(p) is null then substr(app_private.id_normalize(p), 8, 2)::smallint end
$$;

create or replace function app_private.id_governorate_name(p text, p_lang text default 'en') returns text
language sql immutable parallel safe set search_path = '' as $$
  select app_private.eg_governorate_name(app_private.id_governorate_code(p), p_lang)
$$;

-- masked display: ten asterisks + the last four digits (the full number is never part of a list payload)
create or replace function app_private.id_mask(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when app_private.id_normalize(p) is null then null else repeat('*', 10) || right(app_private.id_normalize(p), 4) end
$$;

-- ================================================================= 2. lookups (bilingual, manager-editable, no direct API access)
create table if not exists public.alumni_lookups (
  kind        text not null,
  key         text not null,
  parent_kind text generated always as (case when kind = 'subsector' then 'sector' end) stored,
  parent_key  text,
  label_en    text not null,
  label_ar    text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (kind, key),
  constraint alumni_lookups_kind_chk check (kind in ('startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'closing_reason', 'after_closing', 'support_kind',
                                                      'age_category', 'gender', 'education_status', 'operating_status', 'directory_visibility')),
  constraint alumni_lookups_key_chk check (key ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
  constraint alumni_lookups_parent_chk check ((kind = 'subsector') = (parent_key is not null)),
  constraint alumni_lookups_labels_chk check (btrim(label_en) <> '' and btrim(label_ar) <> '' and char_length(label_en) <= 120 and char_length(label_ar) <= 120)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'alumni_lookups_parent_fk') then
    alter table public.alumni_lookups add constraint alumni_lookups_parent_fk foreign key (parent_kind, parent_key) references public.alumni_lookups (kind, key) on delete restrict;
  end if;
end $$;
drop index if exists public.alumni_lookups_parent_idx;
create index if not exists alumni_lookups_parent_fk_idx on public.alumni_lookups (parent_kind, parent_key) where parent_key is not null;
alter table public.alumni_lookups enable row level security;
alter table public.alumni_lookups force row level security;
revoke all on public.alumni_lookups from public, anon, authenticated;

-- seeds (on conflict do nothing: a manager's edit is never overwritten by a re-run)
insert into public.alumni_lookups (kind, key, parent_key, label_en, label_ar, sort_order, is_system) values
  -- startup type
  ('startup_type', 'startup',           null, 'Startup',           'شركة ناشئة',          10, false),
  ('startup_type', 'msme',              null, 'MSME',              'مشروع صغير ومتوسط',   20, false),
  ('startup_type', 'social_enterprise', null, 'Social enterprise', 'مشروع اجتماعي',        30, false),
  ('startup_type', 'other',             null, 'Other',             'أخرى',                 99, false),
  -- stage (the keys are exactly the values already stored in companies.stage)
  ('stage', 'idea_stage',         null, 'Idea stage',          'مرحلة الفكرة',                10, false),
  ('stage', 'prototype',          null, 'Prototype',           'نموذج أولي',                   20, false),
  ('stage', 'advanced_prototype', null, 'Advanced prototype',  'نموذج أولي متقدم',             30, false),
  ('stage', 'mvp',                null, 'MVP',                 'منتج أولي قابل للتجربة (MVP)', 40, false),
  ('stage', 'product',            null, 'Product',             'منتج في السوق',                50, false),
  ('stage', 'early_traction',     null, 'Early traction',      'بداية الانتشار',               60, false),
  ('stage', 'revenue',            null, 'Generating revenue',  'مرحلة الإيرادات',              70, false),
  ('stage', 'steady_revenue',     null, 'Steady revenue',      'إيرادات مستقرة',               80, false),
  ('stage', 'break-even_point',   null, 'Break-even point',    'نقطة التعادل',                 90, false),
  ('stage', 'profit',             null, 'Profitable',          'مرحلة الربح',                  100, false),
  ('stage', 'scaling',            null, 'Scaling',             'مرحلة التوسع',                 110, false),
  -- legal status (the five options of the legacy application form + other)
  ('legal_status', 'not_registered',       null, 'Not registered',                          'غير مسجل',                          10, false),
  ('legal_status', 'sole_proprietorship',  null, 'Sole proprietorship',                     'شركة فردية',                        20, false),
  ('legal_status', 'llc',                  null, 'Limited liability company',               'شركة ذات مسؤولية محدودة',           30, false),
  ('legal_status', 'joint_stock',          null, 'Joint-stock company',                     'شركة مساهمة',                       40, false),
  ('legal_status', 'nonprofit',            null, 'Non-profit association or foundation',   'جمعية أو مؤسسة غير هادفة للربح',    50, false),
  ('legal_status', 'other',                null, 'Other',                                   'أخرى',                              99, false),
  -- closing reason / after closing
  ('closing_reason', 'funding',          null, 'Lack of funding',                'نقص التمويل',                         10, false),
  ('closing_reason', 'market',           null, 'Not enough market demand',       'ضعف الطلب في السوق',                  20, false),
  ('closing_reason', 'team',             null, 'Team or partner issues',         'مشاكل في الفريق أو بين الشركاء',      30, false),
  ('closing_reason', 'legal_regulatory',  null, 'Legal or regulatory obstacles',  'عقبات قانونية أو تنظيمية',            40, false),
  ('closing_reason', 'economic',         null, 'Economic conditions',            'الظروف الاقتصادية',                   50, false),
  ('closing_reason', 'personal',         null, 'Personal reasons',               'أسباب شخصية',                         60, false),
  ('closing_reason', 'pivot',            null, 'Moved to a new idea',            'التحول إلى فكرة جديدة',               70, false),
  ('closing_reason', 'other',            null, 'Other',                          'أخرى',                                99, false),
  ('after_closing', 'new_startup',  null, 'Started a new venture',        'بدأ مشروعًا جديدًا',      10, false),
  ('after_closing', 'employed',     null, 'Took a job',                   'التحق بوظيفة',            20, false),
  ('after_closing', 'studying',     null, 'Went back to studies',         'عاد للدراسة',             30, false),
  ('after_closing', 'freelancing',  null, 'Freelancing',                  'يعمل بشكل حر',            40, false),
  ('after_closing', 'seeking',      null, 'Looking for opportunities',    'يبحث عن فرصة',            50, false),
  ('after_closing', 'other',        null, 'Other',                        'أخرى',                    99, false),
  -- support provided (derived from the nodes of the project, see app_private.alumni_project_support); labels only
  ('support_kind', 'mentoring',     null, 'Mentoring',               'الإرشاد والتوجيه',           10, true),
  ('support_kind', 'training',      null, 'Training and workshops',  'التدريب وورش العمل',        20, true),
  ('support_kind', 'resources',     null, 'Learning resources',      'مصادر التعلم',              30, true),
  ('support_kind', 'certification', null, 'Certification',           'الشهادات',                  40, true),
  -- closed vocabularies (CHECK constraints / derivation functions use these keys; only the labels are editable)
  ('age_category', 'under_18',    null, 'Under 18',     'أقل من 18',  10, true),
  ('age_category', 'age_18_24',   null, '18 - 24',      '18 - 24',    20, true),
  ('age_category', 'age_25_34',   null, '25 - 34',      '25 - 34',    30, true),
  ('age_category', 'age_35_44',   null, '35 - 44',      '35 - 44',    40, true),
  ('age_category', 'age_45_plus', null, '45 and above', '45 فأكثر',   50, true),
  ('gender', 'male',   null, 'Male',   'ذكر',   10, true),
  ('gender', 'female', null, 'Female', 'أنثى',  20, true),
  ('education_status', 'student',  null, 'Student',  'طالب',  10, true),
  ('education_status', 'graduate', null, 'Graduate', 'خريج',  20, true),
  ('education_status', 'other',    null, 'Other',    'أخرى',  30, true),
  ('operating_status', 'open',   null, 'Open',   'تعمل',    10, true),
  ('operating_status', 'closed', null, 'Closed', 'متوقفة',  20, true),
  ('directory_visibility', 'private', null, 'Private (only me and the Athar team)',  'خاص (أنا وفريق أثر فقط)',   10, true),
  ('directory_visibility', 'alumni',  null, 'Alumni network (signed-in alumni)',     'شبكة الخريجين (الخريجون المسجلون)', 20, true),
  ('directory_visibility', 'public',  null, 'Public directory',                      'الدليل العام',               30, true)
on conflict (kind, key) do nothing;

insert into public.alumni_lookups (kind, key, parent_key, label_en, label_ar, sort_order, is_system) values
  ('sector', 'agriculture',              null, 'Agriculture',                        'الزراعة',                         10, false),
  ('sector', 'food_beverage',            null, 'Food & Beverage',                    'الأغذية والمشروبات',               20, false),
  ('sector', 'healthcare',               null, 'Healthcare & Life Sciences',         'الرعاية الصحية وعلوم الحياة',      30, false),
  ('sector', 'technology',               null, 'Technology',                         'التكنولوجيا',                     40, false),
  ('sector', 'creative',                 null, 'Creative Industries',                'الصناعات الإبداعية',               50, false),
  ('sector', 'manufacturing',            null, 'Manufacturing',                      'التصنيع',                         60, false),
  ('sector', 'retail',                   null, 'Retail',                             'التجزئة',                         70, false),
  ('sector', 'ecommerce',                null, 'E-commerce',                         'التجارة الإلكترونية',              80, false),
  ('sector', 'logistics',                null, 'Logistics & Transportation',         'الخدمات اللوجستية والنقل',         90, false),
  ('sector', 'education',                null, 'Education',                          'التعليم',                         100, false),
  ('sector', 'sustainability',           null, 'Sustainability & Environment',       'الاستدامة والبيئة',                110, false),
  ('sector', 'energy',                   null, 'Energy & Utilities',                 'الطاقة والمرافق',                  120, false),
  ('sector', 'services',                 null, 'Services',                           'الخدمات',                         130, false),
  ('sector', 'finance',                  null, 'Finance & Insurance',                'الخدمات المالية والتأمين',         140, false),
  ('sector', 'construction_real_estate', null, 'Construction & Real Estate',         'البناء والعقارات',                 150, false),
  ('sector', 'media',                    null, 'Media & Communications',             'الإعلام والاتصالات',               160, false),
  ('sector', 'tourism_leisure',          null, 'Tourism & Leisure',                  'السياحة والترفيه',                 170, false),
  ('sector', 'other',                    null, 'Other',                              'أخرى',                            999, false)
on conflict (kind, key) do nothing;

-- the 55 options of the industry question of the legacy application forms, each under exactly one sector (nothing invented; the owner's own list replaces this seed)
insert into public.alumni_lookups (kind, key, parent_key, label_en, label_ar, sort_order) values
  ('subsector', 'agriculture',                    'agriculture',              'Agriculture',                              'الزراعة',                           10),
  ('subsector', 'food_beverages',                 'food_beverage',            'Food & Beverages',                         'الأغذية والمشروبات',                 10),
  ('subsector', 'healthcare_pharma',              'healthcare',               'Healthcare & Pharmaceuticals',             'الرعاية الصحية والأدوية',            10),
  ('subsector', 'biotech',                        'healthcare',               'Biotech',                                  'التقنية الحيوية',                    20),
  ('subsector', 'life_sciences',                  'healthcare',               'Life Sciences',                            'علوم الحياة',                        30),
  ('subsector', 'genome_editing',                 'healthcare',               'Genome editing',                           'تحرير الجينوم',                      40),
  ('subsector', 'wellness',                       'healthcare',               'Wellness',                                 'الصحة والعافية',                     50),
  ('subsector', 'telecom_internet_electronics',   'technology',               'Telecommunications / Internet & Electronics', 'الاتصالات والإنترنت والإلكترونيات',  10),
  ('subsector', 'consumer_electronics',           'technology',               'Consumer Electronics',                     'الإلكترونيات الاستهلاكية',           20),
  ('subsector', 'cyber_security',                 'technology',               'Cyber Security',                           'الأمن السيبراني',                    30),
  ('subsector', 'robotics',                       'technology',               'Robotics',                                 'الروبوتات',                          40),
  ('subsector', 'drones',                         'technology',               'Drones',                                   'الطائرات المسيّرة',                  50),
  ('subsector', 'image_face_recognition',         'technology',               'Image & Face recognition',                 'التعرف على الصور والوجوه',           60),
  ('subsector', 'language_recognition_translation','technology',              'Language recognition & translation',       'التعرف على اللغة والترجمة',          70),
  ('subsector', 'geolocation',                    'technology',               'Geolocation',                              'تحديد المواقع الجغرافية',            80),
  ('subsector', 'gadgets_wearables',              'technology',               'Gadgets & Wearables',                      'الأجهزة الذكية والقابلة للارتداء',   90),
  ('subsector', 'home_assistants',                'technology',               'Home assistants',                          'المساعدات المنزلية الذكية',          100),
  ('subsector', 'smart_homes_cities',             'technology',               'Smart Homes / Cities',                     'المنازل والمدن الذكية',              110),
  ('subsector', 'art_design',                     'creative',                 'Art & Design',                             'الفن والتصميم',                      10),
  ('subsector', 'fashion',                        'creative',                 'Fashion',                                  'الأزياء',                            20),
  ('subsector', 'culture',                        'creative',                 'Culture',                                  'الثقافة',                            30),
  ('subsector', 'gaming',                         'creative',                 'Gaming',                                   'الألعاب',                            40),
  ('subsector', 'architecture',                   'creative',                 'Architecture',                             'العمارة',                            50),
  ('subsector', 'manufacturing',                  'manufacturing',            'Manufacturing',                            'التصنيع',                            10),
  ('subsector', 'chemicals',                      'manufacturing',            'Chemicals',                                'الكيماويات',                         20),
  ('subsector', 'furniture',                      'manufacturing',            'Furniture',                                'الأثاث',                             30),
  ('subsector', 'automotive',                     'manufacturing',            'Automotive',                               'السيارات',                           40),
  ('subsector', 'airlines_aerospace',             'manufacturing',            'Airlines & Aerospace',                     'الطيران والفضاء',                    50),
  ('subsector', 'retail_consumer_durables',       'retail',                   'Retail & Consumer Durables',               'التجزئة والسلع الاستهلاكية المعمرة', 10),
  ('subsector', 'ecommerce',                      'ecommerce',                'E-commerce',                               'التجارة الإلكترونية',                10),
  ('subsector', 'transportation_delivery',        'logistics',                'Transportation & Delivery',                'النقل والتوصيل',                     10),
  ('subsector', 'mobility',                       'logistics',                'Mobility',                                 'التنقل',                             20),
  ('subsector', 'driverless_cars',                'logistics',                'Driverless Cars',                          'السيارات ذاتية القيادة',             30),
  ('subsector', 'education',                      'education',                'Education',                                'التعليم',                            10),
  ('subsector', 'green_clean_tech',               'sustainability',           'Green & Clean Tech',                       'التقنيات الخضراء والنظيفة',          10),
  ('subsector', 'waste_management_recycling',     'sustainability',           'Waste Management & Recycling',             'إدارة النفايات وإعادة التدوير',      20),
  ('subsector', 'social_impact',                  'sustainability',           'Social Impact',                            'الأثر الاجتماعي',                    30),
  ('subsector', 'energy_efficiency',              'sustainability',           'Energy Efficiency',                        'كفاءة الطاقة',                       40),
  ('subsector', 'utilities_energy_extraction',    'energy',                   'Utilities / Energy & Extraction',          'المرافق والطاقة والتعدين',           10),
  ('subsector', 'business_support_logistics',     'services',                 'Business Support & Logistics',             'دعم الأعمال والخدمات اللوجستية',     10),
  ('subsector', 'recruitment_jobs',               'services',                 'Recruitment & Jobs',                       'التوظيف والوظائف',                   20),
  ('subsector', 'legal',                          'services',                 'Legal',                                    'الخدمات القانونية',                  30),
  ('subsector', 'advertising_marketing',          'services',                 'Advertising & Marketing',                  'الإعلان والتسويق',                   40),
  ('subsector', 'government',                     'services',                 'Government',                               'الحكومة',                            50),
  ('subsector', 'security_defence',               'services',                 'Security & Defence',                       'الأمن والدفاع',                      60),
  ('subsector', 'nonprofit',                      'services',                 'Nonprofit',                                'غير هادف للربح',                     70),
  ('subsector', 'finance_financial_services',     'finance',                  'Finance & Financial Services',             'التمويل والخدمات المالية',           10),
  ('subsector', 'insurance',                      'finance',                  'Insurance',                                'التأمين',                            20),
  ('subsector', 'construction_machinery_homes',   'construction_real_estate', 'Construction / Machinery & Homes',         'البناء والآلات والمنازل',            10),
  ('subsector', 'real_estate',                    'construction_real_estate', 'Real Estate',                              'العقارات',                           20),
  ('subsector', 'media_communications',           'media',                    'Media & Communications',                   'الإعلام والاتصالات',                 10),
  ('subsector', 'social_networking',              'media',                    'Social Networking',                        'الشبكات الاجتماعية',                 20),
  ('subsector', 'tourism',                        'tourism_leisure',          'Tourism',                                  'السياحة',                            10),
  ('subsector', 'sports',                         'tourism_leisure',          'Sports',                                   'الرياضة',                            20),
  ('subsector', 'entertainment_leisure',          'tourism_leisure',          'Entertainment & Leisure',                  'الترفيه والتسلية',                   30)
on conflict (kind, key) do nothing;

create or replace function app_private.alumni_lookup_ok(p_kind text, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.alumni_lookups l where l.kind = p_kind and l.key = p_key and l.is_active)
$$;

create or replace function app_private.alumni_label(p_kind text, p_key text, p_lang text default 'en') returns text
language sql stable security definer set search_path = '' as $$
  select case when lower(coalesce(p_lang, 'en')) = 'ar' then l.label_ar else l.label_en end from public.alumni_lookups l where l.kind = p_kind and l.key = p_key
$$;

-- legacy free-text industry ('التكنولوجيا، الخدمات', 'Technology, Manufacturing', 'Food & Beverage') -> PRIMARY sector key: the first listed value, matched on the label
-- of a sector (either language) or on a short alias. NULL when not recognised. Used by the BACKFILL only.
create or replace function app_private.alumni_sector_from_text(p text) returns text
language sql stable security definer set search_path = '' as $$
  with n as (select app_private.alumni_norm_text(split_part(split_part(replace(coalesce(p, ''), '،', ','), ',', 1), ';', 1)) s)
  select m.key from (
    select l.key, app_private.alumni_norm_text(l.label_en) k from public.alumni_lookups l where l.kind = 'sector'
    union all select l.key, app_private.alumni_norm_text(l.label_ar) from public.alumni_lookups l where l.kind = 'sector'
    union all select a.key, app_private.alumni_norm_text(a.alias) from (values
      ('healthcare', 'healthcare'), ('healthcare', 'الرعاية الصحية'), ('food_beverage', 'food beverage'), ('food_beverage', 'food & beverages'), ('logistics', 'logistics / transportation'),
      ('logistics', 'الخدمات اللوجستية / النقل'), ('sustainability', 'sustainability / environment'), ('sustainability', 'الاستدامة / البيئة'), ('technology', 'tech'),
      ('creative', 'creative'), ('ecommerce', 'e commerce'), ('retail', 'retail & consumer durables')
    ) a(key, alias)
  ) m, n where n.s <> '' and m.k = n.s limit 1
$$;

-- ================================================================= 3. typed columns (all nullable / defaulted: the PM list screens keep working unchanged)
alter table public.companies
  add column if not exists startup_type_key     text,
  add column if not exists sector_key           text,
  add column if not exists subsector_key        text,
  add column if not exists governorate_code     smallint,
  add column if not exists established_on       date,
  add column if not exists app_url              text,
  add column if not exists legal_status_key     text,
  add column if not exists operating_status     text not null default 'open',
  add column if not exists closed_on            date,
  add column if not exists closing_reason_key   text,
  add column if not exists after_closing_key    text,
  add column if not exists closing_note         text,
  add column if not exists directory_visibility text not null default 'private';

alter table public.companies drop constraint if exists companies_operating_status_chk;
alter table public.companies add constraint companies_operating_status_chk check (operating_status in ('open', 'closed'));
alter table public.companies drop constraint if exists companies_directory_visibility_chk;
alter table public.companies add constraint companies_directory_visibility_chk check (directory_visibility in ('private', 'alumni', 'public'));
alter table public.companies drop constraint if exists companies_closed_fields_chk;
alter table public.companies add constraint companies_closed_fields_chk
  check (operating_status = 'closed' or (closed_on is null and closing_reason_key is null and after_closing_key is null and closing_note is null));
alter table public.companies drop constraint if exists companies_app_url_chk;
alter table public.companies add constraint companies_app_url_chk check (app_url is null or (char_length(app_url) <= 500 and app_url ~* '^https?://[^[:space:]]+$'));
alter table public.companies drop constraint if exists companies_closing_note_chk;
alter table public.companies add constraint companies_closing_note_chk check (closing_note is null or char_length(closing_note) <= 1000);
alter table public.companies drop constraint if exists companies_established_chk;
alter table public.companies add constraint companies_established_chk check (established_on is null or established_on >= date '1900-01-01');
create index if not exists companies_sector_idx on public.companies (sector_key) where sector_key is not null;
create index if not exists companies_governorate_code_idx on public.companies (governorate_code) where governorate_code is not null;
create index if not exists companies_stage_idx on public.companies (stage) where stage is not null;
create index if not exists companies_directory_idx on public.companies (directory_visibility) where directory_visibility <> 'private';
create index if not exists companies_closed_idx on public.companies (operating_status) where operating_status = 'closed';

alter table public.founders add column if not exists education_status text;
alter table public.founders drop constraint if exists founders_education_status_chk;
alter table public.founders add constraint founders_education_status_chk check (education_status is null or education_status in ('student', 'graduate', 'other'));

-- ================================================================= 4. the identity table, the manager-only table, the audit and the probe limiter
-- ONE place for the national ID (decision 19.1). Nothing derived is stored: birth date / age / gender / governorate are COMPUTED from national_id by app_private.id_*.
-- self_birth_date / self_gender are the flagged "self-declared" fallback that exists ONLY while there is no ID (CHECK: with an ID both are NULL = no second copy).
create table if not exists public.founder_identities (
  founder_id      uuid primary key references public.founders(id) on delete cascade,
  national_id     text,
  self_birth_date date,
  self_gender     text,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint founder_identities_nid_chk check (national_id is null or (national_id ~ '^[23][0-9]{13}$' and app_private.id_invalid_reason(national_id) is null)),
  constraint founder_identities_self_gender_chk check (self_gender is null or self_gender in ('male', 'female')),
  constraint founder_identities_self_dob_chk check (self_birth_date is null or self_birth_date >= date '1900-01-01'),
  constraint founder_identities_id_wins_chk check (national_id is null or (self_birth_date is null and self_gender is null)),
  constraint founder_identities_not_empty_chk check (national_id is not null or self_birth_date is not null or self_gender is not null)
);
create unique index if not exists founder_identities_national_id_key on public.founder_identities (national_id);
alter table public.founder_identities enable row level security;
alter table public.founder_identities force row level security;
revoke all on public.founder_identities from public, anon, authenticated;

-- manager-only notes: the Excel "Hint" column, the directory veto and the review stamp. A founder can read his own company row but NOT this table.
create table if not exists public.company_internal (
  company_id       uuid primary key references public.companies(id) on delete cascade,
  hint             text,
  directory_hidden boolean not null default false,
  reviewed_at      timestamptz,
  reviewed_by      uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint company_internal_hint_chk check (hint is null or char_length(hint) <= 2000)
);
alter table public.company_internal enable row level security;
alter table public.company_internal force row level security;
revoke all on public.company_internal from public, anon, authenticated;

-- who read national IDs and how (one row per reveal / export, with the number of rows: never the numbers); not reachable through the API
create table if not exists app_private.founder_identity_access_log (
  id          bigint generated always as identity primary key,
  accessed_by uuid,
  accessed_at timestamptz not null default now(),
  via         text not null,
  founder_id  uuid,
  row_count   integer not null default 1
);
alter table app_private.founder_identity_access_log enable row level security;
alter table app_private.founder_identity_access_log force row level security;
revoke all on app_private.founder_identity_access_log from public, anon, authenticated;

-- ID-conflict probing limiter (a signed-in founder could otherwise test whether a number is registered): 5 conflicts per hour per account
create table if not exists app_private.alumni_probe_limits (
  user_id uuid not null,
  bucket  timestamptz not null,
  hits    integer not null default 0,
  primary key (user_id, bucket)
);
alter table app_private.alumni_probe_limits enable row level security;
alter table app_private.alumni_probe_limits force row level security;
revoke all on app_private.alumni_probe_limits from public, anon, authenticated;

-- ================================================================= 5. company_snapshots: typed yearly metrics (one ANNUAL row per company and year)
alter table public.company_snapshots
  add column if not exists period_year          smallint,
  add column if not exists revenue_total        numeric(16, 2),
  add column if not exists funding_raised_total numeric(16, 2),
  add column if not exists employees_total      integer,
  add column if not exists employees_female     integer,
  add column if not exists freelancers          integer,
  add column if not exists traction             text,
  add column if not exists challenges           text,
  add column if not exists needs                text,
  add column if not exists updated_by           uuid references auth.users(id) on delete set null,
  add column if not exists updated_at           timestamptz not null default now();
alter table public.company_snapshots drop constraint if exists company_snapshots_type_chk;
alter table public.company_snapshots add constraint company_snapshots_type_chk check (snapshot_type in ('annual', 'baseline', 'followup', 'manual'));
alter table public.company_snapshots drop constraint if exists company_snapshots_source_chk;
alter table public.company_snapshots add constraint company_snapshots_source_chk check (source in ('founder', 'manager', 'import', 'form'));
alter table public.company_snapshots drop constraint if exists company_snapshots_year_chk;
alter table public.company_snapshots add constraint company_snapshots_year_chk
  check ((snapshot_type <> 'annual' or period_year is not null) and (period_year is null or period_year between 1990 and 2100));
alter table public.company_snapshots drop constraint if exists company_snapshots_numbers_chk;
alter table public.company_snapshots add constraint company_snapshots_numbers_chk
  check ((revenue_total is null or revenue_total between 0 and 1000000000000) and (funding_raised_total is null or funding_raised_total between 0 and 1000000000000)
     and (employees_total is null or employees_total between 0 and 1000000) and (employees_female is null or employees_female between 0 and 1000000)
     and (freelancers is null or freelancers between 0 and 1000000) and (employees_female is null or employees_total is null or employees_female <= employees_total));
alter table public.company_snapshots drop constraint if exists company_snapshots_text_chk;
alter table public.company_snapshots add constraint company_snapshots_text_chk
  check ((traction is null or char_length(traction) <= 4000) and (challenges is null or char_length(challenges) <= 4000) and (needs is null or char_length(needs) <= 4000));
create unique index if not exists company_snapshots_annual_year_key on public.company_snapshots (company_id, period_year) where snapshot_type = 'annual';

-- financial figures are private by default: the founders of the company and the alumni managers read them, a PM of a project the company joined does NOT (03 table 8.3 tightened).
-- Writes happen only through upsert_company_snapshot / delete_company_snapshot (definer): no INSERT / UPDATE grant any more.
drop policy if exists company_snapshots_select_own_mgr_pm on public.company_snapshots;
drop policy if exists company_snapshots_select_own_mgr on public.company_snapshots;
create policy company_snapshots_select_own_mgr on public.company_snapshots for select to authenticated
  using (company_id in (select app_private.my_company_ids()) or (select app_private.has_any_role(array['alumni_manager', 'super_admin'])));
drop policy if exists company_snapshots_insert_own_or_mgr on public.company_snapshots;
drop policy if exists company_snapshots_update_mgr on public.company_snapshots;
revoke insert, update, delete on public.company_snapshots from anon, authenticated;

-- ================================================================= 6. derived helpers (every consumer uses these: nothing is re-implemented)
-- "today" of the Egyptian ID rules (age, birthdays, "not in the future", the reporting year) is the date in CAIRO, not in UTC
create or replace function app_private.alumni_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Africa/Cairo')::date $$;

create or replace function app_private.alumni_is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.has_any_role(array['alumni_manager', 'super_admin'])
$$;

-- founder attributes DERIVED from the ID (decision 19.1: "the ID always wins"): with a national_id all five values come from it; without one, the flagged
-- self-declared birth date / gender are used and `source` says so; the governorate of origin exists only with an ID. One row per live founder (or just p_founder).
create or replace function app_private.alumni_founder_attrs(p_today date default app_private.alumni_today(), p_founder uuid default null)
returns table (founder_id uuid, birth_date date, age integer, age_category text, gender text, governorate_code smallint, source text)
language sql stable security definer set search_path = '' as $$
  select a.fid, a.bd, a.ag, app_private.id_age_category(a.ag), a.gn, a.gv, a.src from (
    select f.id as fid,
           case when i.national_id is not null then app_private.id_birth_date(i.national_id) else i.self_birth_date end as bd,
           case when i.national_id is not null then app_private.id_age(i.national_id, p_today)
                when i.self_birth_date is not null and i.self_birth_date <= p_today then extract(year from age(p_today, i.self_birth_date))::int end as ag,
           case when i.national_id is not null then app_private.id_gender(i.national_id) else i.self_gender end as gn,
           case when i.national_id is not null then app_private.id_governorate_code(i.national_id) end as gv,
           case when i.national_id is not null then 'id' when i.self_birth_date is not null or i.self_gender is not null then 'self' end as src
      from public.founders f left join public.founder_identities i on i.founder_id = f.id
     where f.deleted_at is null and (p_founder is null or f.id = p_founder)) a
$$;

-- the CEO of a company = its primary founder; else the earliest linked founder (deterministic: created_at, id)
create or replace function app_private.alumni_company_ceo(p_company uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select cf.founder_id from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
   where cf.company_id = p_company order by cf.is_primary desc, cf.created_at, cf.founder_id limit 1
$$;

-- Founding team size / Female founders / Nu. of founders below 35 = COUNTS over the linked founders (never typed)
create or replace function app_private.alumni_team_stats(p_today date default app_private.alumni_today(), p_company uuid default null)
returns table (company_id uuid, team_size integer, female_founders integer, founders_under_35 integer)
language sql stable security definer set search_path = '' as $$
  select cf.company_id, count(*)::int, (count(*) filter (where a.gender = 'female'))::int, (count(*) filter (where a.age < 35))::int
    from public.company_founders cf
    join public.founders f on f.id = cf.founder_id and f.deleted_at is null
    left join app_private.alumni_founder_attrs(p_today) a on a.founder_id = f.id
   where p_company is null or cf.company_id = p_company
   group by cf.company_id
$$;

-- Program Scope / Program Name / Support provided are DERIVED, never typed: a company took part in a project when it is a participant (accepted / attended)
-- OR an item of a company list of that project; a withdrawn company (the m40 predicate) and a legacy-hidden item do not count.
create or replace function app_private.alumni_participations() returns table (company_id uuid, project_id uuid, program_id uuid)
language sql stable security definer set search_path = '' as $$
  select x.company_id, x.project_id, j.program_id from (
    select pa.company_id, pa.project_id from public.participants pa where pa.company_id is not null and pa.status in ('accepted', 'attended')
    union
    select li.company_id, li.project_id from public.list_items li
      join public.lists l on l.node_id = li.list_node_id and l.subkind = 'company'
      join public.nodes n on n.id = l.node_id and n.deleted_at is null
     where li.company_id is not null and not li.excluded and li.withdrawn_at is null) x
  join public.projects j on j.id = x.project_id and j.deleted_at is null
  join public.programs g on g.id = j.program_id and g.deleted_at is null
  where not app_private.is_withdrawn(x.project_id, null, x.company_id, null)
$$;

-- support kinds a project provides, from the node types it holds (booking / distribution -> mentoring, agenda -> training, library -> resources, certificates -> certification)
create or replace function app_private.alumni_project_support(p_project uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct s.k), '{}'::text[]) from (
    select case when n.type in ('booking', 'distribution') then 'mentoring' when n.type = 'agenda' then 'training'
                when n.type = 'library' then 'resources' when n.type = 'certificates' then 'certification' end as k
      from public.nodes n where n.project_id = p_project and n.deleted_at is null) s where s.k is not null
$$;

create or replace function app_private.alumni_company_programs_json(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('program_id', g.id, 'program_name_en', g.name_en, 'program_name_ar', g.name_ar, 'program_type', g.program_type,
           'project_id', j.id, 'project_name_en', j.name_en, 'project_name_ar', j.name_ar, 'completed', j.completed_at is not null,
           'start_date', (select min(d.day_date) from public.agenda_days d join public.nodes n on n.id = d.node_id and n.deleted_at is null where n.project_id = j.id),
           'end_date', (select max(d.day_date) from public.agenda_days d join public.nodes n on n.id = d.node_id and n.deleted_at is null where n.project_id = j.id),
           'support', to_jsonb(app_private.alumni_project_support(j.id))) order by g.created_at, g.id, j.created_at, j.id), '[]'::jsonb)
    from app_private.alumni_participations() ap
    join public.projects j on j.id = ap.project_id
    join public.programs g on g.id = ap.program_id
   where ap.company_id = p_company
$$;

-- social media of a company: the typed entries of `links` (legacy {type,label,url} or {kind,url}) whose kind is a social network + linkedin_url
create or replace function app_private.alumni_social_links(p_links jsonb, p_linkedin text) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', s.k, 'url', s.u)), '[]'::jsonb) from (
    select case when lower(coalesce(e->>'kind', e->>'type')) = 'twitter' then 'x' else lower(coalesce(e->>'kind', e->>'type')) end as k, e->>'url' as u
      from jsonb_array_elements(case when jsonb_typeof(p_links) = 'array' then p_links else '[]'::jsonb end) e
    union all
    select 'linkedin', p_linkedin where p_linkedin is not null and btrim(p_linkedin) <> '') s
  where s.k in ('facebook', 'instagram', 'x', 'tiktok', 'youtube', 'telegram', 'whatsapp', 'linkedin') and s.u is not null and btrim(s.u) <> ''
$$;

-- the CANONICAL links of a company for the profile form: legacy entries ({type,label,url}: 'globe' = a plain link) become {kind,url,label?}; an entry that only repeats the
-- website or the LinkedIn page is dropped (those live in website_url / linkedin_url, one place); unknown kinds become 'other'. Read side only: nothing stored changes until a save.
create or replace function app_private.alumni_links_json(p_links jsonb, p_website text, p_linkedin text) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', n.kind, 'url', n.url, 'label', n.label)) order by n.ord), '[]'::jsonb) from (
    select t.ord, e->>'url' as url, nullif(left(btrim(coalesce(e->>'label', '')), 60), '') as label,
           case when lower(coalesce(e->>'kind', e->>'type', '')) = 'twitter' then 'x'
                when lower(coalesce(e->>'kind', e->>'type', '')) in ('facebook', 'instagram', 'x', 'tiktok', 'youtube', 'telegram', 'whatsapp', 'deck', 'video') then lower(coalesce(e->>'kind', e->>'type'))
                when lower(coalesce(e->>'kind', e->>'type', '')) = 'linkedin' then 'linkedin' else 'other' end as kind
      from jsonb_array_elements(case when jsonb_typeof(p_links) = 'array' then p_links else '[]'::jsonb end) with ordinality t(e, ord)) n
  where n.url is not null and btrim(n.url) <> '' and n.kind <> 'linkedin' and n.url is distinct from p_website and n.url is distinct from p_linkedin
$$;

-- the LinkedIn page of a company: the column, else the first LinkedIn entry of a legacy links array
create or replace function app_private.alumni_linkedin(p_links jsonb, p_linkedin text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(nullif(btrim(p_linkedin), ''), (select e->>'url' from jsonb_array_elements(case when jsonb_typeof(p_links) = 'array' then p_links else '[]'::jsonb end) with ordinality t(e, ord)
                                                    where lower(coalesce(e->>'kind', e->>'type', '')) = 'linkedin' and nullif(btrim(coalesce(e->>'url', '')), '') is not null order by ord limit 1))
$$;

create or replace function app_private.alumni_social_text(p_links jsonb, p_linkedin text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(string_agg(initcap(e->>'kind') || ': ' || (e->>'url'), '; '), '') from jsonb_array_elements(app_private.alumni_social_links(p_links, p_linkedin)) e
$$;

-- completeness (percent + the missing keys): the founder profile and the company profile
create or replace function app_private.alumni_founder_missing(p_founder uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when f.name_en is null and f.name_ar is null then 'name' end,
    case when f.phone is null then 'phone' end,
    case when i.national_id is null and (i.self_birth_date is null or i.self_gender is null) then 'identity' end,
    case when f.education_status is null then 'education_status' end], null)
    from public.founders f left join public.founder_identities i on i.founder_id = f.id where f.id = p_founder
$$;

create or replace function app_private.alumni_company_missing(p_company uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when c.name_en is null and c.name_ar is null then 'name' end,
    case when c.description_en is null and c.description_ar is null then 'description' end,
    case when c.startup_type_key is null then 'startup_type' end,
    case when c.sector_key is null then 'sector' end,
    case when c.stage is null then 'stage' end,
    case when c.legal_status_key is null then 'legal_status' end,
    case when c.governorate_code is null then 'governorate' end,
    case when c.established_on is null then 'established_on' end,
    case when c.website_url is null and c.app_url is null and jsonb_array_length(app_private.alumni_social_links(c.links, c.linkedin_url)) = 0 then 'online_presence' end,
    case when not exists (select 1 from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'annual'
                             and s.period_year >= extract(year from app_private.alumni_today())::int - 1) then 'annual_update' end], null)
    from public.companies c where c.id = p_company
$$;

create or replace function app_private.alumni_completeness_json(p_missing text[], p_total integer) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select jsonb_build_object('percent', greatest(0, round(100.0 * (p_total - coalesce(cardinality(p_missing), 0)) / p_total)::int), 'missing', to_jsonb(coalesce(p_missing, '{}'::text[])))
$$;

-- ================================================================= 7. BEFORE trigger on companies: manager-only columns + the validation EVERY writer goes through
-- (the RPC path and a direct PostgREST write by a founder or a PM). Only values that CHANGE are validated, so legacy values stay readable.
create or replace function app_private.alumni_companies_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_parent text;
begin
  if v_uid is not null and not app_private.alumni_is_manager() then
    if tg_op = 'INSERT' and new.is_alumni then
      raise exception 'forbidden: only an alumni manager can mark a company as alumni' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.is_alumni is distinct from old.is_alumni or new.created_by is distinct from old.created_by) then
      raise exception 'forbidden: only an alumni manager can change is_alumni / created_by' using errcode = '42501';
    end if;
  end if;

  if new.startup_type_key is not null and (tg_op = 'INSERT' or new.startup_type_key is distinct from old.startup_type_key) and not app_private.alumni_lookup_ok('startup_type', new.startup_type_key) then
    raise exception 'alumni_invalid: startup_type:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'startup_type:unknown';
  end if;
  if new.stage is not null and (tg_op = 'INSERT' or new.stage is distinct from old.stage) and not app_private.alumni_lookup_ok('stage', new.stage) then
    raise exception 'alumni_invalid: stage:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'stage:unknown';
  end if;
  if new.legal_status_key is not null and (tg_op = 'INSERT' or new.legal_status_key is distinct from old.legal_status_key) and not app_private.alumni_lookup_ok('legal_status', new.legal_status_key) then
    raise exception 'alumni_invalid: legal_status:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'legal_status:unknown';
  end if;
  if new.closing_reason_key is not null and (tg_op = 'INSERT' or new.closing_reason_key is distinct from old.closing_reason_key) and not app_private.alumni_lookup_ok('closing_reason', new.closing_reason_key) then
    raise exception 'alumni_invalid: closing_reason:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'closing_reason:unknown';
  end if;
  if new.after_closing_key is not null and (tg_op = 'INSERT' or new.after_closing_key is distinct from old.after_closing_key) and not app_private.alumni_lookup_ok('after_closing', new.after_closing_key) then
    raise exception 'alumni_invalid: after_closing:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'after_closing:unknown';
  end if;
  if new.sector_key is not null and (tg_op = 'INSERT' or new.sector_key is distinct from old.sector_key) and not app_private.alumni_lookup_ok('sector', new.sector_key) then
    raise exception 'alumni_invalid: sector:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'sector:unknown';
  end if;
  if new.subsector_key is not null then
    if new.sector_key is null then
      raise exception 'alumni_invalid: subsector:needs_sector' using errcode = '22023', hint = 'alumni_invalid', detail = 'subsector:needs_sector';
    end if;
    if tg_op = 'INSERT' or new.subsector_key is distinct from old.subsector_key or new.sector_key is distinct from old.sector_key then
      select l.parent_key into v_parent from public.alumni_lookups l where l.kind = 'subsector' and l.key = new.subsector_key and l.is_active;
      if not found then
        raise exception 'alumni_invalid: subsector:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'subsector:unknown';
      elsif v_parent is distinct from new.sector_key then
        raise exception 'alumni_invalid: subsector:parent_mismatch' using errcode = '22023', hint = 'alumni_invalid', detail = 'subsector:parent_mismatch';
      end if;
    end if;
  end if;
  if new.governorate_code is not null and (tg_op = 'INSERT' or new.governorate_code is distinct from old.governorate_code)
     and not exists (select 1 from app_private.eg_governorates() g where g.code = new.governorate_code and not g.is_abroad) then
    raise exception 'alumni_invalid: governorate:unknown' using errcode = '22023', hint = 'alumni_invalid', detail = 'governorate:unknown';
  end if;
  if new.established_on is not null and (tg_op = 'INSERT' or new.established_on is distinct from old.established_on) and new.established_on > app_private.alumni_today() then
    raise exception 'alumni_invalid: established_on:future' using errcode = '22023', hint = 'alumni_invalid', detail = 'established_on:future';
  end if;
  if new.closed_on is not null and (tg_op = 'INSERT' or new.closed_on is distinct from old.closed_on) and (new.closed_on > app_private.alumni_today() or new.closed_on < date '1900-01-01') then
    raise exception 'alumni_invalid: closed_on:bad_date' using errcode = '22023', hint = 'alumni_invalid', detail = 'closed_on:bad_date';
  end if;
  return new;
end $$;
drop trigger if exists companies_bu_alumni_guard on public.companies;
create trigger companies_bu_alumni_guard before insert or update on public.companies for each row execute function app_private.alumni_companies_guard();

-- ================================================================= 8. error helper, lookups RPCs, national-ID preview
-- ONE way to refuse a value: SQLSTATE 22023, message / hint = the token `alumni_invalid`, detail = "<field>:<reason>"
create or replace function app_private.alumni_fail(p_field text, p_reason text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'alumni_invalid: %:%', p_field, p_reason using errcode = '22023', hint = 'alumni_invalid', detail = p_field || ':' || p_reason;
end $$;

create or replace function app_private.alumni_lookup_json(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', l.key, 'label_en', l.label_en, 'label_ar', l.label_ar, 'sort', l.sort_order, 'active', l.is_active, 'system', l.is_system)
                            order by l.sort_order, l.key), '[]'::jsonb)
    from public.alumni_lookups l where l.kind = p_kind
$$;

-- ONE cached call fills every select / chip / filter of both builders (static vocabulary, no personal data: anon may read it, the public directory needs the labels)
create or replace function public.list_alumni_lookups() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'governorates', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'key', g.key, 'name_en', g.name_en, 'name_ar', g.name_ar, 'is_abroad', g.is_abroad) order by g.code), '[]'::jsonb)
                       from app_private.eg_governorates() g),
    'sectors', (select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'label_en', s.label_en, 'label_ar', s.label_ar, 'sort', s.sort_order, 'active', s.is_active, 'system', s.is_system,
                         'subsectors', (select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'label_en', x.label_en, 'label_ar', x.label_ar, 'sort', x.sort_order, 'active', x.is_active, 'system', x.is_system)
                                                                  order by x.sort_order, x.key), '[]'::jsonb)
                                          from public.alumni_lookups x where x.kind = 'subsector' and x.parent_key = s.key)) order by s.sort_order, s.key), '[]'::jsonb)
                  from public.alumni_lookups s where s.kind = 'sector'),
    'stages', app_private.alumni_lookup_json('stage'),
    'startup_types', app_private.alumni_lookup_json('startup_type'),
    'legal_statuses', app_private.alumni_lookup_json('legal_status'),
    'closing_reasons', app_private.alumni_lookup_json('closing_reason'),
    'after_closing', app_private.alumni_lookup_json('after_closing'),
    'support_kinds', app_private.alumni_lookup_json('support_kind'),
    'age_categories', app_private.alumni_lookup_json('age_category'),
    'genders', app_private.alumni_lookup_json('gender'),
    'education_statuses', app_private.alumni_lookup_json('education_status'),
    'operating_statuses', app_private.alumni_lookup_json('operating_status'),
    'directory_visibilities', app_private.alumni_lookup_json('directory_visibility'),
    'version', (select coalesce(max(l.updated_at), 'epoch'::timestamptz) from public.alumni_lookups l))
$$;

create or replace function public.save_alumni_lookup(p_kind text, p_key text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.alumni_lookups; k text; v_closed boolean := p_kind in ('support_kind', 'age_category', 'gender', 'education_status', 'operating_status', 'directory_visibility');
        v_en text; v_ar text; v_sort integer; v_active boolean; v_parent text;
begin
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('patch', 'not_an_object'); end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('label_en', 'label_ar', 'sort_order', 'is_active', 'parent_key') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
  end loop;
  if p_kind is null or p_kind not in ('startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'closing_reason', 'after_closing', 'support_kind',
                                       'age_category', 'gender', 'education_status', 'operating_status', 'directory_visibility') then perform app_private.alumni_fail('kind', 'unknown'); end if;
  if p_key is null or p_key !~ '^[a-z0-9][a-z0-9_.-]{0,62}$' then perform app_private.alumni_fail('key', 'bad_value'); end if;
  if p_patch ? 'label_en' then v_en := nullif(btrim(p_patch->>'label_en'), ''); if v_en is null or char_length(v_en) > 120 then perform app_private.alumni_fail('label_en', 'bad_value'); end if; end if;
  if p_patch ? 'label_ar' then v_ar := nullif(btrim(p_patch->>'label_ar'), ''); if v_ar is null or char_length(v_ar) > 120 then perform app_private.alumni_fail('label_ar', 'bad_value'); end if; end if;
  if p_patch ? 'sort_order' then
    begin v_sort := (p_patch->>'sort_order')::int; exception when others then perform app_private.alumni_fail('sort_order', 'not_a_number'); end;
    if v_sort not between 0 and 100000 then perform app_private.alumni_fail('sort_order', 'out_of_range'); end if;
  end if;
  if p_patch ? 'is_active' then
    if jsonb_typeof(p_patch->'is_active') <> 'boolean' then perform app_private.alumni_fail('is_active', 'not_a_boolean'); end if;
    v_active := (p_patch->>'is_active')::boolean;
  end if;
  v_parent := nullif(btrim(p_patch->>'parent_key'), '');

  select * into l from public.alumni_lookups x where x.kind = p_kind and x.key = p_key for update;
  if not found then
    if v_closed then perform app_private.alumni_fail('key', 'closed_vocabulary'); end if;
    if v_en is null or v_ar is null then perform app_private.alumni_fail('label', 'required'); end if;
    if p_kind = 'subsector' and (v_parent is null or not exists (select 1 from public.alumni_lookups s where s.kind = 'sector' and s.key = v_parent)) then perform app_private.alumni_fail('parent_key', 'unknown'); end if;
    if p_kind <> 'subsector' and v_parent is not null then perform app_private.alumni_fail('parent_key', 'not_allowed'); end if;
    insert into public.alumni_lookups (kind, key, parent_key, label_en, label_ar, sort_order, is_active)
    values (p_kind, p_key, v_parent, v_en, v_ar, coalesce(v_sort, 500), coalesce(v_active, true)) returning * into l;
  else
    if p_patch ? 'parent_key' and v_parent is distinct from l.parent_key then perform app_private.alumni_fail('parent_key', 'immutable'); end if;
    if v_active is false and l.is_system then perform app_private.alumni_fail('is_active', 'system_value'); end if;
    update public.alumni_lookups x set label_en = coalesce(v_en, x.label_en), label_ar = coalesce(v_ar, x.label_ar), sort_order = coalesce(v_sort, x.sort_order),
           is_active = coalesce(v_active, x.is_active), updated_at = now()
     where x.kind = p_kind and x.key = p_key returning * into l;
  end if;
  return jsonb_build_object('kind', l.kind, 'key', l.key, 'parent_key', l.parent_key, 'label_en', l.label_en, 'label_ar', l.label_ar, 'sort', l.sort_order, 'active', l.is_active, 'system', l.is_system);
end $$;

create or replace function public.delete_alumni_lookup(p_kind text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.alumni_lookups; v_used boolean;
begin
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into l from public.alumni_lookups x where x.kind = p_kind and x.key = p_key for update;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if l.is_system then perform app_private.alumni_fail('key', 'system_value'); end if;
  v_used := case l.kind
    when 'sector' then exists (select 1 from public.companies c where c.sector_key = l.key) or exists (select 1 from public.alumni_lookups s where s.kind = 'subsector' and s.parent_key = l.key)
    when 'subsector' then exists (select 1 from public.companies c where c.subsector_key = l.key)
    when 'stage' then exists (select 1 from public.companies c where c.stage = l.key)
    when 'startup_type' then exists (select 1 from public.companies c where c.startup_type_key = l.key)
    when 'legal_status' then exists (select 1 from public.companies c where c.legal_status_key = l.key)
    when 'closing_reason' then exists (select 1 from public.companies c where c.closing_reason_key = l.key)
    when 'after_closing' then exists (select 1 from public.companies c where c.after_closing_key = l.key)
    else false end;
  if v_used then raise exception 'alumni_in_use: this value is used by companies; deactivate it instead' using errcode = '23503', hint = 'alumni_in_use'; end if;
  delete from public.alumni_lookups x where x.kind = p_kind and x.key = p_key;
end $$;

-- what the form shows while a founder types his national ID: the SAME functions as the database (the browser re-implements nothing). Stores nothing, reads nothing.
-- VOLATILE on purpose (a STABLE function is served on GET ?p_id=... by PostgREST). NOTE (m52 review): volatile alone is NOT a guarantee: PostgREST 14.7 also serves a GET on a volatile function that writes
-- nothing (in a read-only transaction). m52 adds the explicit refusal of GET / HEAD (app_private.alumni_post_only, SQLSTATE PT405) to every function that takes or returns an ID.
create or replace function public.preview_national_id(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text := app_private.id_normalize(p_id); r text; v_code smallint;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  r := app_private.id_invalid_reason(n, app_private.alumni_today());
  if r is not null then return jsonb_build_object('valid', false, 'reason', r); end if;
  v_code := app_private.id_governorate_code(n);
  return jsonb_build_object('valid', true, 'birth_date', app_private.id_birth_date(n), 'age', app_private.id_age(n, app_private.alumni_today()),
    'age_category', app_private.id_age_category(app_private.id_age(n, app_private.alumni_today())), 'gender', app_private.id_gender(n),
    'governorate', jsonb_build_object('code', v_code, 'name_en', app_private.eg_governorate_name(v_code, 'en'), 'name_ar', app_private.eg_governorate_name(v_code, 'ar'),
                                      'is_abroad', v_code = 88));
end $$;

-- ================================================================= 9. the founder: ensure / read / write
-- the signup trigger creates the founders row; when that failed (an unlinked row with the same e-mail exists: never linked by e-mail, 03 OD-8) the account still needs one
create or replace function app_private.alumni_ensure_founder(p_uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.founders; v_id uuid; v_name text; v_email text;
begin
  select * into f from public.founders x where x.auth_user_id = p_uid;
  if found then
    if f.deleted_at is not null then raise exception 'forbidden' using errcode = '42501'; end if;
    return f.id;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Founder'), u.email into v_name, v_email
    from auth.users u left join public.profiles p on p.id = u.id where u.id = p_uid;
  begin
    insert into public.founders (name_ar, name_en, email, auth_user_id) values (v_name, v_name, v_email, p_uid) returning id into v_id;
  exception when unique_violation then
    select x.id into v_id from public.founders x where x.auth_user_id = p_uid;
    if v_id is null then
      insert into public.founders (name_ar, name_en, auth_user_id) values (v_name, v_name, p_uid) returning id into v_id;
    end if;
  end;
  return v_id;
end $$;

-- the founder block: self = the owner (full national ID); otherwise a manager (masked unless p_reveal). Derived values come from app_private.alumni_founder_attrs ONLY.
create or replace function app_private.alumni_founder_json(p_founder uuid, p_self boolean, p_reveal boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f public.founders; i public.founder_identities; a record; v_identity jsonb;
begin
  select * into f from public.founders x where x.id = p_founder and x.deleted_at is null;
  if not found then return null; end if;
  select * into i from public.founder_identities x where x.founder_id = p_founder;
  select * into a from app_private.alumni_founder_attrs(app_private.alumni_today(), p_founder) x;
  v_identity := jsonb_build_object('source', a.source, 'id_masked', app_private.id_mask(i.national_id), 'has_national_id', i.national_id is not null,
    'self_birth_date', i.self_birth_date, 'self_gender', i.self_gender,
    'derived', jsonb_build_object('birth_date', a.birth_date, 'age', a.age, 'age_category', a.age_category, 'gender', a.gender, 'governorate', a.governorate_code));
  if p_self or p_reveal then v_identity := v_identity || jsonb_build_object('national_id', i.national_id); end if;
  return jsonb_build_object('id', f.id, 'name_en', f.name_en, 'name_ar', f.name_ar, 'email', f.email, 'phone', f.phone, 'linkedin_url', f.linkedin_url,
    'photo_path', f.photo_path, 'bio_en', f.bio_en, 'bio_ar', f.bio_ar, 'education_status', f.education_status, 'has_account', f.auth_user_id is not null,
    'identity', v_identity, 'completeness', app_private.alumni_completeness_json(app_private.alumni_founder_missing(f.id), 4), 'updated_at', f.updated_at);
end $$;

-- probe limiter: 5 national-ID conflicts per account and hour
create or replace function app_private.alumni_probe_blocked(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select l.hits >= 5 from app_private.alumni_probe_limits l where l.user_id = p_user and l.bucket = date_trunc('hour', now())), false)
$$;
create or replace function app_private.alumni_probe_hit(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.alumni_probe_limits (user_id, bucket, hits) values (p_user, date_trunc('hour', now()), 1)
  on conflict (user_id, bucket) do update set hits = app_private.alumni_probe_limits.hits + 1;
  delete from app_private.alumni_probe_limits where bucket < now() - interval '2 days' and random() < 0.05;
end $$;

-- apply a founder patch (the ONE writer of founders profile fields and of founder_identities). Returns { saved, replaced[] } or the soft failure { saved: false, error }.
--   p_manager: an alumni manager / super_admin (may set e-mail and any ID);  p_allow_id: the national ID may be set (the founder himself or a manager, never a co-founder)
create or replace function app_private.alumni_apply_founder_patch(p_founder uuid, p_patch jsonb, p_manager boolean, p_actor uuid, p_allow_id boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.founders; i public.founder_identities; k text; val jsonb; t text; v jsonb := '{}'::jsonb; v_en text; v_ar text; v_replaced jsonb := '[]'::jsonb;
  v_nid_in boolean; v_nid text; v_final_nid text; v_final_sd date; v_final_sg text; v_ident_touched boolean; v_typed_sd date; v_typed_sg text; v_reason text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('patch', 'not_an_object'); end if;
  select * into f from public.founders x where x.id = p_founder and x.deleted_at is null for update;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  select * into i from public.founder_identities x where x.founder_id = p_founder;

  -- 1. clean every key (strings stay strings; a JSON null clears the value)
  for k, val in select key, value from jsonb_each(p_patch) loop
    if k not in ('name_en', 'name_ar', 'bio_en', 'bio_ar', 'phone', 'linkedin_url', 'photo_path', 'education_status', 'national_id', 'self_birth_date', 'self_gender', 'email') then
      perform app_private.alumni_fail(k, 'unknown_key');
    end if;
    if jsonb_typeof(val) not in ('string', 'null') then perform app_private.alumni_fail(k, 'not_a_string'); end if;
    t := nullif(btrim(val #>> '{}'), '');
    if k in ('name_en', 'name_ar') then
      if t is not null and char_length(t) > 200 then perform app_private.alumni_fail(k, 'too_long'); end if;
    elsif k in ('bio_en', 'bio_ar') then
      if t is not null and char_length(t) > 4000 then perform app_private.alumni_fail(k, 'too_long'); end if;
    elsif k = 'phone' then
      if t is not null then
        t := app_private.form_phone_e164(t, array['EG']);
        if t is null then perform app_private.alumni_fail('phone', 'bad_value'); end if;
      end if;
    elsif k = 'linkedin_url' then
      if t is not null and (char_length(t) > 300 or t !~* '^https?://[^[:space:]]+$') then perform app_private.alumni_fail('linkedin_url', 'bad_url'); end if;
    elsif k = 'photo_path' then
      if t is not null and t is distinct from f.photo_path then
        if t !~ '^founders/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then
          perform app_private.alumni_fail('photo_path', 'bad_path');
        end if;
        if not p_manager and split_part(t, '/', 2) <> p_actor::text then perform app_private.alumni_fail('photo_path', 'not_your_folder'); end if;
        if not exists (select 1 from storage.objects o where o.bucket_id = 'founder-assets' and o.name = t) then perform app_private.alumni_fail('photo_path', 'file_missing'); end if;
      end if;
    elsif k = 'education_status' then
      if t is not null and t not in ('student', 'graduate', 'other') then perform app_private.alumni_fail(k, 'bad_value'); end if;
    elsif k = 'email' then
      if not p_manager then perform app_private.alumni_fail(k, 'manager_only'); end if;
      if t is not null and (char_length(t) > 254 or t !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then perform app_private.alumni_fail(k, 'bad_value'); end if;
      t := lower(t);
    elsif k = 'national_id' then
      if not p_allow_id then perform app_private.alumni_fail(k, 'not_allowed'); end if;
      if t is not null then
        t := app_private.id_normalize(t);
        v_reason := app_private.id_invalid_reason(t, app_private.alumni_today());
        if v_reason is not null then
          raise exception 'national_id_invalid: %', v_reason using errcode = '22023', hint = 'national_id_invalid', detail = 'national_id:' || v_reason;
        end if;
      end if;
    elsif k = 'self_birth_date' then
      if t is not null then
        begin t := (t::date)::text; exception when others then perform app_private.alumni_fail(k, 'bad_date'); end;
        if t::date > app_private.alumni_today() or t::date < date '1900-01-01' then perform app_private.alumni_fail(k, 'bad_date'); end if;
      end if;
    elsif k = 'self_gender' then
      if t is not null and t not in ('male', 'female') then perform app_private.alumni_fail(k, 'bad_value'); end if;
    end if;
    v := v || jsonb_build_object(k, t);
  end loop;

  -- 2. national ID: rate limit + conflict BEFORE anything is written (the conflict is a soft failure so the probe counter persists)
  v_nid_in := v ? 'national_id';
  v_nid := v->>'national_id';
  if v_nid_in and v_nid is not null then
    if not p_manager and app_private.alumni_probe_blocked(p_actor) then
      raise exception 'alumni_rate_limited: too many attempts, try again later' using errcode = 'P0001', hint = 'alumni_rate_limited';
    end if;
    if exists (select 1 from public.founder_identities x where x.national_id = v_nid and x.founder_id <> p_founder) then
      if p_manager then
        raise exception 'national_id_conflict: this national ID is registered to another founder' using errcode = '23505', hint = 'national_id_conflict',
          detail = (select x.founder_id::text from public.founder_identities x where x.national_id = v_nid);
      end if;
      perform app_private.alumni_probe_hit(p_actor);
      return jsonb_build_object('saved', false, 'error', 'national_id_conflict');
    end if;
  end if;

  -- 3. names (founders.name_ar is NOT NULL: with one language only, the name as typed goes to name_ar like the signup trigger does)
  v_en := case when v ? 'name_en' then v->>'name_en' else f.name_en end;
  v_ar := case when v ? 'name_ar' then v->>'name_ar' else f.name_ar end;
  if v_ar is null then v_ar := v_en; end if;
  if v_ar is null then perform app_private.alumni_fail('name', 'required'); end if;

  update public.founders x set name_en = v_en, name_ar = v_ar,
    phone = case when v ? 'phone' then v->>'phone' else x.phone end,
    linkedin_url = case when v ? 'linkedin_url' then v->>'linkedin_url' else x.linkedin_url end,
    photo_path = case when v ? 'photo_path' then v->>'photo_path' else x.photo_path end,
    bio_en = case when v ? 'bio_en' then v->>'bio_en' else x.bio_en end,
    bio_ar = case when v ? 'bio_ar' then v->>'bio_ar' else x.bio_ar end,
    education_status = case when v ? 'education_status' then v->>'education_status' else x.education_status end,
    email = case when v ? 'email' then (v->>'email')::extensions.citext else x.email end
   where x.id = p_founder;

  -- 4. identity: the ID WINS. With an ID the self-declared values are dropped (no second copy); typed values that disagree are reported in `replaced`.
  v_ident_touched := v_nid_in or v ? 'self_birth_date' or v ? 'self_gender';
  if v_ident_touched then
    v_final_nid := case when v_nid_in then v_nid else i.national_id end;
    if v_final_nid is not null then
      if not v_nid_in and ((v ? 'self_birth_date' and v->>'self_birth_date' is not null) or (v ? 'self_gender' and v->>'self_gender' is not null)) then
        perform app_private.alumni_fail(case when v ? 'self_birth_date' and v->>'self_birth_date' is not null then 'self_birth_date' else 'self_gender' end, 'id_wins');
      end if;
      v_typed_sd := coalesce((v->>'self_birth_date')::date, i.self_birth_date);
      v_typed_sg := coalesce(v->>'self_gender', i.self_gender);
      if v_typed_sd is not null and v_typed_sd is distinct from app_private.id_birth_date(v_final_nid) then
        v_replaced := v_replaced || jsonb_build_array(jsonb_build_object('field', 'birth_date', 'typed', v_typed_sd, 'from_id', app_private.id_birth_date(v_final_nid)));
      end if;
      if v_typed_sg is not null and v_typed_sg is distinct from app_private.id_gender(v_final_nid) then
        v_replaced := v_replaced || jsonb_build_array(jsonb_build_object('field', 'gender', 'typed', v_typed_sg, 'from_id', app_private.id_gender(v_final_nid)));
      end if;
      v_final_sd := null; v_final_sg := null;
    else
      v_final_sd := case when v ? 'self_birth_date' then (v->>'self_birth_date')::date else i.self_birth_date end;
      v_final_sg := case when v ? 'self_gender' then v->>'self_gender' else i.self_gender end;
    end if;
    if v_final_nid is null and v_final_sd is null and v_final_sg is null then
      delete from public.founder_identities x where x.founder_id = p_founder;
    else
      begin
        insert into public.founder_identities (founder_id, national_id, self_birth_date, self_gender, updated_by)
        values (p_founder, v_final_nid, v_final_sd, v_final_sg, p_actor)
        on conflict (founder_id) do update set national_id = excluded.national_id, self_birth_date = excluded.self_birth_date, self_gender = excluded.self_gender,
               updated_by = p_actor, updated_at = now();
      exception when unique_violation then
        if p_manager then raise exception 'national_id_conflict: this national ID is registered to another founder' using errcode = '23505', hint = 'national_id_conflict'; end if;
        perform app_private.alumni_probe_hit(p_actor);
        return jsonb_build_object('saved', false, 'error', 'national_id_conflict');
      end;
    end if;
  end if;
  return jsonb_build_object('saved', true, 'replaced', v_replaced);
end $$;

create or replace function public.get_my_alumni_profile() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_f uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_f := app_private.alumni_ensure_founder(v_uid);
  return jsonb_build_object('founder', app_private.alumni_founder_json(v_f, true, false),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar, 'logo_path', c.logo_path, 'stage', c.stage, 'sector', c.sector_key,
                'operating_status', c.operating_status, 'role', cf.role, 'is_primary', cf.is_primary, 'directory_visibility', c.directory_visibility, 'is_alumni', c.is_alumni,
                'completeness', app_private.alumni_completeness_json(app_private.alumni_company_missing(c.id), 10),
                'latest_snapshot_year', (select max(s.period_year) from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'annual'), 'updated_at', c.updated_at)
                order by cf.is_primary desc, c.created_at, c.id)
              from public.company_founders cf join public.companies c on c.id = cf.company_id and c.deleted_at is null where cf.founder_id = v_f), '[]'::jsonb));
end $$;

create or replace function public.save_my_founder_profile(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_f uuid; r jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_f := app_private.alumni_ensure_founder(v_uid);
  r := app_private.alumni_apply_founder_patch(v_f, p_patch, false, v_uid, true);
  if (r->>'saved')::boolean is not true then return r; end if;
  return jsonb_build_object('saved', true, 'replaced', r->'replaced', 'founder', app_private.alumni_founder_json(v_f, true, false));
end $$;

-- ================================================================= 10. the company: payload builders
create or replace function app_private.alumni_company_json(p_company uuid, p_manager boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; ci public.company_internal; v jsonb;
begin
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null;
  if not found then return null; end if;
  select * into ci from public.company_internal x where x.company_id = p_company;
  v := jsonb_build_object(
    'id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar, 'description_en', c.description_en, 'description_ar', c.description_ar, 'logo_path', c.logo_path,
    'startup_type', c.startup_type_key, 'sector', c.sector_key, 'subsector', c.subsector_key, 'stage', c.stage, 'legal_status', c.legal_status_key,
    'governorate', c.governorate_code, 'location_en', c.location_en, 'location_ar', c.location_ar, 'established_on', c.established_on, 'founding_year', c.founding_year,
    'website_url', c.website_url, 'app_url', c.app_url, 'linkedin_url', app_private.alumni_linkedin(c.links, c.linkedin_url),
    'links', app_private.alumni_links_json(c.links, c.website_url, app_private.alumni_linkedin(c.links, c.linkedin_url)),
    'operating_status', c.operating_status, 'closed_on', c.closed_on, 'closing_reason', c.closing_reason_key, 'after_closing', c.after_closing_key, 'closing_note', c.closing_note,
    'directory_visibility', c.directory_visibility, 'directory_blocked', coalesce(ci.directory_hidden, false), 'is_alumni', c.is_alumni,
    'legacy', jsonb_build_object('industry_en', c.industry_en, 'industry_ar', c.industry_ar, 'governorate_en', c.governorate_en, 'governorate_ar', c.governorate_ar),
    'completeness', app_private.alumni_completeness_json(app_private.alumni_company_missing(c.id), 10),
    'created_at', c.created_at, 'updated_at', c.updated_at);
  if p_manager then
    v := v || jsonb_build_object('internal', jsonb_build_object('hint', ci.hint, 'directory_hidden', coalesce(ci.directory_hidden, false), 'reviewed_at', ci.reviewed_at, 'reviewed_by', ci.reviewed_by),
                                 'created_by', c.created_by, 'origin_project_id', c.origin_project_id);
  end if;
  return v;
end $$;

create or replace function app_private.alumni_snapshots_json(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'year', s.period_year, 'revenue_total', s.revenue_total, 'funding_raised_total', s.funding_raised_total,
           'employees_total', s.employees_total, 'employees_female', s.employees_female, 'freelancers', s.freelancers, 'traction', s.traction, 'challenges', s.challenges,
           'needs', s.needs, 'source', s.source, 'updated_at', s.updated_at) order by s.period_year desc), '[]'::jsonb)
    from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'annual'
$$;

-- the team of a company. Personal values (gender / age / age category / source) are shown to: a manager, the founder himself, and for a RECORD without an account
-- (a co-founder the lead founder typed in). The derived values of another REGISTERED founder stay private to him (decision 19.4).
create or replace function app_private.alumni_team_json(p_company uuid, p_uid uuid, p_manager boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
      jsonb_build_object('founder_id', f.id, 'name_en', f.name_en, 'name_ar', f.name_ar, 'role', cf.role, 'is_primary', cf.is_primary,
                         'has_account', f.auth_user_id is not null, 'is_me', coalesce(f.auth_user_id = p_uid, false))
      || case when p_manager or coalesce(f.auth_user_id = p_uid, false) or f.auth_user_id is null
              then jsonb_build_object('gender', a.gender, 'age', a.age, 'age_category', a.age_category, 'birth_date', a.birth_date, 'source', a.source) else '{}'::jsonb end
      || case when p_manager then jsonb_build_object('governorate', a.governorate_code, 'id_masked', app_private.id_mask(i.national_id), 'email', f.email, 'phone', f.phone,
                                                     'education_status', f.education_status)
              else '{}'::jsonb end
      order by cf.is_primary desc, cf.created_at, f.id), '[]'::jsonb)
    from public.company_founders cf
    join public.founders f on f.id = cf.founder_id and f.deleted_at is null
    left join app_private.alumni_founder_attrs(app_private.alumni_today()) a on a.founder_id = f.id
    left join public.founder_identities i on i.founder_id = f.id
   where cf.company_id = p_company
$$;

create or replace function app_private.alumni_company_payload(p_company uuid, p_uid uuid, p_manager boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ts record;
begin
  select * into ts from app_private.alumni_team_stats(app_private.alumni_today(), p_company) x;
  return jsonb_build_object('company', app_private.alumni_company_json(p_company, p_manager), 'team', app_private.alumni_team_json(p_company, p_uid, p_manager),
    'counts', jsonb_build_object('team_size', coalesce(ts.team_size, 0), 'female_founders', coalesce(ts.female_founders, 0), 'founders_under_35', coalesce(ts.founders_under_35, 0)),
    'ceo_founder_id', app_private.alumni_company_ceo(p_company), 'programs', app_private.alumni_company_programs_json(p_company),
    'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

-- ================================================================= 11. the company: patch cleaning and writing
create or replace function app_private.alumni_clean_company_patch(p_patch jsonb, p_manager boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text; val jsonb; t text; e jsonb; n int; l_kind text; l_url text; l_label text; l_arr jsonb; ik text; iv jsonb; v_int jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('patch', 'not_an_object'); end if;
  for k, val in select key, value from jsonb_each(p_patch) loop
    if k = 'links' then
      if jsonb_typeof(val) = 'null' then v := v || jsonb_build_object(k, '[]'::jsonb); continue; end if;
      if jsonb_typeof(val) <> 'array' or jsonb_array_length(val) > 12 then perform app_private.alumni_fail('links', 'bad_value'); end if;
      l_arr := '[]'::jsonb;
      for e in select x from jsonb_array_elements(val) x loop
        if jsonb_typeof(e) <> 'object' then perform app_private.alumni_fail('links', 'bad_value'); end if;
        for ik in select jsonb_object_keys(e) loop
          if ik not in ('kind', 'url', 'label') then perform app_private.alumni_fail('links', 'unknown_key'); end if;
        end loop;
        l_kind := lower(btrim(coalesce(e->>'kind', '')));
        l_url := btrim(coalesce(e->>'url', ''));
        l_label := nullif(btrim(coalesce(e->>'label', '')), '');
        if l_kind = 'linkedin' then perform app_private.alumni_fail('links', 'use_linkedin_url'); end if;
        if l_kind not in ('facebook', 'instagram', 'x', 'tiktok', 'youtube', 'telegram', 'whatsapp', 'deck', 'video', 'other') then perform app_private.alumni_fail('links', 'bad_kind'); end if;
        if char_length(l_url) > 500 or l_url !~* '^https?://[^[:space:]]+$' then perform app_private.alumni_fail('links', 'bad_url'); end if;
        if l_label is not null and char_length(l_label) > 60 then perform app_private.alumni_fail('links', 'label_too_long'); end if;
        l_arr := l_arr || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind', l_kind, 'url', l_url, 'label', l_label)));
      end loop;
      v := v || jsonb_build_object(k, l_arr);
      continue;
    elsif k = 'internal' then
      if not p_manager then perform app_private.alumni_fail(k, 'manager_only'); end if;
      if jsonb_typeof(val) <> 'object' then perform app_private.alumni_fail(k, 'bad_value'); end if;
      v_int := '{}'::jsonb;
      for ik, iv in select key, value from jsonb_each(val) loop
        if ik = 'hint' then
          if jsonb_typeof(iv) not in ('string', 'null') then perform app_private.alumni_fail('internal.hint', 'not_a_string'); end if;
          t := nullif(btrim(iv #>> '{}'), '');
          if t is not null and char_length(t) > 2000 then perform app_private.alumni_fail('internal.hint', 'too_long'); end if;
          v_int := v_int || jsonb_build_object('hint', t);
        elsif ik in ('directory_hidden', 'reviewed') then
          if jsonb_typeof(iv) <> 'boolean' then perform app_private.alumni_fail('internal.' || ik, 'not_a_boolean'); end if;
          v_int := v_int || jsonb_build_object(ik, iv);
        else
          perform app_private.alumni_fail('internal.' || ik, 'unknown_key');
        end if;
      end loop;
      v := v || jsonb_build_object(k, v_int);
      continue;
    elsif k = 'is_alumni' then
      if not p_manager then perform app_private.alumni_fail(k, 'manager_only'); end if;
      if jsonb_typeof(val) <> 'boolean' then perform app_private.alumni_fail(k, 'not_a_boolean'); end if;
      v := v || jsonb_build_object(k, val);
      continue;
    elsif k = 'governorate' then
      if jsonb_typeof(val) = 'null' then v := v || jsonb_build_object(k, null); continue; end if;
      t := btrim(val #>> '{}');
      if t !~ '^[0-9]{1,2}$' then perform app_private.alumni_fail(k, 'bad_value'); end if;
      v := v || jsonb_build_object(k, t::int);
      continue;
    end if;

    -- every other key is a string (or null)
    if k not in ('name_en', 'name_ar', 'description_en', 'description_ar', 'location_en', 'location_ar', 'logo_path', 'startup_type', 'sector', 'subsector', 'stage', 'legal_status',
                 'established_on', 'closed_on', 'website_url', 'app_url', 'linkedin_url', 'operating_status', 'closing_reason', 'after_closing', 'closing_note', 'directory_visibility') then
      perform app_private.alumni_fail(k, 'unknown_key');
    end if;
    if jsonb_typeof(val) not in ('string', 'null') then perform app_private.alumni_fail(k, 'not_a_string'); end if;
    t := nullif(btrim(val #>> '{}'), '');
    if k in ('name_en', 'name_ar') then
      if t is not null and char_length(t) > 200 then perform app_private.alumni_fail(k, 'too_long'); end if;
    elsif k in ('description_en', 'description_ar') then
      if t is not null and char_length(t) > 4000 then perform app_private.alumni_fail(k, 'too_long'); end if;
    elsif k in ('location_en', 'location_ar') then
      if t is not null and char_length(t) > 300 then perform app_private.alumni_fail(k, 'too_long'); end if;
    elsif k = 'closing_note' then
      if t is not null and char_length(t) > 1000 then perform app_private.alumni_fail(k, 'too_long'); end if;
    elsif k in ('startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'closing_reason', 'after_closing') then
      if t is not null and t !~ '^[a-z0-9][a-z0-9_.-]{0,62}$' then perform app_private.alumni_fail(k, 'bad_value'); end if;
    elsif k in ('website_url', 'app_url', 'linkedin_url') then
      if t is not null and (char_length(t) > 500 or t !~* '^https?://[^[:space:]]+$') then perform app_private.alumni_fail(k, 'bad_url'); end if;
    elsif k in ('established_on', 'closed_on') then
      if t is not null then
        begin t := (t::date)::text; exception when others then perform app_private.alumni_fail(k, 'bad_date'); end;
        if t::date < date '1900-01-01' then perform app_private.alumni_fail(k, 'bad_date'); end if;
      end if;
    elsif k = 'logo_path' then
      if t is not null and t !~ '^(alumni/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9_-]+|global/[a-z0-9_-]+)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then
        perform app_private.alumni_fail(k, 'bad_path');
      end if;
    elsif k = 'operating_status' then
      if t is null or t not in ('open', 'closed') then perform app_private.alumni_fail(k, 'bad_value'); end if;
    elsif k = 'directory_visibility' then
      if t is null or t not in ('private', 'alumni', 'public') then perform app_private.alumni_fail(k, 'bad_value'); end if;
    end if;
    v := v || jsonb_build_object(k, t);
  end loop;
  return v;
end $$;

create or replace function app_private.alumni_apply_company_patch(p_company uuid, p_clean jsonb, p_manager boolean, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.companies; v_status text; v_sector text; v_sub text; v_path text; v_int jsonb; v_rev boolean; v_gov smallint; v_set_sector boolean; v_set_gov boolean;
begin
  select * into c from public.companies x where x.id = p_company and x.deleted_at is null for update;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if (case when p_clean ? 'name_en' then p_clean->>'name_en' else c.name_en end) is null
     and (case when p_clean ? 'name_ar' then p_clean->>'name_ar' else c.name_ar end) is null then perform app_private.alumni_fail('name', 'required'); end if;

  if p_clean ? 'logo_path' and p_clean->>'logo_path' is distinct from c.logo_path then
    v_path := p_clean->>'logo_path';
    if v_path is not null then
      if not p_manager and not starts_with(v_path, 'alumni/' || p_actor::text || '/logo/') then perform app_private.alumni_fail('logo_path', 'not_your_folder'); end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'public-assets' and o.name = v_path) then perform app_private.alumni_fail('logo_path', 'file_missing'); end if;
    end if;
  end if;

  v_status := coalesce(p_clean->>'operating_status', c.operating_status);
  if v_status = 'open' and ((p_clean ? 'closed_on' and p_clean->>'closed_on' is not null) or (p_clean ? 'closing_reason' and p_clean->>'closing_reason' is not null)
        or (p_clean ? 'after_closing' and p_clean->>'after_closing' is not null) or (p_clean ? 'closing_note' and p_clean->>'closing_note' is not null)) then
    perform app_private.alumni_fail('closing', 'requires_closed');
  end if;

  v_set_sector := p_clean ? 'sector';
  v_sector := case when v_set_sector then p_clean->>'sector' else c.sector_key end;
  v_sub := case when p_clean ? 'subsector' then p_clean->>'subsector' when v_set_sector and v_sector is distinct from c.sector_key then null else c.subsector_key end;
  v_set_gov := p_clean ? 'governorate';
  v_gov := case when v_set_gov then (p_clean->>'governorate')::smallint else c.governorate_code end;

  if (p_clean - 'internal') <> '{}'::jsonb then
  update public.companies x set
    name_en = case when p_clean ? 'name_en' then p_clean->>'name_en' else x.name_en end,
    name_ar = case when p_clean ? 'name_ar' then p_clean->>'name_ar' else x.name_ar end,
    description_en = case when p_clean ? 'description_en' then p_clean->>'description_en' else x.description_en end,
    description_ar = case when p_clean ? 'description_ar' then p_clean->>'description_ar' else x.description_ar end,
    location_en = case when p_clean ? 'location_en' then p_clean->>'location_en' else x.location_en end,
    location_ar = case when p_clean ? 'location_ar' then p_clean->>'location_ar' else x.location_ar end,
    logo_path = case when p_clean ? 'logo_path' then p_clean->>'logo_path' else x.logo_path end,
    startup_type_key = case when p_clean ? 'startup_type' then p_clean->>'startup_type' else x.startup_type_key end,
    sector_key = v_sector, subsector_key = v_sub,
    stage = case when p_clean ? 'stage' then p_clean->>'stage' else x.stage end,
    legal_status_key = case when p_clean ? 'legal_status' then p_clean->>'legal_status' else x.legal_status_key end,
    governorate_code = v_gov,
    established_on = case when p_clean ? 'established_on' then (p_clean->>'established_on')::date else x.established_on end,
    founding_year = case when p_clean ? 'established_on' and p_clean->>'established_on' is not null then extract(year from (p_clean->>'established_on')::date)::smallint
                         when p_clean ? 'established_on' then null else x.founding_year end,
    website_url = case when p_clean ? 'website_url' then p_clean->>'website_url' else x.website_url end,
    app_url = case when p_clean ? 'app_url' then p_clean->>'app_url' else x.app_url end,
    linkedin_url = case when p_clean ? 'linkedin_url' then p_clean->>'linkedin_url' else x.linkedin_url end,
    links = case when p_clean ? 'links' then coalesce(p_clean->'links', '[]'::jsonb) else x.links end,
    operating_status = v_status,
    closed_on = case when v_status = 'open' then null when p_clean ? 'closed_on' then (p_clean->>'closed_on')::date else x.closed_on end,
    closing_reason_key = case when v_status = 'open' then null when p_clean ? 'closing_reason' then p_clean->>'closing_reason' else x.closing_reason_key end,
    after_closing_key = case when v_status = 'open' then null when p_clean ? 'after_closing' then p_clean->>'after_closing' else x.after_closing_key end,
    closing_note = case when v_status = 'open' then null when p_clean ? 'closing_note' then p_clean->>'closing_note' else x.closing_note end,
    directory_visibility = case when p_clean ? 'directory_visibility' then p_clean->>'directory_visibility' else x.directory_visibility end,
    is_alumni = case when p_manager and p_clean ? 'is_alumni' then (p_clean->>'is_alumni')::boolean else x.is_alumni end,
    -- compatibility mirror (ONE-WAY, from the key): the PM list screens still show the legacy text columns
    industry_en = case when v_set_sector then (select l.label_en from public.alumni_lookups l where l.kind = 'sector' and l.key = v_sector) else x.industry_en end,
    industry_ar = case when v_set_sector then (select l.label_ar from public.alumni_lookups l where l.kind = 'sector' and l.key = v_sector) else x.industry_ar end,
    governorate_en = case when v_set_gov then app_private.eg_governorate_name(v_gov, 'en') else x.governorate_en end,
    governorate_ar = case when v_set_gov then app_private.eg_governorate_name(v_gov, 'ar') else x.governorate_ar end
   where x.id = p_company;
  end if;

  if p_manager and p_clean ? 'internal' then
    v_int := p_clean->'internal';
    v_rev := coalesce((v_int->>'reviewed')::boolean, false);
    insert into public.company_internal (company_id, hint, directory_hidden, reviewed_at, reviewed_by, updated_by)
    values (p_company, v_int->>'hint', coalesce((v_int->>'directory_hidden')::boolean, false), case when v_rev then now() end, case when v_rev then p_actor end, p_actor)
    on conflict (company_id) do update set
      hint = case when v_int ? 'hint' then v_int->>'hint' else public.company_internal.hint end,
      directory_hidden = case when v_int ? 'directory_hidden' then (v_int->>'directory_hidden')::boolean else public.company_internal.directory_hidden end,
      reviewed_at = case when v_int ? 'reviewed' then (case when v_rev then now() end) else public.company_internal.reviewed_at end,
      reviewed_by = case when v_int ? 'reviewed' then (case when v_rev then p_actor end) else public.company_internal.reviewed_by end,
      updated_by = p_actor, updated_at = now();
  end if;
end $$;

-- create (p_company null) or update the company of the signed-in founder. p_expected = the `updated_at` the form was loaded with (optimistic concurrency, `alumni_stale`).
create or replace function public.save_my_company_profile(p_company uuid, p_patch jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_f uuid; v_clean jsonb; v_id uuid := p_company; v_upd timestamptz; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_f := app_private.alumni_ensure_founder(v_uid);
  v_clean := app_private.alumni_clean_company_patch(p_patch, false);
  if v_id is null then
    v_name := lower(btrim(coalesce(v_clean->>'name_en', v_clean->>'name_ar')));
    if v_name is null then perform app_private.alumni_fail('name', 'required'); end if;
    -- a founder may not create a second copy of a company that already exists: the Athar team links him by invitation (03 OD-8). The answer never says WHO owns it.
    if exists (select 1 from public.companies c where c.name_key = v_name and c.deleted_at is null) then
      raise exception 'alumni_company_exists: a company with this name already exists; ask the Athar team to link your account' using errcode = '23505', hint = 'alumni_company_exists';
    end if;
    insert into public.companies (name_en, name_ar, created_by) values (v_clean->>'name_en', v_clean->>'name_ar', v_uid) returning id into v_id;
    insert into public.company_founders (company_id, founder_id, role, is_primary) values (v_id, v_f, 'founder', true);
  else
    if not exists (select 1 from app_private.my_company_ids() m where m = v_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    select c.updated_at into v_upd from public.companies c where c.id = v_id and c.deleted_at is null for update;
    if not found then raise exception 'forbidden' using errcode = '42501'; end if;
    if p_expected is not null and v_upd is distinct from p_expected then
      raise exception 'alumni_stale: the company was changed by someone else; reload it' using errcode = '40001', hint = 'alumni_stale';
    end if;
  end if;
  perform app_private.alumni_apply_company_patch(v_id, v_clean, false, v_uid);
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(v_id, v_uid, false);
end $$;

create or replace function public.get_my_company_profile(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_company is null or not exists (select 1 from app_private.my_company_ids() m where m = p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.alumni_company_payload(p_company, v_uid, false);
end $$;

-- ================================================================= 12. the team (co-founders), the CEO, the yearly snapshots
-- add (p_founder null: a RECORD without an account) or edit a team member. A founder may edit his own `role` and the records he typed in; a manager may edit anyone
-- and is the only one who can enter a national ID for somebody else. Counts (team size / female founders / below 35) are derived from these rows.
create or replace function public.save_company_team_member(p_company uuid, p_founder uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; v_fid uuid := p_founder; f public.founders; k text; v_role text; v_rest jsonb := '{}'::jsonb; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app_private.alumni_fail('patch', 'not_an_object'); end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = 'role' then
      if jsonb_typeof(p_patch->'role') not in ('string', 'null') then perform app_private.alumni_fail(k, 'not_a_string'); end if;
      v_role := nullif(btrim(p_patch->>'role'), '');
      if v_role is not null and char_length(v_role) > 60 then perform app_private.alumni_fail(k, 'too_long'); end if;
    else
      v_rest := v_rest || jsonb_build_object(k, p_patch->k);
    end if;
  end loop;

  if v_fid is null then
    v_name := nullif(btrim(coalesce(v_rest->>'name_ar', v_rest->>'name_en')), '');
    if v_name is null then perform app_private.alumni_fail('name', 'required'); end if;
    if char_length(v_name) > 200 then perform app_private.alumni_fail('name', 'too_long'); end if;
    insert into public.founders (name_ar, name_en) values (v_name, nullif(btrim(v_rest->>'name_en'), '')) returning id into v_fid;
    perform app_private.alumni_apply_founder_patch(v_fid, v_rest, v_mgr, v_uid, v_mgr);
    insert into public.company_founders (company_id, founder_id, role, is_primary) values (p_company, v_fid, coalesce(v_role, 'founder'), false);
  else
    if not exists (select 1 from public.company_founders cf where cf.company_id = p_company and cf.founder_id = v_fid) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
    select * into f from public.founders x where x.id = v_fid and x.deleted_at is null;
    if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
    if not v_mgr then
      if f.auth_user_id is not null and f.auth_user_id is distinct from v_uid then raise exception 'forbidden' using errcode = '42501'; end if;
      -- a record that is ALSO a member of another company is shared data: only a manager edits it
      if f.auth_user_id is null and exists (select 1 from public.company_founders o where o.founder_id = v_fid and o.company_id <> p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
      if f.auth_user_id = v_uid and v_rest <> '{}'::jsonb then perform app_private.alumni_fail(jsonb_object_keys(v_rest), 'use_my_profile'); end if;
    end if;
    if v_rest <> '{}'::jsonb then perform app_private.alumni_apply_founder_patch(v_fid, v_rest, v_mgr, v_uid, v_mgr); end if;
    if p_patch ? 'role' then update public.company_founders cf set role = coalesce(v_role, 'founder') where cf.company_id = p_company and cf.founder_id = v_fid; end if;
  end if;
  return jsonb_build_object('saved', true, 'founder_id', v_fid) || app_private.alumni_company_payload(p_company, v_uid, v_mgr);
end $$;

-- remove a team member: a founder removes only RECORDS without an account; a manager removes anyone. The record is soft-deleted and its identity row erased.
create or replace function public.remove_company_team_member(p_company uuid, p_founder uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; f public.founders;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into f from public.founders x where x.id = p_founder and x.deleted_at is null;
  if not found or not exists (select 1 from public.company_founders cf where cf.company_id = p_company and cf.founder_id = p_founder) then
    raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found';
  end if;
  if not v_mgr and f.auth_user_id is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.company_founders cf where cf.company_id = p_company and cf.founder_id = p_founder;
  if f.auth_user_id is null and not exists (select 1 from public.company_founders cf where cf.founder_id = p_founder) then
    delete from public.founder_identities i where i.founder_id = p_founder;
    update public.founders x set deleted_at = now() where x.id = p_founder;
  end if;
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(p_company, v_uid, v_mgr);
end $$;

create or replace function public.set_company_ceo(p_company uuid, p_founder uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null where cf.company_id = p_company and cf.founder_id = p_founder) then
    raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found';
  end if;
  update public.company_founders cf set is_primary = (cf.founder_id = p_founder) where cf.company_id = p_company and cf.is_primary is distinct from (cf.founder_id = p_founder);
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(p_company, v_uid, v_mgr);
end $$;

-- ONE annual row per company and year (revenue / funding / headcount / challenges ...). Patch semantics: the keys present are written, null clears. A founder of the company or a manager.
create or replace function public.upsert_company_snapshot(p_company uuid, p_year integer, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; k text; val jsonb; t text; v jsonb := '{}'::jsonb; s public.company_snapshots; r jsonb; v_total int; v_female int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if p_year is null or p_year < 1990 or p_year > extract(year from app_private.alumni_today())::int then perform app_private.alumni_fail('year', 'out_of_range'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform app_private.alumni_fail('data', 'not_an_object'); end if;
  for k, val in select key, value from jsonb_each(p_data) loop
    if k not in ('revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers', 'traction', 'challenges', 'needs') then perform app_private.alumni_fail(k, 'unknown_key'); end if;
    if jsonb_typeof(val) = 'null' then v := v || jsonb_build_object(k, null); continue; end if;
    if k in ('traction', 'challenges', 'needs') then
      if jsonb_typeof(val) <> 'string' then perform app_private.alumni_fail(k, 'not_a_string'); end if;
      t := nullif(btrim(val #>> '{}'), '');
      if t is not null and char_length(t) > 4000 then perform app_private.alumni_fail(k, 'too_long'); end if;
      v := v || jsonb_build_object(k, t);
    else
      t := btrim(val #>> '{}');
      if t !~ '^[0-9]+(\.[0-9]{1,2})?$' then perform app_private.alumni_fail(k, 'not_a_number'); end if;
      if k in ('revenue_total', 'funding_raised_total') then
        if t::numeric > 1000000000000 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        v := v || jsonb_build_object(k, t::numeric);
      else
        if t !~ '^[0-9]+$' or length(t) > 7 or t::int > 1000000 then perform app_private.alumni_fail(k, 'out_of_range'); end if;
        v := v || jsonb_build_object(k, t::int);
      end if;
    end if;
  end loop;
  select * into s from public.company_snapshots x where x.company_id = p_company and x.snapshot_type = 'annual' and x.period_year = p_year for update;
  v_total := case when v ? 'employees_total' then (v->>'employees_total')::int else s.employees_total end;
  v_female := case when v ? 'employees_female' then (v->>'employees_female')::int else s.employees_female end;
  if v_total is not null and v_female is not null and v_female > v_total then perform app_private.alumni_fail('employees_female', 'exceeds_total'); end if;
  insert into public.company_snapshots (company_id, snapshot_type, snapshot_date, source, period_year, revenue_total, funding_raised_total, employees_total, employees_female,
                                        freelancers, traction, challenges, needs, updated_by, updated_at)
  values (p_company, 'annual', least(make_date(p_year, 12, 31), app_private.alumni_today()), case when v_mgr then 'manager' else 'founder' end, p_year,
          (v->>'revenue_total')::numeric, (v->>'funding_raised_total')::numeric, (v->>'employees_total')::int, (v->>'employees_female')::int, (v->>'freelancers')::int,
          v->>'traction', v->>'challenges', v->>'needs', v_uid, now())
  on conflict (company_id, period_year) where snapshot_type = 'annual' do update set
    revenue_total = case when v ? 'revenue_total' then (v->>'revenue_total')::numeric else public.company_snapshots.revenue_total end,
    funding_raised_total = case when v ? 'funding_raised_total' then (v->>'funding_raised_total')::numeric else public.company_snapshots.funding_raised_total end,
    employees_total = case when v ? 'employees_total' then (v->>'employees_total')::int else public.company_snapshots.employees_total end,
    employees_female = case when v ? 'employees_female' then (v->>'employees_female')::int else public.company_snapshots.employees_female end,
    freelancers = case when v ? 'freelancers' then (v->>'freelancers')::int else public.company_snapshots.freelancers end,
    traction = case when v ? 'traction' then v->>'traction' else public.company_snapshots.traction end,
    challenges = case when v ? 'challenges' then v->>'challenges' else public.company_snapshots.challenges end,
    needs = case when v ? 'needs' then v->>'needs' else public.company_snapshots.needs end,
    source = case when v_mgr then 'manager' else 'founder' end, updated_by = v_uid, updated_at = now(),
    snapshot_date = least(make_date(p_year, 12, 31), app_private.alumni_today());
  select e into r from jsonb_array_elements(app_private.alumni_snapshots_json(p_company)) e where (e->>'year')::int = p_year;
  return jsonb_build_object('saved', true, 'snapshot', r, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

create or replace function public.delete_company_snapshot(p_company uuid, p_year integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.company_snapshots s where s.company_id = p_company and s.snapshot_type = 'annual' and s.period_year = p_year;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  return jsonb_build_object('deleted', true, 'snapshots', app_private.alumni_snapshots_json(p_company));
end $$;

-- ================================================================= 13. the manager side: filters (ONE implementation), directory, export, analytics
-- the ONE filter: directory, export and analytics all select their companies here. p_audience: manager | member (signed-in) | public (anon).
create or replace function app_private.alumni_filter_ids(p_filters jsonb, p_audience text, p_today date default app_private.alumni_today()) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := coalesce(p_filters, '{}'::jsonb); k text; v_mgr boolean := p_audience = 'manager';
  v_q text; v_program uuid; v_project uuid; v_sector text; v_sub text; v_stage text; v_type text; v_legal text; v_gov int; v_status text;
  v_scope text := 'alumni'; v_ceo_gov int; v_gender text; v_age text; v_female boolean; v_reviewed boolean; v_vis text; v_hidden boolean; v_incomplete boolean;
begin
  if jsonb_typeof(v) <> 'object' then perform app_private.alumni_fail('filters', 'not_an_object'); end if;
  for k in select jsonb_object_keys(v) loop
    if k in ('ceo_governorate', 'ceo_gender', 'age_category', 'has_female_founder', 'reviewed', 'directory_visibility', 'directory_hidden', 'scope', 'incomplete') then
      if not v_mgr then perform app_private.alumni_fail(k, 'manager_only'); end if;
    elsif k not in ('q', 'program_id', 'project_id', 'sector', 'subsector', 'stage', 'startup_type', 'legal_status', 'governorate', 'operating_status') then
      perform app_private.alumni_fail(k, 'unknown_key');
    end if;
  end loop;
  v_q := nullif(lower(btrim(v->>'q')), '');
  if v_q is not null and char_length(v_q) > 100 then perform app_private.alumni_fail('q', 'too_long'); end if;
  begin v_program := nullif(v->>'program_id', '')::uuid; exception when others then perform app_private.alumni_fail('program_id', 'bad_value'); end;
  begin v_project := nullif(v->>'project_id', '')::uuid; exception when others then perform app_private.alumni_fail('project_id', 'bad_value'); end;
  v_sector := nullif(v->>'sector', ''); v_sub := nullif(v->>'subsector', ''); v_stage := nullif(v->>'stage', ''); v_type := nullif(v->>'startup_type', '');
  v_legal := nullif(v->>'legal_status', ''); v_status := nullif(v->>'operating_status', '');
  begin v_gov := nullif(v->>'governorate', '')::int; exception when others then perform app_private.alumni_fail('governorate', 'bad_value'); end;
  if v_status is not null and v_status not in ('open', 'closed') then perform app_private.alumni_fail('operating_status', 'bad_value'); end if;
  if v_mgr then
    v_scope := coalesce(nullif(v->>'scope', ''), 'alumni');
    if v_scope not in ('alumni', 'candidates', 'all') then perform app_private.alumni_fail('scope', 'bad_value'); end if;
    begin v_ceo_gov := nullif(v->>'ceo_governorate', '')::int; exception when others then perform app_private.alumni_fail('ceo_governorate', 'bad_value'); end;
    v_gender := nullif(v->>'ceo_gender', ''); v_age := nullif(v->>'age_category', ''); v_vis := nullif(v->>'directory_visibility', '');
    if v_gender is not null and v_gender not in ('male', 'female') then perform app_private.alumni_fail('ceo_gender', 'bad_value'); end if;
    if v_vis is not null and v_vis not in ('private', 'alumni', 'public') then perform app_private.alumni_fail('directory_visibility', 'bad_value'); end if;
    begin v_female := nullif(v->>'has_female_founder', '')::boolean; exception when others then perform app_private.alumni_fail('has_female_founder', 'bad_value'); end;
    begin v_reviewed := nullif(v->>'reviewed', '')::boolean; exception when others then perform app_private.alumni_fail('reviewed', 'bad_value'); end;
    begin v_hidden := nullif(v->>'directory_hidden', '')::boolean; exception when others then perform app_private.alumni_fail('directory_hidden', 'bad_value'); end;
    begin v_incomplete := nullif(v->>'incomplete', '')::boolean; exception when others then perform app_private.alumni_fail('incomplete', 'bad_value'); end;
  end if;

  return query
  with ts as (select * from app_private.alumni_team_stats(p_today)),
       fa as (select * from app_private.alumni_founder_attrs(p_today)),
       ap as (select * from app_private.alumni_participations())
  select c.id
    from public.companies c
    left join public.company_internal ci on ci.company_id = c.id
    left join ts on ts.company_id = c.id
    left join fa on fa.founder_id = (case when v_mgr then app_private.alumni_company_ceo(c.id) end)
   where c.deleted_at is null
     and (case p_audience
            when 'manager' then (v_scope = 'all' or (v_scope = 'alumni' and c.is_alumni)
                                 or (v_scope = 'candidates' and not c.is_alumni and (exists (select 1 from ap where ap.company_id = c.id) or exists (select 1 from public.company_founders cf where cf.company_id = c.id))))
            when 'member' then c.is_alumni and not coalesce(ci.directory_hidden, false) and c.directory_visibility in ('alumni', 'public')
            else c.is_alumni and not coalesce(ci.directory_hidden, false) and c.directory_visibility = 'public' end)
     and (v_q is null or strpos(lower(coalesce(c.name_en, '')), v_q) > 0 or strpos(lower(coalesce(c.name_ar, '')), v_q) > 0)
     and (v_program is null or exists (select 1 from ap where ap.company_id = c.id and ap.program_id = v_program))
     and (v_project is null or exists (select 1 from ap where ap.company_id = c.id and ap.project_id = v_project))
     and (v_sector is null or c.sector_key = v_sector) and (v_sub is null or c.subsector_key = v_sub) and (v_stage is null or c.stage = v_stage)
     and (v_type is null or c.startup_type_key = v_type) and (v_legal is null or c.legal_status_key = v_legal)
     and (v_gov is null or c.governorate_code = v_gov) and (v_status is null or c.operating_status = v_status)
     and (v_ceo_gov is null or fa.governorate_code = v_ceo_gov) and (v_gender is null or fa.gender = v_gender) and (v_age is null or fa.age_category = v_age)
     and (v_female is null or (coalesce(ts.female_founders, 0) > 0) = v_female)
     and (v_reviewed is null or (ci.reviewed_at is not null) = v_reviewed)
     and (v_vis is null or c.directory_visibility = v_vis)
     and (v_hidden is null or coalesce(ci.directory_hidden, false) = v_hidden)
     and (v_incomplete is null or (cardinality(app_private.alumni_company_missing(c.id)) > 0) = v_incomplete);
end $$;

-- the directory page for an audience (shared by list_alumni_directory and list_public_alumni_directory)
create or replace function app_private.alumni_directory_page(p_filters jsonb, p_audience text, p_limit integer, p_offset integer, p_sort text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_lim integer; v_off integer := greatest(coalesce(p_offset, 0), 0); v_sort text := coalesce(nullif(p_sort, ''), 'name'); v_rows jsonb; v_total integer;
begin
  if v_sort not in ('name', 'updated', 'established', 'created') then perform app_private.alumni_fail('sort', 'bad_value'); end if;
  v_lim := least(greatest(coalesce(p_limit, 24), 1), case when p_audience = 'public' then 50 else 100 end);
  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, p_audience) i),
       ts as (select * from app_private.alumni_team_stats(app_private.alumni_today())),
       fa as (select * from app_private.alumni_founder_attrs(app_private.alumni_today())),
       ap as (select * from app_private.alumni_participations()),
       progs as (select ap.company_id, jsonb_agg(jsonb_build_object('program_id', g.id, 'program_name_en', g.name_en, 'program_name_ar', g.name_ar,
                                                  'project_id', j.id, 'project_name_en', j.name_en, 'project_name_ar', j.name_ar) order by g.created_at, g.id, j.created_at, j.id) as p
                   from ap join public.projects j on j.id = ap.project_id join public.programs g on g.id = ap.program_id group by ap.company_id),
       page as (
         select c.*,
                row_number() over (order by case when v_sort = 'updated' then c.updated_at end desc nulls last, case when v_sort = 'established' then c.established_on end desc nulls last,
                                            case when v_sort = 'created' then c.created_at end desc nulls last, lower(coalesce(c.name_en, c.name_ar)), c.id) as rn
           from public.companies c join ids on ids.id = c.id
          order by rn limit v_lim offset v_off)
  select coalesce(jsonb_agg(
           case when p_audience = 'manager' then
             jsonb_build_object('id', pg.id, 'name_en', pg.name_en, 'name_ar', pg.name_ar, 'logo_path', pg.logo_path, 'sector', pg.sector_key, 'subsector', pg.subsector_key,
               'stage', pg.stage, 'startup_type', pg.startup_type_key, 'legal_status', pg.legal_status_key, 'governorate', pg.governorate_code, 'established_on', pg.established_on,
               'founding_year', pg.founding_year, 'operating_status', pg.operating_status, 'is_alumni', pg.is_alumni, 'directory_visibility', pg.directory_visibility,
               'directory_hidden', coalesce(ci.directory_hidden, false), 'reviewed_at', ci.reviewed_at, 'updated_at', pg.updated_at,
               'legacy', jsonb_build_object('industry_en', pg.industry_en, 'industry_ar', pg.industry_ar, 'governorate_en', pg.governorate_en, 'governorate_ar', pg.governorate_ar),
               'team', jsonb_build_object('size', coalesce(ts.team_size, 0), 'female_founders', coalesce(ts.female_founders, 0), 'under_35', coalesce(ts.founders_under_35, 0)),
               'ceo', case when cf.id is not null then jsonb_build_object('founder_id', cf.id, 'name_en', cf.name_en, 'name_ar', cf.name_ar, 'gender', fa.gender, 'age', fa.age,
                                                                         'age_category', fa.age_category, 'governorate', fa.governorate_code, 'source', fa.source) end,
               'latest', (select jsonb_build_object('year', s.period_year, 'revenue_total', s.revenue_total, 'employees_total', s.employees_total, 'funding_raised_total', s.funding_raised_total)
                            from public.company_snapshots s where s.company_id = pg.id and s.snapshot_type = 'annual' order by s.period_year desc limit 1),
               'programs', coalesce(progs.p, '[]'::jsonb),
               'completeness_percent', (app_private.alumni_completeness_json(app_private.alumni_company_missing(pg.id), 10)->>'percent')::int)
           else
             jsonb_build_object('id', pg.id, 'name_en', pg.name_en, 'name_ar', pg.name_ar, 'logo_path', pg.logo_path, 'description_en', left(pg.description_en, 280), 'description_ar', left(pg.description_ar, 280),
               'sector', pg.sector_key, 'subsector', pg.subsector_key, 'stage', pg.stage, 'startup_type', pg.startup_type_key, 'governorate', pg.governorate_code,
               'established_year', coalesce(extract(year from pg.established_on)::int, pg.founding_year), 'operating_status', pg.operating_status,
               'website_url', pg.website_url, 'app_url', pg.app_url, 'social', app_private.alumni_social_links(pg.links, pg.linkedin_url), 'programs', coalesce(progs.p, '[]'::jsonb))
           end order by pg.rn), '[]'::jsonb),
         (select count(*) from ids)::int
    into v_rows, v_total
    from page pg
    left join public.company_internal ci on ci.company_id = pg.id
    left join ts on ts.company_id = pg.id
    left join public.founders cf on cf.id = (case when p_audience = 'manager' then app_private.alumni_company_ceo(pg.id) end)
    left join fa on fa.founder_id = cf.id
    left join progs on progs.company_id = pg.id;
  return jsonb_build_object('audience', p_audience, 'total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

create or replace function public.list_alumni_directory(p_filters jsonb default '{}'::jsonb, p_limit integer default 24, p_offset integer default 0, p_sort text default 'name') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if app_private.alumni_is_manager() then return app_private.alumni_directory_page(p_filters, 'manager', p_limit, p_offset, p_sort); end if;
  if app_private.has_any_role(array['founder', 'project_manager']) then return app_private.alumni_directory_page(p_filters, 'member', p_limit, p_offset, p_sort); end if;
  raise exception 'forbidden' using errcode = '42501';
end $$;

-- the PUBLIC directory: only companies a manager marked alumni AND whose founders chose "public" AND that no manager vetoed. Whitelisted company fields, no person, no metric.
create or replace function public.list_public_alumni_directory(p_filters jsonb default '{}'::jsonb, p_limit integer default 24, p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.alumni_directory_page(p_filters, 'public', p_limit, p_offset, 'name')
$$;

create or replace function public.get_alumni_company(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  return app_private.alumni_company_payload(p_company, v_uid, true);
end $$;

-- a founder as a manager sees him: the national ID is MASKED unless p_reveal; every reveal is logged (who, when, which founder; never the number)
create or replace function public.get_alumni_founder(p_founder uuid, p_reveal boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v := app_private.alumni_founder_json(p_founder, false, coalesce(p_reveal, false));
  if v is null then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if coalesce(p_reveal, false) and exists (select 1 from public.founder_identities i where i.founder_id = p_founder and i.national_id is not null) then
    insert into app_private.founder_identity_access_log (accessed_by, via, founder_id) values (v_uid, 'reveal', p_founder);
  end if;
  return v || jsonb_build_object('companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar, 'role', cf.role, 'is_primary', cf.is_primary) order by c.created_at, c.id)
                                                          from public.company_founders cf join public.companies c on c.id = cf.company_id and c.deleted_at is null where cf.founder_id = p_founder), '[]'::jsonb));
end $$;

-- a manager edits ANY company (create when p_company is null; `is_alumni` and `internal` {hint, directory_hidden, reviewed} are manager-only keys)
create or replace function public.save_alumni_company(p_company uuid, p_patch jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_clean jsonb; v_id uuid := p_company; v_upd timestamptz; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_clean := app_private.alumni_clean_company_patch(p_patch, true);
  if v_id is null then
    v_name := lower(btrim(coalesce(v_clean->>'name_en', v_clean->>'name_ar')));
    if v_name is null then perform app_private.alumni_fail('name', 'required'); end if;
    if exists (select 1 from public.companies c where c.name_key = v_name and c.deleted_at is null) then
      raise exception 'alumni_company_exists: a company with this name already exists (use merge_companies for duplicates)' using errcode = '23505', hint = 'alumni_company_exists';
    end if;
    insert into public.companies (name_en, name_ar, created_by) values (v_clean->>'name_en', v_clean->>'name_ar', v_uid) returning id into v_id;
  else
    select c.updated_at into v_upd from public.companies c where c.id = v_id and c.deleted_at is null for update;
    if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
    if p_expected is not null and v_upd is distinct from p_expected then
      raise exception 'alumni_stale: the company was changed by someone else; reload it' using errcode = '40001', hint = 'alumni_stale';
    end if;
  end if;
  perform app_private.alumni_apply_company_patch(v_id, v_clean, true, v_uid);
  return jsonb_build_object('saved', true) || app_private.alumni_company_payload(v_id, v_uid, true);
end $$;

-- a manager edits ANY founder (the only writer of an e-mail; the ID of a founder who has no account yet, e.g. the Excel import)
create or replace function public.save_alumni_founder(p_founder uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  r := app_private.alumni_apply_founder_patch(p_founder, p_patch, true, v_uid, true);
  return jsonb_build_object('saved', true, 'replaced', r->'replaced', 'founder', app_private.alumni_founder_json(p_founder, false, false));
end $$;

-- mark / unmark companies as alumni in bulk (the owner's "mark all participants of a completed program" action)
create or replace function public.set_companies_alumni(p_ids uuid[], p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_value is null or p_ids is null or cardinality(p_ids) = 0 then perform app_private.alumni_fail('ids', 'required'); end if;
  if cardinality(p_ids) > 500 then perform app_private.alumni_fail('ids', 'too_many'); end if;
  update public.companies c set is_alumni = p_value where c.id = any (p_ids) and c.deleted_at is null and c.is_alumni is distinct from p_value;
  get diagnostics v_n = row_count;
  return jsonb_build_object('changed', v_n, 'requested', cardinality(p_ids));
end $$;

-- THE export: the owner's 38 columns in the owner's order, with the owner's header texts (the typos "Governerate" and "Nu. of ..." are kept on purpose: their Excel workflow
-- keys on them). One row per company. Governerate = the CEO's governorate FROM THE ID, else the company's typed governorate. Manager only; logged (row count only).
create or replace function public.export_alumni_rows(p_filters jsonb default '{}'::jsonb, p_year integer default null, p_lang text default 'en', p_as_of date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_lang text := case when lower(coalesce(p_lang, 'en')) = 'ar' then 'ar' else 'en' end; v_today date := coalesce(p_as_of, app_private.alumni_today());
        v_year integer; v_rows jsonb; v_n integer; v_cols jsonb; v_src_id integer; v_src_self integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_year := coalesce(p_year, (select max(s.period_year) from public.company_snapshots s where s.snapshot_type = 'annual')::int, 2023);
  if v_year < 1990 or v_year > 2100 then perform app_private.alumni_fail('year', 'out_of_range'); end if;
  v_cols := jsonb_build_array(
    jsonb_build_object('key', 'startup_name', 'header', 'Startup Name', 'type', 'text'),
    jsonb_build_object('key', 'program_scope', 'header', 'Program Scope', 'type', 'text'),
    jsonb_build_object('key', 'program_name', 'header', 'Program Name', 'type', 'text'),
    jsonb_build_object('key', 'support_provided', 'header', 'Support provided', 'type', 'text'),
    jsonb_build_object('key', 'startup_type', 'header', 'Startup type', 'type', 'text'),
    jsonb_build_object('key', 'hint', 'header', 'Hint', 'type', 'text'),
    jsonb_build_object('key', 'sector', 'header', 'Sector', 'type', 'text'),
    jsonb_build_object('key', 'sub_sector', 'header', 'Sub sector', 'type', 'text'),
    jsonb_build_object('key', 'description', 'header', 'Description', 'type', 'text'),
    jsonb_build_object('key', 'stage', 'header', 'Stage', 'type', 'text'),
    jsonb_build_object('key', 'governerate', 'header', 'Governerate', 'type', 'text'),
    jsonb_build_object('key', 'established', 'header', 'Date of company established', 'type', 'date'),
    jsonb_build_object('key', 'app', 'header', 'App', 'type', 'text'),
    jsonb_build_object('key', 'website', 'header', 'Website', 'type', 'text'),
    jsonb_build_object('key', 'social_media', 'header', 'Social media', 'type', 'text'),
    jsonb_build_object('key', 'traction', 'header', 'Traction/Validation', 'type', 'text'),
    jsonb_build_object('key', 'ceo_name', 'header', 'CEO Name', 'type', 'text'),
    jsonb_build_object('key', 'phone', 'header', 'Phone', 'type', 'text'),
    jsonb_build_object('key', 'email', 'header', 'Email', 'type', 'text'),
    jsonb_build_object('key', 'national_id', 'header', 'ID', 'type', 'text'),
    jsonb_build_object('key', 'ceo_age', 'header', 'CEO Age', 'type', 'number'),
    jsonb_build_object('key', 'age_category', 'header', 'Age Category', 'type', 'text'),
    jsonb_build_object('key', 'student_graduate', 'header', 'Student/Graduate', 'type', 'text'),
    jsonb_build_object('key', 'ceo_gender', 'header', 'CEO Gender', 'type', 'text'),
    jsonb_build_object('key', 'open_closed', 'header', 'Open/Closed', 'type', 'text'),
    jsonb_build_object('key', 'reason_for_closing', 'header', 'Reason for closing', 'type', 'text'),
    jsonb_build_object('key', 'after_closing', 'header', 'After closing', 'type', 'text'),
    jsonb_build_object('key', 'legal_status', 'header', 'Legal Status', 'type', 'text'),
    jsonb_build_object('key', 'founding_team_size', 'header', 'Founding team size', 'type', 'number'),
    jsonb_build_object('key', 'female_founders', 'header', 'Female founders', 'type', 'number'),
    jsonb_build_object('key', 'founders_below_35', 'header', 'Nu. of founders below 35', 'type', 'number'),
    jsonb_build_object('key', 'employees', 'header', 'Nu. of employees', 'type', 'number'),
    jsonb_build_object('key', 'female_employees', 'header', 'Nu. of female employees', 'type', 'number'),
    jsonb_build_object('key', 'freelancers', 'header', 'Number of freelancers', 'type', 'number'),
    jsonb_build_object('key', 'funding_raised', 'header', 'Funding raised', 'type', 'number'),
    jsonb_build_object('key', 'revenue', 'header', 'Revenue (' || v_year || ') (Total)', 'type', 'number'),
    jsonb_build_object('key', 'challenges', 'header', 'Challenges', 'type', 'text'),
    jsonb_build_object('key', 'needs', 'header', 'Needs', 'type', 'text'));

  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', v_today) i),
       ts as (select * from app_private.alumni_team_stats(v_today)),
       fa as (select * from app_private.alumni_founder_attrs(v_today)),
       ap as (select * from app_private.alumni_participations()),
       progs as (select ap.company_id,
                        string_agg(distinct case when v_lang = 'ar' then coalesce(g.name_ar, g.name_en) else coalesce(g.name_en, g.name_ar) end, '; ') as scope_txt,
                        string_agg(distinct case when v_lang = 'ar' then coalesce(j.name_ar, j.name_en) else coalesce(j.name_en, j.name_ar) end, '; ') as name_txt
                   from ap join public.projects j on j.id = ap.project_id join public.programs g on g.id = ap.program_id group by ap.company_id),
       supp as (select s.company_id, string_agg(case when v_lang = 'ar' then l.label_ar else l.label_en end, '; ' order by l.sort_order, l.key) as txt
                  from (select distinct ap.company_id, k from ap cross join lateral unnest(app_private.alumni_project_support(ap.project_id)) k) s
                  join public.alumni_lookups l on l.kind = 'support_kind' and l.key = s.k group by s.company_id),
       rows as (
         select jsonb_build_array(
           case when v_lang = 'ar' then coalesce(c.name_ar, c.name_en) else coalesce(c.name_en, c.name_ar) end,
           progs.scope_txt, progs.name_txt, supp.txt,
           app_private.alumni_label('startup_type', c.startup_type_key, v_lang),
           ci.hint,
           coalesce(app_private.alumni_label('sector', c.sector_key, v_lang), case when v_lang = 'ar' then coalesce(c.industry_ar, c.industry_en) else coalesce(c.industry_en, c.industry_ar) end),
           app_private.alumni_label('subsector', c.subsector_key, v_lang),
           case when v_lang = 'ar' then coalesce(c.description_ar, c.description_en) else coalesce(c.description_en, c.description_ar) end,
           coalesce(app_private.alumni_label('stage', c.stage, v_lang), c.stage),
           coalesce(app_private.eg_governorate_name(fa.governorate_code, v_lang), app_private.eg_governorate_name(c.governorate_code, v_lang),
                    case when v_lang = 'ar' then coalesce(c.governorate_ar, c.governorate_en) else coalesce(c.governorate_en, c.governorate_ar) end),
           coalesce(c.established_on::text, c.founding_year::text),
           c.app_url, c.website_url, app_private.alumni_social_text(c.links, c.linkedin_url),
           m.traction,
           case when v_lang = 'ar' then coalesce(f.name_ar, f.name_en) else coalesce(f.name_en, f.name_ar) end,
           f.phone, f.email::text, idn.national_id,
           fa.age, app_private.alumni_label('age_category', fa.age_category, v_lang), app_private.alumni_label('education_status', f.education_status, v_lang),
           app_private.alumni_label('gender', fa.gender, v_lang),
           app_private.alumni_label('operating_status', c.operating_status, v_lang),
           nullif(concat_ws(' - ', app_private.alumni_label('closing_reason', c.closing_reason_key, v_lang), c.closing_note), ''),
           app_private.alumni_label('after_closing', c.after_closing_key, v_lang),
           app_private.alumni_label('legal_status', c.legal_status_key, v_lang),
           coalesce(ts.team_size, 0), coalesce(ts.female_founders, 0), coalesce(ts.founders_under_35, 0),
           m.employees_total, m.employees_female, m.freelancers, m.funding_raised_total, m.revenue_year, m.challenges, m.needs) as r,
           lower(coalesce(c.name_en, c.name_ar)) as sort_key, c.id as cid, fa.source as src
           from public.companies c
           join ids on ids.id = c.id
           left join public.company_internal ci on ci.company_id = c.id
           left join ts on ts.company_id = c.id
           left join progs on progs.company_id = c.id
           left join supp on supp.company_id = c.id
           left join public.founders f on f.id = app_private.alumni_company_ceo(c.id)
           left join fa on fa.founder_id = f.id
           left join public.founder_identities idn on idn.founder_id = f.id
           left join lateral (
             select (array_agg(s.employees_total order by s.period_year desc) filter (where s.employees_total is not null))[1] as employees_total,
                    (array_agg(s.employees_female order by s.period_year desc) filter (where s.employees_female is not null))[1] as employees_female,
                    (array_agg(s.freelancers order by s.period_year desc) filter (where s.freelancers is not null))[1] as freelancers,
                    (array_agg(s.funding_raised_total order by s.period_year desc) filter (where s.funding_raised_total is not null))[1] as funding_raised_total,
                    (array_agg(s.traction order by s.period_year desc) filter (where s.traction is not null))[1] as traction,
                    (array_agg(s.challenges order by s.period_year desc) filter (where s.challenges is not null))[1] as challenges,
                    (array_agg(s.needs order by s.period_year desc) filter (where s.needs is not null))[1] as needs,
                    max(s.revenue_total) filter (where s.period_year = v_year) as revenue_year
               from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'annual' and s.period_year <= v_year) m on true)
  select coalesce(jsonb_agg(rows.r order by rows.sort_key, rows.cid), '[]'::jsonb), count(*)::int, (count(*) filter (where rows.src = 'id'))::int, (count(*) filter (where rows.src = 'self'))::int
    into v_rows, v_n, v_src_id, v_src_self from rows;
  insert into app_private.founder_identity_access_log (accessed_by, via, row_count) values (v_uid, 'export', v_n);
  -- meta.ceo_source tells the manager how many CEO age / gender / governorate cells come from an ID, how many are self-declared and how many are unknown
  return jsonb_build_object('columns', v_cols, 'rows', v_rows, 'meta', jsonb_build_object('year', v_year, 'lang', v_lang, 'as_of', v_today, 'count', v_n, 'generated_at', now(),
    'ceo_source', jsonb_build_object('id', v_src_id, 'self', v_src_self, 'none', v_n - v_src_id - v_src_self)));
end $$;

-- aggregates for the manager dashboard / analytics / impact pages (counts per key; labels are the client's lookup)
create or replace function public.get_alumni_analytics(p_filters jsonb default '{}'::jsonb, p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_year integer; v jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app_private.alumni_is_manager() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_year := coalesce(p_year, (select max(s.period_year) from public.company_snapshots s where s.snapshot_type = 'annual')::int, extract(year from app_private.alumni_today())::int - 1);
  if v_year < 1990 or v_year > 2100 then perform app_private.alumni_fail('year', 'out_of_range'); end if;
  with ids as (select i as id from app_private.alumni_filter_ids(p_filters, 'manager', app_private.alumni_today()) i),
       ts as (select * from app_private.alumni_team_stats(app_private.alumni_today())),
       fa as (select * from app_private.alumni_founder_attrs(app_private.alumni_today())),
       ap as (select * from app_private.alumni_participations()),
       x as (
         select c.id, c.sector_key, c.stage, c.startup_type_key, c.legal_status_key, c.governorate_code, c.operating_status,
                fa.governorate_code as ceo_gov, fa.gender as ceo_gender, fa.age_category as ceo_age_cat,
                coalesce(ts.team_size, 0) as team_size, coalesce(ts.female_founders, 0) as female_founders, coalesce(ts.founders_under_35, 0) as under_35,
                m.employees_total, m.employees_female, m.freelancers, m.funding_raised_total, m.revenue_year, m.reporting
           from public.companies c
           join ids on ids.id = c.id
           left join ts on ts.company_id = c.id
           left join fa on fa.founder_id = app_private.alumni_company_ceo(c.id)
           left join lateral (
             select (array_agg(s.employees_total order by s.period_year desc) filter (where s.employees_total is not null))[1] as employees_total,
                    (array_agg(s.employees_female order by s.period_year desc) filter (where s.employees_female is not null))[1] as employees_female,
                    (array_agg(s.freelancers order by s.period_year desc) filter (where s.freelancers is not null))[1] as freelancers,
                    (array_agg(s.funding_raised_total order by s.period_year desc) filter (where s.funding_raised_total is not null))[1] as funding_raised_total,
                    max(s.revenue_total) filter (where s.period_year = v_year) as revenue_year,
                    bool_or(s.period_year = v_year) as reporting
               from public.company_snapshots s where s.company_id = c.id and s.snapshot_type = 'annual' and s.period_year <= v_year) m on true)
  select jsonb_build_object(
    'year', v_year,
    'totals', (select jsonb_build_object('companies', count(*), 'open', count(*) filter (where operating_status = 'open'), 'closed', count(*) filter (where operating_status = 'closed'),
                 'survival_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where operating_status = 'open') / count(*), 1) end,
                 'with_program', count(*) filter (where exists (select 1 from ap where ap.company_id = x.id)),
                 'reporting_year', count(*) filter (where coalesce(reporting, false)),
                 'founders', coalesce(sum(team_size), 0), 'female_founders', coalesce(sum(female_founders), 0), 'founders_under_35', coalesce(sum(under_35), 0),
                 'employees', coalesce(sum(employees_total), 0), 'female_employees', coalesce(sum(employees_female), 0), 'freelancers', coalesce(sum(freelancers), 0),
                 'funding_raised', coalesce(sum(funding_raised_total), 0), 'revenue', coalesce(sum(revenue_year), 0)) from x),
    'by_sector', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select sector_key k, count(*) n from x group by sector_key) q),
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select stage k, count(*) n from x group by stage) q),
    'by_startup_type', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select startup_type_key k, count(*) n from x group by startup_type_key) q),
    'by_legal_status', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select legal_status_key k, count(*) n from x group by legal_status_key) q),
    'by_governorate', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select governorate_code::text k, count(*) n from x group by governorate_code) q),
    'by_ceo_governorate', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select ceo_gov::text k, count(*) n from x group by ceo_gov) q),
    'by_ceo_gender', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select ceo_gender k, count(*) n from x group by ceo_gender) q),
    'by_ceo_age_category', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k), '[]'::jsonb) from (select ceo_age_cat k, count(*) n from x group by ceo_age_cat) q),
    'by_program', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'program_name_en', pn_en, 'program_name_ar', pn_ar, 'count', n) order by n desc, k), '[]'::jsonb)
                     from (select g.id::text k, g.name_en pn_en, g.name_ar pn_ar, count(distinct ap.company_id) n from ap join x on x.id = ap.company_id join public.programs g on g.id = ap.program_id group by g.id, g.name_en, g.name_ar) q),
    'by_year', (select coalesce(jsonb_agg(jsonb_build_object('year', yy, 'companies_reporting', n, 'revenue', rev, 'funding_raised', fund, 'employees', emp, 'female_employees', femp, 'freelancers', fl) order by yy), '[]'::jsonb)
                  from (select s.period_year yy, count(distinct s.company_id) n, sum(s.revenue_total) rev, sum(s.funding_raised_total) fund, sum(s.employees_total) emp, sum(s.employees_female) femp, sum(s.freelancers) fl
                          from public.company_snapshots s join x on x.id = s.company_id where s.snapshot_type = 'annual' group by s.period_year) q))
    into v;
  return v;
end $$;

-- ================================================================= 14. alumni invitations (the data the signup / invitation pages need; the e-mail itself waits for the outbox worker)
-- token: 24 random bytes (base64url), returned ONCE; only its sha256 is stored (the format validate_invitation / accept_invitation / handle_new_user already hash). A founder may
-- invite a co-founder to HIS company; a manager to any company. At most 20 new invitations per account and day (outside managers).
create or replace function public.create_alumni_invitation(p_company uuid, p_email text, p_language text default 'en', p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mgr boolean; v_email text := lower(btrim(coalesce(p_email, ''))); v_token text; i public.alumni_invitations; v_lang text := case when p_language = 'ar' then 'ar' else 'en' end;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = p_company)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.deleted_at is null) then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then perform app_private.alumni_fail('email', 'bad_value'); end if;
  if p_app_url is not null and p_app_url !~* '^https?://[^[:space:]]+$' then perform app_private.alumni_fail('app_url', 'bad_url'); end if;
  if exists (select 1 from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
              where cf.company_id = p_company and lower(f.email::text) = v_email) then perform app_private.alumni_fail('email', 'already_member'); end if;
  if not v_mgr and (select count(*) from public.alumni_invitations x where x.sent_by = v_uid and x.created_at > now() - interval '1 day') >= 20 then
    raise exception 'alumni_rate_limited: too many invitations today' using errcode = 'P0001', hint = 'alumni_rate_limited';
  end if;
  update public.alumni_invitations x set status = 'revoked' where x.company_id = p_company and lower(x.founder_email) = v_email and x.status = 'pending';
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');
  insert into public.alumni_invitations (company_id, founder_email, token, status, sent_by) values (p_company, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), 'pending', v_uid) returning * into i;
  return jsonb_build_object('id', i.id, 'company_id', i.company_id, 'email', i.founder_email, 'token', v_token, 'link', coalesce(rtrim(p_app_url, '/'), '') || '/invite/' || v_token,
                            'language', v_lang, 'expires_at', i.sent_at + interval '14 days');
end $$;

create or replace function public.revoke_alumni_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); i public.alumni_invitations;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into i from public.alumni_invitations x where x.id = p_id;
  if not found then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  if not (app_private.alumni_is_manager() or (app_private.has_role('founder') and exists (select 1 from app_private.my_company_ids() m where m = i.company_id))) then raise exception 'forbidden' using errcode = '42501'; end if;
  if i.status <> 'pending' then raise exception 'alumni_not_found' using errcode = 'P0002', hint = 'alumni_not_found'; end if;
  update public.alumni_invitations x set status = 'revoked' where x.id = p_id;
end $$;

-- manager: every invitation; founder: the invitations of his own companies. Never the token or its hash. `effective_status` turns a pending invitation older than 14 days into 'expired'.
create or replace function public.list_alumni_invitations(p_status text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean; v_rows jsonb; v_total integer; v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 200); v_off integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_mgr := app_private.alumni_is_manager();
  if not v_mgr and not app_private.has_role('founder') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('pending', 'accepted', 'expired', 'revoked') then perform app_private.alumni_fail('status', 'bad_value'); end if;
  select coalesce(jsonb_agg(q.j order by q.sent_at desc, q.id), '[]'::jsonb) into v_rows from (
    select i.id, i.sent_at,
           jsonb_build_object('id', i.id, 'company_id', i.company_id, 'company_name_en', c.name_en, 'company_name_ar', c.name_ar, 'email', i.founder_email, 'status', i.status,
             'effective_status', case when i.status = 'pending' and i.sent_at + interval '14 days' <= now() then 'expired' else i.status end,
             'sent_at', i.sent_at, 'expires_at', i.sent_at + interval '14 days', 'accepted_at', i.accepted_at, 'sent_by', i.sent_by) as j
      from public.alumni_invitations i join public.companies c on c.id = i.company_id
     where (v_mgr or i.company_id in (select app_private.my_company_ids()))
       and (p_status is null or (case when i.status = 'pending' and i.sent_at + interval '14 days' <= now() then 'expired' else i.status end) = p_status)
     order by i.sent_at desc, i.id limit v_lim offset v_off) q;
  select count(*)::int into v_total from public.alumni_invitations i
   where (v_mgr or i.company_id in (select app_private.my_company_ids()))
     and (p_status is null or (case when i.status = 'pending' and i.sent_at + interval '14 days' <= now() then 'expired' else i.status end) = p_status);
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end $$;

-- ================================================================= 15. storage: a founder's company logo (public-assets/alumni/<uid>/logo/<uuid>.webp, WebP only: m41 / m43 restrictive policies stay in force)
-- (policies call only app_private.has_role / has_any_role, which the authenticated role may execute; a function it may not execute would fail the whole statement: the m36 lesson)
drop policy if exists public_assets_insert_alumni on storage.objects;
create policy public_assets_insert_alumni on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and name ~ '^alumni/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$'
              and (((storage.foldername(name))[2] = (select auth.uid())::text and (select app_private.has_role('founder'))) or (select app_private.has_any_role(array['alumni_manager', 'super_admin']))));
drop policy if exists public_assets_update_alumni on storage.objects;
create policy public_assets_update_alumni on storage.objects for update to authenticated
  using (bucket_id = 'public-assets' and (storage.foldername(name))[1] = 'alumni'
         and (((storage.foldername(name))[2] = (select auth.uid())::text and (select app_private.has_role('founder'))) or (select app_private.has_any_role(array['alumni_manager', 'super_admin']))))
  with check (bucket_id = 'public-assets' and name ~ '^alumni/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$'
              and (((storage.foldername(name))[2] = (select auth.uid())::text and (select app_private.has_role('founder'))) or (select app_private.has_any_role(array['alumni_manager', 'super_admin']))));
drop policy if exists public_assets_delete_alumni on storage.objects;
create policy public_assets_delete_alumni on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and (storage.foldername(name))[1] = 'alumni'
         and (((storage.foldername(name))[2] = (select auth.uid())::text and (select app_private.has_role('founder'))) or (select app_private.has_any_role(array['alumni_manager', 'super_admin']))));

-- ================================================================= 16. merge_companies (m06d / m43) patched IN PLACE: yearly snapshots, manager notes and profile gaps survive a merge
-- keep wins; a gap in the kept company is filled from the dropped one; a same-year annual snapshot is merged field by field (kept values win); the dropped notes are moved
create or replace function app_private.alumni_merge_company_data(p_keep uuid, p_drop uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.company_snapshots; k uuid; s2 public.company_snapshots;
begin
  for r in select * from public.company_snapshots s where s.company_id = p_drop loop
    select x.id into k from public.company_snapshots x where x.company_id = p_keep and r.snapshot_type = 'annual' and x.snapshot_type = 'annual' and x.period_year = r.period_year;
    if k is null then
      update public.company_snapshots x set company_id = p_keep where x.id = r.id;
    else
      select * into s2 from public.company_snapshots x where x.id = k;
      update public.company_snapshots x set revenue_total = coalesce(s2.revenue_total, r.revenue_total), funding_raised_total = coalesce(s2.funding_raised_total, r.funding_raised_total),
             employees_total = coalesce(s2.employees_total, r.employees_total),
             employees_female = case when coalesce(s2.employees_female, r.employees_female) <= coalesce(s2.employees_total, r.employees_total, 1000000) then coalesce(s2.employees_female, r.employees_female) else s2.employees_female end,
             freelancers = coalesce(s2.freelancers, r.freelancers), traction = coalesce(s2.traction, r.traction), challenges = coalesce(s2.challenges, r.challenges),
             needs = coalesce(s2.needs, r.needs), updated_at = now()
       where x.id = k;
      delete from public.company_snapshots x where x.id = r.id;
    end if;
  end loop;

  insert into public.company_internal (company_id, hint, directory_hidden, reviewed_at, reviewed_by, updated_by)
    select p_keep, d.hint, d.directory_hidden, d.reviewed_at, d.reviewed_by, d.updated_by from public.company_internal d where d.company_id = p_drop
  on conflict (company_id) do update set hint = coalesce(public.company_internal.hint, excluded.hint),
    directory_hidden = public.company_internal.directory_hidden or excluded.directory_hidden,
    reviewed_at = coalesce(public.company_internal.reviewed_at, excluded.reviewed_at), reviewed_by = coalesce(public.company_internal.reviewed_by, excluded.reviewed_by), updated_at = now();
  delete from public.company_internal d where d.company_id = p_drop;

  update public.companies x set
    startup_type_key = coalesce(x.startup_type_key, d.startup_type_key),
    sector_key = coalesce(x.sector_key, d.sector_key),
    subsector_key = case when x.subsector_key is not null then x.subsector_key
                         when x.sector_key is null and d.sector_key is not null then d.subsector_key
                         when x.sector_key is not distinct from d.sector_key then d.subsector_key end,
    stage = coalesce(x.stage, d.stage), legal_status_key = coalesce(x.legal_status_key, d.legal_status_key), governorate_code = coalesce(x.governorate_code, d.governorate_code),
    established_on = coalesce(x.established_on, d.established_on), app_url = coalesce(x.app_url, d.app_url), website_url = coalesce(x.website_url, d.website_url),
    linkedin_url = coalesce(x.linkedin_url, d.linkedin_url), logo_path = coalesce(x.logo_path, d.logo_path),
    description_en = coalesce(x.description_en, d.description_en), description_ar = coalesce(x.description_ar, d.description_ar),
    location_en = coalesce(x.location_en, d.location_en), location_ar = coalesce(x.location_ar, d.location_ar), is_alumni = x.is_alumni or d.is_alumni
   from public.companies d where x.id = p_keep and d.id = p_drop;
end $$;

create or replace function pg_temp.m49_patch(p_fn regprocedure, p_old text, p_new text, p_expect int default 1) returns text
language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  if position(p_new in v_def) > 0 then return 'already  ' || p_fn::text; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_expect then raise exception 'm49_patch: % anchor found % times (expected %): %', p_fn, v_n, p_expect, left(p_old, 90); end if;
  execute replace(v_def, p_old, p_new);
  return 'patched   ' || p_fn::text;
end $$;
select pg_temp.m49_patch('public.merge_companies(uuid,uuid)'::regprocedure,
  $o$update public.company_snapshots set company_id = p_keep where company_id = p_drop;$o$,
  $n$perform app_private.alumni_merge_company_data(p_keep, p_drop);$n$);

-- ================================================================= 17. non-destructive BACKFILL (fills new typed columns from values that already exist; nothing is overwritten or deleted)
-- updated_at is NOT touched (the touch trigger is switched off for the statements): the migrated companies keep their last-modified time
alter table public.companies disable trigger companies_bu_touch;
update public.companies c set governorate_code = g.code
  from (select c2.id, coalesce(app_private.eg_governorate_from_text(c2.governorate_en), app_private.eg_governorate_from_text(c2.governorate_ar),
                               app_private.eg_governorate_from_text(c2.location_en), app_private.eg_governorate_from_text(c2.location_ar)) as code
          from public.companies c2 where c2.governorate_code is null) g
 where c.id = g.id and g.code is not null;
update public.companies c set sector_key = g.k
  from (select c2.id, app_private.alumni_sector_from_text(coalesce(c2.industry_en, c2.industry_ar)) as k
          from public.companies c2 where c2.sector_key is null and coalesce(c2.industry_en, c2.industry_ar) is not null) g
 where c.id = g.id and g.k is not null;
alter table public.companies enable trigger companies_bu_touch;

-- ================================================================= 18. grants (new functions have NO API privilege by default: the postgres default ACL gives EXECUTE to service_role only)
do $$
declare s text; r record;
  v_auth text[] := array[
    'public.save_alumni_lookup(text,text,jsonb)', 'public.delete_alumni_lookup(text,text)', 'public.preview_national_id(text)',
    'public.get_my_alumni_profile()', 'public.save_my_founder_profile(jsonb)', 'public.get_my_company_profile(uuid)', 'public.save_my_company_profile(uuid,jsonb,timestamptz)',
    'public.save_company_team_member(uuid,uuid,jsonb)', 'public.remove_company_team_member(uuid,uuid)', 'public.set_company_ceo(uuid,uuid)',
    'public.upsert_company_snapshot(uuid,integer,jsonb)', 'public.delete_company_snapshot(uuid,integer)',
    'public.list_alumni_directory(jsonb,integer,integer,text)', 'public.get_alumni_company(uuid)', 'public.get_alumni_founder(uuid,boolean)',
    'public.save_alumni_company(uuid,jsonb,timestamptz)', 'public.save_alumni_founder(uuid,jsonb)', 'public.set_companies_alumni(uuid[],boolean)',
    'public.export_alumni_rows(jsonb,integer,text,date)', 'public.get_alumni_analytics(jsonb,integer)',
    'public.create_alumni_invitation(uuid,text,text,text)', 'public.revoke_alumni_invitation(uuid)', 'public.list_alumni_invitations(text,integer,integer)'];
  v_anon text[] := array['public.list_alumni_lookups()', 'public.list_public_alumni_directory(jsonb,integer,integer)'];
begin
  foreach s in array v_auth loop
    if to_regprocedure(s) is null then raise exception 'm49: function missing: %', s; end if;
    execute format('revoke all on function %s from public, anon, authenticated', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;
  foreach s in array v_anon loop
    if to_regprocedure(s) is null then raise exception 'm49: function missing: %', s; end if;
    execute format('revoke all on function %s from public, anon, authenticated', s);
    execute format('grant execute on function %s to anon, authenticated', s);
  end loop;
  -- every helper of this migration (alumni_*, id_*, eg_*) is closed to the API roles: only SECURITY DEFINER RPCs and triggers reach them
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^(alumni_|id_|eg_)' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;

analyze public.companies;
analyze public.company_snapshots;

-- ================================================================= 19. self-check
do $$
declare v_bad integer;
begin
  if (select count(*) from public.alumni_lookups where kind = 'sector') < 18 or (select count(*) from public.alumni_lookups where kind = 'subsector') < 55 then raise exception 'm49: lookups not seeded'; end if;
  -- the identity, internal-notes and lookup tables are closed to every API role; the snapshots are read-only for the authenticated role
  if exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('founder_identities', 'company_internal', 'alumni_lookups') and g.grantee in ('anon', 'authenticated', 'PUBLIC')) then
    raise exception 'm49: an API role has a privilege on an identity / internal / lookup table';
  end if;
  if exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'app_private' and g.table_name in ('founder_identity_access_log', 'alumni_probe_limits') and g.grantee in ('anon', 'authenticated', 'PUBLIC')) then
    raise exception 'm49: an API role has a privilege on an app_private audit table';
  end if;
  if has_table_privilege('authenticated', 'public.company_snapshots', 'INSERT') or has_table_privilege('authenticated', 'public.company_snapshots', 'UPDATE') or has_table_privilege('anon', 'public.company_snapshots', 'SELECT') then
    raise exception 'm49: company_snapshots must be read-only for authenticated and closed to anon';
  end if;
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname ~ '^(alumni_|id_|eg_)'
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then raise exception 'm49: % app_private helper(s) executable by an API role', v_bad; end if;
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname in ('get_my_alumni_profile', 'save_my_founder_profile', 'get_my_company_profile', 'save_my_company_profile', 'save_company_team_member', 'remove_company_team_member', 'set_company_ceo',
                       'upsert_company_snapshot', 'delete_company_snapshot', 'list_alumni_directory', 'get_alumni_company', 'get_alumni_founder', 'save_alumni_company', 'save_alumni_founder',
                       'set_companies_alumni', 'export_alumni_rows', 'get_alumni_analytics', 'preview_national_id', 'save_alumni_lookup', 'delete_alumni_lookup',
                       'create_alumni_invitation', 'revoke_alumni_invitation', 'list_alumni_invitations');
  if v_bad > 0 then raise exception 'm49: anon must not execute the alumni RPCs (only list_alumni_lookups and list_public_alumni_directory)'; end if;
  if not (has_function_privilege('anon', 'public.list_alumni_lookups()', 'EXECUTE') and has_function_privilege('anon', 'public.list_public_alumni_directory(jsonb,integer,integer)', 'EXECUTE')) then
    raise exception 'm49: anon must execute the two public vocabulary / directory functions';
  end if;
  -- the backfill only wrote valid keys
  if exists (select 1 from public.companies c where c.governorate_code is not null and not exists (select 1 from app_private.eg_governorates() g where g.code = c.governorate_code and not g.is_abroad)) then raise exception 'm49: bad governorate_code'; end if;
  if exists (select 1 from public.companies c where c.sector_key is not null and not exists (select 1 from public.alumni_lookups l where l.kind = 'sector' and l.key = c.sector_key)) then raise exception 'm49: bad sector_key'; end if;
  if exists (select 1 from public.companies c where c.stage is not null and not exists (select 1 from public.alumni_lookups l where l.kind = 'stage' and l.key = c.stage)) then raise notice 'm49: some companies.stage values are not in the stage lookup (legacy values stay untouched)'; end if;
end $$;

commit;
