import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody, findUnavailableOverlap } from './_utils.js';

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

    const payload = getBody(req);

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

    const overlap = await findUnavailableOverlap(
      supabase,
      payload.car_id,
      payload.start_date,
      payload.end_date
    );

    if (overlap) {
      const label = overlap.type === 'block' ? 'Блокировка' : 'Занятая бронь';
      return res.status(409).json({
        error: `Эта машина уже занята на выбранные даты. ${label}: ${overlap.start_date} — ${overlap.end_date}.`
      });
    }

    const extras = payload.extras && typeof payload.extras === 'object' ? payload.extras : {};

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        car_id: payload.car_id,
        customer_name: payload.customer_name,
        phone: payload.phone,
        start_date: payload.start_date,
        end_date: payload.end_date,
        days_count: payload.days_count,
        base_price: payload.base_price || 0,
        discount_percent: payload.discount_percent || 0,
        discount_amount: payload.discount_amount || 0,
        discount_label: payload.discount_label || null,
        extras_total: payload.extras_total || 0,
        extras,
        total_price: payload.total_price,
        status: 'new',
        comment: payload.comment || '',
        telegram_user_id: payload.telegram_user_id ? String(payload.telegram_user_id) : null,
        telegram_username: payload.telegram_username || null
      })
      .select()
      .single();

    if (bookingError) {
      return res.status(400).json({ error: bookingError.message });
    }

    if (botToken && adminChatId) {
      const selectedExtras = Object.entries(extras).filter(([, value]) => Boolean(value)).map(([key]) => key);

      const text = [
        '🚗 <b>Новая заявка на аренду</b>',
        '',
        `<b>Авто:</b> ${escapeHtml(car.brand)} ${escapeHtml(car.model)}`,
        `<b>Даты:</b> ${escapeHtml(payload.start_date)} — ${escapeHtml(payload.end_date)}`,
        `<b>Дней:</b> ${escapeHtml(payload.days_count)}`,
        payload.base_price ? `<b>Аренда:</b> ${escapeHtml(payload.base_price)} €` : '',
        payload.discount_amount ? `<b>Скидка:</b> −${escapeHtml(payload.discount_amount)} €${payload.discount_label ? ' · ' + escapeHtml(payload.discount_label) : ''}` : '',
        payload.extras_total ? `<b>Доп. услуги:</b> ${escapeHtml(payload.extras_total)} €` : '',
        `<b>Сумма:</b> ${escapeHtml(payload.total_price)} €`,
        car.deposit ? `<b>Залог:</b> ${escapeHtml(car.deposit)} €` : '',
        selectedExtras.length ? `<b>Услуги:</b> ${escapeHtml(selectedExtras.join(', '))}` : '',
        '',
        `<b>Клиент:</b> ${escapeHtml(payload.customer_name)}`,
        `<b>Телефон:</b> ${escapeHtml(payload.phone)}`,
        payload.telegram_username ? `<b>Telegram:</b> @${escapeHtml(payload.telegram_username)}` : '',
        payload.comment ? `<b>Комментарий:</b> ${escapeHtml(payload.comment)}` : '',
        '',
        `<b>ID заявки:</b> ${booking.id}`,
        `<b>Статус:</b> новая`
      ].filter(Boolean).join('\n');

      await telegramApi(botToken, 'sendMessage', {
        chat_id: adminChatId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Подтвердить', callback_data: `confirm_booking:${booking.id}` },
              { text: '❌ Отклонить', callback_data: `decline_booking:${booking.id}` }
            ]
          ]
        }
      });
    }

    return res.status(200).json({ ok: true, booking });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
