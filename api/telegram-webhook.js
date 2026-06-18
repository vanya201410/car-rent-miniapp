import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody } from './_utils.js';

function bookingStatusText(status) {
  if (status === 'confirmed') return 'подтверждена ✅';
  if (status === 'cancelled') return 'отклонена ❌';
  return status;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const update = getBody(req);
    const callback = update.callback_query;

    if (!callback) {
      return res.status(200).json({ ok: true });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!botToken || !adminChatId || !supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Required server variables are missing.' });
    }

    const callbackUserId = String(callback.from?.id || '');
    if (callbackUserId !== String(adminChatId)) {
      await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Нет доступа',
        show_alert: false
      });
      return res.status(200).json({ ok: true });
    }

    const [action, bookingId] = String(callback.data || '').split(':');
    if (!bookingId || !['confirm_booking', 'decline_booking'].includes(action)) {
      await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Неизвестная команда',
        show_alert: false
      });
      return res.status(200).json({ ok: true });
    }

    const newStatus = action === 'confirm_booking' ? 'confirmed' : 'cancelled';

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError) {
      await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Заявка не найдена',
        show_alert: true
      });
      return res.status(200).json({ ok: true });
    }

    const { data: car } = await supabase
      .from('cars')
      .select('*')
      .eq('id', booking.car_id)
      .single();

    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: newStatus })
      .eq('id', bookingId);

    if (updateError) {
      await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Ошибка обновления статуса',
        show_alert: true
      });
      return res.status(200).json({ ok: true });
    }

    await telegramApi(botToken, 'answerCallbackQuery', {
      callback_query_id: callback.id,
      text: newStatus === 'confirmed' ? 'Заявка подтверждена' : 'Заявка отклонена',
      show_alert: false
    });

    const adminText = [
      newStatus === 'confirmed' ? '✅ <b>Заявка подтверждена</b>' : '❌ <b>Заявка отклонена</b>',
      '',
      `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      `<b>Дней:</b> ${escapeHtml(booking.days_count)}`,
      `<b>Сумма:</b> ${escapeHtml(booking.total_price)} €`,
      '',
      `<b>Клиент:</b> ${escapeHtml(booking.customer_name)}`,
      `<b>Телефон:</b> ${escapeHtml(booking.phone)}`,
      booking.telegram_username ? `<b>Telegram:</b> @${escapeHtml(booking.telegram_username)}` : '',
      booking.comment ? `<b>Комментарий:</b> ${escapeHtml(booking.comment)}` : '',
      '',
      `<b>ID заявки:</b> ${booking.id}`,
      `<b>Статус:</b> ${bookingStatusText(newStatus)}`
    ].filter(Boolean).join('\n');

    await telegramApi(botToken, 'editMessageText', {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: adminText,
      parse_mode: 'HTML'
    });

    if (booking.telegram_user_id) {
      const clientText = newStatus === 'confirmed'
        ? [
            '✅ <b>Ваша бронь подтверждена</b>',
            '',
            `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
            `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
            `<b>Сумма:</b> ${escapeHtml(booking.total_price)} €`,
            '',
            'Менеджер скоро свяжется с вами для уточнения деталей.'
          ].join('\n')
        : [
            '❌ <b>К сожалению, заявка отклонена</b>',
            '',
            `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
            `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
            '',
            'Менеджер может предложить вам другой автомобиль или другие даты.'
          ].join('\n');

      await telegramApi(botToken, 'sendMessage', {
        chat_id: booking.telegram_user_id,
        text: clientText,
        parse_mode: 'HTML'
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}
