-- m34_booking.sql  (Booking node, ONE node type with two presets; design 01 §3.5/§3.6/§6, 02 §3.8, 03 §6.2/§5.9, 04 §3.9/§5.6/§5.8,
--                   07 §1.5/§1.6/§2; decisions 01-1 / 01-12 / 01-15 / 02-12 / 07-3 / 07-6 / 07-10)
-- Re-runnable (create or replace / if not exists). Local DB only. No business data is altered (the 6 providers, 55 slots and
-- 30 migrated bookings are untouched; the two new NULLable columns on bookings stay NULL for them).
--
-- 1. bookings.cancel_token_hash / bookings.lang      the booker's self-service cancel token (sha256 only; the clear token is
--                                                     returned ONCE by create_booking and travels in the confirmation e-mail,
--                                                     03 §4.4 rule 7) and the language the booker used (cancellation e-mail)
--    app_private.email_outbox scope CHECK            booking_confirmation / booking_cancellation rows may be queued without a
--                                                     sender connection (the worker resolves the sender, 07-3; m24/m31/m33 pattern)
--    node_types.booking.save_children_fn             = save_children_booking: Settings saves the booking_settings row in the
--                                                     SAME save_node transaction as the config (04 §5.2)
-- 2. app_private.booking_default_template(key, lang)  node-type default texts of the two v1 booking e-mails (01-12)
--    app_private.render_email_template re-created     (m33 body) + cancel_link / meet_link become anchors like booking_link
--    app_private.booking_vars(booking, lang, cancel)  the 07 §1.5 placeholder set derived from stored data (project timezone)
--    app_private.booking_queue_email(booking, key, cancel_link)   renders the node's template (ar/en, else the default) and
--                                                     queues ONE email_outbox row (null sender, idempotency key per round) + email_log
--    app_private.booking_token_ok(booking, token)      stored hash OR the m06d HMAC (when app.settings.booking_hmac_key is set)
--    app_private.save_children_booking(node, children) validated write of booking_settings (shared mode needs a link: C-3 fixed)
-- 3. public.get_public_booking_page re-created (additive): slug, audience, whitelisted page config, default notice, the providers'
--    organisation + notice, interview invitee prefill, the existing booking on `already_booked`
--    public.create_booking re-created (same signature): name required, lang + base_url read from p_booker, cancel token stored
--    hashed and returned once, confirmation e-mail ALWAYS queued (null sender) with the rendered placeholders, calendar_create job
--    public.cancel_booking re-created (same signature): PM or token (stored hash / HMAC), calendar_cancel job + cancellation e-mail
-- 4. PM RPCs: add_booking_slots (bulk, overlap skipped by the GiST exclusion), reschedule_booking (calendar_update + e-mail),
--    restore_booking (undo of a cancel while the slot is still free), retry_calendar_job, get_booking_extras (jobs, outbox rows,
--    invitations, usable Google connections, names for the preview)
set search_path = public, extensions;

begin;

-- ================================================================= 1. schema
alter table public.bookings add column if not exists cancel_token_hash text;
alter table public.bookings add column if not exists lang text;
alter table public.bookings drop constraint if exists bookings_lang_chk;
alter table public.bookings add constraint bookings_lang_chk check (lang is null or lang in ('ar','en'));

alter table app_private.email_outbox drop constraint if exists email_outbox_scope_chk;
alter table app_private.email_outbox add constraint email_outbox_scope_chk check (
     (project_id is not null and node_id is not null and sender_connection_id is not null)
  or (email_key = 'staff_invitation' and project_id is null and node_id is null)
  or (email_key in ('form_new_response','acceptance','rejection','interview','booking_confirmation','booking_cancellation')
      and project_id is not null and node_id is not null)
);

update public.node_types set save_children_fn = 'save_children_booking'
 where key = 'booking' and save_children_fn is distinct from 'save_children_booking';

-- ================================================================= 2. helpers
-- the node-type default templates (01-12: confirmation + cancellation). MUST stay identical to
-- web/src/nodes/booking/bookingConfig.js DEFAULT_TEMPLATES (the client preview shows what the server queues).
create or replace function app_private.booking_default_template(p_key text, p_lang text) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case p_key
    when 'booking_confirmation' then case when p_lang = 'ar'
      then jsonb_build_object('subject', 'تأكيد حجزك مع {{provider_name}}',
             'body', E'عزيزي {{booker_name}}،\n\nتم تأكيد جلستك مع {{provider_name}}.\n\nالموعد: {{start_time}} - {{end_time}} ({{timezone}})\nرابط الاجتماع: {{meet_link}}\n\nلإلغاء الحجز: {{cancel_link}}\n\nمع أطيب التحيات،\nفريق {{project_name}}')
      else jsonb_build_object('subject', 'Your session with {{provider_name}} is confirmed',
             'body', E'Dear {{booker_name}},\n\nYour session with {{provider_name}} is confirmed.\n\nWhen: {{start_time}} - {{end_time}} ({{timezone}})\nMeeting link: {{meet_link}}\n\nNeed to cancel? {{cancel_link}}\n\nBest regards,\nThe {{project_name}} team') end
    when 'booking_cancellation' then case when p_lang = 'ar'
      then jsonb_build_object('subject', 'تم إلغاء جلستك مع {{provider_name}}',
             'body', E'عزيزي {{booker_name}}،\n\nتم إلغاء جلستك مع {{provider_name}} التي كانت مقررة في {{start_time}} ({{timezone}}).\n\nيمكنك حجز موعد آخر من صفحة الحجز.\n\nمع أطيب التحيات،\nفريق {{project_name}}')
      else jsonb_build_object('subject', 'Your session with {{provider_name}} was cancelled',
             'body', E'Dear {{booker_name}},\n\nYour session with {{provider_name}} scheduled for {{start_time}} ({{timezone}}) has been cancelled.\n\nYou are welcome to book another slot from the booking page.\n\nBest regards,\nThe {{project_name}} team') end
    else null end
