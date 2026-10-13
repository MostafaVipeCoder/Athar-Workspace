-- m38_certificates.sql  (Certificates node, design 01 section 3.10 / 02 section 7 / 03 / 04 sections 3.13 + 5.7 / 07 section 4 / decisions 01-11, 06-5, 07-8, 07-9)
-- Adds what the Certificates node needs beyond m04 / m06a / m06d / m07. Re-runnable (create or replace / if not exists). Local DB only.
-- No business data is altered (0 certificates, 0 templates, 0 certificate nodes exist; the empty legacy `certificates` table was folded into
-- public.certificates by the stage-2a loader: nothing to migrate).
--
-- 1. public.certificates: UNIQUE (node_id, participant_id) becomes a PARTIAL unique index on the ACTIVE rows (revoked_at IS NULL): one active
--    certificate per participant per node, a revoked one can be re-issued as a NEW certificate (new code) and the history stays.
--    certificate_templates.file_path must live under `<project>/<node>/` (no pointing a template at another project's private file).
-- 2. node_types.certificates: ports (the participants edge is optional: nothing emits rows:participant yet, the node reads the project's
--    participants), save_children_fn = save_children_certificates.
-- 3. app_private helpers (revoked from the API roles): cert_normalize_code, cert_names (name as stored, in the template language, whitespace
--    collapsed), cert_fields_json / cert_render_json (the payload the client canvas renderer needs; PUBLIC variant keeps only the values the
--    template actually prints), cert_verify_limit (rate limit per hashed caller).
-- 4. app_private.save_children_certificates(node, { template: { language, file_path, file_kind, width_px, height_px, fields[] } }):
--    validated; a template that issued certificates reference is IMMUTABLE (m06a trigger) so a change creates the next VERSION, an
--    unreferenced one is updated in place. Called by save_node under the revision token.
-- 5. issue_certificates(node, participants[] | null) -> per-row results. Rules (decisions 01-11 / 07-8): the caller is a PM of the project, the
--    project is completed, the participant is `attended`, one ACTIVE certificate per participant per node (idempotent: an existing one is
--    returned, nothing is created twice), the template of the node language must exist. "All" skips participants whose certificate was revoked
--    (the PM re-issues those on purpose by selecting them). The row's snapshot freezes name + company + program + project + dates + template version.
--    issue_certificate / issue_certificates_bulk (m06d) are kept and delegate to the same code.
-- 6. revoke_certificate(cert, reason) re-created with validation (manual revocation, decision 07-9; the UI warns first).
-- 7. get_certificates_admin(node): the Issue panel payload (project completion, template state, rows = attended participants + anyone holding a certificate).
-- 8. get_certificate_render_payload(cert) re-created: PM, or the OWNER (attended, not revoked, project completed, node show_to_participants).
--    list_my_certificates(project) for the founder Program page block.
-- 9. get_public_certificate_verification(code) (anon + authenticated): valid | revoked | not_found, name + program + dates only; per-caller rate
--    limit; the node's `verifier.enabled` switch; the render payload only for a valid certificate and `verifier.showCertificate`.
--    verify_certificate(code) (m06d name, still granted to anon) delegates to it.
-- 10. Storage (the PRIVATE `certificate-templates` bucket): PM delete / update of a template image that issued certificates reference is
--    refused (public.cert_template_deletable); SELECT policy for anon + authenticated through public.cert_template_readable(name)
--    (the template of a certificate the public verifier may show, or of the caller's OWN issued certificate). PMs keep their m07 policies.
set search_path = public, extensions;

begin;

-- ================================================================= 1. schema
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'certificates_node_id_participant_id_key' and conrelid = 'public.certificates'::regclass) then
    alter table public.certificates drop constraint certificates_node_id_participant_id_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'certificate_templates_path_chk' and conrelid = 'public.certificate_templates'::regclass) then
    alter table public.certificate_templates add constraint certificate_templates_path_chk
      check (left(file_path, 74) = project_id::text || '/' || node_id::text || '/' and file_path !~ '\.\.');
  end if;
end $$;
create unique index if not exists certificates_active_key on public.certificates (node_id, participant_id) where revoked_at is null;
create index if not exists certificates_node_idx on public.certificates (node_id, issued_at desc);

-- ================================================================= 2. node type row
update public.node_types set
  ports = '[{"key":"participants","direction":"in","families":["rows:participant"],"kind":null,"cardinality":"one","required":false,"label":{"en":"Participants","ar":"المشاركون"}}]'::jsonb,
  save_children_fn = 'save_children_certificates'
 where key = 'certificates';

