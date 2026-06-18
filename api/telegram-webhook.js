import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody, findUnavailableOverlap, buildAdminBookingText } from './_utils.js';

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

function adminMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '🆕 Новые заявки', callback_data: 'admin_new' },
        { text: '✅ Подтверждённые', callback_data: 'admin_confirmed' }
      ],
      [
        { text: '🚗 Машины', callback_data: 'admin_cars' },
        { text: '🚫 Блокировки дат', callback_data: 'admin_blocks' }
      ],
      [
        { text: 'ℹ️ Команды', callback_data: 'admin_help' }
      ]
    ]
  };
}

async function sendAdminMenu(botToken, chatId, editTarget = null) {
  const text = [
    '⚙️ <b>Админ-панель аренды авто</b>',
    '',
    'Выберите раздел или используйте команды:',
    '',
    '<code>/block 1 2026-07-01 2026-07-03 сервис</code>',
    '<code>/price 1 90</code>',
    '<code>/hidecar 1</code>',
    '<code>/showcar 1</code>'
  ].join('\n');

  if (editTarget) {
    return telegramApi(botToken, 'editMessageText', {
      chat_id: editTarget.chat_id,
      message_id: editTarget.message_id,
      text,
      parse_mode: 'HTML',
      reply_markup: adminMenuMarkup()
    });
  }

  return telegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: adminMenuMarkup()
  });
}

async function loadCarsByIds(supabase, carIds) {
  const uniqueIds = [...new Set(carIds.filter(Boolean))];
  if (!uniqueIds.length) return {};

  const { data } = await supabase
    .from('cars')
    .select('id, brand, model, price_per_day, is_active')
    .in('id', uniqueIds);

  return Object.fromEntries((data || []).map((car) => [String(car.id), car]));
}

async function renderBookingsList({ supabase, botToken, chatId, messageId, status }) {
  const title = status === 'new' ? '🆕 <b>Новые заявки</b>' : '✅ <b>Подтверждённые брони</b>';

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return telegramApi(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: 'Ошибка загрузки заявок: ' + escapeHtml(error.message),
      parse_mode: 'HTML',
      reply_markup: adminMenuMarkup()
    });
  }

  const carsById = await loadCarsByIds(supabase, (bookings || []).map((item) => item.car_id));

  const lines = (bookings || []).map((booking) => {
    const car = carsById[String(booking.car_id)];
    return [
      `#${booking.id} — ${escapeHtml(car?.brand || 'car')} ${escapeHtml(car?.model || '')}`,
      `${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)} · ${escapeHtml(booking.total_price)} €`,
      `${escapeHtml(booking.customer_name)} · ${escapeHtml(booking.phone)}`
    ].join('\n');
  });

  const keyboard = (bookings || []).map((booking) => {
    if (status === 'new') {
      return [
        { text: `✅ #${booking.id}`, callback_data: `confirm_booking:${booking.id}` },
        { text: `❌ #${booking.id}`, callback_data: `decline_booking:${booking.id}` }
      ];
    }

    return [
      { text: `🚫 Отменить #${booking.id}`, callback_data: `cancel_booking:${booking.id}` }
    ];
  });

  keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin_menu' }]);

  return telegramApi(botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: [title, '', lines.length ? lines.join('\n\n') : 'Пока пусто.'].join('\n'),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function renderCarsList({ supabase, botToken, chatId, messageId }) {
  const { data: cars, error } = await supabase
    .from('cars')
    .select('id, brand, model, price_per_day, is_active')
    .order('id', { ascending: true });

  const text = error
    ? 'Ошибка загрузки машин: ' + escapeHtml(error.message)
    : [
        '🚗 <b>Машины</b>',
        '',
        ...(cars || []).map((car) => [
          `#${car.id} — ${escapeHtml(car.brand)} ${escapeHtml(car.model)}`,
          `Цена: ${escapeHtml(car.price_per_day)} €/день`,
          `Статус: ${car.is_active ? 'показывается' : 'скрыта'}`,
          `Команды: /price ${car.id} 90 · /hidecar ${car.id} · /showcar ${car.id}`
        ].join('\n'))
      ].join('\n\n');

  return telegramApi(botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text || 'Машин пока нет.',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin_menu' }]] }
  });
}

async function renderBlocksList({ supabase, botToken, chatId, messageId }) {
  const { data: blocks, error } = await supabase
    .from('blocked_dates')
    .select('*')
    .order('start_date', { ascending: true })
    .limit(15);

  const carsById = await loadCarsByIds(supabase, (blocks || []).map((item) => item.car_id));

  const text = error
    ? 'Ошибка загрузки блокировок: ' + escapeHtml(error.message)
    : [
        '🚫 <b>Ручные блокировки дат</b>',
        '',
        ...(blocks || []).map((block) => {
          const car = carsById[String(block.car_id)];
          return [
            `#${block.id} — ${escapeHtml(car?.brand || 'car')} ${escapeHtml(car?.model || '')}`,
            `${escapeHtml(block.start_date)} — ${escapeHtml(block.end_date)}`,
            block.reason ? `Причина: ${escapeHtml(block.reason)}` : '',
            `Удалить: /unblock ${block.id}`
          ].filter(Boolean).join('\n');
        })
      ].join('\n\n');

  return telegramApi(botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text || 'Блокировок пока нет.',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin_menu' }]] }
  });
}

