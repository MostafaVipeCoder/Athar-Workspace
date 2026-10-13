-- m40_withdrawn.sql  (decision 17.1 of 08-decisions-log: WITHDRAWN replaces the ambiguous "Hide"; the PM marks, nothing is automatic)
-- Re-runnable (create or replace / if not exists / idempotent patches). Local DB only. No business data is altered.
--
-- THE MODEL (one fact, one place, everything else DERIVES it):
--   * A person / company that takes part in the program (a form-response applicant or a canonical company) is withdrawn when the
--     PROJECT-LEVEL participant row has status = 'withdrawn'. That row already exists (02-7), already drives the founder page (03-6,
--     m39) and already decides certificate eligibility (attended only). A withdrawal made on ANY item of that identity (the Selection
--     board, any list, the Participants page) writes THAT row, so the person leaves the whole program at once: every stage, every list
--     fed by a stage, Distribution, Booking, Agenda tabs, founder blocks. A never-enrolled applicant gets a row created
--     only to record the withdrawal (restore_status = 'not_enrolled'): reinstating removes it again.
--   * Anything else in a list (an expert of the Athar Network, a manual item) has no participant row: the flag lives on the LIST ITEM
--     (list_items.withdrawn_at / _by / _reason), so it leaves the lists fed by that list and every consumer of that list.
--   * app_private.is_withdrawn(project, form_response, company, item_flag) is THE predicate (flag OR participant withdrawn). Every
--     resolver, public RPC, founder RPC and PM RPC below calls it; nothing re-implements it.
--   * The reason (PM-internal, optional) is not on `participants` (a founder can read his own row): it lives in the PM-only side table
--     participant_withdrawals together with the status to restore on reinstating (accepted / attended / not_enrolled).
--   * The legacy "hidden" flag (list_items.excluded, 2 migrated experts) stays as it is, shown as "Hidden (legacy)" by the client with
--     two ways out: convert to withdrawn (set_item_withdrawn clears it) or restore (exclude_item false). The client no longer creates it.
--
-- 1. schema: list_items.withdrawn_at/_by/_reason; participant_withdrawals (PM-only).   2. helpers: is_withdrawn, item_is_withdrawn,
--    provider_is_withdrawn, withdrawal_detail, apply_withdrawal.   3. revision bumps for every consumer when the fact changes.
-- 4. RPCs: set_item_withdrawn, withdraw_participant, set_participant_status (kept, delegates).   5. consumers patched IN PLACE on the
--    CURRENT definitions (the m37 technique, so other migrations' edits survive): resolve_list_rows, list_public_payload, list_participants,
--    enroll_accepted, detach_item_to_manual, invite_for, get_public_booking_page, create_booking, create_invitations, send_selection_emails,
--    enqueue_email, get_booking_extras, distribution_payload, set_distribution_session_companies, replace_distribution_sessions,
--    my_meetings, get_public_tab, get_founder_block.
set search_path = public, extensions;

begin;

-- ================================================================= 1. schema
alter table public.list_items
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references auth.users(id) on delete set null,
  add column if not exists withdrawn_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'list_items_withdrawn_chk' and conrelid = 'public.list_items'::regclass) then
    alter table public.list_items add constraint list_items_withdrawn_chk
      check ((withdrawn_at is not null or (withdrawn_by is null and withdrawn_reason is null)) and (withdrawn_reason is null or char_length(withdrawn_reason) <= 1000));
  end if;
end $$;

-- PM-internal metadata of a participant's withdrawal. Readers always gate on participants.status = 'withdrawn' (a stale row is harmless).
create table if not exists public.participant_withdrawals (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  reason         text check (char_length(reason) <= 1000),
  restore_status text not null default 'accepted' check (restore_status in ('accepted', 'attended', 'not_enrolled')),
  withdrawn_by   uuid references auth.users(id) on delete set null,
  withdrawn_at   timestamptz not null default now()
);
create index if not exists participant_withdrawals_project_idx on public.participant_withdrawals (project_id);
alter table public.participant_withdrawals enable row level security;
alter table public.participant_withdrawals force row level security;
drop policy if exists participant_withdrawals_select_pm on public.participant_withdrawals;
create policy participant_withdrawals_select_pm on public.participant_withdrawals for select to authenticated
  using ((select app_private.is_project_manager(project_id)));
revoke all on public.participant_withdrawals from public, anon, authenticated;
grant select on public.participant_withdrawals to authenticated;

