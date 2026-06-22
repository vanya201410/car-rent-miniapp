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

async function createStripeCheckoutSession({ booking, car, req }) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is missing in Vercel Environment Variables.');
  }

  const appUrl = getBaseUrl(req);
  const amountCents = euroToCents(booking.prepayment_amount);

  if (!amountCents || amountCents < 50) {
    throw new Error('Сумма предоплаты слишком маленькая для онлайн-оплаты.');
  }

  const carTitle = `${car?.brand || 'Авто'} ${car?.model || ''}`.trim();
  const params = new URLSearchParams();

  params.append('mode', 'payment');
  params.append('success_url', `${appUrl}/?payment=success&booking_id=${booking.id}&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${appUrl}/?payment=cancel&booking_id=${booking.id}`);
  params.append('client_reference_id', String(booking.id));
  params.append('locale', 'auto');

  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', 'eur');
  params.append('line_items[0][price_data][unit_amount]', String(amountCents));
  params.append('line_items[0][price_data][product_data][name]', `Предоплата за аренду: ${carTitle}`);
  params.append('line_items[0][price_data][product_data][description]', `Бронь #${booking.id}. Предоплата входит в стоимость аренды.`);

  params.append('metadata[booking_id]', String(booking.id));
  params.append('metadata[payment_type]', 'prepayment');
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

    if (booking.prepayment_status === 'paid') {
      return res.status(400).json({ error: 'Предоплата по этой брони уже оплачена.' });
    }

    if (!booking.prepayment_amount || Number(booking.prepayment_amount) <= 0) {
      return res.status(400).json({ error: 'У этой брони нет суммы предоплаты.' });
    }

    const { data: car } = await supabase
      .from('cars')
      .select('*')
      .eq('id', booking.car_id)
      .maybeSingle();

    const session = await createStripeCheckoutSession({ booking, car, req });

    await supabase
      .from('bookings')
      .update({
        online_payment_status: 'checkout_created',
        stripe_checkout_session_id: session.id,
        payment_url: session.url,
        payment_type: 'prepayment',
        payment_method: 'stripe_checkout'
      })
      .eq('id', booking.id);

    return res.status(200).json({
      ok: true,
      checkout_url: session.url,
      session_id: session.id
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
