-- m15_load_lists_selection  (05 phase 8; STAGE 2a, LOCAL ONLY)
-- list_items: expert list (old expert_id preserved, +2 hidden provider-only items), Athar-team list, company list (old company_id preserved,
-- founder text / role / card config / sort order in the overlay), selection items (old submission_id preserved; status map approved/displayed ->
-- accepted with overlay.legacy_status), selection_reviews.  Participants stay virtual (08 02-7).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m15_load_lists_selection') as id;
\o /dev/null

-- ---------------------------------------------------------------- expert list items
insert into public.list_items (id, project_id, list_node_id, source_kind, network_expert_id, excluded, sort_order, overlay, created_at, updated_at)
select e.expert_id, e.event_id, migration.nid(e.event_id::text||':list_experts'), 'network_expert', e.master_id, false, e.sort_order,
       case when nullif(btrim(e.role),'') is not null then jsonb_build_object('role', btrim(e.role)) else '{}'::jsonb end,
       ev.created_at, ev.created_at
from legacy.experts e join legacy.events ev on ev.event_id = e.event_id
where exists (select 1 from public.network_experts n where n.id = e.master_id)
on conflict (id) do nothing;

-- provider-only mentors (not in the event's expert list): hidden items so the Experts tab shows exactly what it shows today (OD-19)
insert into public.list_items (id, project_id, list_node_id, source_kind, network_expert_id, excluded, sort_order, overlay, created_at, updated_at)
select migration.nid('provider-item:'||m.id::text), m.event_id::uuid, migration.nid(m.event_id||':list_experts'), 'network_expert', m.master_id::uuid, true, null,
       jsonb_build_object('provider_only', true), ev.created_at, ev.created_at
from legacy.mentors m join legacy.events ev on ev.event_id::text = m.event_id
where not exists (select 1 from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id)
  and exists (select 1 from public.network_experts n where n.id = m.master_id::uuid)
on conflict (id) do nothing;
insert into migration.id_map(entity, old_id, new_id, note)
select 'provider_item', m.id::text, migration.nid('provider-item:'||m.id::text), 'hidden list item for a provider that is not in the expert list'
from legacy.mentors m
where not exists (select 1 from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id)
on conflict do nothing;

-- Athar-team list items
insert into public.list_items (id, project_id, list_node_id, source_kind, network_expert_id, excluded, sort_order, overlay, created_at, updated_at)
select migration.nid('team-item:'||t.id::text), t.event_id::uuid, migration.nid(t.event_id||':list_team'), 'network_expert', t.id, false, null, '{}'::jsonb,
       ev.created_at, ev.created_at
from legacy.ather_team_members t join legacy.events ev on ev.event_id::text = t.event_id
on conflict (id) do nothing;
insert into migration.id_map(entity, old_id, new_id, note)
select 'team_item', t.id::text, migration.nid('team-item:'||t.id::text), 'Athar team list item' from legacy.ather_team_members t
where t.event_id in (select event_id::text from legacy.events) on conflict do nothing;

-- ---------------------------------------------------------------- company list items (merged companies are not re-created)
insert into public.list_items (id, project_id, list_node_id, source_kind, company_id, sort_order, overlay, created_at, updated_at)
select c.company_id, c.event_id, migration.nid(c.event_id::text||':list_companies'), 'company', c.company_id, c.sort_order,
       jsonb_strip_nulls(jsonb_build_object('founder_name', nullif(btrim(c.founder),''), 'founder_name_ar', nullif(btrim(c.founder_ar),''),
                                            'founder_role', nullif(btrim(c.role),''),
                                            'card', jsonb_build_object('show', coalesce(c.display_config, '{}'::jsonb)))),
       ev.created_at, ev.created_at
from legacy.companies c join legacy.events ev on ev.event_id = c.event_id
where c.company_id not in (select drop_id from migration.company_merges)
  and exists (select 1 from public.companies x where x.id = c.company_id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- selection items (id = submission_id)
insert into public.list_items (id, project_id, list_node_id, source_kind, form_response_id, status, overlay, created_at, updated_at)
select s.submission_id, s.event_id, migration.nid(s.event_id::text||':selection'), 'form_response', s.submission_id,
       case s.status when 'approved' then 'accepted' when 'displayed' then 'accepted' else s.status end,
       jsonb_strip_nulls(jsonb_build_object(
         'tech_status', nullif(btrim(s.additional_data->>'tech_status'),''),
         'legacy_status', case when s.status = 'displayed' then 'displayed' end,
         'previous_reasons', nullif(jsonb_strip_nulls(jsonb_build_object(
            'rejected', case when s.status <> 'rejected' then nullif(btrim(s.additional_data->>'rejected_reason'),'') end,
            'holding',  case when s.status <> 'holding'  then nullif(btrim(s.additional_data->>'holding_reason'),'')  end,
            'approved', case when s.status <> 'approved' then nullif(btrim(s.additional_data->>'approved_reason'),'') end)), '{}'::jsonb))),
       coalesce(s.created_at, s.submitted_at, now()), coalesce(s.updated_at, s.created_at, now())
from legacy.company_submissions s
where exists (select 1 from public.form_responses r where r.id = s.submission_id)
on conflict (id) do nothing;

insert into public.selection_reviews (item_id, project_id, reason, reviewed_at)
select s.submission_id, s.event_id,
       case s.status when 'rejected' then nullif(btrim(s.additional_data->>'rejected_reason'),'')
                     when 'holding'  then nullif(btrim(s.additional_data->>'holding_reason'),'')
                     when 'approved' then nullif(btrim(s.additional_data->>'approved_reason'),'') end,
       s.reviewed_at
from legacy.company_submissions s
where exists (select 1 from public.list_items i where i.id = s.submission_id)
  and ((case s.status when 'rejected' then nullif(btrim(s.additional_data->>'rejected_reason'),'')
                      when 'holding'  then nullif(btrim(s.additional_data->>'holding_reason'),'')
                      when 'approved' then nullif(btrim(s.additional_data->>'approved_reason'),'') end) is not null or s.reviewed_at is not null)
on conflict (item_id) do nothing;

select migration.flag('duplicate_applicant_names', 'info', 'project', t.event_id::text, t.n::text || ' applicant names appear more than once in this event (kept as separate responses)')
from (select s.event_id, count(*) n from (select event_id, lower(btrim(startup_name)) k, count(*) c from legacy.company_submissions group by 1, 2 having count(*) > 1) s group by 1) t;

-- ================================================================= verification
create temp table t_plan on commit drop as select drop_id id from migration.company_merge_plan union select keep_id from migration.company_merge_plan;

select migration.check((select id from _r), 'V08.1 expert items = experts + hidden provider-only',
  ((select count(*) from legacy.experts) + (select count(*) from legacy.mentors m where not exists (select 1 from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id)))::text,
  (select count(*)::text from public.list_items i join public.lists l on l.node_id = i.list_node_id where l.subkind = 'expert' and i.network_expert_id is not null
     and i.list_node_id not in (select n.id from public.nodes n where n.name_en = 'Athar team' and n.type = 'list')));
select migration.check((select id from _r), 'V08.1 hidden provider-only items', (select count(*)::text from legacy.mentors m where not exists (select 1 from legacy.experts e where e.event_id::text = m.event_id and e.master_id::text = m.master_id)),
  (select count(*)::text from public.list_items where excluded));
select migration.check((select id from _r), 'V08.1 team items', (select count(*)::text from public.network_experts where kind = 'team'),
  (select count(*)::text from public.list_items i join public.nodes n on n.id = i.list_node_id where n.name_en = 'Athar team'));
select migration.check((select id from _r), 'V08.1 company items = companies - collapsed merges',
  ((select count(*) from legacy.companies) - (select coalesce(sum((result->>'items_collapsed')::int), 0) from migration.company_merges))::text,
  (select count(*)::text from public.list_items where source_kind = 'company'));
select migration.check((select id from _r), 'V08.1 selection items = submissions', (select count(*)::text from legacy.company_submissions),
  (select count(*)::text from public.list_items where source_kind = 'form_response'));
select migration.check((select id from _r), 'V08.3 selection status histogram (mapped)',
  (select string_agg(st || '=' || n, ',' order by st) from (select case status when 'approved' then 'accepted' when 'displayed' then 'accepted' else status end st, count(*) n from legacy.company_submissions group by 1) x),
  (select string_agg(status || '=' || n, ',' order by status) from (select status, count(*) n from public.list_items where source_kind = 'form_response' group by 1) x));
select migration.check((select id from _r), 'V08.3 selection checksum md5(id||status)',
  (select md5(string_agg(submission_id::text || case status when 'approved' then 'accepted' when 'displayed' then 'accepted' else status end, ',' order by submission_id)) from legacy.company_submissions),
  (select md5(string_agg(id::text || status, ',' order by id)) from public.list_items where source_kind = 'form_response'));
select migration.check((select id from _r), 'V08.4 founder text / role / card config in overlay (items outside merges)',
  (select (select count(*) from legacy.companies where nullif(btrim(founder),'') is not null and company_id not in (select id from t_plan)) || '/' ||
          (select count(*) from legacy.companies where nullif(btrim(role),'') is not null and company_id not in (select id from t_plan)) || '/' ||
          (select count(*) from legacy.companies where company_id not in (select id from t_plan))),
  (select (select count(*) from public.list_items where source_kind = 'company' and overlay ? 'founder_name' and id not in (select id from t_plan)) || '/' ||
          (select count(*) from public.list_items where source_kind = 'company' and overlay ? 'founder_role' and id not in (select id from t_plan)) || '/' ||
          (select count(*) from public.list_items where source_kind = 'company' and overlay #> '{card,show}' is not null and id not in (select id from t_plan))));
select migration.check((select id from _r), 'V08.5 selection_reviews',
  (select count(*)::text from legacy.company_submissions s where (case s.status when 'rejected' then nullif(btrim(s.additional_data->>'rejected_reason'),'') when 'holding' then nullif(btrim(s.additional_data->>'holding_reason'),'') when 'approved' then nullif(btrim(s.additional_data->>'approved_reason'),'') end) is not null or s.reviewed_at is not null),
  (select count(*)::text from public.selection_reviews));
select migration.check((select id from _r), 'V08.6 every non-empty *_reason preserved (current + previous)',
  (select (select count(*) from legacy.company_submissions s, unnest(array['rejected_reason','holding_reason','approved_reason']) k where nullif(btrim(s.additional_data->>k),'') is not null)::text),
  (select ((select count(*) from public.selection_reviews where reason is not null) +
           (select count(*) from public.list_items i, jsonb_each(i.overlay->'previous_reasons') where i.source_kind = 'form_response'))::text));
select migration.check((select id from _r), 'V08.7 tech_status in overlay', (select count(*)::text from legacy.company_submissions where nullif(btrim(additional_data->>'tech_status'),'') is not null),
  (select count(*)::text from public.list_items where overlay ? 'tech_status'));
select migration.check((select id from _r), 'V08.8 legacy_status displayed', (select count(*)::text from legacy.company_submissions where status = 'displayed'),
  (select count(*)::text from public.list_items where overlay->>'legacy_status' = 'displayed'));
select migration.check((select id from _r), 'V08.2 no duplicate source per list', '0',
  (select count(*)::text from (select list_node_id, company_id from public.list_items where company_id is not null group by 1, 2 having count(*) > 1) x));
select migration.check_design((select id from _r), 'D08.1 design: list_items 614 / reviews 201 / participants 0', '614/201/0',
  (select (select count(*) from public.list_items) + (select coalesce(sum((result->>'items_collapsed')::int), 0) from migration.company_merges) || '/' || (select count(*) from public.selection_reviews) || '/' || (select count(*) from public.participants)));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
