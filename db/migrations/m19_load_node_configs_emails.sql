-- m19_load_node_configs_emails  (05 phase 12; STAGE 2a, LOCAL ONLY)
-- Writes nodes.config ONLY for keys that differ from the node-type default, e-mail templates deduplicated (64 cells -> defaults kept in
-- migration.email_template_defaults + 4 per-node overrides), admin/cc recipient lists, landing/form/agenda settings.
-- Key names follow the implemented RPCs: config.emails.<email_key> {subject, body_html, admin, cc}, config.thank_you (get_public_form).
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m19_load_node_configs_emails') as id;
\o /dev/null

-- ---------------------------------------------------------------- e-mail template dedup
create temp table t_tplsrc on commit drop as
select e.event_id, g.k, g.subj, g.body, g.admin, g.cc
from legacy.events e cross join lateral (values
  ('interview',  e.interview_email_template_subject,  e.interview_email_template_body,  e.interview_admin_emails,  e.interview_cc_emails),
  ('rejection',  e.rejection_email_template_subject,  e.rejection_email_template_body,  e.rejection_admin_emails,  e.rejection_cc_emails),
  ('acceptance', e.acceptance_email_template_subject, e.acceptance_email_template_body, e.acceptance_admin_emails, e.acceptance_cc_emails),
  ('mentor',     e.mentor_email_template_subject,     e.mentor_email_template_body,     e.mentor_admin_emails,     e.mentor_cc_emails)) g(k, subj, body, admin, cc);

create temp table t_tpldef on commit drop as
select distinct on (k) k, subj, body, n from (select k, subj, body, count(*) n from t_tplsrc group by k, subj, body) x order by k, n desc;

insert into migration.email_template_defaults (node_type, email_key, subject, body_html, used_by_events, note)
select case d.k when 'mentor' then 'booking' else 'selection' end, case d.k when 'mentor' then 'booking_confirmation' else d.k end,
       d.subj, d.body, d.n::int, 'most common legacy variant (kept here; the node-type default in code must be seeded from it)'
from t_tpldef d where d.subj is not null or d.body is not null
on conflict (node_type, email_key) do nothing;

create temp table t_tplnode on commit drop as
select n.id node_id, s.k,
       nullif(jsonb_strip_nulls(jsonb_build_object(
         'subject',   case when (s.subj, s.body) is distinct from (d.subj, d.body) then s.subj end,
         'body_html', case when (s.subj, s.body) is distinct from (d.subj, d.body) then s.body end,
         'admin',     case when coalesce(cardinality(s.admin), 0) > 0 then to_jsonb(s.admin) end,
         'cc',        case when coalesce(cardinality(s.cc), 0) > 0 then to_jsonb(s.cc) end)), '{}'::jsonb) obj,
       ((s.subj, s.body) is distinct from (d.subj, d.body)) is_override
from t_tplsrc s join t_tpldef d on d.k = s.k
join public.nodes n on n.project_id = s.event_id and ((s.k <> 'mentor' and n.type = 'selection') or (s.k = 'mentor' and n.type = 'booking' and n.name_en = 'Mentor booking'));

-- ---------------------------------------------------------------- config per node type
create temp table t_cfg on commit drop as
-- agenda
select migration.nid(e.event_id::text||':agenda') id,
       jsonb_strip_nulls(jsonb_build_object(
         'header', nullif(coalesce(e.header_settings, '{}'::jsonb) - 'customExpertsLabel' - 'customExpertsLabelAr' - 'hideExpertListTitle', '{}'::jsonb),
         'showDayNames', case when e.show_day_names is false then false end,
         'headerHeight', case when nullif(btrim(e.header_height),'') is not null and btrim(e.header_height) <> '16rem' then btrim(e.header_height) end,
         'legacySheetUrl', nullif(btrim(e.gsheets_url),''),
         'backgroundPath', migration.register_asset('agenda-background', e.event_id, e.background_image_url, 'nodes', migration.nid(e.event_id::text||':agenda')::text, 'config.backgroundPath'),
         'footerPath', migration.register_asset('agenda-footer', e.event_id, e.footer_image_url, 'nodes', migration.nid(e.event_id::text||':agenda')::text, 'config.footerPath'))) cfg
from legacy.events e
union all
-- expert lists: hideTitle, accent when not the default colour
select migration.nid(e.event_id::text||':list_experts'),
       jsonb_strip_nulls(jsonb_build_object('hideTitle', case when (e.header_settings->>'hideExpertListTitle') = 'true' then true end,
                                            'accent', case when nullif(btrim(e.experts_color),'') is not null and lower(btrim(e.experts_color)) <> '#9333ea' then btrim(e.experts_color) end))
from legacy.events e
union all
select migration.nid(e.event_id::text||':list_companies'),
       jsonb_strip_nulls(jsonb_build_object('accent', case when nullif(btrim(e.startups_color),'') is not null and lower(btrim(e.startups_color)) <> '#059669' then btrim(e.startups_color) end))
from legacy.events e
union all
-- selection: sheet import + e-mail overrides / recipients
select n.id,
       jsonb_strip_nulls(jsonb_build_object(
         'sheetImport', case when nullif(btrim(e.selection_process_gsheets_url),'') is not null
                             then jsonb_build_object('enabled', false, 'url', btrim(e.selection_process_gsheets_url)) end,
         'emails', nullif((select jsonb_object_agg(t.k, t.obj) from t_tplnode t where t.node_id = n.id and t.obj is not null), '{}'::jsonb)))
