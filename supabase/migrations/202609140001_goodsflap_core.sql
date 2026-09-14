create table if not exists public.assets (
  id uuid primary key,
  session_hash text not null,
  format text not null check (format in ('png','jpeg','webp')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  original_path text not null unique,
  normalized_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists assets_session_hash_idx on public.assets(session_hash);
create table if not exists public.orders (
  id text primary key,
  session_hash text not null,
  body jsonb not null,
  status text not null check (status in ('demo','pending','paid','production','shipped')),
  payment_key text,
  created_at timestamptz not null default now()
);
create index if not exists orders_session_created_idx on public.orders(session_hash,created_at desc);
alter table public.assets enable row level security;
alter table public.orders enable row level security;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('customer-originals','customer-originals',false,10485760,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('design-previews','design-previews',false,15728640,array['image/png'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
