import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const s = Array.isArray(h) ? h[0] : String(h || '');
  const m = s.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const token = getBearerToken(req);
    if (!token) return json(res, 401, { error: 'Missing bearer token' });

    const supabase = getSupabase();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) return json(res, 401, { error: 'Invalid token' });

    const userId = userData.user.id;
    const details = String(req.query?.details || '') === '1';
    const modeRaw = typeof req.query?.mode === 'string' ? req.query.mode : '';
    const mode = modeRaw === 'hardcore' ? 'hardcore' : modeRaw === 'daily' ? 'daily' : '';

    const baseColumns = 'anon_id,mode,daily_number,date,answer,guesses,won,created_at';
    const columns = details ? `${baseColumns},guess_history,top5` : baseColumns;

    let q = supabase.from('mantle_runs').select(columns).eq('user_id', userId).limit(5000);
    if (mode) q = q.eq('mode', mode);

    const { data, error } = await q;
    if (error) return json(res, 500, { error: 'Failed to load runs' });

    return json(res, 200, { user_id: userId, runs: Array.isArray(data) ? data : [] });
  } catch {
    return json(res, 500, { error: 'Server misconfigured' });
  }
}

