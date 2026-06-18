# Car Rent Telegram Mini App — v9 add car admin

Эта версия добавляет красивое добавление машин прямо из Telegram.

Что добавлено:
- кнопка ➕ Добавить машину в `/admin`;
- пошаговый мастер добавления машины;
- бот спрашивает марку, модель, год, цену, залог, коробку, топливо, места, город и описание;
- после создания машины можно отправить фото прямо в Telegram;
- фото автоматически загружаются в Supabase Storage `car-photos`;
- фото автоматически добавляются в таблицу `car_photos`;
- команда `/done` завершает добавление фото;
- команда `/cancel` отменяет текущий мастер;
- весь функционал v8 сохраняется.

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
add column if not exists extras jsonb default '{}'::jsonb;

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
```

## Storage

Нужен public bucket:

- `car-photos`

Если его нет:
Supabase → Storage → New bucket → `car-photos` → Public bucket.

## Webhook

Если кнопки подтверждения уже работали, webhook менять не нужно.
