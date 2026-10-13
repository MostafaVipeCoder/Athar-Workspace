-- m42_certificates_person.sql  (owner decision 08 section 17.2: CERTIFICATES PER FOUNDER = PERSON NAME + COMPANY NAME; universal WebP for templates, 08 section 17.3)
-- Re-runnable (create or replace / if not exists / drop policy if exists). Local DB only. Run AFTER m38 (and m39 - m41); it replaces some m38 functions.
-- Owner's words: "the name on the certificate is the PERSON's name and the COMPANY's name. When a company has more than one founder, each one downloads
-- a certificate from HIS OWN interface, issued under HIS name, because the certificates are dynamic on the name of the account owner."
--
-- The model (m38 kept one certificate per PARTICIPANT = a company-level row; m42 splits authorisation from the person instance):
--   public.certificate_grants   the PM's explicit action ("Issue certificates"): one ACTIVE grant per (node, participant), only for an ATTENDED
--                               participant of a COMPLETED project. A grant does not carry a name. Revoking a grant = participant-level revocation.
--   public.certificates         the PERSON certificate: one row per (grant, ACCOUNT): user_id = the account owner, snapshot = THAT account's person
--                               name + the company name + program / project / dates, a distinct 12-character code. One ACTIVE row per
--                               (node, participant, user). Created idempotently (a) by "Issue certificates" for every founder account that is ALREADY
--                               linked to the participant and (b) on demand by claim_my_certificate(node) / list_my_certificates() when a founder
--                               who links or joins later opens the Program page block. Never created from anything the client sends.
--   "Linked account" = the same rule as the founder platform (m39 my_participation): participants.user_id = the account, OR the account's
--   founders row (founders.auth_user_id) belongs to participants.company_id through company_founders. A founder who is not linked gets nothing
--   and claim_my_certificate answers `forbidden`.
--   Name source of truth (decided here, documented in MIGRATION-LOG): the account's founders row in the template language (name_en / name_ar,
--   the other language as the fallback), else the account's profiles.full_name. Both are the account owner's own data (the sign-up trigger
--   copies the name into the founders row); the form response's `founder_name` is NOT used any more (it belongs to the application, not to the
--   account that downloads). The name is FROZEN in the snapshot at creation; later edits do not change an issued certificate.
--
-- 1. schema: certificate_grants (RLS forced, PM / alumni_manager read only, writes only through the RPCs below), certificates.user_id /
--    grant_id / origin, the active unique index becomes per person (name kept: certificates_active_key), the template variable `participant_name`
--    is renamed `person_name` (the old key stays accepted and is read as an alias), non-destructive backfill of m38 rows (0 exist today).
-- 2. helpers (app_private, revoked from API roles): cert_clean, cert_pick_name, cert_person_name, cert_company_name, cert_is_member, cert_accounts,
--    cert_people, cert_snapshot, cert_issue_person, cert_claim; cert_fields_json / cert_render_json re-created (person_name alias).
-- 3. save_children_certificates re-created (person_name, alias participant_name -> person_name, no spurious new version for a legacy template).
-- 4. issuing: cert_issue_one (participant: grant + person certificates), cert_issue_checks, issue_certificates, issue_certificate(_internal),
--    issue_certificates_bulk, reissue_certificate (one person), revoke_participant_certificates (participant level; revoke_certificate of m38 stays
--    the per-certificate revocation), claim_my_certificate.
-- 5. reads: get_certificates_admin (participant rows + the founders of each with linked / not-linked and certificate state), list_my_certificates
--    (volatile now: claims first), get_certificate_render_payload (the OWNER = the account of the certificate), get_public_certificate_verification
--    (person_name + company_name + program + dates; participant_name kept as an alias).
-- 6. RLS: certificates_select_pm_alumni_own tightened (a founder reads only HIS OWN person certificate), cert_template_readable (own branch = the
--    certificate's account), certificate_grants policies.
-- 7. storage: the PRIVATE `certificate-templates` bucket becomes WebP only (bucket list + two restrictive policies, the m41 handover statement),
--    PDF templates are gone (owner decision 17.2: images only).
set search_path = public, extensions;

begin;

-- ================================================================= 1. schema
create table if not exists public.certificate_grants (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null,
  node_id        uuid not null,
  participant_id uuid not null references public.participants (id) on delete restrict,
  granted_at     timestamptz not null default now(),
  granted_by     uuid references auth.users (id) on delete set null,
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users (id) on delete set null,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) <= 500),
  constraint certificate_grants_node_fk foreign key (project_id, node_id) references public.nodes (project_id, id) on delete restrict
);
create unique index if not exists certificate_grants_active_key on public.certificate_grants (node_id, participant_id) where revoked_at is null;
create index if not exists certificate_grants_participant_idx on public.certificate_grants (participant_id);
create index if not exists certificate_grants_node_idx on public.certificate_grants (node_id, granted_at desc);
drop trigger if exists certificate_grants_bu_project on public.certificate_grants;
create trigger certificate_grants_bu_project before update of project_id on public.certificate_grants for each row execute function app_private.forbid_project_change();

alter table public.certificate_grants enable row level security;
alter table public.certificate_grants force row level security;
revoke all on public.certificate_grants from public, anon, authenticated;
grant select on public.certificate_grants to authenticated;
drop policy if exists certificate_grants_select_pm_alumni on public.certificate_grants;
create policy certificate_grants_select_pm_alumni on public.certificate_grants for select to authenticated
  using ((select app_private.is_project_manager(project_id)) or (select app_private.has_role('alumni_manager')));

alter table public.certificates add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.certificates add column if not exists grant_id uuid references public.certificate_grants (id) on delete restrict;
alter table public.certificates add column if not exists origin text not null default 'issue';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'certificates_origin_check' and conrelid = 'public.certificates'::regclass) then
    alter table public.certificates add constraint certificates_origin_check check (origin in ('issue', 'claim', 'reissue'));
  end if;
  -- one ACTIVE certificate per (node, participant, ACCOUNT). The m38 name is kept so a re-run of m38's `create unique index if not exists` is a no-op.
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'certificates_active_key' and indexdef not like '%user_id%') then
    drop index public.certificates_active_key;
  end if;
