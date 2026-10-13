-- m33_selection.sql  (Selection Process node + project Participants page; design 01 §3.4, 02 §7, 04 §3.5/§5.4/§5.8, 07 §1,
--                     08 decisions 01-4 / 01-6 / 01-12 / 01-15 / 01-16 / 02-7 / 07-3 / 07-12)
-- Re-runnable (create or replace / if not exists). Local DB only. No business data is altered.
--
-- 1. app_private.selection_port_statuses(config, port)   statuses an output port carries (`approved` = selection_passing,
--                                                        `rejected`/`holding`/`interview` = the stages of that type/key; `all` = no filter)
--    app_private.selection_enrolls(config)               the stage's "accepted -> participants" toggle (config.participantRule.onAccept)
--    app_private.first_name(name) / html_escape / render_email_template   the ONE renderer of 07 §1.5 ({{key}} and {key}, escaped values)
-- 2. app_private.resolve_list_rows re-created (m06c body): a `rows:list-item` edge from a SELECTION output port now filters by the
--    upstream stage's CONFIGURED statuses (the m06c body compared `status = from_port`, so `approved` never matched the migrated
--    `accepted` rows of decision 01-16 and a chained stage saw nothing). Every other branch unchanged.
-- 3. public.selection_scores (per-reviewer score 1..5 + note; selection_reviews stays the ONE decision record per item) with RLS
--    (PM select; writes only through set_selection_score), revision bump, updated_at.
-- 4. public.set_selection_score(item, score, note)       upsert of the caller's own score (null/null deletes it)
-- 5. public.get_selection_extras(node)                   ONE call for the board: reviews, scores, outbox rows per item, participants of
--                                                        accepted items, the effective interview Booking node (+ its public slug), enrolls flag
-- 6. public.list_participants re-created (m06c body):    virtual "eligible from selection" rows ONLY from stages whose toggle enrolls
--                                                        (02 §7.3 step 1); rows carry source_node_id, email, dates, notes (PM payload)
--    public.enroll_accepted re-created:                   refuses a stage that does not enroll (hint selection_not_enrolling)
--    public.ensure_participant(project, stage, company, response)   ONE eligible applicant -> participants row (idempotent, 02-7 lazy rows)
-- 7. app_private.email_outbox scope CHECK                 the three selection e-mails may be queued without a sender connection
--                                                        (sender resolved by the worker, 07-3; same pattern as m24/m31)
--    app_private.selection_default_template(key, lang)  the node-type default texts (used when the stage has no override)
--    public.send_selection_emails(node, key, items, lang, base_url, resend, confirm)   validates, derives recipients from the item's
--                                                        source answers (founder_email role / manual email / expert e-mail), renders the
--                                                        stage's template (ar/en, else the default) with the unified placeholder set, resolves {{booking_link}}
--                                                        from the connected interview Booking node as a TOKENISED per-item link
--                                                        (booking_invitations, 01-15), enqueues email_outbox rows with idempotency keys +
--                                                        an email_log audit record, skips already-sent items unless resend, needs confirm
--                                                        above 100 recipients (07-12), per-PM daily cap 1,500. Returns per-item status.
set search_path = public, extensions;

begin;

-- ================================================================= 1. helpers
create or replace function app_private.selection_port_statuses(p_config jsonb, p_port text) returns text[]
language plpgsql immutable parallel safe set search_path = '' as $$
declare v text[]; v_stages jsonb := case when jsonb_typeof(p_config->'stages') = 'array' then p_config->'stages' else '[]'::jsonb end;
begin
  if p_port = 'approved' then return app_private.selection_passing(p_config); end if;
  if p_port = 'all' or p_port is null then return null; end if;
  if p_port = 'rejected' then
    v := array(select s->>'key' from jsonb_array_elements(v_stages) s where s->>'type' = 'reject' and s->>'key' is not null);
  elsif p_port = 'holding' then
    v := array(select s->>'key' from jsonb_array_elements(v_stages) s where s->>'type' = 'hold' and s->>'key' is not null);
  elsif p_port = 'interview' then
    v := array(select s->>'key' from jsonb_array_elements(v_stages) s where (s->>'key' = 'interview' or s->>'email' = 'interview') and s->>'key' is not null);
  else
    v := '{}';
  end if;
  if coalesce(cardinality(v), 0) = 0 then v := array[p_port]; end if;
  return v;
end $$;
revoke all on function app_private.selection_port_statuses(jsonb, text) from public, anon, authenticated;

create or replace function app_private.selection_enrolls(p_config jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_config->'participantRule'->>'onAccept', 'none') = 'create_participant'
$$;
revoke all on function app_private.selection_enrolls(jsonb) from public, anon, authenticated;

