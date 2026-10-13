-- v37_landing  (m37: Landing Page node RPCs, stable card ids, share presets, frames, anon analytics)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users/rows never persist.
-- Prints PASS/FAIL lines; exits non-zero on any FAIL.  U1 = temporary super_admin (PM), U2 = temporary founder without participation.
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v37.res', '', false) \gset

begin;
create schema v37_test;
grant usage on schema v37_test to public;
create or replace function v37_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v37.res', current_setting('v37.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
end $$;
create or replace function v37_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v37_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v37_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v37_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
    perform v37_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform v37_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint), 'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v37_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v37_test.t(p_key, true, 'ok');
  exception when others then
    perform v37_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
revoke all on all functions in schema v37_test from public;
grant execute on all functions in schema v37_test to anon, authenticated, service_role;

-- ================================================================= catalog checks (as postgres)
select v37_test.val('C01 m37 functions exist', $q$select (to_regprocedure('app_private.landing_safe_url(text)') is not null and to_regprocedure('app_private.landing_public_config(jsonb)') is not null and to_regprocedure('app_private.landing_target_link(uuid)') is not null and to_regprocedure('app_private.landing_public_payload(public.nodes)') is not null and to_regprocedure('public.get_public_landing(text)') is not null and to_regprocedure('public.track_landing_event(text,text,uuid,text,uuid)') is not null and to_regprocedure('public.get_landing_analytics(uuid,integer)') is not null and to_regprocedure('app_private.save_children_landing_page(uuid,jsonb)') is not null)::text$q$, 'true');
select v37_test.val('C02 every m37 function has search_path = empty', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('landing_safe_url','landing_public_config','landing_target_link','landing_public_payload','get_public_landing','track_landing_event','get_landing_analytics','save_children_landing_page') and coalesce(p.proconfig::text,'') not like '%search_path=%'$q$, '0');
select v37_test.val('C03 anon executes get_public_landing and track_landing_event', $q$select (has_function_privilege('anon','public.get_public_landing(text)','EXECUTE') and has_function_privilege('anon','public.track_landing_event(text,text,uuid,text,uuid)','EXECUTE'))::text$q$, 'true');
select v37_test.val('C04 anon cannot execute the analytics read nor any helper', $q$select (has_function_privilege('anon','public.get_landing_analytics(uuid,integer)','EXECUTE') or has_function_privilege('anon','app_private.landing_public_payload(public.nodes)','EXECUTE') or has_function_privilege('anon','app_private.landing_target_link(uuid)','EXECUTE') or has_function_privilege('anon','app_private.save_children_landing_page(uuid,jsonb)','EXECUTE') or has_function_privilege('authenticated','app_private.landing_safe_url(text)','EXECUTE'))::text$q$, 'false');
select v37_test.val('C05 authenticated can read analytics (the function checks the PM itself)', $q$select has_function_privilege('authenticated','public.get_landing_analytics(uuid,integer)','EXECUTE')::text$q$, 'true');
select v37_test.val('C06 rate-limit table: RLS forced and no client grant', $q$select (select relforcerowsecurity from pg_class where oid = 'app_private.landing_event_limits'::regclass)::text || '/' || (has_table_privilege('anon','app_private.landing_event_limits','SELECT') or has_table_privilege('authenticated','app_private.landing_event_limits','INSERT'))::text$q$, 'true/false');
select v37_test.val('C07 URL whitelist: https, mailto, tel, /path, #anchor accepted', $q$select (app_private.landing_safe_url('https://athareg.com/x?y=1') and app_private.landing_safe_url('mailto:a@b.co') and app_private.landing_safe_url('tel:+201001234567') and app_private.landing_safe_url('/forms/abc') and app_private.landing_safe_url('#') and app_private.landing_safe_url('') and app_private.landing_safe_url(null))::text$q$, 'true');
select v37_test.val('C08 URL whitelist: javascript:, data:, spaces and bare words refused', $q$select (app_private.landing_safe_url('javascript:alert(1)') or app_private.landing_safe_url('JaVaScRiPt:alert(1)') or app_private.landing_safe_url('data:text/html;base64,AAAA') or app_private.landing_safe_url('https://a b.co') or app_private.landing_safe_url('www.athareg.com') or app_private.landing_safe_url('ftp://x.co'))::text$q$, 'false');
select v37_test.val('C09 public config whitelist keeps the page keys and drops the rest', $q$select app_private.landing_public_config('{"secret":"x","legacyThing":1,"title":"Join","layoutColumns":2,"hero":{"title":{"en":"H"}},"nav":{"enabled":true},"seo":{"title":{"en":"S"}},"analytics":{"enabled":false,"internal":"y"},"personalize":{"enabled":true}}'::jsonb)::text$q$, '{"nav": {"enabled": true}, "seo": {"title": {"en": "S"}}, "hero": {"title": {"en": "H"}}, "title": "Join", "analytics": {"enabled": false}, "personalize": {"enabled": true}, "layoutColumns": 2}');
select v37_test.val('C10 get_public_tab still carries the landing payload call AND the other branches', $q$select (position('landing_public_payload' in pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure)) > 0 and position('distribution_payload' in pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure)) > 0 and position('agenda_public_config' in pg_get_functiondef('public.get_public_tab(text,uuid,jsonb)'::regprocedure)) > 0)::text$q$, 'true');
select v37_test.val('C11 the migrated landing node and its 4 cards are untouched by m37', $q$select (select count(*) from public.landing_cards where node_id = 'd35d0dfb-ce1b-49cb-98a5-0fde162e03b8')::text$q$, '4');

