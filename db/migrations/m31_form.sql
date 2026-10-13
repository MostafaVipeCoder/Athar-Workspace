-- m31_form.sql  (Form Builder node, design 01 section 3.2 / 02 section 2.3 / 03 sections 6.2 + 9 / 04 section 3.7)
-- Adds what the Form Builder node needs beyond m03/m06b/m06d. Re-runnable (create or replace / if not exists). Local DB only.
-- No business data is altered by applying this file.
--
-- 1. app_private.form_rate_limits          per (form, caller ip) sliding counter for anonymous submissions
-- 2. app_private.form_check_answers(...)   server-side validation + sanitisation by DECLARED question type (docs/04 A-9/A-11/
--                                          A-17/S-6): key whitelist, required, e-mail, phone -> E.164, number/url/date, select
--                                          options, multiselect arrays, file paths, length caps. Raises 22023 with a stable
--                                          token (`form_invalid`, detail = "<key>:<reason>") the client maps to field errors.
-- 3. public.submit_public_form(...)        the anon-callable submit RPC (03 section 6.2 "mutating public actions go through
--                                          RPC/edge code"): link + audience, open window, max_responses, honeypot (silently
--                                          dropped), rate limit, validation, one_response_per_email, insert, PM notification
--                                          (email_outbox row only, 07 worker is stage 3) and the Google Sheet append as a
--                                          queued integration_jobs row (no browser key, docs/04 S-1). Returns {id}.
-- 4. public.get_public_form(ref)           replaced (additive): description, social channels, allow_uploads, audience, slug,
--                                          closed_reason, response_count-free (no counts leak).
-- 5. app_private.save_children_form_builder replaced: when a question's KEY changes (e.g. a semantic role is assigned to a
--                                          legacy `q010` question) the stored answers are re-keyed in the same transaction so
--                                          nothing is lost and the list resolver (answers->>'founder_email') keeps working.
-- 6. storage: narrow INSERT policy on `form-uploads` for anon/authenticated guarded by app_private.form_upload_allowed(name)
--                                          (path `<project>/<form node>/<uuid>.<ext>`, form open + public/platform link + has a
--                                          file question, per-form hourly cap). Deviation from 03 section 9.2 (signed URL
--                                          from an edge function) until the edge function exists; recorded in MIGRATION-LOG.
-- 7. app_private.email_outbox scope CHECK  allows `form_new_response` rows without a sender connection (worker picks the
--                                          system sender at send time, same rule as m24's staff_invitation).
-- 8. public.restore_form_response(id)      undo of the PM's soft delete (update policy already allows it; RPC keeps one path)
set search_path = public, extensions;

begin;

-- ================================================================= 1. rate limits (app_private: never exposed)
create table if not exists app_private.form_rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);
alter table app_private.form_rate_limits enable row level security;
alter table app_private.form_rate_limits force row level security;
revoke all on app_private.form_rate_limits from public, anon, authenticated;