$$;
revoke all on function app_private.booking_default_template(text, text) from public, anon, authenticated;

-- m33 body + the booking link keys (booking_link, cancel_link, meet_link) become anchors when they hold a URL
create or replace function app_private.render_email_template(p_tpl text, p_vars jsonb, p_html boolean) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare out text := coalesce(p_tpl, ''); k text; v text; is_html boolean;
begin
  is_html := p_html and out ~ '<[a-zA-Z][^>]*>';
  if p_html and not is_html then out := replace(replace(out, E'\r\n', E'\n'), E'\n', '<br>'); end if;
  for k, v in select * from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    v := coalesce(v, '');
    if p_html then
      v := case when k in ('booking_link', 'cancel_link', 'meet_link') and v ~* '^https?://'
                  then '<a href="' || app_private.html_escape(v) || '">' || app_private.html_escape(v) || '</a>'
                else app_private.html_escape(v) end;
    end if;
    out := regexp_replace(out, '\{\{\s*' || k || '\s*\}\}', v, 'g');
    out := regexp_replace(out, '\{' || k || '\}', v, 'g');
  end loop;
  out := regexp_replace(out, '\{\{\s*[a-zA-Z_]+\s*\}\}', '', 'g');
  return out;
end $$;
revoke all on function app_private.render_email_template(text, jsonb, boolean) from public, anon, authenticated;

-- the 07 §1.5 placeholder values of one booking, formatted in the PROJECT timezone (07-10)
create or replace function app_private.booking_vars(p_booking uuid, p_lang text, p_cancel_link text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    -- names are whitespace-collapsed: the migrated network_experts carry runs of spaces ("First    Last")
    'provider_name', btrim(regexp_replace(coalesce(case when p_lang = 'ar' then coalesce(ne.name_ar, li.manual_fields->>'title_ar') end,
                              ne.name_en, li.manual_fields->>'title_en', ne.name_ar, li.manual_fields->>'title_ar', ''), '[[:space:]]+', ' ', 'g')),
    'mentor_name',   btrim(regexp_replace(coalesce(case when p_lang = 'ar' then coalesce(ne.name_ar, li.manual_fields->>'title_ar') end,
                              ne.name_en, li.manual_fields->>'title_en', ne.name_ar, li.manual_fields->>'title_ar', ''), '[[:space:]]+', ' ', 'g')),
    'booker_name',   coalesce(b.booker_name, ''),
    'first_name',    app_private.first_name(b.booker_name),
    'company_name',  coalesce(case when p_lang = 'ar' then co.name_ar end, co.name_en, co.name_ar, b.booker_company_name, ''),
    'booker_email',  b.booker_email::text,
    'start_time',    to_char(s.starts_at at time zone j.timezone, case when p_lang = 'ar' then 'DD/MM/YYYY HH24:MI' else 'DD Mon YYYY, HH24:MI' end),
    'end_time',      to_char(s.ends_at   at time zone j.timezone, 'HH24:MI'),
    'date',          to_char(s.starts_at at time zone j.timezone, 'YYYY-MM-DD'),
    'timezone',      j.timezone,
    'meet_link',     coalesce(nullif(btrim(b.meet_link), ''), case when p_lang = 'ar' then 'سيصلك رابط الاجتماع في رسالة لاحقة' else 'the meeting link will follow by e-mail' end),
    'project_name',  coalesce(case when p_lang = 'ar' then j.name_ar end, j.name_en, j.name_ar, ''),
    'program_name',  coalesce(case when p_lang = 'ar' then g.name_ar end, g.name_en, g.name_ar, ''),
    'cancel_link',   coalesce(p_cancel_link, ''))
  from public.bookings b
  join public.booking_slots s on s.id = b.slot_id
  join public.booking_providers p on p.id = s.provider_id
  join public.list_items li on li.id = p.list_item_id
  left join public.network_experts ne on ne.id = li.network_expert_id
  left join public.companies co on co.id = b.booker_company_id
  join public.projects j on j.id = b.project_id
  join public.programs g on g.id = j.program_id
  where b.id = p_booking
$$;
revoke all on function app_private.booking_vars(uuid, text, text) from public, anon, authenticated;

