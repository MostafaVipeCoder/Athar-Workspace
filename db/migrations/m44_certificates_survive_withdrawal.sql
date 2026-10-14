-- m44_certificates_survive_withdrawal.sql  (owner decision 08 section 18.2, 2026-10-14)
--
--   "An issued certificate STAYS VALID AND AVAILABLE even if the participant is later marked withdrawn. Withdrawal after issuing can only happen by
--    a PM mistake, so it must not revoke or hide certificates."   Replaces the m43 behaviour "a withdrawn participant's certificate reads revoked".
--
-- THE RULE (one sentence, now true everywhere): once a certificate EXISTS and the PM has not revoked it, it is valid in the public verifier, listed and
-- renderable for its founder, and readable by its owner, WHATEVER later happens to the participant's status (withdrawn, or attended -> accepted by
-- mistake). Only the PM's explicit revoke (revoke_certificate / revoke_participant_certificates) ends it. CREATING a certificate is unchanged: issuing,
-- claiming and re-issuing still require an ATTENDED participant + a completed project + the PM's authorisation (grant).
--
-- Everywhere that read the participant status for an EXISTING certificate (each patched IN PLACE on its CURRENT definition, m40 - m43 untouched):
--   1. get_public_certificate_verification   valid = not revoked (was: not revoked AND attended: m43)
--   2. get_certificate_render_payload        the owner needs no attended participant any more (still: own, not revoked, project completed, node shown)
--   3. list_my_certificates                  lists my active certificates whatever the status; its CLAIM loop (creating NEW ones) still needs attended
--   4. cert_template_readable                the storage rule that signs the template image for the owner (same condition as 2)
--   5. RLS certificates_select_pm_alumni_own the founder reads his OWN active certificate row (no participants subquery any more)
--   6. get_founder_program_page              a WITHDRAWN participant keeps the status-only page, which now also carries the founder's certificate block
--   7. list_my_programs                      a withdrawn (status-only) row says how many certificates the founder keeps (`certificate_count`), so the card can link to them
--   8. get_certificates_admin (the PM panel) a linked founder with no certificate under a non-attended participant is `not_eligible`, not "claimable"
--   9. reissue_certificate                   re-issuing creates a certificate, so a non-attended participant is refused with the clear `certificate_not_attended`
-- Unchanged on purpose (documented): the founder-side gates "project completed" and "node shown to participants" (the PM's own exposure switches; the
-- public verifier never looked at them), cert_claim / cert_issue_one / cert_issue_person (creation), the PM manual revoke.
--
-- Re-runnable: every patch recognises its own result. Run AFTER m43 (m43's verifier patch would put the attended condition back if it were re-run
-- ALONE after this file: re-run m43 and m44 together, in order, as the suite does). Local DB only. No business data is altered.
set search_path = public, extensions;

begin;

-- ================================================================= patch helper (pg_temp)
-- Replace an anchor in the CURRENT definition of a function (exactly `p_expect` hits). Recognises its own result in BOTH shapes: a patch whose new text
-- CONTAINS the old one (an extension: check the new text first, or it would be applied twice) and one whose old text contains the new one (a removal:
-- check the old text first, or it would be reported as already applied).
create or replace function pg_temp.m44_patch(p_fn regprocedure, p_old text, p_new text, p_expect int default 1) returns text
language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int; v_extension boolean := position(p_old in p_new) > 0;
begin
  if v_extension and position(p_new in v_def) > 0 then return 'already  ' || p_fn::text; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n = 0 and not v_extension and position(p_new in v_def) > 0 then return 'already  ' || p_fn::text; end if;
  if v_n <> p_expect then raise exception 'm44_patch: % anchor found % times (expected %): %', p_fn, v_n, p_expect, left(p_old, 100); end if;
  execute replace(v_def, p_old, p_new);
  return 'patched   ' || p_fn::text;
end $$;

-- ================================================================= 1. the public verifier: valid = not revoked
select pg_temp.m44_patch('public.get_public_certificate_verification(text)'::regprocedure,
$o$v_valid := c.revoked_at is null and exists (select 1 from public.participants vp where vp.id = c.participant_id and vp.status = 'attended');$o$,
$n$v_valid := c.revoked_at is null;$n$);

