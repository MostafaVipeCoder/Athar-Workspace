-- m16_load_agenda_library_landing  (05 phase 9; STAGE 2a, LOCAL ONLY)
-- agenda_days / agenda_slots (with the owner-approved fixup 08 s13: slot "Mentoring and Teamwork", Upper Egypt AI Hackathon, 2026-09-10,
-- order 6, end 04:30 -> 16:30, recorded in migration.fixups with the old value), resources (library), landing_cards, landing_share_presets,
-- node_events (join_athar_analytics, form_share_events).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m16_load_agenda_library_landing') as id;
\o /dev/null

-- ---------------------------------------------------------------- owner-approved fixup (applied by this loader; the legacy row stays unchanged)
insert into migration.fixups (entity, ref_id, column_name, new_value, reason, approved_by)
select 'agenda_slots', s.slot_id::text, 'end_time', '16:30',
       'owner decision 08 s13: end 04:30 -> 16:30 (old value: ' || s.end_time || '; start ' || s.start_time || '; event "' || e.event_name || '", day ' || d.day_date::text || ', order ' || s.sort_order::text || ')',
       'owner 2026-10-11'
from legacy.agenda_slots s join legacy.event_days d on d.day_id = s.day_id join legacy.events e on e.event_id = d.event_id
where e.event_name = 'Upper Egypt AI Hackathon' and d.day_date = date '2026-09-10' and s.slot_title = 'Mentoring and Teamwork'
  and s.sort_order = 6 and s.start_time = '13:30' and s.end_time = '04:30'
on conflict (entity, ref_id, column_name) do nothing;

-- ---------------------------------------------------------------- agenda
insert into public.agenda_days (id, project_id, node_id, sort_order, day_date, name_en, name_ar)
select d.day_id, d.event_id, migration.nid(d.event_id::text||':agenda'), d.day_number, d.day_date, d.day_name, nullif(btrim(d.day_name_ar),'')
from legacy.event_days d
where exists (select 1 from public.nodes n where n.id = migration.nid(d.event_id::text||':agenda'))
on conflict (id) do nothing;

insert into public.agenda_slots (id, project_id, day_id, sort_order, start_time, end_time, title_en, title_ar, presenter_en, presenter_ar, show_presenter, bullets)
select s.slot_id, d.event_id, s.day_id, s.sort_order, s.start_time::time,
       coalesce((select f.new_value::time from migration.fixups f where f.entity = 'agenda_slots' and f.ref_id = s.slot_id::text and f.column_name = 'end_time'), s.end_time::time),
       s.slot_title, nullif(btrim(s.slot_title_ar),''), nullif(btrim(s.presenter_name),''), nullif(btrim(s.presenter_name_ar),''), coalesce(s.show_presenter, true),
       coalesce((select jsonb_agg(jsonb_build_object('en', coalesce(s.bullet_points->>(i-1), ''), 'ar', coalesce(s.bullet_points_ar->>(i-1), '')) order by i)
                 from generate_series(1, greatest(case when jsonb_typeof(s.bullet_points) = 'array' then jsonb_array_length(s.bullet_points) else 0 end,
                                                  case when jsonb_typeof(s.bullet_points_ar) = 'array' then jsonb_array_length(s.bullet_points_ar) else 0 end)) i),
                '[]'::jsonb)
