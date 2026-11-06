-- The parts of a Supabase project the migrations rely on, for a plain Postgres
-- test database (local dev stack or CI). Mirrors what Supabase provides:
-- the anon/authenticated/service_role roles, auth.users and auth.uid()/jwt()/role(),
-- an extensions schema and the supabase_realtime publication.
-- Used only by scripts/test-db-setup.ts on a throwaway database.

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema extensions;
create schema auth;
create publication supabase_realtime;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
-- The same default grants a Supabase project starts with; RLS is what restricts access.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
create function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create function auth.uid() returns uuid language sql stable as
  $f$ select nullif(auth.jwt() ->> 'sub', '')::uuid $f$;
create function auth.role() returns text language sql stable as
  $f$ select auth.jwt() ->> 'role' $f$;
