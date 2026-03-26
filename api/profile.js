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

function getDailyPuzzleIndexDisplayed() {
  return getDailyPuzzleDayIndex();
}

function getISODateForDailyIndex(index) {
  return getISODateForDailyIndexFromEpoch(index);
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

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const modeRaw = req.query?.mode;
    const mode = modeRaw === 'hardcore' ? 'hardcore' : 'daily';
    const anon_id = typeof req.query?.anon_id === 'string' ? req.query.anon_id.trim() : '';
    if (!anon_id) return json(res, 400, { error: 'Missing anon_id' });

    const lookbackDays = Math.min(180, Math.max(20, Number(req.query?.lookbackDays) || 60));

    const todayDailyNumber = getDailyPuzzleIndexDisplayed() + 1;
    const startDailyNumber = Math.max(1, todayDailyNumber - lookbackDays);

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('mantle_runs')
      .select('daily_number,won,guesses,date,created_at')
      .eq('mode', mode)
      .eq('anon_id', anon_id)
      .gte('daily_number', startDailyNumber)
      .limit(200000);

    if (error) return json(res, 500, { error: 'Failed to load profile' });

    const rows = Array.isArray(data) ? data : [];

    // winByDailyNum only counts "live wins" when solve happened on the scheduled date.
    const winByDailyNum = new Map();
    const guessesByDailyNum = new Map();

    for (const r of rows) {
      const num = r?.daily_number;
      const won = r?.won === true;
      if (!Number.isFinite(Number(num)) || !won) continue;
      const dailyNum = Number(num);

      const expectedDate = getISODateForDailyIndex(dailyNum - 1);
      const completionDate = typeof r?.created_at === 'string' ? r.created_at.slice(0, 10) : r?.date;
      const completionDateOk = typeof completionDate === 'string' && completionDate === expectedDate;
      if (!completionDateOk) continue;

      winByDailyNum.set(dailyNum, true);
      const g = typeof r?.guesses === 'number' ? r.guesses : Number(r?.guesses);
      if (Number.isFinite(g)) guessesByDailyNum.set(dailyNum, g);
    }

    let wins = 0;
    let totalGuesses = 0;
    let recent = [];

    for (let num = startDailyNumber; num <= todayDailyNumber; num++) {
      if (winByDailyNum.has(num)) {
        wins++;
        const g = guessesByDailyNum.get(num);
        if (Number.isFinite(g)) totalGuesses += g;
      }
    }

    const avgGuesses = wins > 0 ? totalGuesses / wins : null;

    // Current streak (ending today or yesterday)
    const todayHasWin = winByDailyNum.has(todayDailyNumber);
    let streakStart = todayHasWin ? todayDailyNumber : todayDailyNumber - 1;
    let currentStreak = 0;
    for (let num = streakStart; num >= startDailyNumber; num--) {
      if (!winByDailyNum.has(num)) break;
      currentStreak++;
    }

    // Max streak within lookback window
    let maxStreak = 0;
    let run = 0;
    for (let num = startDailyNumber; num <= todayDailyNumber; num++) {
      if (winByDailyNum.has(num)) {
        run++;
        maxStreak = Math.max(maxStreak, run);
      } else {
        run = 0;
      }
    }

    // Recent (last 10 dailyNumbers)
    const startRecent = Math.max(startDailyNumber, todayDailyNumber - 9);
    for (let num = startRecent; num <= todayDailyNumber; num++) {
      recent.push({
        dailyNumber: num,
        won: winByDailyNum.has(num),
        guesses: guessesByDailyNum.get(num) ?? null,
      });
    }

    let displayName = `Player ${hashAnonId(anon_id).slice(0, 4)}`;
    let avatarUrl = '';
    let isVerified = VERIFIED_ANON_IDS.has(anon_id);
    try {
      const { data: linkRows } = await supabase
        .from('anon_links')
        .select('user_id')
        .eq('anon_id', anon_id)
        .limit(1);
      const link = Array.isArray(linkRows) ? linkRows[0] : null;

      if (link?.user_id) {
        const { data: profRows } = await supabase
          .from('profiles')
          .select('display_name,avatar_url,is_verified')
          .eq('user_id', link.user_id)
          .limit(1);
        const prof = Array.isArray(profRows) ? profRows[0] : null;
        if (prof) {
          displayName = prof.display_name || displayName;
          avatarUrl = prof.avatar_url || '';
          isVerified = prof.is_verified === true;
        }
      }
    } catch {
      // Ignore if tables are missing.
    }

    const value = {
      mode,
      anon_id,
      user: displayName,
      avatarUrl,
      verified: isVerified,
      todayDailyNumber,
      wins,
      avgGuesses: avgGuesses == null ? null : Number(avgGuesses.toFixed(2)),
      currentStreak,
      maxStreak,
      recent,
      updatedAt: new Date().toISOString(),
    };

    return json(res, 200, value);
  } catch (e) {
    return json(res, 500, { error: 'Server misconfigured' });
  }
}

