import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody, findConfirmedOverlap, buildAdminBookingText } from './_utils.js';

function clientMessage({ status, booking, car }) {
  if (status === 'confirmed') {
    return [
      '✅ <b>Ваша бронь подтверждена</b>',
      '',
      `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      `<b>Сумма:</b> ${escapeHtml(booking.total_price)} €`,
      '',
      'Менеджер скоро свяжется с вами для уточнения деталей.'
    ].join('\n');
  }

  if (status === 'cancelled_by_admin') {
    return [
      '🚫 <b>Ваша бронь отменена</b>',
      '',
      `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
      `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
      '',
      'Если это ошибка или вы хотите выбрать другие даты, свяжитесь с менеджером.'
    ].join('\n');
  }

  return [
    '❌ <b>К сожалению, заявка отклонена</b>',
    '',
    `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
    `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
    '',
    'Менеджер может предложить вам другой автомобиль или другие даты.'
  ].join('\n');
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
    const allowedActions = ['confirm_booking', 'decline_booking', 'cancel_booking'];

    if (!bookingId || !allowedActions.includes(action)) {
      await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Неизвестная команда',
        show_alert: false
      });
      return res.status(200).json({ ok: true });
    }

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

    let newStatus = 'cancelled';
    let callbackText = 'Заявка отменена';
    let adminTitle = '❌ <b>Заявка отклонена</b>';
    let clientStatus = 'declined';
    let replyMarkup = undefined;

    if (action === 'confirm_booking') {
      const overlap = await findConfirmedOverlap(
        supabase,
        booking.car_id,
        booking.start_date,
        booking.end_date,
        booking.id
      );

      if (overlap) {
        await telegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: callback.id,
          text: `Нельзя подтвердить: авто уже занято ${overlap.start_date} — ${overlap.end_date}`,
          show_alert: true
        });

        return res.status(200).json({ ok: true });
      }

      newStatus = 'confirmed';
      callbackText = 'Заявка подтверждена';
      adminTitle = '✅ <b>Заявка подтверждена</b>';
      clientStatus = 'confirmed';
      replyMarkup = {
        inline_keyboard: [
          [
            { text: '🚫 Отменить бронь', callback_data: `cancel_booking:${booking.id}` }
          ]
        ]
      };
    }

    if (action === 'decline_booking') {
      newStatus = 'cancelled';
      callbackText = 'Заявка отклонена';
      adminTitle = '❌ <b>Заявка отклонена</b>';
      clientStatus = 'declined';
    }

    if (action === 'cancel_booking') {
      if (booking.status !== 'confirmed') {
        await telegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: callback.id,
          text: 'Эта бронь уже не подтверждена',
          show_alert: true
        });
        return res.status(200).json({ ok: true });
      }

      newStatus = 'cancelled';
      callbackText = 'Бронь отменена';
      adminTitle = '🚫 <b>Бронь отменена администратором</b>';
      clientStatus = 'cancelled_by_admin';
    }

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({ status: newStatus })
      .eq('id', bookingId)
      .select()
      .single();

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
      text: callbackText,
      show_alert: false
    });

    await telegramApi(botToken, 'editMessageText', {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: buildAdminBookingText({
        title: adminTitle,
        booking: updatedBooking,
        car
      }),
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });

    if (updatedBooking.telegram_user_id) {
      await telegramApi(botToken, 'sendMessage', {
        chat_id: updatedBooking.telegram_user_id,
        text: clientMessage({ status: clientStatus, booking: updatedBooking, car }),
        parse_mode: 'HTML'
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}
