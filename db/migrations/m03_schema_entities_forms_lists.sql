-- m03_schema_entities_forms_lists  (05 phase 2; design 04 sections 3.5-3.8 and 3.16)
-- network_experts, companies, founders, company_founders, field_semantics (seeded), form_covers, form_templates, forms,
-- form_sections, form_questions, form_responses, lists, list_items, selection_reviews, participants and the six
-- alumni-side tables kept as-is (alumni_invitations, notifications, opportunities, opportunity_applications,
-- investor_requests, company_snapshots).
set search_path = public, extensions;

begin;

-- ---------------------------------------------------------------- 3.6 entities
create table if not exists public.network_experts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'expert' check (kind in ('expert','team')),
  name_en     text, name_ar text,
  title_en    text, title_ar text,
  company_en  text, company_ar text,
  bio_en      text, bio_ar text,
  photo_path  text,
  linkedin_url text,
  email       citext,
  deleted_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint network_experts_name_chk check (name_en is not null or name_ar is not null)
);
create index if not exists network_experts_kind_idx on public.network_experts (kind) where deleted_at is null;
create index if not exists network_experts_name_trgm_idx on public.network_experts
  using gin (name_en gin_trgm_ops, name_ar gin_trgm_ops);

create table if not exists public.companies (
  id               uuid primary key default gen_random_uuid(),
  name_en          text, name_ar text,
  description_en   text, description_ar text,
  industry_en      text, industry_ar text,
  location_en      text, location_ar text,
  governorate_en   text, governorate_ar text,
  stage            text,
  employees        text,
  founding_year    smallint,
  logo_path        text,
  website_url      text,
  linkedin_url     text,
  links            jsonb not null default '[]' check (octet_length(links::text) <= 2048),
  is_alumni        boolean not null default false,
  origin_project_id uuid references public.projects(id) on delete set null,
  name_key         text generated always as (lower(btrim(coalesce(name_en, name_ar)))) stored,
  deleted_at       timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint companies_name_chk check (name_en is not null or name_ar is not null)
);
create index if not exists companies_name_key_idx on public.companies (name_key);
create index if not exists companies_alumni_idx on public.companies (is_alumni) where is_alumni;
create index if not exists companies_origin_project_idx on public.companies (origin_project_id);

