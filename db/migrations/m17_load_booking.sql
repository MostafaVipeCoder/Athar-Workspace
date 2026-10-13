-- m17_load_booking  (05 phase 10; STAGE 2a, LOCAL ONLY)
-- ONE booking model (mode mentor / interview): booking_providers (4 mentors + 2 team members), booking_slots (zero-length / orphan slots are
-- quarantined, not loaded), bookings (every booking keeps its Meet link: a booking without its own link inherits the slot's; the Google
-- calendar event id is kept in legacy_calendar_event_id; the 2 legacy 'pending' bookings load as confirmed).  Calendar sync state lives in
-- app_private.integration_jobs: a calendar_create job is queued ONLY for confirmed future bookings without a calendar id (0 today).
-- Quarantine = views over the legacy tables (nothing is copied or deleted).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m17_load_booking') as id;
\o /dev/null

-- ---------------------------------------------------------------- quarantine views (live in the closed legacy schema)
create or replace view legacy.v_quarantine_ather_team_members as
  select * from legacy.ather_team_members t where t.event_id not in (select event_id::text from legacy.events);
create or replace view legacy.v_quarantine_ather_team_slots as
  select s.* from legacy.ather_team_slots s
  where s.event_id not in (select event_id::text from legacy.events)
     or s.ather_team_member_id in (select id from legacy.v_quarantine_ather_team_members)
     or s.end_time <= s.start_time;
create or replace view legacy.v_quarantine_ather_team_bookings as
  select b.* from legacy.ather_team_bookings b
  where b.event_id not in (select event_id::text from legacy.events)
     or b.slot_id in (select id from legacy.v_quarantine_ather_team_slots);
create or replace view legacy.v_quarantine_mentor_slots as
  select s.* from legacy.mentor_slots s
  where s.event_id not in (select event_id::text from legacy.events)
     or s.mentor_id not in (select id from legacy.mentors m where m.event_id in (select event_id::text from legacy.events))
     or s.end_time <= s.start_time;
create or replace view legacy.v_quarantine_bookings as
  select b.* from legacy.bookings b
  where b.event_id not in (select event_id::text from legacy.events) or b.slot_id in (select id from legacy.v_quarantine_mentor_slots);
revoke all on legacy.v_quarantine_ather_team_members, legacy.v_quarantine_ather_team_slots, legacy.v_quarantine_ather_team_bookings,
            legacy.v_quarantine_mentor_slots, legacy.v_quarantine_bookings from public, anon, authenticated;

-- ---------------------------------------------------------------- providers
insert into public.booking_providers (id, project_id, node_id, list_item_id, advance_notice_min, booking_email, created_at)
select m.id, m.event_id::uuid, migration.nid(m.event_id||':booking_mentor'),
       coalesce((select e.expert_id from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id),
                migration.nid('provider-item:'||m.id::text)),
       nullif(m.advance_notice_minutes, 1440), nullif(btrim(m.email),''), coalesce(m.created_at, now())
from legacy.mentors m
where m.event_id in (select event_id::text from legacy.events)
on conflict (id) do nothing;

insert into public.booking_providers (id, project_id, node_id, list_item_id, advance_notice_min, booking_email, created_at)
select t.id, t.event_id::uuid, migration.nid(t.event_id||':booking_interview'), migration.nid('team-item:'||t.id::text),
       nullif(t.advance_notice_minutes, 1440), null, coalesce(t.created_at, now())
from legacy.ather_team_members t
where t.event_id in (select event_id::text from legacy.events)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- slots (is_blocked = unavailable AND not booked: a booked slot is derived as taken)
insert into public.booking_slots (id, project_id, node_id, provider_id, starts_at, ends_at, is_blocked, created_at)
select s.id, p.project_id, p.node_id, s.mentor_id, s.start_time, s.end_time,
       (not coalesce(s.is_available, true)) and not exists (select 1 from legacy.bookings b where b.slot_id = s.id), coalesce(s.created_at, now())
from legacy.mentor_slots s join public.booking_providers p on p.id = s.mentor_id
where s.end_time > s.start_time
on conflict (id) do nothing;

