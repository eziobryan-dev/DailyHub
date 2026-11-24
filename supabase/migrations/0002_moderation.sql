-- DailyHub: email moderation of suggestions
-- Flow: insert pending game -> trigger -> Edge Function notify-suggestion -> email with
-- signed Accept/Deny links -> moderate.html -> Edge Function moderate -> update/delete.

create extension if not exists pg_net with schema extensions;

-- Private config, not exposed through the REST API
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.config (
  key   text primary key,
  value text not null
);

-- Secrets are generated inside the database and never written in this repo.
-- admin_email is inserted separately (not committed, the repo is public):
--   insert into private.config values ('admin_email', 'you@example.com');
insert into private.config (key, value) values
  ('webhook_secret',    encode(extensions.gen_random_bytes(32), 'hex')),
  ('moderation_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('functions_url',     'https://cithcxrdoemkvmazergr.supabase.co/functions/v1'),
  ('site_url',          'https://eziobryan-dev.github.io/DailyHub');

-- Edge Functions read the config through this RPC, with the service role only
create function public.get_moderation_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(key, value) from private.config;
$$;

revoke execute on function public.get_moderation_config() from public, anon, authenticated;
grant execute on function public.get_moderation_config() to service_role;

-- Call notify-suggestion for every new pending game (async, never blocks the insert)
create function private.notify_new_suggestion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := (select jsonb_object_agg(key, value) from private.config);
begin
  perform net.http_post(
    url     := (cfg ->> 'functions_url') || '/notify-suggestion',
    body    := jsonb_build_object('id', new.id, 'name', new.name, 'url', new.url),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', cfg ->> 'webhook_secret'
    ),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;

create trigger games_notify_new_suggestion
  after insert on public.games
  for each row
  when (new.status = 'pending')
  execute function private.notify_new_suggestion();
