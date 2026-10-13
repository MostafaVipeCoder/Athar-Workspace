-- m05_schema_internal  (05 phase 2; design 04 section 3.14)
-- app_private worker tables: email_outbox, email_log, integration_jobs (google_connections is created in m04 because
-- booking references it).  No client policy and no client grant: service role / SECURITY DEFINER RPCs only.
set search_path = public, extensions;

begin;

create table if not exists app_private.email_outbox (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null,
  node_id              uuid not null,
  email_key            text not null,
  sender_connection_id uuid not null references app_private.google_connections(id) on delete restrict,
  recipient_email      citext not null,
  list_item_id         uuid references public.list_items(id)   on delete set null,
  booking_id           uuid references public.bookings(id)     on delete set null,
  participant_id       uuid references public.participants(id) on delete set null,
  subject              text,
  body_html            text,
  cc                   text[],
  idempotency_key      text not null unique,
  status               text not null default 'queued' check (status in ('queued','sending','sent','failed','dead','cancelled','needs_review')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  gmail_message_id     text,
  error_code           text,
  error_message        text,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  constraint email_outbox_recipient_ref_chk check (num_nonnulls(list_item_id, booking_id, participant_id) <= 1)
);
create index if not exists email_outbox_queue_idx  on app_private.email_outbox (next_attempt_at) where status = 'queued';
create index if not exists email_outbox_sender_idx on app_private.email_outbox (sender_connection_id, status);
create index if not exists email_outbox_item_idx   on app_private.email_outbox (node_id, list_item_id, email_key);
create index if not exists email_outbox_list_item_idx on app_private.email_outbox (list_item_id) where list_item_id is not null;
create index if not exists email_outbox_booking_idx on app_private.email_outbox (booking_id) where booking_id is not null;
create index if not exists email_outbox_participant_idx on app_private.email_outbox (participant_id) where participant_id is not null;

create table if not exists app_private.email_log (
  id         bigint generated always as identity primary key,
  outbox_id  uuid not null references app_private.email_outbox(id) on delete cascade,
  event      text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists email_log_outbox_idx on app_private.email_log (outbox_id);

create table if not exists app_private.integration_jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('calendar_create','calendar_update','calendar_cancel','sheets_append')),
  project_id      uuid not null references public.projects(id) on delete cascade,
  booking_id      uuid references public.bookings(id) on delete set null,
  form_response_id uuid references public.form_responses(id) on delete set null,
  connection_id   uuid references app_private.google_connections(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','processing','done','failed','dead')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  error           text,
  payload         jsonb not null default '{}' check (octet_length(payload::text) <= 16384),
  result          jsonb check (octet_length(result::text) <= 16384),
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists integration_jobs_queue_idx on app_private.integration_jobs (next_attempt_at) where status in ('pending','failed');
create index if not exists integration_jobs_project_idx on app_private.integration_jobs (project_id);
create index if not exists integration_jobs_booking_idx on app_private.integration_jobs (booking_id) where booking_id is not null;
create index if not exists integration_jobs_response_idx on app_private.integration_jobs (form_response_id) where form_response_id is not null;
create index if not exists integration_jobs_connection_idx on app_private.integration_jobs (connection_id) where connection_id is not null;

commit;
