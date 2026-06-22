import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { telegramApi, findUnavailableOverlap, buildAdminBookingText, escapeHtml } from './_utils.js';

// LIVE STRIPE READY
// Реальные Stripe-платежи принимаются только с live-ключом sk_live_...
// Сначала проверяем Stripe-Signature через STRIPE_WEBHOOK_SECRET.
// Если Vercel изменил raw body и подпись не прошла, включена дополнительная безопасная проверка:
// webhook достает Checkout Session напрямую из Stripe API и сверяет live-mode, booking_id, payment_status и сумму.

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');

  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseStripeSignature(header = '') {
  return String(header)
    .split(',')
    .map((part) => part.split('='))
    .reduce((acc, [key, value]) => {
      if (!key || !value) return acc;
      acc[key] = value;
      return acc;
    }, {});
}

function timingSafeEqualHex(a, b) {
  const aBuffer = Buffer.from(String(a || ''), 'hex');
  const bBuffer = Buffer.from(String(b || ''), 'hex');
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is missing in Vercel Environment Variables. Use the LIVE webhook signing secret whsec_...');
  }

  const parsed = parseStripeSignature(signatureHeader);
  const timestamp = parsed.t;
  const signature = parsed.v1;

  if (!timestamp || !signature) {
    throw new Error('Stripe signature header is invalid or missing.');
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  if (!timingSafeEqualHex(expected, signature)) {
    throw new Error('Stripe webhook signature verification failed. Check that STRIPE_WEBHOOK_SECRET is from the same LIVE webhook endpoint.');
  }
}

function requireLiveStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is missing in Vercel Environment Variables.');
  }

  if (!String(key).startsWith('sk_live_')) {
    throw new Error('This live-payment version requires STRIPE_SECRET_KEY to start with sk_live_. You still have a test key or wrong key.');
  }

  return key;
}

function normalizePaymentType(value) {
  const type = String(value || 'prepayment');
  if (['prepayment', 'full_rental', 'remaining_rental'].includes(type)) return type;
  return 'prepayment';
}

function getExpectedAmount({ booking, paymentType }) {
  const totalPrice = Number(booking.total_price || 0);
  const prepaymentAmount = Number(booking.prepayment_amount || 0);
  const remainingAmount = Math.max(0, Number(booking.remaining_amount ?? (totalPrice - prepaymentAmount)));

  if (paymentType === 'prepayment') return prepaymentAmount;
  if (paymentType === 'remaining_rental') return remainingAmount;

  if (paymentType === 'full_rental') {
    return booking.prepayment_status === 'paid' ? remainingAmount : totalPrice;
  }

  return prepaymentAmount;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
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
  const totalPaidAfterFull = booking.prepayment_status === 'paid'
    ? Math.min(totalPrice, prepaymentAmount + paidAmount)
    : paidAmount;

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
      rental_paid_amount: totalPaidAfterFull,
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

async function fetchStripeCheckoutSession(sessionId) {
  const stripeKey = requireLiveStripeKey();

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${stripeKey}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || 'Could not fetch Stripe Checkout Session for verification.');
  }

  return data;
}

async function getVerifiedEventOrSession(rawBody, signatureHeader) {
  requireLiveStripeKey();

  try {
    verifyStripeWebhookSignature(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
    const event = JSON.parse(rawBody);

    if (event?.livemode !== true) {
      throw new Error('This live webhook rejects test Stripe events. Use live webhook endpoint and live keys.');
    }

    return { event, verifiedBy: 'stripe_signature' };
  } catch (signatureError) {
    let parsedEvent;

    try {
      parsedEvent = JSON.parse(rawBody);
    } catch {
      throw signatureError;
    }

    const sessionId = parsedEvent?.data?.object?.id;
    const objectType = parsedEvent?.data?.object?.object;

    if (parsedEvent?.type !== 'checkout.session.completed' || objectType !== 'checkout.session' || !sessionId) {
      throw signatureError;
    }

    const session = await fetchStripeCheckoutSession(sessionId);

    if (session?.livemode !== true) {
      throw new Error('Fetched Stripe session is not live. Check live/test mode.');
    }

    if (session?.status !== 'complete' || session?.payment_status !== 'paid') {
      throw new Error('Stripe session is not fully paid.');
    }

    console.warn('Stripe signature check failed, but live Checkout Session was verified directly through Stripe API:', signatureError.message);

    return {
      event: {
        id: parsedEvent.id || `verified_session_${session.id}`,
        type: 'checkout.session.completed',
        livemode: true,
        data: { object: session }
      },
      verifiedBy: 'stripe_api_session_verification'
    };
  }
}

function assertSessionMatchesBooking({ session, booking, paymentType }) {
  if (session?.livemode !== true) {
    throw new Error('Stripe session is not live.');
  }

  if (session?.status !== 'complete' || session?.payment_status !== 'paid') {
    throw new Error('Stripe session is not paid.');
  }

  const sessionBookingId = String(session?.metadata?.booking_id || session?.client_reference_id || '');
  if (sessionBookingId !== String(booking.id)) {
    throw new Error('Stripe session booking_id does not match booking.');
  }

  const sessionPaymentType = normalizePaymentType(session?.metadata?.payment_type);
  if (sessionPaymentType !== paymentType) {
    throw new Error('Stripe session payment_type does not match metadata.');
  }

  const expected = cents(getExpectedAmount({ booking, paymentType }));
  const paid = Number(session?.amount_total || 0);

  if (expected !== paid) {
    throw new Error(`Stripe amount mismatch. Expected ${expected} cents, got ${paid} cents.`);
  }

  if (String(session?.currency || '').toLowerCase() !== 'eur') {
    throw new Error('Stripe session currency must be EUR.');
  }
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

  assertSessionMatchesBooking({ session, booking, paymentType });

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
    const signature = req.headers['stripe-signature'];
    const { event, verifiedBy } = await getVerifiedEventOrSession(rawBody, signature);

    if (event.type === 'checkout.session.completed') {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase server variables are missing. Check SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.');
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      await handleCheckoutCompleted({ supabase, session: event.data.object });
    }

    return res.status(200).json({ received: true, mode: 'live_stripe_ready', verified_by: verifiedBy });
  } catch (error) {
    console.error('Stripe live webhook error:', error);
    return res.status(400).json({ error: error.message || 'Webhook error', mode: 'live_stripe_ready' });
  }
}
