# Stripe онлайн-предоплата

## Что добавлено

В проект добавлена онлайн-оплата предоплаты через Stripe Checkout.

Клиент после отправки заявки видит кнопку:

- 💳 Оплатить предоплату онлайн

После оплаты Stripe отправляет webhook на Vercel, а приложение автоматически обновляет бронь в Supabase.

## Что должно быть в Vercel → Settings → Environment Variables

Обязательно:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_APP_URL=https://car-rent-miniapp.vercel.app
```

Также должны остаться старые переменные:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
```

## Webhook в Stripe

В Stripe → Developers → Webhooks / Workbench → Add destination добавь endpoint:

```text
https://car-rent-miniapp.vercel.app/api/stripe-webhook
```

Событие:

```text
checkout.session.completed
```

После создания скопируй Signing secret, который начинается с `whsec_`, и вставь его в Vercel как `STRIPE_WEBHOOK_SECRET`.

## Supabase

После загрузки архива в GitHub снова запусти SQL:

```text
supabase/extra-services-setup.sql
```

Он добавляет поля:

```text
online_payment_status
stripe_checkout_session_id
stripe_payment_intent_id
online_paid_amount
online_paid_at
payment_url
payment_type
```

## Как тестировать

1. В Stripe используй Test mode.
2. В Vercel в `STRIPE_SECRET_KEY` вставь ключ `sk_test_...`.
3. Сделай тестовую заявку.
4. Нажми “💳 Оплатить предоплату онлайн”.
5. Используй тестовую карту Stripe:

```text
4242 4242 4242 4242
любая будущая дата
любой CVC
```

После успешной оплаты бронь должна стать `confirmed`, а `prepayment_status` — `paid`.

## Перед реальными оплатами

1. Создай live webhook в Stripe live mode.
2. В Vercel замени:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_... live webhook
```

3. Сделай Redeploy.

Не публикуй `sk_live_...` и `whsec_...` в GitHub или чатах.
