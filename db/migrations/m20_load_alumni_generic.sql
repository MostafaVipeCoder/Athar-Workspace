-- m20_load_alumni_generic  (05 section 4.1 "generic rule for empty tables"; STAGE 2a, LOCAL ONLY)
-- Loaders for the tables that are EMPTY on this copy but may hold rows at a later freeze: founders, company_founders, company_snapshots,
-- alumni_invitations (token stored as sha256 hex), notifications, opportunities, opportunity_applications, investor_requests,
-- program_participations -> participants.  Tables with no destination (certificates, email_audit_log, booking_notifications, expert_submissions,
-- mentor_day_config) raise a BLOCKER flag if they ever contain rows.  Secret tables are never read.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m20_load_alumni_generic') as id;
\o /dev/null

insert into public.founders (id, name_ar, name_en, email, phone, linkedin_url, photo_path, bio_ar, bio_en, auth_user_id, created_at, updated_at)
select f.founder_id, f.name_ar, nullif(btrim(f.name_en),''), nullif(btrim(f.email),''), nullif(btrim(f.phone),''), nullif(btrim(f.linkedin_url),''),
       migration.register_asset('founder-photo', null, f.photo_url, 'founders', f.founder_id::text, 'photo_path'),
       nullif(btrim(f.bio_ar),''), nullif(btrim(f.bio_en),''), (select u.id from auth.users u where u.id = f.auth_user_id), coalesce(f.created_at, now()), coalesce(f.updated_at, now())
from legacy.founders f
on conflict (id) do nothing;

insert into public.company_founders (company_id, founder_id, role, is_primary, created_at)
select cf.company_id, cf.founder_id, coalesce(nullif(btrim(cf.role_in_company),''), nullif(btrim(cf.role),''), 'founder'), coalesce(cf.is_primary, false), coalesce(cf.created_at, now())
from legacy.company_founders cf
where exists (select 1 from public.companies c where c.id = cf.company_id) and exists (select 1 from public.founders f where f.id = cf.founder_id)
on conflict (company_id, founder_id) do nothing;

insert into public.company_snapshots (id, company_id, snapshot_type, snapshot_date, source, data, form_response_id, created_at)
select s.snapshot_id, s.company_id, s.snapshot_type, s.snapshot_date, s.source, s.data, (select r.id from public.form_responses r where r.id = s.form_response_id), coalesce(s.created_at, now())
from legacy.company_snapshots s where exists (select 1 from public.companies c where c.id = s.company_id)
on conflict (id) do nothing;

insert into public.alumni_invitations (id, company_id, founder_email, token, status, sent_at, accepted_at, sent_by, created_at, founder_id)
select i.id, i.company_id, i.founder_email, encode(extensions.digest(i.token, 'sha256'), 'hex'),
       case when i.status in ('pending','accepted','expired','revoked') then i.status else 'expired' end, i.sent_at, i.accepted_at, i.sent_by, i.created_at,
       (select f.id from public.founders f where f.id = i.founder_id)
from legacy.alumni_invitations i where exists (select 1 from public.companies c where c.id = i.company_id)
on conflict (id) do nothing;

insert into public.notifications (id, recipient_id, founder_id, title, body, is_read, created_at, sent_by, audience_type, audience_target_id, broadcast_id, metadata)
select n.id, (select u.id from auth.users u where u.id = n.recipient_id), (select f.id from public.founders f where f.id = n.founder_id), n.title, n.body, n.is_read, n.created_at,
       (select u.id from auth.users u where u.id = n.sent_by), n.audience_type, n.audience_target_id, n.broadcast_id, coalesce(n.metadata, '{}'::jsonb)
from legacy.notifications n
on conflict (id) do nothing;

insert into public.opportunities (opportunity_id, type, title_ar, title_en, description_ar, description_en, deadline, eligibility, link, image_url, is_active, order_index, created_at, updated_at)
select o.opportunity_id, o.type, o.title_ar, o.title_en, o.description_ar, o.description_en, o.deadline, o.eligibility, o.link, o.image_url, coalesce(o.is_active, true), coalesce(o.order_index, 0),
       coalesce(o.created_at, now()), coalesce(o.updated_at, now())
