# Stripe webhook test bypass v2

Этот архив временно отключает проверку `STRIPE_WEBHOOK_SECRET` только для тестовых событий Stripe (`livemode: false`) и только если `STRIPE_SECRET_KEY` начинается с `sk_test_`.

Что делать:
1. Загрузить файлы в GitHub.
2. Проверить, что в корне `package.json` — нормальный JSON, а `.npmrc` содержит `registry=https://registry.npmjs.org/`.
3. Сделать redeploy без cache в Vercel.
4. В Stripe нажать Resend на событии `checkout.session.completed`.

Успешный ответ webhook будет:
`{"received":true,"mode":"test_signature_disabled_v2"}`

Перед реальными платежами нужно вернуть строгую проверку подписи webhook.
