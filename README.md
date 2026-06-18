# Car Rent Telegram Mini App — v6 visual calendar

Эта версия:
- добавляет визуальный календарь занятых дат;
- показывает подтверждённые брони красным цветом;
- позволяет выбрать дату начала и дату возврата кликом по календарю;
- запрещает выбрать период, который пересекается с подтверждённой бронью;
- сохраняет защиту от двойной брони на сервере;
- сохраняет галерею фото автомобиля.

## SQL для Supabase

Выполнить в Supabase → SQL Editor:

```sql
alter table public.cars
add column if not exists image_url text;

alter table public.bookings
add column if not exists telegram_user_id text,
add column if not exists telegram_username text;

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
```

## Как работает календарь

- Красные даты — дни, когда авто уже занято подтверждённой бронью.
- Сначала клиент выбирает дату начала.
- Потом клиент выбирает дату возврата.
- Если выбранный период пересекается с confirmed-бронью, приложение покажет ошибку.
- `end_date` считается датой возврата, поэтому бронь 19–30 блокирует дни 19–29, а 30 число уже можно выбрать как новый старт.
