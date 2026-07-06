-- Canonical SliceMatic schema repair for local Postgres and Supabase Postgres.
-- Safe to run repeatedly. It preserves existing orders and normalizes drifted
-- order channel data to orders."type" = online | dine_in | takeaway.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
    id uuid primary key default gen_random_uuid(),
    role text not null default 'user',
    name text,
    full_name text,
    phone text,
    email text,
    emp_id text,
    address jsonb,
    secret_hash text,
    is_active boolean not null default true,
    status text not null default 'active',
    failed_attempts integer not null default 0,
    locked_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.app_users add column if not exists role text default 'user';
alter table public.app_users add column if not exists name text;
alter table public.app_users add column if not exists full_name text;
alter table public.app_users add column if not exists phone text;
alter table public.app_users add column if not exists email text;
alter table public.app_users add column if not exists emp_id text;
alter table public.app_users add column if not exists address jsonb;
alter table public.app_users add column if not exists secret_hash text;
alter table public.app_users add column if not exists is_active boolean default true;
alter table public.app_users add column if not exists status text default 'active';
alter table public.app_users add column if not exists failed_attempts integer default 0;
alter table public.app_users add column if not exists locked_until timestamptz;
alter table public.app_users add column if not exists created_at timestamptz default now();
alter table public.app_users add column if not exists updated_at timestamptz default now();
alter table public.app_users alter column email drop not null;
alter table public.app_users alter column phone drop not null;
alter table public.app_users alter column emp_id drop not null;
alter table public.app_users alter column name drop not null;
alter table public.app_users alter column full_name drop not null;

update public.app_users
set name = coalesce(name, full_name),
    full_name = coalesce(full_name, name),
    role = coalesce(role, 'user'),
    is_active = coalesce(is_active, status is distinct from 'inactive', true),
    status = coalesce(status, case when coalesce(is_active, true) then 'active' else 'inactive' end),
    failed_attempts = coalesce(failed_attempts, 0);

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    order_no text unique,
    user_id uuid references public.app_users(id) on delete set null,
    session_id text,
    source text,
    customer_name text,
    customer_phone text,
    base_name text,
    pizza_name text,
    topping_name text,
    unit_price numeric,
    quantity integer,
    items jsonb,
    subtotal numeric not null default 0,
    discount numeric not null default 0,
    gst numeric not null default 0,
    total numeric not null default 0,
    payment_mode text,
    language text,
    status text not null default 'received',
    delivery_address text,
    "type" text not null default 'online',
    rider_id uuid references public.app_users(id) on delete set null,
    logged_at timestamptz,
    created_at timestamptz not null default now(),
    preparing_at timestamptz,
    ready_at timestamptz,
    out_for_delivery_at timestamptz,
    delivered_at timestamptz
);

alter table public.orders add column if not exists id uuid default gen_random_uuid();
alter table public.orders add column if not exists order_no text;
alter table public.orders add column if not exists user_id uuid;
alter table public.orders add column if not exists session_id text;
alter table public.orders add column if not exists source text;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_phone text;
alter table public.orders add column if not exists base_name text;
alter table public.orders add column if not exists pizza_name text;
alter table public.orders add column if not exists topping_name text;
alter table public.orders add column if not exists unit_price numeric;
alter table public.orders add column if not exists quantity integer;
alter table public.orders add column if not exists items jsonb;
alter table public.orders add column if not exists subtotal numeric default 0;
alter table public.orders add column if not exists discount numeric default 0;
alter table public.orders add column if not exists gst numeric default 0;
alter table public.orders add column if not exists total numeric default 0;
alter table public.orders add column if not exists payment_mode text;
alter table public.orders add column if not exists language text;
alter table public.orders add column if not exists status text default 'received';
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists "type" text default 'online';
alter table public.orders add column if not exists rider_id uuid;
alter table public.orders add column if not exists logged_at timestamptz;
alter table public.orders add column if not exists created_at timestamptz default now();
alter table public.orders add column if not exists preparing_at timestamptz;
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists out_for_delivery_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;

create sequence if not exists public.orders_order_no_seq;

alter table public.orders
    alter column order_no set default (
        'SM-' || to_char(now(), 'YYYYMMDD') || '-' ||
        lpad(nextval('public.orders_order_no_seq')::text, 4, '0')
    );

do $$
declare
    constraint_name text;
begin
    for constraint_name in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = 'orders'
          and con.contype = 'c'
          and (
              pg_get_constraintdef(con.oid) ilike '%order_type%'
              or pg_get_constraintdef(con.oid) ilike '%type%'
              or pg_get_constraintdef(con.oid) ilike '%status%'
          )
    loop
        execute format('alter table public.orders drop constraint if exists %I', constraint_name);
    end loop;
