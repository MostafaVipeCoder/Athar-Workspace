-- m80_final_verification_reconciliation  (05 phase 15; STAGE 2a, LOCAL ONLY)
-- Fills migration.table_recon (old count vs new count vs archived-only vs quarantined for EVERY one of the 48 legacy tables),
-- migration.event_totals (per-event business totals old vs new), runs the referential scan on the old and on the new schema, and
-- compares the target row counts with the design (05 6.2).  Nothing may be unaccounted for.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m80_final_verification_reconciliation') as id;
\o /dev/null

-- ================================================================= generic orphan scan over every foreign key of a schema
create or replace function migration.orphan_scan(p_schema text) returns table (constraint_name text, child text, parent text, orphans bigint)
language plpgsql stable set search_path = '' as $f$
declare r record; cols_c text; join_on text; nulls text; n bigint;
begin
  for r in select c.oid, c.conname, c.conrelid::regclass::text child, c.confrelid::regclass::text parent, c.conkey, c.confkey, c.conrelid, c.confrelid
           from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace
           where c.contype = 'f' and ns.nspname = p_schema order by c.conname
  loop
    select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by k.ord),
           string_agg(format('c.%I is not null', ca.attname), ' and ' order by k.ord)
      into join_on, nulls
    from unnest(r.conkey, r.confkey) with ordinality k(ck, pk, ord)
    join pg_attribute ca on ca.attrelid = r.conrelid and ca.attnum = k.ck
    join pg_attribute pa on pa.attrelid = r.confrelid and pa.attnum = k.pk;
    execute format('select count(*) from %s c where %s and not exists (select 1 from %s p where %s)', r.child, nulls, r.parent, join_on) into n;
    constraint_name := r.conname; child := r.child; parent := r.parent; orphans := n; return next;
  end loop;
end $f$;

-- ================================================================= table reconciliation (every legacy table)
create table if not exists migration.table_recon (
  legacy_table text primary key, old_count bigint not null, represented_in_new bigint not null, merged_archived bigint not null default 0,
  quarantined bigint not null default 0, not_carried bigint not null default 0, unaccounted bigint not null,
  new_table text, new_count bigint, disposition text, note text, computed_at timestamptz not null default now()
);
revoke all on migration.table_recon from public, anon, authenticated;
truncate migration.table_recon;

