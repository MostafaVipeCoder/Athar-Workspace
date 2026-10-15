-- m75_network_experts_registry.sql  (Athar Network: the experts registry, part 1 = schema, helpers, triggers, tags, merge audit, photo storage rule)
-- Re-runnable (add column if not exists / create or replace / drop ... if exists / on conflict do nothing). Local DB only. Run AFTER m03 / m06 / m07 / m41.
-- Then m76 (read RPCs), m77 (write RPCs, merge, import). Verify with db/verify/v75_*.sql, v76_*.sql, v77_*.sql.
--
-- WHAT THIS ADDS (owner: "أثر نتورك: المكان اللي بيتجمع فيه كل المدربين ... وكل مدرب شارك في إيه برامج وكام مرة ... وبروفايل للموجّهين والخبراء")
--  1. network_experts gets the profile fields a registry needs: phone, website_url, links, languages (iso codes), notes (STAFF ONLY), archived_at / archived_by (archive = hidden from
--     pickers and the default registry view, history untouched), merged_into (the canonical record a merged duplicate points at), updated_by, and three DERIVED search columns
--     (search_text, name_key, name_skels) kept by a trigger. Nothing that was migrated is changed (the derived columns are back-filled with the touch trigger switched off).
--  2. Pure helpers (immutable): expert_norm (Arabic / Latin normalisation: tashkeel, alef / ya / ta-marbuta variants, accents, punctuation, whitespace), expert_skeleton (a consonant skeleton
--     that is the same for "Osama Nageeb" and "أسامة نجيب": the cross-script duplicate signal), expert_linkkey (a LinkedIn / URL equality key).
--  3. Expertise tags: expert_tags (bilingual, normalised key, archive flag) + network_expert_tags (expert x tag). Written by RPC only (m77). A small starter vocabulary is seeded.
--  4. app_private.expert_participation(expert): ONE row per list item that points at an expert (live node / project / program) with its roles and its session counts (booking sessions =
--     confirmed bookings of the expert's booking provider; distribution sessions = mentoring sessions with a company). It is the single source of every "which programs and how many times".
--     NO stored counters, nothing duplicated.
--  5. Guards: a trigger that keeps `deleted_at` / `merged_into` for super_admin only (and stamps updated_by / created_by), a list_items trigger that redirects a MERGED expert to its canonical
--     record and refuses a removed one (a stale picker can never attach a ghost), the audit tables of merges and dismissed duplicate pairs (app_private, no API privilege).
--  6. Storage: staff (project_manager, alumni_manager, super_admin) may add / replace / remove expert photos at global/expert-photo/<uuid>[_t].webp (the folder the migrated photos use;
--     until now only a super_admin could write under global/). The WebP-only rule of m41 still applies on top.
set search_path = public, extensions;

begin;

-- ================================================================= 1. columns
alter table public.network_experts
  add column if not exists phone        text,
  add column if not exists website_url  text,
  add column if not exists links        jsonb not null default '[]'::jsonb,
  add column if not exists languages    text[] not null default '{}'::text[],
  add column if not exists notes        text,
  add column if not exists archived_at  timestamptz,
  add column if not exists archived_by  uuid references auth.users(id) on delete set null,
  add column if not exists merged_into  uuid references public.network_experts(id) on delete set null,
  add column if not exists updated_by   uuid references auth.users(id) on delete set null,
  add column if not exists search_text  text,
  add column if not exists name_key     text,
  add column if not exists name_skels   text[];

alter table public.network_experts drop constraint if exists network_experts_notes_len;
alter table public.network_experts add constraint network_experts_notes_len check (notes is null or char_length(notes) <= 4000);
alter table public.network_experts drop constraint if exists network_experts_phone_len;
alter table public.network_experts add constraint network_experts_phone_len check (phone is null or char_length(phone) <= 40);
alter table public.network_experts drop constraint if exists network_experts_links_chk;
alter table public.network_experts add constraint network_experts_links_chk check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 6 and octet_length(links::text) <= 3000);
alter table public.network_experts drop constraint if exists network_experts_languages_chk;
alter table public.network_experts add constraint network_experts_languages_chk
  check (cardinality(languages) <= 8 and array_position(languages, null) is null and array_to_string(languages, ',') ~ '^([a-z]{2,3}(,[a-z]{2,3})*)?$');