create table if not exists public.founders (
  id           uuid primary key default gen_random_uuid(),
  name_ar      text not null,
  name_en      text,
  email        citext,
  phone        text,
  linkedin_url text,
  photo_path   text,
  bio_ar       text,
  bio_en       text,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists founders_email_key on public.founders (email) where email is not null;

create table if not exists public.company_founders (
  company_id uuid not null references public.companies(id) on delete cascade,
  founder_id uuid not null references public.founders(id) on delete cascade,
  role       text not null default 'founder',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (company_id, founder_id)
);
create index if not exists company_founders_founder_idx on public.company_founders (founder_id, company_id);

-- ---------------------------------------------------------------- 3.7 forms
create table if not exists public.field_semantics (
  key      text primary key,
  label_en text not null,
  label_ar text
);
insert into public.field_semantics (key, label_en, label_ar) values
  ('company_name',  'Company name',  'اسم الشركة'),
  ('founder_name',  'Founder name',  'اسم المؤسس'),
  ('founder_email', 'Founder email', 'البريد الإلكتروني للمؤسس'),
  ('phone',         'Phone',         'رقم الهاتف'),
  ('logo',          'Logo',          'الشعار'),
  ('bio',           'Bio / description', 'نبذة')
on conflict (key) do update set label_en = excluded.label_en, label_ar = excluded.label_ar;

create table if not exists public.form_covers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,    -- NULL = global library cover
  name       text,
  image_path text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists form_covers_project_idx on public.form_covers (project_id);

create table if not exists public.form_templates (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects(id) on delete cascade,  -- NULL = global template
  name_en        text, name_ar text,
  description_en text, description_ar text,
  definition     jsonb not null default '{}' check (octet_length(definition::text) <= 131072),
  schema_version smallint not null default 1,
  cover_id       uuid references public.form_covers(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint form_templates_name_chk check (name_en is not null or name_ar is not null)
);
create index if not exists form_templates_project_idx on public.form_templates (project_id);
create index if not exists form_templates_cover_idx on public.form_templates (cover_id);

create table if not exists public.forms (
  node_id        uuid primary key,
  node_type      text not null default 'form_builder' check (node_type = 'form_builder'),
  project_id     uuid not null,
  template_id    uuid references public.form_templates(id) on delete set null,
  cover_id       uuid references public.form_covers(id) on delete set null,
  is_active      boolean not null default true,
  opens_at       timestamptz,
  closes_at      timestamptz,
  max_responses  integer check (max_responses > 0),
  one_response_per_email boolean not null default false,
  export_sheet_id  text,
  export_sheet_tab text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (node_id, node_type)  references public.nodes (id, type)       on delete cascade,
  check (opens_at is null or closes_at is null or closes_at > opens_at)
);
create index if not exists forms_project_idx  on public.forms (project_id);
create index if not exists forms_template_idx on public.forms (template_id);
create index if not exists forms_cover_idx    on public.forms (cover_id);

create table if not exists public.form_sections (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null,
  node_id        uuid not null,
  title_en       text, title_ar text,
  description_en text, description_ar text,
  order_index    integer not null default 0,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create index if not exists form_sections_node_idx on public.form_sections (node_id, order_index);

create table if not exists public.form_questions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null,
  node_id        uuid not null,
  section_id     uuid references public.form_sections(id) on delete set null,
  key            text not null,
  type           text not null check (type in ('text','textarea','email','tel','number','url','select','multiselect','file','hidden','date')),
  semantic       text references public.field_semantics(key),
  label_en       text, label_ar text,
  description_en text, description_ar text,
  placeholder_en text, placeholder_ar text,
  is_required    boolean not null default false,
  options        jsonb check (octet_length(options::text) <= 32768),
  validation     jsonb check (octet_length(validation::text) <= 4096),
  order_index    integer not null default 0,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  constraint form_questions_semantic_key_chk check (semantic is null or key = semantic),
  unique (node_id, key)
);
create unique index if not exists form_questions_semantic_key on public.form_questions (node_id, semantic) where semantic is not null;
create index if not exists form_questions_order_idx   on public.form_questions (node_id, order_index);
create index if not exists form_questions_section_idx on public.form_questions (section_id);
create index if not exists form_questions_semantic_idx on public.form_questions (semantic) where semantic is not null;

create table if not exists public.form_responses (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  node_id      uuid not null,
  answers      jsonb not null default '{}' check (octet_length(answers::text) <= 65536),
  source       text,
  tracking     jsonb not null default '{}' check (octet_length(tracking::text) <= 2048),
  external_key text,
  status       text not null default 'submitted' check (status in ('submitted','reviewed','spam')),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create index if not exists form_responses_node_idx on public.form_responses (node_id, submitted_at desc, id) where deleted_at is null;
create unique index if not exists form_responses_external_key on public.form_responses (node_id, external_key) where external_key is not null;
create index if not exists form_responses_submitter_idx on public.form_responses (submitted_by) where submitted_by is not null;

-- ---------------------------------------------------------------- 3.5 lists
create table if not exists public.lists (
  node_id    uuid primary key,
  node_type  text not null default 'list' check (node_type = 'list'),
  project_id uuid not null,
  subkind    text not null check (subkind in ('company','expert','generic')),
  created_at timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (node_id, node_type)  references public.nodes (id, type)       on delete cascade
);
create index if not exists lists_project_idx on public.lists (project_id);

create table if not exists public.list_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  list_node_id      uuid not null,
  source_kind       text check (source_kind in ('form_response','network_expert','company')),
  form_response_id  uuid references public.form_responses(id)  on delete set null,
  network_expert_id uuid references public.network_experts(id) on delete set null,
  company_id        uuid references public.companies(id)       on delete set null,
  source_label      text,
  manual_fields     jsonb check (octet_length(manual_fields::text) <= 8192),
  status            text,
  sort_order        integer,
  excluded          boolean not null default false,
  overlay           jsonb not null default '{}' check (octet_length(overlay::text) <= 16384),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (project_id, list_node_id) references public.nodes (project_id, id) on delete cascade,
  check (num_nonnulls(form_response_id, network_expert_id, company_id) <= 1),
  check ((source_kind is null and manual_fields is not null) or (source_kind is not null and manual_fields is null)),
  check (form_response_id  is null or source_kind = 'form_response'),
  check (network_expert_id is null or source_kind = 'network_expert'),
  check (company_id        is null or source_kind = 'company')
);
create unique index if not exists list_items_resp_key    on public.list_items (list_node_id, form_response_id)  where form_response_id is not null;
create unique index if not exists list_items_expert_key  on public.list_items (list_node_id, network_expert_id) where network_expert_id is not null;
create unique index if not exists list_items_company_key on public.list_items (list_node_id, company_id)        where company_id is not null;
create index if not exists list_items_order_idx   on public.list_items (list_node_id, sort_order, id);
create index if not exists list_items_status_idx  on public.list_items (list_node_id, status);
create index if not exists list_items_resp_idx    on public.list_items (form_response_id)  where form_response_id is not null;
create index if not exists list_items_expert_idx  on public.list_items (network_expert_id) where network_expert_id is not null;
create index if not exists list_items_company_idx on public.list_items (company_id)        where company_id is not null;

create table if not exists public.selection_reviews (
  item_id      uuid primary key references public.list_items(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  reason       text,
  origin_stage text,
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users(id) on delete set null
);
create index if not exists selection_reviews_project_idx on public.selection_reviews (project_id);

-- ---------------------------------------------------------------- 3.8 participants
create table if not exists public.participants (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  company_id              uuid references public.companies(id) on delete restrict,
  user_id                 uuid references auth.users(id) on delete set null,
  form_response_id        uuid references public.form_responses(id) on delete set null,
  source                  text not null check (source in ('manual','selection')),
  source_node_id          uuid,
  status                  text not null default 'accepted' check (status in ('accepted','attended','withdrawn')),
  status_changed_at       timestamptz,
  status_changed_by       uuid references auth.users(id) on delete set null,
  needs_review            boolean not null default false,
  withdrawal_requested_at timestamptz,
  notes                   text,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (project_id, source_node_id) references public.nodes (project_id, id) on delete set null (source_node_id),
  check (company_id is not null or user_id is not null or form_response_id is not null)
);
create unique index if not exists participants_company_key  on public.participants (project_id, company_id)       where company_id is not null;
create unique index if not exists participants_user_key     on public.participants (project_id, user_id)          where user_id is not null;
create unique index if not exists participants_response_key on public.participants (project_id, form_response_id) where form_response_id is not null;
create index if not exists participants_user_idx     on public.participants (user_id)    where user_id is not null;
create index if not exists participants_company_idx  on public.participants (company_id) where company_id is not null;
create index if not exists participants_status_idx   on public.participants (project_id, status);
create index if not exists participants_response_idx on public.participants (form_response_id) where form_response_id is not null;
create index if not exists participants_source_node_idx on public.participants (source_node_id) where source_node_id is not null;

-- ---------------------------------------------------------------- 3.16 alumni side (kept as-is; only the fixes listed in 04)
-- alumni_invitations.token stores the sha256 hex of the token (03 4.4 rule 7); the clear token is never stored.
create table if not exists public.alumni_invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  founder_email text not null,
  token        text not null unique,
  status       text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  sent_at      timestamptz not null default now(),
  accepted_at  timestamptz,
  sent_by      uuid,
  created_at   timestamptz not null default now(),
  founder_id   uuid references public.founders(id) on delete set null
);
create index if not exists alumni_invitations_company_idx on public.alumni_invitations (company_id);
create index if not exists alumni_invitations_founder_idx on public.alumni_invitations (founder_id);
create index if not exists alumni_invitations_status_idx  on public.alumni_invitations (status);
create index if not exists alumni_invitations_created_idx on public.alumni_invitations (created_at desc);

create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  recipient_id     uuid references auth.users(id) on delete cascade,
  founder_id       uuid references public.founders(id) on delete cascade,
  title            text not null,
  body             text not null,
  is_read          boolean not null default false,
  created_at       timestamptz not null default now(),
  sent_by          uuid references auth.users(id) on delete set null,
  audience_type    text default 'founder',
  audience_target_id uuid,
  broadcast_id     uuid,
  metadata         jsonb not null default '{}'
);
create index if not exists notifications_recipient_idx  on public.notifications (recipient_id);
create index if not exists notifications_founder_idx    on public.notifications (founder_id);
create index if not exists notifications_broadcast_idx  on public.notifications (broadcast_id);
create index if not exists notifications_created_idx    on public.notifications (created_at desc);

create table if not exists public.opportunities (
  opportunity_id uuid primary key default gen_random_uuid(),
  type           text not null default 'grant',
  title_ar       text not null,
  title_en       text,
  description_ar text,
  description_en text,
  deadline       date,
  eligibility    text,
  link           text,
  image_url      text,
  is_active      boolean not null default true,
  order_index    integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists opportunities_active_idx   on public.opportunities (is_active);
create index if not exists opportunities_deadline_idx on public.opportunities (deadline);
create index if not exists opportunities_type_idx     on public.opportunities (type);

create table if not exists public.opportunity_applications (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(opportunity_id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  founder_id     uuid references public.founders(id) on delete set null,
  status         text default 'applied',
  notes          text,
  applied_at     timestamptz not null default now(),
  unique (opportunity_id, company_id)
);
create index if not exists opportunity_applications_company_idx on public.opportunity_applications (company_id);
create index if not exists opportunity_applications_founder_idx on public.opportunity_applications (founder_id);

create table if not exists public.investor_requests (
  id              uuid primary key default gen_random_uuid(),
  requester_name  text not null,
  requester_email text not null,
  requester_org   text,
  company_id      uuid references public.companies(id) on delete set null,
  request_type    text default 'data_room',
  message         text,
  status          text default 'pending',
  created_at      timestamptz not null default now()
);
create index if not exists investor_requests_company_idx on public.investor_requests (company_id);
create index if not exists investor_requests_status_idx  on public.investor_requests (status);

create table if not exists public.company_snapshots (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  snapshot_type    text not null,
  snapshot_date    date not null default current_date,
  source           text not null default 'founder',
  data             jsonb not null default '{}',
  form_response_id uuid references public.form_responses(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists company_snapshots_company_date_idx on public.company_snapshots (company_id, snapshot_date desc);
create index if not exists company_snapshots_type_idx on public.company_snapshots (snapshot_type);
create index if not exists company_snapshots_response_idx on public.company_snapshots (form_response_id) where form_response_id is not null;

commit;
