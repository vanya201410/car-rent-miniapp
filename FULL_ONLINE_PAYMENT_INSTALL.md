# Полная онлайн-оплата аренды

Добавлено:

- `💳 Оплатить предоплату онлайн` — как раньше.
- `💳 Оплатить всю аренду онлайн` — клиент оплачивает всю сумму аренды сразу.
- `💳 Оплатить остаток онлайн` — если предоплата уже оплачена, клиент может оплатить оставшийся баланс.

Важно:

- Залог не входит в онлайн-оплату аренды.
- Залог оплачивается отдельно при получении автомобиля.
- Перед live-платежами нужно вернуть строгую проверку Stripe webhook signature и заменить test-ключи на live-ключи.

## Что сделать после загрузки архива

1. Загрузить архив в GitHub.
2. В Supabase запустить SQL:

```sql
-- файл: supabase/extra-services-setup.sql
```

3. В Vercel сделать Redeploy without cache.
4. Открыть приложение с новым параметром:

```text
https://car-rent-miniapp.vercel.app/?v=120
```

5. Создать тестовую бронь и проверить 3 сценария:
   - оплатить только предоплату;
   - оплатить всю аренду сразу;
   - сначала оплатить предоплату, потом оплатить остаток.

## Новые поля в bookings

- `rental_payment_status`
- `rental_paid_amount`
- `rental_paid_at`
- `full_payment_status`
- `full_payment_amount`
- `full_payment_paid_at`
- `remaining_payment_status`
- `remaining_paid_amount`
- `remaining_paid_at`
- `last_online_payment_type`

## Типы payment_type

- `prepayment` — предоплата.
- `full_rental` — полная оплата всей аренды.
- `remaining_rental` — оплата остатка после предоплаты.
