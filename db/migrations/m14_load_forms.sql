-- m14_load_forms  (05 phase 7; STAGE 2a, LOCAL ONLY)
-- form_covers (+ the 2 default covers of events.form_cover_image_url), form_templates (library_forms), forms (7 native + 5 Legacy import),
-- form_sections, form_questions (56 native + generated from the sheet headers of the Legacy-import events),
-- form_responses (all company_submissions; answers re-keyed header -> qNNN; national-id keys/columns are NOT carried: owner decision 08 s8 05-b).
-- Lossless check: non-PII answered cells old = new.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m14_load_forms') as id;
\o /dev/null

-- ---------------------------------------------------------------- guards: legacy tables without a destination loader that are NON-empty are blockers
select migration.flag('unloaded_table_not_empty', 'blocker', 'table', t.n, t.n || ' has rows but no loader/destination exists')
from (select 'expert_submissions' n, count(*) c from legacy.expert_submissions) t where t.c > 0;

-- ---------------------------------------------------------------- covers
insert into public.form_covers (id, project_id, name, image_path, created_at, updated_at)
select c.cover_id, c.event_id, c.name,
       migration.register_asset('form-cover', c.event_id, c.image_url, 'form_covers', c.cover_id::text, 'image_path'), c.created_at, c.updated_at
from legacy.form_covers c
where c.event_id in (select event_id from legacy.events) and nullif(btrim(c.image_url),'') is not null
on conflict (id) do nothing;

insert into public.form_covers (id, project_id, name, image_path, created_at, updated_at)
select migration.nid(e.event_id::text||':form-cover-default'), e.event_id, 'Default form cover (migrated)',
       migration.register_asset('form-cover', e.event_id, e.form_cover_image_url, 'form_covers', migration.nid(e.event_id::text||':form-cover-default')::text, 'image_path'),
       e.created_at, e.created_at
from legacy.events e
where nullif(btrim(e.form_cover_image_url),'') is not null
on conflict (id) do nothing;
insert into migration.id_map(entity, old_id, new_id, note)
select 'form_cover_default', e.event_id::text, migration.nid(e.event_id::text||':form-cover-default'), 'events.form_cover_image_url kept as project-scoped cover (05 note 04-3)'
from legacy.events e where nullif(btrim(e.form_cover_image_url),'') is not null on conflict do nothing;

-- ---------------------------------------------------------------- templates (library_forms, global)
insert into public.form_templates (id, project_id, name_en, name_ar, description_en, definition, schema_version, cover_id, created_at, updated_at)
select l.id, null, l.form_name, nullif(btrim(l.form_name_ar),''), nullif(btrim(l.description),''),
       jsonb_strip_nulls(jsonb_build_object(
         'schema_version', 1,
         'questions', coalesce(l.fields, '[]'::jsonb),
         'settings', jsonb_strip_nulls(jsonb_build_object(
            'thank_you', jsonb_strip_nulls(jsonb_build_object('message', nullif(btrim(l.thank_you_message),''),
                           'image_path', migration.register_asset('form-cover', null, l.thank_you_image_url, 'form_templates', l.id::text, 'thank_you_image'),
                           'show_image', l.show_thank_you_image)),
            'share', jsonb_strip_nulls(jsonb_build_object('title', nullif(btrim(l.share_title),''), 'description', nullif(btrim(l.share_description),''),
                           'image_path', migration.register_asset('form-cover', null, l.share_image_url, 'form_templates', l.id::text, 'share_image'))),
            'social', l.social_channels_config,
            'cover_path', migration.register_asset('form-cover', null, l.cover_image_url, 'form_templates', l.id::text, 'cover_image'))))),
       1, (select c.id from public.form_covers c where c.id = l.cover_id), l.created_at, l.updated_at
from legacy.library_forms l
on conflict (id) do nothing;

