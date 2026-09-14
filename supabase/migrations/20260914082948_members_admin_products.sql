-- Member, administration, and catalog data model.
-- Browser clients use Supabase Auth for identity. All management operations and
-- opaque session-token handling remain server-side through the service_role key.

create table if not exists public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text unique check (email is null or char_length(btrim(email)) between 3 and 320),
  phone text check (phone is null or char_length(btrim(phone)) between 7 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists members_role_status_idx on public.members(role, status);

-- Metadata is used only for an initial display name. It never participates in
-- authorization; role and status are maintained by trusted server-side code.
create or replace function public.sync_member_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.members (id, name, email, phone)
    values (
      new.id,
      left(
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
          nullif(split_part(new.email, '@', 1), ''),
          '회원'
        ),
        120
      ),
      new.email,
      new.phone
    )
    on conflict (id) do nothing;
  elsif new.email is distinct from old.email or new.phone is distinct from old.phone then
    update public.members
       set email = new.email,
           phone = new.phone
     where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_member_from_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_member_sync on auth.users;
create trigger on_auth_user_member_sync
  after insert or update of email, phone on auth.users
  for each row execute function public.sync_member_from_auth_user();

create or replace function public.set_goodsflap_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_goodsflap_updated_at() from public, anon, authenticated;

drop trigger if exists members_set_updated_at on public.members;
create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_goodsflap_updated_at();

create table if not exists public.member_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) >= 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists member_sessions_active_member_idx
  on public.member_sessions(member_id, expires_at desc)
  where revoked_at is null;

create table if not exists public.catalog_products (
  id text primary key check (char_length(btrim(id)) between 1 and 120),
  body jsonb not null default '{}'::jsonb check (jsonb_typeof(body) = 'object'),
  visible boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_products_visible_sort_idx
  on public.catalog_products(visible, sort_order, id);

drop trigger if exists catalog_products_set_updated_at on public.catalog_products;
create trigger catalog_products_set_updated_at
  before update on public.catalog_products
  for each row execute function public.set_goodsflap_updated_at();

alter table public.assets
  add column if not exists member_id uuid references public.members(id) on delete set null;

create index if not exists assets_member_created_idx
  on public.assets(member_id, created_at desc)
  where member_id is not null;

alter table public.orders
  add column if not exists member_id uuid references public.members(id) on delete set null;

create index if not exists orders_member_created_idx
  on public.orders(member_id, created_at desc)
  where member_id is not null;

-- All tables in the exposed public schema remain protected by RLS. Session,
-- order, and management access runs only through the server's service_role key.
alter table public.members enable row level security;
alter table public.member_sessions enable row level security;
alter table public.catalog_products enable row level security;
alter table public.orders enable row level security;

revoke all on table public.members from anon, authenticated;
revoke all on table public.member_sessions from anon, authenticated;
revoke all on table public.catalog_products from anon, authenticated;
revoke all on table public.orders from anon, authenticated;

grant select on table public.members to authenticated;
grant update (name, phone) on table public.members to authenticated;
grant select on table public.catalog_products to anon, authenticated;
grant select, insert, update, delete on table public.members to service_role;
grant select, insert, update, delete on table public.member_sessions to service_role;
grant select, insert, update, delete on table public.catalog_products to service_role;
grant select, insert, update, delete on table public.orders to service_role;

drop policy if exists members_read_own_profile on public.members;
create policy members_read_own_profile
  on public.members
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists members_update_own_active_profile on public.members;
create policy members_update_own_active_profile
  on public.members
  for update
  to authenticated
  using ((select auth.uid()) = id and status = 'active')
  with check ((select auth.uid()) = id and status = 'active');

drop policy if exists catalog_products_read_visible on public.catalog_products;
create policy catalog_products_read_visible
  on public.catalog_products
  for select
  to anon, authenticated
  using (visible = true);