-- 07-5: first_name = the first logical unit (titles skipped, Arabic/English particles joined with the next word)
create or replace function app_private.first_name(p_name text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare parts text[]; i int := 1; w text; nx text;
begin
  parts := regexp_split_to_array(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ' ');
  if parts is null or cardinality(parts) = 0 or parts[1] = '' then return ''; end if;
  while i < cardinality(parts) and lower(regexp_replace(parts[i], '[.,]', '', 'g')) in ('dr','eng','mr','mrs','ms','م','د','أ') loop i := i + 1; end loop;
  w := parts[i]; nx := parts[i + 1];
  if nx is not null and (lower(regexp_replace(w, '[.,]', '', 'g')) in ('عبد','أبو','ابو','أم','ام','al','el','abdel','abdul','abd','abu','bin','ibn','bint','de','van','von','da','di','la','le','mc','mac','o','d')
                          or (w ~ '^(عبد|أبو|ابو)' and char_length(w) <= 4)) then
    return w || ' ' || nx;
  end if;
  return w;
end $$;
revoke all on function app_private.first_name(text) from public, anon, authenticated;

create or replace function app_private.html_escape(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select replace(replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;
revoke all on function app_private.html_escape(text) from public, anon, authenticated;

-- {{key}} and {key} (same set for subject and body, 01 §2.1); values HTML-escaped in HTML mode; unknown tokens removed;
-- a plain-text body (no tag) gets <br> line breaks; booking_link becomes a real anchor in HTML mode
create or replace function app_private.render_email_template(p_tpl text, p_vars jsonb, p_html boolean) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare out text := coalesce(p_tpl, ''); k text; v text; is_html boolean;
begin
  is_html := p_html and out ~ '<[a-zA-Z][^>]*>';
  if p_html and not is_html then out := replace(replace(out, E'\r\n', E'\n'), E'\n', '<br>'); end if;
  for k, v in select * from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    v := coalesce(v, '');
    if p_html then
      v := case when k = 'booking_link' and v <> '' then '<a href="' || app_private.html_escape(v) || '">' || app_private.html_escape(v) || '</a>'
                else app_private.html_escape(v) end;
    end if;
    out := regexp_replace(out, '\{\{\s*' || k || '\s*\}\}', v, 'g');
    out := regexp_replace(out, '\{' || k || '\}', v, 'g');
  end loop;
  out := regexp_replace(out, '\{\{\s*[a-zA-Z_]+\s*\}\}', '', 'g');
  return out;
end $$;
revoke all on function app_private.render_email_template(text, jsonb, boolean) from public, anon, authenticated;

-- the node-type default templates (01 §3.4 / 07 §1.5 "one default set owned by the node type"; seeded from
-- migration.email_template_defaults). MUST stay identical to web/src/nodes/selection/selectionConfig.js DEFAULT_TEMPLATES.
create or replace function app_private.selection_default_template(p_key text, p_lang text) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case p_key
    when 'interview' then case when p_lang = 'ar'
      then jsonb_build_object('subject', 'دعوة لمقابلة: {{company_name}}',
             'body', E'عزيزي {{first_name}}،\n\nيسعدنا دعوة {{company_name}} لمقابلة مع فريق {{program_name}}.\n\nيرجى حجز موعدك من هنا: {{booking_link}}\n\nمع أطيب التحيات،\n{{project_manager_name}}')
      else jsonb_build_object('subject', 'Interview Invitation: {{company_name}}',
             'body', E'Dear {{first_name}},\n\nWe would like to invite {{company_name}} for an interview with the {{program_name}} team.\n\nPlease book your slot here: {{booking_link}}\n\nBest regards,\n{{project_manager_name}}') end
    when 'acceptance' then case when p_lang = 'ar'
      then jsonb_build_object('subject', 'تهانينا! تم اختيار {{company_name}}',
             'body', E'عزيزي {{first_name}}،\n\nتهانينا! يسعدنا إبلاغك بأن {{company_name}} قد تم اختيارها للانضمام إلى {{program_name}}.\n\nسنتواصل معك قريباً بالخطوات التالية.\n\nمع أطيب التحيات،\n{{project_manager_name}}')
      else jsonb_build_object('subject', 'Congratulations! {{company_name}} has been selected',
             'body', E'Dear {{first_name}},\n\nCongratulations! We are pleased to inform you that {{company_name}} has been selected to join {{program_name}}.\n\nWe will contact you shortly with the next steps.\n\nBest regards,\n{{project_manager_name}}') end
    when 'rejection' then case when p_lang = 'ar'
      then jsonb_build_object('subject', 'شكراً لتقديمك',
             'body', E'عزيزي {{founder_name}}،\n\nشكراً لتقديمك إلى {{program_name}}. راجعنا طلبك بعناية، ورغم إعجابنا بشركتك الناشئة فقد قررنا عدم المضي في طلبك هذه المرة.\n\nتلقينا عدداً كبيراً من الطلبات القوية وكانت عملية الاختيار تنافسية للغاية. نشجعك على مواصلة تطوير شركتك ونأمل أن تتقدم مجدداً في المستقبل.\n\nمع أطيب التحيات،\n{{project_manager_name}}')
      else jsonb_build_object('subject', 'Thank You for Your Application',
             'body', E'Dear {{founder_name}},\n\nThank you for your application to {{program_name}}. We had the opportunity to review your submission, and while we were impressed with your startup, we have decided not to move forward with your application at this time.\n\nWe received a large number of strong applications, and the selection process was extremely competitive. We encourage you to continue developing your startup and hope you will consider applying again in the future.\n\nBest regards,\n{{project_manager_name}}') end
    else null end
$$;
revoke all on function app_private.selection_default_template(text, text) from public, anon, authenticated;

-- ================================================================= 2. resolve_list_rows (m06c body; selection ports filter by configured statuses)
create or replace function app_private.resolve_list_rows(
  p_list uuid, p_filter jsonb default '{}'::jsonb, p_limit int default 100, p_after jsonb default null,
  p_with_fields boolean default false)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  with params as (
    select least(greatest(coalesce(p_limit, 100), 1), 200) as lim,
           coalesce((p_filter->>'include_excluded')::boolean, false) as inc_excl,
           case when p_filter ? 'status' then
                  case jsonb_typeof(p_filter->'status')
                    when 'array' then array(select jsonb_array_elements_text(p_filter->'status'))
                    else array[p_filter->>'status'] end
           end as statuses
  ),
  feed as (
    select 'form_response'::text as kind, fr.id as sid, e.order_index as ord
      from public.edges e
      join public.form_responses fr on fr.node_id = e.from_node_id and fr.deleted_at is null
     where e.to_node_id = p_list and e.is_enabled and e.family = 'rows:form-response'
    union all
    select u.source_kind, coalesce(u.form_response_id, u.network_expert_id, u.company_id), e.order_index
      from public.edges e
      join public.nodes sn on sn.id = e.from_node_id
      join public.list_items u on u.list_node_id = e.from_node_id and u.source_kind is not null and not u.excluded
     where e.to_node_id = p_list and e.is_enabled and e.family = 'rows:list-item'
       and coalesce(u.form_response_id, u.network_expert_id, u.company_id) is not null
       and (not (e.filter ? 'status_in') or u.status in (select jsonb_array_elements_text(e.filter->'status_in')))
       and (sn.type <> 'selection' or e.from_port = 'all'
            or u.status = any (coalesce(app_private.selection_port_statuses(sn.config, e.from_port), '{}'::text[])))
    union all
    select li.source_kind, coalesce(li.network_expert_id, li.company_id), 0
      from public.list_items li
     where li.list_node_id = p_list and li.source_kind in ('network_expert','company')
       and coalesce(li.network_expert_id, li.company_id) is not null
  ),
  src as (select distinct on (kind, sid) kind, sid, ord from feed order by kind, sid, ord),
  joined as (
    select s.kind, s.sid, li.id as item_id, li.status, li.sort_order, li.excluded, li.overlay, li.manual_fields, li.source_label,
           fr.answers as answers, ne as ne_row, co as co_row,
           case when s.kind = 'network_expert' and ne.deleted_at is not null then 'missing'
                when s.kind = 'company' and co.deleted_at is not null then 'missing'
                else 'ok' end as state
    from src s
    left join public.list_items li on li.list_node_id = p_list and (
         (s.kind = 'form_response'  and li.form_response_id  = s.sid)
      or (s.kind = 'network_expert' and li.network_expert_id = s.sid)
      or (s.kind = 'company'        and li.company_id        = s.sid))
    left join public.form_responses  fr on s.kind = 'form_response'  and fr.id = s.sid
    left join public.network_experts ne on s.kind = 'network_expert' and ne.id = s.sid
    left join public.companies       co on s.kind = 'company'        and co.id = s.sid
    union all
    -- manual items
    select 'manual', null::uuid, li.id, li.status, li.sort_order, li.excluded, li.overlay, li.manual_fields, null,
           null::jsonb, null, null, 'ok'
    from public.list_items li where li.list_node_id = p_list and li.source_kind is null
    union all
    -- tombstones: the source row was hard-deleted (FK set null); cached label only
    select li.source_kind, null::uuid, li.id, li.status, li.sort_order, li.excluded, li.overlay, null, li.source_label,
           null::jsonb, null, null, 'missing'
    from public.list_items li
    where li.list_node_id = p_list and li.source_kind is not null
      and li.form_response_id is null and li.network_expert_id is null and li.company_id is null
  ),
  final as (
    select j.*, coalesce(j.sort_order, 2147483647) as sk, coalesce(j.item_id, j.sid) as k
    from joined j, params
    where (params.inc_excl or not coalesce(j.excluded, false))
      and (params.statuses is null or j.status = any (params.statuses))
  )
  select jsonb_build_object(
      'item_id', f.item_id,
      'source', jsonb_build_object('kind', f.kind, 'id', f.sid, 'state', f.state),
      'display',
        (case f.kind
           when 'form_response' then jsonb_build_object(
               'title_en', f.answers->>'company_name', 'title_ar', f.answers->>'company_name',
               'subtitle_en', f.answers->>'founder_name', 'subtitle_ar', f.answers->>'founder_name',
               'image_path', f.answers->>'logo', 'bio_en', f.answers->>'bio', 'bio_ar', f.answers->>'bio')
           when 'network_expert' then jsonb_build_object(
               'title_en', (f.ne_row).name_en, 'title_ar', (f.ne_row).name_ar,
               'subtitle_en', (f.ne_row).title_en, 'subtitle_ar', (f.ne_row).title_ar,
               'organization_en', (f.ne_row).company_en, 'organization_ar', (f.ne_row).company_ar,
               'image_path', (f.ne_row).photo_path, 'bio_en', (f.ne_row).bio_en, 'bio_ar', (f.ne_row).bio_ar,
               'linkedin_url', (f.ne_row).linkedin_url)
           when 'company' then jsonb_build_object(
               'title_en', (f.co_row).name_en, 'title_ar', (f.co_row).name_ar,
               'subtitle_en', (f.co_row).industry_en, 'subtitle_ar', (f.co_row).industry_ar,
               'image_path', (f.co_row).logo_path, 'bio_en', (f.co_row).description_en, 'bio_ar', (f.co_row).description_ar,
               'website_url', (f.co_row).website_url, 'linkedin_url', (f.co_row).linkedin_url)
           when 'manual' then coalesce(f.manual_fields, '{}'::jsonb)
           else jsonb_build_object('title_en', f.source_label, 'title_ar', f.source_label)
         end) || coalesce(f.overlay->'display_override', '{}'::jsonb),
      'contact', case f.kind
           when 'form_response' then jsonb_build_object('email', f.answers->>'founder_email', 'phone', f.answers->>'phone')
           when 'network_expert' then jsonb_build_object('email', (f.ne_row).email)
           when 'manual' then jsonb_build_object('email', f.manual_fields->>'email')
           else '{}'::jsonb end,
      'fields', case when p_with_fields then f.answers end,
      'overlay', coalesce(f.overlay, '{}'::jsonb),
      'status', f.status, 'sort_order', f.sort_order, 'excluded', coalesce(f.excluded, false),
      'cursor', jsonb_build_object('s', f.sk, 'k', f.k))
  from final f, params
  where p_after is null or (f.sk, f.k) > ((p_after->>'s')::int, (p_after->>'k')::uuid)
  order by f.sk, f.k
  limit (select lim from params)
$$;
revoke all on function app_private.resolve_list_rows(uuid, jsonb, int, jsonb, boolean) from public, anon, authenticated;

-- ================================================================= 3. selection_scores (per reviewer)
create table if not exists public.selection_scores (
  item_id     uuid not null references public.list_items(id) on delete cascade,
  project_id  uuid not null,
  node_id     uuid not null,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  score       smallint check (score between 1 and 5),
  note        text check (char_length(note) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (item_id, reviewer_id),
  foreign key (project_id, node_id) references public.nodes (project_id, id) on delete cascade,
  check (score is not null or note is not null)
);
create index if not exists selection_scores_node_idx on public.selection_scores (node_id);
create index if not exists selection_scores_project_idx on public.selection_scores (project_id);
alter table public.selection_scores enable row level security;
alter table public.selection_scores force row level security;
drop policy if exists selection_scores_select_pm on public.selection_scores;
create policy selection_scores_select_pm on public.selection_scores for select to authenticated
  using ((select app_private.is_project_manager(project_id)));
revoke all on public.selection_scores from public, anon, authenticated;
grant select on public.selection_scores to authenticated;
drop trigger if exists selection_scores_bu_touch on public.selection_scores;
create trigger selection_scores_bu_touch before update on public.selection_scores for each row execute function app_private.touch_updated_at();
do $$
declare ev text; refclause text;
begin
  foreach ev in array array['insert','update','delete'] loop
    refclause := case ev when 'delete' then 'old table as changed' else 'new table as changed' end;
    execute format('drop trigger if exists %I on public.selection_scores', 'selection_scores_rev_' || left(ev, 3));
    execute format('create trigger %I after %s on public.selection_scores referencing %s for each statement execute function app_private.bump_node_revs(%L)',
                   'selection_scores_rev_' || left(ev, 3), ev, refclause, 'node_id');
  end loop;
end $$;

-- ================================================================= 4. set_selection_score
create or replace function public.set_selection_score(p_item uuid, p_score int default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.list_items; n public.nodes; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v := app_private.item_for_write(p_item);
  select * into n from public.nodes where id = v.list_node_id;
  if n.type <> 'selection' then raise exception 'scores belong to selection stages' using errcode = '22023'; end if;
  if p_score is not null and (p_score < 1 or p_score > 5) then raise exception 'score must be between 1 and 5' using errcode = '22023'; end if;
  if p_score is null and v_note is null then
    delete from public.selection_scores where item_id = p_item and reviewer_id = (select auth.uid());
    return;
  end if;
  insert into public.selection_scores (item_id, project_id, node_id, reviewer_id, score, note)
  values (p_item, v.project_id, v.list_node_id, (select auth.uid()), p_score, v_note)
  on conflict (item_id, reviewer_id) do update set score = excluded.score, note = excluded.note;
end $$;
revoke all on function public.set_selection_score(uuid, int, text) from public, anon, authenticated;
grant execute on function public.set_selection_score(uuid, int, text) to authenticated;

-- ================================================================= helper: the interview Booking node of a stage (config override, else the edge)
create or replace function app_private.selection_booking_node(p_node public.nodes) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select b.id from public.nodes b
      where b.id = nullif(p_node.config->'interviewBooking'->>'linkedBookingNodeId', '')::uuid
        and b.project_id = p_node.project_id and b.type = 'booking' and b.deleted_at is null),
    (select b.id from public.edges e join public.nodes b on b.id = e.to_node_id
      where e.from_node_id = p_node.id and e.is_enabled and b.type = 'booking' and b.deleted_at is null
      order by e.created_at limit 1))
$$;
revoke all on function app_private.selection_booking_node(public.nodes) from public, anon, authenticated;

-- ================================================================= 5. get_selection_extras
create or replace function public.get_selection_extras(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes; v_booking uuid; v_slug text; v_bnode public.nodes;
begin
  select * into n from public.nodes where id = p_node and type = 'selection' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_booking := app_private.selection_booking_node(n);
  if v_booking is not null then
    select * into v_bnode from public.nodes where id = v_booking;
    select s.slug into v_slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current
     where l.node_id = v_booking and l.kind = 'booking' and l.view_key is null limit 1;
  end if;
  return jsonb_build_object(
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('item_id', r.item_id, 'reason', r.reason, 'origin_stage', r.origin_stage,
                   'reviewed_at', r.reviewed_at, 'reviewed_by', r.reviewed_by, 'reviewer_name', pr.full_name))
                 from public.selection_reviews r join public.list_items li on li.id = r.item_id left join public.profiles pr on pr.id = r.reviewed_by
                 where li.list_node_id = p_node), '[]'::jsonb),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'reviewer_id', s.reviewer_id, 'reviewer_name', pr.full_name,
                   'score', s.score, 'note', s.note, 'updated_at', s.updated_at) order by s.updated_at)
                 from public.selection_scores s left join public.profiles pr on pr.id = s.reviewer_id where s.node_id = p_node), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'item_id', o.list_item_id, 'email_key', o.email_key, 'status', o.status,
                   'recipient', o.recipient_email, 'created_at', o.created_at, 'sent_at', o.sent_at, 'error_message', o.error_message) order by o.created_at)
                 from app_private.email_outbox o where o.node_id = p_node and o.list_item_id is not null), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('participant_id', pa.id, 'form_response_id', pa.form_response_id, 'company_id', pa.company_id,
                   'status', pa.status, 'source', pa.source, 'source_node_id', pa.source_node_id, 'needs_review', pa.needs_review))
                 from public.participants pa where pa.project_id = n.project_id
                   and exists (select 1 from public.list_items li where li.list_node_id = p_node
                               and ((pa.form_response_id is not null and li.form_response_id = pa.form_response_id)
                                 or (pa.company_id is not null and li.company_id = pa.company_id)))), '[]'::jsonb),
    'booking', case when v_booking is null then null else jsonb_build_object('node_id', v_booking, 'name_en', v_bnode.name_en, 'name_ar', v_bnode.name_ar, 'slug', v_slug) end,
    'enrolls', app_private.selection_enrolls(n.config),
    'pm_name', coalesce((select pr.full_name from public.profiles pr where pr.id = (select auth.uid())), ''),
    'program_name', (select jsonb_build_object('en', g.name_en, 'ar', g.name_ar) from public.projects j join public.programs g on g.id = j.program_id where j.id = n.project_id),
    'project_name', (select jsonb_build_object('en', j.name_en, 'ar', j.name_ar) from public.projects j where j.id = n.project_id));