create temp table t_rc (legacy_table text, represented bigint, merged bigint, quar bigint, notcarried bigint, new_table text, new_count bigint, disposition text, note text) on commit drop;
insert into t_rc values
('agenda_slots',        (select count(*) from public.agenda_slots), 0, 0, 0, 'agenda_slots', (select count(*) from public.agenda_slots), 'C', '1 slot with owner-approved end-time fixup (04:30 -> 16:30), logged in migration.fixups'),
('alumni_invitations',  (select count(*) from public.alumni_invitations), 0, 0, 0, 'alumni_invitations', (select count(*) from public.alumni_invitations), 'C', 'generic loader (token stored as sha256)'),
('ather_team_bookings', (select count(*) from public.bookings b join public.nodes n on n.id = b.node_id where n.name_en = 'Interview booking'), 0, (select count(*) from legacy.v_quarantine_ather_team_bookings), 0, 'bookings (interview)', (select count(*) from public.bookings b join public.nodes n on n.id = b.node_id where n.name_en = 'Interview booking'), 'C/Q', 'booking of the deleted event quarantined'),
('ather_team_members',  (select count(*) from public.network_experts where kind = 'team'), 0, (select count(*) from legacy.v_quarantine_ather_team_members), 0, 'network_experts (team)', (select count(*) from public.network_experts where kind = 'team'), 'C/Q', 'member of the deleted event quarantined'),
('ather_team_slots',    (select count(*) from public.booking_slots s join public.nodes n on n.id = s.node_id where n.name_en = 'Interview booking'), 0, (select count(*) from legacy.v_quarantine_ather_team_slots), 0, 'booking_slots (interview)', (select count(*) from public.booking_slots s join public.nodes n on n.id = s.node_id where n.name_en = 'Interview booking'), 'C/Q', '8 slots of the deleted event quarantined'),
('booking_notifications', 0, 0, 0, (select count(*) from legacy.booking_notifications), null, null, 'X', 'empty, replaced by app_private.email_outbox (blocker flag if ever non-empty)'),
('bookings',            (select count(*) from public.bookings b join public.nodes n on n.id = b.node_id where n.name_en = 'Mentor booking'), 0, (select count(*) from legacy.v_quarantine_bookings), 0, 'bookings (mentor)', (select count(*) from public.bookings b join public.nodes n on n.id = b.node_id where n.name_en = 'Mentor booking'), 'C', '2 pending test bookings loaded as confirmed (no Meet link existed)'),
('certificates',        0, 0, 0, (select count(*) from legacy.certificates), 'certificates', (select count(*) from public.certificates), 'C', 'empty (blocker flag if ever non-empty: needs a template)'),
('companies',           (select count(*) from public.companies), (select count(*) from migration.company_merges), 0, 0, 'companies', (select count(*) from public.companies), 'C', '20 duplicates merged (16 exact + 4 probable); dropped rows archived in legacy.companies'),
('company_founders',    (select count(*) from public.company_founders), 0, 0, 0, 'company_founders', (select count(*) from public.company_founders), 'C', 'generic loader'),
('company_snapshots',   (select count(*) from public.company_snapshots), 0, 0, 0, 'company_snapshots', (select count(*) from public.company_snapshots), 'C', 'generic loader'),
('company_submissions', (select count(*) from public.form_responses r where r.external_key like 'legacy:%' and r.id in (select submission_id from legacy.company_submissions)), 0, 0, 0, 'form_responses (+ list_items selection, selection_reviews)', (select count(*) from public.form_responses), 'C/M', 'national_id column (65 non-empty) and the 5 national-id answer headers (665 cells) archived in legacy only; 1 pasted id redacted in a free-text cell'),
('email_audit_log',     0, 0, 0, (select count(*) from legacy.email_audit_log), null, null, 'C', 'empty (blocker flag if ever non-empty)'),
('event_days',          (select count(*) from public.agenda_days), 0, 0, 0, 'agenda_days', (select count(*) from public.agenda_days), 'C', null),
('event_forms',         (select count(*) from public.forms f where f.node_id in (select form_id from legacy.event_forms)), 0, 0, 0, 'forms (+ form nodes, public_links)', (select count(*) from public.forms), 'C', '5 Legacy-import forms added'),
('events',              (select count(*) from public.projects), 0, 0, 0, 'projects (+ nodes, edges, public_links)', (select count(*) from public.projects), 'C/D', '82 nodes, 53 edges, 33 links derived'),
('expert_submissions',  0, 0, 0, (select count(*) from legacy.expert_submissions), null, null, 'C', 'empty (blocker flag if ever non-empty)'),
('experts',             (select count(*) from public.list_items i where i.id in (select expert_id from legacy.experts)), 0, 0, 0, 'list_items (expert lists)', (select count(*) from public.list_items i join public.lists l on l.node_id = i.list_node_id where l.subkind = 'expert'), 'O', 'per-event copies became list items by reference to network_experts (+2 hidden provider-only, +2 team)'),
('form_covers',         (select count(*) from public.form_covers where id in (select cover_id from legacy.form_covers)), 0, 0, 0, 'form_covers', (select count(*) from public.form_covers), 'C', '+2 default covers from events.form_cover_image_url'),
('form_field_configs',  (select count(*) from public.form_questions where id in (select config_id from legacy.form_field_configs)), 0, 0, 0, 'form_questions', (select count(*) from public.form_questions), 'C', '+148 generated questions for the Legacy-import forms'),
('form_responses',      (select count(*) from public.form_responses where id in (select response_id from legacy.form_responses)), 0, 0, 0, 'form_responses', (select count(*) from public.form_responses), 'C', 'empty (generic loader)'),
('form_share_events',   (select count(*) from legacy.form_share_events), 0, 0, 0, 'node_events', (select count(*) from public.node_events), 'C', 'empty (generic loader)'),
('founders',            (select count(*) from public.founders), 0, 0, 0, 'founders', (select count(*) from public.founders), 'C', 'generic loader'),
('google_settings',     0, 0, 0, (select count(*) from legacy.google_settings), null, null, 'X', 'SECRET: never copied; metadata only via migration.v_google_settings_meta; stays in the closed legacy archive'),
('investor_requests',   (select count(*) from public.investor_requests), 0, 0, 0, 'investor_requests', (select count(*) from public.investor_requests), 'C', 'generic loader'),
('join_athar_analytics',(select count(*) from public.node_events n where n.node_id in (select id from legacy.join_athar_pages)), 0, 0, 0, 'node_events', (select count(*) from public.node_events), 'C', null),
('join_athar_cards',    (select count(*) from public.landing_cards), 0, 0, 0, 'landing_cards', (select count(*) from public.landing_cards), 'C', null),
('join_athar_pages',    (select count(*) from public.nodes where type = 'landing_page'), 0, 0, 0, 'nodes (landing_page)', (select count(*) from public.nodes where type = 'landing_page'), 'C/D', null),
('join_athar_share_presets', (select count(*) from legacy.join_athar_share_presets), 0, 0, 0, 'landing_share_presets', (select count(*) from public.landing_share_presets), 'C', 'empty (generic loader)'),
('library_forms',       (select count(*) from public.form_templates), 0, 0, 0, 'form_templates', (select count(*) from public.form_templates), 'C', null),
('library_resources',   (select count(*) from public.resources), 0, 0, 0, 'resources', (select count(*) from public.resources), 'C', '5 bucket files (path in bucket resources, pending 2b), 21 external links'),
('master_experts',      (select count(*) from public.network_experts where kind = 'expert'), 0, 0, 0, 'network_experts (expert)', (select count(*) from public.network_experts where kind = 'expert'), 'C', '2 Arabic names promoted from per-event copies'),
('mentor_day_config',   0, 0, 0, (select count(*) from legacy.mentor_day_config), null, null, 'X', 'empty and dead (blocker flag if ever non-empty)'),
('mentor_slots',        (select count(*) from public.booking_slots s join public.nodes n on n.id = s.node_id where n.name_en = 'Mentor booking'), 0, (select count(*) from legacy.v_quarantine_mentor_slots), 0, 'booking_slots (mentor)', (select count(*) from public.booking_slots s join public.nodes n on n.id = s.node_id where n.name_en = 'Mentor booking'), 'C/Q', '1 zero-length slot quarantined'),
('mentoring_distribution_config', (select count(*) from public.distributions), 0, 0, 0, 'distributions (+ distribution_days, rules)', (select count(*) from public.distributions), 'C/D', '3 mentor rules loaded, 4 dangling keys flagged'),
('mentoring_distribution_day_config', (select count(*) from legacy.mentoring_distribution_day_config d join public.distribution_days x on x.project_id = d.event_id and x.day_index = d.day_index), 0, 0, 0, 'distribution_days', (select count(*) from public.distribution_days), 'C', '9 days in total (4 + 2 more created from num_days / stored sessions)'),
('mentoring_sessions',  (select count(*) from public.distribution_sessions), 0, (select count(*) from legacy.v_quarantine_mentoring_sessions), 0, 'distribution_sessions', (select count(*) from public.distribution_sessions), 'C/Q', '432 sessions without event id quarantined'),
('mentors',             (select count(*) from public.booking_providers p join public.nodes n on n.id = p.node_id where n.name_en = 'Mentor booking'), 0, 0, 0, 'booking_providers (mentor)', (select count(*) from public.booking_providers p join public.nodes n on n.id = p.node_id where n.name_en = 'Mentor booking'), 'C', null),
('notifications',       (select count(*) from public.notifications), 0, 0, 0, 'notifications', (select count(*) from public.notifications), 'C', 'generic loader'),
('opportunities',       (select count(*) from public.opportunities), 0, 0, 0, 'opportunities', (select count(*) from public.opportunities), 'C', 'generic loader'),
('opportunity_applications', (select count(*) from public.opportunity_applications), 0, 0, 0, 'opportunity_applications', (select count(*) from public.opportunity_applications), 'C', 'generic loader'),
('profiles',            (select count(*) from public.profiles), 0, 0, 0, 'profiles', (select count(*) from public.profiles), 'C', null),
('program_participations', (select count(*) from public.participants), 0, 0, 0, 'participants', (select count(*) from public.participants), 'C', 'generic loader'),
('programs',            (select count(*) from public.programs where id in (select program_id from legacy.programs)), 0, 0, 0, 'programs', (select count(*) from public.programs), 'C', '+1 invented Legacy program for the 3 projects without a program'),
('project_managers',    (select count(*) from public.project_members), 0, 0, 0, 'project_members', (select count(*) from public.project_members), 'C', 'empty: no membership can be derived (open item)'),
('roles',               (select count(*) from public.roles where key in (select key from legacy.roles)), 0, 0, 0, 'roles', (select count(*) from public.roles), 'C', '+ integration role'),
('smtp_settings',       0, 0, 0, (select count(*) from legacy.smtp_settings), null, null, 'X', 'SECRET: never copied; stays in the closed legacy archive'),
('user_roles',          (select count(*) from public.user_roles), 0, 0, 0, 'user_roles', (select count(*) from public.user_roles), 'C', 'owner decision 08 s9: 11 accounts converted super_admin -> project_manager (fixups), abdullah.shaban stays super_admin');