end $$;
create unique index if not exists certificates_active_key on public.certificates (node_id, participant_id, user_id) where revoked_at is null;
create index if not exists certificates_user_idx on public.certificates (user_id) where user_id is not null;
create index if not exists certificates_grant_idx on public.certificates (grant_id) where grant_id is not null;

-- template variables: `participant_name` is now `person_name` (the old value stays legal: a template already referenced by certificates is immutable)
alter table public.certificate_template_fields drop constraint if exists certificate_template_fields_var_check;
alter table public.certificate_template_fields add constraint certificate_template_fields_var_check
  check (var = any (array['person_name', 'participant_name', 'company_name', 'program_name', 'project_name', 'issue_date', 'completion_date', 'verification_code', 'verification_qr']));
-- non-destructive backfill of m38 data, also callable on its own (the verify script proves it on a legacy-shaped row):
--  * an unreferenced template field `participant_name` becomes `person_name` (a REFERENCED template is immutable: its legacy key stays and is read as an alias)
--  * a participant-level certificate becomes a grant + a person certificate of the participant's own account when it has one (user_id), the snapshot
--    gets `person_name`; a row whose account cannot be determined keeps user_id = null (the PM still sees and can revoke it, no founder can read it)
create or replace function app_private.cert_backfill_person() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_grant uuid; k_fields int := 0; k_grants int := 0; k_users int := 0; k_snap int := 0;
begin
  update public.certificate_template_fields f set var = 'person_name'
   where f.var = 'participant_name'
     and not exists (select 1 from public.certificates c where c.template_id = f.template_id)
     and not exists (select 1 from public.certificate_template_fields o where o.template_id = f.template_id and o.var = 'person_name');
  get diagnostics k_fields = row_count;
  for r in
    select c.project_id, c.node_id, c.participant_id, min(c.issued_at) as first_at,
           (array_agg(c.issued_by order by c.issued_at))[1] as granter,
           bool_or(c.revoked_at is null) as any_active,
           max(c.revoked_at) as last_rev,
           (array_agg(c.revoked_by order by c.revoked_at desc nulls last))[1] as rev_by,
           (array_agg(c.revoked_reason order by c.revoked_at desc nulls last))[1] as rev_reason
      from public.certificates c where c.grant_id is null group by c.project_id, c.node_id, c.participant_id
  loop
    insert into public.certificate_grants (project_id, node_id, participant_id, granted_at, granted_by, revoked_at, revoked_by, revoked_reason)
    values (r.project_id, r.node_id, r.participant_id, r.first_at, r.granter,
            case when r.any_active then null else r.last_rev end, case when r.any_active then null else r.rev_by end, case when r.any_active then null else r.rev_reason end)
    returning id into v_grant;
    k_grants := k_grants + 1;
    update public.certificates set grant_id = v_grant where node_id = r.node_id and participant_id = r.participant_id and grant_id is null;
  end loop;
  update public.certificates c set user_id = pa.user_id from public.participants pa
   where pa.id = c.participant_id and c.user_id is null and pa.user_id is not null;
  get diagnostics k_users = row_count;
  update public.certificates c set snapshot = c.snapshot || jsonb_build_object('person_name', c.snapshot->'participant_name')
   where c.snapshot ? 'participant_name' and not (c.snapshot ? 'person_name');
  get diagnostics k_snap = row_count;
  return jsonb_build_object('fields', k_fields, 'grants', k_grants, 'users', k_users, 'snapshots', k_snap);
end $$;
revoke all on function app_private.cert_backfill_person() from public, anon, authenticated;
select app_private.cert_backfill_person();

-- ================================================================= 2. helpers
create or replace function app_private.cert_clean(p text) returns text
language sql immutable parallel safe set search_path = '' as $$ select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '') $$;
revoke all on function app_private.cert_clean(text) from public, anon, authenticated;

-- a bilingual name in the TEMPLATE language, the other language as the fallback, whitespace collapsed
create or replace function app_private.cert_pick_name(p_en text, p_ar text, p_lang text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p_lang = 'ar' then coalesce(app_private.cert_clean(p_ar), app_private.cert_clean(p_en))
              else coalesce(app_private.cert_clean(p_en), app_private.cert_clean(p_ar)) end
$$;
revoke all on function app_private.cert_pick_name(text, text, text) from public, anon, authenticated;

-- THE person name of an ACCOUNT (never a client value): the account's founders row, else its profile name
create or replace function app_private.cert_person_name(p_user uuid, p_lang text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select app_private.cert_pick_name(f.name_en, f.name_ar, p_lang) from public.founders f where f.auth_user_id = p_user and f.deleted_at is null limit 1),
    (select app_private.cert_clean(pr.full_name) from public.profiles pr where pr.id = p_user))
$$;
revoke all on function app_private.cert_person_name(uuid, text) from public, anon, authenticated;

-- the company name in the template language (the application's answer as the last fallback)
create or replace function app_private.cert_company_name(p public.participants, p_lang text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select app_private.cert_pick_name(c.name_en, c.name_ar, p_lang) from public.companies c where c.id = p.company_id),
    (select app_private.cert_clean(fr.answers->>'company_name') from public.form_responses fr where fr.id = p.form_response_id))
$$;
revoke all on function app_private.cert_company_name(public.participants, text) from public, anon, authenticated;