insert into public.booking_slots (id, project_id, node_id, provider_id, starts_at, ends_at, is_blocked, created_at)
select s.id, p.project_id, p.node_id, s.ather_team_member_id, s.start_time, s.end_time,
       (not coalesce(s.is_available, true)) and not exists (select 1 from legacy.ather_team_bookings b where b.slot_id = s.id), coalesce(s.created_at, now())
from legacy.ather_team_slots s join public.booking_providers p on p.id = s.ather_team_member_id
where s.end_time > s.start_time
on conflict (id) do nothing;

-- ---------------------------------------------------------------- bookings
insert into public.bookings (id, project_id, node_id, slot_id, status, booker_email, booker_company_id, booker_company_name, meet_link,
                             legacy_calendar_event_id, created_at, updated_at)
select b.id, sl.project_id, sl.node_id, b.slot_id,
       case when b.status = 'cancelled' then 'cancelled' else 'confirmed' end, btrim(b.booker_email),
       (select c.company_id from legacy.companies c
         where c.event_id = sl.project_id and lower(btrim(c.name)) = lower(btrim(b.company_name))
           and exists (select 1 from public.companies x where x.id = c.company_id)
         order by c.company_id limit 1),
       nullif(btrim(b.company_name),''),
       coalesce(nullif(btrim(b.meet_link),''), nullif(btrim(ls.meet_link),'')), nullif(btrim(b.calendar_event_id),''),
       coalesce(b.created_at, now()), coalesce(b.updated_at, b.created_at, now())
from legacy.ather_team_bookings b
join public.booking_slots sl on sl.id = b.slot_id
join legacy.ather_team_slots ls on ls.id = b.slot_id
on conflict (id) do nothing;

insert into public.bookings (id, project_id, node_id, slot_id, status, booker_email, booker_company_name, meet_link, legacy_calendar_event_id, created_at, updated_at)
select b.id, sl.project_id, sl.node_id, b.slot_id,
       case when b.status = 'cancelled' then 'cancelled' else 'confirmed' end, btrim(b.booker_email), nullif(btrim(b.company_name),''),
       coalesce(nullif(btrim(b.meet_link),''), nullif(btrim(ls.meet_link),'')), nullif(btrim(b.calendar_event_id),''),
       coalesce(b.created_at, now()), coalesce(b.updated_at, b.created_at, now())
from legacy.bookings b
join public.booking_slots sl on sl.id = b.slot_id
join legacy.mentor_slots ls on ls.id = b.slot_id
on conflict (id) do nothing;

-- calendar jobs: only confirmed bookings starting in the future that have no calendar event id (none today)
insert into app_private.integration_jobs (kind, project_id, booking_id, status, idempotency_key, payload)
select 'calendar_create', bk.project_id, bk.id, 'pending', 'cal:' || bk.id::text || ':calendar_create', '{"origin":"stage2a"}'::jsonb
from public.bookings bk join public.booking_slots sl on sl.id = bk.slot_id
where bk.status = 'confirmed' and sl.starts_at > now() and bk.legacy_calendar_event_id is null
on conflict (idempotency_key) do nothing;

