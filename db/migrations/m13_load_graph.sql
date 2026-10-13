-- m13_load_graph  (05 phase 6; STAGE 2a, LOCAL ONLY)
-- Derives, per event, the nodes it actually uses (04 4.4), their list/booking_settings extension rows, the edges that reproduce today's
-- implicit connections, and the public links + slugs (legacy_ref keeps old event/form/mentor ids working).
-- Derived ids are UUIDv5 (migration.nid); native forms and the landing page keep their old ids.
-- Extension rows of forms / distributions are written by m14 / m18 (they need covers, templates and day configs).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m13_load_graph') as id;
\o /dev/null

-- ---------------------------------------------------------------- node plan
create temp table t_nodes on commit drop as
with ev as (select e.* from legacy.events e)
select migration.nid(e.event_id||':view_host') id, e.event_id project_id, 'view_host' type, 'view_host' role, 'Project page' name_en, 'صفحة المشروع' name_ar,
       'public' visibility, true is_system, e.created_at, 0 rank, e.event_id::text old_id
from ev e
union all
select migration.nid(e.event_id||':agenda'), e.event_id, 'agenda', 'agenda', 'Agenda', 'الأجندة', 'public', false, e.created_at, 1, e.event_id::text
from ev e where exists (select 1 from legacy.event_days d where d.event_id = e.event_id)
  or nullif(btrim(e.header_image_url),'') is not null or nullif(btrim(e.background_image_url),'') is not null
  or nullif(btrim(e.footer_image_url),'') is not null or (e.header_settings is not null and e.header_settings <> '{}'::jsonb)
  or nullif(btrim(e.gsheets_url),'') is not null
union all
select f.form_id, f.event_id, 'form_builder', 'form', f.form_name, nullif(btrim(f.form_name_ar),''),
       case when coalesce(f.is_active, true) then 'public' else 'private' end, false, f.created_at, 2, f.form_id::text
from legacy.event_forms f where f.event_id in (select event_id from ev)
union all
select migration.nid(e.event_id||':form_legacy'), e.event_id, 'form_builder', 'form_legacy', 'Legacy import', 'استيراد قديم', 'private', false, e.created_at, 2, e.event_id::text
from ev e where exists (select 1 from legacy.company_submissions s where s.event_id = e.event_id and s.form_id is null)
union all
select migration.nid(e.event_id||':selection'), e.event_id, 'selection', 'selection', 'Selection', 'عملية الاختيار', 'private', false, e.created_at, 3, e.event_id::text
from ev e where exists (select 1 from legacy.company_submissions s where s.event_id = e.event_id)
  or exists (select 1 from legacy.event_forms f where f.event_id = e.event_id and f.target_module = 'selection_process')
union all
select migration.nid(e.event_id||':list_experts'), e.event_id, 'list', 'list_experts', 'Experts', 'الخبراء', 'public', false, e.created_at, 4, e.event_id::text
from ev e where exists (select 1 from legacy.experts x where x.event_id = e.event_id) or exists (select 1 from legacy.mentors m where m.event_id = e.event_id::text)
union all
select migration.nid(e.event_id||':list_companies'), e.event_id, 'list', 'list_companies', 'Companies', 'الشركات', 'public', false, e.created_at, 4, e.event_id::text
from ev e where exists (select 1 from legacy.companies c where c.event_id = e.event_id)
union all
select migration.nid(e.event_id||':list_team'), e.event_id, 'list', 'list_team', 'Athar team', 'فريق أثر', 'private', false, e.created_at, 4, e.event_id::text
from ev e where exists (select 1 from legacy.ather_team_members t where t.event_id = e.event_id::text)
union all
select migration.nid(e.event_id||':booking_mentor'), e.event_id, 'booking', 'booking_mentor', 'Mentor booking', 'حجز المنتورز', 'public', false, e.created_at, 5, e.event_id::text
from ev e where exists (select 1 from legacy.mentors m where m.event_id = e.event_id::text)
union all
select migration.nid(e.event_id||':booking_interview'), e.event_id, 'booking', 'booking_interview', 'Interview booking', 'حجز المقابلات', 'public', false, e.created_at, 5, e.event_id::text
from ev e where exists (select 1 from legacy.ather_team_members t where t.event_id = e.event_id::text)
union all
select migration.nid(e.event_id||':distribution'), e.event_id, 'distribution', 'distribution', 'Mentoring distribution', 'توزيع المنتورينج', 'public', false, e.created_at, 6, e.event_id::text
from ev e where exists (select 1 from legacy.mentoring_distribution_config c where c.event_id = e.event_id::text)
union all
select migration.nid(e.event_id||':library'), e.event_id, 'library', 'library', 'Library', 'المكتبة', 'public', false, e.created_at, 7, e.event_id::text
from ev e where exists (select 1 from legacy.library_resources r where r.event_id = e.event_id)
union all
select p.id, p.project_id::uuid, 'landing_page', 'landing', p.main_title, null, 'public', false, p.created_at, 8, p.id::text
from legacy.join_athar_pages p where p.project_id::uuid in (select event_id from ev);

