import { createClient } from '@supabase/supabase-js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase server variables are missing.' });
    }

    const payload = req.body || {};

    const requiredFields = ['car_id', 'customer_name', 'phone', 'start_date', 'end_date', 'days_count', 'total_price'];
    for (const field of requiredFields) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        return res.status(400).json({ error: `Missing field: ${field}` });
      }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: car, error: carError } = await supabase
      .from('cars')
      .select('*')
      .eq('id', payload.car_id)
      .single();

    if (carError) {
      return res.status(400).json({ error: 'Car not found: ' + carError.message });
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        car_id: payload.car_id,
        customer_name: payload.customer_name,
        phone: payload.phone,
        start_date: payload.start_date,
        end_date: payload.end_date,
        days_count: payload.days_count,
        total_price: payload.total_price,
        status: 'new',
        comment: payload.comment || ''
      })
      .select()
      .single();

    if (bookingError) {
      return res.status(400).json({ error: bookingError.message });
    }

    if (botToken && adminChatId) {
      const text = [
        '🚗 <b>Новая заявка на аренду</b>',
        '',
        `<b>Авто:</b> ${escapeHtml(car.brand)} ${escapeHtml(car.model)}`,
        `<b>Даты:</b> ${escapeHtml(payload.start_date)} — ${escapeHtml(payload.end_date)}`,
        `<b>Дней:</b> ${escapeHtml(payload.days_count)}`,
        `<b>Сумма:</b> ${escapeHtml(payload.total_price)} €`,
        car.deposit ? `<b>Залог:</b> ${escapeHtml(car.deposit)} €` : '',
        '',
        `<b>Клиент:</b> ${escapeHtml(payload.customer_name)}`,
        `<b>Телефон:</b> ${escapeHtml(payload.phone)}`,
        payload.comment ? `<b>Комментарий:</b> ${escapeHtml(payload.comment)}` : '',
        '',
        `<b>ID заявки:</b> ${booking.id}`
      ].filter(Boolean).join('\n');

      const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminChatId,
          text,
          parse_mode: 'HTML'
        })
      });

      if (!telegramResponse.ok) {
        const tgError = await telegramResponse.text();
        console.error('Telegram sendMessage error:', tgError);
      }
    }

    return res.status(200).json({ ok: true, booking });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