from public.nodes n join legacy.events e on e.event_id = n.project_id where n.type = 'selection'
union all
-- mentor booking: recipients (template is the default on 16/16 events)
select n.id,
       jsonb_strip_nulls(jsonb_build_object('emails', (select jsonb_build_object('booking_confirmation', t.obj) from t_tplnode t where t.node_id = n.id and t.obj is not null)))
from public.nodes n where n.type = 'booking' and n.name_en = 'Mentor booking'
union all
-- native forms
select f.form_id,
       jsonb_strip_nulls(jsonb_build_object(
         'thank_you', nullif(jsonb_strip_nulls(jsonb_build_object('message', nullif(btrim(f.thank_you_message),''),
                         'image_path', migration.register_asset('thank-you', f.event_id, f.thank_you_image_url, 'nodes', f.form_id::text, 'config.thank_you.image_path'),
                         'show_image', case when f.show_thank_you_image is not null then f.show_thank_you_image end)), '{}'::jsonb),
         'social', case when f.social_channels_config is not null and f.social_channels_config <> '{}'::jsonb then f.social_channels_config end,
         'description', nullif(btrim(f.description),''),
         'show_in_card', (select jsonb_agg(q.field_name order by q.display_order) from legacy.form_field_configs q where q.form_id = f.form_id and q.show_in_card)))
from legacy.event_forms f
union all
-- Legacy-import forms
select migration.nid(e.event_id::text||':form_legacy'),
       jsonb_build_object('legacy_import', true, 'description', 'Responses migrated from the legacy company_submissions table; the sheet headers are the question labels (answers re-keyed q001...).')
from legacy.events e
union all
-- landing page
select p.id,
       jsonb_strip_nulls(jsonb_build_object(
         'hero', nullif(jsonb_strip_nulls(jsonb_build_object('coverPath', migration.register_asset('landing', p.project_id::uuid, p.cover_url, 'nodes', p.id::text, 'config.hero.coverPath'))), '{}'::jsonb),
         'title', nullif(btrim(p.main_title),''), 'layoutColumns', p.layout_columns))
from legacy.join_athar_pages p;

update public.nodes n set config = c.cfg
from t_cfg c
where n.id = c.id and c.cfg <> '{}'::jsonb and n.config is distinct from c.cfg;

select migration.flag('form_show_in_card_config', 'info', 'form', f.form_id::text,
  (select count(*) from legacy.form_field_configs q where q.form_id = f.form_id and q.show_in_card)::text || ' questions had show_in_card=true: stored as node config.show_in_card (list card config for the PM to review)')
from legacy.event_forms f where exists (select 1 from legacy.form_field_configs q where q.form_id = f.form_id and q.show_in_card);
select migration.flag('legacy_portal_settings_not_carried', 'info', 'project', e.event_id::text, 'legacy company/expert portal switches/messages/deadline and admin_email are not carried (portals replaced by public forms); values stay in legacy.events')
from legacy.events e
where nullif(btrim(e.admin_email),'') is not null or nullif(btrim(e.company_portal_message),'') is not null or nullif(btrim(e.expert_portal_message),'') is not null or e.submission_deadline is not null;

-- ================================================================= verification
select migration.check((select id from _r), 'V12.2 template overrides present (node, key)', '4',
  (select count(*)::text from public.nodes n, jsonb_each(n.config->'emails') e where e.value ? 'subject' or e.value ? 'body_html'));
select migration.check((select id from _r), 'V12.2 overrides on the right events (interview/rejection/acceptance bdf9, acceptance c82e)',
  'bdf987a0:acceptance,bdf987a0:interview,bdf987a0:rejection,c82e422f:acceptance',
  (select string_agg(left(n.project_id::text, 8) || ':' || e.key, ',' order by n.project_id::text, e.key) from public.nodes n, jsonb_each(n.config->'emails') e where e.value ? 'subject' or e.value ? 'body_html'));
select migration.check((select id from _r), 'V12.2 default template sets kept (distinct non-null variants)', '3',
  (select count(*)::text from migration.email_template_defaults));
select migration.check((select id from _r), 'V12.2 recipient lists preserved',
  (select count(*)::text from t_tplsrc where coalesce(cardinality(admin), 0) + coalesce(cardinality(cc), 0) > 0),
  (select count(*)::text from (select 1 from public.nodes n, jsonb_each(n.config->'emails') e where e.value ? 'admin' or e.value ? 'cc') x));
select migration.check((select id from _r), 'V12.3 every config is a JSON object within the size cap', '0',
  (select count(*)::text from public.nodes where jsonb_typeof(config) <> 'object' or octet_length(config::text) > 262144));
select migration.check((select id from _r), 'V12.1 nodes with an empty config', (select count(*)::text from public.nodes n where n.id not in (select id from t_cfg where cfg <> '{}'::jsonb)),
  (select count(*)::text from public.nodes where config = '{}'::jsonb));
select migration.check_design((select id from _r), 'D12.1 design: 64 template cells -> 4 overrides', '4',
  (select count(*)::text from t_tplnode where is_override));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
