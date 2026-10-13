-- m02_schema_identity_structure_graph  (05 phase 2; design 04 sections 3.1-3.4)
-- roles, user_roles, profiles, programs, projects, memberships, node_types (seeded), nodes, node_revisions, edges,
-- public_links, public_link_slugs.  Tables only: triggers/functions are in m06, RLS/grants in m07.
-- Idempotent (CREATE ... IF NOT EXISTS; seeds are UPSERTs).
set search_path = public, extensions;

begin;

-- ---------------------------------------------------------------- default privileges (03 8.1): nothing for anon/authenticated
-- (only "postgres"-owned objects can be altered from here; supabase_admin defaults are reported in MIGRATION-LOG.md)
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema app_private revoke execute on functions from public, anon;

-- ---------------------------------------------------------------- 3.1 identity
create table if not exists public.roles (
  key         text primary key,
  name_en     text not null,
  name_ar     text,
  description text,
  is_staff    boolean not null default false
);

create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_key   text not null references public.roles(key) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_key)
);
create index if not exists user_roles_role_user_idx on public.user_roles (role_key, user_id);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_path text,
  language    text not null default 'ar' check (language in ('ar','en')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- 3.3 programs and projects
create table if not exists public.programs (
  id             uuid primary key default gen_random_uuid(),
  name_en        text,
  name_ar        text,
  description_en text,
  description_ar text,
  program_type   text,
  year           smallint,
  cover_path     text,
  visibility     text not null default 'private' check (visibility in ('private','platform','public')),
  archived_at    timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint programs_name_chk check (name_en is not null or name_ar is not null)
);

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.programs(id) on delete restrict,
  name_en          text,
  name_ar          text,
  description_en   text,
  description_ar   text,
  cover_path       text,
  timezone         text not null default 'Africa/Cairo',
  location_en      text,
  location_ar      text,
  map_url          text check (map_url ~* '^https?://'),
  offline_days     smallint check (offline_days >= 0),
  transportation   text check (transportation in ('provided','self_arranged')),
  show_description boolean not null default false,
  show_details     boolean not null default false,
  visibility       text not null default 'private' check (visibility in ('private','platform','public')),
  completed_at     timestamptz,
  completed_by     uuid references auth.users(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_name_chk check (name_en is not null or name_ar is not null)
);
create index if not exists projects_program_idx on public.projects (program_id) where deleted_at is null;

-- ---------------------------------------------------------------- 3.2 memberships
create table if not exists public.program_members (
  program_id  uuid not null references public.programs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'manager' check (member_role in ('owner','manager')),
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (program_id, user_id)
);
create index if not exists program_members_user_idx on public.program_members (user_id, program_id);

create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'manager' check (member_role in ('owner','manager')),
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id, project_id);

-- ---------------------------------------------------------------- 3.4 the graph
create table if not exists public.node_types (
  key              text primary key,
  name_en          text not null,
  name_ar          text,
  category         text not null,
  latest_version   smallint not null default 1,
  is_singleton     boolean not null default false,
  is_system        boolean not null default false,
  ports            jsonb not null default '[]' check (octet_length(ports::text) <= 65536),
  config_schema    jsonb check (octet_length(config_schema::text) <= 65536),
  save_children_fn text
);

create table if not exists public.nodes (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  type                 text not null references public.node_types(key),
  type_version         smallint not null default 1,
  name_en              text,
  name_ar              text,
  config               jsonb not null default '{}' check (octet_length(config::text) <= 262144),
  visibility           text not null default 'private' check (visibility in ('private','platform','public')),
  show_to_participants boolean not null default false,
  position_x           double precision not null default 0,
  position_y           double precision not null default 0,
  is_system            boolean not null default false,
  deleted_at           timestamptz,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint nodes_name_chk check (name_en is not null or name_ar is not null),
  unique (project_id, id),
  unique (id, type)
);
create index if not exists nodes_project_type_idx on public.nodes (project_id, type) where deleted_at is null;
create index if not exists nodes_type_idx on public.nodes (type);

