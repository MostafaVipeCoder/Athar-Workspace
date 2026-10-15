-- ============================================================
-- Athar Alumni Platform — Seed Data for Testing
-- Generated: 2026-09-25
-- Run against: Supabase project nipunwrewluxaikyfbzg
-- ============================================================

-- ─── 1. PROGRAMS ─────────────────────────────────────────────
INSERT INTO programs (name, description, program_type, year, status, name_ar)
VALUES
  ('Athar Accelerator 2023', 'Flagship startup acceleration program', 'accelerator', 2023, 'completed', 'مسرّع أثر 2023'),
  ('Athar Bootcamp 2024', 'Intensive 3-month pre-seed bootcamp',    'bootcamp',     2024, 'active',    'معسكر أثر 2024'),
  ('Athar Fellowship 2023', 'Social impact fellowship track',        'fellowship',   2023, 'completed', 'زمالة أثر 2023')
ON CONFLICT DO NOTHING;

-- ─── 2. COMPANIES (Alumni) ───────────────────────────────────
INSERT INTO companies (name, industry, stage, province, founding_year, is_alumni, description, website_url)
VALUES
  ('NovaTech Solutions',  'Technology',    'Series A', 'Riyadh',  2020, true, 'AI-powered supply chain optimization',     'https://novatech.sa'),
  ('GreenSaudi',          'AgriTech',      'Seed',     'Al-Ahsa', 2021, true, 'Sustainable hydroponics for arid climates', 'https://greensaudi.com'),
  ('MedSync',             'HealthTech',    'Pre-Seed',  'Jeddah',  2022, true, 'Digital health records for rural clinics',  'https://medsync.sa'),
  ('EduPath Arabia',      'EdTech',        'Seed',     'Dammam',  2021, true, 'Gamified K-12 learning platform',           'https://edupathsa.com'),
  ('FinFlowSA',           'FinTech',       'Series A', 'Riyadh',  2019, true, 'SME lending and invoice financing',         'https://finflowsa.com')
ON CONFLICT DO NOTHING;

-- ─── 3. FOUNDERS ─────────────────────────────────────────────
INSERT INTO founders (name_ar, name_en, email, phone, linkedin_url, bio_ar, bio_en)
VALUES
  ('سارة المحمد',  'Sara Al-Mohammed', 'sara@novatech.sa',     '+966501111001', 'https://linkedin.com/in/sara-alm', 'مؤسسة NovaTech، خبرة 8 سنوات في الذكاء الاصطناعي',  'Co-founder of NovaTech, 8 years in AI/ML'),
  ('خالد الزهراني','Khalid Al-Zahrani','khalid@greensaudi.com', '+966501111002', 'https://linkedin.com/in/khalid-az', 'رائد أعمال في التقنية الزراعية',                     'AgriTech entrepreneur & sustainability advocate'),
  ('ريم العتيبي',  'Reem Al-Otaibi',  'reem@medsync.sa',      '+966501111003', 'https://linkedin.com/in/reem-ao',  'طبيبة ومؤسسة MedSync',                                'Physician-turned-founder, MedSync CEO'),
  ('فهد السبيعي',  'Fahad Al-Subaie', 'fahad@edupathsa.com',  '+966501111004', 'https://linkedin.com/in/fahad-as', 'خبير تعليم رقمي ومؤسس EduPath',                        'EdTech pioneer, former Ministry of Education advisor'),
  ('نورة الدوسري', 'Noura Al-Dosari', 'noura@finflowsa.com',  '+966501111005', 'https://linkedin.com/in/noura-ad', 'FinTech entrepreneur، خبرة في البنوك والتقنية المالية', 'FinTech founder with 10 years in banking'),
  ('عمر الغامدي',  'Omar Al-Ghamdi',  'omar@novatech.sa',     '+966501111006', NULL, 'شريك مؤسس في NovaTech', 'Co-founder & CTO, NovaTech'),
  ('لمياء العمري', 'Lamia Al-Omari',  'lamia@edupathsa.com',  '+966501111007', NULL, 'مؤسسة مشاركة في EduPath', 'Co-founder EduPath, product lead'),
  ('بدر الشهري',   'Badr Al-Shehri', 'badr@finflowsa.com',   '+966501111008', NULL, 'CFO ومؤسس مشارك في FinFlowSA', 'Co-founder & CFO, FinFlowSA'),
  ('منى الحربي',   'Mona Al-Harbi',  'mona@greensaudi.com',  '+966501111009', NULL, 'مشاركة في GreenSaudi', 'Operations lead, GreenSaudi'),
  ('عبدالله الشمري','Abdullah Al-Shamri','abdulla@medsync.sa','+966501111010', NULL, 'مهندس البرمجيات الرئيسي في MedSync', 'Lead engineer, MedSync')
