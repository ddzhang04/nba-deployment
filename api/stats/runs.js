import { createClient } from '@supabase/supabase-js';
import { getUserIdFromJwt } from '../_authUserFromJwt.js';

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

function mergeRunRows(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const mode = String(r?.mode || '');
    const n = Number(r?.daily_number);
    if (!Number.isFinite(n) || n < 1) continue;
    const k = `${mode}|${n}`;
    const prev = byKey.get(k);
    const score = (row) => {
      let s = 0;
      const gh = Array.isArray(row?.guess_history) ? row.guess_history.length : 0;
      const t5 = Array.isArray(row?.top5) ? row.top5.length : 0;
      s += gh + t5;
      const ca = typeof row?.created_at === 'string' ? row.created_at : '';
      return { s, ca };
    };
    if (!prev) {
      byKey.set(k, r);
      continue;
    }
    const a = score(prev);
    const b = score(r);
    if (b.s > a.s || (b.s === a.s && b.ca > a.ca)) byKey.set(k, r);
  }
  return Array.from(byKey.values());
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const token = getBearerToken(req);
    if (!token) return json(res, 401, { error: 'Missing bearer token' });

    const supabase = getSupabase();
    const userId = await getUserIdFromJwt(supabase, supabaseUrl, token);
    if (!userId) return json(res, 401, { error: 'Invalid token' });

    const details = String(req.query?.details || '') === '1';
    const modeRaw = typeof req.query?.mode === 'string' ? req.query.mode : '';
    const mode = modeRaw === 'hardcore' ? 'hardcore' : modeRaw === 'daily' ? 'daily' : '';

    const baseColumns = 'anon_id,mode,daily_number,date,answer,guesses,won,created_at';
    const columns = details ? `${baseColumns},guess_history,top5` : baseColumns;

    let linkedAnonIds = [];
    try {
      const { data: links, error: linkErr } = await supabase
        .from('anon_links')
        .select('anon_id')
        .eq('user_id', userId)
        .limit(500);
      if (!linkErr && Array.isArray(links)) {
        linkedAnonIds = links.map((r) => String(r?.anon_id || '').trim()).filter(Boolean);
      }
    } catch {}

    const uniqueAnons = Array.from(new Set(linkedAnonIds));

    let qUser = supabase.from('mantle_runs').select(columns).eq('user_id', userId).limit(5000);
    if (mode) qUser = qUser.eq('mode', mode);

    const runQueries = [qUser];
    if (uniqueAnons.length) {
      let qAnon = supabase.from('mantle_runs').select(columns).in('anon_id', uniqueAnons).limit(5000);
      if (mode) qAnon = qAnon.eq('mode', mode);
      runQueries.push(qAnon);
    }

    const results = await Promise.all(runQueries);
    for (const r of results) {
      if (r?.error) return json(res, 500, { error: 'Failed to load runs', detail: r.error.message });
    }

    const merged = mergeRunRows(
      results.flatMap((r) => (Array.isArray(r?.data) ? r.data : []))
    );

    return json(res, 200, { user_id: userId, runs: merged });
  } catch (e) {
    return json(res, 500, { error: 'Server misconfigured', detail: String(e?.message || e) });
  }
}