-- is the ACCOUNT linked to the participant (the founder-platform rule: own user OR one of the participant company's founders)
create or replace function app_private.cert_is_member(p public.participants, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    p.user_id = p_user
    or (p.company_id is not null and exists (
         select 1 from public.company_founders cf join public.founders f on f.id = cf.founder_id and f.deleted_at is null
          where cf.company_id = p.company_id and f.auth_user_id = p_user)))
$$;
revoke all on function app_private.cert_is_member(public.participants, uuid) from public, anon, authenticated;

-- every ACCOUNT linked to the participant (one row per account)
create or replace function app_private.cert_accounts(p_participant uuid) returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select x.uid from (
    select pa.user_id as uid from public.participants pa where pa.id = p_participant and pa.user_id is not null
    union
    select f.auth_user_id from public.participants pa
      join public.company_founders cf on cf.company_id = pa.company_id
      join public.founders f on f.id = cf.founder_id and f.deleted_at is null and f.auth_user_id is not null
     where pa.id = p_participant) x
  order by x.uid
$$;
revoke all on function app_private.cert_accounts(uuid) from public, anon, authenticated;

-- the PEOPLE of a participant for the PM panel: the company's founders (linked to an account or not), the participant's own account when it is
-- not one of them, and the application's founder when nothing else identifies a person. [{ founder_id, user_id, name, linked }] (ids stay in app_private)
create or replace function app_private.cert_people(p_participant uuid, p_lang text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pa public.participants; v jsonb := '[]'::jsonb; seen uuid[] := '{}'; f record; fo public.founders; v_name text;
begin
  select * into pa from public.participants where id = p_participant;
  if not found then return v; end if;
  if pa.company_id is not null then
    for f in
      select fo2.id, fo2.auth_user_id, fo2.name_en, fo2.name_ar
        from public.company_founders cf join public.founders fo2 on fo2.id = cf.founder_id and fo2.deleted_at is null
       where cf.company_id = pa.company_id order by cf.is_primary desc, cf.created_at, fo2.id
    loop
      v_name := case when f.auth_user_id is not null then app_private.cert_person_name(f.auth_user_id, p_lang) else app_private.cert_pick_name(f.name_en, f.name_ar, p_lang) end;
      v := v || jsonb_build_array(jsonb_build_object('founder_id', f.id, 'user_id', f.auth_user_id, 'name', coalesce(v_name, ''), 'linked', f.auth_user_id is not null));
      if f.auth_user_id is not null then seen := seen || f.auth_user_id; end if;
    end loop;
  end if;
  if pa.user_id is not null and not (pa.user_id = any (seen)) then
    select * into fo from public.founders where auth_user_id = pa.user_id and deleted_at is null;
    v := v || jsonb_build_array(jsonb_build_object('founder_id', fo.id, 'user_id', pa.user_id, 'name', coalesce(app_private.cert_person_name(pa.user_id, p_lang), ''), 'linked', true));
  end if;
  if pa.company_id is null and pa.user_id is null and pa.form_response_id is not null then
    select app_private.cert_clean(fr.answers->>'founder_name') into v_name from public.form_responses fr where fr.id = pa.form_response_id;
    if v_name is not null then
      v := v || jsonb_build_array(jsonb_build_object('founder_id', null, 'user_id', null, 'name', v_name, 'linked', false));
    end if;
  end if;
  return v;
end $$;
revoke all on function app_private.cert_people(uuid, text) from public, anon, authenticated;

-- the fields of a template as the renderer needs them (the legacy variable is emitted as `person_name`)
create or replace function app_private.cert_fields_json(p_template uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('var', case when f.var = 'participant_name' then 'person_name' else f.var end, 'x', f.x, 'y', f.y, 'w', f.w,
                  'align', f.align, 'font', f.font, 'size', f.size, 'color', f.color, 'weight', f.weight, 'direction', f.direction, 'max_lines', f.max_lines,
                  'shrink_to_fit', f.shrink_to_fit) order by case when f.var = 'participant_name' then 'person_name' else f.var end), '[]'::jsonb)
    from public.certificate_template_fields f where f.template_id = p_template
$$;
revoke all on function app_private.cert_fields_json(uuid) from public, anon, authenticated;

-- The payload of the client canvas renderer (decision 06-5). `p_public` keeps ONLY the snapshot values that a field of the template prints.
create or replace function app_private.cert_render_json(c public.certificates, p_public boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.certificate_templates; v_fields jsonb; v_snap jsonb; v_full jsonb;
begin
  select * into t from public.certificate_templates where id = c.template_id;
  v_fields := app_private.cert_fields_json(t.id);
  v_full := c.snapshot;
  if not (v_full ? 'person_name') and v_full ? 'participant_name' then v_full := v_full || jsonb_build_object('person_name', v_full->'participant_name'); end if;
  if p_public then
    v_snap := coalesce((select jsonb_object_agg(m.k, v_full->m.k) from (
        select distinct case f->>'var' when 'person_name' then 'person_name' when 'company_name' then 'company_name'
                                       when 'program_name' then 'program_name' when 'project_name' then 'project_name'
                                       when 'completion_date' then 'completed_on' when 'issue_date' then 'issued_on' end as k
          from jsonb_array_elements(v_fields) f) m where m.k is not null and v_full ? m.k), '{}'::jsonb);
  else
    v_snap := v_full;
  end if;
  return jsonb_build_object('id', c.id, 'code', c.code, 'snapshot', v_snap, 'revoked', c.revoked_at is not null, 'issued_at', c.issued_at,
    'template', jsonb_build_object('id', t.id, 'file_path', t.file_path, 'file_kind', t.file_kind, 'width_px', t.width_px, 'height_px', t.height_px,
                'language', t.language, 'version', t.version, 'bucket', 'certificate-templates'),
    'fields', v_fields);
end $$;
revoke all on function app_private.cert_render_json(public.certificates, boolean) from public, anon, authenticated;

-- ================================================================= 3. save_children_certificates (person_name)
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
    v_var := case when f->>'var' = 'participant_name' then 'person_name' else f->>'var' end;      -- the legacy key is an alias of person_name
    if v_var is null or v_var not in ('person_name','company_name','program_name','project_name','issue_date','completion_date','verification_code','verification_qr') then
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
    select app_private.cert_fields_json(t.id) into v_old;                                           -- (already emits person_name for a legacy row)
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

-- ================================================================= 4. issuing
-- ONE person certificate: the account `p_user` under the grant `p_grant`. Idempotent. Returns { status: 'issued' | 'existing' | 'revoked' | 'no_name' | 'no_template' | 'not_linked',
--   certificate_id, code }.  `p_force` = re-issue on purpose a person whose certificate was revoked (new code); without it a revoked person is left alone.
-- The caller already checked who may do this (PM of the project, or the account itself through cert_claim).
create or replace function app_private.cert_issue_person(p_grant uuid, p_user uuid, p_actor uuid, p_force boolean, p_origin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.certificate_grants; pa public.participants; n public.nodes; j public.projects; pg public.programs; t public.certificates; tp public.certificate_templates;
  v public.certificates; v_lang text; v_person text; v_company text; i int := 0; v_code text;
begin
  select * into g from public.certificate_grants where id = p_grant;
  if not found or g.revoked_at is not null then return jsonb_build_object('status', 'not_linked'); end if;
  select * into pa from public.participants where id = g.participant_id;
  if pa.status <> 'attended' or not app_private.cert_is_member(pa, p_user) then return jsonb_build_object('status', 'not_linked'); end if;
  perform pg_advisory_xact_lock(hashtextextended(g.id::text || p_user::text, 42));
  select * into v from public.certificates where grant_id = g.id and user_id = p_user and revoked_at is null;
  if found then return jsonb_build_object('status', 'existing', 'certificate_id', v.id, 'code', v.code); end if;
  if not p_force and exists (select 1 from public.certificates where grant_id = g.id and user_id = p_user) then
    return jsonb_build_object('status', 'revoked');
  end if;
  select * into n from public.nodes where id = g.node_id;
  select * into j from public.projects where id = pa.project_id;
  select * into pg from public.programs where id = j.program_id;
  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  select * into tp from public.certificate_templates where node_id = g.node_id and language = v_lang order by version desc limit 1;
  if not found then return jsonb_build_object('status', 'no_template'); end if;
  v_person := app_private.cert_person_name(p_user, v_lang);
  if v_person is null then return jsonb_build_object('status', 'no_name'); end if;
  v_company := coalesce(app_private.cert_company_name(pa, v_lang), '');
  loop
    i := i + 1; v_code := app_private.gen_cert_code();
    begin
      insert into public.certificates (project_id, node_id, participant_id, template_id, code, snapshot, issued_by, user_id, grant_id, origin)
      values (pa.project_id, g.node_id, pa.id, tp.id, v_code,
              jsonb_build_object('person_name', left(v_person, 200), 'company_name', left(v_company, 200),
                'program_name', left(case when v_lang = 'ar' then coalesce(nullif(pg.name_ar, ''), pg.name_en) else coalesce(nullif(pg.name_en, ''), pg.name_ar) end, 200),
                'project_name', left(case when v_lang = 'ar' then coalesce(nullif(j.name_ar, ''), j.name_en) else coalesce(nullif(j.name_en, ''), j.name_ar) end, 200),
                'completed_on', (j.completed_at at time zone j.timezone)::date, 'issued_on', (now() at time zone j.timezone)::date,
                'language', v_lang, 'template_version', tp.version),
              coalesce(p_actor, g.granted_by), p_user, g.id, p_origin)
      returning * into v;
      return jsonb_build_object('status', 'issued', 'certificate_id', v.id, 'code', v.code);
    exception when unique_violation then
      select * into v from public.certificates where grant_id = g.id and user_id = p_user and revoked_at is null;
      if found then return jsonb_build_object('status', 'existing', 'certificate_id', v.id, 'code', v.code); end if;   -- lost a race: the winner
      if i > 5 then raise; end if;                                                                                    -- (a code collision: retry)
    end;
  end loop;
end $$;
revoke all on function app_private.cert_issue_person(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;

-- ONE participant (company level): the explicit "Issue" action = authorise it (one ACTIVE grant) and create the person certificate of EVERY account that
-- is already linked. Returns { status: 'issued' | 'authorised' | 'existing' | 'no_name' | 'not_attended' | 'skipped_revoked' | 'not_found', grant_id, created,
--   existing, revoked, no_name, linked, unlinked }.
-- The caller already checked: PM of the project, node of type certificates, project completed, template present.
-- `p_skip_revoked` (the bulk "all attended" action): a participant whose grant was revoked is left alone (the PM re-issues those on purpose).
create or replace function app_private.cert_issue_one(p_participant uuid, p_node uuid, p_actor uuid, p_skip_revoked boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pa public.participants; n public.nodes; g public.certificate_grants; r record; v_res jsonb; v_lang text; v_new boolean := false;
  k_created int := 0; k_existing int := 0; k_revoked int := 0; k_noname int := 0; k_linked int := 0; k_unlinked int := 0; v_status text;
begin
  select * into n from public.nodes where id = p_node;
  select * into pa from public.participants where id = p_participant and project_id = n.project_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_node::text || p_participant::text, 0));
  if pa.status <> 'attended' then return jsonb_build_object('status', 'not_attended'); end if;
  select * into g from public.certificate_grants where node_id = p_node and participant_id = p_participant and revoked_at is null;
  if not found then
    if p_skip_revoked and exists (select 1 from public.certificate_grants where node_id = p_node and participant_id = p_participant) then
      return jsonb_build_object('status', 'skipped_revoked');
    end if;
    insert into public.certificate_grants (project_id, node_id, participant_id, granted_by) values (pa.project_id, p_node, p_participant, p_actor) returning * into g;
    v_new := true;
  end if;
  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  for r in select a.user_id from app_private.cert_accounts(p_participant) a loop
    k_linked := k_linked + 1;
    v_res := app_private.cert_issue_person(g.id, r.user_id, p_actor, false, 'issue');
    case v_res->>'status'
      when 'issued' then k_created := k_created + 1;
      when 'existing' then k_existing := k_existing + 1;
      when 'revoked' then k_revoked := k_revoked + 1;
      when 'no_name' then k_noname := k_noname + 1;
      else null;
    end case;
  end loop;
  select count(*) into k_unlinked from jsonb_array_elements(app_private.cert_people(p_participant, v_lang)) p where not (p->>'linked')::boolean;
  v_status := case when k_created > 0 then 'issued' when k_linked > 0 and k_noname = k_linked then 'no_name' when v_new then 'authorised' else 'existing' end;
  return jsonb_build_object('status', v_status, 'grant_id', g.id, 'created', k_created, 'existing', k_existing, 'revoked', k_revoked, 'no_name', k_noname,
                            'linked', k_linked, 'unlinked', k_unlinked);
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
  if not exists (select 1 from public.certificate_template_fields f where f.template_id = t.id and f.var in ('person_name', 'participant_name')) then
    raise exception 'certificate_template_incomplete: the template has no person name field' using errcode = '23514', hint = 'certificate_template_incomplete';
  end if;
  return n;
end $$;
revoke all on function app_private.cert_issue_checks(uuid) from public, anon, authenticated;

-- "Issue certificates": `p_participants = null` -> every attended participant (a participant whose grant was revoked is skipped); an array -> exactly
-- those (re-authorises a participant whose grant was revoked: NEW certificates with NEW codes). Totals: issued = person certificates created,
-- authorised = participants newly authorised, existing = participants with nothing new, skipped = the rest.
create or replace function public.issue_certificates(p_node uuid, p_participants uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; r record; v_ids uuid[]; v_res jsonb; v_rows jsonb := '[]'::jsonb; k_issued int := 0; k_auth int := 0; k_existing int := 0; k_skipped int := 0;
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
    k_issued := k_issued + coalesce((v_res->>'created')::int, 0);
    case v_res->>'status'
      when 'issued' then k_auth := k_auth + 1;
      when 'authorised' then k_auth := k_auth + 1;
      when 'existing' then k_existing := k_existing + 1;
      else k_skipped := k_skipped + 1;
    end case;
    v_rows := v_rows || jsonb_build_array(v_res || jsonb_build_object('participant_id', r.id));
  end loop;
  return jsonb_build_object('issued', k_issued, 'authorised', k_auth, 'existing', k_existing, 'skipped', k_skipped, 'results', v_rows);
end $$;
revoke all on function public.issue_certificates(uuid, uuid[]) from public, anon;
grant execute on function public.issue_certificates(uuid, uuid[]) to authenticated;

-- m06d names, kept (the stage-1 exhaustive grant list names them) and routed through the same code.
-- issue_certificate(participant, node) authorises the participant and returns the FIRST person certificate (an empty row when no account is linked yet).
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
  select * into v from public.certificates where grant_id = (v_res->>'grant_id')::uuid and revoked_at is null order by issued_at, id limit 1;
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

-- Issue AGAIN to one person whose certificate was revoked (decision 07-9: on purpose): a NEW certificate with a NEW code, the old one stays revoked.
-- The participant's grant must be active (a participant-level revocation is undone by issuing to the participant again).
create or replace function public.reissue_certificate(p_cert uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.certificates; g public.certificate_grants; v_res jsonb;
begin
  select * into c from public.certificates where id = p_cert;
  if not found or not app_private.is_project_manager(c.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.cert_issue_checks(c.node_id);
  if c.user_id is null then
    raise exception 'certificate_invalid: this certificate has no account to issue to' using errcode = '22023', hint = 'certificate_invalid', detail = 'user:none';
  end if;
  select * into g from public.certificate_grants where node_id = c.node_id and participant_id = c.participant_id and revoked_at is null;
  if not found then
    raise exception 'certificate_grant_revoked: issue to the participant again first' using errcode = '23514', hint = 'certificate_grant_revoked';
  end if;
  v_res := app_private.cert_issue_person(g.id, c.user_id, (select auth.uid()), true, 'reissue');
  if v_res->>'status' not in ('issued', 'existing') then
    raise exception 'certificate_not_linked: the person is no longer linked to this participant' using errcode = '23514', hint = 'certificate_not_linked';
  end if;
  return v_res;
end $$;
revoke all on function public.reissue_certificate(uuid) from public, anon;
grant execute on function public.reissue_certificate(uuid) to authenticated;

-- Participant-level revocation: the grant AND every active person certificate of the participant under this node (one reason, one timestamp).
-- revoke_certificate(cert, reason) of m38 stays the per-certificate revocation.
create or replace function public.revoke_participant_certificates(p_node uuid, p_participant uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; v_now timestamptz := now(); k int := 0; v_reason text; v_grant int := 0;
begin
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'certificate_invalid: the reason is too long' using errcode = '22023', hint = 'certificate_invalid', detail = 'reason:too_long';
  end if;
  if not exists (select 1 from public.participants pa where pa.id = p_participant and pa.project_id = n.project_id) then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;
  v_reason := nullif(btrim(p_reason), '');
  perform pg_advisory_xact_lock(hashtextextended(p_node::text || p_participant::text, 0));
  update public.certificates set revoked_at = v_now, revoked_by = (select auth.uid()), revoked_reason = v_reason
   where node_id = p_node and participant_id = p_participant and revoked_at is null;
  get diagnostics k = row_count;
  update public.certificate_grants set revoked_at = v_now, revoked_by = (select auth.uid()), revoked_reason = v_reason
   where node_id = p_node and participant_id = p_participant and revoked_at is null;
  get diagnostics v_grant = row_count;
  return jsonb_build_object('revoked', k, 'grant_revoked', v_grant > 0);
end $$;
revoke all on function public.revoke_participant_certificates(uuid, uuid, text) from public, anon;
grant execute on function public.revoke_participant_certificates(uuid, uuid, text) to authenticated;

-- The founder's own certificate, created on demand (idempotent): the caller must be linked to an ATTENDED participant that the PM authorised (an active
-- grant) in a COMPLETED project, on a node shown to participants. Anything else is `forbidden` (no hint about what exists).
-- Returns { status: 'issued' | 'existing' | 'revoked' | 'no_name', certificate_id, code, certificates }.
create or replace function app_private.cert_claim(p_node uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; j public.projects; r record; v_res jsonb; v_best jsonb := null; v_any boolean := false; k int := 0; v_lang text;
begin
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null and show_to_participants;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.projects where id = n.project_id and deleted_at is null;
  if not found or j.completed_at is null then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in
    select g.id as grant_id, g.granted_by, pa.id as participant_id
      from public.certificate_grants g join public.participants pa on pa.id = g.participant_id
     where g.node_id = p_node and g.revoked_at is null and pa.project_id = n.project_id and pa.status = 'attended'
       and app_private.cert_is_member(pa, p_user)
     order by pa.created_at, pa.id
  loop
    v_any := true;
    v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
    if not exists (select 1 from public.certificate_templates t where t.node_id = p_node and t.language = v_lang) then
      raise exception 'certificate_template_missing: no certificate template for language %', v_lang using errcode = 'P0002', hint = 'certificate_template_missing';
    end if;
    v_res := app_private.cert_issue_person(r.grant_id, p_user, r.granted_by, false, 'claim');
    if v_res->>'status' in ('issued', 'existing') then k := k + 1; end if;
    if v_best is null or (v_best->>'status' not in ('issued', 'existing') and v_res->>'status' in ('issued', 'existing')) then v_best := v_res; end if;
  end loop;
  if not v_any then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce(v_best, jsonb_build_object('status', 'no_name')) || jsonb_build_object('certificates', k);
end $$;
revoke all on function app_private.cert_claim(uuid, uuid) from public, anon, authenticated;

create or replace function public.claim_my_certificate(p_node uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform app_private.link_my_participations();          -- a founder accepted through Selection is linked by the verified e-mail first (m39)
  return app_private.cert_claim(p_node, v_uid);
end $$;
revoke all on function public.claim_my_certificate(uuid) from public, anon;
grant execute on function public.claim_my_certificate(uuid) to authenticated;

-- ================================================================= 5. reads
-- The Issue panel payload (PM). One row per participant that attended or holds a grant / certificate; each row lists the PEOPLE of the participant
-- (the company's founders, linked to an account or not) with the state of THEIR certificate:
--   issued | revoked | claimable (linked, authorised, not created yet) | pending (linked, not authorised yet) | not_linked | no_name (linked, but the account has no name to print)
-- No account ids leave the database: a certificate is addressed by ITS id.
create or replace function public.get_certificates_admin(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  n public.nodes; j public.projects; v_lang text; t public.certificates; tp public.certificate_templates; v_rows jsonb := '[]'::jsonb; v_other int;
  pa public.participants; g public.certificate_grants; p jsonb; v_founders jsonb; v_cert jsonb; v_cid uuid; v_state text; v_user uuid; v_company text; v_label text;
  k_linked int; k_issued int; k_claim int; k_rev int; k_unl int; seen uuid[]; c record;
  t_issued int := 0; t_claim int := 0; t_unl int := 0; t_rev int := 0; t_persons int := 0;
begin
  select * into n from public.nodes where id = p_node and type = 'certificates' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.projects where id = n.project_id;
  v_lang := coalesce(nullif(n.config->>'language', ''), 'ar');
  select * into tp from public.certificate_templates where node_id = p_node and language = v_lang order by version desc limit 1;
  for pa in
    select x.* from public.participants x
     where x.project_id = n.project_id
       and (x.status = 'attended' or exists (select 1 from public.certificate_grants gg where gg.node_id = p_node and gg.participant_id = x.id)
            or exists (select 1 from public.certificates cc where cc.node_id = p_node and cc.participant_id = x.id))
     order by x.created_at, x.id
  loop
    select * into g from public.certificate_grants where node_id = p_node and participant_id = pa.id order by (revoked_at is null) desc, granted_at desc limit 1;
    v_founders := '[]'::jsonb; seen := '{}'; k_linked := 0; k_issued := 0; k_claim := 0; k_rev := 0; k_unl := 0;
    for p in select * from jsonb_array_elements(app_private.cert_people(pa.id, v_lang)) loop
      v_user := nullif(p->>'user_id', '')::uuid;
      v_cert := null; v_cid := null;
      if v_user is not null then
        select jsonb_build_object('id', c2.id, 'code', c2.code, 'issued_at', c2.issued_at, 'revoked_at', c2.revoked_at, 'revoked_reason', c2.revoked_reason,
                                  'name', coalesce(c2.snapshot->>'person_name', c2.snapshot->>'participant_name')), c2.id
          into v_cert, v_cid
          from public.certificates c2 where c2.node_id = p_node and c2.participant_id = pa.id and c2.user_id = v_user
         order by (c2.revoked_at is null) desc, c2.issued_at desc limit 1;
      end if;
      if v_cid is not null then seen := seen || v_cid; end if;
      v_state := case when v_cert is not null and v_cert->>'revoked_at' is null then 'issued'
                      when v_cert is not null then 'revoked'
                      when not (p->>'linked')::boolean then 'not_linked'
                      when coalesce(p->>'name', '') = '' then 'no_name'
                      when g.id is not null and g.revoked_at is null then 'claimable'
                      else 'pending' end;
      if (p->>'linked')::boolean then k_linked := k_linked + 1; else k_unl := k_unl + 1; end if;
      if v_state = 'issued' then k_issued := k_issued + 1; elsif v_state = 'claimable' then k_claim := k_claim + 1; elsif v_state = 'revoked' then k_rev := k_rev + 1; end if;
      v_founders := v_founders || jsonb_build_array(jsonb_build_object('founder_id', p->'founder_id', 'name', p->>'name', 'linked', (p->>'linked')::boolean,
                                                                      'state', v_state, 'certificate', v_cert));
    end loop;
    -- certificates whose account is no longer one of the participant's people (a founder removed from the company, a deleted account): still revocable
    for c in
      select c3.id, c3.code, c3.issued_at, c3.revoked_at, c3.revoked_reason, coalesce(c3.snapshot->>'person_name', c3.snapshot->>'participant_name') as nm
        from public.certificates c3 where c3.node_id = p_node and c3.participant_id = pa.id and not (c3.id = any (seen))
         and not exists (select 1 from public.certificates c4 where c4.node_id = p_node and c4.participant_id = pa.id and c4.user_id is not distinct from c3.user_id
                            and c4.user_id is not null and c4.id = any (seen))
       order by c3.issued_at, c3.id
    loop
      v_founders := v_founders || jsonb_build_array(jsonb_build_object('founder_id', null, 'name', coalesce(c.nm, ''), 'linked', false, 'detached', true,
        'state', case when c.revoked_at is null then 'issued' else 'revoked' end,
        'certificate', jsonb_build_object('id', c.id, 'code', c.code, 'issued_at', c.issued_at, 'revoked_at', c.revoked_at, 'revoked_reason', c.revoked_reason, 'name', c.nm)));
      if c.revoked_at is null then k_issued := k_issued + 1; else k_rev := k_rev + 1; end if;
    end loop;
    v_company := coalesce(app_private.cert_company_name(pa, v_lang), '');
    v_label := coalesce(nullif(v_company, ''), nullif(v_founders->0->>'name', ''), '');
    t_issued := t_issued + k_issued; t_claim := t_claim + k_claim; t_unl := t_unl + k_unl; t_rev := t_rev + k_rev; t_persons := t_persons + jsonb_array_length(v_founders);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'participant_id', pa.id, 'status', pa.status, 'needs_review', pa.needs_review, 'name', v_label, 'company_name', v_company,
      'grant', case when g.id is null then null else jsonb_build_object('id', g.id, 'granted_at', g.granted_at, 'revoked_at', g.revoked_at, 'revoked_reason', g.revoked_reason) end,
      'founders', v_founders,
      'counts', jsonb_build_object('people', jsonb_array_length(v_founders), 'linked', k_linked, 'unlinked', k_unl, 'issued', k_issued, 'claimable', k_claim, 'revoked', k_rev)));
  end loop;
  select jsonb_agg(r order by lower(r->>'name'), r->>'participant_id') into v_rows from jsonb_array_elements(v_rows) r;
  select count(*) into v_other from public.participants x
   where x.project_id = n.project_id and x.status <> 'attended'
     and not exists (select 1 from public.certificate_grants gg where gg.node_id = p_node and gg.participant_id = x.id)
     and not exists (select 1 from public.certificates cc where cc.node_id = p_node and cc.participant_id = x.id);
  return jsonb_build_object(
    'project', jsonb_build_object('id', j.id, 'program_id', j.program_id, 'name_en', j.name_en, 'name_ar', j.name_ar, 'completed_at', j.completed_at, 'timezone', j.timezone),
    'language', v_lang,
    'template', case when tp.id is null then null else jsonb_build_object('id', tp.id, 'version', tp.version, 'language', tp.language, 'width_px', tp.width_px, 'height_px', tp.height_px,
                   'has_name_field', exists (select 1 from public.certificate_template_fields f where f.template_id = tp.id and f.var in ('person_name', 'participant_name'))) end,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totals', jsonb_build_object('people', t_persons, 'issued', t_issued, 'claimable', t_claim, 'unlinked', t_unl, 'revoked', t_rev),
    'others', v_other);
end $$;
revoke all on function public.get_certificates_admin(uuid) from public, anon;
grant execute on function public.get_certificates_admin(uuid) to authenticated;

-- The render payload of ONE person certificate: a PM, or the OWNER (the ACCOUNT of the certificate; attended, not revoked, project completed, node exposed).
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
  v_own := (select auth.uid()) is not null and c.user_id = (select auth.uid())
           and pa.status = 'attended' and c.revoked_at is null and j.completed_at is not null and n.show_to_participants and n.deleted_at is null;
  if not v_own then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.cert_render_json(c, false);
end $$;
revoke all on function public.get_certificate_render_payload(uuid) from public, anon;
grant execute on function public.get_certificate_render_payload(uuid) to authenticated;

-- The certificates the CALLER owns and may download now. VOLATILE: opening the block first CLAIMS the caller's own certificate on every authorised
-- node of the scope (a founder who joined or linked after the PM issued gets hers here, idempotently), then lists. Light metadata only; the render
-- payload is fetched on demand. `p_project` narrows to one project (the founder Program page). `participant_name` is kept as an alias of `person_name`.
create or replace function public.list_my_certificates(p_project uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r record;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform app_private.link_my_participations();
  for r in
    select distinct n.id
      from public.certificate_grants g
      join public.participants pa on pa.id = g.participant_id and pa.status = 'attended'
      join public.nodes n on n.id = g.node_id and n.deleted_at is null and n.show_to_participants
      join public.projects j on j.id = n.project_id and j.completed_at is not null
     where g.revoked_at is null and (p_project is null or n.project_id = p_project) and app_private.cert_is_member(pa, v_uid)
  loop
    begin
      perform app_private.cert_claim(r.id, v_uid);
    exception when others then null;                         -- nothing to claim (template missing, ...): the list below simply shows what exists
    end;
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object('certificate_id', c.id, 'node_id', n.id, 'project_id', c.project_id, 'name_en', n.name_en, 'name_ar', n.name_ar,
             'code', c.code, 'issued_at', c.issued_at,
             'person_name', coalesce(c.snapshot->>'person_name', c.snapshot->>'participant_name'), 'participant_name', coalesce(c.snapshot->>'person_name', c.snapshot->>'participant_name'),
             'company_name', c.snapshot->>'company_name', 'program_name', c.snapshot->>'program_name',
             'project_name', c.snapshot->>'project_name', 'completed_on', c.snapshot->>'completed_on', 'language', c.snapshot->>'language')
           order by c.issued_at desc, c.id)
      from public.certificates c
      join public.participants pa on pa.id = c.participant_id
      join public.nodes n on n.id = c.node_id and n.deleted_at is null and n.show_to_participants
      join public.projects j on j.id = c.project_id and j.completed_at is not null
     where c.revoked_at is null and pa.status = 'attended' and c.user_id = v_uid
       and (p_project is null or c.project_id = p_project)), '[]'::jsonb);
end $$;
revoke all on function public.list_my_certificates(uuid) from public, anon;
grant execute on function public.list_my_certificates(uuid) to authenticated;

-- public verification: valid | revoked | not_found + the PERSON name + the COMPANY name + program + dates, nothing else
create or replace function public.get_public_certificate_verification(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_code text; c public.certificates; n public.nodes; v_valid boolean; v_show boolean; v_person text;
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
  v_person := coalesce(c.snapshot->>'person_name', c.snapshot->>'participant_name');
  return jsonb_strip_nulls(jsonb_build_object(
    'status', case when v_valid then 'valid' else 'revoked' end, 'valid', v_valid, 'revoked', not v_valid,
    'code', c.code, 'person_name', v_person, 'participant_name', v_person, 'company_name', nullif(c.snapshot->>'company_name', ''),
    'program_name', c.snapshot->>'program_name',
    'project_name', c.snapshot->>'project_name', 'completed_on', c.snapshot->>'completed_on', 'issued_on', c.snapshot->>'issued_on',
    'language', c.snapshot->>'language', 'issuer', 'Athar',
    'render', case when v_show then app_private.cert_render_json(c, true) - 'id' - 'issued_at' end));
end $$;
revoke all on function public.get_public_certificate_verification(text) from public;
grant execute on function public.get_public_certificate_verification(text) to anon, authenticated;

-- ================================================================= 6. RLS
-- a founder reads only HIS OWN person certificate (the account of the row), not the company's other founders' ones (m07 allowed the whole company)
drop policy if exists certificates_select_pm_alumni_own on public.certificates;
create policy certificates_select_pm_alumni_own on public.certificates for select to authenticated
  using (
    (select app_private.is_project_manager(project_id))
    or (select app_private.has_role('alumni_manager'))
    or (revoked_at is null and user_id = (select auth.uid())
        and exists (select 1 from public.participants pa where pa.id = certificates.participant_id and pa.status = 'attended'))
  );

-- the template image: the public verifier branch is unchanged; the owner branch is now the certificate's ACCOUNT
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
                and c.user_id = (select auth.uid()))))
$$;
revoke all on function public.cert_template_readable(text) from public, anon, authenticated;
grant execute on function public.cert_template_readable(text) to anon, authenticated;

-- ================================================================= 7. storage: the template bucket is WebP only (owner decisions 17.2 + 17.3)
update storage.buckets set allowed_mime_types = array['image/webp'] where id = 'certificate-templates';
-- Two more RESTRICTIVE policies (the m41 ones are left alone): an object in the template bucket must be named *.webp and, when Storage recorded a
-- mimetype, it must be image/webp. A PNG / JPEG / PDF cannot be stored there, whatever the permissive PM policies say. Plain operators only.
drop policy if exists webp_only_cert_insert on storage.objects;
create policy webp_only_cert_insert on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'certificate-templates' or (name ~* '\.webp$' and coalesce(metadata ->> 'mimetype', 'image/webp') = 'image/webp'));
drop policy if exists webp_only_cert_update on storage.objects;
create policy webp_only_cert_update on storage.objects as restrictive for update to anon, authenticated
  with check (bucket_id <> 'certificate-templates' or (name ~* '\.webp$' and coalesce(metadata ->> 'mimetype', 'image/webp') = 'image/webp'));

-- ================================================================= self-check
do $$
begin
  if to_regclass('public.certificate_grants') is null then raise exception 'm42: certificate_grants is missing'; end if;
  if to_regprocedure('public.claim_my_certificate(uuid)') is null or to_regprocedure('public.reissue_certificate(uuid)') is null
     or to_regprocedure('public.revoke_participant_certificates(uuid,uuid,text)') is null or to_regprocedure('app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)') is null
     or to_regprocedure('app_private.cert_claim(uuid,uuid)') is null or to_regprocedure('app_private.cert_person_name(uuid,text)') is null
     or to_regprocedure('app_private.cert_backfill_person()') is null or has_function_privilege('authenticated', 'app_private.cert_backfill_person()', 'EXECUTE') then
    raise exception 'm42: a function is missing';
  end if;
  if has_function_privilege('anon', 'public.claim_my_certificate(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.reissue_certificate(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_participant_certificates(uuid,uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.list_my_certificates(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.cert_claim(uuid,uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.cert_people(uuid,text)', 'EXECUTE') then
    raise exception 'm42: an API role may execute a function it must not';
  end if;
  if not (has_function_privilege('authenticated', 'public.claim_my_certificate(uuid)', 'EXECUTE') and has_function_privilege('anon', 'public.get_public_certificate_verification(text)', 'EXECUTE')) then
    raise exception 'm42: a grant is missing';
  end if;
  if has_table_privilege('anon', 'public.certificate_grants', 'SELECT') or has_table_privilege('authenticated', 'public.certificate_grants', 'INSERT')
     or has_table_privilege('authenticated', 'public.certificate_grants', 'UPDATE') or has_table_privilege('authenticated', 'public.certificate_grants', 'DELETE') then
    raise exception 'm42: certificate_grants privileges are wrong';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'certificates_active_key' and indexdef like '%user_id%' and indexdef like '%revoked_at IS NULL%') then
    raise exception 'm42: the per-person active unique index is missing';
  end if;
  if (select allowed_mime_types from storage.buckets where id = 'certificate-templates') is distinct from array['image/webp'] then raise exception 'm42: the template bucket must be WebP only'; end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('webp_only_cert_insert', 'webp_only_cert_update') and permissive = 'RESTRICTIVE') <> 2 then
    raise exception 'm42: the template restrictive policies are missing';
  end if;
  if exists (select 1 from public.certificates where grant_id is null) then raise exception 'm42: a certificate without a grant remains'; end if;
end $$;

commit;
