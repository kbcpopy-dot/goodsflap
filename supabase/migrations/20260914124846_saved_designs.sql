-- Saved works belong to the member and are accessed only through the server-side service role.
create table if not exists public.saved_designs (
  id uuid primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_designs_member_updated_idx
  on public.saved_designs(member_id, updated_at desc);

alter table public.saved_designs enable row level security;
revoke all on table public.saved_designs from anon, authenticated;
grant select, insert, update, delete on table public.saved_designs to service_role;

drop trigger if exists saved_designs_set_updated_at on public.saved_designs;
create trigger saved_designs_set_updated_at
  before update on public.saved_designs
  for each row execute function public.set_goodsflap_updated_at();
