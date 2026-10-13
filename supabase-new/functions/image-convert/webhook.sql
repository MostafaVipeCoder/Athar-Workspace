-- webhook.sql - wire the image-convert edge function to Storage (design: owner decision 08 section 17.3). NOT run on the local stack and NOT run
-- anywhere yet: it is the checklist for the future LIVE project, run once by the owner AFTER `supabase functions deploy image-convert --no-verify-jwt`
-- and after db/migrations/m41_webp.sql. Placeholders in <angle brackets>; never commit the real secret.
--
-- Option 1 (what the dashboard "Database Webhooks" page creates): a trigger that calls supabase_functions.http_request (pg_net underneath).
-- The webhook secret must be the same value as the function's IMAGE_CONVERT_SECRET (`supabase secrets set IMAGE_CONVERT_SECRET=...`).
begin;

drop trigger if exists image_convert_on_insert on storage.objects;
create trigger image_convert_on_insert
  after insert on storage.objects
  for each row
  when (new.bucket_id in ('public-assets', 'founder-assets', 'resources', 'form-uploads'))
  execute function supabase_functions.http_request(
    'https://<project-ref>.supabase.co/functions/v1/image-convert',
    'POST',
    '{"Content-Type":"application/json","x-webhook-secret":"<IMAGE_CONVERT_SECRET>"}',
    '{}',
    '5000'
  );

commit;

-- Option 2 (secret kept in Vault instead of in the trigger definition): a small SECURITY DEFINER function reads the secret and calls pg_net.
--   select vault.create_secret('<IMAGE_CONVERT_SECRET>', 'image_convert_secret');
--   create or replace function app_private.image_convert_notify() returns trigger language plpgsql security definer set search_path = '' as $$
--   begin
--     perform net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/image-convert',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                                     'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'image_convert_secret')),
--       body := jsonb_build_object('type', 'INSERT', 'schema', 'storage', 'table', 'objects', 'record', jsonb_build_object('bucket_id', new.bucket_id, 'name', new.name, 'metadata', new.metadata)));
--     return new;
--   end $$;
--   create trigger image_convert_on_insert after insert on storage.objects for each row
--     when (new.bucket_id in ('public-assets', 'founder-assets', 'resources', 'form-uploads')) execute function app_private.image_convert_notify();
--
-- Remove it again:  drop trigger if exists image_convert_on_insert on storage.objects;
