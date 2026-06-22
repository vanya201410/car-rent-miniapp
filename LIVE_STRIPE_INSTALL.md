# Подключение реальной Stripe-оплаты

Этот архив включает live-режим Stripe:

- `STRIPE_SECRET_KEY` должен быть `sk_live_...`
- `STRIPE_WEBHOOK_SECRET` должен быть от LIVE webhook endpoint
- тестовый bypass `test_signature_disabled_v2` удален
- webhook проверяет `Stripe-Signature`
- если Vercel ломает raw body, webhook дополнительно проверяет платеж напрямую через Stripe API: live-mode, paid, booking_id, payment_type, EUR и точную сумму

## 1. Stripe Dashboard

Переключитесь в Live mode.

Создайте live webhook endpoint:

```text
https://car-rent-miniapp.vercel.app/api/stripe-webhook
```

Событие:

```text
checkout.session.completed
```

Скопируйте live signing secret:

```text
whsec_...
```

## 2. Vercel Environment Variables

В Project Settings → Environment Variables поставьте:

```text
STRIPE_SECRET_KEY = sk_live_...
STRIPE_WEBHOOK_SECRET = whsec_...
PUBLIC_APP_URL = https://car-rent-miniapp.vercel.app
```

Остальные переменные оставить как были:

```text
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
```

После изменения переменных обязательно сделайте:

```text
Deployments → Redeploy → Redeploy without cache
```

## 3. Проверка

Сделайте реальную маленькую бронь и оплатите.

В Stripe webhook должен быть ответ:

```json
{"received":true,"mode":"live_stripe_ready"}
```

В Supabase у брони должно стать:

```text
online_payment_status = paid
payment_method = stripe_checkout
stripe_payment_intent_id = pi_...
```

Для полной оплаты:

```text
rental_payment_status = paid
remaining_amount = 0
```

Для предоплаты:

```text
prepayment_status = paid
rental_payment_status = partial
```

## 4. Важно

Залог автомобиля не входит в онлайн-оплату аренды. Залог лучше принимать отдельно при выдаче автомобиля.