-- ================================================================= 2. the predicate and its helpers (no API grant; callers are SECURITY DEFINER)
-- THE predicate: the item flag, or the participant row of the same identity in the same project is withdrawn.
create or replace function app_private.is_withdrawn(p_project uuid, p_form_response uuid, p_company uuid, p_withdrawn_at timestamptz default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_withdrawn_at is not null
      or (p_project is not null and (p_form_response is not null or p_company is not null) and exists (
            select 1 from public.participants pa
             where pa.project_id = p_project and pa.status = 'withdrawn'
               and ((p_form_response is not null and pa.form_response_id = p_form_response)
                 or (p_company is not null and pa.company_id = p_company))))
$$;
revoke all on function app_private.is_withdrawn(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function app_private.item_is_withdrawn(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at)
                     from public.list_items li where li.id = p_item), false)
$$;
revoke all on function app_private.item_is_withdrawn(uuid) from public, anon, authenticated;

create or replace function app_private.provider_is_withdrawn(p_provider uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at)
                     from public.booking_providers p join public.list_items li on li.id = p.list_item_id where p.id = p_provider), false)
$$;
revoke all on function app_private.provider_is_withdrawn(uuid) from public, anon, authenticated;

-- When and why (PM views only): the item flag's own values, else the participant row + its side row.
create or replace function app_private.withdrawal_detail(p_project uuid, p_form_response uuid, p_company uuid, p_at timestamptz, p_reason text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'at', coalesce(p_at, x.at),
           'reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), x.reason),
           'source', case when p_at is not null then 'item' else 'participant' end)
    from (select 1) o
    left join lateral (
      select coalesce(w.withdrawn_at, pa.status_changed_at) as at, w.reason
        from public.participants pa left join public.participant_withdrawals w on w.participant_id = pa.id
       where p_at is null and pa.project_id = p_project and pa.status = 'withdrawn'
         and ((p_form_response is not null and pa.form_response_id = p_form_response) or (p_company is not null and pa.company_id = p_company))
       limit 1) x on true
