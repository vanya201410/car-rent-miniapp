import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody, buildAdminBookingText } from './_utils.js';

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

    const { data: car } = await supabase
      .from('cars')
      .select('*')
      .eq('id', booking.car_id)
      .maybeSingle();

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'pending_manual_payment',
        online_payment_status: 'manual_requested',
        payment_method: 'manual_request',
        manual_payment_requested_at: new Date().toISOString(),
        manual_payment_note: payload.note || 'Клиент не может оплатить онлайн'
      })
      .eq('id', booking.id)
      .select()
      .single();

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    if (botToken && adminChatId) {
      await telegramApi(botToken, 'sendMessage', {
        chat_id: adminChatId,
        text: buildAdminBookingText({
          title: '⚠️ <b>Клиент не может оплатить онлайн</b>\n\nКлиент просит альтернативный способ фиксации брони. Бронь пока не подтверждена.',
          booking: updatedBooking,
          car
        }),
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Предоплата получена вручную', callback_data: `prepayment_paid:${booking.id}` }],
            [{ text: '❌ Отклонить', callback_data: `decline_booking:${booking.id}` }]
          ]
        }
      });
    }

    if (botToken && updatedBooking.telegram_user_id) {
      await telegramApi(botToken, 'sendMessage', {
        chat_id: updatedBooking.telegram_user_id,
        text: [
          '⚠️ <b>Запрос альтернативной оплаты отправлен менеджеру</b>',
          '',
          `<b>Бронь:</b> #${escapeHtml(updatedBooking.id)}`,
          `<b>Предоплата:</b> ${escapeHtml(updatedBooking.prepayment_amount || 0)} €`,
          '',
          'Менеджер предложит способ оплаты: перевод, оплата другим человеком или ручное подтверждение.',
          'Автомобиль считается подтвержденным только после оплаты или подтверждения менеджером.'
        ].join('\n'),
        parse_mode: 'HTML'
      });
    }

    return res.status(200).json({ ok: true, booking: updatedBooking });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
