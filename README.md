# Car Rent Telegram Mini App — v2 admin notifications

Эта версия:
- показывает машины из Supabase;
- отправляет заявки в Supabase;
- отправляет админу Telegram-уведомление о новой заявке.

## Переменные Vercel

Frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Serverless API:
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`

`service_role` и `TELEGRAM_BOT_TOKEN` нельзя вставлять в код и нельзя показывать публично.
Они должны храниться только в Vercel Environment Variables.