-- ================================================================= setup (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000b0d7','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v37-admin@example.invalid','{"provisioned":true}','{"full_name":"V37 Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000b0f7','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v37-founder@example.invalid','{"provisioned":true}','{"full_name":"V37 Founder"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000b0d7','super_admin'), ('00000000-0000-4000-8000-00000000b0f7','founder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('V37 Program', null, null, null, null, null)).id as prog \gset
select (public.create_project(:'prog', 'V37 Project', null, 'Asia/Riyadh')).id as proj \gset
select (public.add_node(:'proj', 'landing_page', '{"en":"V37 Landing","ar":"هبوط"}', 0, 0, '{}')).id as ld \gset
select (public.add_node(:'proj', 'landing_page', '{"en":"V37 Other landing"}', 0, 100, '{}')).id as ld2 \gset
select (public.add_node(:'proj', 'form_builder', '{"en":"V37 Form"}', 300, 0, '{}')).id as fm \gset
select (public.add_node(:'proj', 'agenda', '{"en":"V37 Agenda"}', 300, 200, '{}')).id as ag \gset
select public.ensure_public_link(:'fm', 'form', null, null) as flink \gset
select public.ensure_public_link(:'ld', 'view', 'landing', null) as llink \gset
select public.ensure_public_link(:'ag', 'agenda', null, null) as alink \gset
select public.connect(:'proj', :'fm', 'link', :'ld', 'links', '{}'::jsonb);
select (public.connect(:'proj', :'ld', 'landing-tab', :'ag', 'tabs', '{"audience":"public"}')).id as e1 \gset
select public.save_node(:'ld', (select r.rev from public.node_revisions r where r.node_id = :'ld'),
  jsonb_build_object('config', '{"hero":{"title":{"en":"Help","ar":"ساعد"}},"personalize":{"enabled":true},"share":{"channels":["whatsapp","copy"]},"analytics":{"enabled":true},"secretKey":"do-not-leak"}'::jsonb),
  jsonb_build_object('cards', jsonb_build_array(
      jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000001','sort_order',0,'title_en','Card A','cta_label_en','Apply','cta_node_id', :'fm','cta_url','https://ignored.example','cta_dot',true,'share_enabled',true,
        'presets', jsonb_build_object('whatsapp','Join {link} now {link}','telegram','TG {link}','facebook','')),
      jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000002','sort_order',1,'title_en','Card B','cta_url','https://athareg.com/apply','share_enabled',false)),
    'frames', jsonb_build_array(
      jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000001','name','Frame 1','image_path', :'proj' || '/landing/frame1.png','window_x',90,'window_y',90,'window_w',900,'window_h',930,'sort_order',0)))) as saved \gset
reset role;
update public.nodes set visibility = 'public' where id in (:'ld', :'fm', :'ag');
update public.projects set visibility = 'public' where id = :'proj';
select s.slug as lslug from public.public_link_slugs s where s.link_id = :'llink' and s.is_current \gset
select s.slug as aslug from public.public_link_slugs s where s.link_id = :'alink' and s.is_current \gset
select s.slug as fslug from public.public_link_slugs s where s.link_id = :'flink' and s.is_current \gset

select v37_test.val('S01 save_children wrote 2 cards, 2 presets (the empty one skipped) and 1 frame', format($q$select (select count(*) from public.landing_cards where node_id='%s')::text || '/' || (select count(*) from public.landing_share_presets p join public.landing_cards c on c.id=p.card_id where c.node_id='%s')::text || '/' || (select count(*) from public.landing_frames where node_id='%s')::text$q$, :'ld', :'ld', :'ld'), '2/2/1');
select v37_test.val('S02 a card bound to a node stores NO url (cta_url dropped, cta_node_id kept)', format($q$select (cta_url is null)::text || '/' || (cta_node_id = '%s')::text from public.landing_cards where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$, :'fm'), 'true/true');
select v37_test.val('S03 the frame is stored as 4:5 with its window', format($q$select aspect || ' ' || window_x || ',' || window_y || ',' || window_w || ',' || window_h from public.landing_frames where node_id='%s'$q$, :'ld'), '4:5 90,90,900,930');

-- ================================================================= stable ids + analytics survive a save
insert into public.node_events (project_id, node_id, event_type, card_id) values (:'proj', :'ld', 'cta_click', 'aaaaaaaa-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'ld', (select r.rev from public.node_revisions r where r.node_id = :'ld'), '{}'::jsonb,
  jsonb_build_object('cards', jsonb_build_array(
      jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000001','sort_order',1,'title_en','Card A renamed','cta_node_id', :'fm','cta_dot',true,'share_enabled',true,
        'presets', jsonb_build_object('whatsapp','New text {link}')),
      jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000002','sort_order',0,'title_en','Card B','cta_url','https://athareg.com/apply','share_enabled',false)))) as saved2 \gset
reset role;
select v37_test.val('T01 card ids are stable across a save (update by id, never delete-all)', format($q$select (select count(*) from public.landing_cards where node_id='%s' and id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002'))::text$q$, :'ld'), '2');
select v37_test.val('T02 the reorder and the rename landed', format($q$select string_agg(title_en, ',' order by sort_order) from public.landing_cards where node_id='%s'$q$, :'ld'), 'Card B,Card A renamed');
select v37_test.val('T03 the analytics event still points at its card after the save', $q$select card_id::text from public.node_events where event_type = 'cta_click' and card_id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$, 'aaaaaaaa-0000-4000-8000-000000000001');
select v37_test.val('T04 presets were REPLACED for that card (old telegram text gone, new whatsapp text kept)', $q$select count(*)::text || ':' || max(body) from public.landing_share_presets where card_id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$, '1:New text {link}');
select v37_test.val('T05 the frames part was not sent, so the frame is untouched', format($q$select count(*)::text from public.landing_frames where node_id='%s'$q$, :'ld'), '1');

-- ================================================================= validation (as the PM)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.fails('V01 javascript: button link refused with the landing_invalid token', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"cards":[{"title_en":"x","cta_url":"javascript:alert(1)"}]}'::jsonb)$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V02 javascript: share link refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"cards":[{"title_en":"x","share_url":"data:text/html,x"}]}'::jsonb)$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V03 a cover stored in another project is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"cards":[{"title_en":"x","cover_path":"11111111-1111-4111-8111-111111111111/landing/x.webp"}]}'::jsonb)$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V04 an unknown share platform is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"cards":[{"title_en":"x","presets":{"myspace":"hi"}}]}'::jsonb)$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V05 a share text over 2000 characters is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('cards', jsonb_build_array(jsonb_build_object('title_en','x','presets', jsonb_build_object('whatsapp', repeat('a', 2001))))))$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V06 more than 24 cards refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, jsonb_build_object('cards', (select jsonb_agg(jsonb_build_object('title_en','c' || g)) from generate_series(1,25) g)))$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V07 a frame outside the project folder is refused', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"frames":[{"name":"x","image_path":"11111111-1111-4111-8111-111111111111/landing/f.png"}]}'::jsonb)$q$, :'ld', :'ld'), '22023', 'landing_invalid');
select v37_test.fails('V08 a card id that belongs to another node is refused (42501)', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"cards":[{"id":"aaaaaaaa-0000-4000-8000-000000000001","title_en":"steal"}]}'::jsonb)$q$, :'ld2', :'ld2'), '42501');
select v37_test.val('V09 nothing of the refused saves persisted', format($q$select count(*)::text from public.landing_cards where node_id='%s'$q$, :'ld'), '2');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.fails('V10 a founder without participation cannot save the node (forbidden)', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{}'::jsonb, '{"cards":[]}'::jsonb)$q$, :'ld', :'ld'), '42501');
select v37_test.fails('V11 nor read the analytics (forbidden)', format($q$select public.get_landing_analytics('%s')$q$, :'ld'), '42501');
reset role;

-- ================================================================= public payload (anon)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v37_test.val('P01 anon: a public landing with its link is served', format($q$select (public.get_public_landing('%s') is not null)::text$q$, :'lslug'), 'true');
select v37_test.val('P02 anon: the form link resolves for the card bound to the form node', format($q$select (public.get_public_landing('%s')->'data'->'cards'->1->'cta_link')::text$q$, :'lslug'), format('{"kind": "form", "slug": "%s"}', :'fslug'));
select v37_test.val('P03 anon: typed URL cards carry cta_url and no link descriptor', format($q$select (public.get_public_landing('%s')->'data'->'cards'->0->>'cta_url') || ' ' || coalesce((public.get_public_landing('%s')->'data'->'cards'->0->'cta_link')::text, 'null')$q$, :'lslug', :'lslug'), 'https://athareg.com/apply null');
select v37_test.val('P04 anon: share presets travel with the card (per card, per platform)', format($q$select (public.get_public_landing('%s')->'data'->'cards'->1->'presets')::text$q$, :'lslug'), '{"whatsapp": "New text {link}"}');
select v37_test.val('P05 anon: frames travel with their window', format($q$select (public.get_public_landing('%s')->'data'->'frames'->0->>'window_w') || '/' || (public.get_public_landing('%s')->'data'->'frames'->0->>'aspect')$q$, :'lslug', :'lslug'), '900/4:5');
select v37_test.val('P06 anon: the config is whitelisted (secretKey never leaks)', format($q$select ((public.get_public_landing('%s')->'data'->'config') ? 'secretKey')::text || '/' || (public.get_public_landing('%s')->'data'->'config'->'hero'->'title'->>'ar')$q$, :'lslug', :'lslug'), 'false/ساعد');
select v37_test.val('P07 anon: the payload carries the node id (the agenda tab needs it for analytics) and no PM-only keys', format($q$select ((public.get_public_landing('%s')->'data' ? 'node_id') and not (public.get_public_landing('%s')->'data' ? 'analytics') and not (public.get_public_landing('%s') ? 'created_by'))::text$q$, :'lslug', :'lslug', :'lslug'), 'true');
select v37_test.val('P08 anon: an unknown ref answers null', $q$select (public.get_public_landing('nope-nope-nope') is null)::text$q$, 'true');
select v37_test.val('P09 anon: the agenda tab carries the same payload (cards + presets + frames)', format($q$select jsonb_array_length(public.get_public_tab('%s', '%s')->'data'->'cards')::text || '/' || jsonb_array_length(public.get_public_tab('%s', '%s')->'data'->'frames')::text || '/' || (public.get_public_tab('%s', '%s')->'data'->'cards'->1->'presets'->>'whatsapp')$q$, :'aslug', :'e1', :'aslug', :'e1', :'aslug', :'e1'), '2/1/New text {link}');
reset role;
-- visibility and the private target
update public.nodes set visibility = 'private' where id = :'fm';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v37_test.val('P10 anon: a card bound to a PRIVATE node carries no link (nothing to open)', format($q$select coalesce((public.get_public_landing('%s')->'data'->'cards'->1->'cta_link')::text, 'null')$q$, :'lslug'), 'null');
reset role;
update public.nodes set visibility = 'public' where id = :'fm';
update public.nodes set visibility = 'private' where id = :'ld';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v37_test.val('P11 anon: a private landing is not served (null, no existence leak)', format($q$select (public.get_public_landing('%s') is null)::text$q$, :'lslug'), 'true');
select v37_test.val('P12 anon: nor as an agenda tab', format($q$select (public.get_public_tab('%s', '%s') is null)::text$q$, :'aslug', :'e1'), 'true');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.val('P13 the project manager still previews a private landing (viewer pm)', format($q$select public.get_public_landing('%s')->>'viewer'$q$, :'lslug'), 'pm');
reset role;
update public.nodes set visibility = 'public' where id = :'ld';

-- ================================================================= analytics write (anon)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select public.track_landing_event(:'lslug', 'tab_view');
select public.track_landing_event(:'lslug', 'card_share', 'aaaaaaaa-0000-4000-8000-000000000001', 'whatsapp');
select public.track_landing_event(:'lslug', 'cta_click', 'aaaaaaaa-0000-4000-8000-000000000002');
select public.track_landing_event(:'lslug', 'image_upload');
select public.track_landing_event(:'lslug', 'image_download');
select public.track_landing_event(:'lslug', 'share_copy', 'aaaaaaaa-0000-4000-8000-000000000001', 'copy');
select public.track_landing_event(:'lslug', 'card_share', 'aaaaaaaa-0000-4000-8000-000000000001', 'myspace');
select public.track_landing_event(:'lslug', 'drop table', null, null);
select public.track_landing_event(:'lslug', 'cta_click', '99999999-9999-4999-8999-999999999999');
select public.track_landing_event('nope-nope-nope', 'tab_view');
reset role;
select v37_test.val('E01 the 7 valid events were recorded (+ the seed row); the unknown type, the foreign card and the unknown ref were dropped', format($q$select count(*)::text from public.node_events where node_id='%s'$q$, :'ld'), '8');
select v37_test.val('E02 an unknown platform is stored as NULL, a known one is kept', format($q$select (select count(*) from public.node_events where node_id='%s' and event_type='card_share' and platform = 'whatsapp')::text || '/' || (select count(*) from public.node_events where node_id='%s' and event_type='card_share' and platform is null)::text$q$, :'ld', :'ld'), '1/1');
select v37_test.val('E03 an event keeps its stable card id', format($q$select count(*)::text from public.node_events where node_id='%s' and card_id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$, :'ld'), '4');
select v37_test.val('E04 no event row carries anything but ids, type, platform and time (no ip / agent column exists)', $q$select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='node_events'$q$, 'id,project_id,node_id,event_type,card_id,platform,created_at');
-- as an agenda TAB: the visitor's ref is the agenda's, the node id travels along
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select public.track_landing_event(:'aslug', 'tab_view', null, null, :'ld');
select public.track_landing_event(:'aslug', 'cta_click', 'aaaaaaaa-0000-4000-8000-000000000001', null, :'ld');
select public.track_landing_event(:'aslug', 'tab_view', null, null, :'ld2');
select public.track_landing_event(:'aslug', 'tab_view');
reset role;
select v37_test.val('E05 as an agenda tab: 2 more events on the landing node; a landing node that is NOT a tab of that agenda and a missing node id are ignored', format($q$select (select count(*) from public.node_events where node_id='%s')::text || '/' || (select count(*) from public.node_events where node_id='%s')::text$q$, :'ld', :'ld2'), '10/0');
-- analytics switched off
update public.nodes set config = jsonb_set(config, '{analytics,enabled}', 'false') where id = :'ld';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select public.track_landing_event(:'lslug', 'tab_view');
reset role;
select v37_test.val('E06 analytics.enabled = false: nothing is recorded', format($q$select count(*)::text from public.node_events where node_id='%s'$q$, :'ld'), '10');
update public.nodes set config = jsonb_set(config, '{analytics,enabled}', 'true') where id = :'ld';
-- a PM visit is not counted
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select public.track_landing_event(:'lslug', 'tab_view');
reset role;
select v37_test.val('E07 a project manager previewing is not a visit', format($q$select count(*)::text from public.node_events where node_id='%s'$q$, :'ld'), '10');
-- rate limit: 120 events / 10 minutes per (node, caller)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select public.track_landing_event(:'lslug', 'tab_view') from generate_series(1, 140);
reset role;
select v37_test.val('E08 rate limit: 120 events per window through the RPC (9 before the burst + 111 of it) + the seed row', format($q$select count(*)::text from public.node_events where node_id='%s'$q$, :'ld'), '121');
select v37_test.val('E09 the limiter stores a one-way bucket hash only (32 hex chars, no address)', $q$select (count(*) > 0 and bool_and(bucket ~ '^[0-9a-f]{32}$'))::text from app_private.landing_event_limits$q$, 'true');

-- ================================================================= analytics read (PM)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.val('R01 PM: totals include the recorded types and the all-time count', format($q$select (public.get_landing_analytics('%s')->'totals'->>'card_share') || '/' || (public.get_landing_analytics('%s')->>'all_time')$q$, :'ld', :'ld'), '2/121');
select v37_test.val('R02 PM: per-card rows carry the stable card id', format($q$select (select count(*) from jsonb_array_elements(public.get_landing_analytics('%s')->'by_card') x where x->>'card_id' = 'aaaaaaaa-0000-4000-8000-000000000001')::text$q$, :'ld'), '3');
select v37_test.val('R03 PM: per-platform rows only for events that have a platform', format($q$select (select string_agg(x->>'platform', ',' order by x->>'platform') from jsonb_array_elements(public.get_landing_analytics('%s')->'by_platform') x)$q$, :'ld'), 'copy,whatsapp');
select v37_test.val('R04 PM: a daily series exists', format($q$select (jsonb_array_length(public.get_landing_analytics('%s')->'by_day') > 0)::text$q$, :'ld'), 'true');
reset role;

-- ================================================================= removing a card keeps its history (card_id -> NULL), deletes the card
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select public.save_node(:'ld', (select r.rev from public.node_revisions r where r.node_id = :'ld'), '{}'::jsonb,
  '{"cards":[{"id":"aaaaaaaa-0000-4000-8000-000000000002","sort_order":0,"title_en":"Card B","cta_url":"https://athareg.com/apply"}]}'::jsonb) as saved3 \gset
reset role;
select v37_test.val('D01 the removed card is gone, the other kept its id', format($q$select count(*)::text || ':' || min(id::text) from public.landing_cards where node_id='%s'$q$, :'ld'), '1:aaaaaaaa-0000-4000-8000-000000000002');
select v37_test.val('D02 the removed card''s presets went with it', $q$select count(*)::text from public.landing_share_presets where card_id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$, '0');
select v37_test.val('D03 its events survive with card_id NULL (totals intact)', format($q$select (select count(*) from public.node_events where node_id='%s')::text || '/' || (select count(*) from public.node_events where node_id='%s' and event_type = 'cta_click' and card_id is null)::text$q$, :'ld', :'ld'), '121/2');

-- ================================================================= founder exposure (list_founder_landings)
insert into public.participants (project_id, user_id, source, status) values (:'proj', '00000000-0000-4000-8000-00000000b0f7', 'manual', 'accepted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0d7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.val('F01 PM: nothing is listed while show_to_participants is false', format($q$select jsonb_array_length(public.list_founder_landings('%s'))::text$q$, :'proj'), '0');
select v37_test.okrun('F02 PM: expose the landing to participants', format($q$select public.save_node('%s', (select r.rev from public.node_revisions r where r.node_id = '%s'), '{"show_to_participants": true}')$q$, :'ld', :'ld'));
select v37_test.val('F03 PM: listed once with its own slug', format($q$select (select (v->0->>'name_en') || ' ' || (v->0->>'ref') from (select public.list_founder_landings('%s') v) x)$q$, :'proj'), 'V37 Landing ' || :'lslug');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.val('F04 participant founder: sees the exposed landing', format($q$select jsonb_array_length(public.list_founder_landings('%s'))::text$q$, :'proj'), '1');
reset role;
update public.nodes set visibility = 'private' where id = :'ld';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.val('F05 participant founder: a PRIVATE landing is never listed', format($q$select jsonb_array_length(public.list_founder_landings('%s'))::text$q$, :'proj'), '0');
reset role;
update public.nodes set visibility = 'public' where id = :'ld';
delete from public.participants where project_id = :'proj';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b0f7","role":"authenticated"}', true);
set local role authenticated;
select v37_test.fails('F06 a founder without participation: forbidden', format($q$select public.list_founder_landings('%s')$q$, :'proj'), '42501');
reset role;
select v37_test.val('F07 anon cannot execute it (privilege catalog)', $q$select has_function_privilege('anon','public.list_founder_landings(uuid)','EXECUTE')::text$q$, 'false');

select current_setting('v37.res', true) as res \gset
rollback;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v37: landing RPC tests FAILED'; end $$;
\endif