$$;
revoke all on function app_private.withdrawal_detail(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;

-- Withdraw / reinstate ONE participant row (the callers did the PM check). Withdrawing remembers the status to come back to;
-- reinstating a row that exists only to record the withdrawal of a never-enrolled applicant removes it again.
create or replace function app_private.apply_withdrawal(p_participant uuid, p_withdrawn boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.participants; v_restore text;
begin
  select * into v from public.participants where id = p_participant for update;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if p_withdrawn then
    if v.status <> 'withdrawn' then
      update public.participants set status = 'withdrawn' where id = v.id;
      insert into public.participant_withdrawals (participant_id, project_id, reason, restore_status, withdrawn_by)
      values (v.id, v.project_id, p_reason, v.status, (select auth.uid()))
      on conflict (participant_id) do update set reason = excluded.reason, restore_status = excluded.restore_status,
        withdrawn_by = excluded.withdrawn_by, withdrawn_at = now();
    else
      insert into public.participant_withdrawals (participant_id, project_id, reason, withdrawn_by)
      values (v.id, v.project_id, p_reason, (select auth.uid()))
      on conflict (participant_id) do update set reason = coalesce(excluded.reason, public.participant_withdrawals.reason);
    end if;
    return jsonb_build_object('participant_id', v.id, 'status', 'withdrawn', 'removed', false);
  end if;
  if v.status <> 'withdrawn' then
    return jsonb_build_object('participant_id', v.id, 'status', v.status, 'removed', false);
  end if;
  select w.restore_status into v_restore from public.participant_withdrawals w where w.participant_id = v.id;
  v_restore := coalesce(v_restore, 'accepted');
  if v_restore = 'not_enrolled' and not exists (select 1 from public.certificates c where c.participant_id = v.id) then
    delete from public.participants where id = v.id;        -- the side row goes with it (on delete cascade)
    return jsonb_build_object('participant_id', v.id, 'status', null, 'removed', true);
  end if;
  if v_restore = 'not_enrolled' then v_restore := 'accepted'; end if;
  update public.participants set status = v_restore where id = v.id;
  delete from public.participant_withdrawals where participant_id = v.id;
  return jsonb_build_object('participant_id', v.id, 'status', v_restore, 'removed', false);
end $$;
revoke all on function app_private.apply_withdrawal(uuid, boolean, text) from public, anon, authenticated;

-- ================================================================= 3. consumers learn about a change through the node revisions
-- A withdrawal changes what every consumer of a list resolves; bump the revision of every node whose output depends on it.
create or replace function app_private.bump_withdrawal_revs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  if tg_op = 'DELETE' then v_project := old.project_id; else v_project := new.project_id; end if;
  insert into public.node_revisions (node_id, project_id)
  select n.id, n.project_id from public.nodes n
   where n.project_id = v_project and n.deleted_at is null
     and n.type in ('list', 'selection', 'distribution', 'booking', 'agenda', 'view_host', 'certificates')
  on conflict (node_id) do update set rev = public.node_revisions.rev + 1, updated_at = now();
  return null;
end $$;
revoke all on function app_private.bump_withdrawal_revs() from public, anon, authenticated;
drop trigger if exists participants_rev_wd_ins on public.participants;
create trigger participants_rev_wd_ins after insert on public.participants for each row
  when (new.status = 'withdrawn') execute function app_private.bump_withdrawal_revs();
drop trigger if exists participants_rev_wd_upd on public.participants;
create trigger participants_rev_wd_upd after update of status on public.participants for each row
  when ((old.status = 'withdrawn') is distinct from (new.status = 'withdrawn')) execute function app_private.bump_withdrawal_revs();
drop trigger if exists participants_rev_wd_del on public.participants;
create trigger participants_rev_wd_del after delete on public.participants for each row
  when (old.status = 'withdrawn') execute function app_private.bump_withdrawal_revs();
drop trigger if exists list_items_rev_wd on public.list_items;
create trigger list_items_rev_wd after update of withdrawn_at on public.list_items for each row
  when (old.withdrawn_at is distinct from new.withdrawn_at) execute function app_private.bump_withdrawal_revs();

-- ================================================================= 4. the PM actions
-- Mark / reinstate ONE list item (a materialised row). Identity items write the participant row; others write the item flag.
create or replace function public.set_item_withdrawn(p_item uuid, p_withdrawn boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.list_items; n public.nodes; v_flag boolean := coalesce(p_withdrawn, true); v_pid uuid; v_res jsonb := '{}'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v := app_private.item_for_write(p_item);                -- PM check + row lock
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'withdrawn_invalid: the reason is too long' using errcode = '22023', hint = 'withdrawn_invalid', detail = 'reason:too_long';
  end if;
  select * into n from public.nodes where id = v.list_node_id;
  if v.company_id is not null or v.form_response_id is not null then
    select x.id into v_pid from public.participants x
     where x.project_id = v.project_id
       and ((v.company_id is not null and x.company_id = v.company_id) or (v.company_id is null and x.form_response_id = v.form_response_id))
     order by (x.status = 'withdrawn') desc limit 1;
    if v_flag then
      if v_pid is null then
        insert into public.participants (project_id, company_id, form_response_id, source, source_node_id, status, created_by)
        values (v.project_id, v.company_id, case when v.company_id is null then v.form_response_id end,
                case when n.type = 'selection' then 'selection' else 'manual' end, case when n.type = 'selection' then n.id end,
                'withdrawn', (select auth.uid()))
        returning id into v_pid;
        insert into public.participant_withdrawals (participant_id, project_id, reason, restore_status, withdrawn_by)
        values (v_pid, v.project_id, v_reason, 'not_enrolled', (select auth.uid()));
        v_res := jsonb_build_object('participant_id', v_pid, 'status', 'withdrawn', 'removed', false);
      else
        v_res := app_private.apply_withdrawal(v_pid, true, v_reason);
      end if;
      update public.list_items set excluded = false where id = p_item and excluded;     -- a legacy "hidden" flag is converted
    elsif v_pid is not null then
      v_res := app_private.apply_withdrawal(v_pid, false, null);
    end if;
  elsif v_flag then
    update public.list_items set withdrawn_at = coalesce(withdrawn_at, now()), withdrawn_by = coalesce(withdrawn_by, (select auth.uid())),
           withdrawn_reason = coalesce(v_reason, withdrawn_reason), excluded = false where id = p_item;
  else
    update public.list_items set withdrawn_at = null, withdrawn_by = null, withdrawn_reason = null where id = p_item;
  end if;
  return v_res || jsonb_build_object('item_id', p_item, 'withdrawn', app_private.item_is_withdrawn(p_item));
end $$;
revoke all on function public.set_item_withdrawn(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_item_withdrawn(uuid, boolean, text) to authenticated;

-- Mark / reinstate ONE participant (the Participants page).
create or replace function public.withdraw_participant(p_participant uuid, p_withdrawn boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.participants; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from public.participants where id = p_participant;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'withdrawn_invalid: the reason is too long' using errcode = '22023', hint = 'withdrawn_invalid', detail = 'reason:too_long';
  end if;
  return app_private.apply_withdrawal(p_participant, coalesce(p_withdrawn, true), v_reason);
end $$;
revoke all on function public.withdraw_participant(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.withdraw_participant(uuid, boolean, text) to authenticated;

-- The m06c status RPC stays (same signature): 'withdrawn' now goes through the one withdrawal path.
create or replace function public.set_participant_status(p_participant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.participants;
begin
  select * into v from public.participants where id = p_participant for update;
  if not found or not app_private.is_project_manager(v.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('accepted','attended','withdrawn') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_status = 'withdrawn' then
    perform app_private.apply_withdrawal(p_participant, true, null);
  elsif v.status = 'withdrawn' then
    update public.participants set status = p_status where id = p_participant;
    delete from public.participant_withdrawals where participant_id = p_participant;
  else
    update public.participants set status = p_status where id = p_participant;
  end if;
end $$;

-- ================================================================= 5. consumers: patched IN PLACE on the current definitions
-- pg_temp helper: replace an anchor in the CURRENT definition of a function (exactly `p_expect` hits), skip when already applied.
create or replace function pg_temp.m40_patch(p_fn regprocedure, p_old text, p_new text, p_expect int default 1) returns text
language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  if position(p_new in v_def) > 0 then return 'already  ' || p_fn::text; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_expect then raise exception 'm40_patch: % anchor found % times (expected %): %', p_fn, v_n, p_expect, left(p_old, 90); end if;
  execute replace(v_def, p_old, p_new);
  return 'patched   ' || p_fn::text;
end $$;

-- same, for several anchors that must change TOGETHER (e.g. the branches of a UNION): p_pairs = [old1, new1, old2, new2, ...]
create or replace function pg_temp.m40_patch_set(p_fn regprocedure, p_pairs text[]) returns text
language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int; i int; v_changed boolean := false;
begin
  for i in 1 .. cardinality(p_pairs) / 2 loop
    if position(p_pairs[2 * i] in v_def) > 0 then continue; end if;                       -- this anchor is already patched
    v_n := (length(v_def) - length(replace(v_def, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]);
    if v_n <> 1 then raise exception 'm40_patch_set: % anchor found % times (expected 1): %', p_fn, v_n, left(p_pairs[2 * i - 1], 90); end if;
    v_def := replace(v_def, p_pairs[2 * i - 1], p_pairs[2 * i]);
    v_changed := true;
  end loop;
  if not v_changed then return 'already  ' || p_fn::text; end if;
  execute v_def;
  return 'patched   ' || p_fn::text;
end $$;


-- ---- 5.1 the list resolver (every list, selection stage, public tab, founder block and input port goes through it); ONE replacement.
--   filter { include_withdrawn: true } (PM managers) keeps withdrawn rows, flagged `withdrawn` + `withdrawal {at, reason, source}`; the default
--   leaves them out. In a CHAINED list (rows:list-item feed) an upstream item carrying the ITEM flag never flows on; an upstream item that is
--   withdrawn through the PARTICIPANT row flows on only with include_withdrawn, so the PM still sees the company, with its chip, downstream.
select pg_temp.m40_patch_set('app_private.resolve_list_rows(uuid,jsonb,integer,jsonb,boolean)'::regprocedure, array[
$o$coalesce((p_filter->>'include_excluded')::boolean, false) as inc_excl,$o$,
$n$coalesce((p_filter->>'include_excluded')::boolean, false) as inc_excl,
           coalesce((p_filter->>'include_withdrawn')::boolean, false) as inc_wd,
           (select n.project_id from public.nodes n where n.id = p_list) as pid,$n$,
$o$join public.list_items u on u.list_node_id = e.from_node_id and u.source_kind is not null and not u.excluded$o$,
$n$join public.list_items u on u.list_node_id = e.from_node_id and u.source_kind is not null and not u.excluded
                                  and u.withdrawn_at is null
                                  and (coalesce((p_filter->>'include_withdrawn')::boolean, false)
                                       or not app_private.is_withdrawn(u.project_id, u.form_response_id, u.company_id, null))$n$,
$o$else 'ok' end as state$o$,
$n$else 'ok' end as state,
           case when s.kind = 'form_response' then s.sid end as wd_fr, case when s.kind = 'company' then s.sid end as wd_co,
           li.withdrawn_at as wd_at, li.withdrawn_reason as wd_reason$n$,
$o$null::jsonb, null, null, 'ok'$o$,
$n$null::jsonb, null, null, 'ok', null::uuid, null::uuid, li.withdrawn_at, li.withdrawn_reason$n$,
$o$null::jsonb, null, null, 'missing'$o$,
$n$null::jsonb, null, null, 'missing', null::uuid, null::uuid, li.withdrawn_at, li.withdrawn_reason$n$,
$o$  final as (
    select j.*, coalesce(j.sort_order, 2147483647) as sk, coalesce(j.item_id, j.sid) as k
    from joined j, params
    where (params.inc_excl or not coalesce(j.excluded, false))
      and (params.statuses is null or j.status = any (params.statuses))
  )$o$,
$n$  flagged as (
    select j.*, app_private.is_withdrawn(params.pid, j.wd_fr, j.wd_co, j.wd_at) as withdrawn
    from joined j, params
    where (params.inc_excl or not coalesce(j.excluded, false))
      and (params.statuses is null or j.status = any (params.statuses))
  ),
  final as (
    select j.*, coalesce(j.sort_order, 2147483647) as sk, coalesce(j.item_id, j.sid) as k
    from flagged j, params
    where params.inc_wd or not j.withdrawn
  )$n$,
$o$'status', f.status, 'sort_order', f.sort_order, 'excluded', coalesce(f.excluded, false),$o$,
$n$'status', f.status, 'sort_order', f.sort_order, 'excluded', coalesce(f.excluded, false),
      'withdrawn', f.withdrawn,
      'withdrawal', case when f.withdrawn then app_private.withdrawal_detail(params.pid, f.wd_fr, f.wd_co, f.wd_at, f.wd_reason) end,$n$
]);

-- ---- 5.2 public / platform list payload: no PM-only keys
select pg_temp.m40_patch('app_private.list_public_payload(public.nodes,jsonb,jsonb)'::regprocedure,
$o$- 'excluded')$o$, $n$- 'excluded' - 'withdrawn' - 'withdrawal')$n$);

-- ---- 5.3 participants: enrolment never re-enrols a withdrawn identity; the PM list carries the reason
select pg_temp.m40_patch('public.enroll_accepted(uuid,uuid)'::regprocedure,
$o$where li.list_node_id = p_selection_node and not li.excluded$o$,
$n$where li.list_node_id = p_selection_node and not li.excluded
      and not app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at)$n$);
select pg_temp.m40_patch('public.list_participants(uuid,text)'::regprocedure,
$o$'created_at', pa.created_at, 'status_changed_at', pa.status_changed_at,$o$,
$n$'created_at', pa.created_at, 'status_changed_at', pa.status_changed_at,
         'withdrawal_reason', (select w.reason from public.participant_withdrawals w where w.participant_id = pa.id and pa.status = 'withdrawn'),$n$);
select pg_temp.m40_patch('public.list_participants(uuid,text)'::regprocedure,
$o$join public.list_items li on li.list_node_id = n.id and not li.excluded$o$,
$n$join public.list_items li on li.list_node_id = n.id and not li.excluded
                              and not app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at)$n$);

-- ---- 5.4 detaching a withdrawn item to a manual one keeps it withdrawn (the manual row has no identity to derive it from)
select pg_temp.m40_patch('public.detach_item_to_manual(uuid)'::regprocedure,
$o$manual_fields = m where id = p_item;$o$,
$n$manual_fields = m,
         withdrawn_at = case when app_private.is_withdrawn(v.project_id, v.form_response_id, v.company_id, v.withdrawn_at) then coalesce(v.withdrawn_at, now()) end,
         withdrawn_by = case when app_private.is_withdrawn(v.project_id, v.form_response_id, v.company_id, v.withdrawn_at) then coalesce(v.withdrawn_by, (select auth.uid())) end,
         withdrawn_reason = case when app_private.is_withdrawn(v.project_id, v.form_response_id, v.company_id, v.withdrawn_at)
                                 then coalesce(v.withdrawn_reason, app_private.withdrawal_detail(v.project_id, v.form_response_id, v.company_id, v.withdrawn_at, v.withdrawn_reason)->>'reason') end
   where id = p_item;$n$);

-- ---- 5.5 Booking: a withdrawn invitee's link stops working; a withdrawn mentor's page, slots and bookings disappear
select pg_temp.m40_patch('app_private.invite_for(uuid,text)'::regprocedure,
$o$and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())$o$,
$n$and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
    and not app_private.item_is_withdrawn(i.booker_item_id)$n$);
select pg_temp.m40_patch('public.get_public_booking_page(text,uuid,text)'::regprocedure,
$o$where p.node_id = n.id and p.is_active and (p_host is null or p.id = p_host)), '[]'::jsonb),$o$,
$n$where p.node_id = n.id and p.is_active and (p_host is null or p.id = p_host)
          and not app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at)), '[]'::jsonb),$n$);