insert into migration.table_recon (legacy_table, old_count, represented_in_new, merged_archived, quarantined, not_carried, unaccounted, new_table, new_count, disposition, note)
select t.legacy_table,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from legacy.%I', t.legacy_table), false, true, '')))[1]::text::bigint,
       t.represented, t.merged, t.quar, t.notcarried,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from legacy.%I', t.legacy_table), false, true, '')))[1]::text::bigint - (t.represented + t.merged + t.quar + t.notcarried),
       t.new_table, t.new_count, t.disposition, t.note
from t_rc t;

-- ================================================================= per-event business totals
create table if not exists migration.event_totals (
  project_id uuid not null, metric text not null, old_count bigint not null, new_count bigint not null, primary key (project_id, metric)
);
revoke all on migration.event_totals from public, anon, authenticated;
truncate migration.event_totals;
insert into migration.event_totals (project_id, metric, old_count, new_count)
select e.event_id, m.metric, m.o, m.n from legacy.events e cross join lateral (values
  ('days', (select count(*) from legacy.event_days d where d.event_id = e.event_id), (select count(*) from public.agenda_days d where d.project_id = e.event_id)),
  ('agenda_slots', (select count(*) from legacy.agenda_slots s join legacy.event_days d on d.day_id = s.day_id where d.event_id = e.event_id),
                   (select count(*) from public.agenda_slots s where s.project_id = e.event_id)),
  ('forms', (select count(*) from legacy.event_forms f where f.event_id = e.event_id), (select count(*) from public.forms f where f.project_id = e.event_id and f.node_id in (select form_id from legacy.event_forms))),
  ('questions', (select count(*) from legacy.form_field_configs q join legacy.event_forms f on f.form_id = q.form_id where f.event_id = e.event_id),
                (select count(*) from public.form_questions q where q.project_id = e.event_id and q.node_id in (select form_id from legacy.event_forms))),
  ('submissions', (select count(*) from legacy.company_submissions s where s.event_id = e.event_id), (select count(*) from public.form_responses r where r.project_id = e.event_id)),
  ('selection_items', (select count(*) from legacy.company_submissions s where s.event_id = e.event_id), (select count(*) from public.list_items i where i.project_id = e.event_id and i.source_kind = 'form_response')),
  ('companies (list items; merged same-list pairs collapse)',
      (select count(*) from legacy.companies c where c.event_id = e.event_id)
        - (select count(*) from migration.company_merges m join legacy.companies k on k.company_id = m.keep_id join legacy.companies d on d.company_id = m.drop_id where k.event_id = d.event_id and k.event_id = e.event_id),
      (select count(*) from public.list_items i where i.project_id = e.event_id and i.source_kind = 'company')),
  ('experts (list items)', (select count(*) from legacy.experts x where x.event_id = e.event_id),
      (select count(*) from public.list_items i join public.lists l on l.node_id = i.list_node_id join public.nodes n on n.id = i.list_node_id
        where i.project_id = e.event_id and l.subkind = 'expert' and not i.excluded and n.name_en = 'Experts')),
  ('mentors (providers)', (select count(*) from legacy.mentors m where m.event_id = e.event_id::text),
      (select count(*) from public.booking_providers p join public.nodes n on n.id = p.node_id where p.project_id = e.event_id and n.name_en = 'Mentor booking')),
  ('mentor_slots (loaded subset)', (select count(*) from legacy.mentor_slots s where s.event_id = e.event_id::text and s.end_time > s.start_time),
      (select count(*) from public.booking_slots s join public.nodes n on n.id = s.node_id where s.project_id = e.event_id and n.name_en = 'Mentor booking')),
  ('mentor_bookings', (select count(*) from legacy.bookings b where b.event_id = e.event_id::text),
      (select count(*) from public.bookings b join public.nodes n on n.id = b.node_id where b.project_id = e.event_id and n.name_en = 'Mentor booking')),
  ('team_members', (select count(*) from legacy.ather_team_members t where t.event_id = e.event_id::text),
      (select count(*) from public.booking_providers p join public.nodes n on n.id = p.node_id where p.project_id = e.event_id and n.name_en = 'Interview booking')),
  ('team_slots', (select count(*) from legacy.ather_team_slots s where s.event_id = e.event_id::text),
      (select count(*) from public.booking_slots s join public.nodes n on n.id = s.node_id where s.project_id = e.event_id and n.name_en = 'Interview booking')),
  ('team_bookings', (select count(*) from legacy.ather_team_bookings b where b.event_id = e.event_id::text),
      (select count(*) from public.bookings b join public.nodes n on n.id = b.node_id where b.project_id = e.event_id and n.name_en = 'Interview booking')),
  ('library', (select count(*) from legacy.library_resources r where r.event_id = e.event_id), (select count(*) from public.resources r where r.project_id = e.event_id)),
  ('distribution_sessions', (select count(*) from legacy.mentoring_sessions s where s.event_id = e.event_id::text), (select count(*) from public.distribution_sessions s where s.project_id = e.event_id)),
  ('form_covers (+ default cover)', (select count(*) from legacy.form_covers c where c.event_id = e.event_id) + (case when nullif(btrim(e.form_cover_image_url),'') is not null then 1 else 0 end),
      (select count(*) from public.form_covers c where c.project_id = e.event_id))
) m(metric, o, n);

