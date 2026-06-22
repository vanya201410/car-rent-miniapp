# Car Rent Telegram Mini App — v10 discount rules

Эта версия добавляет нормальную систему скидок по сроку аренды.

Что добавлено:
- скидки хранятся в таблице `discount_rules`;
- приложение само загружает активные скидки из Supabase;
- клиент видит правила скидок в карточке машины;
- расчёт показывает цену без скидки, сумму скидки и итог;
- в `/admin` появляется раздел 💸 Скидки;
- команды администратора:
  - `/discount 7 10 Скидка 10% от 7 дней`
  - `/discount 14 15 Скидка 15% от 14 дней`
  - `/discountoff 3`
  - `/discounton 3`
- весь функционал v9 сохраняется.

## SQL для Supabase

Выполнить в Supabase → SQL Editor:

```sql
alter table public.cars
add column if not exists image_url text;

alter table public.bookings
add column if not exists telegram_user_id text,
add column if not exists telegram_username text,
add column if not exists base_price numeric default 0,
add column if not exists extras_total numeric default 0,
add column if not exists extras jsonb default '{}'::jsonb,
add column if not exists discount_percent numeric default 0,
add column if not exists discount_amount numeric default 0,
add column if not exists discount_label text;

create index if not exists bookings_car_status_dates_idx
on public.bookings (car_id, status, start_date, end_date);

create table if not exists public.car_photos (
  id bigserial primary key,
  car_id int8 not null references public.cars(id) on delete cascade,
  image_url text not null,
  sort_order int4 default 1,
  created_at timestamptz default now()
);

alter table public.car_photos enable row level security;

drop policy if exists "Public can read car photos" on public.car_photos;

create policy "Public can read car photos"
on public.car_photos
for select
to anon
using (true);

create index if not exists car_photos_car_sort_idx
on public.car_photos (car_id, sort_order);

create table if not exists public.blocked_dates (
  id bigserial primary key,
  car_id int8 not null references public.cars(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz default now()
);

alter table public.blocked_dates enable row level security;

drop policy if exists "Public can read blocked dates" on public.blocked_dates;

create policy "Public can read blocked dates"
on public.blocked_dates
for select
to anon
using (true);

create index if not exists blocked_dates_car_dates_idx
on public.blocked_dates (car_id, start_date, end_date);

create table if not exists public.admin_sessions (
  admin_id text primary key,
  flow text not null,
  step text not null,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.admin_sessions enable row level security;

create table if not exists public.discount_rules (
  id bigserial primary key,
  min_days int4 not null,
  discount_percent numeric not null default 0,
  label text,
  is_active bool default true,
  sort_order int4 default 1,
  created_at timestamptz default now()
);

alter table public.discount_rules enable row level security;

drop policy if exists "Public can read discount rules" on public.discount_rules;

create policy "Public can read discount rules"
on public.discount_rules
for select
to anon
using (is_active = true);

create index if not exists discount_rules_active_days_idx
on public.discount_rules (is_active, min_days);

insert into public.discount_rules (min_days, discount_percent, label, sort_order)
select 7, 10, 'Скидка 10% за аренду от 7 дней', 1
where not exists (select 1 from public.discount_rules where min_days = 7);

insert into public.discount_rules (min_days, discount_percent, label, sort_order)
select 14, 15, 'Скидка 15% за аренду от 14 дней', 2
where not exists (select 1 from public.discount_rules where min_days = 14);
```

## Как управлять скидками

Открой бота и напиши:

`/admin`

Нажми:

`💸 Скидки`

Добавить или изменить правило:

`/discount 7 10 Скидка 10% от 7 дней`

`/discount 14 15 Скидка 15% от 14 дней`

Выключить скидку:

`/discountoff 1`

Включить обратно:

`/discounton 1`

## Live Stripe payment

Для реальных оплат используйте файл `LIVE_STRIPE_INSTALL.md`.
Этот архив рассчитан на live-ключ Stripe `sk_live_...` и live webhook secret `whsec_...`.
Тестовый webhook bypass удален.
