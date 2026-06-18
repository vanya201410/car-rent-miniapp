# Car Rent Telegram Mini App — v7 admin cancel button

Эта версия добавляет админ-кнопку отмены брони.

Что работает:
- заявка создаётся в Supabase;
- админу приходит уведомление с кнопками ✅ Подтвердить / ❌ Отклонить;
- после подтверждения сообщение меняется и появляется кнопка 🚫 Отменить бронь;
- при отмене статус заявки становится `cancelled`;
- даты снова становятся свободными;
- клиенту отправляется уведомление об отмене, если Telegram позволяет боту написать клиенту;
- визуальный календарь, галерея фото и защита от двойной брони сохраняются.

## SQL для Supabase

Можно выполнить повторно, даже если часть уже есть:

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

Webhook менять не нужно, если он уже был установлен на:
`/api/telegram-webhook`