-- ================================================================= 2. the render payload (the owner)
select pg_temp.m44_patch('public.get_certificate_render_payload(uuid)'::regprocedure,
$o$and pa.status = 'attended' and c.revoked_at is null and j.completed_at is not null$o$,
$n$and c.revoked_at is null and j.completed_at is not null$n$);

-- ================================================================= 3. list_my_certificates: what I hold, whatever the status (the claim loop above it still needs attended)
select pg_temp.m44_patch('public.list_my_certificates(uuid)'::regprocedure,
$o$where c.revoked_at is null and pa.status = 'attended' and c.user_id = v_uid$o$,
$n$where c.revoked_at is null and c.user_id = v_uid$n$);

-- ================================================================= 4. the storage rule that signs the template image for the owner
select pg_temp.m44_patch('public.cert_template_readable(text)'::regprocedure,
$o$and pa.status = 'attended' and j.completed_at is not null$o$,
$n$and j.completed_at is not null$n$);

-- ================================================================= 5. RLS: a founder reads his OWN active certificate row
drop policy if exists certificates_select_pm_alumni_own on public.certificates;
create policy certificates_select_pm_alumni_own on public.certificates for select to authenticated
  using ((select app_private.is_project_manager(project_id)) or (select app_private.has_role('alumni_manager'))
         or (revoked_at is null and user_id = (select auth.uid())));

-- ================================================================= 6. the founder Program page of a WITHDRAWN participant keeps the certificate
-- The page stays the status-only page (header with the NAMES, status, no cover / dates / links), but its `blocks` now hold the ONE block the founder keeps:
-- his certificate(s), built by the same exposure RPC as the normal page (list_my_certificates). Nothing else is ever added to a restricted page.
select pg_temp.m44_patch('public.get_founder_program_page(uuid)'::regprocedure,
$o$'restricted', true, 'blocks', '[]'::jsonb);$o$,
$n$'restricted', true, 'blocks', coalesce((select jsonb_build_array(jsonb_build_object('type', 'certificate', 'data', jsonb_build_object('items', x.j))) from (select public.list_my_certificates(p_project) as j) x where jsonb_array_length(x.j) > 0), '[]'::jsonb));$n$);
select pg_temp.m44_patch('public.get_founder_program_page(uuid)'::regprocedure,
$o$-- certificate (decided in the DB: issued, not revoked, attended, project completed, node exposed)$o$,
$n$-- certificate (decided in the DB: issued to me, not revoked, project completed, node exposed; the participant status does not matter, 08 section 18.2)$n$);