alter table public.network_experts drop constraint if exists network_experts_merge_chk;
alter table public.network_experts add constraint network_experts_merge_chk check (merged_into is null or (deleted_at is not null and merged_into <> id));

create index if not exists network_experts_search_trgm_idx on public.network_experts using gin (search_text gin_trgm_ops);
create index if not exists network_experts_name_key_trgm_idx on public.network_experts using gin (name_key gin_trgm_ops);
create index if not exists network_experts_name_skels_idx on public.network_experts using gin (name_skels);
create index if not exists network_experts_state_idx on public.network_experts (kind, archived_at) where deleted_at is null;
create index if not exists network_experts_merged_into_idx on public.network_experts (merged_into) where merged_into is not null;
create index if not exists network_experts_archived_by_idx on public.network_experts (archived_by) where archived_by is not null;   -- every FK column keeps a leading index (v02)

-- ================================================================= 2. pure helpers
-- Normal form of a person's text for search and duplicate detection: lower case, no tashkeel / tatweel, one alef, ya (ى ئ -> ي), waw (ؤ -> و), ha (ة -> ه), no accents, punctuation and
-- every kind of whitespace (tabs and runs of spaces are in the migrated names) become ONE space. Western digits stay as typed.
create or replace function app_private.expert_norm(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p, '')), 'أإآٱىئؤةéèêëàâäôöüûùïîçñóúíáãõø', 'ااااييوهeeeeaaaoouuuiicnouiaaoo'),
      '[ً-ٰٟـ]', '', 'g'),
    '[\s.,;:!?()\[\]{}"''“”‘’`~@#$%^&*_+=|\\/<>،؛؟«»-]+', ' ', 'g'))
$$;

-- Consonant skeleton of a NAME (no spaces): Latin and Arabic spellings of the same name give the same string ("Osama Nageeb" = "أسامة نجيب" = smngb). Vowels, semi-vowels, ayn and hamza are dropped,
-- digraphs (sh kh gh th dh ph ch) are folded, look-alike consonants share one class (j / g, q / k / c, z / s, p / b, v / f), repeated letters collapse. A CANDIDATE signal only.
create or replace function app_private.expert_skeleton(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             translate(
               regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                 app_private.expert_norm(replace(coalesce(p, ''), 'ة', '')), 'sh', 's', 'g'), 'kh', 'k', 'g'), 'gh', 'g', 'g'), 'th', 't', 'g'), 'dh', 'd', 'g'), 'ph', 'f', 'g'), 'ch', 'k', 'g'),
               'بتثجحخدذرزسشصضطظغفقكلمنهpvcqzjx', 'bttghkddrssssdtsgfkklmnhbfkksgk'),
             '[^bdfghklmnrst]', '', 'g'),
           '(.)\1+', '\1', 'g')
$$;

-- Equality key of a profile link: no scheme, no www, no country sub-domain of linkedin, no query / fragment / trailing slash, lower case.
create or replace function app_private.expert_linkkey(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z][a-z0-9+.-]*://', ''), '^(www\.|[a-z]{2,3}\.(?=linkedin\.com))', ''),
             '[?#].*$', ''),
           '/+$', ''))
$$;

-- ================================================================= 3. derived columns, guards and stamps (one BEFORE trigger each; alphabetical order matters: biu_* run before bu_touch)
create or replace function app_private.network_experts_derive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.search_text := app_private.expert_norm(concat_ws(' ', new.name_en, new.name_ar, new.title_en, new.title_ar, new.company_en, new.company_ar, new.email::text, app_private.expert_linkkey(new.linkedin_url)));
  new.name_key := btrim(app_private.expert_norm(new.name_en) || ' ' || app_private.expert_norm(new.name_ar));
  new.name_skels := coalesce((select array_agg(distinct s) from unnest(array[app_private.expert_skeleton(new.name_en), app_private.expert_skeleton(new.name_ar)]) s where char_length(s) >= 4), '{}'::text[]);
  return new;
end $$;