select pg_temp.m40_patch('public.get_public_booking_page(text,uuid,text)'::regprocedure,
$o$from (select * from public.v_booking_slots_open v where v.node_id = n.id and (p_host is null or v.provider_id = p_host)$o$,
$n$from (select * from public.v_booking_slots_open v where v.node_id = n.id and (p_host is null or v.provider_id = p_host)
                 and not app_private.provider_is_withdrawn(v.provider_id)$n$);
select pg_temp.m40_patch('public.create_booking(text,uuid,jsonb,text)'::regprocedure,
$o$if not pv.is_active then$o$, $n$if not pv.is_active or app_private.provider_is_withdrawn(pv.id) then$n$);
select pg_temp.m40_patch('public.create_invitations(uuid,uuid[])'::regprocedure,
$o$update public.booking_invitations set revoked_at = now() where node_id = p_node and booker_item_id = it and revoked_at is null;$o$,
$n$if app_private.item_is_withdrawn(it) then
      raise exception 'item_withdrawn: item % is withdrawn', it using errcode = '22023', hint = 'item_withdrawn';
    end if;
    update public.booking_invitations set revoked_at = now() where node_id = p_node and booker_item_id = it and revoked_at is null;$n$);
select pg_temp.m40_patch('public.get_booking_extras(uuid)'::regprocedure,
$o$'email', coalesce(fr.answers->>'founder_email', li.manual_fields->>'email')) order by i.created_at desc)$o$,
$n$'email', coalesce(fr.answers->>'founder_email', li.manual_fields->>'email'),
                   'withdrawn', app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at)) order by i.created_at desc)$n$);
