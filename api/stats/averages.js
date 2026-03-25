import { createClient } from '@supabase/supabase-js';
import { json, parseQuery } from '../_http.js';

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

/** Aggregate winning runs into { daily_number, avg, wins } */
async function averagesFromTable(supabase, mode) {
  let { data, error } = await supabase
    .from('mantle_runs')
    .select('daily_number,guesses')
    .eq('mode', mode)
    .eq('won', true)
    .limit(50000);

  if (error && /won|column|42703|PGRST204/i.test(String(error.message || ''))) {
    ({ data, error } = await supabase
      .from('mantle_runs')
      .select('daily_number,guesses')
      .eq('mode', mode)
      .limit(50000));
  }

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

  return Array.from(byDaily.entries())
    .map(([daily_number, { sum, count }]) => ({
      daily_number,
      avg: count ? sum / count : 0,
      wins: count,
    }))
    .sort((a, b) => a.daily_number - b.daily_number);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const q = parseQuery(req);
  const modeRaw = typeof q.mode === 'string' ? q.mode : '';
  const mode = modeRaw === 'hardcore' ? 'hardcore' : 'daily';

  try {
    const supabase = getSupabase();

    // Table aggregation is reliable; RPC shape/version mismatches caused 500s for some projects.
    const list = await averagesFromTable(supabase, mode);
    return json(res, 200, { averages: list });
  } catch (e) {
    return json(res, 500, {
      error: 'Failed to compute averages',
      detail: String(e?.message || e),
    });
  }
}
