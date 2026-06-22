import { createClient } from '@supabase/supabase-js';
import { telegramApi, findUnavailableOverlap, buildAdminBookingText, escapeHtml } from './_utils.js';

// TEST FIX v2 + FULL PAYMENT
// В тестовом Stripe-режиме этот webhook НЕ проверяет подпись whsec_, чтобы убрать проблему
// "Stripe webhook signature verification failed" во время настройки.
// Перед live-платежами нужно вернуть строгую проверку подписи.

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizePaymentType(value) {
  const type = String(value || 'prepayment');
  if (['prepayment', 'full_rental', 'remaining_rental'].includes(type)) return type;
  return 'prepayment';
}

function paidClientText({ booking, car, conflict = false, paymentType = 'prepayment', paidAmount = 0 }) {
  const carTitle = `${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`.trim();

  if (conflict) {
    return [
      '✅ <b>Оплата получена</b>',
      '',
      `<b>Авто:</b> ${carTitle}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      `<b>Оплачено:</b> ${escapeHtml(paidAmount || booking.prepayment_amount)} € ✅`,
      '',
      'Менеджер проверит доступность автомобиля и свяжется с вами. Если выбранные даты уже заняты, мы предложим замену или вернем оплату.'
    ].join('\n');
  }

  if (paymentType === 'full_rental') {
    return [
      '✅ <b>Полная оплата аренды получена. Бронь подтверждена</b>',
      '',
      `<b>Авто:</b> ${carTitle}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      `<b>Сумма аренды:</b> ${escapeHtml(booking.total_price)} € ✅`,
      '<b>Остаток аренды:</b> 0 €',
      car?.deposit ? `<b>Залог при получении:</b> ${escapeHtml(car.deposit)} €` : '',
      '',
      'Важно: залог не входит в онлайн-оплату и оплачивается отдельно при получении автомобиля.',
      'Менеджер скоро свяжется с вами для уточнения деталей выдачи автомобиля.'
    ].filter(Boolean).join('\n');
  }

  if (paymentType === 'remaining_rental') {
    return [
      '✅ <b>Остаток аренды оплачен онлайн</b>',
      '',
      `<b>Авто:</b> ${carTitle}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      `<b>Оплачено сейчас:</b> ${escapeHtml(paidAmount)} € ✅`,
      '<b>Остаток аренды:</b> 0 €',
      car?.deposit ? `<b>Залог при получении:</b> ${escapeHtml(car.deposit)} €` : '',
      '',
      'Важно: залог не входит в онлайн-оплату и оплачивается отдельно при получении автомобиля.'
    ].filter(Boolean).join('\n');
  }

  return [
    '✅ <b>Предоплата получена. Бронь подтверждена</b>',
    '',
    `<b>Авто:</b> ${carTitle}`,
    `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
    `<b>Сумма аренды:</b> ${escapeHtml(booking.total_price)} €`,
    `<b>Предоплата:</b> ${escapeHtml(booking.prepayment_amount)} € ✅`,
    booking.remaining_amount !== undefined && booking.remaining_amount !== null ? `<b>Остаток при получении:</b> ${escapeHtml(booking.remaining_amount)} €` : '',
    car?.deposit ? `<b>Залог при получении:</b> ${escapeHtml(car.deposit)} €` : '',
    '',
    'Менеджер скоро свяжется с вами для уточнения деталей выдачи автомобиля.'
  ].filter(Boolean).join('\n');
}

function buildUpdatePayload({ booking, session, paymentType, hasConflict }) {
  const now = new Date().toISOString();
  const paidAmount = Number(session.amount_total || 0) / 100;
  const totalPrice = Number(booking.total_price || 0);
  const prepaymentAmount = Number(booking.prepayment_amount || 0);
  const alreadyPaidRental = Number(booking.rental_paid_amount || 0);

  const base = {
    payment_method: 'stripe_checkout',
    online_payment_status: hasConflict ? 'paid_conflict' : 'paid',
    online_paid_amount: paidAmount,
    online_paid_at: now,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent || null,
    payment_type: paymentType,
    last_online_payment_type: paymentType,
    status: hasConflict ? 'payment_conflict' : 'confirmed'
  };

  if (paymentType === 'full_rental') {
    return {
      ...base,
      prepayment_status: 'paid',
      prepayment_paid_at: booking.prepayment_paid_at || now,
      remaining_amount: 0,
      rental_payment_status: hasConflict ? 'paid_conflict' : 'paid',
      rental_paid_amount: paidAmount,
      rental_paid_at: now,
      full_payment_status: hasConflict ? 'paid_conflict' : 'paid',
      full_payment_amount: paidAmount,
      full_payment_paid_at: now
    };
  }

  if (paymentType === 'remaining_rental') {
    return {
      ...base,
      remaining_amount: 0,
      rental_payment_status: hasConflict ? 'paid_conflict' : 'paid',
      rental_paid_amount: Math.min(totalPrice, alreadyPaidRental + paidAmount),
      rental_paid_at: now,
      remaining_payment_status: hasConflict ? 'paid_conflict' : 'paid',
      remaining_paid_amount: paidAmount,
      remaining_paid_at: now
    };
  }

  return {
    ...base,
    prepayment_status: 'paid',
    prepayment_paid_at: now,
    remaining_amount: Math.max(0, totalPrice - prepaymentAmount),
    rental_payment_status: Math.max(0, totalPrice - prepaymentAmount) > 0 ? 'partial' : 'paid',
    rental_paid_amount: prepaymentAmount,
    rental_paid_at: now
  };
}

function adminTitleForPayment({ paymentType, hasConflict }) {
  if (hasConflict) return '⚠️ <b>Stripe оплата получена, но даты уже заняты</b>';
  if (paymentType === 'full_rental') return '💳 <b>Полная онлайн-оплата аренды получена</b>';
  if (paymentType === 'remaining_rental') return '💳 <b>Остаток аренды оплачен онлайн</b>';
  return '💳 <b>Stripe предоплата получена. Бронь подтверждена</b>';
}

async function handleCheckoutCompleted({ supabase, session }) {
  const bookingId = session?.metadata?.booking_id || session?.client_reference_id;
  const paymentType = normalizePaymentType(session?.metadata?.payment_type);

  if (!bookingId) {
    console.warn('Stripe session without booking_id:', session?.id);
    return;
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (bookingError || !booking) {
    console.error('Booking not found for Stripe session:', bookingId, bookingError);
    return;
  }

  const { data: car } = await supabase
    .from('cars')
    .select('*')
    .eq('id', booking.car_id)
    .maybeSingle();

  const overlap = await findUnavailableOverlap(
    supabase,
    booking.car_id,
    booking.start_date,
    booking.end_date,
    booking.id
  );

  const hasConflict = Boolean(overlap);
  const paidAmount = Number(session.amount_total || 0) / 100;
  const updatePayload = buildUpdatePayload({ booking, session, paymentType, hasConflict });

  const { data: updatedBooking, error: updateError } = await supabase
    .from('bookings')
    .update(updatePayload)
    .eq('id', booking.id)
    .select()
    .single();

  if (updateError) {
    console.error('Failed to update booking after Stripe payment:', updateError);
    throw updateError;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (botToken && adminChatId) {
    await telegramApi(botToken, 'sendMessage', {
      chat_id: adminChatId,
      text: buildAdminBookingText({
        title: adminTitleForPayment({ paymentType, hasConflict }),
        booking: updatedBooking,
        car
      }),
      parse_mode: 'HTML',
      reply_markup: hasConflict
        ? { inline_keyboard: [[{ text: '❌ Отменить / обработать вручную', callback_data: `decline_booking:${booking.id}` }]] }
        : { inline_keyboard: [[{ text: '🚫 Отменить бронь', callback_data: `cancel_booking:${booking.id}` }]] }
    });
  }

  if (botToken && updatedBooking.telegram_user_id) {
    await telegramApi(botToken, 'sendMessage', {
      chat_id: updatedBooking.telegram_user_id,
      text: paidClientText({ booking: updatedBooking, car, conflict: hasConflict, paymentType, paidAmount }),
      parse_mode: 'HTML'
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await readRawBody(req);
    const event = JSON.parse(rawBody);

    const isTestEvent = event?.livemode === false;
    const isTestKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

    // В test mode принимаем событие без проверки whsec_.
    // В live mode намеренно блокируем, чтобы случайно не принимать реальные платежи без подписи.
    if (!isTestEvent || !isTestKey) {
      return res.status(400).json({
        error: 'Live Stripe webhook requires signature verification. Test-only bypass is disabled for live mode.',
        mode: 'live_blocked'
      });
    }

    if (event.type === 'checkout.session.completed') {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase server variables are missing. Check SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.');
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      await handleCheckoutCompleted({ supabase, session: event.data.object });
    }

    return res.status(200).json({ received: true, mode: 'test_signature_disabled_v2_full_payment' });
  } catch (error) {
    console.error('Stripe webhook test handler error:', error);
    return res.status(400).json({ error: error.message || 'Webhook error', mode: 'test_signature_disabled_v2_full_payment' });
  }
}
