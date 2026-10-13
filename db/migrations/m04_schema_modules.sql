-- m04_schema_modules  (05 phase 2; design 04 sections 3.9-3.13 + app_private.google_connections of 3.14)
-- agenda, library, landing, analytics, distribution, booking, certificates.
-- Leaf tables carry (project_id, parent_id) composite foreign keys to a parent that has UNIQUE (project_id, id),
-- so the database itself proves project agreement (04 2.3 "Project scoping").
set search_path = public, extensions;

begin;

-- ---------------------------------------------------------------- google_connections (needed by booking; rest of app_private is m05)
create table if not exists app_private.google_connections (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid references auth.users(id) on delete set null,       -- NULL = system sender
  kind           text not null check (kind in ('user','system')),
  email          citext not null unique,
  scopes         text[] not null,
  vault_secret_id uuid not null,                                           -- soft reference to vault.secrets (separate extension schema)
  status         text not null default 'active' check (status in ('active','needs_reauth','revoked')),
  last_ok_at     timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);
create index if not exists google_connections_owner_idx on app_private.google_connections (owner_user_id) where owner_user_id is not null;

-- ---------------------------------------------------------------- 3.11 agenda
create table if not exists public.agenda_days (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  node_id    uuid not null,
  sort_order smallint not null,
  day_date   date,
  name_en    text, name_ar text,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  unique (project_id, id),
  unique (node_id, sort_order) deferrable initially deferred
);

create table if not exists public.agenda_slots (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  day_id            uuid not null,
  sort_order        smallint not null,
  start_time        time not null,
  end_time          time not null,
  title_en          text, title_ar text,
  presenter_en      text, presenter_ar text,
  presenter_item_id uuid references public.list_items(id) on delete set null,
  show_presenter    boolean not null default true,
  bullets           jsonb not null default '[]' check (octet_length(bullets::text) <= 4096),
  foreign key (project_id, day_id) references public.agenda_days (project_id, id) on delete cascade,
  constraint agenda_slots_time_chk check (end_time > start_time)
);
create index if not exists agenda_slots_day_idx on public.agenda_slots (day_id, sort_order);
create index if not exists agenda_slots_presenter_idx on public.agenda_slots (presenter_item_id) where presenter_item_id is not null;

-- ---------------------------------------------------------------- resource library
create table if not exists public.resources (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid,                       -- NULL project and node = central pool
  node_id    uuid,
  title_en   text, title_ar text,
  type       text not null check (type in ('readable','audible','visual','link')),
  url        text,
  file_path  text,
  mime       text,
  bytes      integer,
  sort_order integer,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  constraint resources_scope_chk check ((project_id is null) = (node_id is null)),
  constraint resources_source_chk check (url is not null or file_path is not null),
  constraint resources_title_chk check (title_en is not null or title_ar is not null)
);
create index if not exists resources_node_idx on public.resources (node_id, sort_order) where deleted_at is null;
create index if not exists resources_type_idx on public.resources (type);

