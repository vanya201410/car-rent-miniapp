# Car Rent Telegram Mini App — v4 availability + photos

Эта версия:
- показывает фото автомобиля из поля `cars.image_url`;
- не даёт клиенту отправить заявку, если автомобиль уже подтверждён на эти даты;
- не даёт админу подтвердить заявку, если на эти даты уже есть подтверждённая бронь;
- сохраняет старую логику Telegram-уведомлений и кнопок.

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
```

## Как работает проверка дат

Если есть подтверждённая бронь:

- start_date = 2026-06-18
- end_date = 2026-06-26

то новая заявка на 2026-06-20 — 2026-06-24 будет заблокирована.

Заявка на 2026-06-26 — 2026-06-28 будет разрешена, потому что `end_date` считается датой возврата.

## Фото

В таблице `cars` появится поле `image_url`.
Туда нужно вставить публичную ссылку на фото автомобиля.