-- `deleted_at` / `merged_into` are the super_admin's (delete, restore, merge). A call without a signed-in user (the migrations, service_role) is trusted. created_by / updated_by are stamped here so a
-- direct table write and an RPC leave the same trail.
create or replace function app_private.network_experts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and not coalesce(app_private.is_super_admin(), false) then
    if tg_op = 'INSERT' then
      if new.deleted_at is not null or new.merged_into is not null then raise exception 'forbidden' using errcode = '42501'; end if;
    elsif old.deleted_at is distinct from new.deleted_at or old.merged_into is distinct from new.merged_into then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_uid);
  end if;
  if v_uid is not null then new.updated_by := v_uid; end if;
  return new;
end $$;

drop trigger if exists network_experts_biu_derive on public.network_experts;
create trigger network_experts_biu_derive before insert or update on public.network_experts for each row execute function app_private.network_experts_derive();
drop trigger if exists network_experts_biu_guard on public.network_experts;
create trigger network_experts_biu_guard before insert or update on public.network_experts for each row execute function app_private.network_experts_guard();

-- back-fill of the derived columns on the migrated rows: the touch trigger is switched off so `updated_at` (business data) does not move
alter table public.network_experts disable trigger network_experts_bu_touch;
update public.network_experts set name_key = name_key;   -- recomputes EVERY row on each run (a later change of expert_norm / expert_skeleton re-derives the stored keys)
alter table public.network_experts enable trigger network_experts_bu_touch;

-- ================================================================= 4. a list item can only point at a live expert; a merged one is redirected to its canonical record
create or replace function app_private.list_items_expert_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_del timestamptz; v_into uuid; v_hops int := 0;
begin
  if new.network_expert_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.network_expert_id is not distinct from old.network_expert_id then return new; end if;
  v_id := new.network_expert_id;
  loop
    select x.deleted_at, x.merged_into into v_del, v_into from public.network_experts x where x.id = v_id;
    if not found then return new; end if;          -- the foreign key reports a missing expert
    exit when v_del is null;
    v_hops := v_hops + 1;
    if v_into is null or v_hops > 5 then
      raise exception 'expert_unavailable: this expert was removed' using errcode = '22023', hint = 'expert_unavailable';
    end if;
    v_id := v_into;
  end loop;
  new.network_expert_id := v_id;
  return new;
end $$;
drop trigger if exists list_items_biu_expert on public.list_items;
create trigger list_items_biu_expert before insert or update of network_expert_id on public.list_items for each row execute function app_private.list_items_expert_guard();

-- ================================================================= 5. expertise tags (bilingual lookup + the expert x tag link; RPC-written)
create table if not exists public.expert_tags (
  id          uuid primary key default gen_random_uuid(),
  tag_key     text not null,
  name_en     text,
  name_ar     text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint expert_tags_key_key unique (tag_key),
  constraint expert_tags_name_chk check (nullif(btrim(coalesce(name_en, '')), '') is not null or nullif(btrim(coalesce(name_ar, '')), '') is not null),
  constraint expert_tags_len_chk check (char_length(coalesce(name_en, '')) <= 60 and char_length(coalesce(name_ar, '')) <= 60)
);
create table if not exists public.network_expert_tags (
  expert_id  uuid not null references public.network_experts(id) on delete cascade,
  tag_id     uuid not null references public.expert_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (expert_id, tag_id)
);
create index if not exists network_expert_tags_tag_idx on public.network_expert_tags (tag_id);

