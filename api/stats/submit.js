import { createClient } from '@supabase/supabase-js';
import { getUserIdFromJwt } from '../_authUserFromJwt.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const s = Array.isArray(h) ? h[0] : String(h || '');
  const m = s.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  let body = await readBody(req);
  if (!body || typeof body !== 'object') {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const anon_id = typeof body.anon_id === 'string' ? body.anon_id.trim() : '';
  const modeRaw = typeof body.mode === 'string' ? body.mode : '';
  const mode = modeRaw === 'hardcore' ? 'hardcore' : modeRaw === 'daily' ? 'daily' : '';
  const daily_number = Number.isFinite(Number(body.dailyNumber)) ? Number(body.dailyNumber) : null;
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  const guesses = Number.isFinite(Number(body.guesses)) ? Number(body.guesses) : null;
  const won = typeof body.won === 'boolean' ? body.won : null;
  const guess_history = Array.isArray(body.guessHistory) ? body.guessHistory : [];
  const top5 = Array.isArray(body.top5) ? body.top5 : [];

  if (!anon_id || !mode || !daily_number || daily_number < 1 || !date || !answer || guesses == null || guesses < 0 || won == null) {
    return json(res, 400, { error: 'Missing or invalid fields' });
  }

  try {
    const supabase = getSupabase();
    const token = getBearerToken(req);
    const user_id = token ? await getUserIdFromJwt(supabase, supabaseUrl, token) : null;

    const rowFull = {
      anon_id,
      user_id,
      mode,
      daily_number,
      date,
      answer,
      guesses,
      won,
      guess_history,
      top5,
    };

    const rowMinimal = {
      anon_id,
      user_id,
      mode,
      daily_number,
      date,
      answer,
      guesses,
      won,
    };

    let { error } = await supabase.from('mantle_runs').upsert(rowFull, {
      onConflict: 'anon_id,mode,daily_number',
    });

    if (error) {
      const msg = String(error.message || '');
      const maybeMissingJson = /guess_history|top5|user_id|column/i.test(msg);
      if (maybeMissingJson) {
        ({ error } = await supabase.from('mantle_runs').upsert(rowMinimal, {
          onConflict: 'anon_id,mode,daily_number',
        }));
      }
    }

    if (error) {
      return json(res, 500, { error: 'Failed to save run', detail: error.message });
    }
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: 'Server misconfigured', detail: String(e?.message || e) });
  }
}