-- ================================================================= 7. list_my_programs: how many certificates a withdrawn (status-only) card keeps
-- app_private.my_certificate_count: the certificates the signed-in founder can read in ONE project (own, active, project completed, node shown). The
-- same conditions as list_my_certificates, without the claim step (a list of cards must not write).
create or replace function app_private.my_certificate_count(p_project uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.certificates c
    join public.nodes n on n.id = c.node_id and n.deleted_at is null and n.show_to_participants
    join public.projects j on j.id = c.project_id and j.completed_at is not null
   where c.project_id = p_project and c.revoked_at is null and c.user_id = (select auth.uid())
$$;
revoke all on function app_private.my_certificate_count(uuid) from public, anon, authenticated;

select pg_temp.m44_patch('public.list_my_programs(boolean)'::regprocedure,
$o$jsonb_build_object('participant_id', b.participant_id, 'project_id', b.pid, 'program_id', j.program_id, 'status', b.status, 'restricted', true,$o$,
$n$jsonb_build_object('participant_id', b.participant_id, 'project_id', b.pid, 'program_id', j.program_id, 'status', b.status, 'restricted', true, 'certificate_count', app_private.my_certificate_count(b.pid),$n$);

-- ================================================================= 8. the PM's Issue panel: a founder who cannot get one now is not "claimable"
-- A linked founder with no certificate whose participant is not attended (withdrawn, or un-marked) has an active grant but NOTHING can be created: the
-- state is `not_eligible` (new), not the promise "created when he opens his page". The founder counts (claimable) follow.
select pg_temp.m44_patch('public.get_certificates_admin(uuid)'::regprocedure,
$o$when g.id is not null and g.revoked_at is null then 'claimable'$o$,
$n$when g.id is not null and g.revoked_at is null then case when pa.status = 'attended' then 'claimable' else 'not_eligible' end$n$);

-- ================================================================= 9. reissue_certificate: re-issuing is issuing
select pg_temp.m44_patch('public.reissue_certificate(uuid)'::regprocedure,
$o$perform app_private.cert_issue_checks(c.node_id);$o$,
$n$perform app_private.cert_issue_checks(c.node_id); if not exists (select 1 from public.participants x where x.id = c.participant_id and x.status = 'attended') then raise exception 'only attended participants receive certificates' using errcode = '23514', hint = 'certificate_not_attended'; end if;$n$);

-- ================================================================= self-check
do $$
begin
  if pg_get_functiondef('public.get_public_certificate_verification(text)'::regprocedure) like '%vp.status%' then raise exception 'm44: the verifier still looks at the participant status'; end if;
  if pg_get_functiondef('public.get_certificate_render_payload(uuid)'::regprocedure) like '%pa.status = ''attended''%' then raise exception 'm44: the render payload still needs an attended participant'; end if;
  if pg_get_functiondef('public.get_certificate_render_payload(uuid)'::regprocedure) not like '%not coalesce(v_own, false)%' then raise exception 'm44: the m43 NULL guard of the render payload is gone'; end if;
  if pg_get_functiondef('public.cert_template_readable(text)'::regprocedure) like '%pa.status = ''attended''%' then raise exception 'm44: the template rule still needs an attended participant'; end if;
  if pg_get_functiondef('public.list_my_certificates(uuid)'::regprocedure) like '%where c.revoked_at is null and pa.status%' then raise exception 'm44: list_my_certificates still filters the status'; end if;
  -- CREATION is unchanged: the claim loop of list_my_certificates, cert_claim, cert_issue_one and cert_issue_person still need an attended participant
  if pg_get_functiondef('public.list_my_certificates(uuid)'::regprocedure) not like '%join public.participants pa on pa.id = g.participant_id and pa.status = ''attended''%' then raise exception 'm44: the claim loop lost its attended gate'; end if;
  if pg_get_functiondef('app_private.cert_claim(uuid,uuid)'::regprocedure) not like '%pa.status = ''attended''%' then raise exception 'm44: cert_claim lost its attended gate'; end if;
  if pg_get_functiondef('app_private.cert_issue_one(uuid,uuid,uuid,boolean)'::regprocedure) not like '%pa.status <> ''attended''%' then raise exception 'm44: cert_issue_one lost its attended gate'; end if;
  if pg_get_functiondef('app_private.cert_issue_person(uuid,uuid,uuid,boolean,text)'::regprocedure) not like '%pa.status is distinct from ''attended''%' then raise exception 'm44: cert_issue_person lost its attended gate'; end if;
  if pg_get_functiondef('public.reissue_certificate(uuid)'::regprocedure) not like '%certificate_not_attended%' then raise exception 'm44: reissue_certificate is not patched'; end if;
  if pg_get_functiondef('public.get_founder_program_page(uuid)'::regprocedure) not like '%''restricted'', true, ''blocks'', coalesce(%' then raise exception 'm44: the restricted founder page is not patched'; end if;
  if pg_get_functiondef('public.list_my_programs(boolean)'::regprocedure) not like '%certificate_count%' then raise exception 'm44: list_my_programs is not patched'; end if;
  if pg_get_functiondef('public.get_certificates_admin(uuid)'::regprocedure) not like '%not_eligible%' then raise exception 'm44: the admin panel is not patched'; end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'certificates' and policyname = 'certificates_select_pm_alumni_own') like '%attended%' then raise exception 'm44: the certificates RLS policy still needs an attended participant'; end if;
  if has_function_privilege('anon', 'app_private.my_certificate_count(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'app_private.my_certificate_count(uuid)', 'EXECUTE') then
    raise exception 'm44: an API role can execute the helper';
  end if;
end $$;

commit;
