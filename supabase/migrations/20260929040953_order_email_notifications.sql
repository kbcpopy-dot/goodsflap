create table public.order_email_notifications (
 order_id text primary key references public.orders(id) on delete cascade,
 payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','failed')),
 claim_token text, first_attempt_at timestamptz, last_attempt_at timestamptz,
 provider_id text, sent_at timestamptz, error text
);
alter table public.order_email_notifications enable row level security;
revoke all on public.order_email_notifications from anon, authenticated;
grant select, insert, update, delete on public.order_email_notifications to service_role;
