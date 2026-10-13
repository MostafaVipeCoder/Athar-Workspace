-- m10_load_reference_programs  (05 phase 3 + phase 4 part 1; STAGE 2a, LOCAL ONLY)
-- 1) loader helper functions (run bookkeeping, checks, flags, asset registration) used by m10..m90
-- 2) roles (seed re-asserted), programs (+ Legacy program), projects
-- Re-runnable: every insert is ON CONFLICT DO NOTHING, helpers are CREATE OR REPLACE.
-- Reads only legacy.*; never reads a secret column (google_settings.service_account_key, smtp_settings.smtp_pass).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;

-- ================================================================= bookkeeping extensions (all in schema migration)
alter table migration.asset_map add column if not exists source     text;      -- 'bucket' | 'external' | 'static'
alter table migration.asset_map add column if not exists project_id uuid;
alter table migration.asset_map add column if not exists note       text;

create table if not exists migration.asset_refs (
  ref_table  text not null,
  ref_id     text not null,
  ref_column text not null,
  old_path   text not null references migration.asset_map(old_path) on delete cascade,
  new_path   text,
  kind       text not null,
  project_id uuid,
  primary key (ref_table, ref_id, ref_column)
);
create index if not exists asset_refs_old_path_idx on migration.asset_refs (old_path);

create table if not exists migration.company_merges (
  keep_id    uuid not null,
  drop_id    uuid primary key,
  keep_name  text,
  drop_name  text,
  kind       text not null check (kind in ('exact','probable')),
  result     jsonb,
  merged_at  timestamptz not null default now()
);

create table if not exists migration.email_template_defaults (
  node_type  text not null,
  email_key  text not null,
  subject    text,
  body_html  text,
  used_by_events integer not null,
  note       text,
  primary key (node_type, email_key)
);
revoke all on all tables in schema migration from public, anon, authenticated;

-- ================================================================= helper functions
create or replace function migration.begin_run(p_phase text) returns bigint
language sql volatile set search_path = '' as $$
  insert into migration.run(phase, status) values (p_phase, 'running') returning id
$$;

create or replace function migration.finish_run(p_run bigint, p_note text default null) returns void
language plpgsql volatile set search_path = '' as $$
begin
  update migration.run set finished_at = now(),
         status = case when exists (select 1 from migration.recon r where r.run_id = p_run and r.status = 'mismatch') then 'mismatch' else 'ok' end,
         note = p_note where id = p_run;
end $$;

-- hard check: records the row and RAISES on mismatch (the phase transaction then rolls back)
create or replace function migration.check(p_run bigint, p_key text, p_expected text, p_actual text, p_detail jsonb default null) returns void
language plpgsql volatile set search_path = '' as $$
begin
  insert into migration.recon(run_id, check_key, expected, actual, status, detail)
  values (p_run, p_key, p_expected, p_actual, case when p_expected is not distinct from p_actual then 'ok' else 'mismatch' end, p_detail)
  on conflict (run_id, check_key) do update set expected = excluded.expected, actual = excluded.actual, status = excluded.status, detail = excluded.detail;
  if p_expected is distinct from p_actual then
    raise exception 'CHECK FAILED % : expected % but got %', p_key, p_expected, p_actual using errcode = 'P0001';
  end if;
end $$;

-- soft check against the number printed in the design document (05 section 6.2): mismatch is a WARN, never an abort
create or replace function migration.check_design(p_run bigint, p_key text, p_design text, p_actual text, p_detail jsonb default null) returns void
language plpgsql volatile set search_path = '' as $$
begin
  insert into migration.recon(run_id, check_key, expected, actual, status, detail)
  values (p_run, p_key, p_design, p_actual, case when p_design is not distinct from p_actual then 'ok' else 'warn' end, p_detail)
  on conflict (run_id, check_key) do update set expected = excluded.expected, actual = excluded.actual, status = excluded.status, detail = excluded.detail;
end $$;

