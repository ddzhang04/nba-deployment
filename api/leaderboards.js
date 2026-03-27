import { createClient } from '@supabase/supabase-js';
import { getDailyPuzzleDayIndex, getISODateForDailyIndexFromEpoch } from '../src/data/dailyPlayers.js';

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

function getYmdInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (!y || !m || !d) return '';
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
}

function computeCurrentStreak(winDailyNums, todayDailyNumber, firstDailyNumber) {
  const start = winDailyNums.has(todayDailyNumber) ? todayDailyNumber : todayDailyNumber - 1;
  let streak = 0;
  for (let n = start; n >= firstDailyNumber; n--) {
    if (!winDailyNums.has(n)) break;
    streak++;
  }
  return streak;
}

function computeMaxStreak(winDailyNums, todayDailyNumber, firstDailyNumber) {
  let run = 0;
  let best = 0;
  for (let n = firstDailyNumber; n <= todayDailyNumber; n++) {
    if (winDailyNums.has(n)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

// Tiny in-memory cache (per serverless instance)
const cache = new Map();
const TTL_MS = 1000 * 45;

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const mode = parseMode(req.query?.mode);
    const limit = Math.min(50, Math.max(5, Number(req.query?.limit) || 20));
    const lookbackDays = Math.min(365, Math.max(30, Number(req.query?.lookbackDays) || 120));
    const minWinsForSpeed = Math.min(20, Math.max(1, Number(req.query?.minWinsForSpeed) || 3));

    const todayDailyNumber = getDailyPuzzleDayIndex() + 1;
    const firstDailyNumber = Math.max(1, todayDailyNumber - lookbackDays + 1);
    const cacheKey = `${mode}:${limit}:${lookbackDays}:${minWinsForSpeed}:${todayDailyNumber}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts <= TTL_MS) return json(res, 200, cached.value);

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('mantle_runs')
      .select('anon_id,user_id,daily_number,guesses,won,created_at')
      .eq('mode', mode)
      .gte('daily_number', firstDailyNumber)
      .lte('daily_number', todayDailyNumber)
      .limit(200000);

    if (error) return json(res, 500, { error: 'Failed to load leaderboard data' });

    const rows = Array.isArray(data) ? data : [];
    const byAnon = new Map();
    for (const r of rows) {
      const anonId = String(r?.anon_id || '').trim();
      if (!anonId) continue;
      const dailyNum = Number(r?.daily_number);
      if (!Number.isFinite(dailyNum) || dailyNum < 1) continue;

      let agg = byAnon.get(anonId);
      if (!agg) {
        agg = {
          anon_id: anonId,
          user_id: null,
          wins: 0,
          totalGuesses: 0,
          liveWinDailyNums: new Set(),
        };
        byAnon.set(anonId, agg);
      }

      if (r?.user_id) agg.user_id = r.user_id;
      if (r?.won !== true) continue;

      const g = Number(r?.guesses);
      agg.wins += 1;
      if (Number.isFinite(g)) agg.totalGuesses += g;

      const expectedDate = getISODateForDailyIndexFromEpoch(dailyNum - 1);
      const completedDate = typeof r?.created_at === 'string' ? getYmdInTimeZone(new Date(r.created_at), 'America/New_York') : '';
      if (completedDate && completedDate === expectedDate) {
        agg.liveWinDailyNums.add(dailyNum);
      }
    }

    const userIds = Array.from(new Set(
      Array.from(byAnon.values()).map((x) => x.user_id).filter(Boolean)
    ));
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
        // Optional table may not exist in some deployments.
      }
    }

    const entries = Array.from(byAnon.values()).map((x) => {
      const prof = x.user_id ? profileByUserId.get(x.user_id) : null;
      const avgGuesses = x.wins > 0 ? x.totalGuesses / x.wins : null;
      const currentStreak = computeCurrentStreak(x.liveWinDailyNums, todayDailyNumber, firstDailyNumber);
      const maxStreak = computeMaxStreak(x.liveWinDailyNums, todayDailyNumber, firstDailyNumber);
      return {
        anon_id: x.anon_id,
        user: prof?.display_name || `Player ${hashAnonId(x.anon_id).slice(0, 4)}`,
        avatarUrl: prof?.avatar_url || '',
        verified: prof?.is_verified === true,
        wins: x.wins,
        avgGuesses: avgGuesses == null ? null : Number(avgGuesses.toFixed(2)),
        currentStreak,
        maxStreak,
      };
    });

    const speed = entries
      .filter((e) => e.wins >= minWinsForSpeed && e.avgGuesses != null)
      .sort((a, b) => {
        if (a.avgGuesses !== b.avgGuesses) return a.avgGuesses - b.avgGuesses;
        if (a.wins !== b.wins) return b.wins - a.wins;
        return b.maxStreak - a.maxStreak;
      })
      .slice(0, limit);

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

    const value = {
      mode,
      todayDailyNumber,
      lookbackDays,
      minWinsForSpeed,
      updatedAt: new Date().toISOString(),
      speed,
      wins,
      streaks,
    };
    cache.set(cacheKey, { ts: Date.now(), value });
    return json(res, 200, value);
  } catch {
    return json(res, 500, { error: 'Server misconfigured' });
  }
}
