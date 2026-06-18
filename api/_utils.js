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