select pg_temp.m40_patch('public.get_booking_extras(uuid)'::regprocedure,
$o$'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id,$o$,
$n$'withdrawn_items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id,
                   'name_en', coalesce(ne.name_en, co.name_en, fr.answers->>'company_name', x.manual_fields->>'title_en'),
                   'name_ar', coalesce(ne.name_ar, co.name_ar, fr.answers->>'company_name', x.manual_fields->>'title_ar')))
                 from (
                   select p.list_item_id as id from public.booking_providers p where p.node_id = p_node
                   union select b.booker_item_id from public.bookings b where b.node_id = p_node and b.booker_item_id is not null
                   union select i.booker_item_id from public.booking_invitations i where i.node_id = p_node) y
                 join public.list_items x on x.id = y.id
                 left join public.network_experts ne on ne.id = x.network_expert_id
                 left join public.companies co on co.id = x.company_id
                 left join public.form_responses fr on fr.id = x.form_response_id
                where app_private.is_withdrawn(x.project_id, x.form_response_id, x.company_id, x.withdrawn_at)), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id,$n$);

-- ---- 5.6 Selection e-mails never go to a withdrawn applicant
select pg_temp.m40_patch('public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)'::regprocedure,
$o$if not found then status := 'item_not_found'; return next; continue; end if;$o$,
$n$if not found then status := 'item_not_found'; return next; continue; end if;
    if app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at) then status := 'withdrawn'; return next; continue; end if;$n$);