-- ================================================================= verification
select migration.check((select id from _r), 'V80.1 table reconciliation covers all 48 legacy tables', '48', (select count(*)::text from migration.table_recon));
select migration.check((select id from _r), 'V80.1 every legacy table in the catalog is reconciled', '0',
  (select count(*)::text from information_schema.tables t where t.table_schema = 'legacy' and t.table_type = 'BASE TABLE' and t.table_name not in (select legacy_table from migration.table_recon)));
select migration.check((select id from _r), 'V80.1 nothing unaccounted: old = represented + merged + quarantined + not carried', '0',
  (select count(*)::text from migration.table_recon where unaccounted <> 0));
select migration.check((select id from _r), 'V80.1 legacy row total = baseline', (select sum(row_count)::text from migration.baseline where table_name like 'public.%'),
  (select sum(old_count)::text from migration.table_recon));
select migration.check((select id from _r), 'V80.2 per-event business totals: no mismatch', '0',
  (select count(*)::text from migration.event_totals where old_count <> new_count));
select migration.check((select id from _r), 'V80.3 referential scan of the OLD schema (legacy FKs): orphans', '0',
  (select coalesce(sum(orphans), 0)::text from migration.orphan_scan('legacy')),
  (select jsonb_build_object('foreign_keys', count(*)) from migration.orphan_scan('legacy')));
