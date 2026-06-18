import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase server variables are missing.' });
    }

    const telegramUserId = req.query?.telegram_user_id;
    if (!telegramUserId) {
      return res.status(400).json({ error: 'telegram_user_id is required' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('telegram_user_id', String(telegramUserId))
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const carIds = [...new Set((bookings || []).map((item) => item.car_id).filter(Boolean))];

    let carsById = {};
    if (carIds.length) {
      const { data: cars } = await supabase
        .from('cars')
        .select('id, brand, model, image_url')
        .in('id', carIds);

      carsById = Object.fromEntries((cars || []).map((car) => [String(car.id), car]));
    }

    const enriched = (bookings || []).map((booking) => ({
      ...booking,
      car: carsById[String(booking.car_id)] || null
    }));

    return res.status(200).json({ ok: true, bookings: enriched });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