select pg_temp.m40_patch('public.enqueue_email(uuid,text,uuid[],integer,boolean)'::regprocedure,
$o$if not found then outbox_id := null; status := 'item_not_found'; return next; continue; end if;$o$,
$n$if not found then outbox_id := null; status := 'item_not_found'; return next; continue; end if;
    if app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at) then outbox_id := null; status := 'withdrawn'; return next; continue; end if;$n$);

-- ---- 5.7 Distribution: PM payload carries the flag; public / platform / founder payloads drop the withdrawn; the RPCs refuse them
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$from public.distribution_day_mentors m where m.day_id = dd.id), '[]'::jsonb))$o$,
$n$from public.distribution_day_mentors m where m.day_id = dd.id and (p_pm or not app_private.item_is_withdrawn(m.mentor_item_id))), '[]'::jsonb))$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$'m', s.mentor_item_id, 'c', s.company_item_id,$o$,
$n$'m', s.mentor_item_id, 'c', case when p_pm or not app_private.item_is_withdrawn(s.company_item_id) then s.company_item_id end,$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$and exists (select 1 from public.distribution_day_mentors m where m.day_id = s.day_id and m.mentor_item_id = s.mentor_item_id)));$o$,
$n$and exists (select 1 from public.distribution_day_mentors m where m.day_id = s.day_id and m.mentor_item_id = s.mentor_item_id)
                   and not app_private.item_is_withdrawn(s.mentor_item_id)));$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$(li.company_id is null and li.network_expert_id is null and li.form_response_id is null and li.source_kind is not null) as missing$o$,
