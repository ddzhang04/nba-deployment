-- NBA Mantle — paste into Supabase SQL Editor to debug leaderboards.
-- Run sections one at a time; inspect results.

-- ---------------------------------------------------------------------------
-- 1) Function exists + is SECURITY DEFINER (reads all mantle_runs for aggregates)
-- ---------------------------------------------------------------------------
SELECT
  p.proname,
  p.prosecdef AS is_security_definer,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_leaderboard_snapshot';

-- ---------------------------------------------------------------------------
-- 2) Which mode strings exist? (Leaderboard RPC expects 'daily' | 'hardcore' per CHECK)
-- ---------------------------------------------------------------------------
SELECT mode, count(*)::bigint AS n
FROM public.mantle_runs
GROUP BY mode
ORDER BY n DESC;

-- ---------------------------------------------------------------------------
-- 3) Recent mantle_runs (hardcore + daily) — verify mode, user_id, guesses
-- ---------------------------------------------------------------------------
SELECT id, anon_id, user_id, mode, daily_number, guesses, won, created_at
FROM public.mantle_runs
ORDER BY created_at DESC
LIMIT 40;

-- ---------------------------------------------------------------------------
-- 4) Hardcore rows that NEVER appear on leaderboard (no attributable uid)
--    Leaderboard requires: user_id OR anon_id like 'user:%uuid'
-- ---------------------------------------------------------------------------
SELECT id, anon_id, user_id, mode, daily_number, guesses, won, created_at
FROM public.mantle_runs
WHERE mode = 'hardcore'
  AND user_id IS NULL
  AND (anon_id NOT LIKE 'user:%' OR split_part(anon_id, ':', 2) = '')
ORDER BY created_at DESC
LIMIT 50;

-- ---------------------------------------------------------------------------
-- 5) Count hardcore rows per mode of attribution
-- ---------------------------------------------------------------------------
SELECT
  CASE
    WHEN user_id IS NOT NULL THEN 'has user_id'
    WHEN anon_id LIKE 'user:%' THEN 'anon user: prefix'
    ELSE 'guest device only (excluded from leaderboard)'
  END AS bucket,
  count(*)::bigint AS n
FROM public.mantle_runs
WHERE mode = 'hardcore'
GROUP BY 1
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- 6) Live RPC output (widen p_last_daily if your app epoch is ahead in DB tests)
-- ---------------------------------------------------------------------------
SELECT *
FROM public.get_leaderboard_snapshot('hardcore', 1, 5000)
ORDER BY completions DESC, total_guesses_all DESC
LIMIT 30;

SELECT *
FROM public.get_leaderboard_snapshot('daily', 1, 5000)
ORDER BY completions DESC, total_guesses_all DESC
LIMIT 30;

-- ---------------------------------------------------------------------------
-- 7) Lookup by your auth user id (replace UUID)
-- ---------------------------------------------------------------------------
-- SELECT * FROM public.mantle_runs WHERE user_id = 'YOUR-UUID-HERE'::uuid ORDER BY created_at DESC;
-- SELECT * FROM public.get_leaderboard_snapshot('hardcore', 1, 5000) WHERE user_id = 'YOUR-UUID-HERE'::uuid;

-- ---------------------------------------------------------------------------
-- 8) Repair a guest row you know is yours (device reveal saved before user_id resolved)
--    Only run if anon_id matches your device id from localStorage
--    `nba-mantle-analytics-id` / sid — and you are sure no one else shares that row.
-- ---------------------------------------------------------------------------
-- UPDATE public.mantle_runs
-- SET user_id = '3201149d-68f5-484c-b143-83f644846250'::uuid
-- WHERE id = 196
--   AND user_id IS NULL
--   AND mode = 'hardcore'
--   AND daily_number = 1;