insert into public.nodes (id, project_id, type, type_version, name_en, name_ar, visibility, is_system, created_at, updated_at)
select n.id, n.project_id, n.type, (select latest_version from public.node_types t where t.key = n.type), n.name_en, n.name_ar,
       n.visibility, n.is_system, n.created_at, n.created_at
from t_nodes n
on conflict (id) do nothing;

insert into migration.id_map(entity, old_id, new_id, note)
select 'node:' || n.role, n.old_id, n.id, 'derived node (05 4.4)' from t_nodes n
where n.role not in ('form','landing')
on conflict do nothing;

-- canvas layout: a deterministic grid per project (position-only update; does not bump revisions)
update public.nodes n set position_x = g.x, position_y = g.y
from (select t.id, ((row_number() over (partition by t.project_id order by t.rank, t.id) - 1) % 4) * 360.0 x,
             ((row_number() over (partition by t.project_id order by t.rank, t.id) - 1) / 4) * 220.0 y
      from t_nodes t) g
where n.id = g.id and n.position_x = 0 and n.position_y = 0 and (g.x <> 0 or g.y <> 0);

-- ---------------------------------------------------------------- lists (subkind) and booking settings
insert into public.lists (node_id, project_id, subkind)
select n.id, n.project_id, case n.role when 'list_companies' then 'company' else 'expert' end
from t_nodes n where n.type = 'list'
on conflict (node_id) do nothing;

insert into public.booking_settings (node_id, project_id, mode, default_advance_notice_min, meeting_link_mode, shared_meet_link)
select n.id, n.project_id, case n.role when 'booking_mentor' then 'mentor' else 'interview' end, 1440,
       case when e.meeting_link_mode = 'shared' and nullif(btrim(e.shared_google_meet_link),'') is not null then 'shared' else 'unique' end,
       case when e.meeting_link_mode = 'shared' and nullif(btrim(e.shared_google_meet_link),'') is not null then btrim(e.shared_google_meet_link) end
from t_nodes n join legacy.events e on e.event_id = n.project_id
where n.type = 'booking'
on conflict (node_id) do nothing;
select migration.flag('meeting_link_shared_without_link', 'review', 'project', e.event_id::text, 'meeting_link_mode=shared but shared link is empty: loaded as unique')
from legacy.events e where e.meeting_link_mode = 'shared' and nullif(btrim(e.shared_google_meet_link),'') is null;