$n$(li.company_id is null and li.network_expert_id is null and li.form_response_id is null and li.source_kind is not null) as missing,
           app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at) as withdrawn$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$'image_path', x.image_path, 'room', r.room, 'missing', case when p_pm then x.missing end)$o$,
$n$'image_path', x.image_path, 'room', r.room, 'missing', case when p_pm then x.missing end, 'withdrawn', case when p_pm then x.withdrawn end)$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$'image_path', x.image_path, 'missing', case when p_pm then x.missing end)$o$,
$n$'image_path', x.image_path, 'missing', case when p_pm then x.missing end, 'withdrawn', case when p_pm then x.withdrawn end)$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$filter (where x.is_mentor), '[]'::jsonb)$o$,
$n$filter (where x.is_mentor and (p_pm or not x.withdrawn)), '[]'::jsonb)$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$filter (where not x.is_mentor), '[]'::jsonb)$o$,
$n$filter (where not x.is_mentor and (p_pm or not x.withdrawn)), '[]'::jsonb)$n$);
select pg_temp.m40_patch('app_private.distribution_payload(uuid,boolean)'::regprocedure,
$o$where s.node_id = p_node and li.company_id in (select app_private.my_company_ids());$o$,
$n$where s.node_id = p_node and li.company_id in (select app_private.my_company_ids())
       and not app_private.is_withdrawn(li.project_id, li.form_response_id, li.company_id, li.withdrawn_at);$n$);
select pg_temp.m40_patch('public.set_distribution_session_companies(uuid,jsonb)'::regprocedure,
$o$raise exception 'distribution_invalid: unknown company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:unknown';$o$,
$n$raise exception 'distribution_invalid: unknown company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:unknown';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_changes) as c(session_id uuid, company_item_id uuid, is_manual_override boolean)
              where c.company_item_id is not null and app_private.item_is_withdrawn(c.company_item_id)) then
    raise exception 'distribution_invalid: withdrawn company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:withdrawn';$n$);
select pg_temp.m40_patch('public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)'::regprocedure,
$o$if v_bad > 0 then raise exception 'distribution_invalid: unknown company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:unknown'; end if;$o$,
$n$if v_bad > 0 then raise exception 'distribution_invalid: unknown company' using errcode = '22023', hint = 'distribution_invalid', detail = 'company:unknown'; end if;
  select count(*) into v_bad from jsonb_to_recordset(p_sessions) as r(day_id uuid, slot_index int, mentor_item_id uuid, company_item_id uuid, is_manual_override boolean)
   where app_private.item_is_withdrawn(r.mentor_item_id) or (r.company_item_id is not null and app_private.item_is_withdrawn(r.company_item_id));
  if v_bad > 0 then raise exception 'distribution_invalid: withdrawn mentor or company' using errcode = '22023', hint = 'distribution_invalid', detail = 'item:withdrawn'; end if;$n$);
select pg_temp.m40_patch('public.my_meetings(uuid)'::regprocedure,
$o$where v.project_id = p_project and ci.company_id in (select app_private.my_company_ids())$o$,
$n$where v.project_id = p_project and ci.company_id in (select app_private.my_company_ids())
    and not app_private.is_withdrawn(ci.project_id, ci.form_response_id, ci.company_id, ci.withdrawn_at)
    and not app_private.item_is_withdrawn(v.mentor_item_id)$n$);

