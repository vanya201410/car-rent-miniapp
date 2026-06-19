export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export async function telegramApi(botToken, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data.ok === false) {
    console.error(`Telegram API ${method} error:`, data);
  }

  return data;
}

export function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export async function findConfirmedOverlap(supabase, carId, startDate, endDate, excludeBookingId = null) {
  let query = supabase
    .from('bookings')
    .select('id, start_date, end_date, status')
    .eq('car_id', carId)
    .eq('status', 'confirmed')
    .lt('start_date', endDate)
    .gt('end_date', startDate)
    .limit(1);

  if (excludeBookingId) {
    query = query.neq('id', excludeBookingId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data && data.length > 0 ? data[0] : null;
}

export async function findBlockedOverlap(supabase, carId, startDate, endDate) {
  const { data, error } = await supabase
    .from('blocked_dates')
    .select('id, start_date, end_date, reason')
    .eq('car_id', carId)
    .lt('start_date', endDate)
    .gt('end_date', startDate)
    .limit(1);

  if (error) {
    if (String(error.message || '').includes('blocked_dates')) return null;
    throw error;
  }

  return data && data.length > 0 ? data[0] : null;
}

export async function findUnavailableOverlap(supabase, carId, startDate, endDate, excludeBookingId = null) {
  const booking = await findConfirmedOverlap(supabase, carId, startDate, endDate, excludeBookingId);
  if (booking) {
    return { type: 'booking', ...booking };
  }

  const block = await findBlockedOverlap(supabase, carId, startDate, endDate);
  if (block) {
    return { type: 'block', ...block };
  }

  return null;
}

export function bookingStatusText(status) {
  if (status === 'new') return 'новая';
  if (status === 'confirmed') return 'подтверждена ✅';
  if (status === 'cancelled') return 'отменена ❌';
  if (status === 'completed') return 'завершена 🏁';
  return status;
}

export function buildAdminBookingText({ title, booking, car }) {
  const extras = booking.extras && typeof booking.extras === 'object'
    ? Object.entries(booking.extras).filter(([, value]) => Boolean(value)).map(([key]) => key)
    : [];

  return [
    title,
    '',
    `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
    `<b>Даты:</b> ${escapeHtml(booking.start_date)} — ${escapeHtml(booking.end_date)}`,
    `<b>Дней:</b> ${escapeHtml(booking.days_count)}`,
    booking.base_price ? `<b>Аренда:</b> ${escapeHtml(booking.base_price)} €` : '',
    booking.discount_amount ? `<b>Скидка:</b> −${escapeHtml(booking.discount_amount)} €${booking.discount_label ? ' · ' + escapeHtml(booking.discount_label) : ''}` : '',
    booking.extras_total ? `<b>Доп. услуги:</b> ${escapeHtml(booking.extras_total)} €` : '',
    `<b>Сумма:</b> ${escapeHtml(booking.total_price)} €`,
    car?.deposit ? `<b>Залог:</b> ${escapeHtml(car.deposit)} €` : '',
    extras.length ? `<b>Услуги:</b> ${escapeHtml(extras.join(', '))}` : '',
    '',
    `<b>Клиент:</b> ${escapeHtml(booking.customer_name)}`,
    `<b>Телефон:</b> ${escapeHtml(booking.phone)}`,
    booking.telegram_username ? `<b>Telegram:</b> @${escapeHtml(booking.telegram_username)}` : '',
    booking.comment ? `<b>Комментарий:</b> ${escapeHtml(booking.comment)}` : '',
    '',
    `<b>ID заявки:</b> ${booking.id}`,
    `<b>Статус:</b> ${bookingStatusText(booking.status)}`
  ].filter(Boolean).join('\n');
}