-- ================================================================= 3. helpers
create or replace function app_private.cert_normalize_code(p text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare v text;
begin
  v := translate(upper(regexp_replace(coalesce(p, ''), '[\s-]', '', 'g')), 'OIL', '011');   -- Crockford decoding: O -> 0, I / L -> 1
  if v !~ '^[0-9A-HJKMNP-TV-Z]{12}$' then return null; end if;
  return substr(v, 1, 4) || '-' || substr(v, 5, 4) || '-' || substr(v, 9, 4);
end $$;
revoke all on function app_private.cert_normalize_code(text) from public, anon, authenticated;

-- The names a certificate prints, "as stored" (decision 07-8), in the language of the template, whitespace collapsed:
--   participant_name = the person: the form response's founder name, else the signed-in account's profile name, else the company's primary
--                      founder, else the company name;  company_name = the company (the response's company answer as the last fallback).
create or replace function app_private.cert_names(p public.participants, p_lang text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; fr public.form_responses; v_company text; v_person text;
begin
  select * into c from public.companies where id = p.company_id;
  select * into fr from public.form_responses where id = p.form_response_id;
  v_company := nullif(btrim(regexp_replace(case when p_lang = 'ar' then coalesce(nullif(c.name_ar, ''), nullif(c.name_en, ''))
                                                else coalesce(nullif(c.name_en, ''), nullif(c.name_ar, '')) end, '\s+', ' ', 'g')), '');
  v_company := coalesce(v_company, nullif(btrim(regexp_replace(coalesce(fr.answers->>'company_name', ''), '\s+', ' ', 'g')), ''));
  v_person := nullif(btrim(regexp_replace(coalesce(fr.answers->>'founder_name', ''), '\s+', ' ', 'g')), '');
  if v_person is null and p.user_id is not null then
    select nullif(btrim(regexp_replace(coalesce(pr.full_name, ''), '\s+', ' ', 'g')), '') into v_person from public.profiles pr where pr.id = p.user_id;
  end if;
  if v_person is null and p.company_id is not null then
    select nullif(btrim(regexp_replace(case when p_lang = 'ar' then coalesce(nullif(f.name_ar, ''), nullif(f.name_en, ''))
                                            else coalesce(nullif(f.name_en, ''), nullif(f.name_ar, '')) end, '\s+', ' ', 'g')), '')
      into v_person
      from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
     where cf.company_id = p.company_id order by cf.is_primary desc, cf.created_at limit 1;
  end if;
  return jsonb_build_object('participant_name', coalesce(v_person, v_company, ''), 'company_name', coalesce(v_company, ''));
end $$;
revoke all on function app_private.cert_names(public.participants, text) from public, anon, authenticated;

create or replace function app_private.cert_fields_json(p_template uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('var', f.var, 'x', f.x, 'y', f.y, 'w', f.w, 'align', f.align, 'font', f.font, 'size', f.size,
                  'color', f.color, 'weight', f.weight, 'direction', f.direction, 'max_lines', f.max_lines, 'shrink_to_fit', f.shrink_to_fit) order by f.var), '[]'::jsonb)
    from public.certificate_template_fields f where f.template_id = p_template
$$;
revoke all on function app_private.cert_fields_json(uuid) from public, anon, authenticated;

-- The payload of the client canvas renderer (decision 06-5). `p_public` keeps ONLY the snapshot values that a field of the template prints.
create or replace function app_private.cert_render_json(c public.certificates, p_public boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.certificate_templates; v_fields jsonb; v_snap jsonb;
begin
  select * into t from public.certificate_templates where id = c.template_id;
  v_fields := app_private.cert_fields_json(t.id);
  if p_public then
    v_snap := coalesce((select jsonb_object_agg(m.k, c.snapshot->m.k) from (
        select distinct case f->>'var' when 'participant_name' then 'participant_name' when 'company_name' then 'company_name'
                                       when 'program_name' then 'program_name' when 'project_name' then 'project_name'
                                       when 'completion_date' then 'completed_on' when 'issue_date' then 'issued_on' end as k
          from jsonb_array_elements(v_fields) f) m where m.k is not null and c.snapshot ? m.k), '{}'::jsonb);
  else
    v_snap := c.snapshot;
  end if;
  return jsonb_build_object('id', c.id, 'code', c.code, 'snapshot', v_snap, 'revoked', c.revoked_at is not null, 'issued_at', c.issued_at,
    'template', jsonb_build_object('id', t.id, 'file_path', t.file_path, 'file_kind', t.file_kind, 'width_px', t.width_px, 'height_px', t.height_px,
                'language', t.language, 'version', t.version, 'bucket', 'certificate-templates'),
    'fields', v_fields);
end $$;
revoke all on function app_private.cert_render_json(public.certificates, boolean) from public, anon, authenticated;

-- rate limit of the public verifier: 40 lookups / 10 minutes per hashed caller (the caller is only ever seen as a one-way hash)
create table if not exists app_private.certificate_verify_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);
alter table app_private.certificate_verify_limits enable row level security;
alter table app_private.certificate_verify_limits force row level security;
revoke all on app_private.certificate_verify_limits from public, anon, authenticated;

create or replace function app_private.cert_verify_limit() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_headers jsonb; v_ip text; v_bucket text; v_hits int;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(v_headers->>'cf-connecting-ip', nullif(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), ''), v_headers->>'x-real-ip', 'unknown');
  v_bucket := md5('cert|' || btrim(v_ip));
  insert into app_private.certificate_verify_limits (bucket, window_start, hits) values (v_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when app_private.certificate_verify_limits.window_start < now() - interval '10 minutes' then 1 else app_private.certificate_verify_limits.hits + 1 end,
    window_start = case when app_private.certificate_verify_limits.window_start < now() - interval '10 minutes' then now() else app_private.certificate_verify_limits.window_start end
  returning hits into v_hits;
  if random() < 0.02 then delete from app_private.certificate_verify_limits where window_start < now() - interval '1 day'; end if;
  return v_hits <= 40;
end $$;
revoke all on function app_private.cert_verify_limit() from public, anon, authenticated;

-- ================================================================= 4. save_children_certificates
-- children = { template: { language, file_path, file_kind: 'image', width_px, height_px, fields: [{ var, x, y, w, align, font, size, color, weight,
--                          direction, max_lines, shrink_to_fit }] } }.  A missing `template` key leaves the templates untouched.
-- Fractions: x / w are fractions of the template WIDTH, y of its HEIGHT; text `size` is a fraction of the WIDTH; the QR box is a square whose
-- side is `w` (= `size`) as a fraction of the width. (x, y) is the CENTRE of the box.
create or replace function app_private.save_children_certificates(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid; v_prefix text; v_tpl jsonb; v_lang text; v_path text; v_w int; v_h int; v_fields jsonb; f jsonb; v_var text; seen text[] := '{}';
  t public.certificate_templates; v_old jsonb; v_new jsonb; v_id uuid; v_ref boolean;
  v_color text; v_font text; v_size numeric; v_wt int; v_ml int;
begin
  select project_id into v_project from public.nodes where id = p_node;
  v_prefix := v_project::text || '/' || p_node::text || '/';
  if p_children is null or not (p_children ? 'template') or jsonb_typeof(p_children->'template') = 'null' then return; end if;
  v_tpl := p_children->'template';
  if jsonb_typeof(v_tpl) <> 'object' then
    raise exception 'certificate_invalid: template must be an object' using errcode = '22023', hint = 'certificate_invalid', detail = 'template:type';
  end if;
  v_lang := v_tpl->>'language';
  if v_lang is null or v_lang not in ('ar', 'en') then
    raise exception 'certificate_invalid: language must be ar or en' using errcode = '22023', hint = 'certificate_invalid', detail = 'language:invalid';
  end if;
  v_path := v_tpl->>'file_path';
  if v_path is null or left(v_path, length(v_prefix)) <> v_prefix or v_path ~ '\.\.' or length(v_path) > 300 then
    raise exception 'certificate_invalid: the template file must be stored in this node folder' using errcode = '22023', hint = 'certificate_invalid', detail = 'file_path:invalid';
  end if;
  if coalesce(v_tpl->>'file_kind', 'image') <> 'image' then
    raise exception 'certificate_invalid: only image templates are supported' using errcode = '22023', hint = 'certificate_invalid', detail = 'file_kind:invalid';
  end if;
  begin
    v_w := (v_tpl->>'width_px')::int; v_h := (v_tpl->>'height_px')::int;
  exception when others then
    raise exception 'certificate_invalid: the template size is not a number' using errcode = '22023', hint = 'certificate_invalid', detail = 'size:invalid';
  end;
  if v_w is null or v_h is null or v_w not between 600 and 10000 or v_h not between 600 and 10000 then
    raise exception 'certificate_invalid: the template size is out of range' using errcode = '22023', hint = 'certificate_invalid', detail = 'size:out_of_range';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'certificate-templates' and o.name = v_path) then
    raise exception 'certificate_invalid: the template file was not uploaded' using errcode = '22023', hint = 'certificate_invalid', detail = 'file_path:file_missing';
  end if;

  v_fields := coalesce(v_tpl->'fields', '[]'::jsonb);
  if jsonb_typeof(v_fields) <> 'array' or jsonb_array_length(v_fields) > 12 then
    raise exception 'certificate_invalid: fields must be an array of at most 12' using errcode = '22023', hint = 'certificate_invalid', detail = 'fields:invalid';
  end if;
  v_new := '[]'::jsonb;
  for f in select * from jsonb_array_elements(v_fields) loop
    if jsonb_typeof(f) <> 'object' then
      raise exception 'certificate_invalid: a field must be an object' using errcode = '22023', hint = 'certificate_invalid', detail = 'fields:invalid';
    end if;
    v_var := f->>'var';
    if v_var is null or v_var not in ('participant_name','company_name','program_name','project_name','issue_date','completion_date','verification_code','verification_qr') then
      raise exception 'certificate_invalid: unknown variable' using errcode = '22023', hint = 'certificate_invalid', detail = 'var:invalid';
    end if;
    if v_var = any (seen) then
      raise exception 'certificate_invalid: a variable can be placed once' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':duplicate';
    end if;
    seen := seen || v_var;
    begin
      if (f->>'x')::numeric not between 0 and 1 or (f->>'y')::numeric not between 0 and 1 or (f->>'w')::numeric not between 0.01 and 1 then
        raise exception 'range';
      end if;
      v_size := coalesce((f->>'size')::numeric, case when v_var = 'verification_qr' then (f->>'w')::numeric else 0.03 end);
      if v_var = 'verification_qr' then
        if v_size not between 0.03 and 0.5 then raise exception 'range'; end if;
      elsif v_size not between 0.005 and 0.2 then
        raise exception 'range';
      end if;
    exception when others then
      raise exception 'certificate_invalid: a position or size is out of range' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':position';
    end;
    v_color := coalesce(f->>'color', '#1a1a2e');
    if v_color !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'certificate_invalid: bad colour' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':color';
    end if;
    v_font := coalesce(nullif(f->>'font', ''), 'Tajawal');
    if v_font !~ '^[A-Za-z0-9 _-]{1,40}$' then
      raise exception 'certificate_invalid: bad font' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':font';
    end if;
    begin
      v_wt := coalesce((f->>'weight')::int, 700);
      v_ml := coalesce((f->>'max_lines')::int, 1);
    exception when others then
      raise exception 'certificate_invalid: bad weight / lines' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':weight';
    end;
    if v_wt not in (300, 400, 500, 600, 700, 800, 900) or v_ml not between 1 and 4 then
      raise exception 'certificate_invalid: bad weight / lines' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':weight';
    end if;
    if coalesce(f->>'align', 'center') not in ('left', 'center', 'right') or coalesce(f->>'direction', 'auto') not in ('auto', 'ltr', 'rtl') then
      raise exception 'certificate_invalid: bad alignment / direction' using errcode = '22023', hint = 'certificate_invalid', detail = v_var || ':align';
    end if;
    v_new := v_new || jsonb_build_array(jsonb_build_object('var', v_var, 'x', round((f->>'x')::numeric, 5), 'y', round((f->>'y')::numeric, 5),
        'w', round((f->>'w')::numeric, 5), 'align', coalesce(f->>'align', 'center'), 'font', v_font, 'size', round(v_size, 5), 'color', lower(v_color),
        'weight', v_wt, 'direction', coalesce(f->>'direction', 'auto'), 'max_lines', v_ml,
        'shrink_to_fit', coalesce((f->>'shrink_to_fit')::boolean, false)));
  end loop;
  -- canonical order so the comparison with the stored version is stable
  select coalesce(jsonb_agg(x order by x->>'var'), '[]'::jsonb) into v_new from jsonb_array_elements(v_new) x;

  select * into t from public.certificate_templates where node_id = p_node and language = v_lang order by version desc limit 1;
  if not found then
    insert into public.certificate_templates (project_id, node_id, version, language, file_path, file_kind, width_px, height_px, created_by)
    values (v_project, p_node, 1, v_lang, v_path, 'image', v_w, v_h, (select auth.uid())) returning id into v_id;
  else
    select app_private.cert_fields_json(t.id) into v_old;
    select coalesce(jsonb_agg(jsonb_build_object('var', x->>'var', 'x', (x->>'x')::numeric, 'y', (x->>'y')::numeric, 'w', (x->>'w')::numeric,
        'align', x->>'align', 'font', x->>'font', 'size', (x->>'size')::numeric, 'color', lower(x->>'color'), 'weight', (x->>'weight')::int,
        'direction', x->>'direction', 'max_lines', (x->>'max_lines')::int, 'shrink_to_fit', (x->>'shrink_to_fit')::boolean) order by x->>'var'), '[]'::jsonb)
      into v_old from jsonb_array_elements(v_old) x;
    if t.file_path = v_path and t.width_px = v_w and t.height_px = v_h and v_old = v_new then
      return;                                                         -- nothing changed: no new version
    end if;
    v_ref := exists (select 1 from public.certificates c where c.template_id = t.id);
    if v_ref then
      insert into public.certificate_templates (project_id, node_id, version, language, file_path, file_kind, width_px, height_px, created_by)
      values (v_project, p_node, t.version + 1, v_lang, v_path, 'image', v_w, v_h, (select auth.uid())) returning id into v_id;
    else
      update public.certificate_templates set file_path = v_path, file_kind = 'image', width_px = v_w, height_px = v_h where id = t.id;
      delete from public.certificate_template_fields where template_id = t.id;
      v_id := t.id;
    end if;
  end if;
  insert into public.certificate_template_fields (template_id, project_id, var, x, y, w, align, font, size, color, weight, direction, max_lines, shrink_to_fit)
  select v_id, v_project, x->>'var', (x->>'x')::numeric, (x->>'y')::numeric, (x->>'w')::numeric, x->>'align', x->>'font', (x->>'size')::numeric,
         x->>'color', (x->>'weight')::smallint, x->>'direction', (x->>'max_lines')::smallint, (x->>'shrink_to_fit')::boolean
    from jsonb_array_elements(v_new) x;
end $$;
revoke all on function app_private.save_children_certificates(uuid, jsonb) from public, anon, authenticated;

-- ================================================================= 5. issuing
-- ONE participant. Returns { status: 'issued' | 'existing' | 'not_attended' | 'no_name' | 'skipped_revoked' | 'not_found', certificate_id, code }.
-- The caller already checked: PM of the project, node of type certificates, project completed, template present.
create or replace function app_private.cert_issue_one(p_participant uuid, p_node uuid, p_actor uuid, p_skip_revoked boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pa public.participants; n public.nodes; j public.projects; g public.programs; t public.certificate_templates; v public.certificates;
        v_lang text; v_names jsonb; i int := 0; v_code text;
begin
  select * into n from public.nodes where id = p_node;
  select * into pa from public.participants where id = p_participant and project_id = n.project_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_node::text || p_participant::text, 0));
  if pa.status <> 'attended' then return jsonb_build_object('status', 'not_attended'); end if;
  select * into v from public.certificates where node_id = p_node and participant_id = p_participant and revoked_at is null;
  if found then return jsonb_build_object('status', 'existing', 'certificate_id', v.id, 'code', v.code); end if;      -- idempotent
  if p_skip_revoked and exists (select 1 from public.certificates where node_id = p_node and participant_id = p_participant) then
    return jsonb_build_object('status', 'skipped_revoked');
  end if;
  select * into j from public.projects where id = pa.project_id;
  select * into g from public.programs where id = j.program_id;
  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  select * into t from public.certificate_templates where node_id = p_node and language = v_lang order by version desc limit 1;
  v_names := app_private.cert_names(pa, v_lang);
  if coalesce(v_names->>'participant_name', '') = '' then return jsonb_build_object('status', 'no_name'); end if;
  loop
    i := i + 1; v_code := app_private.gen_cert_code();
    begin
      insert into public.certificates (project_id, node_id, participant_id, template_id, code, snapshot, issued_by)
      values (pa.project_id, p_node, p_participant, t.id, v_code,
              jsonb_build_object('participant_name', v_names->>'participant_name', 'company_name', v_names->>'company_name',
                'program_name', case when v_lang = 'ar' then coalesce(nullif(g.name_ar, ''), g.name_en) else coalesce(nullif(g.name_en, ''), g.name_ar) end,
                'project_name', case when v_lang = 'ar' then coalesce(nullif(j.name_ar, ''), j.name_en) else coalesce(nullif(j.name_en, ''), j.name_ar) end,
                'completed_on', (j.completed_at at time zone j.timezone)::date, 'issued_on', (now() at time zone j.timezone)::date,
                'language', v_lang, 'template_version', t.version),
              p_actor)
      returning * into v;
      return jsonb_build_object('status', 'issued', 'certificate_id', v.id, 'code', v.code);
    exception when unique_violation then
      select * into v from public.certificates where node_id = p_node and participant_id = p_participant and revoked_at is null;
      if found then return jsonb_build_object('status', 'existing', 'certificate_id', v.id, 'code', v.code); end if;   -- lost a race: the winner
      if i > 5 then raise; end if;                                                                                     -- (a code collision: retry)
    end;
  end loop;
end $$;
revoke all on function app_private.cert_issue_one(uuid, uuid, uuid, boolean) from public, anon, authenticated;

create or replace function app_private.cert_issue_checks(p_node uuid) returns public.nodes
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; j public.projects; v_lang text; t public.certificate_templates;
begin
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null;
  if not found then raise exception 'certificates node not found' using errcode = 'P0002'; end if;
  if not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.projects where id = n.project_id;
  if j.completed_at is null then
    raise exception 'certificate_project_not_completed: certificates can be issued only after the project is marked completed'
      using errcode = '23514', hint = 'certificate_project_not_completed';
  end if;
  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  select * into t from public.certificate_templates where node_id = p_node and language = v_lang order by version desc limit 1;
  if not found then
    raise exception 'certificate_template_missing: no certificate template for language %', v_lang using errcode = 'P0002', hint = 'certificate_template_missing';
  end if;
  if not exists (select 1 from public.certificate_template_fields f where f.template_id = t.id and f.var = 'participant_name') then
    raise exception 'certificate_template_incomplete: the template has no participant name field' using errcode = '23514', hint = 'certificate_template_incomplete';
  end if;
  return n;
end $$;
revoke all on function app_private.cert_issue_checks(uuid) from public, anon, authenticated;

create or replace function public.issue_certificates(p_node uuid, p_participants uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; r record; v_ids uuid[]; v_res jsonb; v_rows jsonb := '[]'::jsonb; k_issued int := 0; k_existing int := 0; k_skipped int := 0;
begin
  n := app_private.cert_issue_checks(p_node);
  if p_participants is not null and cardinality(p_participants) > 1000 then
    raise exception 'certificate_invalid: at most 1000 participants per call' using errcode = '22023', hint = 'certificate_invalid', detail = 'participants:too_many';
  end if;
  if p_participants is null then
    select coalesce(array_agg(pa.id order by pa.created_at, pa.id), '{}') into v_ids
      from public.participants pa where pa.project_id = n.project_id and pa.status = 'attended';
  else
    v_ids := array(select distinct x from unnest(p_participants) x);
  end if;
  for r in select x as id from unnest(v_ids) x loop
    begin
      v_res := app_private.cert_issue_one(r.id, p_node, (select auth.uid()), p_participants is null);
    exception when others then
      v_res := jsonb_build_object('status', 'error', 'reason', left(sqlerrm, 160));
    end;
    case v_res->>'status' when 'issued' then k_issued := k_issued + 1; when 'existing' then k_existing := k_existing + 1; else k_skipped := k_skipped + 1; end case;
    v_rows := v_rows || jsonb_build_array(v_res || jsonb_build_object('participant_id', r.id));
  end loop;
  return jsonb_build_object('issued', k_issued, 'existing', k_existing, 'skipped', k_skipped, 'results', v_rows);
end $$;
revoke all on function public.issue_certificates(uuid, uuid[]) from public, anon;
grant execute on function public.issue_certificates(uuid, uuid[]) to authenticated;

-- m06d names, kept (the exhaustive grant list in m07 names them) and routed through the same code
create or replace function app_private.issue_certificate_internal(p_participant uuid, p_node uuid, p_actor uuid) returns public.certificates
language plpgsql security definer set search_path = '' as $$
declare pa public.participants; v_res jsonb; v public.certificates;
begin
  select * into pa from public.participants where id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  perform app_private.cert_issue_checks(p_node);                                  -- PM, completed, template
  if pa.project_id is distinct from (select project_id from public.nodes where id = p_node) then
    raise exception 'certificates node not found in the participant''s project' using errcode = 'P0002';
  end if;
  v_res := app_private.cert_issue_one(p_participant, p_node, p_actor, false);
  if v_res->>'status' = 'not_attended' then raise exception 'only attended participants receive certificates' using errcode = '23514', hint = 'certificate_not_attended'; end if;
  if v_res->>'status' = 'no_name' then raise exception 'the participant has no name to print' using errcode = '23514', hint = 'certificate_no_name'; end if;
  select * into v from public.certificates where id = (v_res->>'certificate_id')::uuid;
  return v;
end $$;
revoke all on function app_private.issue_certificate_internal(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.issue_certificate(p_participant uuid, p_node uuid) returns public.certificates
language plpgsql security definer set search_path = '' as $$
declare pa public.participants;
begin
  select * into pa from public.participants where id = p_participant;
  if not found or not app_private.is_project_manager(pa.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.issue_certificate_internal(p_participant, p_node, (select auth.uid()));
end $$;

create or replace function public.issue_certificates_bulk(p_node uuid) returns int
language sql security definer set search_path = '' as $$
  select (public.issue_certificates(p_node, null)->>'issued')::int
$$;

-- ================================================================= 6. revocation (manual, decision 07-9; the UI warns first)
create or replace function public.revoke_certificate(p_cert uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_cert for update;
  if not found or not app_private.is_project_manager(c.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'certificate_invalid: the reason is too long' using errcode = '22023', hint = 'certificate_invalid', detail = 'reason:too_long';
  end if;
  update public.certificates set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, (select auth.uid())),
         revoked_reason = coalesce(nullif(btrim(p_reason), ''), revoked_reason)
   where id = p_cert;
end $$;

-- ================================================================= 7. the Issue panel payload (PM)
create or replace function public.get_certificates_admin(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes; j public.projects; v_lang text; t public.certificate_templates; v_rows jsonb; v_other int;
begin
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.projects where id = n.project_id;
  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  select * into t from public.certificate_templates where node_id = p_node and language = v_lang order by version desc limit 1;
  select coalesce(jsonb_agg(x.row order by x.sort_name, x.pid), '[]'::jsonb) into v_rows from (
    select pa.id as pid, lower(coalesce(app_private.cert_names(pa, v_lang)->>'participant_name', '')) as sort_name,
           jsonb_build_object('participant_id', pa.id, 'status', pa.status, 'needs_review', pa.needs_review,
             'name', app_private.cert_names(pa, v_lang)->>'participant_name', 'company_name', app_private.cert_names(pa, v_lang)->>'company_name',
             'certificate', (select jsonb_build_object('id', c.id, 'code', c.code, 'issued_at', c.issued_at, 'revoked_at', c.revoked_at,
                                'revoked_reason', c.revoked_reason, 'name', c.snapshot->>'participant_name')
                               from public.certificates c where c.node_id = p_node and c.participant_id = pa.id
                              order by (c.revoked_at is null) desc, c.issued_at desc limit 1)) as row
      from public.participants pa
     where pa.project_id = n.project_id
       and (pa.status = 'attended' or exists (select 1 from public.certificates c where c.node_id = p_node and c.participant_id = pa.id))) x;
  select count(*) into v_other from public.participants pa
   where pa.project_id = n.project_id and pa.status <> 'attended'
     and not exists (select 1 from public.certificates c where c.node_id = p_node and c.participant_id = pa.id);
  return jsonb_build_object(
    'project', jsonb_build_object('id', j.id, 'program_id', j.program_id, 'name_en', j.name_en, 'name_ar', j.name_ar, 'completed_at', j.completed_at, 'timezone', j.timezone),
    'language', v_lang,
    'template', case when t.id is null then null else jsonb_build_object('id', t.id, 'version', t.version, 'language', t.language, 'width_px', t.width_px, 'height_px', t.height_px,
                   'has_name_field', exists (select 1 from public.certificate_template_fields f where f.template_id = t.id and f.var = 'participant_name')) end,
    'rows', v_rows,
    'others', v_other);
end $$;
revoke all on function public.get_certificates_admin(uuid) from public, anon;
grant execute on function public.get_certificates_admin(uuid) to authenticated;

-- ================================================================= 8. render payload + the founder's own certificates
create or replace function public.get_certificate_render_payload(p_cert uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.certificates; pa public.participants; n public.nodes; j public.projects; v_own boolean;
begin
  select * into c from public.certificates where id = p_cert;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if app_private.is_project_manager(c.project_id) then
    return app_private.cert_render_json(c, false);
  end if;
  select * into pa from public.participants where id = c.participant_id;
  select * into n from public.nodes where id = c.node_id;
  select * into j from public.projects where id = c.project_id;
  v_own := (select auth.uid()) is not null and (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids()))
           and pa.status = 'attended' and c.revoked_at is null and j.completed_at is not null and n.show_to_participants and n.deleted_at is null;
  if not v_own then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.cert_render_json(c, false);
end $$;
revoke all on function public.get_certificate_render_payload(uuid) from public, anon;
grant execute on function public.get_certificate_render_payload(uuid) to authenticated;

-- The certificates the CALLER owns and may download now: attended, not revoked, project completed, node exposed to participants.
-- Light metadata only; the render payload is fetched on demand. `p_project` narrows to one project (the founder Program page).
create or replace function public.list_my_certificates(p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('certificate_id', c.id, 'node_id', n.id, 'project_id', c.project_id, 'name_en', n.name_en, 'name_ar', n.name_ar,
             'code', c.code, 'issued_at', c.issued_at, 'participant_name', c.snapshot->>'participant_name', 'program_name', c.snapshot->>'program_name',
             'project_name', c.snapshot->>'project_name', 'completed_on', c.snapshot->>'completed_on', 'language', c.snapshot->>'language')
           order by c.issued_at desc, c.id)
      from public.certificates c
      join public.participants pa on pa.id = c.participant_id
      join public.nodes n on n.id = c.node_id and n.deleted_at is null and n.show_to_participants
      join public.projects j on j.id = c.project_id and j.completed_at is not null
     where c.revoked_at is null and pa.status = 'attended'
       and (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids()))
       and (p_project is null or c.project_id = p_project)), '[]'::jsonb);
end $$;
revoke all on function public.list_my_certificates(uuid) from public, anon;
grant execute on function public.list_my_certificates(uuid) to authenticated;

-- ================================================================= 9. public verification
create or replace function public.get_public_certificate_verification(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_code text; c public.certificates; n public.nodes; v_valid boolean; v_show boolean;
begin
  if not app_private.cert_verify_limit() then
    raise exception 'certificate_rate_limited: too many lookups, try again in a few minutes' using errcode = 'P0001', hint = 'certificate_rate_limited';
  end if;
  v_code := app_private.cert_normalize_code(p_code);
  if v_code is null then return jsonb_build_object('status', 'not_found', 'valid', false); end if;
  select * into c from public.certificates where code = v_code;
  if not found then return jsonb_build_object('status', 'not_found', 'valid', false); end if;
  select * into n from public.nodes where id = c.node_id;
  if coalesce(n.config->'verifier'->>'enabled', 'true') = 'false' then return jsonb_build_object('status', 'not_found', 'valid', false); end if;
  v_valid := c.revoked_at is null;
  v_show := v_valid and coalesce(n.config->'verifier'->>'showCertificate', 'true') <> 'false';
  return jsonb_strip_nulls(jsonb_build_object(
    'status', case when v_valid then 'valid' else 'revoked' end, 'valid', v_valid, 'revoked', not v_valid,
    'code', c.code, 'participant_name', c.snapshot->>'participant_name', 'program_name', c.snapshot->>'program_name',
    'project_name', c.snapshot->>'project_name', 'completed_on', c.snapshot->>'completed_on', 'issued_on', c.snapshot->>'issued_on',
    'language', c.snapshot->>'language', 'issuer', 'Athar',
    'render', case when v_show then app_private.cert_render_json(c, true) - 'id' - 'issued_at' end));
end $$;
revoke all on function public.get_public_certificate_verification(text) from public;
grant execute on function public.get_public_certificate_verification(text) to anon, authenticated;

-- m06d name (granted to anon by m07): the same answer
create or replace function public.verify_certificate(p_code text) returns jsonb
language sql security definer set search_path = '' as $$ select public.get_public_certificate_verification(p_code) $$;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- ================================================================= 10. storage: the private `certificate-templates` bucket
-- anon has no USAGE on app_private (m36 L8): the policy calls a PUBLIC SECURITY DEFINER function that answers only "may the CALLER read this
-- object": the template of a certificate the public verifier shows (verifier enabled + showCertificate, certificate valid) OR of the caller's own
-- issued certificate (attended, not revoked, project completed, node exposed to participants). PMs keep their m07 policies.
create or replace function public.cert_template_readable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.certificate_templates t
      join public.certificates c on c.template_id = t.id and c.revoked_at is null
      join public.nodes n on n.id = c.node_id
      join public.participants pa on pa.id = c.participant_id
      join public.projects j on j.id = c.project_id
     where t.file_path = p_name
       and ((coalesce(n.config->'verifier'->>'enabled', 'true') <> 'false' and coalesce(n.config->'verifier'->>'showCertificate', 'true') <> 'false')
            or ((select auth.uid()) is not null and pa.status = 'attended' and j.completed_at is not null and n.show_to_participants and n.deleted_at is null
                and (pa.user_id = (select auth.uid()) or pa.company_id in (select app_private.my_company_ids())))))
$$;
revoke all on function public.cert_template_readable(text) from public, anon, authenticated;
grant execute on function public.cert_template_readable(text) to anon, authenticated;

-- A template image that an ISSUED certificate still renders from must not disappear or be overwritten (04 3.13: a template version is
-- immutable once referenced, and so is its file): the m07 PM delete / update policies now also require that no template row
-- carrying certificates points at the object. Unreferenced files (an abandoned draft, a replaced image) stay deletable.
create or replace function public.cert_template_deletable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.certificate_templates t where t.file_path = p_name and exists (select 1 from public.certificates c where c.template_id = t.id))
$$;
revoke all on function public.cert_template_deletable(text) from public, anon, authenticated;
grant execute on function public.cert_template_deletable(text) to authenticated;
drop policy if exists certificate_templates_delete_pm on storage.objects;
create policy certificate_templates_delete_pm on storage.objects for delete to authenticated
  using (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])) and (select public.cert_template_deletable(name)));
