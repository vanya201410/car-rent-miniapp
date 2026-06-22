import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody, findUnavailableOverlap } from './_utils.js';

const INCLUDED_KM_PER_DAY = 200;
const EXTRA_KM_PRICE = 0.25;
const RENTAL_RULES_VERSION = 'v1.0_2026_06';

const PREPAYMENT_STATUS_PENDING = 'pending';
const PREPAYMENT_STATUS_PAID = 'paid';

function isPremiumCar(car) {
  const text = `${car?.brand || ''} ${car?.model || ''}`.toLowerCase();
  const deposit = Number(car?.deposit || 0);
  const pricePerDay = Number(car?.price_per_day || 0);

  return text.includes('jaguar') || deposit >= 800 || pricePerDay >= 120;
}

function calculatePrepaymentAmount(car, daysCount, totalPrice) {
  const total = Math.max(Number(totalPrice || 0), 0);
  if (!total) return 0;

  let amount = 50;

  if (isPremiumCar(car)) {
    amount = 100;
  } else if (Number(daysCount || 0) <= 3) {
    amount = 30;
  } else {
    amount = 50;
  }

  return Math.min(amount, total);
}

const FALLBACK_EXTRA_SERVICES = [
  { code: 'delivery_barcelona', name: '🚗 Доставка по Барселоне', price: 30, price_type: 'fixed', max_price: null, extra_km: 0, is_active: true, sort_order: 1 },
  { code: 'delivery_airport', name: '✈️ Доставка в аэропорт BCN', price: 40, price_type: 'fixed', max_price: null, extra_km: 0, is_active: true, sort_order: 2 },
  { code: 'child_seat', name: '👶 Детское кресло', price: 25, price_type: 'fixed', max_price: null, extra_km: 0, is_active: true, sort_order: 3 },
  { code: 'additional_driver', name: '👤 Дополнительный водитель', price: 10, price_type: 'per_day_capped', max_price: 50, extra_km: 0, is_active: true, sort_order: 4 },
  { code: 'night_service', name: '🌙 Ночная выдача/возврат', price: 30, price_type: 'fixed', max_price: null, extra_km: 0, is_active: true, sort_order: 5 },
  { code: 'return_other_place', name: '📍 Возврат в другом месте', price: 50, price_type: 'fixed', max_price: null, extra_km: 0, is_active: true, sort_order: 6 },
  { code: 'extra_km_100', name: '🛣 Пакет +100 км', price: 20, price_type: 'fixed', max_price: null, extra_km: 100, is_active: true, sort_order: 7 },
  { code: 'extra_km_300', name: '🛣 Пакет +300 км', price: 50, price_type: 'fixed', max_price: null, extra_km: 300, is_active: true, sort_order: 8 },
  { code: 'no_wash_return', name: '🧽 Возврат без мойки', price: 20, price_type: 'fixed', max_price: null, extra_km: 0, is_active: true, sort_order: 9 },
  { code: 'cross_border', name: '🌍 Выезд за пределы Испании', price: 0, price_type: 'request', max_price: null, extra_km: 0, is_active: true, sort_order: 10 }
];

function unique(array) {
  return [...new Set((array || []).filter(Boolean).map(String))];
}

function normalizeSelectedCodes(payload) {
  const fromArray = Array.isArray(payload.selected_extra_service_codes)
    ? payload.selected_extra_service_codes
    : [];

  const fromExtrasObject = payload.extras && typeof payload.extras === 'object'
    ? Object.entries(payload.extras).filter(([, value]) => Boolean(value)).map(([key]) => key)
    : [];

  let codes = unique([...fromArray, ...fromExtrasObject]);

  // Защита: только одна доставка.
  if (codes.includes('delivery_airport')) {
    codes = codes.filter((code) => code !== 'delivery_barcelona');
  }

  // Защита: только один пакет километров.
  if (codes.includes('extra_km_300')) {
    codes = codes.filter((code) => code !== 'extra_km_100');
  }

  return codes;
}