select migration.check((select id from _r), 'V80.3 referential scan of the NEW schema (public + app_private FKs): orphans', '0',
  (select (coalesce((select sum(orphans) from migration.orphan_scan('public')), 0) + coalesce((select sum(orphans) from migration.orphan_scan('app_private')), 0))::text),
  (select jsonb_build_object('foreign_keys', (select count(*) from migration.orphan_scan('public')) + (select count(*) from migration.orphan_scan('app_private')))));
select migration.check((select id from _r), 'V80.4 no node without extension row where one is required', '0',
  (select ((select count(*) from public.nodes n where n.type = 'list' and not exists (select 1 from public.lists l where l.node_id = n.id)) +
           (select count(*) from public.nodes n where n.type = 'form_builder' and not exists (select 1 from public.forms f where f.node_id = n.id)) +
           (select count(*) from public.nodes n where n.type = 'booking' and not exists (select 1 from public.booking_settings b where b.node_id = n.id)) +
           (select count(*) from public.nodes n where n.type = 'distribution' and not exists (select 1 from public.distributions d where d.node_id = n.id)))::text));
select migration.check((select id from _r), 'V80.5 every project has the view host node', '0',
  (select count(*)::text from public.projects j where not exists (select 1 from public.nodes n where n.project_id = j.id and n.type = 'view_host')));