-- ONE outbox row for a booking e-mail: the node's template for the booker's language (else its other language, else the
-- node-type default); sender resolved by the worker (null); idempotent per (node, key, booking, round). Returns the outbox id
-- (null when the e-mail is disabled on the node or already queued in this round).
create or replace function app_private.booking_queue_email(p_booking uuid, p_key text, p_cancel_link text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; n public.nodes; v_tpl jsonb; v_lang text; v_subject text; v_body text; v_vars jsonb; v_round int; v_key text; v_id uuid; v_cc text[];
begin
  if p_key not in ('booking_confirmation', 'booking_cancellation') then raise exception 'unknown booking e-mail %', p_key using errcode = '22023'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found then return null; end if;
  select * into n from public.nodes where id = b.node_id;
  v_lang := coalesce(b.lang, 'en');
  v_tpl := coalesce(n.config->'emails'->p_key, '{}'::jsonb);
  if coalesce(v_tpl->>'enabled', 'true') = 'false' then return null; end if;
  if v_lang = 'ar' then
    v_subject := coalesce(nullif(btrim(v_tpl->>'subject_ar'), ''), nullif(btrim(v_tpl->>'subject'), ''), app_private.booking_default_template(p_key, 'ar')->>'subject');
    v_body := coalesce(nullif(btrim(v_tpl->>'body_html_ar'), ''), nullif(btrim(v_tpl->>'body_html'), ''), app_private.booking_default_template(p_key, 'ar')->>'body');
  else
    v_subject := coalesce(nullif(btrim(v_tpl->>'subject'), ''), nullif(btrim(v_tpl->>'subject_ar'), ''), app_private.booking_default_template(p_key, 'en')->>'subject');
    v_body := coalesce(nullif(btrim(v_tpl->>'body_html'), ''), nullif(btrim(v_tpl->>'body_html_ar'), ''), app_private.booking_default_template(p_key, 'en')->>'body');
  end if;
  v_cc := array(select distinct lower(btrim(x)) from (
            select jsonb_array_elements_text(case when jsonb_typeof(v_tpl->'cc') = 'array' then v_tpl->'cc' else '[]'::jsonb end) x
            union all
            select jsonb_array_elements_text(case when jsonb_typeof(v_tpl->'admin') = 'array' then v_tpl->'admin' else '[]'::jsonb end)) s
          where btrim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' order by 1);
  v_vars := app_private.booking_vars(p_booking, v_lang, p_cancel_link);
  select count(*) into v_round from app_private.email_outbox o where o.booking_id = p_booking and o.email_key = p_key;
  v_round := v_round + 1;
  v_key := encode(extensions.digest(n.id::text || ':' || p_key || ':' || p_booking::text || ':' || v_round::text, 'sha256'), 'hex');
  insert into app_private.email_outbox (project_id, node_id, email_key, sender_connection_id, recipient_email, booking_id, subject, body_html, cc, idempotency_key, created_by)
  values (n.project_id, n.id, p_key, null, b.booker_email, p_booking,
          app_private.render_email_template(v_subject, v_vars, false), app_private.render_email_template(v_body, v_vars, true),
          case when cardinality(v_cc) > 0 then v_cc end, v_key, (select auth.uid()))
  on conflict (idempotency_key) do nothing returning id into v_id;
  if v_id is not null then
    insert into app_private.email_log (outbox_id, event, detail) values (v_id, 'queued', 'booking:' || p_key || ' round ' || v_round || ' lang ' || v_lang);
  end if;
  return v_id;
end $$;
revoke all on function app_private.booking_queue_email(uuid, text, text) from public, anon, authenticated;

-- the booker's self-service token: the hash stored by create_booking, or the m06d HMAC when the DB setting exists
create or replace function app_private.booking_token_ok(p_booking public.bookings, p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_token is not null and btrim(p_token) <> '' and (
       (p_booking.cancel_token_hash is not null and p_booking.cancel_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex'))
    or (app_private.booking_cancel_token(p_booking.id) is not null and app_private.booking_cancel_token(p_booking.id) = p_token))
$$;
revoke all on function app_private.booking_token_ok(public.bookings, text) from public, anon, authenticated;

-- typed children of a booking node = its booking_settings row (04 §3.9); called by save_node inside its transaction
create or replace function app_private.save_children_booking(p_node uuid, p_children jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_mode text; v_notice int; v_link_mode text; v_link text; v_conn uuid; bs public.booking_settings;
begin
  if p_children is null or jsonb_typeof(p_children) <> 'object' then return; end if;
  s := p_children->'settings';
  if s is null or jsonb_typeof(s) <> 'object' then return; end if;
  select * into bs from public.booking_settings where node_id = p_node for update;
  if not found then raise exception 'booking settings row missing' using errcode = 'P0002'; end if;
  v_mode := coalesce(nullif(s->>'mode', ''), bs.mode);
  if v_mode not in ('mentor', 'interview') then raise exception 'booking_invalid: mode must be mentor or interview' using errcode = '22023', hint = 'booking_invalid', detail = 'mode:invalid'; end if;
  v_notice := coalesce(nullif(s->>'default_advance_notice_min', '')::int, bs.default_advance_notice_min);
  if v_notice < 0 then raise exception 'booking_invalid: advance notice must be >= 0' using errcode = '22023', hint = 'booking_invalid', detail = 'advance_notice:invalid'; end if;
  v_link_mode := coalesce(nullif(s->>'meeting_link_mode', ''), bs.meeting_link_mode);
  if v_link_mode not in ('unique', 'shared') then raise exception 'booking_invalid: meeting link mode' using errcode = '22023', hint = 'booking_invalid', detail = 'meeting_link_mode:invalid'; end if;
  v_link := case when s ? 'shared_meet_link' then nullif(btrim(s->>'shared_meet_link'), '') else bs.shared_meet_link end;
  if v_link_mode = 'shared' and v_link is null then
    raise exception 'booking_shared_link_required: shared Meet mode needs a link' using errcode = '22023', hint = 'booking_shared_link_required', detail = 'shared_meet_link:required';
  end if;
  if v_link is not null and v_link !~* '^https?://[^\s]+$' then
    raise exception 'booking_invalid: the shared link must be an https URL' using errcode = '22023', hint = 'booking_invalid', detail = 'shared_meet_link:invalid';
  end if;
  if s ? 'organizer_connection_id' then
    v_conn := nullif(s->>'organizer_connection_id', '')::uuid;
    if v_conn is not null and not exists (select 1 from app_private.google_connections c where c.id = v_conn and c.status <> 'revoked'
                                            and (c.kind = 'system' or c.owner_user_id = (select auth.uid()) or c.id = bs.organizer_connection_id)) then
      raise exception 'booking_invalid: unknown Google connection' using errcode = '22023', hint = 'booking_invalid', detail = 'organizer_connection_id:invalid';
    end if;
  else
    v_conn := bs.organizer_connection_id;
  end if;
  update public.booking_settings
     set mode = v_mode, default_advance_notice_min = v_notice, meeting_link_mode = v_link_mode,
         shared_meet_link = case when v_link_mode = 'shared' then v_link else v_link end, organizer_connection_id = v_conn
   where node_id = p_node;
end $$;
revoke all on function app_private.save_children_booking(uuid, jsonb) from public, anon, authenticated;

-- ================================================================= 3. public RPCs (anon + authenticated; the DB decides the audience)
create or replace function public.get_public_booking_page(p_ref text, p_host uuid default null, p_invite text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l record; n public.nodes; bs public.booking_settings; inv public.booking_invitations; v_tz text; v_head jsonb; v_booking jsonb; v_invitee jsonb;
begin
  select * into l from app_private.resolve_link('booking', p_ref) r limit 1;
  if not found then return null; end if;
  select * into n from public.nodes where id = l.node_id and type = 'booking' and deleted_at is null;
  if not found then return null; end if;
  select * into bs from public.booking_settings where node_id = n.id;
  if not found then return null; end if;
  select j.timezone into v_tz from public.projects j where j.id = n.project_id;
  v_head := jsonb_build_object('mode', bs.mode, 'node_id', n.id, 'name_en', n.name_en, 'name_ar', n.name_ar, 'slug', l.slug, 'audience', l.audience,
    'timezone', v_tz, 'default_advance_notice_min', bs.default_advance_notice_min, 'meeting_link_mode', bs.meeting_link_mode,
    'config', jsonb_build_object('page', coalesce(n.config->'page', '{}'::jsonb), 'max_bookings_per_email', n.config->'rules'->>'max_bookings_per_email'));
  if bs.mode = 'interview' then
    inv := app_private.invite_for(n.id, p_invite);
    -- a project manager previewing the page without a token sees the providers/slots (no invitee); visitors need the token
    if inv.id is null and l.audience <> 'pm' then return v_head || jsonb_build_object('status', 'invitation_required'); end if;
    if inv.id is not null then select jsonb_build_object('id', b.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'provider_id', s.provider_id, 'meet_link', b.meet_link,
             'provider_name_en', coalesce(ne.name_en, li.manual_fields->>'title_en'), 'provider_name_ar', coalesce(ne.name_ar, li.manual_fields->>'title_ar'))
      into v_booking
      from public.bookings b join public.booking_slots s on s.id = b.slot_id join public.booking_providers p on p.id = s.provider_id
      join public.list_items li on li.id = p.list_item_id left join public.network_experts ne on ne.id = li.network_expert_id
      where b.invitation_id = inv.id and b.status = 'confirmed' limit 1;
    end if;
    if v_booking is not null then return v_head || jsonb_build_object('status', 'already_booked', 'booking', v_booking); end if;
    if inv.id is not null then select jsonb_build_object('item_id', li.id,
             'company_en', coalesce(co.name_en, fr.answers->>'company_name', li.manual_fields->>'title_en'),
             'company_ar', coalesce(co.name_ar, fr.answers->>'company_name', li.manual_fields->>'title_ar'),
             'name', coalesce(fr.answers->>'founder_name', li.manual_fields->>'subtitle_en', ''),
             'email', coalesce(fr.answers->>'founder_email', li.manual_fields->>'email', ''))
      into v_invitee
      from public.list_items li left join public.companies co on co.id = li.company_id left join public.form_responses fr on fr.id = li.form_response_id
      where li.id = inv.booker_item_id;
    end if;
  end if;
  return v_head || jsonb_build_object('status', 'open', 'invitee', v_invitee, 'pm_preview', (bs.mode = 'interview' and inv.id is null),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id,
          'name_en', coalesce(ne.name_en, li.manual_fields->>'title_en'), 'name_ar', coalesce(ne.name_ar, li.manual_fields->>'title_ar'),
          'title_en', coalesce(ne.title_en, li.manual_fields->>'subtitle_en'), 'title_ar', coalesce(ne.title_ar, li.manual_fields->>'subtitle_ar'),
          'organization_en', coalesce(ne.company_en, li.manual_fields->>'organization_en'), 'organization_ar', coalesce(ne.company_ar, li.manual_fields->>'organization_ar'),
          'photo_path', coalesce(ne.photo_path, li.manual_fields->>'image_path'), 'bio_en', coalesce(ne.bio_en, li.manual_fields->>'bio_en'), 'bio_ar', coalesce(ne.bio_ar, li.manual_fields->>'bio_ar'),
          'advance_notice_min', coalesce(p.advance_notice_min, bs.default_advance_notice_min))
          order by p.sort_order nulls last, p.created_at)
        from public.booking_providers p
        join public.list_items li on li.id = p.list_item_id
        left join public.network_experts ne on ne.id = li.network_expert_id
        where p.node_id = n.id and p.is_active and (p_host is null or p.id = p_host)), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'provider_id', o.provider_id, 'starts_at', o.starts_at, 'ends_at', o.ends_at)
          order by o.starts_at)
        from (select * from public.v_booking_slots_open v where v.node_id = n.id and (p_host is null or v.provider_id = p_host)
              order by v.starts_at limit 500) o), '[]'::jsonb));