-- ---------------------------------------------------------------- edges
-- (a) tabs on the view host (today's getAgendaTabs): Agenda, Experts (only when real expert rows exist), Companies, Library, Landing
insert into public.edges (id, project_id, from_node_id, from_port, to_node_id, to_port, family, audience, label_en, label_ar, order_index)
select migration.nid('edge:tab:' || n.id::text), n.project_id, n.id,
       case n.role when 'agenda' then 'agenda' when 'library' then 'library-tab' when 'landing' then 'landing-tab' else 'list-tab' end,
       migration.nid(n.project_id::text || ':view_host'), 'tabs', 'view', 'public',
       case when n.role = 'list_experts' then nullif(btrim(e.header_settings->>'customExpertsLabel'), '') end,
       case when n.role = 'list_experts' then nullif(btrim(e.header_settings->>'customExpertsLabelAr'), '') end,
       case n.role when 'agenda' then 0 when 'list_experts' then 1 when 'list_companies' then 2 when 'library' then 3 else 4 end
from t_nodes n join legacy.events e on e.event_id = n.project_id
where n.role in ('agenda','library','landing','list_companies')
   or (n.role = 'list_experts' and exists (select 1 from legacy.experts x where x.event_id = n.project_id))
on conflict (from_node_id, from_port, to_node_id, to_port) do nothing;

-- (b) form responses feed the selection node (selection_process forms and every Legacy-import form)
insert into public.edges (id, project_id, from_node_id, from_port, to_node_id, to_port, family, audience, order_index)
select migration.nid('edge:sel:' || n.id::text), n.project_id, n.id, 'responses', migration.nid(n.project_id::text || ':selection'), 'applicants',
       'rows:form-response', 'platform', 0
from t_nodes n
where (n.role = 'form_legacy'
       or (n.role = 'form' and exists (select 1 from legacy.event_forms f where f.form_id = n.id and f.target_module = 'selection_process')))
  and exists (select 1 from t_nodes s where s.id = migration.nid(n.project_id::text || ':selection'))
on conflict (from_node_id, from_port, to_node_id, to_port) do nothing;

-- (c) distribution reads the event's experts and companies
insert into public.edges (id, project_id, from_node_id, from_port, to_node_id, to_port, family, audience, order_index)
select migration.nid('edge:dist:' || l.id::text), l.project_id, l.id, 'items', d.id,
       case l.role when 'list_experts' then 'mentors' else 'companies' end, 'rows:list-item', 'platform', 0
from t_nodes d join t_nodes l on l.project_id = d.project_id and l.role in ('list_experts','list_companies')
where d.role = 'distribution'
on conflict (from_node_id, from_port, to_node_id, to_port) do nothing;

-- (d) booking providers come from the expert list (mentor mode) / the Athar-team list (interview mode)
insert into public.edges (id, project_id, from_node_id, from_port, to_node_id, to_port, family, audience, order_index)
select migration.nid('edge:book:' || l.id::text || b.id::text), l.project_id, l.id, 'items', b.id, 'mentors', 'rows:list-item', 'platform', 0
from t_nodes b join t_nodes l on l.project_id = b.project_id
 and ((b.role = 'booking_mentor' and l.role = 'list_experts') or (b.role = 'booking_interview' and l.role = 'list_team'))
where b.type = 'booking'
on conflict (from_node_id, from_port, to_node_id, to_port) do nothing;

-- Selection(interview stage) -> Booking(bookers) is deliberately NOT created (would newly restrict who can book; PM decision, 05 4.4)

-- ---------------------------------------------------------------- public links
create temp table t_links on commit drop as
select migration.nid(e.event_id::text||':link:agenda') id, e.event_id project_id, migration.nid(e.event_id::text||':view_host') node_id, 'agenda' kind,
       null::text view_key, e.event_id legacy_ref, nullif(btrim(e.seo_title),'') og_t, nullif(btrim(e.seo_description),'') og_d, e.seo_image_url og_img,
       e.created_at, 0 ord, e.event_id::text refid,
       trim(both '-' from regexp_replace(lower(btrim(e.event_name)), '[^a-z0-9]+', '-', 'g')) name_slug
from legacy.events e
union all
select migration.nid(f.form_id::text||':link:form'), f.event_id, f.form_id, 'form', null, f.form_id, nullif(btrim(f.share_title),''), nullif(btrim(f.share_description),''),
       f.share_image_url, f.created_at, 1, f.form_id::text, null
from legacy.event_forms f where f.event_id in (select event_id from legacy.events)
union all
select migration.nid(m.id::text||':link:booking'), m.event_id::uuid, migration.nid(m.event_id||':booking_mentor'), 'booking', m.id::text, m.id, null, null, null,
       m.created_at, 2, m.id::text, null
from legacy.mentors m where m.event_id in (select event_id::text from legacy.events)
union all
select migration.nid(t.id::text||':link:booking'), t.event_id::uuid, migration.nid(t.event_id||':booking_interview'), 'booking', t.id::text, t.id, null, null, null,
       t.created_at, 2, t.id::text, null
from legacy.ather_team_members t where t.event_id in (select event_id::text from legacy.events)
union all
select migration.nid(d.event_id||':link:view:'||v.k), d.event_id::uuid, migration.nid(d.event_id||':distribution'), 'view', v.k, null, null, null, null,
       d.created_at, 3, d.event_id||':'||v.k, null
from legacy.mentoring_distribution_config d cross join (values ('matrix'),('live')) v(k)
where d.event_id in (select event_id::text from legacy.events);

insert into public.public_links (id, project_id, node_id, kind, view_key, legacy_ref, og_title_en, og_description_en, og_image_path, created_at, updated_at)
select l.id, l.project_id, l.node_id, l.kind, l.view_key, l.legacy_ref, l.og_t, l.og_d,
       migration.register_asset('og', l.project_id, l.og_img, 'public_links', l.id::text, 'og_image_path'), l.created_at, l.created_at
from t_links l
where exists (select 1 from public.nodes n where n.id = l.node_id)
on conflict (id) do nothing;

-- slugs: the 16 agenda links keep their name-derived slug (old name-style URLs); every other link gets a deterministic 10-char code
insert into public.public_link_slugs (slug, link_id, is_current)
select s.slug, s.id, true
from (select l.id,
             case when l.name_slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'
                       and row_number() over (partition by l.name_slug order by l.id) = 1
                  then l.name_slug
                  else substr(encode(extensions.digest(coalesce(l.legacy_ref::text, l.refid || ':' || l.kind), 'sha256'), 'hex'), 1, 10) end slug
      from t_links l where exists (select 1 from public.public_links p where p.id = l.id)) s
on conflict (slug) do nothing;

-- ================================================================= verification
select migration.check((select id from _r), 'V06.1 nodes = plan', (select count(*)::text from t_nodes), (select count(*)::text from public.nodes));
select migration.check((select id from _r), 'V06.1 nodes by type',
  (select string_agg(type || '=' || n, ',' order by type) from (select type, count(*) n from t_nodes group by 1) x),
  (select string_agg(type || '=' || n, ',' order by type) from (select type, count(*) n from public.nodes group by 1) x));
select migration.check((select id from _r), 'V06.2 every node has a revision row', '0',
  (select count(*)::text from public.nodes n where not exists (select 1 from public.node_revisions r where r.node_id = n.id)));
select migration.check((select id from _r), 'V06.3 edges: no project mismatch', '0',
  (select count(*)::text from public.edges e join public.nodes a on a.id = e.from_node_id join public.nodes b on b.id = e.to_node_id where a.project_id <> e.project_id or b.project_id <> e.project_id));
select migration.check((select id from _r), 'V06.4 no cycle in any family', '0',
  (select count(*)::text from public.edges e where app_private.edge_has_cycle(e.id, e.from_node_id, e.to_node_id, e.family)));
select migration.check((select id from _r), 'V06.5 public_links = plan', (select count(*)::text from t_links), (select count(*)::text from public.public_links));
select migration.check((select id from _r), 'V06.5 legacy_ref distinct', '0', (select count(*)::text from (select legacy_ref from public.public_links where legacy_ref is not null group by 1 having count(*) > 1) x));
select migration.check((select id from _r), 'V06.6 slugs = links, one current each', (select count(*)::text from public.public_links),
  (select count(*)::text from public.public_link_slugs s where s.is_current));
select migration.check((select id from _r), 'V06.6 name-derived slugs on agenda links', '16',
  (select count(*)::text from public.public_link_slugs s join public.public_links l on l.id = s.link_id where l.kind = 'agenda' and length(s.slug) <> 10 or (l.kind = 'agenda' and s.slug ~ '[g-z-]')));
select migration.check_design((select id from _r), 'D06.1 design: nodes 82 / edges 53 / links 33 / slugs 33', '82/53/33/33',
  (select (select count(*) from public.nodes) || '/' || (select count(*) from public.edges) || '/' || (select count(*) from public.public_links) || '/' || (select count(*) from public.public_link_slugs)));
select migration.check_design((select id from _r), 'D06.2 design: edges tab34/sel9/dist4/book6', '34/9/4/6',
  (select (select count(*) from public.edges where to_port = 'tabs') || '/' || (select count(*) from public.edges where to_port = 'applicants') || '/' ||
          (select count(*) from public.edges e join public.nodes n on n.id = e.to_node_id where n.type = 'distribution') || '/' ||
          (select count(*) from public.edges e join public.nodes n on n.id = e.to_node_id where n.type = 'booking')));
select migration.check_design((select id from _r), 'D06.3 design: per type', 'agenda=14,booking=6,distribution=2,form_builder=12,landing_page=1,library=3,list=20,selection=8,view_host=16',
  (select string_agg(type || '=' || n, ',' order by type) from (select type, count(*) n from public.nodes group by 1) x));

select migration.finish_run((select id from _r));
\o
select check_key, expected, actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
