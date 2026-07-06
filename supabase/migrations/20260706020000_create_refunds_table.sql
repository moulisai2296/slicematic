-- Migration: Create refunds table
-- Ensures customers can only have one active refund per order.

create table if not exists public.refunds (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references public.orders(id) on delete cascade not null,
    customer_id uuid references public.app_users(id) on delete set null,
    status text not null default 'REQUESTED',
    reason text not null,
    admin_response text,
    refund_amount numeric not null default 0,
    requested_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.app_users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Ensure a customer can only request a refund once per order
do $$
begin
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_refunds_order_id_unique'
    ) then
        create unique index idx_refunds_order_id_unique
            on public.refunds(order_id);
    end if;
end $$;

alter table public.refunds
    drop constraint if exists refunds_status_check;

alter table public.refunds
    add constraint refunds_status_check
    check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'));

create index if not exists idx_refunds_customer_id
    on public.refunds(customer_id, requested_at desc);

create index if not exists idx_refunds_status
    on public.refunds(status, requested_at desc);
