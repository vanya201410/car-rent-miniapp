# Car Rent Telegram Mini App — starter

Это стартовая версия Telegram Mini App для аренды машин.

Что умеет:
- показывает машины из таблицы `cars` в Supabase;
- открывает карточку машины;
- считает цену по датам;
- отправляет заявку в таблицу `bookings`.

## Нужно указать переменные окружения

В Vercel добавь:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Значения возьми в Supabase: Project Settings → API.

## Таблицы Supabase

Ожидаются таблицы:

### cars
- id
- brand
- model
- year
- price_per_day
- deposit
- transmission
- fuel_type
- seats
- city
- description
- is_active
- created_at

### bookings
- id
- car_id
- customer_name
- phone
- start_date
- end_date
- days_count
- total_price
- status
- comment
- created_at
