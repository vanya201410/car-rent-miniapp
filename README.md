# Car Rent Telegram Mini App — v8 business pack

Эта версия добавляет большой бизнес-пакет:

- админ-меню в Telegram через `/admin`;
- просмотр новых и подтверждённых заявок из Telegram;
- команды администратора:
  - `/block car_id start_date end_date reason` — заблокировать даты вручную;
  - `/unblock block_id` — удалить ручную блокировку;
  - `/price car_id price` — изменить цену за день;
  - `/hidecar car_id` — скрыть машину из каталога;
  - `/showcar car_id` — вернуть машину в каталог;
  - `/complete booking_id` — отметить аренду завершённой;
- ручные блокировки дат учитываются в календаре;
- дополнительные услуги при бронировании;
- скидка за длительную аренду;
- раздел клиента «Мои бронирования»;
- галерея фото, визуальный календарь, защита от двойной брони и админ-кнопка отмены сохраняются.

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
```

## Важно

Webhook менять не нужно, если он уже установлен на `/api/telegram-webhook`.
После деплоя напишите своему боту `/admin`.
