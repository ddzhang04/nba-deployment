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

/** Aggregate winning runs into { daily_number, avg, wins } when RPC is not installed. */
async function averagesFromTable(supabase, mode) {
  const { data, error } = await supabase
    .from('mantle_runs')
    .select('daily_number,guesses')
    .eq('mode', mode)
    .eq('won', true)
    .limit(50000);

  if (error) throw error;

  const byDaily = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    const dn = Number(row?.daily_number);
    const g = Number(row?.guesses);
    if (!Number.isFinite(dn) || dn < 1 || !Number.isFinite(g)) continue;
    const cur = byDaily.get(dn) || { sum: 0, count: 0 };
    cur.sum += g;
    cur.count += 1;
    byDaily.set(dn, cur);
  }

  const list = Array.from(byDaily.entries())
    .map(([daily_number, { sum, count }]) => ({
      daily_number,
      avg: count ? sum / count : 0,
      wins: count,
    }))
    .sort((a, b) => a.daily_number - b.daily_number);

  return list;
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
    if (!error) {
      const list = Array.isArray(data) ? data : [];
      return res.status(200).json({ averages: list });
    }

    // RPC missing or failed (e.g. function not defined in Supabase) — compute from table.
    try {
      const list = await averagesFromTable(supabase, mode);
      return res.status(200).json({ averages: list });
    } catch (fallbackErr) {
      return res.status(500).json({
        error: 'Failed to compute averages',
        detail: String(fallbackErr?.message || error?.message || error),
      });
    }
  } catch (e) {
    return res.status(500).json({
      error: 'Server misconfigured',
      detail: String(e?.message || e),
    });
  }
}
