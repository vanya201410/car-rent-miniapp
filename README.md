# Car Rent Telegram Mini App — v3 admin buttons

Эта версия:
- показывает машины из Supabase;
- отправляет заявки в Supabase;
- отправляет админу Telegram-уведомление;
- добавляет кнопки ✅ Подтвердить и ❌ Отклонить;
- меняет статус заявки в Supabase;
- отправляет клиенту сообщение о подтверждении/отклонении, если Telegram позволяет боту написать клиенту.

## Переменные Vercel

Frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Serverless API:
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`

## Нужно добавить поля в Supabase

В SQL Editor выполнить:

```sql
alter table public.bookings
add column if not exists telegram_user_id text,
add column if not exists telegram_username text;
```

## Нужно подключить webhook Telegram

После деплоя открыть в браузере:

https://api.telegram.org/botBOT_TOKEN/setWebhook?url=https://YOUR_DOMAIN.vercel.app/api/telegram-webhook

Заменить:
- `BOT_TOKEN` на токен бота
- `YOUR_DOMAIN` на домен Vercel
