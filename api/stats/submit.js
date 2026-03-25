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

function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const s = Array.isArray(h) ? h[0] : String(h || '');
  const m = s.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON body' });
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
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  try {
    const supabase = getSupabase();
    // If a bearer token is present, trust *that* user as the run owner.
    // This prevents spoofing `user_id` from the client.
    let user_id = null;
    const token = getBearerToken(req);
    if (token) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (!userErr && userData?.user?.id) user_id = userData.user.id;
    }

    const { error } = await supabase
      .from('mantle_runs')
      .upsert(
        {
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
        },
        { onConflict: 'anon_id,mode,daily_number' }
      );

    if (error) return res.status(500).json({ error: 'Failed to save run' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
}

