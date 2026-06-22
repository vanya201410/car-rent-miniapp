import { createClient } from '@supabase/supabase-js';
import { getBody } from './_utils.js';

function getBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function euroToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function normalizePaymentType(value) {
  const type = String(value || 'prepayment');
  if (['prepayment', 'full_rental', 'remaining_rental'].includes(type)) return type;
  return 'prepayment';
}

function getPaymentConfig({ booking, car, paymentType }) {
  const totalPrice = Number(booking.total_price || 0);
  const prepaymentAmount = Number(booking.prepayment_amount || 0);
  const remainingAmount = Math.max(0, Number(booking.remaining_amount ?? (totalPrice - prepaymentAmount)));
  const carTitle = `${car?.brand || 'Авто'} ${car?.model || ''}`.trim();

  if (paymentType === 'prepayment') {
    if (booking.prepayment_status === 'paid') {
      throw new Error('Предоплата по этой брони уже оплачена.');
    }

    return {
      amount: prepaymentAmount,
      productName: `Предоплата за аренду: ${carTitle}`,
      description: `Бронь #${booking.id}. Предоплата входит в стоимость аренды. Остаток оплачивается позже.`,
      errorMessage: 'Сумма предоплаты слишком маленькая для онлайн-оплаты.'
    };
  }

  if (paymentType === 'full_rental') {
    if (booking.rental_payment_status === 'paid' || Number(booking.remaining_amount || 0) === 0) {
      throw new Error('Аренда по этой брони уже полностью оплачена.');
    }

    const amount = booking.prepayment_status === 'paid' ? remainingAmount : totalPrice;
    const name = booking.prepayment_status === 'paid'
      ? `Остаток аренды: ${carTitle}`
      : `Полная оплата аренды: ${carTitle}`;
    const description = booking.prepayment_status === 'paid'
      ? `Бронь #${booking.id}. Оплата остатка аренды. Залог оплачивается отдельно при получении автомобиля.`
      : `Бронь #${booking.id}. Полная оплата аренды без залога. Залог оплачивается отдельно при получении автомобиля.`;

    return {
      amount,
      productName: name,
      description,
      errorMessage: 'Сумма аренды слишком маленькая для онлайн-оплаты.'
    };
  }

  if (paymentType === 'remaining_rental') {
    if (booking.prepayment_status !== 'paid') {
      throw new Error('Сначала должна быть оплачена предоплата. Для оплаты всей суммы выберите полную оплату аренды.');
    }

    if (booking.rental_payment_status === 'paid' || remainingAmount <= 0) {
      throw new Error('Остаток аренды уже оплачен.');
    }

    return {
      amount: remainingAmount,
      productName: `Остаток аренды: ${carTitle}`,
      description: `Бронь #${booking.id}. Оплата остатка аренды. Залог оплачивается отдельно при получении автомобиля.`,
      errorMessage: 'Сумма остатка слишком маленькая для онлайн-оплаты.'
    };
  }

  throw new Error('Неизвестный тип оплаты.');
}

async function createStripeCheckoutSession({ booking, car, req, paymentType }) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is missing in Vercel Environment Variables.');
  }

  if (!String(stripeSecretKey).startsWith('sk_live_')) {
    throw new Error('Для реальной оплаты в Vercel нужно поставить STRIPE_SECRET_KEY = sk_live_... Сейчас стоит тестовый или неверный ключ.');
  }

  const appUrl = getBaseUrl(req);
  const config = getPaymentConfig({ booking, car, paymentType });
  const amountCents = euroToCents(config.amount);

  if (!amountCents || amountCents < 50) {
    throw new Error(config.errorMessage);
  }

  const params = new URLSearchParams();

  params.append('mode', 'payment');
  params.append('success_url', `${appUrl}/?payment=success&booking_id=${booking.id}&payment_type=${paymentType}&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${appUrl}/?payment=cancel&booking_id=${booking.id}&payment_type=${paymentType}`);
  params.append('client_reference_id', String(booking.id));
  params.append('locale', 'auto');

  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', 'eur');
  params.append('line_items[0][price_data][unit_amount]', String(amountCents));
  params.append('line_items[0][price_data][product_data][name]', config.productName);
  params.append('line_items[0][price_data][product_data][description]', config.description);

  params.append('metadata[booking_id]', String(booking.id));
  params.append('metadata[payment_type]', paymentType);
  params.append('metadata[car_id]', String(booking.car_id || ''));

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Stripe checkout session error:', data);
    throw new Error(data?.error?.message || 'Не удалось создать Stripe Checkout Session.');
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase server variables are missing.' });
    }

    const payload = getBody(req);
    const bookingId = payload.booking_id;
    const paymentType = normalizePaymentType(payload.payment_type);

    if (!bookingId) {
      return res.status(400).json({ error: 'booking_id is required' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({ error: 'Бронь не найдена.' });
    }

    const { data: car } = await supabase
      .from('cars')
      .select('*')
      .eq('id', booking.car_id)
      .maybeSingle();

    const session = await createStripeCheckoutSession({ booking, car, req, paymentType });

    const updatePayload = {
      online_payment_status: 'checkout_created',
      stripe_checkout_session_id: session.id,
      payment_url: session.url,
      payment_type: paymentType,
      last_online_payment_type: paymentType,
      payment_method: 'stripe_checkout'
    };

    if (paymentType === 'full_rental') {
      updatePayload.rental_payment_status = 'checkout_created';
      updatePayload.full_payment_status = 'checkout_created';
    }

    if (paymentType === 'remaining_rental') {
      updatePayload.remaining_payment_status = 'checkout_created';
    }

    await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', booking.id);

    return res.status(200).json({
      ok: true,
      checkout_url: session.url,
      session_id: session.id,
      payment_type: paymentType
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