end $$;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'orders'
          and column_name = 'order_type'
    ) then
        execute $sql$
            update public.orders
            set "type" = case
                    when lower(coalesce("type", order_type, '')) in ('online', 'delivery') then 'online'
                    when lower(coalesce("type", order_type, '')) in ('dine_in', 'dine-in') then 'dine_in'
                    when lower(coalesce("type", order_type, '')) in ('takeaway', 'pickup', 'in-store', 'store') then 'takeaway'
                    when source = 'staff_pos' then 'takeaway'
                    else 'online'
                end
        $sql$;
    end if;
end $$;

update public.orders
set "type" = case
        when lower(coalesce("type", '')) in ('online', 'delivery') then 'online'
        when lower(coalesce("type", '')) in ('dine_in', 'dine-in') then 'dine_in'
        when lower(coalesce("type", '')) in ('takeaway', 'pickup', 'in-store', 'store') then 'takeaway'
        when source = 'staff_pos' then 'takeaway'
        else 'online'
    end,
    status = case
        when status is null or status = '' then 'received'
        when lower(status) = 'confirmed' then 'received'
        when lower(status) = 'ready' then 'ready_for_pickup'
        when lower(status) = 'completed' then 'delivered'
        when lower(status) = 'refundrequested' then 'refund_requested'
        else lower(status)
    end,
    created_at = coalesce(
        created_at,
        case
            when nullif(logged_at::text, '') is not null
             and logged_at::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                then logged_at::text::timestamptz
            else null
        end,
        now()
    ),
    subtotal = coalesce(subtotal, 0),
    discount = coalesce(discount, 0),
    gst = coalesce(gst, 0),
    total = coalesce(total, 0);

do $$
declare
    constraint_name text;
begin
    for constraint_name in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = 'orders'
          and con.contype = 'c'
          and (
              pg_get_constraintdef(con.oid) ilike '%order_type%'
              or pg_get_constraintdef(con.oid) ilike '%type%'
              or pg_get_constraintdef(con.oid) ilike '%status%'
          )
    loop
        execute format('alter table public.orders drop constraint if exists %I', constraint_name);
    end loop;
end $$;

alter table public.orders
    add constraint orders_type_check
    check ("type" in ('online', 'dine_in', 'takeaway'));

alter table public.orders
    add constraint orders_status_check
    check (
        status in (
            'received',
            'preparing',
            'ready_for_pickup',
            'out_for_delivery',
            'delivered',
            'payment_pending',
            'confirmed',
            'completed',
            'cancelled',
            'refund_requested',
            'refunded',
            'created',
            'refundrequested'
        )
    );

update public.orders o
set user_id = null
where user_id is not null
  and not exists (
      select 1 from public.app_users u where u.id = o.user_id
  );

update public.orders o
set rider_id = null
where rider_id is not null
  and not exists (
      select 1 from public.app_users u where u.id = o.rider_id
  );

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'orders_user_id_fkey'
          and conrelid = 'public.orders'::regclass
    ) then
        alter table public.orders
            add constraint orders_user_id_fkey
            foreign key (user_id) references public.app_users(id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'orders_rider_id_fkey'
          and conrelid = 'public.orders'::regclass
    ) then
        alter table public.orders
            add constraint orders_rider_id_fkey
            foreign key (rider_id) references public.app_users(id) on delete set null;
    end if;
end $$;

create unique index if not exists idx_orders_order_no_unique
    on public.orders(order_no)
    where order_no is not null;
create index if not exists idx_orders_type_status
    on public.orders("type", status, created_at desc);
create index if not exists idx_orders_customer_phone
    on public.orders(customer_phone, created_at desc);
create index if not exists idx_orders_user_id
    on public.orders(user_id, created_at desc);
create index if not exists idx_orders_rider_id
    on public.orders(rider_id);

do $$
begin
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_app_users_email_unique'
    ) and not exists (
        select 1
        from public.app_users
        where email is not null
        group by lower(email)
        having count(*) > 1
    ) then
        create unique index idx_app_users_email_unique
            on public.app_users(lower(email))
            where email is not null;
    end if;
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_app_users_phone_unique'
    ) and not exists (
        select 1
        from public.app_users
        where phone is not null
        group by phone
        having count(*) > 1
    ) then
        create unique index idx_app_users_phone_unique
            on public.app_users(phone)
            where phone is not null;
    end if;
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_app_users_emp_id_unique'
    ) and not exists (
        select 1
        from public.app_users
        where emp_id is not null
        group by emp_id
        having count(*) > 1
    ) then
        create unique index idx_app_users_emp_id_unique
            on public.app_users(emp_id)
            where emp_id is not null;
    end if;
end $$;

create index if not exists idx_app_users_role
    on public.app_users(role);