alter table public.expert_tags enable row level security;
alter table public.expert_tags force row level security;
alter table public.network_expert_tags enable row level security;
alter table public.network_expert_tags force row level security;
drop policy if exists expert_tags_select_staff on public.expert_tags;
create policy expert_tags_select_staff on public.expert_tags for select to authenticated
  using ((select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin'])));
drop policy if exists network_expert_tags_select_staff on public.network_expert_tags;
create policy network_expert_tags_select_staff on public.network_expert_tags for select to authenticated
  using ((select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin'])));
revoke all on public.expert_tags, public.network_expert_tags from public, anon, authenticated;
grant select on public.expert_tags, public.network_expert_tags to authenticated;
grant select, insert, update, delete on public.expert_tags, public.network_expert_tags to service_role;

-- a small starter vocabulary (the staff add the rest as they type; a super_admin renames / archives): key = the normal form of the English name
insert into public.expert_tags (tag_key, name_en, name_ar) values
  ('marketing branding', 'Marketing & Branding', 'التسويق والعلامة التجارية'),
  ('sales business development', 'Sales & Business Development', 'المبيعات وتطوير الأعمال'),
  ('finance fundraising', 'Finance & Fundraising', 'المالية وجمع التمويل'),
  ('investment', 'Investment', 'الاستثمار'),
  ('legal compliance', 'Legal & Compliance', 'الشؤون القانونية والامتثال'),
  ('technology software', 'Technology & Software', 'التكنولوجيا والبرمجيات'),
  ('artificial intelligence data', 'Artificial Intelligence & Data', 'الذكاء الاصطناعي والبيانات'),
  ('product design', 'Product & Design', 'المنتج والتصميم'),
  ('operations supply chain', 'Operations & Supply Chain', 'العمليات وسلاسل الإمداد'),
  ('strategy leadership', 'Strategy & Leadership', 'الاستراتيجية والقيادة'),
  ('climate sustainability', 'Climate & Sustainability', 'المناخ والاستدامة'),
  ('agriculture food', 'Agriculture & Food', 'الزراعة والغذاء'),
  ('manufacturing industry', 'Manufacturing & Industry', 'التصنيع والصناعة'),
  ('export trade', 'Export & Trade', 'التصدير والتجارة'),
  ('hr training', 'HR & Training', 'الموارد البشرية والتدريب'),
  ('social impact entrepreneurship', 'Social Impact & Entrepreneurship', 'الأثر الاجتماعي وريادة الأعمال'),
  ('pitching public speaking', 'Pitching & Public Speaking', 'العرض التقديمي والإلقاء'),
  ('mentoring coaching', 'Mentoring & Coaching', 'الإرشاد والتوجيه')
on conflict (tag_key) do nothing;

-- ================================================================= 6. the audit of merges and of "these two are NOT the same person" (no API privilege: read through the super_admin RPCs of m77)
create table if not exists app_private.network_expert_merges (
  id          uuid primary key default gen_random_uuid(),
  keep_id     uuid not null,
  drop_id     uuid not null,
  keep_name   text,
  drop_name   text,
  keep_before jsonb not null,
  drop_before jsonb not null,
  plan        jsonb not null default '{}'::jsonb,
  result      jsonb not null default '{}'::jsonb,
  merged_by   uuid,
  merged_at   timestamptz not null default now()
);
create index if not exists network_expert_merges_keep_idx on app_private.network_expert_merges (keep_id);
create index if not exists network_expert_merges_drop_idx on app_private.network_expert_merges (drop_id);
create table if not exists app_private.network_expert_nondup (
  a            uuid not null,
  b            uuid not null,
  dismissed_by uuid,
  dismissed_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table app_private.network_expert_merges enable row level security;
alter table app_private.network_expert_merges force row level security;
alter table app_private.network_expert_nondup enable row level security;
alter table app_private.network_expert_nondup force row level security;
revoke all on app_private.network_expert_merges, app_private.network_expert_nondup from public, anon, authenticated;

-- ================================================================= 7. participation: ONE row per list item of an expert (live node / project / program), derived live
-- booking sessions = confirmed bookings through the expert's booking provider (any booking node of the project); distribution sessions = mentoring-distribution sessions of the expert
-- WITH a company assigned (an empty slot is not a session). first / last = the dates of those sessions (project time zone). `withdrawn` rows are returned (the profile shows them to a
-- project manager with a chip) but every COUNT leaves them out: a withdrawn expert is not participating any more (owner decision 17.1, the m40 rule).
-- (m78 re-creates this function with two more columns, `hidden` and `counted`: a plain `create or replace` cannot change the result type, so m75 stays re-runnable by dropping it first;
--  nothing depends on it by catalog, and m78 - run again after any re-run of m75 - puts the current version back)
drop function if exists app_private.expert_participation(uuid);
create or replace function app_private.expert_participation(p_expert uuid default null)
returns table (expert_id uuid, item_id uuid, node_id uuid, project_id uuid, program_id uuid, withdrawn boolean,
               is_provider boolean, is_mentor boolean, is_presenter boolean,
               booking_sessions integer, distribution_sessions integer, first_session_on date, last_session_on date, added_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select li.network_expert_id, li.id, li.list_node_id, li.project_id, j.program_id, (li.withdrawn_at is not null),
         exists (select 1 from public.booking_providers bp join public.nodes bn on bn.id = bp.node_id and bn.deleted_at is null where bp.list_item_id = li.id),
         (exists (select 1 from public.distribution_sessions x where x.mentor_item_id = li.id)
          or exists (select 1 from public.distribution_mentor_rules r where r.mentor_item_id = li.id)
          or exists (select 1 from public.distribution_day_mentors m where m.mentor_item_id = li.id)),
         exists (select 1 from public.agenda_slots a where a.presenter_item_id = li.id),
         coalesce(bk.n, 0), coalesce(ds.n, 0),
         least(bk.first_on, ds.first_on), greatest(bk.last_on, ds.last_on), li.created_at
    from public.list_items li
    join public.nodes n on n.id = li.list_node_id and n.deleted_at is null
    join public.projects j on j.id = li.project_id and j.deleted_at is null
    join public.programs g on g.id = j.program_id and g.deleted_at is null
    left join lateral (
      select count(*)::int as n, min((s.starts_at at time zone coalesce(j.timezone, 'Africa/Cairo'))::date) as first_on, max((s.starts_at at time zone coalesce(j.timezone, 'Africa/Cairo'))::date) as last_on
        from public.booking_providers bp
        join public.booking_slots s on s.provider_id = bp.id
        join public.bookings b on b.slot_id = s.id and b.status = 'confirmed'
        join public.nodes bn on bn.id = bp.node_id and bn.deleted_at is null
       where bp.list_item_id = li.id) bk on true
    left join lateral (
      select count(*)::int as n, min(d.day_date) as first_on, max(d.day_date) as last_on
        from public.distribution_sessions x
        join public.distribution_days d on d.id = x.day_id
        join public.nodes dn on dn.id = x.node_id and dn.deleted_at is null
       where x.mentor_item_id = li.id and x.company_item_id is not null) ds on true
   where li.network_expert_id is not null and (p_expert is null or li.network_expert_id = p_expert)
$$;

-- ================================================================= 8. storage: staff manage the expert photos of the registry (global/expert-photo/<uuid>[_t].webp)
drop policy if exists public_assets_insert_expert_photo on storage.objects;
create policy public_assets_insert_expert_photo on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and name ~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$'
              and (select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin'])));
drop policy if exists public_assets_delete_expert_photo on storage.objects;
create policy public_assets_delete_expert_photo on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and name ~ '^global/expert-photo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$'
         and (select app_private.has_any_role(array['project_manager', 'alumni_manager', 'super_admin'])));

-- ================================================================= 9. privileges of the helpers (closed to API roles; the RPCs of m76 / m77 are the only door)
revoke all on function app_private.expert_norm(text), app_private.expert_skeleton(text), app_private.expert_linkkey(text),
               app_private.expert_participation(uuid), app_private.network_experts_derive(), app_private.network_experts_guard(), app_private.list_items_expert_guard()
  from public, anon, authenticated;

-- ================================================================= 10. self-check
do $$
declare v_missing int;
begin
  select count(*) into v_missing from public.network_experts where search_text is null or name_key is null or name_skels is null;
  if v_missing <> 0 then raise exception 'm75: % experts without the derived search columns', v_missing; end if;
  if app_private.expert_skeleton('Osama Nageeb') is distinct from app_private.expert_skeleton('أسامة نجيب') then raise exception 'm75: the skeleton of the same name differs across scripts'; end if;
  if app_private.expert_norm(E'  Alaa\tAfifi  ') is distinct from 'alaa afifi' then raise exception 'm75: expert_norm does not collapse whitespace'; end if;
  if has_table_privilege('anon', 'public.expert_tags', 'SELECT') or has_table_privilege('authenticated', 'app_private.network_expert_merges', 'SELECT') then raise exception 'm75: a table is open to an API role'; end if;
  raise notice 'm75 ok';
end $$;

commit;