-- ---------------------------------------------------------------- forms extension rows
insert into public.forms (node_id, project_id, template_id, cover_id, is_active, closes_at, created_at, updated_at)
select f.form_id, f.event_id, (select t.id from public.form_templates t where t.id = f.library_form_id),
       (select c.id from public.form_covers c where c.id = f.cover_id), coalesce(f.is_active, true), e.submission_deadline, f.created_at, f.updated_at
from legacy.event_forms f join legacy.events e on e.event_id = f.event_id
where exists (select 1 from public.nodes n where n.id = f.form_id)
on conflict (node_id) do nothing;

-- the Legacy-import forms never accept new submissions (is_active = false)
insert into public.forms (node_id, project_id, is_active, created_at, updated_at)
select n.id, n.project_id, false, n.created_at, n.created_at
from public.nodes n
where n.type = 'form_builder' and n.id in (select migration.nid(e.event_id::text||':form_legacy') from legacy.events e)
on conflict (node_id) do nothing;

-- ---------------------------------------------------------------- sections (old text ids kept in migration.id_map)
insert into public.form_sections (id, project_id, node_id, title_en, order_index)
select migration.nid('formsec:'||f.form_id::text||':'||(s.v->>'id')), f.event_id, f.form_id, nullif(btrim(s.v->>'title'),''),
       coalesce((s.v->>'order_index')::int, s.ord::int - 1)
from legacy.event_forms f
cross join lateral jsonb_array_elements(case when jsonb_typeof(f.integrations->'form_sections') = 'array' then f.integrations->'form_sections' else '[]'::jsonb end)
     with ordinality s(v, ord)
where exists (select 1 from public.nodes n where n.id = f.form_id) and s.v->>'id' is not null
on conflict (id) do nothing;
insert into migration.id_map(entity, old_id, new_id, note)
select 'form_section', f.form_id::text||':'||(s.v->>'id'), migration.nid('formsec:'||f.form_id::text||':'||(s.v->>'id')), 'old text section id'
from legacy.event_forms f
cross join lateral jsonb_array_elements(case when jsonb_typeof(f.integrations->'form_sections') = 'array' then f.integrations->'form_sections' else '[]'::jsonb end) s(v)
where s.v->>'id' is not null on conflict do nothing;

-- ---------------------------------------------------------------- native questions (56)
insert into public.form_questions (id, project_id, node_id, section_id, key, type, label_en, description_en, placeholder_en, is_required,
                                   options, validation, order_index)
