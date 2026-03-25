import { createClient } from '@supabase/supabase-js';
import { DAILY_PUZZLE_EPOCH } from '../src/data/dailyPlayers.js';

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

function parseMode(modeRaw) {
  const m = typeof modeRaw === 'string' ? modeRaw : '';
  if (m === 'hardcore') return 'hardcore';
  return 'daily';
}

const DAILY_PUZZLE_INDEX_OFFSET = -1;

function getDailyPuzzleIndexDisplayed() {
  const epoch = new Date(`${DAILY_PUZZLE_EPOCH}T00:00:00.000Z`).getTime();
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((todayUTC - epoch) / 86400000) + DAILY_PUZZLE_INDEX_OFFSET);
}

function getISODateForDailyIndex(index) {
  const epochUTC = Date.UTC(
    Number(DAILY_PUZZLE_EPOCH.slice(0, 4)),
    Number(DAILY_PUZZLE_EPOCH.slice(5, 7)) - 1,
    Number(DAILY_PUZZLE_EPOCH.slice(8, 10))
  );
  const d = new Date(epochUTC + index * 86400000);
  return d.toISOString().slice(0, 10);
}

function hashAnonId(str) {
  // FNV-1a 32-bit
  const s = String(str || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const VERIFIED_ANON_IDS = (() => {
  const raw = process.env.VERIFIED_ANON_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
})();

// Tiny in-memory cache (works per serverless instance)
const cache = new Map(); // key -> { ts, value }
const TTL_MS = 1000 * 60; // 1 min

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const mode = parseMode(req.query?.mode);
    const dailyNumberRaw = req.query?.dailyNumber;
    const dailyNumberNum = Number(dailyNumberRaw);
    const dailyNumber =
      Number.isFinite(dailyNumberNum) && dailyNumberNum > 0 ? dailyNumberNum : getDailyPuzzleIndexDisplayed() + 1;

    const limit = Math.min(50, Math.max(5, Number(req.query?.limit) || 25));
    const cacheKey = `${mode}-${dailyNumber}-${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts <= TTL_MS) return json(res, 200, cached.value);

    const supabase = getSupabase();

    // One row per anon_id+mode+daily_number due to upsert conflict.
    const { data, error } = await supabase
      .from('mantle_runs')
      .select('anon_id,guesses,won')
      .eq('mode', mode)
      .eq('daily_number', dailyNumber)
      .eq('won', true)
      .limit(50000);

    if (error) return json(res, 500, { error: 'Failed to load leaderboard' });

    const rows = Array.isArray(data) ? data : [];
    const byAnon = new Map();
    for (const r of rows) {
      if (!r?.anon_id) continue;
      const anon_id = String(r.anon_id);
      const guesses = typeof r.guesses === 'number' ? r.guesses : Number(r.guesses);
      if (!Number.isFinite(guesses)) continue;

      // For this day, wins is 1 per anon_id due to unique upsert; but keep generic.
      const cur = byAnon.get(anon_id) || { anon_id, wins: 0, totalGuesses: 0 };
      cur.wins += 1;
      cur.totalGuesses += guesses;
      byAnon.set(anon_id, cur);
    }

    const anonIdsInRank = Array.from(byAnon.values()).map((x) => String(x.anon_id));

    // Optional: if profiles/anon_links exist, show real display names + verified flag.
    let anonToProfile = new Map(); // anon_id -> { display_name, avatar_url, is_verified }
    try {
      if (anonIdsInRank.length) {
        const { data: links } = await supabase
          .from('anon_links')
          .select('anon_id,user_id')
          .in('anon_id', anonIdsInRank);

        const userIds = Array.isArray(links) ? links.map((l) => l.user_id).filter(Boolean) : [];
        if (userIds.length) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id,display_name,avatar_url,is_verified')
            .in('user_id', userIds);

          const profileByUserId = new Map();
          for (const p of Array.isArray(profiles) ? profiles : []) {
            profileByUserId.set(p.user_id, p);
          }
          for (const l of Array.isArray(links) ? links : []) {
            const p = profileByUserId.get(l.user_id);
            if (p) anonToProfile.set(String(l.anon_id), p);
          }
        }
      }
    } catch {
      // If tables don't exist yet, fall back to anon hashes.
    }

    const entries = Array.from(byAnon.values())
      .map((x) => {
        const linked = anonToProfile.get(String(x.anon_id));
        const user = linked?.display_name || `Player ${hashAnonId(x.anon_id).slice(0, 4)}`;
        const verified = linked?.is_verified === true || VERIFIED_ANON_IDS.has(x.anon_id);
        return {
          anon_id: x.anon_id,
          user,
          verified,
          wins: x.wins,
          avgGuesses: x.totalGuesses / Math.max(1, x.wins),
        };
      })
      .sort((a, b) => {
        // Lower avg guesses is better; if tie, more wins is better.
        if (a.avgGuesses !== b.avgGuesses) return a.avgGuesses - b.avgGuesses;
        return b.wins - a.wins;
      })
      .slice(0, limit)
      .map((e) => ({ ...e, avgGuesses: Number(e.avgGuesses.toFixed(2)) }));

    const value = {
      mode,
      dailyNumber,
      updatedAt: new Date().toISOString(),
      entries,
      date: getISODateForDailyIndex(dailyNumber - 1),
    };

    cache.set(cacheKey, { ts: Date.now(), value });
    return json(res, 200, value);
  } catch (e) {
    return json(res, 500, { error: 'Server misconfigured' });
  }
}