ON CONFLICT DO NOTHING;

-- ─── 4. LINK FOUNDERS TO COMPANIES ──────────────────────────
-- (Run after above inserts; uses sub-selects to avoid hardcoded UUIDs)
DO  
DECLARE
  v_nova    uuid; v_green   uuid; v_med     uuid; v_edu     uuid; v_fin     uuid;
  v_sara    uuid; v_khalid  uuid; v_reem    uuid; v_fahad   uuid; v_noura   uuid;
  v_omar    uuid; v_lamia   uuid; v_badr    uuid; v_mona    uuid; v_abdulla uuid;
BEGIN
  SELECT company_id INTO v_nova    FROM companies WHERE name = 'NovaTech Solutions' LIMIT 1;
  SELECT company_id INTO v_green   FROM companies WHERE name = 'GreenSaudi'         LIMIT 1;
  SELECT company_id INTO v_med     FROM companies WHERE name = 'MedSync'            LIMIT 1;
  SELECT company_id INTO v_edu     FROM companies WHERE name = 'EduPath Arabia'     LIMIT 1;
  SELECT company_id INTO v_fin     FROM companies WHERE name = 'FinFlowSA'          LIMIT 1;

  SELECT founder_id INTO v_sara    FROM founders WHERE email = 'sara@novatech.sa'    LIMIT 1;
  SELECT founder_id INTO v_khalid  FROM founders WHERE email = 'khalid@greensaudi.com' LIMIT 1;
  SELECT founder_id INTO v_reem    FROM founders WHERE email = 'reem@medsync.sa'    LIMIT 1;
  SELECT founder_id INTO v_fahad   FROM founders WHERE email = 'fahad@edupathsa.com' LIMIT 1;
  SELECT founder_id INTO v_noura   FROM founders WHERE email = 'noura@finflowsa.com' LIMIT 1;
  SELECT founder_id INTO v_omar    FROM founders WHERE email = 'omar@novatech.sa'   LIMIT 1;
  SELECT founder_id INTO v_lamia   FROM founders WHERE email = 'lamia@edupathsa.com' LIMIT 1;
  SELECT founder_id INTO v_badr    FROM founders WHERE email = 'badr@finflowsa.com' LIMIT 1;
  SELECT founder_id INTO v_mona    FROM founders WHERE email = 'mona@greensaudi.com' LIMIT 1;
  SELECT founder_id INTO v_abdulla FROM founders WHERE email = 'abdulla@medsync.sa' LIMIT 1;

  INSERT INTO company_founders (company_id, founder_id, role, is_primary) VALUES
    (v_nova,  v_sara,    'CEO',      true),
    (v_nova,  v_omar,    'CTO',      false),
    (v_green, v_khalid,  'CEO',      true),
    (v_green, v_mona,    'COO',      false),
    (v_med,   v_reem,    'CEO',      true),
    (v_med,   v_abdulla, 'CTO',      false),
    (v_edu,   v_fahad,   'CEO',      true),
    (v_edu,   v_lamia,   'CPO',      false),
    (v_fin,   v_noura,   'CEO',      true),
    (v_fin,   v_badr,    'CFO',      false)
  ON CONFLICT DO NOTHING;

  -- ─── 5. PROGRAM PARTICIPATIONS ───────────────────────────
  DECLARE v_prog1 uuid; v_prog2 uuid; v_prog3 uuid;
  SELECT program_id INTO v_prog1 FROM programs WHERE name = 'Athar Accelerator 2023' LIMIT 1;
  SELECT program_id INTO v_prog2 FROM programs WHERE name = 'Athar Bootcamp 2024'    LIMIT 1;
  SELECT program_id INTO v_prog3 FROM programs WHERE name = 'Athar Fellowship 2023'  LIMIT 1;

  INSERT INTO program_participations (company_id, program_id, graduation_status, start_date, end_date) VALUES
    (v_nova,  v_prog1, 'graduated', '2023-01-10', '2023-06-30'),
    (v_green, v_prog1, 'graduated', '2023-01-10', '2023-06-30'),
    (v_med,   v_prog3, 'graduated', '2023-03-01', '2023-09-30'),
    (v_edu,   v_prog2, 'active',    '2024-02-01', NULL),
    (v_fin,   v_prog1, 'graduated', '2023-01-10', '2023-06-30')
  ON CONFLICT DO NOTHING;

  -- ─── 6. COMPANY SNAPSHOTS ────────────────────────────────
  INSERT INTO company_snapshots (company_id, snapshot_type, snapshot_date, source, data) VALUES
    (v_nova,  'graduation',      '2023-07-01', 'me_team', '{"revenue_sar": 0,       "jobs_created": 4,  "funding_raised_sar": 500000,  "is_active": true, "employee_count": 6}'),
    (v_nova,  'six_month',       '2024-01-15', 'founder', '{"revenue_sar": 180000,  "jobs_created": 9,  "funding_raised_sar": 2000000, "is_active": true, "employee_count": 14}'),
    (v_nova,  'annual_update',   '2024-07-01', 'founder', '{"revenue_sar": 650000,  "jobs_created": 17, "funding_raised_sar": 5000000, "is_active": true, "employee_count": 23}'),
    (v_green, 'graduation',      '2023-07-01', 'me_team', '{"revenue_sar": 0,       "jobs_created": 3,  "funding_raised_sar": 200000,  "is_active": true, "employee_count": 5}'),
    (v_green, 'annual_update',   '2024-07-01', 'founder', '{"revenue_sar": 320000,  "jobs_created": 12, "funding_raised_sar": 1200000, "is_active": true, "employee_count": 16}'),
    (v_med,   'graduation',      '2023-10-01', 'me_team', '{"revenue_sar": 0,       "jobs_created": 2,  "funding_raised_sar": 150000,  "is_active": true, "employee_count": 4}'),
    (v_edu,   'program_start',   '2024-02-01', 'me_team', '{"revenue_sar": 0,       "jobs_created": 2,  "funding_raised_sar": 100000,  "is_active": true, "employee_count": 3}'),
    (v_fin,   'graduation',      '2023-07-01', 'me_team', '{"revenue_sar": 800000,  "jobs_created": 8,  "funding_raised_sar": 3000000, "is_active": true, "employee_count": 11}'),
    (v_fin,   'annual_update',   '2024-07-01', 'founder', '{"revenue_sar": 3200000, "jobs_created": 22, "funding_raised_sar": 8000000, "is_active": true, "employee_count": 35}')
  ;

  -- ─── 7. OPPORTUNITIES ────────────────────────────────────
  INSERT INTO opportunities (title_en, title_ar, description_en, description_ar, type, deadline, is_active, order_index) VALUES
    ('SDAIA AI Grant 2025', 'منحة SDAIA للذكاء الاصطناعي 2025',
     'Up to SAR 500,000 for AI-driven startups in Saudi Arabia.',
     'حتى 500,000 ريال للشركات الناشئة في مجال الذكاء الاصطناعي.',
     'grant', '2025-03-31', true, 1),
    ('Athar Alumni Seed Round', 'جولة تمويل بذرية لخريجي أثر',
     'Internal investment round reserved for Athar alumni companies.',
     'جولة استثمار داخلية مخصصة لشركات خريجي أثر.',
     'investment', '2025-06-30', true, 2),
    ('Saudi Startup World Cup — Regional Qualifier', 'كأس العالم للشركات الناشئة — التصفيات الإقليمية',
     'Compete for USD 1M prize and global exposure.',
     'تنافس على جائزة مليون دولار والانتشار العالمي.',
     'competition', '2025-02-28', true, 3)
  ON CONFLICT DO NOTHING;

  -- ─── 8. CERTIFICATES ─────────────────────────────────────
  INSERT INTO certificates (founder_id, program_id, issued_by, issue_date) VALUES
    (v_sara,   v_prog1, 'Athar', '2023-07-10'),
    (v_khalid, v_prog1, 'Athar', '2023-07-10'),
    (v_reem,   v_prog3, 'Athar', '2023-10-05'),
    (v_noura,  v_prog1, 'Athar', '2023-07-10'),
    (v_omar,   v_prog1, 'Athar', '2023-07-10')
  ON CONFLICT DO NOTHING;

END ;