from legacy.opportunities o
on conflict (opportunity_id) do nothing;

insert into public.opportunity_applications (id, opportunity_id, company_id, founder_id, status, notes, applied_at)
select a.id, a.opportunity_id, a.company_id, (select f.id from public.founders f where f.id = a.founder_id), a.status, a.notes, coalesce(a.applied_at, now())
from legacy.opportunity_applications a
where exists (select 1 from public.companies c where c.id = a.company_id) and exists (select 1 from public.opportunities o where o.opportunity_id = a.opportunity_id)
on conflict (id) do nothing;

insert into public.investor_requests (id, requester_name, requester_email, requester_org, company_id, request_type, message, status, created_at)
select r.id, r.requester_name, r.requester_email, r.requester_org, (select c.id from public.companies c where c.id = r.company_id), r.request_type, r.message, r.status, coalesce(r.created_at, now())
from legacy.investor_requests r
on conflict (id) do nothing;

insert into public.participants (id, project_id, company_id, source, status, notes, created_at, updated_at)
select p.id, p.event_id, p.company_id, 'manual',
       case when lower(coalesce(p.graduation_status, '')) in ('graduated','completed','attended') then 'attended'
            when lower(coalesce(p.graduation_status, '')) in ('withdrawn','dropped','left') then 'withdrawn' else 'accepted' end,
       p.notes, coalesce(p.created_at, now()), coalesce(p.updated_at, now())
from legacy.program_participations p
where p.event_id is not null and exists (select 1 from public.projects j where j.id = p.event_id) and exists (select 1 from public.companies c where c.id = p.company_id)
on conflict (id) do nothing;
select migration.flag('participation_not_loaded', 'review', 'program_participations', p.id::text, 'row has no event/company that exists in the new schema (program-level participation without a project); stays in legacy')
from legacy.program_participations p
where p.event_id is null or not exists (select 1 from public.projects j where j.id = p.event_id) or not exists (select 1 from public.companies c where c.id = p.company_id);

-- ---------------------------------------------------------------- tables without a destination: blockers if they ever hold rows
select migration.flag('unloaded_table_not_empty', 'blocker', 'table', t.n, t.n || ' has ' || t.c::text || ' rows but no loader/destination exists (see 05 4.1)')
from (select 'certificates' n, count(*) c from legacy.certificates
      union all select 'email_audit_log', count(*) from legacy.email_audit_log
      union all select 'booking_notifications', count(*) from legacy.booking_notifications
      union all select 'expert_submissions', count(*) from legacy.expert_submissions
      union all select 'mentor_day_config', count(*) from legacy.mentor_day_config) t where t.c > 0;

-- ================================================================= verification
select migration.check((select id from _r), 'V20.1 generic tables: legacy = loaded (founders/company_founders/snapshots/invitations/notifications/opportunities/applications/investor_requests)',
  (select (select count(*) from legacy.founders) || '/' || (select count(*) from legacy.company_founders) || '/' || (select count(*) from legacy.company_snapshots) || '/' ||
          (select count(*) from legacy.alumni_invitations) || '/' || (select count(*) from legacy.notifications) || '/' || (select count(*) from legacy.opportunities) || '/' ||
          (select count(*) from legacy.opportunity_applications) || '/' || (select count(*) from legacy.investor_requests)),
  (select (select count(*) from public.founders) || '/' || (select count(*) from public.company_founders) || '/' || (select count(*) from public.company_snapshots) || '/' ||
          (select count(*) from public.alumni_invitations) || '/' || (select count(*) from public.notifications) || '/' || (select count(*) from public.opportunities) || '/' ||
          (select count(*) from public.opportunity_applications) || '/' || (select count(*) from public.investor_requests)));
select migration.check((select id from _r), 'V20.2 participants = loadable program_participations',
  (select count(*)::text from legacy.program_participations p where p.event_id is not null and exists (select 1 from public.projects j where j.id = p.event_id) and exists (select 1 from public.companies c where c.id = p.company_id)),
  (select count(*)::text from public.participants));
select migration.check((select id from _r), 'V20.3 no blocker flag open', '0', (select count(*)::text from migration.flags where severity = 'blocker' and resolved_at is null));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
commit;