-- ---------------------------------------------------------------- flags (quarantine + info)
select migration.flag('quarantine_ather_team_member', 'review', 'ather_team_members', id::text, 'member of a deleted event (' || event_id || '): not loaded, kept in legacy (view legacy.v_quarantine_ather_team_members)')
from legacy.v_quarantine_ather_team_members;
select migration.flag('quarantine_ather_team_slot', 'review', 'ather_team_slots', id::text, 'slot of a deleted event / orphan member / zero length: not loaded, kept in legacy')
from legacy.v_quarantine_ather_team_slots;
select migration.flag('quarantine_ather_team_booking', 'review', 'ather_team_bookings', id::text, 'booking of a deleted event: not loaded, kept in legacy')
from legacy.v_quarantine_ather_team_bookings;
select migration.flag('quarantine_mentor_slot', 'review', 'mentor_slots', id::text, 'zero-length or orphan mentor slot: not loaded, kept in legacy (meet_link kept there)')
from legacy.v_quarantine_mentor_slots;
select migration.flag('unbooked_slot_meet_link', 'info', 'mentor_slots', s.id::text, 'unbooked mentor slot carries a pre-generated Meet link: stays in legacy only (07-6: links are created at booking time)')
from legacy.mentor_slots s where nullif(btrim(s.meet_link),'') is not null and not exists (select 1 from legacy.bookings b where b.slot_id = s.id);
select migration.flag('booking_pending_loaded_confirmed', 'info', 'bookings', b.id::text, 'legacy status pending (test event, past start) loaded as confirmed (the legacy row never had a Meet link)')
from legacy.bookings b where b.status = 'pending';
select migration.flag('interview_booking_company_unmatched', 'info', 'bookings', b.id::text, 'company name matches no company of the event: kept as free text booker_company_name')
from public.bookings b join public.nodes n on n.id = b.node_id
where n.name_en = 'Interview booking' and b.booker_company_id is null;
select migration.flag('booking_calendar_owner_pending', 'review', 'bookings', 'all',
  (select count(*) from public.bookings where legacy_calendar_event_id is not null)::text ||
  ' bookings carry a Google calendar event id created by the startups@ poller; set calendar_owner_connection_id after the system google_connection exists (owner OAuth action, 05 phase 14)')
where exists (select 1 from public.bookings where legacy_calendar_event_id is not null);

-- ================================================================= verification
select migration.check((select id from _r), 'V10.1 providers = mentors + team (existing events)',
  ((select count(*) from legacy.mentors where event_id in (select event_id::text from legacy.events)) + (select count(*) from legacy.ather_team_members where event_id in (select event_id::text from legacy.events)))::text,
  (select count(*)::text from public.booking_providers));
select migration.check((select id from _r), 'V10.2 slot accounting: legacy = loaded + quarantined',
  ((select count(*) from legacy.mentor_slots) + (select count(*) from legacy.ather_team_slots))::text,
  ((select count(*) from public.booking_slots) + (select count(*) from legacy.v_quarantine_mentor_slots) + (select count(*) from legacy.v_quarantine_ather_team_slots))::text);
select migration.check((select id from _r), 'V10.3 booking accounting: legacy = loaded + quarantined',
  ((select count(*) from legacy.bookings) + (select count(*) from legacy.ather_team_bookings))::text,
  ((select count(*) from public.bookings) + (select count(*) from legacy.v_quarantine_bookings) + (select count(*) from legacy.v_quarantine_ather_team_bookings))::text);
select migration.check((select id from _r), 'V10.4 bookings per event',
  (select string_agg(left(e, 8) || '=' || n, ',' order by e) from (select event_id e, count(*) n from (select event_id from legacy.bookings where slot_id not in (select id from legacy.v_quarantine_mentor_slots) union all select event_id from legacy.ather_team_bookings where slot_id not in (select id from legacy.v_quarantine_ather_team_slots)) x group by 1) y),
  (select string_agg(left(project_id::text, 8) || '=' || n, ',' order by project_id::text) from (select project_id, count(*) n from public.bookings group by 1) y));
