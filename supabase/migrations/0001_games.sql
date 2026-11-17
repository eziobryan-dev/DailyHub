-- DailyHub: games catalog + public suggestions
create table public.games (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  url         text not null unique check (url ~* '^https?://' and char_length(url) <= 500),
  preview_url text check (preview_url is null or preview_url ~* '^https://'),
  status      text not null default 'pending' check (status in ('pending', 'approved')),
  created_at  timestamptz not null default now()
);

alter table public.games enable row level security;

grant select, insert on public.games to anon, authenticated;

-- Everyone can read approved games only
create policy "Approved games are public"
  on public.games for select
  to anon, authenticated
  using (status = 'approved');

-- Everyone can suggest a game, but it always lands as pending
create policy "Anyone can suggest a game"
  on public.games for insert
  to anon, authenticated
  with check (status = 'pending' and preview_url is null);

-- No update/delete policies: moderation happens in the Supabase dashboard.