end $$;

create or replace function public.create_booking(p_ref text, p_slot uuid, p_booker jsonb, p_invite text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record; n public.nodes; bs public.booking_settings; sl public.booking_slots; pv public.booking_providers; inv public.booking_invitations;
  v_email text := lower(btrim(p_booker->>'email')); v_name text := nullif(btrim(coalesce(p_booker->>'name', '')), '');
  v_id uuid; v_notice int; v_company uuid := nullif(p_booker->>'company_id', '')::uuid; v_company_name text; v_item uuid; v_max int;
  v_lang text := case when p_booker->>'lang' = 'ar' then 'ar' else 'en' end; v_base text; v_token text; v_cancel text;
begin
  select * into l from app_private.resolve_link('booking', p_ref) r limit 1;
  if not found then raise exception 'booking_not_found: booking page not found' using errcode = 'P0002', hint = 'booking_not_found'; end if;
  select * into n from public.nodes where id = l.node_id and type = 'booking' and deleted_at is null;
  if not found then raise exception 'booking_not_found: booking page not found' using errcode = 'P0002', hint = 'booking_not_found'; end if;
  select * into bs from public.booking_settings where node_id = n.id;
  if not found then raise exception 'booking_not_found: booking page not found' using errcode = 'P0002', hint = 'booking_not_found'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'booking_invalid: e-mail' using errcode = '22023', hint = 'booking_invalid', detail = 'email:invalid';
  end if;
  if v_name is null then raise exception 'booking_invalid: name' using errcode = '22023', hint = 'booking_invalid', detail = 'name:required'; end if;
  if char_length(v_name) > 200 or char_length(coalesce(p_booker->>'company_name', '')) > 200 then
    raise exception 'booking_invalid: too long' using errcode = '22023', hint = 'booking_invalid', detail = 'name:too_long';
  end if;
  v_base := rtrim(btrim(coalesce(p_booker->>'base_url', '')), '/');
  if v_base !~ '^https?://[^/\s]+' then v_base := null; end if;

  select * into sl from public.booking_slots where id = p_slot and node_id = n.id for update;      -- serialises concurrent bookers
  if not found or sl.is_blocked then raise exception 'slot_unavailable: this slot is no longer available' using errcode = 'P0001', hint = 'slot_unavailable'; end if;
  select * into pv from public.booking_providers where id = sl.provider_id;
  v_notice := coalesce(pv.advance_notice_min, bs.default_advance_notice_min);
  if not pv.is_active then raise exception 'slot_unavailable: this slot is no longer available' using errcode = 'P0001', hint = 'slot_unavailable'; end if;
  if sl.starts_at < now() + make_interval(mins => v_notice) then
    raise exception 'slot_too_soon: this slot is inside the advance-notice window' using errcode = 'P0001', hint = 'slot_too_soon';
  end if;

  if bs.mode = 'interview' then
    inv := app_private.invite_for(n.id, p_invite);
    if inv.id is null then raise exception 'invitation_required: a valid invitation link is required' using errcode = '42501', hint = 'invitation_required'; end if;
    if exists (select 1 from public.bookings b where b.invitation_id = inv.id and b.status = 'confirmed') then
      raise exception 'already_booked: this invitation already has a booking' using errcode = 'P0001', hint = 'already_booked';
    end if;
    v_item := inv.booker_item_id;
    select li.company_id, coalesce(fr.answers->>'company_name', li.manual_fields->>'title_en') into v_company, v_company_name
      from public.list_items li left join public.form_responses fr on fr.id = li.form_response_id where li.id = v_item;
  else
    v_company_name := nullif(btrim(coalesce(p_booker->>'company_name', '')), '');
    v_max := nullif(n.config->'rules'->>'max_bookings_per_email', '')::int;
    if v_max is not null and v_max > 0 and (select count(*) from public.bookings b where b.node_id = n.id and b.status = 'confirmed' and b.booker_email = v_email) >= v_max then
      raise exception 'booking_limit_reached: the maximum number of bookings for this e-mail was reached' using errcode = 'P0001', hint = 'booking_limit_reached';
    end if;
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  begin
    insert into public.bookings (project_id, node_id, slot_id, booker_email, booker_name, booker_item_id, booker_company_id,
                                 booker_company_name, invitation_id, meet_link, calendar_owner_connection_id, cancel_token_hash, lang)
    values (n.project_id, n.id, sl.id, v_email, v_name, v_item, v_company,
            case when v_company is null then v_company_name end, inv.id,
            case when bs.meeting_link_mode = 'shared' then bs.shared_meet_link end, bs.organizer_connection_id,
            encode(extensions.digest(v_token, 'sha256'), 'hex'), v_lang)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'slot_unavailable: this slot was just taken' using errcode = 'P0001', hint = 'slot_unavailable';   -- concurrent loser: UNIQUE (slot_id) WHERE confirmed
  end;

  -- calendar/Meet: ONE job path (07 §2.2); the booking is never rolled back because Google fails (sync state = the job)
  insert into app_private.integration_jobs (kind, project_id, booking_id, connection_id, idempotency_key, payload)
  values ('calendar_create', n.project_id, v_id, bs.organizer_connection_id, 'cal:' || v_id || ':calendar_create', jsonb_build_object('lang', v_lang))
  on conflict (idempotency_key) do nothing;

  -- confirmation e-mail (01-12): always queued; the worker resolves the sender (07-3)
  v_cancel := case when v_base is not null then v_base || '/book/' || coalesce(l.slug, p_ref) || '?cancel=' || v_id || '&token=' || v_token end;
  perform app_private.booking_queue_email(v_id, 'booking_confirmation', v_cancel);

  return jsonb_build_object('booking_id', v_id, 'slot_id', sl.id, 'provider_id', sl.provider_id, 'starts_at', sl.starts_at, 'ends_at', sl.ends_at,
    'status', 'confirmed', 'meet_link', case when bs.meeting_link_mode = 'shared' then bs.shared_meet_link end, 'cancel_token', v_token, 'lang', v_lang);
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_token text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; bs public.booking_settings; allowed boolean := false;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if app_private.is_project_manager(b.project_id) then
    allowed := true;
  elsif p_token is not null then
    allowed := app_private.booking_token_ok(b, p_token);
  end if;
  if not allowed then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.status = 'cancelled' then return; end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()) where id = p_booking;
  select * into bs from public.booking_settings where node_id = b.node_id;
  insert into app_private.integration_jobs (kind, project_id, booking_id, connection_id, idempotency_key, payload)
  values ('calendar_cancel', b.project_id, b.id, coalesce(b.calendar_owner_connection_id, bs.organizer_connection_id),
          'cal:' || b.id || ':calendar_cancel:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), '{}'::jsonb)
  on conflict (idempotency_key) do nothing;
  perform app_private.booking_queue_email(b.id, 'booking_cancellation', null);
end $$;

-- ================================================================= 4. PM RPCs
-- bulk slot creation; a slot overlapping an existing one of the same provider is SKIPPED (GiST exclusion), never an error
create or replace function public.add_booking_slots(p_node uuid, p_provider uuid, p_slots jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.nodes; pv public.booking_providers; r jsonb; v_s timestamptz; v_e timestamptz; created int := 0; overlapped int := 0; invalid int := 0; ids uuid[] := '{}'; v_id uuid;
begin
  select * into n from public.nodes where id = p_node and type = 'booking' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pv from public.booking_providers where id = p_provider and node_id = p_node;
  if not found then raise exception 'provider not found' using errcode = 'P0002'; end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then raise exception 'slots must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_slots) > 500 then raise exception 'at most 500 slots per call' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_slots) loop
    begin
      v_s := (r->>'starts_at')::timestamptz; v_e := (r->>'ends_at')::timestamptz;
    exception when others then
      invalid := invalid + 1; continue;
    end;
    if v_s is null or v_e is null or v_e <= v_s or v_e - v_s > interval '24 hours' then invalid := invalid + 1; continue; end if;
    begin
      insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at) values (n.project_id, p_node, p_provider, v_s, v_e) returning id into v_id;
      created := created + 1; ids := ids || v_id;
    exception when exclusion_violation then
      overlapped := overlapped + 1;
    end;
  end loop;
  return jsonb_build_object('created', created, 'overlapped', overlapped, 'invalid', invalid, 'ids', to_jsonb(ids));
end $$;
revoke all on function public.add_booking_slots(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_booking_slots(uuid, uuid, jsonb) to authenticated;

-- move a confirmed booking to another free slot of the same node: calendar_update job (same event, 07 §2.2) + confirmation e-mail
create or replace function public.reschedule_booking(p_booking uuid, p_slot uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; sl public.booking_slots; pv public.booking_providers; bs public.booking_settings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not app_private.is_project_manager(b.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.status <> 'confirmed' then raise exception 'booking_not_confirmed: only a confirmed booking can be rescheduled' using errcode = 'P0001', hint = 'booking_not_confirmed'; end if;
  select * into sl from public.booking_slots where id = p_slot and node_id = b.node_id for update;
  if not found or sl.is_blocked then raise exception 'slot_unavailable: this slot is no longer available' using errcode = 'P0001', hint = 'slot_unavailable'; end if;
  if sl.id = b.slot_id then return jsonb_build_object('booking_id', b.id, 'slot_id', b.slot_id, 'changed', false); end if;
  select * into pv from public.booking_providers where id = sl.provider_id;
  if not pv.is_active then raise exception 'slot_unavailable: this slot is no longer available' using errcode = 'P0001', hint = 'slot_unavailable'; end if;
  begin
    update public.bookings set slot_id = sl.id where id = p_booking;
  exception when unique_violation then
    raise exception 'slot_unavailable: this slot is already booked' using errcode = 'P0001', hint = 'slot_unavailable';
  end;
  select * into bs from public.booking_settings where node_id = b.node_id;
  insert into app_private.integration_jobs (kind, project_id, booking_id, connection_id, idempotency_key, payload)
  values ('calendar_update', b.project_id, b.id, coalesce(b.calendar_owner_connection_id, bs.organizer_connection_id),
          'cal:' || b.id || ':calendar_update:' || sl.id, jsonb_build_object('slot_id', sl.id))
  on conflict (idempotency_key) do nothing;
  perform app_private.booking_queue_email(b.id, 'booking_confirmation', null);
  return jsonb_build_object('booking_id', b.id, 'slot_id', sl.id, 'provider_id', sl.provider_id, 'starts_at', sl.starts_at, 'ends_at', sl.ends_at, 'changed', true);
end $$;
revoke all on function public.reschedule_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reschedule_booking(uuid, uuid) to authenticated;

-- undo of a cancellation (PM) while the slot is still free: back to confirmed, calendar re-created, confirmation re-sent
create or replace function public.restore_booking(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; sl public.booking_slots; bs public.booking_settings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not app_private.is_project_manager(b.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.status = 'confirmed' then return; end if;
  select * into sl from public.booking_slots where id = b.slot_id for update;
  if sl.is_blocked then raise exception 'slot_unavailable: the slot is blocked' using errcode = 'P0001', hint = 'slot_unavailable'; end if;
  begin
    update public.bookings set status = 'confirmed', cancelled_at = null, cancelled_by = null, cancel_reason = null where id = p_booking;
  exception when unique_violation then
    raise exception 'slot_unavailable: the slot was booked by someone else' using errcode = 'P0001', hint = 'slot_unavailable';
  end;
  select * into bs from public.booking_settings where node_id = b.node_id;
  if not exists (select 1 from app_private.integration_jobs j where j.booking_id = b.id and j.kind = 'calendar_create' and j.status in ('pending', 'processing')) then
    insert into app_private.integration_jobs (kind, project_id, booking_id, connection_id, idempotency_key, payload)
    values ('calendar_create', b.project_id, b.id, coalesce(b.calendar_owner_connection_id, bs.organizer_connection_id),
            'cal:' || b.id || ':calendar_create:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), '{"origin":"restore"}'::jsonb)
    on conflict (idempotency_key) do nothing;
  end if;
  perform app_private.booking_queue_email(b.id, 'booking_confirmation', null);
end $$;
revoke all on function public.restore_booking(uuid) from public, anon, authenticated;
grant execute on function public.restore_booking(uuid) to authenticated;

-- failed / dead calendar jobs of a booking are queued again (07 §2.2: a missing link is visible and retryable)
create or replace function public.retry_calendar_job(p_booking uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; k int;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or not app_private.is_project_manager(b.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  with u as (
    update app_private.integration_jobs set status = 'pending', next_attempt_at = now(), locked_until = null, error = null
    where booking_id = p_booking and kind in ('calendar_create', 'calendar_update', 'calendar_cancel') and status in ('failed', 'dead')
    returning 1)
  select count(*) into k from u;
  return k;
end $$;
revoke all on function public.retry_calendar_job(uuid) from public, anon, authenticated;
grant execute on function public.retry_calendar_job(uuid) to authenticated;

-- worker side (service role only): a claimed job goes back to `pending` without counting a failure (no Google connection yet)
create or replace function public.release_integration_job(p_id uuid, p_note text default null, p_delay interval default interval '15 minutes') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  update app_private.integration_jobs set status = 'pending', locked_until = null, attempts = greatest(attempts - 1, 0),
         next_attempt_at = now() + coalesce(p_delay, interval '15 minutes'), error = left(p_note, 500)
   where id = p_id and status = 'processing';
end $$;
revoke all on function public.release_integration_job(uuid, text, interval) from public, anon, authenticated;

-- ONE PM call for the admin screens: calendar jobs, outbox rows, invitations, usable Google connections, names for the preview
create or replace function public.get_booking_extras(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n public.nodes; bs public.booking_settings;
begin
  select * into n from public.nodes where id = p_node and type = 'booking' and deleted_at is null;
  if not found or not app_private.is_project_manager(n.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into bs from public.booking_settings where node_id = p_node;
  return jsonb_build_object(
    'settings', case when bs.node_id is null then null else jsonb_build_object('mode', bs.mode, 'default_advance_notice_min', bs.default_advance_notice_min,
                  'meeting_link_mode', bs.meeting_link_mode, 'shared_meet_link', bs.shared_meet_link, 'organizer_connection_id', bs.organizer_connection_id) end,
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'booking_id', j.booking_id, 'kind', j.kind, 'status', j.status, 'attempts', j.attempts,
                   'error', j.error, 'next_attempt_at', j.next_attempt_at, 'connection_id', j.connection_id, 'created_at', j.created_at, 'updated_at', j.updated_at,
                   'result', j.result) order by j.created_at)
                 from app_private.integration_jobs j where j.project_id = n.project_id and j.booking_id in (select b.id from public.bookings b where b.node_id = p_node)), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'booking_id', o.booking_id, 'email_key', o.email_key, 'status', o.status,
                   'recipient', o.recipient_email, 'created_at', o.created_at, 'sent_at', o.sent_at, 'error_message', o.error_message) order by o.created_at)
                 from app_private.email_outbox o where o.node_id = p_node and o.booking_id is not null), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'booker_item_id', i.booker_item_id, 'expires_at', i.expires_at, 'revoked_at', i.revoked_at,
                   'created_at', i.created_at, 'used', exists (select 1 from public.bookings b where b.invitation_id = i.id and b.status = 'confirmed'),
                   'company_en', coalesce(co.name_en, fr.answers->>'company_name', li.manual_fields->>'title_en'),
                   'company_ar', coalesce(co.name_ar, fr.answers->>'company_name', li.manual_fields->>'title_ar'),
                   'email', coalesce(fr.answers->>'founder_email', li.manual_fields->>'email')) order by i.created_at desc)
                 from public.booking_invitations i join public.list_items li on li.id = i.booker_item_id
                 left join public.companies co on co.id = li.company_id left join public.form_responses fr on fr.id = li.form_response_id
                 where i.node_id = p_node), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'kind', c.kind, 'status', c.status, 'own', c.owner_user_id = (select auth.uid())) order by c.kind desc, c.email)
                 from app_private.google_connections c
                 where c.status <> 'revoked' and (c.kind = 'system' or c.owner_user_id = (select auth.uid()) or c.id = bs.organizer_connection_id)), '[]'::jsonb),
    'pm_name', coalesce((select pr.full_name from public.profiles pr where pr.id = (select auth.uid())), ''),
    'program_name', (select jsonb_build_object('en', g.name_en, 'ar', g.name_ar) from public.projects j join public.programs g on g.id = j.program_id where j.id = n.project_id),
    'project_name', (select jsonb_build_object('en', j.name_en, 'ar', j.name_ar) from public.projects j where j.id = n.project_id),
    'timezone', (select j.timezone from public.projects j where j.id = n.project_id));