select q.config_id, f.event_id, q.form_id,
       (select s.id from public.form_sections s where s.id = migration.nid('formsec:'||q.form_id::text||':'||(q.validation_rules->>'section_id'))),
       q.field_name, q.field_type, q.field_label,
       nullif(btrim(coalesce(nullif(btrim(q.help_text),''), q.validation_rules->>'description')), ''),
       nullif(btrim(q.placeholder),''), coalesce(q.is_required, false),
       case when jsonb_typeof(q.field_options) = 'array' and jsonb_array_length(q.field_options) > 0 then
         (select jsonb_agg(case when jsonb_typeof(o) = 'string' then jsonb_build_object('value', o #>> '{}', 'label_en', o #>> '{}') else o end)
          from jsonb_array_elements(q.field_options) o) end,
       nullif(q.validation_rules - 'section_id' - 'description', '{}'::jsonb), coalesce(q.display_order, 0)
from legacy.form_field_configs q join legacy.event_forms f on f.form_id = q.form_id
where exists (select 1 from public.nodes n where n.id = q.form_id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- Legacy-import questions from the sheet headers
create temp table t_hdr on commit drop as
with cells as (
  select s.event_id, e.key header, e.value val,
         (select min(o.ord) from jsonb_array_elements_text(case when jsonb_typeof(s.additional_data->'_column_order') = 'array'
                                                               then s.additional_data->'_column_order' else '[]'::jsonb end) with ordinality o(h, ord)
           where o.h = e.key) pos
  from legacy.company_submissions s, jsonb_each(s.additional_data) e
  where s.form_id is null and s.event_id is not null and e.key <> '_column_order'
    and not (e.key ilike '%national id%' or e.key like '%القومي%')
)
select event_id, header, count(*) n, min(pos) pos, max(length(val #>> '{}')) maxlen,
       'q' || lpad((row_number() over (partition by event_id order by count(*) desc, header))::text, 3, '0') qkey
from cells group by 1, 2;

-- typed semantic questions, only where the typed column is used by at least one row of the event
create temp table t_sem on commit drop as
select s.event_id, v.k key, v.sem semantic, v.typ type, v.l_en, v.l_ar, v.ord
from (select distinct s.event_id from legacy.company_submissions s where s.form_id is null and s.event_id is not null) s
cross join (values ('company_name','company_name','text','Company name','اسم الشركة',0),
                   ('founder_name','founder_name','text','Founder name','اسم المؤسس',1),
                   ('founder_email','founder_email','email','Founder email','البريد الإلكتروني للمؤسس',2),
                   ('phone','phone','tel','Phone','رقم الهاتف',3),
                   ('location','location_x','text','Location','الموقع',4),
                   ('industry','industry_x','text','Industry','القطاع',5),
                   ('logo','logo','file','Logo','الشعار',6)) v(k, sem, typ, l_en, l_ar, ord)
where case v.k
        when 'company_name'  then true
        when 'founder_name'  then exists (select 1 from legacy.company_submissions x where x.event_id = s.event_id and x.form_id is null and nullif(btrim(x.founder_name),'') is not null)
        when 'founder_email' then exists (select 1 from legacy.company_submissions x where x.event_id = s.event_id and x.form_id is null and nullif(btrim(x.founder_email),'') is not null)
        when 'phone'         then exists (select 1 from legacy.company_submissions x where x.event_id = s.event_id and x.form_id is null and nullif(btrim(x.phone),'') is not null)
        when 'location'      then exists (select 1 from legacy.company_submissions x where x.event_id = s.event_id and x.form_id is null and nullif(btrim(x.location),'') is not null)
        when 'industry'      then exists (select 1 from legacy.company_submissions x where x.event_id = s.event_id and x.form_id is null and nullif(btrim(x.industry),'') is not null)
        when 'logo'          then exists (select 1 from legacy.company_submissions x where x.event_id = s.event_id and x.form_id is null and nullif(btrim(x.logo_url),'') is not null)
      end;

insert into public.form_questions (id, project_id, node_id, key, type, semantic, label_en, label_ar, is_required, order_index)
select migration.nid('q:'||s.event_id::text||':'||s.key), s.event_id, migration.nid(s.event_id::text||':form_legacy'), s.key, s.type,
       case when s.semantic in ('company_name','founder_name','founder_email','phone','logo') then s.semantic end, s.l_en, s.l_ar, false, s.ord
from t_sem s
on conflict (id) do nothing;

insert into public.form_questions (id, project_id, node_id, key, type, label_en, is_required, order_index)
select migration.nid('q:'||h.event_id::text||':'||h.qkey), h.event_id, migration.nid(h.event_id::text||':form_legacy'), h.qkey,
       case when coalesce(h.maxlen, 0) >= 200 then 'textarea' else 'text' end, h.header, false,
       (select count(*) from t_sem s where s.event_id = h.event_id)::int
         + (row_number() over (partition by h.event_id order by coalesce(h.pos, 99999), h.n desc, h.header))::int - 1
from t_hdr h
on conflict (id) do nothing;

insert into migration.id_map(entity, old_id, new_id, note)
select 'form_question_legacy', h.event_id::text || ':' || h.qkey, migration.nid('q:'||h.event_id::text||':'||h.qkey), 'sheet header re-keyed (header text is the label)'
from t_hdr h on conflict do nothing;

-- ---------------------------------------------------------------- responses (company_submissions) with re-keyed answers, PII stripped
-- known national-id values (14-digit ids from the archived column and from the 5 PII headers): none may survive anywhere in the new schema,
-- not even pasted inside a free-text cell; such an occurrence is replaced by a marker (the cell stays, the original stays in legacy)
create or replace function migration.redact_values(p_text text, p_vals text[]) returns text
language plpgsql immutable set search_path = '' as $f$
declare v text; r text := p_text;
begin
  foreach v in array p_vals loop
    if position(v in r) > 0 then r := replace(r, v, '[national id removed]'); end if;
  end loop;
  return r;
end $f$;
create temp table t_pii on commit drop as
select coalesce(array_agg(distinct v), '{}'::text[]) vals from (
  select btrim(s.national_id) v from legacy.company_submissions s where btrim(coalesce(s.national_id,'')) ~ '^[0-9]{14}$'
  union all
  select btrim(e.value #>> '{}') from legacy.company_submissions s, jsonb_each(s.additional_data) e
   where (e.key ilike '%national id%' or e.key like '%القومي%') and btrim(e.value #>> '{}') ~ '^[0-9]{14}$') x;

create temp table t_answers on commit drop as
select s.submission_id, s.event_id,
       coalesce(s.form_id, migration.nid(s.event_id::text||':form_legacy')) node_id,
       case when s.form_id is null then
         coalesce((select jsonb_object_agg(h.qkey, case when jsonb_typeof(e.value) = 'string'
                          then to_jsonb(migration.redact_values(e.value #>> '{}', (select vals from t_pii))) else e.value end)
                   from jsonb_each(s.additional_data) e
                   join t_hdr h on h.event_id = s.event_id and h.header = e.key), '{}'::jsonb)
         || jsonb_strip_nulls(jsonb_build_object(
              'company_name',  nullif(btrim(coalesce(s.startup_name, s.company_name)), ''),
              'founder_name',  nullif(btrim(s.founder_name), ''),
              'founder_email', nullif(btrim(s.founder_email), ''),
              'phone',         nullif(btrim(s.phone), ''),
              'location',      nullif(btrim(s.location), ''),
              'industry',      nullif(btrim(s.industry), ''),
              'logo',          migration.register_asset('answer-logo', s.event_id, s.logo_url, 'form_responses', s.submission_id::text, 'answers.logo')))
       else
         coalesce(s.additional_data - '_column_order', '{}'::jsonb)
         || jsonb_strip_nulls(jsonb_build_object(
              'startup_name', nullif(btrim(s.startup_name), ''),
              'industry',     nullif(btrim(s.industry), ''),
              'location',     nullif(btrim(s.location), ''),
              'logo_url',     migration.register_asset('answer-logo', s.event_id, s.logo_url, 'form_responses', s.submission_id::text, 'answers.logo_url')))
       end answers
from legacy.company_submissions s
where s.event_id in (select event_id from legacy.events);

insert into public.form_responses (id, project_id, node_id, answers, external_key, status, submitted_at, updated_at)
select a.submission_id, a.event_id, a.node_id, a.answers, 'legacy:' || a.submission_id::text, 'submitted',
       coalesce(s.submitted_at, s.created_at, now()), coalesce(s.updated_at, s.created_at, now())
from t_answers a join legacy.company_submissions s on s.submission_id = a.submission_id
on conflict (id) do nothing;

-- generic loader for the (empty) legacy.form_responses table: answers are already keyed by question keys
insert into public.form_responses (id, project_id, node_id, answers, source, tracking, external_key, status, submitted_at, updated_at)
select r.response_id, r.event_id, r.form_id, coalesce(r.answers, '{}'::jsonb), r.source, coalesce(r.tracking_data, '{}'::jsonb), 'legacy:' || r.response_id::text,
       case when r.status in ('reviewed','spam') then r.status else 'submitted' end,
       coalesce(r.submitted_at, r.created_at, now()), coalesce(r.updated_at, r.created_at, now())
from legacy.form_responses r
where exists (select 1 from public.nodes n where n.id = r.form_id and n.project_id = r.event_id)
on conflict (id) do nothing;

select migration.flag('pii_redacted_in_answer', 'review', 'form_response', a.submission_id::text,
  'a 14-digit national-id value was pasted inside a free-text answer; replaced by a marker in the new schema (cell count unchanged, original kept only in legacy)')
from t_answers a where a.answers::text like '%[national id removed]%';
select migration.flag('selection_items_without_edge', 'info', 'project', '3750a84e-d87a-49f5-95d4-d8b84dc55a8e',
  'the 2 responses of the native company form (target_module=company) have selection items but no form->selection edge (05 4.4 creates edges only for selection_process forms and Legacy-import forms)')
where exists (select 1 from legacy.company_submissions where form_id is not null);
select migration.flag('legacy_import_meta_keys_as_questions', 'info', 'form', migration.nid(e.event_id::text||':form_legacy')::text,
  'answer keys rejected_reason/holding_reason/approved_reason/tech_status are kept as answers (lossless cell count) AND copied to the selection review/overlay in m15')
from (select distinct event_id from t_hdr where header in ('rejected_reason','holding_reason','approved_reason','tech_status')) e;

select migration.flag('national_id_column_not_ids', 'info', 'table', 'legacy.company_submissions.national_id',
  (select count(*) from legacy.company_submissions where national_id is not null and btrim(national_id) <> '' and btrim(national_id) !~ '^[0-9]{14}$')::text ||
  ' of the ' || (select count(*) from legacy.company_submissions where national_id is not null and btrim(national_id) <> '')::text ||
  ' non-empty national_id column values are free text, not 14-digit ids (Founder Camp); the whole column is archived in legacy only (owner 05-b), nothing is copied')
where exists (select 1 from legacy.company_submissions where national_id is not null);

-- ================================================================= verification
select migration.check((select id from _r), 'V07.1 forms = native + Legacy import',
  ((select count(*) from legacy.event_forms where event_id in (select event_id from legacy.events)) + (select count(distinct event_id) from legacy.company_submissions where form_id is null))::text,
  (select count(*)::text from public.forms));
select migration.check((select id from _r), 'V07.1 sections = integrations form_sections',
  (select coalesce(sum(jsonb_array_length(f.integrations->'form_sections')),0)::text from legacy.event_forms f where jsonb_typeof(f.integrations->'form_sections') = 'array'),
  (select count(*)::text from public.form_sections));
select migration.check((select id from _r), 'V07.1 questions = native + generated',
  ((select count(*) from legacy.form_field_configs) + (select count(*) from t_hdr) + (select count(*) from t_sem))::text,
  (select count(*)::text from public.form_questions));
select migration.check((select id from _r), 'V07.2 responses = submissions + form_responses + expert_submissions',
  ((select count(*) from legacy.company_submissions) + (select count(*) from legacy.form_responses) + (select count(*) from legacy.expert_submissions))::text,
  (select count(*)::text from public.form_responses));
select migration.check((select id from _r), 'V07.3 responses per form node (old vs new)',
  (select string_agg(coalesce(s.form_id::text, 'legacy:' || s.event_id::text) || '=' || n, ',' order by coalesce(s.form_id::text, 'legacy:' || s.event_id::text))
   from (select form_id, event_id, count(*) n from legacy.company_submissions group by 1, 2) s),
  (select string_agg(coalesce(case when r.node_id in (select form_id from legacy.event_forms) then r.node_id::text end, 'legacy:' || r.project_id::text) || '=' || n,
                     ',' order by coalesce(case when r.node_id in (select form_id from legacy.event_forms) then r.node_id::text end, 'legacy:' || r.project_id::text))
   from (select node_id, project_id, count(*) n from public.form_responses group by 1, 2) r));
select migration.check((select id from _r), 'V07.4 lossless non-PII cells (legacy-import rows)',
  (select count(*)::text from legacy.company_submissions s, jsonb_each(s.additional_data) e
    where s.form_id is null and e.key <> '_column_order' and not (e.key ilike '%national id%' or e.key like '%القومي%')),
  (select count(*)::text from public.form_responses r cross join lateral jsonb_object_keys(r.answers) k
    where r.node_id in (select migration.nid(e.event_id::text||':form_legacy') from legacy.events e) and k ~ '^q[0-9]{3}$'));
-- a NATIVE form definition (Athar Accelerator waiting) has a "National ID" question: it is form CONFIGURATION, not archived data; it is kept
-- (dropping it would silently change what the form collects) and reported for the owner (flag + warn row below)
select migration.flag('form_collects_national_id', 'review', 'form_question', q.id::text,
  'native form question "National ID" is kept as form configuration; the owner archived the VALUES only (05-b). The form will collect national ids again unless the PM removes this question')
from public.form_questions q
where q.node_id in (select form_id from legacy.event_forms) and (q.label_en ilike '%national id%' or q.label_en like '%القومي%');
select migration.check_design((select id from _r), 'D07.3 native questions that ask for a national id (kept as configuration, owner to review)', '0',
  (select count(*)::text from public.form_questions q where q.node_id in (select form_id from legacy.event_forms) and (q.label_en ilike '%national id%' or q.label_en like '%القومي%')));
select migration.check((select id from _r), 'V07.5 PII: no national-id question label and no key in generated forms / answers', '0',
  (select (select count(*) from public.form_questions where node_id in (select migration.nid(e.event_id::text||':form_legacy') from legacy.events e)
                                                        and (label_en ilike '%national id%' or label_en like '%القومي%' or key ilike '%national%'))
        + (select count(*) from public.form_responses r cross join lateral jsonb_object_keys(r.answers) k where k ilike '%national%' or k like '%القومي%')
   )::text);
select migration.check((select id from _r), 'V07.5 PII: no legacy national-id value appears in any new answer', '0',
  (select count(*)::text from public.form_responses r
    where exists (select 1 from (select s.national_id v from legacy.company_submissions s where btrim(coalesce(s.national_id,'')) ~ '^[0-9]{14}$'
                                  union
                                  select e.value #>> '{}' from legacy.company_submissions s, jsonb_each(s.additional_data) e
                                   where (e.key ilike '%national id%' or e.key like '%القومي%') and btrim(e.value #>> '{}') ~ '^[0-9]{14}$') p
                  where position(p.v in r.answers::text) > 0)));
select migration.check((select id from _r), 'V07.6 every answer key exists as a question of its node', '0',
  (select count(*)::text from public.form_responses r cross join lateral jsonb_object_keys(r.answers) k
    where not exists (select 1 from public.form_questions q where q.node_id = r.node_id and q.key = k)));
select migration.check((select id from _r), 'V07.7 answers within 64 KB cap', 'true', (select (coalesce(max(octet_length(answers::text)), 0) <= 65536)::text from public.form_responses));
select migration.check((select id from _r), 'V07.8 questions keep their section reference',
  (select count(*)::text from legacy.form_field_configs where nullif(validation_rules->>'section_id','') is not null),
  (select count(*)::text from public.form_questions where section_id is not null));
select migration.check((select id from _r), 'V07.9 covers = legacy + defaults', ((select count(*) from legacy.form_covers) + (select count(*) from legacy.events where nullif(btrim(form_cover_image_url),'') is not null))::text,
  (select count(*)::text from public.form_covers));
select migration.check((select id from _r), 'V07.9 templates = library_forms', (select count(*)::text from legacy.library_forms), (select count(*)::text from public.form_templates));
select migration.check_design((select id from _r), 'D07.1 design: forms 12 / sections 6 / questions 204 / responses 384 / covers 5 / templates 1', '12/6/204/384/5/1',
  (select (select count(*) from public.forms) || '/' || (select count(*) from public.form_sections) || '/' || (select count(*) from public.form_questions) || '/' ||
          (select count(*) from public.form_responses) || '/' || (select count(*) from public.form_covers) || '/' || (select count(*) from public.form_templates)));
select migration.check_design((select id from _r), 'D07.2 design: lossless cells 13428', '13428',
  (select count(*)::text from public.form_responses r cross join lateral jsonb_object_keys(r.answers) k where k ~ '^q[0-9]{3}$'));

select migration.finish_run((select id from _r));
\o
select check_key, expected, actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
