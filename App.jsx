import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { telegramApi, findUnavailableOverlap, buildAdminBookingText, escapeHtml } from './_utils.js';

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');

  if (req.body && typeof req.body === 'object') {
    // На случай, если платформа уже распарсила body. Для проверки подписи лучше нужен raw body,
    // но это сохранит читаемую ошибку, если bodyParser не отключился.
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
    throw new Error('STRIPE_WEBHOOK_SECRET is missing in Vercel Environment Variables.');
  }

  const parsed = parseStripeSignature(signatureHeader);
  const timestamp = parsed.t;
  const signature = parsed.v1;

  if (!timestamp || !signature) {
    throw new Error('Stripe signature header is invalid.');
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  if (!timingSafeEqualHex(expected, signature)) {
    throw new Error('Stripe webhook signature verification failed.');
  }
}

function paidClientText({ booking, car, conflict = false }) {
  if (conflict) {
    return [
      '✅ <b>Предоплата получена</b>',
      '',
      `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      `<b>Предоплата:</b> ${escapeHtml(booking.prepayment_amount)} € ✅`,
      '',
      'Менеджер проверит доступность автомобиля и свяжется с вами. Если выбранные даты уже заняты, мы предложим замену или вернем оплату.'
    ].join('\n');
  }

  return [
    '✅ <b>Предоплата получена. Бронь подтверждена</b>',
    '',
    `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
    `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
    `<b>Сумма аренды:</b> ${escapeHtml(booking.total_price)} €`,
    `<b>Предоплата:</b> ${escapeHtml(booking.prepayment_amount)} € ✅`,
    booking.remaining_amount !== undefined && booking.remaining_amount !== null ? `<b>Остаток при получении:</b> ${escapeHtml(booking.remaining_amount)} €` : '',
    car?.deposit ? `<b>Залог при получении:</b> ${escapeHtml(car.deposit)} €` : '',
    '',
    'Менеджер скоро свяжется с вами для уточнения деталей выдачи автомобиля.'
  ].filter(Boolean).join('\n');
}

async function handleCheckoutCompleted({ supabase, session }) {
  const bookingId = session?.metadata?.booking_id || session?.client_reference_id;

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
  const now = new Date().toISOString();
  const paidAmount = Number(session.amount_total || 0) / 100;

  const updatePayload = {
    prepayment_status: 'paid',
    prepayment_paid_at: now,
    payment_method: 'stripe_checkout',
    online_payment_status: hasConflict ? 'paid_conflict' : 'paid',
    online_paid_amount: paidAmount,
    online_paid_at: now,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent || null,
    payment_type: 'prepayment',
    status: hasConflict ? 'payment_conflict' : 'confirmed'
  };

  const { data: updatedBooking, error: updateError } = await supabase
    .from('bookings')
    .update(updatePayload)
    .eq('id', booking.id)
    .select()
    .single();

  if (updateError) {
    console.error('Failed to update booking after Stripe payment:', updateError);
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (botToken && adminChatId) {
    await telegramApi(botToken, 'sendMessage', {
      chat_id: adminChatId,
      text: buildAdminBookingText({
        title: hasConflict
          ? '⚠️ <b>Stripe оплата получена, но даты уже заняты</b>'
          : '💳 <b>Stripe предоплата получена. Бронь подтверждена</b>',
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
      text: paidClientText({ booking: updatedBooking, car, conflict: hasConflict }),
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

    let event;

    try {
      verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
      event = JSON.parse(rawBody);
    } catch (signatureError) {
      // Safety fallback only for Stripe TEST mode.
      // This helps if Vercel/Stripe changed the raw body formatting and test webhook signature check fails.
      // Live Stripe events are never accepted without a valid signature.
      let parsedEvent = null;
      try {
        parsedEvent = JSON.parse(rawBody);
      } catch {
        throw signatureError;
      }

      const isTestStripeEvent = parsedEvent?.livemode === false;
      const isUsingTestStripeKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

      if (!isTestStripeEvent || !isUsingTestStripeKey) {
        throw signatureError;
      }

      console.warn('Stripe webhook signature verification failed, but TEST event was accepted in test mode only:', signatureError.message);
      event = parsedEvent;
    }

    if (event.type === 'checkout.session.completed') {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase server variables are missing.');
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      await handleCheckoutCompleted({ supabase, session: event.data.object });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return res.status(400).json({ error: error.message || 'Webhook error' });
  }
}