drop policy if exists certificate_templates_update_pm on storage.objects;
create policy certificate_templates_update_pm on storage.objects for update to authenticated
  using (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])) and (select public.cert_template_deletable(name)))
  with check (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])));

drop policy if exists certificate_templates_select_visitor on storage.objects;
create policy certificate_templates_select_visitor on storage.objects for select to anon, authenticated
  using (bucket_id = 'certificate-templates' and (select public.cert_template_readable(name)));

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.issue_certificates(uuid,uuid[])') is null or to_regprocedure('public.get_certificates_admin(uuid)') is null
     or to_regprocedure('public.list_my_certificates(uuid)') is null or to_regprocedure('public.get_public_certificate_verification(text)') is null
     or to_regprocedure('public.cert_template_readable(text)') is null or to_regprocedure('app_private.save_children_certificates(uuid,jsonb)') is null then
    raise exception 'm38: a function is missing';
  end if;
  if (select save_children_fn from public.node_types where key = 'certificates') is distinct from 'save_children_certificates' then raise exception 'm38: node_types.certificates.save_children_fn'; end if;
  if not has_function_privilege('anon', 'public.get_public_certificate_verification(text)', 'EXECUTE') or not has_function_privilege('anon', 'public.cert_template_readable(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.verify_certificate(text)', 'EXECUTE') then
    raise exception 'm38: anon must execute the public verification and the storage-policy wrapper';
  end if;
  if has_function_privilege('anon', 'public.issue_certificates(uuid,uuid[])', 'EXECUTE') or has_function_privilege('anon', 'public.get_certificates_admin(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_my_certificates(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.get_certificate_render_payload(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.save_children_certificates(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.cert_issue_one(uuid,uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'm38: a PM / helper function is executable by an API role';
  end if;
  if app_private.cert_normalize_code('abcd-efgh-jkmn') is distinct from 'ABCD-EFGH-JKMN' or app_private.cert_normalize_code('0O0O 1I1L 0000') is distinct from '0000-1111-0000'
     or app_private.cert_normalize_code('xyz') is not null then
    raise exception 'm38: code normalisation is wrong';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'certificates_active_key') then raise exception 'm38: the active unique index is missing'; end if;
end $$;

commit;
