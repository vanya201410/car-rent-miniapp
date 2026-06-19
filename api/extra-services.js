import { createClient } from '@supabase/supabase-js';

const DEFAULT_EXTRA_SERVICES = [
  { code: 'delivery_barcelona', name: '🚗 Доставка по Барселоне', description: 'Доставка автомобиля в пределах Барселоны', price: 30, price_type: 'fixed', max_price: null, extra_km: 0, sort_order: 1, is_active: true },
  { code: 'delivery_airport', name: '✈️ Доставка в аэропорт BCN', description: 'Доставка автомобиля в аэропорт Barcelona-El Prat', price: 40, price_type: 'fixed', max_price: null, extra_km: 0, sort_order: 2, is_active: true },
  { code: 'child_seat', name: '👶 Детское кресло', description: 'Детское кресло на весь срок аренды', price: 25, price_type: 'fixed', max_price: null, extra_km: 0, sort_order: 3, is_active: true },
  { code: 'additional_driver', name: '👤 Дополнительный водитель', description: '10 €/день, максимум 50 €. Требуются документы и права второго водителя.', price: 10, price_type: 'per_day_capped', max_price: 50, extra_km: 0, sort_order: 4, is_active: true },
  { code: 'night_service', name: '🌙 Ночная выдача/возврат', description: 'Выдача или возврат с 22:00 до 08:00', price: 30, price_type: 'fixed', max_price: null, extra_km: 0, sort_order: 5, is_active: true },
  { code: 'return_other_place', name: '📍 Возврат в другом месте', description: 'В пределах Барселоны. За пределами города — по согласованию.', price: 50, price_type: 'fixed', max_price: null, extra_km: 0, sort_order: 6, is_active: true },
  { code: 'extra_km_100', name: '🛣 Пакет +100 км', description: 'Дополнительные 100 км к лимиту пробега', price: 20, price_type: 'fixed', max_price: null, extra_km: 100, sort_order: 7, is_active: true },
  { code: 'extra_km_300', name: '🛣 Пакет +300 км', description: 'Дополнительные 300 км к лимиту пробега', price: 50, price_type: 'fixed', max_price: null, extra_km: 300, sort_order: 8, is_active: true },
  { code: 'no_wash_return', name: '🧽 Возврат без мойки', description: 'Можно вернуть автомобиль без обычной мойки. Сильное загрязнение оплачивается отдельно.', price: 20, price_type: 'fixed', max_price: null, extra_km: 0, sort_order: 9, is_active: true },
  { code: 'cross_border', name: '🌍 Выезд за пределы Испании', description: 'Только по согласованию с менеджером', price: 0, price_type: 'request', max_price: null, extra_km: 0, sort_order: 10, is_active: true }
];

function normalizeService(service) {
  const code = service.code || service.id;
  return {
    ...service,
    id: code,
    code,
    label: service.name || service.label || code,
    name: service.name || service.label || code,
    price: Number(service.price || 0),
    max_price: service.max_price === null || service.max_price === undefined ? null : Number(service.max_price),
    price_type: service.price_type || 'fixed',
    extra_km: Number(service.extra_km || 0),
    sort_order: Number(service.sort_order || 0)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(200).json({ ok: true, extra_services: DEFAULT_EXTRA_SERVICES });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from('extra_services')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.warn('extra_services fallback:', error.message);
      return res.status(200).json({ ok: true, extra_services: DEFAULT_EXTRA_SERVICES });
    }

    const services = (data && data.length ? data : DEFAULT_EXTRA_SERVICES).map(normalizeService);

    return res.status(200).json({ ok: true, extra_services: services });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ ok: true, extra_services: DEFAULT_EXTRA_SERVICES });
  }
}