create table if not exists public.library_selections (
  node_id     uuid not null,
  resource_id uuid not null references public.resources(id) on delete cascade,
  project_id  uuid not null,
  sort_order  integer,
  primary key (node_id, resource_id),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create index if not exists library_selections_resource_idx on public.library_selections (resource_id);

-- ---------------------------------------------------------------- landing page
create table if not exists public.landing_cards (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null,
  node_id         uuid not null,
  sort_order      integer not null default 0,
  cover_path      text,
  chip_label_en   text, chip_label_ar text,
  title_en        text, title_ar text,
  body_en         text, body_ar text,
  see_more_lines  smallint,
  cta_label_en    text, cta_label_ar text,
  cta_url         text,
  cta_node_id     uuid,
  cta_dot         boolean not null default false,
  share_enabled   boolean not null default false,
  share_url       text,
  share_node_id   uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (project_id, node_id)       references public.nodes (project_id, id) on delete cascade,
  foreign key (project_id, cta_node_id)   references public.nodes (project_id, id) on delete set null (cta_node_id),
  foreign key (project_id, share_node_id) references public.nodes (project_id, id) on delete set null (share_node_id),
  constraint landing_cards_cta_chk   check (cta_url   is null or cta_node_id   is null),
  constraint landing_cards_share_chk check (share_url is null or share_node_id is null),
  unique (project_id, id)
);
create index if not exists landing_cards_node_idx on public.landing_cards (node_id, sort_order);
create index if not exists landing_cards_cta_node_idx on public.landing_cards (cta_node_id) where cta_node_id is not null;
create index if not exists landing_cards_share_node_idx on public.landing_cards (share_node_id) where share_node_id is not null;

create table if not exists public.landing_share_presets (
  card_id    uuid not null,
  platform   text not null check (platform in ('whatsapp','facebook','linkedin','instagram','telegram','x','copy')),
  project_id uuid not null,
  body       text not null,
  primary key (card_id, platform),
  foreign key (project_id, card_id) references public.landing_cards (project_id, id) on delete cascade
);

create table if not exists public.landing_frames (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  node_id      uuid not null,
  name         text,
  image_path   text not null,
  aspect       text not null default '4:5',
  window_x     smallint, window_y smallint, window_w smallint, window_h smallint,
  window_shape text not null default 'rect' check (window_shape in ('rect','circle')),
  sort_order   integer not null default 0,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create index if not exists landing_frames_node_idx on public.landing_frames (node_id, sort_order);

-- ---------------------------------------------------------------- 3.12 analytics
create table if not exists public.node_events (
  id         bigint generated always as identity primary key,
  project_id uuid not null,
  node_id    uuid not null,
  event_type text not null check (event_type in ('tab_view','card_share','share_copy','cta_click','image_upload','image_download','form_share','form_view')),
  card_id    uuid references public.landing_cards(id) on delete set null,
  platform   text,
  created_at timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create index if not exists node_events_node_idx on public.node_events (node_id, created_at desc);
create index if not exists node_events_card_idx on public.node_events (card_id) where card_id is not null;

-- ---------------------------------------------------------------- 3.10 distribution
create table if not exists public.distributions (
  node_id           uuid primary key,
  node_type         text not null default 'distribution' check (node_type = 'distribution'),
  project_id        uuid not null,
  slot_duration_min smallint not null default 20 check (slot_duration_min > 0),
  gap_min           smallint not null default 5 check (gap_min >= 0),
  start_time        time not null default '10:00',
  unique_pairing    boolean not null default true,
  is_published      boolean not null default false,
  published_at      timestamptz,
  seed              bigint,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (node_id, node_type)  references public.nodes (id, type)       on delete cascade
);
create index if not exists distributions_project_idx on public.distributions (project_id);

create table if not exists public.distribution_days (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  node_id           uuid not null,
  day_index         smallint not null,
  agenda_day_id     uuid,
  day_date          date,
  start_time        time,
  total_round_min   smallint,
  slot_duration_min smallint,
  gap_min           smallint,
  is_locked         boolean not null default false,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (project_id, agenda_day_id) references public.agenda_days (project_id, id) on delete set null (agenda_day_id),
  unique (node_id, day_index),
  unique (project_id, id),
  constraint distribution_days_date_chk check (agenda_day_id is null or day_date is null)
);
create index if not exists distribution_days_agenda_day_idx on public.distribution_days (agenda_day_id) where agenda_day_id is not null;

create table if not exists public.distribution_day_mentors (
  day_id         uuid not null,
  mentor_item_id uuid not null references public.list_items(id) on delete cascade,
  project_id     uuid not null,
  primary key (day_id, mentor_item_id),
  foreign key (project_id, day_id) references public.distribution_days (project_id, id) on delete cascade
);
create index if not exists distribution_day_mentors_item_idx on public.distribution_day_mentors (mentor_item_id);

create table if not exists public.distribution_mentor_rules (
  node_id        uuid not null,
  mentor_item_id uuid not null references public.list_items(id) on delete cascade,
  project_id     uuid not null,
  days           smallint[],
  max_slots      smallint,
  available_from time,
  available_to   time,
  primary key (node_id, mentor_item_id),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create index if not exists distribution_mentor_rules_item_idx on public.distribution_mentor_rules (mentor_item_id);

create table if not exists public.distribution_sessions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null,
  node_id            uuid not null,
  day_id             uuid not null,
  slot_index         smallint not null,
  mentor_item_id     uuid not null references public.list_items(id) on delete restrict,
  company_item_id    uuid references public.list_items(id) on delete restrict,
  is_manual_override boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (project_id, day_id)  references public.distribution_days (project_id, id) on delete cascade,
  unique (day_id, slot_index, mentor_item_id)
);
create unique index if not exists distribution_sessions_company_slot_key
  on public.distribution_sessions (day_id, slot_index, company_item_id) where company_item_id is not null;
create index if not exists distribution_sessions_node_idx    on public.distribution_sessions (node_id, day_id, slot_index);
create index if not exists distribution_sessions_company_idx on public.distribution_sessions (company_item_id);
create index if not exists distribution_sessions_mentor_idx  on public.distribution_sessions (mentor_item_id);

-- ---------------------------------------------------------------- 3.9 booking
create table if not exists public.booking_settings (
  node_id            uuid primary key,
  node_type          text not null default 'booking' check (node_type = 'booking'),
  project_id         uuid not null,
  mode               text not null check (mode in ('mentor','interview')),
  default_advance_notice_min integer not null default 1440 check (default_advance_notice_min >= 0),
  meeting_link_mode  text not null default 'unique' check (meeting_link_mode in ('unique','shared')),
  shared_meet_link   text,
  organizer_connection_id uuid references app_private.google_connections(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  foreign key (node_id, node_type)  references public.nodes (id, type)       on delete cascade,
  constraint booking_settings_shared_chk check (meeting_link_mode <> 'shared' or shared_meet_link is not null)
);
create index if not exists booking_settings_project_idx on public.booking_settings (project_id);
create index if not exists booking_settings_connection_idx on public.booking_settings (organizer_connection_id) where organizer_connection_id is not null;

create table if not exists public.booking_providers (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  node_id           uuid not null,
  list_item_id      uuid not null references public.list_items(id) on delete restrict,
  advance_notice_min integer check (advance_notice_min >= 0),
  booking_email     citext,
  is_active         boolean not null default true,
  sort_order        integer,
  created_at        timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  unique (node_id, list_item_id),
  unique (project_id, id)
);
create index if not exists booking_providers_item_idx on public.booking_providers (list_item_id);

create table if not exists public.booking_slots (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  node_id     uuid not null,
  provider_id uuid not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  is_blocked  boolean not null default false,
  created_at  timestamptz not null default now(),
  foreign key (project_id, node_id)     references public.nodes (project_id, id) on delete cascade,
  foreign key (project_id, provider_id) references public.booking_providers (project_id, id) on delete restrict,
  constraint booking_slots_time_chk check (ends_at > starts_at),
  constraint booking_slots_no_overlap exclude using gist (provider_id with =, tstzrange(starts_at, ends_at) with &&),
  unique (project_id, id)
);
create index if not exists booking_slots_open_idx on public.booking_slots (node_id, starts_at) where not is_blocked;
create index if not exists booking_slots_provider_idx on public.booking_slots (provider_id, starts_at);

create table if not exists public.booking_invitations (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null,
  node_id        uuid not null,
  booker_item_id uuid not null references public.list_items(id) on delete cascade,
  token_hash     text not null unique,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade
);
create unique index if not exists booking_invitations_active_key on public.booking_invitations (node_id, booker_item_id) where revoked_at is null;
create index if not exists booking_invitations_item_idx on public.booking_invitations (booker_item_id);

create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null,
  node_id          uuid not null,
  slot_id          uuid not null,
  status           text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  booker_email     citext not null,
  booker_name      text,
  booker_item_id   uuid references public.list_items(id) on delete set null,
  booker_company_id uuid references public.companies(id) on delete set null,
  booker_company_name text,
  invitation_id    uuid references public.booking_invitations(id) on delete set null,
  meet_link        text,
  legacy_calendar_event_id text,
  calendar_event_id text generated always as (coalesce(legacy_calendar_event_id, replace(id::text, '-', ''))) stored,
  calendar_owner_connection_id uuid references app_private.google_connections(id) on delete set null,
  cancelled_at     timestamptz,
  cancelled_by     uuid references auth.users(id) on delete set null,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete restrict,
  foreign key (project_id, slot_id) references public.booking_slots (project_id, id) on delete restrict
);
create unique index if not exists bookings_one_confirmed_per_slot on public.bookings (slot_id) where status = 'confirmed';
create index if not exists bookings_node_idx    on public.bookings (node_id, created_at desc);
create index if not exists bookings_email_idx   on public.bookings (booker_email);
create index if not exists bookings_item_idx    on public.bookings (booker_item_id) where booker_item_id is not null;
create index if not exists bookings_company_idx on public.bookings (booker_company_id) where booker_company_id is not null;
create index if not exists bookings_invitation_idx on public.bookings (invitation_id) where invitation_id is not null;
create index if not exists bookings_connection_idx on public.bookings (calendar_owner_connection_id) where calendar_owner_connection_id is not null;

-- ---------------------------------------------------------------- 3.13 certificates
create table if not exists public.certificate_templates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  node_id    uuid not null,
  version    integer not null,
  language   text not null check (language in ('ar','en')),
  file_path  text not null,
  file_kind  text not null check (file_kind in ('image','pdf')),
  width_px   integer, height_px integer,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  unique (node_id, language, version),
  unique (project_id, id)
);

create table if not exists public.certificate_template_fields (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  project_id  uuid not null,
  var         text not null check (var in ('participant_name','company_name','program_name','project_name','issue_date','completion_date','verification_code','verification_qr')),
  x numeric(6,5) not null check (x between 0 and 1),
  y numeric(6,5) not null check (y between 0 and 1),
  w numeric(6,5) not null check (w between 0 and 1),
  align       text not null default 'center' check (align in ('left','center','right')),
  font        text,
  size        numeric(6,5) check (size between 0 and 1),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  weight      smallint,
  direction   text not null default 'auto' check (direction in ('auto','ltr','rtl')),
  max_lines   smallint,
  shrink_to_fit boolean not null default false,
  foreign key (project_id, template_id) references public.certificate_templates (project_id, id) on delete cascade,
  unique (template_id, var)
);

create table if not exists public.certificates (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null,
  node_id        uuid not null,
  participant_id uuid not null references public.participants(id) on delete restrict,
  template_id    uuid not null references public.certificate_templates(id) on delete restrict,
  code           text not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$'),
  snapshot       jsonb not null check (octet_length(snapshot::text) <= 4096),
  issued_at      timestamptz not null default now(),
  issued_by      uuid references auth.users(id) on delete set null,
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id) on delete set null,
  revoked_reason text,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete restrict,
  unique (node_id, participant_id)
);
create index if not exists certificates_participant_idx on public.certificates (participant_id);
create index if not exists certificates_template_idx    on public.certificates (template_id);

commit;
