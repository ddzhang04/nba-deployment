import { createClient } from '@supabase/supabase-js';
import { getDailyPuzzleDayIndex } from '../src/data/dailyPlayers.js';

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
  return modeRaw === 'hardcore' ? 'hardcore' : 'daily';
}

/** Keep in sync with `DAILY_PUZZLE_INDEX_OFFSET` in `src/App.jsx`. */
const DAILY_PUZZLE_INDEX_OFFSET = -1;

function hashAnonId(str) {
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

const cache = new Map();
const TTL_MS = 1000 * 90;

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const mode = parseMode(req.query?.mode);
    const limit = Math.min(50, Math.max(5, Number(req.query?.limit) || 20));
    const lookbackDays = Math.min(180, Math.max(14, Number(req.query?.lookbackDays) || 60));
    const minWinsForSpeed = Math.min(20, Math.max(1, Number(req.query?.minWinsForSpeed) || 3));

    const todayDailyNumber = getDailyPuzzleDayIndex(new Date(), DAILY_PUZZLE_INDEX_OFFSET) + 1;
    const firstDailyNumber = Math.max(1, todayDailyNumber - lookbackDays + 1);
    const cacheKey = `${mode}:${limit}:${lookbackDays}:${minWinsForSpeed}:${todayDailyNumber}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts <= TTL_MS) return json(res, 200, cached.value);

    const supabase = getSupabase();

    const { data: rows, error: rpcErr } = await supabase.rpc('get_leaderboard_snapshot', {
      p_mode: mode,
      p_first_daily: firstDailyNumber,
      p_last_daily: todayDailyNumber,
    });

    if (rpcErr) {
      return json(res, 503, {
        error: 'Leaderboards unavailable',
        hint: 'Run supabase/setup.sql in your Supabase SQL editor (get_leaderboard_snapshot).',
        details: rpcErr.message || String(rpcErr),
      });
    }

    const rawRows = Array.isArray(rows) ? rows : [];
    const userIds = Array.from(
      new Set(rawRows.map((r) => r?.user_id).filter(Boolean))
    );
    const profileByUserId = new Map();
    if (userIds.length) {
      try {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id,display_name,avatar_url,is_verified')
          .in('user_id', userIds);
        for (const p of Array.isArray(profiles) ? profiles : []) {
          profileByUserId.set(p.user_id, p);
        }
      } catch {
        // optional
      }
    }

    const entries = rawRows.map((r) => {
      const anon_id = String(r?.anon_id || '').trim();
      const prof = r?.user_id ? profileByUserId.get(r.user_id) : null;
      const completions = Number(r?.completions) || 0;
      const wins = Number(r?.wins) || 0;
      const totalGuesses = Number(r?.total_guesses) || 0;
      const totalGuessesAll = Number(r?.total_guesses_all) || totalGuesses;
      const avgGuesses = wins > 0 ? totalGuesses / wins : null;
      return {
        anon_id,
        user: prof?.display_name || `Player ${hashAnonId(anon_id).slice(0, 4)}`,
        avatarUrl: prof?.avatar_url || '',
        verified: prof?.is_verified === true || VERIFIED_ANON_IDS.has(anon_id),
        completions,
        wins,
        totalGuessesAll,
        avgGuesses: avgGuesses == null ? null : Number(avgGuesses.toFixed(2)),
        currentStreak: Number(r?.current_live_streak) || 0,
        maxStreak: Number(r?.max_live_streak) || 0,
      };
    });

    const speed = entries
      .filter((e) => e.wins >= minWinsForSpeed && e.avgGuesses != null)
      .sort((a, b) => {
        if (a.avgGuesses !== b.avgGuesses) return a.avgGuesses - b.avgGuesses;
        if (a.wins !== b.wins) return b.wins - a.wins;
        return b.maxStreak - a.maxStreak;
      })
      .slice(0, limit)
      .map((e) => ({ ...e, avgGuesses: Number(e.avgGuesses.toFixed(2)) }));

    const wins = entries
      .filter((e) => e.wins > 0)
      .sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        const aa = Number.isFinite(a.avgGuesses) ? a.avgGuesses : Infinity;
        const bb = Number.isFinite(b.avgGuesses) ? b.avgGuesses : Infinity;
        if (aa !== bb) return aa - bb;
        return b.maxStreak - a.maxStreak;
      })
      .slice(0, limit);

    const streaks = entries
      .filter((e) => e.maxStreak > 0)
      .sort((a, b) => {
        if (a.maxStreak !== b.maxStreak) return b.maxStreak - a.maxStreak;
        if (a.currentStreak !== b.currentStreak) return b.currentStreak - a.currentStreak;
        return b.wins - a.wins;
      })
      .slice(0, limit);

    const completed = entries
      .filter((e) => e.completions > 0)
      .sort((a, b) => {
        if (a.completions !== b.completions) return b.completions - a.completions;
        return b.wins - a.wins;
      })
      .slice(0, limit);

    const guesses = entries
      .filter((e) => e.totalGuessesAll > 0)
      .sort((a, b) => {
        if (a.totalGuessesAll !== b.totalGuessesAll) return b.totalGuessesAll - a.totalGuessesAll;
        return b.completions - a.completions;
      })
      .slice(0, limit);

    const value = {
      mode,
      todayDailyNumber,
      lookbackDays,
      minWinsForSpeed,
      updatedAt: new Date().toISOString(),
      speed,
      wins,
      streaks,
      completed,
      guesses,
    };
    cache.set(cacheKey, { ts: Date.now(), value });
    return json(res, 200, value);
  } catch (e) {
    return json(res, 500, { error: 'Server misconfigured' });
  }
}