create or replace function migration.flag(p_code text, p_severity text, p_entity text, p_ref text, p_msg text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  if exists (select 1 from migration.flags f where f.code = p_code and f.entity is not distinct from p_entity and f.ref_id is not distinct from p_ref) then
    -- re-run: refresh the text of a still-open flag (a resolved flag keeps its history untouched)
    update migration.flags f set severity = p_severity, message = p_msg
     where f.code = p_code and f.entity is not distinct from p_entity and f.ref_id is not distinct from p_ref and f.resolved_at is null;
  else
    insert into migration.flags(code, severity, entity, ref_id, message) values (p_code, p_severity, p_entity, p_ref, p_msg);
  end if;
end $$;

-- latest run per phase: the recon rows of the most recent run of every phase
create or replace view migration.v_recon_latest as
select r.phase, c.run_id, c.check_key, c.expected, c.actual, c.status, c.detail
from migration.recon c join migration.run r on r.id = c.run_id
where r.id = (select max(r2.id) from migration.run r2 where r2.phase = r.phase and r2.status in ('ok','mismatch'));

-- registers an image/file reference, returns the target storage path that the loader writes into the *_path column.
-- NOTHING is copied or downloaded here (stage 2b does the file work from migration.asset_map WHERE status = 'pending').
-- Deterministic: path = <project|global>/<kind>/<uuidv5(old_path)>.<ext>; an object shared by several rows keeps the path of the first
-- registration (loaders run in a fixed order), so a re-run yields the same path.
create or replace function migration.register_asset(p_kind text, p_project uuid, p_url text,
                                                    p_ref_table text, p_ref_id text, p_ref_col text) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare v_url text; v_old text; v_src text; v_bucket text; v_ext text; v_scope text; v_new text; v_bytes bigint;
begin
  if p_url is null or btrim(p_url) = '' then return null; end if;
  v_url := btrim(p_url);
  if v_url like '%/storage/v1/object/public/event-assets/%' then
    v_src := 'bucket';
    v_old := split_part(substring(v_url from '/storage/v1/object/public/event-assets/(.*)$'), '?', 1);
  elsif v_url ~* '^https?://' then
    v_src := 'external'; v_old := v_url;
  else
    insert into migration.asset_map(old_path, bucket, new_path, kind, status, source, project_id, note)
    values (v_url, null, null, p_kind, 'skipped_static', 'static', p_project, 'app-relative path, not a storage object')
    on conflict (old_path) do nothing;
    insert into migration.asset_refs(ref_table, ref_id, ref_column, old_path, new_path, kind, project_id)
    values (p_ref_table, p_ref_id, p_ref_col, v_url, null, p_kind, p_project) on conflict do nothing;
    return null;
  end if;
  v_bucket := case when p_kind = 'resource' then 'resources' else 'public-assets' end;
  v_ext := lower(coalesce(substring(split_part(v_old, '?', 1) from '\.([A-Za-z0-9]{2,5})$'), ''));
  v_ext := case when v_ext = 'pdf' then 'pdf'
                when p_kind = 'resource' and v_ext <> '' then v_ext
                else 'webp' end;
  v_scope := case when p_kind in ('expert-photo','company-logo') or p_project is null then 'global' else p_project::text end;
  v_new := v_scope || '/' || p_kind || '/' || migration.nid('asset:' || v_old)::text || '.' || v_ext;
  if v_src = 'bucket' then
    select nullif(o.metadata->>'size','')::bigint into v_bytes from storage.objects o where o.bucket_id = 'event-assets' and o.name = v_old;
  end if;
  insert into migration.asset_map(old_path, bucket, new_path, kind, bytes, status, source, project_id)
  values (v_old, v_bucket, v_new, p_kind, v_bytes, 'pending', v_src, p_project)
  on conflict (old_path) do nothing;
  select m.new_path into v_new from migration.asset_map m where m.old_path = v_old;
  insert into migration.asset_refs(ref_table, ref_id, ref_column, old_path, new_path, kind, project_id)
  values (p_ref_table, p_ref_id, p_ref_col, v_old, v_new, p_kind, p_project) on conflict do nothing;
  return v_new;
end $$;

-- ================================================================= run
create temp table _r on commit drop as select migration.begin_run('m10_load_reference_programs') as id;
\o /dev/null

-- ---------------------------------------------------------------- roles: seed from m02 stays authoritative (names differ slightly from legacy.roles, nothing is lost)
insert into public.roles (key, name_en, name_ar, description, is_staff)
select r.key, r.name_en, r.name_ar, r.description, r.key in ('super_admin','project_manager','alumni_manager')
from legacy.roles r
on conflict (key) do nothing;
insert into public.roles (key, name_en, name_ar, is_staff) values ('integration','Integration','حساب تكامل', false) on conflict (key) do nothing;

-- ---------------------------------------------------------------- programs (+ the Legacy program for events without a program)
insert into public.programs (id, name_en, name_ar, description_en, program_type, year, visibility, created_at, updated_at)
select p.program_id, p.name, nullif(btrim(p.name_ar),''), nullif(btrim(p.description),''), p.program_type, p.year, 'private', p.created_at, p.updated_at
from legacy.programs p
on conflict (id) do nothing;

insert into public.programs (id, name_en, name_ar, description_en, visibility, created_at, updated_at)
select migration.nid('program:legacy'), 'Legacy projects', null, 'Projects migrated without a program (owner may assign them to real programs later)', 'private',
       (select min(created_at) from legacy.events), (select min(created_at) from legacy.events)
where exists (select 1 from legacy.events where program_id is null)
on conflict (id) do nothing;
insert into migration.id_map(entity, old_id, new_id, note)
select 'program', 'legacy', migration.nid('program:legacy'), 'invented Legacy program (04-3)'
where exists (select 1 from legacy.events where program_id is null)
on conflict do nothing;

-- ---------------------------------------------------------------- projects (id preserved = old event_id)
insert into public.projects (id, program_id, name_en, name_ar, cover_path, timezone, visibility, created_at, updated_at)
select e.event_id, coalesce(e.program_id, migration.nid('program:legacy')), e.event_name, nullif(btrim(e.event_name_ar),''),
       migration.register_asset('project-cover', e.event_id, e.header_image_url, 'projects', e.event_id::text, 'cover_path'),
       'Africa/Cairo', 'public', e.created_at, e.created_at
from legacy.events e
on conflict (id) do nothing;

select migration.flag('test_data', 'info', 'project', e.event_id::text, 'test-looking event ('||e.event_name||'); migrated like the rest (OD-3)')
from legacy.events e where lower(btrim(e.event_name)) in ('test','founder');

-- ================================================================= verification
select migration.check((select id from _r), 'V03.1 roles', '5', (select count(*)::text from public.roles));
select migration.check((select id from _r), 'V04.1 programs = legacy + Legacy',
  ((select count(*) from legacy.programs) + (case when exists (select 1 from legacy.events where program_id is null) then 1 else 0 end))::text,
  (select count(*)::text from public.programs));
select migration.check((select id from _r), 'V04.2 projects = events', (select count(*)::text from legacy.events), (select count(*)::text from public.projects));
select migration.check((select id from _r), 'V04.3 every project has a program', '0', (select count(*)::text from public.projects j where not exists (select 1 from public.programs g where g.id = j.program_id)));
select migration.check((select id from _r), 'V04.4 projects in Legacy program', (select count(*)::text from legacy.events where program_id is null),
  (select count(*)::text from public.projects where program_id = migration.nid('program:legacy')));
select migration.check((select id from _r), 'V04.5 project names checksum',
  (select md5(string_agg(event_id::text || event_name, ',' order by event_id)) from legacy.events),
  (select md5(string_agg(id::text || name_en, ',' order by id)) from public.projects));
select migration.check((select id from _r), 'V04.6 projects with cover path', (select count(*)::text from legacy.events where nullif(btrim(header_image_url),'') is not null),
  (select count(*)::text from public.projects where cover_path is not null));
select migration.check_design((select id from _r), 'D04.1 design: programs 4 / projects 16 / covers 8',
  '4/16/8', (select (select count(*) from public.programs) || '/' || (select count(*) from public.projects) || '/' || (select count(*) from public.projects where cover_path is not null)));

select migration.finish_run((select id from _r));
\o
select check_key, expected, actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