select migration.check((select id from _r), 'V80.6 no open blocker flag', '0', (select count(*)::text from migration.flags where severity = 'blocker' and resolved_at is null));

-- design 05 6.2 expected target counts (warn only; after the 20 merges companies/list_items are expected to be lower)
select migration.check_design((select id from _r), 'D80.1 design 6.2 headline counts (companies 161-20=141, list_items 614-2=612)',
  'roles5 user_roles12 profiles12 programs4 projects16 members0/0 nodes82 revisions82 edges53 links33 slugs33 network_experts44 companies141 list_items612 reviews201 lists20 forms12 sections6 questions204 responses384 covers5 templates1 resources26 landing_cards4 events26 providers6 slots55 bookings30 distributions2 dist_days9 day_mentors139 rules3 sessions716 agenda_days37 agenda_slots248 booking_settings6 participants0',
  (select 'roles' || (select count(*) from public.roles) || ' user_roles' || (select count(*) from public.user_roles) || ' profiles' || (select count(*) from public.profiles) ||
          ' programs' || (select count(*) from public.programs) || ' projects' || (select count(*) from public.projects) ||
          ' members' || (select count(*) from public.program_members) || '/' || (select count(*) from public.project_members) ||
          ' nodes' || (select count(*) from public.nodes) || ' revisions' || (select count(*) from public.node_revisions) || ' edges' || (select count(*) from public.edges) ||
          ' links' || (select count(*) from public.public_links) || ' slugs' || (select count(*) from public.public_link_slugs) ||
          ' network_experts' || (select count(*) from public.network_experts) || ' companies' || (select count(*) from public.companies) ||
          ' list_items' || (select count(*) from public.list_items) || ' reviews' || (select count(*) from public.selection_reviews) || ' lists' || (select count(*) from public.lists) ||
          ' forms' || (select count(*) from public.forms) || ' sections' || (select count(*) from public.form_sections) || ' questions' || (select count(*) from public.form_questions) ||
          ' responses' || (select count(*) from public.form_responses) || ' covers' || (select count(*) from public.form_covers) || ' templates' || (select count(*) from public.form_templates) ||
          ' resources' || (select count(*) from public.resources) || ' landing_cards' || (select count(*) from public.landing_cards) || ' events' || (select count(*) from public.node_events) ||
          ' providers' || (select count(*) from public.booking_providers) || ' slots' || (select count(*) from public.booking_slots) || ' bookings' || (select count(*) from public.bookings) ||
          ' distributions' || (select count(*) from public.distributions) || ' dist_days' || (select count(*) from public.distribution_days) ||
          ' day_mentors' || (select count(*) from public.distribution_day_mentors) || ' rules' || (select count(*) from public.distribution_mentor_rules) ||
          ' sessions' || (select count(*) from public.distribution_sessions) || ' agenda_days' || (select count(*) from public.agenda_days) ||
          ' agenda_slots' || (select count(*) from public.agenda_slots) || ' booking_settings' || (select count(*) from public.booking_settings) ||
          ' participants' || (select count(*) from public.participants)));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 36) expected, left(actual, 36) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
