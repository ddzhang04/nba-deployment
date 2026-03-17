import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const modeRaw = typeof req.query?.mode === 'string' ? req.query.mode : '';
  const mode = modeRaw === 'hardcore' ? 'hardcore' : modeRaw === 'daily' ? 'daily' : 'daily';

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_mantle_answer_averages', { p_mode: mode });
    if (error) return res.status(500).json({ error: 'Failed to compute averages' });
    const list = Array.isArray(data) ? data : [];
    return res.status(200).json({ averages: list });
  } catch {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
}

