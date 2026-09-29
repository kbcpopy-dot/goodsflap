-- Private cart snapshots; only the application server authorizes access.
create table public.member_carts (
 member_id uuid primary key references public.members(id) on delete cascade,
 items jsonb not null default '[]'::jsonb check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=20),
 version uuid not null,
 updated_at timestamptz not null default now()
);
alter table public.member_carts enable row level security;
revoke all on public.member_carts from anon, authenticated;
grant select, insert, update, delete on public.member_carts to service_role;
create index member_carts_updated_idx on public.member_carts(updated_at desc);
