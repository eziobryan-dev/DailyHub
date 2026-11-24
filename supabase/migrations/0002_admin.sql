-- DailyHub: admin page (Supabase Auth with password + TOTP 2FA, enforced by RLS)
-- Only users listed in private.admins, with a confirmed email AND a session
-- verified with 2FA (aal2), can see pending suggestions and add/edit/delete games.

create schema if not exists private;
revoke all on schema private from public, anon;
-- authenticated may call functions in private (used by RLS policies),
-- but has no access to its tables, and the schema is not exposed by the REST API.
grant usage on schema private to authenticated;

create table private.admins (
  email text primary key
);
revoke all on private.admins from public, anon, authenticated;

-- Add the admin email separately (not committed, the repo is public):
--   insert into private.admins values ('you@example.com');

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1
       from auth.users u
       join private.admins a on lower(a.email) = lower(u.email)
       where u.id = auth.uid()
         and u.email_confirmed_at is not null
     );
$$;

revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

grant select, insert, update, delete on public.games to authenticated;

create policy "Admins see every game"
  on public.games for select
  to authenticated
  using ((select private.is_admin()));

create policy "Admins add games"
  on public.games for insert
  to authenticated
  with check ((select private.is_admin()));

create policy "Admins edit games"
  on public.games for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Admins delete games"
  on public.games for delete
  to authenticated
  using ((select private.is_admin()));