-- ---- 5.8 Agenda: a withdrawn presenter's NAME (derived from the expert) is not shown on the public / founder agenda
select pg_temp.m40_patch('public.get_public_tab(text,uuid,jsonb)'::regprocedure,
$o$'presenter_en', case when a.show_presenter then coalesce(a.presenter_en, ne.name_en) end,$o$,
$n$'presenter_en', case when a.show_presenter then coalesce(a.presenter_en, case when not app_private.is_withdrawn(pi.project_id, pi.form_response_id, pi.company_id, pi.withdrawn_at) then ne.name_en end) end,$n$);
select pg_temp.m40_patch('public.get_public_tab(text,uuid,jsonb)'::regprocedure,
$o$'presenter_ar', case when a.show_presenter then coalesce(a.presenter_ar, ne.name_ar) end)$o$,
$n$'presenter_ar', case when a.show_presenter then coalesce(a.presenter_ar, case when not app_private.is_withdrawn(pi.project_id, pi.form_response_id, pi.company_id, pi.withdrawn_at) then ne.name_ar end) end)$n$);
select pg_temp.m40_patch('public.get_founder_block(uuid,text,uuid,jsonb)'::regprocedure,
$o$'presenter_en', case when a.show_presenter then coalesce(a.presenter_en, ne.name_en) end,$o$,
$n$'presenter_en', case when a.show_presenter then coalesce(a.presenter_en, case when not app_private.is_withdrawn(pi.project_id, pi.form_response_id, pi.company_id, pi.withdrawn_at) then ne.name_en end) end,$n$);
select pg_temp.m40_patch('public.get_founder_block(uuid,text,uuid,jsonb)'::regprocedure,
$o$'presenter_ar', case when a.show_presenter then coalesce(a.presenter_ar, ne.name_ar) end)$o$,
$n$'presenter_ar', case when a.show_presenter then coalesce(a.presenter_ar, case when not app_private.is_withdrawn(pi.project_id, pi.form_response_id, pi.company_id, pi.withdrawn_at) then ne.name_ar end) end)$n$);

-- ================================================================= self-check
do $$
declare v_def text;
begin
  if to_regprocedure('app_private.is_withdrawn(uuid,uuid,uuid,timestamptz)') is null or to_regprocedure('app_private.item_is_withdrawn(uuid)') is null
     or to_regprocedure('app_private.provider_is_withdrawn(uuid)') is null or to_regprocedure('app_private.withdrawal_detail(uuid,uuid,uuid,timestamptz,text)') is null
     or to_regprocedure('app_private.apply_withdrawal(uuid,boolean,text)') is null or to_regprocedure('public.set_item_withdrawn(uuid,boolean,text)') is null
     or to_regprocedure('public.withdraw_participant(uuid,boolean,text)') is null or to_regclass('public.participant_withdrawals') is null then
    raise exception 'm40: an object is missing';
  end if;
  -- every consumer calls the ONE predicate
  for v_def in select pg_get_functiondef(p) from unnest(array[
      'app_private.resolve_list_rows(uuid,jsonb,integer,jsonb,boolean)', 'public.enroll_accepted(uuid,uuid)', 'public.list_participants(uuid,text)',
      'public.detach_item_to_manual(uuid)', 'app_private.invite_for(uuid,text)', 'public.get_public_booking_page(text,uuid,text)', 'public.create_booking(text,uuid,jsonb,text)',
      'public.create_invitations(uuid,uuid[])', 'public.send_selection_emails(uuid,text,uuid[],text,text,boolean,boolean)', 'public.enqueue_email(uuid,text,uuid[],integer,boolean)',
      'public.get_booking_extras(uuid)', 'app_private.distribution_payload(uuid,boolean)', 'public.set_distribution_session_companies(uuid,jsonb)',
      'public.replace_distribution_sessions(uuid,text,uuid[],jsonb,bigint)', 'public.my_meetings(uuid)', 'public.get_public_tab(text,uuid,jsonb)', 'public.get_founder_block(uuid,text,uuid,jsonb)']::regprocedure[]) p loop
    if v_def not like '%is\_withdrawn(%' and v_def not like '%item\_is\_withdrawn(%' and v_def not like '%provider\_is\_withdrawn(%' then
      raise exception 'm40: a consumer is not wired to the withdrawn predicate: %', left(v_def, 120);
    end if;
  end loop;
  if has_function_privilege('anon', 'public.set_item_withdrawn(uuid,boolean,text)', 'EXECUTE') or has_function_privilege('anon', 'public.withdraw_participant(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.is_withdrawn(uuid,uuid,uuid,timestamptz)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.is_withdrawn(uuid,uuid,uuid,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.apply_withdrawal(uuid,boolean,text)', 'EXECUTE') then
    raise exception 'm40: wrong function privileges';
  end if;
  if not (has_function_privilege('authenticated', 'public.set_item_withdrawn(uuid,boolean,text)', 'EXECUTE') and has_function_privilege('authenticated', 'public.withdraw_participant(uuid,boolean,text)', 'EXECUTE')) then
    raise exception 'm40: authenticated must execute the PM RPCs';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.participant_withdrawals'::regclass and relrowsecurity and relforcerowsecurity) then
    raise exception 'm40: participant_withdrawals needs forced RLS';
  end if;
end $$;

commit;
