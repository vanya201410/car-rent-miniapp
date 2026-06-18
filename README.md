# Car Rent Telegram Mini App — v5 gallery

Эта версия:
- добавляет галерею фото;
- клиент может листать фото кнопками, точками и свайпом;
- фото берутся из таблицы `car_photos`;
- старое поле `cars.image_url` работает как запасное главное фото;
- защита от двойной брони сохраняется.

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

## Как добавить фото

1. Supabase → Storage → `car-photos`
2. Upload фото
3. Copy public URL
4. Supabase → Table Editor → `car_photos`
5. Insert row:
   - `car_id`: id машины, например `1`
   - `image_url`: ссылка на фото
   - `sort_order`: порядок фото, например `1`, `2`, `3`