end $$;
revoke all on function public.get_booking_extras(uuid) from public, anon, authenticated;
grant execute on function public.get_booking_extras(uuid) to authenticated;

-- ================================================================= grants (04 §5.9: the public trio stays anon-callable)
revoke all on function public.get_public_booking_page(text, uuid, text), public.create_booking(text, uuid, jsonb, text), public.cancel_booking(uuid, text) from public;
grant execute on function public.get_public_booking_page(text, uuid, text), public.create_booking(text, uuid, jsonb, text), public.cancel_booking(uuid, text) to anon, authenticated;

-- ================================================================= self-check
do $$
begin
  if to_regprocedure('public.add_booking_slots(uuid,uuid,jsonb)') is null or to_regprocedure('public.reschedule_booking(uuid,uuid)') is null
     or to_regprocedure('public.restore_booking(uuid)') is null or to_regprocedure('public.retry_calendar_job(uuid)') is null
     or to_regprocedure('public.get_booking_extras(uuid)') is null or to_regprocedure('app_private.save_children_booking(uuid,jsonb)') is null
     or to_regprocedure('app_private.booking_queue_email(uuid,text,text)') is null then
    raise exception 'm34: a function is missing';
  end if;
  if (select save_children_fn from public.node_types where key = 'booking') is distinct from 'save_children_booking' then raise exception 'm34: node_types.booking.save_children_fn'; end if;
  if has_function_privilege('anon', 'public.add_booking_slots(uuid,uuid,jsonb)', 'EXECUTE') or has_function_privilege('anon', 'public.get_booking_extras(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.restore_booking(uuid)', 'EXECUTE') or has_function_privilege('anon', 'app_private.booking_queue_email(uuid,text,text)', 'EXECUTE') then
    raise exception 'm34: anon must not reach the PM RPCs';
  end if;
  if not has_function_privilege('anon', 'public.create_booking(text,uuid,jsonb,text)', 'EXECUTE') then raise exception 'm34: anon must execute create_booking'; end if;
  if app_private.render_email_template('x {{cancel_link}} {{meet_link}}', '{"cancel_link":"https://a.b/c?x=1&y=2","meet_link":"later"}'::jsonb, true)
     <> 'x <a href="https://a.b/c?x=1&amp;y=2">https://a.b/c?x=1&amp;y=2</a> later' then
    raise exception 'm34: renderer self-check failed';
  end if;
  if app_private.render_email_template(E'Hi {{first_name}},\n<b>x</b>', '{"first_name":"A<b>"}'::jsonb, true) <> E'Hi A&lt;b&gt;,\n<b>x</b>' then
    raise exception 'm34: renderer regression (m33 semantics)';
  end if;
  if (app_private.booking_default_template('booking_confirmation', 'ar')->>'subject') is null or (app_private.booking_default_template('booking_cancellation', 'en')->>'body') is null then
    raise exception 'm34: default templates';
  end if;
  raise notice 'm34 ok';
end $$;

commit;