async function handleAdminCommand({ text, supabase, botToken, chatId }) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0];

  if (command === '/admin' || command === '/start') {
    await sendAdminMenu(botToken, chatId);
    return true;
  }

  if (command === '/block') {
    const [, carId, startDate, endDate, ...reasonParts] = parts;
    const reason = reasonParts.join(' ') || 'ручная блокировка';

    if (!carId || !startDate || !endDate) {
      await telegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Формат: /block car_id start_date end_date reason\nПример: /block 1 2026-07-01 2026-07-03 сервис'
      });
      return true;
    }

    const { data, error } = await supabase
      .from('blocked_dates')
      .insert({ car_id: carId, start_date: startDate, end_date: endDate, reason })
      .select()
      .single();

    await telegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: error ? 'Ошибка: ' + error.message : `🚫 Даты заблокированы. ID блокировки: ${data.id}`
    });
    return true;
  }

  if (command === '/unblock') {
    const [, blockId] = parts;
    const { error } = await supabase.from('blocked_dates').delete().eq('id', blockId);

    await telegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: error ? 'Ошибка: ' + error.message : `✅ Блокировка #${blockId} удалена.`
    });
    return true;
  }

  if (command === '/price') {
    const [, carId, price] = parts;
    const { error } = await supabase.from('cars').update({ price_per_day: price }).eq('id', carId);

    await telegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: error ? 'Ошибка: ' + error.message : `✅ Цена машины #${carId} изменена на ${price} €/день.`
    });
    return true;
  }

  if (command === '/hidecar' || command === '/showcar') {
    const [, carId] = parts;
    const isActive = command === '/showcar';
    const { error } = await supabase.from('cars').update({ is_active: isActive }).eq('id', carId);

    await telegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: error ? 'Ошибка: ' + error.message : isActive ? `✅ Машина #${carId} снова показывается.` : `🙈 Машина #${carId} скрыта.`
    });
    return true;
  }

  if (command === '/complete') {
    const [, bookingId] = parts;
    const { error } = await supabase.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

    await telegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: error ? 'Ошибка: ' + error.message : `🏁 Аренда по заявке #${bookingId} завершена.`
    });
    return true;
  }

  if (text.startsWith('/')) {
    await telegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        'ℹ️ Команды администратора:',
        '',
        '/admin — открыть меню',
        '/block 1 2026-07-01 2026-07-03 сервис',
        '/unblock 3',
        '/price 1 90',
        '/hidecar 1',
        '/showcar 1',
        '/complete 5'
      ].join('\n')
    });
    return true;
  }

  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const update = getBody(req);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!botToken || !adminChatId || !supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Required server variables are missing.' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (update.message) {
      const chatId = String(update.message.chat?.id || '');
      const text = update.message.text || '';

      if (chatId !== String(adminChatId)) {
        return res.status(200).json({ ok: true });
      }

      await handleAdminCommand({ text, supabase, botToken, chatId });
      return res.status(200).json({ ok: true });
    }

    const callback = update.callback_query;

    if (!callback) {
      return res.status(200).json({ ok: true });
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

    const callbackData = String(callback.data || '');

    if (callbackData === 'admin_menu') {
      await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Меню' });
      await sendAdminMenu(botToken, callback.message.chat.id, {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id
      });
      return res.status(200).json({ ok: true });
    }

    if (callbackData === 'admin_new') {
      await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Новые заявки' });
      await renderBookingsList({ supabase, botToken, chatId: callback.message.chat.id, messageId: callback.message.message_id, status: 'new' });
      return res.status(200).json({ ok: true });
    }

    if (callbackData === 'admin_confirmed') {
      await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Подтверждённые' });
      await renderBookingsList({ supabase, botToken, chatId: callback.message.chat.id, messageId: callback.message.message_id, status: 'confirmed' });
      return res.status(200).json({ ok: true });
    }

    if (callbackData === 'admin_cars') {
      await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Машины' });
      await renderCarsList({ supabase, botToken, chatId: callback.message.chat.id, messageId: callback.message.message_id });
      return res.status(200).json({ ok: true });
    }

    if (callbackData === 'admin_blocks') {
      await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Блокировки' });
      await renderBlocksList({ supabase, botToken, chatId: callback.message.chat.id, messageId: callback.message.message_id });
      return res.status(200).json({ ok: true });
    }

    if (callbackData === 'admin_help') {
      await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Команды' });
      await telegramApi(botToken, 'editMessageText', {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: [
          'ℹ️ <b>Команды администратора</b>',
          '',
          '<code>/admin</code> — открыть меню',
          '<code>/block 1 2026-07-01 2026-07-03 сервис</code>',
          '<code>/unblock 3</code>',
          '<code>/price 1 90</code>',
          '<code>/hidecar 1</code>',
          '<code>/showcar 1</code>',
          '<code>/complete 5</code>'
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin_menu' }]] }
      });
      return res.status(200).json({ ok: true });
    }

    const [action, bookingId] = callbackData.split(':');
    const allowedActions = ['confirm_booking', 'decline_booking', 'cancel_booking'];

    if (!bookingId || !allowedActions.includes(action)) {
      await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Неизвестная команда',
        show_alert: false
      });
      return res.status(200).json({ ok: true });
    }

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
      const overlap = await findUnavailableOverlap(
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