create table if not exists public.node_revisions (
  node_id    uuid primary key references public.nodes(id) on delete cascade,
  project_id uuid not null,
  rev        bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists node_revisions_project_idx on public.node_revisions (project_id);

create table if not exists public.edges (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  from_node_id uuid not null,
  from_port    text not null,
  to_node_id   uuid not null,
  to_port      text not null,
  family       text not null check (family in ('rows:form-response','rows:list-item','rows:participant','view','schedule','link')),
  is_enabled   boolean not null default true,
  audience     text not null default 'platform' check (audience in ('public','platform','participants','pms')),
  label_en     text,
  label_ar     text,
  order_index  integer not null default 0,
  filter       jsonb not null default '{}' check (octet_length(filter::text) <= 4096),
  created_at   timestamptz not null default now(),
  foreign key (project_id, from_node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (project_id, to_node_id)   references public.nodes (project_id, id) on delete cascade,
  check (from_node_id <> to_node_id),
  unique (from_node_id, from_port, to_node_id, to_port)
);
create index if not exists edges_to_idx      on public.edges (to_node_id, to_port, order_index);
create index if not exists edges_from_idx    on public.edges (from_node_id);
create index if not exists edges_project_idx on public.edges (project_id);

create table if not exists public.public_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  node_id     uuid,
  kind        text not null check (kind in ('project','agenda','form','landing','booking','view')),
  view_key    text,
  is_enabled  boolean not null default true,
  expires_at  timestamptz,
  legacy_ref  uuid unique,
  og_title_en text, og_title_ar text, og_description_en text, og_description_ar text, og_image_path text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  unique nulls not distinct (project_id, node_id, kind, view_key)
);
create index if not exists public_links_node_idx on public.public_links (node_id);

create table if not exists public.public_link_slugs (
  slug       text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  link_id    uuid not null references public.public_links(id) on delete cascade,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists public_link_slugs_current_key on public.public_link_slugs (link_id) where is_current;
create index if not exists public_link_slugs_link_idx on public.public_link_slugs (link_id);

-- ---------------------------------------------------------------- seed: roles (lookup; 05 phase 3 re-asserts it from legacy.roles)
insert into public.roles (key, name_en, name_ar, description, is_staff) values
  ('super_admin',     'Super Admin',     'مدير النظام',        'Platform owner: everything, including users and roles', true),
  ('project_manager', 'Project Manager', 'مدير مشروع',         'Creates programs; manages the programs/projects they are a member of', true),
  ('alumni_manager',  'Alumni Manager',  'مدير الخريجين',      'Runs the Alumni platform (also used for the M&E team for now)', true),
  ('founder',         'Founder',         'مؤسس',               'Founder of a startup in Athar programs', false),
  ('integration',     'Integration',     'حساب تكامل',         'Non-human account for server jobs (Apps Script poller bridge)', false)
on conflict (key) do update set name_en = excluded.name_en, name_ar = excluded.name_ar,
  description = excluded.description, is_staff = excluded.is_staff;

-- ---------------------------------------------------------------- seed: node_types (10 keys; 04 3.4, 02 2.2, 01)
-- ports: [{key, direction in|out, families[], kind (list-item subkind or null), cardinality one|many, required, label{en,ar}}]
insert into public.node_types (key, name_en, name_ar, category, latest_version, is_singleton, is_system, ports, config_schema, save_children_fn) values
('view_host','View page host','صفحة العرض','system',1,false,true,
 '[{"key":"tabs","direction":"in","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Tabs","ar":"التبويبات"}},
   {"key":"link","direction":"out","families":["link"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Link","ar":"الرابط"}}]',
 '{"type":"object"}', null),
('agenda','Agenda','الأجندة','content',1,false,false,
 '[{"key":"tabs","direction":"in","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Tabs","ar":"التبويبات"}},
   {"key":"participants","direction":"in","families":["rows:participant"],"kind":null,"cardinality":"one","required":false,"label":{"en":"Participants","ar":"المشاركون"}},
   {"key":"agenda","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Agenda tab","ar":"تبويب الأجندة"}},
   {"key":"schedule","direction":"out","families":["schedule"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Schedule","ar":"الجدول"}},
   {"key":"link","direction":"out","families":["link"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Link","ar":"الرابط"}}]',
 '{"type":"object"}', 'save_children_agenda'),
('form_builder','Form','نموذج','data',1,false,false,
 '[{"key":"responses","direction":"out","families":["rows:form-response"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Responses","ar":"الردود"}},
   {"key":"link","direction":"out","families":["link"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Link","ar":"الرابط"}}]',
 '{"type":"object"}', 'save_children_form_builder'),
('list','List','قائمة','data',1,false,false,
 '[{"key":"items-in","direction":"in","families":["rows:form-response","rows:list-item"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Items in","ar":"عناصر واردة"}},
   {"key":"items","direction":"out","families":["rows:list-item"],"kind":"subkind","cardinality":"many","required":false,"label":{"en":"Items","ar":"العناصر"}},
   {"key":"list-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"List tab","ar":"تبويب القائمة"}}]',
 '{"type":"object"}', null),
('selection','Selection process','عملية الاختيار','data',1,false,false,
 '[{"key":"applicants","direction":"in","families":["rows:form-response","rows:list-item"],"kind":null,"cardinality":"many","required":true,"label":{"en":"Applicants","ar":"المتقدمون"}},
   {"key":"approved","direction":"out","families":["rows:list-item"],"kind":"company","cardinality":"many","required":false,"label":{"en":"Approved","ar":"المقبولون"}},
   {"key":"rejected","direction":"out","families":["rows:list-item"],"kind":"company","cardinality":"many","required":false,"label":{"en":"Rejected","ar":"المرفوضون"}},
   {"key":"holding","direction":"out","families":["rows:list-item"],"kind":"company","cardinality":"many","required":false,"label":{"en":"Holding","ar":"قيد الانتظار"}},
   {"key":"interview","direction":"out","families":["rows:list-item"],"kind":"company","cardinality":"many","required":false,"label":{"en":"Interview","ar":"المقابلات"}},
   {"key":"all","direction":"out","families":["rows:list-item"],"kind":"company","cardinality":"many","required":false,"label":{"en":"All","ar":"الكل"}},
   {"key":"results-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Results tab","ar":"تبويب النتائج"}}]',
 '{"type":"object"}', null),
('booking','Booking','الحجز','operations',1,false,false,
 '[{"key":"mentors","direction":"in","families":["rows:list-item"],"kind":"expert","cardinality":"many","required":true,"label":{"en":"Providers","ar":"مقدمو الجلسات"}},
   {"key":"bookers","direction":"in","families":["rows:list-item"],"kind":"company","cardinality":"many","required":false,"label":{"en":"Invitees","ar":"المدعوون"}},
   {"key":"schedule","direction":"in","families":["schedule"],"kind":null,"cardinality":"one","required":false,"label":{"en":"Schedule","ar":"الجدول"}},
   {"key":"booking-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Booking tab","ar":"تبويب الحجز"}},
   {"key":"link","direction":"out","families":["link"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Link","ar":"الرابط"}}]',
 '{"type":"object"}', null),
('distribution','Mentoring distribution','توزيع المنتورينج','operations',1,false,false,
 '[{"key":"mentors","direction":"in","families":["rows:list-item"],"kind":"expert","cardinality":"many","required":true,"label":{"en":"Mentors","ar":"المنتورز"}},
   {"key":"companies","direction":"in","families":["rows:list-item"],"kind":"company","cardinality":"many","required":true,"label":{"en":"Companies","ar":"الشركات"}},
   {"key":"schedule","direction":"in","families":["schedule"],"kind":null,"cardinality":"one","required":false,"label":{"en":"Schedule","ar":"الجدول"}},
   {"key":"sessions-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Sessions tab","ar":"تبويب الجلسات"}},
   {"key":"my-meetings-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"My meetings tab","ar":"تبويب اجتماعاتي"}}]',
 '{"type":"object"}', null),
('library','Resource library','مكتبة الموارد','content',1,false,false,
 '[{"key":"library-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Library tab","ar":"تبويب المكتبة"}}]',
 '{"type":"object"}', null),
('landing_page','Landing page','صفحة الهبوط','content',1,false,false,
 '[{"key":"links","direction":"in","families":["link"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Links","ar":"الروابط"}},
   {"key":"landing-tab","direction":"out","families":["view"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Landing tab","ar":"تبويب الهبوط"}},
   {"key":"link","direction":"out","families":["link"],"kind":null,"cardinality":"many","required":false,"label":{"en":"Link","ar":"الرابط"}}]',
 '{"type":"object"}', 'save_children_landing_page'),
('certificates','Certificates','الشهادات','content',1,false,false,
 '[{"key":"participants","direction":"in","families":["rows:participant"],"kind":null,"cardinality":"one","required":true,"label":{"en":"Participants","ar":"المشاركون"}}]',
 '{"type":"object"}', null)
on conflict (key) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar, category = excluded.category,
  latest_version = excluded.latest_version, is_singleton = excluded.is_singleton, is_system = excluded.is_system,
  ports = excluded.ports, config_schema = excluded.config_schema, save_children_fn = excluded.save_children_fn;

commit;