from legacy.agenda_slots s join legacy.event_days d on d.day_id = s.day_id
where exists (select 1 from public.agenda_days a where a.id = s.day_id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- library resources (bucket files get a target path in bucket "resources"; external stay url)
insert into public.resources (id, project_id, node_id, title_en, title_ar, type, url, file_path, mime, bytes, sort_order, created_at)
select r.resource_id, r.event_id, migration.nid(r.event_id::text||':library'), nullif(btrim(r.title_en),''), nullif(btrim(r.title_ar),''),
       case when r.resource_type in ('readable','audible','visual','link') then r.resource_type else 'link' end,
       case when r.url like '%/storage/v1/object/public/event-assets/%' then null else btrim(r.url) end,
       case when r.url like '%/storage/v1/object/public/event-assets/%'
            then migration.register_asset('resource', r.event_id, r.url, 'resources', r.resource_id::text, 'file_path') end,
       o.metadata->>'mimetype', nullif(o.metadata->>'size','')::bigint::int, r.sort_order, coalesce(r.created_at, now())
from legacy.library_resources r
left join storage.objects o on o.bucket_id = 'event-assets'
     and o.name = split_part(substring(r.url from '/storage/v1/object/public/event-assets/(.*)$'), '?', 1)
where exists (select 1 from public.nodes n where n.id = migration.nid(r.event_id::text||':library'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------- landing page cards
insert into public.landing_cards (id, project_id, node_id, sort_order, cover_path, title_en, body_en, cta_label_en, cta_url, created_at, updated_at)
select c.id, n.project_id, c.page_id, c.order_index,
       migration.register_asset('landing', n.project_id, c.image_url, 'landing_cards', c.id::text, 'cover_path'),
       nullif(btrim(c.title),''), nullif(btrim(c.description),''), nullif(btrim(c.button_text),''), nullif(btrim(c.button_url),''),
       coalesce(c.created_at, now()), coalesce(c.updated_at, now())
from legacy.join_athar_cards c join public.nodes n on n.id = c.page_id and n.type = 'landing_page'
on conflict (id) do nothing;

-- page-level share presets -> one preset per card per platform (generic rule; 0 rows today)
insert into public.landing_share_presets (card_id, platform, project_id, body)
select c.id, p.platform, c.project_id, p.preset_message
from legacy.join_athar_share_presets p join public.landing_cards c on c.node_id = p.page_id
where p.platform in ('whatsapp','facebook','linkedin','instagram','telegram','x','copy') and nullif(btrim(p.preset_message),'') is not null
on conflict (card_id, platform) do nothing;
select migration.flag('share_preset_not_loaded', 'review', 'join_athar_share_presets', p.id::text, 'platform "' || p.platform || '" or empty message does not fit landing_share_presets; stays in legacy')
from legacy.join_athar_share_presets p
where p.platform not in ('whatsapp','facebook','linkedin','instagram','telegram','x','copy') or nullif(btrim(p.preset_message),'') is null;

-- ---------------------------------------------------------------- analytics events (no natural key: guarded by a marker so a re-run never duplicates)
insert into public.node_events (project_id, node_id, event_type, card_id, platform, created_at)
select n.project_id, a.page_id, a.event_type, (select c.id from public.landing_cards c where c.id = a.card_id), a.platform, coalesce(a."timestamp", now())
from legacy.join_athar_analytics a join public.nodes n on n.id = a.page_id
where a.event_type in ('tab_view','card_share','share_copy','cta_click','image_upload','image_download','form_share','form_view')
  and not exists (select 1 from migration.id_map m where m.entity = 'node_events_loaded' and m.old_id = 'join_athar_analytics')
order by a."timestamp", a.id;
insert into public.node_events (project_id, node_id, event_type, platform, created_at)
select n.project_id, s.form_id, 'form_share', s.platform, coalesce(s.clicked_at, now())
from legacy.form_share_events s join public.nodes n on n.id = s.form_id
where not exists (select 1 from migration.id_map m where m.entity = 'node_events_loaded' and m.old_id = 'form_share_events')
order by s.clicked_at, s.id;
insert into migration.id_map(entity, old_id, new_id, note) values
  ('node_events_loaded', 'join_athar_analytics', migration.nid('node_events_loaded:join_athar_analytics'), 'marker: analytics loaded once'),
  ('node_events_loaded', 'form_share_events',    migration.nid('node_events_loaded:form_share_events'),    'marker: form share events loaded once')
on conflict do nothing;

-- ================================================================= verification
select migration.check((select id from _r), 'V09.1 agenda_days', (select count(*)::text from legacy.event_days), (select count(*)::text from public.agenda_days));
select migration.check((select id from _r), 'V09.1 agenda_slots', (select count(*)::text from legacy.agenda_slots), (select count(*)::text from public.agenda_slots));
select migration.check((select id from _r), 'V09.1 slots per event',
  (select string_agg(left(d.event_id::text, 8) || '=' || n, ',' order by d.event_id) from (select d.event_id, count(*) n from legacy.agenda_slots s join legacy.event_days d on d.day_id = s.day_id group by 1) d),
  (select string_agg(left(project_id::text, 8) || '=' || n, ',' order by project_id) from (select d.project_id, count(*) n from public.agenda_slots s join public.agenda_days d on d.id = s.day_id group by 1) d));
select migration.check((select id from _r), 'V09.1 agenda checksum (old side with the fixup applied)',
  (select md5(string_agg(s.slot_id::text || s.start_time || coalesce((select f.new_value from migration.fixups f where f.entity = 'agenda_slots' and f.ref_id = s.slot_id::text and f.column_name = 'end_time'), s.end_time)
                         || s.slot_title || coalesce(nullif(btrim(s.slot_title_ar),''), '') || coalesce(nullif(btrim(s.presenter_name),''), '') || coalesce(s.sort_order::text, ''), ',' order by s.slot_id))
   from legacy.agenda_slots s),
  (select md5(string_agg(id::text || to_char(start_time, 'HH24:MI') || to_char(end_time, 'HH24:MI') || title_en || coalesce(title_ar, '') || coalesce(presenter_en, '') || sort_order::text, ',' order by id)) from public.agenda_slots));
select migration.check((select id from _r), 'V09.1 the fixed slot now ends 16:30 and the old value is logged', '16:30/04:30',
  (select to_char(a.end_time, 'HH24:MI') || '/' || substring(f.reason from 'old value: ([0-9:]+)') from public.agenda_slots a join migration.fixups f on f.ref_id = a.id::text and f.entity = 'agenda_slots'));
select migration.check((select id from _r), 'V09.2 bullet items',
  (select coalesce(sum(greatest(case when jsonb_typeof(bullet_points) = 'array' then jsonb_array_length(bullet_points) else 0 end, case when jsonb_typeof(bullet_points_ar) = 'array' then jsonb_array_length(bullet_points_ar) else 0 end)), 0)::text from legacy.agenda_slots),
  (select coalesce(sum(jsonb_array_length(bullets)), 0)::text from public.agenda_slots));
select migration.check((select id from _r), 'V09.3 resources by event',
  (select string_agg(left(event_id::text, 8) || '=' || n, ',' order by event_id) from (select event_id, count(*) n from legacy.library_resources group by 1) x),
  (select string_agg(left(project_id::text, 8) || '=' || n, ',' order by project_id) from (select project_id, count(*) n from public.resources group by 1) x));
select migration.check((select id from _r), 'V09.3 resources bucket files vs external',
  (select (select count(*) from legacy.library_resources where url like '%/storage/v1/object/public/event-assets/%') || '/' || (select count(*) from legacy.library_resources where url not like '%/storage/v1/object/public/event-assets/%')),
  (select (select count(*) from public.resources where file_path is not null) || '/' || (select count(*) from public.resources where url is not null)));
select migration.check((select id from _r), 'V09.4 landing_cards', (select count(*)::text from legacy.join_athar_cards), (select count(*)::text from public.landing_cards));
select migration.check((select id from _r), 'V09.4 node_events = analytics + form shares',
  ((select count(*) from legacy.join_athar_analytics) + (select count(*) from legacy.form_share_events))::text, (select count(*)::text from public.node_events));
select migration.check_design((select id from _r), 'D09.1 design: days 37 / slots 248 / resources 26 / cards 4 / events 26', '37/248/26/4/26',
  (select (select count(*) from public.agenda_days) || '/' || (select count(*) from public.agenda_slots) || '/' || (select count(*) from public.resources) || '/' ||
          (select count(*) from public.landing_cards) || '/' || (select count(*) from public.node_events)));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