function calculateExtraServiceTotal(service, daysCount) {
  if (!service) return 0;
  if (service.price_type === 'request') return 0;

  const price = Number(service.price || 0);

  if (service.price_type === 'per_day_capped') {
    const days = Math.max(Number(daysCount || 1), 1);
    const rawTotal = days * price;
    const maxPrice = service.max_price === null || service.max_price === undefined ? null : Number(service.max_price);
    return maxPrice ? Math.min(rawTotal, maxPrice) : rawTotal;
  }

  return price;
}

async function loadExtraServices(supabase, selectedCodes) {
  if (!selectedCodes.length) return [];

  const { data, error } = await supabase
    .from('extra_services')
    .select('*')
    .in('code', selectedCodes)
    .eq('is_active', true);

  if (error) {
    console.warn('Не удалось загрузить extra_services, используем резервный список:', error.message);
    return FALLBACK_EXTRA_SERVICES.filter((service) => selectedCodes.includes(service.code));
  }

  return data || [];
}

function buildExtrasObject(selectedServices) {
  return selectedServices.reduce((acc, service) => {
    acc[service.code] = true;
    return acc;
  }, {});
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

    const payload = getBody(req);

    const requiredFields = ['car_id', 'customer_name', 'phone', 'start_date', 'end_date', 'days_count', 'total_price'];
    for (const field of requiredFields) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        return res.status(400).json({ error: `Missing field: ${field}` });
      }
    }

    if (payload.rules_accepted !== true) {
      return res.status(400).json({ error: 'Перед отправкой заявки нужно принять правила аренды.' });
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

    const selectedCodes = normalizeSelectedCodes(payload);
    const servicesFromDb = await loadExtraServices(supabase, selectedCodes);
    const servicesByCode = Object.fromEntries((servicesFromDb || []).map((service) => [service.code, service]));

    const selectedServices = selectedCodes
      .map((code) => servicesByCode[code])
      .filter(Boolean)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    const serviceRows = selectedServices.map((service) => {
      const quantity = service.price_type === 'per_day_capped' ? Math.max(Number(payload.days_count || 1), 1) : 1;
      const total = calculateExtraServiceTotal(service, payload.days_count);

      return {
        service,
        row: {
          service_code: service.code,
          service_name: service.name || service.label || service.code,
          price: Number(service.price || 0),
          quantity,
          total
        }
      };
    });

    const extrasTotal = serviceRows.reduce((sum, item) => sum + Number(item.row.total || 0), 0);
    const basePrice = Number(payload.base_price || 0);
    const totalPrice = basePrice + extrasTotal;
    const extras = buildExtrasObject(selectedServices);
    const includedKmPerDay = Number(payload.included_km_per_day || INCLUDED_KM_PER_DAY);
    const includedKm = Number(payload.included_km || (Number(payload.days_count || 0) * includedKmPerDay));
    const extraKmPrice = Number(payload.extra_km_price || EXTRA_KM_PRICE);
    const rulesVersion = payload.rules_version || RENTAL_RULES_VERSION;
    const prepaymentAmount = calculatePrepaymentAmount(car, payload.days_count, totalPrice);
    const remainingAmount = Math.max(0, totalPrice - prepaymentAmount);

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        car_id: payload.car_id,
        customer_name: payload.customer_name,
        phone: payload.phone,
        start_date: payload.start_date,
        end_date: payload.end_date,
        days_count: payload.days_count,
        base_price: basePrice,
        discount_percent: payload.discount_percent || 0,
        discount_amount: payload.discount_amount || 0,
        discount_label: payload.discount_label || null,
        extras_total: extrasTotal,
        extras,
        total_price: totalPrice,
        status: 'pending_prepayment',
        prepayment_amount: prepaymentAmount,
        prepayment_status: PREPAYMENT_STATUS_PENDING,
        prepayment_paid_at: null,
        payment_method: null,
        remaining_amount: remainingAmount,
        online_payment_status: 'not_started',
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        online_paid_amount: 0,
        online_paid_at: null,
        payment_url: null,
        payment_type: 'prepayment',
        last_online_payment_type: null,
        rental_payment_status: 'not_paid',
        rental_paid_amount: 0,
        rental_paid_at: null,
        full_payment_status: 'not_started',
        full_payment_amount: 0,
        full_payment_paid_at: null,
        remaining_payment_status: 'not_started',
        remaining_paid_amount: 0,
        remaining_paid_at: null,
        comment: payload.comment || '',
        telegram_user_id: payload.telegram_user_id ? String(payload.telegram_user_id) : null,
        telegram_username: payload.telegram_username || null,
        included_km: includedKm,
        included_km_per_day: includedKmPerDay,
        extra_km_price: extraKmPrice,
        rules_accepted: true,
        rules_accepted_at: new Date().toISOString(),
        rules_version: rulesVersion
      })
      .select()
      .single();

    if (bookingError) {
      return res.status(400).json({ error: bookingError.message });
    }

    if (serviceRows.length) {
      const bookingExtraRows = serviceRows.map(({ service, row }) => ({
        booking_id: booking.id,
        service_id: service.id,
        service_code: row.service_code,
        service_name: row.service_name,
        price: row.price,
        quantity: row.quantity,
        total: row.total
      }));

      const { error: bookingExtrasError } = await supabase
        .from('booking_extra_services')
        .insert(bookingExtraRows);

      if (bookingExtrasError) {
        console.error('booking_extra_services insert error:', bookingExtrasError.message);
      }
    }

    if (botToken && adminChatId) {
      const servicesText = serviceRows
        .map(({ row }) => `${row.service_name} — ${row.total} €`)
        .join('\n');


      const text = [
        '🚗 <b>Новая заявка на аренду</b>',
        '',
        `<b>Авто:</b> ${escapeHtml(car.brand)} ${escapeHtml(car.model)}`,
        `<b>Даты:</b> ${escapeHtml(payload.start_date)} — ${escapeHtml(payload.end_date)}`,
        `<b>Дней:</b> ${escapeHtml(payload.days_count)}`,
        basePrice ? `<b>Аренда:</b> ${escapeHtml(basePrice)} €` : '',
        payload.discount_amount ? `<b>Скидка:</b> −${escapeHtml(payload.discount_amount)} €${payload.discount_label ? ' · ' + escapeHtml(payload.discount_label) : ''}` : '',
        extrasTotal ? `<b>Доп. услуги:</b> ${escapeHtml(extrasTotal)} €` : '',
        servicesText ? `<b>Выбрано:</b>\n${escapeHtml(servicesText)}` : '',
        includedKm ? `<b>Включено км:</b> ${escapeHtml(includedKm)} км (${escapeHtml(includedKmPerDay)} км/день)` : '',
        `<b>Доп. км сверх лимита:</b> ${escapeHtml(extraKmPrice)} €/км`,
        `<b>Правила приняты:</b> да · ${escapeHtml(rulesVersion)}`,
        `<b>Сумма:</b> ${escapeHtml(totalPrice)} €`,
        `<b>Предоплата для фиксации:</b> ${escapeHtml(prepaymentAmount)} €`,
        `<b>Остаток при получении:</b> ${escapeHtml(remainingAmount)} €`,
        `<b>Статус предоплаты:</b> ожидается`,
        `<b>Онлайн-оплата:</b> клиент может оплатить предоплату или всю аренду картой через приложение`,
        car.deposit ? `<b>Залог:</b> ${escapeHtml(car.deposit)} €` : '',
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
              { text: '💰 Предоплата получена', callback_data: `prepayment_paid:${booking.id}` }
            ],
            [
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
