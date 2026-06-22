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

    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, start_date, end_date, status')
      .eq('car_id', carId)
      .eq('status', 'confirmed')
      .order('start_date', { ascending: true });

    if (bookingsError) {
      return res.status(400).json({ error: bookingsError.message });
    }

    const { data: blocks, error: blocksError } = await supabase
      .from('blocked_dates')
      .select('id, start_date, end_date, reason')
      .eq('car_id', carId)
      .order('start_date', { ascending: true });

    const safeBlocks = blocksError ? [] : (blocks || []);

    const busyRanges = [
      ...(bookings || []).map((item) => ({ ...item, type: 'booking' })),
      ...safeBlocks.map((item) => ({ ...item, status: 'blocked', type: 'block' }))
    ].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));

    return res.status(200).json({ ok: true, busy_ranges: busyRanges });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