end $$;
revoke all on function public.get_selection_extras(uuid) from public, anon, authenticated;
grant execute on function public.get_selection_extras(uuid) to authenticated;

-- ================================================================= 6. participants
create or replace function public.list_participants(p_project uuid, p_status text default null) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.is_project_manager(p_project) or app_private.has_role('alumni_manager')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select jsonb_build_object('participant_id', pa.id, 'virtual', false, 'source', pa.source, 'status', pa.status,
         'company_id', pa.company_id, 'user_id', pa.user_id, 'form_response_id', pa.form_response_id, 'source_node_id', pa.source_node_id,
         'needs_review', pa.needs_review, 'withdrawal_requested_at', pa.withdrawal_requested_at, 'notes', pa.notes,
         'created_at', pa.created_at, 'status_changed_at', pa.status_changed_at,
         'email', coalesce(fr.answers->>'founder_email', pr_email.email::text),
         'display', app_private.participants_display(pa))
  from public.participants pa
  left join public.form_responses fr on fr.id = pa.form_response_id
  left join lateral (select f.email from public.company_founders cf join public.founders f on f.id = cf.founder_id
                      where cf.company_id = pa.company_id and f.email is not null order by cf.is_primary desc, cf.created_at limit 1) pr_email on true
  where pa.project_id = p_project and (p_status is null or pa.status = p_status)
  union all
  select jsonb_build_object('participant_id', null, 'virtual', true, 'source', 'selection', 'status', 'accepted',
         'company_id', li.company_id, 'user_id', null, 'form_response_id', li.form_response_id, 'source_node_id', n.id,
         'needs_review', false, 'withdrawal_requested_at', null, 'notes', null,
         'created_at', li.updated_at, 'status_changed_at', null,
         'email', fr.answers->>'founder_email',
         'display', jsonb_build_object('name_en', coalesce(c.name_en, fr.answers->>'company_name'),
                                       'name_ar', coalesce(c.name_ar, fr.answers->>'company_name'), 'logo_path', c.logo_path))
  from public.nodes n
  join public.list_items li on li.list_node_id = n.id and not li.excluded
  left join public.companies c on c.id = li.company_id
  left join public.form_responses fr on fr.id = li.form_response_id
  where n.project_id = p_project and n.type = 'selection' and n.deleted_at is null
    and app_private.selection_enrolls(n.config)
    and li.status = any (app_private.selection_passing(n.config))
    and (li.company_id is not null or li.form_response_id is not null)
    and (p_status is null or p_status = 'accepted')
    and not exists (select 1 from public.participants x where x.project_id = p_project
                    and ((li.company_id is not null and x.company_id = li.company_id)
                      or (li.form_response_id is not null and x.form_response_id = li.form_response_id)));
