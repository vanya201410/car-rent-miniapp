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

    const carId = req.query?.car_id;

    if (!carId) {
      return res.status(400).json({ error: 'car_id is required' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from('bookings')
      .select('id, start_date, end_date, status')
      .eq('car_id', carId)
      .eq('status', 'confirmed')
      .order('start_date', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, busy_ranges: data || [] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