-- DEVIATION from 05 F12: on this data the 2 legacy 'pending' (test) bookings have NO Meet link, neither on the booking nor on the slot
-- (the slot's meet_link is an empty string), so only the bookings that HAD a link (own or slot) can keep one: 28 of 30.
select migration.check((select id from _r), 'V10.5 every booking that had a Meet link (own or slot) keeps it',
  (select count(*)::text from (select b.id, b.meet_link, s.meet_link sl from legacy.bookings b join legacy.mentor_slots s on s.id = b.slot_id
                               union all select b.id, b.meet_link, s.meet_link from legacy.ather_team_bookings b join legacy.ather_team_slots s on s.id = b.slot_id
                               where b.slot_id not in (select id from legacy.v_quarantine_ather_team_slots)) x
    where nullif(btrim(x.meet_link),'') is not null or nullif(btrim(x.sl),'') is not null),
  (select count(*)::text from public.bookings where meet_link is not null));
select migration.flag('booking_without_meet_link', 'info', 'bookings', b.id::text,
  'legacy booking never had a Meet link (neither the booking nor its slot; test event). Loaded without link (05 F12 expected the slot to carry one)')
from public.bookings b where b.meet_link is null;
select migration.check_design((select id from _r), 'D10.3 design: 30 of 30 bookings keep a Meet link', '30', (select count(*)::text from public.bookings where meet_link is not null));
select migration.check((select id from _r), 'V10.5 Google calendar ids kept', (select count(*)::text from (select id, calendar_event_id from legacy.bookings union all select id, calendar_event_id from legacy.ather_team_bookings) x where nullif(btrim(calendar_event_id),'') is not null and x.id in (select id from public.bookings)),
  (select count(*)::text from public.bookings where legacy_calendar_event_id is not null));
select migration.check((select id from _r), 'V10.5 own Meet links unchanged', '0',
  (select count(*)::text from public.bookings b join (select id, meet_link from legacy.bookings union all select id, meet_link from legacy.ather_team_bookings) o on o.id = b.id
    where nullif(btrim(o.meet_link),'') is not null and b.meet_link <> btrim(o.meet_link)));
select migration.check((select id from _r), 'V10.6 no slot with two confirmed bookings', '0',
  (select count(*)::text from (select slot_id from public.bookings where status = 'confirmed' group by 1 having count(*) > 1) x));
select migration.check((select id from _r), 'V10.8 booking checksum md5(id||slot||email||meet_link)',
  (select md5(string_agg(x.id::text || x.slot_id::text || lower(btrim(x.booker_email)) || coalesce(nullif(btrim(x.meet_link),''), nullif(btrim(ls.meet_link),''), ''), ',' order by x.id))
   from (select id, slot_id, booker_email, meet_link from legacy.bookings union all select id, slot_id, booker_email, meet_link from legacy.ather_team_bookings) x
   left join (select id, meet_link from legacy.mentor_slots union all select id, meet_link from legacy.ather_team_slots) ls on ls.id = x.slot_id
   where x.slot_id not in (select id from legacy.v_quarantine_mentor_slots union select id from legacy.v_quarantine_ather_team_slots)),
  (select md5(string_agg(id::text || slot_id::text || lower(booker_email::text) || coalesce(meet_link, ''), ',' order by id)) from public.bookings));
select migration.check((select id from _r), 'V10.9 derived start/end equal the old booking start/end', '0',
  (select count(*)::text from public.bookings b join public.booking_slots s on s.id = b.slot_id
    join (select id, start_time, end_time from legacy.bookings union all select id, start_time, end_time from legacy.ather_team_bookings) o on o.id = b.id
    where o.start_time is not null and (o.start_time <> s.starts_at or o.end_time <> s.ends_at)));
select migration.check((select id from _r), 'V10.10 interview bookings linked to a company',
  (select count(*)::text from legacy.ather_team_bookings b join legacy.ather_team_slots s on s.id = b.slot_id
    where b.slot_id not in (select id from legacy.v_quarantine_ather_team_slots) and exists (select 1 from legacy.companies c where c.event_id::text = b.event_id and lower(btrim(c.name)) = lower(btrim(b.company_name)))),
  (select count(*)::text from public.bookings b join public.nodes n on n.id = b.node_id where n.name_en = 'Interview booking' and b.booker_company_id is not null));
select migration.check_design((select id from _r), 'D10.1 design: providers 6 / slots 55 / bookings 30 / quarantined slots 9 / bookings 1', '6/55/30/9/1',
  (select (select count(*) from public.booking_providers) || '/' || (select count(*) from public.booking_slots) || '/' || (select count(*) from public.bookings) || '/' ||
          ((select count(*) from legacy.v_quarantine_mentor_slots) + (select count(*) from legacy.v_quarantine_ather_team_slots)) || '/' ||
          ((select count(*) from legacy.v_quarantine_bookings) + (select count(*) from legacy.v_quarantine_ather_team_bookings))));
select migration.check_design((select id from _r), 'D10.2 design: 17 of 28 interview bookings matched to a company', '17',
  (select count(*)::text from public.bookings where booker_company_id is not null));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