-- ================================================================= 2. validation (no authorisation: callers check)
drop function if exists app_private.form_phone_e164(text);
create or replace function app_private.form_phone_e164(p_raw text, p_countries text[] default null) returns text
language sql immutable set search_path = '' as $$
  -- Arabic-Indic / Persian digits -> Western, strip spaces/dashes/dots/parens, 00 -> +; a national number (leading 0)
  -- takes the dial code of the question's FIRST allowed country (same rule as web/src/lib/contact.js); then E.164.
  with c as (
    select regexp_replace(translate(coalesce(p_raw, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[\s\-\.\(\)]', '', 'g') as s,
           coalesce((select m.dial from (values ('EG','20'),('SA','966'),('AE','971'),('KW','965'),('QA','974'),('BH','973'),('OM','968'),('JO','962')) m(code, dial)
                     where m.code = upper(coalesce(p_countries[1], ''))), '20') as dial
  ), d as (
    select case when s like '00%' then '+' || substr(s, 3)
                when s like '+%' then s
                when s like '0%' then '+' || dial || substr(s, 2)
                else '+' || s end as s from c
  )
  select case when s ~ '^\+[1-9][0-9]{6,14}$' then s end from d
$$;
revoke all on function app_private.form_phone_e164(text, text[]) from public, anon, authenticated;

create or replace function app_private.form_check_answers(p_node uuid, p_answers jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  q record; v jsonb; s text; n numeric; out_answers jsonb := '{}'::jsonb; k text; opts jsonb; has_other boolean;
  v_min numeric; v_max numeric; v_minlen int; v_maxlen int; arr jsonb; el jsonb; cleaned text[];
  v_project uuid;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'form_invalid: answers must be an object' using errcode = '22023', hint = 'form_invalid', detail = '_:object';
  end if;
  select project_id into v_project from public.nodes where id = p_node;
  for k in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from public.form_questions fq where fq.node_id = p_node and fq.key = k) then
      raise exception 'form_invalid: unknown answer key' using errcode = '22023', hint = 'form_invalid', detail = k || ':unknown';
    end if;
  end loop;

  for q in select fq.* from public.form_questions fq where fq.node_id = p_node order by fq.order_index loop
    v := p_answers -> q.key;
    -- normalise "empty"
    if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      if q.is_required and q.type <> 'hidden' then
        raise exception 'form_invalid: missing required answer' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':required';
      end if;
      continue;
    end if;
    v_minlen := nullif(coalesce(q.validation->>'minLength', ''), '')::int;
    v_maxlen := nullif(coalesce(q.validation->>'maxLength', ''), '')::int;
    v_min := nullif(coalesce(q.validation->>'min', q.validation->>'minValue', ''), '')::numeric;
    v_max := nullif(coalesce(q.validation->>'max', q.validation->>'maxValue', ''), '')::numeric;

    if q.type in ('text', 'textarea', 'hidden') then
      s := btrim(case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end);
      if length(s) > (case when q.type = 'textarea' then 20000 else 4000 end) then
        raise exception 'form_invalid: too long' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':maxLength';
      end if;
      if v_minlen is not null and length(s) < v_minlen then raise exception 'form_invalid: too short' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':minLength'; end if;
      if v_maxlen is not null and length(s) > v_maxlen then raise exception 'form_invalid: too long' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':maxLength'; end if;
      out_answers := out_answers || jsonb_build_object(q.key, s);
    elsif q.type = 'email' then
      s := lower(btrim(v #>> '{}'));
      if s !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(s) > 254 then
        raise exception 'form_invalid: bad e-mail' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':email';
      end if;
      out_answers := out_answers || jsonb_build_object(q.key, s);
    elsif q.type = 'tel' then
      s := app_private.form_phone_e164(v #>> '{}', case when jsonb_typeof(q.validation->'allowed_countries') = 'array' then array(select jsonb_array_elements_text(q.validation->'allowed_countries')) end);
      if s is null then raise exception 'form_invalid: bad phone' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':phone'; end if;
      out_answers := out_answers || jsonb_build_object(q.key, s);
    elsif q.type = 'number' then
      begin
        n := (btrim(v #>> '{}'))::numeric;
      exception when others then
        raise exception 'form_invalid: not a number' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':number';
      end;
      if v_min is not null and n < v_min then raise exception 'form_invalid: below min' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':min'; end if;
      if v_max is not null and n > v_max then raise exception 'form_invalid: above max' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':max'; end if;
      out_answers := out_answers || jsonb_build_object(q.key, n);
    elsif q.type = 'url' then
      s := btrim(v #>> '{}');
      if s !~* '^https?://' then s := 'https://' || s; end if;
      if s !~* '^https?://[^\s/$.?#].[^\s]*$' or length(s) > 2000 then
        raise exception 'form_invalid: bad url' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':url';
      end if;
      out_answers := out_answers || jsonb_build_object(q.key, s);
    elsif q.type = 'date' then
      s := btrim(v #>> '{}');
      if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'form_invalid: bad date' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':date'; end if;
      begin
        perform s::date;
      exception when others then
        raise exception 'form_invalid: bad date' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':date';
      end;
      out_answers := out_answers || jsonb_build_object(q.key, s);
    elsif q.type in ('select', 'multiselect') then
      opts := coalesce(q.options, '[]'::jsonb);
      has_other := exists (select 1 from jsonb_array_elements(opts) o where coalesce((o->>'is_other')::boolean, false));
      arr := case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end;
      if q.type = 'select' and jsonb_array_length(arr) <> 1 then
        raise exception 'form_invalid: one choice expected' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':option';
      end if;
      cleaned := '{}';
      for el in select * from jsonb_array_elements(arr) loop
        s := btrim(el #>> '{}');
        if s = '' then continue; end if;
        if not exists (select 1 from jsonb_array_elements(opts) o where o->>'value' = s) then
          if not has_other or length(s) > 200 then
            raise exception 'form_invalid: unknown option' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':option';
          end if;
        end if;
        if not (s = any (cleaned)) then cleaned := cleaned || s; end if;
      end loop;
      if array_length(cleaned, 1) is null then
        if q.is_required then raise exception 'form_invalid: missing required answer' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':required'; end if;
        continue;
      end if;
      out_answers := out_answers || jsonb_build_object(q.key, case when q.type = 'select' then to_jsonb(cleaned[1]) else to_jsonb(cleaned) end);
    elsif q.type = 'file' then
      s := btrim(v #>> '{}');
      if not (s ~ ('^' || v_project::text || '/' || p_node::text || '/[0-9a-f-]{36}\.[a-z0-9]{1,5}$') or (s ~* '^https?://\S+$' and length(s) <= 1000)) then
        raise exception 'form_invalid: bad file' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':file';
      end if;
      out_answers := out_answers || jsonb_build_object(q.key, s);
    else
      raise exception 'form_invalid: unsupported type' using errcode = '22023', hint = 'form_invalid', detail = q.key || ':type';
    end if;
  end loop;
  return out_answers;
end $$;
revoke all on function app_private.form_check_answers(uuid, jsonb) from public, anon, authenticated;

-- ================================================================= 7. outbox scope: PM notification rows have no sender yet
alter table app_private.email_outbox drop constraint if exists email_outbox_scope_chk;
alter table app_private.email_outbox add constraint email_outbox_scope_chk check (
     (project_id is not null and node_id is not null and sender_connection_id is not null)
  or (email_key = 'staff_invitation' and project_id is null and node_id is null)
  or (email_key = 'form_new_response' and project_id is not null and node_id is not null)
);

-- ================================================================= 3. submit_public_form (anon + authenticated)
create or replace function public.submit_public_form(p_ref text, p_answers jsonb, p_tracking jsonb default '{}'::jsonb, p_website text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l record; n public.nodes; f public.forms; v_id uuid; v_cnt bigint; v_email text; v_clean jsonb; v_track jsonb;
  v_headers jsonb; v_ip text; v_bucket text; v_hits int; v_window timestamptz; r record; v_pm text; v_form_name text;
begin
  -- honeypot: bots fill the hidden field; answer like a success without storing anything (no tip-off)
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    return jsonb_build_object('id', null, 'accepted', false);
  end if;

  select * into l from app_private.resolve_link('form', p_ref) r limit 1;      -- audience: public / participant / pm
  if not found or l.node_id is null then raise exception 'form_not_found: no such form' using errcode = 'P0002', hint = 'form_not_found'; end if;
  select * into n from public.nodes where id = l.node_id and type = 'form_builder' and deleted_at is null;
  if not found then raise exception 'form_not_found: no such form' using errcode = 'P0002', hint = 'form_not_found'; end if;
  select * into f from public.forms where node_id = n.id for update;        -- serialises max_responses / per-email checks
  if not found then raise exception 'form_not_found: no such form' using errcode = 'P0002', hint = 'form_not_found'; end if;

  if not f.is_active or (f.opens_at is not null and f.opens_at > now()) or (f.closes_at is not null and f.closes_at <= now()) then
    raise exception 'form_closed: the form is not accepting responses' using errcode = 'P0001', hint = 'form_closed';
  end if;
  if f.max_responses is not null then
    select count(*) into v_cnt from public.form_responses fr where fr.node_id = n.id and fr.deleted_at is null;
    if v_cnt >= f.max_responses then raise exception 'form_full: the form reached its maximum' using errcode = 'P0001', hint = 'form_full'; end if;
  end if;

  -- rate limit per (form, caller ip): 20 submissions / 10 minutes (PostgREST passes the headers; absent = one shared bucket)
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(v_headers->>'cf-connecting-ip', nullif(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), ''), v_headers->>'x-real-ip', 'unknown');
  v_bucket := md5(n.id::text || '|' || btrim(v_ip));
  insert into app_private.form_rate_limits (bucket, window_start, hits) values (v_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when app_private.form_rate_limits.window_start < now() - interval '10 minutes' then 1 else app_private.form_rate_limits.hits + 1 end,
    window_start = case when app_private.form_rate_limits.window_start < now() - interval '10 minutes' then now() else app_private.form_rate_limits.window_start end
  returning hits, window_start into v_hits, v_window;
  if v_hits > 20 then raise exception 'form_rate_limited: too many submissions' using errcode = 'P0001', hint = 'form_rate_limited'; end if;
  if random() < 0.02 then delete from app_private.form_rate_limits where window_start < now() - interval '1 day'; end if;

  v_clean := app_private.form_check_answers(n.id, p_answers);

  if f.one_response_per_email then
    select lower(v_clean->>fq.key) into v_email from public.form_questions fq
     where fq.node_id = n.id and fq.type = 'email' order by (fq.semantic = 'founder_email') desc nulls last, fq.order_index limit 1;
    if v_email is not null and exists (
        select 1 from public.form_responses fr join public.form_questions fq on fq.node_id = fr.node_id and fq.type = 'email'
         where fr.node_id = n.id and fr.deleted_at is null and lower(fr.answers->>fq.key) = v_email) then
      raise exception 'form_duplicate: this e-mail already responded' using errcode = '23505', hint = 'form_duplicate';
    end if;
  end if;

  -- tracking: whitelisted keys, each capped (04 section 3.7: tracking <= 2 KB)
  v_track := jsonb_strip_nulls(jsonb_build_object(
    'source', left(nullif(btrim(coalesce(p_tracking->>'source', '')), ''), 64),
    'utm_source', left(nullif(p_tracking->>'utm_source', ''), 64), 'utm_medium', left(nullif(p_tracking->>'utm_medium', ''), 64),
    'utm_campaign', left(nullif(p_tracking->>'utm_campaign', ''), 64), 'utm_content', left(nullif(p_tracking->>'utm_content', ''), 64),
    'referrer', left(nullif(p_tracking->>'referrer', ''), 200), 'lang', left(nullif(p_tracking->>'lang', ''), 2)));

  insert into public.form_responses (project_id, node_id, answers, source, tracking, submitted_by)
  values (n.project_id, n.id, v_clean, coalesce(v_track->>'source', v_track->>'utm_source', 'direct'), v_track, (select auth.uid()))
  returning id into v_id;

  -- PM notification: queued only (07 worker is stage 3); one row per project manager, idempotent per (response, e-mail)
  if coalesce((n.config->>'notify_pm')::boolean, false) then
    v_form_name := coalesce(n.name_en, n.name_ar, 'Form');
    for r in
      select distinct u.email
        from auth.users u
       where u.email is not null and u.deleted_at is null and (
             u.id in (select m.user_id from public.project_members m where m.project_id = n.project_id)
          or u.id in (select pm.user_id from public.program_members pm join public.projects j on j.program_id = pm.program_id where j.id = n.project_id))
    loop
      insert into app_private.email_outbox (project_id, node_id, email_key, recipient_email, subject, body_html, idempotency_key, status, created_by)
      values (n.project_id, n.id, 'form_new_response', r.email,
              'New response: ' || v_form_name,
              '<p>A new response arrived for the form <strong>' || replace(replace(v_form_name, '<', '&lt;'), '>', '&gt;') || '</strong>.</p><p>Open the Responses tab of the form in Athar to review it.</p>',
              'form_new_response:' || v_id::text || ':' || lower(r.email), 'queued', (select auth.uid()))
      on conflict (idempotency_key) do nothing;
    end loop;
  end if;

  -- Google Sheet append: only a queued job (docs/04 S-1: no service-account key in the browser); the worker reads the answers
  if nullif(btrim(coalesce(f.export_sheet_id, '')), '') is not null then
    insert into app_private.integration_jobs (kind, project_id, form_response_id, idempotency_key, payload)
    values ('sheets_append', n.project_id, v_id, 'sheets_append:' || v_id::text,
            jsonb_build_object('node_id', n.id, 'response_id', v_id, 'sheet_id', f.export_sheet_id, 'sheet_tab', f.export_sheet_tab))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('id', v_id, 'accepted', true);
end $$;
revoke all on function public.submit_public_form(text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_public_form(text, jsonb, jsonb, text) to anon, authenticated;

-- ================================================================= 4. get_public_form (m06d body + additive keys)
create or replace function public.get_public_form(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; n public.nodes; f public.forms; v_full boolean; v_open boolean;
begin
  select * into l from app_private.resolve_link('form', p_ref) r limit 1;
  if not found then return null; end if;
  select * into n from public.nodes where id = l.node_id and type = 'form_builder' and deleted_at is null;
  if not found then return null; end if;
  select * into f from public.forms where node_id = n.id;
  v_full := f.max_responses is not null and (select count(*) from public.form_responses fr where fr.node_id = n.id and fr.deleted_at is null) >= f.max_responses;
  v_open := f.is_active and (f.opens_at is null or f.opens_at <= now()) and (f.closes_at is null or f.closes_at > now()) and not v_full;
  return jsonb_build_object(
    'node_id', n.id, 'project_id', n.project_id, 'name_en', n.name_en, 'name_ar', n.name_ar,
    'description_en', n.config->'description'->>'en', 'description_ar', n.config->'description'->>'ar',
    'audience', l.audience, 'slug', l.slug,
    'is_open', v_open,
    'closed_reason', case when v_open then null when not f.is_active then 'inactive'
                          when f.opens_at is not null and f.opens_at > now() then 'not_open'
                          when f.closes_at is not null and f.closes_at <= now() then 'closed' when v_full then 'full' end,
    'opens_at', f.opens_at, 'closes_at', f.closes_at,
    'cover_path', (select c.image_path from public.form_covers c where c.id = f.cover_id),
    'thank_you', n.config->'thank_you',
    'social', n.config->'social',
    'allow_uploads', exists (select 1 from public.form_questions fq where fq.node_id = n.id and fq.type = 'file'),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title_en', s.title_en, 'title_ar', s.title_ar,
                 'description_en', s.description_en, 'description_ar', s.description_ar, 'order_index', s.order_index) order by s.order_index)
                 from public.form_sections s where s.node_id = n.id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'section_id', q.section_id, 'key', q.key, 'type', q.type,
                 'semantic', q.semantic, 'label_en', q.label_en, 'label_ar', q.label_ar, 'description_en', q.description_en,
                 'description_ar', q.description_ar, 'placeholder_en', q.placeholder_en, 'placeholder_ar', q.placeholder_ar,
                 'is_required', q.is_required, 'options', q.options, 'validation', q.validation, 'order_index', q.order_index) order by q.order_index)
                 from public.form_questions q where q.node_id = n.id), '[]'::jsonb));
end $$;
grant execute on function public.get_public_form(text) to anon, authenticated;

-- ================================================================= 5. save_children_form_builder (m06b body + answer re-keying)
create or replace function app_private.save_children_form_builder(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; keep_s uuid[]; keep_q uuid[]; f jsonb := p_children->'form'; r record;
begin
  select project_id into v_project from public.nodes where id = p_node;
  if f is not null then
    update public.forms set
      is_active = coalesce((f->>'is_active')::boolean, is_active),
      opens_at = case when f ? 'opens_at' then (f->>'opens_at')::timestamptz else opens_at end,
      closes_at = case when f ? 'closes_at' then (f->>'closes_at')::timestamptz else closes_at end,
      max_responses = case when f ? 'max_responses' then (f->>'max_responses')::int else max_responses end,
      one_response_per_email = coalesce((f->>'one_response_per_email')::boolean, one_response_per_email),
      export_sheet_id = case when f ? 'export_sheet_id' then f->>'export_sheet_id' else export_sheet_id end,
      export_sheet_tab = case when f ? 'export_sheet_tab' then f->>'export_sheet_tab' else export_sheet_tab end,
      cover_id = case when f ? 'cover_id' then (f->>'cover_id')::uuid else cover_id end,
      template_id = case when f ? 'template_id' then (f->>'template_id')::uuid else template_id end
    where node_id = p_node;
  end if;
  if p_children ? 'sections' then
    if exists (select 1 from jsonb_to_recordset(p_children->'sections') as x(id uuid)
               join public.form_sections s on s.id = x.id where s.node_id <> p_node) then
      raise exception 'a section id belongs to another form' using errcode = '42501';
    end if;
    with up as (
      insert into public.form_sections (id, project_id, node_id, title_en, title_ar, description_en, description_ar, order_index)
      select coalesce(x.id, gen_random_uuid()), v_project, p_node, x.title_en, x.title_ar, x.description_en, x.description_ar,
             coalesce(x.order_index, 0)
      from jsonb_to_recordset(p_children->'sections') as x(id uuid, title_en text, title_ar text, description_en text,
           description_ar text, order_index int)
      on conflict (id) do update set title_en = excluded.title_en, title_ar = excluded.title_ar,
        description_en = excluded.description_en, description_ar = excluded.description_ar, order_index = excluded.order_index
      returning id)
    select array_agg(id) into keep_s from up;
  end if;
  if p_children ? 'questions' then
    if exists (select 1 from jsonb_to_recordset(p_children->'questions') as x(id uuid)
               join public.form_questions q on q.id = x.id where q.node_id <> p_node) then
      raise exception 'a question id belongs to another form' using errcode = '42501';
    end if;
    -- a renamed key (typically: a semantic role assigned to an existing question) re-keys the stored answers (nothing lost)
    for r in
      select q.key as old_key, x.key as new_key
        from jsonb_to_recordset(p_children->'questions') as x(id uuid, key text)
        join public.form_questions q on q.id = x.id and q.node_id = p_node
       where x.key is not null and x.key <> q.key
    loop
      update public.form_responses fr
         set answers = (fr.answers - r.old_key) || jsonb_build_object(r.new_key, fr.answers -> r.old_key)
       where fr.node_id = p_node and fr.answers ? r.old_key and not (fr.answers ? r.new_key);
    end loop;
    -- two-phase upsert so swapped keys never collide with (node_id, key)
    update public.form_questions q set key = '__tmp_' || q.id::text
     where q.node_id = p_node and q.id in (select x.id from jsonb_to_recordset(p_children->'questions') as x(id uuid, key text) where x.key <> q.key);
    with up as (
      insert into public.form_questions (id, project_id, node_id, section_id, key, type, semantic, label_en, label_ar,
                  description_en, description_ar, placeholder_en, placeholder_ar, is_required, options, validation, order_index)
      select coalesce(x.id, gen_random_uuid()), v_project, p_node, x.section_id, x.key, x.type, x.semantic, x.label_en, x.label_ar,
             x.description_en, x.description_ar, x.placeholder_en, x.placeholder_ar, coalesce(x.is_required, false),
             x.options, x.validation, coalesce(x.order_index, 0)
      from jsonb_to_recordset(p_children->'questions') as x(id uuid, section_id uuid, key text, type text, semantic text,
           label_en text, label_ar text, description_en text, description_ar text, placeholder_en text, placeholder_ar text,
           is_required boolean, options jsonb, validation jsonb, order_index int)
      on conflict (id) do update set section_id = excluded.section_id, key = excluded.key, type = excluded.type,
        semantic = excluded.semantic, label_en = excluded.label_en, label_ar = excluded.label_ar,
        description_en = excluded.description_en, description_ar = excluded.description_ar,
        placeholder_en = excluded.placeholder_en, placeholder_ar = excluded.placeholder_ar,
        is_required = excluded.is_required, options = excluded.options, validation = excluded.validation,
        order_index = excluded.order_index
      returning id)
    select array_agg(id) into keep_q from up;
    delete from public.form_questions where node_id = p_node and id <> all (coalesce(keep_q, '{}'));
  end if;
  if p_children ? 'sections' then
    delete from public.form_sections where node_id = p_node and id <> all (coalesce(keep_s, '{}'));
  end if;
end $$;
revoke all on function app_private.save_children_form_builder(uuid, jsonb) from public, anon, authenticated;

-- ================================================================= 8. restore a soft-deleted response (undo)
create or replace function public.restore_form_response(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.form_responses;
begin
  select * into v from public.form_responses where id = p_id for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.form_responses set deleted_at = null where id = p_id;
end $$;
revoke all on function public.restore_form_response(uuid) from public, anon, authenticated;
grant execute on function public.restore_form_response(uuid) to authenticated;

-- ================================================================= 6. form-uploads: guarded public INSERT
create or replace function app_private.form_upload_allowed(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; v_project uuid; v_node uuid; f public.forms; n public.nodes; v_recent bigint;
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) <> 3 then return false; end if;
  if parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|gif|pdf|docx|xlsx|txt)$' then return false; end if;
  v_project := parts[1]::uuid; v_node := parts[2]::uuid;
  select * into n from public.nodes where id = v_node and project_id = v_project and type = 'form_builder' and deleted_at is null;
  if not found then return false; end if;
  select * into f from public.forms where node_id = v_node;
  if not found or not f.is_active or (f.opens_at is not null and f.opens_at > now()) or (f.closes_at is not null and f.closes_at <= now()) then return false; end if;
  if not exists (select 1 from public.form_questions q where q.node_id = v_node and q.type = 'file') then return false; end if;
  if not app_private.is_project_manager(v_project) then
    if n.visibility not in ('public', 'platform') then return false; end if;
    if not exists (select 1 from public.public_links l where l.node_id = v_node and l.kind = 'form' and l.is_enabled and (l.expires_at is null or l.expires_at > now())) then return false; end if;
    if n.visibility = 'platform' and not app_private.is_participant(v_project) then return false; end if;
  end if;
  select count(*) into v_recent from storage.objects o where o.bucket_id = 'form-uploads' and o.name like parts[1] || '/' || parts[2] || '/%' and o.created_at > now() - interval '1 hour';
  return v_recent < 100;
end $$;
revoke all on function app_private.form_upload_allowed(text) from public, anon, authenticated;

drop policy if exists form_uploads_insert_public on storage.objects;
create policy form_uploads_insert_public on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'form-uploads' and (select app_private.form_upload_allowed(name)));

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.submit_public_form(text,jsonb,jsonb,text)') is null or to_regprocedure('app_private.form_check_answers(uuid,jsonb)') is null
     or to_regprocedure('app_private.form_upload_allowed(text)') is null or to_regprocedure('public.restore_form_response(uuid)') is null then
    raise exception 'm31: a function is missing';
  end if;
  if not has_function_privilege('anon', 'public.submit_public_form(text,jsonb,jsonb,text)', 'EXECUTE') then raise exception 'm31: anon must execute submit_public_form'; end if;
  if has_function_privilege('anon', 'public.submit_form_response(text,jsonb,jsonb)', 'EXECUTE') then raise exception 'm31: anon must not execute submit_form_response'; end if;
  if has_function_privilege('anon', 'app_private.form_check_answers(uuid,jsonb)', 'EXECUTE') then raise exception 'm31: anon must not execute the helper'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'form_uploads_insert_public') then raise exception 'm31: upload policy missing'; end if;
  raise notice 'm31 ok';
end $$;

commit;