end $$;
grant execute on function public.list_participants(uuid, text) to authenticated;

create or replace function public.enroll_accepted(p_project uuid, p_selection_node uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; k int;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into n from public.nodes where id = p_selection_node and project_id = p_project and type = 'selection' and deleted_at is null;
  if not found then raise exception 'selection node not found' using errcode = 'P0002'; end if;
  if not app_private.selection_enrolls(n.config) then
    raise exception 'selection_not_enrolling: this stage does not enroll accepted applicants as participants' using errcode = '22023', hint = 'selection_not_enrolling';
  end if;
  with ins as (
    insert into public.participants (project_id, company_id, form_response_id, source, source_node_id, status, created_by)
    select p_project, li.company_id, case when li.company_id is null then li.form_response_id end,
           'selection', p_selection_node, 'accepted', (select auth.uid())
    from public.list_items li
    where li.list_node_id = p_selection_node and not li.excluded
      and li.status = any (app_private.selection_passing(n.config))
      and (li.company_id is not null or li.form_response_id is not null)
    on conflict do nothing
    returning 1)
  select count(*) into k from ins;
  return k;
end $$;
grant execute on function public.enroll_accepted(uuid, uuid) to authenticated;

create or replace function public.ensure_participant(p_project uuid, p_selection_node uuid, p_company uuid default null, p_form_response uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; v_id uuid;
begin
  if not app_private.is_project_manager(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_company is null and p_form_response is null then raise exception 'a company or a form response is required' using errcode = '22023'; end if;
  select * into n from public.nodes where id = p_selection_node and project_id = p_project and type = 'selection' and deleted_at is null;
  if not found then raise exception 'selection node not found' using errcode = 'P0002'; end if;
  if not app_private.selection_enrolls(n.config) then
    raise exception 'selection_not_enrolling: this stage does not enroll accepted applicants as participants' using errcode = '22023', hint = 'selection_not_enrolling';
  end if;
  if not exists (select 1 from public.list_items li where li.list_node_id = p_selection_node and not li.excluded
                   and li.status = any (app_private.selection_passing(n.config))
                   and ((p_company is not null and li.company_id = p_company) or (p_company is null and li.form_response_id = p_form_response))) then
    raise exception 'the applicant is not in an accepted stage of this selection' using errcode = '22023';
  end if;
  insert into public.participants (project_id, company_id, form_response_id, source, source_node_id, status, created_by)
  values (p_project, p_company, case when p_company is null then p_form_response end, 'selection', p_selection_node, 'accepted', (select auth.uid()))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.participants x where x.project_id = p_project
      and ((p_company is not null and x.company_id = p_company) or (p_company is null and x.form_response_id = p_form_response));
  end if;
  return v_id;
end $$;
revoke all on function public.ensure_participant(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_participant(uuid, uuid, uuid, uuid) to authenticated;

-- ================================================================= 7. e-mails
alter table app_private.email_outbox drop constraint if exists email_outbox_scope_chk;
alter table app_private.email_outbox add constraint email_outbox_scope_chk check (
     (project_id is not null and node_id is not null and sender_connection_id is not null)
  or (email_key = 'staff_invitation' and project_id is null and node_id is null)
  or (email_key in ('form_new_response','acceptance','rejection','interview') and project_id is not null and node_id is not null)
);

create or replace function public.send_selection_emails(
  p_node uuid, p_email_key text, p_item_ids uuid[], p_lang text default 'en', p_base_url text default null,
  p_resend boolean default false, p_confirm boolean default false)
returns table (item_id uuid, outbox_id uuid, status text, recipient text)
language plpgsql security definer set search_path = '' as $$
declare
  n public.nodes; v_acting uuid := (select auth.uid()); v_tpl jsonb; v_subject text; v_body text; v_uses_booking boolean;
  v_booking uuid; v_link uuid; v_slug text; v_base text; v_cc text[]; v_prog text; v_proj text; v_pm text; v_today int;
  it uuid; li public.list_items; v_email text; v_name text; v_company text; v_round int; v_key text; v_id uuid; v_token text; v_url text;
  v_vars jsonb; v_live int; v_recent int;
begin
  select * into n from public.nodes where id = p_node and type = 'selection' and deleted_at is null;
  if not found then raise exception 'selection node not found' using errcode = 'P0002'; end if;
  if not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_email_key not in ('acceptance','rejection','interview') then raise exception 'unknown selection e-mail %', p_email_key using errcode = '22023'; end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 then raise exception 'no recipients' using errcode = '22023'; end if;
  if cardinality(p_item_ids) > 100 and not coalesce(p_confirm, false) then
    raise exception 'selection_confirm_required: confirmation required for more than 100 recipients' using errcode = '22023', hint = 'selection_confirm_required';
  end if;
  -- template: the stage's override for the requested language, else its other language, else the node-type default
  v_tpl := coalesce(n.config->'emails'->p_email_key, '{}'::jsonb);
  if coalesce(v_tpl->>'enabled', 'true') = 'false' then
    raise exception 'selection_no_template: the % e-mail is disabled on this stage', p_email_key using errcode = '22023', hint = 'selection_no_template';
  end if;
  if p_lang = 'ar' then
    v_subject := coalesce(nullif(btrim(v_tpl->>'subject_ar'), ''), nullif(btrim(v_tpl->>'subject'), ''), app_private.selection_default_template(p_email_key, 'ar')->>'subject');
    v_body := coalesce(nullif(btrim(v_tpl->>'body_html_ar'), ''), nullif(btrim(v_tpl->>'body_html'), ''), app_private.selection_default_template(p_email_key, 'ar')->>'body');
  else
    v_subject := coalesce(nullif(btrim(v_tpl->>'subject'), ''), nullif(btrim(v_tpl->>'subject_ar'), ''), app_private.selection_default_template(p_email_key, 'en')->>'subject');
    v_body := coalesce(nullif(btrim(v_tpl->>'body_html'), ''), nullif(btrim(v_tpl->>'body_html_ar'), ''), app_private.selection_default_template(p_email_key, 'en')->>'body');
  end if;
  if coalesce(btrim(v_subject), '') = '' or coalesce(btrim(v_body), '') = '' then
    raise exception 'selection_no_template: the % template has no subject or body', p_email_key using errcode = '22023', hint = 'selection_no_template';
  end if;
  -- per-PM daily cap (07-12): rows this user queued today (any sender)
  select count(*) into v_today from app_private.email_outbox o where o.created_by = v_acting and o.created_at >= date_trunc('day', now()) and o.status <> 'cancelled';
  if v_today + cardinality(p_item_ids) > 1500 then
    raise exception 'selection_daily_cap: the daily sending cap (1500) would be exceeded' using errcode = '22023', hint = 'selection_daily_cap';
  end if;

  select coalesce(case when p_lang = 'ar' then g.name_ar end, g.name_en, g.name_ar), coalesce(case when p_lang = 'ar' then j.name_ar end, j.name_en, j.name_ar)
    into v_prog, v_proj
    from public.projects j join public.programs g on g.id = j.program_id where j.id = n.project_id;
  select coalesce(nullif(btrim(pr.full_name), ''), 'Athar Team') into v_pm from public.profiles pr where pr.id = v_acting;
  v_pm := coalesce(v_pm, 'Athar Team');
  v_cc := array(select distinct lower(btrim(x)) from (
            select jsonb_array_elements_text(case when jsonb_typeof(v_tpl->'cc') = 'array' then v_tpl->'cc' else '[]'::jsonb end) x
            union all
            select jsonb_array_elements_text(case when jsonb_typeof(v_tpl->'admin') = 'array' then v_tpl->'admin' else '[]'::jsonb end)) s
          where btrim(x) <> '' order by 1);

  -- {{booking_link}}: the connected interview Booking node, tokenised per applicant (01-15)
  v_uses_booking := (v_subject || ' ' || v_body) ~ '\{\{?\s*booking_link\s*\}?\}';
  if v_uses_booking then
    v_booking := app_private.selection_booking_node(n);
    if v_booking is null then
      raise exception 'selection_no_booking: the template uses {{booking_link}} but no Booking node is connected to this stage' using errcode = '22023', hint = 'selection_no_booking';
    end if;
    v_base := rtrim(btrim(coalesce(p_base_url, '')), '/');
    if v_base !~ '^https?://[^/\s]+' then
      raise exception 'selection_bad_base_url: a valid https?:// application URL is required for the booking link' using errcode = '22023', hint = 'selection_bad_base_url';
    end if;
    v_link := public.ensure_public_link(v_booking, 'booking', null, null);
    select s.slug into v_slug from public.public_link_slugs s where s.link_id = v_link and s.is_current limit 1;
  end if;

  foreach it in array p_item_ids loop
    item_id := it; outbox_id := null; recipient := null;
    select * into li from public.list_items where id = it and list_node_id = p_node;
    if not found then status := 'item_not_found'; return next; continue; end if;
    select coalesce(nullif(btrim(fr.answers->>'founder_email'), ''), nullif(btrim(li.manual_fields->>'email'), ''), ne.email::text),
           coalesce(nullif(btrim(fr.answers->>'founder_name'), ''), nullif(btrim(li.manual_fields->>'subtitle_en'), ''), ne.name_en),
           coalesce(nullif(btrim(fr.answers->>'company_name'), ''), co.name_en, nullif(btrim(li.manual_fields->>'title_en'), ''), ne.name_en)
      into v_email, v_name, v_company
      from (select 1) one
      left join public.form_responses fr on fr.id = li.form_response_id
      left join public.network_experts ne on ne.id = li.network_expert_id
      left join public.companies co on co.id = li.company_id;
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then status := 'no_recipient'; return next; continue; end if;
    v_email := lower(btrim(v_email));
    recipient := v_email;
    select count(*) filter (where o.status in ('queued','sending','sent','needs_review')),
           count(*) filter (where o.created_by = v_acting and o.status = 'queued' and o.created_at > now() - interval '60 seconds'),
           count(*)
      into v_live, v_recent, v_round
      from app_private.email_outbox o where o.node_id = p_node and o.list_item_id = it and o.email_key = p_email_key;
    if v_live > 0 and not coalesce(p_resend, false) then status := 'already_sent'; return next; continue; end if;   -- 01 §3.4: bulk skips sent items
    if v_recent > 0 then status := 'duplicate'; return next; continue; end if;           -- a double click / retried resend
    v_round := v_round + 1;

    v_url := null;
    if v_uses_booking then
      update public.booking_invitations set revoked_at = now() where node_id = v_booking and booker_item_id = it and revoked_at is null;
      v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
      insert into public.booking_invitations (project_id, node_id, booker_item_id, token_hash, expires_at)
      values (n.project_id, v_booking, it, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');
      v_url := v_base || '/book/' || v_slug || '?invite=' || v_token;
    end if;
    v_vars := jsonb_build_object('founder_name', coalesce(v_name, ''), 'first_name', app_private.first_name(v_name), 'company_name', coalesce(v_company, ''),
                                 'program_name', coalesce(v_prog, ''), 'project_name', coalesce(v_proj, ''),
                                 'project_manager_name', v_pm, 'sender_name', v_pm, 'booking_link', coalesce(v_url, ''));
    v_key := encode(extensions.digest(p_node::text || ':' || p_email_key || ':' || it::text || ':' || v_round::text, 'sha256'), 'hex');
    insert into app_private.email_outbox (project_id, node_id, email_key, sender_connection_id, recipient_email, list_item_id, subject, body_html, cc, idempotency_key, created_by)
    values (n.project_id, p_node, p_email_key, null, v_email, it,
            app_private.render_email_template(v_subject, v_vars, false), app_private.render_email_template(v_body, v_vars, true),
            case when cardinality(v_cc) > 0 then v_cc end, v_key, v_acting)
    on conflict (idempotency_key) do nothing returning id into v_id;
    if v_id is null then
      status := 'duplicate';
      select o.id into outbox_id from app_private.email_outbox o where o.idempotency_key = v_key;
    else
      status := 'queued'; outbox_id := v_id;
      insert into app_private.email_log (outbox_id, event, detail)
      values (v_id, 'queued', 'selection:' || p_email_key || ' round ' || v_round || ' lang ' || coalesce(p_lang, 'en') || ' by ' || coalesce(v_acting::text, 'service'));
    end if;
    return next;
  end loop;
end $$;
revoke all on function public.send_selection_emails(uuid, text, uuid[], text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.send_selection_emails(uuid, text, uuid[], text, text, boolean, boolean) to authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)') is null
     or to_regprocedure('public.get_selection_extras(uuid)') is null or to_regprocedure('public.set_selection_score(uuid,int,text)') is null
     or to_regprocedure('public.ensure_participant(uuid,uuid,uuid,uuid)') is null or to_regprocedure('app_private.selection_port_statuses(jsonb,text)') is null
     or to_regclass('public.selection_scores') is null then
    raise exception 'm33: a function or table is missing';
  end if;
  if has_function_privilege('anon', 'public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_selection_score(uuid,int,text)', 'EXECUTE')
     or has_table_privilege('anon', 'public.selection_scores', 'SELECT') then
    raise exception 'm33: anon must not reach the selection RPCs/tables';
  end if;
  if app_private.selection_port_statuses('{"stages":[{"key":"accepted","type":"accept"},{"key":"no","type":"reject"}],"passing":["accepted"]}'::jsonb, 'rejected') <> array['no']
     or app_private.selection_port_statuses('{}'::jsonb, 'approved') <> array['approved','accepted']
     or app_private.first_name('Dr. Abdel Rahman Ali') <> 'Abdel Rahman' or app_private.first_name('عبد الله محمد') <> 'عبد الله' or app_private.first_name('Mona Fathy') <> 'Mona'
     or app_private.render_email_template(E'Hi {{first_name}},\n<b>x</b>', '{"first_name":"A<b>"}'::jsonb, true) <> E'Hi A&lt;b&gt;,\n<b>x</b>'
     or app_private.render_email_template(E'Hi {{ first_name }}\nbye {{unknown}}', '{"first_name":"A"}'::jsonb, true) <> 'Hi A<br>bye ' then
    raise exception 'm33: helper self-check failed';
  end if;
  raise notice 'm33 ok';
end $$;

commit;
